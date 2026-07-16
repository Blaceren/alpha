import { createHash } from "node:crypto";
import {
  Prisma,
  type CurriculumXpSourceType,
  type PrismaClient,
  type UserLevelProgressStatus,
} from "@prisma/client";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
  isCurriculumV2XpEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { CURRICULUM_AUDIT_ACTIONS, DEFAULT_CURRICULUM_CODE } from "./constants";
import {
  validatePinnedEnrollmentSnapshot,
  type EnrollmentResolutionGraph,
} from "./resolver";
import {
  isCurriculumXpError,
  recordCurriculumXpInTransaction,
  resolveEnrollmentXp,
  verifyCurriculumXpAwardInTransaction,
  type CurriculumXpTransactionSummary,
} from "./xp";

const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const MAX_SOURCE_ID_LENGTH = 200;
const UNSAFE_REVIEW_TEXT = /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:/i;

export type CurriculumLevelCompletionSource = Extract<
  CurriculumXpSourceType,
  | "level_completion"
  | "assessment_pass"
  | "report_approval"
  | "mentor_completion"
>;

const COMPLETION_SOURCES = new Set<string>([
  "level_completion",
  "assessment_pass",
  "report_approval",
  "mentor_completion",
]);

type OwnerRule = {
  initialStatus: UserLevelProgressStatus;
  pairs: ReadonlySet<string>;
};

// Only mappings already made unambiguous by the V2 definition vocabulary are
// accepted. Scenario/practice/external/checkpoint definitions remain unavailable
// until their owning phase defines a durable authorization contract.
const OWNER_RULES: Record<CurriculumLevelCompletionSource, OwnerRule> = {
  level_completion: {
    initialStatus: "in_progress",
    pairs: new Set(["lesson:lesson", "lesson:manual"]),
  },
  assessment_pass: {
    initialStatus: "in_progress",
    pairs: new Set(["lesson:assessment_pass", "final_exam:assessment_pass"]),
  },
  report_approval: {
    initialStatus: "pending_review",
    pairs: new Set(["report:report_approval"]),
  },
  mentor_completion: {
    initialStatus: "pending_review",
    pairs: new Set(["mentor_review:mentor_review"]),
  },
};

export type CurriculumLevelCompletionErrorCode =
  | "COMPLETION_DISABLED"
  | "COMPLETION_INPUT_INVALID"
  | "COMPLETION_ENROLLMENT_NOT_FOUND"
  | "COMPLETION_ENROLLMENT_CORRUPT"
  | "COMPLETION_LEVEL_NOT_FOUND"
  | "COMPLETION_LEVEL_NOT_CURRENT"
  | "COMPLETION_PROGRESS_NOT_STARTED"
  | "COMPLETION_STATUS_INVALID"
  | "COMPLETION_OWNER_MISMATCH"
  | "COMPLETION_OWNER_UNAVAILABLE"
  | "COMPLETION_REWARD_INVALID"
  | "COMPLETION_IDEMPOTENCY_CONFLICT"
  | "COMPLETION_CONFLICT"
  | "COMPLETION_STATE_CORRUPT"
  | "COMPLETION_INTERNAL_ERROR";

export class CurriculumLevelCompletionError extends Error {
  readonly code: CurriculumLevelCompletionErrorCode;
  readonly retryableCas: boolean;

  constructor(
    code: CurriculumLevelCompletionErrorCode,
    message: string,
    retryableCas = false,
  ) {
    super(message);
    this.name = "CurriculumLevelCompletionError";
    this.code = code;
    this.retryableCas = retryableCas;
  }
}

export function isCurriculumLevelCompletionError(
  error: unknown,
): error is CurriculumLevelCompletionError {
  return error instanceof CurriculumLevelCompletionError;
}

export type CompleteCurriculumLevelInput = {
  enrollmentId: number;
  levelDefinitionId: number;
  sourceType: CurriculumLevelCompletionSource;
  sourceId: string;
  actorId?: number | null;
  evaluationTime?: Date;
  db?: Pick<PrismaClient, "$transaction">;
};

export type CompleteCurriculumLevelInTransactionInput = Omit<
  CompleteCurriculumLevelInput,
  "db"
>;

export type CurriculumLevelCompletedResult = {
  kind: "completed";
  created: boolean;
  enrollmentId: number;
  levelNumber: number;
  stableCode: string;
  xpAwarded: number;
  xpTransactionId: number;
  nextLevelNumber: number | null;
  terminal: boolean;
  completedAt: Date;
};

export type CompleteCurriculumLevelResult =
  | CurriculumLevelCompletedResult
  | { kind: "disabled"; code: "COMPLETION_DISABLED" }
  | {
      kind: "rejected";
      code: Exclude<
        CurriculumLevelCompletionErrorCode,
        | "COMPLETION_DISABLED"
        | "COMPLETION_IDEMPOTENCY_CONFLICT"
        | "COMPLETION_CONFLICT"
        | "COMPLETION_ENROLLMENT_CORRUPT"
        | "COMPLETION_REWARD_INVALID"
        | "COMPLETION_STATE_CORRUPT"
        | "COMPLETION_INTERNAL_ERROR"
      >;
    }
  | {
      kind: "conflict";
      code: "COMPLETION_IDEMPOTENCY_CONFLICT" | "COMPLETION_CONFLICT";
    }
  | {
      kind: "corrupt";
      code:
        | "COMPLETION_ENROLLMENT_CORRUPT"
        | "COMPLETION_REWARD_INVALID"
        | "COMPLETION_STATE_CORRUPT"
        | "COMPLETION_INTERNAL_ERROR";
    };

type CompletionContext = {
  enrollment: EnrollmentResolutionGraph;
  level: EnrollmentResolutionGraph["curriculumVersion"]["levels"][number];
  progress: EnrollmentResolutionGraph["levelProgress"][number];
  maxLevel: number;
};

function failure(
  code: CurriculumLevelCompletionErrorCode,
  message: string,
  retryableCas = false,
): never {
  throw new CurriculumLevelCompletionError(code, message, retryableCas);
}

function assertFlags() {
  if (
    !isCurriculumV2ReadEnabled() ||
    !isCurriculumV2EnrollmentEnabled() ||
    !isCurriculumV2XpEnabled()
  ) {
    failure("COMPLETION_DISABLED", "curriculum level completion is disabled");
  }
}

function positiveId(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    failure("COMPLETION_INPUT_INVALID", `${field} must be a positive integer`);
  }
  return Number(value);
}

function validatedInput(input: CompleteCurriculumLevelInTransactionInput) {
  const enrollmentId = positiveId(input.enrollmentId, "enrollmentId");
  const levelDefinitionId = positiveId(
    input.levelDefinitionId,
    "levelDefinitionId",
  );
  if (!COMPLETION_SOURCES.has(String(input.sourceType))) {
    failure("COMPLETION_OWNER_MISMATCH", "completion source is not allowed");
  }
  if (typeof input.sourceId !== "string") {
    failure("COMPLETION_INPUT_INVALID", "completion source identity is invalid");
  }
  const sourceId = input.sourceId.trim();
  if (
    sourceId.length === 0 ||
    sourceId.length > MAX_SOURCE_ID_LENGTH ||
    !SOURCE_ID_PATTERN.test(sourceId)
  ) {
    failure("COMPLETION_INPUT_INVALID", "completion source identity is invalid");
  }
  const actorId =
    input.actorId === undefined || input.actorId === null
      ? null
      : positiveId(input.actorId, "actorId");
  const evaluationTime = input.evaluationTime ?? new Date();
  if (
    !(evaluationTime instanceof Date) ||
    Number.isNaN(evaluationTime.getTime())
  ) {
    failure("COMPLETION_INPUT_INVALID", "completion time is invalid");
  }
  return {
    enrollmentId,
    levelDefinitionId,
    sourceType: input.sourceType as CurriculumLevelCompletionSource,
    sourceId,
    actorId,
    evaluationTime: new Date(evaluationTime.getTime()),
  };
}

const completionGraphInclude = {
  curriculumVersion: { include: { modules: true, levels: true } },
  levelProgress: { include: { levelDefinition: true } },
} as const;

function assertSequence(context: CompletionContext) {
  const { enrollment, maxLevel } = context;
  const levelsByNumber = new Map(
    enrollment.curriculumVersion.levels.map((level) => [level.levelNumber, level]),
  );
  const progressByLevel = new Map(
    enrollment.levelProgress.map((progress) => [
      progress.levelDefinition.levelNumber,
      progress,
    ]),
  );
  if (levelsByNumber.size !== maxLevel || maxLevel < 1) {
    failure("COMPLETION_STATE_CORRUPT", "curriculum level sequence is corrupt");
  }
  for (let levelNumber = 1; levelNumber <= maxLevel; levelNumber += 1) {
    if (!levelsByNumber.has(levelNumber)) {
      failure("COMPLETION_STATE_CORRUPT", "curriculum level sequence is corrupt");
    }
  }

  const expectedCurrent = enrollment.highestCompletedLevel + 1;
  if (
    enrollment.currentLevel !== expectedCurrent ||
    (enrollment.status === "active" && enrollment.currentLevel > maxLevel) ||
    (enrollment.status === "completed" &&
      (enrollment.highestCompletedLevel !== maxLevel ||
        enrollment.currentLevel !== maxLevel + 1))
  ) {
    failure("COMPLETION_STATE_CORRUPT", "enrollment summary is inconsistent");
  }

  for (let levelNumber = 1; levelNumber <= maxLevel; levelNumber += 1) {
    const progress = progressByLevel.get(levelNumber);
    if (levelNumber <= enrollment.highestCompletedLevel) {
      if (!progress || progress.status !== "completed" || !progress.completedAt) {
        failure("COMPLETION_STATE_CORRUPT", "completed level sequence is corrupt");
      }
      continue;
    }
    if (levelNumber > enrollment.currentLevel && progress) {
      failure("COMPLETION_STATE_CORRUPT", "future progress creates a sequence gap");
    }
  }
}

async function loadContext(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof validatedInput>,
): Promise<CompletionContext> {
  // Read enum text before Prisma materializes the relation so legacy/manual
  // SQLite corruption is classified as a domain status error instead of an
  // opaque enum decoding failure.
  const rawStatuses = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status"
    FROM "UserLevelProgress"
    WHERE "enrollmentId" = ${input.enrollmentId}
  `);
  if (
    rawStatuses.some(
      ({ status }) =>
        status !== "in_progress" &&
        status !== "pending_review" &&
        status !== "completed",
    )
  ) {
    failure("COMPLETION_STATUS_INVALID", "curriculum progress status is invalid");
  }
  const enrollment = await tx.userCurriculumEnrollment.findUnique({
    where: { id: input.enrollmentId },
    include: completionGraphInclude,
  });
  if (!enrollment) {
    failure("COMPLETION_ENROLLMENT_NOT_FOUND", "curriculum enrollment does not exist");
  }
  const pinIssue = validatePinnedEnrollmentSnapshot(
    enrollment as EnrollmentResolutionGraph,
    DEFAULT_CURRICULUM_CODE,
  );
  if (pinIssue) {
    failure("COMPLETION_ENROLLMENT_CORRUPT", "curriculum enrollment pin is corrupt");
  }
  if (enrollment.status !== "active" && enrollment.status !== "completed") {
    failure("COMPLETION_ENROLLMENT_CORRUPT", "curriculum enrollment is not completable");
  }
  const owner = await tx.user.findUnique({
    where: { id: enrollment.userId },
    select: { id: true, status: true },
  });
  if (!owner || owner.status !== "active") {
    failure("COMPLETION_ENROLLMENT_CORRUPT", "curriculum enrollment owner is invalid");
  }
  const globalLevel = await tx.levelDefinition.findUnique({
    where: { id: input.levelDefinitionId },
    select: { id: true, curriculumVersionId: true },
  });
  if (!globalLevel) {
    failure("COMPLETION_LEVEL_NOT_FOUND", "curriculum level does not exist");
  }
  const level = enrollment.curriculumVersion.levels.find(
    (candidate) => candidate.id === input.levelDefinitionId,
  );
  if (!level || globalLevel.curriculumVersionId !== enrollment.curriculumVersionId) {
    failure("COMPLETION_LEVEL_NOT_CURRENT", "curriculum level is outside the pinned version");
  }
  const moduleDefinition = enrollment.curriculumVersion.modules.find(
    (candidate) => candidate.id === level.moduleId,
  );
  if (
    !moduleDefinition ||
    moduleDefinition.status !== "active" ||
    level.status !== "active"
  ) {
    failure("COMPLETION_STATE_CORRUPT", "curriculum definition is inactive");
  }
  const progress = enrollment.levelProgress.find(
    (candidate) => candidate.levelDefinitionId === level.id,
  );
  if (!progress) {
    if (level.levelNumber !== enrollment.currentLevel) {
      failure("COMPLETION_LEVEL_NOT_CURRENT", "curriculum level is not current");
    }
    failure("COMPLETION_PROGRESS_NOT_STARTED", "curriculum level was not started");
  }
  const maxLevel = enrollment.curriculumVersion.levels.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.levelNumber),
    0,
  );
  const context = {
    enrollment: enrollment as EnrollmentResolutionGraph,
    level,
    progress,
    maxLevel,
  };
  assertSequence(context);
  return context;
}

function assertOwnerRule(
  context: CompletionContext,
  sourceType: CurriculumLevelCompletionSource,
) {
  const { level, progress } = context;
  const rule = OWNER_RULES[sourceType];
  const pair = `${level.type}:${level.completionMethod}`;
  if (!rule.pairs.has(pair)) {
    const mappedOwner = Object.entries(OWNER_RULES).find(([, candidate]) =>
      candidate.pairs.has(pair),
    );
    if (mappedOwner) {
      failure("COMPLETION_OWNER_MISMATCH", "completion source does not own this level");
    }
    failure("COMPLETION_OWNER_UNAVAILABLE", "completion owner is unavailable for this level");
  }
  if (progress.status === "completed") return;
  if (
    progress.status !== "in_progress" &&
    progress.status !== "pending_review"
  ) {
    failure("COMPLETION_STATUS_INVALID", "curriculum progress status is invalid");
  }
  if (progress.status !== rule.initialStatus) {
    failure("COMPLETION_OWNER_MISMATCH", "completion owner does not match progress state");
  }
  if (progress.completedAt || progress.completionEvidence !== null) {
    failure("COMPLETION_STATE_CORRUPT", "curriculum progress fields are inconsistent");
  }
}

const ASSESSMENT_ATTEMPT_SOURCE = /^assessment-attempt:([1-9]\d*)$/;
const REPORT_REVIEW_SOURCE = /^report-review:([1-9]\d*)$/;

async function assertLessonAssessmentProof(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (input.sourceType !== "assessment_pass" || context.level.type !== "lesson") {
    return;
  }
  const match = ASSESSMENT_ATTEMPT_SOURCE.exec(input.sourceId);
  const attemptId = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(attemptId) || attemptId <= 0) {
    failure("COMPLETION_OWNER_MISMATCH", "lesson assessment proof identity is invalid");
  }
  const attempt = await tx.assessmentAttempt.findUnique({ where: { id: attemptId } });
  const assessment = attempt
    ? await tx.assessmentVersion.findUnique({ where: { id: attempt.assessmentVersionId } })
    : null;
  if (
    !attempt ||
    attempt.userId !== context.enrollment.userId ||
    attempt.enrollmentId !== context.enrollment.id ||
    attempt.curriculumVersionId !== context.enrollment.curriculumVersionId ||
    attempt.levelDefinitionId !== context.level.id ||
    attempt.status !== "passed" ||
    !attempt.submittedAt ||
    attempt.durationSeconds === null ||
    attempt.durationSeconds < 0 ||
    attempt.durationSeconds !==
      Math.floor((attempt.submittedAt.getTime() - attempt.startedAt.getTime()) / 1_000) ||
    attempt.totalQuestions === null ||
    attempt.correctCount === null ||
    attempt.scoreBasisPoints === null ||
    attempt.submittedAnswers === null ||
    !attempt.answersFingerprint ||
    !/^sha256:[a-f0-9]{64}$/.test(attempt.answersFingerprint) ||
    !attempt.submitRequestId ||
    !assessment ||
    assessment.id !== attempt.assessmentVersionId ||
    (assessment.status !== "published" && assessment.status !== "archived") ||
    !assessment.publishedAt ||
    assessment.levelDefinitionId !== context.level.id ||
    assessment.curriculumVersionId !== context.enrollment.curriculumVersionId ||
    attempt.totalQuestions <= 0 ||
    attempt.correctCount < 0 ||
    attempt.correctCount > attempt.totalQuestions ||
    attempt.correctCount * 100 <
      assessment.passPercent * attempt.totalQuestions ||
    attempt.scoreBasisPoints !==
      Math.floor((attempt.correctCount * 10_000) / attempt.totalQuestions)
  ) {
    failure("COMPLETION_STATE_CORRUPT", "lesson assessment proof is missing or corrupt");
  }
}

async function assertReportApprovalProof(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (input.sourceType !== "report_approval") return;
  const match = REPORT_REVIEW_SOURCE.exec(input.sourceId);
  const reviewId = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) {
    failure("COMPLETION_OWNER_MISMATCH", "report approval proof identity is invalid");
  }
  const review = await tx.reportReview.findUnique({
    where: { id: reviewId },
    include: {
      reviewer: { select: { id: true, status: true } },
      scores: true,
      submission: {
        include: {
          rubric: { include: { criteria: true, scaleOptions: true } },
          submittedRevision: { select: { id: true, submissionId: true } },
        },
      },
    },
  });
  if (!review) {
    failure("COMPLETION_STATE_CORRUPT", "report approval proof is missing or corrupt");
  }
  const submission = review.submission;
  const pendingProof =
    submission.status === "pending_review" &&
    submission.approvedRevisionId === null &&
    submission.approvedReviewId === null &&
    submission.approvedAt === null &&
    submission.claimedById === review.reviewerId &&
    submission.claimedAt?.getTime() === review.claimedAt?.getTime() &&
    submission.claimExpiresAt?.getTime() === review.claimExpiresAt?.getTime() &&
    submission.claimExpiresAt !== null &&
    submission.claimExpiresAt > input.evaluationTime;
  const approvedProof =
    submission.status === "approved" &&
    submission.approvedRevisionId === review.revisionId &&
    submission.latestReviewId === review.id &&
    submission.approvedReviewId === review.id &&
    submission.reviewedAt !== null &&
    submission.approvedAt !== null &&
    submission.reviewedAt.getTime() === review.reviewedAt.getTime() &&
    submission.approvedAt.getTime() === review.reviewedAt.getTime() &&
    submission.claimedById === null &&
    submission.claimedAt === null &&
    submission.claimExpiresAt === null &&
    submission.reviewStartedAt === null;
  const criteria = new Map(submission.rubric.criteria.map((criterion) => [criterion.id, criterion]));
  const criterionIds = new Set(criteria.keys());
  const scaleIds = new Set(submission.rubric.scaleOptions.map((option) => option.id));
  const scoreCriterionIds = new Set(review.scores.map((score) => score.rubricCriterionId));
  if (
    review.decision !== "approved" ||
    review.rejectionReasonId !== null ||
    review.humanComment !== null ||
    review.correctiveAction !== null ||
    !review.claimedAt ||
    !review.claimExpiresAt ||
    review.reviewedAt < review.claimedAt ||
    review.claimExpiresAt <= review.reviewedAt ||
    !review.reviewer ||
    review.reviewer.status !== "active" ||
    review.reviewerId === submission.userId ||
    review.reviewerRoleSnapshot !== "admin" && review.reviewerRoleSnapshot !== "mentor" ||
    review.revisionId !== submission.submittedRevisionId ||
    !submission.submittedRevision ||
    submission.submittedRevision.id !== review.revisionId ||
    submission.submittedRevision.submissionId !== submission.id ||
    submission.activeRevisionId !== submission.submittedRevisionId ||
    submission.userId !== context.enrollment.userId ||
    submission.enrollmentId !== context.enrollment.id ||
    submission.curriculumVersionId !== context.enrollment.curriculumVersionId ||
    submission.levelDefinitionId !== context.level.id ||
    submission.userLevelProgressId !== context.progress.id ||
    review.curriculumVersionId !== submission.curriculumVersionId ||
    review.levelDefinitionId !== submission.levelDefinitionId ||
    review.reportAssignmentVersionId !== submission.reportAssignmentVersionId ||
    review.reportRubricVersionId !== submission.reportRubricVersionId ||
    submission.rubric.id !== submission.reportRubricVersionId ||
    submission.rubric.reportAssignmentVersionId !== submission.reportAssignmentVersionId ||
    !/^sha256:[a-f0-9]{64}$/.test(review.payloadFingerprint) ||
    review.requestId.length < 8 ||
    criterionIds.size === 0 ||
    scaleIds.size === 0 ||
    review.scores.length !== criterionIds.size ||
    scoreCriterionIds.size !== criterionIds.size ||
    review.scores.some((score) => {
      const criterion = criteria.get(score.rubricCriterionId);
      return score.reportRubricVersionId !== submission.reportRubricVersionId ||
        !criterion || !scaleIds.has(score.rubricScaleOptionId) ||
        (criterion.commentRequired && (!score.comment || score.comment.trim().length === 0)) ||
        (score.comment !== null && (score.comment.length > 4_000 || UNSAFE_REVIEW_TEXT.test(score.comment)));
    }) ||
    (!pendingProof && !approvedProof)
  ) {
    failure("COMPLETION_STATE_CORRUPT", "report approval proof is missing or corrupt");
  }
}

function assertReward(context: CompletionContext) {
  if (!Number.isInteger(context.level.xpReward) || context.level.xpReward <= 0) {
    failure("COMPLETION_REWARD_INVALID", "curriculum level reward is invalid");
  }
}

function xpInput(
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  return {
    enrollmentId: context.enrollment.id,
    levelDefinitionId: context.level.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    amount: context.level.xpReward,
    actorId: input.actorId,
  };
}

function mapXpError(error: unknown): never {
  if (!isCurriculumXpError(error)) throw error;
  switch (error.code) {
    case "XP_DISABLED":
      return failure("COMPLETION_DISABLED", "curriculum level completion is disabled");
    case "XP_INPUT_INVALID":
    case "XP_SOURCE_INVALID":
      return failure("COMPLETION_INPUT_INVALID", "completion XP identity is invalid");
    case "XP_ACTOR_INVALID":
      return failure("COMPLETION_OWNER_MISMATCH", "completion actor is invalid");
    case "XP_IDEMPOTENCY_CONFLICT":
    case "XP_SOURCE_CONFLICT":
      return failure(
        "COMPLETION_IDEMPOTENCY_CONFLICT",
        "completion identity conflicts with durable XP",
      );
    case "XP_ENROLLMENT_NOT_FOUND":
    case "XP_ENROLLMENT_CORRUPT":
    case "XP_LEVEL_VERSION_MISMATCH":
    case "XP_TOTAL_CORRUPT":
      return failure("COMPLETION_STATE_CORRUPT", "completion XP state is corrupt");
    case "XP_INTERNAL_ERROR":
      return failure("COMPLETION_INTERNAL_ERROR", "curriculum level completion failed");
  }
}

async function levelXpRows(tx: Prisma.TransactionClient, context: CompletionContext) {
  return tx.xPTransaction.findMany({
    where: {
      enrollmentId: context.enrollment.id,
      levelDefinitionId: context.level.id,
      sourceType: { in: [...COMPLETION_SOURCES] as CurriculumXpSourceType[] },
    },
    orderBy: { id: "asc" },
  });
}

function completedResult(
  context: CompletionContext,
  transaction: CurriculumXpTransactionSummary,
  completedAt: Date,
  created: boolean,
): CurriculumLevelCompletedResult {
  const terminal = context.level.levelNumber === context.maxLevel;
  return {
    kind: "completed",
    created,
    enrollmentId: context.enrollment.id,
    levelNumber: context.level.levelNumber,
    stableCode: context.level.stableCode,
    xpAwarded: context.level.xpReward,
    xpTransactionId: transaction.id,
    nextLevelNumber: terminal ? null : context.level.levelNumber + 1,
    terminal,
    completedAt: new Date(completedAt.getTime()),
  };
}

async function verifyCompletedRetry(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (!context.progress.completedAt) {
    failure("COMPLETION_STATE_CORRUPT", "completed progress has no completion time");
  }
  const ledger = await resolveEnrollmentXp({
    enrollmentId: context.enrollment.id,
    db: tx,
  });
  if (ledger.kind !== "available") {
    failure("COMPLETION_STATE_CORRUPT", "completion XP ledger is corrupt");
  }
  const rows = await levelXpRows(tx, context);
  if (rows.length === 0) {
    failure("COMPLETION_STATE_CORRUPT", "completed progress has no durable XP award");
  }
  if (rows.length !== 1) {
    failure("COMPLETION_STATE_CORRUPT", "completed progress has ambiguous XP awards");
  }
  let verified;
  try {
    verified = await verifyCurriculumXpAwardInTransaction(
      tx,
      xpInput(context, input),
    );
  } catch (error) {
    mapXpError(error);
  }
  if (verified.kind === "missing") {
    failure("COMPLETION_CONFLICT", "completed level has a different owner identity");
  }
  return completedResult(
    context,
    verified.transaction,
    context.progress.completedAt,
    false,
  );
}

async function runCompletionTransaction(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof validatedInput>,
): Promise<CurriculumLevelCompletedResult> {
  const context = await loadContext(tx, input);
  assertOwnerRule(context, input.sourceType);
  await assertLessonAssessmentProof(tx, context, input);
  await assertReportApprovalProof(tx, context, input);
  assertReward(context);

  if (context.progress.status === "completed") {
    return verifyCompletedRetry(tx, context, input);
  }
  if (context.enrollment.status !== "active") {
    failure("COMPLETION_CONFLICT", "completed enrollment cannot accept a new completion");
  }
  if (context.level.levelNumber !== context.enrollment.currentLevel) {
    failure("COMPLETION_LEVEL_NOT_CURRENT", "curriculum level is not current");
  }
  if ((await levelXpRows(tx, context)).length !== 0) {
    failure("COMPLETION_STATE_CORRUPT", "XP exists before progress completion");
  }

  const progressClaim = await tx.userLevelProgress.updateMany({
    where: {
      id: context.progress.id,
      enrollmentId: context.enrollment.id,
      levelDefinitionId: context.level.id,
      status: OWNER_RULES[input.sourceType].initialStatus,
      completedAt: null,
      completionEvidence: { equals: Prisma.DbNull },
    },
    data: {
      status: "completed",
      completedAt: input.evaluationTime,
      lastProgressAt: input.evaluationTime,
    },
  });
  if (progressClaim.count !== 1) {
    failure("COMPLETION_CONFLICT", "completion progress claim lost", true);
  }

  let xpAward;
  try {
    xpAward = await recordCurriculumXpInTransaction(tx, xpInput(context, input));
  } catch (error) {
    mapXpError(error);
  }
  if (!xpAward.created) {
    failure("COMPLETION_STATE_CORRUPT", "XP existed before progress completion");
  }

  const terminal = context.level.levelNumber === context.maxLevel;
  const nextCurrentLevel = context.level.levelNumber + 1;
  const enrollmentClaim = await tx.userCurriculumEnrollment.updateMany({
    where: {
      id: context.enrollment.id,
      status: "active",
      currentLevel: context.enrollment.currentLevel,
      highestCompletedLevel: context.enrollment.highestCompletedLevel,
      completedAt: null,
    },
    data: {
      status: terminal ? "completed" : "active",
      highestCompletedLevel: context.level.levelNumber,
      currentLevel: nextCurrentLevel,
      lastMeaningfulActionAt: input.evaluationTime,
      completedAt: terminal ? input.evaluationTime : null,
    },
  });
  if (enrollmentClaim.count !== 1) {
    failure("COMPLETION_CONFLICT", "completion enrollment claim lost", true);
  }

  const sourceIdHash = `sha256:${createHash("sha256")
    .update(input.sourceId, "utf8")
    .digest("hex")}`;
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.levelCompleted,
      entityType: "UserLevelProgress",
      entityId: String(context.progress.id),
      metadata: {
        enrollmentId: context.enrollment.id,
        userId: context.enrollment.userId,
        curriculumVersionId: context.enrollment.curriculumVersionId,
        levelDefinitionId: context.level.id,
        levelNumber: context.level.levelNumber,
        stableCode: context.level.stableCode,
        sourceType: input.sourceType,
        sourceIdHash,
        actorId: input.actorId,
        xpTransactionId: xpAward.transaction.id,
        xpAwarded: context.level.xpReward,
        previousCurrentLevel: context.enrollment.currentLevel,
        nextCurrentLevel: terminal ? null : nextCurrentLevel,
        terminal,
      },
    },
  });

  return completedResult(
    context,
    xpAward.transaction,
    input.evaluationTime,
    true,
  );
}

export async function completeCurriculumLevelInTransaction(
  tx: Prisma.TransactionClient,
  rawInput: CompleteCurriculumLevelInTransactionInput,
): Promise<CurriculumLevelCompletedResult> {
  assertFlags();
  const input = validatedInput(rawInput);
  return runCompletionTransaction(tx, input);
}

function asFailureResult(
  error: CurriculumLevelCompletionError,
): CompleteCurriculumLevelResult {
  if (error.code === "COMPLETION_DISABLED") {
    return { kind: "disabled", code: error.code };
  }
  if (
    error.code === "COMPLETION_IDEMPOTENCY_CONFLICT" ||
    error.code === "COMPLETION_CONFLICT"
  ) {
    return { kind: "conflict", code: error.code };
  }
  if (
    error.code === "COMPLETION_ENROLLMENT_CORRUPT" ||
    error.code === "COMPLETION_REWARD_INVALID" ||
    error.code === "COMPLETION_STATE_CORRUPT" ||
    error.code === "COMPLETION_INTERNAL_ERROR"
  ) {
    return { kind: "corrupt", code: error.code };
  }
  return { kind: "rejected", code: error.code };
}

export async function completeCurriculumLevel({
  db = prisma,
  ...rawInput
}: CompleteCurriculumLevelInput): Promise<CompleteCurriculumLevelResult> {
  try {
    assertFlags();
    const input = validatedInput(rawInput);
    try {
      return await db.$transaction((tx) => runCompletionTransaction(tx, input));
    } catch (error) {
      if (
        isCurriculumLevelCompletionError(error) &&
        error.retryableCas
      ) {
        return await db.$transaction((tx) => runCompletionTransaction(tx, input));
      }
      throw error;
    }
  } catch (error) {
    if (isCurriculumLevelCompletionError(error)) return asFailureResult(error);
    // Unknown database/infrastructure failures remain visible to the trusted
    // owner so they cannot be mistaken for an idempotent completion.
    throw error;
  }
}
