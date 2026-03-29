import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { toast } from "sonner";
import {
  Phone,
  Upload,
  RefreshCw,
  Trash2,
  CheckCircle,
  Clock,
  XCircle,
  Search,
} from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  unused:  { label: "未使用", variant: "default" },
  in_use:  { label: "使用中", variant: "secondary" },
  used:    { label: "已使用", variant: "outline" },
};

export default function PhoneNumbers() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.phoneNumbers.stats.useQuery();
  const { data: listData, isLoading: listLoading } = trpc.phoneNumbers.list.useQuery({
    status: statusFilter !== "all" ? (statusFilter as "unused" | "in_use" | "used") : undefined,
    search: search || undefined,
    page,
    pageSize: 50,
  });

  const bulkImport = trpc.phoneNumbers.bulkImport.useMutation({
    onSuccess: (result) => {
      toast.success(`导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条`);
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} 条格式错误，已跳过`);
      }
      setImportText("");
      setImportOpen(false);
      utils.phoneNumbers.list.invalidate();
      utils.phoneNumbers.stats.invalidate();
    },
    onError: (err) => toast.error(`导入失败：${err.message}`),
  });

  const markUsed = trpc.phoneNumbers.markUsed.useMutation({
    onSuccess: () => {
      toast.success("已标记为已使用");
      utils.phoneNumbers.list.invalidate();
      utils.phoneNumbers.stats.invalidate();
    },
    onError: (err) => toast.error(`操作失败：${err.message}`),
  });

  const reset = trpc.phoneNumbers.reset.useMutation({
    onSuccess: () => {
      toast.success("已重置为未使用");
      utils.phoneNumbers.list.invalidate();
      utils.phoneNumbers.stats.invalidate();
    },
    onError: (err) => toast.error(`操作失败：${err.message}`),
  });

  const deleteMutation = trpc.phoneNumbers.delete.useMutation({
    onSuccess: () => {
      toast.success("删除成功");
      setSelectedIds([]);
      utils.phoneNumbers.list.invalidate();
      utils.phoneNumbers.stats.invalidate();
    },
    onError: (err) => toast.error(`删除失败：${err.message}`),
  });

  const items = listData?.items ?? [];
  const total = listData?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((i) => i.id));
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">手机号管理</h1>
            <p className="text-sm text-muted-foreground mt-1">
              管理注册用手机号，格式：手机号|接码URL
            </p>
          </div>
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Upload className="h-4 w-4" />
                批量导入
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>批量导入手机号</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  <p className="font-medium mb-1">格式说明：</p>
                  <p>每行一条，格式为 <code className="bg-background px-1 rounded">手机号|接码URL</code></p>
                  <p className="mt-1 text-xs">示例：</p>
                  <pre className="text-xs mt-1 bg-background p-2 rounded">
{`+12232263007|https://sms-555.com/cacgadbjbbcccf6mmg3tv4frasfup3bn
+17699335914|https://sms-555.com/xxxxxxxxxxxxx`}
                  </pre>
                </div>
                <Textarea
                  placeholder="粘贴手机号数据，每行一条..."
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    共 {importText.split("\n").filter((l) => l.trim()).length} 条
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setImportOpen(false)}>
                      取消
                    </Button>
                    <Button
                      onClick={() => bulkImport.mutate({ text: importText })}
                      disabled={!importText.trim() || bulkImport.isPending}
                    >
                      {bulkImport.isPending ? "导入中..." : "确认导入"}
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "总数量", value: stats?.total ?? 0, icon: Phone, color: "text-blue-500" },
            { label: "未使用", value: stats?.unused ?? 0, icon: CheckCircle, color: "text-green-500" },
            { label: "使用中", value: stats?.inUse ?? 0, icon: Clock, color: "text-yellow-500" },
            { label: "已使用", value: stats?.used ?? 0, icon: XCircle, color: "text-gray-400" },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <stat.icon className={`h-8 w-8 ${stat.color}`} />
                <div>
                  <p className="text-2xl font-bold">{statsLoading ? "—" : stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 筛选栏 */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索手机号..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="状态筛选" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="unused">未使用</SelectItem>
                  <SelectItem value="in_use">使用中</SelectItem>
                  <SelectItem value="used">已使用</SelectItem>
                </SelectContent>
              </Select>
              {selectedIds.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-1">
                      <Trash2 className="h-4 w-4" />
                      删除选中 ({selectedIds.length})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认删除</AlertDialogTitle>
                      <AlertDialogDescription>
                        将删除选中的 {selectedIds.length} 条手机号，此操作不可撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate({ ids: selectedIds })}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        确认删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 手机号列表 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              手机号列表
              <span className="text-sm font-normal text-muted-foreground ml-2">
                共 {total} 条
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selectedIds.length === items.length}
                      onChange={toggleSelectAll}
                      className="cursor-pointer"
                    />
                  </TableHead>
                  <TableHead>手机号 | 接码URL</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-48">使用账号</TableHead>
                  <TableHead className="w-40">导入时间</TableHead>
                  <TableHead className="w-28 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      暂无数据，请点击「批量导入」添加手机号
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const statusInfo = STATUS_LABELS[item.status] ?? STATUS_LABELS.unused;
                    return (
                      <TableRow key={item.id} className={selectedIds.includes(item.id) ? "bg-muted/50" : ""}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(item.id)}
                            onChange={() => toggleSelect(item.id)}
                            className="cursor-pointer"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-sm">
                            <span className="font-medium">{item.phone}</span>
                            <span className="text-muted-foreground mx-1">|</span>
                            <span className="text-xs text-muted-foreground break-all">
                              {item.smsUrl.length > 60
                                ? item.smsUrl.slice(0, 60) + "..."
                                : item.smsUrl}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.usedByEmail ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {/* 任何状态都可以重置为未使用 */}
                            {item.status !== "unused" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                onClick={() => reset.mutate({ phone: item.phone })}
                              >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                重置
                              </Button>
                            )}
                            {/* 未使用或使用中，可手动标记已使用 */}
                            {item.status !== "used" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-green-600"
                                onClick={() => markUsed.mutate({ phone: item.phone })}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                标记已用
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-sm text-muted-foreground">
                  第 {page} / {totalPages} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* API 接口说明 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">插件调用接口</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              插件每次需要手机号时，调用以下接口获取一条未使用的手机号（调用后自动标记为已使用）：
            </p>
            <div className="bg-muted rounded-md p-3 font-mono text-sm space-y-2">
              <div>
                <span className="text-green-500 font-bold">POST</span>
                <span className="ml-2">/api/callback/get-phone</span>
              </div>
              <div className="text-muted-foreground text-xs">无需请求体，直接调用即可</div>
              <div className="text-muted-foreground text-xs mt-2">返回示例：</div>
              <pre className="text-xs bg-background p-2 rounded overflow-auto">{`{
  "success": true,
  "data": "+12232263007|https://sms-555.com/cacgadbjbbcccf6mmg3tv4frasfup3bn"
}`}</pre>
              <div className="text-muted-foreground text-xs mt-2">
                若无可用手机号，返回：<code className="bg-background px-1 rounded">{`{"success": false, "message": "暂无可用手机号"}`}</code>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
