import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  bulkImportPhoneNumbers,
  createAccount,
  deleteAccount,
  deletePhoneNumbers,
  getAccountByEmail,
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
  deleteAutomationTask,
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
  list: publicProcedure.input(AccountFilterSchema).query(async ({ input }) => {
    return getAccounts(input);
  }),

  detail: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const account = await getAccountById(input.id);
    if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
    return account;
  }),

  invitationChain: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getInvitationChain(input.id);
    }),

  unusedCodes: publicProcedure.query(async () => {
    return getUnusedInviteCodes();
  }),

  creditDistribution: publicProcedure.query(async () => {
    return getCreditDistribution();
  }),

  create: publicProcedure.input(AccountImportSchema).mutation(async ({ input }) => {
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

  bulkImport: publicProcedure
    .input(z.object({ accounts: z.array(AccountImportSchema) }))
    .mutation(async ({ input }) => {
      let successCount = 0;
      let skipCount = 0;
      let failCount = 0;
      const errors: string[] = [];
      const skipped: string[] = [];

      for (const accountData of input.accounts) {
        try {
          // 检查 email 是否已存在
          const existing = await getAccountByEmail(accountData.email);
          if (existing) {
            skipCount++;
            skipped.push(accountData.email);
            continue;
          }

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
          const msg = err instanceof Error ? err.message : "未知错误";
          errors.push(`${accountData.email}: ${msg}`);
        }
      }

      return { successCount, skipCount, failCount, errors, skipped };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const account = await getAccountById(input.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      await deleteAccount(input.id);
      return { success: true };
    }),

  update: publicProcedure
    .input(z.object({ id: z.number(), data: AccountImportSchema.partial() }))
    .mutation(async ({ input }) => {
      await updateAccount(input.id, input.data as Parameters<typeof updateAccount>[1]);
      return { success: true };
    }),

  updateInviteStatus: publicProcedure
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
  stats: publicProcedure.query(async () => {
    return getDashboardStats();
  }),
});

// ─── Automation Router ────────────────────────────────────────────────────────

const automationRouter = router({
  list: publicProcedure.query(async () => {
    const tasks = await getAutomationTasks();
    const runningIds = getRunningTaskIds();
    return tasks.map((t) => ({ ...t, isRunning: runningIds.includes(t.id) }));
  }),

  detail: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const task = await getAutomationTaskById(input.id);
    if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    return task;
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      scanIntervalSeconds: z.number().min(10).default(60),
      adspowerApiUrl: z.string().default(ADSPOWER_CONFIG.apiUrl),
      adspowerGroupId: z.string().optional(),
      targetUrl: z.string().optional(),
      maxConcurrent: z.number().min(1).max(50).default(1),
      targetCount: z.number().min(1).optional(),
    }))
    .mutation(async ({ input }) => {
      await createAutomationTask(input);
      return { success: true };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().optional(),
        scanIntervalSeconds: z.number().min(10).optional(),
        adspowerApiUrl: z.string().optional(),
        adspowerGroupId: z.string().optional(),
        targetUrl: z.string().optional(),
        maxConcurrent: z.number().min(1).max(50).optional(),
        targetCount: z.number().min(1).nullish(),
      }),
    }))
    .mutation(async ({ input }) => {
      await updateAutomationTask(input.id, input.data);
      return { success: true };
    }),

  start: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await startScheduler(input.id);
      return { success: true };
    }),

  pause: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await pauseScheduler(input.id);
      return { success: true };
    }),

  stop: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await stopScheduler(input.id);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // 如果任务正在运行，先强制停止
      const task = await getAutomationTaskById(input.id);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      if (task.status === "running" || task.status === "paused") {
        await stopScheduler(input.id);
      }
      await deleteAutomationTask(input.id);
      return { success: true };
    }),

  checkAdspower: publicProcedure
    .input(z.object({ apiUrl: z.string() }))
    .query(async ({ input }) => {
      const connected = await checkAdsPowerConnection(input.apiUrl, ADSPOWER_CONFIG.apiKey);
      const activeBrowsers = connected ? await getActiveBrowsers(input.apiUrl) : [];
      return { connected, activeBrowsers };
    }),
});

// ─── Task Logs Router ─────────────────────────────────────────────────────────

const taskLogsRouter = router({
  list: publicProcedure
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

const phoneNumbersRouter = router({
  list: publicProcedure
    .input(z.object({
      status: z.enum(["unused", "in_use", "used"]).optional(),
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      return getPhoneNumbers(input);
    }),

  stats: publicProcedure.query(async () => {
    return getPhoneStats();
  }),

  bulkImport: publicProcedure
    .input(z.object({ text: z.string().min(1, "请输入手机号数据") }))
    .mutation(async ({ input }) => {
      const lines = input.text.split("\n").filter((l) => l.trim());
      return bulkImportPhoneNumbers(lines);
    }),

  getNext: publicProcedure.mutation(async () => {
    return getNextAvailablePhone();
  }),

  markUsed: publicProcedure
    .input(z.object({
      phone: z.string(),
      usedByEmail: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await markPhoneUsed(input.phone, input.usedByEmail);
      return { success: true };
    }),

  reset: publicProcedure
    .input(z.object({ phone: z.string() }))
    .mutation(async ({ input }) => {
      await resetPhoneStatus(input.phone);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      await deletePhoneNumbers(input.ids);
      return { success: true };
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  accounts: accountsRouter,
  dashboard: dashboardRouter,
  automation: automationRouter,
  taskLogs: taskLogsRouter,
  phoneNumbers: phoneNumbersRouter,
});

export type AppRouter = typeof appRouter;
