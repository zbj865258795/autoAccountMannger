# 账号管理系统 (main-1 分支) Windows Docker Desktop 部署指南

本文档旨在指导您如何在 Windows Docker Desktop 环境下，将账号管理系统从 `main` 分支切换并重新部署为包含最新 IP 池检测与 AdsPower 代理设置逻辑的 `main-1` 分支版本。

## 环境要求

在开始部署之前，请确保您的 Windows 系统已安装并正常运行以下环境：

| 工具 | 说明 |
|------|------|
| **Docker Desktop** | 必须处于 Running 状态，推荐开启 WSL 2 后端支持 |
| **Git** | 用于拉取和切换代码分支 |

## 部署步骤

### 第一步：获取最新代码并切换分支

打开命令行（如 PowerShell 或 Git Bash），进入您之前克隆的项目目录，拉取最新代码并切换到 `main-1` 分支：

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

> **注意**：我已经为您更新了 `main-1` 分支的 `docker/init.sql` 文件，确保它包含了最新的 IP 池表结构。

### 第二步：清理旧的 Docker 容器

为了避免旧版本的容器和缓存影响新版本的运行，建议先停止并移除旧的容器：

```bash
# 停止并移除旧容器（不会删除数据卷）
docker-compose down
```

### 第三步：配置环境变量

在项目根目录找到或创建 `.env` 文件。如果您之前在 `main` 分支已经配置过 `.env`，可以直接复用。如果没有，请参考 `env.example` 创建：

```env
# MySQL 容器配置（docker-compose 使用）
MYSQL_ROOT_PASSWORD=rootpassword
MYSQL_DATABASE=account_manager
MYSQL_USER=appuser
MYSQL_PASSWORD=apppassword
MYSQL_PORT=3307

# JWT 密钥（必填，随机字符串即可）
JWT_SECRET=any_random_string_here

# 应用访问端口（默认 3000）
APP_PORT=3000

# AdsPower 本地 API 地址（Docker 容器通过 host.docker.internal 访问宿主机）
ADSPOWER_API_URL=http://host.docker.internal:50325
```

### 第四步：处理数据库更新（重要！）

由于 `main-1` 分支新增了 IP 池检测功能，数据库结构有更新（新增了 `used_ip_pool` 表和 `task_logs.exitIp` 字段）。

在 Docker 部署中，`docker/init.sql` 仅在**首次创建数据库数据卷时**执行。如果您之前已经运行过 `main` 分支的 Docker 容器，MySQL 数据卷（`mysql_data`）已经存在，那么重新启动容器时**不会**再次执行 `init.sql`。

您有两种选择来更新数据库：

#### 选项 A：保留现有数据（推荐）

如果您希望保留之前注册的账号和任务数据，您需要手动在现有的 MySQL 容器中执行更新 SQL：

1. 先启动数据库容器：
   ```bash
   docker-compose up -d db
   ```
2. 等待数据库启动后，进入 MySQL 容器执行更新：
   ```bash
   docker exec -i account_mgr_db mysql -u root -prootpassword account_manager < drizzle/0008_add_proxy_and_ip_pool.sql
   ```
   *(注意：请将 `-prootpassword` 中的 `rootpassword` 替换为您 `.env` 文件中的 `MYSQL_ROOT_PASSWORD`)*

#### 选项 B：清空所有数据重新开始

如果您不需要保留之前的数据，可以直接删除 Docker 数据卷，这样下次启动时会自动执行最新的 `init.sql`：

```bash
# 警告：这会删除所有数据库数据！
docker volume rm autoaccountmannger_mysql_data
```
*(注意：数据卷名称可能因您所在的文件夹名称而异，可以通过 `docker volume ls` 查看具体的名称)*

### 第五步：重新构建并启动服务

使用以下命令强制重新构建应用镜像，并启动所有服务：

```bash
# --build 参数强制重新构建 app 镜像
# -d 参数表示在后台运行
docker-compose up -d --build
```

启动后，您可以使用以下命令查看运行日志，确保服务正常启动：

```bash
docker-compose logs -f app
```

服务启动成功后，打开浏览器访问 `http://localhost:3000` 即可使用系统。

## AdsPower 与代理配置说明

在 Docker 环境下使用 AdsPower 和代理功能，请注意以下几点：

1. **AdsPower 连接**：Docker 容器内的应用无法直接通过 `127.0.0.1` 访问宿主机（您的 Windows 系统）上的 AdsPower。系统已默认配置使用 `http://host.docker.internal:50325` 来访问宿主机。请确保您的 AdsPower 客户端已启动并开启了 Local API。
2. **代理配置**：在系统的“自动化任务”配置界面中，您可以为任务填写 `proxyUrl`（例如 `socks5://user:pass@host:port`）。
3. **IP 池检测机制**：
   - 每次创建 AdsPower 浏览器前，系统会通过代理请求外部接口检测真实的出口 IP。
   - 系统会比对数据库中的 `used_ip_pool` 表，确保该出口 IP 之前未被使用过。
   - 如果 IP 已被使用，系统会自动等待并重试（最多 10 次）。如果连续 10 次获取的 IP 都已使用，任务将自动停止，提示您更换代理平台。
   - 注册成功后，系统会自动将本次使用的出口 IP 记录到已用 IP 池中。

## 常见问题排查

**Q: 启动后应用报错 "Table 'account_manager.used_ip_pool' doesn't exist"？**
A: 这说明数据库没有成功更新。请参考“第四步：处理数据库更新”中的“选项 A”，手动将更新 SQL 导入到数据库中。

**Q: 应用无法连接到 AdsPower？**
A: 请检查 AdsPower 客户端是否已启动，并在 AdsPower 设置中确认 Local API 端口是否为 `50325`。同时，确保您的 Docker Desktop 允许容器通过 `host.docker.internal` 访问宿主机网络。

**Q: 提示 "代理IP检测失败" 或 "连续 10 次获取到的出口IP均已使用"？**
A: 这说明您的动态代理池中重复 IP 较多，或者代理网络不通。请检查代理配置是否正确，或考虑在代理平台后台清理/更换 IP 池。
