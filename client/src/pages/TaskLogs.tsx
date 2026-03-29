import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

type LogStatus = "pending" | "running" | "success" | "failed" | "skipped";

const statusConfig: Record<LogStatus, { label: string; class: string; icon: React.ElementType }> = {
  pending: { label: "等待中", class: "border-blue-500/30 text-blue-400 bg-blue-500/10", icon: Clock },
  running: { label: "執行中", class: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10", icon: Loader2 },
  success: { label: "成功", class: "border-green-500/30 text-green-400 bg-green-500/10", icon: CheckCircle2 },
  failed: { label: "失敗", class: "border-red-500/30 text-red-400 bg-red-500/10", icon: XCircle },
  skipped: { label: "跳過", class: "border-gray-500/30 text-gray-400 bg-gray-500/10", icon: Clock },
};

export default function TaskLogs() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading, refetch } = trpc.taskLogs.list.useQuery(
    {
      status: statusFilter !== "all" ? (statusFilter as LogStatus) : undefined,
      page,
      pageSize,
    },
    { refetchInterval: 10000 }
  );

  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">執行日誌</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {data?.total ?? 0} 條記錄
          </p>
        </div>
        <div className="flex gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
          >
            <SelectTrigger className="w-32 bg-muted/50 border-border/50 text-foreground h-9">
              <SelectValue placeholder="狀態篩選" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failed">失敗</SelectItem>
              <SelectItem value="running">執行中</SelectItem>
              <SelectItem value="pending">等待中</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />刷新
          </Button>
        </div>
      </div>

      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : data?.items?.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">暫無執行日誌</p>
              <p className="text-xs mt-1">啟動自動化任務後，日誌將在此顯示</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {data?.items?.map((log) => {
                const sc = statusConfig[log.status as LogStatus] ?? statusConfig.pending;
                const StatusIcon = sc.icon;
                return (
                  <div key={log.id} className="p-4 hover:bg-muted/10 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <StatusIcon
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            log.status === "success" ? "text-green-400" :
                            log.status === "failed" ? "text-red-400" :
                            log.status === "running" ? "text-yellow-400 animate-spin" :
                            "text-muted-foreground"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={`text-xs ${sc.class}`}>
                              {sc.label}
                            </Badge>
                            {log.usedInviteCode && (
                              <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                                {log.usedInviteCode}
                              </code>
                            )}
                            {log.adspowerBrowserId && (
                              <span className="text-xs text-muted-foreground font-mono">
                                Browser: {log.adspowerBrowserId}
                              </span>
                            )}
                          </div>
                          {log.errorMessage && (
                            <p className="text-xs text-red-400 mt-1.5 font-mono bg-red-500/5 px-2 py-1 rounded">
                              {log.errorMessage}
                            </p>
                          )}
                          <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                            {log.durationMs && (
                              <span>耗時：{(log.durationMs / 1000).toFixed(1)}s</span>
                            )}
                            {log.startedAt && (
                              <span>{new Date(log.startedAt).toLocaleString("zh-TW")}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                第 {page} / {totalPages} 頁
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-7 w-7 p-0">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-7 w-7 p-0">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
