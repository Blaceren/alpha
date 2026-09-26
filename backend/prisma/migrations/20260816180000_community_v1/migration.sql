-- COMMUNITY-V1 — the Academy Community domain.
--
-- WHY THIS MIGRATION IS HAND-WRITTEN AND WHAT IT DELIBERATELY OMITS.
--
-- `prisma migrate diff` against the live PREPROD database emits, in addition to
-- the five tables below, a rebuild of THIRTEEN unrelated tables
-- (AgentActionProposal, AgentEvaluation, AgentEvidenceReference, AgentFinding,
-- AgentHandoff, ChatMessage, GrowthEvent, GrowthEventOutbox,
-- PocketProviderEvent, ProviderIngressEvent, User, VideoProductionAssessmentLink,
-- VideoProductionVersion) and ten index renames.
--
-- NONE OF THAT IS THIS CHANGE. It was verified by diffing the same database
-- against the schema AT HEAD, with no Community models present: the identical
-- thirteen rebuilds and ten renames appear there too. It is long-standing
-- cosmetic drift between Prisma's canonical naming and the shortened index
-- names of hand-written migrations, plus foreign-key action differences, and it
-- has been carried by this repository across many migrations.
--
-- Dropping and recreating `User`, `GrowthEvent`, `PocketProviderEvent` and
-- `ProviderIngressEvent` — the Pocket, Affiliate and Growth record tables — to
-- land a discussion board would be a destructive, out-of-scope rewrite of four
-- closed domains. This migration therefore contains ONLY Community objects, the
-- way migration 52 contained only its two indexes. The drift is recorded as a
-- finding, not silently repaired here.
--
-- WHAT THIS MIGRATION DOES. Five new tables, their indexes, and five seed rows.
-- It ADDS ONLY. No existing table is altered, dropped or rebuilt, no existing
-- row is read, updated or deleted, and no index on an existing table is touched.
--
-- NOTE FOR THE NEXT AUTHOR. Do not put a semicolon in a comment in this file.
-- The runner splits the file on the statement terminator before it strips
-- comments, so a semicolon inside a comment splits that comment into two
-- fragments. The first becomes an empty statement and the migration fails
-- with SQLITE_MISUSE (`P2010`, code 21, "not an error"), which names nothing.
-- It fails SAFELY -- the transaction rolls back and the database is untouched --
-- but the message does not point at the cause. Every migration in this
-- repository observes the same convention.
-- `ChatChannel`, `ChatMessage` and every V1 chat table are untouched — V1 chat
-- and V2 Community are separate tables with separate authority.
--
-- WHY `readFromLevel` / `writeFromLevel` AND NOT `requiredLevel`. These are
-- levels of the V2 curriculum (`UserCurriculumEnrollment.highestCompletedLevel`).
-- The legacy `ChatChannel.requiredLevel` means `User.level`, which reads 1 for
-- every learner in PREPROD including one who has completed fourteen V2 levels.
-- The column names differ so that no future reader can mistake one authority for
-- the other.
--
-- The runner applies this file in ONE transaction, so either all five tables and
-- all five seed rows exist, or none do.

-- CreateTable
CREATE TABLE "CommunitySpace" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "readFromLevel" INTEGER NOT NULL DEFAULT 0,
    "writeFromLevel" INTEGER NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommunityDiscussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" DATETIME,
    "removedByStaffId" TEXT,
    "removalReason" TEXT,
    CONSTRAINT "CommunityDiscussion_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "CommunitySpace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommunityDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommunityDiscussion_removedByStaffId_fkey" FOREIGN KEY ("removedByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommunityReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "removedAt" DATETIME,
    "removedByStaffId" TEXT,
    "removalReason" TEXT,
    CONSTRAINT "CommunityReply_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "CommunityDiscussion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommunityReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommunityReply_removedByStaffId_fkey" FOREIGN KEY ("removedByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommunityContentReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" INTEGER NOT NULL,
    "discussionId" TEXT,
    "replyId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolvedByStaffId" TEXT,
    CONSTRAINT "CommunityContentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommunityContentReport_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "CommunityDiscussion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommunityContentReport_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "CommunityReply" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommunityContentReport_resolvedByStaffId_fkey" FOREIGN KEY ("resolvedByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommunityModerationAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staffId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityModerationAction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunitySpace_code_key" ON "CommunitySpace"("code");

-- CreateIndex
CREATE INDEX "CommunitySpace_isActive_orderIndex_idx" ON "CommunitySpace"("isActive", "orderIndex");

-- CreateIndex
CREATE INDEX "CommunityDiscussion_spaceId_status_lastActivityAt_idx" ON "CommunityDiscussion"("spaceId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "CommunityDiscussion_authorId_createdAt_idx" ON "CommunityDiscussion"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityReply_discussionId_createdAt_idx" ON "CommunityReply"("discussionId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityReply_authorId_createdAt_idx" ON "CommunityReply"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityContentReport_status_createdAt_idx" ON "CommunityContentReport"("status", "createdAt");

-- CreateIndex. One report per learner per target. This is what stops a single
-- learner filing the same report repeatedly to make content look contested.
-- SQLite treats NULLs as distinct, so the discussion index does not constrain
-- reply reports and vice versa.
CREATE UNIQUE INDEX "CommunityContentReport_reporterId_discussionId_key" ON "CommunityContentReport"("reporterId", "discussionId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityContentReport_reporterId_replyId_key" ON "CommunityContentReport"("reporterId", "replyId");

-- CreateIndex
CREATE INDEX "CommunityModerationAction_createdAt_idx" ON "CommunityModerationAction"("createdAt");

-- CreateIndex
CREATE INDEX "CommunityModerationAction_targetType_targetId_idx" ON "CommunityModerationAction"("targetType", "targetId");

-- Seed the five spaces.
--
-- THE SET IS NOT INVENTED HERE. It is the accepted five-space map of
-- `academy/docs/CURRICULUM_AND_UNLOCKS.md` §5, whose unlock levels are exactly
-- the module checkpoint levels of the published curriculum (M1→4, M4→20,
-- M7→35, M9→45, M17→85). Twenty per-module channels were deliberately NOT
-- created: a module is not a reason for a room.
--
-- `readFromLevel` differs from `writeFromLevel` only for the entry space. A
-- learner below level 4 may READ what their peers are asking but may not post
-- yet — the accepted L4 write gate is unchanged, while Community stops being a
-- surface that answers "nothing here for you" to every new learner.
INSERT INTO "CommunitySpace" ("code", "title", "purpose", "readFromLevel", "writeFromLevel", "orderIndex", "isActive", "createdAt", "updatedAt") VALUES
  ('channel.start_questions',    'Старт и вопросы',          'Вопросы первых модулей: с чего начать, что непонятно, что делать дальше.',      0,  4, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel.chart_review',       'Разбор графиков',          'Разметка, уровни и структура графика — покажите свой разбор и посмотрите чужие.', 20, 20, 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel.discipline_journal', 'Дисциплина и дневник',     'Дневник, правила, паузы и то, что мешает их соблюдать.',                          35, 35, 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel.strategies',         'Стратегии',                'Собственные торговые системы: условия входа, проверка, слабые места.',            45, 45, 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel.advanced_circle',    'Продвинутый круг',         'Разбор кейсов и статистики для тех, кто прошёл большую часть программы.',         85, 85, 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
