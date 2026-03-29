import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerCallbackRoutes } from "../callback";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`未找到可用端口（起始端口：${startPort}）`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // 支持大文件上传
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Chrome 插件和外部回调 REST 端点
  registerCallbackRoutes(app);

  // tRPC API（无需认证）
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // 开发模式使用 Vite，生产模式使用静态文件
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`端口 ${preferredPort} 已被占用，改用端口 ${port}`);
  }

  server.listen(port, () => {
    console.log(`账号管理系统已启动：http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
