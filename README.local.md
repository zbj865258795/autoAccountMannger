# 账号管理系统 - 本地部署指南

本系统为完全独立的本地应用，**无需登录**，无任何云平台依赖，直接在本地运行。

---

## 环境要求

| 工具 | 版本要求 |
|------|---------|
| Node.js | 18+ |
| pnpm | 8+ |
| MySQL | 5.7+ 或 8.0+ |

---

## 快速部署步骤

### 第一步：克隆代码

```bash
git clone https://github.com/zbj865258795/autoAccountMannger.git
cd autoAccountMannger
```

### 第二步：安装依赖

```bash
pnpm install
```

### 第三步：配置环境变量

在项目根目录创建 `.env` 文件，填入以下内容：

```env
# MySQL 数据库连接（必填）
DATABASE_URL=mysql://root:你的密码@localhost:3306/account_manager

# JWT 密钥（必填，随机字符串即可）
JWT_SECRET=any_random_string_here

# 服务端口（可选，默认 3000）
PORT=3000

# 运行环境
NODE_ENV=production
```

### 第四步：创建数据库

在 MySQL 中创建数据库：

```sql
CREATE DATABASE account_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 第五步：执行数据库迁移

```bash
pnpm drizzle-kit migrate
```

### 第六步：构建并启动

**开发模式（热重载）：**
```bash
pnpm dev
```

**生产模式：**
```bash
pnpm build
pnpm start
```

访问 `http://localhost:3000` 即可使用，无需登录。

---

## AdsPower 配置

系统已内置 AdsPower API Key，无需额外配置。

AdsPower 默认地址：`http://local.adspower.net:50325`

如需修改，编辑 `server/config.ts` 文件中的 `ADSPOWER_CONFIG`。

---

## Chrome 插件集成

插件需要在注册成功后调用以下接口：

### 获取手机号
```
POST http://localhost:3000/api/callback/get-phone
```
返回一条未使用的手机号（原始格式），同时自动标记为已使用。

### 获取下一个可用邀请码
```
GET http://localhost:3000/api/callback/next-invite-code
```
返回一条未使用的邀请码信息。

### 上报注册成功的账号
```
POST http://localhost:3000/api/callback/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "your_password",
  "phone": "+12232263007",
  "token": "jwt_token_here",
  "clientId": "client_id_here",
  "membershipVersion": "free",
  "totalCredits": 2800,
  "freeCredits": 2500,
  "inviteCode": "YOUR_INVITE_CODE",
  "invitedByCode": "USED_INVITE_CODE"
}
```

### 通知邀请码已开始使用
```
POST http://localhost:3000/api/callback/invite-used
Content-Type: application/json

{ "inviteCode": "USED_INVITE_CODE" }
```

---

## 目录结构

```
├── client/          前端 React 应用
├── server/          后端 Express + tRPC 服务
│   ├── config.ts    AdsPower 配置（API Key 在此）
│   ├── adspower.ts  AdsPower 集成（随机指纹生成）
│   ├── scheduler.ts 自动化任务调度器
│   └── callback.ts  Chrome 插件回调接口
├── drizzle/         数据库 Schema 和迁移文件
└── README.local.md  本文件
```

---

## 常见问题

**Q: 数据库连接失败？**
检查 `.env` 中的 `DATABASE_URL` 格式是否正确，MySQL 服务是否已启动。

**Q: 端口被占用？**
修改 `.env` 中的 `PORT` 为其他端口，如 `PORT=8080`。

**Q: AdsPower 连接失败？**
确认 AdsPower 客户端已在本地运行，默认监听 `http://local.adspower.net:50325`。
