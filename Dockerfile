# ─── 阶段一：构建前端 + 编译后端 ──────────────────────────────────────────────
FROM node:22-alpine AS builder

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# 先复制依赖文件，利用 Docker 层缓存
COPY package.json pnpm-lock.yaml* ./

# 如果有 patches 目录则复制（可选）
COPY patches/ ./patches/

# 安装所有依赖（含 devDependencies，构建时需要）
RUN pnpm install --frozen-lockfile

# 复制全部源码
COPY . .

# 构建：
#   vite build   → dist/public/  （前端静态文件）
#   esbuild      → dist/index.js （后端入口）
RUN pnpm build

# ─── 阶段二：生产运行镜像 ──────────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# 只安装生产依赖
COPY package.json pnpm-lock.yaml* ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile --prod

# 复制构建产物（dist/ 包含 index.js 和 public/ 两部分）
COPY --from=builder /app/dist ./dist

# 复制数据库初始化 schema（运行时迁移需要）
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
