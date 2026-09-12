-- A8 -- STAGING_ATTESTED QA verification.
--
-- NOT APPLIED ANYWHERE BY THIS PHASE. Phase A is a source-only candidate: this
-- file exists so the model is reviewable and so the regression harness can
-- build a throwaway SQLite fixture from it. No live, preprod or production
-- database was touched.
--
-- PURELY ADDITIVE. ONE new table and its indexes. No existing table is read,
-- altered, rebuilt or backfilled, no column is added to an existing table, and
-- no row anywhere else is modified. Dropping this table returns the schema to
-- exactly its previous shape.
--
-- MIGRATION RUNNER CONTRACT. prisma/migrate.ts splits this file on the
-- semicolon character, so NO COMMENT IN THIS FILE CONTAINS ONE. Every statement
-- is a single complete SQL statement terminated by exactly one semicolon.
--
-- WHAT ONE ROW MEANS. "An authorized operator, on a deployment authoritatively
-- classified staging, attested that this enrollment's gate at this level should
-- be treated as satisfied for QA." It does not mean the learner deposited
-- money. It does not mean Pocket witnessed a registration. Production is
-- untouched and remains Pocket-authoritative for both.
--
-- PRIVACY AND HONESTY BY ABSENCE. There is no column here that could hold an
-- amount, a currency, a balance, a balance delta, a Pocket user id, a click id,
-- an API token or a raw provider payload. Fabricating a financial event or a
-- partner event through this table is not merely forbidden, it has nowhere to
-- be written. For the same reason a fake row is NOT inserted into
-- CheckpointVerificationAttempt, whose rows mean "the platform asked a balance
-- provider" and whose cooldown window is derived from them.
--
-- WHY environment IS A STORED COLUMN. The runtime gate already refuses outside
-- staging. Storing the classification the row was made under means a database
-- copied from PREPROD to anywhere else still carries rows that identify
-- themselves as staging-only, and the completion primitive re-checks the value
-- before it will act on one. The CHECK pins it to the single legal literal.

CREATE TABLE "StagingAttestation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    -- Bound one-to-one to a completion owner in
    -- src/lib/curriculum/completion.ts. A third class requires a migration and
    -- a review rather than a runtime string.
    "eventClass" TEXT NOT NULL
        CHECK ("eventClass" IN ('pocket_registration', 'financial_checkpoint')),
    "enrollmentId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    -- Operator-supplied idempotency identity, same charset and bounds as every
    -- other durable request identity in this schema. Never a learner value.
    "requestId" TEXT NOT NULL
        CHECK (length(trim("requestId")) BETWEEN 8 AND 128),
    -- The operator. The domain refuses an attestation whose operator is the
    -- learner who owns the enrollment.
    "attestedById" INTEGER NOT NULL,
    -- Pinned. A row can never claim to have been made anywhere else.
    "environment" TEXT NOT NULL DEFAULT 'staging'
        CHECK ("environment" IN ('staging')),
    "attestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StagingAttestation_enrollment_fkey" FOREIGN KEY ("enrollmentId")
        REFERENCES "UserCurriculumEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StagingAttestation_level_fkey" FOREIGN KEY ("levelDefinitionId")
        REFERENCES "LevelDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StagingAttestation_operator_fkey" FOREIGN KEY ("attestedById")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Idempotency as a database fact. An identical retry resolves to the one row
-- rather than creating a second attestation, and two concurrent identical
-- requests cannot both commit.
CREATE UNIQUE INDEX "StagingAttestation_enrollment_level_request_key"
ON "StagingAttestation"("enrollmentId", "levelDefinitionId", "requestId");

-- Exactness as a database fact. One gate can be attested exactly once, however
-- many request identities are tried against it. Without this, rotating the
-- request id would be a way to accumulate attestations for one level.
CREATE UNIQUE INDEX "StagingAttestation_enrollment_level_event_key"
ON "StagingAttestation"("enrollmentId", "levelDefinitionId", "eventClass");

-- Replay lookup by request identity within an enrollment.
CREATE INDEX "StagingAttestation_enrollmentId_requestId_idx"
ON "StagingAttestation"("enrollmentId", "requestId");

-- "What did this operator attest, and when" -- the QA audit read.
CREATE INDEX "StagingAttestation_attestedById_attestedAt_idx"
ON "StagingAttestation"("attestedById", "attestedAt");

-- "Which enrollments were attested at this level" -- the level drill-down.
CREATE INDEX "StagingAttestation_levelDefinitionId_idx"
ON "StagingAttestation"("levelDefinitionId");
