/**
 * Chrome 插件回調 REST 端點
 *
 * ─── 插件调用流程 ───
 *
 * 1. 注册开始前，获取邀请码（同时自动标记为「邀请中」）：
 *    GET /api/callback/next-invite-code
 *    → 返回 { id, inviteCode, sourceEmail }，保存 id 备用
 *
 * 2. 注册开始前，获取手机号：
 *    POST /api/callback/get-phone
 *    → 返回 { id, phone, smsUrl }
 *
 * 3. 获取到验证码后，标记手机号已使用：
 *    POST /api/callback/mark-phone-used
 *    Body: { id }
 *
 * 4. 注册成功后，上报账号数据（同时自动将邀请人邀请码标记为「已使用」）：
 *    POST /api/callback/register
 *    Body: { email, password, ..., inviterAccountId }
 *
 * 5. 注册失败时，重置邀请码为「未使用」：
 *    POST /api/callback/reset-invite-code
 *    Body: { id }
 *
 * 6. 健康检查：
 *    GET /api/callback/health
 */

import type { Express, Request, Response } from "express";
import {
  createAccount,
  claimNextInviteCode,
  getNextAvailablePhone,
  incrementTaskCounters,
  markPhoneUsedById,
  updateInviteStatusById,
  updateAutomationTask,
  getAutomationTasks,
  getTaskLogs,
  updateTaskLog,
  getAutomationTaskById,
} from "./db";
import { stopAndDeleteAdsPowerBrowser } from "./adspower";
import { ADSPOWER_CONFIG } from "./config";
import { handlePluginError, stopScheduler } from "./scheduler";

export function registerCallbackRoutes(app: Express): void {

  // ─────────────────────────────────────────────
  // 健康检查
  // ─────────────────────────────────────────────
  app.get("/api/callback/health", (_req: Request, res: Response) => {
    res.json({ success: true, status: "ok", timestamp: new Date().toISOString() });
  });

  // ─────────────────────────────────────────────
  // 获取下一个可用邀请码
  // 获取时直接将邀请码状态标记为「邀请中」，防止并发重复分配
  // 返回 id（用于后续 reset-invite-code 或 register 时使用）
  // ─────────────────────────────────────────────
  app.get("/api/callback/next-invite-code", async (_req: Request, res: Response) => {
    try {
      // 原子操作：SELECT FOR UPDATE + UPDATE 在同一事务内完成，彻底防止并发重复分配
      const next = await claimNextInviteCode();

      if (!next) {
        return res.json({
          success: true,
          inviteCode: null,
          message: "暂无可用邀请码",
        });
      }

      console.log(`[Callback] Invite code ${next.inviteCode} (id=${next.id}) claimed atomically`);

      return res.json({
        success: true,
        id: next.id,
        inviteCode: next.inviteCode,
        sourceEmail: next.email,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // 重置邀请码为「未使用」（注册失败时调用）
  // 传入 next-invite-code 返回的 id
  // ─────────────────────────────────────────────
  app.post("/api/callback/reset-invite-code", async (req: Request, res: Response) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ success: false, error: "id is required" });
      }
      await updateInviteStatusById(Number(id), "unused");
      console.log(`[Callback] Invite code id=${id} reset to unused`);
      return res.json({ success: true, message: "邀请码已重置为未使用" });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // 主要回调：注册成功后上报账号数据
  // 传入 inviterAccountId（next-invite-code 返回的 id），
  // 系统自动将该邀请人的邀请码状态改为「已使用」
  // ─────────────────────────────────────────────
  app.post("/api/callback/register", async (req: Request, res: Response) => {
    try {
      const body = req.body;

      // ── 必填字段校验 ──
      const email: string = body.email;
      const password: string = body.password;
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: "email 和 password 为必填字段",
        });
      }

      // ── 解析字段 ──
      const phone: string | undefined = body.phone;
      const token: string | undefined = body.token;
      const clientId: string | undefined = body.clientId;

      // 兼容嵌套格式
      const userInfo = body.user_info || {};
      const creditsInfo = body.credits_info || {};
      const invitationInfo = body.invitation_info || {};

      const userId: string | undefined = body.userId || userInfo.userId;
      const displayname: string | undefined =
        body.displayname || userInfo.displayname || userInfo.nickname;
      const membershipVersion: string =
        body.membershipVersion || userInfo.membershipVersion || creditsInfo.membershipVersion || "free";
      const totalCredits: number = body.totalCredits ?? creditsInfo.totalCredits ?? 0;
      const freeCredits: number = body.freeCredits ?? creditsInfo.freeCredits ?? 0;
      const refreshCredits: number = body.refreshCredits ?? creditsInfo.refreshCredits ?? 0;

      // 新账号自己的邀请码
      let inviteCode: string | undefined = body.inviteCode;
      let inviteCodeId: string | undefined = body.inviteCodeId;
      if (!inviteCode && invitationInfo.invitationCodes?.length > 0) {
        const primary = invitationInfo.invitationCodes[0];
        inviteCode = primary.inviteCode;
        inviteCodeId = primary.id;
      }

      // 邀请人账号 ID（来自 next-invite-code 返回的 id）
      const inviterAccountId: number | undefined = body.inviterAccountId
        ? Number(body.inviterAccountId)
        : undefined;

      // 兼容旧字段：referrerCode / invitedByCode（仅用于存储，不再用于查找邀请人）
      const referrerCode: string | undefined = body.referrerCode || body.invitedByCode;

      const registeredAt: Date =
        body.registeredAt
          ? new Date(body.registeredAt)
          : userInfo.registeredAt
          ? new Date(userInfo.registeredAt)
          : new Date();

      // ── 检查邮箱是否已存在 ──
      const { getAccountByEmail } = await import("./db");
      const existingByEmail = await getAccountByEmail(email);
      if (existingByEmail) {
        return res.status(409).json({
          success: false,
          error: `邮箱 ${email} 已存在，跳过注册`,
          code: "EMAIL_EXISTS",
        });
      }

      // ── 查找邀请人信息（通过 inviterAccountId 或 referrerCode 兼容旧逻辑）──
      let invitedById: number | undefined = inviterAccountId;
      let resolvedReferrerCode: string | undefined = referrerCode;

      if (inviterAccountId) {
        // 新逻辑：直接通过 id 查找邀请人
        const { getAccountById } = await import("./db");
        const inviter = await getAccountById(inviterAccountId);
        if (inviter) {
          invitedById = inviter.id;
          resolvedReferrerCode = inviter.inviteCode ?? referrerCode;
          // 通过 id 直接将邀请人邀请码标记为「已使用」
          await updateInviteStatusById(inviterAccountId, "used");
          console.log(`[Callback] Inviter account id=${inviterAccountId} invite code marked as used`);
        }
      } else if (referrerCode) {
        // 旧逻辑兼容：通过 referrerCode 查找邀请人
        const { getAccountByInviteCode, updateInviteStatus } = await import("./db");
        const inviter = await getAccountByInviteCode(referrerCode);
        if (inviter) {
          invitedById = inviter.id;
          await updateInviteStatus(referrerCode, "used");
          console.log(`[Callback] Inviter ${referrerCode} marked as used (legacy mode)`);
        }
      }

      // ── 创建新账号 ──
      await createAccount({
        email,
        password,
        phone,
        token,
        clientId,
        userId,
        displayname,
        membershipVersion,
        totalCredits,
        freeCredits,
        refreshCredits,
        inviteCode,
        inviteCodeId,
        referrerCode: resolvedReferrerCode,
        invitedById,
        registeredAt,
        inviteStatus: "unused",
      });

      // ── 更新运行中的任务统计 ──
      const allTasks = await getAutomationTasks();

      // 优先通过 adspowerBrowserId 直接匹配日志（插件端上报时应携带此字段）
      const adspowerBrowserId: string | undefined = body.adspowerBrowserId;

      for (const task of allTasks) {
        if (task.status === "running") {
          // 使用原子自增，避免并发 read-modify-write 导致计数丢失
          await incrementTaskCounters(task.id, { totalAccountsCreated: 1, totalSuccess: 1 });

          // ── 检查是否已达到目标账号数，达到则自动停止任务 ──
          if (task.targetCount) {
            const updatedTask = await getAutomationTaskById(task.id);
            const created = updatedTask?.totalAccountsCreated ?? 0;
            if (created >= task.targetCount) {
              console.log(`[Callback] Task ${task.id}: Target count reached (${created}/${task.targetCount}), auto-stopping`);
              stopScheduler(task.id).catch((e) =>
                console.error(`[Callback] Failed to auto-stop task ${task.id}: ${e}`)
              );
            }
          }

          // ── 匹配对应的任务日志 ──
          // 优先级：1) adspowerBrowserId 直接匹配  2) usedInviteCode 匹配  3) 任意 running 日志
          const logs = await getTaskLogs({
            taskId: task.id,
            status: "running",
            pageSize: 50,
          });

          let matchingLog = logs.items.find(
            (l) => adspowerBrowserId && l.adspowerBrowserId === adspowerBrowserId
          );

          if (!matchingLog && resolvedReferrerCode) {
            matchingLog = logs.items.find(
              (l) => l.usedInviteCode === resolvedReferrerCode
            );
          }

          // 如果上面都没匹配到，取最早的一条 running 日志（必须有 adspowerBrowserId）
          if (!matchingLog) {
            matchingLog = logs.items
              .filter((l) => !!l.adspowerBrowserId)
              .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0))[0];
          }

          if (matchingLog) {
            console.log(`[Callback] Matched log #${matchingLog.id} | browserId: ${matchingLog.adspowerBrowserId ?? 'none'} | inviteCode: ${matchingLog.usedInviteCode ?? 'none'}`);

            await updateTaskLog(matchingLog.id, {
              status: "success",
              completedAt: new Date(),
              durationMs: Date.now() - (matchingLog.startedAt?.getTime() ?? Date.now()),
            });

            // ★ 修复：注册成功后异步关闭浏览器（不阻塞响应）
            // 原来是同步等待，如果 AdsPower 超时则整个接口超时，导致插件认为注册失败并重试
            if (matchingLog.adspowerBrowserId) {
              const adspowerConfig = {
                apiUrl: task.adspowerApiUrl || ADSPOWER_CONFIG.apiUrl,
                apiKey: ADSPOWER_CONFIG.apiKey,
              };
              const browserIdToClose = matchingLog.adspowerBrowserId;
              // 异步关闭，不阻塞当前请求的返回
              stopAndDeleteAdsPowerBrowser(adspowerConfig, browserIdToClose)
                .then((result) => {
                  if (result.success) {
                    console.log(`[Callback] Browser ${browserIdToClose} destroyed after successful registration`);
                  } else {
                    console.error(`[Callback] Failed to destroy browser ${browserIdToClose}: ${result.error}`);
                  }
                })
                .catch((e) => {
                  console.error(`[Callback] Error destroying browser ${browserIdToClose}: ${e}`);
                });
            } else {
              console.warn(`[Callback] Log #${matchingLog.id} has no adspowerBrowserId, cannot destroy browser`);
            }
          } else {
            console.warn(`[Callback] No matching running log found for task ${task.id} | adspowerBrowserId: ${adspowerBrowserId ?? 'none'} | referrerCode: ${resolvedReferrerCode ?? 'none'}`);
          }
        }
      }

      console.log(
        `[Callback] New account registered: ${email} | inviteCode: ${inviteCode ?? "none"} | inviterAccountId: ${inviterAccountId ?? "none"}`
      );

      return res.json({
        success: true,
        message: "账号注册成功",
        email,
        inviteCode: inviteCode ?? null,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[Callback] Register error:", msg);
      // 检测 unique 冲突
      if (msg.includes("Duplicate entry") || msg.includes("unique") || msg.includes("UNIQUE")) {
        if (msg.includes("email") || msg.toLowerCase().includes("email")) {
          return res.status(409).json({ success: false, error: "邮箱已存在，跳过注册", code: "EMAIL_EXISTS" });
        }
        if (msg.includes("inviteCode") || msg.includes("invite_code")) {
          return res.status(409).json({ success: false, error: "该邀请码已被其他账号使用，请检查 inviteCode 是否重复", code: "INVITE_CODE_EXISTS" });
        }
        return res.status(409).json({ success: false, error: "数据重复，请检查 email 和 inviteCode 是否已存在", code: "DUPLICATE" });
      }
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // 获取手机号（自动标记为「使用中」）
  // ─────────────────────────────────────────────
  app.post("/api/callback/get-phone", async (_req: Request, res: Response) => {
    try {
      const record = await getNextAvailablePhone();
      if (!record) {
        return res.json({ success: false, message: "暂无可用手机号" });
      }
      return res.json({
        success: true,
        id: record.id,
        phone: record.phone,
        smsUrl: record.smsUrl,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // 插件异常上报（注册失败时调用）
  // ─────────────────────────────────────────────
  app.post("/api/callback/report-error", async (req: Request, res: Response) => {
    try {
      const { browserId, error } = req.body;
      if (!browserId) {
        return res.status(400).json({ success: false, error: "browserId is required" });
      }
      if (!error) {
        return res.status(400).json({ success: false, error: "error message is required" });
      }

      const result = await handlePluginError(String(browserId), String(error));

      // ★ 修复问题D：找不到对应日志时返回 200（而非 404）
      // 插件收到 404 会认为接口不存在并抛出异常，导致流程停止
      // 实际上找不到日志属于正常情况（比如浏览器已被清理），应该返回成功让插件继续执行
      if (!result.success) {
        console.warn(`[Callback] report-error: ${result.message} (returning 200 to avoid plugin crash)`);
        return res.json({ success: false, message: result.message });
      }

      console.log(`[Callback] Plugin error reported for browser ${browserId}: ${error}`);
      return res.json({ success: true, message: result.message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // 标记手机号为已使用（获取到验证码后调用）
  // ─────────────────────────────────────────────
  app.post("/api/callback/mark-phone-used", async (req: Request, res: Response) => {
    try {
      const { id, phone } = req.body;
      if (!id && !phone) {
        return res.status(400).json({ success: false, error: "id is required" });
      }
      if (id) {
        await markPhoneUsedById(Number(id));
        console.log(`[Callback] Phone id=${id} marked as used`);
      } else {
        const { markPhoneUsed } = await import("./db");
        await markPhoneUsed(phone);
        console.log(`[Callback] Phone ${phone} marked as used`);
      }
      return res.json({ success: true, message: "手机号已标记为已使用" });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ success: false, error: msg });
    }
  });
}
