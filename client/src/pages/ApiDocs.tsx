import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, AlertCircle, Code2, Webhook, GitBranch, Zap } from "lucide-react";
import { toast } from "sonner";

function CodeBlock({ code, language = "javascript" }: { code: string; language?: string }) {
  const copy = () => {
    navigator.clipboard.writeText(code);
    toast.success("已複製代碼");
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
          將你的 Chrome 插件與本系統對接所需的完整說明
        </p>
      </div>

      {/* 流程概覽 */}
      <Section title="完整自動化流程" icon={GitBranch}>
        <div className="space-y-3">
          {[
            { step: 1, title: "系統掃描", desc: "本系統定時掃描數據庫中「未使用」狀態的邀請碼", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
            { step: 2, title: "啟動瀏覽器", desc: "系統調用 AdsPower API 創建指紋瀏覽器，URL 帶上邀請碼參數", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
            { step: 3, title: "插件讀取邀請碼", desc: "插件啟動後，調用本系統 API 獲取當前需要使用的邀請碼", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
            { step: 4, title: "插件執行注冊", desc: "插件使用邀請碼自動完成注冊流程（你現有的邏輯）", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
            { step: 5, title: "插件回調上報", desc: "注冊成功後，插件調用回調接口將賬號數據上報到本系統", color: "bg-green-500/15 text-green-400 border-green-500/30" },
            { step: 6, title: "系統更新狀態", desc: "系統保存新賬號，更新邀請碼狀態為「已使用」，循環繼續", color: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
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
            <span className="text-sm font-medium text-yellow-400">需要在插件中添加以下 3 個功能</span>
          </div>
          {[
            "注冊開始前：調用 API 獲取邀請碼（或從 URL 參數讀取）",
            "注冊過程中：調用 API 通知系統「邀請碼使用中」",
            "注冊成功後：調用 API 上報完整賬號數據",
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
              {item}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">方案一：從 URL 參數讀取邀請碼（推薦）</p>
          <p className="text-xs text-muted-foreground">AdsPower 啟動瀏覽器時，系統會在 URL 中帶上邀請碼，插件直接讀取即可：</p>
          <CodeBlock code={`// 在插件 background.js 或 content.js 中
// AdsPower 啟動時 URL 格式：https://target-site.com?invite_code=KZUPX5EF3K7I

function getInviteCodeFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get('invite_code') || 
         url.searchParams.get('inviteCode') ||
         url.searchParams.get('code');
}

const inviteCode = getInviteCodeFromUrl();
console.log('使用邀請碼:', inviteCode);`} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">方案二：主動從系統 API 獲取邀請碼</p>
          <CodeBlock code={`// 插件啟動時，從系統獲取下一個可用邀請碼
async function getNextInviteCode() {
  const response = await fetch('${BASE_URL}/api/callback/next-invite-code');
  const data = await response.json();
  
  if (data.success && data.inviteCode) {
    console.log('獲取到邀請碼:', data.inviteCode);
    console.log('邀請者 Email:', data.sourceEmail);
    return data.inviteCode;
  }
  
  console.log('暫無可用邀請碼');
  return null;
}`} />
        </div>
      </Section>

      {/* 注冊成功回調 */}
      <Section title="注冊成功後的回調代碼" icon={Webhook}>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            注冊成功後，在插件中調用以下代碼將賬號數據上報到本系統。支持兩種格式：
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            格式一：直接使用插件輸出的完整 JSON（最簡單）
          </p>
          <CodeBlock code={`// 注冊成功後，直接把插件的完整輸出 JSON 發送過來
// 系統會自動解析所有字段

async function reportRegistrationSuccess(fullAccountData, invitedByCode) {
  try {
    const response = await fetch('${BASE_URL}/api/callback/register-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...fullAccountData,      // 插件原始輸出的完整 JSON
        invitedByCode: invitedByCode  // 使用的邀請碼（關鍵！）
      })
    });
    
    const result = await response.json();
    if (result.success) {
      console.log('✅ 賬號已上報到系統:', result.email);
      console.log('新邀請碼:', result.inviteCode);
    }
  } catch (error) {
    console.error('❌ 上報失敗:', error);
  }
}

// 使用示例
// 假設你的插件已有 accountData（就是你現在保存的那個 JSON）
// 以及 usedInviteCode（本次注冊使用的邀請碼）
reportRegistrationSuccess(accountData, usedInviteCode);`} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            格式二：精簡格式（只發送必要字段）
          </p>
          <CodeBlock code={`async function reportRegistrationSuccess(data) {
  const response = await fetch('${BASE_URL}/api/callback/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: data.email,                    // 必填
      password: data.password,              // 必填
      phone: data.phone,                    // 手機號（如有）
      token: data.token,                    // JWT token
      clientId: data.clientId,              // 平台 clientId
      inviteCode: data.inviteCode,          // 新賬號的邀請碼
      invitedByCode: data.usedInviteCode,   // 本次使用的邀請碼（關鍵！）
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
  console.log('上報結果:', result);
}`} />
        </div>
      </Section>

      {/* 通知邀請碼使用中 */}
      <Section title="可選：注冊開始時通知系統" icon={Zap}>
        <p className="text-xs text-muted-foreground">
          如果你想讓系統實時知道哪個邀請碼正在被使用（避免重複使用），可以在注冊流程開始時調用：
        </p>
        <CodeBlock code={`// 注冊流程開始時調用（可選，建議添加）
async function notifyInviteCodeInUse(inviteCode) {
  await fetch('${BASE_URL}/api/callback/invite-used', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode })
  });
  // 此調用會將邀請碼狀態改為「邀請中」
}`} />
      </Section>

      {/* 完整插件集成示例 */}
      <Section title="完整插件集成示例（推薦的插件修改方案）" icon={Code2}>
        <CodeBlock code={`// ============================================================
// 在你的 Chrome 插件 background.js 或 content.js 中添加
// ============================================================

const SYSTEM_API = '${BASE_URL}';

// 1. 獲取邀請碼（插件啟動時調用）
async function getInviteCode() {
  // 優先從 URL 參數讀取（AdsPower 啟動時帶入）
  const urlCode = new URL(window.location.href).searchParams.get('invite_code');
  if (urlCode) return urlCode;
  
  // 備選：從系統 API 獲取
  const res = await fetch(\`\${SYSTEM_API}/api/callback/next-invite-code\`);
  const data = await res.json();
  return data.inviteCode || null;
}

// 2. 通知系統邀請碼使用中（注冊開始時）
async function markInviteCodeInProgress(inviteCode) {
  await fetch(\`\${SYSTEM_API}/api/callback/invite-used\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode })
  });
}

// 3. 注冊成功後上報（最重要！）
async function reportSuccess(fullAccountData, usedInviteCode) {
  const res = await fetch(\`\${SYSTEM_API}/api/callback/register-full\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fullAccountData, invitedByCode: usedInviteCode })
  });
  return await res.json();
}

// ============================================================
// 在你現有的注冊流程中插入以下調用：
// ============================================================

async function autoRegister() {
  // Step 1: 獲取邀請碼
  const inviteCode = await getInviteCode();
  if (!inviteCode) {
    console.log('無可用邀請碼，停止');
    return;
  }
  
  // Step 2: 通知系統開始使用
  await markInviteCodeInProgress(inviteCode);
  
  // Step 3: 執行你現有的注冊邏輯（保持不變）
  const accountData = await yourExistingRegisterFunction(inviteCode);
  
  // Step 4: 注冊成功後上報
  if (accountData) {
    const result = await reportSuccess(accountData, inviteCode);
    console.log('✅ 已上報到系統:', result);
  }
}`} />
      </Section>

      {/* API 端點列表 */}
      <Section title="API 端點列表" icon={Webhook}>
        <div className="space-y-3">
          {[
            { method: "GET", path: "/api/callback/next-invite-code", desc: "獲取下一個可用邀請碼", badge: "GET" },
            { method: "POST", path: "/api/callback/invite-used", desc: "通知邀請碼正在使用中（狀態→邀請中）", badge: "POST" },
            { method: "POST", path: "/api/callback/register-full", desc: "上報完整賬號數據（插件原始 JSON 格式）", badge: "POST" },
            { method: "POST", path: "/api/callback/register", desc: "上報精簡賬號數據（自定義字段）", badge: "POST" },
            { method: "GET", path: "/api/callback/health", desc: "健康檢查", badge: "GET" },
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
                onClick={() => { navigator.clipboard.writeText(`${BASE_URL}${api.path}`); toast.success("已複製 URL"); }}
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
