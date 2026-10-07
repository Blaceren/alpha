-- NOTIFICATIONS A LEARNER CLEARED (DD-349, owner 2026-10-06: the bell opens a
-- small window with «Прочитать все» and «Очистить всё», «как в примере»).
--
-- ADDITIVE, AND NOTHING ELSE. One nullable column and one index. No existing
-- row is rewritten and nothing is deleted: «Очистить всё» hides the learner's
-- notifications from the learner's own list by stamping clearedAt, and the rows
-- stay, for the staff's learner view and for the audit. A Backend built before
-- this migration never reads the column, so it remains a valid rollback target
-- (it would simply show cleared notifications again).
--
-- HAND-WRITTEN for the same reason as every recent migration here. Timestamps
-- are integer epoch milliseconds with a typeof CHECK, as everywhere else. (No
-- semicolon may appear in these comments: the runner splits the file on it.)
ALTER TABLE "Notification" ADD COLUMN "clearedAt" DATETIME
    CHECK ("clearedAt" IS NULL OR typeof("clearedAt") = 'integer');

CREATE INDEX "Notification_userId_clearedAt_createdAt_idx" ON "Notification"("userId", "clearedAt", "createdAt");
