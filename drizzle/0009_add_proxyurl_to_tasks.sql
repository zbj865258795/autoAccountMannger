-- 迁移：automation_tasks 表新增 proxyUrl 字段
-- 版本：0009

DROP PROCEDURE IF EXISTS add_proxyurl_column;

DELIMITER //
CREATE PROCEDURE add_proxyurl_column()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'automation_tasks'
      AND COLUMN_NAME = 'proxyUrl'
  ) THEN
    ALTER TABLE `automation_tasks` ADD COLUMN `proxyUrl` varchar(1024) NULL;
  END IF;
END //
DELIMITER ;

CALL add_proxyurl_column();
DROP PROCEDURE IF EXISTS add_proxyurl_column;
