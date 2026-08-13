/**
 * G4-GROWTH — the emitters that turn accepted product facts into growth events.
 *
 * ONE PLACE, SO THE FUNNEL CANNOT DRIFT. Each function here takes an owner row
 * that has ALREADY been written by its accepted owner, and records the growth
 * event for it. None of them decides anything: not whether a level is complete,
 * not whether an assessment passed, not whether a report was approved. They read
 * a decision and project it.
 *
 * EVERY ONE OF THEM IS SAFE TO CALL TWICE. The keys come from `event-keys.ts`
 * and the unique index does the rest, which is what makes it correct to call
 * them after a transaction has committed rather than inside it — a retry, a
 * reconciliation sweep and a replayed request all converge on one event.
 *
 * EVERY ONE OF THEM IS SAFE TO FAIL. They use the swallowing emitter, because a
 * learner's level completion must not be rolled back because the row counting it
 * could not be written. The registration path is the single deliberate
 * exception, and it says so at its own call site.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { emitGrowthEventSafely, type GrowthEmitResult } from "@/lib/growth/emit";
import {
  assessmentAttemptSourceEventId,
  enrollmentSourceEventId,
  clickSourceEventId,
  progressSourceEventId,
  reportSubmissionSourceEventId,
} from "@/lib/growth/event-keys";

type GrowthWriter = Pick<Prisma.TransactionClient, "growthEvent" | "growthEventOutbox">;

/**
 * A qualified acquisition click.
 *
 * ONLY QUALIFIED CLICKS PRODUCE AN EVENT. A prefetch was made by a machine and an
 * authenticated-user click can never be attributed — the accepted click model
 * makes both permanently unattributable at the database level, and emitting
 * events for them would put traffic into the funnel that can never convert,
 * depressing every downstream rate for a reason no reader could see.
 */
export async function emitTrafficClickEvent(
  tx: GrowthWriter,
  input: {
    affiliateClickId: number;
    classification: string;
    occurredAt: Date;
  },
): Promise<GrowthEmitResult | null> {
  if (input.classification !== "qualified") return null;

  return emitGrowthEventSafely(tx, {
    eventType: "traffic_click",
    occurredAt: input.occurredAt,
    sourceEventId: clickSourceEventId(input.affiliateClickId),
    sourceEntityId: input.affiliateClickId,
    acquisitionClickId: input.affiliateClickId,
    metadata: { classification: input.classification },
  });
}

/** A learner enrolled in a curriculum. */
export async function emitCurriculumEnrollmentEvent(
  tx: GrowthWriter,
  input: { enrollmentId: number; userId: number; occurredAt: Date },
): Promise<GrowthEmitResult> {
  return emitGrowthEventSafely(tx, {
    eventType: "curriculum_enrollment",
    occurredAt: input.occurredAt,
    sourceEventId: enrollmentSourceEventId(input.enrollmentId),
    sourceEntityId: input.enrollmentId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
  });
}

export type LevelEventInput = {
  userLevelProgressId: number;
  enrollmentId: number;
  userId: number;
  levelDefinitionId: number;
  levelNumber: number;
  occurredAt: Date;
};

export async function emitLevelStartedEvent(
  tx: GrowthWriter,
  input: LevelEventInput,
): Promise<GrowthEmitResult> {
  return emitGrowthEventSafely(tx, {
    eventType: "level_started",
    occurredAt: input.occurredAt,
    sourceEventId: progressSourceEventId(input.userLevelProgressId),
    sourceEntityId: input.userLevelProgressId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
    levelDefinitionId: input.levelDefinitionId,
    levelNumber: input.levelNumber,
  });
}

/**
 * A completed level, and — if it is the first for this enrollment — activation.
 *
 * ACTIVATION IS DEFINED AS THE FIRST COMPLETED LEVEL. §12 permits an
 * `academy_activation` event only if its semantics can be defined from real
 * product events, and this is the definition that can: a learner who has
 * finished something has done more than open an account. It is deliberately not
 * a login, not a page view and not a heuristic about engagement, none of which
 * this platform records as a durable product fact.
 *
 * The activation key is the ENROLLMENT, so however many levels are later
 * completed, exactly one activation exists. The unique index enforces that
 * rather than this function's ordering assumptions.
 */
export async function emitLevelCompletedEvent(
  tx: GrowthWriter,
  input: LevelEventInput & { completionMethod?: string | null },
): Promise<{ completion: GrowthEmitResult; activation: GrowthEmitResult }> {
  const completion = await emitGrowthEventSafely(tx, {
    eventType: "level_completed",
    occurredAt: input.occurredAt,
    sourceEventId: progressSourceEventId(input.userLevelProgressId),
    sourceEntityId: input.userLevelProgressId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
    levelDefinitionId: input.levelDefinitionId,
    levelNumber: input.levelNumber,
    metadata: input.completionMethod ? { completionMethod: input.completionMethod } : undefined,
  });

  const activation = await emitGrowthEventSafely(tx, {
    eventType: "academy_activation",
    occurredAt: input.occurredAt,
    sourceEventId: enrollmentSourceEventId(input.enrollmentId),
    sourceEntityId: input.userLevelProgressId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
    levelDefinitionId: input.levelDefinitionId,
    levelNumber: input.levelNumber,
  });

  return { completion, activation };
}

/**
 * A mentor-reviewed level approved by a reviewer.
 *
 * Emitted BESIDE the level completion, not instead of it: "how many levels were
 * completed" and "how many mentor reviews were approved" are different
 * questions, and a mentor-completed level is a true answer to both.
 */
export async function emitMentorReviewApprovedEvent(
  tx: GrowthWriter,
  input: LevelEventInput,
): Promise<GrowthEmitResult> {
  return emitGrowthEventSafely(tx, {
    eventType: "mentor_review_approved",
    occurredAt: input.occurredAt,
    sourceEventId: progressSourceEventId(input.userLevelProgressId),
    sourceEntityId: input.userLevelProgressId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
    levelDefinitionId: input.levelDefinitionId,
    levelNumber: input.levelNumber,
  });
}

/** A learner sent a practical level for mentor review. */
export async function emitMentorReviewSubmittedEvent(
  tx: GrowthWriter,
  input: LevelEventInput,
): Promise<GrowthEmitResult> {
  return emitGrowthEventSafely(tx, {
    eventType: "mentor_review_submitted",
    occurredAt: input.occurredAt,
    sourceEventId: progressSourceEventId(input.userLevelProgressId),
    sourceEntityId: input.userLevelProgressId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
    levelDefinitionId: input.levelDefinitionId,
    levelNumber: input.levelNumber,
  });
}

/**
 * A submitted assessment attempt, passed or failed.
 *
 * BOTH OUTCOMES PRODUCE AN EVENT, with the verdict in metadata. Emitting only
 * passes would make "assessment completion rate" uncomputable, because the
 * denominator — people who actually took it — would not exist anywhere.
 */
export async function emitAssessmentCompletedEvent(
  tx: GrowthWriter,
  input: {
    attemptId: number;
    userId: number;
    enrollmentId: number;
    levelDefinitionId: number;
    levelNumber: number;
    attemptNumber: number;
    passed: boolean;
    occurredAt: Date;
  },
): Promise<GrowthEmitResult> {
  return emitGrowthEventSafely(tx, {
    eventType: "assessment_completed",
    occurredAt: input.occurredAt,
    sourceEventId: assessmentAttemptSourceEventId(input.attemptId),
    sourceEntityId: input.attemptId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
    levelDefinitionId: input.levelDefinitionId,
    levelNumber: input.levelNumber,
    metadata: { attemptNumber: input.attemptNumber, passed: input.passed },
  });
}

export type ReportEventInput = {
  submissionId: number;
  userId: number;
  enrollmentId: number;
  levelDefinitionId: number;
  occurredAt: Date;
};

/**
 * The report workflow holds a level DEFINITION id but not its ordinal, so the
 * two report emitters resolve it themselves rather than making every call site
 * pass a number it would have to look up.
 *
 * A LEVEL WHOSE ORDINAL CANNOT BE RESOLVED PRODUCES AN EVENT WITH NEITHER FIELD,
 * never one with a placeholder. `levelNumber = 0` would satisfy nothing — the
 * database CHECK requires `>= 1` and would refuse the row — and a placeholder
 * that did pass would put a level that does not exist into every funnel.
 */
type LevelReader = Pick<Prisma.TransactionClient, "levelDefinition">;

async function levelColumns(
  tx: LevelReader,
  levelDefinitionId: number,
): Promise<{ levelDefinitionId: number; levelNumber: number } | Record<string, never>> {
  const row = await tx.levelDefinition.findUnique({
    where: { id: levelDefinitionId },
    select: { levelNumber: true },
  });
  return row ? { levelDefinitionId, levelNumber: row.levelNumber } : {};
}

/**
 * A report submitted for review.
 *
 * KEYED ON THE SUBMISSION, so a resubmission after a rejection does not produce
 * a second `report_submitted`. The learner submitted one report and revised it —
 * counting that as two would inflate the submission rate every time a mentor
 * asked for changes.
 */
export async function emitReportSubmittedEvent(
  tx: GrowthWriter & LevelReader,
  input: ReportEventInput,
): Promise<GrowthEmitResult> {
  return emitGrowthEventSafely(tx, {
    eventType: "report_submitted",
    occurredAt: input.occurredAt,
    sourceEventId: reportSubmissionSourceEventId(input.submissionId),
    sourceEntityId: input.submissionId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
    ...(await levelColumns(tx, input.levelDefinitionId)),
  });
}

/** A report approved. Keyed on the submission: a report is approved once. */
export async function emitReportApprovedEvent(
  tx: GrowthWriter & LevelReader,
  input: ReportEventInput & { reviewId: number },
): Promise<GrowthEmitResult> {
  return emitGrowthEventSafely(tx, {
    eventType: "report_approved",
    occurredAt: input.occurredAt,
    sourceEventId: reportSubmissionSourceEventId(input.submissionId),
    sourceEntityId: input.reviewId,
    userId: input.userId,
    enrollmentId: input.enrollmentId,
    ...(await levelColumns(tx, input.levelDefinitionId)),
    metadata: { reviewDecision: "approved" },
  });
}

/**
 * Look up the level ordinal for a progress row.
 *
 * Growth events store `levelNumber` denormalised so a funnel query does not join
 * the curriculum on every read. It is resolved from the definition rather than
 * passed in by callers, so a caller cannot record a level ordinal that disagrees
 * with the curriculum.
 */
export async function resolveLevelOrdinal(
  db: Pick<PrismaClient, "levelDefinition">,
  levelDefinitionId: number,
): Promise<number | null> {
  const row = await db.levelDefinition.findUnique({
    where: { id: levelDefinitionId },
    select: { levelNumber: true },
  });
  return row?.levelNumber ?? null;
}
