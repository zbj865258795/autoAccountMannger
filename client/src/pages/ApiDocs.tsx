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
      <Section title="完整自动化流程（5步）" icon={GitBranch}>
        <div className="space-y-3">
          {[
            { step: 1, title: "获取邀请码（自动标记为「邀请中」）", desc: "调用 GET /api/callback/next-invite-code，返回 id 和 inviteCode，同时自动将该邀请码标记为「邀请中」，防止并发重复分配。保存返回的 id，后续步骤需要用到。", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
            { step: 2, title: "获取手机号（自动标记为「使用中」）", desc: "调用 POST /api/callback/get-phone，返回 id、phone、smsUrl，同时自动标记为「使用中」。保存返回的 id。", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
            { step: 3, title: "执行注册流程", desc: "使用获取到的邀请码和手机号完成注册。如果注册失败，调用 POST /api/callback/reset-invite-code（传入 id）将邀请码重置为「未使用」。", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
            { step: 4, title: "获取到验证码后标记手机号已用", desc: "调用 POST /api/callback/mark-phone-used，Body 传入 { id }（来自 get-phone 返回的 id）。", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
            { step: 5, title: "注册成功后上报账号数据", desc: "调用 POST /api/callback/register，传入完整账号数据和 inviterAccountId（来自 next-invite-code 返回的 id）。系统自动将邀请人邀请码标记为「已使用」，新账号邀请码状态为「未使用」，循环继续。", color: "bg-green-500/15 text-green-400 border-green-500/30" },
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
        <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
            <span className="font-medium text-green-400">设计原则</span>
          </div>
          每个接口只需传一个 <code className="text-primary">id</code>，不需要传邀请码字符串。获取即标记，失败即重置，成功即完成——状态机由系统自动维护。
        </div>
      </Section>

      {/* ── 接口1：获取邀请码 ── */}
      <Section title="接口 1：获取邀请码（自动标记为邀请中）" icon={Zap}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-blue-500/30 text-blue-400 bg-blue-500/10">GET</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/next-invite-code</code>
          </div>
          <p className="text-xs text-muted-foreground">
            返回下一个「未使用」邀请码，<strong>同时自动将其标记为「邀请中」</strong>，防止并发重复分配。
            请保存返回的 <code className="text-primary">id</code>，后续 <code className="text-primary">reset-invite-code</code> 和 <code className="text-primary">register</code> 接口都需要用到。
          </p>

          <p className="text-xs font-semibold text-foreground">请求参数</p>
          <p className="text-xs text-muted-foreground">无需传入任何参数（GET 请求）。</p>

          <p className="text-xs font-semibold text-foreground">返回值（成功）</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "始终为 true" },
            { name: "id", type: "number", desc: "邀请码所属账号的数据库 ID，后续接口需要用到此值" },
            { name: "inviteCode", type: "string", desc: "邀请码字符串，用于注册流程" },
            { name: "sourceEmail", type: "string", desc: "该邀请码所属账号的邮箱（仅供参考）" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值（无可用邀请码）</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true" },
            { name: "inviteCode", type: "null", desc: "null，表示暂无可用邀请码" },
            { name: "message", type: "string", desc: "\"暂无可用邀请码\"" },
          ]} />

          <p className="text-xs font-semibold text-foreground">示例</p>
          <CodeBlock code={`// 有可用邀请码（邀请码已自动标记为「邀请中」）
{ "success": true, "id": 30001, "inviteCode": "DNTT7V7WJAS6ABI", "sourceEmail": "user@example.com" }

// 无可用邀请码
{ "success": true, "inviteCode": null, "message": "暂无可用邀请码" }`} />

          <CodeBlock code={`// 插件代码示例
async function getInviteCode() {
  const res = await fetch('${BASE_URL}/api/callback/next-invite-code');
  const data = await res.json();
  if (!data.inviteCode) {
    console.log('❌ 暂无可用邀请码');
    return null;
  }
  // 保存 id 和 inviteCode，后续步骤需要
  return { id: data.id, inviteCode: data.inviteCode };
}`} />
        </div>
      </Section>

      {/* ── 接口2：重置邀请码 ── */}
      <Section title="接口 2：重置邀请码（注册失败时调用）" icon={Zap}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-red-500/30 text-red-400 bg-red-500/10">POST</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/reset-invite-code</code>
          </div>
          <p className="text-xs text-muted-foreground">
            注册流程中途失败时调用，将邀请码状态从「邀请中」重置回「未使用」，使其可被下次重新分配。
            传入 <code className="text-primary">next-invite-code</code> 返回的 <code className="text-primary">id</code>。
          </p>

          <p className="text-xs font-semibold text-foreground">请求 Body</p>
          <ParamTable rows={[
            { name: "id", type: "number", required: true, desc: "邀请码账号 ID，来自 next-invite-code 返回的 id 字段" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=重置成功" },
            { name: "message", type: "string", desc: "\"邀请码已重置为未使用\"" },
          ]} />

          <p className="text-xs font-semibold text-foreground">示例</p>
          <CodeBlock code={`// 请求
{ "id": 30001 }

// 响应
{ "success": true, "message": "邀请码已重置为未使用" }`} />

          <CodeBlock code={`// 注册失败时调用
async function resetInviteCode(inviterAccountId) {
  await fetch('${BASE_URL}/api/callback/reset-invite-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: inviterAccountId })
  });
  console.log('邀请码已重置，可重新分配');
}`} />
        </div>
      </Section>

      {/* ── 接口3：获取手机号 ── */}
      <Section title="接口 3：获取手机号（自动标记为使用中）" icon={Phone}>
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

          <p className="text-xs font-semibold text-foreground">返回值（成功）</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=获取成功" },
            { name: "id", type: "number", desc: "手机号记录 ID，后续调用 mark-phone-used 时需要传入此值" },
            { name: "phone", type: "string", desc: "手机号（含国家代码，如 +12232263007）" },
            { name: "smsUrl", type: "string", desc: "接码平台 URL，用于获取短信验证码" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值（无可用手机号）</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "false" },
            { name: "message", type: "string", desc: "\"暂无可用手机号\"" },
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
  const data = await res.json();
  if (!data.success) { console.log('❌ 暂无可用手机号'); return null; }
  // 保存 id，后续 mark-phone-used 需要
  return { id: data.id, phone: data.phone, smsUrl: data.smsUrl };
}`} />
        </div>
      </Section>

      {/* ── 接口4：标记手机号已使用 ── */}
      <Section title="接口 4：标记手机号已使用" icon={Phone}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs border-green-500/30 text-green-400 bg-green-500/10">POST</Badge>
            <code className="text-xs text-primary font-mono">/api/callback/mark-phone-used</code>
          </div>
          <p className="text-xs text-muted-foreground">
            获取到短信验证码后调用，将手机号状态从「使用中」改为「已使用」。
            传入 <code className="text-primary">get-phone</code> 返回的 <code className="text-primary">id</code>。
          </p>

          <p className="text-xs font-semibold text-foreground">请求 Body</p>
          <ParamTable rows={[
            { name: "id", type: "number", required: true, desc: "手机号记录 ID，来自 get-phone 接口返回的 id 字段" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=标记成功" },
            { name: "message", type: "string", desc: "\"手机号已标记为已使用\"" },
          ]} />

          <p className="text-xs font-semibold text-foreground">示例</p>
          <CodeBlock code={`// 请求
{ "id": 5 }

// 响应
{ "success": true, "message": "手机号已标记为已使用" }`} />
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
            注册成功后调用，将新账号完整数据保存到系统。
            传入 <code className="text-primary">inviterAccountId</code>（来自 <code className="text-primary">next-invite-code</code> 返回的 <code className="text-primary">id</code>），
            系统自动将该邀请人的邀请码标记为「已使用」，新账号邀请码状态自动设为「未使用」（可被下一轮使用）。
          </p>

          <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs space-y-1">
            <p className="font-medium text-blue-400">⚠️ 关键字段说明</p>
            <p className="text-muted-foreground">
              <code className="text-primary">inviterAccountId</code>：<strong>邀请人的账号 ID</strong>（来自 next-invite-code 返回的 <code className="text-primary">id</code>），系统通过此 ID 直接更新邀请码状态。
              <br />
              <code className="text-primary">inviteCode</code>：<strong>新账号自己的邀请码</strong>（注册后平台分配给该账号的），每个账号唯一，不可重复。
            </p>
          </div>

          <p className="text-xs font-semibold text-foreground">请求 Body</p>
          <ParamTable rows={[
            { name: "email", type: "string", required: true, desc: "账号邮箱，全局唯一，重复则返回 409 错误（EMAIL_EXISTS）" },
            { name: "password", type: "string", required: true, desc: "账号密码" },
            { name: "inviterAccountId", type: "number", required: true, desc: "邀请人账号 ID，来自 next-invite-code 返回的 id，系统通过此 ID 将邀请码标记为「已使用」" },
            { name: "inviteCode", type: "string", required: false, desc: "新账号自己的邀请码（平台分配，每个账号唯一）" },
            { name: "phone", type: "string", required: false, desc: "注册使用的手机号（含国家代码，如 +17699335914）" },
            { name: "token", type: "string", required: false, desc: "平台返回的 JWT token（用于后续 API 调用）" },
            { name: "clientId", type: "string", required: false, desc: "平台分配的 clientId" },
            { name: "membershipVersion", type: "string", required: false, desc: "会员版本，如 free / pro，默认 free" },
            { name: "totalCredits", type: "number", required: false, desc: "账号总积分，默认 0" },
            { name: "freeCredits", type: "number", required: false, desc: "免费积分，默认 0" },
            { name: "referrerCode", type: "string", required: false, desc: "兼容旧格式：邀请人的邀请码字符串（新接口推荐用 inviterAccountId 替代）" },
          ]} />

          <p className="text-xs font-semibold text-foreground">返回值（成功）</p>
          <ReturnTable rows={[
            { name: "success", type: "boolean", desc: "true=注册成功" },
            { name: "message", type: "string", desc: "\"账号注册成功\"" },
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
          <CodeBlock code={`// 请求 Body（推荐格式）
{
  "email": "stevenpetersen1175@outlook.com",
  "password": "aB3#kLm9xPq2$Yw",
  "inviterAccountId": 30001,              // next-invite-code 返回的 id
  "inviteCode": "DNTT7V7WJAS6ABI",        // 新账号自己的邀请码（唯一）
  "phone": "+17699335914",
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "clientId": "c4QzUWRnJKGQ6QJEsUXUWV",
  "membershipVersion": "free",
  "totalCredits": 2800,
  "freeCredits": 2500
}

// 成功响应
{ "success": true, "message": "账号注册成功", "email": "stevenpetersen1175@outlook.com", "inviteCode": "DNTT7V7WJAS6ABI" }

// 邮箱已存在（409）
{ "success": false, "error": "邮箱 xxx@outlook.com 已存在，跳过注册", "code": "EMAIL_EXISTS" }`} />

          <CodeBlock code={`async function reportSuccess(accountData, inviterAccountId) {
  const res = await fetch('${BASE_URL}/api/callback/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...accountData,
      inviterAccountId,   // next-invite-code 返回的 id
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

      {/* 完整插件集成示例 */}
      <Section title="完整插件集成示例" icon={Code2}>
        <div className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs font-medium text-yellow-400">在你的插件中添加以下代码，替换现有的注册逻辑</span>
          </div>
        </div>
        <CodeBlock code={`const SYSTEM_API = '${BASE_URL}';

// ── 接口1：获取邀请码（自动标记为邀请中）──
async function getInviteCode() {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/next-invite-code\`);
  const data = await res.json();
  if (!data.inviteCode) return null;
  return { id: data.id, inviteCode: data.inviteCode };  // 保存 id！
}

// ── 接口2：注册失败时重置邀请码 ──
async function resetInviteCode(id) {
  await fetch(\`\${SYSTEM_API}/api/callback/reset-invite-code\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
}

// ── 接口3：获取手机号（自动标记为使用中）──
async function getPhone() {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/get-phone\`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  if (!data.success) return null;
  return { id: data.id, phone: data.phone, smsUrl: data.smsUrl };  // 保存 id！
}

// ── 接口4：标记手机号已使用 ──
async function markPhoneUsed(phoneId) {
  await fetch(\`\${SYSTEM_API}/api/callback/mark-phone-used\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: phoneId })
  });
}

// ── 接口5：上报账号数据 ──
async function reportSuccess(accountData, inviterAccountId) {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/register\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...accountData, inviterAccountId })
  });
  return await res.json();
}

// ============================================================
// 主流程（在你现有的注册逻辑中替换/插入）
// ============================================================
async function autoRegister() {
  // Step 1: 获取邀请码（自动标记为邀请中）
  const inviteInfo = await getInviteCode();
  if (!inviteInfo) { console.log('❌ 无可用邀请码'); return; }
  const { id: inviterAccountId, inviteCode } = inviteInfo;

  // Step 2: 获取手机号
  const phoneInfo = await getPhone();
  if (!phoneInfo) {
    await resetInviteCode(inviterAccountId);  // 归还邀请码
    console.log('❌ 无可用手机号');
    return;
  }

  try {
    // Step 3: 执行你现有的注册逻辑
    const accountData = await yourExistingRegisterFunction(inviteCode, phoneInfo.phone, phoneInfo.smsUrl);

    // Step 4: 获取到验证码后标记手机号已使用
    await markPhoneUsed(phoneInfo.id);

    // Step 5: 注册成功后上报（传入 inviterAccountId）
    const result = await reportSuccess(accountData, inviterAccountId);
    console.log('✅ 上报结果:', result);

  } catch (err) {
    // 注册失败：重置邀请码，使其可被下次重新分配
    await resetInviteCode(inviterAccountId);
    console.error('❌ 注册失败，邀请码已重置:', err);
  }
}`} />
      </Section>

      {/* API 端点汇总 */}
      <Section title="API 端点汇总" icon={Webhook}>
        <div className="space-y-2">
          {[
            { method: "GET",  path: "/api/callback/next-invite-code", desc: "获取邀请码（自动标记为「邀请中」），返回 id 和 inviteCode" },
            { method: "POST", path: "/api/callback/reset-invite-code", desc: "注册失败时重置邀请码为「未使用」，Body: { id }" },
            { method: "POST", path: "/api/callback/get-phone", desc: "获取手机号（自动标记为「使用中」），返回 id、phone、smsUrl" },
            { method: "POST", path: "/api/callback/mark-phone-used", desc: "标记手机号为「已使用」，Body: { id }" },
            { method: "POST", path: "/api/callback/register", desc: "上报账号数据，Body: { email*, password*, inviterAccountId*, inviteCode, phone, token, ... }" },
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
