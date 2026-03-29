/**
 * 自動化任務調度器
 * 定時掃描數據庫中未使用的邀請碼，並觸發 AdsPower 創建瀏覽器實例
 */

import {
  createTaskLog,
  getAutomationTaskById,
  getUnusedInviteCodes,
  updateAutomationTask,
  updateInviteStatus,
  updateTaskLog,
} from "./db";
import { createAdsPowerBrowser } from "./adspower";

// 全局調度器狀態
const schedulerTimers = new Map<number, NodeJS.Timeout>();
let isRunning = false;

/**
 * 啟動自動化任務調度器
 */
export async function startScheduler(taskId: number): Promise<void> {
  if (schedulerTimers.has(taskId)) {
    console.log(`[Scheduler] Task ${taskId} is already running`);
    return;
  }

  const task = await getAutomationTaskById(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  await updateAutomationTask(taskId, {
    status: "running",
    startedAt: new Date(),
  });

  console.log(`[Scheduler] Starting task ${taskId} with interval ${task.scanIntervalSeconds}s`);

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

/**
 * 暫停自動化任務
 */
export async function pauseScheduler(taskId: number): Promise<void> {
  const timer = schedulerTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    schedulerTimers.delete(taskId);
  }
  await updateAutomationTask(taskId, { status: "paused" });
  console.log(`[Scheduler] Task ${taskId} paused`);
}

/**
 * 停止自動化任務
 */
export async function stopScheduler(taskId: number): Promise<void> {
  const timer = schedulerTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    schedulerTimers.delete(taskId);
  }
  await updateAutomationTask(taskId, { status: "stopped" });
  console.log(`[Scheduler] Task ${taskId} stopped`);
}

/**
 * 獲取所有正在運行的任務 ID
 */
export function getRunningTaskIds(): number[] {
  return Array.from(schedulerTimers.keys());
}

/**
 * 執行一次掃描和觸發邏輯
 */
async function executeTask(taskId: number): Promise<void> {
  const task = await getAutomationTaskById(taskId);
  if (!task) return;

  const startTime = Date.now();

  try {
    // 1. 掃描未使用的邀請碼
    const unusedCodes = await getUnusedInviteCodes();

    if (unusedCodes.length === 0) {
      console.log(`[Scheduler] Task ${taskId}: No unused invite codes found`);
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    // 2. 取第一個未使用的邀請碼（按創建時間排序）
    const targetAccount = unusedCodes[0];
    const inviteCode = targetAccount.inviteCode;

    if (!inviteCode) {
      console.log(`[Scheduler] Task ${taskId}: Account has no invite code`);
      return;
    }

    console.log(`[Scheduler] Task ${taskId}: Processing invite code ${inviteCode} from account ${targetAccount.email}`);

    // 3. 創建任務日誌
    const logResult = await createTaskLog({
      taskId,
      status: "running",
      usedInviteCode: inviteCode,
      sourceAccountId: targetAccount.id,
      startedAt: new Date(),
    });

    // 獲取日誌 ID（MySQL insertId）
    const logId = (logResult as any)[0]?.insertId;

    // 4. 將邀請碼狀態改為「邀請中」
    await updateInviteStatus(inviteCode, "in_progress");

    // 5. 調用 AdsPower API 創建瀏覽器實例
    const browserResult = await createAdsPowerBrowser(
      {
        apiUrl: task.adspowerApiUrl || "http://local.adspower.net:50325",
        groupId: task.adspowerGroupId || undefined,
      },
      inviteCode
    );

    const durationMs = Date.now() - startTime;

    if (browserResult.success) {
      // 6a. 成功：更新日誌
      if (logId) {
        await updateTaskLog(logId, {
          status: "success",
          adspowerBrowserId: browserResult.browserId,
          durationMs,
          completedAt: new Date(),
        });
      }

      await updateAutomationTask(taskId, {
        lastExecutedAt: new Date(),
        totalSuccess: (task.totalSuccess || 0) + 1,
      });

      console.log(`[Scheduler] Task ${taskId}: Browser created successfully - ${browserResult.browserId}`);
    } else {
      // 6b. 失敗：恢復邀請碼狀態，記錄錯誤
      await updateInviteStatus(inviteCode, "unused");

      if (logId) {
        await updateTaskLog(logId, {
          status: "failed",
          errorMessage: browserResult.error,
          durationMs,
          completedAt: new Date(),
        });
      }

      await updateAutomationTask(taskId, {
        lastExecutedAt: new Date(),
        totalFailed: (task.totalFailed || 0) + 1,
      });

      console.error(`[Scheduler] Task ${taskId}: Failed to create browser - ${browserResult.error}`);
    }
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[Scheduler] Task ${taskId}: Unexpected error - ${error?.message}`);

    await updateAutomationTask(taskId, {
      lastExecutedAt: new Date(),
      totalFailed: (task.totalFailed || 0) + 1,
    });
  }
}
