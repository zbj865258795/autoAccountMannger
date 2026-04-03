/**
 * 系统配置文件
 * AdsPower API Key 等固定配置写在这里，无需在界面填写
 */

export const ADSPOWER_CONFIG = {
  /** AdsPower 本地 API 地址（本地运行，固定端口 50325） */
  apiUrl: "http://127.0.0.1:50325",

  /** AdsPower API Key（开启安全校验时必须，CLI 模式必须） */
  apiKey: "1dd5aa65da0c22934e189faa672ed1240063f1d06082b6d7",

  /** 创建浏览器后等待启动的超时时间（毫秒） */
  browserStartTimeoutMs: 30_000,

  /** 每次调度任务的扫描间隔（毫秒），默认 30 秒 */
  defaultScanIntervalMs: 30_000,
} as const;
