import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, GitBranch, Search, Users } from "lucide-react";
import { useLocation } from "wouter";

type InviteStatus = "unused" | "in_progress" | "used";

const statusLabel: Record<InviteStatus, string> = {
  unused: "未使用",
  in_progress: "邀请中",
  used: "已使用",
};

const statusClass: Record<InviteStatus, string> = {
  unused: "border-blue-500/30 text-blue-400 bg-blue-500/10",
  in_progress: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10",
  used: "border-green-500/30 text-green-400 bg-green-500/10",
};

function AccountNode({
  account,
  depth = 0,
  isLast = false,
  onSelect,
}: {
  account: any;
  depth?: number;
  isLast?: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <div className={`relative ${depth > 0 ? "ml-8" : ""}`}>
      {depth > 0 && (
        <div className="absolute -left-4 top-5 w-4 h-px bg-border/50" />
      )}
      {depth > 0 && !isLast && (
        <div className="absolute -left-4 top-0 bottom-0 w-px bg-border/30" />
      )}
      <div
        className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/50 hover:border-primary/30 hover:bg-accent/20 transition-all cursor-pointer mb-2"
        onClick={() => onSelect(account.id)}
      >
        <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-primary">
            {account.email?.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{account.email}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {account.inviteCode && (
              <code className="text-xs font-mono text-primary/80">{account.inviteCode}</code>
            )}
            <span className="text-xs text-muted-foreground">
              {account.totalCredits?.toLocaleString()} 积分
            </span>
          </div>
        </div>
        <Badge
          variant="outline"
          className={`text-xs shrink-0 ${statusClass[account.inviteStatus as InviteStatus]}`}
        >
          {statusLabel[account.inviteStatus as InviteStatus]}
        </Badge>
      </div>
    </div>
  );
}

function ChainView({ accountId }: { accountId: number }) {
  const { data: chain, isLoading } = trpc.accounts.invitationChain.useQuery({ id: accountId });
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  if (!chain || chain.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">无邀请关系数据</p>;
  }

  return (
    <div className="space-y-1">
      {chain.map((account, index) => (
        <div key={account.id}>
          <AccountNode
            account={account}
            depth={0}
            onSelect={(id) => setLocation(`/accounts/${id}`)}
          />
          {index < chain.length - 1 && (
            <div className="flex justify-center my-1">
              <ArrowDown className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function InvitationTree() {
  const [searchInput, setSearchInput] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: accountsData, isLoading } = trpc.accounts.list.useQuery({
    search: searchInput || undefined,
    page: 1,
    pageSize: 50,
    sortBy: "createdAt",
    sortOrder: "asc",
  });

  const accounts = accountsData?.items ?? [];

  // 找出根节点（没有 invitedById 的账号）
  const rootAccounts = accounts.filter((a) => !a.invitedById);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">邀请关系</h1>
        <p className="text-sm text-muted-foreground mt-1">查看账号之间的邀请链条关系</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 左侧：账号列表 */}
        <div className="space-y-3">
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                选择账号查看邀请链
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="搜索 email 或邀请码..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="bg-muted/50 border-border/50 text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-1 max-h-[500px] overflow-y-auto">
                {isLoading ? (
                  [...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
                ) : accounts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">暂无账号</div>
                ) : (
                  accounts.map((account) => (
                    <button
                      key={account.id}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        selectedId === account.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/30 hover:border-border/60 hover:bg-muted/20"
                      }`}
                      onClick={() => setSelectedId(account.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{account.email}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {account.inviteCode && (
                              <code className="text-xs font-mono text-primary/80">{account.inviteCode}</code>
                            )}
                            {!account.invitedById && (
                              <span className="text-xs text-muted-foreground">（根节点）</span>
                            )}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-xs ml-2 shrink-0 ${statusClass[account.inviteStatus as InviteStatus]}`}
                        >
                          {statusLabel[account.inviteStatus as InviteStatus]}
                        </Badge>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：邀请链展示 */}
        <div>
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-primary" />
                邀请链条
                {selectedId && (
                  <span className="text-xs text-muted-foreground font-normal ml-1">
                    （从选中账号展开）
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedId ? (
                <div className="text-center py-12 text-muted-foreground">
                  <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">请在左侧选择一个账号</p>
                  <p className="text-xs mt-1">系统将展示其完整的邀请链条</p>
                </div>
              ) : (
                <ChainView accountId={selectedId} />
              )}
            </CardContent>
          </Card>

          {/* 统计说明 */}
          <Card className="bg-card border-border/50 mt-3">
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-lg font-bold text-foreground">{rootAccounts.length}</p>
                  <p className="text-xs text-muted-foreground">根账号</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{accounts.filter(a => a.invitedById).length}</p>
                  <p className="text-xs text-muted-foreground">被邀请账号</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{accounts.filter(a => a.inviteStatus === "used").length}</p>
                  <p className="text-xs text-muted-foreground">已完成邀请</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
