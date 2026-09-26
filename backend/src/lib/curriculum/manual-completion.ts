/**
 * A1 — the learner-owned HTTP command for `lesson:lesson` and `lesson:manual`.
 *
 * WHAT WAS MISSING
 * `completion.ts` has always mapped both pairs to the `level_completion` owner,
 * and nothing could reach it. A learner who finished a manual lesson or a
 * practical exercise had no action available: the level stayed `in_progress`
 * forever, `currentLevel` never advanced, and every later level stayed locked.
 * Under product decision R1 that gap covers 13 of the 20 canonical practical
 * levels, so it is not an edge case — it is most of the practical curriculum.
 *
 * WHAT `lesson:manual` MEANS (R1)
 * Real practical instructional content exists, the learner performs the
 * exercise, and THIS command is the explicit completion action that records it.
 * The platform cannot witness the exercise itself and does not pretend to: the
 * honest contract is an explicit, idempotent, audited learner declaration, not
 * an inferred one.
 *
 * WHAT THIS COMMAND IS NOT
 * It is not a generic completion endpoint. Exactly two pairs reach it, both
 * owned by `level_completion`. An assessment level, a report level, a mentor
 * review, a financial checkpoint or the Pocket registration level is refused
 * with `MANUAL_COMPLETION_LEVEL_WRONG_OWNER` before anything is written — their
 * owners require proof this command cannot produce, and routing around them is
 * exactly the bypass this file must not become.
 *
 * WHAT THE CALLER CANNOT SUPPLY
 * A user, an enrollment, a level id, a level number, an XP amount, a status, a
 * completion time or an evidence blob. The learner comes from the session; the
 * enrollment and the level are resolved server-side from that learner and the
 * path's stable code. The only thing the request body carries is a `requestId`.
 *
 * IDEMPOTENCY, PRECISELY
 * The completion source id is `manual-completion:<requestId>`.
 *
 *   * Retrying with the SAME requestId replays: the durable completion is
 *     returned with `created: false` and nothing is written twice — no second
 *     XP row, no second unlock, no second audit event.
 *   * A DIFFERENT requestId against an already-completed XP-bearing level is a
 *     conflict (409), because the stored award names the first request and the
 *     XP ledger refuses to answer for an identity it does not hold.
 *   * A different requestId against an already-completed ZERO-reward level
 *     replays instead of conflicting: with no XP row there is no durable
 *     request identity to compare against, and the completed progress row is
 *     the whole truth. Either way the level completes exactly once — the
 *     distinction is only in which of the two safe answers a client gets.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  completeCurriculumLevelInTransaction,
  isCurriculumLevelCompletionError,
  type CurriculumLevelCompletionErrorCode,
} from "./completion";
import { PRODUCTION_COMPLETION_PAIRS, completionPair } from "./completion-pairs";

/** Same identity charset and bounds as every other durable request identity. */
export const MANUAL_COMPLETION_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;

/** The exact pairs this owner may complete. Nothing else, ever. */
const MANUAL_COMPLETION_PAIRS: ReadonlySet<string> = new Set(
  PRODUCTION_COMPLETION_PAIRS.level_completion,
);

export type ManualCompletionErrorCode =
  | "MANUAL_COMPLETION_DISABLED"
  | "MANUAL_COMPLETION_INPUT_INVALID"
  | "MANUAL_COMPLETION_FORBIDDEN"
  | "MANUAL_COMPLETION_NOT_ENROLLED"
  | "MANUAL_COMPLETION_LEVEL_NOT_FOUND"
  | "MANUAL_COMPLETION_LEVEL_WRONG_OWNER"
  | "MANUAL_COMPLETION_LEVEL_NOT_CURRENT"
  | "MANUAL_COMPLETION_LEVEL_NOT_STARTED"
  | "MANUAL_COMPLETION_REQUEST_CONFLICT"
  | "MANUAL_COMPLETION_STATE_CORRUPT"
  | "MANUAL_COMPLETION_INTERNAL_ERROR";

export class ManualCompletionError extends Error {
  readonly code: ManualCompletionErrorCode;
  constructor(code: ManualCompletionErrorCode, message: string) {
    super(message);
    this.name = "ManualCompletionError";
    this.code = code;
  }
}

export function isManualCompletionError(error: unknown): error is ManualCompletionError {
  return error instanceof ManualCompletionError;
}

function fail(code: ManualCompletionErrorCode, message: string): never {
  throw new ManualCompletionError(code, message);
}

export type CompleteManualLevelInput = {
  /** From the session. There is no body field through which this can be set. */
  actorUserId: number;
  /** A guard AND the target: the level must be the learner's current one. */
  stableCode: string;
  requestId: string;
  evaluationTime?: Date;
  db?: Pick<PrismaClient, "$transaction">;
};

export type ManualCompletionReceipt = {
  /** False on an idempotent replay of the same request identity. */
  created: boolean;
  levelNumber: number;
  stableCode: string;
  completionMethod: string;
  xpAwarded: number;
  xpTransactionId: number | null;
  nextLevelNumber: number | null;
  terminal: boolean;
  completedAt: string;
};

/**
 * Completion-primitive failures, translated once.
 *
 * Every mapping keeps the primitive's distinction rather than flattening it:
 * "you have not started this" and "this is not your current level" and "another
 * request already completed this" are three different facts and a client that
 * cannot tell them apart cannot recover from any of them.
 */
function mapCompletionCode(code: CurriculumLevelCompletionErrorCode): never {
  switch (code) {
    case "COMPLETION_DISABLED":
      return fail("MANUAL_COMPLETION_DISABLED", "manual completion is disabled");
    case "COMPLETION_INPUT_INVALID":
      return fail("MANUAL_COMPLETION_INPUT_INVALID", "manual completion input is invalid");
    case "COMPLETION_ENROLLMENT_NOT_FOUND":
      return fail("MANUAL_COMPLETION_NOT_ENROLLED", "no curriculum enrollment");
    case "COMPLETION_LEVEL_NOT_FOUND":
      return fail("MANUAL_COMPLETION_LEVEL_NOT_FOUND", "level does not exist");
    case "COMPLETION_LEVEL_NOT_CURRENT":
      return fail("MANUAL_COMPLETION_LEVEL_NOT_CURRENT", "level is not current");
    case "COMPLETION_PROGRESS_NOT_STARTED":
      return fail("MANUAL_COMPLETION_LEVEL_NOT_STARTED", "level was not started");
    case "COMPLETION_OWNER_MISMATCH":
    case "COMPLETION_OWNER_UNAVAILABLE":
      return fail("MANUAL_COMPLETION_LEVEL_WRONG_OWNER", "level is not manually completable");
    case "COMPLETION_IDEMPOTENCY_CONFLICT":
    case "COMPLETION_CONFLICT":
      return fail("MANUAL_COMPLETION_REQUEST_CONFLICT", "request identity conflicts with the durable completion");
    case "COMPLETION_STATUS_INVALID":
    case "COMPLETION_ENROLLMENT_CORRUPT":
    case "COMPLETION_REWARD_INVALID":
    case "COMPLETION_STATE_CORRUPT":
      return fail("MANUAL_COMPLETION_STATE_CORRUPT", "curriculum state is corrupt");
    case "COMPLETION_INTERNAL_ERROR":
      return fail("MANUAL_COMPLETION_INTERNAL_ERROR", "manual completion failed");
  }
}

async function runManualCompletion(
  tx: Prisma.TransactionClient,
  input: { actorUserId: number; stableCode: string; requestId: string; now: Date },
): Promise<ManualCompletionReceipt> {
  const user = await tx.user.findUnique({
    where: { id: input.actorUserId },
    select: { id: true, status: true },
  });
  if (!user) fail("MANUAL_COMPLETION_FORBIDDEN", "actor does not exist");
  if (user.status !== "active") fail("MANUAL_COMPLETION_FORBIDDEN", "actor is not active");

  // Selected by OWNERSHIP, not by "still active": a replay of the request that
  // completed the final level must still resolve after the enrollment has
  // terminally completed. Whether a NEW completion is allowed is decided by the
  // completion primitive, which refuses one on a completed enrollment.
  const enrollment = await tx.userCurriculumEnrollment.findFirst({
    where: { userId: user.id, status: { in: ["active", "completed"] } },
    orderBy: [{ status: "asc" }, { id: "desc" }],
    include: { curriculumVersion: { include: { levels: true } } },
  });
  if (!enrollment) fail("MANUAL_COMPLETION_NOT_ENROLLED", "no curriculum enrollment");

  const level = enrollment.curriculumVersion.levels.find(
    (candidate) => candidate.stableCode === input.stableCode,
  );
  if (!level) {
    fail("MANUAL_COMPLETION_LEVEL_NOT_FOUND", "level is not in the pinned curriculum");
  }

  // The owner guard, BEFORE anything else is checked and long before anything
  // is written. A learner aiming this at an assessment, a report, a mentor
  // review, a checkpoint or the registration level changes nothing at all, and
  // learns only that this is not the way to complete it.
  if (!MANUAL_COMPLETION_PAIRS.has(completionPair(level.type, level.completionMethod))) {
    fail("MANUAL_COMPLETION_LEVEL_WRONG_OWNER", "level is not manually completable");
  }

  // A level the learner never opened cannot be declared finished. The start
  // owner is deliberately NOT called for them: auto-starting here would let one
  // request both begin and end a level the learner never saw, and starting is
  // already an explicit, shipped action of its own.
  const progress = await tx.userLevelProgress.findFirst({
    where: { enrollmentId: enrollment.id, levelDefinitionId: level.id },
    select: { id: true, status: true },
  });
  if (!progress) {
    if (level.levelNumber !== enrollment.currentLevel) {
      fail("MANUAL_COMPLETION_LEVEL_NOT_CURRENT", "level is not current");
    }
    fail("MANUAL_COMPLETION_LEVEL_NOT_STARTED", "level was not started");
  }

  let completion;
  try {
    // The canonical engine owns everything from here: prerequisite sequence,
    // the CAS on the progress row, the XP award, the `currentLevel` advance,
    // terminal completion and the audit event. This file writes NOTHING to
    // UserLevelProgress, XPTransaction or UserCurriculumEnrollment itself.
    completion = await completeCurriculumLevelInTransaction(tx, {
      enrollmentId: enrollment.id,
      levelDefinitionId: level.id,
      sourceType: "level_completion",
      sourceId: `manual-completion:${input.requestId}`,
      actorId: user.id,
      evaluationTime: input.now,
    });
  } catch (error) {
    if (isCurriculumLevelCompletionError(error)) mapCompletionCode(error.code);
    throw error;
  }

  return {
    created: completion.created,
    levelNumber: completion.levelNumber,
    stableCode: completion.stableCode,
    completionMethod: level.completionMethod,
    xpAwarded: completion.xpAwarded,
    xpTransactionId: completion.xpTransactionId,
    nextLevelNumber: completion.nextLevelNumber,
    terminal: completion.terminal,
    completedAt: completion.completedAt.toISOString(),
  };
}

export async function completeManualLevel({
  actorUserId,
  stableCode,
  requestId,
  evaluationTime,
  db = prisma,
}: CompleteManualLevelInput): Promise<ManualCompletionReceipt> {
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
    fail("MANUAL_COMPLETION_INPUT_INVALID", "actor is invalid");
  }
  if (typeof stableCode !== "string" || stableCode.trim().length === 0) {
    fail("MANUAL_COMPLETION_INPUT_INVALID", "stableCode is invalid");
  }
  if (
    typeof requestId !== "string" ||
    !MANUAL_COMPLETION_REQUEST_ID_PATTERN.test(requestId)
  ) {
    fail("MANUAL_COMPLETION_INPUT_INVALID", "requestId is invalid");
  }
  const now = evaluationTime ?? new Date();
  return db.$transaction((tx) =>
    runManualCompletion(tx, { actorUserId, stableCode, requestId, now }),
  );
}
