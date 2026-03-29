# ─── 阶段一：构建前端 + 编译后端 ──────────────────────────────────────────────
FROM node:22-alpine AS builder

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# 先复制依赖文件，利用 Docker 层缓存
COPY package.json pnpm-lock.yaml* ./
COPY patches/ ./patches/

# 安装所有依赖（含 devDependencies，构建时需要）
RUN pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 构建：Vite 打包前端 + esbuild 编译后端
RUN pnpm build

# ─── 阶段二：生产运行镜像 ──────────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# 只复制生产依赖
COPY package.json pnpm-lock.yaml* ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile --prod

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist

# 复制数据库 schema（运行时迁移需要）
COPY drizzle/ ./drizzle/

# 复制 drizzle 配置（用于迁移）
COPY drizzle.config.ts ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 启动应用
CMD ["node", "dist/index.js"]
