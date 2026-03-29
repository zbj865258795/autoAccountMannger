import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

// 本地部署模式：无需登录认证，直接放行所有请求
export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  return {
    req: opts.req,
    res: opts.res,
    user: null,
  };
}
