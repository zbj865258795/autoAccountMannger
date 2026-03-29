/**
 * AdsPower 集成服務
 * 用於創建指紋瀏覽器實例並觸發自動化注冊流程
 *
 * AdsPower 本地 API 文檔: http://local.adspower.net:50325
 */

import axios from "axios";

export interface AdsPowerConfig {
  apiUrl: string;
  groupId?: string;
}

export interface CreateBrowserResult {
  success: boolean;
  browserId?: string;
  webdriverPath?: string;
  debugPort?: number;
  error?: string;
}

export interface BrowserStatus {
  browserId: string;
  status: "Active" | "Inactive";
}

/**
 * 創建新的 AdsPower 指紋瀏覽器實例
 */
export async function createAdsPowerBrowser(
  config: AdsPowerConfig,
  inviteCode: string
): Promise<CreateBrowserResult> {
  try {
    // 1. 創建新的瀏覽器配置（指紋）
    const createProfileResponse = await axios.post(
      `${config.apiUrl}/api/v1/user/create`,
      {
        name: `AutoReg_${inviteCode}_${Date.now()}`,
        group_id: config.groupId || "0",
        remark: `Auto registration with invite code: ${inviteCode}`,
        // 使用隨機指紋
        fingerprint_config: {
          automatic_timezone: "1",
          language: ["en-US", "en"],
          ua: "",  // 自動生成 UA
        },
      },
      { timeout: 15000 }
    );

    if (createProfileResponse.data?.code !== 0) {
      return {
        success: false,
        error: `Failed to create browser profile: ${createProfileResponse.data?.msg}`,
      };
    }

    const browserId = createProfileResponse.data?.data?.id;
    if (!browserId) {
      return { success: false, error: "No browser ID returned from AdsPower" };
    }

    // 2. 啟動瀏覽器
    const openResponse = await axios.get(
      `${config.apiUrl}/api/v1/browser/start`,
      {
        params: {
          user_id: browserId,
          open_tabs: 1,
          ip_tab: 0,
          launch_args: JSON.stringify([
            `--invite-code=${inviteCode}`,  // 通過啟動參數傳遞邀請碼
          ]),
        },
        timeout: 30000,
      }
    );

    if (openResponse.data?.code !== 0) {
      return {
        success: false,
        browserId,
        error: `Failed to open browser: ${openResponse.data?.msg}`,
      };
    }

    return {
      success: true,
      browserId,
      webdriverPath: openResponse.data?.data?.webdriver,
      debugPort: openResponse.data?.data?.ws?.selenium,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Unknown AdsPower error",
    };
  }
}

/**
 * 停止並刪除 AdsPower 瀏覽器實例
 */
export async function closeAdsPowerBrowser(
  apiUrl: string,
  browserId: string
): Promise<boolean> {
  try {
    await axios.get(`${apiUrl}/api/v1/browser/stop`, {
      params: { user_id: browserId },
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 獲取 AdsPower 瀏覽器列表（用於檢查 API 連通性）
 */
export async function checkAdsPowerConnection(apiUrl: string): Promise<boolean> {
  try {
    const response = await axios.get(`${apiUrl}/api/v1/user/list`, {
      params: { page: 1, page_size: 1 },
      timeout: 5000,
    });
    return response.data?.code === 0;
  } catch {
    return false;
  }
}

/**
 * 獲取活躍的瀏覽器列表
 */
export async function getActiveBrowsers(apiUrl: string): Promise<BrowserStatus[]> {
  try {
    const response = await axios.get(`${apiUrl}/api/v1/browser/local-active`, {
      timeout: 5000,
    });
    if (response.data?.code === 0) {
      return (response.data?.data?.list || []).map((item: any) => ({
        browserId: item.user_id,
        status: "Active",
      }));
    }
    return [];
  } catch {
    return [];
  }
}
