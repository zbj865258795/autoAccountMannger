import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
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
  CheckCircle2,
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
  idle: { label: "空閒", class: "border-gray-500/30 text-gray-400 bg-gray-500/10", icon: Clock },
  running: { label: "運行中", class: "border-green-500/30 text-green-400 bg-green-500/10", icon: Play },
  paused: { label: "已暫停", class: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10", icon: Pause },
  stopped: { label: "已停止", class: "border-red-500/30 text-red-400 bg-red-500/10", icon: Square },
};

function CreateTaskDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("自動注冊任務");
  const [interval, setInterval] = useState(60);
  const [apiUrl, setApiUrl] = useState("http://local.adspower.net:50325");
  const [groupId, setGroupId] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState(1);

  const createTask = trpc.automation.create.useMutation({
    onSuccess: () => {
      toast.success("任務已創建");
      onCreated();
      onClose();
    },
    onError: (err) => toast.error(`創建失敗：${err.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border/50 text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">創建自動化任務</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">任務名稱</Label>
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
              className="bg-muted/50 border-border/50 text-foreground font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">分組 ID（可選）</Label>
            <Input
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="AdsPower 瀏覽器分組 ID"
              className="bg-muted/50 border-border/50 text-foreground"
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">掃描間隔</Label>
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
              <span>10s</span><span>5分鐘</span>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">最大並發數</Label>
              <span className="text-sm font-medium text-foreground">{maxConcurrent} 個</span>
            </div>
            <Slider
              value={[maxConcurrent]}
              onValueChange={([v]) => setMaxConcurrent(v)}
              min={1}
              max={10}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              每次掃描最多同時啟動 {maxConcurrent} 個 AdsPower 瀏覽器實例
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={() => createTask.mutate({ name, scanIntervalSeconds: interval, adspowerApiUrl: apiUrl, adspowerGroupId: groupId || undefined, maxConcurrent })}
            disabled={createTask.isPending || !name.trim()}
          >
            {createTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            創建任務
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
          <span className="text-green-400">已連接</span>
          {(data.activeBrowsers?.length ?? 0) > 0 && (
            <span className="text-muted-foreground">· {data.activeBrowsers?.length} 個活躍瀏覽器</span>
          )}
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3 text-red-400" />
          <span className="text-red-400">未連接</span>
        </>
      )}
      <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground">
        <RefreshCw className="w-3 h-3" />
      </button>
    </div>
  );
}

// 並發啟動面板：選擇同時啟動幾個任務
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
    toast.success(`已標記 ${successCount} 個邀請碼為「邀請中」，請在 AdsPower 中手動啟動對應瀏覽器`);
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          並發任務控制
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
          <div>
            <p className="text-sm font-medium text-foreground">可用邀請碼</p>
            <p className="text-xs text-muted-foreground mt-0.5">當前未使用的邀請碼數量</p>
          </div>
          <span className="text-2xl font-bold text-primary">{maxConcurrent}</span>
        </div>

        {maxConcurrent === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-sm">
            暫無可用邀請碼，請先導入賬號
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">同時啟動數量</Label>
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
                <span>1 個</span>
                <span>全部 {maxConcurrent} 個</span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground space-y-1">
              <p className="text-foreground font-medium">將要執行：</p>
              <p>· 選取前 {concurrentCount} 個未使用邀請碼</p>
              <p>· 狀態改為「邀請中」</p>
              <p>· 調用 AdsPower API 創建 {concurrentCount} 個指紋瀏覽器</p>
              <p>· 插件自動在每個瀏覽器中執行注冊流程</p>
            </div>

            <Button
              className="w-full"
              onClick={handleLaunch}
              disabled={launching || concurrentCount === 0}
            >
              {launching ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />啟動中...</>
              ) : (
                <><Play className="w-4 h-4 mr-2" />同時啟動 {concurrentCount} 個任務</>
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
    onSuccess: () => { toast.success("任務已啟動"); utils.automation.list.invalidate(); },
    onError: (err) => toast.error(`啟動失敗：${err.message}`),
  });
  const pauseTask = trpc.automation.pause.useMutation({
    onSuccess: () => { toast.success("任務已暫停"); utils.automation.list.invalidate(); },
    onError: (err) => toast.error(`暫停失敗：${err.message}`),
  });
  const stopTask = trpc.automation.stop.useMutation({
    onSuccess: () => { toast.success("任務已停止"); utils.automation.list.invalidate(); setConfirmStop(null); },
    onError: (err) => toast.error(`停止失敗：${err.message}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">自動化任務</h1>
          <p className="text-sm text-muted-foreground mt-1">管理 AdsPower 自動注冊任務</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />刷新
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />新建任務
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 並發控制面板 */}
        <div className="lg:col-span-1">
          <ConcurrentLaunchPanel />
        </div>

        {/* 任務列表 */}
        <div className="lg:col-span-2 space-y-3">
          {isLoading ? (
            <Card className="bg-card border-border/50">
              <CardContent className="p-6 text-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p className="text-sm">加載中...</p>
              </CardContent>
            </Card>
          ) : tasks?.length === 0 ? (
            <Card className="bg-card border-border/50">
              <CardContent className="p-12 text-center text-muted-foreground">
                <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">暫無自動化任務</p>
                <p className="text-xs mt-1">點擊「新建任務」創建第一個自動化任務</p>
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
                            <Play className="w-3 h-3 mr-1" />啟動
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
                            <Pause className="w-3 h-3 mr-1" />暫停
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
                        <p className="text-xs text-muted-foreground">已創建賬號</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-green-400">{task.totalSuccess ?? 0}</p>
                        <p className="text-xs text-muted-foreground">成功次數</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-red-400">{task.totalFailed ?? 0}</p>
                        <p className="text-xs text-muted-foreground">失敗次數</p>
                      </div>
                    </div>

                    <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                      <span>間隔：{task.scanIntervalSeconds}s</span>
                      <span>並發：{task.maxConcurrent}</span>
                      {task.lastExecutedAt && (
                        <span>最後執行：{new Date(task.lastExecutedAt).toLocaleString("zh-TW")}</span>
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
            <AlertDialogTitle>確認停止任務</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              停止後任務將不再自動掃描邀請碼，已在運行的瀏覽器實例不受影響。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmStop !== null && stopTask.mutate({ id: confirmStop })}
              className="bg-destructive hover:bg-destructive/90"
            >
              確認停止
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
