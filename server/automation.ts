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
  recordUsedIp,
  updateTaskLog,
  incrementTaskCounters,
  saveRegistrationResult,
} from "./db";
import { stopAndDeleteAdsPowerBrowser } from "./adspower";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

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
  exitIp?: string;            // 已检测的出口IP（可选）
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
  const { taskId, logId, profileId, wsEndpoint, exitIp, adspowerConfig } = params;
  const startTime = Date.now();
  const log = makeLogger(taskId, profileId);

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
    log("Connecting to AdsPower browser via CDP...");
    browser = await chromium.connectOverCDP(wsEndpoint, { timeout: 30000 });
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    log(`Connected. Current URL: ${page.url()}`);

    // ── 设置网络响应拦截（替代 chrome.debugger）──
    setupResponseInterception(page, capturedUserData, (token) => {
      capturedToken = token;
      log(`[Token] Captured: ${token.substring(0, 30)}...`);
    });

    // ── Step 0: 获取邀请码（原子锁）──
    log("Claiming invite code...");
    const inviteCodeData = await claimNextInviteCode();
    if (!inviteCodeData) {
      log("No available invite codes, skipping");
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
    log(`Invite code: ${inviteCode} (from ${inviteCodeData.email}, id=${inviterAccountId})`);

    // ── Step 1: 购买邮箱 ──
    log("Buying email...");
    let email: string;
    let codeUrl: string;
    try {
      ({ email, codeUrl } = await buyEmail());
      log(`Email purchased: ${email}`);
    } catch (e: any) {
      await resetInviteCodeStatus(inviterAccountId);
      throw new Error(`购买邮箱失败: ${e.message}`);
    }

    // ── Step 2: 生成密码 ──
    const password = generatePassword();
    log(`Password generated`);

    // ── Step 3: 打开邀请链接 ──
    log(`Opening invite URL: ${inviteUrl}`);
    await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3000);

    // 如果在邀请页面，点击注册入口
    const currentUrl = page.url();
    if (currentUrl.includes("manus.im/invitation") || currentUrl.includes("manus.im/register") || currentUrl.includes("manus.im/signup")) {
      log("On invitation page, looking for registration entry...");
      await clickRegistrationEntry(page);
    }

    // ── 阶段一：login 页面 ──
    log("=== Phase 1: Login page ===");
    const loginResult = await handleLoginPage(page, email, password, codeUrl, log);

    if (loginResult === "app") {
      // 直接跳到 /app，无需手机验证
      await finishRegistration(page, email, password, null, inviteCode, inviterAccountId, capturedToken, capturedUserData, taskId, logId, profileId, exitIp, adspowerConfig, startTime, log);
      return;
    }

    if (loginResult !== "verify-phone") {
      await resetInviteCodeStatus(inviterAccountId);
      throw new Error(`阶段一异常结束: ${loginResult}`);
    }

    // ── 阶段二：verify-phone 页面 ──
    log("=== Phase 2: Phone verification page ===");
    const phoneResult = await handleVerifyPhonePage(page, log);

    if (phoneResult.result === "app" && phoneResult.phoneInfo) {
      await finishRegistration(page, email, password, phoneResult.phoneInfo, inviteCode, inviterAccountId, capturedToken, capturedUserData, taskId, logId, profileId, exitIp, adspowerConfig, startTime, log);
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
    log(`Registration failed: ${msg}`, "error");

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
  onSendPhoneError?: () => void  // SendPhoneVerificationCode 失败回调
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
    } catch {}
  });
}

// ─── 阶段一：login 页面 ──────────────────────────────────────────────────────

async function handleLoginPage(
  page: Page,
  email: string,
  password: string,
  codeUrl: string,
  log: Logger
): Promise<"verify-phone" | "app" | "timeout" | "error"> {
  const PHASE_TIMEOUT = 180000;
  const MAX_REFRESHES = 3;
  let refreshCount = 0;

  while (refreshCount <= MAX_REFRESHES) {
    await sleep(1500);

    const url = page.url();
    if (!url.includes("manus.im/login") && !url.includes("manus.im/register") &&
        !url.includes("manus.im/signup") && !url.includes("manus.im/invitation")) {
      log(`Phase 1: unexpected URL ${url}, waiting...`);
      await sleep(2000);
    }

    let emailFilled = false;
    let emailContinueClicked = false;
    let pwdFilled = false;
    let pwdContinueClicked = false;
    let verifyCodeFetching = false;
    let verifyCode: string | null = null;
    let verifyCodeFilled = false;
    let stepStallCount = 0;
    const roundStart = Date.now();

    for (let i = 0; i < 300; i++) {
      await sleep(1000);

      if (Date.now() - roundStart > PHASE_TIMEOUT) {
        log("Phase 1 timeout, refreshing...", "warn");
        break;
      }

      // 1. 输入邮箱
      if (!emailFilled) {
        log("Filling email...");
        const ok = await typeIntoField(page, 'input#email[autocomplete="email"], input#email[type="email"], input#email', email);
        if (ok) {
          emailFilled = true;
          stepStallCount = 0;
          log(`Email filled: ${email}`);
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on email input, refreshing...", "warn"); break; }
        }
        continue;
      }

      // 2. 点击邮箱 Continue
      if (!emailContinueClicked) {
        const clicked = await page.evaluate(async () => {
          const pwdEl = document.querySelector('input[name="password"][type="password"]') as HTMLElement | null;
          const inEmailStep = !pwdEl || pwdEl.classList.contains("hidden") || pwdEl.offsetParent === null;
          if (!inEmailStep) return true;
          const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return false;
          await new Promise((r) => setTimeout(r, 800));
          btn.click();
          return true;
        });
        if (clicked) {
          emailContinueClicked = true;
          stepStallCount = 0;
          log("Email Continue clicked");
          await sleep(2000);
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on email Continue, refreshing...", "warn"); break; }
        }
        continue;
      }

      // 3. 输入密码
      if (!pwdFilled) {
        const ok = await typeIntoField(page, 'input[name="password"][type="password"]', password);
        if (ok) {
          pwdFilled = true;
          stepStallCount = 0;
          log("Password filled");
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on password input, refreshing...", "warn"); break; }
        }
        continue;
      }

      // 4. 点击密码 Continue
      if (!pwdContinueClicked) {
        const clicked = await page.evaluate(async () => {
          const pwdEl = document.querySelector('input[name="password"][type="password"]') as HTMLElement | null;
          const inPwdStep = pwdEl && !pwdEl.classList.contains("hidden") && pwdEl.offsetParent !== null;
          if (!inPwdStep) return false;
          const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return false;
          await new Promise((r) => setTimeout(r, 800));
          btn.click();
          return true;
        });
        if (clicked) {
          pwdContinueClicked = true;
          stepStallCount = 0;
          log("Password Continue clicked, fetching email verify code in background...");
          if (!verifyCodeFetching) {
            verifyCodeFetching = true;
            fetchVerifyCode(codeUrl).then((code) => {
              verifyCode = code;
              if (code) log(`Email verify code ready: ${code}`);
              else log("Email verify code timeout", "warn");
            });
          }
          await sleep(2000);
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on password Continue, refreshing...", "warn"); break; }
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
            const ok = await typeIntoField(page, 'input#verifyCode[name="verifyCode"]', verifyCode);
            if (ok) {
              verifyCodeFilled = true;
              stepStallCount = 0;
              log(`Email verify code filled: ${verifyCode}`);
              await sleep(800);
            }
          } else {
            if (i % 5 === 0) log("Waiting for email verify code...");
          }
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on verify code input, refreshing...", "warn"); break; }
        }
        continue;
      }

      // 6. 点击验证码确认，等待跳转
      const confirmed = await page.evaluate(async () => {
        const codeEl = document.querySelector('input#verifyCode[name="verifyCode"]') as HTMLInputElement | null;
        if (!codeEl || !codeEl.value.trim()) return false;
        const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
        if (!btn || btn.offsetParent === null) return false;
        await new Promise((r) => setTimeout(r, 800));
        btn.click();
        return true;
      });

      if (confirmed) {
        log("Verify code confirmed, waiting for navigation...");
        try {
          await page.waitForURL((url: URL) => url.toString().includes("manus.im/") && !url.toString().includes("manus.im/login") && !url.toString().includes("manus.im/register"), { timeout: 120000 });
          const navUrl = page.url();
          log(`Navigated to: ${navUrl}`);

          if (navUrl.includes("manus.im/verify-phone")) {
            log("Phase 1 complete → verify-phone");
            return "verify-phone";
          }
          if (navUrl.includes("manus.im/app")) {
            log("Phase 1 complete → /app (no phone verification needed)");
            return "app";
          }
          if (navUrl.includes("manus.im/auth_landing")) {
            log("Detected auth_landing, waiting for final redirect...");
            await page.waitForURL((url: URL) => url.toString().includes("manus.im/") && !url.toString().includes("auth_landing"), { timeout: 60000 });
            const finalUrl = page.url();
            if (finalUrl.includes("manus.im/verify-phone")) return "verify-phone";
            if (finalUrl.includes("manus.im/app")) return "app";
            log(`Unknown redirect after auth_landing: ${finalUrl}`, "warn");
            break;
          }
          log(`Unknown navigation target: ${navUrl}`, "warn");
          break;
        } catch {
          log("Navigation timeout after verify code confirm", "warn");
          break;
        }
      } else {
        stepStallCount++;
        if (stepStallCount >= 20) { log("Stalled on confirm button, refreshing...", "warn"); break; }
        continue;
      }
    }

    // 内层循环退出，刷新重试
    refreshCount++;
    if (refreshCount > MAX_REFRESHES) {
      log(`Phase 1 exhausted ${MAX_REFRESHES} refreshes`, "error");
      return "timeout";
    }
    log(`Phase 1 refresh #${refreshCount}...`, "warn");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);
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
  log: Logger
): Promise<{ result: "app" | "timeout" | "no-phone" | "error"; phoneInfo?: PhoneInfo }> {
  log("Phase 2: Fetching phone number from backend...");

  // 从数据库获取手机号
  const phoneData = await getNextAvailablePhone();
  if (!phoneData) {
    log("No available phone numbers", "error");
    return { result: "no-phone" };
  }

  const phoneInfo = parseBackendPhone(phoneData);
  const acquiredPhoneId = phoneData.id; // 记录获取的手机号 id，失败时用于归还
  log(`Phone: ${phoneInfo.phoneRaw} (${phoneInfo.iso})`);

  const MAX_REFRESHES = 3;
  let refreshCount = 0;
  const PHASE_TIMEOUT = 180000;

  let smsCodeFetching = false;
  let smsCode: string | null = null;
  let phoneMarkedUsed = false; // 提升到外层，超时时可读取
  let sendPhoneError = false;  // SendPhoneVerificationCode 接口失败标志

  // 监听 SendPhoneVerificationCode 接口失败，对齐插件逻辑
  const onSendPhoneError = () => { sendPhoneError = true; };
  page.on("response", async (response) => {
    if (response.url().includes("SendPhoneVerificationCode")) {
      const s = response.status();
      if (s < 200 || s >= 300) onSendPhoneError();
    }
  });

  while (refreshCount <= MAX_REFRESHES) {
    await sleep(1500);

    const url = page.url();
    if (!url.includes("manus.im/verify-phone")) {
      log(`Phase 2: unexpected URL ${url}, waiting...`);
      await sleep(2000);
    }

    let countrySelected = false;
    let phoneFilled = false;
    let phoneSendClicked = false;
    let smsCodeFilled = false;
    let stepStallCount = 0;
    const roundStart = Date.now();

    for (let i = 0; i < 300; i++) {
      await sleep(1000);

      if (Date.now() - roundStart > PHASE_TIMEOUT) {
        log("Phase 2 timeout, refreshing...", "warn");
        break;
      }

      // A. 选择国家
      if (!countrySelected) {
        const result = await selectCountry(page, phoneInfo.iso, phoneInfo.dialCode, log);
        if (result) {
          countrySelected = true;
          stepStallCount = 0;
          log(`Country selected: ${phoneInfo.iso} (${phoneInfo.dialCode})`);
          await sleep(800);
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on country select, refreshing...", "warn"); break; }
        }
        continue;
      }

      // B. 输入手机号
      if (!phoneFilled) {
        const ok = await typeIntoField(page, 'input#phone[type="tel"]', phoneInfo.phoneNumber);
        if (ok) {
          phoneFilled = true;
          stepStallCount = 0;
          log(`Phone filled: ${phoneInfo.phoneNumber}`);
          await sleep(800);
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on phone input, refreshing...", "warn"); break; }
        }
        continue;
      }

      // 处理 SendPhoneVerificationCode 接口失败：重置发送状态，对齐插件逻辑
      if (sendPhoneError) {
        log("SendPhoneVerificationCode API error, resetting send state...", "warn");
        phoneSendClicked = false;
        sendPhoneError = false;
        await sleep(3000);
        continue;
      }

      // C. 点击 Send code
      if (!phoneSendClicked) {
        const clicked = await page.evaluate(async () => {
          const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
          if (!btn || btn.offsetParent === null) return false;
          await new Promise((r) => setTimeout(r, 500));
          btn.click();
          return true;
        });
        if (clicked) {
          phoneSendClicked = true;
          stepStallCount = 0;
          log("Send code clicked, fetching SMS code in background...");
          await sleep(2000);
          if (!smsCodeFetching) {
            smsCodeFetching = true;
            fetchSmsCode(phoneInfo.smsUrl).then(async (code) => {
              smsCode = code;
              if (code) {
                log(`SMS code ready: ${code}`);
                if (!phoneMarkedUsed) {
                  await markPhoneUsedById(phoneInfo.backendPhoneId).catch(() => {});
                  phoneMarkedUsed = true;
                }
              } else {
                log("SMS code timeout", "warn");
              }
            });
          }
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on Send code, refreshing...", "warn"); break; }
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
            const ok = await typeIntoField(page, "input#phone-code", smsCode);
            if (ok) {
              smsCodeFilled = true;
              stepStallCount = 0;
              log(`SMS code filled: ${smsCode}`);
              await sleep(800);
            }
          } else {
            if (i % 5 === 0) log("Waiting for SMS code...");
          }
        } else {
          stepStallCount++;
          if (stepStallCount >= 20) { log("Stalled on SMS code input, refreshing...", "warn"); break; }
        }
        continue;
      }

      // E. 点击确认，等待跳转到 /app
      const confirmed = await page.evaluate(async () => {
        const btn = document.querySelector('button[class*="Button-primary-black"]:not([disabled])') as HTMLButtonElement | null;
        if (!btn || btn.offsetParent === null) return false;
        await new Promise((r) => setTimeout(r, 500));
        btn.click();
        return true;
      });

      if (confirmed) {
        log("Phone confirm clicked, waiting for /app...");
        try {
          await page.waitForURL((url: URL) => url.toString().includes("manus.im/app"), { timeout: 120000 });
          log("Phase 2 complete → /app");
          return { result: "app", phoneInfo };
        } catch {
          log("Timeout waiting for /app after phone confirm", "warn");
          break;
        }
      } else {
        stepStallCount++;
        if (stepStallCount >= 20) { log("Stalled on phone confirm, refreshing...", "warn"); break; }
        continue;
      }
    }

    // 内层循环退出，刷新重试
    refreshCount++;
    if (refreshCount > MAX_REFRESHES) {
      log(`Phase 2 exhausted ${MAX_REFRESHES} refreshes`, "error");
      return { result: "timeout" };
    }
    log(`Phase 2 refresh #${refreshCount}...`, "warn");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);

    // 刷新后检查是否已在 /app
    const afterReloadUrl = page.url();
    if (afterReloadUrl.includes("manus.im/app")) {
      log("After reload, already on /app!");
      return { result: "app", phoneInfo };
    }
  }

  // 阶段二超时：按插件逻辑处理手机号状态
  // - 如果短信已收到并标记使用（phoneMarkedUsed=true），保持已使用状态，不允许再次使用
  // - 如果按钮点了但短信未收到（phoneMarkedUsed=false），归还手机号供下次使用
  if (!phoneMarkedUsed) {
    log(`Phase 2 timeout, phone not marked used, resetting phone ${acquiredPhoneId} back to unused`, "warn");
    await resetPhoneStatusById(acquiredPhoneId).catch(() => {});
  } else {
    log(`Phase 2 timeout, phone ${acquiredPhoneId} already marked used (SMS received), keeping used status`, "warn");
  }
  return { result: "timeout" };
}

// ─── 完成注册（刷新 + 兑换推广码 + 采集数据 + 上报后端）────────────────────

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
  log("Registration successful! Starting post-registration steps...");

  // Step 1: 刷新 + 兑换推广码
  log("Reloading page and redeeming promotion code...");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  await sleep(2000);
  await redeemPromotion(page, capturedToken, log);

  // Step 2: 再次刷新，等待 API 数据
  log("Reloading to collect user data...");
  capturedUserData.membershipVersion = null;
  capturedUserData.totalCredits = null;
  capturedUserData.inviteCode = null;

  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  await sleep(3000);

  // 等待 3 个 API 数据（最多 30 秒）
  const dataWaitStart = Date.now();
  while (Date.now() - dataWaitStart < 30000) {
    if (capturedUserData.membershipVersion && capturedUserData.totalCredits !== null && capturedUserData.inviteCode) {
      log("All user data collected");
      break;
    }
    await sleep(1000);
  }

  // 获取 clientId
  const clientId = await page.evaluate(() => localStorage.getItem("client_id_v2")).catch(() => null);
  capturedUserData.clientId = clientId;

  log(`Data: membership=${capturedUserData.membershipVersion}, credits=${capturedUserData.totalCredits}, inviteCode=${capturedUserData.inviteCode}`);

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
      totalCredits: capturedUserData.totalCredits !== null ? Number(capturedUserData.totalCredits) : undefined,
      freeCredits: capturedUserData.freeCredits !== null ? Number(capturedUserData.freeCredits) : undefined,
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

    // 更新任务日志为成功
    await updateTaskLog(logId, {
      status: "success",
      durationMs,
      completedAt: new Date(),
    });

    await incrementTaskCounters(taskId, { totalSuccess: 1, totalAccountsCreated: 1 });
    log(`Registration complete! email=${email}, duration=${Math.round(durationMs / 1000)}s`);

  } catch (e: any) {
    log(`Failed to save registration result: ${e.message}`, "error");
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
  if (!token) { log("No token, skipping promotion code redemption", "warn"); return; }

  const clientId = await page.evaluate(() => localStorage.getItem("client_id_v2")).catch(() => null);
  if (!clientId) { log("No clientId, skipping promotion code redemption", "warn"); return; }

  const promotionCode = "techtiff";
  log(`Redeeming promotion code: ${promotionCode}`);

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
    log(`Promotion code redeem failed: ${redeemResult?.body}`, "warn");
    return;
  }

  log(`Promotion code submitted (${redeemResult?.status}), polling status...`);

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
      if (st.includes("SUCCESS")) { log("Promotion code redeemed successfully!"); return; }
      if (st.includes("FAILED")) { log(`Promotion code failed: ${pollResult?.body}`, "warn"); return; }
    } catch {}
  }
  log("Promotion code poll timeout (may still be processing)", "warn");
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 模拟逐字打字（与插件的 injectTyping 等效） */
async function typeIntoField(page: Page, selector: string, value: string): Promise<boolean> {
  try {
    const visible = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return !!(el && el.offsetParent !== null);
    }, selector);
    if (!visible) return false;

    // 使用 Playwright 内置的逐字打字（带随机延迟，模拟真人）
    const locator = page.locator(selector).first();
    await locator.click({ delay: 100 });
    await sleep(300 + Math.random() * 200);

    // 清空现有内容
    await locator.fill("");
    await sleep(100);

    // 逐字输入
    await locator.pressSequentially(value, { delay: 40 + Math.random() * 60 });
    return true;
  } catch {
    return false;
  }
}

/** 选择国家（与插件的国家选择逻辑等效） */
async function selectCountry(page: Page, iso: string, dialCode: string, log: Logger): Promise<boolean> {
  return await page.evaluate(async ({ isoCode, dc }: { isoCode: string; dc: string }) => {
    // 检查是否已选中
    const selectedEl = document.querySelector('[class*="PhoneInput"] [class*="selected"], [class*="country-select"] [class*="selected"]');
    if (selectedEl?.textContent?.includes(dc)) return true;

    // 找到国家选择触发器并点击
    const trigger = document.querySelector('[class*="PhoneInput"] button, [class*="country-select"] button, [class*="flag-dropdown"]') as HTMLElement | null;
    if (!trigger) return false;
    trigger.click();
    await new Promise((r) => setTimeout(r, 800));

    // 找搜索框
    const searchInput = document.querySelector('input[type="search"], input[placeholder*="search"], input[placeholder*="Search"]') as HTMLInputElement | null;
    if (!searchInput) return false;

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    async function typeSearch(term: string) {
      if (setter) setter.call(searchInput!, ""); else searchInput!.value = "";
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      if (setter) setter.call(searchInput!, term); else searchInput!.value = term;
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1000));
    }

    function getVisibleItems() {
      const items: HTMLElement[] = [];
      const selectors = ["[data-close-when-click=\"true\"] > *", "[role=\"listbox\"] > *", "[role=\"option\"]", "[role=\"menuitem\"]", "ul > li"];
      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          if ((el as HTMLElement).offsetParent !== null && el.textContent?.trim()) items.push(el as HTMLElement);
        }
        if (items.length > 0) break;
      }
      return items;
    }

       // 手机号固定为美国，硬编码搜索 United States，匹配 +1
    for (const term of ["United States", isoCode]) {
      await typeSearch(term);
      const items = getVisibleItems();
      for (const item of items) {
        const t = item.textContent || "";
        if ((t.includes("United States") || t.includes("美国")) && t.includes("+1")) {
          item.click();
          return true;
        }
      }
      for (const item of items) {
        const t = item.textContent || "";
        if (t.includes("+1") && (t.includes("US") || t.includes("United States"))) {
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

/** 轮询获取邮箱验证码（最多 3 分钟） */
async function fetchVerifyCode(codeUrl: string): Promise<string | null> {
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    try {
      const resp = await fetchWithTimeout(codeUrl, {}, 15000);
      const json = await resp.json() as any;
      const code = json.code || json.verify_code || json.verifyCode || json.data?.code;
      if (code && /^\d{4,8}$/.test(String(code))) return String(code);
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
type Logger = (msg: string, level?: "info" | "warn" | "error") => void;

/** 创建带前缀的日志函数 */
function makeLogger(taskId: number, profileId: string): Logger {
  return (msg: string, level: "info" | "warn" | "error" = "info") => {
    const prefix = `[Automation][Task ${taskId}][${profileId.substring(0, 8)}]`;
    if (level === "error") console.error(`${prefix} ${msg}`);
    else if (level === "warn") console.warn(`${prefix} ${msg}`);
    else console.log(`${prefix} ${msg}`);
  };
}
