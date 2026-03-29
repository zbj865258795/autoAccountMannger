import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Coins,
  GitBranch,
  Loader2,
  Users,
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
  if (total === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
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
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          已使用 {used}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
          邀請中 {inProgress}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
          未使用 {unused}
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
        <h1 className="text-xl font-semibold text-foreground">儀表板</h1>
        <p className="text-sm text-muted-foreground mt-1">賬號管理與自動化任務總覽</p>
      </div>

      {/* 統計卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="總賬號數"
          value={stats?.totalAccounts ?? 0}
          icon={Users}
          color="bg-blue-500/15 text-blue-400"
          sub={`共 ${totalCodes} 個邀請碼`}
          loading={isLoading}
        />
        <StatCard
          title="總積分"
          value={stats?.totalCredits?.toLocaleString() ?? 0}
          icon={Coins}
          color="bg-yellow-500/15 text-yellow-400"
          sub="所有賬號積分合計"
          loading={isLoading}
        />
        <StatCard
          title="未使用邀請碼"
          value={stats?.unusedCodes ?? 0}
          icon={Clock}
          color="bg-purple-500/15 text-purple-400"
          sub="可觸發自動化任務"
          loading={isLoading}
        />
        <StatCard
          title="已完成邀請"
          value={stats?.usedCodes ?? 0}
          icon={CheckCircle2}
          color="bg-green-500/15 text-green-400"
          sub={`邀請中 ${stats?.inProgressCodes ?? 0} 個`}
          loading={isLoading}
        />
      </div>

      {/* 邀請碼狀態分佈 */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            邀請碼狀態分佈
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

      {/* 最近賬號 */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              最近注冊賬號
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
              <p className="text-sm">暫無賬號數據，請先導入賬號</p>
            </div>
          ) : (
            <div className="space-y-2">
              {stats?.recentAccounts?.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => setLocation(`/accounts/${account.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{account.email}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      邀請碼：{account.inviteCode || "—"} · {account.totalCredits?.toLocaleString()} 積分
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
                    {account.inviteStatus === "unused"
                      ? "未使用"
                      : account.inviteStatus === "in_progress"
                      ? "邀請中"
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
          { label: "導入賬號", path: "/import", icon: Users, desc: "批量導入 JSON 數據" },
          { label: "啟動自動化", path: "/automation", icon: Bot, desc: "創建並啟動任務" },
          { label: "查看邀請鏈", path: "/invitation-tree", icon: GitBranch, desc: "可視化邀請關係" },
          { label: "查看日誌", path: "/logs", icon: Activity, desc: "任務執行記錄" },
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
