/**
 * QAOPS-1 — host-only execution of the EXISTING typed StagingAttestation
 * operation, as the synthetic PREPROD QA operator.
 *
 * THIS FILE IMPLEMENTS NO COMPLETION. It reads state, refuses obvious
 * mismatches, and then calls `attestStagingGate` — the same domain service
 * `POST /api/admin/curriculum/staging-attestations` calls, with the same
 * arguments, in the same order. Everything downstream of that call is the
 * accepted chain and is untouched here:
 *
 *     attestStagingGate
 *       -> StagingAttestation row + AuditLog, one transaction
 *       -> reconcilePocketRegistrationLevelCompletion   (pocket_registration)
 *          or completeCurriculumLevelInTransaction      (financial_checkpoint)
 *       -> UserLevelProgress / currentLevel / XP, owned entirely by those
 *
 * NOTHING IN THIS FILE WRITES `UserLevelProgress`, XP, `XPTransaction` or
 * `UserCurriculumEnrollment`. It has no Prisma write of any kind.
 *
 * WHAT IT CANNOT EXPRESS. Two event classes, taken from the domain's own
 * `STAGING_ATTESTATION_EVENT_CLASSES`, and a target. There is no parameter for
 * an amount, a balance, a deposit, a Pocket transaction, a P&L figure or a
 * provider event — not because the CLI filters them out, but because
 * `AttestStagingGateInput` has nowhere to put one and `StagingAttestation` has
 * no such column. The argument parser additionally names the money-shaped flags
 * explicitly and refuses them, so an operator who tries learns why rather than
 * seeing "unknown option".
 *
 * WHY THE PRE-FLIGHT EXISTS AT ALL, GIVEN THE DOMAIN RE-CHECKS EVERYTHING
 * Two reasons, neither of them "to decide". First, an operator running a DRY RUN
 * needs to see the target state before touching it. Second, the phase contract
 * requires the tool to verify the target through existing domain state before
 * writing. Each check below therefore mirrors a rule that
 * `staging-attestation.ts` enforces authoritatively, IN ITS ORDER, and cites it.
 * If the two ever disagree, the domain wins: the pre-flight can only refuse
 * something the domain would also have refused, never permit something it would
 * not.
 */
import type { PrismaClient } from "@prisma/client";
import {
  attestStagingGate,
  STAGING_ATTESTATION_EVENT_CLASS_TARGET,
  STAGING_ATTESTATION_EVENT_CLASSES,
  type StagingAttestationEventClassName,
  type StagingAttestationReceipt,
} from "@/lib/curriculum/staging-attestation";
import { QA_OPERATOR_EMAIL, QA_OPERATOR_USER_ROLE } from "./identity";

export type AttestTarget = {
  readonly eventClass: StagingAttestationEventClassName;
  readonly learnerUserId: number;
  readonly stableCode: string;
  readonly requestId: string;
};

export type PreflightRefusalCode =
  | "OPERATOR_NOT_PROVISIONED"
  | "OPERATOR_NOT_AUTHORIZED"
  | "OPERATOR_IS_THE_LEARNER"
  | "LEARNER_NOT_FOUND"
  | "LEARNER_NOT_ACTIVE"
  | "LEARNER_NOT_ENROLLED"
  | "LEVEL_NOT_FOUND"
  | "LEVEL_WRONG_KIND"
  | "LEVEL_NOT_CURRENT"
  | "GATE_ALREADY_ATTESTED";

/** Bounded facts about the target. No email, no name, no money, ever. */
export type PreflightFacts = {
  readonly operatorUserId: number | null;
  readonly learnerUserId: number;
  readonly enrollmentId: number | null;
  readonly curriculumVersionId: number | null;
  readonly currentLevel: number | null;
  readonly levelDefinitionId: number | null;
  readonly levelNumber: number | null;
  readonly levelType: string | null;
  readonly levelCompletionMethod: string | null;
  readonly expectedLevelType: string;
  readonly expectedCompletionMethod: string;
  /** True when an identical request would REPLAY rather than attest anew. */
  readonly replayOfSameRequest: boolean;
};

export type PreflightResult =
  | { readonly kind: "ok"; readonly facts: PreflightFacts }
  | {
      readonly kind: "refused";
      readonly code: PreflightRefusalCode;
      readonly detail: string;
      readonly facts: PreflightFacts;
    };

function emptyFacts(target: AttestTarget): PreflightFacts {
  const expected = STAGING_ATTESTATION_EVENT_CLASS_TARGET[target.eventClass];
  return {
    operatorUserId: null,
    learnerUserId: target.learnerUserId,
    enrollmentId: null,
    curriculumVersionId: null,
    currentLevel: null,
    levelDefinitionId: null,
    levelNumber: null,
    levelType: null,
    levelCompletionMethod: null,
    expectedLevelType: expected.type,
    expectedCompletionMethod: expected.completionMethod,
    replayOfSameRequest: false,
  };
}

/**
 * Resolve the ONE synthetic operator.
 *
 * By reserved address, never by an id or a role search — so this cannot be
 * pointed at whichever admin happens to exist. A StaffProfile is deliberately
 * NOT required: it gates CRM access (`resolveCrmSession`) and nothing on this
 * path, and demanding one here would invent an authorization rule the product
 * does not have.
 */
export async function resolveQaOperator(
  db: PrismaClient,
): Promise<{ id: number; role: string; status: string } | null> {
  return db.user.findUnique({
    where: { email: QA_OPERATOR_EMAIL },
    select: { id: true, role: true, status: true },
  });
}

/**
 * The read-only pre-flight. Writes nothing, on any path.
 *
 * The check order mirrors `attestInTransaction`: operator authorization, then
 * self-attestation, then learner, then enrollment, then level identity, then
 * level kind, then replay, then "is this the current level" LAST — because a
 * replay of an already-completed gate must still resolve after the learner has
 * moved on, exactly as the domain allows.
 */
export async function preflightAttestation(
  db: PrismaClient,
  target: AttestTarget,
): Promise<PreflightResult> {
  const expected = STAGING_ATTESTATION_EVENT_CLASS_TARGET[target.eventClass];
  let facts = emptyFacts(target);

  // staging-attestation.ts: the operator must be an active admin, re-checked
  // there inside the transaction. This resolves the RESERVED principal only.
  const operator = await resolveQaOperator(db);
  if (!operator) {
    return {
      kind: "refused",
      code: "OPERATOR_NOT_PROVISIONED",
      detail: `no principal exists at ${QA_OPERATOR_EMAIL}; run the provision command first`,
      facts,
    };
  }
  facts = { ...facts, operatorUserId: operator.id };

  if (operator.role !== QA_OPERATOR_USER_ROLE || operator.status !== "active") {
    return {
      kind: "refused",
      code: "OPERATOR_NOT_AUTHORIZED",
      detail: `the QA operator must be an active ${QA_OPERATOR_USER_ROLE} (role is ${operator.role}, status is ${operator.status})`,
      facts,
    };
  }

  // "A learner cannot attest their own gate, even holding an admin role."
  if (operator.id === target.learnerUserId) {
    return {
      kind: "refused",
      code: "OPERATOR_IS_THE_LEARNER",
      detail: "the QA operator cannot attest a gate for itself",
      facts,
    };
  }

  const learner = await db.user.findUnique({
    where: { id: target.learnerUserId },
    select: { id: true, status: true },
  });
  if (!learner) {
    return {
      kind: "refused",
      code: "LEARNER_NOT_FOUND",
      detail: "the target learner does not exist",
      facts,
    };
  }
  if (learner.status !== "active") {
    return {
      kind: "refused",
      code: "LEARNER_NOT_ACTIVE",
      detail: `the target learner is ${learner.status}, not active`,
      facts,
    };
  }

  // The SAME enrollment selection the domain makes: the most recent ACTIVE one.
  const enrollment = await db.userCurriculumEnrollment.findFirst({
    where: { userId: learner.id, status: "active" },
    orderBy: { id: "desc" },
    select: { id: true, curriculumVersionId: true, currentLevel: true },
  });
  if (!enrollment) {
    return {
      kind: "refused",
      code: "LEARNER_NOT_ENROLLED",
      detail: "the target learner has no active curriculum enrollment",
      facts,
    };
  }
  facts = {
    ...facts,
    enrollmentId: enrollment.id,
    curriculumVersionId: enrollment.curriculumVersionId,
    currentLevel: enrollment.currentLevel,
  };

  const level = await db.levelDefinition.findFirst({
    where: {
      curriculumVersionId: enrollment.curriculumVersionId,
      stableCode: target.stableCode,
    },
    select: {
      id: true,
      levelNumber: true,
      stableCode: true,
      type: true,
      completionMethod: true,
    },
  });
  if (!level) {
    return {
      kind: "refused",
      code: "LEVEL_NOT_FOUND",
      detail: "the stable code is not a level of the learner's pinned curriculum version",
      facts,
    };
  }
  facts = {
    ...facts,
    levelDefinitionId: level.id,
    levelNumber: level.levelNumber,
    levelType: level.type,
    levelCompletionMethod: level.completionMethod,
  };

  // The event class decides the level kind, from the domain's own table. This is
  // what makes "wrong type" and "wrong level" different refusals rather than one
  // vague one, and it is why this cannot be aimed at a lesson, a report, an
  // assessment or a final exam.
  if (level.type !== expected.type || level.completionMethod !== expected.completionMethod) {
    return {
      kind: "refused",
      code: "LEVEL_WRONG_KIND",
      detail: `level is ${level.type}:${level.completionMethod}, but ${target.eventClass} owns ${expected.type}:${expected.completionMethod}`,
      facts,
    };
  }

  // Replay is checked BEFORE the current-level rule, for the domain's reason: an
  // identical retry of an attestation that already completed the level must
  // still resolve once the learner has moved on.
  const sameRequest = await db.stagingAttestation.findFirst({
    where: {
      enrollmentId: enrollment.id,
      levelDefinitionId: level.id,
      requestId: target.requestId,
      eventClass: target.eventClass,
    },
    select: { id: true },
  });
  if (sameRequest) {
    return { kind: "ok", facts: { ...facts, replayOfSameRequest: true } };
  }

  // A DIFFERENT request identity for a gate already attested. The domain refuses
  // this so that rotating the id cannot accumulate attestations; refusing it
  // here too means a dry run says so before anyone tries.
  const attestedAlready = await db.stagingAttestation.findFirst({
    where: {
      enrollmentId: enrollment.id,
      levelDefinitionId: level.id,
      eventClass: target.eventClass,
    },
    select: { id: true },
  });
  if (attestedAlready) {
    return {
      kind: "refused",
      code: "GATE_ALREADY_ATTESTED",
      detail: "this gate is already attested under another request identity",
      facts,
    };
  }

  if (level.levelNumber !== enrollment.currentLevel) {
    return {
      kind: "refused",
      code: "LEVEL_NOT_CURRENT",
      detail: `level ${level.levelNumber} is not the learner's current level (${enrollment.currentLevel})`,
      facts,
    };
  }

  return { kind: "ok", facts };
}

/**
 * Execute the attestation through the accepted domain service.
 *
 * The operator id comes from the RESERVED principal resolved here, never from an
 * argument — there is no `--operator` flag — so the audit actor
 * `attestStagingGate` records (`attestedById`, and `AuditLog.userId` on the
 * `stagingAttestationRecorded` row it writes in the same transaction) is always
 * the synthetic QA principal and never null, a system actor or a real employee.
 */
export async function attestAsQaOperator(
  db: PrismaClient,
  operatorUserId: number,
  target: AttestTarget,
): Promise<StagingAttestationReceipt> {
  return attestStagingGate({
    db,
    operatorUserId,
    eventClass: target.eventClass,
    learnerUserId: target.learnerUserId,
    stableCode: target.stableCode,
    requestId: target.requestId,
  });
}

/** Narrow a raw string to one of exactly the two domain event classes. */
export function asEventClass(value: string): StagingAttestationEventClassName | null {
  return (STAGING_ATTESTATION_EVENT_CLASSES as readonly string[]).includes(value)
    ? (value as StagingAttestationEventClassName)
    : null;
}
