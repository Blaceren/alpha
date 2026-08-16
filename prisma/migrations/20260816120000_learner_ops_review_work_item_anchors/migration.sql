-- LO-REVIEW-WORKITEM-UNREACHABLE-1 — anchor uniqueness for derived review work items.
--
-- WHY THIS MIGRATION EXISTS AND WHY IT IS ONLY TWO INDEXES.
-- Migration 51 already gave LearnerOpsCase everything else this integration
-- needs: reportSubmissionId and userLevelProgressId are real foreign keys, and
-- four CHECK constraints tie each anchor to its type in BOTH directions, so an
-- orphan report_review or a mentor_review without a progress row is already
-- impossible. The single thing missing was uniqueness: two operational cases
-- could point at one canonical object, which is exactly what "exactly one work
-- item per canonical review" forbids.
--
-- PARTIAL, BECAUSE MOST CASES HAVE NO ANCHOR AT ALL.
-- support_request, complaint, service_recovery, educational_escalation and
-- operational_followup all carry NULL in both columns. SQLite treats NULLs as
-- distinct in a UNIQUE index, so a plain unique index would already admit them,
-- but the WHERE clause states the intent rather than relying on that rule being
-- remembered by the next reader.
--
-- THIS IS THE CONCURRENCY BACKSTOP, not the primary mechanism. The integration
-- owner reads before it creates, the way every ensure does. The index is what
-- makes the read-then-create safe when two transactions interleave: one wins,
-- the other gets P2002 and re-reads the winner.
--
-- NO DATA IS TOUCHED. Two CREATE UNIQUE INDEX statements, nothing else. No
-- column is added, dropped or retyped, no row is written, no constraint from
-- migration 51 is rebuilt.

CREATE UNIQUE INDEX "LearnerOpsCase_reportSubmissionId_key"
ON "LearnerOpsCase"("reportSubmissionId")
WHERE "reportSubmissionId" IS NOT NULL;

CREATE UNIQUE INDEX "LearnerOpsCase_userLevelProgressId_key"
ON "LearnerOpsCase"("userLevelProgressId")
WHERE "userLevelProgressId" IS NOT NULL;
