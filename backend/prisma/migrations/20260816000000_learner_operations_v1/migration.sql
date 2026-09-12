-- ===========================================================================
-- MIGRATION 51 -- LEARNER-OPERATIONS-V1
--
-- PRISMA SPLITS THIS FILE ON THE SEMICOLON CHARACTER, so NO COMMENT IN THIS
-- FILE CONTAINS ONE, and every statement is a single complete statement
-- terminated by exactly one semicolon.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
--
-- It creates TWELVE new tables, all of them empty except the three that are
-- pure CONFIGURATION, and it adds no column to and rebuilds no existing table.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO, AND WHY THAT IS THE POINT
--
-- IT TOUCHES NO EXISTING TABLE. Not one ALTER, not one rebuild, not one index
-- rename anywhere outside the LearnerOps namespace. This is deliberate and it
-- was measured. `prisma migrate diff` against this schema proposes rebuilding
-- User, GrowthEvent, PocketProviderEvent, ProviderIngressEvent, ChatMessage,
-- four Agent tables and two VideoProduction tables, and proposes renaming nine
-- hand-written indexes. NONE of that is caused by Learner Operations. It is
-- pre-existing drift between this repository's hand-written migration history
-- and Prisma's default naming, and following the generator would have silently
-- DROPPED the CHECK constraints that the growth, provider and financial
-- migrations added by hand -- constraints that Prisma's datamodel cannot see
-- and therefore cannot reproduce. This file is written by hand for exactly that
-- reason, which is also why this repository has always written them by hand.
--
-- IT REWRITES NO PROGRESSION TRUTH. No statement below reads or writes
-- UserLevelProgress, UserCurriculumEnrollment, XPTransaction, ReportSubmission,
-- ReportReview, LevelDefinition or CurriculumVersion. Learner Operations
-- REFERENCES those objects and never owns them.
--
-- IT REWRITES NO COMMERCIAL OR EXTERNAL TRUTH. Nothing here touches
-- GrowthEvent, PocketProviderEvent, ProviderIngressEvent, AffiliateConversion,
-- AffiliateCommission, ExchangeAccount or Checkpoint. The Affiliate Platform is
-- closed and this migration leaves it byte-identical.
--
-- IT CREATES NO OPERATIONAL HISTORY. Not one case, not one message, not one
-- note, not one escalation. There is no backfill of the superseded
-- SupportDialog, which is empty in PREPROD anyway -- and would not be
-- backfilled if it were not, because inventing a case history for conversations
-- that were never operated is indistinguishable from a bug that did the same.
--
-- ---------------------------------------------------------------------------
-- WHY THE THREE CONFIGURATION TABLES ARE SEEDED HERE AND THE OTHER NINE ARE NOT
--
-- Queues, SLA policies and reason codes are CONFIGURATION -- the vocabulary the
-- product needs before it can accept its first case. They carry no business or
-- financial truth, their identifiers are fixed literals rather than generated
-- values so a re-run reaches the same state, and a deployment without them
-- would present an operator with an empty dropdown rather than a working queue.
--
-- THE SLA NUMBERS ARE FIXTURES AND THE SCHEMA SAYS SO. The product owner has
-- supplied no business SLA durations. Every seeded policy is therefore stamped
-- `origin = preprod_acceptance_fixture`, the CRM renders that provenance beside
-- the number, and the column exists precisely so that a real policy can later be
-- told apart from an acceptance fixture by the database rather than by memory.
-- A fixture presented as business policy would be an invented business rule.
--
-- ---------------------------------------------------------------------------
-- THE CHECK CONSTRAINTS, 48 OF THEM, AND WHAT THEY BUY
--
-- Prisma stores an enum as TEXT on SQLite with no constraint, so a raw-SQL
-- writer could store any string at all. The domain CHECKs close that. The
-- structural CHECKs close something more important:
--
--   * a case's TYPE fixes which canonical anchor it may hold, so a support
--     request cannot acquire a mentor-review anchor and a report-review case
--     cannot exist without naming the report it is about,
--   * a learner-visible message has EXACTLY ONE author and the staff and
--     learner axes are mutually exclusive, so an unattributed or
--     double-attributed message cannot be stored,
--   * resolvedAt implies a resolved-or-closed status, closedAt implies closed,
--     and reopenedAt and reopenCount must agree -- so the timeline cannot
--     contradict the status even if application validation is bypassed,
--   * the SLA clock can only be paused in a waiting state.
--
-- These are enforced by the database because a rule enforced only in the
-- application is a rule that holds until the first script, the first console
-- session or the first future migration.
-- ---------------------------------------------------------------------------
-- CreateTable
CREATE TABLE "LearnerOpsQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK (length(trim("key")) > 0),
    CHECK (length(trim("name")) > 0)
);

-- CreateTable
CREATE TABLE "LearnerOpsSlaPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "firstResponseTargetMinutes" INTEGER,
    "resolutionTargetMinutes" INTEGER,
    "pausesOnWaitingLearner" BOOLEAN NOT NULL DEFAULT true,
    "pausesOnWaitingInternal" BOOLEAN NOT NULL DEFAULT false,
    "pausesOnWaitingExternal" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK ("priority" IN ('urgent', 'high', 'normal', 'low')),
    CHECK ("origin" IN ('preprod_acceptance_fixture', 'product_owner_supplied')),
    CHECK (("firstResponseTargetMinutes" IS NULL) OR ("firstResponseTargetMinutes" > 0)),
    CHECK (("resolutionTargetMinutes" IS NULL) OR ("resolutionTargetMinutes" > 0))
);

-- CreateTable
CREATE TABLE "LearnerOpsReasonCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK (length(trim("code")) > 0),
    CHECK (length(trim("category")) > 0)
);

-- CreateTable
CREATE TABLE "LearnerOpsCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "queueId" TEXT NOT NULL,
    "assignedStaffId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "assignmentVersion" INTEGER NOT NULL DEFAULT 0,
    "reasonCodeId" TEXT,
    "subject" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "supportDialogId" INTEGER,
    "reportSubmissionId" INTEGER,
    "userLevelProgressId" INTEGER,
    "slaPolicyId" TEXT,
    "firstResponseDueAt" DATETIME,
    "resolutionDueAt" DATETIME,
    "firstRespondedAt" DATETIME,
    "clockPausedAt" DATETIME,
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "closedAt" DATETIME,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "reopenedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearnerOpsCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCase_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "LearnerOpsQueue" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCase_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCase_reasonCodeId_fkey" FOREIGN KEY ("reasonCodeId") REFERENCES "LearnerOpsReasonCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCase_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "LearnerOpsSlaPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCase_supportDialogId_fkey" FOREIGN KEY ("supportDialogId") REFERENCES "SupportDialog" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCase_reportSubmissionId_fkey" FOREIGN KEY ("reportSubmissionId") REFERENCES "ReportSubmission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCase_userLevelProgressId_fkey" FOREIGN KEY ("userLevelProgressId") REFERENCES "UserLevelProgress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("type" IN ('support_request', 'report_review', 'mentor_review', 'educational_escalation', 'complaint', 'service_recovery', 'operational_followup')),
    CHECK ("status" IN ('new', 'open', 'in_progress', 'waiting_learner', 'waiting_internal', 'waiting_external', 'escalated', 'resolved', 'closed')),
    CHECK ("priority" IN ('urgent', 'high', 'normal', 'low')),
    CHECK ("version" >= 1),
    CHECK ("assignmentVersion" >= 0),
    CHECK ("pausedMs" >= 0),
    CHECK ("reopenCount" >= 0),
    CHECK (length(trim("subject")) > 0),
    CHECK (("reportSubmissionId" IS NULL) OR ("type" = 'report_review')),
    CHECK (("userLevelProgressId" IS NULL) OR ("type" = 'mentor_review')),
    CHECK (("supportDialogId" IS NULL) OR ("type" = 'support_request')),
    CHECK (("type" <> 'report_review') OR ("reportSubmissionId" IS NOT NULL)),
    CHECK (("type" <> 'mentor_review') OR ("userLevelProgressId" IS NOT NULL)),
    CHECK (("resolvedAt" IS NULL) OR ("status" IN ('resolved', 'closed'))),
    CHECK (("closedAt" IS NULL) OR ("status" = 'closed')),
    CHECK ((("reopenedAt" IS NULL) AND ("reopenCount" = 0)) OR (("reopenedAt" IS NOT NULL) AND ("reopenCount" > 0))),
    CHECK (("clockPausedAt" IS NULL) OR ("status" IN ('waiting_learner', 'waiting_internal', 'waiting_external')))
);

-- CreateTable
CREATE TABLE "LearnerOpsCaseEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "previousStatus" TEXT,
    "nextStatus" TEXT,
    "previousAssignedStaffId" TEXT,
    "nextAssignedStaffId" TEXT,
    "previousPriority" TEXT,
    "nextPriority" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnerOpsCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LearnerOpsCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCaseEvent_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCaseEvent_previousAssignedStaffId_fkey" FOREIGN KEY ("previousAssignedStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsCaseEvent_nextAssignedStaffId_fkey" FOREIGN KEY ("nextAssignedStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("caseVersion" >= 1),
    CHECK ("eventType" IN ('created', 'status_changed', 'assigned', 'reassigned', 'unassigned', 'priority_changed', 'reason_code_changed', 'message_sent', 'note_added', 'escalated', 'escalation_resolved', 'first_response_recorded', 'resolved', 'closed', 'reopened', 'qa_reviewed', 'canonical_decision_mirrored')),
    CHECK (("eventType" <> 'status_changed') OR (("previousStatus" IS NOT NULL) AND ("nextStatus" IS NOT NULL) AND ("previousStatus" <> "nextStatus"))),
    CHECK (("eventType" <> 'priority_changed') OR (("previousPriority" IS NOT NULL) AND ("nextPriority" IS NOT NULL) AND ("previousPriority" <> "nextPriority")))
);

-- CreateTable
CREATE TABLE "LearnerOpsMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "authorStaffId" TEXT,
    "authorUserId" INTEGER,
    "body" TEXT NOT NULL,
    "readByLearnerAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnerOpsMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LearnerOpsCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsMessage_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("authorKind" IN ('staff', 'learner')),
    CHECK ((("authorKind" = 'staff') AND ("authorStaffId" IS NOT NULL) AND ("authorUserId" IS NULL)) OR (("authorKind" = 'learner') AND ("authorUserId" IS NOT NULL) AND ("authorStaffId" IS NULL))),
    CHECK (length(trim("body")) > 0)
);

-- CreateTable
CREATE TABLE "LearnerOpsNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "authorStaffId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnerOpsNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LearnerOpsCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsNote_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (length(trim("body")) > 0)
);

-- CreateTable
CREATE TABLE "LearnerOpsEscalation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "raisedByStaffId" TEXT NOT NULL,
    "targetQueueId" TEXT,
    "targetStaffId" TEXT,
    "reason" TEXT NOT NULL,
    "raisedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolution" TEXT,
    "resolvedByStaffId" TEXT,
    "returnedToOwnerAt" DATETIME,
    CONSTRAINT "LearnerOpsEscalation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LearnerOpsCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsEscalation_raisedByStaffId_fkey" FOREIGN KEY ("raisedByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsEscalation_targetQueueId_fkey" FOREIGN KEY ("targetQueueId") REFERENCES "LearnerOpsQueue" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsEscalation_targetStaffId_fkey" FOREIGN KEY ("targetStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsEscalation_resolvedByStaffId_fkey" FOREIGN KEY ("resolvedByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("class" IN ('educational_methodology', 'technical_product', 'external_provider', 'security_abuse', 'operational_lead')),
    CHECK (length(trim("reason")) > 0),
    CHECK (("targetQueueId" IS NOT NULL) OR ("targetStaffId" IS NOT NULL)),
    CHECK (("resolvedAt" IS NULL) OR ("resolution" IS NOT NULL)),
    CHECK (("resolvedByStaffId" IS NULL) OR ("resolvedAt" IS NOT NULL)),
    CHECK (("returnedToOwnerAt" IS NULL) OR ("resolvedAt" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "LearnerOpsQaReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "reviewerStaffId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "dimensions" JSONB,
    "feedback" TEXT,
    "coachingRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnerOpsQaReview_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LearnerOpsCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsQaReview_reviewerStaffId_fkey" FOREIGN KEY ("reviewerStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("result" IN ('meets', 'needs_improvement', 'does_not_meet'))
);

-- CreateTable
CREATE TABLE "LearnerOpsKnowledgeArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "ownerStaffId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearnerOpsKnowledgeArticle_ownerStaffId_fkey" FOREIGN KEY ("ownerStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("status" IN ('draft', 'published', 'archived')),
    CHECK ("version" >= 1),
    CHECK (length(trim("slug")) > 0),
    CHECK (length(trim("title")) > 0)
);

-- CreateTable
CREATE TABLE "LearnerOpsVocSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "theme" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "ownerStaffId" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "resolutionReference" TEXT,
    "resolutionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    CONSTRAINT "LearnerOpsVocSignal_ownerStaffId_fkey" FOREIGN KEY ("ownerStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsVocSignal_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("severity" IN ('critical', 'high', 'medium', 'low')),
    CHECK ("status" IN ('open', 'under_review', 'accepted', 'rejected', 'resolved')),
    CHECK (length(trim("theme")) > 0),
    CHECK (("resolvedAt" IS NULL) OR ("status" IN ('resolved', 'rejected')))
);

-- CreateTable
CREATE TABLE "LearnerOpsVocSignalCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "linkedByStaffId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnerOpsVocSignalCase_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "LearnerOpsVocSignal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsVocSignalCase_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LearnerOpsCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearnerOpsVocSignalCase_linkedByStaffId_fkey" FOREIGN KEY ("linkedByStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LearnerOpsQueue_key_key" ON "LearnerOpsQueue"("key");

-- CreateIndex
CREATE INDEX "LearnerOpsQueue_isActive_key_idx" ON "LearnerOpsQueue"("isActive", "key");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerOpsSlaPolicy_key_key" ON "LearnerOpsSlaPolicy"("key");

-- CreateIndex
CREATE INDEX "LearnerOpsSlaPolicy_isActive_idx" ON "LearnerOpsSlaPolicy"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerOpsSlaPolicy_priority_isActive_key_key" ON "LearnerOpsSlaPolicy"("priority", "isActive", "key");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerOpsReasonCode_code_key" ON "LearnerOpsReasonCode"("code");

-- CreateIndex
CREATE INDEX "LearnerOpsReasonCode_category_isActive_idx" ON "LearnerOpsReasonCode"("category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerOpsCase_reference_key" ON "LearnerOpsCase"("reference");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_queueId_status_priority_lastActivityAt_idx" ON "LearnerOpsCase"("queueId", "status", "priority", "lastActivityAt");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_assignedStaffId_status_lastActivityAt_idx" ON "LearnerOpsCase"("assignedStaffId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_status_assignedStaffId_openedAt_idx" ON "LearnerOpsCase"("status", "assignedStaffId", "openedAt");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_userId_openedAt_idx" ON "LearnerOpsCase"("userId", "openedAt");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_type_status_openedAt_idx" ON "LearnerOpsCase"("type", "status", "openedAt");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_status_firstResponseDueAt_idx" ON "LearnerOpsCase"("status", "firstResponseDueAt");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_status_resolutionDueAt_idx" ON "LearnerOpsCase"("status", "resolutionDueAt");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_reportSubmissionId_idx" ON "LearnerOpsCase"("reportSubmissionId");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_userLevelProgressId_idx" ON "LearnerOpsCase"("userLevelProgressId");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_supportDialogId_idx" ON "LearnerOpsCase"("supportDialogId");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_reasonCodeId_idx" ON "LearnerOpsCase"("reasonCodeId");

-- CreateIndex
CREATE INDEX "LearnerOpsCase_slaPolicyId_idx" ON "LearnerOpsCase"("slaPolicyId");

-- CreateIndex
CREATE INDEX "LearnerOpsCaseEvent_caseId_createdAt_idx" ON "LearnerOpsCaseEvent"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "LearnerOpsCaseEvent_actorStaffId_idx" ON "LearnerOpsCaseEvent"("actorStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsCaseEvent_previousAssignedStaffId_idx" ON "LearnerOpsCaseEvent"("previousAssignedStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsCaseEvent_nextAssignedStaffId_idx" ON "LearnerOpsCaseEvent"("nextAssignedStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsCaseEvent_eventType_createdAt_idx" ON "LearnerOpsCaseEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerOpsCaseEvent_caseId_caseVersion_key" ON "LearnerOpsCaseEvent"("caseId", "caseVersion");

-- CreateIndex
CREATE INDEX "LearnerOpsMessage_caseId_createdAt_idx" ON "LearnerOpsMessage"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "LearnerOpsMessage_authorStaffId_idx" ON "LearnerOpsMessage"("authorStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsMessage_authorUserId_idx" ON "LearnerOpsMessage"("authorUserId");

-- CreateIndex
CREATE INDEX "LearnerOpsNote_caseId_createdAt_idx" ON "LearnerOpsNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "LearnerOpsNote_authorStaffId_idx" ON "LearnerOpsNote"("authorStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsEscalation_caseId_raisedAt_idx" ON "LearnerOpsEscalation"("caseId", "raisedAt");

-- CreateIndex
CREATE INDEX "LearnerOpsEscalation_class_resolvedAt_idx" ON "LearnerOpsEscalation"("class", "resolvedAt");

-- CreateIndex
CREATE INDEX "LearnerOpsEscalation_targetQueueId_resolvedAt_idx" ON "LearnerOpsEscalation"("targetQueueId", "resolvedAt");

-- CreateIndex
CREATE INDEX "LearnerOpsEscalation_raisedByStaffId_idx" ON "LearnerOpsEscalation"("raisedByStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsEscalation_targetStaffId_idx" ON "LearnerOpsEscalation"("targetStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsEscalation_resolvedByStaffId_idx" ON "LearnerOpsEscalation"("resolvedByStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsQaReview_caseId_createdAt_idx" ON "LearnerOpsQaReview"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "LearnerOpsQaReview_reviewerStaffId_createdAt_idx" ON "LearnerOpsQaReview"("reviewerStaffId", "createdAt");

-- CreateIndex
CREATE INDEX "LearnerOpsQaReview_result_createdAt_idx" ON "LearnerOpsQaReview"("result", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerOpsKnowledgeArticle_slug_key" ON "LearnerOpsKnowledgeArticle"("slug");

-- CreateIndex
CREATE INDEX "LearnerOpsKnowledgeArticle_status_updatedAt_idx" ON "LearnerOpsKnowledgeArticle"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "LearnerOpsKnowledgeArticle_ownerStaffId_idx" ON "LearnerOpsKnowledgeArticle"("ownerStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsVocSignal_status_severity_updatedAt_idx" ON "LearnerOpsVocSignal"("status", "severity", "updatedAt");

-- CreateIndex
CREATE INDEX "LearnerOpsVocSignal_category_status_idx" ON "LearnerOpsVocSignal"("category", "status");

-- CreateIndex
CREATE INDEX "LearnerOpsVocSignal_ownerStaffId_idx" ON "LearnerOpsVocSignal"("ownerStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsVocSignal_createdByStaffId_idx" ON "LearnerOpsVocSignal"("createdByStaffId");

-- CreateIndex
CREATE INDEX "LearnerOpsVocSignalCase_caseId_idx" ON "LearnerOpsVocSignalCase"("caseId");

-- CreateIndex
CREATE INDEX "LearnerOpsVocSignalCase_linkedByStaffId_idx" ON "LearnerOpsVocSignalCase"("linkedByStaffId");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerOpsVocSignalCase_signalId_caseId_key" ON "LearnerOpsVocSignalCase"("signalId", "caseId");

-- ===========================================================================
-- CONFIGURATION SEED -- fixed literal identifiers, no generated values.
-- ===========================================================================
--
-- FOUR QUEUES, derived from the operating model rather than from the list of
-- case types. Report review and mentor review are ONE review queue in the
-- product sense but two queues here because their eligible reviewers and their
-- canonical owners differ. Escalation is its own queue because an escalation
-- must be findable by the party it was escalated TO.

INSERT INTO "LearnerOpsQueue" ("id", "key", "name", "description", "isActive", "createdAt", "updatedAt") VALUES
 ('loq_support', 'support', 'Поддержка', 'Обращения учеников, вопросы по продукту и доступу', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('loq_report_review', 'report_review', 'Проверка отчётов', 'Операционная очередь по каноническим отчётам учеников', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('loq_mentor_review', 'mentor_review', 'Проверка практики', 'Операционная очередь по каноническим менторским проверкам', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('loq_escalation', 'escalation', 'Эскалации', 'Методические, технические и внешние эскалации', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- FOUR SLA POLICIES, one per priority. Every one is an ACCEPTANCE FIXTURE.
--
-- The numbers below were chosen to be operable and testable in PREPROD, NOT to
-- describe a business commitment nobody made. `origin` says so in the database,
-- the API returns it, and the CRM prints it next to the target. When the
-- product owner supplies real targets, those rows arrive with
-- `origin = product_owner_supplied` and these become inactive.
--
-- The pause flags encode the one thing that is NOT arbitrary: waiting on a
-- LEARNER is not our delay and pauses the resolution clock, waiting on an
-- INTERNAL decision is our delay and does not, and waiting on an EXTERNAL
-- provider pauses because the provider's response time is not ours to promise.

INSERT INTO "LearnerOpsSlaPolicy" ("id", "key", "name", "priority", "firstResponseTargetMinutes", "resolutionTargetMinutes", "pausesOnWaitingLearner", "pausesOnWaitingInternal", "pausesOnWaitingExternal", "origin", "isActive", "createdAt", "updatedAt") VALUES
 ('losla_urgent', 'preprod_fixture_urgent', 'PREPROD fixture — срочный', 'urgent', 30, 240, 1, 0, 1, 'preprod_acceptance_fixture', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('losla_high', 'preprod_fixture_high', 'PREPROD fixture — высокий', 'high', 120, 960, 1, 0, 1, 'preprod_acceptance_fixture', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('losla_normal', 'preprod_fixture_normal', 'PREPROD fixture — обычный', 'normal', 480, 2880, 1, 0, 1, 'preprod_acceptance_fixture', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('losla_low', 'preprod_fixture_low', 'PREPROD fixture — низкий', 'low', 1440, 7200, 1, 0, 1, 'preprod_acceptance_fixture', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- THIRTEEN REASON CODES. A deliberately small V1 vocabulary with clear config
-- ownership, not an exhaustive taxonomy invented up front. Free-text context is
-- preserved on the case ALONGSIDE the code, never replaced by it.

INSERT INTO "LearnerOpsReasonCode" ("id", "code", "category", "label", "isActive", "createdAt", "updatedAt") VALUES
 ('lorc_product_technical', 'product_technical', 'product', 'Техническая проблема продукта', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_lesson_content', 'lesson_content', 'content', 'Вопрос по уроку или материалу', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_assessment', 'assessment', 'education', 'Вопрос по тесту или оценке', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_report_review', 'report_review', 'education', 'Вопрос по отчёту или его проверке', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_mentor', 'mentor', 'education', 'Вопрос к наставнику', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_progression_blocker', 'progression_blocker', 'education', 'Блокер прохождения программы', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_account_access', 'account_access', 'account', 'Доступ к аккаунту', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_pocket_external', 'pocket_external', 'external', 'Вопрос по внешнему провайдеру (Pocket)', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_deposit_financial', 'deposit_financial', 'external', 'Вопрос по депозиту или финансовому событию', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_complaint', 'complaint', 'complaint', 'Жалоба', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_service_recovery', 'service_recovery', 'complaint', 'Восстановление сервиса', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_followup', 'followup', 'operations', 'Операционное сопровождение', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('lorc_other', 'other', 'operations', 'Другое', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
