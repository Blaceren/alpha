-- L4VC-1 -- Provider-neutral financial-checkpoint verification core.
--
-- Purely additive: two NEW tables and their indexes. No existing table is
-- rebuilt, no existing column is altered, no existing row is modified, no enum
-- CHECK is mutated and nothing is backfilled. Applying it changes no accepted
-- behaviour, and with CURRICULUM_V2_CHECKPOINT_ENABLED / POCKET_BALANCE_PROVIDER_ENABLED
-- absent (the shipped default) neither table is ever written.
--
-- PRIVACY BY ABSENCE. Neither table has a column that could hold an observed
-- balance, a demo balance, a remaining amount, an account login, an account
-- identifier, a token, or a free-form provider payload. Persisting a learner's
-- money would require a new migration and a review, which is the point.
--
-- The threshold is stored as an INTEGER in minor units (USD 50.00 -> 5000).
-- Money is never a float here.

-- One configured threshold per financial-checkpoint level.
CREATE TABLE "LevelCheckpointRequirement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "levelDefinitionId" INTEGER NOT NULL,
    "integrationCode" TEXT NOT NULL CHECK (length(trim("integrationCode")) BETWEEN 1 AND 64),
    -- USD only in this phase. A currency the platform cannot compare against is
    -- an `unsupported_currency` outcome, never a silently coerced comparison.
    "thresholdCurrency" TEXT NOT NULL CHECK ("thresholdCurrency" IN ('USD')),
    -- Strictly positive: a zero or negative gate is not a gate.
    "thresholdMinorUnits" INTEGER NOT NULL CHECK ("thresholdMinorUnits" > 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LevelCheckpointRequirement_levelDefinition_fkey" FOREIGN KEY ("levelDefinitionId")
        REFERENCES "LevelDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- "One requirement per level" as a database fact, not a convention.
CREATE UNIQUE INDEX "LevelCheckpointRequirement_levelDefinitionId_key"
ON "LevelCheckpointRequirement"("levelDefinitionId");

CREATE INDEX "LevelCheckpointRequirement_integrationCode_idx"
ON "LevelCheckpointRequirement"("integrationCode");

-- One verification attempt. Also the durable idempotency receipt.
CREATE TABLE "CheckpointVerificationAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "enrollmentId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    -- Learner-supplied idempotency identity. Charset and length are enforced by
    -- the application. The floor here stops an empty or absurd key being stored.
    "requestId" TEXT NOT NULL CHECK (length(trim("requestId")) BETWEEN 8 AND 128),
    -- Bounded vocabulary. Every member is a verdict about the configured
    -- threshold or an operational fact, and none can describe an amount.
    "outcome" TEXT NOT NULL CHECK ("outcome" IN (
        'in_progress',
        'met',
        'not_met',
        'identity_unlinked',
        'identity_mismatch',
        'unsupported_currency',
        'provider_disabled',
        'provider_unconfigured',
        'provider_timeout',
        'provider_maintenance',
        'provider_rate_limited',
        'stale',
        'invalid_provider_response'
    )),
    -- Provider-side correlation handle for support. Never a token or a login.
    "providerRequestId" TEXT,
    -- Freshness of the provider's answer. A timestamp, not a measurement.
    "observedAt" DATETIME,
    "cooldownUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- NULL while the attempt is claimed but the provider has not answered.
    "completedAt" DATETIME,
    CONSTRAINT "CheckpointVerificationAttempt_enrollment_fkey" FOREIGN KEY ("enrollmentId")
        REFERENCES "UserCurriculumEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CheckpointVerificationAttempt_levelDefinition_fkey" FOREIGN KEY ("levelDefinitionId")
        REFERENCES "LevelDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The idempotency key. Two concurrent identical requests race to insert this
-- row, and the loser reads the winner's row instead of calling the provider again,
-- which is what bounds the provider to exactly one call per request identity.
CREATE UNIQUE INDEX "CheckpointVerificationAttempt_enrollment_level_requestId_key"
ON "CheckpointVerificationAttempt"("enrollmentId", "levelDefinitionId", "requestId");

-- Detects a requestId reused across levels within one enrollment (bounded conflict).
CREATE INDEX "CheckpointVerificationAttempt_enrollmentId_requestId_idx"
ON "CheckpointVerificationAttempt"("enrollmentId", "requestId");

-- Serves cooldown ("most recent attempt") and the rolling-hour rate limit.
CREATE INDEX "CheckpointVerificationAttempt_enrollment_level_createdAt_idx"
ON "CheckpointVerificationAttempt"("enrollmentId", "levelDefinitionId", "createdAt");

CREATE INDEX "CheckpointVerificationAttempt_levelDefinitionId_idx"
ON "CheckpointVerificationAttempt"("levelDefinitionId");
