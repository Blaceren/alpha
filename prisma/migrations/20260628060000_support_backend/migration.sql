-- Replace the early mock support tables with relational support fields.
CREATE TABLE "new_SupportDialog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "userName" TEXT NOT NULL,
    "userLevel" INTEGER NOT NULL,
    "currentStep" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "assignedToId" INTEGER,
    "lastMessage" TEXT NOT NULL,
    "lastMessageAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupportDialog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportDialog_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_SupportDialog" ("id", "userId", "userName", "userLevel", "currentStep", "status", "assignedToId", "lastMessage", "lastMessageAt", "createdAt", "updatedAt")
SELECT "id", "userId", "userName", "userLevel", "currentStep",
    CASE "status"
        WHEN 'новый' THEN 'new'
        WHEN 'в работе' THEN 'in_progress'
        WHEN 'ожидает ответа пользователя' THEN 'waiting_user'
        WHEN 'закрыт' THEN 'closed'
        ELSE 'new'
    END,
    NULL, "lastMessage", "lastMessageAt", "createdAt", "updatedAt"
FROM "SupportDialog"
WHERE "userId" IS NOT NULL;

CREATE TABLE "new_SupportMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dialogId" INTEGER NOT NULL,
    "senderUserId" INTEGER,
    "senderRole" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "internalNote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "new_SupportDialog" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_SupportMessage" ("id", "dialogId", "senderUserId", "senderRole", "message", "internalNote", "createdAt")
SELECT message."id", message."supportDialogId", message."userId",
    CASE WHEN message."role" IN ('user', 'admin', 'support', 'mentor') THEN message."role" ELSE 'support' END,
    message."message", false, message."createdAt"
FROM "SupportMessage" AS message
INNER JOIN "new_SupportDialog" AS dialog ON dialog."id" = message."supportDialogId";

DROP TABLE "SupportMessage";
DROP TABLE "SupportDialog";
ALTER TABLE "new_SupportDialog" RENAME TO "SupportDialog";
ALTER TABLE "new_SupportMessage" RENAME TO "SupportMessage";

CREATE INDEX "SupportDialog_userId_status_updatedAt_idx" ON "SupportDialog"("userId", "status", "updatedAt");
CREATE INDEX "SupportDialog_status_lastMessageAt_idx" ON "SupportDialog"("status", "lastMessageAt");
CREATE INDEX "SupportDialog_assignedToId_idx" ON "SupportDialog"("assignedToId");
CREATE INDEX "SupportMessage_dialogId_createdAt_idx" ON "SupportMessage"("dialogId", "createdAt");
CREATE INDEX "SupportMessage_senderUserId_idx" ON "SupportMessage"("senderUserId");
