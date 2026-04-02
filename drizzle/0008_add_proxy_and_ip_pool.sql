-- 迁移：新增已用IP池表，任务表新增代理字段，task_logs 新增出口IP字段
-- 版本：0008

-- ─────────────────────────────────────────────
-- 1. 已用出口IP池表
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `used_ip_pool` (
  `id` int AUTO_INCREMENT NOT NULL,
  `ip` varchar(64) NOT NULL COMMENT '出口IP地址',
  `usedByEmail` varchar(320) COMMENT '哪个账号注册时使用了此IP',
  `taskLogId` int COMMENT '关联的任务日志ID',
  `usedAt` timestamp NOT NULL DEFAULT (now()),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `used_ip_pool_id` PRIMARY KEY(`id`),
  CONSTRAINT `used_ip_pool_ip_unique` UNIQUE(`ip`)
);

-- ─────────────────────────────────────────────
-- 2. automation_tasks 新增代理配置字段
-- ─────────────────────────────────────────────
ALTER TABLE `automation_tasks`
  ADD COLUMN IF NOT EXISTS `proxyUrl` varchar(1024) COMMENT 'socks5h://user:pass@host:port 格式的代理，留空则不使用代理';

-- ─────────────────────────────────────────────
-- 3. task_logs 新增出口IP字段
-- ─────────────────────────────────────────────
ALTER TABLE `task_logs`
  ADD COLUMN IF NOT EXISTS `exitIp` varchar(64) COMMENT '本次注册使用的出口IP';
