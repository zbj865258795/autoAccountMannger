/**
 * 自動化任務調度器（单线程版）
 *
 * 核心邏輯：
 * 1. 每次只运行一个注册任务（单线程），上一个完成后才启动下一个
 * 2. 创建浏览器前先检测代理出口IP，确保未被使用过
 * 3. 出口IP连续10次都已使用 → 停止任务（需更换代理平台）
 * 4. 注册成功后将出口IP记录到已用IP池
 * 5. 定時輪詢已啟動瀏覽器的狀態，異常關閉時自動標記任務失敗
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
  parseProxyUrl,
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
import { checkProxyWithRetry } from "./proxy";
import { runRegistration } from "./automation";

// ─── 全局調度器狀態 ───────────────────────────────────────────────────────────

const schedulerTimers = new Map<number, NodeJS.Timeout>();

// 記錄每個任務對應的 AdsPower apiUrl（用於監控時清理瀏覽器）
const taskApiUrls = new Map<number, string>();

// 全局防并发锁：同一任务同一时刻只允许一个 executeTask 在运行
const executeTaskLocks = new Map<number, boolean>();

// ─── 瀏覽器狀態監控 ──────────────────────────────────────────────────────────

let browserMonitorTimer: NodeJS.Timeout | null = null;
const BROWSER_MONITOR_INTERVAL = 15000; // 每 15 秒檢查一次

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

function stopBrowserMonitor(): void {
  if (browserMonitorTimer) {
    clearInterval(browserMonitorTimer);
    browserMonitorTimer = null;
    console.log(`[BrowserMonitor] Stopped`);
  }
}

async function checkBrowserStatus(): Promise<void> {
  const runningLogs = await getRunningLogsWithBrowserId();
  if (runningLogs.length === 0) return;

  const taskGroups = new Map<number, typeof runningLogs>();
  for (const log of runningLogs) {
    if (!log.taskId) continue;
    if (!taskGroups.has(log.taskId)) taskGroups.set(log.taskId, []);
    taskGroups.get(log.taskId)!.push(log);
  }

  for (const [taskId, logs] of Array.from(taskGroups)) {
    const apiUrl = taskApiUrls.get(taskId) || ADSPOWER_CONFIG.apiUrl;
    const adspowerConfig = { apiUrl, apiKey: ADSPOWER_CONFIG.apiKey };
    const activeBrowsers = await getActiveBrowsers(apiUrl);
    const activeIds = new Set(activeBrowsers.map((b) => b.browserId));

    console.log(
      `[BrowserMonitor] Task ${taskId}: checking ${logs.length} browser(s) | ${activeIds.size} active in AdsPower`
    );

    const BROWSER_STARTUP_GRACE_MS = 3 * 60 * 1000; // 3 分钟保护窗口期

    for (const log of logs) {
      const browserId = log.adspowerBrowserId;
      if (!browserId) continue;

      if (log.startedAt) {
        const ageMs = Date.now() - new Date(log.startedAt).getTime();
        if (ageMs < BROWSER_STARTUP_GRACE_MS) continue;
      }

      if (!activeIds.has(browserId)) {
        const durationMs = log.startedAt
          ? Date.now() - new Date(log.startedAt).getTime()
          : undefined;

        console.log(`[BrowserMonitor] Browser ${browserId} (log #${log.id}) is no longer active → marking failed`);

        await updateTaskLog(log.id, {
          status: "failed",
          errorMessage: "浏览器被关闭或异常退出（由状态监控检测到）",
          durationMs,
          completedAt: new Date(),
        });

        await incrementTaskCounters(taskId, { totalFailed: 1 });
        await stopAndDeleteAdsPowerBrowser(adspowerConfig, browserId).catch(() => {});

        // 浏览器异常退出后，触发下一次执行
        const task = await getAutomationTaskById(taskId);
        if (task && task.status === "running") {
          if (!executeTaskLocks.get(taskId)) {
            executeTaskLocks.set(taskId, true);
            executeTask(taskId)
              .catch((e) => console.error(`[BrowserMonitor] Failed to trigger next task: ${e}`))
              .finally(() => executeTaskLocks.delete(taskId));
          }
        }
      }
    }
  }
}

// ─── 停止任務時清理所有 running 日誌和瀏覽器 ─────────────────────────────────

async function cleanupTaskBrowsers(taskId: number, reason: string): Promise<void> {
  const apiUrl = taskApiUrls.get(taskId) || ADSPOWER_CONFIG.apiUrl;
  const adspowerConfig = { apiUrl, apiKey: ADSPOWER_CONFIG.apiKey };

  const runningLogs = await getRunningLogsForTask(taskId);
  const affected = await failAllRunningLogsForTask(taskId, reason);
  if (affected > 0) {
    console.log(`[Scheduler] Task ${taskId}: marked ${affected} running log(s) as failed (${reason})`);
  }

  const browserIds = runningLogs
    .map((log) => log.adspowerBrowserId)
    .filter((id): id is string => !!id);

  if (browserIds.length === 0) return;

  console.log(`[Scheduler] Task ${taskId}: closing ${browserIds.length} browser(s): [${browserIds.join(", ")}]`);

  await Promise.all(
    browserIds.map((browserId) =>
      closeAdsPowerBrowser(adspowerConfig, browserId).catch((e) =>
        console.error(`[Scheduler] Failed to close browser ${browserId}: ${e}`)
      )
    )
  );

  await deleteAdsPowerBrowsers(adspowerConfig, browserIds).catch((e) =>
    console.error(`[Scheduler] Failed to batch-delete browsers: ${e}`)
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

  const apiUrl = task.adspowerApiUrl || ADSPOWER_CONFIG.apiUrl;
  taskApiUrls.set(taskId, apiUrl);

  await updateAutomationTask(taskId, {
    status: "running",
    startedAt: new Date(),
  });

  console.log(
    `[Scheduler] Starting task ${taskId} "${task.name}" | interval: ${task.scanIntervalSeconds}s | single-thread mode`
  );

  // 立即執行一次
  await executeTask(taskId);

  // 設置定時器（用于检查是否需要启动下一个任务）
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
  startBrowserMonitor();
}

// ─── 暫停調度器 ───────────────────────────────────────────────────────────────

export async function pauseScheduler(taskId: number): Promise<void> {
  const timer = schedulerTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    schedulerTimers.delete(taskId);
  }

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

  await cleanupTaskBrowsers(taskId, "任务已停止，浏览器被强制关闭");
  await updateAutomationTask(taskId, { status: "stopped" });
  console.log(`[Scheduler] Task ${taskId} stopped`);

  taskApiUrls.delete(taskId);
  if (schedulerTimers.size === 0) stopBrowserMonitor();
}

// ─── 獲取運行中的任务 ID ──────────────────────────────────────────────────────

export function getRunningTaskIds(): number[] {
  return Array.from(schedulerTimers.keys());
}

// ─── 错误处理（注册失败时由 automation.ts 调用） ──────────────────────────────

export async function handlePluginError(
  browserId: string,
  errorMessage: string
): Promise<{ success: boolean; message: string }> {
  console.log(`[Scheduler] Received error report for browser ${browserId}: ${errorMessage}`);

  const log = await getRunningLogByBrowserId(browserId);

  if (!log) {
    console.warn(`[Scheduler] No running log found for browser ${browserId}, ignoring`);
    return { success: false, message: `未找到对应的运行中任务（browserId: ${browserId}）` };
  }

  const taskId = log.taskId!;
  const logId = log.id;
  const durationMs = log.startedAt
    ? Date.now() - new Date(log.startedAt).getTime()
    : undefined;

  await updateTaskLog(logId, {
    status: "failed",
    errorMessage: `注册异常: ${errorMessage}`,
    durationMs,
    completedAt: new Date(),
  });

  const apiUrl = taskApiUrls.get(taskId) || ADSPOWER_CONFIG.apiUrl;
  const adspowerConfig = { apiUrl, apiKey: ADSPOWER_CONFIG.apiKey };

  stopAndDeleteAdsPowerBrowser(adspowerConfig, browserId)
    .then((r) => {
      if (!r.success) console.error(`[Scheduler] Failed to cleanup browser ${browserId}: ${r.error}`);
    })
    .catch((e) => console.error(`[Scheduler] Failed to cleanup browser ${browserId}: ${e}`));

  await incrementTaskCounters(taskId, { totalFailed: 1 });

  // 触发下一次执行
  const task = await getAutomationTaskById(taskId);
  if (task && task.status === "running") {
    if (executeTaskLocks.get(taskId)) {
      console.log(`[Scheduler] Task ${taskId} executeTask already in progress, skipping`);
    } else {
      console.log(`[Scheduler] Task ${taskId} triggering next execution`);
      executeTaskLocks.set(taskId, true);
      executeTask(taskId)
        .catch((e) => console.error(`[Scheduler] Failed to trigger next execution: ${e}`))
        .finally(() => executeTaskLocks.delete(taskId));
    }
  }

  return { success: true, message: `已处理异常，浏览器 ${browserId} 已关闭，任务继续` };
}

// ─── 核心執行邏輯（单线程：每次只创建一个浏览器） ────────────────────────────

async function executeTask(taskId: number): Promise<void> {
  if (executeTaskLocks.get(taskId)) {
    console.log(`[Scheduler] Task ${taskId}: executeTask already in progress, skipping`);
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

  try {
    // 1. 检查是否有未使用的邀请码
    const unusedCount = await getUnusedInviteCodeCount();
    if (unusedCount === 0) {
      console.log(`[Scheduler] Task ${taskId}: No unused invite codes available`);
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    // 2. 检查当前是否已有正在运行的浏览器（单线程：最多1个）
    const runningLogs = await getRunningLogsForTask(taskId);
    if (runningLogs.length >= 1) {
      console.log(
        `[Scheduler] Task ${taskId}: A registration task is already running (single-thread mode), skipping`
      );
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    console.log(`[Scheduler] Task ${taskId}: Starting new registration task`);

    // 3. 如果配置了代理，先检测出口IP
    let exitIp: string | undefined;
    const proxyUrl = (task as any).proxyUrl as string | undefined;

    if (proxyUrl && proxyUrl.trim()) {
      console.log(`[Scheduler] Task ${taskId}: Checking proxy exit IP...`);
      const proxyResult = await checkProxyWithRetry(proxyUrl, 10);

      if (!proxyResult.success) {
        const errMsg = proxyResult.error || "代理IP检测失败";
        console.error(`[Scheduler] Task ${taskId}: ${errMsg}`);

        // 如果是连续10次IP都已使用，停止任务
        if (proxyResult.ipAlreadyUsed) {
          console.error(`[Scheduler] Task ${taskId}: Stopping task due to exhausted IPs`);
          await updateAutomationTask(taskId, { status: "stopped" });
          await stopScheduler(taskId);
        }

        await incrementTaskCounters(taskId, { totalFailed: 1 });
        return;
      }

      exitIp = proxyResult.exitIp;
      if (proxyResult.retryCount > 0) {
        console.log(`[Scheduler] Task ${taskId}: Got fresh exit IP ${exitIp} after ${proxyResult.retryCount} retries`);
      } else {
        console.log(`[Scheduler] Task ${taskId}: Exit IP ${exitIp} is fresh, proceeding`);
      }
    } else {
      console.log(`[Scheduler] Task ${taskId}: No proxy configured, skipping IP check`);
    }

    // 4. 创建单个浏览器并启动注册
    await createOneBrowser(taskId, task, adspowerConfig, exitIp);
    await updateAutomationTask(taskId, { lastExecutedAt: new Date() });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Scheduler] Task ${taskId}: Unexpected error - ${msg}`);
    await incrementTaskCounters(taskId, { totalFailed: 1 });
  }
}

// ─── 創建單個瀏覽器實例並启动注册 ────────────────────────────────────────────

async function createOneBrowser(
  taskId: number,
  task: Awaited<ReturnType<typeof getAutomationTaskById>>,
  adspowerConfig: { apiUrl: string; apiKey?: string; groupId?: string },
  exitIp?: string
): Promise<void> {
  const startTime = Date.now();
  let logId: number | undefined;
  let profileId: string | undefined;

  try {
    console.log(`[Scheduler] Task ${taskId}: Creating browser instance`);

    // 创建任务日志
    const logResult = await createTaskLog({
      taskId,
      status: "running",
      startedAt: new Date(),
      exitIp: exitIp ?? null,
    });
    logId = (logResult as any)[0]?.insertId;

    // 解析代理配置
    const proxyUrl = (task as any).proxyUrl as string | undefined;
    let proxyConfig: { proxyType: string; host?: string; port?: string; user?: string; password?: string } | undefined;

    if (proxyUrl && proxyUrl.trim()) {
      const parsed = parseProxyUrl(proxyUrl);
      if (parsed) {
        proxyConfig = {
          proxyType: parsed.proxyType,
          host: parsed.host,
          port: parsed.port,
          user: parsed.username,
          password: parsed.password,
        };
      }
    }

    // 创建 AdsPower 浏览器（注入代理）
    const createResult = await createAdsPowerBrowser(
      adspowerConfig,
      `task_${taskId}_${Date.now()}`,
      { proxyConfig }
    );

    if (!createResult.success || !createResult.profileId) {
      throw new Error(createResult.error || "Failed to create browser profile");
    }

    profileId = createResult.profileId;

    // 启动浏览器，获取 CDP wsEndpoint
    const startResult = await startAdsPowerBrowser(adspowerConfig, profileId);

    if (!startResult.success || !startResult.wsEndpoint) {
      await stopAndDeleteAdsPowerBrowser(adspowerConfig, profileId).catch(() => {});
      throw new Error(startResult.error || "Failed to start browser or get wsEndpoint");
    }

    // 更新日志：记录 browserId
    if (logId) {
      await updateTaskLog(logId, {
        status: "running",
        adspowerBrowserId: profileId,
        durationMs: Date.now() - startTime,
      });
    }

    // Docker 容器内无法通过 127.0.0.1 访问宿主机，需替换为 host.docker.internal
    const wsEndpointFixed = startResult.wsEndpoint.replace(
      /127\.0\.0\.1/g,
      "host.docker.internal"
    );
    console.log(`[Scheduler] Task ${taskId}: Browser started | profile: ${profileId} | ws: ${wsEndpointFixed}`);

    // 异步启动注册流程（不阻塞调度器）
    runRegistration({
      taskId,
      logId: logId!,
      profileId,
      wsEndpoint: wsEndpointFixed,
      exitIp,
      adspowerConfig,
    }).catch(async (e) => {
      console.error(`[Scheduler] Task ${taskId}: Registration failed unexpectedly: ${e}`);
      // 异步失败时也要清理浏览器，防止残留
      if (profileId) await stopAndDeleteAdsPowerBrowser(adspowerConfig, profileId).catch(() => {});
      if (logId) {
        await updateTaskLog(logId, {
          status: "failed",
          errorMessage: String(e),
          completedAt: new Date(),
        }).catch(() => {});
      }
      await incrementTaskCounters(taskId, { totalFailed: 1 }).catch(() => {});
      // 失败后继续下一次
      const currentTask = await getAutomationTaskById(taskId);
      if (currentTask && currentTask.status === "running") {
        setTimeout(() => executeTask(taskId), 3000);
      }
    });

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

    if (profileId) {
      await stopAndDeleteAdsPowerBrowser(adspowerConfig, profileId).catch(() => {});
    }

    await incrementTaskCounters(taskId, { totalFailed: 1 });
    console.error(`[Scheduler] Task ${taskId}: Failed to create/start browser - ${msg}`);

    // 失败后触发下一次尝试
    const currentTask = await getAutomationTaskById(taskId);
    if (currentTask && currentTask.status === "running") {
      setTimeout(() => {
        if (!executeTaskLocks.get(taskId)) {
          executeTaskLocks.set(taskId, true);
          executeTask(taskId)
            .catch((e) => console.error(`[Scheduler] Retry trigger failed: ${e}`))
            .finally(() => executeTaskLocks.delete(taskId));
        }
      }, 5000);
    }
  }
}
