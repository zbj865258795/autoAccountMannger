import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createAccount,
  createAutomationTask,
  getAccountById,
  getAccountByInviteCode,
  getAccounts,
  getAutomationTaskById,
  getAutomationTasks,
  getCreditDistribution,
  getDashboardStats,
  getInvitationChain,
  getTaskLogs,
  getUnusedInviteCodes,
  updateAccount,
  updateAutomationTask,
  updateInviteStatus,
} from "./db";
import { checkAdsPowerConnection, getActiveBrowsers } from "./adspower";
import { startScheduler, pauseScheduler, stopScheduler, getRunningTaskIds } from "./scheduler";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const AccountImportSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  phone: z.string().optional(),
  token: z.string().optional(),
  clientId: z.string().optional(),
  userId: z.string().optional(),
  displayname: z.string().optional(),
  membershipVersion: z.string().optional().default("free"),
  totalCredits: z.number().optional().default(0),
  freeCredits: z.number().optional().default(0),
  refreshCredits: z.number().optional().default(0),
  inviteCode: z.string().optional(),
  inviteCodeId: z.string().optional(),
  invitedByCode: z.string().optional(),
  registeredAt: z.string().optional(),
  notes: z.string().optional(),
});

const AccountFilterSchema = z.object({
  search: z.string().optional(),
  inviteStatus: z.enum(["unused", "in_progress", "used"]).optional(),
  membershipVersion: z.string().optional(),
  minCredits: z.number().optional(),
  maxCredits: z.number().optional(),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "totalCredits", "registeredAt"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

// ─── Accounts Router ──────────────────────────────────────────────────────────

const accountsRouter = router({
  list: protectedProcedure.input(AccountFilterSchema).query(async ({ input }) => {
    return getAccounts(input);
  }),

  detail: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const account = await getAccountById(input.id);
    if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
    return account;
  }),

  invitationChain: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getInvitationChain(input.id);
    }),

  unusedCodes: protectedProcedure.query(async () => {
    return getUnusedInviteCodes();
  }),

  creditDistribution: protectedProcedure.query(async () => {
    return getCreditDistribution();
  }),

  // 手動新增單個賬號
  create: protectedProcedure.input(AccountImportSchema).mutation(async ({ input }) => {
    // 如果有 invitedByCode，查找邀請者
    let invitedById: number | undefined;
    if (input.invitedByCode) {
      const inviter = await getAccountByInviteCode(input.invitedByCode);
      if (inviter) {
        invitedById = inviter.id;
        // 將邀請者的邀請碼狀態改為「已使用」
        await updateInviteStatus(input.invitedByCode, "used");
      }
    }

    await createAccount({
      ...input,
      registeredAt: input.registeredAt ? new Date(input.registeredAt) : new Date(),
      invitedById,
    });

    return { success: true };
  }),

  // 批量導入賬號（支持 JSON 數組）
  bulkImport: protectedProcedure
    .input(z.object({ accounts: z.array(AccountImportSchema) }))
    .mutation(async ({ input }) => {
      let successCount = 0;
      let failCount = 0;
      const errors: string[] = [];

      for (const accountData of input.accounts) {
        try {
          let invitedById: number | undefined;
          if (accountData.invitedByCode) {
            const inviter = await getAccountByInviteCode(accountData.invitedByCode);
            if (inviter) {
              invitedById = inviter.id;
              await updateInviteStatus(accountData.invitedByCode, "used");
            }
          }

          await createAccount({
            ...accountData,
            registeredAt: accountData.registeredAt ? new Date(accountData.registeredAt) : new Date(),
            invitedById,
          });
          successCount++;
        } catch (err: any) {
          failCount++;
          errors.push(`${accountData.email}: ${err?.message || "Unknown error"}`);
        }
      }

      return { successCount, failCount, errors };
    }),

  // 更新賬號信息
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        data: AccountImportSchema.partial(),
      })
    )
    .mutation(async ({ input }) => {
      await updateAccount(input.id, input.data as any);
      return { success: true };
    }),

  // 更新邀請碼狀態
  updateInviteStatus: protectedProcedure
    .input(
      z.object({
        inviteCode: z.string(),
        status: z.enum(["unused", "in_progress", "used"]),
      })
    )
    .mutation(async ({ input }) => {
      await updateInviteStatus(input.inviteCode, input.status);
      return { success: true };
    }),
});

// ─── Dashboard Router ─────────────────────────────────────────────────────────

const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    return getDashboardStats();
  }),
});

// ─── Accounts Extended Router ─────────────────────────────────────────────────────

// ─── Automation Router ────────────────────────────────────────────────────────

const automationRouter = router({
  list: protectedProcedure.query(async () => {
    const tasks = await getAutomationTasks();
    const runningIds = getRunningTaskIds();
    return tasks.map((t) => ({ ...t, isRunning: runningIds.includes(t.id) }));
  }),

  detail: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const task = await getAutomationTaskById(input.id);
    if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
    return task;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        scanIntervalSeconds: z.number().min(10).default(60),
        adspowerApiUrl: z.string().default("http://local.adspower.net:50325"),
        adspowerApiKey: z.string().optional(),
        adspowerGroupId: z.string().optional(),
        targetUrl: z.string().optional(),
        maxConcurrent: z.number().min(1).max(50).default(1),
      })
    )
    .mutation(async ({ input }) => {
      await createAutomationTask(input);
      return { success: true };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        data: z.object({
          name: z.string().optional(),
          scanIntervalSeconds: z.number().min(10).optional(),
          adspowerApiUrl: z.string().optional(),
          adspowerApiKey: z.string().optional(),
          adspowerGroupId: z.string().optional(),
          targetUrl: z.string().optional(),
          maxConcurrent: z.number().min(1).max(50).optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      await updateAutomationTask(input.id, input.data);
      return { success: true };
    }),

  start: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await startScheduler(input.id);
      return { success: true };
    }),

  pause: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await pauseScheduler(input.id);
      return { success: true };
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await stopScheduler(input.id);
      return { success: true };
    }),

  // 檢查 AdsPower 連通性
  checkAdspower: protectedProcedure
    .input(z.object({ apiUrl: z.string() }))
    .query(async ({ input }) => {
      const connected = await checkAdsPowerConnection(input.apiUrl);
      const activeBrowsers = connected ? await getActiveBrowsers(input.apiUrl) : [];
      return { connected, activeBrowsers };
    }),
});

// ─── Task Logs Router ─────────────────────────────────────────────────────────

const taskLogsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        taskId: z.number().optional(),
        status: z.enum(["pending", "running", "success", "failed", "skipped"]).optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      return getTaskLogs(input);
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  accounts: accountsRouter,
  dashboard: dashboardRouter,
  automation: automationRouter,
  taskLogs: taskLogsRouter,
});

export type AppRouter = typeof appRouter;
