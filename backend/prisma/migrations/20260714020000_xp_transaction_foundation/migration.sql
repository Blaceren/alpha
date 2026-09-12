-- Additive parent key for the enrollment-owned cross-user and cross-version XP foreign key.
CREATE UNIQUE INDEX "UserCurriculumEnrollment_id_userId_curriculumVersionId_key"
ON "UserCurriculumEnrollment"("id", "userId", "curriculumVersionId");

-- Immutable V2 XP ledger foundation.
-- The amount CHECK is intentionally maintained in SQL because Prisma schema
-- cannot express SQLite CHECK constraints. Zero and negative XP are rejected.
-- The source CHECK is the DB allowlist for the approved Phase 3 XP sources.
CREATE TABLE "XPTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER,
    "sourceType" TEXT NOT NULL CHECK ("sourceType" IN (
        'level_completion',
        'assessment_pass',
        'report_approval',
        'mentor_completion',
        'promocode',
        'migration_adjustment',
        'admin_correction'
    )),
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "amount" INTEGER NOT NULL CHECK ("amount" > 0),
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    CONSTRAINT "XPTransaction_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "XPTransaction_enrollmentId_userId_curriculumVersionId_fkey"
        FOREIGN KEY ("enrollmentId", "userId", "curriculumVersionId")
        REFERENCES "UserCurriculumEnrollment" ("id", "userId", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "XPTransaction_levelDefinitionId_curriculumVersionId_fkey"
        FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition" ("id", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "XPTransaction_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "XPTransaction_idempotencyKey_key"
ON "XPTransaction"("idempotencyKey");

-- Defense in depth for one durable owner event per enrollment and source.
-- SQLite permits repeated NULL sourceId values, while non-null owner identities are unique.
CREATE UNIQUE INDEX "XPTransaction_enrollmentId_sourceType_sourceId_key"
ON "XPTransaction"("enrollmentId", "sourceType", "sourceId")
WHERE "sourceId" IS NOT NULL;

CREATE INDEX "XPTransaction_enrollmentId_createdAt_id_idx"
ON "XPTransaction"("enrollmentId", "createdAt", "id");

CREATE INDEX "XPTransaction_userId_createdAt_id_idx"
ON "XPTransaction"("userId", "createdAt", "id");

CREATE INDEX "XPTransaction_curriculumVersionId_sourceType_idx"
ON "XPTransaction"("curriculumVersionId", "sourceType");

CREATE INDEX "XPTransaction_levelDefinitionId_idx"
ON "XPTransaction"("levelDefinitionId");

CREATE INDEX "XPTransaction_sourceType_sourceId_idx"
ON "XPTransaction"("sourceType", "sourceId");
