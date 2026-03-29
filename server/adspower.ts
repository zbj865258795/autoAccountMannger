/**
 * AdsPower API 集成服務
 * 文檔：https://documenter.getpostman.com/view/45822952/2sB2x5JDXn
 *
 * 核心功能：
 * 1. 每次創建瀏覽器時生成完全不同的隨機指紋
 * 2. 支持創建、啟動、關閉、刪除瀏覽器環境（v2 API）
 */

import axios from "axios";

// ─────────────────────────────────────────────
// 類型定義
// ─────────────────────────────────────────────

export interface AdsPowerConfig {
  apiUrl: string;       // e.g. http://local.adspower.net:50325
  apiKey?: string;      // Bearer Token（開啟安全校驗時必填）
  groupId?: string;     // 分組 ID，默認 "0"（未分組）
}

export interface CreateBrowserResult {
  success: boolean;
  profileId?: string;   // 創建成功後的環境 ID
  error?: string;
}

export interface StartBrowserResult {
  success: boolean;
  webdriverUrl?: string;
  wsEndpoint?: string;
  error?: string;
}

export interface BrowserStatus {
  browserId: string;
  status: "Active" | "Inactive";
}

// ─────────────────────────────────────────────
// 隨機工具函數
// ─────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomHex(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

// ─────────────────────────────────────────────
// 隨機指紋生成器
// 每次調用都產生完全不同的指紋組合，確保每個瀏覽器實例都是獨特的
// ─────────────────────────────────────────────

export function generateRandomFingerprint() {
  // 硬件並發數：隨機選 2/4/8/16
  const hardwareConcurrency = randomPick(["2", "4", "8", "16"]);

  // 設備內存：隨機選 2/4/8
  const deviceMemory = randomPick(["2", "4", "8"]);

  // 瀏覽器內核：隨機選 chrome 或 firefox
  const browserType = randomPick(["chrome", "firefox"]);

  // UA 系統版本：隨機選不同操作系統
  const uaSystemVersion = randomPick([
    ["Windows"],
    ["Mac"],
    ["Linux"],
    ["Android"],
  ]);

  // 時區：隨機選常見時區
  const timezone = randomPick([
    "America/New_York",
    "America/Los_Angeles",
    "America/Chicago",
    "America/Toronto",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Amsterdam",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Seoul",
    "Asia/Singapore",
    "Asia/Hong_Kong",
    "Australia/Sydney",
    "Pacific/Auckland",
  ]);

  // 語言：隨機選常見語言
  const language = randomPick([
    "en-US,en;q=0.9",
    "en-GB,en;q=0.9",
    "zh-CN,zh;q=0.9,en;q=0.8",
    "zh-TW,zh;q=0.9,en;q=0.8",
    "ja-JP,ja;q=0.9,en;q=0.8",
    "ko-KR,ko;q=0.9,en;q=0.8",
    "de-DE,de;q=0.9,en;q=0.8",
    "fr-FR,fr;q=0.9,en;q=0.8",
    "es-ES,es;q=0.9,en;q=0.8",
  ]);

  // 屏幕分辨率：隨機選常見分辨率
  const resolution = randomPick([
    "1920x1080",
    "1366x768",
    "1440x900",
    "1536x864",
    "1280x800",
    "1680x1050",
    "2560x1440",
    "1600x900",
    "1280x1024",
  ]);

  // 地理位置：隨機選常見城市坐標
  const location = randomPick([
    { longitude: "-74.0060", latitude: "40.7128", city: "New York" },
    { longitude: "-118.2437", latitude: "34.0522", city: "Los Angeles" },
    { longitude: "-87.6298", latitude: "41.8781", city: "Chicago" },
    { longitude: "-0.1276", latitude: "51.5074", city: "London" },
    { longitude: "2.3522", latitude: "48.8566", city: "Paris" },
    { longitude: "13.4050", latitude: "52.5200", city: "Berlin" },
    { longitude: "139.6917", latitude: "35.6895", city: "Tokyo" },
    { longitude: "121.4737", latitude: "31.2304", city: "Shanghai" },
    { longitude: "103.8198", latitude: "1.3521", city: "Singapore" },
    { longitude: "114.1694", latitude: "22.3193", city: "Hong Kong" },
    { longitude: "151.2093", latitude: "-33.8688", city: "Sydney" },
    { longitude: "37.6173", latitude: "55.7558", city: "Moscow" },
    { longitude: "72.8777", latitude: "19.0760", city: "Mumbai" },
  ]);

  // WebRTC 模式
  const webrtc = randomPick(["local", "proxy", "disabled"]);

  // GPU 模式
  const gpu = randomPick(["0", "1", "2"]);

  return {
    fingerprint_config: {
      // 自動時區（根據代理 IP 自動設置）
      automatic_timezone: "1",
      timezone,
      // Flash：阻止
      flash: "block",
      // 端口掃描保護
      scan_port_type: "1",
      // 地理位置
      location: "ask",
      location_switch: "1",
      accuracy: "1000",
      longitude: location.longitude,
      latitude: location.latitude,
      // Canvas 指紋：噪音模式（每次不同）
      canvas: "0",
      // WebGL 指紋：噪音模式
      webgl: "0",
      webgl_image: "0",
      // 音頻指紋：噪音模式
      audio: "0",
      // WebRTC
      webrtc,
      // 隱私
      do_not_track: randomPick(["true", "false"]),
      // 硬件信息（隨機）
      hardware_concurrency: hardwareConcurrency,
      device_memory: deviceMemory,
      gpu,
      // MAC 地址：隨機生成
      mac_address_config: {
        model: "1",   // 1 = 隨機生成
        address: "",
      },
      // 瀏覽器內核
      browser_kernel_config: {
        version: "latest",
        type: browserType,
      },
      // 隨機 User-Agent
      random_ua: {
        ua_system_version: uaSystemVersion,
      },
      // 語言
      language_switch: "1",
      languages: language,
      // 分辨率
      resolution,
    },
    _meta: {
      timezone,
      location: location.city,
      browserType,
      hardwareConcurrency,
      deviceMemory,
    },
  };
}

// ─────────────────────────────────────────────
// 創建 Axios 客戶端
// ─────────────────────────────────────────────

function createAxiosClient(config: AdsPowerConfig) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }
  return axios.create({
    baseURL: config.apiUrl,
    headers,
    timeout: 15000,
  });
}

// ─────────────────────────────────────────────
// 創建瀏覽器環境（隨機指紋，使用 v2 API）
// ─────────────────────────────────────────────

export async function createAdsPowerBrowser(
  config: AdsPowerConfig,
  inviteCode: string,
  options: {
    targetUrl?: string;
    proxyConfig?: {
      proxyType: string;
      host?: string;
      port?: string;
      user?: string;
      password?: string;
    };
  } = {}
): Promise<CreateBrowserResult> {
  const client = createAxiosClient(config);
  const { fingerprint_config, _meta } = generateRandomFingerprint();

  const profileName = `AutoReg_${inviteCode}_${randomHex(6)}`;
  const remark = `邀請碼: ${inviteCode} | ${_meta.browserType} | ${_meta.location} | ${new Date().toISOString()}`;

  // 目標 URL（帶邀請碼參數）
  const tabs: string[] = [];
  if (options.targetUrl) {
    try {
      const url = new URL(options.targetUrl);
      url.searchParams.set("invite_code", inviteCode);
      tabs.push(url.toString());
    } catch {
      tabs.push(options.targetUrl);
    }
  }

  const body: Record<string, unknown> = {
    name: profileName,
    group_id: config.groupId ?? "0",
    remark,
    fingerprint_config,
  };

  if (tabs.length > 0) {
    body.tabs = tabs;
  }

  // 代理配置
  if (options.proxyConfig && options.proxyConfig.proxyType !== "noproxy") {
    body.user_proxy_config = {
      proxy_soft: "other",
      proxy_type: options.proxyConfig.proxyType,
      proxy_host: options.proxyConfig.host ?? "",
      proxy_port: options.proxyConfig.port ?? "",
      proxy_user: options.proxyConfig.user ?? "",
      proxy_password: options.proxyConfig.password ?? "",
      global_config: "1",
    };
  }

  try {
    const response = await client.post("/api/v2/browser-profile/create", body);
    const data = response.data;

    if (data.code === 0 && data.data?.id) {
      console.log(`[AdsPower] 創建瀏覽器成功: ${data.data.id} | ${_meta.browserType} | ${_meta.location}`);
      return { success: true, profileId: data.data.id };
    } else {
      const errMsg = data.msg ?? `API 返回錯誤碼: ${data.code}`;
      console.error(`[AdsPower] 創建瀏覽器失敗: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AdsPower] 創建瀏覽器請求失敗: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// ─────────────────────────────────────────────
// 啟動瀏覽器
// ─────────────────────────────────────────────

export async function startAdsPowerBrowser(
  config: AdsPowerConfig,
  profileId: string
): Promise<StartBrowserResult> {
  const client = createAxiosClient(config);

  try {
    const response = await client.get("/api/v1/browser/start", {
      params: {
        user_id: profileId,
        open_tabs: 1,
        ip_tab: 0,
        new_first_tab: 0,
      },
    });
    const data = response.data;

    if (data.code === 0 && data.data) {
      console.log(`[AdsPower] 啟動瀏覽器成功: ${profileId}`);
      return {
        success: true,
        webdriverUrl: data.data.webdriver,
        wsEndpoint: data.data.ws?.puppeteer,
      };
    } else {
      const errMsg = data.msg ?? `啟動失敗，code: ${data.code}`;
      console.error(`[AdsPower] 啟動瀏覽器失敗: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AdsPower] 啟動瀏覽器請求失敗: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// ─────────────────────────────────────────────
// 關閉瀏覽器（不刪除環境）
// ─────────────────────────────────────────────

export async function closeAdsPowerBrowser(
  apiUrl: string,
  browserId: string
): Promise<boolean> {
  try {
    const response = await axios.get(`${apiUrl}/api/v1/browser/stop`, {
      params: { user_id: browserId },
      timeout: 10000,
    });
    return response.data?.code === 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// 刪除瀏覽器環境（v2 API，支持批量，單次最多 100 個）
// ─────────────────────────────────────────────

export async function deleteAdsPowerBrowsers(
  config: AdsPowerConfig,
  profileIds: string[]
): Promise<{ success: boolean; error?: string }> {
  if (profileIds.length === 0) return { success: true };

  const client = createAxiosClient(config);
  // 分批處理，每批最多 100 個
  const chunks = chunkArray(profileIds, 100);

  for (const chunk of chunks) {
    try {
      const response = await client.post("/api/v2/browser-profile/delete", {
        profile_id: chunk,
      });
      const data = response.data;

      if (data.code !== 0) {
        const errMsg = data.msg ?? `刪除失敗，code: ${data.code}`;
        console.error(`[AdsPower] 刪除瀏覽器失敗: ${errMsg}`);
        return { success: false, error: errMsg };
      }
      console.log(`[AdsPower] 刪除瀏覽器成功: ${chunk.join(", ")}`);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AdsPower] 刪除瀏覽器請求失敗: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  return { success: true };
}

// ─────────────────────────────────────────────
// 關閉並刪除瀏覽器（完整清理）
// ─────────────────────────────────────────────

export async function stopAndDeleteAdsPowerBrowser(
  config: AdsPowerConfig,
  profileId: string
): Promise<{ success: boolean; error?: string }> {
  // 先嘗試關閉（可能已關閉，忽略錯誤）
  await closeAdsPowerBrowser(config.apiUrl, profileId).catch(() => {});
  // 再刪除
  return deleteAdsPowerBrowsers(config, [profileId]);
}

// ─────────────────────────────────────────────
// 查詢已啟動的瀏覽器列表
// ─────────────────────────────────────────────

export async function getActiveBrowsers(apiUrl: string): Promise<BrowserStatus[]> {
  try {
    const response = await axios.get(`${apiUrl}/api/v1/browser/local-active`, {
      timeout: 5000,
    });
    if (response.data?.code === 0) {
      return (response.data?.data?.list || []).map((item: Record<string, unknown>) => ({
        browserId: String(item.user_id ?? ""),
        status: "Active" as const,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// 檢查 AdsPower 連通性
// ─────────────────────────────────────────────

export async function checkAdsPowerConnection(apiUrl: string, apiKey?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    // 使用查詢環境列表接口來檢查連通性
    const response = await axios.get(`${apiUrl}/api/v1/user/list`, {
      params: { page: 1, page_size: 1 },
      headers,
      timeout: 5000,
    });
    return response.data?.code === 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// 工具函數
// ─────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
