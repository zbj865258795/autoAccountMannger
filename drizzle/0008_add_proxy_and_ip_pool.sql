-- 迁移：新增已用IP池表，任务表新增代理字段，task_logs 新增出口IP字段
-- 版本：0008
-- 兼容 MySQL 8.0 所有版本

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
-- 2. automation_tasks 新增代理配置字段（兼容写法）
-- ─────────────────────────────────────────────
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'automation_tasks'
    AND COLUMN_NAME = 'proxyUrl'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `automation_tasks` ADD COLUMN `proxyUrl` varchar(1024) COMMENT ''socks5h代理地址，留空不使用''',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────
-- 3. task_logs 新增出口IP字段（兼容写法）
-- ─────────────────────────────────────────────
SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'task_logs'
    AND COLUMN_NAME = 'exitIp'
);

SET @sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE `task_logs` ADD COLUMN `exitIp` varchar(64) COMMENT ''本次注册使用的出口IP''',
  'SELECT 1'
);

PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
