-- Phase 5B.6: pin report reviews to their immutable reviewed revision.
--
-- Documented schema insufficiency that this corrective rebuild fixes: the
-- Phase 5B.1 SQL-only constraint "ReportReview_submittedRevision_fkey"
-- declared FOREIGN KEY (revisionId, submissionId) REFERENCES
-- ReportSubmission(submittedRevisionId, id) ON UPDATE CASCADE. The approved
-- state machine allows rejected -> correction draft -> resubmission, and the
-- resubmit command must advance ReportSubmission.submittedRevisionId. That
-- cascade then silently rebound every historical review row to the brand-new
-- submitted revision, corrupting the immutable review history that design
-- section 36.2 guarantees, and making the approved rejected -> resubmitted ->
-- approved transition impossible because the one-review-per-revision unique
-- index collides with the rebound rejected review. Any retained form of the
-- constraint (RESTRICT or NO ACTION) would instead block resubmission while a
-- historical review exists, so the constraint itself contradicts the approved
-- workflow and must be removed.
--
-- SQLite cannot drop a single foreign key, so the table is recreated without
-- that one constraint while every other column, CHECK, foreign key and index
-- is reproduced exactly. Review-to-revision integrity remains guaranteed by
-- "ReportReview_revision_fkey" plus the service layer, which always binds a
-- review to the exact current submitted revision at creation time. The table
-- is empty on every real migration path (reviews exist only behind feature
-- flags that were never enabled anywhere) and any rows are still preserved
-- defensively through the temporary stash. Foreign-key enforcement is
-- deferred to the surrounding migration transaction commit, where the
-- re-inserted parent rows resolve every reference again. No V1 table is
-- touched.

PRAGMA defer_foreign_keys = ON;

CREATE TEMPORARY TABLE "_report_review_history_pin_stash" AS SELECT * FROM "ReportReview";

DROP TABLE "ReportReview";

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
    CONSTRAINT "ReportReview_rubric_fkey" FOREIGN KEY ("reportRubricVersionId", "reportAssignmentVersionId") REFERENCES "ReportRubricVersion"("id", "reportAssignmentVersionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReportReview_reason_fkey" FOREIGN KEY ("rejectionReasonId", "reportRubricVersionId") REFERENCES "ReportRejectionReason"("id", "reportRubricVersionId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReportReview_revisionId_key" ON "ReportReview"("revisionId");

CREATE UNIQUE INDEX "ReportReview_reviewerId_requestId_key" ON "ReportReview"("reviewerId", "requestId");

CREATE UNIQUE INDEX "ReportReview_id_submissionId_key" ON "ReportReview"("id", "submissionId");

CREATE UNIQUE INDEX "ReportReview_id_reportRubricVersionId_key" ON "ReportReview"("id", "reportRubricVersionId");

INSERT INTO "ReportReview" (
    "id", "submissionId", "revisionId", "curriculumVersionId", "levelDefinitionId",
    "reportAssignmentVersionId", "reportRubricVersionId", "reviewerId", "reviewerRoleSnapshot",
    "decision", "humanComment", "correctiveAction", "rejectionReasonId", "requestId",
    "payloadFingerprint", "claimedAt", "claimExpiresAt", "reviewStartedAt", "reviewedAt", "createdAt"
)
SELECT
    "id", "submissionId", "revisionId", "curriculumVersionId", "levelDefinitionId",
    "reportAssignmentVersionId", "reportRubricVersionId", "reviewerId", "reviewerRoleSnapshot",
    "decision", "humanComment", "correctiveAction", "rejectionReasonId", "requestId",
    "payloadFingerprint", "claimedAt", "claimExpiresAt", "reviewStartedAt", "reviewedAt", "createdAt"
FROM "_report_review_history_pin_stash";

DROP TABLE "_report_review_history_pin_stash";

CREATE INDEX "ReportReview_submissionId_reviewedAt_idx" ON "ReportReview"("submissionId", "reviewedAt");
