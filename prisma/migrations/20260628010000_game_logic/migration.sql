ALTER TABLE "Task" ADD COLUMN "xpReward" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Referral" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "inviterUserId" INTEGER NOT NULL,
  "invitedUserId" INTEGER NOT NULL,
  "xpEarned" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Referral_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Referral_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Referral_invitedUserId_key" ON "Referral"("invitedUserId");

CREATE TABLE "NotificationSettings" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "webPushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "NotificationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationSettings_userId_key" ON "NotificationSettings"("userId");
