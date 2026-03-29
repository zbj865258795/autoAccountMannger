# 账号管理系统 · 插件对接 API 文档

**版本：** v1.0  
**更新日期：** 2026-03-29  
**Base URL：** `http://localhost:3900`（本地运行时的地址，根据实际端口修改）

---

## 概述

本文档描述了 Chrome 插件与账号管理系统对接所需的全部接口。插件在执行自动注册流程时，需要按照以下顺序调用接口，系统会自动维护邀请码和手机号的状态机，确保资源不被重复分配。

所有接口均返回 JSON，`Content-Type` 统一为 `application/json`。

---

## 完整流程图

```
插件启动注册
    │
    ▼
[Step 1] GET /api/callback/next-invite-code
    │  成功 → 保存 inviterAccountId 和 inviteCode
    │  失败（inviteCode=null）→ 停止，等待管理员补充邀请码
    │
    ▼
[Step 2] POST /api/callback/get-phone
    │  成功 → 保存 phoneId 和 phone
    │  失败（success=false）→ 调用 reset-invite-code 归还邀请码，停止
    │
    ▼
[Step 3] 插件执行注册（填写邀请码、手机号）
    │
    ├── 注册失败（任意原因）
    │       └── POST /api/callback/reset-invite-code  ← 归还邀请码
    │
    ▼
[Step 4] 插件收到短信验证码
    │
    ▼
POST /api/callback/mark-phone-used  ← 标记手机号已使用
    │
    ▼
[Step 5] 注册完全成功，获取到账号数据
    │
    ▼
POST /api/callback/register  ← 上报账号数据，系统自动标记邀请人邀请码为「已使用」
```

---

## 接口详情

### 1. 获取邀请码

**调用时机：** 注册流程开始前，第一步调用。

| 属性 | 值 |
|------|----|
| 方法 | `GET` |
| 路径 | `/api/callback/next-invite-code` |
| 请求 Body | 无 |

**重要说明：** 调用此接口后，系统会立即将该邀请码标记为「邀请中」（原子操作，使用数据库行锁），防止多个插件实例并发时重复分配同一邀请码。**必须保存返回的 `id` 字段**，后续的 `reset-invite-code` 和 `register` 接口都需要用到它。

**成功响应（有可用邀请码）：**

```json
{
  "success": true,
  "id": 30001,
  "inviteCode": "DNTT7V7WJAS6ABI",
  "sourceEmail": "user@example.com"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 固定为 `true` |
| `id` | number | **邀请人账号 ID，必须保存，后续接口需要用到** |
| `inviteCode` | string | 邀请码字符串，填入注册表单的邀请码输入框 |
| `sourceEmail` | string | 该邀请码所属账号的邮箱（仅供参考，无需使用） |

**无可用邀请码时的响应：**

```json
{
  "success": true,
  "inviteCode": null,
  "message": "暂无可用邀请码"
}
```

当 `inviteCode` 为 `null` 时，说明系统中所有邀请码均已被分配或使用完毕，插件应停止注册并等待管理员补充。

**错误响应（服务器异常）：**

```json
{
  "success": false,
  "error": "Database not available"
}
```

**插件示例代码：**

```javascript
async function getInviteCode() {
  const res = await fetch('http://localhost:3900/api/callback/next-invite-code');
  const data = await res.json();

  if (!data.inviteCode) {
    console.log('❌ 暂无可用邀请码，停止注册');
    return null;
  }

  // 必须保存这两个值
  return {
    inviterAccountId: data.id,      // 后续 register 接口需要
    inviteCode: data.inviteCode,    // 填入注册表单
  };
}
```

---

### 2. 获取手机号

**调用时机：** 注册流程中，进入手机号输入页面时调用。

| 属性 | 值 |
|------|----|
| 方法 | `POST` |
| 路径 | `/api/callback/get-phone` |
| 请求 Body | 无（空 Body 或不传均可） |

**重要说明：** 调用此接口后，系统会立即将该手机号标记为「使用中」（原子操作），防止并发重复分配。**必须保存返回的 `id` 字段**，后续 `mark-phone-used` 接口需要用到。

**成功响应（有可用手机号）：**

```json
{
  "success": true,
  "id": 5,
  "phone": "+12232263007",
  "smsUrl": "https://sms-activate.io/xxx/12232263007"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | `true` 表示获取成功 |
| `id` | number | **手机号记录 ID，必须保存，mark-phone-used 需要用到** |
| `phone` | string | 手机号（含国家代码，如 `+12232263007`），填入注册表单 |
| `smsUrl` | string | 接码平台 URL，插件通过此 URL 轮询获取短信验证码 |

**无可用手机号时的响应：**

```json
{
  "success": false,
  "message": "暂无可用手机号"
}
```

当 `success` 为 `false` 时，插件应调用 `reset-invite-code` 归还已获取的邀请码，然后停止本次注册。

**插件示例代码：**

```javascript
async function getPhone(inviterAccountId) {
  const res = await fetch('http://localhost:3900/api/callback/get-phone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();

  if (!data.success) {
    console.log('❌ 暂无可用手机号，归还邀请码');
    // 归还邀请码
    await resetInviteCode(inviterAccountId);
    return null;
  }

  return {
    phoneId: data.id,       // 后续 mark-phone-used 需要
    phone: data.phone,      // 填入注册表单
    smsUrl: data.smsUrl,    // 用于轮询短信验证码
  };
}
```

---

### 3. 注册失败时归还邀请码

**调用时机：** 注册流程中任意步骤失败时（如网络超时、验证码错误、账号被封等），立即调用此接口归还邀请码，使其可被下次重新分配。

| 属性 | 值 |
|------|----|
| 方法 | `POST` |
| 路径 | `/api/callback/reset-invite-code` |
| 请求 Body | `{ "id": <number> }` |

**请求 Body：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | **是** | 邀请人账号 ID，来自 `next-invite-code` 返回的 `id` 字段 |

**请求示例：**

```json
{
  "id": 30001
}
```

**成功响应：**

```json
{
  "success": true,
  "message": "邀请码已重置为未使用"
}
```

**错误响应（缺少 id）：**

```json
{
  "success": false,
  "error": "id is required"
}
```

**插件示例代码：**

```javascript
async function resetInviteCode(inviterAccountId) {
  const res = await fetch('http://localhost:3900/api/callback/reset-invite-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: inviterAccountId }),
  });
  const data = await res.json();
  if (data.success) {
    console.log('✅ 邀请码已归还，可重新分配');
  }
}
```

---

### 4. 标记手机号已使用

**调用时机：** 插件成功从接码平台获取到短信验证码后，立即调用此接口。

| 属性 | 值 |
|------|----|
| 方法 | `POST` |
| 路径 | `/api/callback/mark-phone-used` |
| 请求 Body | `{ "id": <number> }` |

**请求 Body：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | **是** | 手机号记录 ID，来自 `get-phone` 返回的 `id` 字段 |

**请求示例：**

```json
{
  "id": 5
}
```

**成功响应：**

```json
{
  "success": true,
  "message": "手机号已标记为已使用"
}
```

**插件示例代码：**

```javascript
async function markPhoneUsed(phoneId) {
  await fetch('http://localhost:3900/api/callback/mark-phone-used', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: phoneId }),
  });
  console.log('✅ 手机号已标记为已使用');
}
```

---

### 5. 注册成功后上报账号数据

**调用时机：** 账号完全注册成功，获取到平台返回的所有账号信息后调用。调用此接口时，系统会自动将邀请人的邀请码标记为「已使用」，新账号的邀请码状态自动设为「未使用」（可被下一轮注册使用，形成邀请链循环）。

| 属性 | 值 |
|------|----|
| 方法 | `POST` |
| 路径 | `/api/callback/register` |
| 请求 Body | JSON 对象，见下表 |

**请求 Body 字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | **是** | 新账号邮箱，全局唯一，重复则返回 409 |
| `password` | string | **是** | 新账号密码 |
| `inviterAccountId` | number | **是** | 邀请人账号 ID，来自 `next-invite-code` 返回的 `id`，系统通过此 ID 将邀请码标记为「已使用」 |
| `inviteCode` | string | 否 | 新账号自己的邀请码（平台注册成功后分配，每个账号唯一） |
| `phone` | string | 否 | 注册使用的手机号（含国家代码，如 `+17699335914`） |
| `token` | string | 否 | 平台返回的 JWT Token（用于后续 API 调用） |
| `clientId` | string | 否 | 平台分配的 Client ID |
| `membershipVersion` | string | 否 | 会员版本，如 `free` / `pro`，默认 `free` |
| `totalCredits` | number | 否 | 账号总积分，默认 `0` |
| `freeCredits` | number | 否 | 免费积分，默认 `0` |
| `refreshCredits` | number | 否 | 刷新积分，默认 `0` |
| `userId` | string | 否 | 平台内部用户 ID |
| `displayname` | string | 否 | 账号昵称 |
| `registeredAt` | string | 否 | 注册时间（ISO 8601 格式），不传则取当前时间 |

**请求示例（标准格式）：**

```json
{
  "email": "stevenpetersen1175@outlook.com",
  "password": "aB3#kLm9xPq2$Yw",
  "inviterAccountId": 30001,
  "inviteCode": "DNTT7V7WJAS6ABI",
  "phone": "+17699335914",
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "clientId": "c4QzUWRnJKGQ6QJEsUXUWV",
  "membershipVersion": "free",
  "totalCredits": 2800,
  "freeCredits": 2500,
  "refreshCredits": 0
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

**失败响应一览：**

| HTTP 状态码 | `code` 字段 | 含义 | 处理建议 |
|-------------|-------------|------|----------|
| 400 | — | `email` 或 `password` 缺失 | 检查请求 Body |
| 409 | `EMAIL_EXISTS` | 邮箱已存在 | 跳过，不需要重试 |
| 409 | `INVITE_CODE_EXISTS` | 新账号的 `inviteCode` 与已有记录重复 | 检查 `inviteCode` 是否正确 |
| 409 | `DUPLICATE` | 其他唯一键冲突 | 检查数据 |
| 500 | — | 服务器内部错误 | 可重试，若持续失败则记录日志 |

**邮箱已存在响应示例（HTTP 409）：**

```json
{
  "success": false,
  "error": "邮箱 stevenpetersen1175@outlook.com 已存在，跳过注册",
  "code": "EMAIL_EXISTS"
}
```

**插件示例代码：**

```javascript
async function reportSuccess(accountData, inviterAccountId) {
  const res = await fetch('http://localhost:3900/api/callback/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...accountData,
      inviterAccountId,   // next-invite-code 返回的 id
    }),
  });

  const result = await res.json();

  if (result.success) {
    console.log('✅ 账号已上报:', result.email);
  } else if (result.code === 'EMAIL_EXISTS') {
    console.log('⚠️ 邮箱已存在，跳过（正常情况）');
  } else {
    console.error('❌ 上报失败:', result.error);
  }

  return result;
}
```

---

## 完整插件集成代码

将以下代码集成到你的插件中，替换现有的注册逻辑：

```javascript
const SYSTEM_API = 'http://localhost:3900';

// ── 接口 1：获取邀请码（自动标记为「邀请中」）──
async function getInviteCode() {
  const res = await fetch(`${SYSTEM_API}/api/callback/next-invite-code`);
  const data = await res.json();
  if (!data.inviteCode) {
    console.log('❌ 暂无可用邀请码');
    return null;
  }
  return { inviterAccountId: data.id, inviteCode: data.inviteCode };
}

// ── 接口 2：获取手机号（自动标记为「使用中」）──
async function getPhone() {
  const res = await fetch(`${SYSTEM_API}/api/callback/get-phone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!data.success) return null;
  return { phoneId: data.id, phone: data.phone, smsUrl: data.smsUrl };
}

// ── 接口 3：注册失败时归还邀请码 ──
async function resetInviteCode(inviterAccountId) {
  await fetch(`${SYSTEM_API}/api/callback/reset-invite-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: inviterAccountId }),
  });
  console.log('🔄 邀请码已归还');
}

// ── 接口 4：标记手机号已使用 ──
async function markPhoneUsed(phoneId) {
  await fetch(`${SYSTEM_API}/api/callback/mark-phone-used`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: phoneId }),
  });
}

// ── 接口 5：注册成功后上报账号数据 ──
async function reportSuccess(accountData, inviterAccountId) {
  const res = await fetch(`${SYSTEM_API}/api/callback/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...accountData, inviterAccountId }),
  });
  return await res.json();
}

// ============================================================
// 主流程（在你现有的注册逻辑中替换/插入以下调用）
// ============================================================
async function autoRegister() {
  // ── Step 1：获取邀请码 ──
  const inviteInfo = await getInviteCode();
  if (!inviteInfo) return;  // 无可用邀请码，停止
  const { inviterAccountId, inviteCode } = inviteInfo;

  // ── Step 2：获取手机号 ──
  const phoneInfo = await getPhone();
  if (!phoneInfo) {
    await resetInviteCode(inviterAccountId);  // 归还邀请码
    return;  // 无可用手机号，停止
  }
  const { phoneId, phone, smsUrl } = phoneInfo;

  try {
    // ── Step 3：执行注册（你现有的注册逻辑）──
    // 将 inviteCode 填入注册表单的邀请码输入框
    // 将 phone 填入手机号输入框
    // 通过 smsUrl 轮询获取短信验证码
    const accountData = await yourExistingRegisterFunction(inviteCode, phone, smsUrl);

    // ── Step 4：获取到验证码后，标记手机号已使用 ──
    await markPhoneUsed(phoneId);

    // ── Step 5：注册成功，上报账号数据 ──
    const result = await reportSuccess(accountData, inviterAccountId);
    if (result.success) {
      console.log('✅ 注册并上报成功:', result.email);
    }

  } catch (err) {
    // ── 注册失败：归还邀请码 ──
    await resetInviteCode(inviterAccountId);
    console.error('❌ 注册失败，邀请码已归还:', err.message);
  }
}
```

---

## 接口速查表

| 步骤 | 方法 | 路径 | 调用时机 | 关键返回值 |
|------|------|------|----------|-----------|
| 1 | `GET` | `/api/callback/next-invite-code` | 注册开始前 | `id`（保存为 inviterAccountId）、`inviteCode` |
| 2 | `POST` | `/api/callback/get-phone` | 进入手机号输入页面时 | `id`（保存为 phoneId）、`phone`、`smsUrl` |
| 失败 | `POST` | `/api/callback/reset-invite-code` | 任意步骤失败时 | — |
| 4 | `POST` | `/api/callback/mark-phone-used` | 收到短信验证码后 | — |
| 5 | `POST` | `/api/callback/register` | 注册完全成功后 | `success`、`email` |
| — | `GET` | `/api/callback/health` | 检查服务是否正常 | `status: "ok"` |

---

## 错误处理规范

插件在调用接口时，建议按照以下规范处理错误，确保资源不泄漏：

**邀请码状态机：** 邀请码有三种状态——`未使用 → 邀请中 → 已使用`。`next-invite-code` 调用后进入「邀请中」，注册失败时通过 `reset-invite-code` 退回「未使用」，注册成功后通过 `register` 的 `inviterAccountId` 自动进入「已使用」。

**手机号状态机：** 手机号有三种状态——`未使用 → 使用中 → 已使用`。`get-phone` 调用后进入「使用中」，收到验证码后通过 `mark-phone-used` 进入「已使用」。手机号没有归还接口，若注册失败导致手机号卡在「使用中」，可在管理系统后台手动重置。

**网络超时建议：** 所有接口建议设置 10 秒超时。若超时，对于 `register` 接口可重试一次（因为有邮箱唯一性检查，重复调用不会产生重复数据）；对于 `next-invite-code` 和 `get-phone`，超时后若不确定是否已成功，建议调用 `reset-invite-code` 归还邀请码后重新开始。

---

*文档由账号管理系统自动生成，如有疑问请联系管理员。*
