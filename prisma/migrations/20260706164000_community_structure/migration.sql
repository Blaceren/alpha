ALTER TABLE "ChatChannel" ADD COLUMN "requiredAchievement" TEXT;

INSERT OR IGNORE INTO "ChatChannel" ("slug", "title", "description", "requiredLevel", "requiredCheckpoint", "requiredAchievement", "isLockedVisible", "isActive", "retentionDays", "createdAt", "updatedAt") VALUES
('newcomers', 'Вопросы новичков', 'Вопросы по первым шагам обучения', 1, NULL, NULL, true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('reports', 'Отчёты и разборы', 'Обсуждение учебных отчётов и выводов', 3, NULL, NULL, true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('after-checkpoint', 'Чат после checkpoint', 'Канал открывается после первого депозита', NULL, 'lvl_04_any_deposit', NULL, true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('achievement-private', 'Клуб достижений', 'Приватный канал после достижения', NULL, NULL, 'first-report', true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
