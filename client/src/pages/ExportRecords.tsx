import { trpc } from "@/lib/trpc";
import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Download,
  Eye,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadCsv(filename: string, rows: string[][], headers: string[]) {
  const escape = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 批次详情弹窗 ─────────────────────────────────────────────────────────────

function BatchDetailDialog({
  batchId,
  onClose,
}: {
  batchId: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading } = trpc.export.batchDetail.useQuery(
    { batchId, search: debouncedSearch || undefined, page, pageSize },
    { enabled: !!batchId }
  );

  const handleSearch = useCallback(
    (v: string) => {
      setSearch(v);
      clearTimeout((handleSearch as any)._t);
      (handleSearch as any)._t = setTimeout(() => {
        setDebouncedSearch(v);
        setPage(1);
      }, 400);
    },
    []
  );

  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  const handleDownload = () => {
    if (!data?.items?.length) return;
    const headers = ["邮箱", "密码", "Token", "邀请码", "邀请人邀请码", "会员版本", "积分", "手机号", "注册时间", "导出时间"];
    const rows = data.items.map((r) => [
      r.email,
      r.password,
      r.token ?? "",
      r.inviteCode ?? "",
      r.referrerCode ?? "",
      r.membershipVersion ?? "",
      String(r.totalCredits ?? 0),
      r.phone ?? "",
      formatDate(r.registeredAt),
      formatDate(r.exportedAt),
    ]);
    downloadCsv(`${batchId}.csv`, rows, headers);
    toast.success("CSV 已下载");
  };

  const handleCopyCredentials = () => {
    if (!data?.items?.length) return;
    const text = data.items.map((r) => `${r.email}----${r.password}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`已复制 ${data.items.length} 条账号密码`);
    }).catch(() => {
      toast.error("复制失败，请手动复制");
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">批次详情</DialogTitle>
          <DialogDescription className="text-xs font-mono text-muted-foreground">
            {batchId}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mt-1">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索邮箱 / 邀请码 / 邀请人邀请码…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={!data?.items?.length}>
            <Download className="h-3.5 w-3.5 mr-1" />
            下载 CSV
          </Button>
          <Button size="sm" variant="outline" onClick={handleCopyCredentials} disabled={!data?.items?.length}
            className="border-primary/30 text-primary hover:bg-primary/10">
            <ClipboardCopy className="h-3.5 w-3.5 mr-1" />
            复制账号密码
          </Button>
        </div>

        <div className="flex-1 overflow-auto mt-2 rounded-md border border-border/50">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">邮箱</TableHead>
                <TableHead className="text-xs">密码</TableHead>
                <TableHead className="text-xs">邀请码</TableHead>
                <TableHead className="text-xs">邀请人邀请码</TableHead>
                <TableHead className="text-xs">会员</TableHead>
                <TableHead className="text-xs">积分</TableHead>
                <TableHead className="text-xs">导出时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data?.items?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                data?.items?.map((row) => (
                  <TableRow key={row.id} className="text-xs">
                    <TableCell className="font-mono max-w-[180px] truncate">{row.email}</TableCell>
                    <TableCell className="font-mono max-w-[120px] truncate">{row.password}</TableCell>
                    <TableCell className="font-mono text-primary">{row.inviteCode ?? "—"}</TableCell>
                    <TableCell className="font-mono text-yellow-400">{row.referrerCode ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs py-0">
                        {row.membershipVersion ?? "free"}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.totalCredits ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.exportedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              共 {data?.total ?? 0} 条，第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function ExportRecords() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewBatchId, setViewBatchId] = useState<string | null>(null);
  const pageSize = 20;

  const { data, isLoading } = trpc.export.listBatches.useQuery(
    { search: debouncedSearch || undefined, page, pageSize },
    { refetchInterval: 30000 }
  );

  const handleSearch = useCallback(
    (v: string) => {
      setSearch(v);
      clearTimeout((handleSearch as any)._t);
      (handleSearch as any)._t = setTimeout(() => {
        setDebouncedSearch(v);
        setPage(1);
      }, 400);
    },
    []
  );

  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">导出记录</h1>
        <p className="text-sm text-muted-foreground mt-1">
          每次导出操作的批次汇总，点击查看该批次的账号明细或重新下载 CSV
        </p>
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Download className="w-4 h-4 text-primary" />
              导出批次列表
              {data?.total != null && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {data.total} 批次
                </Badge>
              )}
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="搜索批次号 / 邮箱…"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => handleSearch("")}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-b-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-t border-border/50">
                  <TableHead className="text-xs pl-6">批次号</TableHead>
                  <TableHead className="text-xs">导出时间</TableHead>
                  <TableHead className="text-xs">账号数量</TableHead>
                  <TableHead className="text-xs text-right pr-6">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 }).map((__, j) => (
                        <TableCell key={j} className={j === 0 ? "pl-6" : j === 3 ? "pr-6" : ""}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : data?.items?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-12 text-muted-foreground text-sm">
                      <Download className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      暂无导出记录
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.items?.map((batch) => (
                    <TableRow key={batch.exportBatchId} className="hover:bg-muted/30">
                      <TableCell className="pl-6 font-mono text-xs text-primary">
                        {batch.exportBatchId}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(batch.exportedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {Number(batch.accountCount)} 个账号
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setViewBatchId(batch.exportBatchId)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          查看详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                共 {data?.total ?? 0} 个批次，第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {viewBatchId && (
        <BatchDetailDialog batchId={viewBatchId} onClose={() => setViewBatchId(null)} />
      )}
    </div>
  );
}
