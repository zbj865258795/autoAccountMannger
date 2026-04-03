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
  updateInviteStatusById,
  exportAccounts,
  getExportableAccounts,
  getExportBatches,
  getExportBatchDetail,
  getExportableCount,
  getUsedIpPool,
  getUsedIpCount,
  clearUsedIpPool,
  getProxyAccounts,
  createProxyAccount,
  updateProxyAccount,
  deleteProxyAccount,
  getProxyAccountById,
  getStepLogs,
} from "./db";
import { checkAdsPowerConnection, getActiveBrowsers } from "./adspower";
import { ADSPOWER_CONFIG } from "./config";
import { startScheduler, pauseScheduler, stopScheduler, getRunningTaskIds, handlePluginError } from "./scheduler";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

// 辅助：将 null / undefined / 空字符串统一转为 undefined
const optStr = z.string().nullish().transform(v => (v == null || v === "" ? undefined : v));
const optNum = (def: number) =>
  z.number().nullish().transform(v => v ?? def).default(def);

const AccountImportSchema = z.object({
  // ── 必填字段（三个）──────────────────────────────────────────────────────
  email:      z.string().email(),
  password:   z.string().min(1),
  inviteCode: z.string().min(1),  // 自己的邀请码，必填

  // ── 可选字段（null / undefined / 空字符串均可） ────────────────────────────
  phone:             optStr,
  token:             optStr,
  clientId:          optStr,
  userId:            optStr,
  displayname:       optStr,
  membershipVersion: z.string().nullish().transform(v => v ?? "free").default("free"),
  totalCredits:      optNum(0),
  freeCredits:       optNum(0),
  refreshCredits:    optNum(0),

  inviteCodeId: optStr,

  // 邀请人的邀请码（可选，没有邀请人时不填）
  invitedByCode: optStr,

  registeredAt: optStr,
  notes:        optStr,
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

  // ★ 新增：按账号 ID 将邀请码状态重置为「未使用」
  // 用于注册异常导致邀请码未被归还时，手动在账号列表重置
  resetInviteCode: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateInviteStatusById(input.id, "unused");
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
      proxyAccountId: z.number().optional(),
      targetCount: z.number().min(1).optional(),
    }))
    .mutation(async ({ input }) => {
      await createAutomationTask({ ...input, maxConcurrent: 1 });
      return { success: true };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().optional(),
        scanIntervalSeconds: z.number().min(10).optional(),
        adspowerApiUrl: z.string().optional(),
        proxyAccountId: z.number().nullish(),
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

  // 查询某条 task_log 的所有步骤日志（按时间升序）
  steps: publicProcedure
    .input(z.object({ taskLogId: z.number() }))
    .query(async ({ input }) => {
      return getStepLogs(input.taskLogId);
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

// ─── Export Router ───────────────────────────────────────────────────────────

const exportRouter = router({
  // 查询满足导出条件的账号列表
  listExportable: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      return getExportableAccounts(input);
    }),

  // 实时查询可导出账号总数（弹窗打开时调用）
  exportableCount: publicProcedure
    .query(async () => {
      return { count: await getExportableCount() };
    }),

  // 执行导出：按数量取前 N 条满足条件的账号（先注册先导出）
  doExport: publicProcedure
    .input(z.object({
      count: z.number().int().min(1, "至少导出 1 个").max(10000, "单次最多导出 10000 个"),
    }))
    .mutation(async ({ input }) => {
      // 后端二次校验：不超过实际可导出数量
      const available = await getExportableCount();
      if (available === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前没有满足导出条件的账号（需被邀请注册且自己的邀请码已被使用）",
        });
      }
      const actualCount = Math.min(input.count, available);
      const result = await exportAccounts(actualCount);
      if (result.exported === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "导出失败，请重试",
        });
      }
      return { ...result, available };
    }),

  // 查询导出批次列表
  listBatches: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      return getExportBatches(input);
    }),

  // 查询某批次的账号明细
  batchDetail: publicProcedure
    .input(z.object({
      batchId: z.string().min(1),
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      return getExportBatchDetail(input);
    }),
});

// ─── Plugin Router （插件回调接口） ───────────────────────────────────────────────────────

const pluginRouter = router({
  /**
   * 插件异常上报接口
   *
   * 插件在注册失败时调用此接口，传入当前浏览器的 profileId 和错误信息。
   * 服务器收到后会自动：
   *   1. 将对应任务日志标记为 failed
   *   2. 关闭并删除该 AdsPower 浏览器环境
   *   3. 如果任务仍在运行中，立即触发下一次注册
   *
   * 请求示例：
   * {
   *   "browserId": "kxxxxx",      // AdsPower 环境 ID（profile_id）
   *   "error": "验证码超时"         // 错误描述
   * }
   */
  reportError: publicProcedure
    .input(z.object({
      browserId: z.string().min(1, "browserId 不能为空"),
      error: z.string().min(1, "错误信息不能为空"),
    }))
    .mutation(async ({ input }) => {
      const result = await handlePluginError(input.browserId, input.error);
      if (!result.success) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: result.message,
        });
      }
      return { success: true, message: result.message };
    }),
});

// ─── IP Pool Router ───────────────────────────────────────────────────────────

const ipPoolRouter = router({
  list: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      return getUsedIpPool(input);
    }),

  count: publicProcedure.query(async () => {
    return { count: await getUsedIpCount() };
  }),

  clear: publicProcedure.mutation(async () => {
    await clearUsedIpPool();
    return { success: true };
  }),
});
// ─── Proxy Accounts Router ───────────────────────────────────────────────────────────────────────

const proxyAccountsRouter = router({
  list: publicProcedure.query(async () => {
    return getProxyAccounts();
  }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const account = await getProxyAccountById(input.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "代理账号不存在" });
      return account;
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      region: z.enum(["us", "tw", "hk", "jp"]),
      proxyUrl: z.string().min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await createProxyAccount(input);
      return { success: true };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().min(1).optional(),
        region: z.enum(["us", "tw", "hk", "jp"]).optional(),
        proxyUrl: z.string().min(1).optional(),
        notes: z.string().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      await updateProxyAccount(input.id, input.data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteProxyAccount(input.id);
      return { success: true };
    }),
});

// ─── App Router ────────────────────────────────────────────────────────────────────────

export const appRouter = router({
  accounts: accountsRouter,
  dashboard: dashboardRouter,
  automation: automationRouter,
  taskLogs: taskLogsRouter,
  phoneNumbers: phoneNumbersRouter,
  export: exportRouter,
  plugin: pluginRouter,
  ipPool: ipPoolRouter,
  proxyAccounts: proxyAccountsRouter,
});

export type AppRouter = typeof appRouter;
