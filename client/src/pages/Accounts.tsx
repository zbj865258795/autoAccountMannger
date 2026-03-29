import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Copy, Search, Trash2, Users } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

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

function CopyCell({ value, label, maxW = 160 }: { value?: string | null; label: string; maxW?: number }) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className="text-xs text-foreground font-mono truncate"
        style={{ maxWidth: maxW }}
        title={value}
      >
        {value}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(value);
          toast.success(`已复制 ${label}`);
        }}
        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
      >
        <Copy className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function Accounts() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const utils = trpc.useUtils();

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

  const deleteAccount = trpc.accounts.delete.useMutation({
    onSuccess: () => {
      toast.success("账号已删除");
      utils.accounts.list.invalidate();
      utils.dashboard.stats.invalidate();
    },
    onError: (err) => {
      toast.error(`删除失败：${err.message}`);
    },
  });

  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);
  const total = data?.total ?? 0;

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  // 生成页码数组（最多显示 7 个页码）
  const getPageNumbers = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "...")[] = [];
    if (page <= 4) {
      pages.push(1, 2, 3, 4, 5, "...", totalPages);
    } else if (page >= totalPages - 3) {
      pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, "...", page - 1, page, page + 1, "...", totalPages);
    }
    return pages;
  };

  return (
    <div className="space-y-5">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">账号管理</h1>
          <p className="text-sm text-muted-foreground mt-1">共 {total} 个账号</p>
        </div>
        <Button onClick={() => setLocation("/import")} size="sm">
          <Users className="w-4 h-4 mr-2" />
          导入账号
        </Button>
      </div>

      {/* 搜索和筛选 */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-4">
          <div className="flex gap-3 flex-wrap">
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="搜索 email、邀请码..."
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
                <SelectValue placeholder="邀请码状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="unused">未使用</SelectItem>
                <SelectItem value="in_progress">邀请中</SelectItem>
                <SelectItem value="used">已使用</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 账号表格 */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {/* 表格使用 sticky 固定最后一列（操作列） */}
            <table className="w-full text-sm border-collapse" style={{ minWidth: "1400px" }}>
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">Email</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">密码</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">手机号</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">Token</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">自己邀请码</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">邀请码状态</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">邀请人邀请码</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">会员版本</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap">注册时间</th>
                  {/* 固定操作列 */}
                  <th
                    className="text-center text-xs font-medium text-muted-foreground px-3 py-3 uppercase tracking-wider whitespace-nowrap bg-muted/30"
                    style={{ position: "sticky", right: 0, zIndex: 10, boxShadow: "-2px 0 4px rgba(0,0,0,0.15)" }}
                  >
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/30">
                      {[...Array(10)].map((_, j) => (
                        <td key={j} className="px-3 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-muted-foreground text-sm">
                      暂无账号数据，请先导入账号
                    </td>
                  </tr>
                ) : (
                  data?.items?.map((account) => (
                    <tr
                      key={account.id}
                      className="border-b border-border/30 hover:bg-muted/20 transition-colors"
                    >
                      {/* Email */}
                      <td className="px-3 py-3">
                        <CopyCell value={account.email} label="Email" maxW={180} />
                      </td>
                      {/* 密码 */}
                      <td className="px-3 py-3">
                        <CopyCell value={account.password} label="密码" maxW={120} />
                      </td>
                      {/* 手机号 */}
                      <td className="px-3 py-3">
                        <CopyCell value={account.phone} label="手机号" maxW={120} />
                      </td>
                      {/* Token */}
                      <td className="px-3 py-3">
                        <CopyCell value={account.token} label="Token" maxW={140} />
                      </td>
                      {/* 自己的邀请码 */}
                      <td className="px-3 py-3">
                        {account.inviteCode ? (
                          <div className="flex items-center gap-1.5">
                            <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                              {account.inviteCode}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(account.inviteCode!);
                                toast.success("已复制邀请码");
                              }}
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      {/* 邀请码状态 */}
                      <td className="px-3 py-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${statusClass[account.inviteStatus as InviteStatus]}`}
                        >
                          {statusLabel[account.inviteStatus as InviteStatus]}
                        </Badge>
                      </td>
                      {/* 邀请人邀请码 */}
                      <td className="px-3 py-3">
                        <CopyCell value={(account as any).referrerCode || account.invitedByCode} label="邀请人邀请码" maxW={120} />
                      </td>
                      {/* 会员版本 */}
                      <td className="px-3 py-3">
                        <span className="text-xs text-muted-foreground capitalize">
                          {account.membershipVersion || "free"}
                        </span>
                      </td>
                      {/* 注册时间 */}
                      <td className="px-3 py-3">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {account.registeredAt
                            ? new Date(account.registeredAt).toLocaleString("zh-CN")
                            : new Date(account.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </td>
                      {/* 操作列（固定右侧） */}
                      <td
                        className="px-3 py-3 bg-card"
                        style={{ position: "sticky", right: 0, zIndex: 9, boxShadow: "-2px 0 4px rgba(0,0,0,0.15)" }}
                      >
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除账号</AlertDialogTitle>
                              <AlertDialogDescription>
                                将永久删除账号 <strong>{account.email}</strong>，此操作不可撤销。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteAccount.mutate({ id: account.id })}
                              >
                                确认删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                共 <strong className="text-foreground">{total}</strong> 条，
                第 <strong className="text-foreground">{page}</strong> / <strong className="text-foreground">{totalPages}</strong> 页，
                每页 {pageSize} 条
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                  className="h-7 px-2 text-xs"
                >
                  首页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {/* 页码按钮 */}
                {getPageNumbers().map((p, idx) =>
                  p === "..." ? (
                    <span key={`ellipsis-${idx}`} className="text-xs text-muted-foreground px-1">
                      …
                    </span>
                  ) : (
                    <Button
                      key={p}
                      size="sm"
                      variant={p === page ? "default" : "outline"}
                      onClick={() => setPage(p as number)}
                      className="h-7 w-7 p-0 text-xs"
                    >
                      {p}
                    </Button>
                  )
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage(totalPages)}
                  className="h-7 px-2 text-xs"
                >
                  末页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
