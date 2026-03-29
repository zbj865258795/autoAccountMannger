/**
 * 自動化任務調度器
 *
 * 核心邏輯：
 * 1. 定時查詢數據庫中「未使用」的邀請碼數量（只讀，不修改狀態）
 * 2. 根據 maxConcurrent（線程數）和 targetCount（目標總數）計算本次需要創建幾個瀏覽器
 * 3. 調用 AdsPower API 創建並啟動對應數量的瀏覽器實例
 * 4. 邀請碼的認領和狀態變更由插件端通過 callback 接口完成
 * 5. 定時輪詢已啟動瀏覽器的狀態，異常關閉時自動標記任務失敗並清理
 */

import {
  getUnusedInviteCodeCount,
  createTaskLog,
  getAutomationTaskById,
  getRunningLogsWithBrowserId,
  incrementTaskCounters,
  updateAutomationTask,
  updateTaskLog,
} from "./db";
import {
  createAdsPowerBrowser,
  getActiveBrowsers,
  startAdsPowerBrowser,
  stopAndDeleteAdsPowerBrowser,
} from "./adspower";
import { ADSPOWER_CONFIG } from "./config";

// ─── 全局調度器狀態 ───────────────────────────────────────────────────────────

const schedulerTimers = new Map<number, NodeJS.Timeout>();

// ─── 瀏覽器狀態監控 ──────────────────────────────────────────────────────────

let browserMonitorTimer: NodeJS.Timeout | null = null;
const BROWSER_MONITOR_INTERVAL = 15000; // 每 15 秒檢查一次

/**
 * 啟動瀏覽器狀態監控
 * 定時檢查所有 running 狀態的任務日誌對應的瀏覽器是否還活著
 * 如果瀏覽器被手動關閉或異常退出，自動標記為失敗並清理
 */
function startBrowserMonitor(): void {
  if (browserMonitorTimer) return; // 已經在運行

  console.log(`[BrowserMonitor] Started | interval: ${BROWSER_MONITOR_INTERVAL / 1000}s`);

  browserMonitorTimer = setInterval(async () => {
    try {
      await checkBrowserStatus();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[BrowserMonitor] Error: ${msg}`);
    }
  }, BROWSER_MONITOR_INTERVAL);
}

/**
 * 停止瀏覽器狀態監控（當沒有任何運行中的調度器時）
 */
function stopBrowserMonitor(): void {
  if (browserMonitorTimer) {
    clearInterval(browserMonitorTimer);
    browserMonitorTimer = null;
    console.log(`[BrowserMonitor] Stopped`);
  }
}

/**
 * 核心檢查邏輯：
 * 1. 從數據庫獲取所有 running 且有 adspowerBrowserId 的任務日誌
 * 2. 從 AdsPower 獲取當前活躍的瀏覽器列表
 * 3. 對比：如果某個日誌的瀏覽器不在活躍列表中，說明已關閉
 * 4. 標記該日誌為 failed，並嘗試刪除 AdsPower 中的瀏覽器環境
 */
async function checkBrowserStatus(): Promise<void> {
  // 1. 獲取所有 running 且有 browserId 的日誌
  const runningLogs = await getRunningLogsWithBrowserId();
  if (runningLogs.length === 0) return;

  // 2. 獲取 AdsPower 當前活躍的瀏覽器列表
  const apiUrl = ADSPOWER_CONFIG.apiUrl;
  const activeBrowsers = await getActiveBrowsers(apiUrl);
  const activeIds = new Set(activeBrowsers.map((b) => b.browserId));

  console.log(
    `[BrowserMonitor] Checking ${runningLogs.length} running browser(s) | ${activeIds.size} active in AdsPower`
  );

  // 3. 對比：找出已關閉的瀏覽器
  for (const log of runningLogs) {
    const browserId = log.adspowerBrowserId;
    if (!browserId) continue;

    if (!activeIds.has(browserId)) {
      // 瀏覽器已不在活躍列表中 → 被關閉或異常退出
      const durationMs = log.startedAt
        ? Date.now() - new Date(log.startedAt).getTime()
        : undefined;

      console.log(
        `[BrowserMonitor] Browser ${browserId} (log #${log.id}) is no longer active, marking as failed`
      );

      // 標記日誌為失敗
      await updateTaskLog(log.id, {
        status: "failed",
        errorMessage: "浏览器被关闭或异常退出（由状态监控检测到）",
        durationMs,
        completedAt: new Date(),
      });

      // 更新任務計數器
      if (log.taskId) {
        await incrementTaskCounters(log.taskId, { totalFailed: 1 });
      }

      // 嘗試清理 AdsPower 中的瀏覽器環境（可能已經不存在，忽略錯誤）
      const adspowerConfig = {
        apiUrl,
        apiKey: ADSPOWER_CONFIG.apiKey,
      };
      await stopAndDeleteAdsPowerBrowser(adspowerConfig, browserId).catch(() => {});
    }
  }
}

// ─── 啟動調度器 ───────────────────────────────────────────────────────────────

export async function startScheduler(taskId: number): Promise<void> {
  if (schedulerTimers.has(taskId)) {
    console.log(`[Scheduler] Task ${taskId} is already running`);
    return;
  }

  const task = await getAutomationTaskById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  await updateAutomationTask(taskId, {
    status: "running",
    startedAt: new Date(),
  });

  console.log(
    `[Scheduler] Starting task ${taskId} "${task.name}" | interval: ${task.scanIntervalSeconds}s | maxConcurrent: ${task.maxConcurrent}`
  );

  // 立即執行一次
  await executeTask(taskId);

  // 設置定時器
  const timer = setInterval(async () => {
    const currentTask = await getAutomationTaskById(taskId);
    if (!currentTask || currentTask.status !== "running") {
      clearInterval(timer);
      schedulerTimers.delete(taskId);
      // 如果沒有任何運行中的調度器，停止瀏覽器監控
      if (schedulerTimers.size === 0) stopBrowserMonitor();
      return;
    }
    await executeTask(taskId);
  }, (task.scanIntervalSeconds || 60) * 1000);

  schedulerTimers.set(taskId, timer);

  // 啟動瀏覽器狀態監控（如果尚未啟動）
  startBrowserMonitor();
}

// ─── 暫停調度器 ───────────────────────────────────────────────────────────────

export async function pauseScheduler(taskId: number): Promise<void> {
  const timer = schedulerTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    schedulerTimers.delete(taskId);
  }
  await updateAutomationTask(taskId, { status: "paused" });
  console.log(`[Scheduler] Task ${taskId} paused`);
  if (schedulerTimers.size === 0) stopBrowserMonitor();
}

// ─── 停止調度器 ───────────────────────────────────────────────────────────────

export async function stopScheduler(taskId: number): Promise<void> {
  const timer = schedulerTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    schedulerTimers.delete(taskId);
  }
  await updateAutomationTask(taskId, { status: "stopped" });
  console.log(`[Scheduler] Task ${taskId} stopped`);
  if (schedulerTimers.size === 0) stopBrowserMonitor();
}

// ─── 獲取運行中的任務 ID ──────────────────────────────────────────────────────

export function getRunningTaskIds(): number[] {
  return Array.from(schedulerTimers.keys());
}

// ─── 核心執行邏輯（只負責創建瀏覽器，不操作邀請碼） ──────────────────────────

async function executeTask(taskId: number): Promise<void> {
  const task = await getAutomationTaskById(taskId);
  if (!task) return;

  const maxConcurrent = task.maxConcurrent || 1;

  // 检查是否已达到注册目标总数
  if (task.targetCount && (task.totalAccountsCreated ?? 0) >= task.targetCount) {
    console.log(
      `[Scheduler] Task ${taskId}: Target count reached (${task.totalAccountsCreated}/${task.targetCount}), auto-stopping`
    );
    await stopScheduler(taskId);
    return;
  }

  // API Key 从配置文件读取
  const adspowerConfig = {
    apiUrl: task.adspowerApiUrl || ADSPOWER_CONFIG.apiUrl,
    apiKey: ADSPOWER_CONFIG.apiKey,
    groupId: task.adspowerGroupId || undefined,
  };
  const targetUrl = (task as any).targetUrl || undefined;

  try {
    // 1. 只讀查詢：獲取當前未使用的邀請碼數量（不修改任何狀態）
    const unusedCount = await getUnusedInviteCodeCount();

    if (unusedCount === 0) {
      console.log(`[Scheduler] Task ${taskId}: No unused invite codes available`);
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    // 2. 查詢當前正在運行中的瀏覽器數量（避免重複創建）
    const runningLogs = await getRunningLogsWithBrowserId();
    const currentRunning = runningLogs.filter((l) => l.taskId === taskId).length;

    // 3. 計算本次需要創建的瀏覽器數量（扣除已在運行的）
    let browsersToCreate = Math.min(maxConcurrent - currentRunning, unusedCount);

    // 如果有目標總數限制，還需要考慮剩餘名額
    if (task.targetCount) {
      const remaining = task.targetCount - (task.totalAccountsCreated ?? 0);
      browsersToCreate = Math.min(browsersToCreate, remaining);
    }

    if (browsersToCreate <= 0) {
      console.log(
        `[Scheduler] Task ${taskId}: No new browsers needed (running: ${currentRunning}/${maxConcurrent})`
      );
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    console.log(
      `[Scheduler] Task ${taskId}: ${unusedCount} unused codes | ${currentRunning} running | creating ${browsersToCreate} new browser(s)`
    );

    // 4. 並發創建瀏覽器（不綁定具體邀請碼，邀請碼由插件端認領）
    await Promise.all(
      Array.from({ length: browsersToCreate }, (_, i) =>
        createOneBrowser(taskId, task, adspowerConfig, targetUrl, i)
      )
    );

    await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Scheduler] Task ${taskId}: Unexpected error - ${msg}`);
    await incrementTaskCounters(taskId, { totalFailed: 1 });
  }
}

// ─── 創建單個瀏覽器實例（不涉及邀請碼操作） ─────────────────────────────────

async function createOneBrowser(
  taskId: number,
  task: Awaited<ReturnType<typeof getAutomationTaskById>>,
  adspowerConfig: { apiUrl: string; apiKey?: string; groupId?: string },
  targetUrl?: string,
  index?: number
): Promise<void> {
  const startTime = Date.now();
  let logId: number | undefined;

  try {
    console.log(`[Scheduler] Task ${taskId}: Creating browser instance #${(index ?? 0) + 1}`);

    // 1. 創建任務日誌
    const logResult = await createTaskLog({
      taskId,
      status: "running",
      startedAt: new Date(),
    });
    logId = (logResult as any)[0]?.insertId;

    // 2. 調用 AdsPower API 創建瀏覽器環境（隨機指紋）
    //    注意：不傳入邀請碼，瀏覽器只是一個空環境，邀請碼由插件端認領
    const createResult = await createAdsPowerBrowser(adspowerConfig, `task_${taskId}_${Date.now()}`, {
      targetUrl,
    });

    if (!createResult.success || !createResult.profileId) {
      throw new Error(createResult.error || "Failed to create browser profile");
    }

    const profileId = createResult.profileId;

    // 3. 啟動瀏覽器
    const startResult = await startAdsPowerBrowser(adspowerConfig, profileId);

    const durationMs = Date.now() - startTime;

    if (startResult.success) {
      // 成功：更新日誌
      if (logId) {
        await updateTaskLog(logId, {
          status: "running",
          adspowerBrowserId: profileId,
          durationMs,
        });
      }

      console.log(
        `[Scheduler] Task ${taskId}: Browser started successfully | profile: ${profileId}`
      );
    } else {
      // 啟動失敗，清理已創建的瀏覽器環境
      await stopAndDeleteAdsPowerBrowser(adspowerConfig, profileId).catch((e) =>
        console.error(`[Scheduler] Task ${taskId}: Failed to cleanup browser ${profileId}: ${e}`)
      );
      throw new Error(startResult.error || "Failed to start browser");
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    if (logId) {
      await updateTaskLog(logId, {
        status: "failed",
        errorMessage: msg,
        durationMs,
        completedAt: new Date(),
      });
    }

    await incrementTaskCounters(taskId, { totalFailed: 1 });

    console.error(
      `[Scheduler] Task ${taskId}: Failed to create/start browser - ${msg}`
    );
  }
}
