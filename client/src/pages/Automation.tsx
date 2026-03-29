import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Bot,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

type TaskStatus = "idle" | "running" | "paused" | "stopped";

const statusConfig: Record<TaskStatus, { label: string; class: string; icon: React.ElementType }> = {
  idle: { label: "空闲", class: "border-gray-500/30 text-gray-400 bg-gray-500/10", icon: Clock },
  running: { label: "运行中", class: "border-green-500/30 text-green-400 bg-green-500/10", icon: Play },
  paused: { label: "已暂停", class: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10", icon: Pause },
  stopped: { label: "已停止", class: "border-red-500/30 text-red-400 bg-red-500/10", icon: Square },
};

function CreateTaskDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("自动注册任务");
  const [interval, setInterval] = useState(60);
  const [apiUrl, setApiUrl] = useState("http://local.adspower.net:50325");
  const [groupId, setGroupId] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState(1);

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
      <DialogContent className="bg-card border-border/50 text-foreground max-w-md">
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
            <Label className="text-xs text-muted-foreground">AdsPower API 地址</Label>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://local.adspower.net:50325"
              className="bg-muted/50 border-border/50 text-foreground font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">注册目标 URL（可选）</Label>
            <Input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com/register"
              className="bg-muted/50 border-border/50 text-foreground font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">浏览器打开后自动跳转到此 URL，邀请码会自动附加到 URL 参数</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">分组 ID（可选）</Label>
            <Input
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="AdsPower 浏览器分组 ID"
              className="bg-muted/50 border-border/50 text-foreground"
            />
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
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">最大并发数</Label>
              <span className="text-sm font-medium text-foreground">{maxConcurrent} 个</span>
            </div>
            <Slider
              value={[maxConcurrent]}
              onValueChange={([v]) => setMaxConcurrent(v)}
              min={1}
              max={50}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              每次扫描最多同时启动 {maxConcurrent} 个 AdsPower 浏览器实例
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
              adspowerGroupId: groupId || undefined,
              targetUrl: targetUrl || undefined,
              maxConcurrent,
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

function AdsPowerStatus({ apiUrl }: { apiUrl: string }) {
  const { data, isLoading, refetch } = trpc.automation.checkAdspower.useQuery(
    { apiUrl },
    { refetchInterval: 30000 }
  );

  return (
    <div className="flex items-center gap-2 text-xs">
      {isLoading ? (
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
      ) : data?.connected ? (
        <>
          <Wifi className="w-3 h-3 text-green-400" />
          <span className="text-green-400">已连接</span>
          {(data.activeBrowsers?.length ?? 0) > 0 && (
            <span className="text-muted-foreground">· {data.activeBrowsers?.length} 个活跃浏览器</span>
          )}
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3 text-red-400" />
          <span className="text-red-400">未连接</span>
        </>
      )}
      <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground">
        <RefreshCw className="w-3 h-3" />
      </button>
    </div>
  );
}

// 并发启动面板：选择同时启动几个任务
function ConcurrentLaunchPanel() {
  const utils = trpc.useUtils();
  const { data: unusedData } = trpc.accounts.unusedCodes.useQuery();
  const [concurrentCount, setConcurrentCount] = useState(1);
  const [launching, setLaunching] = useState(false);

  const unusedCodes = unusedData ?? [];
  const maxConcurrent = unusedCodes.length;

  const updateStatus = trpc.accounts.updateInviteStatus.useMutation();

  const handleLaunch = async () => {
    if (concurrentCount === 0 || unusedCodes.length === 0) return;
    setLaunching(true);

    const selected = unusedCodes.slice(0, concurrentCount);
    let successCount = 0;

    for (const account of selected) {
      if (!account.inviteCode) continue;
      try {
        await updateStatus.mutateAsync({ inviteCode: account.inviteCode, status: "in_progress" });
        successCount++;
      } catch {
        // ignore
      }
    }

    await utils.accounts.unusedCodes.invalidate();
    await utils.dashboard.stats.invalidate();
    setLaunching(false);
    toast.success(`已标记 ${successCount} 个邀请码为「邀请中」，请在 AdsPower 中手动启动对应浏览器`);
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          并发任务控制
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
          <div>
            <p className="text-sm font-medium text-foreground">可用邀请码</p>
            <p className="text-xs text-muted-foreground mt-0.5">当前未使用的邀请码数量</p>
          </div>
          <span className="text-2xl font-bold text-primary">{maxConcurrent}</span>
        </div>

        {maxConcurrent === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-sm">
            暂无可用邀请码，请先导入账号
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">同时启动数量</Label>
                <span className="text-lg font-bold text-primary">{concurrentCount}</span>
              </div>
              <Slider
                value={[concurrentCount]}
                onValueChange={([v]) => setConcurrentCount(v)}
                min={1}
                max={maxConcurrent}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1 个</span>
                <span>全部 {maxConcurrent} 个</span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground space-y-1">
              <p className="text-foreground font-medium">将要执行：</p>
              <p>· 选取前 {concurrentCount} 个未使用邀请码</p>
              <p>· 状态改为「邀请中」</p>
              <p>· 调用 AdsPower API 创建 {concurrentCount} 个指纹浏览器</p>
              <p>· 插件自动在每个浏览器中执行注册流程</p>
            </div>

            <Button
              className="w-full"
              onClick={handleLaunch}
              disabled={launching || concurrentCount === 0}
            >
              {launching ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />启动中...</>
              ) : (
                <><Play className="w-4 h-4 mr-2" />同时启动 {concurrentCount} 个任务</>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Automation() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [confirmStop, setConfirmStop] = useState<number | null>(null);

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">自动化任务</h1>
          <p className="text-sm text-muted-foreground mt-1">管理 AdsPower 自动注册任务</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 并发控制面板 */}
        <div className="lg:col-span-1">
          <ConcurrentLaunchPanel />
        </div>

        {/* 任务列表 */}
        <div className="lg:col-span-2 space-y-3">
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
                        </div>
                        <AdsPowerStatus apiUrl={task.adspowerApiUrl ?? "http://local.adspower.net:50325"} />
                      </div>
                      <div className="flex gap-2 ml-3">
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
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/30">
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">{task.totalAccountsCreated ?? 0}</p>
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

                    <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                      <span>间隔：{task.scanIntervalSeconds}s</span>
                      <span>并发：{task.maxConcurrent}</span>
                      {task.lastExecutedAt && (
                        <span>最后执行：{new Date(task.lastExecutedAt).toLocaleString("zh-CN")}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      <CreateTaskDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => utils.automation.list.invalidate()}
      />

      <AlertDialog open={confirmStop !== null} onOpenChange={() => setConfirmStop(null)}>
        <AlertDialogContent className="bg-card border-border/50 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>确认停止任务</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              停止后任务将不再自动扫描邀请码，已在运行的浏览器实例不受影响。
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
    </div>
  );
}
