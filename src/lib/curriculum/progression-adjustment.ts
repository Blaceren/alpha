/**
 * PHASE-1 ADMIN — administrative FORWARD progression correction.
 *
 * ============================== WHAT THIS IS ==============================
 * An authorized CRM operator moves one learner forward to a level they should
 * already be standing on, and the platform records honestly that an operator —
 * not the learner — is why. It is a correction of a RECORD, never a claim about
 * what the learner did.
 *
 * ========================= WHAT IT IS NOT, PRECISELY =========================
 * It is not "set the learner's level". `UserCurriculumEnrollment.currentLevel`
 * and `highestCompletedLevel` are summary counters that the readers who matter
 * refuse to trust: `tool-access.ts` and `community/access.ts` both derive access
 * from durable `UserLevelProgress` rows and say in their own headers that they
 * will not read the counters. Writing the counters directly would therefore
 * grant nothing, and would leave the enrollment in a shape
 * `deriveEnrolledLevelStates` classifies as CORRUPT — a learner with no
 * available level, no error message, and no way forward. So this service writes
 * neither counter. It completes levels, one at a time, through the canonical
 * engine, and lets the engine move the counters as it always has.
 *
 * ======================= FORWARD ONLY, AND WHAT "TO" MEANS =======================
 * `targetStableCode` names the level the learner will STAND ON afterwards, so
 * moving from X to Y completes X … Y-1 and completes Y itself never. That is
 * not a technicality — it is what lets an operator park a learner exactly AT a
 * financial checkpoint and leave the gate for the authority that owns it.
 *
 * Backward is refused with a typed error and no writes. It is not "not built
 * yet" in the sense of a missing branch: reversing progression would mean
 * deciding what to do with an approved report, a mentor's judgement, a
 * provider's answer about money and an append-only XP ledger whose amounts are
 * CHECK-constrained positive. That is a domain design, not a flag.
 *
 * ========================== THE PROTECTED GATES ==========================
 * `financial_checkpoint:balance_check` and `external_event:pocket_postback` can
 * never be completed here. An operator who "corrects" a learner past one has not
 * corrected a record — they have asserted that money arrived or that a partner
 * witnessed a registration. PREPROD's `staging_attested_*` owners exist for
 * exactly those two gates, they are staging-only, and this service NEVER calls
 * them: merging the two authorities would put a QA affordance behind an
 * operator-facing correction button.
 *
 * A pleasant consequence, verified rather than assumed: every one of the 19 tool
 * unlocks and all 5 Community gates sits on a financial checkpoint, so an
 * administrative correction can never open a tool or a Community space. The
 * preview says so rather than leaving the operator to wonder.
 *
 * ============================== ALL OR NOTHING ==============================
 * Every level in the interval is completed inside ONE transaction. A partial
 * multi-level adjustment would leave a learner somewhere nobody chose, so a
 * failure at level four of five rolls back all four.
 */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  completeCurriculumLevelInTransaction,
  isCurriculumLevelCompletionError,
  type CurriculumLevelCompletionErrorCode,
} from "./completion";
import { isProtectedAuthorityPair, isAdminCorrectablePair } from "./completion-pairs";
import {
  CURRICULUM_AUDIT_ACTIONS,
  DEFAULT_CURRICULUM_CODE,
  isProgressionAdjustmentReasonCode,
  type ProgressionAdjustmentReasonCode,
} from "./constants";
import {
  isLevelStartDomainError,
  startCurrentCurriculumLevelInTransaction,
} from "./level-state";

/** Same identity charset and bounds as every other durable request identity. */
export const PROGRESSION_ADJUSTMENT_REQUEST_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;

export const PROGRESSION_ADJUSTMENT_REASON_TEXT_MIN = 10;
export const PROGRESSION_ADJUSTMENT_REASON_TEXT_MAX = 2000;

/** Mirrors the reference-identity charset the completion engine validates. */
const REFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * Operator prose is stored, so it is bounded and screened for the same markup
 * the report workflow refuses. It is never rendered as HTML anywhere, and this
 * is the belt for that brace.
 */
const UNSAFE_REASON_TEXT = /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:/i;

/**
 * A whole-curriculum correction is legal and bounded by the curriculum itself.
 * The transaction bound is named here for the same reason `prisma/migrate.ts`
 * names its own: a 90-level correction is not a request-shaped unit of work, and
 * inheriting Prisma's 5s request default would make the largest legitimate
 * adjustment fail for a reason nothing in the source explained.
 */
const ADJUSTMENT_TRANSACTION_TIMEOUT_MS = 60_000;
const ADJUSTMENT_TRANSACTION_MAX_WAIT_MS = 10_000;

export type ProgressionAdjustmentErrorCode =
  | "PROGRESSION_ADJUST_DISABLED"
  | "PROGRESSION_ADJUST_INPUT_INVALID"
  | "PROGRESSION_ADJUST_FORBIDDEN"
  | "PROGRESSION_ADJUST_LEARNER_NOT_FOUND"
  | "PROGRESSION_ADJUST_LEARNER_INACTIVE"
  | "PROGRESSION_ADJUST_NOT_ENROLLED"
  | "PROGRESSION_ADJUST_WRONG_CURRICULUM"
  | "PROGRESSION_ADJUST_TARGET_INVALID"
  | "PROGRESSION_ADJUST_NO_CHANGE"
  | "PROGRESSION_ADJUST_BACKWARD_UNSUPPORTED"
  | "PROGRESSION_ADJUST_GATE_LEVEL_REFUSED"
  | "PROGRESSION_ADJUST_STALE_STATE"
  | "PROGRESSION_ADJUST_REQUEST_CONFLICT"
  | "PROGRESSION_ADJUST_STATE_CORRUPT"
  | "PROGRESSION_ADJUST_INTERNAL_ERROR";

export class ProgressionAdjustmentError extends Error {
  readonly code: ProgressionAdjustmentErrorCode;
  /** Present when the refusal is about one specific level. */
  readonly blockingLevelNumber: number | null;

  constructor(
    code: ProgressionAdjustmentErrorCode,
    message: string,
    blockingLevelNumber: number | null = null,
  ) {
    super(message);
    this.name = "ProgressionAdjustmentError";
    this.code = code;
    this.blockingLevelNumber = blockingLevelNumber;
  }
}

export function isProgressionAdjustmentError(
  error: unknown,
): error is ProgressionAdjustmentError {
  return error instanceof ProgressionAdjustmentError;
}

function fail(
  code: ProgressionAdjustmentErrorCode,
  message: string,
  blockingLevelNumber: number | null = null,
): never {
  throw new ProgressionAdjustmentError(code, message, blockingLevelNumber);
}

/* ------------------------------------------------------------------ */
/* Read model                                                          */
/* ------------------------------------------------------------------ */

export type ProgressionAdjustmentPlanLevel = {
  levelNumber: number;
  stableCode: string;
  title: string;
  type: string;
  completionMethod: string;
  /** The canonical reward this level pays; 0 for a zero-reward level. */
  xpReward: number;
  /** What exists for this level today. `none` means no progress row at all. */
  currentStatus: "none" | "in_progress" | "pending_review" | "completed";
};

export type ProgressionAdjustmentBlocker = {
  levelNumber: number;
  stableCode: string;
  title: string;
  type: string;
  reason: "protected_authority_gate" | "not_administratively_correctable";
};

export type ProgressionAdjustmentPlan = {
  learnerUserId: number;
  enrollmentId: number;
  curriculumCode: string;
  curriculumVersionId: number;
  curriculumVersionNumber: number;
  totalLevels: number;
  fromCurrentLevel: number;
  fromHighestCompletedLevel: number;
  targetCurrentLevel: number;
  targetStableCode: string;
  /** The levels this correction would complete, in ascending order. */
  levels: ProgressionAdjustmentPlanLevel[];
  /** Sum of the canonical rewards that would be credited as `admin_correction`. */
  xpTotal: number;
  /**
   * Always empty, and the reason is a domain fact rather than an omission: every
   * tool unlock level is a financial checkpoint, which this owner may never
   * complete.
   */
  toolsUnlocked: readonly string[];
  /** Empty for the same reason: every Community gate is a checkpoint level. */
  communitySpacesOpened: readonly string[];
  warnings: readonly string[];
  blocker: ProgressionAdjustmentBlocker | null;
  canApply: boolean;
  refusalCode: ProgressionAdjustmentErrorCode | null;
};

export type ProgressionAdjustmentReceipt = {
  /** False on an idempotent replay of the same request identity. */
  created: boolean;
  learnerUserId: number;
  enrollmentId: number;
  curriculumVersionId: number;
  fromCurrentLevel: number;
  toCurrentLevel: number;
  levelsCompleted: readonly number[];
  xpAwarded: number;
  xpTransactionIds: readonly number[];
  auditLogId: number;
  adjustedAt: string;
};

type Db = Pick<PrismaClient, "$transaction">;
type Tx = Prisma.TransactionClient;

/* ------------------------------------------------------------------ */
/* Planning — pure, and shared by preview and confirm                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve everything the correction depends on, and decide whether it may run.
 *
 * READS ONLY. Preview calls it directly; the mutation calls it AGAIN inside its
 * transaction and acts on that answer rather than on anything the client echoed
 * back. A preview is advice about a snapshot, never authority — that is what
 * makes "the learner completed a level while the operator was reading" a
 * conflict instead of a corruption.
 */
async function planAdjustment(
  db: Tx,
  input: { learnerUserId: number; targetStableCode: string },
): Promise<ProgressionAdjustmentPlan> {
  const learner = await db.user.findUnique({
    where: { id: input.learnerUserId },
    select: { id: true, status: true, role: true },
  });
  if (!learner) {
    fail("PROGRESSION_ADJUST_LEARNER_NOT_FOUND", "learner does not exist");
  }
  if (learner.status !== "active") {
    // The completion engine refuses a non-active enrollment owner outright, so
    // this is the same refusal said earlier and in the operator's language.
    fail("PROGRESSION_ADJUST_LEARNER_INACTIVE", "learner account is not active");
  }

  const enrollment = await db.userCurriculumEnrollment.findFirst({
    where: { userId: learner.id, status: "active" },
    orderBy: { id: "desc" },
    include: {
      curriculumVersion: {
        select: { id: true, code: true, versionNumber: true, levels: true },
      },
      levelProgress: { select: { levelDefinitionId: true, status: true } },
    },
  });
  if (!enrollment) {
    fail("PROGRESSION_ADJUST_NOT_ENROLLED", "learner has no active curriculum enrollment");
  }
  if (enrollment.curriculumVersion.code !== DEFAULT_CURRICULUM_CODE) {
    fail("PROGRESSION_ADJUST_WRONG_CURRICULUM", "enrollment is not on the canonical curriculum");
  }

  const definitions = [...enrollment.curriculumVersion.levels].sort(
    (left, right) => left.levelNumber - right.levelNumber,
  );
  const totalLevels = definitions.length;
  const statusByLevelId = new Map(
    enrollment.levelProgress.map((row) => [row.levelDefinitionId, row.status]),
  );

  const target = definitions.find(
    (candidate) => candidate.stableCode === input.targetStableCode,
  );
  if (!target) {
    fail(
      "PROGRESSION_ADJUST_TARGET_INVALID",
      "target level is not in the learner's pinned curriculum",
    );
  }

  const fromCurrentLevel = enrollment.currentLevel;
  const targetCurrentLevel = target.levelNumber;

  const base = {
    learnerUserId: learner.id,
    enrollmentId: enrollment.id,
    curriculumCode: enrollment.curriculumVersion.code,
    curriculumVersionId: enrollment.curriculumVersionId,
    curriculumVersionNumber: enrollment.curriculumVersion.versionNumber,
    totalLevels,
    fromCurrentLevel,
    fromHighestCompletedLevel: enrollment.highestCompletedLevel,
    targetCurrentLevel,
    targetStableCode: target.stableCode,
    toolsUnlocked: [] as const,
    communitySpacesOpened: [] as const,
  };

  if (targetCurrentLevel === fromCurrentLevel) {
    return {
      ...base,
      levels: [],
      xpTotal: 0,
      warnings: ["Учащийся уже находится на этом уровне."],
      blocker: null,
      canApply: false,
      refusalCode: "PROGRESSION_ADJUST_NO_CHANGE",
    };
  }
  if (targetCurrentLevel < fromCurrentLevel) {
    return {
      ...base,
      levels: [],
      xpTotal: 0,
      warnings: [
        "Обратная корректировка прогресса не поддерживается: история прохождения неизменяема.",
      ],
      blocker: null,
      canApply: false,
      refusalCode: "PROGRESSION_ADJUST_BACKWARD_UNSUPPORTED",
    };
  }

  // The interval is [current, target - 1]: the target level is where the learner
  // ENDS UP, so it is never completed by this correction.
  const interval = definitions.filter(
    (candidate) =>
      candidate.levelNumber >= fromCurrentLevel &&
      candidate.levelNumber < targetCurrentLevel,
  );

  const levels: ProgressionAdjustmentPlanLevel[] = [];
  let blocker: ProgressionAdjustmentBlocker | null = null;
  for (const definition of interval) {
    const describe = (): ProgressionAdjustmentBlocker => ({
      levelNumber: definition.levelNumber,
      stableCode: definition.stableCode,
      title: definition.title,
      type: definition.type,
      reason: isProtectedAuthorityPair(definition.type, definition.completionMethod)
        ? "protected_authority_gate"
        : "not_administratively_correctable",
    });
    if (
      isProtectedAuthorityPair(definition.type, definition.completionMethod) ||
      !isAdminCorrectablePair(definition.type, definition.completionMethod)
    ) {
      // STOP AT THE FIRST BLOCKER and report the levels before it. Listing the
      // whole interval and marking one entry would invite an operator to read
      // past the blocker; the honest picture is "this is how far you can go".
      blocker = describe();
      break;
    }
    levels.push({
      levelNumber: definition.levelNumber,
      stableCode: definition.stableCode,
      title: definition.title,
      type: definition.type,
      completionMethod: definition.completionMethod,
      xpReward: definition.xpReward,
      currentStatus: statusByLevelId.get(definition.id) ?? "none",
    });
  }

  const warnings: string[] = [];
  const reviewLevels = levels.filter(
    (level) => level.type === "mentor_review" || level.type === "report",
  );
  if (reviewLevels.length > 0) {
    warnings.push(
      `Интервал включает уровни с проверкой (${reviewLevels
        .map((level) => `L${level.levelNumber}`)
        .join(", ")}). Они будут отмечены как административная корректировка — проверка ментора и одобрение отчёта НЕ создаются.`,
    );
  }
  if (levels.length > 1) {
    warnings.push(`Будет административно завершено уровней: ${levels.length}.`);
  }
  warnings.push(
    "Инструменты и доступ в Community не изменятся: каждый из них открывается финансовой контрольной точкой, которую административная корректировка выполнить не может.",
  );

  if (blocker) {
    return {
      ...base,
      levels,
      xpTotal: levels.reduce((total, level) => total + level.xpReward, 0),
      warnings,
      blocker,
      canApply: false,
      refusalCode: "PROGRESSION_ADJUST_GATE_LEVEL_REFUSED",
    };
  }

  return {
    ...base,
    levels,
    xpTotal: levels.reduce((total, level) => total + level.xpReward, 0),
    warnings,
    blocker: null,
    canApply: levels.length > 0,
    refusalCode: levels.length > 0 ? null : "PROGRESSION_ADJUST_NO_CHANGE",
  };
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

export type PreviewProgressionAdjustmentInput = {
  learnerUserId: number;
  targetStableCode: string;
  db?: Db;
};

/**
 * PURE. It opens a read transaction so every read sees one snapshot, writes
 * nothing, starts nothing, emits nothing and does not touch
 * `lastMeaningfulActionAt`. A preview that mutated would be the worst kind of
 * bug here: an operator "just checking" would move a learner.
 */
export async function previewProgressionAdjustment({
  learnerUserId,
  targetStableCode,
  db = prisma,
}: PreviewProgressionAdjustmentInput): Promise<ProgressionAdjustmentPlan> {
  assertLearnerId(learnerUserId);
  assertStableCode(targetStableCode);
  return db.$transaction((tx) => planAdjustment(tx, { learnerUserId, targetStableCode }));
}

/* ------------------------------------------------------------------ */
/* Confirm                                                             */
/* ------------------------------------------------------------------ */

export type AdjustLearnerProgressionInput = {
  /** The operator's StaffProfile id. Comes from the session, never a body. */
  actorStaffProfileId: string;
  /** The operator's User id, carried only so the AuditLog row can be attributed. */
  actorUserId: number;
  learnerUserId: number;
  targetStableCode: string;
  expectedCurrentLevel: number;
  expectedCurriculumVersionId: number;
  reasonCode: ProgressionAdjustmentReasonCode;
  reasonText: string;
  referenceId?: string | null;
  requestId: string;
  evaluationTime?: Date;
  db?: Db;
};

function assertLearnerId(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "learner id is invalid");
  }
}

function assertStableCode(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "target stable code is invalid");
  }
}

function validated(input: AdjustLearnerProgressionInput) {
  assertLearnerId(input.learnerUserId);
  assertStableCode(input.targetStableCode);
  if (
    typeof input.actorStaffProfileId !== "string" ||
    input.actorStaffProfileId.trim().length === 0
  ) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "actor identity is invalid");
  }
  if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "actor identity is invalid");
  }
  if (
    !Number.isSafeInteger(input.expectedCurrentLevel) ||
    input.expectedCurrentLevel <= 0
  ) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "expected current level is invalid");
  }
  if (
    !Number.isSafeInteger(input.expectedCurriculumVersionId) ||
    input.expectedCurriculumVersionId <= 0
  ) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "expected curriculum version is invalid");
  }
  if (!isProgressionAdjustmentReasonCode(input.reasonCode)) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "reason code is invalid");
  }
  const reasonText = typeof input.reasonText === "string" ? input.reasonText.trim() : "";
  if (
    reasonText.length < PROGRESSION_ADJUSTMENT_REASON_TEXT_MIN ||
    reasonText.length > PROGRESSION_ADJUSTMENT_REASON_TEXT_MAX ||
    UNSAFE_REASON_TEXT.test(reasonText)
  ) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "reason text is invalid");
  }
  const referenceId =
    input.referenceId === undefined || input.referenceId === null
      ? null
      : String(input.referenceId).trim();
  if (referenceId !== null && !REFERENCE_ID_PATTERN.test(referenceId)) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "reference id is invalid");
  }
  if (
    typeof input.requestId !== "string" ||
    !PROGRESSION_ADJUSTMENT_REQUEST_ID_PATTERN.test(input.requestId)
  ) {
    fail("PROGRESSION_ADJUST_INPUT_INVALID", "request id is invalid");
  }
  // SELF-ADJUSTMENT. Refused on the ACTOR/LEARNER identity only. Being the
  // learner's CRM owner is explicitly NOT a disqualification — owning a learner
  // is how support work is routed, and refusing it would block the correction in
  // exactly the case it is most often needed.
  if (input.actorUserId === input.learnerUserId) {
    fail("PROGRESSION_ADJUST_FORBIDDEN", "an operator cannot adjust their own progression");
  }
  return {
    actorStaffProfileId: input.actorStaffProfileId,
    actorUserId: input.actorUserId,
    learnerUserId: input.learnerUserId,
    targetStableCode: input.targetStableCode,
    expectedCurrentLevel: input.expectedCurrentLevel,
    expectedCurriculumVersionId: input.expectedCurriculumVersionId,
    reasonCode: input.reasonCode,
    reasonText,
    referenceId,
    requestId: input.requestId,
    evaluationTime: input.evaluationTime ?? new Date(),
  };
}

function hashRequestId(requestId: string) {
  return `sha256:${createHash("sha256").update(requestId, "utf8").digest("hex")}`;
}

/**
 * The completion-primitive failures, translated once and without flattening.
 *
 * A stale operator view, a level whose owner refuses it and a genuine corruption
 * are three different facts, and an operator who cannot tell them apart cannot
 * act on any of them.
 */
function mapCompletionCode(
  code: CurriculumLevelCompletionErrorCode,
  levelNumber: number,
): never {
  switch (code) {
    case "COMPLETION_DISABLED":
      return fail("PROGRESSION_ADJUST_DISABLED", "curriculum completion is disabled", levelNumber);
    case "COMPLETION_INPUT_INVALID":
      return fail("PROGRESSION_ADJUST_INPUT_INVALID", "completion input is invalid", levelNumber);
    case "COMPLETION_ENROLLMENT_NOT_FOUND":
      return fail("PROGRESSION_ADJUST_NOT_ENROLLED", "enrollment disappeared", levelNumber);
    case "COMPLETION_LEVEL_NOT_FOUND":
      return fail("PROGRESSION_ADJUST_TARGET_INVALID", "level does not exist", levelNumber);
    case "COMPLETION_LEVEL_NOT_CURRENT":
    case "COMPLETION_CONFLICT":
      return fail(
        "PROGRESSION_ADJUST_STALE_STATE",
        "learner progression changed while the correction was being applied",
        levelNumber,
      );
    case "COMPLETION_PROGRESS_NOT_STARTED":
      return fail(
        "PROGRESSION_ADJUST_STATE_CORRUPT",
        "level could not be started for correction",
        levelNumber,
      );
    case "COMPLETION_OWNER_MISMATCH":
    case "COMPLETION_OWNER_UNAVAILABLE":
      return fail(
        "PROGRESSION_ADJUST_GATE_LEVEL_REFUSED",
        "level cannot be completed by an administrative correction",
        levelNumber,
      );
    case "COMPLETION_IDEMPOTENCY_CONFLICT":
      return fail(
        "PROGRESSION_ADJUST_REQUEST_CONFLICT",
        "request identity conflicts with a durable award",
        levelNumber,
      );
    case "COMPLETION_STATUS_INVALID":
    case "COMPLETION_ENROLLMENT_CORRUPT":
    case "COMPLETION_REWARD_INVALID":
    case "COMPLETION_STATE_CORRUPT":
      return fail("PROGRESSION_ADJUST_STATE_CORRUPT", "curriculum state is corrupt", levelNumber);
    case "COMPLETION_INTERNAL_ERROR":
      return fail("PROGRESSION_ADJUST_INTERNAL_ERROR", "correction failed", levelNumber);
  }
}

/**
 * Has this exact request already been applied?
 *
 * Replay cannot be detected by re-running the plan: the first application moved
 * the learner, so a replay computes an EMPTY interval and would otherwise be
 * reported as `NO_CHANGE` — technically true, operationally a lie, and it would
 * hide a double-submit rather than absorb it. The envelope audit row is the
 * durable record of the request, so it is what a replay is matched against.
 *
 * There is no new table for this: the envelope is keyed to the enrollment and an
 * enrollment accumulates a handful of these at most, so the scan is bounded.
 */
async function findReplay(
  tx: Tx,
  enrollmentId: number,
  requestIdHash: string,
): Promise<ProgressionAdjustmentReceipt | null> {
  const envelopes = await tx.auditLog.findMany({
    where: {
      action: CURRICULUM_AUDIT_ACTIONS.progressionAdjusted,
      entityType: "UserCurriculumEnrollment",
      entityId: String(enrollmentId),
    },
    orderBy: { id: "desc" },
    take: 200,
  });
  for (const envelope of envelopes) {
    const metadata = envelope.metadata as Record<string, unknown> | null;
    if (!metadata || metadata.requestIdHash !== requestIdHash) continue;
    return {
      created: false,
      learnerUserId: Number(metadata.learnerUserId),
      enrollmentId,
      curriculumVersionId: Number(metadata.curriculumVersionId),
      fromCurrentLevel: Number(metadata.fromCurrentLevel),
      toCurrentLevel: Number(metadata.toCurrentLevel),
      levelsCompleted: Array.isArray(metadata.levelsCompleted)
        ? (metadata.levelsCompleted as number[])
        : [],
      xpAwarded: Number(metadata.xpAwarded ?? 0),
      xpTransactionIds: Array.isArray(metadata.xpTransactionIds)
        ? (metadata.xpTransactionIds as number[])
        : [],
      auditLogId: envelope.id,
      adjustedAt: envelope.createdAt.toISOString(),
    };
  }
  return null;
}

async function runAdjustment(
  tx: Tx,
  input: ReturnType<typeof validated>,
): Promise<ProgressionAdjustmentReceipt> {
  const requestIdHash = hashRequestId(input.requestId);

  // Re-planned INSIDE the transaction. The preview the operator saw is advice
  // about a snapshot that may already be stale; this is the authority.
  const plan = await planAdjustment(tx, {
    learnerUserId: input.learnerUserId,
    targetStableCode: input.targetStableCode,
  });

  const replay = await findReplay(tx, plan.enrollmentId, requestIdHash);
  if (replay) return replay;

  if (plan.curriculumVersionId !== input.expectedCurriculumVersionId) {
    fail(
      "PROGRESSION_ADJUST_WRONG_CURRICULUM",
      "learner is pinned to a different curriculum version than the request expected",
    );
  }
  if (plan.fromCurrentLevel !== input.expectedCurrentLevel) {
    fail(
      "PROGRESSION_ADJUST_STALE_STATE",
      "learner is no longer on the level the request expected",
    );
  }
  if (!plan.canApply) {
    fail(
      plan.refusalCode ?? "PROGRESSION_ADJUST_TARGET_INVALID",
      "correction cannot be applied",
      plan.blocker?.levelNumber ?? null,
    );
  }

  const levelsCompleted: number[] = [];
  const xpTransactionIds: number[] = [];
  let xpAwarded = 0;

  for (const level of plan.levels) {
    const definition = await tx.levelDefinition.findFirst({
      where: {
        curriculumVersionId: plan.curriculumVersionId,
        stableCode: level.stableCode,
      },
      select: { id: true, levelNumber: true },
    });
    if (!definition) {
      fail("PROGRESSION_ADJUST_STATE_CORRUPT", "level disappeared mid-correction", level.levelNumber);
    }

    // A level with no progress row is STARTED through the shipped start owner —
    // never by inserting a row here. That owner re-checks the sequence, refuses a
    // financial checkpoint on its own account, and emits the `level_started`
    // growth event exactly as an ordinary start does.
    if (level.currentStatus === "none") {
      try {
        const started = await startCurrentCurriculumLevelInTransaction(tx, {
          actorUserId: input.learnerUserId,
          asOf: input.evaluationTime,
          expectedStableCode: level.stableCode,
          // The trusted context. It suppresses the `level_started` growth event
          // — an operator materialising a row is not a learner opening a level —
          // and attributes the audit row to the operator instead of the learner.
          administrative: {
            actorUserId: input.actorUserId,
            actorStaffProfileId: input.actorStaffProfileId,
            reasonCode: input.reasonCode,
            requestIdHash,
          },
        });
        if (started.kind !== "started") {
          fail(
            "PROGRESSION_ADJUST_STATE_CORRUPT",
            "level could not be started for correction",
            level.levelNumber,
          );
        }
      } catch (error) {
        if (isProgressionAdjustmentError(error)) throw error;
        if (isLevelStartDomainError(error)) {
          fail(
            "PROGRESSION_ADJUST_STATE_CORRUPT",
            `level could not be started for correction (${error.code})`,
            level.levelNumber,
          );
        }
        throw error;
      }
    }

    let completion;
    try {
      completion = await completeCurriculumLevelInTransaction(tx, {
        enrollmentId: plan.enrollmentId,
        levelDefinitionId: definition.id,
        sourceType: "admin_correction",
        // Unique PER LEVEL, not per request. The XP ledger keys
        // `admin_correction` globally by sourceId rather than per enrollment, so
        // one identity reused across a multi-level correction would collide with
        // itself on the second level.
        sourceId: `admin-correction:${input.requestId}:l${definition.levelNumber}`,
        // The OPERATOR is the actor. The completion audit therefore never says
        // the learner did this, which is the whole point of the owner.
        actorId: input.actorUserId,
        evaluationTime: input.evaluationTime,
        administrativeProvenance: {
          reasonCode: input.reasonCode,
          actorStaffProfileId: input.actorStaffProfileId,
          requestIdHash,
          referenceId: input.referenceId,
        },
      });
    } catch (error) {
      if (isCurriculumLevelCompletionError(error)) {
        mapCompletionCode(error.code, level.levelNumber);
      }
      throw error;
    }

    levelsCompleted.push(completion.levelNumber);
    xpAwarded += completion.xpAwarded;
    if (completion.xpTransactionId !== null) {
      xpTransactionIds.push(completion.xpTransactionId);
    }
  }

  const finalEnrollment = await tx.userCurriculumEnrollment.findUnique({
    where: { id: plan.enrollmentId },
    select: { currentLevel: true, highestCompletedLevel: true },
  });
  if (!finalEnrollment || finalEnrollment.currentLevel !== plan.targetCurrentLevel) {
    // The engine moves the counters; this asserts it actually arrived where the
    // plan said. Reaching a different level than the operator approved is a
    // corruption, and it rolls the whole correction back.
    fail(
      "PROGRESSION_ADJUST_STATE_CORRUPT",
      "correction did not reach the approved level",
    );
  }

  const envelope = await tx.auditLog.create({
    data: {
      userId: input.actorUserId,
      action: CURRICULUM_AUDIT_ACTIONS.progressionAdjusted,
      entityType: "UserCurriculumEnrollment",
      entityId: String(plan.enrollmentId),
      metadata: {
        actorUserId: input.actorUserId,
        actorStaffProfileId: input.actorStaffProfileId,
        learnerUserId: plan.learnerUserId,
        enrollmentId: plan.enrollmentId,
        curriculumCode: plan.curriculumCode,
        curriculumVersionId: plan.curriculumVersionId,
        curriculumVersionNumber: plan.curriculumVersionNumber,
        fromCurrentLevel: plan.fromCurrentLevel,
        fromHighestCompletedLevel: plan.fromHighestCompletedLevel,
        toCurrentLevel: finalEnrollment.currentLevel,
        toHighestCompletedLevel: finalEnrollment.highestCompletedLevel,
        targetStableCode: plan.targetStableCode,
        levelsCompleted,
        levelCount: levelsCompleted.length,
        xpAwarded,
        xpTransactionIds,
        reasonCode: input.reasonCode,
        // The ONE place operator prose is stored. It is deliberately not copied
        // onto every level row or into `completionEvidence`.
        reasonText: input.reasonText,
        referenceId: input.referenceId,
        // Hashed, following the completion audit's own convention for a durable
        // request identity: enough to match a replay, never the raw token.
        requestIdHash,
        result: "applied",
      },
    },
  });

  return {
    created: true,
    learnerUserId: plan.learnerUserId,
    enrollmentId: plan.enrollmentId,
    curriculumVersionId: plan.curriculumVersionId,
    fromCurrentLevel: plan.fromCurrentLevel,
    toCurrentLevel: finalEnrollment.currentLevel,
    levelsCompleted,
    xpAwarded,
    xpTransactionIds,
    auditLogId: envelope.id,
    adjustedAt: input.evaluationTime.toISOString(),
  };
}

export async function adjustLearnerProgression(
  rawInput: AdjustLearnerProgressionInput,
): Promise<ProgressionAdjustmentReceipt> {
  const input = validated(rawInput);
  const db = rawInput.db ?? prisma;
  return db.$transaction((tx) => runAdjustment(tx, input), {
    timeout: ADJUSTMENT_TRANSACTION_TIMEOUT_MS,
    maxWait: ADJUSTMENT_TRANSACTION_MAX_WAIT_MS,
  });
}
