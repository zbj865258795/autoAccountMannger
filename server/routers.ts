import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  bulkImportPhoneNumbers,
  createAccount,
  deletePhoneNumbers,
  getAccountById,
  getAccountByInviteCode,
  getAccounts,
  getAutomationTaskById,
  getAutomationTasks,
  getCreditDistribution,
  getDashboardStats,
  getInvitationChain,
  getNextAvailablePhone,
  getPhoneNumbers,
  getPhoneStats,
  getTaskLogs,
  getUnusedInviteCodes,
  markPhoneUsed,
  resetPhoneStatus,
  updateAccount,
  createAutomationTask,
  updateAutomationTask,
  updateInviteStatus,
} from "./db";
import { checkAdsPowerConnection, getActiveBrowsers } from "./adspower";
import { ADSPOWER_CONFIG } from "./config";
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

  create: protectedProcedure.input(AccountImportSchema).mutation(async ({ input }) => {
    let invitedById: number | undefined;
    if (input.invitedByCode) {
      const inviter = await getAccountByInviteCode(input.invitedByCode);
      if (inviter) {
        invitedById = inviter.id;
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
        } catch (err: unknown) {
          failCount++;
          const msg = err instanceof Error ? err.message : "Unknown error";
          errors.push(`${accountData.email}: ${msg}`);
        }
      }

      return { successCount, failCount, errors };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number(), data: AccountImportSchema.partial() }))
    .mutation(async ({ input }) => {
      await updateAccount(input.id, input.data as Parameters<typeof updateAccount>[1]);
      return { success: true };
    }),

  updateInviteStatus: protectedProcedure
    .input(z.object({
      inviteCode: z.string(),
      status: z.enum(["unused", "in_progress", "used"]),
    }))
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
    .input(z.object({
      name: z.string().min(1),
      scanIntervalSeconds: z.number().min(10).default(60),
      adspowerApiUrl: z.string().default(ADSPOWER_CONFIG.apiUrl),
      adspowerGroupId: z.string().optional(),
      targetUrl: z.string().optional(),
      maxConcurrent: z.number().min(1).max(50).default(1),
    }))
    .mutation(async ({ input }) => {
      await createAutomationTask(input);
      return { success: true };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().optional(),
        scanIntervalSeconds: z.number().min(10).optional(),
        adspowerApiUrl: z.string().optional(),
        adspowerGroupId: z.string().optional(),
        targetUrl: z.string().optional(),
        maxConcurrent: z.number().min(1).max(50).optional(),
      }),
    }))
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

  // 检查 AdsPower 连通性（自动使用配置文件中的 API Key）
  checkAdspower: protectedProcedure
    .input(z.object({ apiUrl: z.string() }))
    .query(async ({ input }) => {
      const connected = await checkAdsPowerConnection(input.apiUrl, ADSPOWER_CONFIG.apiKey);
      const activeBrowsers = connected ? await getActiveBrowsers(input.apiUrl) : [];
      return { connected, activeBrowsers };
    }),
});

// ─── Task Logs Router ─────────────────────────────────────────────────────────

const taskLogsRouter = router({
  list: protectedProcedure
    .input(z.object({
      taskId: z.number().optional(),
      status: z.enum(["pending", "running", "success", "failed", "skipped"]).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      return getTaskLogs(input);
    }),
});

// ─── Phone Numbers Router ─────────────────────────────────────────────────────
// 手机号录入格式：每行一条「手机号|接码URL」，原样存储，不做拆分处理
// 每次调用 getNext 接口，返回一条未使用的记录，同时立即标记为已使用

const phoneNumbersRouter = router({
  // 获取手机号列表（支持状态筛选和搜索）
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["unused", "in_use", "used"]).optional(),
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      return getPhoneNumbers(input);
    }),

  // 获取统计数据（各状态数量）
  stats: protectedProcedure.query(async () => {
    return getPhoneStats();
  }),

  // 批量导入：每行一条「手机号|接码URL」，原样存储
  bulkImport: protectedProcedure
    .input(z.object({ text: z.string().min(1, "请输入手机号数据") }))
    .mutation(async ({ input }) => {
      const lines = input.text.split("\n").filter((l) => l.trim());
      return bulkImportPhoneNumbers(lines);
    }),

  // 获取下一个未使用的手机号，调用后立即标记为已使用
  getNext: protectedProcedure.mutation(async () => {
    return getNextAvailablePhone();
  }),

  // 手动标记已使用（可附带使用此号码注册的邮箱）
  markUsed: protectedProcedure
    .input(z.object({
      phone: z.string(),
      usedByEmail: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await markPhoneUsed(input.phone, input.usedByEmail);
      return { success: true };
    }),

  // 重置为未使用（用于重新分配）
  reset: protectedProcedure
    .input(z.object({ phone: z.string() }))
    .mutation(async ({ input }) => {
      await resetPhoneStatus(input.phone);
      return { success: true };
    }),

  // 删除手机号
  delete: protectedProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      await deletePhoneNumbers(input.ids);
      return { success: true };
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
  phoneNumbers: phoneNumbersRouter,
});

export type AppRouter = typeof appRouter;
