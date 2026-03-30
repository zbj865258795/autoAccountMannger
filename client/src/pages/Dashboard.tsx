import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  GitBranch,
  Hourglass,
  Users,
  Phone,
} from "lucide-react";
import { useLocation } from "wouter";

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  sub,
  loading,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-24 mb-1" />
            ) : (
              <p className="text-2xl font-bold text-foreground">{value}</p>
            )}
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InviteStatusBar({ unused, inProgress, used }: { unused: number; inProgress: number; used: number }) {
  const total = unused + inProgress + used;
  if (total === 0) return <p className="text-sm text-muted-foreground">暂无邀请码数据</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
        {used > 0 && (
          <div className="bg-green-500 transition-all" style={{ width: `${(used / total) * 100}%` }} />
        )}
        {inProgress > 0 && (
          <div className="bg-yellow-500 transition-all" style={{ width: `${(inProgress / total) * 100}%` }} />
        )}
        {unused > 0 && (
          <div className="bg-blue-500 transition-all" style={{ width: `${(unused / total) * 100}%` }} />
        )}
      </div>
      <div className="flex gap-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          已使用 <strong className="text-foreground">{used}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
          邀请中 <strong className="text-foreground">{inProgress}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
          未使用 <strong className="text-foreground">{unused}</strong>
        </span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery(undefined, {
    refetchInterval: 15000,
  });

  const totalCodes = (stats?.unusedCodes ?? 0) + (stats?.inProgressCodes ?? 0) + (stats?.usedCodes ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">仪表板</h1>
        <p className="text-sm text-muted-foreground mt-1">账号管理与自动化任务总览</p>
      </div>

      {/* 统计卡片：账号数量相关 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="总账号数"
          value={stats?.totalAccounts ?? 0}
          icon={Users}
          color="bg-blue-500/15 text-blue-400"
          sub={`共 ${totalCodes} 个邀请码`}
          loading={isLoading}
        />
        <StatCard
          title="未使用邀请码"
          value={stats?.unusedCodes ?? 0}
          icon={Clock}
          color="bg-purple-500/15 text-purple-400"
          sub="可触发自动化任务"
          loading={isLoading}
        />
        <StatCard
          title="邀请中"
          value={stats?.inProgressCodes ?? 0}
          icon={Activity}
          color="bg-yellow-500/15 text-yellow-400"
          sub="正在进行中的邀请"
          loading={isLoading}
        />
        <StatCard
          title="已完成邀请"
          value={stats?.usedCodes ?? 0}
          icon={CheckCircle2}
          color="bg-green-500/15 text-green-400"
          sub={`共 ${totalCodes} 个邀请码`}
          loading={isLoading}
        />
      </div>

      {/* 统计卡片：导出相关 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="已导出账号"
          value={stats?.totalExported ?? 0}
          icon={Download}
          color="bg-emerald-500/15 text-emerald-400"
          sub="已导出并从库中移除"
          loading={isLoading}
        />
        <StatCard
          title="待导出账号"
          value={stats?.pendingExport ?? 0}
          icon={Hourglass}
          color="bg-orange-500/15 text-orange-400"
          sub="满足条件可立即导出"
          loading={isLoading}
        />
      </div>

      {/* 邀请码状态分布 */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            邀请码状态分布
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <InviteStatusBar
              unused={stats?.unusedCodes ?? 0}
              inProgress={stats?.inProgressCodes ?? 0}
              used={stats?.usedCodes ?? 0}
            />
          )}
        </CardContent>
      </Card>

      {/* 最近账号 */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              最近注册账号
            </CardTitle>
            <button
              onClick={() => setLocation("/accounts")}
              className="text-xs text-primary hover:underline"
            >
              查看全部
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : stats?.recentAccounts?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">暂无账号数据，请先导入账号</p>
            </div>
          ) : (
            <div className="space-y-2">
              {stats?.recentAccounts?.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{account.email}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      邀请码：<code className="font-mono text-primary">{account.inviteCode || "—"}</code>
                      {(account as any).referrerCode && (
                        <span> · 邀请人：<code className="font-mono text-yellow-400">{(account as any).referrerCode}</code></span>
                      )}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`ml-3 shrink-0 text-xs ${
                      account.inviteStatus === "unused"
                        ? "border-blue-500/30 text-blue-400 bg-blue-500/10"
                        : account.inviteStatus === "in_progress"
                        ? "border-yellow-500/30 text-yellow-400 bg-yellow-500/10"
                        : "border-green-500/30 text-green-400 bg-green-500/10"
                    }`}
                  >
                    {account.inviteStatus === "unused" ? "未使用"
                      : account.inviteStatus === "in_progress" ? "邀请中"
                      : "已使用"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 快捷操作 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "导入账号", path: "/import", icon: Users, desc: "批量导入 JSON 数据" },
          { label: "手机号管理", path: "/phones", icon: Phone, desc: "管理接码手机号" },
          { label: "启动自动化", path: "/automation", icon: Bot, desc: "创建并启动任务" },
          { label: "查看日志", path: "/logs", icon: Activity, desc: "任务执行记录" },
        ].map((item) => (
          <button
            key={item.path}
            onClick={() => setLocation(item.path)}
            className="p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 hover:bg-accent/30 transition-all text-left group"
          >
            <item.icon className="w-5 h-5 text-primary mb-2" />
            <p className="text-sm font-medium text-foreground">{item.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
