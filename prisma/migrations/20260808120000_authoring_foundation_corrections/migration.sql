-- PHASE-G0 CORRECTION -- the durable video/assessment bridge and the preview video pin.
--
-- NOT APPLIED ANYWHERE BY THIS PHASE. Source-only, exactly like the G0 migration
-- it descends from. No live, preprod or production database was touched and
-- CURRICULUM_V2_ADMIN_ENABLED stays absent.
--
-- IT DESCENDS FROM 20260808000000_authoring_foundation AND DOES NOT EDIT IT.
-- The accepted G0 migration file is untouched: correcting a shipped migration in
-- place would change its checksum and make every database that already ran it
-- disagree with the repository.
--
-- MIGRATION RUNNER CONTRACT. prisma/migrate.ts splits this file on the semicolon
-- character, so NO COMMENT IN THIS FILE CONTAINS ONE, and every statement is a
-- single complete statement terminated by exactly one semicolon. This is also
-- why the paired-nullable rule below is expressed as a NEW TABLE rather than as
-- a trigger: a trigger body contains semicolons and would be split apart.
--
-- PURELY ADDITIVE. One new table and two new nullable columns. No existing
-- column is dropped, renamed, retyped or backfilled, no existing row is
-- rewritten, no table is rebuilt, and no learner or runtime table is touched.

-- ------------------------------------------ VideoProductionAssessmentLink
--
-- WHAT WAS WRONG. G0 stored an `assessmentFingerprint` on
-- VideoProductionVersion computed from the video contract's OWN embedded
-- questions. Both sides of every coherence check therefore came from the same
-- JSON document, so editing the REAL question bank could not make video
-- evidence stale. The independent audit proved it: changing the correct answer
-- of the bank for a level left the production evidence reading fresh.
--
-- WHY A TABLE RATHER THAN THREE NULLABLE COLUMNS. The link means nothing in
-- pieces: a bank id without the revision it was fingerprinted at, or a
-- fingerprint with no bank, is a FALSE link rather than a partial one. SQLite
-- refuses a CHECK on ALTER TABLE ADD COLUMN, so nullable columns on
-- VideoProductionVersion could not have carried a real all-or-nothing
-- constraint. A new table declares its constraints inline, so "linked" is a row
-- whose every column is NOT NULL and "unlinked" is the absence of a row. There
-- is no half-linked state that a reader has to reason about.
--
-- ONE BANK PER CONTRACT, AND NEVER A GUESS. `videoProductionVersionId` is
-- UNIQUE. A level whose candidate bank is ambiguous gets NO row at all, which is
-- the fail-closed behaviour the correction requires.
--
-- ON DELETE. The link is owned by the production contract, so deleting that
-- contract CASCADEs the link away. The AssessmentVersion is RESTRICTed: a bank
-- that video evidence still points at must not be deletable out from under it.
CREATE TABLE "VideoProductionAssessmentLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "videoProductionVersionId" INTEGER NOT NULL,
    "assessmentVersionId" INTEGER NOT NULL,
    -- The bank's aggregate revision when the fingerprint below was computed.
    "assessmentRevision" INTEGER NOT NULL CHECK ("assessmentRevision" > 0),
    -- Lowercase sha256 hex from calculateAssessmentFingerprint applied to
    -- projectAssessmentBank. The length constraint is what stops a caller
    -- supplied value from ever masquerading as a computed one.
    "assessmentBankFingerprint" TEXT NOT NULL CHECK (length("assessmentBankFingerprint") = 64),
    "linkedById" INTEGER,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoProductionAssessmentLink_video_fkey" FOREIGN KEY ("videoProductionVersionId") REFERENCES "VideoProductionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoProductionAssessmentLink_assessment_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VideoProductionAssessmentLink_linkedBy_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VideoProductionAssessmentLink_videoProductionVersionId_key" ON "VideoProductionAssessmentLink"("videoProductionVersionId");
CREATE INDEX "VideoProductionAssessmentLink_assessmentVersionId_idx" ON "VideoProductionAssessmentLink"("assessmentVersionId");
CREATE INDEX "VideoProductionAssessmentLink_linkedById_idx" ON "VideoProductionAssessmentLink"("linkedById");

-- ------------------------------------------- AuthoringPreviewSnapshot pin
--
-- G0 could pin a content version and an assessment version, but not the video
-- production version, so a preview of a video-backed level could not prove what
-- production state it rendered. These two columns close that.
--
-- THE PAIRING RULE IS DOMAIN-ENFORCED HERE, AND SAYING SO MATTERS. SQLite
-- refuses a CHECK on ADD COLUMN, exactly as it did for G0's `editorialState`, so
-- the "id present if and only if revision present" rule lives in
-- `authoring-preview-snapshot.ts` and is proven by regression rather than
-- declared here. The FOREIGN KEY, which ALTER TABLE DOES accept, is real.
--
-- The existing `AuthoringPreviewSnapshot_has_target` CHECK is deliberately left
-- alone. It already requires a content or assessment target, and a preview is a
-- LEARNER FRAME: a video production contract is production metadata attached to
-- a lesson, never a lesson on its own. Rebuilding the table to allow a
-- video-only snapshot would have meant a destructive rewrite for a state that
-- has no learner meaning.
ALTER TABLE "AuthoringPreviewSnapshot" ADD COLUMN "videoProductionVersionId" INTEGER REFERENCES "VideoProductionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthoringPreviewSnapshot" ADD COLUMN "videoProductionRevision" INTEGER;

CREATE INDEX "AuthoringPreviewSnapshot_videoProductionVersionId_idx" ON "AuthoringPreviewSnapshot"("videoProductionVersionId");
