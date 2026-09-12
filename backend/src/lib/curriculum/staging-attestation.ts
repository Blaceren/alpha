/**
 * A8 — STAGING_ATTESTED QA verification (product decisions R2 and R3).
 *
 * THE PROBLEM THIS SOLVES
 * PREPROD cannot exercise level 1 or a financial checkpoint. Level 1 completes
 * on an authenticated Pocket registration postback and a checkpoint completes
 * on an authoritative balance. Neither can be produced on a staging host, and
 * every shortcut that was considered is worse than the gap:
 *
 *   real deposits merely to test              -- spends real money
 *   ATA_ENVIRONMENT=staging -> dev            -- relaxes every dev-only gate
 *   enabling the dev simulator                -- an unclassified-host hazard
 *   the regression test backend in production -- refused at startup, correctly
 *   inferring a deposit from a balance delta  -- the exact fiction ATA forbids
 *   fake Pocket partner credentials           -- forging a partner event
 *
 * WHAT THIS IS INSTEAD
 * An explicit, separately-named act with its own vocabulary: an authorized
 * operator ATTESTS that a gate should be considered satisfied for QA. The
 * semantics are never laundered into the production ones — the completion
 * source is `staging_attested_*`, so the progress row, the completion audit and
 * every later reader can tell a QA attestation from a real financial or partner
 * event forever.
 *
 * SIXTEEN THINGS THAT MUST HOLD, AND WHERE EACH IS ENFORCED
 *   1  staging only ................ staging-attestation-policy.ts, re-checked
 *                                    in completion.ts
 *   2  default off ................. absent flag is disabled
 *   3  dedicated flag .............. STAGING_ATTESTATION_ENABLED, nothing else
 *   4  fail closed off-staging ..... validateRuntimeEnv refuses to boot
 *   5  never in production ......... classification must be exactly `staging`
 *   6  no self-attestation ......... here AND in completion.ts
 *   7  operator authorization ...... active admin, checked in the transaction
 *   8  server-side authorization ... actor comes from the session, never a body
 *   9  CSRF ........................ the admin mutation gate
 *  10  durable audit ............... same transaction as the attestation row
 *  11  exact target ................ one learner, one level, one event class
 *  12  idempotent .................. two unique indexes plus replay
 *  13  no financial event .......... the table has no amount column at all
 *  14  no fake Pocket history ...... no PocketTraderIdentity, no provider event
 *  15  no inferred amount .......... nothing reads a balance on this path
 *  16  production unaffected ....... Pocket remains authoritative there
 *
 * TWO TRANSACTIONS, DELIBERATELY
 * T1 validates and writes the attestation WITH its audit record. T2 completes
 * the level through the canonical engine. Splitting them means an attestation
 * whose completion fails is still durably recorded and auditable, and an
 * identical retry replays it instead of attesting twice — the same shape the
 * checkpoint engine uses for its claim/settle split, and for the same reason.
 *
 * NO GENERIC "COMPLETE ANY LEVEL" ENDPOINT EXISTS. Each event class is bound to
 * exactly one level kind, so this cannot be pointed at a lesson, a report, an
 * assessment or a final exam.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isFinancialCheckpointType } from "./checkpoint";
import {
  completeCurriculumLevelInTransaction,
  isCurriculumLevelCompletionError,
} from "./completion";
import { CURRICULUM_AUDIT_ACTIONS } from "./constants";
import { reconcilePocketRegistrationLevelCompletion } from "./pocket-registration-completion";
import {
  isStagingAttestationUsable,
  STAGING_ATTESTATION_ENVIRONMENT,
} from "./staging-attestation-policy";

/** Same identity charset and bounds as every other durable request identity. */
export const STAGING_ATTESTATION_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;

export const STAGING_ATTESTATION_EVENT_CLASSES = [
  "pocket_registration",
  "financial_checkpoint",
] as const;

export type StagingAttestationEventClassName =
  (typeof STAGING_ATTESTATION_EVENT_CLASSES)[number];

/**
 * The level pair each event class may target. Exactly one each, no wildcards.
 *
 * EXPORTED so an out-of-band operator tool can VERIFY a target against the same
 * table this service decides with, instead of restating the mapping and drifting
 * from it. Exporting it changes nothing about who may attest: the authorization,
 * the environment gate and the refusal all still live below, and a reader of
 * this constant learns only which level kind each event class is bound to —
 * which is already stated in this file's header and in the route's.
 */
export const STAGING_ATTESTATION_EVENT_CLASS_TARGET: Record<
  StagingAttestationEventClassName,
  { type: string; completionMethod: string }
> = {
  pocket_registration: { type: "external_event", completionMethod: "pocket_postback" },
  financial_checkpoint: { type: "financial_checkpoint", completionMethod: "balance_check" },
};

export type StagingAttestationErrorCode =
  | "STAGING_ATTESTATION_DISABLED"
  | "STAGING_ATTESTATION_INPUT_INVALID"
  | "STAGING_ATTESTATION_FORBIDDEN"
  | "STAGING_ATTESTATION_LEARNER_NOT_FOUND"
  | "STAGING_ATTESTATION_NOT_ENROLLED"
  | "STAGING_ATTESTATION_LEVEL_NOT_FOUND"
  | "STAGING_ATTESTATION_LEVEL_WRONG_KIND"
  | "STAGING_ATTESTATION_LEVEL_NOT_CURRENT"
  | "STAGING_ATTESTATION_REQUEST_CONFLICT"
  | "STAGING_ATTESTATION_COMPLETION_REFUSED"
  | "STAGING_ATTESTATION_STATE_CORRUPT"
  | "STAGING_ATTESTATION_INTERNAL_ERROR";

export class StagingAttestationError extends Error {
  readonly code: StagingAttestationErrorCode;
  constructor(code: StagingAttestationErrorCode, message: string) {
    super(message);
    this.name = "StagingAttestationError";
    this.code = code;
  }
}

export function isStagingAttestationError(
  error: unknown,
): error is StagingAttestationError {
  return error instanceof StagingAttestationError;
}

function fail(code: StagingAttestationErrorCode, message: string): never {
  throw new StagingAttestationError(code, message);
}

export type AttestStagingGateInput = {
  /** From the session. There is no body field through which this can be set. */
  operatorUserId: number;
  eventClass: StagingAttestationEventClassName;
  /** The exact learner whose gate is attested. */
  learnerUserId: number;
  /** The exact level. A stable code, never a level number or an internal id. */
  stableCode: string;
  requestId: string;
  evaluationTime?: Date;
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
};

/**
 * The operator-facing receipt.
 *
 * Carries a level identity, a verdict and nothing else. No balance, no amount,
 * no Pocket identifier, no learner email — an operator learns that the gate was
 * attested, not anything about the learner's money.
 */
export type StagingAttestationReceipt = {
  attestationId: number;
  eventClass: StagingAttestationEventClassName;
  /** False when an identical request replayed an existing attestation. */
  created: boolean;
  levelNumber: number;
  stableCode: string;
  /** True when the level is completed (by this call or an earlier identical one). */
  completed: boolean;
  /** A gate awards nothing. Always 0, always null. */
  xpAwarded: 0;
  xpTransactionId: null;
};

type AttestationClaim = {
  attestationId: number;
  created: boolean;
  enrollmentId: number;
  levelDefinitionId: number;
  levelNumber: number;
  stableCode: string;
  learnerUserId: number;
};

function validated(input: AttestStagingGateInput) {
  if (!Number.isSafeInteger(input.operatorUserId) || input.operatorUserId <= 0) {
    fail("STAGING_ATTESTATION_INPUT_INVALID", "operator is invalid");
  }
  if (!Number.isSafeInteger(input.learnerUserId) || input.learnerUserId <= 0) {
    fail("STAGING_ATTESTATION_INPUT_INVALID", "learner is invalid");
  }
  if (
    !(STAGING_ATTESTATION_EVENT_CLASSES as readonly string[]).includes(input.eventClass)
  ) {
    fail("STAGING_ATTESTATION_INPUT_INVALID", "event class is invalid");
  }
  if (
    typeof input.requestId !== "string" ||
    !STAGING_ATTESTATION_REQUEST_ID_PATTERN.test(input.requestId)
  ) {
    fail("STAGING_ATTESTATION_INPUT_INVALID", "requestId is invalid");
  }
  if (typeof input.stableCode !== "string" || input.stableCode.trim().length === 0) {
    fail("STAGING_ATTESTATION_INPUT_INVALID", "stableCode is invalid");
  }
  return {
    operatorUserId: input.operatorUserId,
    learnerUserId: input.learnerUserId,
    eventClass: input.eventClass,
    requestId: input.requestId,
    stableCode: input.stableCode,
  };
}

/* ------------------------------------------------------------------------ */
/* T1 — authorize, target, attest, audit                                     */
/* ------------------------------------------------------------------------ */

async function attestInTransaction(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof validated>,
  now: Date,
): Promise<AttestationClaim> {
  // Operator authorization is decided here, from the database, not from
  // anything the request carried. The HTTP gate has already required an admin
  // session; this is the same question asked again where it cannot be skipped
  // by a future caller.
  const operator = await tx.user.findUnique({
    where: { id: input.operatorUserId },
    select: { id: true, role: true, status: true },
  });
  if (!operator || operator.role !== "admin" || operator.status !== "active") {
    fail("STAGING_ATTESTATION_FORBIDDEN", "attestation operator must be an active admin");
  }
  // A learner cannot attest their own gate, even holding an admin role.
  if (operator.id === input.learnerUserId) {
    fail("STAGING_ATTESTATION_FORBIDDEN", "a learner cannot attest their own gate");
  }

  const learner = await tx.user.findUnique({
    where: { id: input.learnerUserId },
    select: { id: true, status: true },
  });
  if (!learner) {
    fail("STAGING_ATTESTATION_LEARNER_NOT_FOUND", "attestation learner does not exist");
  }
  if (learner.status !== "active") {
    fail("STAGING_ATTESTATION_FORBIDDEN", "attestation learner is not active");
  }

  const enrollment = await tx.userCurriculumEnrollment.findFirst({
    where: { userId: learner.id, status: "active" },
    orderBy: { id: "desc" },
    include: { curriculumVersion: { include: { levels: true } } },
  });
  if (!enrollment) {
    fail("STAGING_ATTESTATION_NOT_ENROLLED", "learner has no active enrollment");
  }

  const level = enrollment.curriculumVersion.levels.find(
    (candidate) => candidate.stableCode === input.stableCode,
  );
  if (!level) {
    fail("STAGING_ATTESTATION_LEVEL_NOT_FOUND", "level is not in the pinned curriculum");
  }

  // The event class decides the level kind. This is what stops the endpoint
  // being a generic "complete any level for me" tool.
  const expected = STAGING_ATTESTATION_EVENT_CLASS_TARGET[input.eventClass];
  if (level.type !== expected.type || level.completionMethod !== expected.completionMethod) {
    fail("STAGING_ATTESTATION_LEVEL_WRONG_KIND", "level does not match the event class");
  }
  if (input.eventClass === "financial_checkpoint" && !isFinancialCheckpointType(level.type)) {
    fail("STAGING_ATTESTATION_LEVEL_WRONG_KIND", "level is not a financial checkpoint");
  }

  const claimShape = {
    enrollmentId: enrollment.id,
    levelDefinitionId: level.id,
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    learnerUserId: learner.id,
  };

  // Replay. Checked BEFORE the "is this the current level?" rule, because a
  // replay is not a new question: an attestation that already completed the
  // level must still resolve once the learner has moved on.
  const existing = await tx.stagingAttestation.findUnique({
    where: {
      enrollmentId_levelDefinitionId_requestId: {
        enrollmentId: enrollment.id,
        levelDefinitionId: level.id,
        requestId: input.requestId,
      },
    },
    select: { id: true, eventClass: true },
  });
  if (existing) {
    if (existing.eventClass !== input.eventClass) {
      fail("STAGING_ATTESTATION_REQUEST_CONFLICT", "requestId is used for another event class");
    }
    return { ...claimShape, attestationId: existing.id, created: false };
  }

  // A different request identity for a gate already attested. Refused rather
  // than silently accepted, so rotating the id cannot accumulate attestations.
  const attestedAlready = await tx.stagingAttestation.findUnique({
    where: {
      enrollmentId_levelDefinitionId_eventClass: {
        enrollmentId: enrollment.id,
        levelDefinitionId: level.id,
        eventClass: input.eventClass,
      },
    },
    select: { id: true },
  });
  if (attestedAlready) {
    fail("STAGING_ATTESTATION_REQUEST_CONFLICT", "gate is already attested under another request identity");
  }

  // A NEW attestation must target the level the learner is actually standing
  // on. Attesting a gate they have not reached would leave a durable row the
  // completion engine can never act on.
  if (level.levelNumber !== enrollment.currentLevel) {
    fail("STAGING_ATTESTATION_LEVEL_NOT_CURRENT", "level is not the learner's current level");
  }

  const attestation = await tx.stagingAttestation.create({
    data: {
      eventClass: input.eventClass,
      enrollmentId: enrollment.id,
      levelDefinitionId: level.id,
      requestId: input.requestId,
      attestedById: operator.id,
      environment: STAGING_ATTESTATION_ENVIRONMENT,
      attestedAt: now,
    },
    select: { id: true },
  });

  // The audit is written in THIS transaction, so a durable attestation without
  // an audit record is not a state the database can hold.
  await tx.auditLog.create({
    data: {
      userId: operator.id,
      action: CURRICULUM_AUDIT_ACTIONS.stagingAttestationRecorded,
      entityType: "StagingAttestation",
      entityId: String(attestation.id),
      // Bounded: identities, a gate and a verdict. No email, no name, no
      // balance, no amount, no Pocket identifier. The request identity is
      // hashed rather than quoted, the same discipline the completion audit
      // applies to its source id.
      metadata: {
        environment: STAGING_ATTESTATION_ENVIRONMENT,
        eventClass: input.eventClass,
        attestationId: attestation.id,
        attestedById: operator.id,
        learnerUserId: learner.id,
        enrollmentId: enrollment.id,
        curriculumVersionId: enrollment.curriculumVersionId,
        levelDefinitionId: level.id,
        levelNumber: level.levelNumber,
        stableCode: level.stableCode,
        requestIdHash: `sha256:${createHash("sha256").update(input.requestId, "utf8").digest("hex")}`,
      },
    },
  });

  return { ...claimShape, attestationId: attestation.id, created: true };
}

/* ------------------------------------------------------------------------ */
/* T2 — complete through the canonical engine                                */
/* ------------------------------------------------------------------------ */

/**
 * A financial checkpoint is not startable by the learner (the start owner
 * refuses it outright), so the `in_progress` row the completion primitive
 * requires is created here and handed straight over — exactly what the real
 * verification engine does on a `met` outcome. This function never writes
 * `completed`, never writes XP and never moves `currentLevel`: the completion
 * primitive owns all three.
 */
async function completeAttestedCheckpoint(
  db: PrismaClient,
  claim: AttestationClaim,
  now: Date,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const existing = await tx.userLevelProgress.findFirst({
      where: { enrollmentId: claim.enrollmentId, levelDefinitionId: claim.levelDefinitionId },
      select: { id: true, status: true },
    });
    if (existing?.status === "completed") return true;
    if (!existing) {
      const level = await tx.levelDefinition.findUniqueOrThrow({
        where: { id: claim.levelDefinitionId },
        select: { curriculumVersionId: true },
      });
      await tx.userLevelProgress.create({
        data: {
          enrollmentId: claim.enrollmentId,
          curriculumVersionId: level.curriculumVersionId,
          levelDefinitionId: claim.levelDefinitionId,
          status: "in_progress",
          startedAt: now,
          lastProgressAt: now,
          attemptCount: 0,
        },
      });
    }

    const completion = await completeCurriculumLevelInTransaction(tx, {
      enrollmentId: claim.enrollmentId,
      levelDefinitionId: claim.levelDefinitionId,
      sourceType: "staging_attested_checkpoint",
      sourceId: `staging-attestation:${claim.attestationId}`,
      // The OPERATOR is the actor. Recording the learner here would say the
      // learner passed a gate they did not.
      actorId: null,
      evaluationTime: now,
    });
    if (completion.xpAwarded !== 0 || completion.xpTransactionId !== null) {
      // Unreachable: the source is zero-reward-only. Throwing rolls the whole
      // transaction back rather than letting an attestation mint XP.
      throw new Error("staging attestation awarded XP");
    }
    return true;
  });
}

/* ------------------------------------------------------------------------ */
/* Command                                                                   */
/* ------------------------------------------------------------------------ */

export async function attestStagingGate({
  db = prisma,
  env = process.env,
  evaluationTime,
  ...rawInput
}: AttestStagingGateInput): Promise<StagingAttestationReceipt> {
  // The environment gate runs FIRST, before anything is read or written, so a
  // deployment that is not staging costs nothing and can leave no trace.
  //
  // BOTH POLICIES MUST SAY YES, and that is the whole point of asking twice.
  //
  //   `isStagingAttestationUsable()`     the REAL process environment
  //   `isStagingAttestationUsable(env)`  the environment this CALLER supplied
  //
  // The injected `env` exists so a test can describe a deployment it is not
  // running on. Consulting it ALONE would make it an authority, and a
  // caller-supplied authority is not one: a direct server-side caller on a
  // production host could then hand in `{ ATA_ENVIRONMENT: "staging" }` and
  // persist a durable, audited `StagingAttestation` row — the completion would
  // still be refused downstream, but the evidence trail would already carry a
  // row that says a staging attestation was made on a production deployment.
  //
  // Requiring both means a supplied environment can only ever NARROW the
  // capability, never widen it. `env` defaults to `process.env`, so for every
  // real caller the two questions are the same question and nothing changes.
  //
  // This is deliberately NOT a substitute for the re-check inside the
  // completion primitive (`assertStagingAttestationProof`), which asks the real
  // `process.env` again at the moment the level is completed. Two independent
  // gates, one at the write and one at the effect.
  if (!isStagingAttestationUsable() || !isStagingAttestationUsable(env)) {
    fail("STAGING_ATTESTATION_DISABLED", "staging attestation is not available here");
  }

  const input = validated(rawInput as AttestStagingGateInput);
  const now = evaluationTime ?? new Date();

  let claim: AttestationClaim;
  try {
    claim = await db.$transaction((tx) => attestInTransaction(tx, input, now));
  } catch (error) {
    // The loser of a concurrent identical attestation: a unique index rejected
    // the insert, which means the winner already holds it. Re-resolve rather
    // than racing, so both callers see the same one attestation.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      claim = await db.$transaction((tx) => attestInTransaction(tx, input, now));
    } else {
      throw error;
    }
  }

  let completed = false;
  try {
    if (input.eventClass === "financial_checkpoint") {
      completed = await completeAttestedCheckpoint(db, claim, now);
    } else {
      // R3. The SAME reconciliation the authenticated postback uses, in an
      // explicit staging-attested source mode. There is no second progression
      // engine for level 1, and the package semantics stay
      // `external_event:pocket_postback`.
      const outcome = await reconcilePocketRegistrationLevelCompletion(claim.learnerUserId, {
        evaluationTime: now,
        stagingAttestation: { attestationId: claim.attestationId },
      });
      if (outcome.outcome !== "completed" && outcome.outcome !== "already_completed") {
        fail(
          "STAGING_ATTESTATION_COMPLETION_REFUSED",
          `registration reconciliation refused: ${outcome.outcome}`,
        );
      }
      completed = true;
    }
  } catch (error) {
    if (isStagingAttestationError(error)) throw error;
    if (isCurriculumLevelCompletionError(error)) {
      // The attestation is durable and audited either way. An identical retry
      // replays it and re-attempts the completion, which is why this is a
      // refusal rather than a rollback.
      fail("STAGING_ATTESTATION_COMPLETION_REFUSED", `completion refused: ${error.code}`);
    }
    throw error;
  }

  return {
    attestationId: claim.attestationId,
    eventClass: input.eventClass,
    created: claim.created,
    levelNumber: claim.levelNumber,
    stableCode: claim.stableCode,
    completed,
    xpAwarded: 0,
    xpTransactionId: null,
  };
}
