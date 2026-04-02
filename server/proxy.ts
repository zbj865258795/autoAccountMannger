/**
 * 代理出口IP检测模块
 *
 * 功能：
 * 1. 通过 socks5h 代理请求外部 IP 检测服务，获取真实出口 IP
 * 2. 检查出口 IP 是否已在已用 IP 池中
 * 3. 最多重试 10 次，超过则停止任务
 *
 * 使用场景：每次创建 AdsPower 浏览器前调用，确保出口 IP 未被使用过
 */

import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { isIpUsed } from "./db";

// IP 检测服务列表（按优先级排序，失败时自动切换）
const IP_CHECK_URLS = [
  "https://api.ipify.org?format=json",
  "https://api4.my-ip.io/ip.json",
  "https://ipinfo.io/json",
];

const IP_CHECK_TIMEOUT_MS = 15000; // 15 秒超时

/**
 * 通过代理获取出口 IP
 * @param proxyUrl socks5h://user:pass@host:port 格式
 * @returns 出口 IP 字符串，失败返回 null
 */
export async function getExitIpViaProxy(proxyUrl: string): Promise<string | null> {
  for (const checkUrl of IP_CHECK_URLS) {
    try {
      const ip = await fetchIpViaProxy(proxyUrl, checkUrl);
      if (ip) return ip;
    } catch {
      // 尝试下一个检测服务
    }
  }
  return null;
}

async function fetchIpViaProxy(proxyUrl: string, checkUrl: string): Promise<string | null> {
  // 动态导入 node-fetch（避免 ESM/CJS 兼容问题）
  const fetch = (await import("node-fetch")).default;

  // 根据代理协议选择 agent
  const normalizedProxy = proxyUrl.trim();
  let agent: any;

  if (normalizedProxy.startsWith("socks5") || normalizedProxy.startsWith("socks4")) {
    agent = new SocksProxyAgent(normalizedProxy);
  } else if (normalizedProxy.startsWith("http://") || normalizedProxy.startsWith("https://")) {
    agent = new HttpsProxyAgent(normalizedProxy);
  } else {
    throw new Error(`不支持的代理协议: ${normalizedProxy}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IP_CHECK_TIMEOUT_MS);

  try {
    const resp = await fetch(checkUrl, {
      agent,
      signal: controller.signal as any,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });

    if (!resp.ok) return null;
    const data = await resp.json() as any;

    // 兼容不同服务的返回格式
    const ip = data.ip || data.query || data.IPv4 || null;
    if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      return ip;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 代理IP检测结果
 */
export interface ProxyCheckResult {
  success: boolean;
  exitIp?: string;
  error?: string;
  /** IP 已被使用过（需要换代理重试） */
  ipAlreadyUsed?: boolean;
}

/**
 * 检测代理出口IP，并验证是否在已用IP池中
 * @param proxyUrl 代理地址
 * @returns 检测结果
 */
export async function checkProxyExitIp(proxyUrl: string): Promise<ProxyCheckResult> {
  console.log(`[Proxy] 正在检测出口IP... 代理: ${maskProxyPassword(proxyUrl)}`);

  const exitIp = await getExitIpViaProxy(proxyUrl);

  if (!exitIp) {
    return {
      success: false,
      error: "代理连通性检测失败：无法获取出口IP，请检查代理配置或网络",
    };
  }

  console.log(`[Proxy] 出口IP: ${exitIp}`);

  // 检查是否已在已用IP池中
  const used = await isIpUsed(exitIp);
  if (used) {
    console.log(`[Proxy] 出口IP ${exitIp} 已在已用IP池中，需要重试`);
    return {
      success: false,
      exitIp,
      ipAlreadyUsed: true,
      error: `出口IP ${exitIp} 已被使用过，需要更换IP`,
    };
  }

  console.log(`[Proxy] 出口IP ${exitIp} 未使用过，可以继续`);
  return { success: true, exitIp };
}

/**
 * 带重试的代理IP检测
 * 最多重试 maxRetries 次，每次重试间隔 2 秒
 * 如果连续 maxRetries 次都是已用IP，说明需要更换代理平台，返回失败
 *
 * @param proxyUrl 代理地址
 * @param maxRetries 最大重试次数（默认 10）
 * @returns 最终检测结果
 */
export async function checkProxyWithRetry(
  proxyUrl: string,
  maxRetries = 10
): Promise<ProxyCheckResult & { retryCount: number }> {
  let retryCount = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await checkProxyExitIp(proxyUrl);

    if (result.success) {
      return { ...result, retryCount: attempt - 1 };
    }

    // 如果是连通性失败（不是IP重复），直接返回失败，不重试
    if (!result.ipAlreadyUsed) {
      return { ...result, retryCount: attempt - 1 };
    }

    // IP 已使用，等待 2 秒后重试（动态代理会重新拨号获取新IP）
    retryCount = attempt;
    console.log(`[Proxy] 第 ${attempt}/${maxRetries} 次尝试，IP已使用，等待 2 秒后重试...`);

    if (attempt < maxRetries) {
      await sleep(2000);
    }
  }

  return {
    success: false,
    retryCount,
    ipAlreadyUsed: true,
    error: `连续 ${maxRetries} 次获取到的出口IP均已使用，请更换代理平台或清理IP池`,
  };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 隐藏代理密码，用于日志输出 */
function maskProxyPassword(proxyUrl: string): string {
  try {
    const normalized = proxyUrl.replace(/^socks5h:\/\//, "socks5://");
    const url = new URL(normalized);
    if (url.password) {
      url.password = "***";
    }
    return url.toString().replace("socks5://", "socks5h://");
  } catch {
    return proxyUrl;
  }
}
