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

const BASE_URL = `${window.location.origin}`;

export default function ApiDocs() {
  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">API 集成 & 插件修改指南</h1>
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

      {/* 手机号接口 */}
      <Section title="手机号接口" icon={Phone}>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">1. 获取手机号（注册开始前调用）</p>
          <p className="text-xs text-muted-foreground">
            调用后返回一条「未使用」的手机号，并自动将其标记为「使用中」。返回 id（用于后续标记已使用）、手机号和接码 URL。
          </p>
          <CodeBlock code={`// POST /api/callback/get-phone
// 返回格式：{ success: true, id: 1, phone: "+12232263007", smsUrl: "https://sms-555.com/xxx" }

async function getPhone() {
  const res = await fetch('${BASE_URL}/api/callback/get-phone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const result = await res.json();
  
  if (result.success) {
    console.log('手机号 ID:', result.id);   // 保存此 id，后续标记已使用时需要
    console.log('手机号:', result.phone);
    console.log('接码URL:', result.smsUrl);
    return { id: result.id, phone: result.phone, smsUrl: result.smsUrl };
  }
  
  console.log('暂无可用手机号');
  return null;
}`} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">2. 标记手机号已使用（获取到验证码后调用）</p>
          <p className="text-xs text-muted-foreground">
            插件通过接码 URL 获取到验证码后，调用此接口将手机号标记为「已使用」。只需传入 get-phone 返回的 id 即可。
          </p>
          <CodeBlock code={`// POST /api/callback/mark-phone-used
// Body: { id: 1 }  ← 使用 get-phone 返回的 id

async function markPhoneUsed(phoneId) {
  const res = await fetch('${BASE_URL}/api/callback/mark-phone-used', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: phoneId })
  });
  const result = await res.json();
  console.log('手机号已标记为已使用:', result.success);
}`} />
        </div>
      </Section>

      {/* 注册成功回调 */}
      <Section title="注册成功后的回调代码" icon={Webhook}>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            注册成功后，将以下格式的数据 POST 到系统。字段名与你插件输出的 JSON 完全一致：
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            上报账号数据（POST /api/callback/register）
          </p>
          <CodeBlock code={`// 注册成功后调用，字段与你插件输出的 JSON 完全一致
async function reportSuccess(accountData, usedInviteCode) {
  const res = await fetch('${BASE_URL}/api/callback/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: accountData.email,                  // 必填
      password: accountData.password,            // 必填
      phone: accountData.phone,                  // 手机号
      token: accountData.token,                  // JWT token
      clientId: accountData.clientId,            // 平台 clientId
      membershipVersion: accountData.membershipVersion,
      totalCredits: accountData.totalCredits,
      freeCredits: accountData.freeCredits,
      inviteCode: accountData.inviteCode,        // 新账号自己的邀请码
      referrerCode: usedInviteCode,              // 本次使用的邀请码（关键！）
    })
  });
  
  const result = await res.json();
  if (result.success) {
    console.log('✅ 账号已上报到系统:', result.email);
  } else {
    console.error('❌ 上报失败:', result.error);
  }
}`} />
        </div>
      </Section>

      {/* 完整插件集成示例 */}
      <Section title="完整插件集成示例（推荐的插件修改方案）" icon={Code2}>
        <CodeBlock code={`// ============================================================
// 在你的 Chrome 插件 background.js 或 content.js 中添加
// ============================================================

const SYSTEM_API = '${BASE_URL}';

// 1. 获取手机号（注册开始前调用）
async function getPhone() {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/get-phone\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  if (!data.success) return null;
  return { id: data.id, phone: data.phone, smsUrl: data.smsUrl };
}

// 2. 获取邀请码（优先从 URL 参数读取，备选从系统获取）
async function getInviteCode() {
  const urlCode = new URL(window.location.href).searchParams.get('invite_code');
  if (urlCode) return urlCode;
  
  const res = await fetch(\`\${SYSTEM_API}/api/callback/next-invite-code\`);
  const data = await res.json();
  return data.inviteCode || null;
}

// 3. 标记手机号已使用（获取到验证码后调用）
async function markPhoneUsed(phoneId) {
  await fetch(\`\${SYSTEM_API}/api/callback/mark-phone-used\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: phoneId })  // 传入 get-phone 返回的 id
  });
}

// 4. 注册成功后上报（最重要！）
async function reportSuccess(accountData, usedInviteCode) {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/register\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...accountData,
      referrerCode: usedInviteCode  // 本次使用的邀请码
    })
  });
  return await res.json();
}

// ============================================================
// 在你现有的注册流程中插入以下调用：
// ============================================================

async function autoRegister() {
  // Step 1: 获取手机号
  const phoneInfo = await getPhone();
  if (!phoneInfo) {
    console.log('❌ 无可用手机号，停止');
    return;
  }
  console.log('📱 使用手机号:', phoneInfo.phone);
  
  // Step 2: 获取邀请码
  const inviteCode = await getInviteCode();
  if (!inviteCode) {
    console.log('❌ 无可用邀请码，停止');
    return;
  }
  console.log('🎫 使用邀请码:', inviteCode);
  
  // Step 3: 执行你现有的注册逻辑（保持不变）
  // 注册过程中使用 phoneInfo.phone 填写手机号
  // 使用 phoneInfo.smsUrl 获取验证码
  const accountData = await yourExistingRegisterFunction(inviteCode, phoneInfo);
  
  // Step 4: 获取到验证码后，标记手机号已使用
  await markPhoneUsed(phoneInfo.id);  // 传入 get-phone 返回的 id
  
  // Step 5: 注册成功后上报
  if (accountData) {
    const result = await reportSuccess(accountData, inviteCode);
    console.log('✅ 已上报到系统:', result);
  }
}`} />
      </Section>

      {/* 通知邀请码使用中 */}
      <Section title="可选：注册开始时通知系统邀请码使用中" icon={Zap}>
        <p className="text-xs text-muted-foreground">
          如果你想让系统实时知道哪个邀请码正在被使用（避免并发时重复分配），可以在注册流程开始时调用：
        </p>
        <CodeBlock code={`// 注册流程开始时调用（可选，建议添加）
async function notifyInviteCodeInUse(inviteCode) {
  await fetch('${BASE_URL}/api/callback/invite-used', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode })
  });
  // 此调用会将邀请码状态改为「邀请中」
}`} />
      </Section>

      {/* API 端点列表 */}
      <Section title="API 端点列表" icon={Webhook}>
        <div className="space-y-3">
          {[
            { method: "POST", path: "/api/callback/get-phone", desc: "获取一条未使用手机号（自动标记为「使用中」），返回原始格式 手机号|接码URL" },
            { method: "POST", path: "/api/callback/mark-phone-used", desc: "标记手机号为「已使用」，Body: { id }（使用 get-phone 返回的 id）" },
            { method: "GET",  path: "/api/callback/next-invite-code", desc: "获取下一个可用邀请码（不改变状态，仅查询）" },
            { method: "POST", path: "/api/callback/invite-used", desc: "通知邀请码正在使用中（状态→邀请中），Body: { inviteCode }" },
            { method: "POST", path: "/api/callback/register", desc: "上报账号数据，Body: { email, password, phone, token, clientId, inviteCode, referrerCode, ... }" },
            { method: "GET",  path: "/api/callback/health", desc: "健康检查，确认系统正常运行" },
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
