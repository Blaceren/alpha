-- CreateTable
CREATE TABLE "CurriculumVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "versionNumber" INTEGER NOT NULL,
    "effectiveFrom" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "createdById" INTEGER,
    "changeNotes" TEXT,
    CONSTRAINT "CurriculumVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "curriculumVersionId" INTEGER NOT NULL,
    "moduleNumber" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "firstLevel" INTEGER NOT NULL,
    "lastLevel" INTEGER NOT NULL,
    "checkpointLevel" INTEGER,
    "learningObjective" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "ModuleDefinition_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LevelDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "curriculumVersionId" INTEGER NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "stableCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL DEFAULT '',
    "learningObjective" TEXT NOT NULL DEFAULT '',
    "completionMethod" TEXT NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "requiredXp" INTEGER NOT NULL DEFAULT 0,
    "requiredPreviousLevel" INTEGER,
    "requiredCheckpointLevel" INTEGER,
    "featureUnlockCode" TEXT,
    "visibilityRule" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "LevelDefinition_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelDefinition_moduleId_curriculumVersionId_fkey" FOREIGN KEY ("moduleId", "curriculumVersionId") REFERENCES "ModuleDefinition" ("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CurriculumVersion_status_idx" ON "CurriculumVersion"("status");

-- CreateIndex
CREATE INDEX "CurriculumVersion_createdById_idx" ON "CurriculumVersion"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumVersion_code_versionNumber_key" ON "CurriculumVersion"("code", "versionNumber");

-- CreateIndex
CREATE INDEX "ModuleDefinition_curriculumVersionId_firstLevel_idx" ON "ModuleDefinition"("curriculumVersionId", "firstLevel");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleDefinition_id_curriculumVersionId_key" ON "ModuleDefinition"("id", "curriculumVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleDefinition_curriculumVersionId_moduleNumber_key" ON "ModuleDefinition"("curriculumVersionId", "moduleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleDefinition_curriculumVersionId_code_key" ON "ModuleDefinition"("curriculumVersionId", "code");

-- CreateIndex
CREATE INDEX "LevelDefinition_moduleId_idx" ON "LevelDefinition"("moduleId");

-- CreateIndex
CREATE INDEX "LevelDefinition_curriculumVersionId_type_idx" ON "LevelDefinition"("curriculumVersionId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LevelDefinition_curriculumVersionId_levelNumber_key" ON "LevelDefinition"("curriculumVersionId", "levelNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LevelDefinition_curriculumVersionId_stableCode_key" ON "LevelDefinition"("curriculumVersionId", "stableCode");

-- Manual partial unique index: at most one published CurriculumVersion per curriculum code.
-- Prisma schema language cannot express partial indexes, so this constraint lives only in
-- migration SQL and complements the future service-level publish guard. Draft and archived
-- versions of the same code are intentionally not restricted.
CREATE UNIQUE INDEX "CurriculumVersion_code_published_key" ON "CurriculumVersion"("code") WHERE "status" = 'published';
