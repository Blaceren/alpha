/**
 * LO-REVIEW-WORKITEM-UNREACHABLE-1 — the derived operational mirror of
 * canonical educational review.
 *
 * ============================================================================
 * THE ONE SENTENCE THIS FILE EXISTS TO ENFORCE
 *
 *   Learner Operations MIRRORS canonical educational truth. It never authors
 *   it, and it never disagrees with it.
 * ============================================================================
 *
 * WHAT WAS WRONG. `report_review` and `mentor_review` were declared case types
 * with required canonical anchors, two queues were seeded for them, and nothing
 * in the product could create one: no bridge from the canonical owners, and a
 * blank CRM form cannot supply an anchor. Two of seven types, two of four
 * queues and both anchor columns were unreachable — the "one department, one
 * work queue" claim covered support and escalation only, and the two
 * educational families lived entirely outside it.
 *
 * WHAT THIS LAYER OWNS. Queue presence, assignment, SLA, operational messages,
 * internal notes, escalation, QA/VOC linkage, operational timeline.
 *
 * WHAT IT DOES NOT OWN, AND CANNOT. `ReportSubmission` state, report revision
 * and approval authority, mentor-review progression, `UserLevelProgress`
 * completion, Academy progression. There is no code path here that writes any
 * of them, and §6/§9's terminal invariants make the operational case unable to
 * CLAIM completion the canonical object has not reached.
 *
 * WHY EVERY FUNCTION TAKES A `tx`. The canonical owner's transaction is the
 * only place atomicity is available. A submitted report whose work item failed
 * to appear is exactly the defect being fixed, so "create it afterwards, best
 * effort" would reintroduce it in a narrower window. There is no outbox in this
 * codebase and this integration does not invent one: the canonical owners
 * already run a single interactive transaction, and these calls join it.
 *
 * WHY THE ANCHOR IS THE SUBMISSION AND NOT THE REVISION. `ReportSubmission`
 * survives the whole reject/resubmit lifecycle; `ReportRevision` does not. One
 * report is one piece of operational work no matter how many times it goes
 * back and forth, and anchoring to the revision would open a fresh case on
 * every resubmission — a queue that grows with reviewer strictness.
 *
 * WHY THE MENTOR ANCHOR IS `UserLevelProgress`. That IS the canonical
 * mentor-review object: `requestMentorReview` and `approveMentorReview` both
 * transition that row and there is no separate review entity. Deriving identity
 * from `userId + levelNumber` would be a weaker key for the same fact.
 *
 * IDEMPOTENCE. Every `ensure` is a read-then-create guarded by a partial UNIQUE
 * index on each anchor column (migration 52). The index is the authority: a
 * concurrent pair both passing the read produces one row and one
 * `LEARNER_OPS_DUPLICATE`, never two cases for one canonical object.
 */
import { Prisma } from "@prisma/client";
import type { LearnerOpsCaseStatus } from "@prisma/client";
import {
  createCaseInTransaction,
  transitionCaseInTransaction,
  type StaffActor,
} from "@/lib/learner-ops/case";

/** The seeded queues these two families are routed to. Config, not literals in callers. */
export const REPORT_REVIEW_QUEUE_KEY = "report_review";
export const MENTOR_REVIEW_QUEUE_KEY = "mentor_review";

type Tx = Prisma.TransactionClient;

/**
 * The canonical states an operational mirror reacts to.
 *
 * Deliberately NOT the full `ReportSubmission.status` union: `draft` has no
 * operational work item at all, because nothing has been submitted and nobody
 * is waiting. The mirror begins at the moment ATA owes the learner an answer.
 */
export type CanonicalReportState = "pending_review" | "rejected" | "approved";

/**
 * THE MAPPING, stated once.
 *
 *   pending_review  ATA owes the learner a review        -> operational work is live
 *   rejected        the learner owes ATA a resubmission  -> waiting_learner
 *   approved        the educational outcome is final     -> resolved
 *
 * `rejected` is the canonical vocabulary for "revision requested" in this
 * domain — `ReportReview.decision` is `approved | rejected` and a rejection
 * REQUIRES a reason and a corrective action, which is what makes it a request
 * for changes rather than a refusal. The learner resubmits and the same
 * submission returns to `pending_review`. This phase adds no new canonical
 * vocabulary for that; it only mirrors it.
 *
 * `waiting_learner` is the honest operational state for it, and it is the one
 * the SLA engine already pauses on — so the resolution clock stops while the
 * ball is with the learner and resumes on resubmission, with no special-casing
 * anywhere in `sla.ts`.
 */
const REPORT_OPERATIONAL_STATE: Record<CanonicalReportState, LearnerOpsCaseStatus> = {
  pending_review: "in_progress",
  rejected: "waiting_learner",
  approved: "resolved",
};

/**
 * The system actor for reconciliation the canonical owner performs.
 *
 * A derived transition is attributed to the human who made the CANONICAL
 * decision wherever one exists — the reviewer who approved, the learner whose
 * resubmission moved it. `null` means the platform itself reconciled, which is
 * true for the submit-time creation: no member of staff did anything.
 */
export type ReviewIntegrationActor = StaffActor | null;

/**
 * The operational actor for a canonical decision, resolved from the deciding
 * USER.
 *
 * A canonical reviewer is a `User`; the operational timeline is written in
 * terms of `StaffProfile`. This maps one to the other and returns `null` when
 * the decider has no staff identity — a learner resubmitting, or the platform
 * itself. Callers pass `null` straight through: `writeEvent` already accepts a
 * null actor and records the transition as the system's, which is the honest
 * answer rather than attributing it to whichever employee happens to be handy.
 */
export async function resolveOperationalActor(
  tx: Tx,
  userId: number | null,
): Promise<StaffActor | null> {
  if (userId === null) return null;
  const profile = await tx.staffProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  return profile ? { staffId: profile.id, userId } : null;
}

/* ------------------------------------------------------------------ report */

export type EnsureReportReviewWorkItemInput = {
  readonly submissionId: number;
  readonly userId: number;
  readonly levelNumber: number;
  readonly levelTitle: string;
  readonly actor?: ReviewIntegrationActor;
};

/**
 * Ensure exactly one operational work item exists for this canonical report.
 *
 * Returns the case id either way and says whether this call created it, so a
 * caller can audit "created" separately from "already existed" rather than
 * inferring it.
 */
export async function ensureReportReviewWorkItem(
  tx: Tx,
  input: EnsureReportReviewWorkItemInput,
): Promise<{ caseId: string; created: boolean }> {
  const existing = await tx.learnerOpsCase.findFirst({
    where: { reportSubmissionId: input.submissionId },
    select: { id: true },
  });
  if (existing) return { caseId: existing.id, created: false };

  try {
    const created = await createCaseInTransaction(tx, {
      userId: input.userId,
      type: "report_review",
      queueKey: REPORT_REVIEW_QUEUE_KEY,
      subject: `Отчёт на проверке — уровень ${input.levelNumber}: ${input.levelTitle}`,
      // The details name the canonical object and say plainly where authority
      // lives, so an operator reading the case cannot mistake it for a place to
      // decide the educational outcome.
      details:
        `Операционная карточка проверки отчёта. Канонический отчёт №${input.submissionId}. ` +
        `Учебное решение принимается только в проверке отчётов Академии — статус этой карточки ` +
        `не утверждает и не отклоняет отчёт.`,
      reportSubmissionId: input.submissionId,
      actor: input.actor ?? null,
    });
    return { caseId: created.id, created: true };
  } catch (error) {
    // The partial UNIQUE index is the concurrency backstop. If a racing
    // transaction won, the work item exists — which is what the caller asked
    // for — so re-read it rather than failing a canonical submission.
    if (isAnchorUniqueViolation(error)) {
      const winner = await tx.learnerOpsCase.findFirst({
        where: { reportSubmissionId: input.submissionId },
        select: { id: true },
      });
      if (winner) return { caseId: winner.id, created: false };
    }
    throw error;
  }
}

/**
 * Move the derived operational case to the state the canonical report is in.
 *
 * A no-op when they already agree, so a canonical retry cannot produce a second
 * timeline entry, a second version bump or a second notification.
 */
export async function reconcileReportReviewOperationalState(
  tx: Tx,
  input: {
    readonly submissionId: number;
    readonly canonicalState: CanonicalReportState;
    readonly actor: StaffActor | null;
    readonly reason?: string;
  },
): Promise<{ caseId: string; changed: boolean } | null> {
  const target = REPORT_OPERATIONAL_STATE[input.canonicalState];
  return reconcileAnchoredCase(tx, {
    where: { reportSubmissionId: input.submissionId },
    target,
    actor: input.actor,
    reason: input.reason ?? `report:${input.canonicalState}`,
  });
}

/* ------------------------------------------------------------------ mentor */

export type EnsureMentorReviewWorkItemInput = {
  readonly userLevelProgressId: number;
  readonly userId: number;
  readonly levelNumber: number;
  readonly levelTitle: string;
  readonly actor?: ReviewIntegrationActor;
};

export async function ensureMentorReviewWorkItem(
  tx: Tx,
  input: EnsureMentorReviewWorkItemInput,
): Promise<{ caseId: string; created: boolean }> {
  const existing = await tx.learnerOpsCase.findFirst({
    where: { userLevelProgressId: input.userLevelProgressId },
    select: { id: true },
  });
  if (existing) return { caseId: existing.id, created: false };

  try {
    const created = await createCaseInTransaction(tx, {
      userId: input.userId,
      type: "mentor_review",
      queueKey: MENTOR_REVIEW_QUEUE_KEY,
      subject: `Практика на проверке — уровень ${input.levelNumber}: ${input.levelTitle}`,
      details:
        `Операционная карточка проверки практики. Канонический прогресс №${input.userLevelProgressId}. ` +
        `Уровень завершает только каноническое подтверждение наставника — статус этой карточки ` +
        `не завершает уровень.`,
      userLevelProgressId: input.userLevelProgressId,
      actor: input.actor ?? null,
    });
    return { caseId: created.id, created: true };
  } catch (error) {
    if (isAnchorUniqueViolation(error)) {
      const winner = await tx.learnerOpsCase.findFirst({
        where: { userLevelProgressId: input.userLevelProgressId },
        select: { id: true },
      });
      if (winner) return { caseId: winner.id, created: false };
    }
    throw error;
  }
}

/**
 * Mentor review has exactly two canonical states this layer mirrors, because
 * the accepted V1 contract has exactly two transitions: `pending_review` and
 * `completed`. There is deliberately no reject, no revision_requested and no
 * resubmit — and therefore no operational state for one.
 */
export type CanonicalMentorState = "pending_review" | "completed";

const MENTOR_OPERATIONAL_STATE: Record<CanonicalMentorState, LearnerOpsCaseStatus> = {
  pending_review: "in_progress",
  completed: "resolved",
};

export async function reconcileMentorReviewOperationalState(
  tx: Tx,
  input: {
    readonly userLevelProgressId: number;
    readonly canonicalState: CanonicalMentorState;
    readonly actor: StaffActor | null;
    readonly reason?: string;
  },
): Promise<{ caseId: string; changed: boolean } | null> {
  return reconcileAnchoredCase(tx, {
    where: { userLevelProgressId: input.userLevelProgressId },
    target: MENTOR_OPERATIONAL_STATE[input.canonicalState],
    actor: input.actor,
    reason: input.reason ?? `mentor_review:${input.canonicalState}`,
  });
}

/* ------------------------------------------------------------------ shared */

/**
 * The single reconciliation primitive both families use.
 *
 * RETURNS `null` WHEN THERE IS NO WORK ITEM. That is not an error: a canonical
 * object that predates this integration has no mirror yet, and a canonical
 * decision must not fail because of it. The reconciliation command
 * (`reconcileReviewWorkItems`) is what closes that gap, deliberately as a
 * separate, inspectable act.
 *
 * IT USES THE ORDINARY TRANSITION PRIMITIVE, so the legality table, the SLA
 * pause bookkeeping, the reopen counter, the version CAS and the timeline write
 * are the same ones every operator action goes through. A second write path for
 * "system" transitions is exactly how the two truths would drift apart.
 */
async function reconcileAnchoredCase(
  tx: Tx,
  input: {
    readonly where: { reportSubmissionId: number } | { userLevelProgressId: number };
    readonly target: LearnerOpsCaseStatus;
    readonly actor: StaffActor | null;
    readonly reason: string;
  },
): Promise<{ caseId: string; changed: boolean } | null> {
  const found = await tx.learnerOpsCase.findFirst({
    where: input.where,
    select: { id: true, status: true, version: true },
  });
  if (!found) return null;
  if (found.status === input.target) return { caseId: found.id, changed: false };

  const result = await transitionCaseInTransaction(tx, {
    caseId: found.id,
    expectedVersion: found.version,
    nextStatus: input.target,
    actor: input.actor,
    reason: input.reason,
  });
  return { caseId: found.id, changed: result.changed };
}

/**
 * Was this a collision on one of the two anchor uniqueness indexes?
 *
 * Matched on the index target rather than on P2002 alone, so a reference
 * collision — which means something entirely different and is retried
 * elsewhere — is never mistaken for "somebody else created the work item".
 */
function isAnchorUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = String(error.meta?.target ?? "");
  return target.includes("reportSubmissionId") || target.includes("userLevelProgressId");
}
