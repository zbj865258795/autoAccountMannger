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

    // 获取初始页面（AdsPower 起始页）
    let pages = context.pages();
    let page = pages.length > 0 ? pages[0] : await context.newPage();
    log(`连接成功，当前页面：${page.url()}`, "info");

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

    // ── IP 检测完成后重新获取活跃页面（防止 AdsPower 起始页关闭导致原 page 对象失效）──
    pages = context.pages();
    if (pages.length === 0) {
      // 所有页面已关闭，新建一个
      page = await context.newPage();
      log("IP 检测后所有页面已关闭，已新建空白页面", "info");
    } else {
      // 取最后一个活跃页面（跳过已关闭的页面）
      const activePage = pages.find(p => !p.isClosed()) ?? pages[pages.length - 1];
      if (activePage !== page) {
        page = activePage;
        log(`已切换到活跃页面：${page.url()}`, "info");
      }
    }

    // ── 设置资源拦截（节省代理流量）──
    // 屏蔽图片、字体、广告追踪等不必要资源，保留 JS/CSS/Cloudflare 必要资源
    await context.route("**/*", (route) => {
      const req = route.request();
      const resourceType = req.resourceType();
      const url = req.url();

      // 屏蔽：字体文件
      if (resourceType === "font") {
        route.abort();
        return;
      }
      // 屏蔽：广告/追踪/分析域名
      const blockedDomains = [
        "google-analytics.com", "googletagmanager.com", "doubleclick.net",
        "facebook.com", "twitter.com", "hotjar.com", "segment.com",
        "amplitude.com", "mixpanel.com", "intercom.io", "crisp.chat",
        "sentry.io", "bugsnag.com", "fullstory.com", "logrocket.com",
      ];
      if (blockedDomains.some((d) => url.includes(d))) {
        route.abort();
        return;
      }
      // 屏蔽：files.manuscdn.com 图片资源（节省代理流量）
      if (url.includes("files.manuscdn.com") && resourceType === "image") {
        route.abort();
        return;
      }
      route.continue();
    });

    // ── 设置网络响应拦截（替代 chrome.debugger）──
    setupResponseInterception(
      page,
      capturedUserData,
      (token) => {
        capturedToken = token;
        log(`[Token] 已捕获：${token.substring(0, 30)}...`);
      },
      undefined, // onSendPhoneError 由阶段二内部单独监听，这里不传
      undefined  // onBindPhoneSuccess 不需要，允许浏览器正常跳转到 /app
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

    // ── Step 1: 购买邮箱 ──
    log("正在购买邮箱...");
    let email: string;
    let codeUrl: string;
    try {
      ({ email, codeUrl } = await buyEmail());
      log(`邮箱购买成功：${email}`, "success");
    } catch (e: any) {
      await resetInviteCodeStatus(inviterAccountId);
      throw new Error(`购买邮箱失败: ${e.message}`);
    }

    // ── Step 2: 生成密码 ──
    const password = generatePassword();
    log(`密码已生成`);

    // ── Step 3: 打开邀请链接 ──
    log(`正在打开邀请链接：${inviteUrl}`);
    try {
      await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (gotoErr: any) {
      throw new Error(`打开邀请链接失败（代理网络错误）：${gotoErr.message}`);
    }
    await sleep(3000);

    // 如果在邀请页面，点击注册入口
    const currentUrl = page.url();
    if (currentUrl.includes("manus.im/invitation") || currentUrl.includes("manus.im/register") || currentUrl.includes("manus.im/signup")) {
      log("已进入邀请页面，正在寻找注册入口...");
      await clickRegistrationEntry(page);
    }

    // ── 阶段一：login 页面 ──
    log("=== 阶段一：邮筱 + 密码 + 邮筱验证码 ===");
    const loginResult = await handleLoginPage(page, email, password, codeUrl, inviteUrl, log);

    if (loginResult === "app") {
      // 直接跳到 /app，无需手机验证
      await finishRegistration(page, email, password, null, inviteCode, inviterAccountId, capturedToken, capturedUserData, taskId, logId, profileId, detectedExitIp, adspowerConfig, startTime, log);
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
      await finishRegistration(page, email, password, phoneResult.phoneInfo, inviteCode, inviterAccountId, capturedToken, capturedUserData, taskId, logId, profileId, detectedExitIp, adspowerConfig, startTime, log);
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
  onBindPhoneSuccess?: () => void      // BindPhoneTrait 成功回调（用于停止页面跳转）
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
        try {
          const json = JSON.parse(text);
          if (json.membershipVersion) capturedUserData.membershipVersion = json.membershipVersion;
        } catch {}
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
    // 30% 概率轻微向下滚动再滚回来（模拟用户阅读页面）
    if (Math.random() < 0.3) {
      const scrollY = 80 + Math.floor(Math.random() * 120);
      await page.mouse.wheel(0, scrollY);
      await sleep(400 + Math.random() * 400);
      await page.mouse.wheel(0, -scrollY);
      await sleep(200 + Math.random() * 300);
    }
  } catch {
    // 拟人化操作失败不影响主流程
  }
}

// ─── 阶段一：login 页面 ──────────────────────────────────────────────────────

async function handleLoginPage(
  page: Page,
  email: string,
  password: string,
  codeUrl: string,
  inviteUrl: string,
  log: Logger
): Promise<"verify-phone" | "app" | "timeout" | "error"> {
  const PHASE_TIMEOUT = 180000;
  const MAX_REFRESHES = 3;
  let refreshCount = 0;

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

  while (refreshCount <= MAX_REFRESHES) {
    await sleep(1500);
    // 每轮开始清除上一轮遗留的 API 错误状态（对齐插件的 lastApiResult = null）
    lastApiError = null;
    const url = page.url();
    if (!url.includes("manus.im/login") && !url.includes("manus.im/register") &&
        !url.includes("manus.im/signup") && !url.includes("manus.im/invitation")) {
      log(`阶段一：当前 URL 异常（${url}），等待跳转...`);
      await sleep(2000);
    }
    // 页面加载后模拟真人浏览行为（随机滚动 + 鼠标漫游）
    await humanBrowse(page);

    let emailFilled = false;
    let emailContinueClicked = false;
    let emailRetryCount = 0;          // 情况一：邮箱输入后按钮仍 disabled 的清空重输次数
    let emailClickRetryCount = 0;     // 情况二：邮箱按钮点击后页面未变化的重试次数
    let pwdFilled = false;
    let pwdContinueClicked = false;
    let pwdRetryCount = 0;            // 情况一：密码输入后按钮仍 disabled 的清空重输次数
    let pwdClickRetryCount = 0;       // 情况二：密码按钮点击后页面未变化的重试次数
    let verifyCodeFetching = false;
    let verifyCode: string | null = null;
    let verifyCodeFilled = false;
    let verifyCodeRetryCount = 0;     // 情况一：验证码输入后按钮仍 disabled 的清空重输次数
    let verifyConfirmClicked = false;  // 插件的 verifyConfirmClicked 标志
    let verifyClickRetryCount = 0;    // 情况二：验证码按钮点击后页面未变化的重试次数
    let stepStallCount = 0;
    const roundStart = Date.now();

    for (let i = 0; i < 300; i++) {
      await sleep(1000);

      if (Date.now() - roundStart > PHASE_TIMEOUT) {
        log("阶段一超时，正在刷新重试...", "warn");
        break;
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
        continue;
      }

      // 2. 点击邮箱 Continue
      if (!emailContinueClicked) {
        await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
        // 检测按钮是否可点击，以及当前是否仍在邮箱步骤
        const btnState = await page.evaluate(() => {
          const pwdEl = document.querySelector('input[name="password"][type="password"]') as HTMLElement | null;
          const inEmailStep = !pwdEl || pwdEl.classList.contains("hidden") || pwdEl.offsetParent === null;
          if (!inEmailStep) return "already-passed"; // 已经过了邮箱步骤
          const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return "no-button";
          if (btn.disabled) return "disabled"; // 情况一：按钮存在但 disabled
          return "clickable";
        });

        if (btnState === "already-passed") {
          emailContinueClicked = true;
          stepStallCount = 0;
          log("邮箱步骤已通过", "success");
          await sleep(500);
        } else if (btnState === "disabled") {
          // 情况一：按钮 disabled，先等待 3 秒给页面响应时间，再次检测
          await sleep(3000);
          const btnStateRetry = await page.evaluate(() => {
            const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
            if (!btn || btn.offsetParent === null) return "no-button";
            if (btn.disabled) return "disabled";
            return "clickable";
          });
          if (btnStateRetry === "clickable") {
            // 页面已响应，下次循环直接点击
            continue;
          }
          // 仍然 disabled，才清空重输
          emailRetryCount++;
          if (emailRetryCount > 8) {
            log("邮筱按钮持续 disabled，刷新重试...", "warn"); break;
          }
          log(`邮筱按钮持续 disabled，清空重输（第 ${emailRetryCount} 次）...`, "warn");
          await page.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (!el) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(el, ""); else el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, 'input#email[autocomplete="email"], input#email[type="email"], input#email');
          await sleep(500);
          emailFilled = false;
        } else if (btnState === "clickable") {
          // 按钮可点击，执行点击
          await page.evaluate(async () => {
            const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
            if (btn) { await new Promise((r) => setTimeout(r, 800)); btn.click(); }
          });
          log("邮箱确认按钮已点击", "success");
          await sleep(3000);
          // 情况二：点击后检测页面是否有变化（密码框是否出现）
          const afterClick = await page.evaluate(() => {
            const pwdEl = document.querySelector('input[name="password"][type="password"]') as HTMLElement | null;
            return !!(pwdEl && !pwdEl.classList.contains("hidden") && pwdEl.offsetParent !== null);
          });
          if (afterClick) {
            emailContinueClicked = true;
            emailClickRetryCount = 0;
            stepStallCount = 0;
          } else {
            // 页面未变化，再次尝试
            emailClickRetryCount++;
            if (emailClickRetryCount > 7) {
              log("邮筱按钮点击后页面始终未跳转，刷新重试...", "warn"); break;
            }
            log(`邮筱按钮已点击但页面未变化，第 ${emailClickRetryCount} 次重试...`, "warn");
          }
        } else {
          stepStallCount++;
          if (stepStallCount >= 60) { log("邮筱确认按钮持续干不上，刷新重试...", "warn"); break; }
        }
        continue;
      }

      // 3. 输入密码
      if (!pwdFilled) {
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
        continue;
      }

      // 4. 点击密码 Continue
      if (!pwdContinueClicked) {
        await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
        // 检测密码按钮状态
        const pwdBtnState = await page.evaluate(() => {
          const pwdEl = document.querySelector('input[name="password"][type="password"]') as HTMLElement | null;
          const inPwdStep = pwdEl && !pwdEl.classList.contains("hidden") && pwdEl.offsetParent !== null;
          if (!inPwdStep) return "not-in-pwd-step";
          const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return "no-button";
          if (btn.disabled) return "disabled"; // 情况一：按钮 disabled
          return "clickable";
        });

        if (pwdBtnState === "not-in-pwd-step") {
          // 已经不在密码步骤，可能已跳转到验证码步骤
          pwdContinueClicked = true;
          stepStallCount = 0;
          log("密码步骤已通过", "success");
          await sleep(500);
        } else if (pwdBtnState === "disabled") {
          // 情况一：按钮 disabled，先等待 3 秒给页面响应时间，再次检测
          await sleep(3000);
          const pwdBtnStateRetry = await page.evaluate(() => {
            const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
            if (!btn || btn.offsetParent === null) return "no-button";
            if (btn.disabled) return "disabled";
            return "clickable";
          });
          if (pwdBtnStateRetry === "clickable") {
            continue;
          }
          // 仍然 disabled，才清空重输
          pwdRetryCount++;
          if (pwdRetryCount > 8) {
            log("密码按钮持续 disabled，刷新重试...", "warn"); break;
          }
          log(`密码按钮持续 disabled，清空重输（第 ${pwdRetryCount} 次）...`, "warn");
          await page.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (!el) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(el, ""); else el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, 'input[name="password"][type="password"]');
          await sleep(500);
          pwdFilled = false;
        } else if (pwdBtnState === "clickable") {
          // 按钮可点击，执行点击
          await page.evaluate(async () => {
            const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
            if (btn) { await new Promise((r) => setTimeout(r, 800)); btn.click(); }
          });
          log("密码确认按钮已点击，后台获取邮箱验证码中...", "success");
          if (!verifyCodeFetching) {
            verifyCodeFetching = true;
            fetchVerifyCode(codeUrl).then((code) => {
              verifyCode = code;
              if (code) log(`邮箱验证码已就绪：${code}`, "success");
              else log("邮箱验证码获取超时", "warn");
            });
          }
          await sleep(3000);
          // 情况二：点击后检测验证码输入框是否出现
          const afterPwdClick = await page.evaluate(() => {
            const el = document.querySelector('input#verifyCode[name="verifyCode"]') as HTMLElement | null;
            return !!(el && el.offsetParent !== null);
          });
          if (afterPwdClick) {
            pwdContinueClicked = true;
            pwdClickRetryCount = 0;
            stepStallCount = 0;
          } else {
            pwdClickRetryCount++;
            if (pwdClickRetryCount > 7) {
              log("密码按钮点击后页面始终未变化，刷新重试...", "warn"); break;
            }
            log(`密码按钮已点击但页面未变化，第 ${pwdClickRetryCount} 次重试...`, "warn");
          }
        } else {
          stepStallCount++;
          if (stepStallCount >= 60) { log("密码确认按钮持续干不上，刷新重试...", "warn"); break; }
        }
        continue;
      }

      // 5. 填入邮箱验证码
      if (!verifyCodeFilled) {
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
          } else {
            if (i % 5 === 0) log("等待邮箱验证码...");
          }
        } else {
          stepStallCount++;
          if (stepStallCount >= 60) { log("邮筱验证码输入框持续干不上，刷新重试...", "warn"); break; }
        }
        continue;
      }

      // 6. 点击验证码确认，等待跳转（使用 verifyConfirmClicked 标志，对齐插件逻辑）
      if (!verifyConfirmClicked) {
        await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
        // 检测验证码确认按钮状态
        const verifyBtnState = await page.evaluate(() => {
          const codeEl = document.querySelector('input#verifyCode[name="verifyCode"]') as HTMLInputElement | null;
          if (!codeEl || !codeEl.value.trim()) return "no-code"; // 验证码输入框为空
          const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return "no-button";
          if (btn.disabled) return "disabled"; // 情况一：按钮 disabled
          return "clickable";
        });

        if (verifyBtnState === "no-code") {
          // 验证码输入框为空，重置允许重新填入
          verifyCodeFilled = false;
          stepStallCount++;
          if (stepStallCount >= 30) { log("验证码输入框持续为空，刷新重试...", "warn"); break; }
        } else if (verifyBtnState === "disabled") {
          // 情况一：验证码已输入但按钮 disabled，先等待 3 秒给页面响应时间，再次检测
          await sleep(3000);
          const verifyBtnStateRetry = await page.evaluate(() => {
            const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
            if (!btn || btn.offsetParent === null) return "no-button";
            if (btn.disabled) return "disabled";
            return "clickable";
          });
          if (verifyBtnStateRetry === "clickable") {
            continue;
          }
          // 仍然 disabled，才清空重输
          verifyCodeRetryCount++;
          if (verifyCodeRetryCount > 8) {
            log("验证码按钮持续 disabled，刷新重试...", "warn"); break;
          }
          log(`验证码按钮持续 disabled，清空重输（第 ${verifyCodeRetryCount} 次）...`, "warn");
          await page.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (!el) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(el, ""); else el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, 'input#verifyCode[name="verifyCode"]');
          await sleep(500);
          verifyCodeFilled = false;
        } else if (verifyBtnState === "clickable") {
          // 按钮可点击，执行点击
          await page.evaluate(async () => {
            const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
            if (btn) { await new Promise((r) => setTimeout(r, 800)); btn.click(); }
          });
          verifyConfirmClicked = true;
          stepStallCount = 0;
          log("验证码已确认，等待页面跳转...");
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
              log("检测到 auth_landing 中转页，等待最终跳转...");
              await page.waitForURL((url: URL) => url.toString().includes("manus.im/") && !url.toString().includes("auth_landing"), { timeout: 60000 });
              const finalUrl = page.url();
              if (finalUrl.includes("manus.im/verify-phone")) return "verify-phone";
              if (finalUrl.includes("manus.im/app")) return "app";
              log(`auth_landing 后跳转到未知页面：${finalUrl}`, "warn");
              break;
            }
            log(`跳转到未知目标页面：${navUrl}`, "warn");
            break;
          } catch {
            // 情况二：点击后 30 秒内页面未跳转，重置允许重试
            verifyClickRetryCount++;
            if (verifyClickRetryCount > 5) {
              log("验证码确认按钮点击后页面始终未跳转，刷新重试...", "warn"); break;
            }
            log(`验证码确认后页面未跳转，第 ${verifyClickRetryCount} 次重试...`, "warn");
            verifyConfirmClicked = false; // 重置，允许再次点击
          }
        } else {
          stepStallCount++;
          if (stepStallCount >= 60) { log("确认按钮持续干不上，刷新重试...", "warn"); break; }
          continue;
        }
      }
    }

    // 内层循环退出，刷新当前页面重试
    // 注意：邀请码已在 Step 0 被原子锁定，不依赖 URL 参数，直接刷新当前页面即可
    refreshCount++;
    if (refreshCount > MAX_REFRESHES) {
      log(`阶段一已刷新 ${MAX_REFRESHES} 次仍未完成，放弃`, "error");
      return "timeout";
    }
    log(`阶段一第 ${refreshCount} 次刷新重试（当前页面：${page.url()}）...`, "warn");
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (reloadErr: any) {
      log(`阶段一刷新失败（代理网络错误）：${reloadErr.message}`, "error");
      return "error";
    }

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
  log("阶段二：正在从数据库获取手机号...");

  // 从数据库获取手机号
  const phoneData = await getNextAvailablePhone();
  if (!phoneData) {
    log("暂无可用手机号", "error");
    return { result: "no-phone" };
  }

  const phoneInfo = parseBackendPhone(phoneData);
  const acquiredPhoneId = phoneData.id; // 记录获取的手机号 id，失败时用于归还
  log(`手机号已获取：${phoneInfo.phoneRaw}（${phoneInfo.iso}）`);

  // 立即将手机号 ID 写入 task_log，供浏览器异常关闭时 scheduler 归还手机号
  await updateTaskLog(logId, { acquiredPhoneId }).catch(() => {});

  const MAX_REFRESHES = 3;
  let refreshCount = 0;
  const PHASE_TIMEOUT = 180000;

  let smsCodeFetching = false;
  let smsCode: string | null = null;
  let phoneMarkedUsed = false; // 提升到外层，超时时可读取

  // API 错误监听（对齐插件的 getRecentApiError 机制）
  type ApiError2 = { api: string; status: number; time: number };
  let lastApiError2: ApiError2 | null = null;
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (status >= 200 && status < 300) return;
    const WATCHED2 = ["SendPhoneVerificationCode", "BindPhoneTrait"];
    for (const api of WATCHED2) {
      if (url.includes(api)) {
        lastApiError2 = { api, status, time: Date.now() } as ApiError2;
        log(`[API错误] ${api} 返回 ${status}`, "warn");
        break;
      }
    }
  });

  while (refreshCount <= MAX_REFRESHES) {
    await sleep(1500);
    // 每轮开始清除上一轮遗留的 API 错误状态（对齐插件的 lastApiResult = null）
    lastApiError2 = null;

    const url = page.url();
    if (!url.includes("manus.im/verify-phone")) {
      log(`阶段二：当前 URL 异常（${url}），等待跳转...`);
      await sleep(2000);
    }

    let countrySelected = false;
    let phoneFilled = false;
    let phoneRetryCount = 0;      // 情况一：手机号输入后按钮 disabled 的清空重输次数
    let phoneClickRetryCount = 0; // 情况二： Send code 按钮点击后页面未变化的重试次数
    let phoneSendClicked = false;
    let smsCodeFilled = false;
    let smsCodeRetryCount = 0;    // 情况一：短信验证码输入后按钮 disabled 的清空重输次数
    let smsClickRetryCount = 0;   // 情况二：手机号确认按钮点击后页面未跳转的重试次数
    let stepStallCount = 0;
    const roundStart = Date.now();

    for (let i = 0; i < 300; i++) {
      await sleep(1000);

      if (Date.now() - roundStart > PHASE_TIMEOUT) {
        log("阶段二超时，正在刷新重试...", "warn");
        break;
      }

      // A. 选择国家
      if (!countrySelected) {
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
        continue;
      }

      // B. 输入手机号
      if (!phoneFilled) {
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
        continue;
      }

      // API 错误处理（对齐插件的 getRecentApiError 机制）
      const _err2 = lastApiError2 as ApiError2 | null;
      if (_err2 && (Date.now() - _err2.time) < 5000) {
        lastApiError2 = null;
        log(`[API错误] ${_err2.api} 返回 ${_err2.status}，等待 3 秒后重试...`, "warn");
        if (_err2.api === "SendPhoneVerificationCode") {
          phoneSendClicked = false;  // 插件逻辑：发送失败重置发送状态
        } else if (_err2.api === "BindPhoneTrait") {
          smsCodeFilled = false;  // 插件逻辑：BindPhoneTrait 失败重置短信验证码填写状态
        }
        await sleep(3000);
        continue;
      }

      // C. 点击 Send code
      if (!phoneSendClicked) {
        await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
        // 检测手机号发送按钮状态
        const phoneBtnState = await page.evaluate(() => {
          const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return "no-button";
          if (btn.disabled) return "disabled"; // 情况一：按钮 disabled
          return "clickable";
        });

        if (phoneBtnState === "disabled") {
          // 情况一：手机号输入后按钮仍 disabled，先等待 1.5 秒给页面响应时间，再次检测
          await sleep(1500);
          const phoneBtnStateRetry = await page.evaluate(() => {
            const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
            if (!btn || btn.offsetParent === null) return "no-button";
            if (btn.disabled) return "disabled";
            return "clickable";
          });
          if (phoneBtnStateRetry === "clickable") {
            continue;
          }
          // 仍然 disabled，才清空重输
          phoneRetryCount++;
          if (phoneRetryCount > 3) {
            log("手机号按钮持续 disabled，刷新重试...", "warn"); break;
          }
          log(`手机号按钮持续 disabled，清空重输（第 ${phoneRetryCount} 次）...`, "warn");
          await page.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (!el) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(el, ""); else el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, 'input#phone[type="tel"]');
          await sleep(500);
          phoneFilled = false;
        } else if (phoneBtnState === "clickable") {
          // 按钮可点击，执行点击
          await page.evaluate(async () => {
            const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
            if (btn) { await new Promise((r) => setTimeout(r, 500)); btn.click(); }
          });
          log("发送验证码按钮已点击，后台获取短信验证码中...");
          await sleep(2500);
          // 情况二：点击后检测短信验证码输入框是否出现
          const afterPhoneClick = await page.evaluate(() => {
            const el = document.querySelector("input#phone-code") as HTMLElement | null;
            return !!(el && el.offsetParent !== null);
          });
          if (afterPhoneClick) {
            phoneSendClicked = true;
            phoneClickRetryCount = 0;
            stepStallCount = 0;
            if (!smsCodeFetching) {
              smsCodeFetching = true;
              fetchSmsCode(phoneInfo.smsUrl).then(async (code) => {
                smsCode = code;
                if (code) {
                  log(`短信验证码已就绪：${code}`);
                  if (!phoneMarkedUsed) {
                    await markPhoneUsedById(phoneInfo.backendPhoneId).catch(() => {});
                    phoneMarkedUsed = true;
                  }
                } else {
                  log("短信验证码获取超时", "warn");
                }
              });
            }
          } else {
            // 页面未变化，再次尝试
            phoneClickRetryCount++;
            if (phoneClickRetryCount > 3) {
              log("发送验证码按钮点击后页面始终未变化，刷新重试...", "warn"); break;
            }
            log(`发送按钮已点击但页面未变化，第 ${phoneClickRetryCount} 次重试...`, "warn");
          }
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("发送验证码按钮卡住，刷新重试...", "warn"); break; }
        }
        continue;
      }

      // D. 填入短信验证码
      if (!smsCodeFilled) {
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
        continue;
      }

      // E. 点击确认，等待跳转到 /app
      await simulateMouseMove(page, 'button[class*="Button-primary-black"]');
      // 检测短信验证码确认按钮状态
      const smsBtnState = await page.evaluate(() => {
        const codeEl = document.querySelector("input#phone-code") as HTMLInputElement | null;
        if (!codeEl || !codeEl.value.trim()) return "no-code";
        const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
        if (!btn || btn.offsetParent === null) return "no-button";
        if (btn.disabled) return "disabled"; // 情况一：按钮 disabled
        return "clickable";
      });

      if (smsBtnState === "no-code") {
        // 短信验证码输入框为空，重置允许重新填入
        smsCodeFilled = false;
        stepStallCount++;
        if (stepStallCount >= 10) { log("短信验证码输入框持续为空，刷新重试...", "warn"); break; }
      } else if (smsBtnState === "disabled") {
        // 情况一：短信验证码已输入但按钮 disabled，先等待 1.5 秒给页面响应时间，再次检测
        await sleep(1500);
        const smsBtnStateRetry = await page.evaluate(() => {
          const btn = document.querySelector('button[class*="Button-primary-black"]') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return "no-button";
          if (btn.disabled) return "disabled";
          return "clickable";
        });
        if (smsBtnStateRetry === "clickable") {
          continue;
        }
        // 仍然 disabled，才清空重输
        smsCodeRetryCount++;
        if (smsCodeRetryCount > 3) {
          log("短信验证码按钮持续 disabled，刷新重试...", "warn"); break;
        }
        log(`短信验证码按钮持续 disabled，清空重输（第 ${smsCodeRetryCount} 次）...`, "warn");
        await page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLInputElement | null;
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
          if (setter) setter.call(el, ""); else el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, "input#phone-code");
        await sleep(500);
        smsCodeFilled = false;
      } else if (smsBtnState === "clickable") {
        // 按钮可点击，执行点击
        await page.evaluate(async () => {
          const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
          if (btn) { await new Promise((r) => setTimeout(r, 500)); btn.click(); }
        });
        log("手机号确认按钮已点击，等待跳转至 /app...");
        try {
          await page.waitForURL((url: URL) => url.toString().includes("manus.im/app"), { timeout: 30000 });
          log("阶段二完成 → 已进入 /app");
          return { result: "app", phoneInfo };
        } catch {
          // 情况二：点击后 30 秒内页面未跳转，重置允许重试
          smsClickRetryCount++;
          if (smsClickRetryCount > 3) {
            log("手机号确认按钮点击后页面始终未跳转，刷新重试...", "warn"); break;
          }
          log(`手机号确认按钮已点击但页面未跳转，第 ${smsClickRetryCount} 次重试...`, "warn");
        }
      } else {
        stepStallCount++;
        if (stepStallCount >= 20) { log("手机号确认按钮卡住，刷新重试...", "warn"); break; }
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
  if (!phoneMarkedUsed) {
    log(`阶段二超时，短信未收到，手机号 ${acquiredPhoneId} 已归还`, "warn");
    await resetPhoneStatusById(acquiredPhoneId).catch(() => {});
  } else {
    log(`阶段二超时，短信已收到，手机号 ${acquiredPhoneId} 保持已使用状态`, "warn");
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
  log: Logger
) {
  log("注册成功！开始执行注册后续步骤...", "success");

  // ── Step 0: 验证邀请码 (CheckInvitationCode) ──
  // 对应 Python 脚本 step10：用注册时使用的邀请码调用验证接口
  // 邀请码验证失败则抛出 InviteCodeFailedError，不插入数据库，并由 scheduler 停止所有任务
  if (capturedToken && referrerCode) {
    log(`正在验证邀请码：${referrerCode}...`);
    try {
      const checkResp = await fetch("https://api.manus.im/user.v1.UserService/CheckInvitationCode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${capturedToken}`,
        },
        body: JSON.stringify({ code: referrerCode }),
      });
      if (checkResp.ok) {
        log(`邀请码验证成功：${referrerCode}`, "success");
      } else {
        const errText = await checkResp.text().catch(() => "");
        log(`邀请码验证失败（HTTP ${checkResp.status})：${errText}，停止所有任务`, "error");
        throw new InviteCodeFailedError(`CheckInvitationCode 返回 ${checkResp.status}: ${errText}`);
      }
    } catch (e: any) {
      if (e instanceof InviteCodeFailedError) throw e; // 原样抛出
      log(`邀请码验证请求异常：${e.message}，停止所有任务`, "error");
      throw new InviteCodeFailedError(`CheckInvitationCode 请求异常: ${e.message}`);
    }
  } else {
    log("无 token 或无邀请码，跳过 CheckInvitationCode", "warn");
  }

  // ── Step 1: 兼换推广码 ──
  // 注意：BindPhoneTrait 成功后 token 已捕获，直接用 token 调用 API，无需刷新页面
  log("正在兼换推广码...");
  await redeemPromotion(page, capturedToken, log);

  // ── Step 2: 直接用 token 调用 API 采集用户数据（跳过页面刷新等待）──
  // 原逻辑（页面刷新等待 API 响应）已注释，改为直接 HTTP 调用，速度更快且不依赖页面跳转
  /*
  log("正在刷新页面，采集用户数据...");
  capturedUserData.membershipVersion = null;
  capturedUserData.totalCredits = null;
  capturedUserData.inviteCode = null;

  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await sleep(3000);

  // 等待 3 个 API 数据（最多 30 秒）
  const dataWaitStart = Date.now();
  while (Date.now() - dataWaitStart < 30000) {
    if (capturedUserData.membershipVersion && capturedUserData.totalCredits !== null && capturedUserData.inviteCode) {
      log("所有用户数据采集完成");
      break;
    }
    await sleep(1000);
  }
  */

  // 直接用 token 调用 API 获取积分和邀请码
  if (capturedToken) {
    log("正在通过 API 直接获取积分和邀请码...");
    const apiData = await fetchUserDataByToken(capturedToken, log);
    if (apiData.totalCredits !== null) capturedUserData.totalCredits = apiData.totalCredits;
    if (apiData.freeCredits !== null) capturedUserData.freeCredits = apiData.freeCredits;
    if (apiData.refreshCredits !== null) capturedUserData.refreshCredits = apiData.refreshCredits;
    if (apiData.inviteCode) capturedUserData.inviteCode = apiData.inviteCode;
    if (apiData.membershipVersion) capturedUserData.membershipVersion = apiData.membershipVersion;
  } else {
    log("未获取到 token，跳过 API 数据采集", "warn");
  }

  // 获取 clientId（仍从 localStorage 读取）
  const clientId = await page.evaluate(() => localStorage.getItem("client_id_v2")).catch(() => null);
  capturedUserData.clientId = clientId;

  log(`数据采集：会员版本=${capturedUserData.membershipVersion}，积分=${capturedUserData.totalCredits}，邀请码=${capturedUserData.inviteCode}`);

  // Step 3: 上报注册数据到后端数据库（直接调用 DB，不走 HTTP）
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

async function redeemPromotion(page: Page, token: string | null, log: Logger) {
  if (!token) { log("未获取到 Token，跳过推广码兑换", "warn"); return; }

  const clientId = await page.evaluate(() => localStorage.getItem("client_id_v2")).catch(() => null);
  if (!clientId) { log("未获取到 clientId，跳过推广码兑换", "warn"); return; }

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

  if (!redeemResult?.ok && redeemResult?.status === 0) {
    log(`推广码兑换请求失败：${redeemResult?.body}`, "warn");
    return;
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
      if (st.includes("SUCCESS")) { log("推广码兑换成功！"); return; }
      if (st.includes("FAILED")) { log(`推广码兑换失败：${pollResult?.body}`, "warn"); return; }
    } catch {}
  }
  log("推广码兑换轮询超时（可能仍在处理中）", "warn");
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

/** 点击注册入口（邀请页面） */
async function clickRegistrationEntry(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const clicked = await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll('button, a[role="button"], [class*="Button"]'));
      for (const btn of buttons) {
        const text = (btn.textContent || "").trim().toLowerCase();
        if (text.includes("accept") || text.includes("register") || text.includes("sign up") ||
            text.includes("注册") || text.includes("接受") || text.includes("get started") ||
            text.includes("create account") || text.includes("join")) {
          if ((btn as HTMLElement).offsetParent !== null) {
            (btn as HTMLElement).click();
            return true;
          }
        }
      }
      // 插件的 fallback：尝试点击登录/注册链接
      const links = Array.from(document.querySelectorAll('a[href*="login"], a[href*="register"], a[href*="signup"]'));
      for (const link of links) {
        if ((link as HTMLElement).offsetParent !== null) {
          (link as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (clicked) {
      await sleep(3000);
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
      await sleep(2000);
      break;
    }
    await sleep(2000);
  }
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
    const prefix = `[Automation][Task ${taskId}][${profileId.substring(0, 8)}]`;
    if (level === "error") console.error(`${prefix} ${msg}`);
    else if (level === "warn") console.warn(`${prefix} ${msg}`);
    else console.log(`${prefix} ${msg}`);
    // 异步写入数据库（不 await，不阻塞主流程）
    const dbLevel = level === "warn" ? "warning" : level;
    appendStepLog(logId, msg, dbLevel as "info" | "success" | "warning" | "error").catch(() => {});
  };
}
