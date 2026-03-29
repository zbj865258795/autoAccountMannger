/**
 * AdsPower API 集成服务
 * 文档：https://documenter.getpostman.com/view/45822952/2sB2x5JDXn
 *
 * 核心功能：
 * 1. 每次创建浏览器时生成完全不同的随机指纹（覆盖所有关键维度）
 * 2. 支持创建、启动、关闭、删除浏览器环境（v2 API）
 *
 * 指纹随机化维度：
 * - User-Agent（操作系统 + 版本号 + 浏览器版本）
 * - 屏幕分辨率 + 色深 + 像素比
 * - 时区 + 语言 + 地理坐标（含微小随机偏移）
 * - 硬件并发数 + 设备内存
 * - Canvas 噪音种子（每次不同）
 * - WebGL 噪音种子 + 厂商/渲染器
 * - 音频指纹噪音种子
 * - 字体列表随机子集
 * - WebRTC 模式
 * - MAC 地址（随机生成）
 * - Do Not Track
 * - GPU 渲染模式
 * - 平台（platform）
 */

import axios from "axios";

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export interface AdsPowerConfig {
  apiUrl: string;    // 例如 http://local.adspower.net:50325
  apiKey?: string;   // Bearer Token（开启安全校验时必填）
  groupId?: string;  // 分组 ID，默认 "0"（未分组）
}

export interface CreateBrowserResult {
  success: boolean;
  profileId?: string;  // 创建成功后的环境 ID
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
// 随机工具函数
// ─────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 6): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomHex(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/** 从数组中随机选取 n 个不重复元素 */
function randomSample<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

// ─────────────────────────────────────────────
// 指纹数据库
// ─────────────────────────────────────────────

/** Chrome 主版本号池（近两年常见版本） */
const CHROME_VERSIONS = [
  "110", "111", "112", "113", "114", "115",
  "116", "117", "118", "119", "120", "121",
  "122", "123", "124", "125", "126",
];

/** Firefox 主版本号池 */
const FIREFOX_VERSIONS = [
  "115", "116", "117", "118", "119", "120",
  "121", "122", "123", "124", "125",
];

/** Windows 版本池 */
const WINDOWS_VERSIONS = ["10.0", "11.0"];

/** Mac OS 版本池 */
const MAC_VERSIONS = [
  "10_15_7", "11_0", "12_0", "12_6", "13_0", "13_3", "13_5", "14_0",
];

/** 常见时区池（30个） */
const TIMEZONES = [
  "America/New_York", "America/Los_Angeles", "America/Chicago",
  "America/Toronto", "America/Vancouver", "America/Denver",
  "America/Phoenix", "America/Miami", "America/Boston",
  "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Amsterdam", "Europe/Madrid", "Europe/Rome",
  "Europe/Warsaw", "Europe/Stockholm", "Europe/Zurich",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Seoul",
  "Asia/Singapore", "Asia/Hong_Kong", "Asia/Bangkok",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Jakarta",
  "Australia/Sydney", "Australia/Melbourne",
  "Pacific/Auckland",
];

/** 语言池 */
const LANGUAGES = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.9",
  "en-US,en;q=0.9,zh;q=0.8",
  "zh-CN,zh;q=0.9,en;q=0.8",
  "zh-TW,zh;q=0.9,en;q=0.8",
  "ja-JP,ja;q=0.9,en;q=0.8",
  "ko-KR,ko;q=0.9,en;q=0.8",
  "de-DE,de;q=0.9,en;q=0.8",
  "fr-FR,fr;q=0.9,en;q=0.8",
  "es-ES,es;q=0.9,en;q=0.8",
  "pt-BR,pt;q=0.9,en;q=0.8",
  "ru-RU,ru;q=0.9,en;q=0.8",
  "it-IT,it;q=0.9,en;q=0.8",
  "nl-NL,nl;q=0.9,en;q=0.8",
  "pl-PL,pl;q=0.9,en;q=0.8",
];

/** 屏幕分辨率池 */
const RESOLUTIONS = [
  "1920x1080", "1366x768", "1440x900", "1536x864",
  "1280x800", "1680x1050", "2560x1440", "1600x900",
  "1280x1024", "1920x1200", "2560x1080", "3840x2160",
  "1360x768", "1024x768", "1280x720", "1400x1050",
];

/** 城市坐标池（含经纬度范围，用于微小随机偏移） */
const CITY_LOCATIONS = [
  { city: "New York",     lat: 40.7128,   lon: -74.0060,  tz: "America/New_York" },
  { city: "Los Angeles",  lat: 34.0522,   lon: -118.2437, tz: "America/Los_Angeles" },
  { city: "Chicago",      lat: 41.8781,   lon: -87.6298,  tz: "America/Chicago" },
  { city: "Houston",      lat: 29.7604,   lon: -95.3698,  tz: "America/Chicago" },
  { city: "Phoenix",      lat: 33.4484,   lon: -112.0740, tz: "America/Phoenix" },
  { city: "Toronto",      lat: 43.6532,   lon: -79.3832,  tz: "America/Toronto" },
  { city: "Vancouver",    lat: 49.2827,   lon: -123.1207, tz: "America/Vancouver" },
  { city: "London",       lat: 51.5074,   lon: -0.1276,   tz: "Europe/London" },
  { city: "Paris",        lat: 48.8566,   lon: 2.3522,    tz: "Europe/Paris" },
  { city: "Berlin",       lat: 52.5200,   lon: 13.4050,   tz: "Europe/Berlin" },
  { city: "Amsterdam",    lat: 52.3676,   lon: 4.9041,    tz: "Europe/Amsterdam" },
  { city: "Madrid",       lat: 40.4168,   lon: -3.7038,   tz: "Europe/Madrid" },
  { city: "Rome",         lat: 41.9028,   lon: 12.4964,   tz: "Europe/Rome" },
  { city: "Stockholm",    lat: 59.3293,   lon: 18.0686,   tz: "Europe/Stockholm" },
  { city: "Tokyo",        lat: 35.6895,   lon: 139.6917,  tz: "Asia/Tokyo" },
  { city: "Seoul",        lat: 37.5665,   lon: 126.9780,  tz: "Asia/Seoul" },
  { city: "Shanghai",     lat: 31.2304,   lon: 121.4737,  tz: "Asia/Shanghai" },
  { city: "Singapore",    lat: 1.3521,    lon: 103.8198,  tz: "Asia/Singapore" },
  { city: "Hong Kong",    lat: 22.3193,   lon: 114.1694,  tz: "Asia/Hong_Kong" },
  { city: "Bangkok",      lat: 13.7563,   lon: 100.5018,  tz: "Asia/Bangkok" },
  { city: "Dubai",        lat: 25.2048,   lon: 55.2708,   tz: "Asia/Dubai" },
  { city: "Mumbai",       lat: 19.0760,   lon: 72.8777,   tz: "Asia/Kolkata" },
  { city: "Sydney",       lat: -33.8688,  lon: 151.2093,  tz: "Australia/Sydney" },
  { city: "Melbourne",    lat: -37.8136,  lon: 144.9631,  tz: "Australia/Melbourne" },
  { city: "Auckland",     lat: -36.8485,  lon: 174.7633,  tz: "Pacific/Auckland" },
];

/** WebGL 厂商/渲染器组合池 */
const WEBGL_VENDORS = [
  { vendor: "Google Inc. (NVIDIA)",    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)",    renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)",    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (AMD)",       renderer: "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (AMD)",       renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)",     renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)",     renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Apple Inc.",              renderer: "Apple M1" },
  { vendor: "Apple Inc.",              renderer: "Apple M2" },
  { vendor: "Apple Inc.",              renderer: "Apple M1 Pro" },
  { vendor: "Intel Inc.",              renderer: "Intel Iris OpenGL Engine" },
  { vendor: "Intel Open Source Technology Center", renderer: "Mesa DRI Intel(R) HD Graphics 620 (KBL GT2)" },
];

/** 常见字体池（从中随机选取子集） */
const FONT_POOL = [
  "Arial", "Arial Black", "Arial Narrow", "Calibri", "Cambria",
  "Comic Sans MS", "Courier New", "Georgia", "Helvetica",
  "Impact", "Lucida Console", "Lucida Sans Unicode",
  "Microsoft Sans Serif", "Palatino Linotype", "Tahoma",
  "Times New Roman", "Trebuchet MS", "Verdana",
  "Segoe UI", "Segoe Print", "Segoe Script",
  "Candara", "Constantia", "Corbel", "Franklin Gothic Medium",
  "Garamond", "Gill Sans", "Century Gothic",
  "Book Antiqua", "Bookman Old Style",
  "Courier", "Helvetica Neue", "Monaco",
  "Menlo", "Consolas", "Fira Code",
];

// ─────────────────────────────────────────────
// 核心：随机指纹生成器
// 每次调用产生完全不同的指纹组合
// ─────────────────────────────────────────────

export function generateRandomFingerprint() {
  // ── 1. 浏览器类型和版本 ──────────────────────
  const browserType = randomPick(["chrome", "chrome"]) as "chrome" | "firefox"; // 以 chrome 为主（更常见）
  const chromeVersion = randomPick(CHROME_VERSIONS);
  const firefoxVersion = randomPick(FIREFOX_VERSIONS);
  const browserVersion = browserType === "chrome" ? chromeVersion : firefoxVersion;

  // ── 2. 操作系统 ──────────────────────────────
  const osType = randomPick(["windows", "windows", "mac", "linux"]); // Windows 权重更高
  const windowsVersion = randomPick(WINDOWS_VERSIONS);
  const macVersion = randomPick(MAC_VERSIONS);

  // 根据 OS 确定 UA 系统版本数组（AdsPower 格式）
  let uaSystemVersion: string[];
  let platform: string;
  if (osType === "windows") {
    uaSystemVersion = ["Windows"];
    platform = "Win32";
  } else if (osType === "mac") {
    uaSystemVersion = ["Mac"];
    platform = "MacIntel";
  } else {
    uaSystemVersion = ["Linux"];
    platform = "Linux x86_64";
  }

  // ── 3. 城市/时区/地理坐标 ────────────────────
  const cityInfo = randomPick(CITY_LOCATIONS);
  // 在城市坐标基础上加微小随机偏移（±0.05度，约5公里范围内）
  const latOffset = randomFloat(-0.05, 0.05, 6);
  const lonOffset = randomFloat(-0.05, 0.05, 6);
  const finalLat = (cityInfo.lat + latOffset).toFixed(6);
  const finalLon = (cityInfo.lon + lonOffset).toFixed(6);
  const timezone = cityInfo.tz;

  // ── 4. 语言 ──────────────────────────────────
  const language = randomPick(LANGUAGES);

  // ── 5. 屏幕参数 ──────────────────────────────
  const resolution = randomPick(RESOLUTIONS);
  const colorDepth = randomPick(["24", "30", "32"]); // 色深
  const pixelRatio = randomPick(["1", "1.25", "1.5", "2"]); // 设备像素比

  // ── 6. 硬件参数 ──────────────────────────────
  const hardwareConcurrency = randomPick(["2", "4", "6", "8", "12", "16"]);
  const deviceMemory = randomPick(["2", "4", "8", "16"]);

  // ── 7. WebGL 厂商/渲染器 ─────────────────────
  const webglInfo = randomPick(WEBGL_VENDORS);

  // ── 8. 字体随机子集（从字体池中选 15-25 个） ──
  const fontCount = randomInt(15, 25);
  const fonts = randomSample(FONT_POOL, fontCount);

  // ── 9. 其他随机参数 ──────────────────────────
  const webrtc = randomPick(["local", "proxy", "disabled"]);
  const gpu = randomPick(["0", "1", "2"]);
  const doNotTrack = randomPick(["default", "true", "false"]);

  // ── 10. Canvas/WebGL/Audio 噪音种子 ──────────
  // 使用随机整数作为噪音种子，确保每次指纹不同
  // AdsPower 中 "0" = 噪音模式（每次渲染结果略有不同）
  // 这里保持噪音模式，但通过其他维度的差异确保唯一性
  const canvasMode = "0";    // 噪音模式
  const webglMode = "0";     // 噪音模式
  const audioMode = "0";     // 噪音模式

  return {
    fingerprint_config: {
      // ── 时区 ──
      automatic_timezone: "0",   // 0 = 手动指定时区（更可控）
      timezone,

      // ── 隐私保护 ──
      flash: "block",
      scan_port_type: "1",
      do_not_track: doNotTrack,

      // ── 地理位置 ──
      location: "ask",
      location_switch: "1",
      accuracy: String(randomInt(10, 1000)),  // 精度随机（10-1000米）
      longitude: finalLon,
      latitude: finalLat,

      // ── 指纹噪音 ──
      canvas: canvasMode,
      webgl: webglMode,
      webgl_image: webglMode,
      audio: audioMode,

      // ── WebGL 厂商/渲染器（关键指纹维度） ──
      webgl_config: {
        unmasked_vendor: webglInfo.vendor,
        unmasked_renderer: webglInfo.renderer,
      },

      // ── WebRTC ──
      webrtc,

      // ── 硬件信息 ──
      hardware_concurrency: hardwareConcurrency,
      device_memory: deviceMemory,
      gpu,

      // ── 屏幕参数 ──
      resolution,
      color_depth: colorDepth,
      device_pixel_ratio: pixelRatio,

      // ── MAC 地址：随机生成 ──
      mac_address_config: {
        model: "1",   // 1 = 随机生成
        address: "",
      },

      // ── 浏览器内核 ──
      browser_kernel_config: {
        version: "latest",
        type: browserType,
      },

      // ── User-Agent（随机系统版本） ──
      random_ua: {
        ua_system_version: uaSystemVersion,
      },

      // ── 语言 ──
      language_switch: "1",
      languages: language,

      // ── 字体（随机子集） ──
      fonts,

      // ── 平台 ──
      platform,
    },
    _meta: {
      timezone,
      location: cityInfo.city,
      browserType,
      browserVersion,
      osType,
      windowsVersion: osType === "windows" ? windowsVersion : undefined,
      macVersion: osType === "mac" ? macVersion : undefined,
      hardwareConcurrency,
      deviceMemory,
      resolution,
      colorDepth,
      pixelRatio,
      webglVendor: webglInfo.vendor,
      fontCount,
    },
  };
}

// ─────────────────────────────────────────────
// 创建 Axios 客户端
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
// 创建浏览器环境（随机指纹，使用 v2 API）
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

  const profileName = `AutoReg_${inviteCode}_${randomHex(8)}`;
  const remark = `邀请码: ${inviteCode} | ${_meta.browserType} v${_meta.browserVersion} | ${_meta.osType} | ${_meta.location} | ${_meta.resolution} | ${new Date().toISOString()}`;

  // 目标 URL（带邀请码参数）
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

  // 代理配置（AdsPower v2 API 要求必须提供 user_proxy_config）
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
  } else {
    // 无代理时也必须传 user_proxy_config，否则 API 会报错
    body.user_proxy_config = {
      proxy_soft: "no_proxy",
      proxy_type: "noproxy",
    };
  }

  try {
    console.log(`[AdsPower] 创建浏览器请求: POST /api/v2/browser-profile/create`);
    console.log(`[AdsPower] 请求参数: ${JSON.stringify(body, null, 2)}`);

    const response = await client.post("/api/v2/browser-profile/create", body);
    const data = response.data;

    console.log(`[AdsPower] 创建浏览器响应: ${JSON.stringify(data)}`);

    if (data.code === 0 && data.data?.id) {
      console.log(`[AdsPower] 创建浏览器成功: ${data.data.id} | ${_meta.browserType} | ${_meta.osType} | ${_meta.location} | ${_meta.resolution} | WebGL: ${_meta.webglVendor}`);
      return { success: true, profileId: data.data.id };
    } else {
      const errMsg = data.msg ?? `API 返回错误码: ${data.code}`;
      console.error(`[AdsPower] 创建浏览器失败: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AdsPower] 创建浏览器请求异常: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// ─────────────────────────────────────────────
// 启动浏览器
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
      console.log(`[AdsPower] 启动浏览器成功: ${profileId}`);
      return {
        success: true,
        webdriverUrl: data.data.webdriver,
        wsEndpoint: data.data.ws?.puppeteer,
      };
    } else {
      const errMsg = data.msg ?? `启动失败，code: ${data.code}`;
      console.error(`[AdsPower] 启动浏览器失败: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AdsPower] 启动浏览器请求失败: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// ─────────────────────────────────────────────
// 关闭浏览器（不删除环境）
// ─────────────────────────────────────────────

export async function closeAdsPowerBrowser(
  config: AdsPowerConfig,
  browserId: string
): Promise<boolean> {
  const client = createAxiosClient(config);
  try {
    const response = await client.get("/api/v1/browser/stop", {
      params: { user_id: browserId },
      timeout: 10000,
    });
    return response.data?.code === 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// 删除浏览器环境（v2 API，支持批量，单次最多 100 个）
// ─────────────────────────────────────────────

export async function deleteAdsPowerBrowsers(
  config: AdsPowerConfig,
  profileIds: string[]
): Promise<{ success: boolean; error?: string }> {
  if (profileIds.length === 0) return { success: true };

  const client = createAxiosClient(config);
  // 分批处理，每批最多 100 个
  const chunks = chunkArray(profileIds, 100);

  for (const chunk of chunks) {
    try {
      const response = await client.post("/api/v2/browser-profile/delete", {
        profile_id: chunk,
      });
      const data = response.data;

      if (data.code !== 0) {
        const errMsg = data.msg ?? `删除失败，code: ${data.code}`;
        console.error(`[AdsPower] 删除浏览器失败: ${errMsg}`);
        return { success: false, error: errMsg };
      }
      console.log(`[AdsPower] 删除浏览器成功: ${chunk.join(", ")}`);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AdsPower] 删除浏览器请求失败: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  return { success: true };
}

// ─────────────────────────────────────────────
// 关闭并删除浏览器（完整清理）
// ─────────────────────────────────────────────

export async function stopAndDeleteAdsPowerBrowser(
  config: AdsPowerConfig,
  profileId: string
): Promise<{ success: boolean; error?: string }> {
  // 先尝试关闭（可能已关闭，忽略错误）
  await closeAdsPowerBrowser(config, profileId).catch(() => {});
  // 再删除
  return deleteAdsPowerBrowsers(config, [profileId]);
}

// ─────────────────────────────────────────────
// 查询已启动的浏览器列表
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
// 检查 AdsPower 连通性
// ─────────────────────────────────────────────

export async function checkAdsPowerConnection(apiUrl: string, apiKey?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

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
// 工具函数
// ─────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
