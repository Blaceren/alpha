-- PHASE-G2 FOUNDATION -- the source-authority adjudication record.
--
-- WHAT THIS CLOSES. A Blueprint proposal and an approved bank can disagree on a
-- field. The disagreement is computed live and has always been visible, but the
-- platform had nowhere to put the SENTENCE "a human compared these two exact
-- values and chose one, for this reason, on this evidence, at this time". The
-- only ways to make the disagreement go away were to edit one side into the
-- other or to relabel provenance, and both destroy the fact that a choice was
-- ever made. This table is that missing sentence.
--
-- NOT APPLIED ANYWHERE BY THIS PHASE. Source-only, exactly like the G0 and G1
-- migrations it descends from. No live, preprod or production database is
-- touched, no sealed editorial database is touched, and CURRICULUM_V2_ADMIN
-- _ENABLED stays absent.
--
-- IT DESCENDS FROM 20260808120000_authoring_foundation_corrections AND DOES NOT
-- EDIT IT. Correcting a shipped migration in place would change its checksum and
-- make every database that already ran it disagree with the repository.
--
-- MIGRATION RUNNER CONTRACT. prisma/migrate.ts splits this file on the semicolon
-- character, so NO COMMENT IN THIS FILE CONTAINS ONE, and every statement is a
-- single complete statement terminated by exactly one semicolon.
--
-- PURELY ADDITIVE. One new table and its indexes. No existing column is dropped,
-- renamed, retyped or backfilled, no existing row is rewritten, no table is
-- rebuilt, and no learner or runtime table is touched. Every existing authoring
-- row keeps its exact meaning -- a bank with no row here is simply unadjudicated,
-- which is what every bank is today.
--
-- WHY ONE ROW PER FIELD. The accepted comparison is field-level -- it names
-- questions[0].prompt, not question 0 -- so an adjudication that could only be
-- expressed per question or per bank could not be tied to the exact conflict it
-- settles. Structural completeness for a wider scope is a DOMAIN rule, enforced
-- where it can be explained, not a shape this table imposes.
--
-- WHY THE HASHES ARE COLUMNS. A decision is only about the two values that were
-- actually compared. Storing both sides' hashes is what lets a later read prove
-- the decision still describes reality, and refuse to apply it when either side
-- has moved. Without them the row would silently keep resolving a conflict
-- nobody adjudicated.
CREATE TABLE "SourceAuthorityResolution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,

    -- The exact conflict this row adjudicates.
    "assessmentVersionId" INTEGER NOT NULL,
    "videoProductionVersionId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "questionIndex" INTEGER NOT NULL CHECK ("questionIndex" >= 0),
    "field" TEXT NOT NULL CHECK ("field" IN ('prompt', 'correctAnswerText')),
    -- The accepted path grammar, stored verbatim so the row is readable without
    -- reconstructing it and so a future field vocabulary cannot silently change
    -- what an old row meant.
    "conflictPath" TEXT NOT NULL,

    -- The decision itself.
    "decision" TEXT NOT NULL CHECK ("decision" IN ('CURRENT', 'BLUEPRINT')),

    -- The two values that were compared, by hash. Lowercase sha256 hex.
    "currentValueHash" TEXT NOT NULL CHECK (length("currentValueHash") = 64),
    "blueprintValueHash" TEXT NOT NULL CHECK (length("blueprintValueHash") = 64),

    -- Source identity of each side at decision time.
    "blueprintSourceDocumentSha256" TEXT NOT NULL CHECK (length("blueprintSourceDocumentSha256") = 64),
    "contractFingerprintAtDecision" TEXT NOT NULL CHECK (length("contractFingerprintAtDecision") = 64),
    "bankFingerprintAtDecision" TEXT NOT NULL CHECK (length("bankFingerprintAtDecision") = 64),
    "assessmentRevisionAtDecision" INTEGER NOT NULL CHECK ("assessmentRevisionAtDecision" > 0),

    -- Why, and on what evidence.
    "rationale" TEXT NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "evidenceSha256" TEXT NOT NULL CHECK (length("evidenceSha256") = 64),

    -- One adjudication request writes one batch. Grouping is what makes an
    -- atomic multi-field decision readable as the single editorial act it was.
    "batchId" TEXT NOT NULL,

    -- Who and when. Server-derived from the gate, never accepted from a caller.
    "decidedById" INTEGER NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Supersession rather than deletion. A re-adjudication marks the old row and
    -- inserts a new one, so the history of what was decided when survives and no
    -- code path ever removes evidence that a decision existed.
    "supersededAt" DATETIME,
    "supersededById" INTEGER,

    -- Supersession evidence is all-or-nothing, the same rule the accepted
    -- approval-evidence constraints already use.
    CONSTRAINT "SourceAuthorityResolution_supersede_evidence" CHECK (
        ("supersededAt" IS NULL AND "supersededById" IS NULL) OR
        ("supersededAt" IS NOT NULL AND "supersededById" IS NOT NULL)
    ),

    CONSTRAINT "SourceAuthorityResolution_assessment_fkey"
        FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceAuthorityResolution_video_fkey"
        FOREIGN KEY ("videoProductionVersionId") REFERENCES "VideoProductionVersion" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceAuthorityResolution_level_fkey"
        FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition" ("id", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceAuthorityResolution_decidedBy_fkey"
        FOREIGN KEY ("decidedById") REFERENCES "User" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceAuthorityResolution_supersededBy_fkey"
        FOREIGN KEY ("supersededById") REFERENCES "User" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AT MOST ONE ACTIVE DECISION PER CONFLICT SLOT. The partial index is the whole
-- anti-duplication rule -- a replay cannot create a second active row for the
-- same field, and a superseded row is excluded so history may accumulate freely.
CREATE UNIQUE INDEX "SourceAuthorityResolution_active_slot_key"
ON "SourceAuthorityResolution" ("assessmentVersionId", "questionIndex", "field")
WHERE "supersededAt" IS NULL;

CREATE INDEX "SourceAuthorityResolution_assessment_idx"
ON "SourceAuthorityResolution" ("assessmentVersionId", "supersededAt");

CREATE INDEX "SourceAuthorityResolution_level_idx"
ON "SourceAuthorityResolution" ("curriculumVersionId", "levelDefinitionId");

CREATE INDEX "SourceAuthorityResolution_batch_idx"
ON "SourceAuthorityResolution" ("batchId");

CREATE INDEX "SourceAuthorityResolution_decidedById_idx"
ON "SourceAuthorityResolution" ("decidedById");

CREATE INDEX "SourceAuthorityResolution_supersededById_idx"
ON "SourceAuthorityResolution" ("supersededById");
