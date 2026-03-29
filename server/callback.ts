/**
 * Chrome 插件回調 REST 端點
 *
 * 插件完成注冊後，調用此端點將新賬號信息保存到數據庫。
 *
 * ─── 插件需要調用的接口 ───
 *
 * 1. 注冊開始前，獲取邀請碼：
 *    GET /api/callback/next-invite-code
 *
 * 2. 注冊成功後，上報完整賬號數據：
 *    POST /api/callback/register
 *    Body: { email, password, phone, token, clientId,
 *            membershipVersion, totalCredits, freeCredits, refreshCredits,
 *            inviteCode, invitedByCode, registeredAt }
 *
 * 3. 健康檢查：
 *    GET /api/callback/health
 */

import type { Express, Request, Response } from "express";
import {
  createAccount,
  getAccountByInviteCode,
  updateInviteStatus,
  updateAutomationTask,
  getAutomationTasks,
  getTaskLogs,
  updateTaskLog,
} from "./db";

export function registerCallbackRoutes(app: Express): void {

  // ─────────────────────────────────────────────
  // 健康檢查
  // ─────────────────────────────────────────────
  app.get("/api/callback/health", (_req: Request, res: Response) => {
    res.json({ success: true, status: "ok", timestamp: new Date().toISOString() });
  });

  // ─────────────────────────────────────────────
  // 獲取下一個可用邀請碼（插件主動拉取）
  // ─────────────────────────────────────────────
  app.get("/api/callback/next-invite-code", async (req: Request, res: Response) => {
    try {
      const { getUnusedInviteCodes } = await import("./db");
      const unusedCodes = await getUnusedInviteCodes();

      if (unusedCodes.length === 0) {
        return res.json({
          success: true,
          inviteCode: null,
          message: "No unused invite codes available",
        });
      }

      const next = unusedCodes[0];
      return res.json({
        success: true,
        inviteCode: next.inviteCode,
        sourceEmail: next.email,
        sourceAccountId: next.id,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // 主要回調：插件注冊成功後上報賬號數據
  // 兼容兩種格式：
  //   (A) 簡化格式：直接字段
  //   (B) 完整格式：包含 user_info / credits_info / invitation_info 嵌套對象
  // ─────────────────────────────────────────────
  app.post("/api/callback/register", async (req: Request, res: Response) => {
    try {
      const body = req.body;

      // ── 解析字段（兼容兩種格式）──
      const email: string = body.email;
      const password: string = body.password;
      const phone: string | undefined = body.phone;
      const token: string | undefined = body.token;
      const clientId: string | undefined = body.clientId;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: "email and password are required",
        });
      }

      // 嵌套格式兼容
      const userInfo = body.user_info || {};
      const creditsInfo = body.credits_info || {};
      const invitationInfo = body.invitation_info || {};

      const userId: string | undefined = body.userId || userInfo.userId;
      const displayname: string | undefined =
        body.displayname || userInfo.displayname || userInfo.nickname;
      const membershipVersion: string =
        body.membershipVersion || userInfo.membershipVersion || creditsInfo.membershipVersion || "free";
      const totalCredits: number =
        body.totalCredits ?? creditsInfo.totalCredits ?? 0;
      const freeCredits: number =
        body.freeCredits ?? creditsInfo.freeCredits ?? 0;
      const refreshCredits: number =
        body.refreshCredits ?? creditsInfo.refreshCredits ?? 0;

      // 邀請碼（此賬號持有的邀請碼）
      let inviteCode: string | undefined = body.inviteCode;
      let inviteCodeId: string | undefined = body.inviteCodeId;
      if (!inviteCode && invitationInfo.invitationCodes?.length > 0) {
        const primary = invitationInfo.invitationCodes[0];
        inviteCode = primary.inviteCode;
        inviteCodeId = primary.id;
      }

      // 邀請者邀請碼（此賬號是被誰邀請的）
      const invitedByCode: string | undefined = body.invitedByCode;

      const registeredAt: Date =
        body.registeredAt
          ? new Date(body.registeredAt)
          : userInfo.registeredAt
          ? new Date(userInfo.registeredAt)
          : new Date();

      // ── 查找邀請者 ──
      let invitedById: number | undefined;
      if (invitedByCode) {
        const inviter = await getAccountByInviteCode(invitedByCode);
        if (inviter) {
          invitedById = inviter.id;
          // 將邀請者的邀請碼狀態改為「已使用」
          await updateInviteStatus(invitedByCode, "used");
        }
      }

      // ── 創建新賬號 ──
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
        invitedByCode,
        invitedById,
        registeredAt,
        inviteStatus: "unused",
      });

      // ── 更新運行中的任務統計 ──
      const allTasks = await getAutomationTasks();
      for (const task of allTasks) {
        if (task.status === "running") {
          await updateAutomationTask(task.id, {
            totalAccountsCreated: (task.totalAccountsCreated || 0) + 1,
            totalSuccess: (task.totalSuccess || 0) + 1,
          });

          // 找到對應的任務日誌並標記成功
          if (invitedByCode) {
            const logs = await getTaskLogs({
              taskId: task.id,
              status: "running",
              pageSize: 20,
            });
            const matchingLog = logs.items.find(
              (l) => l.usedInviteCode === invitedByCode
            );
            if (matchingLog) {
              await updateTaskLog(matchingLog.id, {
                status: "success",
                completedAt: new Date(),
                durationMs: Date.now() - (matchingLog.startedAt?.getTime() ?? Date.now()),
              });
            }
          }
        }
      }

      console.log(
        `[Callback] New account registered: ${email} | inviteCode: ${inviteCode ?? "none"} | invitedBy: ${invitedByCode ?? "none"}`
      );

      return res.json({
        success: true,
        message: "Account registered successfully",
        email,
        inviteCode: inviteCode ?? null,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[Callback] Register error:", msg);
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // 通知邀請碼開始被使用（注冊流程開始時調用，可選）
  // ─────────────────────────────────────────────
  app.post("/api/callback/invite-used", async (req: Request, res: Response) => {
    try {
      const { inviteCode } = req.body;
      if (!inviteCode) {
        return res.status(400).json({ success: false, error: "inviteCode is required" });
      }

      await updateInviteStatus(inviteCode, "in_progress");
      console.log(`[Callback] Invite code marked as in_progress: ${inviteCode}`);

      return res.json({ success: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ success: false, error: msg });
    }
  });
}
