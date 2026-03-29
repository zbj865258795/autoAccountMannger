import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, CheckCircle2, AlertCircle, Code2, Webhook, GitBranch, Zap, Phone } from "lucide-react";
import { toast } from "sonner";

function CodeBlock({ code }: { code: string }) {
  const copy = () => {
    navigator.clipboard.writeText(code);
    toast.success("已复制代码");
  };
  return (
    <div className="relative group">
      <pre className="bg-muted/40 border border-border/50 rounded-lg p-4 overflow-x-auto text-xs font-mono text-foreground leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-muted/80 border border-border/50 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
      >
        <Copy className="w-3 h-3" />
      </button>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function ParamTable({ rows }: { rows: { name: string; type: string; required: boolean; desc: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/30 border-b border-border/40">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-36">字段名</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">类型</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">必填</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-transparent" : "bg-muted/10"}>
              <td className="px-3 py-2 font-mono text-primary">{r.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.type}</td>
              <td className="px-3 py-2">
                {r.required
                  ? <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-400 bg-red-500/10">必填</Badge>
                  : <Badge variant="outline" className="text-[10px] border-border/40 text-muted-foreground">可选</Badge>}
              </td>
              <td className="px-3 py-2 text-foreground/80">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReturnTable({ rows }: { rows: { name: string; type: string; desc: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/30 border-b border-border/40">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-36">字段名</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">类型</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-transparent" : "bg-muted/10"}>
              <td className="px-3 py-2 font-mono text-primary">{r.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.type}</td>
              <td className="px-3 py-2 text-foreground/80">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BASE_URL = `${window.location.origin}`;

export default function ApiDocs() {
  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">API 集成 &amp; 插件修改指南</h1>
        <p className="text-sm text-muted-foreground mt-1">
          将你的 Chrome 插件与本系统对接所需的完整说明（本地运行地址：<code className="text-primary">{BASE_URL}</code>）
        </p>
      </div>

      {/* 流程概览 */}
      <Section title="完整自动化流程" icon={GitBranch}>
        <div className="space-y-3">
          {[
            { step: 1, title: "系统扫描邀请码", desc: "本系统定时扫描数据库中「未使用」状态的邀请码，有可用邀请码时调用 AdsPower 创建指纹浏览器", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
            { step: 2, title: "插件获取手机号", desc: "插件启动后调用 /api/callback/get-phone 获取一条「未使用」手机号，系统自动将其标记为「使用中」", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
            { step: 3, title: "插件执行注册", desc: "插件使用获取到的邀请码和手机号完成注册流程（你现有的逻辑）", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
            { step: 4, title: "插件标记手机号已用", desc: "获取到验证码后，调用 /api/callback/mark-phone-used 将手机号标记为「已使用」", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
            { step: 5, title: "插件上报账号数据", desc: "注册成功后，调用 /api/callback/register 将完整账号数据上报到本系统", color: "bg-green-500/15 text-green-400 border-green-500/30" },
            { step: 6, title: "系统更新状态", desc: "系统保存新账号，更新邀请码状态为「已使用」，新账号的邀请码状态为「未使用」，循环继续", color: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
          ].map((item) => (
            <div key={item.step} className="flex items-start gap-3">
              <Badge variant="outline" className={`text-xs shrink-0 mt-0.5 ${item.color}`}>
                Step {item.step}
              </Badge>
              <div>
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 插件需要做的修改 */}
      <Section title="插件需要做的修改（核心）" icon={Code2}>
        <div className="space-y-1 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium text-yellow-400">需要在插件中添加以下 4 个 API 调用</span>
          </div>
          {[
            "注册开始前：调用 /api/callback/get-phone 获取手机号（自动标记为「使用中」）",
            "注册开始前：调用 /api/callback/next-invite-code 获取邀请码（或从 URL 参数读取）",
            "获取到验证码后：调用 /api/callback/mark-phone-used 标记手机号为「已使用」",
            "注册成功后：调用 /api/callback/register 上报完整账号数据",
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </Section>

      {/* ── 接口1：获取手机号 ── */}
      <Section title="接口 1：获取手机号" icon={Phone}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-green-500/30 text-green-400 bg-green-500/10">POST</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/get-phone</code>
          </div>
          <p className="text-xs text-muted-foreground">
            返回一条「未使用」的手机号，并自动将其标记为「使用中」，防止并发重复分配。无需传入任何参数。
          </p>

          <p className="text-xs font-semibold text-foreground">请求 Body</p>
          <p className="text-xs text-muted-foreground">无需传入任何参数（空 Body 或不传均可）。</p>

          <p className="text-xs font-semibold text-foreground">返回值</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=获取成功，false=暂无可用手机号" },
            { name: "id", type: "number", desc: "手机号记录 ID，后续调用 mark-phone-used 时需要传入此值" },
            { name: "phone", type: "string", desc: "手机号（含国家代码，如 +12232263007）" },
            { name: "smsUrl", type: "string", desc: "接码平台 URL，用于获取短信验证码" },
            { name: "message", type: "string", desc: "仅 success=false 时返回，说明原因（如「暂无可用手机号」）" },
          ]} />

          <p className="text-xs font-semibold text-foreground">示例</p>
          <CodeBlock code={`// 成功响应
{ "success": true, "id": 5, "phone": "+12232263007", "smsUrl": "https://sms-555.com/xxx" }

// 无可用手机号
{ "success": false, "message": "暂无可用手机号" }`} />

          <CodeBlock code={`async function getPhone() {
  const res = await fetch('${BASE_URL}/api/callback/get-phone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const result = await res.json();
  if (result.success) {
    // 保存 id，后续标记已使用时需要
    return { id: result.id, phone: result.phone, smsUrl: result.smsUrl };
  }
  console.log('暂无可用手机号');
  return null;
}`} />
        </div>
      </Section>

      {/* ── 接口2：标记手机号已使用 ── */}
      <Section title="接口 2：标记手机号已使用" icon={Phone}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-green-500/30 text-green-400 bg-green-500/10">POST</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/mark-phone-used</code>
          </div>
          <p className="text-xs text-muted-foreground">
            插件通过接码 URL 获取到短信验证码后调用，将手机号状态从「使用中」改为「已使用」。
          </p>

          <p className="text-xs font-semibold text-foreground">请求 Body</p>
          <ParamTable rows={[
            { name: "id", type: "number", required: true, desc: "手机号记录 ID，来自 get-phone 接口返回的 id 字段" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=标记成功" },
            { name: "message", type: "string", desc: "操作结果描述（如「手机号已标记为已使用」）" },
          ]} />

          <p className="text-xs font-semibold text-foreground">示例</p>
          <CodeBlock code={`// 请求
{ "id": 5 }

// 成功响应
{ "success": true, "message": "手机号已标记为已使用" }`} />

          <CodeBlock code={`async function markPhoneUsed(phoneId) {
  const res = await fetch('${BASE_URL}/api/callback/mark-phone-used', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: phoneId })   // 传入 get-phone 返回的 id
  });
  const result = await res.json();
  console.log('标记结果:', result.success);
}`} />
        </div>
      </Section>

      {/* ── 接口3：获取邀请码 ── */}
      <Section title="接口 3：获取下一个可用邀请码" icon={Zap}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-blue-500/30 text-blue-400 bg-blue-500/10">GET</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/next-invite-code</code>
          </div>
          <p className="text-xs text-muted-foreground">
            查询数据库中下一个「未使用」状态的邀请码。此接口只查询，不改变状态。
          </p>

          <p className="text-xs font-semibold text-foreground">请求参数</p>
          <p className="text-xs text-muted-foreground">无需传入任何参数（GET 请求）。</p>

          <p className="text-xs font-semibold text-foreground">返回值</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "始终为 true" },
            { name: "inviteCode", type: "string | null", desc: "下一个可用邀请码，无可用时为 null" },
            { name: "sourceEmail", type: "string", desc: "该邀请码所属账号的邮箱" },
            { name: "sourceAccountId", type: "number", desc: "该邀请码所属账号的 ID" },
            { name: "message", type: "string", desc: "仅 inviteCode=null 时返回，说明原因" },
          ]} />

          <p className="text-xs font-semibold text-foreground">示例</p>
          <CodeBlock code={`// 有可用邀请码
{ "success": true, "inviteCode": "DNTT7V7WJAS6ABI", "sourceEmail": "user@example.com", "sourceAccountId": 1 }

// 无可用邀请码
{ "success": true, "inviteCode": null, "message": "No unused invite codes available" }`} />
        </div>
      </Section>

      {/* ── 接口4：通知邀请码使用中 ── */}
      <Section title="接口 4：通知邀请码使用中（可选）" icon={Zap}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-green-500/30 text-green-400 bg-green-500/10">POST</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/invite-used</code>
          </div>
          <p className="text-xs text-muted-foreground">
            注册流程开始时调用，将邀请码状态改为「邀请中」，避免并发时同一邀请码被重复分配。
          </p>

          <p className="text-xs font-semibold text-foreground">请求 Body</p>
          <ParamTable rows={[
            { name: "inviteCode", type: "string", required: true, desc: "正在使用的邀请码" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=操作成功" },
          ]} />

          <p className="text-xs font-semibold text-foreground">示例</p>
          <CodeBlock code={`// 请求
{ "inviteCode": "DNTT7V7WJAS6ABI" }

// 响应
{ "success": true }`} />
        </div>
      </Section>

      {/* ── 接口5：上报账号数据（核心）── */}
      <Section title="接口 5：上报账号数据（核心）" icon={Webhook}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-green-500/30 text-green-400 bg-green-500/10">POST</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/register</code>
          </div>
          <p className="text-xs text-muted-foreground">
            注册成功后调用，将新账号完整数据保存到系统。系统会自动关联邀请关系、更新邀请码状态、统计任务数据。
          </p>

          <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300 space-y-1">
            <p className="font-medium">⚠️ 注意：inviteCode 字段说明</p>
            <p className="text-muted-foreground">
              <code className="text-primary">inviteCode</code> 是<strong>新账号自己的邀请码</strong>（注册后平台分配给该账号的），每个账号唯一，不可重复。
              <br />
              <code className="text-primary">referrerCode</code> 才是<strong>本次注册使用的邀请码</strong>（即上一个账号的 inviteCode），用于建立邀请关系链。
            </p>
          </div>

          <p className="text-xs font-semibold text-foreground">请求 Body</p>
          <ParamTable rows={[
            { name: "email", type: "string", required: true, desc: "账号邮箱，全局唯一，重复则返回 409 错误" },
            { name: "password", type: "string", required: true, desc: "账号密码（明文存储，请确保安全）" },
            { name: "phone", type: "string", required: false, desc: "注册使用的手机号（含国家代码，如 +17699335914）" },
            { name: "token", type: "string", required: false, desc: "平台返回的 JWT token（用于后续 API 调用）" },
            { name: "clientId", type: "string", required: false, desc: "平台分配的 clientId" },
            { name: "membershipVersion", type: "string", required: false, desc: "会员版本，如 free / pro，默认 free" },
            { name: "totalCredits", type: "number", required: false, desc: "账号总积分，默认 0" },
            { name: "freeCredits", type: "number", required: false, desc: "免费积分，默认 0" },
            { name: "inviteCode", type: "string", required: false, desc: "新账号自己的邀请码（平台分配，每个账号唯一）" },
            { name: "referrerCode", type: "string", required: false, desc: "本次注册使用的邀请码（即上一个账号的 inviteCode），用于建立邀请链" },
            { name: "registeredAt", type: "string", required: false, desc: "注册时间（ISO 8601 格式），不传则默认当前时间" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值（成功）</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=注册成功" },
            { name: "message", type: "string", desc: "固定值 \"Account registered successfully\"" },
            { name: "email", type: "string", desc: "已保存的账号邮箱" },
            { name: "inviteCode", type: "string | null", desc: "已保存的账号邀请码" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值（失败）</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "false" },
            { name: "error", type: "string", desc: "错误描述" },
            { name: "code", type: "string", desc: "错误代码：EMAIL_EXISTS=邮箱已存在，INVITE_CODE_EXISTS=邀请码重复，DUPLICATE=其他重复冲突" },
          ]} />

          <p className="text-xs font-semibold text-foreground">示例</p>
          <CodeBlock code={`// 请求 Body
{
  "email": "stevenpetersen1175@outlook.com",
  "password": "aB3#kLm9xPq2$Yw",
  "phone": "+17699335914",
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "clientId": "c4QzUWRnJKGQ6QJEsUXUWV",
  "membershipVersion": "free",
  "totalCredits": 2800,
  "freeCredits": 2500,
  "inviteCode": "DNTT7V7WJAS6ABI",       // 新账号自己的邀请码（唯一）
  "referrerCode": "DNTT7V7WJAS6ABI12"    // 本次使用的邀请码（上一个账号的）
}

// 成功响应
{ "success": true, "message": "Account registered successfully", "email": "stevenpetersen1175@outlook.com", "inviteCode": "DNTT7V7WJAS6ABI" }

// 邮箱已存在（409）
{ "success": false, "error": "邮箱已存在，跳过注册", "code": "EMAIL_EXISTS" }

// inviteCode 重复（409）
{ "success": false, "error": "该邀请码已被其他账号使用，请检查 inviteCode 是否重复", "code": "INVITE_CODE_EXISTS" }`} />

          <CodeBlock code={`async function reportSuccess(accountData, usedInviteCode) {
  const res = await fetch('${BASE_URL}/api/callback/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: accountData.email,
      password: accountData.password,
      phone: accountData.phone,
      token: accountData.token,
      clientId: accountData.clientId,
      membershipVersion: accountData.membershipVersion,
      totalCredits: accountData.totalCredits,
      freeCredits: accountData.freeCredits,
      inviteCode: accountData.inviteCode,   // 新账号自己的邀请码
      referrerCode: usedInviteCode,         // 本次使用的邀请码
    })
  });
  const result = await res.json();
  if (result.success) {
    console.log('✅ 账号已上报:', result.email);
  } else if (result.code === 'EMAIL_EXISTS') {
    console.log('⚠️ 邮箱已存在，跳过');
  } else {
    console.error('❌ 上报失败:', result.error);
  }
  return result;
}`} />
        </div>
      </Section>

      {/* ── 接口6：健康检查 ── */}
      <Section title="接口 6：健康检查" icon={Zap}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-blue-500/30 text-blue-400 bg-blue-500/10">GET</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/health</code>
          </div>
          <p className="text-xs text-muted-foreground">确认系统正常运行。</p>

          <p className="text-xs font-semibold text-foreground">返回值</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=系统正常" },
            { name: "status", type: "string", desc: "固定值 \"ok\"" },
            { name: "timestamp", type: "string", desc: "当前服务器时间（ISO 8601 格式）" },
          ]} />

          <CodeBlock code={`{ "success": true, "status": "ok", "timestamp": "2026-03-29T12:00:00.000Z" }`} />
        </div>
      </Section>

      {/* 完整插件集成示例 */}
      <Section title="完整插件集成示例" icon={Code2}>
        <CodeBlock code={`// ============================================================
// 在你的 Chrome 插件 background.js 或 content.js 中添加
// ============================================================

const SYSTEM_API = '${BASE_URL}';

// 接口1：获取手机号
async function getPhone() {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/get-phone\`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  if (!data.success) return null;
  return { id: data.id, phone: data.phone, smsUrl: data.smsUrl };
}

// 接口2：标记手机号已使用
async function markPhoneUsed(phoneId) {
  await fetch(\`\${SYSTEM_API}/api/callback/mark-phone-used\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: phoneId })
  });
}

// 接口3：获取邀请码
async function getInviteCode() {
  const urlCode = new URL(window.location.href).searchParams.get('invite_code');
  if (urlCode) return urlCode;
  const res = await fetch(\`\${SYSTEM_API}/api/callback/next-invite-code\`);
  const data = await res.json();
  return data.inviteCode || null;
}

// 接口5：上报账号数据
async function reportSuccess(accountData, usedInviteCode) {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/register\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...accountData, referrerCode: usedInviteCode })
  });
  return await res.json();
}

// ============================================================
// 在你现有的注册流程中插入以下调用：
// ============================================================
async function autoRegister() {
  // Step 1: 获取手机号
  const phoneInfo = await getPhone();
  if (!phoneInfo) { console.log('❌ 无可用手机号'); return; }

  // Step 2: 获取邀请码
  const inviteCode = await getInviteCode();
  if (!inviteCode) { console.log('❌ 无可用邀请码'); return; }

  // Step 3: 执行你现有的注册逻辑（使用 phoneInfo.phone 和 phoneInfo.smsUrl）
  const accountData = await yourExistingRegisterFunction(inviteCode, phoneInfo);

  // Step 4: 获取到验证码后，标记手机号已使用
  await markPhoneUsed(phoneInfo.id);

  // Step 5: 注册成功后上报
  if (accountData) {
    const result = await reportSuccess(accountData, inviteCode);
    console.log('上报结果:', result);
  }
}`} />
      </Section>

      {/* API 端点汇总 */}
      <Section title="API 端点汇总" icon={Webhook}>
        <div className="space-y-2">
          {[
            { method: "POST", path: "/api/callback/get-phone", desc: "获取一条未使用手机号（自动标记为「使用中」）" },
            { method: "POST", path: "/api/callback/mark-phone-used", desc: "标记手机号为「已使用」，Body: { id }" },
            { method: "GET",  path: "/api/callback/next-invite-code", desc: "获取下一个可用邀请码（只查询，不改变状态）" },
            { method: "POST", path: "/api/callback/invite-used", desc: "通知邀请码正在使用中（状态→邀请中），Body: { inviteCode }" },
            { method: "POST", path: "/api/callback/register", desc: "上报账号数据，Body: { email*, password*, phone, token, clientId, inviteCode, referrerCode, ... }" },
            { method: "GET",  path: "/api/callback/health", desc: "健康检查" },
          ].map((api) => (
            <div key={api.path} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border border-border/30">
              <Badge
                variant="outline"
                className={`text-xs shrink-0 font-mono ${
                  api.method === "GET"
                    ? "border-blue-500/30 text-blue-400 bg-blue-500/10"
                    : "border-green-500/30 text-green-400 bg-green-500/10"
                }`}
              >
                {api.method}
              </Badge>
              <div className="flex-1 min-w-0">
                <code className="text-xs font-mono text-primary">{BASE_URL}{api.path}</code>
                <p className="text-xs text-muted-foreground mt-0.5">{api.desc}</p>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(`${BASE_URL}${api.path}`); toast.success("已复制 URL"); }}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
