# 账号管理系统 · 插件对接 API 文档

**Base URL：** `http://localhost:3900`

---

## 接口关联说明

`next-invite-code` 返回的 `id` 需要传给 `reset-invite-code`（注册失败时）或 `register`（注册成功时）的 `inviterAccountId` 字段。`get-phone` 返回的 `id` 需要传给 `mark-phone-used`。

---

## 1. 获取邀请码

**`GET /api/callback/next-invite-code`**

无需传入任何参数。调用后系统立即将该邀请码标记为「邀请中」（原子操作）。

**响应（有可用邀请码）：**

```json
{
  "success": true,
  "id": 30001,
  "inviteCode": "DNTT7V7WJAS6ABI",
  "sourceEmail": "user@example.com"
}
```

**响应（无可用邀请码）：**

```json
{
  "success": true,
  "inviteCode": null,
  "message": "暂无可用邀请码"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 邀请人账号 ID，**必须保存**，后续接口需要用到 |
| `inviteCode` | string \| null | 邀请码字符串；为 `null` 时表示无可用邀请码 |
| `sourceEmail` | string | 该邀请码所属账号的邮箱 |

---

## 2. 注册失败时归还邀请码

**`POST /api/callback/reset-invite-code`**

注册流程中任意步骤失败时调用，将邀请码状态重置为「未使用」。

**请求 Body：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | **是** | 来自 `next-invite-code` 返回的 `id` |

**响应：**

```json
{ "success": true, "message": "邀请码已重置为未使用" }
```

---

## 3. 获取手机号

**`POST /api/callback/get-phone`**

无需传入任何参数。调用后系统立即将该手机号标记为「使用中」（原子操作）。

**响应（有可用手机号）：**

```json
{
  "success": true,
  "id": 5,
  "phone": "+12232263007",
  "smsUrl": "https://sms-activate.io/xxx/12232263007"
}
```

**响应（无可用手机号）：**

```json
{ "success": false, "message": "暂无可用手机号" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 手机号记录 ID，**必须保存**，`mark-phone-used` 需要用到 |
| `phone` | string | 手机号（含国家代码） |
| `smsUrl` | string | 接码平台 URL，用于获取短信验证码 |

---

## 4. 标记手机号已使用

**`POST /api/callback/mark-phone-used`**

收到短信验证码后调用。

**请求 Body：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | **是** | 来自 `get-phone` 返回的 `id` |

**响应：**

```json
{ "success": true, "message": "手机号已标记为已使用" }
```

---

## 5. 注册成功后上报账号数据

**`POST /api/callback/register`**

注册成功后调用。系统会自动将 `inviterAccountId` 对应的邀请码标记为「已使用」，新账号的邀请码状态自动设为「未使用」。

**请求 Body：**

只有 `email`、`password`、`inviterAccountId` 是必填，其余字段**有什么传什么**，没有的直接不传。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | **是** | 新账号邮箱，重复则返回 409 |
| `password` | string | **是** | 新账号密码 |
| `inviterAccountId` | number | **是** | 来自 `next-invite-code` 返回的 `id`，后端通过此 ID 将邀请人邀请码标记为「已使用」 |
| `inviteCode` | string | 否 | 新账号自己的邀请码（平台注册后返回，每账号唯一） |
| `referrerCode` | string | 否 | 邀请人邀请码字符串（兼容旧格式） |
| `phone` | string | 否 | 注册使用的手机号（含国家代码） |
| `token` | string | 否 | 平台返回的 JWT Token |
| `clientId` | string | 否 | 平台分配的 Client ID |
| `membershipVersion` | string | 否 | 会员版本，如 `free` / `pro`，默认 `free` |
| `totalCredits` | number | 否 | 账号总积分，默认 `0` |
| `freeCredits` | number | 否 | 免费积分，默认 `0` |
| `refreshCredits` | number | 否 | 刷新积分，默认 `0` |
| `adspowerBrowserId` | string | 否 | AdsPower 浏览器环境 ID（启动页 URL 中的 `id` 参数），建议传入，用于后端精确匹配任务日志 |

**请求示例（在你现有数据结构上加 `inviterAccountId` 即可）：**

```json
{
  "email": "stevenpetersen1175@outlook.com",
  "password": "aB3#kLm9xPq2$Yw",
  "phone": "+17699335914",
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "clientId": "c4QzUWRnJKGQ6QJEsUXUWV",
  "membershipVersion": "free",
  "totalCredits": 2800,
  "freeCredits": 2500,
  "inviteCode": "DNTT7V7WJAS6ABI",
  "referrerCode": "XXXXXXXXX",
  "inviterAccountId": 30001,
  "adspowerBrowserId": "k1ay3ub1"
}
```

**成功响应（HTTP 200）：**

```json
{
  "success": true,
  "message": "账号注册成功",
  "email": "stevenpetersen1175@outlook.com",
  "inviteCode": "DNTT7V7WJAS6ABI"
}
```

**失败响应：**

| HTTP 状态码 | `code` 字段 | 含义 |
|-------------|-------------|------|
| 400 | — | `email` 或 `password` 缺失 |
| 409 | `EMAIL_EXISTS` | 邮箱已存在 |
| 409 | `INVITE_CODE_EXISTS` | `inviteCode` 与已有记录重复 |
| 409 | `DUPLICATE` | 其他唯一键冲突 |
| 500 | — | 服务器内部错误 |

```json
{
  "success": false,
  "error": "邮箱 xxx@outlook.com 已存在，跳过注册",
  "code": "EMAIL_EXISTS"
}
```

---

## 6. 插件异常上报

**`POST /api/callback/report-error`**

注册流程中任意步骤失败时调用。服务器收到后会自动：
1. 将对应任务日志标记为 `failed`，记录错误信息
2. 关闭并删除该 AdsPower 浏览器环境
3. 如果任务仍在运行中，立即触发下一次注册

> **browserId 如何获取？**
> 启动页面 URL 中已包含：`https://start.adspower.net/?id=kxxxxx&host=...`
> 其中 `id` 参数即为 `browserId`，插件可直接从 URL 中读取。

**请求 Body：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `browserId` | string | **是** | AdsPower 环境 ID（启动页 URL 中的 `id` 参数） |
| `error` | string | **是** | 错误描述，如：验证码识别失败、手机号超时 |

**请求示例：**

```json
{ "browserId": "k1ay3ub1", "error": "验证码识别失败" }
```

**成功响应：**

```json
{ "success": true, "message": "已处理异常，浏览器 k1ay3ub1 已关闭并删除，任务已触发下一次注册" }
```

**插件中的使用示例：**

```js
// 从 URL 中读取 browserId
const browserId = new URLSearchParams(window.location.search).get('id');

async function reportError(errorMsg) {
  if (!browserId) return;
  await fetch('http://localhost:3900/api/callback/report-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browserId, error: errorMsg })
  });
}
```

---

## 7. 健康检查

**`GET /api/callback/health`**

无需参数，确认服务是否正常运行。

**响应：**

```json
{ "success": true, "status": "ok", "timestamp": "2026-03-29T13:00:00.000Z" }
```

---

## 接口速查

| 方法 | 路径 | 关键入参 | 关键返回值 |
|------|------|----------|-----------|
| GET | `/api/callback/next-invite-code` | 无 | `id`、`inviteCode` |
| POST | `/api/callback/reset-invite-code` | `id` | — |
| POST | `/api/callback/get-phone` | 无 | `id`、`phone`、`smsUrl` |
| POST | `/api/callback/mark-phone-used` | `id` | — |
| POST | `/api/callback/register` | `email`、`password`、`inviterAccountId` | `success`、`email`、`inviteCode` |
| POST | `/api/callback/report-error` | `browserId`、`error` | `success`、`message` |
| GET | `/api/callback/health` | 无 | `status` |
