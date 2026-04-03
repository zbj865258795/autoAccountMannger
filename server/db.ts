import { and, asc, count, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { accounts, automationTasks, exportLogs, phoneNumbers, taskLogs, taskStepLogs, users, usedIpPool, proxyAccounts } from "../drizzle/schema";
import type { InsertAccount, InsertAutomationTask, InsertExportLog, InsertPhoneNumber, InsertTaskLog, InsertProxyAccount, InsertTaskStepLog } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function upsertUser(user: typeof users.$inferInsert): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: typeof users.$inferInsert = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export interface AccountFilter {
  search?: string;
  inviteStatus?: "unused" | "in_progress" | "used";
  membershipVersion?: string;
  minCredits?: number;
  maxCredits?: number;
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "totalCredits" | "registeredAt";
  sortOrder?: "asc" | "desc";
}

export async function getAccounts(filter: AccountFilter = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const {
    search,
    inviteStatus,
    membershipVersion,
    minCredits,
    maxCredits,
    page = 1,
    pageSize = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = filter;

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        like(accounts.email, `%${search}%`),
        like(accounts.inviteCode, `%${search}%`),
        like(accounts.displayname, `%${search}%`)
      )
    );
  }
  if (inviteStatus) conditions.push(eq(accounts.inviteStatus, inviteStatus));
  if (membershipVersion) conditions.push(eq(accounts.membershipVersion, membershipVersion));
  if (minCredits !== undefined) conditions.push(gte(accounts.totalCredits, minCredits));
  if (maxCredits !== undefined) conditions.push(lte(accounts.totalCredits, maxCredits));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const sortColumn =
    sortBy === "totalCredits"
      ? accounts.totalCredits
      : sortBy === "registeredAt"
      ? accounts.registeredAt
      : accounts.createdAt;

  const orderFn = sortOrder === "asc" ? asc : desc;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(whereClause)
      .orderBy(orderFn(sortColumn))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)` })
      .from(accounts)
      .where(whereClause),
  ]);

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

export async function getAccountById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return result[0];
}

export async function getAccountByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
  return result[0];
}

export async function getAccountByInviteCode(inviteCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(accounts).where(eq(accounts.inviteCode, inviteCode)).limit(1);
  return result[0];
}

export async function createAccount(data: InsertAccount) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(accounts).values(data);
  return result;
}

export async function updateAccount(id: number, data: Partial<InsertAccount>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(accounts).set(data).where(eq(accounts.id, id));
}

export async function deleteAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(accounts).where(eq(accounts.id, id));
}

export async function updateInviteStatus(
  inviteCode: string,
  status: "unused" | "in_progress" | "used"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(accounts).set({ inviteStatus: status }).where(eq(accounts.inviteCode, inviteCode));
}

export async function updateInviteStatusById(
  accountId: number,
  status: "unused" | "in_progress" | "used"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(accounts).set({ inviteStatus: status }).where(eq(accounts.id, accountId));
}

export async function getUnusedInviteCodes() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.inviteStatus, "unused"))
    .orderBy(asc(accounts.createdAt));
}

/**
 * 只读查询：获取当前未使用邀请码的数量（不修改任何状态）
 */
export async function getUnusedInviteCodeCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(accounts)
    .where(eq(accounts.inviteStatus, "unused"));
  return Number(result[0]?.count ?? 0);
}

/**
 * 原子操作：获取一个「未使用」邀请码并立即标记为「邀请中」
 * 使用 SELECT ... FOR UPDATE + UPDATE 事务，彻底防止并发重复分配
 * 返回被锁定的账号记录，若无可用则返回 null
 */
export async function claimNextInviteCode(): Promise<{
  id: number;
  inviteCode: string | null;
  email: string;
} | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 使用事务 + SELECT FOR UPDATE 保证原子性
  const result = await db.transaction(async (tx) => {
    // 1. 加行锁，找到第一条未使用的邀请码
    const rows = await tx
      .select({ id: accounts.id, inviteCode: accounts.inviteCode, email: accounts.email })
      .from(accounts)
      .where(eq(accounts.inviteStatus, "unused"))
      .orderBy(asc(accounts.createdAt))
      .limit(1)
      .for("update");

    if (rows.length === 0) return null;
    const row = rows[0];

    // 2. 原子更新为「邀请中」
    await tx
      .update(accounts)
      .set({ inviteStatus: "in_progress" })
      .where(eq(accounts.id, row.id));

    return row;
  });

  return result ?? null;
}

export async function getInvitationChain(accountId: number): Promise<typeof accounts.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];

  const chain: typeof accounts.$inferSelect[] = [];
  let currentId: number | null = accountId;

  // 向上追溯邀請鏈（找祖先）
  while (currentId !== null) {
    const result = await db.select().from(accounts).where(eq(accounts.id, currentId)).limit(1);
    if (!result[0]) break;
    chain.unshift(result[0]);
    currentId = result[0].invitedById ?? null;
  }

  // 向下追溯（找後代）
  const descendants = await getDescendants(accountId);
  chain.push(...descendants);

  return chain;
}

async function getDescendants(parentId: number): Promise<typeof accounts.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  const children = await db.select().from(accounts).where(eq(accounts.invitedById, parentId));
  const result: typeof accounts.$inferSelect[] = [];
  for (const child of children) {
    result.push(child);
    const grandchildren = await getDescendants(child.id);
    result.push(...grandchildren);
  }
  return result;
}

export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;

  const [
    totalAccountsResult,
    totalCreditsResult,
    avgMaxCreditsResult,
    unusedCodesResult,
    inProgressCodesResult,
    usedCodesResult,
    recentAccountsResult,
    totalExportedResult,
    pendingExportResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(accounts),
    db.select({ sum: sql<number>`sum(totalCredits)` }).from(accounts),
    db.select({ avg: sql<number>`avg(totalCredits)`, max: sql<number>`max(totalCredits)` }).from(accounts),
    db.select({ count: sql<number>`count(*)` }).from(accounts).where(eq(accounts.inviteStatus, "unused")),
    db.select({ count: sql<number>`count(*)` }).from(accounts).where(eq(accounts.inviteStatus, "in_progress")),
    db.select({ count: sql<number>`count(*)` }).from(accounts).where(eq(accounts.inviteStatus, "used")),
    db.select().from(accounts).orderBy(desc(accounts.createdAt)).limit(5),
    // 已导出总数：export_logs 表中的记录数
    db.select({ count: sql<number>`count(*)` }).from(exportLogs),
    // 待导出数：被邀请注册（referrerCode 不为空）且自己邀请码已被使用（inviteStatus=used）
    db.select({ count: sql<number>`count(*)` }).from(accounts).where(
      and(
        eq(accounts.inviteStatus, "used"),
        sql`${accounts.referrerCode} IS NOT NULL AND ${accounts.referrerCode} != ''`
      )
    ),
  ]);

  return {
    totalAccounts: Number(totalAccountsResult[0]?.count ?? 0),
    totalCredits: Number(totalCreditsResult[0]?.sum ?? 0),
    avgCredits: Math.round(Number(avgMaxCreditsResult[0]?.avg ?? 0)),
    maxCredits: Number(avgMaxCreditsResult[0]?.max ?? 0),
    unusedCodes: Number(unusedCodesResult[0]?.count ?? 0),
    inProgressCodes: Number(inProgressCodesResult[0]?.count ?? 0),
    usedCodes: Number(usedCodesResult[0]?.count ?? 0),
    recentAccounts: recentAccountsResult,
    totalExported: Number(totalExportedResult[0]?.count ?? 0),
    pendingExport: Number(pendingExportResult[0]?.count ?? 0),
  };
}

// ─── Credit Distribution ─────────────────────────────────────────────────────

export async function getCreditDistribution() {
  const db = await getDb();
  if (!db) return { membershipBreakdown: [], topAccounts: [], allAccounts: [] };

  const [membershipBreakdown, topAccounts, allAccounts] = await Promise.all([
    db
      .select({ membership: accounts.membershipVersion, count: sql<number>`count(*)` })
      .from(accounts)
      .groupBy(accounts.membershipVersion),
    db
      .select({ id: accounts.id, email: accounts.email, totalCredits: accounts.totalCredits })
      .from(accounts)
      .orderBy(desc(accounts.totalCredits))
      .limit(10),
    db
      .select({
        id: accounts.id,
        email: accounts.email,
        totalCredits: accounts.totalCredits,
        freeCredits: accounts.freeCredits,
        refreshCredits: accounts.refreshCredits,
        membershipVersion: accounts.membershipVersion,
      })
      .from(accounts)
      .orderBy(desc(accounts.totalCredits))
      .limit(100),
  ]);

  return { membershipBreakdown, topAccounts, allAccounts };
}

// ─── Automation Tasks ─────────────────────────────────────────────────────────

export async function getAutomationTasks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(automationTasks).orderBy(desc(automationTasks.createdAt));
}

export async function getAutomationTaskById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(automationTasks).where(eq(automationTasks.id, id)).limit(1);
  return result[0];
}

export async function createAutomationTask(data: InsertAutomationTask) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(automationTasks).values(data);
}

export async function updateAutomationTask(id: number, data: Partial<InsertAutomationTask>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(automationTasks).set(data).where(eq(automationTasks.id, id));
}

export async function deleteAutomationTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // 先删除关联的任务日志，再删除任务本身
  await db.delete(taskLogs).where(eq(taskLogs.taskId, id));
  await db.delete(automationTasks).where(eq(automationTasks.id, id));
}

/**
 * 原子自增任务计数器，彻底避免并发 read-modify-write 竞态
 * 使用 SQL SET col = col + delta 而非先读后写
 */
export async function incrementTaskCounters(
  id: number,
  deltas: {
    totalSuccess?: number;
    totalFailed?: number;
    totalAccountsCreated?: number;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const sets: Record<string, unknown> = { lastExecutedAt: new Date() };
  if (deltas.totalSuccess)
    sets.totalSuccess = sql`totalSuccess + ${deltas.totalSuccess}`;
  if (deltas.totalFailed)
    sets.totalFailed = sql`totalFailed + ${deltas.totalFailed}`;
  if (deltas.totalAccountsCreated)
    sets.totalAccountsCreated = sql`totalAccountsCreated + ${deltas.totalAccountsCreated}`;
  await db.update(automationTasks).set(sets).where(eq(automationTasks.id, id));
}

// ─── Task Logs ────────────────────────────────────────────────────────────────

export interface TaskLogFilter {
  taskId?: number;
  status?: "pending" | "running" | "success" | "failed" | "skipped";
  page?: number;
  pageSize?: number;
}

export async function getTaskLogs(filter: TaskLogFilter = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const { taskId, status, page = 1, pageSize = 50 } = filter;
  const conditions = [];
  if (taskId) conditions.push(eq(taskLogs.taskId, taskId));
  if (status) conditions.push(eq(taskLogs.status, status));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(taskLogs)
      .where(whereClause)
      .orderBy(desc(taskLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)` }).from(taskLogs).where(whereClause),
  ]);

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

export async function createTaskLog(data: InsertTaskLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(taskLogs).values(data);
  return result;
}

export async function updateTaskLog(id: number, data: Partial<InsertTaskLog>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(taskLogs).set(data).where(eq(taskLogs.id, id));
}

// ─── Phone Numbers ───────────────────────────────────────────────────────────────────────────────

/**
 * 批量导入手机号（支持“手机号|接码URL”格式）
 * 重复的手机号会被跳过（不报错）
 */
export async function bulkImportPhoneNumbers(
  lines: string[]
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 支持用 | 或空格分隔
    const separatorIdx = line.indexOf("|");
    if (separatorIdx === -1) {
      errors.push(`格式错误（缺少 | 分隔符）: ${line}`);
      continue;
    }

    const phone = line.slice(0, separatorIdx).trim();
    const smsUrl = line.slice(separatorIdx + 1).trim();

    if (!phone || !smsUrl) {
      errors.push(`手机号或接码URL为空: ${line}`);
      continue;
    }

    try {
      await db
        .insert(phoneNumbers)
        .values({ phone, smsUrl, status: "unused" })
        .onDuplicateKeyUpdate({ set: { smsUrl, updatedAt: new Date() } });
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`导入失败 ${phone}: ${msg}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

/**
 * 获取手机号列表（支持状态筛选和分页）
 */
export async function getPhoneNumbers(params: {
  status?: "unused" | "in_use" | "used";
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const conditions: ReturnType<typeof eq>[] = [];
  if (params.status) conditions.push(eq(phoneNumbers.status, params.status));
  if (params.search) conditions.push(like(phoneNumbers.phone, `%${params.search}%`));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(phoneNumbers)
      .where(whereClause)
      .orderBy(desc(phoneNumbers.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: count() })
      .from(phoneNumbers)
      .where(whereClause),
  ]);

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

/**
 * 获取下一个可用手机号（状态为 unused）
 * 同时将状态改为 in_use，防止并发重复分配
 */
export async function getNextAvailablePhone(): Promise<{
  id: number;
  phone: string;
  smsUrl: string;
} | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 使用事务 + SELECT FOR UPDATE 保证原子性，彻底防止并发重复分配
  const result = await db.transaction(async (tx) => {
    // 1. 加行锁，找到第一条未使用的手机号
    const rows = await tx
      .select({ id: phoneNumbers.id, phone: phoneNumbers.phone, smsUrl: phoneNumbers.smsUrl })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.status, "unused"))
      .orderBy(phoneNumbers.createdAt)
      .limit(1)
      .for("update");

    if (rows.length === 0) return null;
    const row = rows[0];

    // 2. 原子更新为「使用中」
    await tx
      .update(phoneNumbers)
      .set({ status: "in_use", updatedAt: new Date() })
      .where(eq(phoneNumbers.id, row.id));

    return row;
  });

  return result ?? null;
}

/**
 * 标记手机号为已使用（按 phone 字段查找，兼容旧逻辑）
 */
export async function markPhoneUsed(phone: string, usedByEmail?: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(phoneNumbers)
    .set({
      status: "used",
      usedByEmail: usedByEmail ?? null,
      usedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(phoneNumbers.phone, phone));
}
/**
 * 标记手机号为已使用（按 id 查找，推荐使用）
 */
export async function markPhoneUsedById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(phoneNumbers)
    .set({
      status: "used",
      usedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(phoneNumbers.id, id));
}

/**
 * 重置手机号状态为未使用（一键重置）
 */
export async function resetPhoneStatus(phone: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(phoneNumbers)
    .set({
      status: "unused",
      usedByEmail: null,
      usedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(phoneNumbers.phone, phone));
}

/**
 * 按 id 获取单条 task_log
 */
export async function getTaskLogById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(taskLogs).where(eq(taskLogs.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * 如果 task_log 占用了手机号（acquiredPhoneId 不为 null）且手机号尚未标记为 used，则归还手机号
 * 供 scheduler 的浏览器监控 / 强制停止路径调用
 */
export async function releasePhoneIfNeeded(taskLogId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const log = await getTaskLogById(taskLogId);
  if (!log || !log.acquiredPhoneId) return;
  // 只当手机号处于 in_use 状态时才归还（used 说明短信已收到，不应归还）
  const phones = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, log.acquiredPhoneId)).limit(1);
  const phone = phones[0];
  if (phone && phone.status === "in_use") {
    await db
      .update(phoneNumbers)
      .set({ status: "unused", usedByEmail: null, usedAt: null, updatedAt: new Date() })
      .where(eq(phoneNumbers.id, log.acquiredPhoneId));
    console.log(`[DB] Phone ${log.acquiredPhoneId} released back to unused (task_log ${taskLogId} failed/stopped)`);
  }
}

/**
 * 按 id 重置手机号状态为 unused（阶段二超时且短信未收到时归还）
 */
export async function resetPhoneStatusById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(phoneNumbers)
    .set({ status: "unused", usedByEmail: null, usedAt: null, updatedAt: new Date() })
    .where(eq(phoneNumbers.id, id));
}

/**
 * 删除手机号
 */
export async function deletePhoneNumbers(ids: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (ids.length === 0) return;
  await db.delete(phoneNumbers).where(inArray(phoneNumbers.id, ids));
}

/**
 * 获取手机号统计（各状态数量）
 */
export async function getPhoneStats(): Promise<{
  total: number;
  unused: number;
  inUse: number;
  used: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const results = await db
    .select({ status: phoneNumbers.status, count: count() })
    .from(phoneNumbers)
    .groupBy(phoneNumbers.status);

  const stats = { total: 0, unused: 0, inUse: 0, used: 0 };
  for (const row of results) {
    const n = Number(row.count);
    stats.total += n;
    if (row.status === "unused") stats.unused = n;
    else if (row.status === "in_use") stats.inUse = n;
    else if (row.status === "used") stats.used = n;
  }
  return stats;
}

// ─── 浏览器状态监控 ─────────────────────────────────────────────────────────────

/**
 * 获取所有状态为 running 且有 adspowerBrowserId 的任务日志
 * 用于浏览器状态轮询：检测浏览器是否异常关闭
 */
export async function getRunningLogsWithBrowserId() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(taskLogs)
    .where(
      and(
        eq(taskLogs.status, "running"),
        sql`${taskLogs.adspowerBrowserId} IS NOT NULL AND ${taskLogs.adspowerBrowserId} != ''`
      )
    );
}

/**
 * 将指定任务下所有 running 状态的日志批量标记为 failed
 * 用于手动停止/暂停任务时清理残留的 running 日志
 */
export async function failAllRunningLogsForTask(
  taskId: number,
  errorMessage: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .update(taskLogs)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    })
    .where(and(eq(taskLogs.taskId, taskId), eq(taskLogs.status, "running")));

  return (result as any)[0]?.affectedRows ?? 0;
}

/**
 * 获取指定任务下所有 running 且有 adspowerBrowserId 的日志
 * 用于停止任务时关闭对应的 AdsPower 浏览器
 */
export async function getRunningLogsForTask(taskId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(taskLogs)
    .where(
      and(
        eq(taskLogs.taskId, taskId),
        eq(taskLogs.status, "running"),
        sql`${taskLogs.adspowerBrowserId} IS NOT NULL AND ${taskLogs.adspowerBrowserId} != ''`
      )
    );
}

/**
 * 根据 adspowerBrowserId 查找当前 running 状态的任务日志
 * 用于插件异常上报时定位对应的任务和日志
 */
export async function getRunningLogByBrowserId(browserId: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(taskLogs)
    .where(
      and(
        eq(taskLogs.adspowerBrowserId, browserId),
        eq(taskLogs.status, "running")
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Export Logs ──────────────────────────────────────────────────────────────

/**
 * 生成导出批次号
 * 格式：EXPORT_YYYYMMDD_HHmmss_xxxx（xxxx 为随机 4 位十六进制）
 */
export function generateExportBatchId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `EXPORT_${date}_${time}_${rand}`;
}

/**
 * 查询满足导出条件的账号：
 *   1. 自己是被邀请注册的（referrerCode 不为空）
 *   2. 自己的邀请码已被使用（inviteStatus = 'used'）
 */
export async function getExportableAccounts(filter: {
  search?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const { search, page = 1, pageSize = 50 } = filter;

  const baseConditions = [
    eq(accounts.inviteStatus, "used"),
    sql`${accounts.referrerCode} IS NOT NULL AND ${accounts.referrerCode} != ''`,
  ];

  if (search) {
    baseConditions.push(
      or(
        like(accounts.email, `%${search}%`),
        like(accounts.inviteCode, `%${search}%`),
        like(accounts.referrerCode, `%${search}%`)
      ) as any
    );
  }

  const whereClause = and(...baseConditions);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(whereClause)
      .orderBy(desc(accounts.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)` }).from(accounts).where(whereClause),
  ]);

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

/**
 * 查询满足导出条件的账号总数（用于弹窗实时展示）
 */
export async function getExportableCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(accounts)
    .where(
      and(
        eq(accounts.inviteStatus, "used"),
        sql`${accounts.referrerCode} IS NOT NULL AND ${accounts.referrerCode} != ''`
      )
    );
  return Number(result[0]?.count ?? 0);
}

/**
 * 执行导出：按数量取前 N 条满足条件的账号（按 registeredAt 升序，先注册先导出）
 *   1. 将账号完整信息写入 export_logs 表
 *   2. 从 accounts 表物理删除这些账号（事务保证原子性）
 *   返回批次号和实际导出数量
 */
export async function exportAccounts(
  count: number
): Promise<{ batchId: string; exported: number }> {
  if (count <= 0) return { batchId: "", exported: 0 };

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 1. 查询满足条件的前 N 条账号（按 registeredAt 升序，先注册先导出）
  const rows = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.inviteStatus, "used"),
        sql`${accounts.referrerCode} IS NOT NULL AND ${accounts.referrerCode} != ''`
      )
    )
    .orderBy(asc(accounts.registeredAt))
    .limit(count);

  if (rows.length === 0) return { batchId: "", exported: 0 };

  const batchId = generateExportBatchId();
  const exportedAt = new Date();

  // 2. 批量写入 export_logs + 3. 物理删除 accounts，包裹在事务中保证原子性
  const logRows: InsertExportLog[] = rows.map((row) => ({
    exportBatchId: batchId,
    email: row.email,
    password: row.password,
    token: row.token ?? undefined,
    userId: row.userId ?? undefined,
    displayname: row.displayname ?? undefined,
    phone: row.phone ?? undefined,
    membershipVersion: row.membershipVersion ?? undefined,
    totalCredits: row.totalCredits ?? 0,
    inviteCode: row.inviteCode ?? undefined,
    referrerCode: row.referrerCode ?? undefined,
    registeredAt: row.registeredAt ?? undefined,
    exportedAt,
  }));

  const exportedIds = rows.map((r) => r.id);

  await db.transaction(async (tx) => {
    await tx.insert(exportLogs).values(logRows);
    await tx.delete(accounts).where(inArray(accounts.id, exportedIds));
  });

  return { batchId, exported: rows.length };
}

/**
 * 查询导出批次列表（按批次号聚合）
 */
export async function getExportBatches(filter: {
  search?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const { search, page = 1, pageSize = 20 } = filter;

  // 按批次聚合：批次号、导出时间、账号数量
  const conditions = [];
  if (search) {
    conditions.push(
      or(
        like(exportLogs.exportBatchId, `%${search}%`),
        like(exportLogs.email, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select({
        exportBatchId: exportLogs.exportBatchId,
        exportedAt: sql<Date>`MIN(${exportLogs.exportedAt})`,
        accountCount: sql<number>`count(*)`,
      })
      .from(exportLogs)
      .where(whereClause)
      .groupBy(exportLogs.exportBatchId)
      .orderBy(desc(sql`MIN(${exportLogs.exportedAt})`))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(DISTINCT ${exportLogs.exportBatchId})` })
      .from(exportLogs)
      .where(whereClause),
  ]);

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

/**
 * 查询某个批次的账号明细
 */
export async function getExportBatchDetail(filter: {
  batchId: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const { batchId, search, page = 1, pageSize = 50 } = filter;

  const conditions = [eq(exportLogs.exportBatchId, batchId)];
  if (search) {
    conditions.push(
      or(
        like(exportLogs.email, `%${search}%`),
        like(exportLogs.inviteCode, `%${search}%`),
        like(exportLogs.referrerCode, `%${search}%`)
      ) as any
    );
  }

  const whereClause = and(...conditions);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(exportLogs)
      .where(whereClause)
      .orderBy(asc(exportLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)` }).from(exportLogs).where(whereClause),
  ]);

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

// ─── Used IP Pool ─────────────────────────────────────────────────────────────

/**
 * 检查某个出口IP是否已在已用IP池中
 * 用于防止重复使用同一IP注册账号
 */
export async function isIpUsed(ip: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select({ id: usedIpPool.id }).from(usedIpPool)
    .where(eq(usedIpPool.ip, ip)).limit(1);
  return result.length > 0;
}

/**
 * 将出口IP记录到已用IP池（注册成功后调用）
 */
export async function recordUsedIp(ip: string, usedByEmail?: string, taskLogId?: number) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(usedIpPool).values({
      ip,
      usedByEmail: usedByEmail ?? null,
      taskLogId: taskLogId ?? null,
    }).onDuplicateKeyUpdate({ set: { usedByEmail: usedByEmail ?? null } });
  } catch {
    // 忽略重复插入错误
  }
}

/**
 * 获取已用IP池列表（分页）
 */
export async function getUsedIpPool(filter: {
  search?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const { search, page = 1, pageSize = 50 } = filter;
  const conditions: ReturnType<typeof eq>[] = [];
  if (search) {
    conditions.push(
      or(
        like(usedIpPool.ip, `%${search}%`),
        like(usedIpPool.usedByEmail, `%${search}%`)
      ) as any
    );
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [items, countResult] = await Promise.all([
    db.select().from(usedIpPool).where(whereClause)
      .orderBy(desc(usedIpPool.usedAt))
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)` }).from(usedIpPool).where(whereClause),
  ]);
  return { items, total: Number(countResult[0]?.count ?? 0) };
}

/**
 * 获取已用IP总数
 */
export async function getUsedIpCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(usedIpPool);
  return Number(result[0]?.count ?? 0);
}

/**
 * 清空已用IP池（谨慎使用，一般用于测试重置）
 */
export async function clearUsedIpPool() {
  const db = await getDb();
  if (!db) return;
  await db.delete(usedIpPool);
}

// ─── Proxy URL 解析工具 ───────────────────────────────────────────────────────

/**
 * 解析 socks5h://user:pass@host:port 格式的代理 URL
 * 返回 AdsPower 创建浏览器所需的代理配置字段
 */
export function parseProxyUrl(proxyUrl: string): {
  proxyType: string;   // "socks5" | "http" | "https"
  host: string;
  port: string;
  username: string;
  password: string;
} | null {
  if (!proxyUrl || !proxyUrl.trim()) return null;
  try {
    // socks5h 是 socks5 with remote DNS，AdsPower 用 socks5 类型
    const normalized = proxyUrl.trim().replace(/^socks5h:\/\//, "socks5://");
    const url = new URL(normalized);
    return {
      proxyType: url.protocol.replace(":", ""),
      host: url.hostname,
      port: url.port || "1080",
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

// ─── Automation 注册结果保存 ──────────────────────────────────────────────────

/**
 * 重置邀请码状态（注册失败时归还）
 * 将 in_progress 状态改回 unused
 */
export async function resetInviteCodeStatus(accountId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(accounts)
    .set({ inviteStatus: "unused" })
    .where(eq(accounts.id, accountId));
}

/**
 * 保存注册成功的账号数据（automation.ts 调用，替代 HTTP callback）
 * 与 callback.ts /register 路由的逻辑完全一致
 */
export async function saveRegistrationResult(data: {
  email: string;
  password: string;
  phone?: string;
  token?: string;
  clientId?: string;
  membershipVersion?: string;
  totalCredits?: number;
  freeCredits?: number;
  refreshCredits?: number;
  inviteCode?: string;
  referrerCode?: string;
  inviterAccountId: number;
  adspowerBrowserId?: string;
  taskLogId?: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const {
    email,
    password,
    phone,
    token,
    clientId,
    membershipVersion = "free",
    totalCredits = 0,
    freeCredits = 0,
    refreshCredits = 0,
    inviteCode,
    referrerCode,
    inviterAccountId,
  } = data;

  // 检查邮箱是否已存在
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  if (existing.length > 0) {
    console.log(`[DB] saveRegistrationResult: email ${email} already exists, skipping`);
    return;
  }

  // 查找邀请人，将邀请码标记为已使用
  let invitedById: number | undefined;
  let resolvedReferrerCode: string | undefined = referrerCode;

  const inviter = await db
    .select({ id: accounts.id, inviteCode: accounts.inviteCode })
    .from(accounts)
    .where(eq(accounts.id, inviterAccountId))
    .limit(1);

  if (inviter.length > 0) {
    invitedById = inviter[0].id;
    resolvedReferrerCode = inviter[0].inviteCode ?? referrerCode;
    await db
      .update(accounts)
      .set({ inviteStatus: "used" })
      .where(eq(accounts.id, inviterAccountId));
    console.log(`[DB] Inviter account id=${inviterAccountId} invite code marked as used`);
  }

  // 创建新账号
  await db.insert(accounts).values({
    email,
    password,
    phone,
    token,
    clientId,
    membershipVersion,
    totalCredits,
    freeCredits,
    refreshCredits,
    inviteCode,
    referrerCode: resolvedReferrerCode,
    invitedById,
    registeredAt: new Date(),
    inviteStatus: "unused",
  });

  console.log(`[DB] saveRegistrationResult: account created for ${email}`);
}

// ─── Proxy Accounts ───────────────────────────────────────────────────────────

export async function getProxyAccounts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(proxyAccounts).orderBy(asc(proxyAccounts.createdAt));
}

export async function getProxyAccountById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(proxyAccounts).where(eq(proxyAccounts.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createProxyAccount(data: InsertProxyAccount) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(proxyAccounts).values(data);
}

export async function updateProxyAccount(id: number, data: Partial<InsertProxyAccount>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(proxyAccounts).set(data).where(eq(proxyAccounts.id, id));
}

export async function deleteProxyAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(proxyAccounts).where(eq(proxyAccounts.id, id));
}

// ─── Task Step Logs ──────────────────────────────────────────────────────────

/**
 * 写入一条步骤日志（非阻塞，失败不抛出）
 */
export async function appendStepLog(
  taskLogId: number,
  message: string,
  level: "info" | "success" | "warning" | "error" = "info",
  source: string = "Automation"
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const data: InsertTaskStepLog = { taskLogId, message, level, source };
    await db.insert(taskStepLogs).values(data);
    // 同时打印到控制台
    const ts = new Date().toTimeString().slice(0, 8);
    const icon = level === "success" ? "✅" : level === "error" ? "❌" : level === "warning" ? "⚠️" : "ℹ️";
    console.log(`${icon} [${ts}] [${source}] ${message}`);
  } catch {
    // 日志写入失败不影响主流程
  }
}

/**
 * 查询某个 taskLogId 的所有步骤日志（按时间升序）
 */
export async function getStepLogs(taskLogId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(taskStepLogs)
    .where(eq(taskStepLogs.taskLogId, taskLogId))
    .orderBy(asc(taskStepLogs.createdAt));
}

/**
 * 查询最近 N 条步骤日志（跨任务，用于全局日志页面）
 */
export async function getRecentStepLogs(limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(taskStepLogs)
    .orderBy(desc(taskStepLogs.createdAt))
    .limit(limit);
}
