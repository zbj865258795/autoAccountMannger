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
        <h1 className="text-xl font-semibold text-foreground">積分統計</h1>
        <p className="text-sm text-muted-foreground mt-1">所有賬號的積分分佈與統計</p>
      </div>

      {/* 統計卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "總積分", value: stats?.totalCredits?.toLocaleString() ?? 0, icon: Coins, color: "bg-yellow-500/15 text-yellow-400" },
          { title: "平均積分", value: stats?.avgCredits?.toLocaleString() ?? 0, icon: TrendingUp, color: "bg-blue-500/15 text-blue-400" },
          { title: "最高積分", value: stats?.maxCredits?.toLocaleString() ?? 0, icon: Zap, color: "bg-purple-500/15 text-purple-400" },
          { title: "賬號總數", value: stats?.totalAccounts ?? 0, icon: Users, color: "bg-green-500/15 text-green-400" },
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
        {/* 會員等級分佈 */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">會員等級分佈</CardTitle>
          </CardHeader>
          <CardContent>
            {distLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : membershipData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">暫無數據</div>
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

        {/* 積分 Top 10 */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">積分 Top 10 賬號</CardTitle>
          </CardHeader>
          <CardContent>
            {distLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : topAccounts.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">暫無數據</div>
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
                    formatter={(value: any) => [value.toLocaleString(), "積分"]}
                  />
                  <Bar dataKey="totalCredits" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 積分詳細列表 */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">積分明細</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Email</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">總積分</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">免費積分</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">刷新積分</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">會員</th>
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
