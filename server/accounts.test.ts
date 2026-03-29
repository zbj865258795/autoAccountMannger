/**
 * 賬號管理系統核心功能測試
 * 測試 tRPC 路由中的賬號導入、邀請碼狀態管理等核心邏輯
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock 數據庫模塊
vi.mock("./db", () => ({
  createAccount: vi.fn().mockResolvedValue(undefined),
  getAccountById: vi.fn().mockResolvedValue({
    id: 1,
    email: "test@example.com",
    password: "password123",
    token: null,
    inviteCode: "TESTCODE123",
    inviteStatus: "unused",
    totalCredits: 500,
    freeCredits: 500,
    refreshCredits: 0,
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
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
}));

// Mock AdsPower 模塊
vi.mock("./adspower", () => ({
  checkAdsPowerConnection: vi.fn().mockResolvedValue(false),
  getActiveBrowsers: vi.fn().mockResolvedValue([]),
}));

// Mock 調度器模塊
vi.mock("./scheduler", () => ({
  startScheduler: vi.fn().mockResolvedValue(undefined),
  pauseScheduler: vi.fn().mockResolvedValue(undefined),
  stopScheduler: vi.fn().mockResolvedValue(undefined),
  getRunningTaskIds: vi.fn().mockReturnValue([]),
}));

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

describe("accounts.create", () => {
  it("creates an account with basic fields", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.create({
      email: "new@example.com",
      password: "password123",
      inviteCode: "NEWCODE456",
      totalCredits: 500,
      freeCredits: 500,
      refreshCredits: 0,
      membershipVersion: "free",
    });

    expect(result).toEqual({ success: true });
  });

  it("creates account and updates inviter status when invitedByCode is provided", async () => {
    const { getAccountByInviteCode, updateInviteStatus } = await import("./db");
    vi.mocked(getAccountByInviteCode).mockResolvedValueOnce({
      id: 5,
      email: "inviter@example.com",
      password: "pass",
      token: null,
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

describe("accounts.bulkImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports multiple accounts and returns success count", async () => {
    const { createAccount } = await import("./db");
    vi.mocked(createAccount).mockResolvedValue(undefined);

    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.bulkImport({
      accounts: [
        { email: "acc1@example.com", password: "pass1", inviteCode: "CODE1" },
        { email: "acc2@example.com", password: "pass2", inviteCode: "CODE2" },
        { email: "acc3@example.com", password: "pass3", inviteCode: "CODE3" },
      ],
    });

    expect(result.successCount).toBe(3);
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
