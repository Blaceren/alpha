-- Phase 5B.1 additive report workflow schema foundation.
-- Runtime state transitions and immutable-row enforcement remain service boundaries.
CREATE UNIQUE INDEX "UserLevelProgress_id_enrollmentId_curriculumVersionId_levelDefinitionId_key"
ON "UserLevelProgress"("id", "enrollmentId", "curriculumVersionId", "levelDefinitionId");

CREATE TABLE "ReportAssignmentVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "changeNotes" TEXT,
    CONSTRAINT "ReportAssignmentVersion_lifecycle_check" CHECK (
        ("status" = 'draft' AND "publishedAt" IS NULL AND "archivedAt" IS NULL) OR
        ("status" = 'published' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NULL) OR
        ("status" = 'archived' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NOT NULL AND julianday("archivedAt") >= julianday("publishedAt"))
    ),
    CONSTRAINT "ReportAssignmentVersion_levelDefinition_fkey" FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition"("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportAssignmentVersion_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId")
        REFERENCES "CurriculumVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportAssignmentVersion_createdById_fkey" FOREIGN KEY ("createdById")
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportAssignmentVersion_id_levelDefinitionId_curriculumVersionId_key"
ON "ReportAssignmentVersion"("id", "levelDefinitionId", "curriculumVersionId");
CREATE UNIQUE INDEX "ReportAssignmentVersion_levelDefinitionId_versionNumber_key"
ON "ReportAssignmentVersion"("levelDefinitionId", "versionNumber");
CREATE UNIQUE INDEX "ReportAssignmentVersion_published_per_level_key"
ON "ReportAssignmentVersion"("levelDefinitionId") WHERE "status" = 'published';
CREATE INDEX "ReportAssignmentVersion_curriculumVersionId_status_idx"
ON "ReportAssignmentVersion"("curriculumVersionId", "status");
CREATE INDEX "ReportAssignmentVersion_createdById_idx" ON "ReportAssignmentVersion"("createdById");

CREATE TABLE "ReportAssignmentLocalization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportAssignmentVersionId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL CHECK (
        length("locale") BETWEEN 2 AND 35 AND "locale" NOT GLOB '*[^A-Za-z0-9-]*' AND
        "locale" NOT LIKE '-%' AND "locale" NOT LIKE '%-'
    ),
    "title" TEXT NOT NULL CHECK (length(trim("title")) > 0),
    "instructions" TEXT NOT NULL CHECK (length(trim("instructions")) > 0),
    "successCriteriaSummary" TEXT NOT NULL DEFAULT '',
    "submitLabel" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportAssignmentLocalization_assignment_fkey" FOREIGN KEY ("reportAssignmentVersionId")
        REFERENCES "ReportAssignmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportAssignmentLocalization_reportAssignmentVersionId_locale_key"
ON "ReportAssignmentLocalization"("reportAssignmentVersionId", "locale");

CREATE TABLE "ReportFieldDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportAssignmentVersionId" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL CHECK (length(trim("stableKey")) BETWEEN 1 AND 64),
    "type" TEXT NOT NULL CHECK ("type" IN ('short_text', 'long_text', 'url', 'integer', 'boolean', 'single_choice', 'multi_choice')),
    "required" BOOLEAN NOT NULL DEFAULT false CHECK ("required" IN (0, 1)),
    "sortOrder" INTEGER NOT NULL CHECK ("sortOrder" >= 0),
    "validationRules" JSONB CHECK ("validationRules" IS NULL OR json_valid("validationRules")),
    "choiceCodes" JSONB CHECK ("choiceCodes" IS NULL OR json_valid("choiceCodes")),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportFieldDefinition_assignment_fkey" FOREIGN KEY ("reportAssignmentVersionId")
        REFERENCES "ReportAssignmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportFieldDefinition_id_reportAssignmentVersionId_key"
ON "ReportFieldDefinition"("id", "reportAssignmentVersionId");
CREATE UNIQUE INDEX "ReportFieldDefinition_reportAssignmentVersionId_stableKey_key"
ON "ReportFieldDefinition"("reportAssignmentVersionId", "stableKey");
CREATE UNIQUE INDEX "ReportFieldDefinition_reportAssignmentVersionId_sortOrder_key"
ON "ReportFieldDefinition"("reportAssignmentVersionId", "sortOrder");

CREATE TABLE "ReportFieldLocalization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportFieldDefinitionId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL CHECK (
        length("locale") BETWEEN 2 AND 35 AND "locale" NOT GLOB '*[^A-Za-z0-9-]*' AND
        "locale" NOT LIKE '-%' AND "locale" NOT LIKE '%-'
    ),
    "label" TEXT NOT NULL CHECK (length(trim("label")) > 0),
    "helpText" TEXT NOT NULL DEFAULT '',
    "placeholder" TEXT NOT NULL DEFAULT '',
    "choiceLabels" JSONB CHECK ("choiceLabels" IS NULL OR json_valid("choiceLabels")),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportFieldLocalization_field_fkey" FOREIGN KEY ("reportFieldDefinitionId")
        REFERENCES "ReportFieldDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportFieldLocalization_reportFieldDefinitionId_locale_key"
ON "ReportFieldLocalization"("reportFieldDefinitionId", "locale");

CREATE TABLE "ReportRubricVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportAssignmentVersionId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "changeNotes" TEXT,
    CONSTRAINT "ReportRubricVersion_lifecycle_check" CHECK (
        ("status" = 'draft' AND "publishedAt" IS NULL AND "archivedAt" IS NULL) OR
        ("status" = 'published' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NULL) OR
        ("status" = 'archived' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NOT NULL AND julianday("archivedAt") >= julianday("publishedAt"))
    ),
    CONSTRAINT "ReportRubricVersion_assignment_fkey" FOREIGN KEY ("reportAssignmentVersionId")
        REFERENCES "ReportAssignmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportRubricVersion_createdById_fkey" FOREIGN KEY ("createdById")
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportRubricVersion_id_reportAssignmentVersionId_key"
ON "ReportRubricVersion"("id", "reportAssignmentVersionId");
CREATE UNIQUE INDEX "ReportRubricVersion_reportAssignmentVersionId_versionNumber_key"
ON "ReportRubricVersion"("reportAssignmentVersionId", "versionNumber");
CREATE UNIQUE INDEX "ReportRubricVersion_published_per_assignment_key"
ON "ReportRubricVersion"("reportAssignmentVersionId") WHERE "status" = 'published';
CREATE INDEX "ReportRubricVersion_status_idx" ON "ReportRubricVersion"("status");
CREATE INDEX "ReportRubricVersion_createdById_idx" ON "ReportRubricVersion"("createdById");

CREATE TABLE "LevelReportBinding" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "reportAssignmentVersionId" INTEGER NOT NULL,
    "reportRubricVersionId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LevelReportBinding_levelDefinition_fkey" FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition"("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelReportBinding_assignment_fkey" FOREIGN KEY ("reportAssignmentVersionId", "levelDefinitionId", "curriculumVersionId")
        REFERENCES "ReportAssignmentVersion"("id", "levelDefinitionId", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelReportBinding_rubric_fkey" FOREIGN KEY ("reportRubricVersionId", "reportAssignmentVersionId")
        REFERENCES "ReportRubricVersion"("id", "reportAssignmentVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelReportBinding_createdById_fkey" FOREIGN KEY ("createdById")
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LevelReportBinding_levelDefinitionId_key" ON "LevelReportBinding"("levelDefinitionId");
CREATE UNIQUE INDEX "LevelReportBinding_levelDefinitionId_curriculumVersionId_key"
ON "LevelReportBinding"("levelDefinitionId", "curriculumVersionId");
CREATE INDEX "LevelReportBinding_reportAssignmentVersionId_idx" ON "LevelReportBinding"("reportAssignmentVersionId");
CREATE INDEX "LevelReportBinding_reportRubricVersionId_idx" ON "LevelReportBinding"("reportRubricVersionId");
CREATE INDEX "LevelReportBinding_createdById_idx" ON "LevelReportBinding"("createdById");

CREATE TABLE "ReportRubricCriterion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportRubricVersionId" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL CHECK (length(trim("stableKey")) BETWEEN 1 AND 64),
    "categoryCode" TEXT NOT NULL CHECK (length(trim("categoryCode")) BETWEEN 1 AND 64),
    "sortOrder" INTEGER NOT NULL CHECK ("sortOrder" >= 0),
    "commentRequired" BOOLEAN NOT NULL DEFAULT false CHECK ("commentRequired" IN (0, 1)),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportRubricCriterion_rubric_fkey" FOREIGN KEY ("reportRubricVersionId")
        REFERENCES "ReportRubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportRubricCriterion_id_reportRubricVersionId_key"
ON "ReportRubricCriterion"("id", "reportRubricVersionId");
CREATE UNIQUE INDEX "ReportRubricCriterion_reportRubricVersionId_stableKey_key"
ON "ReportRubricCriterion"("reportRubricVersionId", "stableKey");
CREATE UNIQUE INDEX "ReportRubricCriterion_reportRubricVersionId_sortOrder_key"
ON "ReportRubricCriterion"("reportRubricVersionId", "sortOrder");

CREATE TABLE "ReportRubricCriterionLocalization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportRubricCriterionId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL CHECK (
        length("locale") BETWEEN 2 AND 35 AND "locale" NOT GLOB '*[^A-Za-z0-9-]*' AND
        "locale" NOT LIKE '-%' AND "locale" NOT LIKE '%-'
    ),
    "title" TEXT NOT NULL CHECK (length(trim("title")) > 0),
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportRubricCriterionLocalization_criterion_fkey" FOREIGN KEY ("reportRubricCriterionId")
        REFERENCES "ReportRubricCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportRubricCriterionLocalization_reportRubricCriterionId_locale_key"
ON "ReportRubricCriterionLocalization"("reportRubricCriterionId", "locale");

CREATE TABLE "ReportRubricScaleOption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportRubricVersionId" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL CHECK (length(trim("stableKey")) BETWEEN 1 AND 64),
    "ordinal" INTEGER NOT NULL CHECK ("ordinal" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportRubricScaleOption_rubric_fkey" FOREIGN KEY ("reportRubricVersionId")
        REFERENCES "ReportRubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportRubricScaleOption_id_reportRubricVersionId_key"
ON "ReportRubricScaleOption"("id", "reportRubricVersionId");
CREATE UNIQUE INDEX "ReportRubricScaleOption_reportRubricVersionId_stableKey_key"
ON "ReportRubricScaleOption"("reportRubricVersionId", "stableKey");
CREATE UNIQUE INDEX "ReportRubricScaleOption_reportRubricVersionId_ordinal_key"
ON "ReportRubricScaleOption"("reportRubricVersionId", "ordinal");

CREATE TABLE "ReportRubricScaleOptionLocalization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportRubricScaleOptionId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL CHECK (
        length("locale") BETWEEN 2 AND 35 AND "locale" NOT GLOB '*[^A-Za-z0-9-]*' AND
        "locale" NOT LIKE '-%' AND "locale" NOT LIKE '%-'
    ),
    "label" TEXT NOT NULL CHECK (length(trim("label")) > 0),
    "description" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ReportRubricScaleOptionLocalization_scaleOption_fkey" FOREIGN KEY ("reportRubricScaleOptionId")
        REFERENCES "ReportRubricScaleOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportRubricScaleOptionLocalization_reportRubricScaleOptionId_locale_key"
ON "ReportRubricScaleOptionLocalization"("reportRubricScaleOptionId", "locale");

CREATE TABLE "ReportRejectionReason" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportRubricVersionId" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL CHECK (length(trim("stableKey")) BETWEEN 1 AND 64),
    "sortOrder" INTEGER NOT NULL CHECK ("sortOrder" >= 0),
    "active" BOOLEAN NOT NULL DEFAULT true CHECK ("active" IN (0, 1)),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportRejectionReason_rubric_fkey" FOREIGN KEY ("reportRubricVersionId")
        REFERENCES "ReportRubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportRejectionReason_id_reportRubricVersionId_key"
ON "ReportRejectionReason"("id", "reportRubricVersionId");
CREATE UNIQUE INDEX "ReportRejectionReason_reportRubricVersionId_stableKey_key"
ON "ReportRejectionReason"("reportRubricVersionId", "stableKey");
CREATE UNIQUE INDEX "ReportRejectionReason_reportRubricVersionId_sortOrder_key"
ON "ReportRejectionReason"("reportRubricVersionId", "sortOrder");

CREATE TABLE "ReportRejectionReasonLocalization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportRejectionReasonId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL CHECK (
        length("locale") BETWEEN 2 AND 35 AND "locale" NOT GLOB '*[^A-Za-z0-9-]*' AND
        "locale" NOT LIKE '-%' AND "locale" NOT LIKE '%-'
    ),
    "title" TEXT NOT NULL CHECK (length(trim("title")) > 0),
    "guidance" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ReportRejectionReasonLocalization_reason_fkey" FOREIGN KEY ("reportRejectionReasonId")
        REFERENCES "ReportRejectionReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportRejectionReasonLocalization_reportRejectionReasonId_locale_key"
ON "ReportRejectionReasonLocalization"("reportRejectionReasonId", "locale");

CREATE TABLE "ReportSubmission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    "userLevelProgressId" INTEGER NOT NULL,
    "reportAssignmentVersionId" INTEGER NOT NULL,
    "reportRubricVersionId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'pending_review', 'approved', 'rejected')),
    "workflowVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("workflowVersion" >= 0),
    "activeRevisionId" INTEGER,
    "submittedRevisionId" INTEGER,
    "approvedRevisionId" INTEGER,
    "latestReviewId" INTEGER,
    "approvedReviewId" INTEGER,
    "claimedById" INTEGER,
    "claimVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("claimVersion" >= 0),
    "claimedAt" DATETIME,
    "claimExpiresAt" DATETIME,
    "reviewStartedAt" DATETIME,
    "firstSubmittedAt" DATETIME,
    "submittedAt" DATETIME,
    "reviewDueAt" DATETIME,
    "reviewedAt" DATETIME,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "slaExceededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportSubmission_claim_check" CHECK (
        (("claimedAt" IS NULL AND "claimExpiresAt" IS NULL AND "reviewStartedAt" IS NULL) OR
         ("claimedAt" IS NOT NULL AND "claimExpiresAt" IS NOT NULL AND
          julianday("claimExpiresAt") > julianday("claimedAt") AND
          ("reviewStartedAt" IS NULL OR julianday("reviewStartedAt") >= julianday("claimedAt")))) AND
        ("claimedById" IS NULL OR ("claimedAt" IS NOT NULL AND "claimExpiresAt" IS NOT NULL))
    ),
    CONSTRAINT "ReportSubmission_state_check" CHECK (
        ("status" = 'draft' AND "submittedRevisionId" IS NULL AND "submittedAt" IS NULL AND "approvedRevisionId" IS NULL AND "approvedReviewId" IS NULL AND "approvedAt" IS NULL AND "rejectedAt" IS NULL) OR
        ("status" = 'pending_review' AND "submittedRevisionId" IS NOT NULL AND "firstSubmittedAt" IS NOT NULL AND "submittedAt" IS NOT NULL AND "approvedRevisionId" IS NULL AND "approvedReviewId" IS NULL AND "approvedAt" IS NULL AND "rejectedAt" IS NULL) OR
        ("status" = 'approved' AND "submittedRevisionId" IS NOT NULL AND "approvedRevisionId" = "submittedRevisionId" AND "latestReviewId" IS NOT NULL AND "approvedReviewId" = "latestReviewId" AND "reviewedAt" IS NOT NULL AND "approvedAt" IS NOT NULL AND "rejectedAt" IS NULL) OR
        ("status" = 'rejected' AND "submittedRevisionId" IS NOT NULL AND "latestReviewId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "rejectedAt" IS NOT NULL AND "approvedRevisionId" IS NULL AND "approvedReviewId" IS NULL AND "approvedAt" IS NULL)
    ),
    CONSTRAINT "ReportSubmission_time_check" CHECK (
        ("firstSubmittedAt" IS NULL OR julianday("firstSubmittedAt") >= julianday("createdAt")) AND
        ("submittedAt" IS NULL OR ("firstSubmittedAt" IS NOT NULL AND julianday("submittedAt") >= julianday("firstSubmittedAt"))) AND
        ("reviewDueAt" IS NULL OR ("submittedAt" IS NOT NULL AND julianday("reviewDueAt") >= julianday("submittedAt"))) AND
        ("reviewedAt" IS NULL OR ("submittedAt" IS NOT NULL AND julianday("reviewedAt") >= julianday("submittedAt"))) AND
        ("approvedAt" IS NULL OR ("reviewedAt" IS NOT NULL AND julianday("approvedAt") >= julianday("reviewedAt"))) AND
        ("rejectedAt" IS NULL OR ("reviewedAt" IS NOT NULL AND julianday("rejectedAt") >= julianday("reviewedAt"))) AND
        ("slaExceededAt" IS NULL OR ("reviewDueAt" IS NOT NULL AND julianday("slaExceededAt") >= julianday("reviewDueAt")))
    ),
    CONSTRAINT "ReportSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_enrollment_fkey" FOREIGN KEY ("enrollmentId", "userId", "curriculumVersionId")
        REFERENCES "UserCurriculumEnrollment"("id", "userId", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_levelDefinition_fkey" FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition"("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_progress_fkey" FOREIGN KEY ("userLevelProgressId", "enrollmentId", "curriculumVersionId", "levelDefinitionId")
        REFERENCES "UserLevelProgress"("id", "enrollmentId", "curriculumVersionId", "levelDefinitionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_assignment_fkey" FOREIGN KEY ("reportAssignmentVersionId", "levelDefinitionId", "curriculumVersionId")
        REFERENCES "ReportAssignmentVersion"("id", "levelDefinitionId", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_rubric_fkey" FOREIGN KEY ("reportRubricVersionId", "reportAssignmentVersionId")
        REFERENCES "ReportRubricVersion"("id", "reportAssignmentVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_activeRevision_fkey" FOREIGN KEY ("activeRevisionId", "id") REFERENCES "ReportRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_submittedRevision_fkey" FOREIGN KEY ("submittedRevisionId", "id") REFERENCES "ReportRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_approvedRevision_fkey" FOREIGN KEY ("approvedRevisionId", "id") REFERENCES "ReportRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_latestReview_fkey" FOREIGN KEY ("latestReviewId", "id") REFERENCES "ReportReview"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSubmission_approvedReview_fkey" FOREIGN KEY ("approvedReviewId", "id") REFERENCES "ReportReview"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportSubmission_enrollmentId_levelDefinitionId_key" ON "ReportSubmission"("enrollmentId", "levelDefinitionId");
CREATE UNIQUE INDEX "ReportSubmission_id_userId_key" ON "ReportSubmission"("id", "userId");
CREATE UNIQUE INDEX "ReportSubmission_id_enrollmentId_curriculumVersionId_levelDefinitionId_key"
ON "ReportSubmission"("id", "enrollmentId", "curriculumVersionId", "levelDefinitionId");
CREATE UNIQUE INDEX "ReportSubmission_id_reportRubricVersionId_key" ON "ReportSubmission"("id", "reportRubricVersionId");
CREATE UNIQUE INDEX "ReportSubmission_submittedRevisionId_id_key" ON "ReportSubmission"("submittedRevisionId", "id");
CREATE UNIQUE INDEX "ReportSubmission_discriminators_key"
ON "ReportSubmission"("id", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId", "reportRubricVersionId");
CREATE INDEX "ReportSubmission_status_submittedAt_idx" ON "ReportSubmission"("status", "submittedAt");
CREATE INDEX "ReportSubmission_claimedById_status_idx" ON "ReportSubmission"("claimedById", "status");
CREATE INDEX "ReportSubmission_reviewDueAt_status_idx" ON "ReportSubmission"("reviewDueAt", "status");

CREATE TABLE "ReportRevision" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId" INTEGER NOT NULL,
    "revisionNumber" INTEGER NOT NULL CHECK ("revisionNumber" > 0),
    "kind" TEXT NOT NULL CHECK ("kind" IN ('draft_autosave', 'initial_submission', 'resubmission')),
    "sourceRevisionId" INTEGER,
    "content" JSONB NOT NULL CHECK (json_valid("content")),
    "contentFingerprint" TEXT NOT NULL CHECK (
        length("contentFingerprint") = 71 AND substr("contentFingerprint", 1, 7) = 'sha256:' AND
        substr("contentFingerprint", 8) NOT GLOB '*[^0-9a-f]*'
    ),
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    CONSTRAINT "ReportRevision_kind_check" CHECK (
        ("kind" = 'draft_autosave' AND "submittedAt" IS NULL) OR
        ("kind" IN ('initial_submission', 'resubmission') AND "submittedAt" IS NOT NULL AND "sourceRevisionId" IS NOT NULL AND julianday("submittedAt") >= julianday("createdAt"))
    ),
    CONSTRAINT "ReportRevision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ReportSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportRevision_sourceRevision_fkey" FOREIGN KEY ("sourceRevisionId", "submissionId") REFERENCES "ReportRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportRevision_id_submissionId_key" ON "ReportRevision"("id", "submissionId");
CREATE UNIQUE INDEX "ReportRevision_submissionId_revisionNumber_key" ON "ReportRevision"("submissionId", "revisionNumber");
CREATE INDEX "ReportRevision_submissionId_createdAt_idx" ON "ReportRevision"("submissionId", "createdAt");

CREATE TABLE "ReportReview" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId" INTEGER NOT NULL,
    "revisionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    "reportAssignmentVersionId" INTEGER NOT NULL,
    "reportRubricVersionId" INTEGER NOT NULL,
    "reviewerId" INTEGER,
    "reviewerRoleSnapshot" TEXT NOT NULL CHECK ("reviewerRoleSnapshot" IN ('user', 'admin', 'support', 'mentor', 'moderator', 'news_editor')),
    "decision" TEXT NOT NULL CHECK ("decision" IN ('approved', 'rejected')),
    "humanComment" TEXT,
    "correctiveAction" TEXT,
    "rejectionReasonId" INTEGER,
    "requestId" TEXT NOT NULL CHECK (length("requestId") BETWEEN 8 AND 128),
    "payloadFingerprint" TEXT NOT NULL CHECK (
        length("payloadFingerprint") = 71 AND substr("payloadFingerprint", 1, 7) = 'sha256:' AND
        substr("payloadFingerprint", 8) NOT GLOB '*[^0-9a-f]*'
    ),
    "claimedAt" DATETIME,
    "claimExpiresAt" DATETIME,
    "reviewStartedAt" DATETIME,
    "reviewedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportReview_decision_check" CHECK (
        ("decision" = 'approved' AND "rejectionReasonId" IS NULL AND "correctiveAction" IS NULL) OR
        ("decision" = 'rejected' AND "rejectionReasonId" IS NOT NULL AND
         "humanComment" IS NOT NULL AND length(trim("humanComment")) > 0 AND
         "correctiveAction" IS NOT NULL AND length(trim("correctiveAction")) > 0)
    ),
    CONSTRAINT "ReportReview_claim_check" CHECK (
        ("claimedAt" IS NULL AND "claimExpiresAt" IS NULL AND "reviewStartedAt" IS NULL) OR
        ("claimedAt" IS NOT NULL AND "claimExpiresAt" IS NOT NULL AND julianday("claimExpiresAt") > julianday("claimedAt") AND
         ("reviewStartedAt" IS NULL OR julianday("reviewStartedAt") >= julianday("claimedAt")))
    ),
    CONSTRAINT "ReportReview_time_check" CHECK (julianday("reviewedAt") >= julianday("createdAt")),
    CONSTRAINT "ReportReview_submission_fkey" FOREIGN KEY ("submissionId", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId", "reportRubricVersionId")
        REFERENCES "ReportSubmission"("id", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId", "reportRubricVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReview_revision_fkey" FOREIGN KEY ("revisionId", "submissionId") REFERENCES "ReportRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReview_submittedRevision_fkey" FOREIGN KEY ("revisionId", "submissionId") REFERENCES "ReportSubmission"("submittedRevisionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReview_rubric_fkey" FOREIGN KEY ("reportRubricVersionId", "reportAssignmentVersionId") REFERENCES "ReportRubricVersion"("id", "reportAssignmentVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReportReview_reason_fkey" FOREIGN KEY ("rejectionReasonId", "reportRubricVersionId") REFERENCES "ReportRejectionReason"("id", "reportRubricVersionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportReview_revisionId_key" ON "ReportReview"("revisionId");
CREATE UNIQUE INDEX "ReportReview_reviewerId_requestId_key" ON "ReportReview"("reviewerId", "requestId");
CREATE UNIQUE INDEX "ReportReview_id_submissionId_key" ON "ReportReview"("id", "submissionId");
CREATE UNIQUE INDEX "ReportReview_id_reportRubricVersionId_key" ON "ReportReview"("id", "reportRubricVersionId");
CREATE INDEX "ReportReview_submissionId_reviewedAt_idx" ON "ReportReview"("submissionId", "reviewedAt");

CREATE TABLE "ReportReviewScore" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportReviewId" INTEGER NOT NULL,
    "reportRubricVersionId" INTEGER NOT NULL,
    "rubricCriterionId" INTEGER NOT NULL,
    "rubricScaleOptionId" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportReviewScore_review_fkey" FOREIGN KEY ("reportReviewId", "reportRubricVersionId") REFERENCES "ReportReview"("id", "reportRubricVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReviewScore_criterion_fkey" FOREIGN KEY ("rubricCriterionId", "reportRubricVersionId") REFERENCES "ReportRubricCriterion"("id", "reportRubricVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReviewScore_scaleOption_fkey" FOREIGN KEY ("rubricScaleOptionId", "reportRubricVersionId") REFERENCES "ReportRubricScaleOption"("id", "reportRubricVersionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportReviewScore_reportReviewId_rubricCriterionId_key"
ON "ReportReviewScore"("reportReviewId", "rubricCriterionId");

CREATE TABLE "ReportAttachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId" INTEGER NOT NULL,
    "revisionId" INTEGER NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL CHECK (length(trim("storageKey")) BETWEEN 1 AND 512),
    "originalName" TEXT NOT NULL CHECK (length(trim("originalName")) BETWEEN 1 AND 255),
    "mimeType" TEXT NOT NULL CHECK (length(trim("mimeType")) BETWEEN 1 AND 255),
    "sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes" > 0),
    "checksum" TEXT CHECK (
        "checksum" IS NULL OR (length("checksum") = 71 AND substr("checksum", 1, 7) = 'sha256:' AND substr("checksum", 8) NOT GLOB '*[^0-9a-f]*')
    ),
    "status" TEXT NOT NULL DEFAULT 'initiated' CHECK ("status" IN ('initiated', 'uploaded', 'quarantined', 'available', 'rejected', 'deleted')),
    "scanProvider" TEXT,
    "scanReference" TEXT,
    "scanCompletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" DATETIME,
    "deletedAt" DATETIME,
    CONSTRAINT "ReportAttachment_state_check" CHECK (
        ("status" IN ('initiated', 'uploaded', 'quarantined', 'rejected') AND "availableAt" IS NULL AND "deletedAt" IS NULL) OR
        ("status" = 'available' AND "availableAt" IS NOT NULL AND "deletedAt" IS NULL) OR
        ("status" = 'deleted' AND "deletedAt" IS NOT NULL)
    ),
    CONSTRAINT "ReportAttachment_scan_check" CHECK (
        "scanCompletedAt" IS NULL OR ("scanProvider" IS NOT NULL AND length(trim("scanProvider")) > 0 AND "scanReference" IS NOT NULL AND length(trim("scanReference")) > 0)
    ),
    CONSTRAINT "ReportAttachment_submission_fkey" FOREIGN KEY ("submissionId", "ownerUserId") REFERENCES "ReportSubmission"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportAttachment_revision_fkey" FOREIGN KEY ("revisionId", "submissionId") REFERENCES "ReportRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportAttachment_owner_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportAttachment_storageKey_key" ON "ReportAttachment"("storageKey");
CREATE UNIQUE INDEX "ReportAttachment_id_revisionId_submissionId_key" ON "ReportAttachment"("id", "revisionId", "submissionId");
CREATE INDEX "ReportAttachment_revisionId_status_idx" ON "ReportAttachment"("revisionId", "status");
CREATE INDEX "ReportAttachment_ownerUserId_createdAt_idx" ON "ReportAttachment"("ownerUserId", "createdAt");

CREATE TABLE "ReportCommandReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actorUserId" INTEGER NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "commandType" TEXT NOT NULL CHECK ("commandType" IN ('save_draft', 'submit', 'resubmit', 'claim', 'start_review', 'reassign', 'approve', 'reject', 'attachment_initiate', 'attachment_finalize')),
    "requestId" TEXT NOT NULL CHECK (length("requestId") BETWEEN 8 AND 128),
    "payloadFingerprint" TEXT NOT NULL CHECK (
        length("payloadFingerprint") = 71 AND substr("payloadFingerprint", 1, 7) = 'sha256:' AND
        substr("payloadFingerprint", 8) NOT GLOB '*[^0-9a-f]*'
    ),
    "targetRevisionId" INTEGER,
    "resultRevisionId" INTEGER,
    "resultingWorkflowVersion" INTEGER NOT NULL CHECK ("resultingWorkflowVersion" >= 0),
    "safeResult" JSONB NOT NULL CHECK (json_valid("safeResult")),
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportCommandReceipt_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportCommandReceipt_submission_fkey" FOREIGN KEY ("submissionId") REFERENCES "ReportSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportCommandReceipt_targetRevision_fkey" FOREIGN KEY ("targetRevisionId", "submissionId") REFERENCES "ReportRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportCommandReceipt_resultRevision_fkey" FOREIGN KEY ("resultRevisionId", "submissionId") REFERENCES "ReportRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportCommandReceipt_actorUserId_requestId_key" ON "ReportCommandReceipt"("actorUserId", "requestId");
CREATE INDEX "ReportCommandReceipt_submissionId_appliedAt_idx" ON "ReportCommandReceipt"("submissionId", "appliedAt");
