# 账号管理系统 (main-1 分支) Windows Desktop 部署指南

本文档旨在指导您如何在 Windows 桌面环境下，将账号管理系统从 `main` 分支切换并部署为包含最新 IP 池检测与 AdsPower 代理设置逻辑的 `main-1` 分支版本。

本系统为完全独立的本地应用，无需登录，无任何云平台依赖，直接在本地运行。

## 环境要求

在开始部署之前，请确保您的 Windows 系统已安装以下环境：

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | 18+ | 推荐使用 LTS 版本（如 20.x 或 22.x） |
| **pnpm** | 8+ | Node.js 包管理器，可通过 `npm install -g pnpm` 安装 |
| **MySQL** | 5.7+ 或 8.0+ | 数据库服务，可使用本地安装版或 Docker 容器版 |
| **Git** | 最新版 | 用于克隆和切换代码分支 |

## 部署步骤

### 第一步：获取最新代码并切换分支

如果您已经克隆了仓库，请打开命令行（如 PowerShell 或 Git Bash），进入项目目录，并执行以下命令拉取最新代码并切换到 `main-1` 分支：

```bash
# 进入项目目录
cd autoAccountMannger

# 拉取远程最新代码
git fetch origin

# 切换到 main-1 分支
git checkout main-1

# 确保本地 main-1 分支是最新的
git pull origin main-1
```

如果您还没有克隆仓库，请执行：

```bash
git clone https://github.com/zbj865258795/autoAccountMannger.git
cd autoAccountMannger
git checkout main-1
```

### 第二步：安装依赖

在项目根目录下，使用 pnpm 安装所有必需的依赖包：

```bash
pnpm install
```

### 第三步：配置环境变量

在项目根目录找到或创建 `.env` 文件。如果您之前在 `main` 分支已经配置过 `.env`，可以直接复用。如果没有，请参考 `env.example` 创建：

```env
# MySQL 数据库连接（必填，请根据您的实际 MySQL 账号密码修改）
DATABASE_URL=mysql://root:你的密码@localhost:3306/account_manager

# JWT 密钥（必填，随机字符串即可）
JWT_SECRET=any_random_string_here

# 服务端口（可选，默认 3000）
PORT=3000

# 运行环境
NODE_ENV=production
```

### 第四步：数据库配置与迁移

如果您是**首次部署**，需要在 MySQL 中创建数据库：

```sql
CREATE DATABASE account_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

由于 `main-1` 分支新增了 IP 池检测和代理设置功能，数据库结构有更新（新增了 `used_ip_pool` 表和 `task_logs.exitIp` 字段）。**无论您是首次部署还是从 main 分支升级，都必须执行数据库迁移**：

```bash
# 执行 Drizzle 数据库迁移，将最新的表结构同步到 MySQL
pnpm drizzle-kit migrate
```

> **注意**：如果您在执行迁移时遇到问题，也可以手动在 MySQL 中执行 `drizzle/0008_add_proxy_and_ip_pool.sql` 文件中的 SQL 语句。

### 第五步：构建并启动服务

**开发模式（推荐用于测试和调试，支持热重载）：**

```bash
pnpm dev
```

**生产模式（推荐用于长期稳定运行）：**

```bash
# 编译前端和后端代码
pnpm build

# 启动生产环境服务
pnpm start
```

服务启动成功后，打开浏览器访问 `http://localhost:3000` 即可使用系统。

## AdsPower 与代理配置说明

`main-1` 分支在自动化任务调度中集成了强大的代理 IP 检测功能：

1. **AdsPower 连接**：系统默认连接本地的 AdsPower 客户端（`http://local.adspower.net:50325` 或 `http://127.0.0.1:50325`）。请确保您的 AdsPower 客户端已启动并开启了 Local API。
2. **代理配置**：在系统的“自动化任务”配置界面中，您可以为任务填写 `proxyUrl`（例如 `socks5://user:pass@host:port`）。
3. **IP 池检测机制**：
   - 每次创建 AdsPower 浏览器前，系统会通过代理请求外部接口检测真实的出口 IP。
   - 系统会比对数据库中的 `used_ip_pool` 表，确保该出口 IP 之前未被使用过。
   - 如果 IP 已被使用，系统会自动等待并重试（最多 10 次）。如果连续 10 次获取的 IP 都已使用，任务将自动停止，提示您更换代理平台。
   - 注册成功后，系统会自动将本次使用的出口 IP 记录到已用 IP 池中。

## 常见问题排查

**Q: 数据库迁移 (`pnpm drizzle-kit migrate`) 失败怎么办？**
A: 请检查 `.env` 文件中的 `DATABASE_URL` 是否正确，确保 MySQL 服务正在运行，且数据库 `account_manager` 已创建。

**Q: 提示 "代理IP检测失败" 或 "连续 10 次获取到的出口IP均已使用"？**
A: 这说明您的动态代理池中重复 IP 较多，或者代理网络不通。请检查代理配置是否正确，或考虑在代理平台后台清理/更换 IP 池。

**Q: 启动时报错端口被占用？**
A: 请修改 `.env` 文件中的 `PORT` 变量（例如改为 `PORT=8080`），然后重新启动服务。
