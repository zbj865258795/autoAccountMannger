import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Search,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

type InviteStatus = "unused" | "in_progress" | "used";

const statusLabel: Record<InviteStatus, string> = {
  unused: "未使用",
  in_progress: "邀請中",
  used: "已使用",
};

const statusClass: Record<InviteStatus, string> = {
  unused: "border-blue-500/30 text-blue-400 bg-blue-500/10",
  in_progress: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10",
  used: "border-green-500/30 text-green-400 bg-green-500/10",
};

export default function Accounts() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = trpc.accounts.list.useQuery(
    {
      search: search || undefined,
      inviteStatus: inviteStatus !== "all" ? (inviteStatus as InviteStatus) : undefined,
      page,
      pageSize,
      sortBy: "createdAt",
      sortOrder: "desc",
    },
    { keepPreviousData: true } as any
  );

  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`已複製 ${label}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">賬號管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {data?.total ?? 0} 個賬號
          </p>
        </div>
        <Button onClick={() => setLocation("/import")} size="sm">
          <Users className="w-4 h-4 mr-2" />
          導入賬號
        </Button>
      </div>

      {/* 搜索和篩選 */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-4">
          <div className="flex gap-3 flex-wrap">
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="搜索 email、邀請碼、用戶名..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="bg-muted/50 border-border/50 text-foreground placeholder:text-muted-foreground"
              />
              <Button onClick={handleSearch} size="icon" variant="secondary">
                <Search className="w-4 h-4" />
              </Button>
            </div>
            <Select
              value={inviteStatus}
              onValueChange={(v) => { setInviteStatus(v); setPage(1); }}
            >
              <SelectTrigger className="w-36 bg-muted/50 border-border/50 text-foreground">
                <SelectValue placeholder="邀請碼狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="unused">未使用</SelectItem>
                <SelectItem value="in_progress">邀請中</SelectItem>
                <SelectItem value="used">已使用</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 賬號表格 */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Email</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">邀請碼</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">狀態</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">積分</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">會員</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">注冊時間</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/30">
                      {[...Array(7)].map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                      暫無賬號數據
                    </td>
                  </tr>
                ) : (
                  data?.items?.map((account) => (
                    <tr
                      key={account.id}
                      className="border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => setLocation(`/accounts/${account.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground truncate max-w-[200px]">{account.email}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); copyToClipboard(account.email, "Email"); }}
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {account.inviteCode ? (
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                              {account.inviteCode}
                            </code>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(account.inviteCode!, "邀請碼"); }}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${statusClass[account.inviteStatus as InviteStatus]}`}
                        >
                          {statusLabel[account.inviteStatus as InviteStatus]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-medium text-foreground">
                          {account.totalCredits?.toLocaleString() ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground capitalize">
                          {account.membershipVersion || "free"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">
                          {account.registeredAt
                            ? new Date(account.registeredAt).toLocaleDateString("zh-TW")
                            : new Date(account.createdAt).toLocaleDateString("zh-TW")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/accounts/${account.id}`); }}
                        >
                          詳情
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分頁 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                第 {page} / {totalPages} 頁，共 {data?.total} 條
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="h-7 w-7 p-0"
                >
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
