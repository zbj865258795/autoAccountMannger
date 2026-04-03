import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  XCircle,
  AlertTriangle,
} from "lucide-react";

type LogStatus = "pending" | "running" | "success" | "failed" | "skipped";
type StepLevel = "info" | "success" | "warning" | "error";

const statusConfig: Record<LogStatus, { label: string; class: string; icon: React.ElementType }> = {
  pending: { label: "等待中", class: "border-blue-500/30 text-blue-400 bg-blue-500/10", icon: Clock },
  running: { label: "执行中", class: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10", icon: Loader2 },
  success: { label: "成功", class: "border-green-500/30 text-green-400 bg-green-500/10", icon: CheckCircle2 },
  failed: { label: "失败", class: "border-red-500/30 text-red-400 bg-red-500/10", icon: XCircle },
  skipped: { label: "跳过", class: "border-gray-500/30 text-gray-400 bg-gray-500/10", icon: Clock },
};

const stepLevelConfig: Record<StepLevel, { icon: React.ElementType; iconClass: string; textClass: string }> = {
  info:    { icon: Info,          iconClass: "text-blue-400",   textClass: "text-slate-200" },
  success: { icon: CheckCircle2,  iconClass: "text-green-400",  textClass: "text-green-300" },
  warning: { icon: AlertTriangle, iconClass: "text-yellow-400", textClass: "text-yellow-300" },
  error:   { icon: XCircle,       iconClass: "text-red-400",    textClass: "text-red-300" },
};

// ── 步骤日志展开面板 ──────────────────────────────────────────────────────────

function StepLogsPanel({ taskLogId, isRunning }: { taskLogId: number; isRunning: boolean }) {
  const { data, isLoading } = trpc.taskLogs.steps.useQuery(
    { taskLogId },
    {
      // 任务执行中每 3 秒刷新一次，完成后停止轮询
      refetchInterval: isRunning ? 3000 : false,
    }
  );

  if (isLoading) {
    return (
      <div className="px-4 pb-3 space-y-1.5">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="px-4 pb-3 text-xs text-muted-foreground italic">
        暂无步骤日志
      </div>
    );
  }

  return (
    <div className="px-4 pb-3">
      <div className="bg-zinc-950 rounded-md border border-zinc-700 overflow-hidden">
        <div className="px-3 py-1.5 border-b border-zinc-700 flex items-center justify-between bg-zinc-900">
          <span className="text-xs font-medium text-zinc-400">步骤日志</span>
          <span className="text-xs text-zinc-500">{data.length} 条</span>
        </div>
        <div className="max-h-72 overflow-y-auto font-mono text-xs">
          {data.map((step) => {
            const lvl = (step.level ?? "info") as StepLevel;
            const cfg = stepLevelConfig[lvl] ?? stepLevelConfig.info;
            const StepIcon = cfg.icon;
            const ts = step.createdAt
              ? new Date(step.createdAt).toTimeString().slice(0, 8)
              : "";
            return (
              <div
                key={step.id}
                className="flex items-start gap-2 px-3 py-1 hover:bg-white/5 transition-colors"
              >
                <StepIcon className={`w-3 h-3 mt-0.5 shrink-0 ${cfg.iconClass}`} />
                <span className="text-zinc-500 shrink-0">{ts}</span>
                <span className="text-xs text-zinc-500 shrink-0">
                  [{step.source ?? "Automation"}]
                </span>
                <span className={`flex-1 break-all ${cfg.textClass}`}>{step.message}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function TaskLogs() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
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

  function toggleExpand(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">执行日志</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {data?.total ?? 0} 条记录，点击任意行可展开步骤详情
          </p>
        </div>
        <div className="flex gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
          >
            <SelectTrigger className="w-32 bg-muted/50 border-border/50 text-foreground h-9">
              <SelectValue placeholder="状态筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="running">执行中</SelectItem>
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
              <p className="text-sm font-medium">暂无执行日志</p>
              <p className="text-xs mt-1">启动自动化任务后，日志将在此显示</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {data?.items?.map((log) => {
                const sc = statusConfig[log.status as LogStatus] ?? statusConfig.pending;
                const StatusIcon = sc.icon;
                const isExpanded = expandedId === log.id;
                const isRunning = log.status === "running" || log.status === "pending";

                return (
                  <div key={log.id} className="hover:bg-muted/10 transition-colors">
                    {/* 主行：点击展开/收起 */}
                    <div
                      className="p-4 cursor-pointer select-none"
                      onClick={() => toggleExpand(log.id)}
                    >
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
                                <span>耗时：{(log.durationMs / 1000).toFixed(1)}s</span>
                              )}
                              {log.startedAt && (
                                <span>{new Date(log.startedAt).toLocaleString("zh-CN")}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* 展开/收起箭头 */}
                        <div className="shrink-0 text-muted-foreground mt-0.5">
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4" />
                            : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>

                    {/* 步骤日志展开面板 */}
                    {isExpanded && (
                      <StepLogsPanel taskLogId={log.id} isRunning={isRunning} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                第 {page} / {totalPages} 页
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
