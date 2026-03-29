/**
 * 账号管理系统核心功能测试
 * 涵盖：账号 CRUD、邀请码状态管理、批量导入、AdsPower 集成、并发调度器
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { generateRandomFingerprint } from "./adspower";

// ─── Mock 数据库模块 ──────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  createAccount: vi.fn().mockResolvedValue(undefined),
  getAccountById: vi.fn().mockResolvedValue({
    id: 1,
    email: "test@example.com",
    password: "password123",
    phone: "+17699335914",
    token: null,
    clientId: "c4QzUWRnJKGQ6QJEsUXUWV",
    inviteCode: "TESTCODE123",
    inviteStatus: "unused",
    totalCredits: 2800,
    freeCredits: 2500,
    refreshCredits: 300,
    membershipVersion: "free",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getAccountByInviteCode: vi.fn().mockResolvedValue(null),
  getAccounts: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getAutomationTaskById: vi.fn().mockResolvedValue(null),
  getAutomationTasks: vi.fn().mockResolvedValue([]),
  getCreditDistribution: vi.fn().mockResolvedValue({ membershipBreakdown: [], topAccounts: [], allAccounts: [] }),
  getDashboardStats: vi.fn().mockResolvedValue({
    totalAccounts: 0,
    totalCredits: 0,
    avgCredits: 0,
    maxCredits: 0,
    unusedCodes: 0,
    inProgressCodes: 0,
    usedCodes: 0,
    recentAccounts: [],
  }),
  getInvitationChain: vi.fn().mockResolvedValue([]),
  getTaskLogs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getUnusedInviteCodes: vi.fn().mockResolvedValue([]),
  updateAccount: vi.fn().mockResolvedValue(undefined),
  updateAutomationTask: vi.fn().mockResolvedValue(undefined),
  updateInviteStatus: vi.fn().mockResolvedValue(undefined),
  createAutomationTask: vi.fn().mockResolvedValue(undefined),
  deleteAccount: vi.fn().mockResolvedValue(undefined),
  getAccountByEmail: vi.fn().mockResolvedValue(null), // 默认返回 null，表示邮筱不重复
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock AdsPower 模块 ───────────────────────────────────────────────────────

vi.mock("./adspower", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adspower")>();
  return {
    ...actual,  // 保留 generateRandomFingerprint（纯函数，不需要 mock）
    checkAdsPowerConnection: vi.fn().mockResolvedValue(false),
    getActiveBrowsers: vi.fn().mockResolvedValue([]),
    createAdsPowerBrowser: vi.fn().mockResolvedValue({ success: true, profileId: "test-profile-123" }),
    startAdsPowerBrowser: vi.fn().mockResolvedValue({ success: true }),
  };
});

// ─── Mock 调度器模块 ──────────────────────────────────────────────────────────

vi.mock("./scheduler", () => ({
  startScheduler: vi.fn().mockResolvedValue(undefined),
  pauseScheduler: vi.fn().mockResolvedValue(undefined),
  stopScheduler: vi.fn().mockResolvedValue(undefined),
  getRunningTaskIds: vi.fn().mockReturnValue([]),
}));

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@example.com",
      name: "Admin",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── 测试：账号创建（含新字段） ───────────────────────────────────────────────

describe("accounts.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an account with all fields including phone and clientId", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.create({
      email: "stevenpetersen1175@outlook.com",
      password: "aB3#kLm9xPq2$Yw",
      phone: "+17699335914",
      token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
      clientId: "c4QzUWRnJKGQ6QJEsUXUWV",
      membershipVersion: "free",
      totalCredits: 2800,
      freeCredits: 2500,
      refreshCredits: 300,
      inviteCode: "DNTT7V7WJAS6ABI",
    });

    expect(result).toEqual({ success: true });

    const { createAccount } = await import("./db");
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "stevenpetersen1175@outlook.com",
        phone: "+17699335914",
        clientId: "c4QzUWRnJKGQ6QJEsUXUWV",
        inviteCode: "DNTT7V7WJAS6ABI",
        totalCredits: 2800,
      })
    );
  });

  it("creates account and updates inviter status when invitedByCode is provided", async () => {
    const { getAccountByInviteCode, updateInviteStatus } = await import("./db");
    vi.mocked(getAccountByInviteCode).mockResolvedValueOnce({
      id: 5,
      email: "inviter@example.com",
      password: "pass",
      token: null,
      phone: null,
      clientId: null,
      inviteCode: "INVITERCODE",
      inviteStatus: "unused",
      totalCredits: 500,
      freeCredits: 500,
      refreshCredits: 0,
      membershipVersion: "free",
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: null,
      displayname: null,
      inviteCodeId: null,
      invitedByCode: null,
      invitedById: null,
      registeredAt: new Date(),
      notes: null,
    });

    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.create({
      email: "invited@example.com",
      password: "password123",
      invitedByCode: "INVITERCODE",
    });

    expect(result).toEqual({ success: true });
    expect(updateInviteStatus).toHaveBeenCalledWith("INVITERCODE", "used");
  });
});

// ─── 测试：邀请码状态管理 ─────────────────────────────────────────────────────

describe("accounts.updateInviteStatus", () => {
  it("updates invite status to in_progress", async () => {
    const { updateInviteStatus } = await import("./db");
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.updateInviteStatus({
      inviteCode: "TESTCODE",
      status: "in_progress",
    });

    expect(result).toEqual({ success: true });
    expect(updateInviteStatus).toHaveBeenCalledWith("TESTCODE", "in_progress");
  });

  it("updates invite status to used", async () => {
    const { updateInviteStatus } = await import("./db");
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.updateInviteStatus({
      inviteCode: "TESTCODE",
      status: "used",
    });

    expect(result).toEqual({ success: true });
    expect(updateInviteStatus).toHaveBeenCalledWith("TESTCODE", "used");
  });
});

// ─── 测试：仪表板统计 ─────────────────────────────────────────────────────────

describe("dashboard.stats", () => {
  it("returns dashboard statistics", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const stats = await caller.dashboard.stats();

    expect(stats).toMatchObject({
      totalAccounts: 0,
      totalCredits: 0,
      unusedCodes: 0,
      inProgressCodes: 0,
      usedCodes: 0,
    });
  });
});

// ─── 测试：批量导入 ───────────────────────────────────────────────────────────

describe("accounts.bulkImport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("imports multiple accounts with new fields and returns success count", async () => {
    const { createAccount } = await import("./db");
    vi.mocked(createAccount).mockResolvedValue(undefined);

    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.bulkImport({
      accounts: [
        {
          email: "acc1@example.com",
          password: "pass1",
          phone: "+17699335914",
          clientId: "clientId1",
          inviteCode: "CODE1",
          totalCredits: 2800,
          freeCredits: 2500,
          refreshCredits: 300,
        },
        {
          email: "acc2@example.com",
          password: "pass2",
          phone: "+17699335915",
          clientId: "clientId2",
          inviteCode: "CODE2",
          totalCredits: 2800,
          freeCredits: 2500,
          refreshCredits: 300,
        },
      ],
    });

    expect(result.successCount).toBe(2);
    expect(result.failCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles partial failures gracefully", async () => {
    const { createAccount } = await import("./db");
    vi.mocked(createAccount)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Duplicate email"))
      .mockResolvedValueOnce(undefined);

    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.bulkImport({
      accounts: [
        { email: "acc1@example.com", password: "pass1" },
        { email: "duplicate@example.com", password: "pass2" },
        { email: "acc3@example.com", password: "pass3" },
      ],
    });

    expect(result.successCount).toBe(2);
    expect(result.failCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Duplicate email");
  });
});

// ─── 测试：AdsPower 连通性 ────────────────────────────────────────────────────

describe("automation.checkAdspower", () => {
  it("returns disconnected status for unreachable AdsPower", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.automation.checkAdspower({
      apiUrl: "http://local.adspower.net:50325",
    });

    expect(result.connected).toBe(false);
    expect(result.activeBrowsers).toEqual([]);
  });
});

// ─── 测试：AdsPower 随机指纹生成 ─────────────────────────────────────────────

describe("generateRandomFingerprint", () => {
  it("generates a valid fingerprint config", () => {
    const { fingerprint_config, _meta } = generateRandomFingerprint();

    expect(fingerprint_config).toBeDefined();
    expect(fingerprint_config.automatic_timezone).toBe("0"); // 手动指定时区，更可控
    expect(fingerprint_config.canvas).toBe("0");
    expect(fingerprint_config.webgl).toBe("0");
    expect(fingerprint_config.audio).toBe("0");
    expect(fingerprint_config.resolution).toMatch(/^\d+x\d+$/);
    expect(fingerprint_config.hardware_concurrency).toMatch(/^(2|4|6|8|12|16)$/);
    expect(fingerprint_config.device_memory).toMatch(/^(2|4|8|16)$/);
    expect(_meta.browserType).toMatch(/^(chrome|firefox)$/);
    expect(_meta.location).toBeTruthy();
  });

  it("generates different fingerprints on each call", () => {
    // 多次生成，至少有一個字段不同
    const results = Array.from({ length: 10 }, () => generateRandomFingerprint());
    const timezones = results.map((r) => r.fingerprint_config.timezone);
    const resolutions = results.map((r) => r.fingerprint_config.resolution);
    const concurrencies = results.map((r) => r.fingerprint_config.hardware_concurrency);

    // 10 次生成中，至少有 2 個不同的值（隨機性驗證）
    const uniqueTimezones = new Set(timezones).size;
    const uniqueResolutions = new Set(resolutions).size;
    const uniqueConcurrencies = new Set(concurrencies).size;

    // 至少有一個維度有多樣性
    expect(uniqueTimezones + uniqueResolutions + uniqueConcurrencies).toBeGreaterThan(3);
  });

  it("fingerprint has required mac_address_config with random model", () => {
    const { fingerprint_config } = generateRandomFingerprint();
    expect(fingerprint_config.mac_address_config).toBeDefined();
    expect(fingerprint_config.mac_address_config.model).toBe("1");
  });

  it("fingerprint has browser_kernel_config", () => {
    const { fingerprint_config } = generateRandomFingerprint();
    expect(fingerprint_config.browser_kernel_config).toBeDefined();
    expect(fingerprint_config.browser_kernel_config.version).toBe("latest");
    expect(["chrome", "firefox"]).toContain(fingerprint_config.browser_kernel_config.type);
  });
});

// ─── 測試：自動化任務創建（含新字段） ────────────────────────────────────────

describe("automation.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates automation task with targetUrl and concurrent settings", async () => {
    const { createAutomationTask } = await import("./db");
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    // API Key 已写死到配置文件，不再通过接口传入
    const result = await caller.automation.create({
      name: "Test Task",
      scanIntervalSeconds: 30,
      adspowerApiUrl: "http://local.adspower.net:50325",
      targetUrl: "https://example.com/register",
      maxConcurrent: 5,
    });

    expect(result).toEqual({ success: true });
    expect(createAutomationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test Task",
        maxConcurrent: 5,
        targetUrl: "https://example.com/register",
      })
    );
  });

  it("allows maxConcurrent up to 50", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.automation.create({
      name: "High Concurrency Task",
      maxConcurrent: 50,
    });

    expect(result).toEqual({ success: true });
  });
});
