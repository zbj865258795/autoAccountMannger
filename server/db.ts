import { and, asc, count, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { accounts, automationTasks, phoneNumbers, taskLogs, users } from "../drizzle/schema";
import type { InsertAccount, InsertAutomationTask, InsertPhoneNumber, InsertTaskLog } from "../drizzle/schema";

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

export async function getUnusedInviteCodes() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.inviteStatus, "unused"))
    .orderBy(asc(accounts.createdAt));
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
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(accounts),
    db.select({ sum: sql<number>`sum(totalCredits)` }).from(accounts),
    db.select({ avg: sql<number>`avg(totalCredits)`, max: sql<number>`max(totalCredits)` }).from(accounts),
    db.select({ count: sql<number>`count(*)` }).from(accounts).where(eq(accounts.inviteStatus, "unused")),
    db.select({ count: sql<number>`count(*)` }).from(accounts).where(eq(accounts.inviteStatus, "in_progress")),
    db.select({ count: sql<number>`count(*)` }).from(accounts).where(eq(accounts.inviteStatus, "used")),
    db.select().from(accounts).orderBy(desc(accounts.createdAt)).limit(5),
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
  const results = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.status, "unused"))
    .orderBy(phoneNumbers.createdAt)
    .limit(1);
  if (results.length === 0) return null;
  const record = results[0];
  // 标记为使用中
  await db
    .update(phoneNumbers)
    .set({ status: "in_use", updatedAt: new Date() })
    .where(eq(phoneNumbers.id, record.id));
  return { id: record.id, phone: record.phone, smsUrl: record.smsUrl };
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
