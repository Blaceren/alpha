ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "leaderboardExcluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "selectedAchievementId" INTEGER;

ALTER TABLE "Referral" ADD COLUMN "invitedXpEarned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Referral" ADD COLUMN "bonusGrantedAt" DATETIME;

ALTER TABLE "ExchangeAccount" ADD COLUMN "traderId" TEXT;
ALTER TABLE "ExchangeAccount" ADD COLUMN "clickId" TEXT;
ALTER TABLE "ExchangeAccount" ADD COLUMN "attribution" JSONB;
CREATE INDEX "ExchangeAccount_traderId_idx" ON "ExchangeAccount"("traderId");
CREATE INDEX "ExchangeAccount_clickId_idx" ON "ExchangeAccount"("clickId");

ALTER TABLE "PostbackEvent" ADD COLUMN "normalizedEventType" TEXT;
ALTER TABLE "PostbackEvent" ADD COLUMN "externalAccountId" TEXT;
ALTER TABLE "PostbackEvent" ADD COLUMN "traderId" TEXT;
ALTER TABLE "PostbackEvent" ADD COLUMN "clickId" TEXT;
ALTER TABLE "PostbackEvent" ADD COLUMN "currency" TEXT;
ALTER TABLE "PostbackEvent" ADD COLUMN "attribution" JSONB;

ALTER TABLE "ChatMessage" ADD COLUMN "channelId" INTEGER;
ALTER TABLE "ChatMessage" ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatMessage" ADD COLUMN "achievementTitle" TEXT;

CREATE TABLE "EmailVerificationToken" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_expiresAt_idx" ON "EmailVerificationToken"("userId", "expiresAt");

CREATE TABLE "ReferralBonusConfig" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "slug" TEXT NOT NULL,
  "inviterXp" INTEGER NOT NULL DEFAULT 100,
  "invitedXp" INTEGER NOT NULL DEFAULT 50,
  "secondLevelXp" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ReferralBonusConfig_slug_key" ON "ReferralBonusConfig"("slug");

CREATE TABLE "ChatChannel" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "requiredLevel" INTEGER,
  "requiredCheckpoint" TEXT,
  "isLockedVisible" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "retentionDays" INTEGER NOT NULL DEFAULT 3,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ChatChannel_slug_key" ON "ChatChannel"("slug");
CREATE INDEX "ChatChannel_isActive_requiredLevel_idx" ON "ChatChannel"("isActive", "requiredLevel");

CREATE TABLE "MentorChannelAssignment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "channelId" INTEGER NOT NULL,
  "mentorId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MentorChannelAssignment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MentorChannelAssignment_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MentorChannelAssignment_channelId_mentorId_key" ON "MentorChannelAssignment"("channelId", "mentorId");

CREATE TABLE "ModeratorChannelAssignment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "channelId" INTEGER NOT NULL,
  "moderatorId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModeratorChannelAssignment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ModeratorChannelAssignment_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ModeratorChannelAssignment_channelId_moderatorId_key" ON "ModeratorChannelAssignment"("channelId", "moderatorId");

CREATE TABLE "ChatModerationRule" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "type" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ChatModerationRule_type_isActive_idx" ON "ChatModerationRule"("type", "isActive");

CREATE TABLE "ChatMute" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "channelId" INTEGER,
  "reason" TEXT NOT NULL,
  "expiresAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChatMute_userId_channelId_expiresAt_idx" ON "ChatMute"("userId", "channelId", "expiresAt");

CREATE TABLE "ChatModerationLog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "moderatorId" INTEGER,
  "userId" INTEGER,
  "channelId" INTEGER,
  "messageId" INTEGER,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ChatModerationLog_action_createdAt_idx" ON "ChatModerationLog"("action", "createdAt");

CREATE TABLE "MentorChatDialog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "mentorId" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'locked',
  "unlockReason" TEXT,
  "lastMessage" TEXT,
  "lastMessageAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MentorChatDialog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MentorChatDialog_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MentorChatDialog_userId_status_idx" ON "MentorChatDialog"("userId", "status");
CREATE INDEX "MentorChatDialog_mentorId_status_idx" ON "MentorChatDialog"("mentorId", "status");

CREATE TABLE "MentorChatMessage" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "dialogId" INTEGER NOT NULL,
  "senderUserId" INTEGER,
  "senderRole" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MentorChatMessage_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "MentorChatDialog" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MentorChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MentorChatMessage_dialogId_createdAt_idx" ON "MentorChatMessage"("dialogId", "createdAt");

CREATE TABLE "DailyLoginReward" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "rewardDate" TEXT NOT NULL,
  "streak" INTEGER NOT NULL,
  "xpGranted" INTEGER NOT NULL DEFAULT 0,
  "rewardId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyLoginReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DailyLoginReward_userId_rewardDate_key" ON "DailyLoginReward"("userId", "rewardDate");

CREATE TABLE "Promocode" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "code" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "maxUses" INTEGER,
  "perUserLimit" INTEGER NOT NULL DEFAULT 1,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "startsAt" DATETIME,
  "expiresAt" DATETIME,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Promocode_code_key" ON "Promocode"("code");
CREATE INDEX "Promocode_isActive_startsAt_expiresAt_idx" ON "Promocode"("isActive", "startsAt", "expiresAt");

CREATE TABLE "PromocodeRedemption" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "promocodeId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromocodeRedemption_promocodeId_fkey" FOREIGN KEY ("promocodeId") REFERENCES "Promocode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PromocodeRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PromocodeRedemption_promocodeId_userId_key" ON "PromocodeRedemption"("promocodeId", "userId");

CREATE TABLE "Achievement" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "rarity" TEXT NOT NULL,
  "iconKey" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Achievement_slug_key" ON "Achievement"("slug");

CREATE TABLE "UserAchievement" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "achievementId" INTEGER NOT NULL,
  "grantedById" INTEGER,
  "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'manual',
  CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");
