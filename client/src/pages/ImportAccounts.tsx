import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, Upload, FileJson, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/**
 * 只支持一种格式（插件直接输出的扁平 JSON）：
 * {
 *   email, password, phone, token, clientId,
 *   membershipVersion, totalCredits, freeCredits,
 *   inviteCode,       ← 自己的邀请码
 *   referrerCode      ← 邀请人的邀请码（可选）
 * }
 * 支持单个对象或数组
 */
function parseAndTransform(raw: string): { items: any[]; error: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], error: "JSON 格式错误，请检查括号和引号是否完整" };
  }

  const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
  if (arr.length === 0) return { items: [], error: "未解析到任何账号数据" };

  const items = arr.map((item: any) => ({
    email: item.email,
    password: item.password,
    phone: item.phone || null,
    token: item.token || null,
    clientId: item.clientId || null,
    membershipVersion: item.membershipVersion || "free",
    totalCredits: item.totalCredits ?? 0,
    freeCredits: item.freeCredits ?? 0,
    refreshCredits: item.refreshCredits ?? 0,
    inviteCode: item.inviteCode || null,
    invitedByCode: item.referrerCode || item.invitedByCode || null,
    referrerCode: item.referrerCode || item.invitedByCode || null,
  }));

  const invalid = items.filter((i) => !i.email || !i.password);
  if (invalid.length > 0) {
    return { items: [], error: `有 ${invalid.length} 条数据缺少 email 或 password 字段` };
  }

  return { items, error: "" };
}

export default function ImportAccounts() {
  const [, setLocation] = useLocation();
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<any[]>([]);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState<{ successCount: number; failCount: number; errors: string[] } | null>(null);

  const bulkImport = trpc.accounts.bulkImport.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.successCount > 0) toast.success(`成功导入 ${data.successCount} 个账号`);
      if (data.failCount > 0) toast.error(`${data.failCount} 个账号导入失败`);
    },
    onError: (err) => toast.error(`导入失败：${err.message}`),
  });

  const handleParse = () => {
    setParseError("");
    setResult(null);
    if (!jsonText.trim()) return;
    const { items, error } = parseAndTransform(jsonText);
    if (error) { setParseError(error); setPreview([]); return; }
    setPreview(items);
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
          粘贴插件注册成功后输出的 JSON 数据，支持单个或数组格式
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
                <Label className="text-xs text-muted-foreground">JSON 数据</Label>
                <Textarea
                  placeholder={`粘贴插件输出的 JSON，例如：\n{\n  "email": "JuanParsons4398@outlook.com",\n  "password": "zus5BDWfs!#b8%*",\n  "phone": "+15056282762",\n  "token": "eyJ...",\n  "clientId": "PHIRey9hFG5EkZagZFh912",\n  "membershipVersion": "free",\n  "totalCredits": 2800,\n  "freeCredits": 2500,\n  "inviteCode": "RFZ73T7OTTBICT4",\n  "referrerCode": "XXXXXXXX"\n}`}
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  className="font-mono text-xs bg-muted/50 border-border/50 text-foreground placeholder:text-muted-foreground min-h-[320px] resize-none"
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
                    <><Upload className="w-4 h-4 mr-2" />确认导入{preview.length > 0 ? ` (${preview.length})` : ""}</>
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
                  {result.failCount === 0
                    ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                    : <AlertCircle className="w-4 h-4 text-yellow-400" />}
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
                  <Button size="sm" variant="outline" onClick={() => setLocation("/accounts")} className="mt-2">
                    查看账号列表
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 预览 + 格式说明 */}
        <div className="space-y-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                解析预览
                {preview.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-xs">{preview.length} 个账号</Badge>
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
                        <span>密码：<code className="text-foreground font-mono">{item.password}</code></span>
                        {item.phone && <span>手机：{item.phone}</span>}
                        <span>邀请码：<code className="text-primary font-mono">{item.inviteCode || "—"}</code></span>
                        {item.referrerCode && (
                          <span>邀请人：<code className="text-yellow-400 font-mono">{item.referrerCode}</code></span>
                        )}
                        <span>会员：{item.membershipVersion}</span>
                        <span>积分：{item.totalCredits?.toLocaleString()}</span>
                        {item.clientId && (
                          <span className="col-span-2 truncate">ClientID：<code className="text-muted-foreground font-mono">{item.clientId}</code></span>
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
              <CardTitle className="text-xs font-medium text-muted-foreground">JSON 字段说明</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs text-muted-foreground font-mono bg-muted/30 p-3 rounded-lg overflow-x-auto leading-relaxed">
{`{
  "email":             必填，账号邮箱
  "password":          必填，登录密码
  "phone":             手机号（含国家码）
  "token":             登录 JWT token
  "clientId":          客户端 ID
  "membershipVersion": 会员版本（free/pro...）
  "totalCredits":      总积分
  "freeCredits":       免费积分
  "inviteCode":        自己的邀请码
  "referrerCode":      邀请人的邀请码（可选）
}

// 支持单个对象或数组 [{...}, {...}]`}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
