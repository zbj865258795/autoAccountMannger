import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Globe, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";

// ── 地区类型 ──────────────────────────────────────────────────────────────────
type RegionType = "us" | "tw" | "hk" | "jp";

// ── 地区配置 ──────────────────────────────────────────────────────────────────
export const REGION_OPTIONS: { value: RegionType; label: string; description: string }[] = [
  { value: "us", label: "🇺🇸 美国 (US)", description: "时区：美国各州 | 语言：英语" },
  { value: "tw", label: "🇹🇼 台湾 (TW)", description: "时区：Asia/Taipei | 语言：繁体中文" },
  { value: "hk", label: "🇭🇰 香港 (HK)", description: "时区：Asia/Hong_Kong | 语言：繁体中文" },
  { value: "jp", label: "🇯🇵 日本 (JP)", description: "时区：Asia/Tokyo | 语言：日语" },
];

const REGION_BADGE_COLORS: Record<RegionType, string> = {
  us: "bg-blue-100 text-blue-800",
  tw: "bg-green-100 text-green-800",
  hk: "bg-yellow-100 text-yellow-800",
  jp: "bg-red-100 text-red-800",
};

function getRegionLabel(value: string) {
  return REGION_OPTIONS.find((r) => r.value === value)?.label ?? value.toUpperCase();
}

// ── 表单类型 ──────────────────────────────────────────────────────────────────
interface ProxyFormData {
  name: string;
  region: RegionType;
  proxyUrl: string;
  notes: string;
}

const EMPTY_FORM: ProxyFormData = {
  name: "",
  region: "us",
  proxyUrl: "",
  notes: "",
};

export default function ProxyAccounts() {
  const utils = trpc.useUtils();

  // ── 数据查询 ──
  const { data, isLoading, refetch } = trpc.proxyAccounts.list.useQuery();

  // ── mutations ──
  const createMutation = trpc.proxyAccounts.create.useMutation({
    onSuccess: () => {
      toast.success("代理账号已添加");
      utils.proxyAccounts.list.invalidate();
      setCreateOpen(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.proxyAccounts.update.useMutation({
    onSuccess: () => {
      toast.success("代理账号已更新");
      utils.proxyAccounts.list.invalidate();
      setEditOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.proxyAccounts.delete.useMutation({
    onSuccess: () => {
      toast.success("代理账号已删除");
      utils.proxyAccounts.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── 弹窗状态 ──
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<ProxyFormData>({ ...EMPTY_FORM });

  function openEdit(item: { id: number; name: string; region: string; proxyUrl: string; notes: string | null }) {
    setEditId(item.id);
    setForm({
      name: item.name,
      region: (item.region as RegionType) || "us",
      proxyUrl: item.proxyUrl,
      notes: item.notes ?? "",
    });
    setEditOpen(true);
  }

  function handleCreate() {
    if (!form.name.trim()) return toast.error("请输入账号名称");
    if (!form.proxyUrl.trim()) return toast.error("请输入代理地址");
    createMutation.mutate(form);
  }

  function handleUpdate() {
    if (!editId) return;
    if (!form.name.trim()) return toast.error("请输入账号名称");
    if (!form.proxyUrl.trim()) return toast.error("请输入代理地址");
    updateMutation.mutate({ id: editId, data: form });
  }

  return (
    <div className="p-6 space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">代理账号管理</h1>
            <p className="text-sm text-muted-foreground">
              管理代理账号及地区指纹配置，创建任务时直接选择代理账号
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
          <Button size="sm" onClick={() => { setForm({ ...EMPTY_FORM }); setCreateOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" />
            添加代理账号
          </Button>
        </div>
      </div>

      {/* 地区说明卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {REGION_OPTIONS.map((r) => (
          <Card key={r.value} className="border">
            <CardContent className="p-3">
              <div className="font-medium text-sm">{r.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{r.description}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 代理账号列表 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            代理账号列表
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              共 {data?.length ?? 0} 个
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : !data?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无代理账号，点击右上角添加
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>地区</TableHead>
                  <TableHead>代理地址</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          REGION_BADGE_COLORS[item.region as RegionType] ?? "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {getRegionLabel(item.region)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-xs truncate block">
                        {item.proxyUrl}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除</AlertDialogTitle>
                              <AlertDialogDescription>
                                确定要删除代理账号「{item.name}」吗？此操作不可撤销。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate({ id: item.id })}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 添加弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>添加代理账号</DialogTitle>
          </DialogHeader>
          <ProxyForm form={form} setForm={setForm} />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "添加中..." : "添加"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑代理账号</DialogTitle>
          </DialogHeader>
          <ProxyForm form={form} setForm={setForm} />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 表单组件 ──────────────────────────────────────────────────────────────────
function ProxyForm({
  form,
  setForm,
}: {
  form: ProxyFormData;
  setForm: React.Dispatch<React.SetStateAction<ProxyFormData>>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1 block">账号名称 *</label>
        <Input
          placeholder="例如：iProyal-US-01"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">地区 *</label>
        <Select
          value={form.region}
          onValueChange={(v) => setForm((f) => ({ ...f, region: v as RegionType }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择地区" />
          </SelectTrigger>
          <SelectContent>
            {REGION_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                <div>
                  <div>{r.label}</div>
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          地区决定了浏览器指纹的时区、语言和城市配置
        </p>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">代理地址 *</label>
        <Input
          placeholder="socks5h://user-name-session-{session}-sessionduration-30:pass@gate.decodo.com:7000"
          value={form.proxyUrl}
          onChange={(e) => setForm((f) => ({ ...f, proxyUrl: e.target.value }))}
          className="font-mono text-sm"
        />
        <div className="text-xs text-muted-foreground mt-1 space-y-1">
          <p>
            将 session 值的位置替换为 <code className="bg-muted px-1 rounded">{'{session}'}</code>，系统每次注册时自动填入随机字符串，确保每次使用不同出口 IP。
          </p>
          <p className="text-muted-foreground/70">
            Decodo 示例：<code className="bg-muted px-1 rounded">socks5h://user-name-session-{'{session}'}-sessionduration-30:pass@gate.decodo.com:7000</code>
          </p>
          <p className="text-muted-foreground/70">
            iProyal 示例：<code className="bg-muted px-1 rounded">socks5://user:pass_country-us_session-{'{session}'}_lifetime-30m@geo.iproyal.com:12321</code>
          </p>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">备注（可选）</label>
        <Input
          placeholder="例如：iProyal 美国节点，30分钟会话"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </div>
    </div>
  );
}
