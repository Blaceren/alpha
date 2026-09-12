/**
 * Synthetic report graphs for the learner review-history tests.
 *
 * Every row here is invented. No real learner, no real answer text and no real
 * mentor comment appears in this file or in anything it creates, and nothing it
 * does touches a live database: callers pass their own client, pointed at a
 * throwaway SQLite file.
 *
 * The shapes it builds are the ones `inspectSubmission` accepts. That checker is
 * a corruption detector, so a seed that cuts a corner reads back as `corrupt`
 * and proves nothing — which is why the fingerprint below is computed the same
 * way the product computes it rather than stubbed.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const FIXTURE_LOCALE = "ru";

/**
 * The submission invariants this seed must satisfy are the ones
 * `inspectSubmission` enforces: revisions numbered 1..N with no gaps, a real
 * content fingerprint, every submitted revision derived from the draft below
 * it, and the status pointers agreeing with the status. A seed that cheats any
 * of them reads back as `corrupt`, which would prove nothing about the field
 * under test.
 */
const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
};
const fingerprintOf = (content: Record<string, unknown>) =>
  `sha256:${createHash("sha256").update(stableJson({ version: 1, fieldValues: content })).digest("hex")}`;

/** The one synthetic answer every seeded revision carries. Never real work. */
const CONTENT = { note: "synthetic value" } as const;
const FINGERPRINT = fingerprintOf(CONTENT);

/** Rows a scenario asks for, in the order a learner produced them. */
export type Step =
  | { draft: number }
  | { submit: number }
  | {
      review: "approved" | "rejected";
      of: number;
      at: string;
      /**
       * Fill the rejection-shaped columns even on an ACCEPTANCE. The database
       * allows it — nothing stops a reviewer leaving a note when they accept —
       * so the projection has to be tested against a row that has them rather
       * than against one that happens to be empty.
       */
      carriesRejectionColumns?: boolean;
    };

let nextUser = 1000;
// Levels must form a contiguous 1..N sequence inside the version, or the
// resolver reports `invalid_level_sequence` before any report is read.
let nextLevel = 1;

/**
 * ONE published curriculum, shared by every scenario, because that is the shape
 * the resolvers expect: a learner is enrolled in the default programme, and the
 * levels differ, not the programme.
 */
/**
 * EACH SCENARIO GETS ITS OWN PUBLISHED VERSION, holding exactly one level,
 * numbered 1. Two reasons, both learned from the resolver rather than guessed:
 * level numbers must form a contiguous 1..N sequence inside a version, and a
 * level after the first is gated on the one before it — which would leave every
 * scenario but the first locked before its report could be read. The enrolment
 * still carries the default curriculum code, which is what the context resolver
 * filters on.
 */
async function newCurriculum(db: PrismaClient, versionNumber: number) {
  const version = await db.curriculumVersion.create({
    data: {
      code: "ata-v2", name: "ATA", versionNumber, status: "published",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      publishedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });
  const moduleRow = await db.moduleDefinition.create({
    data: { curriculumVersionId: version.id, moduleNumber: 1, code: "m01", title: "M", firstLevel: 1, lastLevel: 2 },
  });
  return { versionId: version.id, moduleId: moduleRow.id };
}

export async function seedReportScenario(
  db: PrismaClient,
  steps: Step[],
  options: { status: "draft" | "pending_review" | "rejected" | "approved" },
) {
  const userId = nextUser++;
  const levelNumber = nextLevel++;
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { versionId, moduleId } = await newCurriculum(db, levelNumber);

  const user = await db.user.create({
    data: { id: userId, email: `learner${userId}@example.invalid`, name: `L${userId}`, updatedAt: now },
  });
  const level = await db.levelDefinition.create({
    data: {
      curriculumVersionId: versionId, moduleId, levelNumber: 1,
      // The selector regex requires exactly three digits and a lowercase slug.
      stableCode: `v2.l001.report`, type: "report", title: "R", completionMethod: "report_approval",
    },
  });
  /* A second level exists so an accepted report can sit BEHIND the learner's
     current level: the summary check rejects a completed level that is at or
     after `currentLevel`, and a version with one level leaves nowhere to be. */
  await db.levelDefinition.create({
    data: {
      curriculumVersionId: versionId, moduleId, levelNumber: 2,
      stableCode: "v2.l002.next", type: "lesson", title: "N", completionMethod: "manual",
      requiredPreviousLevel: 1,
    },
  });
  const done = options.status === "approved";
  const enrollment = await db.userCurriculumEnrollment.create({
    data: {
      userId: user.id, curriculumVersionId: versionId, curriculumCode: "ata-v2", updatedAt: now,
      currentLevel: done ? 2 : 1, highestCompletedLevel: done ? 1 : 0,
    },
  });
  const progressStatus =
    options.status === "pending_review" ? "pending_review" : options.status === "approved" ? "completed" : "in_progress";
  const progress = await db.userLevelProgress.create({
    data: {
      enrollmentId: enrollment.id, curriculumVersionId: versionId, levelDefinitionId: level.id,
      status: progressStatus, updatedAt: now,
      ...(progressStatus === "completed" ? { completedAt: new Date("2026-01-09T00:00:00.000Z") } : {}),
    },
  });
  const assignment = await db.reportAssignmentVersion.create({
    data: {
      levelDefinitionId: level.id, curriculumVersionId: versionId, versionNumber: 1, updatedAt: now,
      status: "published", publishedAt: new Date("2025-06-01T00:00:00.000Z"),
    },
  });
  await db.reportAssignmentLocalization.create({
    data: {
      reportAssignmentVersionId: assignment.id, locale: FIXTURE_LOCALE, title: "T", instructions: "I",
      successCriteriaSummary: "S", submitLabel: "Отправить", updatedAt: now,
    },
  });
  const field = await db.reportFieldDefinition.create({
    data: { reportAssignmentVersionId: assignment.id, stableKey: "note", type: "long_text", sortOrder: 1, updatedAt: now },
  });
  await db.reportFieldLocalization.create({
    data: { reportFieldDefinitionId: field.id, locale: FIXTURE_LOCALE, label: "N", helpText: "H", placeholder: "P", updatedAt: now },
  });
  const rubric = await db.reportRubricVersion.create({
    data: {
      reportAssignmentVersionId: assignment.id, versionNumber: 1, updatedAt: now,
      status: "published", publishedAt: new Date("2025-06-01T00:00:00.000Z"),
    },
  });
  /* The definition graph is refused outright unless the rubric has at least one
     criterion and one scale option, each localized. */
  const criterion = await db.reportRubricCriterion.create({
    data: { reportRubricVersionId: rubric.id, stableKey: "clarity", categoryCode: "process", sortOrder: 1, updatedAt: now },
  });
  await db.reportRubricCriterionLocalization.create({
    data: { reportRubricCriterionId: criterion.id, locale: FIXTURE_LOCALE, title: "Ясность", description: "D" },
  });
  const scale = await db.reportRubricScaleOption.create({
    data: { reportRubricVersionId: rubric.id, stableKey: "ok", ordinal: 1 },
  });
  await db.reportRubricScaleOptionLocalization.create({
    data: { reportRubricScaleOptionId: scale.id, locale: FIXTURE_LOCALE, label: "OK", description: "D" },
  });
  const reason = await db.reportRejectionReason.create({
    data: { reportRubricVersionId: rubric.id, stableKey: "detail", sortOrder: 1, updatedAt: now },
  });
  await db.reportRejectionReasonLocalization.create({
    data: { reportRejectionReasonId: reason.id, locale: FIXTURE_LOCALE, title: "Нужна конкретика", guidance: "G" },
  });

  const submission = await db.reportSubmission.create({
    data: {
      userId: user.id, enrollmentId: enrollment.id, curriculumVersionId: versionId,
      levelDefinitionId: level.id, userLevelProgressId: progress.id,
      reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id,
      status: options.status, workflowVersion: steps.length, updatedAt: now,
    },
  });

  const byNumber = new Map<number, number>();
  let latestReviewId: number | null = null;
  let approvedReviewId: number | null = null;
  let submittedId: number | null = null;
  let approvedId: number | null = null;
  let activeId = 0;
  let lastDraftId: number | null = null;
  let firstSubmittedAt: Date | null = null;
  let submittedAt: Date | null = null;
  let reviewedAt: Date | null = null;
  let rejectedAt: Date | null = null;
  let approvedAt: Date | null = null;

  for (const step of steps) {
    if ("draft" in step) {
      const revision: { id: number } = await db.reportRevision.create({
        data: {
          submissionId: submission.id, revisionNumber: step.draft, kind: "draft_autosave",
          content: CONTENT, contentFingerprint: FINGERPRINT, createdById: user.id,
          ...(lastDraftId !== null || submittedId !== null
            ? { sourceRevisionId: submittedId ?? lastDraftId }
            : {}),
        },
      });
      byNumber.set(step.draft, revision.id);
      lastDraftId = revision.id;
      activeId = revision.id;
    } else if ("submit" in step) {
      const n = step.submit;
      const at = new Date(`2026-01-0${n}T10:00:00.000Z`);
      const revision: { id: number } = await db.reportRevision.create({
        data: {
          submissionId: submission.id, revisionNumber: n,
          kind: submittedId === null ? "initial_submission" : "resubmission",
          content: CONTENT, contentFingerprint: FINGERPRINT, createdById: user.id,
          submittedAt: at, sourceRevisionId: lastDraftId,
        },
      });
      byNumber.set(n, revision.id);
      submittedId = revision.id;
      activeId = revision.id;
      firstSubmittedAt = firstSubmittedAt ?? at;
      submittedAt = at;
    } else {
      const revisionId = byNumber.get(step.of)!;
      const at = new Date(step.at);
      const review = await db.reportReview.create({
        data: {
          submissionId: submission.id, revisionId,
          curriculumVersionId: versionId, levelDefinitionId: level.id,
          reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id,
          reviewerId: null, reviewerRoleSnapshot: "mentor",
          decision: step.review,
          humanComment: step.review === "rejected" || step.carriesRejectionColumns ? "synthetic comment" : null,
          correctiveAction:
            step.review === "rejected" || step.carriesRejectionColumns ? "synthetic corrective action" : null,
          rejectionReasonId: step.review === "rejected" || step.carriesRejectionColumns ? reason.id : null,
          requestId: `req-${submission.id}-${step.of}-${step.review}`,
          payloadFingerprint: FINGERPRINT,
          reviewedAt: at,
        },
      });
      latestReviewId = review.id;
      reviewedAt = at;
      if (step.review === "approved") { approvedReviewId = review.id; approvedId = revisionId; approvedAt = at; }
      else { rejectedAt = at; }
    }
  }

  await db.reportSubmission.update({
    where: { id: submission.id },
    data: {
      activeRevisionId: activeId,
      submittedRevisionId: options.status === "draft" ? null : submittedId,
      approvedRevisionId: options.status === "approved" ? approvedId : null,
      latestReviewId: options.status === "draft" || options.status === "pending_review" ? null : latestReviewId,
      approvedReviewId: options.status === "approved" ? approvedReviewId : null,
      firstSubmittedAt: options.status === "draft" ? null : firstSubmittedAt,
      submittedAt: options.status === "draft" ? null : submittedAt,
      reviewedAt: options.status === "draft" || options.status === "pending_review" ? null : reviewedAt,
      rejectedAt: options.status === "rejected" ? rejectedAt : null,
      approvedAt: options.status === "approved" ? approvedAt : null,
    },
  });

  return { userId: user.id, levelNumber, stableCode: level.stableCode, submissionId: submission.id };
}

