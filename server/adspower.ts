/**
 * AdsPower API 集成服务
 * 文档：https://localapi-doc-zh.adspower.net/
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

/** Chrome 主版本号池（本地已安装版本） */
const CHROME_VERSIONS = [
  "142", "143", "144", "145", "146",
];

/** Firefox 主版本号池 */
const FIREFOX_VERSIONS = [
  "115", "116", "117", "118", "119", "120",
  "121", "122", "123", "124", "125",
];

/** Windows 版本池（AdsPower random_ua 合法值） */
const WINDOWS_UA_VERSIONS = ["Windows 10", "Windows 11"];

/** Mac OS X 版本池（AdsPower random_ua 合法值） */
const MAC_UA_VERSIONS = [
  "Mac OS X 10", "Mac OS X 11", "Mac OS X 12", "Mac OS X 13",
];

/** 地区指纹配置：每个地区对应专属的时区、语言、城市池 */
const REGION_CONFIGS = {
  us: {
    timezones: [
      "America/New_York", "America/Los_Angeles", "America/Chicago",
      "America/Denver", "America/Phoenix", "America/Seattle",
      "America/Miami", "America/Boston", "America/Atlanta",
    ],
    languages: ["en-US", "en"],
    cities: [
      { city: "New York",     lat: 40.7128,  lon: -74.0060,  tz: "America/New_York" },
      { city: "Los Angeles",  lat: 34.0522,  lon: -118.2437, tz: "America/Los_Angeles" },
      { city: "Chicago",      lat: 41.8781,  lon: -87.6298,  tz: "America/Chicago" },
      { city: "Houston",      lat: 29.7604,  lon: -95.3698,  tz: "America/Chicago" },
      { city: "Phoenix",      lat: 33.4484,  lon: -112.0740, tz: "America/Phoenix" },
      { city: "Philadelphia", lat: 39.9526,  lon: -75.1652,  tz: "America/New_York" },
      { city: "San Antonio",  lat: 29.4241,  lon: -98.4936,  tz: "America/Chicago" },
      { city: "San Diego",    lat: 32.7157,  lon: -117.1611, tz: "America/Los_Angeles" },
      { city: "Dallas",       lat: 32.7767,  lon: -96.7970,  tz: "America/Chicago" },
      { city: "Seattle",      lat: 47.6062,  lon: -122.3321, tz: "America/Los_Angeles" },
    ],
  },
  tw: {
    timezones: ["Asia/Taipei"],
    languages: ["zh-TW", "zh", "en-US", "en"],
    cities: [
      { city: "Taipei",       lat: 25.0330,  lon: 121.5654,  tz: "Asia/Taipei" },
      { city: "New Taipei",   lat: 25.0169,  lon: 121.4628,  tz: "Asia/Taipei" },
      { city: "Taichung",     lat: 24.1477,  lon: 120.6736,  tz: "Asia/Taipei" },
      { city: "Kaohsiung",    lat: 22.6273,  lon: 120.3014,  tz: "Asia/Taipei" },
      { city: "Tainan",       lat: 22.9999,  lon: 120.2269,  tz: "Asia/Taipei" },
    ],
  },
  hk: {
    timezones: ["Asia/Hong_Kong"],
    languages: ["zh-HK", "zh", "en-US", "en"],
    cities: [
      { city: "Hong Kong",    lat: 22.3193,  lon: 114.1694,  tz: "Asia/Hong_Kong" },
      { city: "Kowloon",      lat: 22.3282,  lon: 114.1735,  tz: "Asia/Hong_Kong" },
      { city: "Tsuen Wan",    lat: 22.3707,  lon: 114.1146,  tz: "Asia/Hong_Kong" },
    ],
  },
  jp: {
    timezones: ["Asia/Tokyo"],
    languages: ["ja", "ja-JP", "en-US", "en"],
    cities: [
      { city: "Tokyo",        lat: 35.6895,  lon: 139.6917,  tz: "Asia/Tokyo" },
      { city: "Osaka",        lat: 34.6937,  lon: 135.5023,  tz: "Asia/Tokyo" },
      { city: "Nagoya",       lat: 35.1815,  lon: 136.9066,  tz: "Asia/Tokyo" },
      { city: "Yokohama",     lat: 35.4437,  lon: 139.6380,  tz: "Asia/Tokyo" },
      { city: "Sapporo",      lat: 43.0618,  lon: 141.3545,  tz: "Asia/Tokyo" },
      { city: "Fukuoka",      lat: 33.5904,  lon: 130.4017,  tz: "Asia/Tokyo" },
    ],
  },
} as const;

export type RegionCode = keyof typeof REGION_CONFIGS;

/**
 * 屏幕分辨率池（AdsPower 格式：宽_高）
 * 窗口大小与指纹分辨率保持一致，均为 Windows 10 常见分辨率
 * 对应的窗口大小：宽 = 分辨率宽 - 16，高 = 分辨率高 - 88（标题栏 + 任务栏）
 */
const RESOLUTIONS: Array<{ screen: string; windowWidth: number; windowHeight: number }> = [
  { screen: "1920_1080", windowWidth: 1904, windowHeight: 992 },
  { screen: "1366_768",  windowWidth: 1350, windowHeight: 680 },
  { screen: "1440_900",  windowWidth: 1424, windowHeight: 812 },
  { screen: "1536_864",  windowWidth: 1520, windowHeight: 776 },
  { screen: "1280_800",  windowWidth: 1264, windowHeight: 712 },
  { screen: "1600_900",  windowWidth: 1584, windowHeight: 812 },
  { screen: "1280_720",  windowWidth: 1264, windowHeight: 632 },
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

export function generateRandomFingerprint(region: RegionCode = "us") {
  const regionCfg = REGION_CONFIGS[region];

  // ── 1. 浏览器类型和版本 ────────────────────────────────────
  const browserType = "chrome" as "chrome" | "firefox";
  const chromeVersion = randomPick(CHROME_VERSIONS);
  const firefoxVersion = randomPick(FIREFOX_VERSIONS);
  const browserVersion = browserType === "chrome" ? chromeVersion : firefoxVersion;

  // ── 2. 操作系统 ────────────────────────────────────────
  const osType = randomPick(["windows", "windows", "windows", "mac", "linux"]);
  let uaSystemVersion: string[];
  if (osType === "windows") {
    uaSystemVersion = [randomPick(WINDOWS_UA_VERSIONS)];
  } else if (osType === "mac") {
    uaSystemVersion = [randomPick(MAC_UA_VERSIONS)];
  } else {
    uaSystemVersion = ["Linux"];
  }

  // ── 3. 城市/时区/地理坐标（根据地区选取）─────────────────────
  const cityInfo = randomPick([...regionCfg.cities] as Array<{ city: string; lat: number; lon: number; tz: string }>);
  const latOffset = randomFloat(-0.05, 0.05, 6);
  const lonOffset = randomFloat(-0.05, 0.05, 6);
  const finalLat = (cityInfo.lat + latOffset).toFixed(6);
  const finalLon = (cityInfo.lon + lonOffset).toFixed(6);
  const timezone = cityInfo.tz;

  // ── 4. 语言（根据地区配置）───────────────────────────────────────
  const language = [...regionCfg.languages] as string[];

  // ── 5. 屏幕分辨率 + 窗口大小（保持一致）──────────────────────
  const resolutionInfo = randomPick(RESOLUTIONS);

  // ── 6. 硬件参数 ──────────────────────────────
  // 文档支持：default, 2, 4, 6, 8, 16
  const hardwareConcurrency = randomPick(["2", "4", "4", "6", "8", "16"]);
  // 文档支持：default, 2, 4, 6, 8
  const deviceMemory = randomPick(["2", "4", "4", "8", "8"]);

  // ── 7. WebGL 厂商/渲染器 ─────────────────────
  const webglInfo = randomPick(WEBGL_VENDORS);

  // ── 8. 字体随机子集（从字体池中选 15-25 个） ──
  const fontCount = randomInt(15, 25);
  const fonts = randomSample(FONT_POOL, fontCount);

  // ── 9. 其他随机参数 ────────────────────────────────────────
  // WebRTC 固定为 disabled，防止泄露真实 IP
  const webrtc = "disabled";
  // 文档支持：0=使用本地设置, 1=开启硬件加速, 2=关闭硬件加速
  const gpu = randomPick(["0", "1"]);
  // 文档支持：default, true, false
  const doNotTrack = randomPick(["default", "true", "false"]);

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
      location_switch: "0",      // 0 = 手动指定位置
      accuracy: String(randomInt(10, 1000)),  // 精度随机（10-1000米）
      longitude: finalLon,
      latitude: finalLat,

      // ── 指纹噪音 ──
      // 文档：1=添加噪音(默认)，0=电脑默认 → 使用1增加指纹随机性
      canvas: "1",
      webgl_image: "1",
      audio: "1",

      // ── WebGL 元数据 ──
      // 文档：3=随机匹配(仅新建接口支持)，2=自定义，0=电脑默认
      // 使用 3 = 随机匹配，AdsPower 自动随机 WebGL 厂商/渲染器
      webgl: "3",

      // ── WebRTC ──
      webrtc,

      // ── 硬件信息 ──
      hardware_concurrency: hardwareConcurrency,
      device_memory: deviceMemory,
      gpu,

      // ── 屏幕分辨率（文档格式：宽_高，如 1920_1080）──
      screen_resolution: resolutionInfo.screen,

      // ── MAC 地址：随机生成 ──
      mac_address_config: {
        model: "1",   // 1 = 匹配合适的值代替真实的MAC地址
        address: "",
      },

      // ── 浏览器内核 ──
      // 文档：version 支持 "92","99","102","105","108","111","ua_auto"
      // "ua_auto" = 智能匹配（根据 UA 自动选择内核版本）
      browser_kernel_config: {
        version: "ua_auto",
        type: browserType,
      },

      // ── User-Agent（随机系统版本） ──
      // 文档 random_ua.ua_system_version 合法值：
      //   "Windows 10", "Windows 11", "Mac OS X 10"~"Mac OS X 13", "Linux"
      random_ua: {
        ua_browser: [browserType],
        ua_system_version: uaSystemVersion,
      },

      // ── 语言（文档要求字符串数组格式）──
      language_switch: "0",      // 0 = 不基于IP自动设置语言，使用自定义
      language: language,

      // ── 字体（随机子集） ──
      fonts,
    },
    _meta: {
      timezone,
      location: cityInfo.city,
      browserType,
      browserVersion,
      osType,
      uaSystemVersion: uaSystemVersion[0],
      hardwareConcurrency,
      deviceMemory,
      resolution: resolutionInfo.screen,
      windowWidth: resolutionInfo.windowWidth,
      windowHeight: resolutionInfo.windowHeight,
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
    timeout: 60000,  // ★ 修复：从 30s 增大到 60s，避免 AdsPower 响应慢时误超时
  });
}

// ─────────────────────────────────────────────
// 创建浏览器环境（随机指纹，使用 v2 API）
// POST /api/v2/browser-profile/create
// ─────────────────────────────────────────────

export async function createAdsPowerBrowser(
  config: AdsPowerConfig,
  inviteCode: string,
  options: {
    targetUrl?: string;
    region?: RegionCode;
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
  const { fingerprint_config, _meta } = generateRandomFingerprint(options.region ?? "us");

  const profileName = `AutoReg_${inviteCode}_${randomHex(8)}`;
  const remark = `邀请码: ${inviteCode} | ${_meta.browserType} | ${_meta.osType} | ${_meta.location} | ${_meta.resolution} | ${new Date().toISOString()}`;

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
    // 窗口大小与指纹分辨率保持一致，避免窗口大小异常
    open_width: _meta.windowWidth,
    open_height: _meta.windowHeight,
  };

  if (tabs.length > 0) {
    body.tabs = tabs;
  }

  // 代理配置
  // 文档：user_proxy_config 和 proxyid 二选一必填
  // proxy_soft 合法值：brightdata, brightauto, oxylabsauto, ipfoxyauto,
  //                    kookauto, lumiproxyauto, ssh, other, no_proxy
  if (options.proxyConfig && options.proxyConfig.proxyType !== "noproxy") {
    body.user_proxy_config = {
      proxy_soft: "other",
      proxy_type: options.proxyConfig.proxyType,  // http / https / socks5
      proxy_host: options.proxyConfig.host ?? "",
      proxy_port: options.proxyConfig.port ?? "",
      proxy_user: options.proxyConfig.user ?? "",
      proxy_password: options.proxyConfig.password ?? "",
    };
  } else {
    // 无代理：proxy_soft = "no_proxy"，不需要传 proxy_type
    body.user_proxy_config = {
      proxy_soft: "no_proxy",
    };
  }

  try {
    console.log(`[AdsPower] 创建浏览器请求: POST /api/v2/browser-profile/create`);
    console.log(`[AdsPower] 请求参数: ${JSON.stringify(body, null, 2)}`);

    const response = await client.post("/api/v2/browser-profile/create", body);
    const data = response.data;
    console.log(`[AdsPower] 创建浏览器响应: ${JSON.stringify(data)}`);

    // v2 API 返回 profile_id
    const profileId = data.data?.profile_id || data.data?.id;
    if (data.code === 0 && profileId) {
      console.log(`[AdsPower] 创建浏览器成功: ${profileId} | ${_meta.browserType} | ${_meta.osType} | ${_meta.uaSystemVersion} | ${_meta.location} | ${_meta.resolution}`);
      return { success: true, profileId };
    } else {
      const errMsg = data.msg ?? `API 返回错误码: ${data.code}`;
      console.error(`[AdsPower] 创建浏览器失败: ${errMsg} | 响应: ${JSON.stringify(data)}`);
      return { success: false, error: errMsg };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AdsPower] 创建浏览器请求异常: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// ─────────────────────────────────────────────
// 启动浏览器（v2 API）
// POST /api/v2/browser-profile/start
// ─────────────────────────────────────────────

export async function startAdsPowerBrowser(
  config: AdsPowerConfig,
  profileId: string
): Promise<StartBrowserResult> {
  const client = createAxiosClient(config);

  try {
    // v2 API 使用 POST + JSON body，参数名与 v1 不同：
    //   v1: user_id / ip_tab / open_tabs / new_first_tab
    //   v2: profile_id / proxy_detection / last_opened_tabs
    const response = await client.post("/api/v2/browser-profile/start", {
      profile_id: profileId,
      last_opened_tabs: "0",    // 0 = 不继续上次标签，每次从头开始
      proxy_detection: "1",     // 1 = 打开 IP 检测页（start.adspower.net 启动页）
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
// 关闭浏览器（v2 API，不删除环境）
// POST /api/v2/browser-profile/stop
// ─────────────────────────────────────────────

export async function closeAdsPowerBrowser(
  config: AdsPowerConfig,
  browserId: string
): Promise<boolean> {
  const client = createAxiosClient(config);
  try {
    // v2 API 使用 POST + JSON body，参数名从 user_id 改为 profile_id
    const response = await client.post("/api/v2/browser-profile/stop", {
      profile_id: browserId,
    }, { timeout: 30000 });  // ★ 修复：关闭浏览器超时从 10s 增大到 30s
    return response.data?.code === 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// 删除浏览器环境（v2 API，支持批量，单次最多 100 个）
// POST /api/v2/browser-profile/delete
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
  profileId: string,
  maxRetries = 3
): Promise<{ success: boolean; error?: string }> {
  // ★ 修复：增加重试机制，避免 AdsPower 偶发超时导致浏览器未被关闭
  // 先尝试关闭（可能已关闭，忽略错误）
  await closeAdsPowerBrowser(config, profileId).catch(() => {});

  // 带重试的删除
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await deleteAdsPowerBrowsers(config, [profileId]);
    if (result.success) {
      if (attempt > 1) {
        console.log(`[AdsPower] 删除浏览器 ${profileId} 成功（第 ${attempt} 次尝试）`);
      }
      return result;
    }
    lastError = result.error;
    console.warn(`[AdsPower] 删除浏览器 ${profileId} 第 ${attempt}/${maxRetries} 次失败: ${lastError}`);
    if (attempt < maxRetries) {
      // 等待后重试（指数退避：1s, 2s, 4s...）
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  console.error(`[AdsPower] 删除浏览器 ${profileId} 全部 ${maxRetries} 次尝试均失败，最后错误: ${lastError}`);
  return { success: false, error: lastError };
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
        // ★ 修复问题A：同时兼容 v1(user_id) 和 v2(profile_id) 字段名
        // v1 API 返回 user_id，v2 API 创建的浏览器在此接口可能返回 profile_id
        browserId: String(item.profile_id ?? item.user_id ?? ""),
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

export async function checkAdsPowerConnection(apiUrl: string, _apiKey?: string): Promise<boolean> {
  // ★ 修复：改用 /status 接口（无需 apiKey，专门用于连通性检测）
  // /api/v1/user/list 需要 apiKey 且可能因权限问题返回非 0 的 code，导致误判断为未连接
  const endpoints = [
    `${apiUrl}/status`,
    `${apiUrl}/api/v1/status`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(endpoint, { timeout: 5000 });
      // AdsPower 本地服务运行时，/status 返回 code=0 或 HTTP 200
      if (response.status === 200) {
        const code = response.data?.code;
        // code 为 0 或者接口本身就是健康检查接口（返回的 data 不含 code）
        if (code === 0 || code === undefined) return true;
      }
    } catch {
      // 尝试下一个接口
    }
  }

  // 最后尝试用原有 /api/v1/user/list 接口并宽松判断（HTTP 200 即认为连接）
  try {
    const response = await axios.get(`${apiUrl}/api/v1/user/list`, {
      params: { page: 1, page_size: 1 },
      timeout: 5000,
    });
    // 只要 HTTP 状态码 200 就认为连接成功（不再严格要求 code === 0）
    return response.status === 200;
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
