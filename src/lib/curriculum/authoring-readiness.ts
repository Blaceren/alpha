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
import type { AuthoringLevelSummary } from "@/lib/curriculum/authoring-read";

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
      if (level.assessment.conflictCount > 0) blockers.push("ASSESSMENT_SOURCE_CONFLICT");
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
  /** Total field-level Blueprint disagreements across the curriculum. */
  assessmentConflictRecords: number;

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
  };

  for (const level of levels) {
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
  "NEEDS_ASSESSMENT_APPROVAL",
  "SOURCE_BACKED_AWAITING_REVIEW",
  "SOURCE_CONFLICT",
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

export type WorkQueueEntry = {
  bucket: WorkQueueBucket;
  levelNumber: number;
  stableCode: string;
  aggregate: "content" | "assessment" | "video_production" | "structure";
  reason: string;
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
  ) => {
    entries.push({
      bucket,
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      aggregate,
      reason,
    });
  };

  for (const level of levels) {
    const handoff = levelHandoffStatus(level);

    if (handoff.blockers.includes("STRUCTURE_NOT_CANONICAL")) {
      push(
        "NEEDS_PRODUCT_DECISION",
        level,
        "structure",
        `stableCode "${level.stableCode}" is not the canonical code for level ${level.levelNumber}`,
      );
    }

    /* ------------------------------------------------------------ content */
    if (level.content?.editorialState === "changes_requested") {
      push("CHANGES_REQUESTED", level, "content", "reviewer returned the lesson for changes");
    } else if (level.content?.editorialState === "submitted_for_review") {
      push("READY_FOR_CONTENT_REVIEW", level, "content", "lesson is awaiting a reviewer");
    } else if (requiresLearnerContent(level)) {
      if (!level.content || !level.content.hasLocalization) {
        push("NEEDS_FULL_CONTENT", level, "content", "no learner lesson exists for this level");
      } else if (level.content.teachingCharacters < MIN_EDITORIAL_TEACHING_CHARACTERS) {
        push(
          "NEEDS_FULL_CONTENT",
          level,
          "content",
          `${level.content.teachingCharacters} teaching characters — below the ${MIN_EDITORIAL_TEACHING_CHARACTERS} ATA editorial floor`,
        );
      }
    }

    /* --------------------------------------------------------- assessment */
    if (level.assessment?.editorialState === "changes_requested") {
      push("CHANGES_REQUESTED", level, "assessment", "reviewer returned the bank for changes");
    } else if (level.assessment) {
      switch (level.assessment.provenance) {
        case "CONFLICTING":
          push(
            "SOURCE_CONFLICT",
            level,
            "assessment",
            `${level.assessment.conflictCount} field-level disagreements between the Blueprint proposal and the approved bank`,
          );
          break;
        case "SOURCE_BACKED":
          push(
            "SOURCE_BACKED_AWAITING_REVIEW",
            level,
            "assessment",
            level.assessment.sourceApproval === "AWAITING_APPROVAL"
              ? "source-backed bank whose source records AWAITING_APPROVAL"
              : "source-backed bank with no editorial approval recorded",
          );
          break;
        case "PROPOSED_CANON":
          push(
            "NEEDS_ASSESSMENT_APPROVAL",
            level,
            "assessment",
            "PROPOSED_CANON bank — a Blueprint proposal nobody has approved",
          );
          break;
        case "LOCAL_DRAFT":
          push(
            "NEEDS_ASSESSMENT_APPROVAL",
            level,
            "assessment",
            "bank has no canonical provenance and no editorial approval",
          );
          break;
        default:
          break;
      }
    } else if (isVideoLesson(level)) {
      push(
        "NEEDS_FULL_CONTENT",
        level,
        "assessment",
        "video+assessment lesson with no question bank",
      );
    }

    /* -------------------------------------------------------------- video */
    if (level.video) {
      if (level.video.scriptState === "SCRIPT_PENDING") {
        push("NEEDS_VIDEO_SCRIPT", level, "video_production", "script is SCRIPT_PENDING");
      }
      if (level.video.videoState === "NOT_RECORDED") {
        push("NEEDS_VIDEO_ASSET", level, "video_production", "video is NOT_RECORDED");
      }
      if (level.video.qaState !== "QA_PASSED") {
        push("NEEDS_VIDEO_QA", level, "video_production", `QA is ${level.video.qaState}`);
      } else if (level.video.assessmentEvidenceStale || level.video.contractEvidenceStale) {
        push(
          "NEEDS_VIDEO_QA",
          level,
          "video_production",
          `QA passed but the evidence is stale (${level.video.coherenceReason})`,
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
