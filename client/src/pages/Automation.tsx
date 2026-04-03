import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  Bot,
  Clock,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Shield,
  Square,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

type TaskStatus = "idle" | "running" | "paused" | "stopped";

const statusConfig: Record<TaskStatus, { label: string; class: string; icon: React.ElementType }> = {
  idle: { label: "空闲", class: "border-gray-500/30 text-gray-400 bg-gray-500/10", icon: Clock },
  running: { label: "运行中", class: "border-green-500/30 text-green-400 bg-green-500/10", icon: Play },
  paused: { label: "已暂停", class: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10", icon: Pause },
  stopped: { label: "已停止", class: "border-red-500/30 text-red-400 bg-red-500/10", icon: Square },
};

// ─── 创建任务弹窗 ─────────────────────────────────────────────────────────────

function CreateTaskDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const DEFAULT_PROXY = "socks5://pZAY1voZ9z6AbN4c:DIXJkakL9gbeNoju_country-us_session-qkCyZ9SE_lifetime-30m_streaming-1@geo.iproyal.com:12321";
  const [name, setName] = useState("自动注册任务");
  const [interval, setInterval] = useState(60);
  const [apiUrl, setApiUrl] = useState("http://127.0.0.1:50325");
  const [proxyUrl, setProxyUrl] = useState(DEFAULT_PROXY);
  const [targetCount, setTargetCount] = useState<string>("");

  const createTask = trpc.automation.create.useMutation({
    onSuccess: () => {
      toast.success("任务已创建");
      onCreated();
      onClose();
    },
    onError: (err) => toast.error(`创建失败：${err.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border/50 text-foreground max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">创建自动化任务</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">任务名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted/50 border-border/50 text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Shield className="w-3 h-3" />
              代理地址
            </Label>
            <Input
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="socks5://user:pass@host:port"
              className="bg-muted/50 border-border/50 text-foreground font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              支持 socks5:// / http:// 格式。每次注册前会检测出口 IP，确保未被使用过。
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">扫描间隔</Label>
              <span className="text-sm font-medium text-foreground">{interval} 秒</span>
            </div>
            <Slider
              value={[interval]}
              onValueChange={([v]) => setInterval(v)}
              min={10}
              max={300}
              step={10}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10s</span><span>5分钟</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">注册目标总数（可选）</Label>
            <Input
              type="number"
              value={targetCount}
              onChange={(e) => setTargetCount(e.target.value)}
              placeholder="不填则不限制，直到邀请码用完"
              min={1}
              className="bg-muted/50 border-border/50 text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              达到此数量后调度器自动停止，留空表示不限制
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={() => createTask.mutate({
              name,
              scanIntervalSeconds: interval,
              adspowerApiUrl: apiUrl,
              proxyUrl: proxyUrl || undefined,
              targetCount: targetCount ? Number(targetCount) : undefined,
            })}
            disabled={createTask.isPending || !name.trim()}
          >
            {createTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            创建任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 编辑任务弹窗 ─────────────────────────────────────────────────────────────

type TaskItem = {
  id: number;
  name: string;
  scanIntervalSeconds: number | null;
  adspowerApiUrl: string | null;
  adspowerGroupId: string | null;
  targetUrl: string | null;
  targetCount: number | null;
  status: string;
  [key: string]: unknown;
};

function EditTaskDialog({
  task,
  onClose,
  onUpdated,
}: {
  task: TaskItem;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(task.name);
  const [interval, setInterval] = useState(task.scanIntervalSeconds ?? 60);
  const DEFAULT_PROXY = "socks5://pZAY1voZ9z6AbN4c:DIXJkakL9gbeNoju_country-us_session-qkCyZ9SE_lifetime-30m_streaming-1@geo.iproyal.com:12321";
  const [apiUrl, setApiUrl] = useState(task.adspowerApiUrl ?? "http://127.0.0.1:50325");
  const [proxyUrl, setProxyUrl] = useState((task.proxyUrl as string) || DEFAULT_PROXY);
  const [targetCount, setTargetCount] = useState<string>(
    task.targetCount != null ? String(task.targetCount) : ""
  );

  const updateTask = trpc.automation.update.useMutation({
    onSuccess: () => {
      toast.success("任务已更新");
      onUpdated();
      onClose();
    },
    onError: (err) => toast.error(`更新失败：${err.message}`),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border/50 text-foreground max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">编辑任务：{task.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">任务名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted/50 border-border/50 text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Shield className="w-3 h-3" />
              代理地址
            </Label>
            <Input
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="socks5://user:pass@host:port"
              className="bg-muted/50 border-border/50 text-foreground font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              支持 socks5:// / http:// 格式。每次注册前会检测出口 IP，确保未被使用过。
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">扫描间隔</Label>
              <span className="text-sm font-medium text-foreground">{interval} 秒</span>
            </div>
            <Slider
              value={[interval]}
              onValueChange={([v]) => setInterval(v)}
              min={10}
              max={300}
              step={10}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10s</span><span>5分钟</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">注册目标总数（可选）</Label>
            <Input
              type="number"
              value={targetCount}
              onChange={(e) => setTargetCount(e.target.value)}
              placeholder="不填则不限制"
              min={1}
              className="bg-muted/50 border-border/50 text-foreground"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={() =>
              updateTask.mutate({
                id: task.id,
                data: {
                  name,
                  scanIntervalSeconds: interval,
                  adspowerApiUrl: apiUrl,
                  proxyUrl: proxyUrl || null,
                  targetCount: targetCount ? Number(targetCount) : null,
                },
              })
            }
            disabled={updateTask.isPending || !name.trim()}
          >
            {updateTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── AdsPower 连接状态 ────────────────────────────────────────────────────────

function AdsPowerStatus({ apiUrl }: { apiUrl: string }) {
  const { data, isLoading, isFetching, refetch } = trpc.automation.checkAdspower.useQuery(
    { apiUrl },
    {
      refetchInterval: 30000,
      staleTime: 25000,
      placeholderData: (prev) => prev,
    }
  );

  const showSpinner = isLoading && !data;

  return (
    <div className="flex items-center gap-2 text-xs">
      {showSpinner ? (
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
      ) : data?.connected ? (
        <>
          <Wifi className="w-3 h-3 text-green-400" />
          <span className="text-green-400">已连接</span>
          {(data.activeBrowsers?.length ?? 0) > 0 && (
            <span className="text-muted-foreground">· {data.activeBrowsers?.length} 个活跃浏览器</span>
          )}
          {isFetching && <Loader2 className="w-2.5 h-2.5 animate-spin text-green-400/50" />}
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3 text-red-400" />
          <span className="text-red-400">未连接</span>
          {isFetching && <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground" />}
        </>
      )}
      <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground">
        <RefreshCw className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── 最近失败日志 ─────────────────────────────────────────────────────────────

function RecentErrors({ taskId }: { taskId: number }) {
  const { data } = trpc.taskLogs.list.useQuery(
    { taskId, status: "failed", page: 1, pageSize: 3 },
    { refetchInterval: 10000 }
  );

  const logs = data?.items ?? [];
  if (logs.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertTriangle className="w-3 h-3" />
          <span>最近失败记录</span>
        </div>
        <Link href="/logs" className="text-xs text-muted-foreground hover:text-foreground underline">
          查看全部日志
        </Link>
      </div>
      <div className="space-y-1.5">
        {logs.map((log: any) => (
          <div key={log.id} className="p-2 rounded bg-red-500/5 border border-red-500/10">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{log.startedAt ? new Date(log.startedAt).toLocaleString("zh-CN") : "-"}</span>
              {log.durationMs != null && <span>{(log.durationMs / 1000).toFixed(1)}s</span>}
            </div>
            <p className="text-xs text-red-400 font-mono break-all">{log.errorMessage || "未知错误"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function Automation() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [confirmStop, setConfirmStop] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TaskItem | null>(null);
  const [editTask, setEditTask] = useState<TaskItem | null>(null);

  const { data: tasks, isLoading, refetch } = trpc.automation.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const startTask = trpc.automation.start.useMutation({
    onSuccess: () => { toast.success("任务已启动"); utils.automation.list.invalidate(); },
    onError: (err) => toast.error(`启动失败：${err.message}`),
  });
  const pauseTask = trpc.automation.pause.useMutation({
    onSuccess: () => { toast.success("任务已暂停"); utils.automation.list.invalidate(); },
    onError: (err) => toast.error(`暂停失败：${err.message}`),
  });
  const stopTask = trpc.automation.stop.useMutation({
    onSuccess: () => { toast.success("任务已停止"); utils.automation.list.invalidate(); setConfirmStop(null); },
    onError: (err) => toast.error(`停止失败：${err.message}`),
  });
  const deleteTask = trpc.automation.delete.useMutation({
    onSuccess: () => { toast.success("任务已删除"); utils.automation.list.invalidate(); setConfirmDelete(null); },
    onError: (err) => toast.error(`删除失败：${err.message}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">自动化任务</h1>
          <p className="text-sm text-muted-foreground mt-1">管理 AdsPower 自动注册任务（单线程模式）</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />刷新
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />新建任务
          </Button>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="space-y-3">
        {isLoading ? (
          <Card className="bg-card border-border/50">
            <CardContent className="p-6 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              <p className="text-sm">加载中...</p>
            </CardContent>
          </Card>
        ) : tasks?.length === 0 ? (
          <Card className="bg-card border-border/50">
            <CardContent className="p-12 text-center text-muted-foreground">
              <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">暂无自动化任务</p>
              <p className="text-xs mt-1">点击「新建任务」创建第一个自动化任务</p>
            </CardContent>
          </Card>
        ) : (
          tasks?.map((task) => {
            const sc = statusConfig[task.status as TaskStatus] ?? statusConfig.idle;
            const StatusIcon = sc.icon;
            const hasProxy = !!(task as any).proxyUrl;
            return (
              <Card key={task.id} className="bg-card border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground">{task.name}</span>
                        <Badge variant="outline" className={`text-xs ${sc.class}`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {sc.label}
                        </Badge>
                        {hasProxy && (
                          <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400 bg-blue-500/10">
                            <Shield className="w-3 h-3 mr-1" />代理
                          </Badge>
                        )}
                      </div>
                      <AdsPowerStatus apiUrl={task.adspowerApiUrl ?? "http://127.0.0.1:50325"} />
                    </div>
                    <div className="flex gap-1.5 ml-3 flex-wrap justify-end">
                      {(task.status === "idle" || task.status === "paused" || task.status === "stopped") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-green-400 border-green-500/30 hover:bg-green-500/10"
                          onClick={() => startTask.mutate({ id: task.id })}
                          disabled={startTask.isPending}
                        >
                          <Play className="w-3 h-3 mr-1" />启动
                        </Button>
                      )}
                      {task.status === "running" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                          onClick={() => pauseTask.mutate({ id: task.id })}
                          disabled={pauseTask.isPending}
                        >
                          <Pause className="w-3 h-3 mr-1" />暂停
                        </Button>
                      )}
                      {task.status !== "stopped" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-red-400 border-red-500/30 hover:bg-red-500/10"
                          onClick={() => setConfirmStop(task.id)}
                        >
                          <Square className="w-3 h-3 mr-1" />停止
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-muted-foreground border-border/50 hover:bg-muted/30"
                        onClick={() => setEditTask(task as TaskItem)}
                        disabled={task.status === "running"}
                        title={task.status === "running" ? "请先停止任务再编辑" : "编辑任务"}
                      >
                        <Pencil className="w-3 h-3 mr-1" />编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-red-400 border-red-500/30 hover:bg-red-500/10"
                        onClick={() => setConfirmDelete(task as TaskItem)}
                      >
                        <Trash2 className="w-3 h-3 mr-1" />删除
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/30">
                    <div className="text-center">
                      <p className="text-lg font-bold text-foreground">
                        {task.totalAccountsCreated ?? 0}
                        {(task as any).targetCount ? <span className="text-sm text-muted-foreground">/{(task as any).targetCount}</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">已创建账号</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-green-400">{task.totalSuccess ?? 0}</p>
                      <p className="text-xs text-muted-foreground">成功次数</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-red-400">{task.totalFailed ?? 0}</p>
                      <p className="text-xs text-muted-foreground">失败次数</p>
                    </div>
                  </div>

                  <div className="flex gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
                    <span>间隔：{task.scanIntervalSeconds}s</span>
                    <span className="text-blue-400/70">单线程模式</span>
                    {(task as any).targetCount ? <span>目标：{(task as any).targetCount}</span> : null}
                    {hasProxy && (
                      <span className="text-blue-400/70 flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        代理已配置
                      </span>
                    )}
                    {task.lastExecutedAt && (
                      <span>最后执行：{new Date(task.lastExecutedAt).toLocaleString("zh-CN")}</span>
                    )}
                  </div>

                  {/* 最近失败日志 */}
                  <RecentErrors taskId={task.id} />
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* 创建任务弹窗 */}
      <CreateTaskDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => utils.automation.list.invalidate()}
      />

      {/* 编辑任务弹窗 */}
      {editTask && (
        <EditTaskDialog
          task={editTask}
          onClose={() => setEditTask(null)}
          onUpdated={() => utils.automation.list.invalidate()}
        />
      )}

      {/* 停止确认弹窗 */}
      <AlertDialog open={confirmStop !== null} onOpenChange={() => setConfirmStop(null)}>
        <AlertDialogContent className="bg-card border-border/50 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>确认停止任务</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              停止后任务将不再自动扫描邀请码，所有正在运行的浏览器实例将被强制关闭，对应日志状态将标记为失败。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmStop !== null && stopTask.mutate({ id: confirmStop })}
              className="bg-destructive hover:bg-destructive/90"
            >
              确认停止
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认弹窗 */}
      <AlertDialog open={confirmDelete !== null} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent className="bg-card border-border/50 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              将永久删除任务 <strong className="text-foreground">{confirmDelete?.name}</strong> 及其所有执行日志，此操作不可撤销。
              {(confirmDelete?.status === "running" || confirmDelete?.status === "paused") && (
                <span className="block mt-1 text-yellow-400">该任务当前正在运行/暂停，删除前将自动停止。</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteTask.mutate({ id: confirmDelete.id })}
              className="bg-destructive hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
