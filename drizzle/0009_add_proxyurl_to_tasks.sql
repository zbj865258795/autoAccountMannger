-- 迁移：automation_tasks 表新增 proxyUrl 字段
-- 版本：0009

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'automation_tasks'
    AND COLUMN_NAME = 'proxyUrl'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `automation_tasks` ADD COLUMN `proxyUrl` varchar(1024) COMMENT ''代理地址（socks5://user:pass@host:port）''',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
