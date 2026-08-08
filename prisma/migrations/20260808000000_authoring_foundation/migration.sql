-- PHASE-G0 -- the authoring foundation.
--
-- NOT APPLIED ANYWHERE BY THIS PHASE. Phase G0 is a source-only foundation.
-- This file exists so the model is reviewable and so the regression harness can
-- build a throwaway SQLite fixture from it. No live, preprod or production
-- database was touched, and CURRICULUM_V2_ADMIN_ENABLED stays off.
--
-- MIGRATION RUNNER CONTRACT. prisma/migrate.ts splits this file on the
-- semicolon character, so NO COMMENT IN THIS FILE CONTAINS ONE. Every statement
-- is a single complete SQL statement terminated by exactly one semicolon.
--
-- PURELY ADDITIVE. Ten nullable columns and two defaulted columns are added to
-- each of ContentVersion and AssessmentVersion, and three new tables are
-- created. No existing column is dropped, renamed, retyped or backfilled with a
-- computed value, no existing row is rewritten, no table is rebuilt, and no
-- learner or runtime table is touched at all. The runtime reads `status`, which
-- this migration does not mention.
--
-- SQLITE CONSTRAINT NOTE. SQLite refuses a CHECK on ALTER TABLE ADD COLUMN, so
-- the two `editorialState` columns carry their vocabulary in the Prisma enum and
-- in the domain layer rather than in a table constraint. The three NEW tables
-- declare their CHECKs inline, where SQLite accepts them, which is why the
-- exactly-one-target rule for a review note is a real database constraint.
--
-- WHAT HISTORY GETS. Every pre-existing ContentVersion and AssessmentVersion row
-- becomes `editorialState = 'draft'` and `revision = 1`, with every actor and
-- timestamp column left NULL. This is deliberate and it is the whole reason the
-- default is not `approved`. There is no submission, no reviewer and no approval
-- timestamp anywhere in the database for those rows, so any other default would
-- invent an editorial decision that no human ever made -- and the ATA-100
-- package's 154 open editorial gaps would read as closed. A published row stays
-- published and keeps serving learners exactly as before. It simply carries no
-- editorial claim, which is the truth about it.

-- ---------------------------------------------------------------- ContentVersion

ALTER TABLE "ContentVersion" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ContentVersion" ADD COLUMN "editorialState" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "ContentVersion" ADD COLUMN "lastAuthoredById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentVersion" ADD COLUMN "lastAuthoredAt" DATETIME;
ALTER TABLE "ContentVersion" ADD COLUMN "submittedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentVersion" ADD COLUMN "submittedAt" DATETIME;
ALTER TABLE "ContentVersion" ADD COLUMN "changesRequestedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentVersion" ADD COLUMN "changesRequestedAt" DATETIME;
ALTER TABLE "ContentVersion" ADD COLUMN "approvedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentVersion" ADD COLUMN "approvedAt" DATETIME;

CREATE INDEX "ContentVersion_curriculumVersionId_editorialState_idx" ON "ContentVersion"("curriculumVersionId", "editorialState");
CREATE INDEX "ContentVersion_lastAuthoredById_idx" ON "ContentVersion"("lastAuthoredById");
CREATE INDEX "ContentVersion_submittedById_idx" ON "ContentVersion"("submittedById");
CREATE INDEX "ContentVersion_changesRequestedById_idx" ON "ContentVersion"("changesRequestedById");
CREATE INDEX "ContentVersion_approvedById_idx" ON "ContentVersion"("approvedById");

-- ------------------------------------------------------------- AssessmentVersion

ALTER TABLE "AssessmentVersion" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AssessmentVersion" ADD COLUMN "editorialState" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "AssessmentVersion" ADD COLUMN "lastAuthoredById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssessmentVersion" ADD COLUMN "lastAuthoredAt" DATETIME;
ALTER TABLE "AssessmentVersion" ADD COLUMN "submittedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssessmentVersion" ADD COLUMN "submittedAt" DATETIME;
ALTER TABLE "AssessmentVersion" ADD COLUMN "changesRequestedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssessmentVersion" ADD COLUMN "changesRequestedAt" DATETIME;
ALTER TABLE "AssessmentVersion" ADD COLUMN "approvedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssessmentVersion" ADD COLUMN "approvedAt" DATETIME;

CREATE INDEX "AssessmentVersion_curriculumVersionId_editorialState_idx" ON "AssessmentVersion"("curriculumVersionId", "editorialState");
CREATE INDEX "AssessmentVersion_lastAuthoredById_idx" ON "AssessmentVersion"("lastAuthoredById");
CREATE INDEX "AssessmentVersion_submittedById_idx" ON "AssessmentVersion"("submittedById");
CREATE INDEX "AssessmentVersion_changesRequestedById_idx" ON "AssessmentVersion"("changesRequestedById");
CREATE INDEX "AssessmentVersion_approvedById_idx" ON "AssessmentVersion"("approvedById");

-- -------------------------------------------------------- VideoProductionVersion
--
-- The durable, editable form of the Phase-C video-production contract.
--
-- `contractPayload` is the ONE writable field and it holds the EXACT accepted
-- contract object -- the same shape videoProductionContractSchema parses out of
-- curriculum/canonical/ata-video-production-contracts.v1.json. No production
-- field is invented here and none is dropped.
--
-- Everything else is identity, lifecycle, or a SERVER-DERIVED projection of that
-- payload. The two fingerprints come from calculateContractFingerprint and
-- calculateAssessmentFingerprint, the staleness flag from
-- isProductionEvidenceStale -- the existing Phase-C functions, never a second
-- implementation -- and the six denormalised columns are copied out of the
-- payload in the same transaction so the readiness view can filter without
-- deserialising 58 JSON documents. A caller may supply none of them.
--
-- sourceProvenance AND editorialState ARE TWO COLUMNS ON PURPOSE. Provenance
-- says where a bank came from, approval says whether a human accepted it. L18 is
-- SOURCE_BACKED and NOT approved, and this table is shaped so those two facts
-- cannot be collapsed into one.
CREATE TABLE "VideoProductionVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
    "editorialState" TEXT NOT NULL DEFAULT 'draft' CHECK ("editorialState" IN ('draft', 'submitted_for_review', 'changes_requested', 'approved')),
    "levelNumber" INTEGER NOT NULL CHECK ("levelNumber" BETWEEN 1 AND 100),
    "contractVersion" INTEGER NOT NULL CHECK ("contractVersion" > 0),
    "sourceProvenance" TEXT NOT NULL CHECK ("sourceProvenance" IN ('SOURCE_BACKED', 'PROPOSED_CANON')),
    "scriptState" TEXT NOT NULL CHECK ("scriptState" IN ('SCRIPT_PENDING', 'SCRIPT_READY')),
    "videoState" TEXT NOT NULL CHECK ("videoState" IN ('NOT_RECORDED', 'VIDEO_RECORDED')),
    "qaState" TEXT NOT NULL CHECK ("qaState" IN ('QA_PENDING', 'QA_PASSED', 'QA_FAILED')),
    "contractPayload" JSONB NOT NULL CHECK (json_valid("contractPayload")),
    -- Both fingerprints are lowercase sha256 hex, exactly as the Phase-C
    -- functions produce them. The length constraint is what stops a caller
    -- supplied value from ever masquerading as a computed one.
    "contractFingerprint" TEXT NOT NULL CHECK (length("contractFingerprint") = 64),
    "assessmentFingerprint" TEXT NOT NULL CHECK (length("assessmentFingerprint") = 64),
    "productionEvidenceStale" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAuthoredById" INTEGER,
    "lastAuthoredAt" DATETIME,
    "submittedById" INTEGER,
    "submittedAt" DATETIME,
    "changesRequestedById" INTEGER,
    "changesRequestedAt" DATETIME,
    "approvedById" INTEGER,
    "approvedAt" DATETIME,
    -- Approval evidence is all-or-nothing. A row cannot claim `approved` with no
    -- approver, and cannot name an approver while sitting in another state.
    CONSTRAINT "VideoProductionVersion_approval_evidence" CHECK (
        ("editorialState" = 'approved' AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL) OR
        ("editorialState" <> 'approved' AND "approvedById" IS NULL AND "approvedAt" IS NULL)
    ),
    CONSTRAINT "VideoProductionVersion_level_fkey" FOREIGN KEY ("levelDefinitionId", "curriculumVersionId") REFERENCES "LevelDefinition"("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VideoProductionVersion_createdBy_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VideoProductionVersion_lastAuthoredBy_fkey" FOREIGN KEY ("lastAuthoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VideoProductionVersion_submittedBy_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VideoProductionVersion_changesRequestedBy_fkey" FOREIGN KEY ("changesRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VideoProductionVersion_approvedBy_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VideoProductionVersion_levelDefinitionId_versionNumber_key" ON "VideoProductionVersion"("levelDefinitionId", "versionNumber");
CREATE INDEX "VideoProductionVersion_curriculumVersionId_editorialState_idx" ON "VideoProductionVersion"("curriculumVersionId", "editorialState");
CREATE INDEX "VideoProductionVersion_curriculumVersionId_levelNumber_idx" ON "VideoProductionVersion"("curriculumVersionId", "levelNumber");
CREATE INDEX "VideoProductionVersion_createdById_idx" ON "VideoProductionVersion"("createdById");
CREATE INDEX "VideoProductionVersion_lastAuthoredById_idx" ON "VideoProductionVersion"("lastAuthoredById");
CREATE INDEX "VideoProductionVersion_submittedById_idx" ON "VideoProductionVersion"("submittedById");
CREATE INDEX "VideoProductionVersion_changesRequestedById_idx" ON "VideoProductionVersion"("changesRequestedById");
CREATE INDEX "VideoProductionVersion_approvedById_idx" ON "VideoProductionVersion"("approvedById");

-- ----------------------------------------------------------- EditorialReviewNote
--
-- Append-only staff commentary about STAFF authoring work.
--
-- This is not the learner ReportReview and must never become it. That model
-- reviews a learner submission, carries rubric scores, and its rows are learner
-- visible evidence. These rows are internal editorial notes and no learner
-- surface may ever read them.
--
-- THREE NULLABLE TARGETS, EXACTLY ONE SET. The alternative -- one untyped
-- integer plus a discriminator string -- was rejected because it carries no
-- referential integrity at all: a note could outlive its target, or point at a
-- row of the wrong kind, and nothing in the database would notice. Here each
-- target is a real foreign key with RESTRICT, and the exactly-one rule is a
-- CHECK the database enforces rather than a convention the domain remembers.
--
-- NO HARD DELETE IN THE NORMAL WORKFLOW. There is no deletedAt column and the
-- domain exposes no delete operation. A note is closed by resolvedAt and
-- resolvedById, which keeps both what was asked and who accepted it.
--
-- NO LEARNER PII. No learner relation, no email, no name. There is nowhere to
-- put one.
CREATE TABLE "EditorialReviewNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contentVersionId" INTEGER,
    "assessmentVersionId" INTEGER,
    "videoProductionVersionId" INTEGER,
    "targetRevision" INTEGER NOT NULL CHECK ("targetRevision" > 0),
    "path" TEXT CHECK ("path" IS NULL OR length("path") BETWEEN 1 AND 200),
    "body" TEXT NOT NULL CHECK (length(trim("body")) BETWEEN 1 AND 4000),
    "authorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolvedById" INTEGER,
    CONSTRAINT "EditorialReviewNote_exactly_one_target" CHECK (
        (CASE WHEN "contentVersionId" IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN "assessmentVersionId" IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN "videoProductionVersionId" IS NULL THEN 0 ELSE 1 END) = 1
    ),
    -- Resolution is all-or-nothing, so a row can never record a resolver without
    -- a time or a time without a resolver.
    CONSTRAINT "EditorialReviewNote_resolution_evidence" CHECK (
        ("resolvedAt" IS NULL AND "resolvedById" IS NULL) OR
        ("resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL)
    ),
    CONSTRAINT "EditorialReviewNote_contentVersion_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EditorialReviewNote_assessmentVersion_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EditorialReviewNote_videoProductionVersion_fkey" FOREIGN KEY ("videoProductionVersionId") REFERENCES "VideoProductionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EditorialReviewNote_author_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EditorialReviewNote_resolvedBy_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "EditorialReviewNote_contentVersionId_resolvedAt_idx" ON "EditorialReviewNote"("contentVersionId", "resolvedAt");
CREATE INDEX "EditorialReviewNote_assessmentVersionId_resolvedAt_idx" ON "EditorialReviewNote"("assessmentVersionId", "resolvedAt");
CREATE INDEX "EditorialReviewNote_videoProductionVersionId_resolvedAt_idx" ON "EditorialReviewNote"("videoProductionVersionId", "resolvedAt");
CREATE INDEX "EditorialReviewNote_authorId_idx" ON "EditorialReviewNote"("authorId");
CREATE INDEX "EditorialReviewNote_resolvedById_idx" ON "EditorialReviewNote"("resolvedById");

-- ------------------------------------------------------ AuthoringPreviewSnapshot
--
-- The immutable staff preview snapshot.
--
-- WHY THE EXISTING VERSION IDS ARE NOT ENOUGH, WHICH IS WHY THIS TABLE EXISTS.
-- A preview must render an EXACT draft state. Draft rows are mutable by design
-- -- that is what `revision` is for -- and the previous state is retained
-- nowhere. So naming a ContentVersion id names a moving target: by the time the
-- renderer reads it, revision N may already be N+1, and staff would review text
-- that no longer exists while believing they reviewed what they clicked.
-- Freezing the render input is the only way to make a preview exact.
--
-- snapshotCode IS AN IDENTIFIER, NOT A CREDENTIAL. It is opaque and unique so it
-- can sit in a URL path, and it grants nothing. The preview route must still
-- resolve the caller session and re-check curriculum_read exactly as every other
-- authoring surface does. No bearer secret ever goes in a preview URL.
--
-- WHAT IS FROZEN. Only the learner-facing render input and the asset table it
-- references. No internal production metadata, no correct answers, no learner
-- data -- a snapshot is what a learner would see, which is the point of it.
--
-- G0 SCOPE. The table and its integrity land here so the migration happens once.
-- The creation domain and the Academy render route are G1.
CREATE TABLE "AuthoringPreviewSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "snapshotCode" TEXT NOT NULL CHECK (length("snapshotCode") BETWEEN 16 AND 64),
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "contentVersionId" INTEGER,
    "contentRevision" INTEGER CHECK ("contentRevision" IS NULL OR "contentRevision" > 0),
    "assessmentVersionId" INTEGER,
    "assessmentRevision" INTEGER CHECK ("assessmentRevision" IS NULL OR "assessmentRevision" > 0),
    "payload" JSONB NOT NULL CHECK (json_valid("payload")),
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    -- A frozen revision is meaningless without the version it belongs to, and a
    -- version without its revision cannot prove what was rendered.
    CONSTRAINT "AuthoringPreviewSnapshot_content_pair" CHECK (
        ("contentVersionId" IS NULL AND "contentRevision" IS NULL) OR
        ("contentVersionId" IS NOT NULL AND "contentRevision" IS NOT NULL)
    ),
    CONSTRAINT "AuthoringPreviewSnapshot_assessment_pair" CHECK (
        ("assessmentVersionId" IS NULL AND "assessmentRevision" IS NULL) OR
        ("assessmentVersionId" IS NOT NULL AND "assessmentRevision" IS NOT NULL)
    ),
    -- A snapshot of nothing is not a preview.
    CONSTRAINT "AuthoringPreviewSnapshot_has_target" CHECK (
        "contentVersionId" IS NOT NULL OR "assessmentVersionId" IS NOT NULL
    ),
    CONSTRAINT "AuthoringPreviewSnapshot_level_fkey" FOREIGN KEY ("levelDefinitionId", "curriculumVersionId") REFERENCES "LevelDefinition"("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuthoringPreviewSnapshot_contentVersion_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuthoringPreviewSnapshot_assessmentVersion_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuthoringPreviewSnapshot_createdBy_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AuthoringPreviewSnapshot_snapshotCode_key" ON "AuthoringPreviewSnapshot"("snapshotCode");
CREATE INDEX "AuthoringPreviewSnapshot_levelDefinitionId_createdAt_idx" ON "AuthoringPreviewSnapshot"("levelDefinitionId", "createdAt");
CREATE INDEX "AuthoringPreviewSnapshot_createdById_idx" ON "AuthoringPreviewSnapshot"("createdById");
CREATE INDEX "AuthoringPreviewSnapshot_expiresAt_idx" ON "AuthoringPreviewSnapshot"("expiresAt");
