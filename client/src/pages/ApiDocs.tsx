import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, CheckCircle2, AlertCircle, Code2, Webhook, GitBranch, Zap } from "lucide-react";
import { toast } from "sonner";

function CodeBlock({ code, language = "javascript" }: { code: string; language?: string }) {
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
          将你的 Chrome 插件与本系统对接所需的完整说明
        </p>
      </div>

      {/* 流程概览 */}
      <Section title="完整自动化流程" icon={GitBranch}>
        <div className="space-y-3">
          {[
            { step: 1, title: "系统扫描", desc: "本系统定时扫描数据库中「未使用」状态的邀请码", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
            { step: 2, title: "启动浏览器", desc: "系统调用 AdsPower API 创建指纹浏览器，URL 带上邀请码参数", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
            { step: 3, title: "插件读取邀请码", desc: "插件启动后，调用本系统 API 获取当前需要使用的邀请码", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
            { step: 4, title: "插件执行注册", desc: "插件使用邀请码自动完成注册流程（你现有的逻辑）", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
            { step: 5, title: "插件回调上报", desc: "注册成功后，插件调用回调接口将账号数据上报到本系统", color: "bg-green-500/15 text-green-400 border-green-500/30" },
            { step: 6, title: "系统更新状态", desc: "系统保存新账号，更新邀请码状态为「已使用」，循环继续", color: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
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
            <span className="text-sm font-medium text-yellow-400">需要在插件中添加以下 3 个功能</span>
          </div>
          {[
            "注册开始前：调用 API 获取邀请码（或从 URL 参数读取）",
            "注册过程中：调用 API 通知系统「邀请码使用中」",
            "注册成功后：调用 API 上报完整账号数据",
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
              {item}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">方案一：从 URL 参数读取邀请码（推荐）</p>
          <p className="text-xs text-muted-foreground">AdsPower 启动浏览器时，系统会在 URL 中带上邀请码，插件直接读取即可：</p>
          <CodeBlock code={`// 在插件 background.js 或 content.js 中
// AdsPower 启动时 URL 格式：https://target-site.com?invite_code=KZUPX5EF3K7I

function getInviteCodeFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get('invite_code') || 
         url.searchParams.get('inviteCode') ||
         url.searchParams.get('code');
}

const inviteCode = getInviteCodeFromUrl();
console.log('使用邀请码:', inviteCode);`} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">方案二：主动从系统 API 获取邀请码</p>
          <CodeBlock code={`// 插件启动时，从系统获取下一个可用邀请码
async function getNextInviteCode() {
  const response = await fetch('${BASE_URL}/api/callback/next-invite-code');
  const data = await response.json();
  
  if (data.success && data.inviteCode) {
    console.log('获取到邀请码:', data.inviteCode);
    console.log('邀请者 Email:', data.sourceEmail);
    return data.inviteCode;
  }
  
  console.log('暂无可用邀请码');
  return null;
}`} />
        </div>
      </Section>

      {/* 注册成功回调 */}
      <Section title="注册成功后的回调代码" icon={Webhook}>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            注册成功后，在插件中调用以下代码将账号数据上报到本系统。支持两种格式：
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            格式一：直接使用插件输出的完整 JSON（最简单）
          </p>
          <CodeBlock code={`// 注册成功后，直接把插件的完整输出 JSON 发送过来
// 系统会自动解析所有字段

async function reportRegistrationSuccess(fullAccountData, invitedByCode) {
  try {
    const response = await fetch('${BASE_URL}/api/callback/register-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...fullAccountData,      // 插件原始输出的完整 JSON
        invitedByCode: invitedByCode  // 使用的邀请码（关键！）
      })
    });
    
    const result = await response.json();
    if (result.success) {
      console.log('✅ 账号已上报到系统:', result.email);
      console.log('新邀请码:', result.inviteCode);
    }
  } catch (error) {
    console.error('❌ 上报失败:', error);
  }
}

// 使用示例
// 假设你的插件已有 accountData（就是你现在保存的那个 JSON）
// 以及 usedInviteCode（本次注册使用的邀请码）
reportRegistrationSuccess(accountData, usedInviteCode);`} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            格式二：精简格式（只发送必要字段）
          </p>
          <CodeBlock code={`async function reportRegistrationSuccess(data) {
  const response = await fetch('${BASE_URL}/api/callback/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: data.email,                    // 必填
      password: data.password,              // 必填
      phone: data.phone,                    // 手机号（如有）
      token: data.token,                    // JWT token
      clientId: data.clientId,              // 平台 clientId
      inviteCode: data.inviteCode,          // 新账号的邀请码
      invitedByCode: data.usedInviteCode,   // 本次使用的邀请码（关键！）
      totalCredits: data.totalCredits,
      freeCredits: data.freeCredits,
      refreshCredits: data.refreshCredits,
      membershipVersion: data.membershipVersion,
      registeredAt: data.registeredAt,
      userId: data.userId,
      displayname: data.displayname,
    })
  });
  
  const result = await response.json();
  console.log('上报结果:', result);
}`} />
        </div>
      </Section>

      {/* 通知邀请码使用中 */}
      <Section title="可选：注册开始时通知系统" icon={Zap}>
        <p className="text-xs text-muted-foreground">
          如果你想让系统实时知道哪个邀请码正在被使用（避免重复使用），可以在注册流程开始时调用：
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

      {/* 完整插件集成示例 */}
      <Section title="完整插件集成示例（推荐的插件修改方案）" icon={Code2}>
        <CodeBlock code={`// ============================================================
// 在你的 Chrome 插件 background.js 或 content.js 中添加
// ============================================================

const SYSTEM_API = '${BASE_URL}';

// 1. 获取邀请码（插件启动时调用）
async function getInviteCode() {
  // 优先从 URL 参数读取（AdsPower 启动时带入）
  const urlCode = new URL(window.location.href).searchParams.get('invite_code');
  if (urlCode) return urlCode;
  
  // 备选：从系统 API 获取
  const res = await fetch(\`\${SYSTEM_API}/api/callback/next-invite-code\`);
  const data = await res.json();
  return data.inviteCode || null;
}

// 2. 通知系统邀请码使用中（注册开始时）
async function markInviteCodeInProgress(inviteCode) {
  await fetch(\`\${SYSTEM_API}/api/callback/invite-used\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode })
  });
}

// 3. 注册成功后上报（最重要！）
async function reportSuccess(fullAccountData, usedInviteCode) {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/register-full\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fullAccountData, invitedByCode: usedInviteCode })
  });
  return await res.json();
}

// ============================================================
// 在你现有的注册流程中插入以下调用：
// ============================================================

async function autoRegister() {
  // Step 1: 获取邀请码
  const inviteCode = await getInviteCode();
  if (!inviteCode) {
    console.log('无可用邀请码，停止');
    return;
  }
  
  // Step 2: 通知系统开始使用
  await markInviteCodeInProgress(inviteCode);
  
  // Step 3: 执行你现有的注册逻辑（保持不变）
  const accountData = await yourExistingRegisterFunction(inviteCode);
  
  // Step 4: 注册成功后上报
  if (accountData) {
    const result = await reportSuccess(accountData, inviteCode);
    console.log('✅ 已上报到系统:', result);
  }
}`} />
      </Section>

      {/* API 端点列表 */}
      <Section title="API 端点列表" icon={Webhook}>
        <div className="space-y-3">
          {[
            { method: "GET", path: "/api/callback/next-invite-code", desc: "获取下一个可用邀请码", badge: "GET" },
            { method: "POST", path: "/api/callback/invite-used", desc: "通知邀请码正在使用中（状态→邀请中）", badge: "POST" },
            { method: "POST", path: "/api/callback/register-full", desc: "上报完整账号数据（插件原始 JSON 格式）", badge: "POST" },
            { method: "POST", path: "/api/callback/register", desc: "上报精简账号数据（自定义字段）", badge: "POST" },
            { method: "GET", path: "/api/callback/health", desc: "健康检查", badge: "GET" },
          ].map((api) => (
            <div key={api.path} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border border-border/30">
              <Badge
                variant="outline"
                className={`text-xs shrink-0 font-mono ${
                  api.badge === "GET"
                    ? "border-blue-500/30 text-blue-400 bg-blue-500/10"
                    : "border-green-500/30 text-green-400 bg-green-500/10"
                }`}
              >
                {api.badge}
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
