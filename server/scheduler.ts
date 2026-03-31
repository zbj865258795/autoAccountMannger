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
  getRunningLogsForTask,
  getRunningLogByBrowserId,
  failAllRunningLogsForTask,
  incrementTaskCounters,
  updateAutomationTask,
  updateTaskLog,
} from "./db";
import {
  closeAdsPowerBrowser,
  createAdsPowerBrowser,
  deleteAdsPowerBrowsers,
  getActiveBrowsers,
  startAdsPowerBrowser,
  stopAndDeleteAdsPowerBrowser,
} from "./adspower";
import { ADSPOWER_CONFIG } from "./config";

// ─── 全局調度器狀態 ───────────────────────────────────────────────────────────

const schedulerTimers = new Map<number, NodeJS.Timeout>();

// 記錄每個任務對應的 AdsPower apiUrl（用於監控時清理瀏覽器）
const taskApiUrls = new Map<number, string>();

// ★ 修复：每个任务的 executeTask 全局防并发锁
// 防止以下两种场景同时触发多个 executeTask 导致创建多余浏览器：
//   1. startScheduler 立即执行 + 定时器第一次触发（时间差极短时会并发）
//   2. 多个浏览器同时失败时，handlePluginError 被并发调用
const executeTaskLocks = new Map<number, boolean>();

// ─── 瀏覽器狀態監控 ──────────────────────────────────────────────────────────

let browserMonitorTimer: NodeJS.Timeout | null = null;
const BROWSER_MONITOR_INTERVAL = 15000; // 每 15 秒檢查一次

/**
 * 啟動瀏覽器狀態監控
 */
function startBrowserMonitor(): void {
  if (browserMonitorTimer) return;

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
 * 停止瀏覽器狀態監控
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
  const runningLogs = await getRunningLogsWithBrowserId();
  if (runningLogs.length === 0) return;

  // 按 taskId 分組，每個任務用自己的 apiUrl 查詢活躍瀏覽器
  const taskGroups = new Map<number, typeof runningLogs>();
  for (const log of runningLogs) {
    if (!log.taskId) continue;
    if (!taskGroups.has(log.taskId)) taskGroups.set(log.taskId, []);
    taskGroups.get(log.taskId)!.push(log);
  }

  for (const [taskId, logs] of taskGroups) {
    // 優先用任務自己保存的 apiUrl，否則用全局配置
    const apiUrl = taskApiUrls.get(taskId) || ADSPOWER_CONFIG.apiUrl;
    const adspowerConfig = { apiUrl, apiKey: ADSPOWER_CONFIG.apiKey };

    const activeBrowsers = await getActiveBrowsers(apiUrl);
    const activeIds = new Set(activeBrowsers.map((b) => b.browserId));

    console.log(
      `[BrowserMonitor] Task ${taskId}: checking ${logs.length} browser(s) | ${activeIds.size} active in AdsPower`
    );

    // ★ 修复问题6：设置 3 分钟保护窗口期
    // 浏览器初始化和插件加载需要时间，如果就开始监控就判定为失败会误判
    // 只有启动超过 3 分钟的浏览器才进行存活检测
    const BROWSER_STARTUP_GRACE_MS = 3 * 60 * 1000; // 3 分钟

    for (const log of logs) {
      const browserId = log.adspowerBrowserId;
      if (!browserId) continue;

      // ★ 保护窗口期内跳过检测
      if (log.startedAt) {
        const ageMs = Date.now() - new Date(log.startedAt).getTime();
        if (ageMs < BROWSER_STARTUP_GRACE_MS) {
          console.log(
            `[BrowserMonitor] Browser ${browserId} (log #${log.id}) is within grace period (${Math.round(ageMs / 1000)}s < ${BROWSER_STARTUP_GRACE_MS / 1000}s), skipping check`
          );
          continue;
        }
      }

      if (!activeIds.has(browserId)) {
        const durationMs = log.startedAt
          ? Date.now() - new Date(log.startedAt).getTime()
          : undefined;

        console.log(
          `[BrowserMonitor] Browser ${browserId} (log #${log.id}) is no longer active → marking failed`
        );

        await updateTaskLog(log.id, {
          status: "failed",
          errorMessage: "浏览器被关闭或异常退出（由状态监控检测到）",
          durationMs,
          completedAt: new Date(),
        });

        await incrementTaskCounters(taskId, { totalFailed: 1 });

        // 嘗試清理（可能已不存在，忽略錯误）
        await stopAndDeleteAdsPowerBrowser(adspowerConfig, browserId).catch(() => {});
      }
    }
  }
}

// ─── 停止任務時清理所有 running 日誌和瀏覽器 ─────────────────────────────────

async function cleanupTaskBrowsers(taskId: number, reason: string): Promise<void> {
  const apiUrl = taskApiUrls.get(taskId) || ADSPOWER_CONFIG.apiUrl;
  const adspowerConfig = { apiUrl, apiKey: ADSPOWER_CONFIG.apiKey };

  // 1. 先獲取「本任務」所有 running 且有 browserId 的日誌
  //    getRunningLogsForTask 已按 taskId 過濾，不會取到其他任務的瀏覽器
  const runningLogs = await getRunningLogsForTask(taskId);

  // 2. 批量標記「本任務」所有 running 日誌為 failed
  const affected = await failAllRunningLogsForTask(taskId, reason);
  if (affected > 0) {
    console.log(`[Scheduler] Task ${taskId}: marked ${affected} running log(s) as failed (${reason})`);
  }

  // 3. 收集「本任務」所有需要關閉的 browserId
  const browserIds = runningLogs
    .map((log) => log.adspowerBrowserId)
    .filter((id): id is string => !!id);

  if (browserIds.length === 0) return;

  console.log(`[Scheduler] Task ${taskId}: closing ${browserIds.length} browser(s) concurrently: [${browserIds.join(", ")}]`);

  // 4. 先並發關閉所有瀏覽器進程（stop），再批量刪除環境（delete）
  //    兩步分開：stop 需要逐個調用，delete 支持批量一次性提交
  await Promise.all(
    browserIds.map((browserId) =>
      closeAdsPowerBrowser(adspowerConfig, browserId).catch((e) =>
        console.error(`[Scheduler] Task ${taskId}: failed to close browser ${browserId}: ${e}`)
      )
    )
  );

  // 批量刪除（AdsPower v2 API 支持一次傳入多個 profile_id，單次最多 100 個）
  await deleteAdsPowerBrowsers(adspowerConfig, browserIds).catch((e) =>
    console.error(`[Scheduler] Task ${taskId}: failed to batch-delete browsers [${browserIds.join(", ")}]: ${e}`)
  );
}

// ─── 啟動調度器 ───────────────────────────────────────────────────────────────

export async function startScheduler(taskId: number): Promise<void> {
  if (schedulerTimers.has(taskId)) {
    console.log(`[Scheduler] Task ${taskId} is already running`);
    return;
  }

  const task = await getAutomationTaskById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  // 記錄該任務的 apiUrl
  const apiUrl = task.adspowerApiUrl || ADSPOWER_CONFIG.apiUrl;
  taskApiUrls.set(taskId, apiUrl);

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
      taskApiUrls.delete(taskId);
      if (schedulerTimers.size === 0) stopBrowserMonitor();
      return;
    }
    await executeTask(taskId);
  }, (task.scanIntervalSeconds || 60) * 1000);

  schedulerTimers.set(taskId, timer);

  // 啟動瀏覽器狀態監控
  startBrowserMonitor();
}

// ─── 暫停調度器 ───────────────────────────────────────────────────────────────

export async function pauseScheduler(taskId: number): Promise<void> {
  const timer = schedulerTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    schedulerTimers.delete(taskId);
  }

  // 清理所有 running 日誌和瀏覽器
  await cleanupTaskBrowsers(taskId, "任务已暂停，浏览器被强制关闭");

  await updateAutomationTask(taskId, { status: "paused" });
  console.log(`[Scheduler] Task ${taskId} paused`);

  if (schedulerTimers.size === 0) {
    taskApiUrls.delete(taskId);
    stopBrowserMonitor();
  }
}

// ─── 停止調度器 ───────────────────────────────────────────────────────────────

export async function stopScheduler(taskId: number): Promise<void> {
  const timer = schedulerTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    schedulerTimers.delete(taskId);
  }

  // 清理所有 running 日誌和瀏覽器
  await cleanupTaskBrowsers(taskId, "任务已停止，浏览器被强制关闭");

  await updateAutomationTask(taskId, { status: "stopped" });
  console.log(`[Scheduler] Task ${taskId} stopped`);

  taskApiUrls.delete(taskId);
  if (schedulerTimers.size === 0) stopBrowserMonitor();
}

// ─── 獲取運行中的任务 ID ────────────────────────────────────────────────────────────────

export function getRunningTaskIds(): number[] {
  return Array.from(schedulerTimers.keys());
}

// ─── 插件异常上报处理 ────────────────────────────────────────────────────────────────

/**
 * 处理插件上报的注册异常
 *
 * 流程：
 * 1. 根据 browserId 查找对应的 taskLog 和 taskId
 * 2. 将该日志标记为 failed，记录错误信息
 * 3. 关闭并删除对应的 AdsPower 浏览器环境
 * 4. 更新任务失败计数
 * 5. 立即触发一次 executeTask，让任务继续创建新的浏览器实例
 */
export async function handlePluginError(
  browserId: string,
  errorMessage: string
): Promise<{ success: boolean; message: string }> {
  console.log(`[PluginCallback] Received error report for browser ${browserId}: ${errorMessage}`);

  // 1. 根据 browserId 查找对应的 running 日志
  const log = await getRunningLogByBrowserId(browserId);

  if (!log) {
    console.warn(`[PluginCallback] No running log found for browser ${browserId}, ignoring`);
    return { success: false, message: `未找到对应的运行中任务（browserId: ${browserId}）` };
  }

  const taskId = log.taskId!;
  const logId = log.id;
  const durationMs = log.startedAt
    ? Date.now() - new Date(log.startedAt).getTime()
    : undefined;

  // 2. 将日志标记为 failed
  await updateTaskLog(logId, {
    status: "failed",
    errorMessage: `插件上报异常: ${errorMessage}`,
    durationMs,
    completedAt: new Date(),
  });

  // 3. 关闭并删除 AdsPower 浏览器环境
  const apiUrl = taskApiUrls.get(taskId) || ADSPOWER_CONFIG.apiUrl;
  const adspowerConfig = { apiUrl, apiKey: ADSPOWER_CONFIG.apiKey };

  console.log(`[PluginCallback] Closing and deleting browser ${browserId} for task ${taskId}`);
  await stopAndDeleteAdsPowerBrowser(adspowerConfig, browserId).catch((e) =>
    console.error(`[PluginCallback] Failed to cleanup browser ${browserId}: ${e}`)
  );

  // 4. 更新任务失败计数
  await incrementTaskCounters(taskId, { totalFailed: 1 });

  // 5. 如果任务仍在运行中，立即触发一次新的执行循环（创建新浏览器实例）
  // ★ 修复问题B：加锁防止并发，同一任务同一时刻只允许一个 executeTask 在运行
  const task = await getAutomationTaskById(taskId);
  if (task && task.status === "running") {
    if (executeTaskLocks.get(taskId)) {
      console.log(`[PluginCallback] Task ${taskId} executeTask already in progress, skipping duplicate trigger`);
    } else {
      console.log(`[PluginCallback] Task ${taskId} is still running, triggering next execution immediately`);
      executeTaskLocks.set(taskId, true);
      // 异步触发，不阻塞当前请求
      executeTask(taskId)
        .catch((e) => console.error(`[PluginCallback] Failed to trigger next execution for task ${taskId}: ${e}`))
        .finally(() => executeTaskLocks.delete(taskId));
    }
  } else {
    console.log(`[PluginCallback] Task ${taskId} is not running (status: ${task?.status}), skipping re-trigger`);
  }

  return { success: true, message: `已处理异常，浏览器 ${browserId} 已关闭并删除，任务已触发下一次注册` };
}

// ─── 核心執行邏輯（只負責創建瀏覽器，不操作邀請碼） ──────────────────────────

async function executeTask(taskId: number): Promise<void> {
  // ★ 修复：全局防并发锁，同一任务同一时刻只允许一个 executeTask 在运行
  // 这是防止「创建两个浏览器」的核心修复
  if (executeTaskLocks.get(taskId)) {
    console.log(`[Scheduler] Task ${taskId}: executeTask already in progress, skipping concurrent call`);
    return;
  }
  executeTaskLocks.set(taskId, true);

  try {
    await _executeTask(taskId);
  } finally {
    executeTaskLocks.delete(taskId);
  }
}

async function _executeTask(taskId: number): Promise<void> {
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

  const adspowerConfig = {
    apiUrl: task.adspowerApiUrl || ADSPOWER_CONFIG.apiUrl,
    apiKey: ADSPOWER_CONFIG.apiKey,
    groupId: task.adspowerGroupId || undefined,
  };
  const targetUrl = (task as any).targetUrl || undefined;

  try {
    // 1. 只讀查詢：獲取當前未使用的邀請碼數量
    const unusedCount = await getUnusedInviteCodeCount();

    if (unusedCount === 0) {
      console.log(`[Scheduler] Task ${taskId}: No unused invite codes available`);
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    // 2. 查詢當前正在運行中的瀏覽器數量（避免重複創建）
    const runningLogs = await getRunningLogsForTask(taskId);
    const currentRunning = runningLogs.length;

    // 3. 計算本次需要創建的瀏覽器數量
    let browsersToCreate = Math.min(maxConcurrent - currentRunning, unusedCount);

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

    // 4. 並發創建瀏覽器
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

// ─── 創建單個瀏覽器實例 ─────────────────────────────────────────────────────

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

    const logResult = await createTaskLog({
      taskId,
      status: "running",
      startedAt: new Date(),
    });
    logId = (logResult as any)[0]?.insertId;

    const createResult = await createAdsPowerBrowser(adspowerConfig, `task_${taskId}_${Date.now()}`, {
      targetUrl,
    });

    if (!createResult.success || !createResult.profileId) {
      throw new Error(createResult.error || "Failed to create browser profile");
    }

    const profileId = createResult.profileId;

    const startResult = await startAdsPowerBrowser(adspowerConfig, profileId);
    const durationMs = Date.now() - startTime;

    if (startResult.success) {
      if (logId) {
        await updateTaskLog(logId, {
          status: "running",
          adspowerBrowserId: profileId,
          durationMs,
        });
      }
      console.log(`[Scheduler] Task ${taskId}: Browser started | profile: ${profileId}`);
    } else {
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
    console.error(`[Scheduler] Task ${taskId}: Failed to create/start browser - ${msg}`);
  }
}
