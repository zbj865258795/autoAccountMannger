-- 迁移：automation_tasks 表新增 proxyUrl 字段
-- 版本：0009

ALTER TABLE `automation_tasks`
  ADD COLUMN IF NOT EXISTS `proxyUrl` varchar(1024) NULL;
