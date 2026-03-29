/**
 * 自動化任務調度器
 *
 * 核心邏輯：
 * 1. 定時掃描數據庫中「未使用」的邀請碼
 * 2. 根據 maxConcurrent 設置，同時啟動多個 AdsPower 瀏覽器實例
 * 3. 每個瀏覽器實例對應一個邀請碼，插件自動運行注冊流程
 * 4. 注冊成功後插件回調系統，更新邀請碼狀態為「已使用」
 */

import {
  createTaskLog,
  getAutomationTaskById,
  getUnusedInviteCodes,
  updateAutomationTask,
  updateInviteStatus,
  updateTaskLog,
} from "./db";
import {
  createAdsPowerBrowser,
  startAdsPowerBrowser,
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

// ─── 核心執行邏輯（支持並發） ─────────────────────────────────────────────────

async function executeTask(taskId: number): Promise<void> {
  const task = await getAutomationTaskById(taskId);
  if (!task) return;

  const maxConcurrent = task.maxConcurrent || 1;
  // API Key 从配置文件读取（固定写死，不依赖数据库字段）
  const adspowerConfig = {
    apiUrl: task.adspowerApiUrl || ADSPOWER_CONFIG.apiUrl,
    apiKey: ADSPOWER_CONFIG.apiKey,
    groupId: task.adspowerGroupId || undefined,
  };
  const targetUrl = (task as any).targetUrl || undefined;

  try {
    // 1. 掃描所有「未使用」的邀請碼
    const unusedCodes = await getUnusedInviteCodes();

    if (unusedCodes.length === 0) {
      console.log(`[Scheduler] Task ${taskId}: No unused invite codes found`);
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    // 2. 取前 N 個（N = maxConcurrent），並發啟動多個瀏覽器
    const toProcess = unusedCodes.slice(0, maxConcurrent);
    console.log(
      `[Scheduler] Task ${taskId}: Found ${unusedCodes.length} unused codes, processing ${toProcess.length} concurrently`
    );

    // 3. 並發執行
    await Promise.all(
      toProcess.map((targetAccount) =>
        processOneInviteCode(taskId, task, targetAccount, adspowerConfig, targetUrl)
      )
    );

    await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Scheduler] Task ${taskId}: Unexpected error - ${msg}`);
    await updateAutomationTask(taskId, {
      lastExecutedAt: new Date(),
      totalFailed: (task.totalFailed || 0) + 1,
    });
  }
}

// ─── 處理單個邀請碼（創建一個瀏覽器實例） ────────────────────────────────────

async function processOneInviteCode(
  taskId: number,
  task: Awaited<ReturnType<typeof getAutomationTaskById>>,
  targetAccount: { id: number; email: string; inviteCode: string | null },
  adspowerConfig: { apiUrl: string; apiKey?: string; groupId?: string },
  targetUrl?: string
): Promise<void> {
  const inviteCode = targetAccount.inviteCode;
  if (!inviteCode) {
    console.log(`[Scheduler] Task ${taskId}: Account ${targetAccount.email} has no invite code, skipping`);
    return;
  }

  const startTime = Date.now();
  let logId: number | undefined;

  try {
    console.log(`[Scheduler] Task ${taskId}: Processing invite code ${inviteCode} from ${targetAccount.email}`);

    // 1. 創建任務日誌
    const logResult = await createTaskLog({
      taskId,
      status: "running",
      usedInviteCode: inviteCode,
      sourceAccountId: targetAccount.id,
      startedAt: new Date(),
    });
    logId = (logResult as any)[0]?.insertId;

    // 2. 將邀請碼狀態改為「邀請中」（防止其他任務重複使用）
    await updateInviteStatus(inviteCode, "in_progress");

    // 3. 調用 AdsPower API 創建瀏覽器環境（隨機指紋）
    const createResult = await createAdsPowerBrowser(adspowerConfig, inviteCode, {
      targetUrl,
    });

    if (!createResult.success || !createResult.profileId) {
      throw new Error(createResult.error || "Failed to create browser profile");
    }

    const profileId = createResult.profileId;

    // 4. 啟動瀏覽器
    const startResult = await startAdsPowerBrowser(adspowerConfig, profileId);

    const durationMs = Date.now() - startTime;

    if (startResult.success) {
      // 成功：更新日誌（注冊完成後由插件回調更新最終狀態）
      if (logId) {
        await updateTaskLog(logId, {
          status: "running",  // 保持 running，等待插件回調後改為 success
          adspowerBrowserId: profileId,
          durationMs,
        });
      }

      await updateAutomationTask(taskId, {
        lastExecutedAt: new Date(),
        totalSuccess: (task?.totalSuccess || 0) + 1,
      });

      console.log(
        `[Scheduler] Task ${taskId}: Browser started successfully | profile: ${profileId} | inviteCode: ${inviteCode}`
      );
    } else {
      throw new Error(startResult.error || "Failed to start browser");
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    // 失敗：恢復邀請碼狀態
    await updateInviteStatus(inviteCode, "unused");

    if (logId) {
      await updateTaskLog(logId, {
        status: "failed",
        errorMessage: msg,
        durationMs,
        completedAt: new Date(),
      });
    }

    await updateAutomationTask(taskId, {
      lastExecutedAt: new Date(),
      totalFailed: (task?.totalFailed || 0) + 1,
    });

    console.error(
      `[Scheduler] Task ${taskId}: Failed to process invite code ${inviteCode} - ${msg}`
    );
  }
}
