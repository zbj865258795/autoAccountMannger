/**
 * 注册自动化核心模块
 *
 * 通过 Playwright connectOverCDP 接管 AdsPower 已启动的浏览器，
 * 执行与 background.js 完全一致的注册流程：
 *
 * Step 0: 获取邀请码（原子锁，防并发重复）
 * Step 1: 购买邮箱（888-mail.com API）
 * Step 2: 生成密码
 * Step 3: 打开邀请链接
 * 阶段一: 邮箱输入 → 密码输入 → 邮箱验证码
 * 阶段二: 手机号输入 → 短信验证码
 * 完成:   刷新 + 兑换推广码 + 采集数据 + 上报后端
 */

import { chromium, type Browser, type Page } from "playwright";
import {
  claimNextInviteCode,
  resetInviteCodeStatus,
  getNextAvailablePhone,
  markPhoneUsedById,
  resetPhoneStatusById,
  releasePhoneIfNeeded,
  recordUsedIp,
  isIpUsed,
  updateTaskLog,
  incrementTaskCounters,
  saveRegistrationResult,
  appendStepLog,
} from "./db";
import { stopAndDeleteAdsPowerBrowser } from "./adspower";

// ─── 自定义错误类型 ───────────────────────────────────────────────────────────────────────────────

/**
 * 邀请码验证失败错误：由 finishRegistration 抛出，由 scheduler.ts 捕获后停止所有任务
 */
export class InviteCodeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteCodeFailedError";
  }
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────────────────

const BUY_EMAIL_API =
  "https://888-mail.com/api/goods/buy?key=45934c0edb8ada894890d349ba6405871d43ba0bd509a650336defca822b6d47&goods_code=77929&quantity=1";

const DIAL_TO_ISO: Record<string, string> = {
  "+1": "US", "+7": "RU", "+20": "EG", "+27": "ZA", "+30": "GR", "+31": "NL",
  "+32": "BE", "+33": "FR", "+34": "ES", "+36": "HU", "+39": "IT", "+40": "RO",
  "+41": "CH", "+43": "AT", "+44": "GB", "+45": "DK", "+46": "SE", "+47": "NO",
  "+48": "PL", "+49": "DE", "+51": "PE", "+52": "MX", "+53": "CU", "+54": "AR",
  "+55": "BR", "+56": "CL", "+57": "CO", "+58": "VE", "+60": "MY", "+61": "AU",
  "+62": "ID", "+63": "PH", "+64": "NZ", "+65": "SG", "+66": "TH", "+81": "JP",
  "+82": "KR", "+84": "VN", "+86": "CN", "+90": "TR", "+91": "IN", "+92": "PK",
  "+93": "AF", "+94": "LK", "+95": "MM", "+98": "IR", "+212": "MA", "+213": "DZ",
  "+216": "TN", "+218": "LY", "+220": "GM", "+221": "SN", "+234": "NG",
  "+249": "SD", "+254": "KE", "+255": "TZ", "+256": "UG", "+260": "ZM",
  "+263": "ZW", "+351": "PT", "+352": "LU", "+353": "IE", "+354": "IS",
  "+358": "FI", "+370": "LT", "+371": "LV", "+372": "EE", "+380": "UA",
  "+381": "RS", "+385": "HR", "+386": "SI", "+420": "CZ", "+421": "SK",
  "+852": "HK", "+853": "MO", "+855": "KH", "+856": "LA", "+880": "BD",
  "+886": "TW", "+960": "MV", "+961": "LB", "+962": "JO", "+963": "SY",
  "+964": "IQ", "+965": "KW", "+966": "SA", "+967": "YE", "+968": "OM",
  "+971": "AE", "+972": "IL", "+973": "BH", "+974": "QA", "+975": "BT",
  "+976": "MN", "+977": "NP", "+992": "TJ", "+993": "TM", "+994": "AZ",
  "+995": "GE", "+996": "KG", "+998": "UZ",
};

// ─── 参数类型 ─────────────────────────────────────────────────────────────────

export interface RegistrationParams {
  taskId: number;
  logId: number;
  profileId: string;          // AdsPower browser profile ID
  wsEndpoint: string;         // CDP WebSocket endpoint
  adspowerConfig: {
    apiUrl: string;
    apiKey?: string;
    groupId?: string;
  };
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 执行完整注册流程
 * 由 scheduler.ts 的 createOneBrowser 异步调用
 */
export async function runRegistration(params: RegistrationParams): Promise<void> {
  const { taskId, logId, profileId, wsEndpoint, adspowerConfig } = params;
  const startTime = Date.now();
  const log = makeLogger(taskId, profileId, logId);

  let browser: Browser | null = null;
  let inviterAccountId: number | null = null;
  let inviteCode: string | null = null;
  let capturedToken: string | null = null;
  // 标志位：是否已进入 /app 页面（用于激活 JS 屏蔽规则）
  let isOnAppPage = false;
  let capturedUserData = {
    membershipVersion: null as string | null,
    totalCredits: null as number | null,
    freeCredits: null as number | null,
    refreshCredits: null as number | null,
    inviteCode: null as string | null,
    clientId: null as string | null,
  };

  try {
    // ── 连接 AdsPower 浏览器 ──
    log("正在通过 CDP 连接 AdsPower 浏览器...");
    browser = await chromium.connectOverCDP(wsEndpoint, { timeout: 30000 });
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();

    // 关闭 AdsPower 自带的起始页（通常是 start.adspower.net），新建空白页面
    let pages = context.pages();
    for (const p of pages) {
      if (!p.isClosed()) {
        try { await p.close(); } catch { /* 忽略关闭失败 */ }
      }
    }
    let page = await context.newPage();
    log(`连接成功，已关闭 AdsPower 起始页并新建空白页面`, "info");

    // ── Step -1: 通过浏览器内部检测出口 IP（确保代理已生效，且 IP 与注册用 IP 完全一致）──
    log("正在通过浏览器检测出口 IP...");
    let detectedExitIp: string | undefined;
    try {
      const ipPage = await context.newPage();
      await ipPage.goto("https://ipv4.icanhazip.com", { waitUntil: "domcontentloaded", timeout: 20000 });
      const ipText = (await ipPage.textContent("body") ?? "").trim();
      await ipPage.close();
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipText)) {
        detectedExitIp = ipText;
        log(`出口 IP 检测成功：${detectedExitIp}`, "success");
        // 检查 IP 是否已使用过
        const used = await isIpUsed(detectedExitIp);
        if (used) {
          log(`出口 IP ${detectedExitIp} 已被使用过，跳过本次注册`, "warn");
          await updateTaskLog(logId, {
            status: "skipped",
            errorMessage: `出口IP ${detectedExitIp} 已被使用过，跳过本次注册`,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          });
          await cleanupBrowser(browser, adspowerConfig, profileId);
          return;
        }
        log(`出口 IP ${detectedExitIp} 未使用，继续注册`, "success");
      } else {
        log(`无法解析出口 IP（响应内容："${ipText}"），跳过 IP 检查继续注册`, "warn");
      }
    } catch (ipErr: any) {
      log(`出口 IP 检测失败：${ipErr.message}，跳过 IP 检查继续注册`, "warn");
    }

    // IP 检测使用单独的 ipPage，已关闭，主 page 始终保持有效
    // 确认 page 仍然有效，否则新建
    if (page.isClosed()) {
      page = await context.newPage();
      log("IP 检测后主页面已关闭，已新建空白页面", "info");
    }

    // ── 设置资源拦截（节省代理流量）──
    // 屏蔽图片、字体、广告追踪等不必要资源，保留 JS/CSS/Cloudflare 必要资源
    await context.route("**/*", (route) => {
      const req = route.request();
      const resourceType = req.resourceType();
      const url = req.url();

      // ── /app 页面专属屏蔽：进入 /app 后屏蔽所有 JS chunk，只放行 API 请求 ──
      // 原理：/app 页面的 JS 体积巨大（7MB+），加载耗时严重，但我们只需要用
      // page.evaluate 手动调用 API，完全不依赖页面 JS 执行，屏蔽后页面白屏无所谓
      if (isOnAppPage) {
        // 放行：api.manus.im 的所有接口请求（我们手动调用的目标）
        if (url.includes("api.manus.im")) {
          route.continue();
          return;
        }
        // 屏蔽：所有 JS 文件（chunk、vendor、frame 等）
        if (resourceType === "script") {
          route.abort();
          return;
        }
        // 屏蔽：CSS 样式文件（页面白屏无所谓）
        if (resourceType === "stylesheet") {
          route.abort();
          return;
        }
        // 屏蔽：图片、媒体、字体
        if (["image", "media", "font"].includes(resourceType)) {
          route.abort();
          return;
        }
        // 屏蔽：第三方 CDN 资源（Intercom、Sentry、音效等）
        const appBlockedDomains = [
          "intercom.io", "intercomcdn.com", "sentry.io", "sentry-cdn.com",
          "cloudfront.net", "manuscdn.com", "plausible.io",
          "amplitude.com", "segment.com", "mixpanel.com",
          "hotjar.com", "fullstory.com", "logrocket.com",
          "google-analytics.com", "googletagmanager.com",
        ];
        if (appBlockedDomains.some((d) => url.includes(d))) {
          route.abort();
          return;
        }
        // 其余请求（如 HTML 文档本身）放行
        route.continue();
        return;
      }

      // ── 注册流程页面（/login、/verify-phone）的通用屏蔽规则 ──
      // 屏蔽：字体文件（.woff2 / .ttf 等）
      if (resourceType === "font") {
        route.abort();
        return;
      }
      // 屏蔽：files.manuscdn.com 下的 CSS
      if (url.includes("files.manuscdn.com") && resourceType === "stylesheet") {
        route.abort();
        return;
      }
      // 屏蔽：files.manuscdn.com 下的图片（png/webp/gif）
      if (url.includes("files.manuscdn.com") && resourceType === "image") {
        route.abort();
        return;
      }
      // 屏蔽：d1oupeiobkpcny.cloudfront.net 下的 png/webp
      if (url.includes("d1oupeiobkpcny.cloudfront.net") && resourceType === "image") {
        route.abort();
        return;
      }
      // 屏蔽：favicon.ico
      if (url.includes("manus.im/favicon.ico")) {
        route.abort();
        return;
      }
      // 屏蔽：国旗 SVG 图标
      if (url.includes("purecatamphetamine.github.io/country-flag-icons")) {
        route.abort();
        return;
      }
      // 屏蔽：Facebook / connect.facebook.net 相关接口
      if (url.includes("connect.facebook.net") || url.includes("www.facebook.com")) {
        route.abort();
        return;
      }
      // 屏蔽：广告/追踪/分析域名
      const blockedDomains = [
        "google-analytics.com", "googletagmanager.com", "doubleclick.net",
        "twitter.com", "hotjar.com", "segment.com",
        "amplitude.com", "mixpanel.com", "intercom.io", "crisp.chat",
        "sentry.io", "bugsnag.com", "fullstory.com", "logrocket.com",
      ];
      if (blockedDomains.some((d) => url.includes(d))) {
        route.abort();
        return;
      }
      route.continue();
    });

    // ── 设置网络响应拦截（替代 chrome.debugger）──
    // UserInfo 403 标志位：/auth_landing 页面加载时如果 UserInfo 返回 403，说明账号注册即封禁
    const userInfoForbiddenRef = { value: false };  // 对象引用，可在回调和 handleLoginPage 之间共享
    setupResponseInterception(
      page,
      capturedUserData,
      (token) => {
        capturedToken = token;
        log(`[Token] 已捕获：${token.substring(0, 30)}...`);
      },
      undefined, // onSendPhoneError 由阶段二内部单独监听，这里不传
      undefined, // onBindPhoneSuccess 不需要，允许浏览器正常跳转到 /app
      () => {
        userInfoForbiddenRef.value = true;
        log("[UserInfo 403] 账号注册即封禁！", "error");
      }
    );

    // ── Step 0: 获取邀请码（原子锁）──
    log("正在获取邀请码...");
    const inviteCodeData = await claimNextInviteCode();
    if (!inviteCodeData) {
      log("暂无可用邀请码，跳过本次注册");
      await updateTaskLog(logId, {
        status: "skipped",
        errorMessage: "暂无可用邀请码",
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      });
      await cleanupBrowser(browser, adspowerConfig, profileId);
      return;
    }

    inviterAccountId = inviteCodeData.id;
    inviteCode = inviteCodeData.inviteCode!;
    const inviteUrl = `https://manus.im/invitation/${inviteCode}`;
    log(`邀请码获取成功：${inviteCode}`, "success");

    // ── Step 1: 生成密码（邮箱将在 /login 页面加载后再购买，避免浪费）──
    let email = "";       // 将在 handleLoginPage 内部购买后填入
    let codeUrl = "";     // 同上
    const password = "QingTian@2026";
    log(`密码已生成（固定密码）`);

    // ── Step 2: 打开邀请链接 ──
    log(`正在打开邀请链接：${inviteUrl}`);
    try {
      await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (gotoErr: any) {
      throw new Error(`打开邀请链接失败（代理网络错误）：${gotoErr.message}`);
    }

    // /invitation/xxx 页面会通过 JS 重定向到 /login，这个重定向发生在 domcontentloaded 之后
    // 不在这里等待 /login，交给 handleLoginPage 的 while 循环顶部统一处理
    // 这样无论网络多慢，都不会在重定向期间执行任何 evaluate
    log("邀请链接已打开，等待重定向到 /login 页面...");

    // ── 阶段一：login 页面 ──
    log("=== 阶段一：邮筱 + 密码 + 邮筱验证码 ===");
    // buyEmailFn 将在 /login 页面稳定、邮箱输入框出现后才被调用
    const buyEmailFn = async (): Promise<{ email: string; codeUrl: string }> => {
      const result = await buyEmail();
      email = result.email;     // 回写到外层变量，供 finishRegistration 使用
      codeUrl = result.codeUrl;
      return result;
    };
    const loginResult = await handleLoginPage(page, password, inviteUrl, log, buyEmailFn, userInfoForbiddenRef);

    if (loginResult === "banned") {
      // 账号注册即封禁，单独记录失败原因
      await resetInviteCodeStatus(inviterAccountId);
      throw new Error("账号注册即封禁（UserInfo 403）");
    }

    if (loginResult === "app") {
      // 直接跳到 /app，无需手机验证
      await finishRegistration(page, email, password, null, inviteCode, inviterAccountId, capturedToken, capturedUserData, taskId, logId, profileId, detectedExitIp, adspowerConfig, startTime, log, (v) => { isOnAppPage = v; });
      return;
    }

    if (loginResult !== "verify-phone") {
      await resetInviteCodeStatus(inviterAccountId);
      throw new Error(`阶段一异常结束: ${loginResult}`);
    }

    // ── 阶段二：verify-phone 页面 ──
    log("=== 阶段二：手机号 + 短信验证码 ===");
    const phoneResult = await handleVerifyPhonePage(page, logId, log);

    if (phoneResult.result === "app" && phoneResult.phoneInfo) {
      await finishRegistration(page, email, password, phoneResult.phoneInfo, inviteCode, inviterAccountId, capturedToken, capturedUserData, taskId, logId, profileId, detectedExitIp, adspowerConfig, startTime, log, (v) => { isOnAppPage = v; });
      return;
    }

    if (phoneResult.result === "no-phone") {
      await resetInviteCodeStatus(inviterAccountId);
      throw new Error("无法获取手机号，流程终止");
    }

    await resetInviteCodeStatus(inviterAccountId);
    throw new Error(`阶段二异常结束: ${phoneResult.result}`);

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`注册失败：${msg}`, "error");

    if (inviterAccountId) {
      await resetInviteCodeStatus(inviterAccountId).catch(() => {});
    }

    await updateTaskLog(logId, {
      status: "failed",
      errorMessage: msg,
      durationMs: Date.now() - startTime,
      completedAt: new Date(),
    });

    await incrementTaskCounters(taskId, { totalFailed: 1 });

    if (browser) {
      await cleanupBrowser(browser, adspowerConfig, profileId);
    }
  }
}

// ─── 网络响应拦截（替代 chrome.debugger）────────────────────────────────────

function setupResponseInterception(
  page: Page,
  capturedUserData: any,
  onToken: (token: string) => void,
  onSendPhoneError?: () => void,       // SendPhoneVerificationCode 失败回调
  onBindPhoneSuccess?: () => void,     // BindPhoneTrait 成功回调（用于停止页面跳转）
  onUserInfoForbidden?: () => void     // UserInfo 返回 403 回调（注册即封禁）
) {
  const WATCHED_APIS = [
    "RegisterByEmail",
    "GetUserPlatforms",
    "SendPhoneVerificationCode",
    "BindPhoneTrait",
    "SendEmailVerifyCodeWithCaptcha",
    "UserInfo",
    "GetAvailableCredits",
    "GetPersonalInvitationCodes",
  ];

  page.on("response", async (response) => {
    const url = response.url();
    const matchedApi = WATCHED_APIS.find((api) => url.includes(api));
    if (!matchedApi) return;

    try {
      const text = await response.text();

      if (matchedApi === "RegisterByEmail") {
        try {
          const json = JSON.parse(text);
          const token =
            json.token || json.accessToken || json.access_token ||
            json.jwt || json.sessionToken || json.session_token ||
            json.data?.token || json.data?.accessToken || json.data?.access_token;
          if (token) onToken(token);
        } catch {}
      }

      if (matchedApi === "UserInfo") {
        // TODO: gRPC-Web 接口的 HTTP status 永远是 200，真正的错误码在响应体的 JSON code 字段里。
        // 封禁时 Manus 返回的响应体格式待确认（需抓包被封账号的实际响应体），目前暂时注释掉 403 判断逻辑。
        // 待确认封禁响应体格式后，改为：
        //   const json = JSON.parse(text);
        //   if (json.code === 7 || json.code === 16) { // gRPC PERMISSION_DENIED / UNAUTHENTICATED
        //     if (onUserInfoForbidden) onUserInfoForbidden();
        //   }
        const userInfoStatus = response.status();
        if (userInfoStatus === 403) {
          // 暂时保留此判断，但 gRPC-Web 接口实际不会走到这里（HTTP status 永远是 200）
          if (onUserInfoForbidden) onUserInfoForbidden();
        } else {
          try {
            const json = JSON.parse(text);
            if (json.membershipVersion) capturedUserData.membershipVersion = json.membershipVersion;
          } catch {}
        }
      }

      if (matchedApi === "GetAvailableCredits") {
        try {
          const json = JSON.parse(text);
          if (json.totalCredits !== undefined) {
            capturedUserData.totalCredits = json.totalCredits;
            capturedUserData.freeCredits = json.freeCredits;
            capturedUserData.refreshCredits = json.refreshCredits ?? null;
          }
        } catch {}
      }

      if (matchedApi === "GetPersonalInvitationCodes") {
        try {
          const json = JSON.parse(text);
          const codes = json.invitationCodes || [];
          if (codes.length > 0 && codes[0].inviteCode) {
            capturedUserData.inviteCode = codes[0].inviteCode;
          }
        } catch {}
      }

      // SendPhoneVerificationCode 失败：重置发送状态，下次循环重新点击发送按钮
      if (matchedApi === "SendPhoneVerificationCode") {
        const status = response.status();
        if (status < 200 || status >= 300) {
          if (onSendPhoneError) onSendPhoneError();
        }
      }

      // BindPhoneTrait 成功：手机号绑定成功，触发回调停止页面跳转
      if (matchedApi === "BindPhoneTrait") {
        const status = response.status();
        if (status >= 200 && status < 300) {
          if (onBindPhoneSuccess) onBindPhoneSuccess();
        }
      }
    } catch {}
  });
}

// ─── 拟人化浏览行为 ──────────────────────────────────────────────────────────

/**
 * 页面加载后模拟真人浏览：随机鼠标漫游 + 偶尔轻微滚动
 * 让 Cloudflare Turnstile 的行为分析看起来像真实用户
 */
async function humanBrowse(page: Page): Promise<void> {
  try {
    // 随机鼠标漫游 2-4 次
    const moveCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < moveCount; i++) {
      const x = 200 + Math.random() * 1000;
      const y = 100 + Math.random() * 500;
      await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 15) });
      await sleep(300 + Math.random() * 600);
    }

    // 分段滚动模拟（触发 Plausible scroll depth + engagement 统计）
    // 每段滚动 25-40% 页面高度，共 3-4 段，最终达到 75-100% 滚动深度
    const pageHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => 800);
    const viewportHeight = await page.evaluate(() => window.innerHeight).catch(() => 600);
    const scrollableHeight = Math.max(0, pageHeight - viewportHeight);

    if (scrollableHeight > 50) {
      // 分 3-4 段向下滚动
      const segments = 3 + Math.floor(Math.random() * 2);
      const targetScrollRatio = 0.75 + Math.random() * 0.25; // 滚动到 75%-100%
      const totalScroll = scrollableHeight * targetScrollRatio;
      const segmentSize = totalScroll / segments;

      for (let seg = 0; seg < segments; seg++) {
        const delta = segmentSize * (0.8 + Math.random() * 0.4); // 每段小幅随机波动
        await page.mouse.wheel(0, delta);
        await sleep(600 + Math.random() * 800); // 每段停顿 0.6-1.4s，模拟阅读
        // 随机鼠标移动，模拟用户看内容
        await page.mouse.move(
          300 + Math.random() * 700,
          200 + Math.random() * 300,
          { steps: 5 + Math.floor(Math.random() * 8) }
        );
      }

      // 停留 1-2 秒（触发 Plausible engagement 时长统计）
      await sleep(1000 + Math.random() * 1000);

      // 分 2-3 段滚回顶部
      const upSegments = 2 + Math.floor(Math.random() * 2);
      const currentScroll = await page.evaluate(() => window.scrollY).catch(() => 0);
      const upSegmentSize = currentScroll / upSegments;
      for (let seg = 0; seg < upSegments; seg++) {
        await page.mouse.wheel(0, -upSegmentSize);
        await sleep(300 + Math.random() * 400);
      }
    } else {
      // 页面内容少（如 /login 登录页），轻微滚动即可
      const scrollY = 60 + Math.floor(Math.random() * 100);
      await page.mouse.wheel(0, scrollY);
      await sleep(500 + Math.random() * 600);
      await page.mouse.wheel(0, -scrollY);
      await sleep(300 + Math.random() * 300);
    }
  } catch {
    // 拟人化操作失败不影响主流程
  }
}

// ─── 阶段一：login 页面 ──────────────────────────────────────────────────────

async function handleLoginPage(
  page: Page,
  password: string,
  inviteUrl: string,
  log: Logger,
  buyEmailFn: () => Promise<{ email: string; codeUrl: string }>,
  userInfoForbiddenRef: { value: boolean }  // 共享引用，检测 UserInfo 403 封禁
): Promise<"verify-phone" | "app" | "timeout" | "error" | "banned"> {
  const PHASE_TIMEOUT = 180000;
  const MAX_REFRESHES = 3;
  const MAX_CHECK_REGION_FAILS = 3; // CheckInvitationCodeRemains 超时最多重试 3 次
  let refreshCount = 0;
  let checkRegionFailCount = 0; // CheckInvitationCodeRemains 超时计数器

  // email 和 codeUrl 将在页面稳定后购买获取
  let email = "";
  let codeUrl = "";
  let emailPurchased = false; // 标记是否已购买邮箱（全局仅购买一次）
  let emailBuyRetryCount = 0; // 邮箱购买失败重试次数（独立于 refreshCount）

  // ── API 请求发出时间戳（用于判断按鈕点击是否生效）──
  // 监听 request（不是 response），这样可以在请求发出的第一时间就知道按鈕点击已生效
  let sendEmailCodeRequestTime = 0;   // SendEmailVerifyCodeWithCaptcha 请求发出时间
  let registerByEmailRequestTime = 0; // RegisterByEmail 请求发出时间
  // 响应状态：0=未响应 1=成功(2xx) -1=失败(4xx/5xx) -2=403封禁
  let sendEmailCodeStatus = 0;   // SendEmailVerifyCodeWithCaptcha 响应状态
  let registerByEmailStatus = 0; // RegisterByEmail 响应状态
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("SendEmailVerifyCodeWithCaptcha")) {
      sendEmailCodeRequestTime = Date.now();
      sendEmailCodeStatus = 0;
      log("[请求监听] SendEmailVerifyCodeWithCaptcha 已发出，等待响应...");
    }
    if (url.includes("RegisterByEmail")) {
      registerByEmailRequestTime = Date.now();
      registerByEmailStatus = 0;
      log("[请求监听] RegisterByEmail 已发出，等待响应...");
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (url.includes("SendEmailVerifyCodeWithCaptcha")) {
      if (status >= 200 && status < 300) {
        sendEmailCodeStatus = 1;
        log(`[SendEmailVerifyCodeWithCaptcha] 响应成功 (${status})`);
      } else {
        sendEmailCodeStatus = -1;
        log(`[SendEmailVerifyCodeWithCaptcha] 响应失败 (${status})，需重新输入密码`, "warn");
      }
    }
    if (url.includes("RegisterByEmail")) {
      if (status >= 200 && status < 300) {
        registerByEmailStatus = 1;
        log(`[RegisterByEmail] 响应成功 (${status})，验证码已消耗`);
      } else {
        registerByEmailStatus = -1;
        log(`[RegisterByEmail] 响应失败 (${status})，验证码未消耗`, "warn");
      }
    }
  });

  // CheckInvitationCodeRemains 成功响应标志位（页面加载时自动触发，成功后才允许开始输入邮箱）
  // 每轮刷新前重置，确保每次重新加载页面后都能重新等待
  let checkInvitationCodeRemainsOk = false;
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (url.includes("CheckInvitationCodeRemains") && status >= 200 && status < 300) {
      checkInvitationCodeRemainsOk = true;
      log("[CheckInvitationCodeRemains] 接口返回成功，页面就绪");
    }
  });

  // API 错误监听（对齐插件的 getRecentApiError 机制）
  type ApiError = { api: string; status: number; time: number };
  let lastApiError: ApiError | null = null;
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (status >= 200 && status < 300) return;
    const WATCHED = ["GetUserPlatforms", "SendEmailVerifyCodeWithCaptcha", "RegisterByEmail"];
    for (const api of WATCHED) {
      if (url.includes(api)) {
        lastApiError = { api, status, time: Date.now() } as ApiError;
        log(`[API错误] ${api} 返回 ${status}`, "warn");
        break;
      }
    }
  });

  // 首次进入循环前先重置标志位（之后每次刷新页面前才重置，不在循环顶部重置）
  checkInvitationCodeRemainsOk = false;

  while (refreshCount <= MAX_REFRESHES) {

    // ── 等待顺序至关重要：先等 URL 稳定，再等 DOM 加载 ──
    // /invitation/xxx 会通过 JS 重定向到 /login，这个重定向发生在 domcontentloaded 之后
    // 如果先等 DOM 加载再等 URL，则 DOM 等待会在 /invitation/ 页面就通过，
    // 然后后续的 evaluate 操作会撞上正在进行的重定向，报 Execution context was destroyed
    //
    // 正确顺序：
    // 1. 先等 URL 稳定到 /login（这个不涉及 evaluate，不会被重定向破坏）
    // 2. 再等 DOM 加载完成（此时已在 /login 页面，不会再跳转）
    // 3. 不使用 waitForFunction(document.readyState)，因为它本质是 evaluate 轮询
    try {
      await page.waitForURL(
        (u: URL) => u.toString().includes("manus.im/login") || u.toString().includes("manus.im/register"),
        { timeout: 60000 }
      );
    } catch {
      const curUrl = page.url();
      log(`阶段一：等待 /login URL 超时，当前 URL：${curUrl}，继续尝试...`, "warn");
    }
    // URL 已稳定在 /login，现在安全地等待 DOM 加载
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch { /* 容错 */ }
    try {
      await page.waitForLoadState("networkidle", { timeout: 20000 });
    } catch { /* 网络慢时容错 */ }
    await sleep(1500);
    // 每轮开始清除上一轮遗留的 API 错误状态和响应状态（防止旧状态干扰当前轮）
    lastApiError = null;
    sendEmailCodeRequestTime = 0;
    sendEmailCodeStatus = 0;
    registerByEmailRequestTime = 0;
    registerByEmailStatus = 0;

    // ── 等待 CheckInvitationCodeRemains 接口成功响应（最多 15 秒）──
    // CheckInvitationCodeRemains 是页面加载时自动触发的，成功后才表示页面就绪，可以开始操作
    log("等待 CheckInvitationCodeRemains 接口成功响应...");
    const checkRegionStart = Date.now();
    while (!checkInvitationCodeRemainsOk && Date.now() - checkRegionStart < 15000) {
      await sleep(300);
    }
    if (!checkInvitationCodeRemainsOk) {
      checkRegionFailCount++;
      if (checkRegionFailCount > MAX_CHECK_REGION_FAILS) {
        log(`CheckInvitationCodeRemains 连续 ${MAX_CHECK_REGION_FAILS} 次未响应，本次注册失败`, "error");
        return "timeout";
      }
      log(`CheckInvitationCodeRemains 接口 15s 内未收到成功响应，刷新重试（第 ${checkRegionFailCount}/${MAX_CHECK_REGION_FAILS} 次）...`, "warn");
      const currentUrlOnCheckFail = page.url();
      // 刷新前先重置标志位，这样刷新过程中收到的响应不会被循环顶部覆盖
      checkInvitationCodeRemainsOk = false;
      try {
        await page.goto(currentUrlOnCheckFail, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (e: any) {
        log(`刷新失败：${e.message}`, "error");
        return "error";
      }
      try { await page.waitForLoadState("networkidle", { timeout: 20000 }); } catch { /* 容错 */ }
      continue;
    }

    // 页面加载后模拟真人浏览行为（随机滚动 + 鼠标漫游）
    await humanBrowse(page);

    // ── 在 /login 页面稳定后购买邮箱（仅购买一次）──
    // 必须确认邮箱输入框真实存在，才去购买邮箱；输入框不存在说明页面未正常加载，直接刷新重试
    if (!emailPurchased) {
      // 等待邮箱输入框出现（最多 30 秒）
      let emailInputVisible = false;
      try {
        await page.waitForSelector(
          'input#email[autocomplete="email"], input#email[type="email"], input#email',
          { state: "visible", timeout: 30000 }
        );
        emailInputVisible = true;
      } catch {
        log("等待邮箱输入框超时，页面可能未正常加载，刷新重试...", "warn");
      }
      if (!emailInputVisible) {
        // 邮箱输入框不存在，页面异常（如 Application error），直接刷新重试
        refreshCount++;
        if (refreshCount > MAX_REFRESHES) {
          log(`阶段一已刷新 ${MAX_REFRESHES} 次仍未完成，放弃`, "error");
          return "timeout";
        }
        const currentUrlOnEmailFail = page.url();
        log(`邮箱输入框未出现，第 ${refreshCount} 次刷新重试：${currentUrlOnEmailFail}`, "warn");
        checkInvitationCodeRemainsOk = false; // 刷新前重置，防止刷新过程中的响应被循环顶部覆盖
        try {
          await page.goto(currentUrlOnEmailFail, { waitUntil: "domcontentloaded", timeout: 30000 });
        } catch (e: any) {
          log(`刷新失败：${e.message}`, "error");
          return "error";
        }
        try { await page.waitForLoadState("networkidle", { timeout: 20000 }); } catch { /* 容错 */ }
        continue;
      }
      log("邮箱输入框已出现，正在购买邮箱...");
      try {
        const result = await buyEmailFn();
        email = result.email;
        codeUrl = result.codeUrl;
        emailPurchased = true;
        log(`邮箱购买成功：${email}`, "success");
      } catch (buyErr: any) {
        emailBuyRetryCount++;
        log(`邮箱购买失败（第 ${emailBuyRetryCount} 次）：${buyErr.message}，等待重试...`, "error");
        if (emailBuyRetryCount > 3) {
          log(`邮箱购买失败已超过 3 次，放弃`, "error");
          return "error";
        }
        await sleep(2000);
        continue;
      }
    }

    let emailFilled = false;
    let emailContinueClicked = false;
    let emailBtnClickTime = 0;        // 邮筱 Continue 按钮点击时间（等待 SendEmailVerifyCodeWithCaptcha 请求发出）
    let emailBtnRetryCount = 0;       // 邮筱按钮点击后 3s 无请求的重试次数
    let pwdFilled = false;
    let pwdContinueClicked = false;
    let pwdBtnClickTime = 0;          // 密码 Continue 按钮点击时间（等待 SendEmailVerifyCodeWithCaptcha 请求发出）
    let pwdBtnRetryCount = 0;         // 密码按钮点击后 3s 无请求的重试次数
    let verifyCodeFetching = false;
    let verifyCodeDone = false; // fetchVerifyCode 已完成（无论成功还是失败）
    let verifyCode: string | null = null;
    let verifyCodeFilled = false;
    let verifyBtnClickTime = 0;       // 验证码确认按钮点击时间（等待 RegisterByEmail 请求发出）
    let verifyBtnRetryCount = 0;      // 验证码按钮点击后 3s 无请求的重试次数
    let verifyConfirmClicked = false;  // 插件的 verifyConfirmClicked 标志
    let stepStallCount = 0;
    const roundStart = Date.now();
    // 每轮开始重置请求时间戳（防止上一轮的旧请求干扰当前轮）
    sendEmailCodeRequestTime = 0;
    registerByEmailRequestTime = 0;

    for (let i = 0; i < 300; i++) {
      await sleep(1000);

      if (Date.now() - roundStart > PHASE_TIMEOUT) {
        log("阶段一超时，正在刷新重试...", "warn");
        break;
      }

      // ── URL 守卫：确保当前在 /login 或 /register 页面且页面加载完成 ──
      const currentUrl1 = page.url();

      // 页面导航中（二次跳转），等待页面稳定后再操作
      if (currentUrl1 === "about:blank" || currentUrl1 === "") {
        await sleep(1000);
        continue;
      }

      // 已跳转到下一阶段页面 → 提前返回成功
      if (currentUrl1.includes("manus.im/verify-phone")) {
        log("检测到页面已跳转到 /verify-phone，阶段一完成");
        return "verify-phone";
      }
      if (currentUrl1.includes("manus.im/app")) {
        log("检测到页面已跳转到 /app，阶段一完成");
        return "app";
      }
      if (currentUrl1.includes("manus.im/auth_landing")) {
        log("检测到 auth_landing 中转页，等待 UserInfo 响应和最终跳转...");
        await sleep(5000);
        if (userInfoForbiddenRef.value) {
          log("账号注册即封禁（UserInfo 403），本次注册失败", "error");
          return "banned";
        }
        try {
          await page.waitForURL((url: URL) => url.toString().includes("manus.im/") && !url.toString().includes("auth_landing"), { timeout: 55000 });
          const landingUrl = page.url();
          if (userInfoForbiddenRef.value) {
            log("账号注册即封禁（UserInfo 403），本次注册失败", "error");
            return "banned";
          }
          if (landingUrl.includes("manus.im/verify-phone")) return "verify-phone";
          if (landingUrl.includes("manus.im/app")) return "app";
        } catch {
          log("auth_landing 跳转超时", "warn");
        }
        continue;
      }

      // 不在预期页面（既不是 /login 也不是 /register）→ 等待跳转或刷新
      if (!currentUrl1.includes("manus.im/login") && !currentUrl1.includes("manus.im/register")) {
        log(`当前不在 /login 页面（URL: ${currentUrl1}），等待页面跳转...`, "warn");
        await sleep(2000);
        continue;
      }

      // API 错误处理（对齐插件的 getRecentApiError 机制）
      const _err1 = lastApiError as ApiError | null;
      if (_err1 && (Date.now() - _err1.time) < 5000) {
        lastApiError = null;
        log(`[API错误] ${_err1.api} 返回 ${_err1.status}，等待 3 秒后重试...`, "warn");
        if (_err1.api === "GetUserPlatforms") {
          // 插件逻辑：GetUserPlatforms 失败时同时重置 emailFilled 和 emailContinueClicked
          emailFilled = false;
          emailContinueClicked = false;
        } else if (_err1.api === "SendEmailVerifyCodeWithCaptcha") {
          pwdContinueClicked = false;
        } else if (_err1.api === "RegisterByEmail") {
          verifyConfirmClicked = false;
          verifyCodeFilled = false;
        }
        await sleep(3000);
        continue;
      }

      // 1. 输入邮箱
      if (!emailFilled) {
        try {
          log("正在填写邮箱...");
          await simulateMouseMove(page, 'input#email[autocomplete="email"], input#email[type="email"], input#email');
          const ok = await typeIntoField(page, 'input#email[autocomplete="email"], input#email[type="email"], input#email', email);
          if (ok) {
            emailFilled = true;
            stepStallCount = 0;
            log(`邮箱已填写：${email}`, "success");
          } else {
            stepStallCount++;
            if (stepStallCount >= 60) { log("邮筱输入框持续干不上，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤1（输入邮箱）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // 2. 点击邮箱 Continue
      // 判断成功依据：SendEmailVerifyCodeWithCaptcha 请求是否发出
      // 注意：邮箱步骤有第三方验证（Cloudflare Turnstile），按钮 disabled 时只能等待，不能清空输入框
      if (!emailContinueClicked) {
        // SendEmailVerifyCodeWithCaptcha 已发出 → 按钮点击已生效
        if (sendEmailCodeRequestTime > 0) {
          emailContinueClicked = true;
          sendEmailCodeRequestTime = 0; // 重置，让步骤4能独立判断新的请求
          stepStallCount = 0;
          log("邮箱 Continue 已生效（SendEmailVerifyCodeWithCaptcha 已发出）", "success");
          continue;
        }

        try {
          await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
          const btnState = await page.evaluate(() => {
            const pwdEl = document.querySelector('input[name="password"][type="password"]') as HTMLElement | null;
            const inEmailStep = !pwdEl || pwdEl.classList.contains("hidden") || pwdEl.offsetParent === null;
            if (!inEmailStep) return "already-passed";
            const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
            if (!btn || btn.offsetParent === null) return "no-button";
            if (btn.disabled) return "disabled";
            return "clickable";
          });

          if (btnState === "already-passed") {
            emailContinueClicked = true;
            sendEmailCodeRequestTime = 0; // 重置，让步骤4能独立判断新的请求
            stepStallCount = 0;
            log("邮箱步骤已通过（密码框已出现）", "success");
            await sleep(500);
          } else if (btnState === "disabled") {
            // 第三方验证未完成，只能等待，不能清空输入框
            emailBtnRetryCount++;
            if (emailBtnRetryCount > 60) {
              log("邮箱按钮持续 disabled（第三方验证超时），刷新重试...", "warn"); break;
            }
            if (emailBtnRetryCount % 10 === 0) log(`等待第三方验证完成（已等 ${emailBtnRetryCount}s）...`, "warn");
          } else if (btnState === "clickable") {
            await page.evaluate(async () => {
              const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
              if (btn) { await new Promise((r) => setTimeout(r, 800)); btn.click(); }
            });
            emailBtnClickTime = Date.now();
            log("邮箱 Continue 按钮已点击，等待 SendEmailVerifyCodeWithCaptcha 请求...", "success");
          } else {
            stepStallCount++;
            if (stepStallCount >= 60) { log("邮箱 Continue 按钮持续不可用，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤2（邮箱 Continue）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // 3. 输入密码
      if (!pwdFilled) {
        try {
          await simulateMouseMove(page, 'input[name="password"][type="password"]');
          const ok = await typeIntoField(page, 'input[name="password"][type="password"]', password);
          if (ok) {
            pwdFilled = true;
            stepStallCount = 0;
            log("密码已填写", "success");
          } else {
            stepStallCount++;
            if (stepStallCount >= 60) { log("密码输入框持续干不上，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤3（输入密码）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // 4. 点击密码 Continue
      // 判断成功依据：SendEmailVerifyCodeWithCaptcha 响应成功（密码提交触发发送验证码）
      // 响应失败时清空密码重新输入
      if (!pwdContinueClicked) {
        // SendEmailVerifyCodeWithCaptcha 已发出 → 等待响应后再判断
        if (sendEmailCodeRequestTime > 0) {
          // 等待最多 10 秒让响应到达
          const waitSendStart = Date.now();
          while (sendEmailCodeStatus === 0 && Date.now() - waitSendStart < 10000) {
            await sleep(200);
          }
          if (sendEmailCodeStatus === -1) {
            // 响应失败，清空密码重新输入
            log("SendEmailVerifyCodeWithCaptcha 响应失败，清空密码重新输入...", "warn");
            sendEmailCodeRequestTime = 0;
            sendEmailCodeStatus = 0;
            pwdContinueClicked = false;
            pwdFilled = false;
            pwdBtnClickTime = 0;
            try {
              await clearField(page, 'input[name="password"][type="password"]');
            } catch { /* 容错 */ }
            continue;
          }
          // 响应成功（或 10s 超时未收到响应，按成功处理）
          pwdContinueClicked = true;
          stepStallCount = 0;
          log("密码 Continue 已生效（SendEmailVerifyCodeWithCaptcha 响应成功）", "success");
          // 开始后台获取邮箱验证码
          if (!verifyCodeFetching) {
            verifyCodeFetching = true;
            fetchVerifyCode(codeUrl).then((code) => {
              verifyCode = code;
              verifyCodeDone = true;
              if (code) log(`邮箱验证码已就绪：${code}`, "success");
              else log("邮箱验证码获取超时", "warn");
            });
          }
          continue;
        }

        // 如果已点击按钮且超过 3s 仍无请求 → 清空密码重新输入
        if (pwdBtnClickTime > 0 && Date.now() - pwdBtnClickTime > 3000) {
          log(`密码 Continue 点击后 3s 无 SendEmailVerifyCodeWithCaptcha 请求，清空密码重新输入（第 ${pwdBtnRetryCount + 1} 次）...`, "warn");
          pwdBtnRetryCount++;
          if (pwdBtnRetryCount > 5) {
            log("密码 Continue 多次无效，刷新重试...", "warn"); break;
          }
          try {
            await clearField(page, 'input[name="password"][type="password"]');
          } catch (e: any) {
            log(`清空密码输入框异常：${e.message}`, "warn");
          }
          pwdFilled = false;
          pwdBtnClickTime = 0;
          continue;
        }

        try {
          await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
          const pwdBtnState = await page.evaluate(() => {
            const pwdEl = document.querySelector('input[name="password"][type="password"]') as HTMLElement | null;
            const inPwdStep = pwdEl && !pwdEl.classList.contains("hidden") && pwdEl.offsetParent !== null;
            if (!inPwdStep) return "not-in-pwd-step";
            const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
            if (!btn || btn.offsetParent === null) return "no-button";
            if (btn.disabled) return "disabled";
            return "clickable";
          });

          if (pwdBtnState === "not-in-pwd-step") {
            pwdContinueClicked = true;
            stepStallCount = 0;
            log("密码步骤已通过（验证码框已出现）", "success");
            await sleep(500);
          } else if (pwdBtnState === "disabled") {
            pwdBtnRetryCount++;
            if (pwdBtnRetryCount > 30) {
              log("密码按钮持续 disabled，刷新重试...", "warn"); break;
            }
            if (pwdBtnRetryCount % 5 === 0) log(`密码按钮持续 disabled，等待中（第 ${pwdBtnRetryCount}s）...`, "warn");
          } else if (pwdBtnState === "clickable") {
            await page.evaluate(async () => {
              const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
              if (btn) { await new Promise((r) => setTimeout(r, 800)); btn.click(); }
            });
            pwdBtnClickTime = Date.now();
            log("密码 Continue 按钮已点击，等待 SendEmailVerifyCodeWithCaptcha 请求（3s 内无请求将清空重输）...", "success");
          } else {
            stepStallCount++;
            if (stepStallCount >= 60) { log("密码 Continue 按钮持续不可用，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤4（密码 Continue）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // 5. 填入邮箱验证码
      if (!verifyCodeFilled) {
        try {
          const verifyVisible = await page.evaluate(() => {
            const el = document.querySelector('input#verifyCode[name="verifyCode"]') as HTMLElement | null;
            return !!(el && el.offsetParent !== null);
          });
          if (verifyVisible) {
            if (verifyCode) {
              await simulateMouseMove(page, 'input#verifyCode[name="verifyCode"]');
              const ok = await typeIntoField(page, 'input#verifyCode[name="verifyCode"]', verifyCode);
              if (ok) {
                verifyCodeFilled = true;
                stepStallCount = 0;
                log(`邮箱验证码已填入：${verifyCode}`);
                await sleep(800);
              }
            } else if (verifyCodeDone && verifyCode === null) {
              // fetchVerifyCode 已返回 null（获取超时），继续等待无意义，直接刷新重试
              log("邮箱验证码获取超时，刷新重试...", "warn");
              break;
            } else {
              if (i % 5 === 0) log("等待邮箱验证码...");
            }
          } else {
            stepStallCount++;
            if (stepStallCount >= 60) { log("邮筱验证码输入框持续干不上，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤5（填入邮箱验证码）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // 6. 点击验证码确认
      // 判断成功依据：RegisterByEmail 请求是否发出
      // 如果点击后 3s 内无请求发出，清空验证码重新输入再点击
      if (!verifyConfirmClicked) {
        // RegisterByEmail 已发出 → 等待响应后再判断是否消耗了验证码
        if (registerByEmailRequestTime > 0) {
          // 等待最多 10 秒让响应到达
          const waitStart = Date.now();
          while (registerByEmailStatus === 0 && Date.now() - waitStart < 10000) {
            await sleep(200);
          }

          if (registerByEmailStatus === -1) {
            // 响应失败（服务端拒绝或网络错误）——验证码未消耗，重新输入验证码再试
            log("RegisterByEmail 响应失败，验证码未消耗，清空重新输入...", "warn");
            registerByEmailRequestTime = 0;
            registerByEmailStatus = 0;
            verifyConfirmClicked = false;
            verifyCodeFilled = false;
            verifyBtnClickTime = 0;
            try {
              await clearField(page, 'input#verifyCode[name="verifyCode"]');
            } catch { /* 容错 */ }
            continue;
          }

          // 响应成功 (status===1) 或 10s 超时未收到响应（按成功处理）
          verifyConfirmClicked = true;
          stepStallCount = 0;
          log("验证码确认已生效（RegisterByEmail 响应成功），等待页面跳转...");
          try {
            await page.waitForURL((url: URL) => url.toString().includes("manus.im/") && !url.toString().includes("manus.im/login") && !url.toString().includes("manus.im/register"), { timeout: 30000 });
            const navUrl = page.url();
            log(`页面已跳转至：${navUrl}`);
            if (navUrl.includes("manus.im/verify-phone")) {
              log("阶段一完成 → 跳转至手机验证页");
              return "verify-phone";
            }
            if (navUrl.includes("manus.im/app")) {
              log("阶段一完成 → 直接进入 /app（无需手机验证）");
              return "app";
            }
            if (navUrl.includes("manus.im/auth_landing")) {
              log("检测到 auth_landing 中转页，等待 UserInfo 响应和最终跳转...");
              await sleep(5000);
              if (userInfoForbiddenRef.value) {
                log("账号注册即封禁（UserInfo 403），本次注册失败", "error");
                return "banned";
              }
              try {
                await page.waitForURL((url: URL) => url.toString().includes("manus.im/") && !url.toString().includes("auth_landing"), { timeout: 55000 });
              } catch { /* 超时容错 */ }
              const finalUrl = page.url();
              if (userInfoForbiddenRef.value) {
                log("账号注册即封禁（UserInfo 403），本次注册失败", "error");
                return "banned";
              }
              if (finalUrl.includes("manus.im/verify-phone")) return "verify-phone";
              if (finalUrl.includes("manus.im/app")) return "app";
              log(`auth_landing 后跳转到未知页面：${finalUrl}`, "warn");
              break;
            }
            log(`跳转到未知目标页面：${navUrl}`, "warn");
            break;
          } catch {
            // RegisterByEmail 已成功响应但页面 30s 内未跳转，验证码已消耗，刷新重试
            log("RegisterByEmail 已成功但页面 30s 内未跳转（验证码已消耗），刷新重试...", "warn");
            break;
          }
          continue;
        }

        // 如果已点击按钮且超过 3s 仍无 RegisterByEmail 请求 → 清空验证码重新输入
        if (verifyBtnClickTime > 0 && Date.now() - verifyBtnClickTime > 3000) {
          log(`验证码确认点击后 3s 无 RegisterByEmail 请求，清空验证码重新输入（第 ${verifyBtnRetryCount + 1} 次）...`, "warn");
          verifyBtnRetryCount++;
          if (verifyBtnRetryCount > 5) {
            log("验证码确认多次无效，刷新重试...", "warn"); break;
          }
          try {
            await clearField(page, 'input#verifyCode[name="verifyCode"]');
          } catch (e: any) {
            log(`清空验证码输入框异常：${e.message}`, "warn");
          }
          verifyCodeFilled = false;
          verifyBtnClickTime = 0;
          continue;
        }

        try {
          await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
          const verifyBtnState = await page.evaluate(() => {
            const codeEl = document.querySelector('input#verifyCode[name="verifyCode"]') as HTMLInputElement | null;
            if (!codeEl || !codeEl.value.trim()) return "no-code";
            const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
            if (!btn || btn.offsetParent === null) return "no-button";
            if (btn.disabled) return "disabled";
            return "clickable";
          });

          if (verifyBtnState === "no-code") {
            verifyCodeFilled = false;
            stepStallCount++;
            if (stepStallCount >= 30) { log("验证码输入框持续为空，刷新重试...", "warn"); break; }
          } else if (verifyBtnState === "disabled") {
            verifyBtnRetryCount++;
            if (verifyBtnRetryCount > 30) {
              log("验证码按钮持续 disabled，刷新重试...", "warn"); break;
            }
            if (verifyBtnRetryCount % 5 === 0) log(`验证码按钮持续 disabled，等待中（第 ${verifyBtnRetryCount}s）...`, "warn");
          } else if (verifyBtnState === "clickable") {
            await page.evaluate(async () => {
              const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
              if (btn) { await new Promise((r) => setTimeout(r, 800)); btn.click(); }
            });
            verifyBtnClickTime = Date.now();
            log("验证码确认按钮已点击，等待 RegisterByEmail 请求（3s 内无请求将清空重输）...", "success");
          } else {
            stepStallCount++;
            if (stepStallCount >= 60) { log("验证码确认按钮持续不可用，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤6（验证码确认）异常：${e.message}，等待重试...`, "warn");
        }
      }
    }

    // 内层循环退出，刷新当前页面重试
    // 刷新前先获取当前完整 URL（包含路径参数、query string 等），
    // 然后用 page.goto(当前 URL) 重新加载，确保所有参数完整保留。
    refreshCount++;
    if (refreshCount > MAX_REFRESHES) {
      log(`阶段一已刷新 ${MAX_REFRESHES} 次仍未完成，放弃`, "error");
      return "timeout";
    }
    const currentUrl = page.url();
    log(`阶段一第 ${refreshCount} 次刷新重试，重新加载：${currentUrl}`, "warn");
    checkInvitationCodeRemainsOk = false; // 刷新前重置，防止刷新过程中的响应被循环顶部覆盖
    try {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (reloadErr: any) {
      log(`阶段一刷新失败（代理网络错误）：${reloadErr.message}`, "error");
      return "error";
    }
    // 刷新后等待网络空闲，确保页面完全就绪
    try {
      await page.waitForLoadState("networkidle", { timeout: 20000 });
    } catch { /* 网络慢时容错 */ }

  }

  return "timeout";
}

// ─── 阶段二：verify-phone 页面 ───────────────────────────────────────────────

interface PhoneInfo {
  dialCode: string;
  phoneNumber: string;
  iso: string;
  phoneRaw: string;
  backendPhoneId: number;
  smsUrl: string;
}

async function handleVerifyPhonePage(
  page: Page,
  logId: number,
  log: Logger
): Promise<{ result: "app" | "timeout" | "no-phone" | "error"; phoneInfo?: PhoneInfo }> {
  // 手机号在确认输入框存在后才获取，此处先初始化为 null
  let phoneInfo: PhoneInfo | null = null;
  let acquiredPhoneId: number | null = null;

  const MAX_REFRESHES = 3;
  let refreshCount = 0;
  const PHASE_TIMEOUT = 180000;

  let smsCodeFetching = false;
  let smsCode: string | null = null;
  let phoneMarkedUsed = false; // 提升到外层，超时时可读取

  // ── API 请求发出时间戳（用于判断按鈕点击是否生效）──
  let sendPhoneCodeRequestTime = 0; // SendPhoneVerificationCode 请求发出时间
  let bindPhoneRequestTime = 0;     // BindPhoneTrait 请求发出时间
  // 响应状态：0=未响应 1=成功(2xx) -1=失败(4xx/5xx)
  let sendPhoneCodeStatus = 0;  // SendPhoneVerificationCode 响应状态
  let bindPhoneStatus = 0;      // BindPhoneTrait 响应状态
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("SendPhoneVerificationCode")) {
      sendPhoneCodeRequestTime = Date.now();
      sendPhoneCodeStatus = 0;
      log("[请求监听] SendPhoneVerificationCode 已发出，等待响应...");
    }
    if (url.includes("BindPhoneTrait")) {
      bindPhoneRequestTime = Date.now();
      bindPhoneStatus = 0;
      log("[请求监听] BindPhoneTrait 已发出，等待响应...");
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (url.includes("SendPhoneVerificationCode")) {
      if (status >= 200 && status < 300) {
        sendPhoneCodeStatus = 1;
        log(`[SendPhoneVerificationCode] 响应成功 (${status})`);
      } else {
        sendPhoneCodeStatus = -1;
        log(`[SendPhoneVerificationCode] 响应失败 (${status})，需重新输入手机号`, "warn");
      }
    }
    if (url.includes("BindPhoneTrait")) {
      if (status >= 200 && status < 300) {
        bindPhoneStatus = 1;
        log(`[BindPhoneTrait] 响应成功 (${status})，手机号绑定成功`);
      } else {
        bindPhoneStatus = -1;
        log(`[BindPhoneTrait] 响应失败 (${status})，短信验证码未消耗`, "warn");
      }
    }
  });

  while (refreshCount <= MAX_REFRESHES) {
    // ── 先等 URL 稳定，再等 DOM 加载（与 handleLoginPage 同理）──
    try {
      await page.waitForURL(
        (u: URL) => u.toString().includes("manus.im/verify-phone"),
        { timeout: 30000 }
      );
    } catch {
      const curUrl = page.url();
      log(`阶段二：等待 /verify-phone URL 超时，当前 URL：${curUrl}，继续尝试...`, "warn");
    }
    // URL 已稳定，现在安全地等待 DOM 加载
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch { /* 容错 */ }
    try {
      await page.waitForLoadState("networkidle", { timeout: 20000 });
    } catch { /* 网络慢时容错 */ }
    await sleep(1500);
    // 页面加载后模拟真实用户浏览行为（触发 Plausible + Manus 埋点）
    await humanBrowse(page);

    // ── 确认手机号输入框真实存在，再获取手机号（仅获取一次）──
    if (!phoneInfo) {
      let phoneInputVisible = false;
      try {
        await page.waitForSelector('input#phone[type="tel"]', { state: "visible", timeout: 30000 });
        phoneInputVisible = true;
      } catch {
        log("手机号输入框未出现，页面可能未正常加载，刷新重试...", "warn");
      }
      if (!phoneInputVisible) {
        refreshCount++;
        if (refreshCount > MAX_REFRESHES) {
          log(`阶段二已刷新 ${MAX_REFRESHES} 次仍未完成，放弃`, "error");
          return { result: "timeout" };
        }
        const curUrlOnPhoneFail = page.url();
        log(`手机号输入框未出现，第 ${refreshCount} 次刷新重试：${curUrlOnPhoneFail}`, "warn");
        try {
          await page.goto(curUrlOnPhoneFail, { waitUntil: "domcontentloaded", timeout: 30000 });
        } catch (e: any) {
          log(`刷新失败：${e.message}`, "error");
          return { result: "error" };
        }
        try { await page.waitForLoadState("networkidle", { timeout: 20000 }); } catch { /* 容错 */ }
        continue;
      }
      // 输入框已确认存在，现在才从数据库获取手机号
      log("手机号输入框已出现，正在从数据库获取手机号...");
      const phoneData = await getNextAvailablePhone();
      if (!phoneData) {
        log("暂无可用手机号", "error");
        return { result: "no-phone" };
      }
      phoneInfo = parseBackendPhone(phoneData);
      acquiredPhoneId = phoneData.id;
      log(`手机号已获取：${phoneInfo.phoneRaw}（${phoneInfo.iso}）`);
      // 立即将手机号 ID 写入 task_log，供浏览器异常关闭时 scheduler 归还手机号
      await updateTaskLog(logId, { acquiredPhoneId }).catch(() => {});
    }

    let countrySelected = false;
    let phoneFilled = false;
    let phoneBtnClickTime = 0;    // Send code 按钮点击时间（等待 SendPhoneVerificationCode 请求发出）
    let phoneBtnRetryCount = 0;   // Send code 按钮点击后 3s 无请求的重试次数
    let phoneSendClicked = false;
    let smsCodeFilled = false;
    let smsBtnClickTime = 0;      // 短信验证码确认按钮点击时间（等待 BindPhoneTrait 请求发出）
    let smsBtnRetryCount = 0;     // 短信验证码按钮点击后 3s 无请求的重试次数
    let stepStallCount = 0;
    const roundStart = Date.now();
    // 每轮开始重置请求时间戳和响应状态（防止上一轮的旧状态干扰当前轮）
    sendPhoneCodeRequestTime = 0;
    sendPhoneCodeStatus = 0;
    bindPhoneRequestTime = 0;
    bindPhoneStatus = 0;
    // 每轮开始重置短信验证码状态（刷新后会重新发送验证码，旧验证码已失效）
    smsCodeFetching = false;
    smsCode = null;

    for (let i = 0; i < 300; i++) {
      await sleep(1000);

      if (Date.now() - roundStart > PHASE_TIMEOUT) {
        log("阶段二超时，正在刷新重试...", "warn");
        break;
      }

      // ── URL 守卫：确保当前在 /verify-phone 页面且页面加载完成 ──
      const currentUrl2 = page.url();

      // 页面导航中（二次跳转），等待页面稳定后再操作
      if (currentUrl2 === "about:blank" || currentUrl2 === "") {
        await sleep(1000);
        continue;
      }

      // 已跳转到 /app → 提前返回成功
      if (currentUrl2.includes("manus.im/app")) {
        log("检测到页面已跳转到 /app，阶段二完成");
        return { result: "app", phoneInfo };
      }

      // 不在预期页面（不是 /verify-phone）→ 等待跳转或刷新
      if (!currentUrl2.includes("manus.im/verify-phone")) {
        log(`当前不在 /verify-phone 页面（URL: ${currentUrl2}），等待页面跳转...`, "warn");
        await sleep(2000);
        continue;
      }

      // A. 选择国家
      if (!countrySelected) {
        try {
          const result = await selectCountry(page, phoneInfo.iso, phoneInfo.dialCode, log);
          if (result) {
            countrySelected = true;
            stepStallCount = 0;
            log(`国家已选择：${phoneInfo.iso}（${phoneInfo.dialCode}）`);
            await sleep(800);
          } else {
            stepStallCount++;
            if (stepStallCount >= 20) { log("国家选择卡住，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤A（选择国家）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // B. 输入手机号
      if (!phoneFilled) {
        try {
          await simulateMouseMove(page, 'input#phone[type="tel"]');
          const ok = await typeIntoField(page, 'input#phone[type="tel"]', phoneInfo.phoneNumber);
          if (ok) {
            phoneFilled = true;
            stepStallCount = 0;
            log(`手机号已填写：${phoneInfo.phoneNumber}`);
            await sleep(800);
          } else {
            stepStallCount++;
            if (stepStallCount >= 20) { log("手机号输入框卡住，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤B（输入手机号）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // C. 点击 Send code
      // 判断成功依据：SendPhoneVerificationCode 响应成功
      // 响应失败时清空手机号重新输入
      if (!phoneSendClicked) {
        // SendPhoneVerificationCode 已发出 → 等待响应后再判断
        if (sendPhoneCodeRequestTime > 0) {
          const waitSendPhoneStart = Date.now();
          while (sendPhoneCodeStatus === 0 && Date.now() - waitSendPhoneStart < 10000) {
            await sleep(200);
          }
          if (sendPhoneCodeStatus === -1) {
            // 响应失败，清空手机号重新输入
            log("SendPhoneVerificationCode 响应失败，清空手机号重新输入...", "warn");
            sendPhoneCodeRequestTime = 0;
            sendPhoneCodeStatus = 0;
            phoneSendClicked = false;
            phoneFilled = false;
            phoneBtnClickTime = 0;
            try {
              await clearField(page, 'input#phone[type="tel"]');
            } catch { /* 容错 */ }
            continue;
          }
          // 响应成功（或 10s 超时，按成功处理）
          phoneSendClicked = true;
          stepStallCount = 0;
          log("Send code 已生效（SendPhoneVerificationCode 响应成功）", "success");
          // 开始后台获取短信验证码
          if (!smsCodeFetching) {
            smsCodeFetching = true;
            fetchSmsCode(phoneInfo.smsUrl).then(async (code) => {
              smsCode = code;
              if (code) {
                log(`短信验证码已就绪：${code}`);
                if (!phoneMarkedUsed) {
                  await markPhoneUsedById(phoneInfo!.backendPhoneId).catch(() => {});
                  phoneMarkedUsed = true;
                }
              } else {
                log("短信验证码获取超时", "warn");
              }
            });
          }
          continue;
        }

        // 如果已点击按钮且超过 3s 仍无请求 → 清空手机号重新输入
        if (phoneBtnClickTime > 0 && Date.now() - phoneBtnClickTime > 3000) {
          log(`Send code 点击后 3s 无 SendPhoneVerificationCode 请求，清空手机号重新输入（第 ${phoneBtnRetryCount + 1} 次）...`, "warn");
          phoneBtnRetryCount++;
          if (phoneBtnRetryCount > 5) {
            log("Send code 多次无效，刷新重试...", "warn"); break;
          }
          try {
            await clearField(page, 'input#phone[type="tel"]');
          } catch (e: any) {
            log(`清空手机号输入框异常：${e.message}`, "warn");
          }
          phoneFilled = false;
          phoneBtnClickTime = 0;
          continue;
        }

        try {
          await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
          const phoneBtnState = await page.evaluate(() => {
            const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
            if (!btn || btn.offsetParent === null) return "no-button";
            if (btn.disabled) return "disabled";
            return "clickable";
          });

          if (phoneBtnState === "disabled") {
            phoneBtnRetryCount++;
            if (phoneBtnRetryCount > 30) {
              log("Send code 按钮持续 disabled，刷新重试...", "warn"); break;
            }
            if (phoneBtnRetryCount % 5 === 0) log(`Send code 按钮持续 disabled，等待中（第 ${phoneBtnRetryCount}s）...`, "warn");
          } else if (phoneBtnState === "clickable") {
            await page.evaluate(async () => {
              const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
              if (btn) { await new Promise((r) => setTimeout(r, 500)); btn.click(); }
            });
            phoneBtnClickTime = Date.now();
            log("Send code 按钮已点击，等待 SendPhoneVerificationCode 请求（3s 内无请求将清空重输）...", "success");
          } else {
            stepStallCount++;
            if (stepStallCount >= 20) { log("发送验证码按钮卡住，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤C（Send code）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // D. 填入短信验证码
      if (!smsCodeFilled) {
        try {
          const phoneCodeVisible = await page.evaluate(() => {
            const el = document.querySelector("input#phone-code") as HTMLElement | null;
            return !!(el && el.offsetParent !== null);
          });
          if (phoneCodeVisible) {
            if (smsCode) {
              await simulateMouseMove(page, "input#phone-code");
              const ok = await typeIntoField(page, "input#phone-code", smsCode);
              if (ok) {
                smsCodeFilled = true;
                stepStallCount = 0;
                log(`短信验证码已填入：${smsCode}`);
                await sleep(800);
              }
            } else {
              if (i % 5 === 0) log("等待短信验证码...");
            }
          } else {
            stepStallCount++;
            if (stepStallCount >= 20) { log("短信验证码输入框卡住，刷新重试...", "warn"); break; }
          }
        } catch (e: any) {
          log(`步骤D（填入短信验证码）异常：${e.message}，等待重试...`, "warn");
        }
        continue;
      }

      // E. 点击确认，等待跳转到 /app
      // 判断成功依据：BindPhoneTrait 响应成功
      // 响应失败时清空短信验证码重新输入

      // BindPhoneTrait 已发出 → 等待响应后再判断
      if (bindPhoneRequestTime > 0) {
        const waitBindStart = Date.now();
        while (bindPhoneStatus === 0 && Date.now() - waitBindStart < 15000) {
          await sleep(200);
        }
        if (bindPhoneStatus === -1) {
          // 响应失败，短信验证码未消耗，清空重新输入
          log("BindPhoneTrait 响应失败，短信验证码未消耗，清空重新输入...", "warn");
          bindPhoneRequestTime = 0;
          bindPhoneStatus = 0;
          smsCodeFilled = false;
          smsBtnClickTime = 0;
          try {
            await clearField(page, "input#phone-code");
          } catch { /* 容错 */ }
          continue;
        }
        // 响应成功（或 15s 超时，按成功处理）——等待页面跳转到 /app
        log("BindPhoneTrait 响应成功，等待页面跳转到 /app...");
        try {
          await page.waitForURL((url: URL) => url.toString().includes("manus.im/app"), { timeout: 30000 });
          log("阶段二完成 → 已进入 /app");
          return { result: "app", phoneInfo };
        } catch {
          // BindPhoneTrait 已成功但页面 30s 内未跳转，刷新重试
          log("BindPhoneTrait 已成功但页面 30s 内未跳转，刷新重试...", "warn");
          break;
        }
      }

      // 如果已点击按钮且超过 3s 仍无 BindPhoneTrait 请求 → 清空短信验证码重新输入
      if (smsBtnClickTime > 0 && Date.now() - smsBtnClickTime > 3000) {
        log(`短信验证码确认点击后 3s 无 BindPhoneTrait 请求，清空短信验证码重新输入（第 ${smsBtnRetryCount + 1} 次）...`, "warn");
        smsBtnRetryCount++;
        if (smsBtnRetryCount > 5) {
          log("短信验证码确认多次无效，刷新重试...", "warn"); break;
        }
        try {
          await clearField(page, "input#phone-code");
        } catch (e: any) {
          log(`清空短信验证码输入框异常：${e.message}`, "warn");
        }
        smsCodeFilled = false;
        smsBtnClickTime = 0;
        continue;
      }

      try {
        await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
        const smsBtnState = await page.evaluate(() => {
          const codeEl = document.querySelector("input#phone-code") as HTMLInputElement | null;
          if (!codeEl || !codeEl.value.trim()) return "no-code";
          const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return "no-button";
          if (btn.disabled) return "disabled";
          return "clickable";
        });

        if (smsBtnState === "no-code") {
          smsCodeFilled = false;
          stepStallCount++;
          if (stepStallCount >= 10) { log("短信验证码输入框持续为空，刷新重试...", "warn"); break; }
        } else if (smsBtnState === "disabled") {
          smsBtnRetryCount++;
          if (smsBtnRetryCount > 30) {
            log("短信验证码按钮持续 disabled，刷新重试...", "warn"); break;
          }
          if (smsBtnRetryCount % 5 === 0) log(`短信验证码按钮持续 disabled，等待中（第 ${smsBtnRetryCount}s）...`, "warn");
        } else if (smsBtnState === "clickable") {
          await page.evaluate(async () => {
            const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
            if (btn) { await new Promise((r) => setTimeout(r, 500)); btn.click(); }
          });
          smsBtnClickTime = Date.now();
          log("短信验证码确认按钮已点击，等待 BindPhoneTrait 请求（3s 内无请求将清空重输）...", "success");
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("手机号确认按钮卡住，刷新重试...", "warn"); break; }
        }
      } catch (e: any) {
        log(`步骤E（短信验证码确认）异常：${e.message}，等待重试...`, "warn");
      }
    }

    // 内层循环退出，刷新重试
    refreshCount++;
    if (refreshCount > MAX_REFRESHES) {
      log(`阶段二已刷新 ${MAX_REFRESHES} 次仍未完成，放弃`, "error");
      return { result: "timeout" };
    }
    log(`阶段二第 ${refreshCount} 次刷新重试...`, "warn");
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (reloadErr: any) {
      log(`阶段二刷新失败（代理网络错误）：${reloadErr.message}`, "error");
      return { result: "error" };
    }
    // 刷新后等待网络空闲，确保页面完全就绪
    try {
      await page.waitForLoadState("networkidle", { timeout: 20000 });
    } catch { /* 网络慢时容错 */ }


    // 刷新后检查是否已在 /app
    const afterReloadUrl = page.url();
    if (afterReloadUrl.includes("manus.im/app")) {
      log("刷新后已在 /app 页面，注册成功！");
      return { result: "app", phoneInfo };
    }
  }

  // 阶段二超时：按插件逻辑处理手机号状态
  // - 如果短信已收到并标记使用（phoneMarkedUsed=true），保持已使用状态，不允许再次使用
  // - 如果按钮点了但短信未收到（phoneMarkedUsed=false），归还手机号供下次使用
  if (acquiredPhoneId !== null) {
    if (!phoneMarkedUsed) {
      log(`阶段二超时，短信未收到，手机号 ${acquiredPhoneId} 已归还`, "warn");
      await resetPhoneStatusById(acquiredPhoneId).catch(() => {});
    } else {
      log(`阶段二超时，短信已收到，手机号 ${acquiredPhoneId} 保持已使用状态`, "warn");
    }
  } else {
    log("阶段二超时，手机号未获取（页面未正常加载），无需归还", "warn");
  }
  return { result: "timeout" };
}

// ─── 完成注册（兑换推广码 + 直接 API 采集数据 + 上报后端）──────────────────

async function finishRegistration(
  page: Page,
  email: string,
  password: string,
  phoneInfo: PhoneInfo | null,
  referrerCode: string,
  inviterAccountId: number,
  capturedToken: string | null,
  capturedUserData: any,
  taskId: number,
  logId: number,
  profileId: string,
  exitIp: string | undefined,
  adspowerConfig: any,
  startTime: number,
  log: Logger,
  setIsOnAppPage: (v: boolean) => void
) {
  log("注册成功！开始执行注册后续步骤...", "success");

  // ── 确认当前在 /app 页面，激活 JS 屏蔽规则 ──
  const appUrl = page.url();
  if (!appUrl.includes("manus.im/app")) {
    log(`当前不在 /app 页面（URL: ${appUrl}），等待跳转...`, "warn");
    try {
      await page.waitForURL((url: URL) => url.toString().includes("manus.im/app"), { timeout: 30000 });
    } catch {
      log(`等待 /app 页面超时，当前 URL: ${page.url()}，继续执行后续步骤...`, "warn");
    }
  }
  // 激活 /app 专属屏蔽规则（屏蔽所有 JS/CSS/图片，只放行 api.manus.im）
  setIsOnAppPage(true);
  log("/app 页面 JS 屏蔽已激活，准备调用 API...");

  // ── Step 1: 在浏览器内按序调用所有 Manus API ──
  // 全部通过 page.evaluate 发起，复用浏览器的 Cookie、TLS 指纹、出口 IP
  // 页面 JS 已被屏蔽（白屏），但 fetch 完全不依赖页面 JS，可正常发送

  // 1a. 获取 clientId（从 localStorage 读取，需在 JS 屏蔽前已写入）
  const clientId = await page.evaluate(() => localStorage.getItem("client_id_v2")).catch(() => null);
  capturedUserData.clientId = clientId;
  log(`clientId: ${clientId ?? "未获取到"}`);

  if (!capturedToken) {
    log("未获取到 token，跳过所有 API 调用", "warn");
  } else {
    const tkn = capturedToken;
    const cid = clientId ?? "";

    // 1b. CheckInvitationCode（验证邀请码）
    log("正在调用 CheckInvitationCode...");
    await page.evaluate(async ({ tkn, cid }: { tkn: string; cid: string }) => {
      try {
        await fetch("https://api.manus.im/user.v1.UserService/CheckInvitationCode", {
          method: "POST",
          headers: { "Content-Type": "application/json", "authorization": `Bearer ${tkn}`, "x-client-id": cid },
          body: JSON.stringify({}),
        });
      } catch {}
    }, { tkn, cid }).catch(() => {});
    log("CheckInvitationCode 调用完成");

    // 1c. UserInfo（获取会员版本）
    log("正在调用 UserInfo...");
    const userInfoResult = await page.evaluate(async ({ tkn, cid }: { tkn: string; cid: string }) => {
      try {
        const resp = await fetch("https://api.manus.im/user.v1.UserService/UserInfo", {
          method: "POST",
          headers: { "Content-Type": "application/json", "authorization": `Bearer ${tkn}`, "x-client-id": cid },
          body: JSON.stringify({}),
        });
        if (resp.ok) return await resp.json();
      } catch {}
      return null;
    }, { tkn, cid }).catch(() => null);
    if (userInfoResult?.membershipVersion) {
      capturedUserData.membershipVersion = userInfoResult.membershipVersion;
      log(`会员版本：${capturedUserData.membershipVersion}`);
    }

    // 1d. GetPersonalInvitationCodes（获取邀请码）
    log("正在调用 GetPersonalInvitationCodes...");
    const inviteResult = await page.evaluate(async ({ tkn, cid }: { tkn: string; cid: string }) => {
      try {
        const resp = await fetch("https://api.manus.im/user.v1.UserService/GetPersonalInvitationCodes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "authorization": `Bearer ${tkn}`, "x-client-id": cid },
          body: JSON.stringify({}),
        });
        if (resp.ok) return await resp.json();
      } catch {}
      return null;
    }, { tkn, cid }).catch(() => null);
    if (inviteResult?.invitationCodes?.length > 0) {
      capturedUserData.inviteCode = inviteResult.invitationCodes[0].inviteCode ?? null;
      log(`邀请码：${capturedUserData.inviteCode}`);
    }

    // 1e. RedeemPromotionCodeV2（提交推广码）+ LoopPromotionCodeRedeemStatus（轮询兑换状态）
    log("正在兑换推广码...");
    await redeemPromotion(page, tkn, cid, log);

    // 1f. GetAvailableCredits（获取最新积分，在兑换后无条件调用）
    log("正在调用 GetAvailableCredits...");
    const creditsResult = await page.evaluate(async ({ tkn, cid }: { tkn: string; cid: string }) => {
      try {
        const resp = await fetch("https://api.manus.im/user.v1.UserService/GetAvailableCredits", {
          method: "POST",
          headers: { "Content-Type": "application/json", "authorization": `Bearer ${tkn}`, "x-client-id": cid },
          body: JSON.stringify({}),
        });
        if (resp.ok) return await resp.json();
      } catch {}
      return null;
    }, { tkn, cid }).catch(() => null);
    if (creditsResult?.totalCredits !== undefined) {
      capturedUserData.totalCredits = creditsResult.totalCredits;
      capturedUserData.freeCredits = creditsResult.freeCredits ?? null;
      capturedUserData.refreshCredits = creditsResult.refreshCredits ?? null;
      log(`积分：总=${capturedUserData.totalCredits}，免费=${capturedUserData.freeCredits}`);
    }
  }

  log(`数据采集完成：会员版本=${capturedUserData.membershipVersion}，积分=${capturedUserData.totalCredits}，邀请码=${capturedUserData.inviteCode}`);

  // Step 2: 上报注册数据到后端数据库（直接调用 DB，不走 HTTP）
  const phoneStr = phoneInfo ? phoneInfo.dialCode + phoneInfo.phoneNumber : "";
  const durationMs = Date.now() - startTime;

  try {
    await saveRegistrationResult({
      email,
      password,
      phone: phoneStr || undefined,
      token: capturedToken || undefined,
      clientId: clientId || undefined,
      membershipVersion: capturedUserData.membershipVersion || undefined,
      totalCredits: (() => { const v = Number(capturedUserData.totalCredits); return !isNaN(v) ? v : 0; })(),
      freeCredits: (() => { const v = Number(capturedUserData.freeCredits); return !isNaN(v) ? v : 0; })(),
      inviteCode: capturedUserData.inviteCode || undefined,
      referrerCode: referrerCode || undefined,
      inviterAccountId,
      adspowerBrowserId: profileId,
      taskLogId: logId,
    });

    // 记录已用IP
    if (exitIp) {
      await recordUsedIp(exitIp, email, logId).catch(() => {});
    }

    // 更新任务日志为成功（将浏览器内检测到的 IP 写入日志）
    await updateTaskLog(logId, {
      status: "success",
      exitIp: exitIp ?? null,
      durationMs,
      completedAt: new Date(),
    });

    await incrementTaskCounters(taskId, { totalSuccess: 1, totalAccountsCreated: 1 });
    log(`注册完成！邮箱=${email}，耗时=${Math.round(durationMs / 1000)}秒`, "success");

  } catch (e: any) {
    log(`注册结果保存失败：${e.message}`, "error");
    await updateTaskLog(logId, {
      status: "failed",
      errorMessage: `注册成功但保存失败: ${e.message}`,
      durationMs,
      completedAt: new Date(),
    });
    await incrementTaskCounters(taskId, { totalFailed: 1 });
  }

  // Step 4: 清理浏览器
  await cleanupBrowser(page.context().browser()!, adspowerConfig, profileId);
}

// ─── 兑换推广码 ──────────────────────────────────────────────────────────────

async function redeemPromotion(page: Page, token: string, clientId: string, log: Logger): Promise<boolean> {
  const promotionCode = "techtiff";
  log(`正在兑换推广码：${promotionCode}`);

  const redeemResult = await page.evaluate(async ({ tkn, cid, code }: { tkn: string; cid: string; code: string }) => {
    try {
      const resp = await fetch("https://api.manus.im/promotion.v1.PromotionService/RedeemPromotionCodeV2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${tkn}`,
          "x-client-id": cid,
        },
        body: JSON.stringify({ promotionCode: code, deviceId: cid }),
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, body: text.substring(0, 300) };
    } catch (e: any) {
      return { ok: false, status: 0, body: e.message };
    }
  }, { tkn: token, cid: clientId, code: promotionCode });

  // 修复：status === 0 表示网络异常，非 0 的 4xx/5xx 是服务端正常拒绝（如推广码已兑换），不应无限轮询
  if (redeemResult?.status === 0) {
    log(`推广码兑换网络异常：${redeemResult?.body}`, "warn");
    return false;
  }
  if (!redeemResult?.ok) {
    log(`推广码兑换被拒绝（状态码 ${redeemResult?.status}）：${redeemResult?.body}`, "warn");
    return false;
  }

  log(`推广码已提交（状态码 ${redeemResult?.status}），轮询兑换结果...`);

  for (let i = 1; i <= 10; i++) {
    await sleep(2000);
    const pollResult = await page.evaluate(async ({ tkn, cid, code }: { tkn: string; cid: string; code: string }) => {
      try {
        const resp = await fetch("https://api.manus.im/promotion.v1.PromotionService/LoopPromotionCodeRedeemStatus", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "authorization": `Bearer ${tkn}`,
            "x-client-id": cid,
          },
          body: JSON.stringify({ promotionCode: code }),
        });
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, body: text.substring(0, 300) };
      } catch (e: any) {
        return { ok: false, status: 0, body: e.message };
      }
    }, { tkn: token, cid: clientId, code: promotionCode });

    try {
      const json = JSON.parse(pollResult?.body || "{}");
      const st = json.status || "";
      if (st.includes("SUCCESS")) { log("推广码兑换成功！"); return true; }
      if (st.includes("FAILED")) { log(`推广码兑换失败：${pollResult?.body}`, "warn"); return false; }
    } catch {}
  }
  log("推广码兑换轮询超时（可能仍在处理中）", "warn");
  return false;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 直接用 token 调用 Manus API 获取用户积分和邀请码
 * 对应 Python 脚本的 step12_get_available_credits + step13_get_invitation_codes
 */
async function fetchUserDataByToken(token: string, log: Logger): Promise<{
  totalCredits: number | null;
  freeCredits: number | null;
  refreshCredits: number | null;
  inviteCode: string | null;
  membershipVersion: string | null;
}> {
  const result = {
    totalCredits: null as number | null,
    freeCredits: null as number | null,
    refreshCredits: null as number | null,
    inviteCode: null as string | null,
    membershipVersion: null as string | null,
  };

  const headers = {
    "Content-Type": "application/json",
    "authorization": `Bearer ${token}`,
  };

  // 获取可用积分（GetAvailableCredits）
  try {
    const resp = await fetch("https://api.manus.im/user.v1.UserService/GetAvailableCredits", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    if (resp.ok) {
      const json = await resp.json() as any;
      result.totalCredits = json.totalCredits ?? null;
      result.freeCredits = json.freeCredits ?? null;
      result.refreshCredits = json.refreshCredits ?? null;
      log(`积分获取成功：总积分=${result.totalCredits}，免费积分=${result.freeCredits}`);
    } else {
      log(`GetAvailableCredits 返回 ${resp.status}`, "warn");
    }
  } catch (e: any) {
    log(`GetAvailableCredits 调用失败：${e.message}`, "warn");
  }

  // 获取个人邀请码（GetPersonalInvitationCodes）
  try {
    const resp = await fetch("https://api.manus.im/user.v1.UserService/GetPersonalInvitationCodes", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    if (resp.ok) {
      const json = await resp.json() as any;
      const codes = json.invitationCodes || [];
      if (codes.length > 0 && codes[0].inviteCode) {
        result.inviteCode = codes[0].inviteCode;
        log(`邀请码获取成功：${result.inviteCode}`);
      }
    } else {
      log(`GetPersonalInvitationCodes 返回 ${resp.status}`, "warn");
    }
  } catch (e: any) {
    log(`GetPersonalInvitationCodes 调用失败：${e.message}`, "warn");
  }

  // 获取用户信息（UserInfo）
  try {
    const resp = await fetch("https://api.manus.im/user.v1.UserService/UserInfo", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    if (resp.ok) {
      const json = await resp.json() as any;
      if (json.membershipVersion) {
        result.membershipVersion = json.membershipVersion;
        log(`会员版本获取成功：${result.membershipVersion}`);
      }
    } else {
      log(`UserInfo 返回 ${resp.status}`, "warn");
    }
  } catch (e: any) {
    log(`UserInfo 调用失败：${e.message}`, "warn");
  }

  return result;
}

/** 模拟鼠标移动（与插件的 simulateMouseMove 完全对齐） */
async function simulateMouseMove(page: Page, selector: string): Promise<void> {
  await page.evaluate(async (sel: string) => {
    const el = sel ? document.querySelector(sel) as HTMLElement | null : null;
    const rect = el ? el.getBoundingClientRect() : null;
    const targetX = rect
      ? rect.left + rect.width  / 2 + (Math.random() - 0.5) * Math.min(rect.width  * 0.3, 10)
      : Math.random() * window.innerWidth;
    const targetY = rect
      ? rect.top  + rect.height / 2 + (Math.random() - 0.5) * Math.min(rect.height * 0.3, 6)
      : Math.random() * window.innerHeight;
    let x = (window as any)._mouseX ?? Math.random() * window.innerWidth;
    let y = (window as any)._mouseY ?? Math.random() * window.innerHeight;
    const cx = x + (targetX - x) * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 60;
    const cy = y + (targetY - y) * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 60;
    const dist = Math.hypot(targetX - x, targetY - y);
    const steps = Math.max(8, Math.min(30, Math.floor(dist / 20)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const bx = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * cx + t * t * targetX;
      const by = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cy + t * t * targetY;
      document.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, cancelable: true,
        clientX: Math.round(bx), clientY: Math.round(by)
      }));
      await new Promise((r) => setTimeout(r, 8 + Math.random() * 12));
    }
    (window as any)._mouseX = targetX;
    (window as any)._mouseY = targetY;
  }, selector);
}

/** 模拟逐字打字（与插件的 injectTyping 完全对齐：React setter + 逐字 dispatch） */
async function typeIntoField(page: Page, selector: string, value: string): Promise<boolean> {
  return await page.evaluate(async ({ sel, val }: { sel: string; val: string }) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (!el || el.offsetParent === null) return false;
    // 插件的点击激活逐字
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
    el.focus();
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));
    // 插件的 React setter 逐字输入
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    let current = "";
    for (let i = 0; i < val.length; i++) {
      current += val[i];
      if (setter) setter.call(el, current); else el.value = current;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: val[i], bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: val[i], bubbles: true }));
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { sel: selector, val: value });
}

/** 清空输入框（React setter 触发、适用于重新输入前的清除操作） */
async function clearField(page: Page, selector: string): Promise<void> {
  await page.evaluate(async (sel: string) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (!el) return;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(el, ""); else el.value = "";
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector);
}

/** 选择国家（与插件的国家选择逻辑完全对齐） */
async function selectCountry(page: Page, iso: string, dialCode: string, log: Logger): Promise<boolean> {
  return await page.evaluate(async ({ isoCode, dc }: { isoCode: string; dc: string }) => {
    // 检查是否已选中（匹配区号文本）
    const spans = Array.from(document.querySelectorAll('span'));
    for (const sp of spans) {
      const txt = sp.textContent?.trim();
      if (txt === dc || txt === "+1") return true;
    }

    // 插件的 4 层 fallback 触发器查找逻辑
    let trigger: HTMLElement | null = null;
    trigger = document.querySelector('div[aria-expanded][aria-haspopup="dialog"]');
    if (!trigger) trigger = document.querySelector('div.inline-flex.cursor-pointer[aria-expanded]');
    if (!trigger) {
      const divs = Array.from(document.querySelectorAll('div.inline-flex'));
      for (const d of divs) {
        if (d.querySelector('img[alt]') && d.querySelector('svg')) { trigger = d as HTMLElement; break; }
      }
    }
    if (!trigger) {
      const imgs = Array.from(document.querySelectorAll('img[alt]'));
      for (const img of imgs) {
        const p = img.closest('div[class*="cursor-pointer"], div[class*="inline-flex"], button') as HTMLElement | null;
        if (p && p.offsetParent !== null) { trigger = p; break; }
      }
    }
    if (!trigger) return false;
    trigger.click();
    await new Promise((r) => setTimeout(r, 1000));

    // 插件的搜索框循环等待（30次 × 200ms）
    let searchInput: HTMLInputElement | null = null;
    for (let si = 0; si < 30; si++) {
      searchInput = document.querySelector('input[placeholder="Search"], input[placeholder*="search" i], input[placeholder*="\u691c\u7d22" i], input[placeholder*="\u641c\u7d22" i], input[placeholder*="\u641c\u5c0b" i]') as HTMLInputElement | null;
      if (searchInput && searchInput.offsetParent !== null) break;
      searchInput = null;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!searchInput) return false;

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

    // 手机号固定为美国，硬编码搜索 United States，匹配 +1
    // 注意：这里不能定义命名函数（const typeSearch = ...），
    // 否则 tsx/esbuild 会注入 __name() 辅助函数，导致浏览器沙算报 ReferenceError: __name is not defined
    for (const term of ["United States", isoCode]) {
      // 内联搜索输入操作（原 typeSearch 函数内容）
      if (setter) setter.call(searchInput!, ""); else searchInput!.value = "";
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      if (setter) setter.call(searchInput!, term); else searchInput!.value = term;
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1000));

      // 内联获取可见列表项（原 getVisibleItems 函数内容）
      const items: HTMLElement[] = [];
      for (const sel of [
        "[data-close-when-click=\"true\"] > *",
        "[role=\"listbox\"] > *",
        "[role=\"option\"]",
        "[role=\"menuitem\"]",
        "ul > li",
        "div[data-radix-scroll-area-viewport] > div > div",
      ]) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          if ((el as HTMLElement).offsetParent !== null && el.textContent?.trim()) items.push(el as HTMLElement);
        }
        if (items.length > 0) break;
      }
      for (const item of items) {
        const t = item.textContent || "";
        if ((t.includes("United States") || t.includes("美国") || t.includes("美國")) && t.includes("+1")) {
          item.click();
          return true;
        }
      }
      for (const item of items) {
        const t = item.textContent || "";
        if (t.includes("+1") && (t.includes("US") || t.includes("United States") || t.includes("美国") || t.includes("美國"))) {
          item.click();
          return true;
        }
      }
    }
    return false;
  }, { isoCode: iso, dc: dialCode });
}

/** 购买邮箱 */
async function buyEmail(): Promise<{ email: string; codeUrl: string }> {
  const resp = await fetchWithTimeout(BUY_EMAIL_API, {}, 30000);
  const json = await resp.json() as any;
  if (json.code !== 200 || !json.data?.carmis?.length) {
    throw new Error(json.msg || "购买失败，无邮箱数据");
  }
  const raw = json.data.carmis[0] as string;
  const parts = raw.split("----");
  const email = parts[0].trim();
  const codeUrl = parts[1].trim();
  return { email, codeUrl };
}

/** 轮询获取邮箱验证码（与插件完全对齐：36次 × 5秒 = 3分钟） */
async function fetchVerifyCode(codeUrl: string): Promise<string | null> {
  for (let i = 1; i <= 36; i++) {
    await sleep(5000);
    try {
      const resp = await fetchWithTimeout(codeUrl, {}, 15000);
      const text = await resp.text();
      try {
        const json = JSON.parse(text);
        // 插件优先：json.status === 'success' && json.code
        if (json.status === "success" && json.code && String(json.code).trim()) {
          return String(json.code).trim();
        }
        // 其次：json.message 中提取数字
        if (json.message) {
          const m = String(json.message).match(/\b(\d{4,8})\b/);
          if (m) return m[1];
        }
      } catch {}
      // html/纯文本：独立6位数字（插件 htmlMatch）
      const htmlMatch = text.match(/\b(\d{6})\b/);
      if (htmlMatch) return htmlMatch[1];
      // 纯文本："code is: XXXX" 或 "code: XXXX"（插件 numMatch）
      const numMatch = text.match(/(?:code\s*(?:is|:)?\s*)(\d{4,8})/i);
      if (numMatch) return numMatch[1];
    } catch {}
  }
  return null;
}

/** 轮询获取短信验证码（与插件完全对齐：36次 × 5秒 = 3分钟） */
async function fetchSmsCode(smsUrl: string): Promise<string | null> {
  const maxAttempts = 36;
  for (let i = 1; i <= maxAttempts; i++) {
    await sleep(5000);
    try {
      const resp = await fetchWithTimeout(smsUrl, {}, 15000);
      const text = await resp.text();

      // 尝试解析 JSON
      try {
        const json = JSON.parse(text);
        // 优先匹配 json.code
        if (json.code && String(json.code).trim()) {
          const code = String(json.code).trim();
          return code;
        }
        // 其次尝试从 json.message 中提取数字
        if (json.message) {
          const match = String(json.message).match(/\b(\d{4,8})\b/);
          if (match) return match[1];
        }
      } catch {}

      // 纯文本匹配："code is: XXXX" 或 "code: XXXX"
      const codeMatch = text.match(/(?:code\s*(?:is|:)\s*)\s*(\d{4,8})/i);
      if (codeMatch) return codeMatch[1];

      // 纯文本匹配：独立的 6 位数字
      const numMatch = text.match(/\b(\d{6})\b/);
      if (numMatch) return numMatch[1];

    } catch {}
  }
  return null;
}

/** 解析后端手机号数据 */
function parseBackendPhone(phoneData: { id: number; phone: string; smsUrl: string }): PhoneInfo {
  const phoneRaw = phoneData.phone;
  let dialCode = "+1";
  let iso = "US";
  let phoneNumber = phoneRaw.replace(/^\+1/, "");

  const sortedDials = Object.keys(DIAL_TO_ISO).sort((a, b) => b.length - a.length);
  for (const dc of sortedDials) {
    if (phoneRaw.startsWith(dc)) {
      dialCode = dc;
      iso = DIAL_TO_ISO[dc];
      phoneNumber = phoneRaw.substring(dc.length);
      break;
    }
  }

  return {
    dialCode,
    phoneNumber,
    iso,
    phoneRaw,
    backendPhoneId: phoneData.id,
    smsUrl: phoneData.smsUrl,
  };
}

/** 随机密码生成（15位：大写+小写+数字+符号） */
function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;
  const pwd: string[] = [
    upper[Math.floor(Math.random() * upper.length)],
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
  while (pwd.length < 15) {
    pwd.push(all[Math.floor(Math.random() * all.length)]);
  }
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join("");
}

/** 带超时的 fetch */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 清理浏览器（断开 CDP 连接 + 关闭 + 删除 AdsPower 环境） */
async function cleanupBrowser(browser: Browser, adspowerConfig: any, profileId: string) {
  try {
    await browser.close();
  } catch {}
  try {
    await stopAndDeleteAdsPowerBrowser(adspowerConfig, profileId);
  } catch {}
}

/** sleep */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 日志函数类型 */
type Logger = (msg: string, level?: "info" | "success" | "warn" | "error") => void;

/**
 * 创建带前缀的日志函数
 * 同时写入控制台 + 数据库 task_step_logs（非阻塞，失败不影响主流程）
 */
function makeLogger(taskId: number, profileId: string, logId: number): Logger {
  return (msg: string, level: "info" | "success" | "warn" | "error" = "info") => {
    // 控制台输出带任务前缀（不在 appendStepLog 里重复打印）
    const prefix = `[Automation][Task ${taskId}][${profileId.substring(0, 8)}]`;
    if (level === "error") console.error(`${prefix} ${msg}`);
    else if (level === "warn") console.warn(`${prefix} ${msg}`);
    else console.log(`${prefix} ${msg}`);
    // 异步写入数据库（不 await，不阻塞主流程）——传入 source="" 让 appendStepLog 不再重复打印控制台
    const dbLevel = level === "warn" ? "warning" : level;
    appendStepLog(logId, msg, dbLevel as "info" | "success" | "warning" | "error", "").catch(() => {});
  };
}
