-- Additive parent keys required by SQLite composite foreign keys.
CREATE UNIQUE INDEX "CurriculumVersion_id_code_key" ON "CurriculumVersion"("id", "code");

CREATE UNIQUE INDEX "LevelDefinition_id_curriculumVersionId_key" ON "LevelDefinition"("id", "curriculumVersionId");

-- CreateTable
CREATE TABLE "UserCurriculumEnrollment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "curriculumCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "enrolledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "highestCompletedLevel" INTEGER NOT NULL DEFAULT 0,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "lastMeaningfulActionAt" DATETIME,
    "completedAt" DATETIME,
    "migrationSource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserCurriculumEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserCurriculumEnrollment_curriculumVersionId_curriculumCode_fkey" FOREIGN KEY ("curriculumVersionId", "curriculumCode") REFERENCES "CurriculumVersion" ("id", "code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserLevelProgress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "enrollmentId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastProgressAt" DATETIME,
    "completedAt" DATETIME,
    "completionMethod" TEXT,
    "completionEvidence" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserLevelProgress_enrollmentId_curriculumVersionId_fkey" FOREIGN KEY ("enrollmentId", "curriculumVersionId") REFERENCES "UserCurriculumEnrollment" ("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserLevelProgress_levelDefinitionId_curriculumVersionId_fkey" FOREIGN KEY ("levelDefinitionId", "curriculumVersionId") REFERENCES "LevelDefinition" ("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCurriculumEnrollment_id_curriculumVersionId_key" ON "UserCurriculumEnrollment"("id", "curriculumVersionId");

CREATE INDEX "UserCurriculumEnrollment_curriculumVersionId_status_idx" ON "UserCurriculumEnrollment"("curriculumVersionId", "status");

CREATE INDEX "UserCurriculumEnrollment_userId_enrolledAt_idx" ON "UserCurriculumEnrollment"("userId", "enrolledAt");

-- Prisma cannot express this partial unique index. Historical completed and
-- superseded rows remain unrestricted, while only one active row is allowed per
-- user and curriculum line.
CREATE UNIQUE INDEX "UserCurriculumEnrollment_userId_curriculumCode_active_key" ON "UserCurriculumEnrollment"("userId", "curriculumCode") WHERE "status" = 'active';

CREATE UNIQUE INDEX "UserLevelProgress_enrollmentId_levelDefinitionId_key" ON "UserLevelProgress"("enrollmentId", "levelDefinitionId");

CREATE INDEX "UserLevelProgress_enrollmentId_status_idx" ON "UserLevelProgress"("enrollmentId", "status");

CREATE INDEX "UserLevelProgress_curriculumVersionId_status_idx" ON "UserLevelProgress"("curriculumVersionId", "status");

CREATE INDEX "UserLevelProgress_levelDefinitionId_idx" ON "UserLevelProgress"("levelDefinitionId");
