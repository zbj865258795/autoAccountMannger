import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { Request, Response } from "express";

// 本地部署模式：无需认证，测试基本路由可访问性
function createLocalContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "http",
      headers: {},
    } as Request,
    res: {} as Response,
  };
}

describe("本地模式路由测试", () => {
  it("仪表板统计接口无需认证即可访问", async () => {
    const ctx = createLocalContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.dashboard.stats();

    expect(result).toHaveProperty("totalAccounts");
    expect(result).toHaveProperty("totalCredits");
    expect(result).toHaveProperty("unusedCodes");
    expect(typeof result.totalAccounts).toBe("number");
  });

  it("账号列表接口无需认证即可访问", async () => {
    const ctx = createLocalContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accounts.list({ page: 1, pageSize: 10 });

    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("手机号统计接口无需认证即可访问", async () => {
    const ctx = createLocalContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.phoneNumbers.stats();

    expect(result).toHaveProperty("unused");
    expect(result).toHaveProperty("used");
    expect(typeof result.unused).toBe("number");
  });
});
