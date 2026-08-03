-- AGENT-FOUNDATION-1 -- the shared Agent Core foundation.
--
-- PURELY ADDITIVE. This migration creates nine new tables and their indexes.
-- It reads no existing table, alters no existing table, rebuilds no existing
-- table, adds no column to an existing table, runs no backfill, seeds no row
-- and introduces no balance, no money column and no current-value column. Every
-- one of the nine tables is EMPTY when this migration finishes, and dropping
-- all nine returns the schema to exactly its migration 40 shape, which is what
-- makes the rollback rehearsal meaningful.
--
-- MIGRATION RUNNER CONTRACT. prisma/migrate.ts splits this file on the
-- semicolon character and executes each fragment inside one transaction
-- together with its own ledger row. A semicolon inside a comment would
-- therefore cut a statement in half and apply the halves separately, so NO
-- COMMENT IN THIS FILE CONTAINS ONE. Every statement below is a single complete
-- SQL statement terminated by exactly one semicolon, and the file ends with a
-- statement rather than with a comment.
--
-- WHY THERE IS NO AgentDefinition TABLE. An agent's identity, version, mode and
-- capability set live in src/lib/agents/agent-registry.ts, where they are a
-- reviewable artefact. A row would let an operator invent an agent at runtime
-- that no review ever saw, and the database would quietly become the source of
-- agent identity. AgentRun stores agentCode and agentVersion as denormalised
-- TEXT so a stored run stays interpretable after that registry moves on.
--
-- WHAT IS DELIBERATELY NOT COPIED INTO THESE TABLES. No affiliate analytics
-- aggregate, no learner progression, no lesson event, no Pocket event, no
-- deposit event, no balance snapshot, no report, no email address, no phone
-- number, no full name, no raw Pocket player id, no raw affiliate click id and
-- no raw provider payload. Agent Core stores REFERENCES to authoritative
-- evidence, never duplicate facts, and the CHECK constraints below are what
-- make that structural rather than aspirational.
--
-- ENUM REPRESENTATION. SQLite has no native enum, so every Prisma enum is a
-- TEXT column with a CHECK constraint listing its members, matching the
-- convention established by migrations 37 to 39. The member lists here are
-- mirrored member-for-member from src/lib/agents/agent-core-contract.ts and a
-- regression compares the two so they cannot drift.

-- ---------------------------------------------------------------------------
-- 1. AgentRun -- one bounded execution attempt.
-- ---------------------------------------------------------------------------
--
-- THE IDEMPOTENCY CONTRACT is the unique index at the bottom: the same logical
-- question, asked twice under one agent, returns the first run instead of doing
-- the work again. SQLite treats NULLs as distinct in a unique index, which is
-- exactly the semantics required -- the key is optional for interactive runs
-- and mandatory for the future scheduled, handoff and action workflows, so many
-- keyless runs must coexist under one agent while two keyed ones must not.
--
-- THE SUBJECT PAIRING is enforced here and not only in the service. A run with
-- a subjectType and no subjectRef is not a global run and is not a
-- subject-scoped run either -- it is a silently wrong answer about an
-- unspecified thing, and the database refuses to hold one.
--
-- subjectRef IS AN INTERNAL OPAQUE REFERENCE. The GLOB constraints below reject
-- an at-sign, a slash, a question mark, an ampersand and whitespace, so an
-- email address, a URL, a callback query string and a raw provider payload
-- cannot be stored in it whatever the calling code believes it is passing.

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    -- Denormalised registry identity, bounded to the shape a code can have.
    "agentCode" TEXT NOT NULL
        CHECK (length("agentCode") BETWEEN 1 AND 64)
        CHECK ("agentCode" NOT GLOB '*[^a-z0-9_]*'),
    "agentVersion" TEXT NOT NULL
        CHECK (length("agentVersion") BETWEEN 1 AND 32),
    -- Only deterministic is executable in this phase. The other two members are
    -- schema-ready and refused by runtime policy, which is where the model
    -- boundary is enforced -- a CHECK here would have to be altered later.
    "executionMode" TEXT NOT NULL
        CHECK ("executionMode" IN ('deterministic', 'model_assisted', 'model_only')),
    "triggerType" TEXT NOT NULL
        CHECK ("triggerType" IN ('interactive', 'scheduled', 'handoff', 'system', 'test')),
    "status" TEXT NOT NULL DEFAULT 'created'
        CHECK ("status" IN ('created', 'running', 'completed', 'failed', 'cancelled')),
    -- The implementation and catalog behind the findings, kept separate from
    -- agentVersion so a rule fix and a new finding code stay distinguishable.
    "engineVersion" TEXT
        CHECK ("engineVersion" IS NULL OR length("engineVersion") BETWEEN 1 AND 32),
    "catalogVersion" TEXT
        CHECK ("catalogVersion" IS NULL OR length("catalogVersion") BETWEEN 1 AND 32),
    -- Correlates the run with the HTTP request that caused it. Never a URL and
    -- never a query string.
    "requestId" TEXT NOT NULL
        CHECK (length("requestId") BETWEEN 1 AND 64)
        CHECK ("requestId" NOT GLOB '*[ /?&@]*'),
    -- A stable hash of the RESOLVED question, never of the raw request.
    "inputFingerprint" TEXT NOT NULL
        CHECK (length("inputFingerprint") BETWEEN 8 AND 64)
        CHECK ("inputFingerprint" NOT GLOB '*[^a-f0-9]*'),
    "idempotencyKey" TEXT
        CHECK ("idempotencyKey" IS NULL OR (length("idempotencyKey") BETWEEN 1 AND 128 AND "idempotencyKey" NOT GLOB '*[ /?&@]*')),
    "subjectType" TEXT
        CHECK ("subjectType" IS NULL OR "subjectType" IN ('learner', 'affiliate_partner', 'affiliate_campaign', 'affiliate_tracking_link', 'curriculum_level')),
    "subjectRef" TEXT
        CHECK ("subjectRef" IS NULL OR (length("subjectRef") BETWEEN 1 AND 128 AND "subjectRef" NOT GLOB '*[ /?&@]*')),
    -- Nullable for future system runs. References the canonical CRM staff
    -- identity: this migration introduces no second staff model.
    "initiatedByStaffId" TEXT,
    "retentionClass" TEXT NOT NULL DEFAULT 'analytical_standard'
        CHECK ("retentionClass" IN ('operational_short', 'analytical_standard', 'decision_record', 'execution_record', 'evaluation_record')),
    -- NULL until a retention policy exists to fill it. No duration is invented
    -- by this migration and no row is ever automatically deleted.
    "purgeAfter" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "failureCode" TEXT
        CHECK ("failureCode" IS NULL OR length("failureCode") BETWEEN 1 AND 64),
    "findingCount" INTEGER NOT NULL DEFAULT 0
        CHECK ("findingCount" >= 0),
    "warningCount" INTEGER NOT NULL DEFAULT 0
        CHECK ("warningCount" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Both absent for a global run, both present for a subject-scoped run. A
    -- run with a subjectType and no subjectRef is not a global run and is not a
    -- subject-scoped run either -- it is a silently wrong answer about an
    -- unspecified thing, and the database refuses to hold one.
    CHECK (("subjectType" IS NULL AND "subjectRef" IS NULL) OR ("subjectType" IS NOT NULL AND "subjectRef" IS NOT NULL)),
    CONSTRAINT "AgentRun_initiatedByStaffId_fkey" FOREIGN KEY ("initiatedByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentRun_agentCode_idempotencyKey_key" ON "AgentRun"("agentCode", "idempotencyKey");

CREATE INDEX "AgentRun_agentCode_createdAt_idx" ON "AgentRun"("agentCode", "createdAt");

CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

CREATE INDEX "AgentRun_subjectType_subjectRef_createdAt_idx" ON "AgentRun"("subjectType", "subjectRef", "createdAt");

CREATE INDEX "AgentRun_inputFingerprint_idx" ON "AgentRun"("inputFingerprint");

CREATE INDEX "AgentRun_initiatedByStaffId_idx" ON "AgentRun"("initiatedByStaffId");

-- ---------------------------------------------------------------------------
-- 2. AgentFinding -- one structured statement.
-- ---------------------------------------------------------------------------
--
-- THERE IS NO RENDERED-MESSAGE COLUMN, deliberately. The authoritative
-- representation is a stable code, a messageKey naming a reviewed sentence
-- template, strictly validated operands and evidence references. A sentence is
-- produced at read time from the template for the code, so "no invented causes"
-- is a property of a fixed reviewable list rather than of whatever a writer felt
-- like storing. A free-text column here would silently undo that.
--
-- operandsJson IS NOT VALIDATED BY THIS MIGRATION beyond being non-empty JSON.
-- Its real gate is agent-payload-policy.ts, which rejects unknown keys,
-- PII-shaped keys, nested values, oversized payloads and forbidden value shapes
-- against a versioned schema registered per finding code. SQLite cannot express
-- that, and a weaker CHECK here would invite the belief that it had.

CREATE TABLE "AgentFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    -- Stable within a run, so a consumer can address a finding across re-reads
    -- without depending on row order.
    "findingKey" TEXT NOT NULL
        CHECK (length("findingKey") BETWEEN 1 AND 128)
        CHECK ("findingKey" NOT GLOB '*[ /?&@]*'),
    "code" TEXT NOT NULL
        CHECK (length("code") BETWEEN 1 AND 96)
        CHECK ("code" NOT GLOB '*[^a-z0-9_.]*'),
    "category" TEXT NOT NULL
        CHECK (length("category") BETWEEN 1 AND 64)
        CHECK ("category" NOT GLOB '*[^a-z0-9_]*'),
    "severity" TEXT NOT NULL
        CHECK ("severity" IN ('info', 'warning', 'critical')),
    -- Names the sentence template. Never the sentence.
    "messageKey" TEXT NOT NULL
        CHECK (length("messageKey") BETWEEN 1 AND 128)
        CHECK ("messageKey" NOT GLOB '*[ ]*'),
    "operandsJson" TEXT NOT NULL
        CHECK (json_valid("operandsJson"))
        CHECK (json_type("operandsJson") = 'object')
        -- The bound is generous relative to the 2048 byte service limit so that
        -- the service remains the single authority on payload size.
        CHECK (length("operandsJson") <= 4096),
    "operandsSchemaVersion" INTEGER NOT NULL DEFAULT 1
        CHECK ("operandsSchemaVersion" >= 1),
    "supportTier" TEXT NOT NULL
        CHECK ("supportTier" IN ('measured', 'derived', 'insufficient')),
    "status" TEXT NOT NULL DEFAULT 'active'
        CHECK ("status" IN ('active', 'superseded', 'expired', 'withdrawn')),
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentFinding_runId_findingKey_key" ON "AgentFinding"("runId", "findingKey");

CREATE INDEX "AgentFinding_runId_idx" ON "AgentFinding"("runId");

CREATE INDEX "AgentFinding_code_createdAt_idx" ON "AgentFinding"("code", "createdAt");

CREATE INDEX "AgentFinding_severity_createdAt_idx" ON "AgentFinding"("severity", "createdAt");

CREATE INDEX "AgentFinding_status_expiresAt_idx" ON "AgentFinding"("status", "expiresAt");

-- ---------------------------------------------------------------------------
-- 3. AgentEvidenceReference -- what a finding points at, without copying it.
-- ---------------------------------------------------------------------------
--
-- THE OWNERSHIP RULE IN ONE TABLE. A row here names a domain, a type, an opaque
-- reference and a field path. A consumer that wants the VALUE re-reads it from
-- the owner, through the owner's own permission gate. That is what keeps a
-- stale agent output from becoming a second, divergent source of truth.
--
-- observedValueJson is OPTIONAL and bounded to the minimal value needed to
-- reproduce the finding -- a metric name, its exact value as a string, and a
-- unit. It is never an entire DTO, an entire API response, a user profile or a
-- provider payload, none of which is a flat map carrying a metricKey.
--
-- IMMUTABLE AFTER CREATION. There is no updatedAt column and no service method
-- that writes to an existing row.

CREATE TABLE "AgentEvidenceReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "findingId" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL
        CHECK ("sourceDomain" IN ('affiliate_analytics', 'curriculum', 'progression', 'assessment', 'report', 'pocket_event', 'money_event', 'product_event', 'communication_event', 'agent_run')),
    -- The kind of thing within the domain -- an aggregate name, never a table.
    "sourceType" TEXT NOT NULL
        CHECK (length("sourceType") BETWEEN 1 AND 64)
        CHECK ("sourceType" NOT GLOB '*[^a-z0-9_]*'),
    "sourceRef" TEXT NOT NULL
        CHECK (length("sourceRef") BETWEEN 1 AND 128)
        CHECK ("sourceRef" NOT GLOB '*[ /?&@]*'),
    "fieldPath" TEXT NOT NULL
        CHECK (length("fieldPath") BETWEEN 1 AND 128)
        CHECK ("fieldPath" NOT GLOB '*[ ?&@]*'),
    "sourceVersion" TEXT
        CHECK ("sourceVersion" IS NULL OR length("sourceVersion") BETWEEN 1 AND 64),
    "sourceFingerprint" TEXT
        CHECK ("sourceFingerprint" IS NULL OR (length("sourceFingerprint") BETWEEN 8 AND 64 AND "sourceFingerprint" NOT GLOB '*[^a-f0-9]*')),
    "observedValueJson" TEXT
        CHECK ("observedValueJson" IS NULL OR (json_valid("observedValueJson") AND json_type("observedValueJson") = 'object' AND length("observedValueJson") <= 1024)),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentEvidenceReference_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AgentFinding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AgentEvidenceReference_findingId_idx" ON "AgentEvidenceReference"("findingId");

-- ---------------------------------------------------------------------------
-- 4. AgentHandoff -- a structured request from one run to another agent.
-- ---------------------------------------------------------------------------
--
-- NO CONSUMER AND NO BACKGROUND WORKER EXISTS. Nothing accepts a handoff in
-- this phase and no target run is ever created from one, so acceptedRunId and
-- acceptedAt are permanently NULL until a reviewed phase implements a consumer.
--
-- payloadJson CARRIES A CODE AND OPERANDS, NEVER AN INSTRUCTION. No registered
-- handoff schema has a message, note, instruction or reason key. An agent
-- asking another agent to do something in a sentence is exactly the
-- uncontrolled surface this design exists to prevent.

CREATE TABLE "AgentHandoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceRunId" TEXT NOT NULL,
    "targetAgentCode" TEXT NOT NULL
        CHECK (length("targetAgentCode") BETWEEN 1 AND 64)
        CHECK ("targetAgentCode" NOT GLOB '*[^a-z0-9_]*'),
    -- NULL for a reserved target, which has no published version to pin.
    "targetAgentVersion" TEXT
        CHECK ("targetAgentVersion" IS NULL OR length("targetAgentVersion") BETWEEN 1 AND 32),
    "handoffCode" TEXT NOT NULL
        CHECK (length("handoffCode") BETWEEN 1 AND 96)
        CHECK ("handoffCode" NOT GLOB '*[^a-z0-9_]*'),
    "payloadJson" TEXT NOT NULL
        CHECK (json_valid("payloadJson"))
        CHECK (json_type("payloadJson") = 'object')
        CHECK (length("payloadJson") <= 4096),
    "payloadSchemaVersion" INTEGER NOT NULL DEFAULT 1
        CHECK ("payloadSchemaVersion" >= 1),
    "deduplicationKey" TEXT
        CHECK ("deduplicationKey" IS NULL OR (length("deduplicationKey") BETWEEN 1 AND 128 AND "deduplicationKey" NOT GLOB '*[ /?&@]*')),
    "status" TEXT NOT NULL DEFAULT 'proposed'
        CHECK ("status" IN ('proposed', 'accepted', 'rejected', 'expired', 'cancelled')),
    "expiresAt" DATETIME,
    "acceptedRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "rejectedAt" DATETIME,
    "rejectionCode" TEXT
        CHECK ("rejectionCode" IS NULL OR length("rejectionCode") BETWEEN 1 AND 64),
    -- An accepted handoff must name the run that accepted it, and a handoff
    -- that is not accepted must not name one. The status and the link cannot
    -- disagree.
    CHECK (("status" = 'accepted' AND "acceptedRunId" IS NOT NULL) OR ("status" <> 'accepted' AND "acceptedRunId" IS NULL)),
    CONSTRAINT "AgentHandoff_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "AgentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentHandoff_acceptedRunId_fkey" FOREIGN KEY ("acceptedRunId") REFERENCES "AgentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentHandoff_deduplicationKey_key" ON "AgentHandoff"("deduplicationKey");

CREATE INDEX "AgentHandoff_targetAgentCode_status_createdAt_idx" ON "AgentHandoff"("targetAgentCode", "status", "createdAt");

CREATE INDEX "AgentHandoff_sourceRunId_idx" ON "AgentHandoff"("sourceRunId");

CREATE INDEX "AgentHandoff_acceptedRunId_idx" ON "AgentHandoff"("acceptedRunId");

-- ---------------------------------------------------------------------------
-- 5. AgentActionProposal -- a proposed action, not an executed one.
-- ---------------------------------------------------------------------------
--
-- THE CHECK ON requiresHumanApproval IS THE POINT OF THIS TABLE. It is not a
-- default that a caller may override -- the column can hold exactly one value,
-- so automatic approval and automatic execution are impossible at the storage
-- layer and not merely discouraged at the service layer.
--
-- THE ACTION CLASS LIST IS CLOSED AND EVERY MEMBER IS EDUCATIONAL. Permanently
-- absent, because the platform teaches trading rather than selling it: deposit
-- encouragement, trading encouragement, any bid, CPA or payout change,
-- affiliate enablement or disablement, and any financial-pressure messaging.
-- Adding one would require altering this constraint in a reviewed migration.
--
-- templateKey NAMES A REVIEWED TEMPLATE and parametersJson supplies typed
-- parameters to it. No registered parameter schema has a body, text, url,
-- recipient or destination key, so an agent can never author the message,
-- choose the link or address the recipient.
--
-- A PROPOSAL IS ALWAYS ABOUT SOMETHING. Unlike a run there is no global
-- proposal, because an action with no subject has nobody it could apply to --
-- which is why subjectType and subjectRef are both NOT NULL here.

CREATE TABLE "AgentActionProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceRunId" TEXT NOT NULL,
    "sourceFindingId" TEXT,
    "actionClass" TEXT NOT NULL
        CHECK ("actionClass" IN ('education_reminder', 'continue_learning', 'complete_registration', 'review_feedback', 'support_followup')),
    "subjectType" TEXT NOT NULL
        CHECK ("subjectType" IN ('learner', 'affiliate_partner', 'affiliate_campaign', 'affiliate_tracking_link', 'curriculum_level')),
    "subjectRef" TEXT NOT NULL
        CHECK (length("subjectRef") BETWEEN 1 AND 128)
        CHECK ("subjectRef" NOT GLOB '*[ /?&@]*'),
    -- Stable codes naming the findings that motivated this, never a rationale
    -- sentence.
    "reasonCodesJson" TEXT NOT NULL
        CHECK (json_valid("reasonCodesJson"))
        CHECK (json_type("reasonCodesJson") = 'object')
        CHECK (length("reasonCodesJson") <= 2048),
    "channel" TEXT NOT NULL
        CHECK ("channel" IN ('in_app', 'email', 'push', 'sms', 'human_task')),
    "templateKey" TEXT NOT NULL
        CHECK (length("templateKey") BETWEEN 1 AND 128)
        CHECK ("templateKey" NOT GLOB '*[ ]*'),
    "parametersJson" TEXT NOT NULL
        CHECK (json_valid("parametersJson"))
        CHECK (json_type("parametersJson") = 'object')
        CHECK (length("parametersJson") <= 4096),
    "parametersSchemaVersion" INTEGER NOT NULL DEFAULT 1
        CHECK ("parametersSchemaVersion" >= 1),
    "deduplicationKey" TEXT
        CHECK ("deduplicationKey" IS NULL OR (length("deduplicationKey") BETWEEN 1 AND 128 AND "deduplicationKey" NOT GLOB '*[ /?&@]*')),
    "status" TEXT NOT NULL DEFAULT 'proposed'
        CHECK ("status" IN ('proposed', 'awaiting_approval', 'approved', 'rejected', 'expired', 'cancelled', 'execution_pending', 'executed', 'execution_failed')),
    -- Exactly one legal value. Automatic approval is forbidden.
    "requiresHumanApproval" BOOLEAN NOT NULL DEFAULT true
        CHECK ("requiresHumanApproval" = 1),
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentActionProposal_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "AgentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentActionProposal_sourceFindingId_fkey" FOREIGN KEY ("sourceFindingId") REFERENCES "AgentFinding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentActionProposal_deduplicationKey_key" ON "AgentActionProposal"("deduplicationKey");

CREATE INDEX "AgentActionProposal_subjectType_subjectRef_status_idx" ON "AgentActionProposal"("subjectType", "subjectRef", "status");

CREATE INDEX "AgentActionProposal_status_expiresAt_idx" ON "AgentActionProposal"("status", "expiresAt");

CREATE INDEX "AgentActionProposal_sourceRunId_idx" ON "AgentActionProposal"("sourceRunId");

CREATE INDEX "AgentActionProposal_sourceFindingId_idx" ON "AgentActionProposal"("sourceFindingId");

-- ---------------------------------------------------------------------------
-- 6. AgentActionDecision -- the human gate.
-- ---------------------------------------------------------------------------
--
-- decidedByStaffId IS NOT NULL. There is no system approval and no anonymous
-- approval, so an agent never holds more authority than the human who decided.
--
-- THE UNIQUE INDEX ON proposalId IS THE "ONE DECISION EVER" RULE. A second
-- final decision on a proposal is a duplicate-key failure at the database, not
-- a race the service is trusted to win.
--
-- IMMUTABLE. No updatedAt, no status, and no service method writes to an
-- existing row.

CREATE TABLE "AgentActionDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "decision" TEXT NOT NULL
        CHECK ("decision" IN ('approved', 'rejected', 'cancelled')),
    "decisionCode" TEXT NOT NULL
        CHECK (length("decisionCode") BETWEEN 1 AND 64)
        CHECK ("decisionCode" NOT GLOB '*[^a-z0-9_]*'),
    "decidedByStaffId" TEXT NOT NULL,
    -- Which policy authorised this, so a decision stays interpretable after the
    -- policy moves.
    "policyVersion" TEXT NOT NULL
        CHECK (length("policyVersion") BETWEEN 1 AND 64),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentActionDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AgentActionProposal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentActionDecision_decidedByStaffId_fkey" FOREIGN KEY ("decidedByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentActionDecision_proposalId_key" ON "AgentActionDecision"("proposalId");

CREATE INDEX "AgentActionDecision_decidedByStaffId_idx" ON "AgentActionDecision"("decidedByStaffId");

-- ---------------------------------------------------------------------------
-- 7. AgentActionExecution -- future execution attempts.
-- ---------------------------------------------------------------------------
--
-- NO EXECUTION PROVIDER IS REGISTERED. The provider registry is an empty array
-- in src/lib/agents/agent-core-contract.ts, so no code path in this phase can
-- create a row here at all. No external call can be made and no message, email,
-- push or SMS can be sent.
--
-- idempotencyKey IS THE SECOND OF THE TWO IDEMPOTENCY LEVELS. AgentRun's key
-- prevents duplicate WORK, this one prevents duplicate EFFECT, and it is unique
-- across the whole table rather than per proposal because an effect is
-- global -- the same message must not be sent twice under two proposals.
--
-- externalReceiptRef IS OPAQUE ONLY. The GLOB constraint rejects an at-sign, a
-- slash, a question mark, an ampersand and whitespace, so a recipient address,
-- an email, a phone number, a callback URL and a raw provider payload cannot be
-- stored in it.
--
-- auditLogId KEEPS AuditLog THE SINGLE AUDIT SURFACE. Agent Core owns its own
-- structured history, and anything that CHANGES THE PRODUCT is recorded in
-- AuditLog and referenced from here rather than kept in a private audit trail.

CREATE TABLE "AgentActionExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL
        CHECK ("attemptNumber" >= 1),
    "executionProvider" TEXT NOT NULL
        CHECK (length("executionProvider") BETWEEN 1 AND 64)
        CHECK ("executionProvider" NOT GLOB '*[^a-z0-9_]*'),
    "status" TEXT NOT NULL DEFAULT 'pending'
        CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    "idempotencyKey" TEXT NOT NULL
        CHECK (length("idempotencyKey") BETWEEN 1 AND 128)
        CHECK ("idempotencyKey" NOT GLOB '*[ /?&@]*'),
    "externalReceiptRef" TEXT
        CHECK ("externalReceiptRef" IS NULL OR (length("externalReceiptRef") BETWEEN 1 AND 128 AND "externalReceiptRef" NOT GLOB '*[ /?&@]*')),
    "auditLogId" INTEGER,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "failureCode" TEXT
        CHECK ("failureCode" IS NULL OR length("failureCode") BETWEEN 1 AND 64),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentActionExecution_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AgentActionProposal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentActionExecution_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "AuditLog" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentActionExecution_idempotencyKey_key" ON "AgentActionExecution"("idempotencyKey");

CREATE UNIQUE INDEX "AgentActionExecution_proposalId_attemptNumber_key" ON "AgentActionExecution"("proposalId", "attemptNumber");

CREATE INDEX "AgentActionExecution_status_createdAt_idx" ON "AgentActionExecution"("status", "createdAt");

CREATE INDEX "AgentActionExecution_auditLogId_idx" ON "AgentActionExecution"("auditLogId");

-- ---------------------------------------------------------------------------
-- 8. AgentEvaluation -- an assessment of a run, a finding or a proposal.
-- ---------------------------------------------------------------------------
--
-- Kept separate from its target so that re-evaluating a historical run never
-- mutates it. Only deterministic evaluators are enabled in this phase: there is
-- no Curie Sentinel runtime and no model grader.
--
-- scoreValue IS AN EXACT DECIMAL STRING, never a float, for the same reason
-- money is never a float anywhere else in this schema -- a score somebody
-- compares across runs must not depend on binary rounding.
--
-- evidenceJson HOLDS A CODE, A COUNT AND A BOUND. A free-form evaluation report
-- stored here would become authoritative evidence that nobody reviewed.

CREATE TABLE "AgentEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluatorType" TEXT NOT NULL
        CHECK ("evaluatorType" IN ('deterministic', 'human', 'model')),
    "evaluatorCode" TEXT NOT NULL
        CHECK (length("evaluatorCode") BETWEEN 1 AND 64)
        CHECK ("evaluatorCode" NOT GLOB '*[^a-z0-9_]*'),
    "targetType" TEXT NOT NULL
        CHECK ("targetType" IN ('agent_run', 'agent_finding', 'agent_action_proposal')),
    "targetRef" TEXT NOT NULL
        CHECK (length("targetRef") BETWEEN 1 AND 128)
        CHECK ("targetRef" NOT GLOB '*[ /?&@]*'),
    "evaluationCode" TEXT NOT NULL
        CHECK (length("evaluationCode") BETWEEN 1 AND 96)
        CHECK ("evaluationCode" NOT GLOB '*[^a-z0-9_.]*'),
    "scoreValue" TEXT
        CHECK ("scoreValue" IS NULL OR (length("scoreValue") BETWEEN 1 AND 24 AND "scoreValue" NOT GLOB '*[^0-9.-]*')),
    "result" TEXT NOT NULL
        CHECK ("result" IN ('passed', 'failed', 'inconclusive', 'not_applicable')),
    "evidenceJson" TEXT
        CHECK ("evidenceJson" IS NULL OR (json_valid("evidenceJson") AND json_type("evidenceJson") = 'object' AND length("evidenceJson") <= 2048)),
    "evidenceSchemaVersion" INTEGER NOT NULL DEFAULT 1
        CHECK ("evidenceSchemaVersion" >= 1),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AgentEvaluation_targetType_targetRef_createdAt_idx" ON "AgentEvaluation"("targetType", "targetRef", "createdAt");

CREATE INDEX "AgentEvaluation_evaluationCode_createdAt_idx" ON "AgentEvaluation"("evaluationCode", "createdAt");

-- ---------------------------------------------------------------------------
-- 9. ModelInvocation -- schema-only infrastructure for a provider that does
--    not exist.
-- ---------------------------------------------------------------------------
--
-- NO PROVIDER IS SELECTED, no API key is read, no network client exists and
-- every invocation attempt fails closed with MODEL_PROVIDER_DISABLED. The
-- provider registry is an empty array in source, so no code path in this phase
-- can create a row here.
--
-- THIS TABLE RECORDS THAT A CALL HAPPENED AND WHAT IT COST -- NEVER WHAT WAS
-- SAID. Deliberately absent, and a regression asserts each of these by name: a
-- prompt column, a system-prompt column, a raw-response column, a completion
-- column, a feature-packet column and any credential column. promptVersion and
-- outputSchemaVersion NAME artefacts held in source and reviewed there -- they
-- are not the artefacts themselves.
--
-- costMinorUnits IS AN INTEGER OF MINOR UNITS beside an explicit currency,
-- never a float, matching how every other money value in this schema is stored.

CREATE TABLE "ModelInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "providerCode" TEXT NOT NULL
        CHECK (length("providerCode") BETWEEN 1 AND 64)
        CHECK ("providerCode" NOT GLOB '*[^a-z0-9_]*'),
    "modelCode" TEXT NOT NULL
        CHECK (length("modelCode") BETWEEN 1 AND 96)
        CHECK ("modelCode" NOT GLOB '*[ ]*'),
    "modelVersion" TEXT
        CHECK ("modelVersion" IS NULL OR length("modelVersion") BETWEEN 1 AND 64),
    "promptVersion" TEXT
        CHECK ("promptVersion" IS NULL OR length("promptVersion") BETWEEN 1 AND 64),
    "outputSchemaVersion" TEXT
        CHECK ("outputSchemaVersion" IS NULL OR length("outputSchemaVersion") BETWEEN 1 AND 64),
    "attemptNumber" INTEGER NOT NULL DEFAULT 1
        CHECK ("attemptNumber" >= 1),
    "status" TEXT NOT NULL DEFAULT 'pending'
        CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    "validationStatus" TEXT NOT NULL DEFAULT 'not_run'
        CHECK ("validationStatus" IN ('not_run', 'valid', 'invalid_schema', 'invalid_policy', 'unsupported_claim')),
    "inputTokenCount" INTEGER
        CHECK ("inputTokenCount" IS NULL OR "inputTokenCount" >= 0),
    "outputTokenCount" INTEGER
        CHECK ("outputTokenCount" IS NULL OR "outputTokenCount" >= 0),
    "cachedTokenCount" INTEGER
        CHECK ("cachedTokenCount" IS NULL OR "cachedTokenCount" >= 0),
    "latencyMs" INTEGER
        CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0),
    "costMinorUnits" INTEGER
        CHECK ("costMinorUnits" IS NULL OR "costMinorUnits" >= 0),
    "costCurrency" TEXT
        CHECK ("costCurrency" IS NULL OR (length("costCurrency") = 3 AND "costCurrency" NOT GLOB '*[^A-Z]*')),
    -- The provider's own opaque request id. Never a URL, a payload or a key.
    "externalRequestRef" TEXT
        CHECK ("externalRequestRef" IS NULL OR (length("externalRequestRef") BETWEEN 1 AND 128 AND "externalRequestRef" NOT GLOB '*[ /?&@]*')),
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "failureCode" TEXT
        CHECK ("failureCode" IS NULL OR length("failureCode") BETWEEN 1 AND 64),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- A cost without a unit is not a cost. The two move together or not at all.
    CHECK (("costMinorUnits" IS NULL AND "costCurrency" IS NULL) OR ("costMinorUnits" IS NOT NULL AND "costCurrency" IS NOT NULL)),
    CONSTRAINT "ModelInvocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ModelInvocation_runId_attemptNumber_key" ON "ModelInvocation"("runId", "attemptNumber");

CREATE INDEX "ModelInvocation_runId_idx" ON "ModelInvocation"("runId");

CREATE INDEX "ModelInvocation_providerCode_modelCode_createdAt_idx" ON "ModelInvocation"("providerCode", "modelCode", "createdAt");

CREATE INDEX "ModelInvocation_status_createdAt_idx" ON "ModelInvocation"("status", "createdAt");
