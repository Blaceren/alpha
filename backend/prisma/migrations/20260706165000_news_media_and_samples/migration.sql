ALTER TABLE "NewsPost" ADD COLUMN "coverImageUrl" TEXT;
ALTER TABLE "NewsPost" ADD COLUMN "mediaUrl" TEXT;
ALTER TABLE "NewsPost" ADD COLUMN "mediaType" TEXT;

INSERT OR IGNORE INTO "NewsPost" ("slug", "title", "excerpt", "content", "category", "author", "status", "publishedAt", "createdAt") VALUES
('platform-route-map', 'Как устроен путь обучения', 'Короткая карта заданий, уроков и checkpoints.', 'Двигайтесь по активному шагу на дашборде. Уроки завершаются после контрольного вопроса, отчёты проверяет ментор, а checkpoints подтверждаются только реальными условиями.', 'Платформа', 'Редакция TradeQuest', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('community-channels', 'Каналы сообщества', 'Где задавать вопросы и обсуждать отчёты.', 'В сообществе доступны общий канал, вопросы новичков, разборы и закрытые каналы. Доступ к закрытым разделам появляется вместе с прогрессом.', 'Сообщество', 'Редакция TradeQuest', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('checkpoint-rules', 'Как работают checkpoints', 'Почему контрольная точка не закрывается вручную.', 'Первый checkpoint подтверждается фактом депозита. Следующие проверяют реальные пороги баланса. Если внешняя проверка недоступна, система показывает retry или support state без фиктивного завершения.', 'Обучение', 'Команда обучения', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('risk-before-trade', 'Риск задаётся до сделки', 'Простое правило для учебной практики.', 'До входа определите допустимый риск, условие отмены идеи и выход. После открытия позиции не увеличивайте риск только потому, что цена движется против ожидания.', 'Риск-менеджмент', 'Ментор TradeQuest', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
