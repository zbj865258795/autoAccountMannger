-- ============================================================
-- 测试数据：账号列表
-- 说明：
--   - 不会影响已有的真实数据（id=11 的账号）
--   - 覆盖 unused / in_progress / used 三种 inviteStatus
--   - 覆盖有/无邀请关系（referrerCode）的场景
--   - 满足导出条件的账号（inviteStatus=used + referrerCode 不为空）共 6 条
-- ============================================================

INSERT INTO `accounts` (
  `email`, `password`, `token`,
  `userId`, `displayname`, `membershipVersion`, `phone`,
  `totalCredits`, `freeCredits`, `refreshCredits`,
  `inviteCode`, `inviteCodeId`,
  `inviteStatus`,
  `invitedByCode`, `referrerCode`, `invitedById`,
  `registeredAt`, `createdAt`, `updatedAt`, `notes`
) VALUES

-- ── 组 A：inviteStatus = unused（邀请码未被使用）──────────────────────────────

-- A1: 普通账号，无邀请关系，邀请码未使用
('test_user_a1@outlook.com', 'TestPass@A1!', NULL,
 '3200000000000001', 'test_user_a1', 'free', '+12001110001',
 2800, 2500, 300,
 'TESTCODEA001', 'TESTCODEID001',
 'unused',
 NULL, NULL, NULL,
 '2026-03-28 10:00:00', '2026-03-28 10:00:00', '2026-03-28 10:00:00', '测试数据-A1'),

-- A2: 被邀请注册（referrerCode 指向真实账号的邀请码），但自己邀请码未被使用
('test_user_a2@outlook.com', 'TestPass@A2!', NULL,
 '3200000000000002', 'test_user_a2', 'free', '+12001110002',
 2800, 2500, 300,
 'TESTCODEA002', 'TESTCODEID002',
 'unused',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 10:05:00', '2026-03-28 10:05:00', '2026-03-28 10:05:00', '测试数据-A2'),

-- A3: 被邀请注册，邀请码未使用
('test_user_a3@outlook.com', 'TestPass@A3!', NULL,
 '3200000000000003', 'test_user_a3', 'pro', '+12001110003',
 5600, 5000, 600,
 'TESTCODEA003', 'TESTCODEID003',
 'unused',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 10:10:00', '2026-03-28 10:10:00', '2026-03-28 10:10:00', '测试数据-A3'),

-- ── 组 B：inviteStatus = in_progress（邀请进行中）────────────────────────────

-- B1: 无邀请关系，自己邀请码使用中
('test_user_b1@outlook.com', 'TestPass@B1!', NULL,
 '3200000000000004', 'test_user_b1', 'free', '+12001110004',
 2800, 2500, 300,
 'TESTCODEB001', 'TESTCODEID004',
 'in_progress',
 NULL, NULL, NULL,
 '2026-03-28 11:00:00', '2026-03-28 11:00:00', '2026-03-28 11:00:00', '测试数据-B1'),

-- B2: 被邀请注册，自己邀请码使用中（不满足导出条件，inviteStatus != used）
('test_user_b2@outlook.com', 'TestPass@B2!', NULL,
 '3200000000000005', 'test_user_b2', 'free', '+12001110005',
 2800, 2500, 300,
 'TESTCODEB002', 'TESTCODEID005',
 'in_progress',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 11:05:00', '2026-03-28 11:05:00', '2026-03-28 11:05:00', '测试数据-B2'),

-- ── 组 C：inviteStatus = used（邀请码已被使用）───────────────────────────────

-- C1: 无邀请关系，邀请码已用（不满足导出条件，referrerCode 为空）
('test_user_c1@outlook.com', 'TestPass@C1!', NULL,
 '3200000000000006', 'test_user_c1', 'free', '+12001110006',
 2800, 2500, 300,
 'TESTCODEC001', 'TESTCODEID006',
 'used',
 NULL, NULL, NULL,
 '2026-03-28 12:00:00', '2026-03-28 12:00:00', '2026-03-28 12:00:00', '测试数据-C1'),

-- C2: 被邀请注册 + 邀请码已用 → 满足导出条件 ✅
('test_user_c2@outlook.com', 'TestPass@C2!', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_c2',
 '3200000000000007', 'test_user_c2', 'free', '+12001110007',
 2800, 2500, 300,
 'TESTCODEC002', 'TESTCODEID007',
 'used',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 12:05:00', '2026-03-28 12:05:00', '2026-03-28 12:05:00', '测试数据-C2-可导出'),

-- C3: 被邀请注册 + 邀请码已用 → 满足导出条件 ✅
('test_user_c3@outlook.com', 'TestPass@C3!', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_c3',
 '3200000000000008', 'test_user_c3', 'pro', '+12001110008',
 5600, 5000, 600,
 'TESTCODEC003', 'TESTCODEID008',
 'used',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 12:10:00', '2026-03-28 12:10:00', '2026-03-28 12:10:00', '测试数据-C3-可导出'),

-- C4: 被邀请注册 + 邀请码已用 → 满足导出条件 ✅
('test_user_c4@outlook.com', 'TestPass@C4!', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_c4',
 '3200000000000009', 'test_user_c4', 'pro', '+12001110009',
 8400, 7500, 900,
 'TESTCODEC004', 'TESTCODEID009',
 'used',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 12:15:00', '2026-03-28 12:15:00', '2026-03-28 12:15:00', '测试数据-C4-可导出'),

-- C5: 被邀请注册 + 邀请码已用 → 满足导出条件 ✅
('test_user_c5@outlook.com', 'TestPass@C5!', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_c5',
 '3200000000000010', 'test_user_c5', 'free', '+12001110010',
 2800, 2500, 300,
 'TESTCODEC005', 'TESTCODEID010',
 'used',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 12:20:00', '2026-03-28 12:20:00', '2026-03-28 12:20:00', '测试数据-C5-可导出'),

-- C6: 被邀请注册 + 邀请码已用 → 满足导出条件 ✅
('test_user_c6@outlook.com', 'TestPass@C6!', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_c6',
 '3200000000000011', 'test_user_c6', 'pro', '+12001110011',
 5600, 5000, 600,
 'TESTCODEC006', 'TESTCODEID011',
 'used',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 12:25:00', '2026-03-28 12:25:00', '2026-03-28 12:25:00', '测试数据-C6-可导出'),

-- C7: 被邀请注册 + 邀请码已用 → 满足导出条件 ✅
('test_user_c7@outlook.com', 'TestPass@C7!', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_c7',
 '3200000000000012', 'test_user_c7', 'free', '+12001110012',
 2800, 2500, 300,
 'TESTCODEC007', 'TESTCODEID012',
 'used',
 'TJPTXONBZVDBXI0', 'TJPTXONBZVDBXI0', 11,
 '2026-03-28 12:30:00', '2026-03-28 12:30:00', '2026-03-28 12:30:00', '测试数据-C7-可导出');
