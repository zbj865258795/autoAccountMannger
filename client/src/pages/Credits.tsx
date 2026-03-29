import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins, TrendingUp, Users, Zap } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444"];

export default function Credits() {
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery();
  const { data: creditDist, isLoading: distLoading } = trpc.accounts.creditDistribution.useQuery();

  const membershipData = creditDist?.membershipBreakdown ?? [];
  const topAccounts = creditDist?.topAccounts ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">积分统计</h1>
        <p className="text-sm text-muted-foreground mt-1">所有账号的积分分布与统计</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "总积分", value: stats?.totalCredits?.toLocaleString() ?? 0, icon: Coins, color: "bg-yellow-500/15 text-yellow-400" },
          { title: "平均积分", value: stats?.avgCredits?.toLocaleString() ?? 0, icon: TrendingUp, color: "bg-blue-500/15 text-blue-400" },
          { title: "最高积分", value: stats?.maxCredits?.toLocaleString() ?? 0, icon: Zap, color: "bg-purple-500/15 text-purple-400" },
          { title: "账号总数", value: stats?.totalAccounts ?? 0, icon: Users, color: "bg-green-500/15 text-green-400" },
        ].map((item) => (
          <Card key={item.title} className="bg-card border-border/50">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{item.title}</p>
                  {isLoading ? (
                    <Skeleton className="h-8 w-20" />
                  ) : (
                    <p className="text-2xl font-bold text-foreground">{item.value}</p>
                  )}
                </div>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.color}`}>
                  <item.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 会员等级分布 */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">会员等级分布</CardTitle>
          </CardHeader>
          <CardContent>
            {distLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : membershipData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={membershipData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="count"
                    nameKey="membership"
                  >
                    {membershipData.map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }}
                    formatter={(value: any, name: any) => [value, name]}
                  />
                  <Legend
                    formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 积分 Top 10 */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">积分 Top 10 账号</CardTitle>
          </CardHeader>
          <CardContent>
            {distLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : topAccounts.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topAccounts} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="email"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    width={100}
                    tickFormatter={(v) => v.split("@")[0].slice(0, 10)}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }}
                    formatter={(value: any) => [value.toLocaleString(), "积分"]}
                  />
                  <Bar dataKey="totalCredits" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 积分详细列表 */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">积分明细</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Email</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">总积分</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">免费积分</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">刷新积分</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">会员</th>
                </tr>
              </thead>
              <tbody>
                {distLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/30">
                      {[...Array(5)].map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : (creditDist?.allAccounts ?? []).map((account: any) => (
                  <tr key={account.id} className="border-b border-border/30 hover:bg-muted/10">
                    <td className="px-4 py-3 text-sm text-foreground truncate max-w-[200px]">{account.email}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-foreground">{account.totalCredits?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-muted-foreground">{account.freeCredits?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-muted-foreground">{account.refreshCredits?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{account.membershipVersion || "free"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
