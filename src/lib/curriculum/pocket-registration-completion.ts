/**
 * L1OWNER-1 — reconcile the Pocket-registration level completion.
 *
 * WHAT THIS EXISTS FOR
 * Level 1 is `external_event:pocket_postback`. The learner completes it by
 * registering with Pocket, and the only trustworthy witness is a postback ATA
 * itself authenticated. This module is the single, narrow bridge between that
 * authenticated event and the curriculum's completion owner.
 *
 * WHY IT IS A RECONCILIATION AND NOT A DIRECT WRITE
 * It never touches `UserLevelProgress`. It starts the level through the shipped
 * start owner and completes it through the shipped completion owner, so every
 * prerequisite rule, every transaction boundary, every audit event and the
 * zero-XP contract stay exactly where they already were. A second progress
 * implementation is precisely what this phase exists to remove.
 *
 * WHY IT IS IDEMPOTENT RATHER THAN "ONLY WHEN THE IDENTITY WAS CREATED"
 * A request can bind the identity and then fail before completing — a crash, a
 * lost connection, a rolled-back transaction. If completion were gated on
 * `created === true`, that learner would be stuck forever with an identity and
 * no progress, and no retry could ever fix it. So an identical existing binding
 * remains fully eligible: replaying the same registration reconciles.
 *
 * REGISTRATION MAY LEGALLY PRECEDE ENROLMENT
 * `POST /api/exchange/referral-link` requires only a session, so a learner can
 * obtain a clickid and register with Pocket before enrolling. That is not an
 * error and must not complete anything — there is no enrolment to complete
 * against. It returns `pending_enrollment`, the identity stays durable, and the
 * enrolment owner calls this same function afterwards. Both orderings converge.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  completeCurriculumLevelInTransaction,
  isCurriculumLevelCompletionError,
} from "./completion";
import { startCurrentCurriculumLevel } from "./level-state";

/** The one level this owner may ever complete. */
export const POCKET_REGISTRATION_STABLE_CODE = "v2.l001.registraciya-pocket";
const POCKET_REGISTRATION_LEVEL_TYPE = "external_event";
const POCKET_REGISTRATION_COMPLETION_METHOD = "pocket_postback";

export type PocketRegistrationReconcileOutcome =
  /** The level was completed by this call. */
  | "completed"
  /** It was already complete; nothing to do. */
  | "already_completed"
  /** No active enrolment yet — legal, and retried by the enrolment owner. */
  | "pending_enrollment"
  /** No authoritative PocketTraderIdentity for this learner. */
  | "identity_missing"
  /** The learner is not standing on the registration level. */
  | "not_eligible"
  /** The published curriculum does not match the expected registration level. */
  | "configuration_error"
  /** A retryable infrastructure failure; an identical postback may retry. */
  | "transient_failure";

export type PocketRegistrationReconcileResult = {
  readonly outcome: PocketRegistrationReconcileOutcome;
  /** Bounded, non-identifying detail for operators. Never a Pocket value. */
  readonly detail?: string;
};

type Db = { $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T> };

/**
 * A8/R3 — the PREPROD-only alternative witness.
 *
 * When present, the trusted evidence is a durable `StagingAttestation` written
 * by an authorized operator on a staging deployment instead of a
 * `PocketTraderIdentity` written by an authenticated postback. Everything else
 * about this function is unchanged: the same start owner, the same completion
 * primitive, the same idempotency, the same zero-XP contract. There is still
 * exactly one progression engine for level 1.
 *
 * The completion SOURCE differs, permanently and visibly, so a QA attestation
 * can never be mistaken for a real Pocket registration. The environment gate
 * itself lives in the completion primitive, which refuses a
 * `staging_attested_registration` outside staging — so this option cannot
 * become a production bypass by being passed.
 */
export type PocketRegistrationStagingAttestation = {
  readonly attestationId: number;
};

/**
 * Reconcile one learner, idempotently.
 *
 * `actorUserId` is the learner: the completion is recorded as having been made
 * on their behalf by a trusted server event, not by a staff member. There is no
 * parameter through which a caller could nominate a different level, a
 * different learner, or a different completion source — `stagingAttestation`
 * selects the WITNESS, not the level and not the learner.
 */
export async function reconcilePocketRegistrationLevelCompletion(
  learnerUserId: number,
  options: {
    db?: Db;
    evaluationTime?: Date;
    stagingAttestation?: PocketRegistrationStagingAttestation;
  } = {},
): Promise<PocketRegistrationReconcileResult> {
  if (!Number.isSafeInteger(learnerUserId) || learnerUserId <= 0) {
    return { outcome: "not_eligible", detail: "invalid learner" };
  }
  const db = (options.db ?? prisma) as Db;
  const now = options.evaluationTime ?? new Date();
  const attestation = options.stagingAttestation ?? null;

  // The witness is checked BEFORE any curriculum work, so a learner with none
  // costs nothing and can leave no trace.
  //
  // In staging-attested mode there is deliberately NO PocketTraderIdentity
  // lookup and no identity is created: the whole point is that no Pocket
  // registration happened, and inventing a binding would be the fake partner
  // event this design exists to avoid.
  let sourceType: "pocket_registration_postback" | "staging_attested_registration";
  let sourceId: string;
  if (attestation) {
    if (!Number.isSafeInteger(attestation.attestationId) || attestation.attestationId <= 0) {
      return { outcome: "not_eligible", detail: "invalid attestation" };
    }
    sourceType = "staging_attested_registration";
    sourceId = `staging-attestation:${attestation.attestationId}`;
  } else {
    const identity = await prisma.pocketTraderIdentity.findUnique({
      where: { userId: learnerUserId },
      select: { id: true, source: true },
    });
    if (!identity) return { outcome: "identity_missing" };
    if (identity.source !== "registration_postback") {
      return { outcome: "identity_missing", detail: "untrusted provenance" };
    }
    sourceType = "pocket_registration_postback";
    // Names the identity ROW, never a Pocket user id.
    sourceId = `pocket-registration:${identity.id}`;
  }

  const enrollment = await prisma.userCurriculumEnrollment.findFirst({
    where: { userId: learnerUserId, status: "active" },
    select: { id: true, curriculumVersionId: true },
  });
  if (!enrollment) return { outcome: "pending_enrollment" };

  const level = await prisma.levelDefinition.findFirst({
    where: {
      curriculumVersionId: enrollment.curriculumVersionId,
      stableCode: POCKET_REGISTRATION_STABLE_CODE,
    },
    select: { id: true, type: true, completionMethod: true, xpReward: true },
  });
  if (!level) return { outcome: "configuration_error", detail: "registration level not published" };
  if (
    level.type !== POCKET_REGISTRATION_LEVEL_TYPE ||
    level.completionMethod !== POCKET_REGISTRATION_COMPLETION_METHOD
  ) {
    return { outcome: "configuration_error", detail: "registration level contract changed" };
  }

  const existing = await prisma.userLevelProgress.findFirst({
    where: { enrollmentId: enrollment.id, levelDefinitionId: level.id },
    select: { status: true },
  });
  if (existing?.status === "completed") return { outcome: "already_completed" };

  try {
    // The shipped start owner opens its own transaction and starts the CURRENT
    // level. It is idempotent, so calling it here is safe on a replay — and if
    // completion below fails afterwards the level simply stays `in_progress`,
    // which is exactly the state an identical postback replay reconciles from.
    // That is why start and complete are deliberately NOT forced into one
    // transaction: a half-started level is recoverable, a lost identity is not.
    const started = await startCurrentCurriculumLevel({
      actorUserId: learnerUserId,
      asOf: now,
    });
    if (started.kind !== "started") {
      return { outcome: "not_eligible", detail: "level is not startable" };
    }
    if (started.levelDefinition.id !== level.id) {
      // The learner is standing on some other level. Registration completes L1
      // and nothing else, ever.
      return { outcome: "not_eligible", detail: "current level is not registration" };
    }

    return await db.$transaction(async (tx) => {
      const completion = await completeCurriculumLevelInTransaction(tx, {
        enrollmentId: enrollment.id,
        levelDefinitionId: level.id,
        sourceType,
        sourceId,
        // A postback completes on the learner's behalf. A staging attestation
        // is an OPERATOR act and records no learner actor, so the completion
        // audit never says the learner registered when they did not.
        actorId: attestation ? null : learnerUserId,
        evaluationTime: now,
      });

      if (completion.xpAwarded !== 0 || completion.xpTransactionId !== null) {
        // Unreachable: the source is zero-reward-only and L1 awards nothing.
        // Throwing rolls the whole transaction back rather than letting a
        // registration mint XP.
        throw new Error("pocket registration completion awarded XP");
      }
      return { outcome: completion.created ? ("completed" as const) : ("already_completed" as const) };
    });
  } catch (error) {
    if (isCurriculumLevelCompletionError(error)) {
      // A refusal by the owner is a fact about eligibility, not an outage.
      return { outcome: "not_eligible", detail: error.code };
    }
    // Anything else is infrastructure. The caller must NOT report a final
    // success: an identical postback replay is the legitimate retry.
    return { outcome: "transient_failure" };
  }
}
