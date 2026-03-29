/**
 * Chrome 插件回調 REST 端點
 *
 * 當 Chrome 插件完成賬號注冊後，調用此端點將新賬號信息保存到數據庫。
 *
 * POST /api/callback/register
 * {
 *   email, password, token, userId, displayname,
 *   membershipVersion, totalCredits, freeCredits, refreshCredits,
 *   inviteCode, inviteCodeId, invitedByCode, registeredAt
 * }
 *
 * POST /api/callback/invite-used
 * { inviteCode } - 通知系統某邀請碼已被使用（注冊完成）
 */

import type { Express, Request, Response } from "express";
import {
  createAccount,
  getAccountByInviteCode,
  updateInviteStatus,
  updateAutomationTask,
  getAutomationTasks,
  createTaskLog,
  updateTaskLog,
  getTaskLogs,
} from "./db";

export function registerCallbackRoutes(app: Express): void {
  /**
   * 主要回調端點：Chrome 插件注冊成功後調用
   * 接收完整的賬號信息並保存到數據庫
   */
  app.post("/api/callback/register", async (req: Request, res: Response) => {
    try {
      const {
        email,
        password,
        token,
        userId,
        displayname,
        membershipVersion,
        totalCredits,
        freeCredits,
        refreshCredits,
        inviteCode,
        inviteCodeId,
        invitedByCode,
        registeredAt,
        notes,
      } = req.body;

      if (!email || !password) {
        return res.status(400).json({ success: false, error: "email and password are required" });
      }

      // 查找邀請者
      let invitedById: number | undefined;
      if (invitedByCode) {
        const inviter = await getAccountByInviteCode(invitedByCode);
        if (inviter) {
          invitedById = inviter.id;
          // 將邀請者的邀請碼狀態改為「已使用」
          await updateInviteStatus(invitedByCode, "used");
        }
      }

      // 創建新賬號
      await createAccount({
        email,
        password,
        token,
        userId,
        displayname,
        membershipVersion: membershipVersion || "free",
        totalCredits: totalCredits || 0,
        freeCredits: freeCredits || 0,
        refreshCredits: refreshCredits || 0,
        inviteCode,
        inviteCodeId,
        invitedByCode,
        invitedById,
        registeredAt: registeredAt ? new Date(registeredAt) : new Date(),
        notes,
      });

      // 更新相關任務的統計
      const runningTasks = await getAutomationTasks();
      for (const task of runningTasks) {
        if (task.status === "running") {
          await updateAutomationTask(task.id, {
            totalAccountsCreated: (task.totalAccountsCreated || 0) + 1,
          });

          // 查找並更新對應的任務日誌（找到使用了此邀請碼的日誌）
          if (invitedByCode) {
            const logs = await getTaskLogs({ taskId: task.id, status: "running", pageSize: 10 });
            const matchingLog = logs.items.find((l) => l.usedInviteCode === invitedByCode);
            if (matchingLog) {
              await updateTaskLog(matchingLog.id, {
                status: "success",
                completedAt: new Date(),
              });
            }
          }
        }
      }

      console.log(`[Callback] New account registered: ${email} (invited by: ${invitedByCode || "none"})`);

      return res.json({
        success: true,
        message: "Account registered successfully",
        email,
      });
    } catch (error: any) {
      console.error("[Callback] Register error:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Internal server error",
      });
    }
  });

  /**
   * 接收完整的 JSON 格式賬號數據（與插件輸出格式完全兼容）
   * 支持直接粘貼插件輸出的完整 JSON
   */
  app.post("/api/callback/register-full", async (req: Request, res: Response) => {
    try {
      const data = req.body;

      // 解析完整的插件輸出格式
      const email = data.email;
      const password = data.password;
      const token = data.token;
      const userInfo = data.user_info || {};
      const creditsInfo = data.credits_info || {};
      const invitationInfo = data.invitation_info || {};

      if (!email || !password) {
        return res.status(400).json({ success: false, error: "email and password are required" });
      }

      // 提取邀請碼
      const inviteCodes = invitationInfo.invitationCodes || [];
      const primaryInviteCode = inviteCodes[0];

      // 查找邀請者（如果有 invitedByCode 字段）
      let invitedById: number | undefined;
      const invitedByCode = data.invitedByCode;
      if (invitedByCode) {
        const inviter = await getAccountByInviteCode(invitedByCode);
        if (inviter) {
          invitedById = inviter.id;
          await updateInviteStatus(invitedByCode, "used");
        }
      }

      await createAccount({
        email,
        password,
        token,
        userId: userInfo.userId,
        displayname: userInfo.displayname || userInfo.nickname,
        membershipVersion: userInfo.membershipVersion || creditsInfo.membershipVersion || "free",
        totalCredits: creditsInfo.totalCredits || 0,
        freeCredits: creditsInfo.freeCredits || 0,
        refreshCredits: creditsInfo.refreshCredits || 0,
        inviteCode: primaryInviteCode?.inviteCode,
        inviteCodeId: primaryInviteCode?.id,
        invitedByCode,
        invitedById,
        registeredAt: userInfo.registeredAt ? new Date(userInfo.registeredAt) : new Date(),
      });

      // 更新任務統計
      const runningTasks = await getAutomationTasks();
      for (const task of runningTasks) {
        if (task.status === "running") {
          await updateAutomationTask(task.id, {
            totalAccountsCreated: (task.totalAccountsCreated || 0) + 1,
          });
        }
      }

      console.log(`[Callback] Full account data registered: ${email}`);

      return res.json({
        success: true,
        message: "Account registered successfully",
        email,
        inviteCode: primaryInviteCode?.inviteCode,
      });
    } catch (error: any) {
      console.error("[Callback] Register-full error:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Internal server error",
      });
    }
  });

  /**
   * 通知邀請碼已被使用（注冊流程開始時調用）
   */
  app.post("/api/callback/invite-used", async (req: Request, res: Response) => {
    try {
      const { inviteCode } = req.body;
      if (!inviteCode) {
        return res.status(400).json({ success: false, error: "inviteCode is required" });
      }

      await updateInviteStatus(inviteCode, "in_progress");
      console.log(`[Callback] Invite code marked as in_progress: ${inviteCode}`);

      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message });
    }
  });

  /**
   * 獲取下一個可用的邀請碼（Chrome 插件主動拉取）
   */
  app.get("/api/callback/next-invite-code", async (req: Request, res: Response) => {
    try {
      const { getUnusedInviteCodes } = await import("./db");
      const unusedCodes = await getUnusedInviteCodes();

      if (unusedCodes.length === 0) {
        return res.json({ success: true, inviteCode: null, message: "No unused invite codes available" });
      }

      const next = unusedCodes[0];
      return res.json({
        success: true,
        inviteCode: next.inviteCode,
        sourceEmail: next.email,
        sourceAccountId: next.id,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message });
    }
  });

  /**
   * 健康檢查端點
   */
  app.get("/api/callback/health", (_req: Request, res: Response) => {
    res.json({ success: true, status: "ok", timestamp: new Date().toISOString() });
  });
}
