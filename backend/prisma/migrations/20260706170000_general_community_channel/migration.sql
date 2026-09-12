INSERT OR IGNORE INTO "ChatChannel" ("slug", "title", "description", "requiredLevel", "requiredCheckpoint", "requiredAchievement", "isLockedVisible", "isActive", "retentionDays", "createdAt", "updatedAt") VALUES
('general', 'Общий чат', 'Основной открытый канал сообщества', 1, NULL, NULL, true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
