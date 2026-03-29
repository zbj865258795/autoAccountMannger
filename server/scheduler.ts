/**
 * 自動化任務調度器
 *
 * 核心邏輯：
 * 1. 定時查詢數據庫中「未使用」的邀請碼數量（只讀，不修改狀態）
 * 2. 根據 maxConcurrent（線程數）和 targetCount（目標總數）計算本次需要創建幾個瀏覽器
 * 3. 調用 AdsPower API 創建並啟動對應數量的瀏覽器實例
 * 4. 邀請碼的認領和狀態變更由插件端通過 callback 接口完成
 */

import {
  getUnusedInviteCodeCount,
  createTaskLog,
  getAutomationTaskById,
  incrementTaskCounters,
  updateAutomationTask,
  updateTaskLog,
} from "./db";
import {
  createAdsPowerBrowser,
  startAdsPowerBrowser,
  stopAndDeleteAdsPowerBrowser,
} from "./adspower";
import { ADSPOWER_CONFIG } from "./config";

// ─── 全局調度器狀態 ───────────────────────────────────────────────────────────

const schedulerTimers = new Map<number, NodeJS.Timeout>();

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
      return;
    }
    await executeTask(taskId);
  }, (task.scanIntervalSeconds || 60) * 1000);

  schedulerTimers.set(taskId, timer);
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

    // 2. 計算本次需要創建的瀏覽器數量
    let browsersToCreate = Math.min(maxConcurrent, unusedCount);

    // 如果有目標總數限制，還需要考慮剩餘名額
    if (task.targetCount) {
      const remaining = task.targetCount - (task.totalAccountsCreated ?? 0);
      browsersToCreate = Math.min(browsersToCreate, remaining);
    }

    if (browsersToCreate <= 0) {
      console.log(`[Scheduler] Task ${taskId}: No browsers needed to create`);
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    console.log(
      `[Scheduler] Task ${taskId}: ${unusedCount} unused invite codes available, creating ${browsersToCreate} browser(s)`
    );

    // 3. 並發創建瀏覽器（不綁定具體邀請碼，邀請碼由插件端認領）
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
