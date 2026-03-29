import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// 本地部署模式：所有接口无需认证，直接放行
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure;
export const adminProcedure = t.procedure;
