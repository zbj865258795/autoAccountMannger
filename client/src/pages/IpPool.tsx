import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Globe, Loader2, RefreshCw, Search, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function IpPool() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const pageSize = 50;

  const { data, isLoading, refetch } = trpc.ipPool.list.useQuery(
    { search: search || undefined, page, pageSize },
    { refetchInterval: 15000 }
  );

  const { data: countData } = trpc.ipPool.count.useQuery(undefined, {
    refetchInterval: 15000,
  });

  const clearPool = trpc.ipPool.clear.useMutation({
    onSuccess: () => {
      toast.success("IP 池已清空");
      utils.ipPool.list.invalidate();
      utils.ipPool.count.invalidate();
      setConfirmClear(false);
    },
    onError: (err) => toast.error(`清空失败：${err.message}`),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">已用 IP 池</h1>
          <p className="text-sm text-muted-foreground mt-1">
            记录所有已使用过的出口 IP，防止重复 IP 注册账号
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-400 border-red-500/30 hover:bg-red-500/10"
            onClick={() => setConfirmClear(true)}
            disabled={!countData?.count}
          >
            <Trash2 className="w-4 h-4 mr-2" />清空 IP 池
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="bg-card border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Globe className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{countData?.count ?? 0}</p>
              <p className="text-xs text-muted-foreground">已记录 IP 总数</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <Shield className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{countData?.count ?? 0}</p>
              <p className="text-xs text-muted-foreground">已拦截重复 IP 注册次数（累计）</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 搜索 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索 IP 地址..."
          className="pl-9 bg-muted/50 border-border/50 text-foreground"
        />
      </div>

      {/* IP 列表 */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-foreground flex items-center justify-between">
            <span>IP 记录列表</span>
            {total > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                共 {total} 条，第 {page}/{totalPages} 页
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">
                {search ? "未找到匹配的 IP" : "IP 池为空"}
              </p>
              <p className="text-xs mt-1">
                {search ? "请尝试其他搜索词" : "注册成功后，出口 IP 将自动记录到此处"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30 hover:border-border/60 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Globe className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-mono text-foreground">{item.ip}</p>
                      {item.country && (
                        <p className="text-xs text-muted-foreground mt-0.5">{item.country}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className="text-xs border-green-500/30 text-green-400 bg-green-500/10"
                    >
                      已使用
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {item.usedAt ? new Date(item.usedAt).toLocaleString("zh-CN") : "-"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-border/30">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 清空确认弹窗 */}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent className="bg-card border-border/50 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空 IP 池</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              将删除所有 <strong className="text-foreground">{countData?.count ?? 0}</strong> 条已记录的 IP 地址。
              清空后，之前使用过的 IP 将不再被拦截，可能导致重复 IP 注册。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearPool.mutate()}
              className="bg-destructive hover:bg-destructive/90"
            >
              {clearPool.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
