import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  bigint,
  json,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 賬號表：存儲所有通過邀請碼鏈式注冊的賬號信息
 */
export const accounts = mysqlTable("accounts", {
  id: int("id").autoincrement().primaryKey(),

  // 賬號基本信息
  email: varchar("email", { length: 320 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  token: text("token"),

  // 用戶信息
  userId: varchar("userId", { length: 64 }),
  displayname: varchar("displayname", { length: 128 }),
  membershipVersion: varchar("membershipVersion", { length: 64 }).default("free"),
  phone: varchar("phone", { length: 32 }),
  clientId: varchar("clientId", { length: 64 }),

  // 積分信息
  totalCredits: int("totalCredits").default(0),
  freeCredits: int("freeCredits").default(0),
  refreshCredits: int("refreshCredits").default(0),

  // 邀請碼（此賬號持有的邀請碼）
  inviteCode: varchar("inviteCode", { length: 64 }).unique(),
  inviteCodeId: varchar("inviteCodeId", { length: 64 }),

  // 邀請碼狀態：unused=未使用, in_progress=邀請中, used=已使用
  inviteStatus: mysqlEnum("inviteStatus", ["unused", "in_progress", "used"]).default("unused").notNull(),

  // 邀请关系：此账号是被谁邀请的（存储邀请者的 inviteCode）
  invitedByCode: varchar("invitedByCode", { length: 64 }),
  // referrerCode：注册时填写的邀请人邀请码（与 invitedByCode 同义，直接来自插件上报）
  referrerCode: varchar("referrerCode", { length: 64 }),
  // 邀请者账号 ID（外键，自引用）
  invitedById: int("invitedById"),

  // 時間戳
  registeredAt: timestamp("registeredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),

  // 備注
  notes: text("notes"),
});

export type Account = typeof accounts.$inferSelect;
export type InsertAccount = typeof accounts.$inferInsert;

/**
 * 自動化任務表：管理定時掃描和自動注冊任務
 */
export const automationTasks = mysqlTable("automation_tasks", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),

  // 任務狀態：idle=空閒, running=運行中, paused=已暫停, stopped=已停止
  status: mysqlEnum("status", ["idle", "running", "paused", "stopped"]).default("idle").notNull(),

  // 配置
  scanIntervalSeconds: int("scanIntervalSeconds").default(60),  // 掃描間隔（秒）
  adspowerApiUrl: varchar("adspowerApiUrl", { length: 512 }).default("http://127.0.0.1:50325"),
  adspowerApiKey: varchar("adspowerApiKey", { length: 256 }),   // AdsPower API Key（開啟安全校驗時使用）
  adspowerGroupId: varchar("adspowerGroupId", { length: 64 }),
  targetUrl: varchar("targetUrl", { length: 512 }),              // 注冊目標 URL（插件打開的頁面）

  // 代理账号 ID（关联 proxy_accounts 表，优先使用此字段）
  proxyAccountId: int("proxyAccountId"),

  // 代理配置：socks5h://user:pass@host:port 格式，每次创建浏览器时使用此代理
  // 支持动态代理（每次拨号IP不同），留空则不使用代理
  proxyUrl: varchar("proxyUrl", { length: 1024 }),

  // 并发固定为 1（单线程），保留字段兼容旧数据
  maxConcurrent: int("maxConcurrent").default(1),
  targetCount: int("targetCount"),  // 注冊目標總數（達到後自動停止），NULL 表示不限制

  // 統計
  totalAccountsCreated: int("totalAccountsCreated").default(0),
  totalSuccess: int("totalSuccess").default(0),
  totalFailed: int("totalFailed").default(0),

  // 時間
  startedAt: timestamp("startedAt"),
  lastExecutedAt: timestamp("lastExecutedAt"),
  nextExecutionAt: timestamp("nextExecutionAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AutomationTask = typeof automationTasks.$inferSelect;
export type InsertAutomationTask = typeof automationTasks.$inferInsert;

/**
 * 任務執行日誌表：記錄每次自動化任務的執行詳情
 */
export const taskLogs = mysqlTable("task_logs", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId"),

  // 執行狀態
  status: mysqlEnum("status", ["pending", "running", "success", "failed", "skipped"]).default("pending").notNull(),

  // 使用的邀請碼（觸發本次注冊的邀請碼）
  usedInviteCode: varchar("usedInviteCode", { length: 64 }),
  // 邀請碼所屬賬號 ID
  sourceAccountId: int("sourceAccountId"),
  // 新創建的賬號 ID（成功時填寫）
  newAccountId: int("newAccountId"),

  // AdsPower 相關
  adspowerBrowserId: varchar("adspowerBrowserId", { length: 128 }),

  // 本次注册使用的出口IP（代理检测后记录）
  exitIp: varchar("exitIp", { length: 64 }),

  // 執行詳情
  errorMessage: text("errorMessage"),
  durationMs: int("durationMs"),  // 耗時（毫秒）

  // 時間
  startedAt: timestamp("startedAt").defaultNow(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskLog = typeof taskLogs.$inferSelect;
export type InsertTaskLog = typeof taskLogs.$inferInsert;

/**
 * 手机号表：存储用于注册的手机号和接码 URL
 * 格式：手机号|接码URL，例如 +12232263007|https://sms-555.com/xxx
 */
export const phoneNumbers = mysqlTable("phone_numbers", {
  id: int("id").autoincrement().primaryKey(),

  // 手机号（带国家代码，如 +12232263007）
  phone: varchar("phone", { length: 32 }).notNull().unique(),

  // 接码 URL（用于获取验证码）
  smsUrl: varchar("smsUrl", { length: 1024 }).notNull(),

  // 状态：unused=未使用, in_use=使用中, used=已使用
  status: mysqlEnum("status", ["unused", "in_use", "used"]).default("unused").notNull(),

  // 使用此号码注册的账号 email
  usedByEmail: varchar("usedByEmail", { length: 320 }),

  // 时间
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),

  // 备注
  notes: text("notes"),
});

export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type InsertPhoneNumber = typeof phoneNumbers.$inferInsert;

/**
 * 导出日志表：记录每次导出操作的账号明细
 * 每条记录对应一个被导出的账号，同一批次通过 exportBatchId 聚合
 */
export const exportLogs = mysqlTable("export_logs", {
  id: int("id").autoincrement().primaryKey(),

  // 批次号（同一次导出操作共享，格式如 EXPORT_20260330_143000_abc123）
  exportBatchId: varchar("exportBatchId", { length: 64 }).notNull(),

  // 账号信息（从 accounts 表复制，导出后 accounts 中该条记录会被删除）
  email: varchar("email", { length: 320 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  token: text("token"),
  userId: varchar("userId", { length: 64 }),
  displayname: varchar("displayname", { length: 128 }),
  phone: varchar("phone", { length: 32 }),
  membershipVersion: varchar("membershipVersion", { length: 64 }),
  totalCredits: int("totalCredits").default(0),

  // 邀请关系
  inviteCode: varchar("inviteCode", { length: 64 }),
  referrerCode: varchar("referrerCode", { length: 64 }),

  // 时间
  registeredAt: timestamp("registeredAt"),
  exportedAt: timestamp("exportedAt").defaultNow().notNull(),

  // 备注
  notes: text("notes"),
});

export type ExportLog = typeof exportLogs.$inferSelect;
export type InsertExportLog = typeof exportLogs.$inferInsert;

/**
 * 已用出口IP池：记录每次注册成功使用过的出口IP，防止重复使用同一IP注册
 * 动态代理每次拨号IP不同，此表确保不会重复使用同一出口IP
 */
export const usedIpPool = mysqlTable("used_ip_pool", {
  id: int("id").autoincrement().primaryKey(),

  // 出口 IP 地址（唯一）
  ip: varchar("ip", { length: 64 }).notNull().unique(),

  // 关联的账号 email（哪次注册用了这个IP）
  usedByEmail: varchar("usedByEmail", { length: 320 }),

  // 关联的任务日志 ID
  taskLogId: int("taskLogId"),

  // 时间
  usedAt: timestamp("usedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UsedIp = typeof usedIpPool.$inferSelect;
export type InsertUsedIp = typeof usedIpPool.$inferInsert;

/**
 * 代理账号表：存储代理账号、地区、代理 URL
 * 地区决定指纹的时区、语言、城市等配置
 */
export const proxyAccounts = mysqlTable("proxy_accounts", {
  id: int("id").autoincrement().primaryKey(),

  // 账号名称（便于识别）
  name: varchar("name", { length: 128 }).notNull(),

  // 地区代码：us / tw / hk / jp
  region: mysqlEnum("region", ["us", "tw", "hk", "jp"]).notNull(),

  // 代理 URL（socks5://user:pass@host:port 格式）
  proxyUrl: varchar("proxyUrl", { length: 1024 }).notNull(),

  // 备注
  notes: text("notes"),

  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProxyAccount = typeof proxyAccounts.$inferSelect;
export type InsertProxyAccount = typeof proxyAccounts.$inferInsert;
