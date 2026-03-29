import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, Upload, FileJson, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// 解析插件输出的完整 JSON 格式
function parsePluginJson(raw: string): any[] {
  try {
    const parsed = JSON.parse(raw);
    // 支持数组格式
    if (Array.isArray(parsed)) return parsed;
    // 支持单个对象格式
    if (typeof parsed === "object") return [parsed];
    return [];
  } catch {
    return [];
  }
}

function transformPluginData(item: any, invitedByCode?: string) {
  const userInfo = item.user_info || {};
  const creditsInfo = item.credits_info || {};
  const invitationInfo = item.invitation_info || {};
  const inviteCodes = invitationInfo.invitationCodes || [];
  const primaryCode = inviteCodes[0];

  return {
    email: item.email || userInfo.email,
    password: item.password,
    phone: item.phone,
    token: item.token,
    clientId: item.clientId,
    userId: userInfo.userId,
    displayname: userInfo.displayname || userInfo.nickname,
    membershipVersion: userInfo.membershipVersion || creditsInfo.membershipVersion || "free",
    totalCredits: creditsInfo.totalCredits || 0,
    freeCredits: creditsInfo.freeCredits || 0,
    refreshCredits: creditsInfo.refreshCredits || 0,
    inviteCode: primaryCode?.inviteCode,
    inviteCodeId: primaryCode?.id,
    invitedByCode: invitedByCode || item.invitedByCode,
    registeredAt: userInfo.registeredAt,
  };
}

export default function ImportAccounts() {
  const [, setLocation] = useLocation();
  const [jsonText, setJsonText] = useState("");
  const [invitedByCode, setInvitedByCode] = useState("");
  const [preview, setPreview] = useState<any[]>([]);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState<{ successCount: number; failCount: number; errors: string[] } | null>(null);

  const bulkImport = trpc.accounts.bulkImport.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.successCount > 0) {
        toast.success(`成功导入 ${data.successCount} 个账号`);
      }
      if (data.failCount > 0) {
        toast.error(`${data.failCount} 个账号导入失败`);
      }
    },
    onError: (err) => {
      toast.error(`导入失败：${err.message}`);
    },
  });

  const handleParse = () => {
    setParseError("");
    setResult(null);
    const items = parsePluginJson(jsonText);
    if (items.length === 0) {
      setParseError("无法解析 JSON，请确认格式正确");
      setPreview([]);
      return;
    }
    const transformed = items.map((item) => transformPluginData(item, invitedByCode || undefined));
    setPreview(transformed);
  };

  const handleImport = () => {
    if (preview.length === 0) return;
    bulkImport.mutate({ accounts: preview });
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">导入账号</h1>
        <p className="text-sm text-muted-foreground mt-1">
          粘贴插件输出的 JSON 数据，支持单个或数组格式
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 输入区域 */}
        <div className="space-y-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <FileJson className="w-4 h-4 text-primary" />
                粘贴 JSON 数据
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">邀请者邀请码（可选）</Label>
                <Input
                  placeholder="输入此批账号的邀请者邀请码..."
                  value={invitedByCode}
                  onChange={(e) => setInvitedByCode(e.target.value)}
                  className="bg-muted/50 border-border/50 text-foreground placeholder:text-muted-foreground font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  如果这批账号是用同一个邀请码注册的，在此填写邀请者的邀请码
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">JSON 数据</Label>
                <Textarea
                  placeholder={`粘贴插件输出的 JSON，例如：\n{\n  "email": "xxx@outlook.com",\n  "password": "...",\n  "token": "...",\n  "user_info": {...},\n  "credits_info": {...},\n  "invitation_info": {...}\n}`}
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  className="font-mono text-xs bg-muted/50 border-border/50 text-foreground placeholder:text-muted-foreground min-h-[280px] resize-none"
                />
              </div>

              {parseError && (
                <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{parseError}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleParse}
                  variant="secondary"
                  className="flex-1"
                  disabled={!jsonText.trim()}
                >
                  解析预览
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={preview.length === 0 || bulkImport.isPending}
                  className="flex-1"
                >
                  {bulkImport.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />导入中...</>
                  ) : (
                    <><Upload className="w-4 h-4 mr-2" />确认导入 {preview.length > 0 ? `(${preview.length})` : ""}</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 导入结果 */}
          {result && (
            <Card className={`border-border/50 ${result.failCount === 0 ? "bg-green-500/5" : "bg-yellow-500/5"}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  {result.failCount === 0 ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-yellow-400" />
                  )}
                  <span className="text-sm font-medium text-foreground">导入完成</span>
                </div>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-400">成功：{result.successCount}</span>
                  {result.failCount > 0 && <span className="text-red-400">失败：{result.failCount}</span>}
                </div>
                {result.errors.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-400 font-mono">{err}</p>
                    ))}
                  </div>
                )}
                {result.successCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLocation("/accounts")}
                    className="mt-2"
                  >
                    查看账号列表
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 预览区域 */}
        <div className="space-y-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                解析预览
                {preview.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {preview.length} 个账号
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {preview.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileJson className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">粘贴 JSON 后点击「解析预览」</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {preview.map((item, i) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground truncate">{item.email}</span>
                        <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400 bg-blue-500/10 shrink-0 ml-2">
                          #{i + 1}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                        <span>邀请码：<code className="text-primary font-mono">{item.inviteCode || "—"}</code></span>
                        <span>积分：{item.totalCredits?.toLocaleString()}</span>
                        <span>会员：{item.membershipVersion}</span>
                        {item.phone && <span>手机：{item.phone}</span>}
                        {item.clientId && <span className="col-span-2">ClientID：<code className="text-muted-foreground font-mono text-xs">{item.clientId}</code></span>}
                        {item.invitedByCode && (
                          <span>邀请者：<code className="text-yellow-400 font-mono">{item.invitedByCode}</code></span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 格式说明 */}
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">支持的 JSON 格式</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs text-muted-foreground font-mono bg-muted/30 p-3 rounded-lg overflow-x-auto">
{`// 插件完整输出格式（推荐）
{
  "email": "xxx@outlook.com",
  "password": "aB3#kLm9",
  "phone": "+17699335914",
  "token": "eyJ...",
  "clientId": "c4QzUWRnJKGQ6...",
  "user_info": {
    "userId": "...",
    "displayname": "...",
    "membershipVersion": "free",
    "registeredAt": "2026-03-26T..."
  },
  "credits_info": {
    "totalCredits": 2800,
    "freeCredits": 2500,
    "refreshCredits": 300
  },
  "invitation_info": {
    "invitationCodes": [{
      "id": "...",
      "inviteCode": "DNTT7V7WJAS6ABI"
    }]
  }
}

// 也支持数组格式 [{ ... }, { ... }]
// 也支持简化格式（直接字段）：
// { email, password, phone, token, clientId,
//   membershipVersion, totalCredits, freeCredits,
//   refreshCredits, inviteCode, invitedByCode }`}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
