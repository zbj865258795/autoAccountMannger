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
  getProxyAccountById,
  releasePhoneIfNeeded,
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
  console.log(`[浏览器监控] 已启动 | 检查间隔: ${BROWSER_MONITOR_INTERVAL / 1000}s`);
  browserMonitorTimer = setInterval(async () => {
    try {
      await checkBrowserStatus();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[浏览器监控] 检查出错: ${msg}`);
    }
  }, BROWSER_MONITOR_INTERVAL);
}

function stopBrowserMonitor(): void {
  if (browserMonitorTimer) {
    clearInterval(browserMonitorTimer);
    browserMonitorTimer = null;
    console.log(`[浏览器监控] 已停止`);
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
      `[浏览器监控] 任务 ${taskId}: 检查 ${logs.length} 个浏览器 | AdsPower 活跃数: ${activeIds.size}`
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

        console.log(`[浏览器监控] 浏览器 ${browserId}（日志 #${log.id}）已不活跃 → 标记为失败`);

        // 如果手机号尚未收到短信（in_use 状态），归还手机号
        await releasePhoneIfNeeded(log.id).catch(() => {});

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
              .catch((e) => console.error(`[浏览器监控] 触发下一次任务失败: ${e}`))
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

  // 强制停止前，先归还所有尚在 in_use 状态的手机号
  await Promise.all(
    runningLogs.map((log) => releasePhoneIfNeeded(log.id).catch(() => {}))
  );

  const affected = await failAllRunningLogsForTask(taskId, reason);
  if (affected > 0) {
    console.log(`[调度器] 任务 ${taskId}: 已将 ${affected} 条运行日志标记为失败（${reason}）`);
  }

  const browserIds = runningLogs
    .map((log) => log.adspowerBrowserId)
    .filter((id): id is string => !!id);

  if (browserIds.length === 0) return;

  console.log(`[调度器] 任务 ${taskId}: 正在关闭 ${browserIds.length} 个浏览器: [${browserIds.join(", ")}]`);

  await Promise.all(
    browserIds.map((browserId) =>
      closeAdsPowerBrowser(adspowerConfig, browserId).catch((e) =>
        console.error(`[调度器] 关闭浏览器 ${browserId} 失败: ${e}`)
      )
    )
  );

  await deleteAdsPowerBrowsers(adspowerConfig, browserIds).catch((e) =>
    console.error(`[调度器] 批量删除浏览器失败: ${e}`)
  );
}

// ─── 啟動調度器 ───────────────────────────────────────────────────────────────

export async function startScheduler(taskId: number): Promise<void> {
  if (schedulerTimers.has(taskId)) {
    console.log(`[调度器] 任务 ${taskId} 已在运行中`);
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
    `[调度器] 启动任务 ${taskId} "${task.name}" | 检查间隔: ${task.scanIntervalSeconds}s | 单线程模式`
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
  console.log(`[调度器] 任务 ${taskId} 已暂停`);

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
  console.log(`[调度器] 任务 ${taskId} 已停止`);

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
  console.log(`[调度器] 收到浏览器 ${browserId} 的错误上报: ${errorMessage}`);

  const log = await getRunningLogByBrowserId(browserId);

  if (!log) {
    console.warn(`[调度器] 未找到浏览器 ${browserId} 对应的运行日志，忽略`);
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
      if (!r.success) console.error(`[调度器] 清理浏览器 ${browserId} 失败: ${r.error}`);
    })
    .catch((e) => console.error(`[调度器] 清理浏览器 ${browserId} 失败: ${e}`));

  await incrementTaskCounters(taskId, { totalFailed: 1 });

  // 触发下一次执行
  const task = await getAutomationTaskById(taskId);
  if (task && task.status === "running") {
    if (executeTaskLocks.get(taskId)) {
      console.log(`[调度器] 任务 ${taskId} 已有执行中的注册流程，跳过`);
    } else {
      console.log(`[调度器] 任务 ${taskId} 触发下一次执行`);
      executeTaskLocks.set(taskId, true);
      executeTask(taskId)
        .catch((e) => console.error(`[调度器] 触发下一次执行失败: ${e}`))
        .finally(() => executeTaskLocks.delete(taskId));
    }
  }

  return { success: true, message: `已处理异常，浏览器 ${browserId} 已关闭，任务继续` };
}

// ─── 核心執行邏輯（单线程：每次只创建一个浏览器） ────────────────────────────

async function executeTask(taskId: number): Promise<void> {
  if (executeTaskLocks.get(taskId)) {
    console.log(`[调度器] 任务 ${taskId}: 已有执行中的注册流程，跳过`);
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
      `[调度器] 任务 ${taskId}: 已达到目标数量（${task.totalAccountsCreated}/${task.targetCount}），自动停止`
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
    // 1. 先检查当前是否已有正在运行的浏览器（单线程：最多1个）
    // 注意：必须先检查运行中任务，再检查邀请码
    // 原因：邀请码被锁定为 in_progress 后 unused 数量为 0，如果先检查邀请码会误打“暂无可用邀请码”
    const runningLogs = await getRunningLogsForTask(taskId);
    if (runningLogs.length >= 1) {
      console.log(
        `[调度器] 任务 ${taskId}: 已有注册任务运行中（单线程模式），跳过`
      );
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    // 2. 检查是否有未使用的邀请码
    const unusedCount = await getUnusedInviteCodeCount();
    if (unusedCount === 0) {
      console.log(`[调度器] 任务 ${taskId}: 暂无可用邀请码`);
      await updateAutomationTask(taskId, { lastExecutedAt: new Date() });
      return;
    }

    console.log(`[调度器] 任务 ${taskId}: 开始创建新的注册任务`);

    // 3. 创建单个浏览器并启动注册（IP 检测已移入浏览器内部执行，确保代理已生效且 IP 一致）
    await createOneBrowser(taskId, task, adspowerConfig);
    await updateAutomationTask(taskId, { lastExecutedAt: new Date() });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[调度器] 任务 ${taskId}: 意外错误 - ${msg}`);
    await incrementTaskCounters(taskId, { totalFailed: 1 });
  }
}

// ─── 創建單個瀏覽器實例並启动注册 ────────────────────────────────────────────

async function createOneBrowser(
  taskId: number,
  task: Awaited<ReturnType<typeof getAutomationTaskById>>,
  adspowerConfig: { apiUrl: string; apiKey?: string; groupId?: string }
): Promise<void> {
  const startTime = Date.now();
  let logId: number | undefined;
  let profileId: string | undefined;

  try {
    console.log(`[调度器] 任务 ${taskId}: 正在创建浏览器实例`);

    // 创建任务日志（exitIp 将由浏览器内部检测后写入）
    const logResult = await createTaskLog({
      taskId,
      status: "running",
      startedAt: new Date(),
      exitIp: null,
    });
    logId = (logResult as any)[0]?.insertId;

    // 解析代理配置：优先从代理账号表读取，如果没有则回退到任务的 proxyUrl
    const proxyAccountId = (task as any).proxyAccountId as number | undefined | null;
    let proxyUrl: string | undefined = (task as any).proxyUrl as string | undefined;
    let region: "us" | "tw" | "hk" | "jp" = "us"; // 默认美国

    if (proxyAccountId) {
      const proxyAccount = await getProxyAccountById(proxyAccountId);
      if (proxyAccount) {
        proxyUrl = proxyAccount.proxyUrl;
        region = proxyAccount.region as "us" | "tw" | "hk" | "jp";
      }
    }

    let proxyConfig: { proxyType: string; host?: string; port?: string; user?: string; password?: string } | undefined;

    if (proxyUrl && proxyUrl.trim()) {
      // ── 通用多平台 session 动态替换 ──────────────────────────────────────────
      // 生成随机 session 值（12位字母数字）
      const newSessionId = Math.random().toString(36).slice(2, 14);
      let dynamicProxyUrl = proxyUrl;
      let sessionReplaced = false;

      // 方案一：显式占位符 {session}（推荐，适用于所有平台）
      // 用法示例（iProyal）：socks5://user:pass_session-{session}_lifetime-30m@host:port
      // 用法示例（Decodo）：socks5h://user-name-session-{session}-sessionduration-30:pass@host:port
      if (dynamicProxyUrl.includes("{session}")) {
        dynamicProxyUrl = dynamicProxyUrl.replace(/\{session\}/g, newSessionId);
        sessionReplaced = true;
      }

      // 方案二：iProyal 兼容格式 _session-XXXXX（密码段，下划线分隔）
      // 用法示例：socks5://user:pass_country-us_session-placeholder_lifetime-30m@host:port
      if (!sessionReplaced && /(_session-)([a-zA-Z0-9_-]+)/.test(dynamicProxyUrl)) {
        dynamicProxyUrl = dynamicProxyUrl.replace(
          /(_session-)([a-zA-Z0-9_-]+)/,
          (_match, prefix) => `${prefix}${newSessionId}`
        );
        sessionReplaced = true;
      }

      // 方案三：Decodo 兼容格式 -session-XXXXX-（用户名段，连字符分隔）
      // 用法示例：socks5h://user-name-session-1-sessionduration-30:pass@host:port
      // 注意：此格式要求 session 值后面紧跟 -（即 -session-值-）
      if (!sessionReplaced && /(-session-)([a-zA-Z0-9]+)(-)/.test(dynamicProxyUrl)) {
        dynamicProxyUrl = dynamicProxyUrl.replace(
          /(-session-)([a-zA-Z0-9]+)(-)/,
          (_match, prefix, _old, suffix) => `${prefix}${newSessionId}${suffix}`
        );
        sessionReplaced = true;
      }

      if (sessionReplaced) {
        console.log(`[调度器] 任务 ${taskId}: 已动态替换代理 session ID → ${newSessionId}`);
      }

      const parsed = parseProxyUrl(dynamicProxyUrl);
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

    // 创建 AdsPower 浏览器（注入代理 + 地区指纹）
    const createResult = await createAdsPowerBrowser(
      adspowerConfig,
      `task_${taskId}_${Date.now()}`,
      { proxyConfig, region }
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

    // 本地运行：AdsPower 返回的 wsEndpoint 中 127.0.0.1 就是本机，直接使用
    const wsEndpointFixed = startResult.wsEndpoint;
    console.log(`[调度器] 任务 ${taskId}: 浏览器已启动 | 配置ID: ${profileId} | WS: ${wsEndpointFixed}`);

    // 异步启动注册流程（不阻塞调度器）
    runRegistration({
      taskId,
      logId: logId!,
      profileId,
      wsEndpoint: wsEndpointFixed,
      adspowerConfig,
    }).catch(async (e) => {
      console.error(`[调度器] 任务 ${taskId}: 注册流程意外失败: ${e}`);
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
    console.error(`[调度器] 任务 ${taskId}: 创建/启动浏览器失败 - ${msg}`);

    // 失败后触发下一次尝试
    const currentTask = await getAutomationTaskById(taskId);
    if (currentTask && currentTask.status === "running") {
      setTimeout(() => {
        if (!executeTaskLocks.get(taskId)) {
          executeTaskLocks.set(taskId, true);
          executeTask(taskId)
            .catch((e) => console.error(`[调度器] 重试触发失败: ${e}`))
            .finally(() => executeTaskLocks.delete(taskId));
        }
      }, 5000);
    }
  }
}
