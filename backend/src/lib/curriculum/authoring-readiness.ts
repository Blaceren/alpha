/**
 * PHASE-G1 — readiness, package-handoff blockers and the G2 work queue (§32,
 * §33, §49).
 *
 * NO SINGLE PERCENTAGE. The accepted ATA profile already explains why: one
 * completion number over 100 levels flatters, and one over "levels that need
 * writing" answers a different question. Both are true and neither is the
 * headline, so this module reports SEPARATE, NAMED counts and lets a reader
 * decide which one their question is about. There is deliberately no
 * `completionPercent` field anywhere in this file.
 *
 * NOTHING IS HARDCODED (§32). No ATA backlog total appears anywhere in this
 * file — not the gap count, not the proposal count, not the number of video
 * lessons. Every count is derived from the durable rows the Studio reads and
 * from the SOURCE structure, which is also why the counts reconcile with the
 * accepted package profile rather than merely resembling it: the
 * "content required" predicate and the editorial teaching floor are the
 * profile's own, imported rather than restated.
 *
 * PURE. Every function here takes `AuthoringLevelSummary[]` and returns a value.
 * There is no query and no write, so the readiness view can never disagree with
 * the overview it is computed from.
 */
import type { AtaLevelKind } from "@/lib/curriculum/product-ata-100";
import {
  canonicalAtaKind,
  requiresLearnerTeachingContent,
} from "@/lib/curriculum/authoring-level-profile";
import { MIN_EDITORIAL_TEACHING_CHARACTERS } from "@/lib/curriculum/package/ata-profile";
import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import type {
  AuthoringLevelSummary,
  EditorialCandidateSummary,
  EditorialContentCandidateSummary,
} from "@/lib/curriculum/authoring-read";

/**
 * PHASE-G1 CORRECTION — both of these now DELEGATE.
 *
 * The predicate itself moved to `authoring-level-profile`, unchanged in
 * behaviour, because `authoring-validation-service` was answering the same
 * product question from the durable TYPE alone and reaching a different answer
 * for `report` levels. Readiness said L3 owed nothing; validation demanded a
 * teaching body of it; the handoff bundle asked both and threw. One rule, one
 * implementation, four callers — readiness, validation, handoff and the work
 * queue.
 */
export function canonicalKindFor(level: AuthoringLevelSummary): AtaLevelKind | null {
  return canonicalAtaKind({
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    type: level.levelType,
  });
}

/** Does this level owe the product a written lesson? */
export function requiresLearnerContent(level: AuthoringLevelSummary): boolean {
  return requiresLearnerTeachingContent({
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    type: level.levelType,
  });
}

/** Is this level one of the video+assessment lessons? Answered by the durable row. */
export function isVideoLesson(level: AuthoringLevelSummary): boolean {
  return level.video !== null;
}

/* ------------------------------------------------------------------ *
 * Package-handoff blockers
 * ------------------------------------------------------------------ */

export const HANDOFF_BLOCKER_CODES = [
  "CONTENT_MISSING",
  "CONTENT_BELOW_EDITORIAL_FLOOR",
  "CONTENT_NOT_APPROVED",
  "ASSESSMENT_MISSING",
  "ASSESSMENT_NOT_APPROVED",
  "ASSESSMENT_SOURCE_CONFLICT",
  /**
   * PHASE-G2 CORRECTION-2 — the bank's canonical Blueprint source cannot be
   * established, so whether it disagrees is UNKNOWN.
   *
   * Its own code, not folded into `ASSESSMENT_SOURCE_CONFLICT`, because the work
   * is different: a conflict needs a reviewer to decide, an unreadable source
   * needs an operator to repair the contract or the linkage. It exists at all
   * because a count cannot express "we did not get to count" — the previous
   * shape reported zero conflicts and let the level hand off.
   */
  "ASSESSMENT_SOURCE_CONTRACT_UNREADABLE",
  "ASSESSMENT_TAKE_MAPPING_INCOMPLETE",
  "STRUCTURE_NOT_CANONICAL",
] as const;
export type HandoffBlockerCode = (typeof HANDOFF_BLOCKER_CODES)[number];

export type LevelHandoffStatus = {
  levelDefinitionId: number;
  levelNumber: number;
  stableCode: string;
  ready: boolean;
  blockers: HandoffBlockerCode[];
};

/**
 * Why this level may not enter a package-handoff bundle yet.
 *
 * A level with NO editorial requirement — the registration gate, the twenty
 * financial checkpoints — has no blockers and is `ready`. That is not a claim
 * that it is finished; it is the accurate statement that it owes the handoff
 * nothing, which is exactly how the accepted profile treats it.
 */
export function levelHandoffStatus(level: AuthoringLevelSummary): LevelHandoffStatus {
  const blockers: HandoffBlockerCode[] = [];

  const match = STABLE_CODE_PATTERN.exec(level.stableCode);
  if (!match || Number(match[1]) !== level.levelNumber) {
    blockers.push("STRUCTURE_NOT_CANONICAL");
  }

  if (requiresLearnerContent(level)) {
    if (!level.content || !level.content.hasLocalization) {
      blockers.push("CONTENT_MISSING");
    } else {
      if (level.content.teachingCharacters < MIN_EDITORIAL_TEACHING_CHARACTERS) {
        blockers.push("CONTENT_BELOW_EDITORIAL_FLOOR");
      }
      if (level.content.editorialState !== "approved") {
        blockers.push("CONTENT_NOT_APPROVED");
      }
    }
  }

  if (isVideoLesson(level)) {
    if (!level.assessment) {
      blockers.push("ASSESSMENT_MISSING");
    } else {
      // PHASE-G2 — blocks on UNSETTLED disagreement, not on the mere existence
      // of a historical one. A bank whose conflicts were each explicitly
      // adjudicated has nothing outstanding for the handoff to wait on, and the
      // raw count stays on the summary so the history is never hidden.
      // CORRECTION-2 — FIRST, because the counts below are only meaningful once
      // a comparison actually happened. An unreadable source produces zeroes,
      // and a zero that means "not computed" must never read as "nothing owed".
      if (level.assessment.sourceContractUnavailable) {
        blockers.push("ASSESSMENT_SOURCE_CONTRACT_UNREADABLE");
      }
      if (level.assessment.blockingConflictCount > 0) blockers.push("ASSESSMENT_SOURCE_CONFLICT");
      if (level.assessment.editorialState !== "approved") blockers.push("ASSESSMENT_NOT_APPROVED");
      if (level.assessment.mappedTakeCount !== 4) {
        blockers.push("ASSESSMENT_TAKE_MAPPING_INCOMPLETE");
      }
    }
  }

  return {
    levelDefinitionId: level.levelDefinitionId,
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    ready: blockers.length === 0,
    blockers,
  };
}

/* ------------------------------------------------------------------ *
 * Readiness counts
 * ------------------------------------------------------------------ */

export type AuthoringReadiness = {
  totalLevels: number;
  structurallyValidLevels: number;

  /** Levels that owe the product a written lesson. */
  contentRequiredLevels: number;
  contentPresentLevels: number;
  /** Present AND at or above the accepted ATA editorial floor. */
  contentAtEditorialFloorLevels: number;
  /** The honest backlog: required levels still short of the floor or absent. */
  contentNeedsAuthoringLevels: number;
  /** Required levels whose content is not runtime-published. */
  contentNotPublishedLevels: number;
  contentApprovedLevels: number;
  contentSubmittedLevels: number;
  contentChangesRequestedLevels: number;
  /** §34 — historical rows: published, never editorially reviewed. */
  contentLegacyPublishedUnapprovedLevels: number;

  assessmentPresentLevels: number;
  assessmentMissingOnVideoLevels: number;
  assessmentProposedLevels: number;
  assessmentSourceBackedLevels: number;
  assessmentConflictingLevels: number;
  assessmentApprovedLevels: number;
  assessmentSubmittedLevels: number;
  assessmentChangesRequestedLevels: number;
  /** Total RAW field-level Blueprint disagreements across the curriculum. */
  assessmentConflictRecords: number;
  /**
   * PHASE-G2 — the subset still waiting on a decision. The raw total above is
   * deliberately kept: a curriculum that adjudicated seven disagreements has
   * seven of them in its history and zero in its backlog, and one number cannot
   * say both.
   */
  assessmentBlockingConflictRecords: number;
  /** Levels carrying at least one in-force source-authority decision. */
  assessmentAdjudicatedLevels: number;
  /** Levels whose recorded decision no longer matches the values it was made against. */
  assessmentAdjudicationStaleLevels: number;
  /**
   * PHASE-G2 CORRECTION-2 — levels whose canonical Blueprint source could not be
   * established at all. Counted separately from conflicts: an unknown source is
   * not a disagreement, and it is not agreement either.
   */
  assessmentSourceUnavailableLevels: number;

  videoContractLevels: number;
  videoScriptPendingLevels: number;
  videoNotRecordedLevels: number;
  videoQaPendingLevels: number;
  videoQaPassedLevels: number;
  videoContractEvidenceStaleLevels: number;
  videoAssessmentEvidenceStaleLevels: number;
  videoUnlinkedLevels: number;

  openReviewNotes: number;

  handoffReadyLevels: number;
  handoffBlockedLevels: number;
  blockersByCode: Record<HandoffBlockerCode, number>;

  /**
   * REVIEW-SURFACE CORRECTION — THE EDITORIAL AXIS, reported separately.
   *
   * EVERY COUNTER ABOVE IS RUNTIME-ORIENTED and stays that way.
   * `contentApprovedLevels`, `contentSubmittedLevels`, `handoffReadyLevels` and
   * the rest describe the version the level SERVES, because that is what a
   * package handoff ships and what every existing reader of this type already
   * means by them. Redefining them onto the editorial candidate would silently
   * change what "ready" asserts about a curriculum, which is the one thing a
   * readiness view may never do.
   *
   * The block below answers the OTHER question — how much editorial work is
   * outstanding, including on versions that are not serving anything. On a
   * corpus with no successors the two agree; the moment a successor exists they
   * must not be added together, and separate names are what stops that.
   */
  editorial: AuthoringEditorialReadiness;
};

export type AuthoringEditorialReadiness = {
  /** Levels whose editorial candidate is a version the level does not serve. */
  levelsWithSuccessorCandidate: number;
  contentCandidateSubmittedLevels: number;
  contentCandidateChangesRequestedLevels: number;
  contentCandidateApprovedLevels: number;
  assessmentCandidateSubmittedLevels: number;
  assessmentCandidateChangesRequestedLevels: number;
  assessmentCandidateApprovedLevels: number;
  videoCandidateSubmittedLevels: number;
  videoCandidateChangesRequestedLevels: number;
  videoCandidateApprovedLevels: number;
  /** Aggregates awaiting a reviewer right now, across all three axes. */
  awaitingReviewerAggregates: number;
  /** Approved successors waiting on the admin-gated publication. */
  awaitingPublisherAggregates: number;
  /** FAIL-CLOSED axes: two equally-active versions, so no candidate is offered. */
  ambiguousCandidateAxes: number;
};

function zeroBlockers(): Record<HandoffBlockerCode, number> {
  return Object.fromEntries(HANDOFF_BLOCKER_CODES.map((code) => [code, 0])) as Record<
    HandoffBlockerCode,
    number
  >;
}

export function summarizeReadiness(levels: readonly AuthoringLevelSummary[]): AuthoringReadiness {
  const readiness: AuthoringReadiness = {
    totalLevels: levels.length,
    structurallyValidLevels: 0,
    contentRequiredLevels: 0,
    contentPresentLevels: 0,
    contentAtEditorialFloorLevels: 0,
    contentNeedsAuthoringLevels: 0,
    contentNotPublishedLevels: 0,
    contentApprovedLevels: 0,
    contentSubmittedLevels: 0,
    contentChangesRequestedLevels: 0,
    contentLegacyPublishedUnapprovedLevels: 0,
    assessmentPresentLevels: 0,
    assessmentMissingOnVideoLevels: 0,
    assessmentProposedLevels: 0,
    assessmentSourceBackedLevels: 0,
    assessmentConflictingLevels: 0,
    assessmentApprovedLevels: 0,
    assessmentSubmittedLevels: 0,
    assessmentChangesRequestedLevels: 0,
    assessmentConflictRecords: 0,
    assessmentBlockingConflictRecords: 0,
    assessmentAdjudicatedLevels: 0,
    assessmentAdjudicationStaleLevels: 0,
    assessmentSourceUnavailableLevels: 0,
    videoContractLevels: 0,
    videoScriptPendingLevels: 0,
    videoNotRecordedLevels: 0,
    videoQaPendingLevels: 0,
    videoQaPassedLevels: 0,
    videoContractEvidenceStaleLevels: 0,
    videoAssessmentEvidenceStaleLevels: 0,
    videoUnlinkedLevels: 0,
    openReviewNotes: 0,
    handoffReadyLevels: 0,
    handoffBlockedLevels: 0,
    blockersByCode: zeroBlockers(),
    editorial: {
      levelsWithSuccessorCandidate: 0,
      contentCandidateSubmittedLevels: 0,
      contentCandidateChangesRequestedLevels: 0,
      contentCandidateApprovedLevels: 0,
      assessmentCandidateSubmittedLevels: 0,
      assessmentCandidateChangesRequestedLevels: 0,
      assessmentCandidateApprovedLevels: 0,
      videoCandidateSubmittedLevels: 0,
      videoCandidateChangesRequestedLevels: 0,
      videoCandidateApprovedLevels: 0,
      awaitingReviewerAggregates: 0,
      awaitingPublisherAggregates: 0,
      ambiguousCandidateAxes: 0,
    },
  };

  for (const level of levels) {
    /* ---------------- REVIEW-SURFACE CORRECTION — editorial axis ---------- */
    let hasSuccessorCandidate = false;
    for (const [name, axis] of [
      ["content", level.editorial.content],
      ["assessment", level.editorial.assessment],
      ["video", level.editorial.video],
    ] as const) {
      if (axis.ambiguous) {
        readiness.editorial.ambiguousCandidateAxes += 1;
        continue;
      }
      if (axis.versionId === null) continue;
      if (!axis.isRuntimeVersion) hasSuccessorCandidate = true;
      if (axis.editorialState === "submitted_for_review") {
        readiness.editorial[`${name}CandidateSubmittedLevels`] += 1;
        readiness.editorial.awaitingReviewerAggregates += 1;
      } else if (axis.editorialState === "changes_requested") {
        readiness.editorial[`${name}CandidateChangesRequestedLevels`] += 1;
      } else if (axis.editorialState === "approved") {
        readiness.editorial[`${name}CandidateApprovedLevels`] += 1;
        // Approved and not the version being served: the remaining step is the
        // admin-gated publication, which is not an editorial act.
        if (!axis.isRuntimeVersion) readiness.editorial.awaitingPublisherAggregates += 1;
      }
    }
    if (hasSuccessorCandidate) readiness.editorial.levelsWithSuccessorCandidate += 1;

    const match = STABLE_CODE_PATTERN.exec(level.stableCode);
    if (match && Number(match[1]) === level.levelNumber) readiness.structurallyValidLevels += 1;

    const contentRequired = requiresLearnerContent(level);
    if (contentRequired) readiness.contentRequiredLevels += 1;

    if (level.content) {
      readiness.openReviewNotes += level.content.openReviewNotes;
      if (level.content.hasLocalization) readiness.contentPresentLevels += 1;
      if (level.content.teachingCharacters >= MIN_EDITORIAL_TEACHING_CHARACTERS) {
        readiness.contentAtEditorialFloorLevels += 1;
      }
      if (level.content.editorialState === "approved") readiness.contentApprovedLevels += 1;
      if (level.content.editorialState === "submitted_for_review") {
        readiness.contentSubmittedLevels += 1;
      }
      if (level.content.editorialState === "changes_requested") {
        readiness.contentChangesRequestedLevels += 1;
      }
      if (level.content.legacyPublishedUnapproved) {
        readiness.contentLegacyPublishedUnapprovedLevels += 1;
      }
    }

    if (contentRequired) {
      const authored =
        level.content !== null &&
        level.content.hasLocalization &&
        level.content.teachingCharacters >= MIN_EDITORIAL_TEACHING_CHARACTERS;
      if (!authored) readiness.contentNeedsAuthoringLevels += 1;
      if (!level.content || level.content.runtimeStatus !== "published") {
        readiness.contentNotPublishedLevels += 1;
      }
    }

    if (level.assessment) {
      readiness.assessmentPresentLevels += 1;
      readiness.openReviewNotes += level.assessment.openReviewNotes;
      readiness.assessmentConflictRecords += level.assessment.conflictCount;
      readiness.assessmentBlockingConflictRecords += level.assessment.blockingConflictCount;
      if ((level.assessment.authorityResolution?.decisions.length ?? 0) > 0) {
        readiness.assessmentAdjudicatedLevels += 1;
      }
      if (level.assessment.authorityResolution?.state === "ADJUDICATION_STALE") {
        readiness.assessmentAdjudicationStaleLevels += 1;
      }
      // CORRECTION-2 — banks whose source could not be read are their own
      // backlog. They are deliberately NOT added to the conflict records above:
      // no conflict was observed, and inventing a number would be the same lie
      // in the other direction.
      if (level.assessment.sourceContractUnavailable) {
        readiness.assessmentSourceUnavailableLevels += 1;
      }
      switch (level.assessment.provenance) {
        case "PROPOSED_CANON":
          readiness.assessmentProposedLevels += 1;
          break;
        case "SOURCE_BACKED":
          readiness.assessmentSourceBackedLevels += 1;
          break;
        case "CONFLICTING":
          readiness.assessmentConflictingLevels += 1;
          break;
        case "APPROVED_CURRENT":
          readiness.assessmentApprovedLevels += 1;
          break;
        default:
          break;
      }
      if (level.assessment.editorialState === "submitted_for_review") {
        readiness.assessmentSubmittedLevels += 1;
      }
      if (level.assessment.editorialState === "changes_requested") {
        readiness.assessmentChangesRequestedLevels += 1;
      }
    } else if (isVideoLesson(level)) {
      readiness.assessmentMissingOnVideoLevels += 1;
    }

    if (level.video) {
      readiness.videoContractLevels += 1;
      readiness.openReviewNotes += level.video.openReviewNotes;
      if (level.video.scriptState === "SCRIPT_PENDING") readiness.videoScriptPendingLevels += 1;
      if (level.video.videoState === "NOT_RECORDED") readiness.videoNotRecordedLevels += 1;
      if (level.video.qaState === "QA_PENDING") readiness.videoQaPendingLevels += 1;
      if (level.video.qaState === "QA_PASSED") readiness.videoQaPassedLevels += 1;
      if (level.video.contractEvidenceStale) readiness.videoContractEvidenceStaleLevels += 1;
      if (level.video.assessmentEvidenceStale) readiness.videoAssessmentEvidenceStaleLevels += 1;
      if (level.video.coherenceReason === "UNLINKED") readiness.videoUnlinkedLevels += 1;
    }

    const handoff = levelHandoffStatus(level);
    if (handoff.ready) readiness.handoffReadyLevels += 1;
    else readiness.handoffBlockedLevels += 1;
    for (const code of handoff.blockers) readiness.blockersByCode[code] += 1;
  }

  return readiness;
}

/* ------------------------------------------------------------------ *
 * The G2 work queue (§49)
 * ------------------------------------------------------------------ */

export const WORK_QUEUE_BUCKETS = [
  "NEEDS_FULL_CONTENT",
  "READY_FOR_CONTENT_REVIEW",
  /**
   * REVIEW-SURFACE CORRECTION — the review bucket the content axis already had
   * and the other two axes did not.
   *
   * A submitted bank used to fall through to the provenance switch and surface
   * as `NEEDS_ASSESSMENT_APPROVAL` — "a Blueprint proposal nobody has approved"
   * — the right desk with the wrong story: it could not distinguish a bank whose
   * author has not submitted it from one a reviewer is already holding. A
   * submitted production version produced no entry at all, so a reviewer holding
   * a SCRIPT_READY production direction had no surface saying it was theirs.
   */
  "READY_FOR_ASSESSMENT_REVIEW",
  "READY_FOR_VIDEO_REVIEW",
  "NEEDS_ASSESSMENT_APPROVAL",
  "SOURCE_BACKED_AWAITING_REVIEW",
  "SOURCE_CONFLICT",
  /**
   * PHASE-G2 CORRECTION-2 — the bank's Blueprint source cannot be read, so
   * nobody can say whether it conflicts.
   *
   * A separate bucket because it is a different job for a different person: an
   * operator repairs a contract payload or a broken link, a reviewer decides a
   * conflict. Filing it under `SOURCE_CONFLICT` would send a reviewer looking
   * for a disagreement nobody has observed.
   */
  "SOURCE_UNAVAILABLE",
  "NEEDS_VIDEO_SCRIPT",
  "NEEDS_VIDEO_ASSET",
  "NEEDS_VIDEO_QA",
  "CHANGES_REQUESTED",
  "APPROVED_READY_FOR_HANDOFF",
  /**
   * PHASE-G1 CORRECTION — the honest label for a level that owes the handoff no
   * editorial material at all: the registration gate, the twenty financial
   * checkpoints, the report level.
   *
   * These were previously counted as APPROVED_READY_FOR_HANDOFF with the reason
   * "every editorial requirement for this level is approved" — vacuously true and
   * actively misleading, because nothing about them was ever authored, reviewed
   * or approved, and it inflated the approved count by 22 on a backlog whose real
   * `contentApprovedLevels` was 0. A planner reading the queue must be able to
   * tell "finished" from "not applicable".
   */
  "EDITORIAL_HANDOFF_NOT_REQUIRED",
  "NEEDS_PRODUCT_DECISION",
] as const;
export type WorkQueueBucket = (typeof WORK_QUEUE_BUCKETS)[number];

/**
 * REVIEW-SURFACE CORRECTION — enough identity to OPEN the work, not just to name
 * it.
 *
 * A queue entry used to carry a level number, a stable code and prose. A
 * reviewer holding "level 2 · content · awaiting a reviewer" still had to
 * discover WHICH content version, and on a level mid-succession the obvious
 * guess — whatever the level summary shows — is the predecessor. In practice the
 * id was recoverable only from a markdown handoff the author wrote by hand.
 *
 * DELIBERATELY NOT HERE: any source-authority evidence. Decisions, hashes,
 * fingerprints and rationales live on the source-authority surface, which is a
 * different question asked by a different person.
 */
export type WorkQueueCandidateRef = {
  versionId: number;
  versionNumber: number;
  revision: number;
  editorialState: string;
  /** The runtime axis of THIS version, or null for video production. */
  runtimeStatus: string | null;
  /** Is this the version the level currently serves? */
  isRuntimeVersion: boolean;
  /** Is this version pinned by `LevelResourceBinding`? */
  isRuntimeBound: boolean;
  /** PHASE-G2 SUCCESSOR lineage, where the axis records one. */
  predecessorVersionId: number | null;
};

export type WorkQueueEntry = {
  bucket: WorkQueueBucket;
  /** REVIEW-SURFACE CORRECTION — so a client can address the level by id. */
  levelDefinitionId: number;
  levelNumber: number;
  stableCode: string;
  aggregate: "content" | "assessment" | "video_production" | "structure";
  reason: string;
  /**
   * The exact version this entry is about. Null for `structure` entries, which
   * are about the level rather than a version, and for an ambiguous axis, where
   * withholding the id is the point.
   */
  candidate: WorkQueueCandidateRef | null;
};

/**
 * Classify every unresolved item.
 *
 * ONE LEVEL MAY PRODUCE SEVERAL ENTRIES, and that is the point: L18's bank is
 * awaiting review while its video still has no script, and a queue that forced a
 * single label per level would hide one of those two pieces of work from
 * whoever owns it. Entries are keyed by AGGREGATE, so each one has an owner.
 *
 * Nothing here is hardcoded and nothing is resolved: the classifier reads state
 * and names it.
 */
export function classifyWorkQueue(levels: readonly AuthoringLevelSummary[]): WorkQueueEntry[] {
  const entries: WorkQueueEntry[] = [];
  const push = (
    bucket: WorkQueueBucket,
    level: AuthoringLevelSummary,
    aggregate: WorkQueueEntry["aggregate"],
    reason: string,
    candidate: WorkQueueCandidateRef | null = null,
  ) => {
    entries.push({
      bucket,
      levelDefinitionId: level.levelDefinitionId,
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      aggregate,
      reason,
      candidate,
    });
  };

  /** One axis' editorial candidate, in queue-entry shape. */
  const ref = (
    axis: EditorialCandidateSummary | EditorialContentCandidateSummary,
  ): WorkQueueCandidateRef | null =>
    axis.versionId === null || axis.versionNumber === null || axis.revision === null
      ? null
      : {
          versionId: axis.versionId,
          versionNumber: axis.versionNumber,
          revision: axis.revision,
          editorialState: axis.editorialState ?? "draft",
          runtimeStatus: axis.runtimeStatus,
          isRuntimeVersion: axis.isRuntimeVersion,
          isRuntimeBound: axis.isRuntimeBound,
          predecessorVersionId: axis.predecessorVersionId,
        };

  for (const level of levels) {
    const handoff = levelHandoffStatus(level);
    const editorialContent = level.editorial.content;
    const editorialAssessment = level.editorial.assessment;
    const editorialVideo = level.editorial.video;

    /* ------------------------------------------------- ambiguity, first */
    // FAIL CLOSED, and BEFORE anything else on that axis: with two equally
    // active versions there is no truthful single work item, and picking one
    // would send a reviewer to a version chosen by id order.
    for (const [axis, aggregate] of [
      [editorialContent, "content"],
      [editorialAssessment, "assessment"],
      [editorialVideo, "video_production"],
    ] as const) {
      if (axis.ambiguous) {
        const desk =
          axis.waitingOn === "reviewer"
            ? "submitted for review"
            : axis.waitingOn === "publisher"
              ? "approved and unpublished"
              : "returned for changes";
        push(
          "NEEDS_PRODUCT_DECISION",
          level,
          aggregate,
          `versions ${axis.ambiguousVersionIds.join(", ")} are all ${desk} — which one is the successor is a human decision, so no candidate is offered`,
        );
      }
    }

    if (handoff.blockers.includes("STRUCTURE_NOT_CANONICAL")) {
      push(
        "NEEDS_PRODUCT_DECISION",
        level,
        "structure",
        `stableCode "${level.stableCode}" is not the canonical code for level ${level.levelNumber}`,
      );
    }

    /* ------------------------------------------------------------ content */
    // REVIEW-SURFACE CORRECTION — judged on the EDITORIAL CANDIDATE, not on the
    // runtime version. Where a level has no successor the two are the same row
    // and nothing changes; where it has one this is the difference between
    // "review the replacement the author submitted" and the old answer, which
    // was silence, because a runtime predecessor is not submitted and never
    // will be.
    if (!editorialContent.ambiguous) {
      if (editorialContent.editorialState === "changes_requested") {
        push("CHANGES_REQUESTED", level, "content", "reviewer returned the lesson for changes", ref(editorialContent));
      } else if (editorialContent.editorialState === "submitted_for_review") {
        push(
          "READY_FOR_CONTENT_REVIEW",
          level,
          "content",
          editorialContent.isRuntimeVersion
            ? "lesson is awaiting a reviewer"
            : "successor lesson is awaiting a reviewer — the level still serves its published predecessor",
          ref(editorialContent),
        );
      } else if (requiresLearnerContent(level)) {
        if (editorialContent.versionId === null || !editorialContent.hasLocalization) {
          push("NEEDS_FULL_CONTENT", level, "content", "no learner lesson exists for this level", ref(editorialContent));
        } else if (editorialContent.teachingCharacters < MIN_EDITORIAL_TEACHING_CHARACTERS) {
          push(
            "NEEDS_FULL_CONTENT",
            level,
            "content",
            `${editorialContent.teachingCharacters} teaching characters — below the ${MIN_EDITORIAL_TEACHING_CHARACTERS} ATA editorial floor`,
            ref(editorialContent),
          );
        }
      }
    }

    /* --------------------------------------------------------- assessment */
    // The PROVENANCE entries describe the bank the provenance was COMPUTED on —
    // the runtime bank — so they name that version rather than the editorial
    // candidate. The two coincide on every level in the corpus today, because no
    // `LevelResourceBinding` pins an assessment; naming each entry after the row
    // its reason came from keeps them honest if that ever changes.
    const runtimeAssessmentRef: WorkQueueCandidateRef | null = level.assessment
      ? {
          versionId: level.assessment.id,
          versionNumber: level.assessment.versionNumber,
          revision: level.assessment.revision,
          editorialState: level.assessment.editorialState,
          runtimeStatus: level.assessment.runtimeStatus,
          isRuntimeVersion: true,
          isRuntimeBound:
            editorialAssessment.versionId === level.assessment.id
              ? editorialAssessment.isRuntimeBound
              : false,
          predecessorVersionId: null,
        }
      : null;

    // REVIEW-SURFACE CORRECTION — SOURCE INTEGRITY IS NOT A LIFECYCLE STATE, so
    // it is emitted unconditionally rather than as the `else` of one.
    //
    // The lifecycle branch used to shadow the whole provenance switch: a bank
    // returned for changes reported only `CHANGES_REQUESTED`, and an unreadable
    // Blueprint source or an unsettled conflict on that same bank disappeared
    // from the queue until somebody resubmitted it. A conflict is owed to a
    // reviewer whatever desk the bank is on, so the two now coexist. No level in
    // the corpus is in both states today, which is why this costs nothing to fix
    // and is exactly why it was never noticed.
    if (level.assessment?.provenance === "SOURCE_UNAVAILABLE") {
      push(
        "SOURCE_UNAVAILABLE",
        level,
        "assessment",
        level.assessment.sourceContractUnavailableReason === "SOURCE_LINK_INCOMPATIBLE"
          ? "the bank is linked to a video production version from another level, so its Blueprint lineage is ambiguous — repair the link before this level can be assessed"
          : "the Blueprint proposal for this bank could not be parsed, so whether it disagrees with the approved bank is unknown — repair the production contract",
        runtimeAssessmentRef,
      );
    }

    if (!editorialAssessment.ambiguous && editorialAssessment.editorialState === "changes_requested") {
      push("CHANGES_REQUESTED", level, "assessment", "reviewer returned the bank for changes", ref(editorialAssessment));
    } else if (!editorialAssessment.ambiguous && editorialAssessment.editorialState === "submitted_for_review") {
      // REVIEW-SURFACE CORRECTION — a submitted bank used to fall straight
      // through to the provenance switch and be reported as "a Blueprint
      // proposal nobody has approved". True of its provenance, wrong about the
      // work: it IS with a reviewer, and the entry now says so and names the id.
      push(
        "READY_FOR_ASSESSMENT_REVIEW",
        level,
        "assessment",
        editorialAssessment.isRuntimeVersion
          ? "question bank is awaiting a reviewer"
          : "successor question bank is awaiting a reviewer — the level still serves its published predecessor",
        ref(editorialAssessment),
      );
    }

    const awaitingEditorialDecision =
      !editorialAssessment.ambiguous &&
      (editorialAssessment.editorialState === "changes_requested" ||
        editorialAssessment.editorialState === "submitted_for_review");

    if (level.assessment) {
      switch (level.assessment.provenance) {
        // Emitted above, unconditionally, so a lifecycle state cannot hide it.
        case "SOURCE_UNAVAILABLE":
          break;
        case "CONFLICTING": {
          // PHASE-G2 — say which of the raw disagreements are actually
          // outstanding, and name the ones that were decided but whose selected
          // authority the bank does not yet serve. A planner reading "7" when
          // six were settled cannot tell what work is left.
          const raw = level.assessment.conflictCount;
          const blocking = level.assessment.blockingConflictCount;
          const decided = level.assessment.authorityResolution?.decisions ?? [];
          const notApplied = decided.filter((entry) => entry.application === "DECIDED_NOT_APPLIED").length;
          const stale = decided.filter((entry) => entry.application === "STALE").length;
          // CORRECTION-1 — a planner must not be told these conflicts are
          // "unadjudicated" when the truth is that the adjudication record could
          // not be read. The two need completely different work: one needs a
          // reviewer, the other needs an operator.
          const detail = level.assessment.authorityReadUnavailable
            ? `${raw} field-level disagreements are blocking because the source-authority record could not be read — any decisions already made cannot be confirmed`
            : decided.length === 0
              ? `${blocking} of ${raw} field-level disagreements between the Blueprint proposal and the approved bank are unadjudicated`
              : `${blocking} of ${raw} field-level disagreements still block` +
                (notApplied > 0 ? `, ${notApplied} decided but not yet applied` : "") +
                (stale > 0 ? `, ${stale} decided against values that have since changed` : "");
          push("SOURCE_CONFLICT", level, "assessment", detail, runtimeAssessmentRef);
          break;
        }
        // REVIEW-SURFACE CORRECTION — these three say "nobody has approved this
        // bank", which stays true while a reviewer is holding it and would
        // duplicate the review entry above. They are suppressed exactly when a
        // lifecycle entry already names the desk the bank is on.
        case "SOURCE_BACKED":
          if (!awaitingEditorialDecision) {
            push(
              "SOURCE_BACKED_AWAITING_REVIEW",
              level,
              "assessment",
              level.assessment.sourceApproval === "AWAITING_APPROVAL"
                ? "source-backed bank whose source records AWAITING_APPROVAL"
                : "source-backed bank with no editorial approval recorded",
              runtimeAssessmentRef,
            );
          }
          break;
        case "PROPOSED_CANON":
          if (!awaitingEditorialDecision) {
            push(
              "NEEDS_ASSESSMENT_APPROVAL",
              level,
              "assessment",
              "PROPOSED_CANON bank — a Blueprint proposal nobody has approved",
              runtimeAssessmentRef,
            );
          }
          break;
        case "LOCAL_DRAFT":
          if (!awaitingEditorialDecision) {
            push(
              "NEEDS_ASSESSMENT_APPROVAL",
              level,
              "assessment",
              "bank has no canonical provenance and no editorial approval",
              runtimeAssessmentRef,
            );
          }
          break;
        default:
          break;
      }
    } else if (isVideoLesson(level)) {
      push("NEEDS_FULL_CONTENT", level, "assessment", "video+assessment lesson with no question bank", null);
    }

    /* -------------------------------------------------------------- video */
    if (level.video) {
      const videoRef: WorkQueueCandidateRef | null = ref(editorialVideo) ?? {
        versionId: level.video.id,
        versionNumber: level.video.versionNumber,
        revision: level.video.revision,
        editorialState: level.video.editorialState,
        runtimeStatus: null,
        isRuntimeVersion: true,
        isRuntimeBound: false,
        predecessorVersionId: null,
      };

      // REVIEW-SURFACE CORRECTION — the production version's own editorial
      // lifecycle. A submitted script produced no queue entry at all. The asset
      // and QA entries below are separate PRODUCTION work and are unaffected: a
      // script can be reviewable while the video is still unrecorded, and both
      // facts stay visible.
      if (!editorialVideo.ambiguous) {
        if (editorialVideo.editorialState === "changes_requested") {
          push("CHANGES_REQUESTED", level, "video_production", "reviewer returned the production direction for changes", videoRef);
        } else if (editorialVideo.editorialState === "submitted_for_review") {
          push("READY_FOR_VIDEO_REVIEW", level, "video_production", "production direction is awaiting a reviewer", videoRef);
        }
      }

      if (level.video.scriptState === "SCRIPT_PENDING") {
        push("NEEDS_VIDEO_SCRIPT", level, "video_production", "script is SCRIPT_PENDING", videoRef);
      }
      if (level.video.videoState === "NOT_RECORDED") {
        push("NEEDS_VIDEO_ASSET", level, "video_production", "video is NOT_RECORDED", videoRef);
      }
      if (level.video.qaState !== "QA_PASSED") {
        push("NEEDS_VIDEO_QA", level, "video_production", `QA is ${level.video.qaState}`, videoRef);
      } else if (level.video.assessmentEvidenceStale || level.video.contractEvidenceStale) {
        push(
          "NEEDS_VIDEO_QA",
          level,
          "video_production",
          `QA passed but the evidence is stale (${level.video.coherenceReason})`,
          videoRef,
        );
      }
    }

    if (handoff.ready) {
      // APPROVED means a human approved durable editorial material. A level with
      // no editorial requirement has nothing to approve and says so.
      const approvedContent = requiresLearnerContent(level) && level.content?.editorialState === "approved";
      const approvedAssessment = isVideoLesson(level) && level.assessment?.editorialState === "approved";
      if (approvedContent || approvedAssessment) {
        const approved = [
          approvedContent ? "lesson" : null,
          approvedAssessment ? "question bank" : null,
        ].filter((part): part is string => part !== null);
        push(
          "APPROVED_READY_FOR_HANDOFF",
          level,
          "structure",
          `approved ${approved.join(" and ")}; every required editorial dimension is satisfied`,
        );
      } else {
        push(
          "EDITORIAL_HANDOFF_NOT_REQUIRED",
          level,
          "structure",
          "source-owned level: it carries no learner-authored material, so there is nothing to approve",
        );
      }
    }
  }

  // Deterministic order: bucket, then level, then aggregate. Two runs against an
  // unchanged database produce byte-identical output.
  const bucketRank = new Map(WORK_QUEUE_BUCKETS.map((bucket, index) => [bucket, index] as const));
  entries.sort((a, b) => {
    const byBucket = (bucketRank.get(a.bucket) ?? 0) - (bucketRank.get(b.bucket) ?? 0);
    if (byBucket !== 0) return byBucket;
    if (a.levelNumber !== b.levelNumber) return a.levelNumber - b.levelNumber;
    return a.aggregate.localeCompare(b.aggregate);
  });

  return entries;
}

export function countWorkQueue(entries: readonly WorkQueueEntry[]): Record<WorkQueueBucket, number> {
  const counts = Object.fromEntries(WORK_QUEUE_BUCKETS.map((b) => [b, 0])) as Record<
    WorkQueueBucket,
    number
  >;
  for (const entry of entries) counts[entry.bucket] += 1;
  return counts;
}
