/**
 * LEARNER-OPERATIONS-V1 — the case domain.
 *
 * Every mutation to a work item goes through this module, and every one of them
 * obeys the same four rules.
 *
 * 1. NO SILENT STATE MUTATION. Each mutation writes exactly one
 *    `LearnerOpsCaseEvent` in the SAME transaction, carrying the actor, the
 *    instant, the previous value and the next value. `(caseId, caseVersion)` is
 *    unique, so a version is claimed by at most one event and two racing
 *    writers cannot both believe they performed the transition.
 *
 * 2. COMPARE-AND-SWAP, NOT READ-THEN-WRITE. Every mutation is an `updateMany`
 *    whose WHERE clause names the version the caller read. A count of zero means
 *    somebody else moved first, and the caller gets a 409 telling it to re-read.
 *    There is no row lock and no `SELECT ... FOR UPDATE`, because SQLite has
 *    neither and because a CAS is correct on any engine.
 *
 * 3. TWO COUNTERS, TWO CONCERNS. `version` guards state, `assignmentVersion`
 *    guards ownership. An operator replying to a learner and a lead reassigning
 *    the case are not in conflict and must not fail each other.
 *
 * 4. LEARNER OPERATIONS NEVER WRITES EDUCATIONAL TRUTH. There is no code path
 *    in this file that touches UserLevelProgress, ReportSubmission, XPTransaction
 *    or any provider table. A case that concerns one of those NAMES it and reads
 *    it back through its own owner.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  LearnerOpsCaseEventType,
  LearnerOpsCaseStatus,
  LearnerOpsCaseType,
  LearnerOpsPriority,
} from "@prisma/client";
import {
  isLegalTransition,
  isReopenTransition,
  isWaitingStatus,
  LEARNER_OPS_AUDIT_ACTIONS,
  LEARNER_OPS_REQUIRED_ANCHOR,
  LEARNER_OPS_TERMINAL_STATUSES,
} from "@/lib/learner-ops/contract";
import { LearnerOpsError, learnerOpsFail } from "@/lib/learner-ops/errors";
import { assertReviewWorkItemMayBecomeTerminal } from "@/lib/learner-ops/review-work-item-invariants";
import { createNotification } from "@/lib/notifications";
import { computeTargets, pauseTransition, type SlaPolicyInput } from "@/lib/learner-ops/sla";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;
type Db = Pick<PrismaClient, "$transaction">;

const MAX_TRANSACTION_ATTEMPTS = 3;

/** The actor of every mutation: a StaffProfile id, resolved server-side. */
export type StaffActor = {
  readonly staffId: string;
  /** Carried only into AuditLog, never into domain rows. */
  readonly userId: number;
};

/* ------------------------------------------------------------- references */

/**
 * `LO-` plus a zero-padded monotonic ordinal. Human-quotable in a conversation
 * with a learner, which a cuid is not.
 *
 * It is derived from a COUNT inside the same transaction, and collisions are
 * impossible to rule out that way alone — so the unique index on `reference` is
 * the real guarantee and the retry loop below is what makes a collision
 * harmless rather than fatal.
 */
/**
 * The next operator-facing reference.
 *
 * DERIVED FROM THE HIGHEST REFERENCE, NOT FROM THE ROW COUNT. Counting assumes
 * the sequence has no gaps, and the moment one appears — a case deleted, a
 * repair that rebuilt a mirror, any archival — the count points at a reference
 * that already exists and every subsequent create collides. Found by the R9
 * reconciliation regression, which deletes a work item and rebuilds it: the
 * count said "LO-000015" while "LO-000015" was already taken.
 *
 * Ordering by the string is safe because the format is fixed-width and
 * zero-padded, so lexical order IS numeric order for the whole `LO-000001` ..
 * `LO-999999` range.
 *
 * `attempt` still offsets the candidate, so the caller's retry loop walks
 * forward past a reference a concurrent transaction took first.
 */
async function nextReference(tx: Tx, attempt: number): Promise<string> {
  const highest = await tx.learnerOpsCase.findFirst({
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const current = highest ? Number.parseInt(highest.reference.slice(3), 10) : 0;
  const next = (Number.isFinite(current) ? current : 0) + 1 + attempt;
  return `LO-${String(next).padStart(6, "0")}`;
}

/* ----------------------------------------------------------------- events */

/**
 * The ONLY way an event row is written. Taking the whole payload as one
 * argument means a caller cannot forget the previous value, and every call site
 * reads the same shape.
 */
async function writeEvent(
  tx: Tx,
  payload: {
    caseId: string;
    caseVersion: number;
    eventType: LearnerOpsCaseEventType;
    actorStaffId: string | null;
    previousStatus?: LearnerOpsCaseStatus | null;
    nextStatus?: LearnerOpsCaseStatus | null;
    previousAssignedStaffId?: string | null;
    nextAssignedStaffId?: string | null;
    previousPriority?: LearnerOpsPriority | null;
    nextPriority?: LearnerOpsPriority | null;
    reason?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.learnerOpsCaseEvent.create({
    data: {
      caseId: payload.caseId,
      caseVersion: payload.caseVersion,
      eventType: payload.eventType,
      actorStaffId: payload.actorStaffId,
      previousStatus: payload.previousStatus ?? null,
      nextStatus: payload.nextStatus ?? null,
      previousAssignedStaffId: payload.previousAssignedStaffId ?? null,
      nextAssignedStaffId: payload.nextAssignedStaffId ?? null,
      previousPriority: payload.previousPriority ?? null,
      nextPriority: payload.nextPriority ?? null,
      reason: payload.reason ?? null,
      ...(payload.metadata !== undefined ? { metadata: payload.metadata } : {}),
    },
  });
}

/**
 * AuditLog is documented as the single audit surface that "must not become
 * chatty", so this records the SENSITIVE operations only and the case's own
 * event timeline carries everything else.
 *
 * `metadata` never receives a message body, a note body, an email address, a
 * password or a token — only identifiers and vocabulary values.
 */
async function writeAudit(
  tx: Tx,
  action: string,
  actor: StaffActor | null,
  entityId: string,
  metadata: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: actor?.userId ?? null,
      action,
      entityType: "LearnerOpsCase",
      entityId,
      metadata,
    },
  });
}

/* ----------------------------------------------------------------- policy */

async function loadPolicy(tx: Tx, priority: LearnerOpsPriority): Promise<
  (SlaPolicyInput & { id: string }) | null
> {
  const row = await tx.learnerOpsSlaPolicy.findFirst({
    where: { priority, isActive: true },
    orderBy: { key: "asc" },
    select: {
      id: true,
      key: true,
      priority: true,
      firstResponseTargetMinutes: true,
      resolutionTargetMinutes: true,
      pausesOnWaitingLearner: true,
      pausesOnWaitingInternal: true,
      pausesOnWaitingExternal: true,
      origin: true,
    },
  });
  return row;
}

/* ----------------------------------------------------------------- create */

export type CreateCaseInput = {
  readonly userId: number;
  readonly type: LearnerOpsCaseType;
  readonly queueKey: string;
  readonly subject: string;
  readonly details: string;
  readonly priority?: LearnerOpsPriority;
  readonly reasonCode?: string;
  readonly reportSubmissionId?: number;
  readonly userLevelProgressId?: number;
  /**
   * Null for a learner-originated case. The learner is not a staff actor and
   * must never appear in a staff attribution column.
   */
  readonly actor: StaffActor | null;
};

/**
 * The whole of case creation, inside a transaction the CALLER owns.
 *
 * SPLIT OUT FOR THE REVIEW INTEGRATION. A canonical educational owner must be
 * able to open its derived operational work item in the SAME transaction that
 * moves the report or the progress row — otherwise a crash between the two
 * leaves a submitted report with no operational owner, which is precisely the
 * gap LO-REVIEW-WORKITEM-UNREACHABLE-1 is about. Passing `tx` is the only way
 * to get that atomicity, so the body lives here and `createCase` becomes the
 * thin standalone wrapper that owns a transaction and the reference retry.
 *
 * `attempt` participates in reference allocation and nothing else.
 */
export async function createCaseInTransaction(
  tx: Tx,
  input: CreateCaseInput,
  attempt = 0,
) {
  const requiredAnchor = LEARNER_OPS_REQUIRED_ANCHOR[input.type];
  if (requiredAnchor === "reportSubmission" && input.reportSubmissionId === undefined) {
    learnerOpsFail("LEARNER_OPS_ANCHOR_REQUIRED", "report_review requires reportSubmissionId");
  }
  if (requiredAnchor === "userLevelProgress" && input.userLevelProgressId === undefined) {
    learnerOpsFail("LEARNER_OPS_ANCHOR_REQUIRED", "mentor_review requires userLevelProgressId");
  }
  // The database enforces this too. Refusing here as well turns a constraint
  // violation into an error an operator can act on.
  if (input.reportSubmissionId !== undefined && input.type !== "report_review") {
    learnerOpsFail("LEARNER_OPS_ANCHOR_NOT_PERMITTED", "only report_review may name a report");
  }
  if (input.userLevelProgressId !== undefined && input.type !== "mentor_review") {
    learnerOpsFail("LEARNER_OPS_ANCHOR_NOT_PERMITTED", "only mentor_review may name a progress row");
  }

  const learner = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!learner) learnerOpsFail("LEARNER_OPS_LEARNER_NOT_FOUND");

  const queue = await tx.learnerOpsQueue.findUnique({
    where: { key: input.queueKey },
    select: { id: true, isActive: true },
  });
  if (!queue || !queue.isActive) learnerOpsFail("LEARNER_OPS_QUEUE_NOT_FOUND");

  let reasonCodeId: string | null = null;
  if (input.reasonCode !== undefined) {
    const reason = await tx.learnerOpsReasonCode.findUnique({
      where: { code: input.reasonCode },
      select: { id: true, isActive: true },
    });
    if (!reason || !reason.isActive) learnerOpsFail("LEARNER_OPS_REASON_CODE_NOT_FOUND");
    reasonCodeId = reason.id;
  }

  const priority = input.priority ?? "normal";
  const policy = await loadPolicy(tx, priority);
  const now = new Date();
  const targets = computeTargets(policy, now);

  const created = await tx.learnerOpsCase.create({
    data: {
      reference: await nextReference(tx, attempt),
      userId: input.userId,
      type: input.type,
      status: "new",
      priority,
      queueId: queue.id,
      reasonCodeId,
      subject: input.subject,
      details: input.details,
      ...(input.reportSubmissionId !== undefined
        ? { reportSubmissionId: input.reportSubmissionId }
        : {}),
      ...(input.userLevelProgressId !== undefined
        ? { userLevelProgressId: input.userLevelProgressId }
        : {}),
      slaPolicyId: policy?.id ?? null,
      firstResponseDueAt: targets.firstResponseDueAt,
      resolutionDueAt: targets.resolutionDueAt,
      openedAt: now,
      lastActivityAt: now,
    },
  });

  await writeEvent(tx, {
    caseId: created.id,
    caseVersion: created.version,
    eventType: "created",
    actorStaffId: input.actor?.staffId ?? null,
    nextStatus: "new",
    metadata: {
      type: input.type,
      queueKey: input.queueKey,
      priority,
      origin: input.actor ? "staff" : "learner",
    },
  });

  await writeAudit(tx, LEARNER_OPS_AUDIT_ACTIONS.caseCreated, input.actor, created.id, {
    reference: created.reference,
    type: input.type,
    queueKey: input.queueKey,
    priority,
    learnerId: input.userId,
  });

  return created;
}

/**
 * Standalone case creation: owns a transaction and the reference retry.
 *
 * Unchanged for every existing caller. The retry lives here rather than in the
 * in-transaction body because a reference collision must roll the whole attempt
 * back and start again with a fresh count, which requires a new transaction.
 */
export async function createCase(input: CreateCaseInput, db: Db = prisma) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction((tx) => createCaseInTransaction(tx, input, attempt));
    } catch (error) {
      if (error instanceof LearnerOpsError) throw error;
      // A reference collision is the one retryable failure here.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        String(error.meta?.target ?? "").includes("reference")
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new LearnerOpsError("LEARNER_OPS_DUPLICATE", "could not allocate a reference");
}

/* ------------------------------------------------------------- transition */

export type TransitionInput = {
  readonly caseId: string;
  readonly expectedVersion: number;
  readonly nextStatus: LearnerOpsCaseStatus;
  /**
   * `null` means the platform reconciled this itself — a canonical decision
   * whose decider holds no StaffProfile, or a learner resubmission moving the
   * derived work item. Recording it as a named employee would be a lie about
   * who acted, and `writeEvent`/`writeAudit` already accept a null actor.
   */
  readonly actor: StaffActor | null;
  readonly reason?: string;
};

/**
 * The one state transition primitive. Resolve, close, reopen, park and unpark
 * are all this function with a different `nextStatus`, which is why there is
 * exactly one place the legality table, the pause bookkeeping, the reopen
 * counter and the event write can be got wrong.
 */
export async function transitionCase(input: TransitionInput, db: Db = prisma) {
  return db.$transaction((tx) => transitionCaseInTransaction(tx, input));
}

/**
 * The same transition, inside a transaction the CALLER owns.
 *
 * Exists for the review integration, which must reconcile the derived
 * operational case in the SAME transaction as the canonical decision — see
 * `createCaseInTransaction` for why that atomicity is not optional. Every rule
 * below is the one and only copy: legality, the escalation invariant, the CAS,
 * the pause bookkeeping and the reopen counter are not restated anywhere.
 */
export async function transitionCaseInTransaction(tx: Tx, input: TransitionInput) {
  {
    const current = await tx.learnerOpsCase.findUnique({
      where: { id: input.caseId },
      select: {
        id: true,
        status: true,
        version: true,
        priority: true,
        pausedMs: true,
        clockPausedAt: true,
        reopenCount: true,
        resolvedAt: true,
        slaPolicy: {
          select: {
            key: true,
            priority: true,
            firstResponseTargetMinutes: true,
            resolutionTargetMinutes: true,
            pausesOnWaitingLearner: true,
            pausesOnWaitingInternal: true,
            pausesOnWaitingExternal: true,
            origin: true,
          },
        },
      },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");

    if (current.version !== input.expectedVersion) {
      learnerOpsFail(
        "LEARNER_OPS_VERSION_CONFLICT",
        `case is at version ${current.version}`,
      );
    }
    if (current.status === input.nextStatus) {
      // A no-op is not an error and must not consume a version or write an
      // event — the CHECK constraint would refuse an equal-state event anyway.
      return { changed: false as const, version: current.version, status: current.status };
    }
    if (!isLegalTransition(current.status, input.nextStatus)) {
      learnerOpsFail(
        "LEARNER_OPS_ILLEGAL_TRANSITION",
        `${current.status} -> ${input.nextStatus} is not a transition this domain defines`,
      );
    }

    // LO-ESCALATION-RESOLVE-AUTHORITY-1 §4 — A CASE WITH AN UNANSWERED
    // ESCALATION IS NOT FINISHED.
    //
    // The escalation record and the case status were two independent truths, so
    // the product could show a `resolved` case whose educational question had
    // never been answered by anybody. This is the smallest invariant that makes
    // the two agree, and it is deliberately narrow:
    //
    //   * only TERMINAL states are refused. `escalated -> in_progress`,
    //     `waiting_*` and the rest stay legal, because "still being worked
    //     while a second authority thinks" is true, not a lie;
    //   * it reads inside the SAME transaction as the status write, so an
    //     escalation opened concurrently cannot slip past the check;
    //   * it is not a second escalation truth. There is one row, one
    //     `resolvedAt`, and this asks that row.
    //
    // The escalation's own resolution transitions the case afterwards, and by
    // then `resolvedAt` is set, so the ordinary path is unaffected.
    if ((LEARNER_OPS_TERMINAL_STATUSES as readonly string[]).includes(input.nextStatus)) {
      const openEscalations = await tx.learnerOpsEscalation.count({
        where: { caseId: input.caseId, resolvedAt: null },
      });
      if (openEscalations > 0) {
        learnerOpsFail(
          "LEARNER_OPS_ESCALATION_OPEN",
          `case has ${openEscalations} unresolved escalation(s) and cannot become ${input.nextStatus}`,
        );
      }

      // LO-REVIEW-WORKITEM-UNREACHABLE-1 §6/§9 — AN OPERATIONAL STATUS MAY NOT
      // CLAIM AN EDUCATIONAL OUTCOME. `resolved` on a review work item asserts
      // the review is finished, and Learner Operations does not own that fact.
      // The canonical owner passes because it reconciles AFTER its own row has
      // moved, inside the same transaction — the ordering is the authorization.
      await assertReviewWorkItemMayBecomeTerminal(tx, input.caseId, input.nextStatus);
    }

    const now = new Date();
    const policy = current.slaPolicy;
    const pause = pauseTransition(
      { status: current.status, pausedMs: current.pausedMs, clockPausedAt: current.clockPausedAt },
      input.nextStatus,
      policy,
      now,
    );

    const reopening = isReopenTransition(current.status, input.nextStatus);
    const nextVersion = current.version + 1;

    // A reopen restarts the RESOLUTION promise from the reopen instant. It
    // never touches firstRespondedAt or the first-response target: that
    // response happened, and a later reopen does not un-happen it.
    const reopenTargets = reopening ? computeTargets(policy, now) : null;

    const updated = await tx.learnerOpsCase.updateMany({
      where: { id: input.caseId, version: input.expectedVersion },
      data: {
        status: input.nextStatus,
        version: nextVersion,
        lastActivityAt: now,
        pausedMs: pause.pausedMs,
        clockPausedAt: pause.clockPausedAt,
        // Clearing resolvedAt on the way out of a terminal state is what keeps
        // the CHECK constraint satisfiable and the timeline honest.
        resolvedAt: input.nextStatus === "resolved" ? now : reopening ? null : current.resolvedAt,
        closedAt: input.nextStatus === "closed" ? now : null,
        ...(reopening
          ? {
              reopenCount: current.reopenCount + 1,
              reopenedAt: now,
              resolutionDueAt: reopenTargets?.resolutionDueAt ?? null,
            }
          : {}),
      },
    });
    // The CAS lost. Somebody else transitioned this case between our read and
    // our write.
    if (updated.count !== 1) {
      learnerOpsFail("LEARNER_OPS_VERSION_CONFLICT", "the case changed while this request was in flight");
    }

    await writeEvent(tx, {
      caseId: input.caseId,
      caseVersion: nextVersion,
      eventType: reopening
        ? "reopened"
        : input.nextStatus === "resolved"
          ? "resolved"
          : input.nextStatus === "closed"
            ? "closed"
            : "status_changed",
      actorStaffId: input.actor?.staffId ?? null,
      previousStatus: current.status,
      nextStatus: input.nextStatus,
      reason: input.reason ?? null,
      metadata: {
        paused: isWaitingStatus(input.nextStatus),
        ...(reopening ? { reopenCount: current.reopenCount + 1 } : {}),
      },
    });

    await writeAudit(
      tx,
      reopening ? LEARNER_OPS_AUDIT_ACTIONS.caseReopened : LEARNER_OPS_AUDIT_ACTIONS.caseStatusChanged,
      input.actor,
      input.caseId,
      { from: current.status, to: input.nextStatus },
    );

    return { changed: true as const, version: nextVersion, status: input.nextStatus };
  }
}

/* ------------------------------------------------------------- assignment */

export type AssignInput = {
  readonly caseId: string;
  readonly expectedAssignmentVersion: number;
  /** `null` releases the case back to the queue. */
  readonly targetStaffId: string | null;
  readonly actor: StaffActor;
  readonly reason?: string;
};

/**
 * Claim, release and reassign are ONE operation with a different target,
 * because they are all "set the owner, given the owner I believed was there".
 * Splitting them would give three chances to get the CAS wrong.
 *
 * THE RACE THIS EXISTS TO LOSE CORRECTLY. Two operators open the same unassigned
 * case and both press Take. Both read `assignmentVersion = 0`, both call this
 * with 0, and exactly one `updateMany` matches. The loser gets a 409 naming the
 * current owner rather than a silent overwrite, so two people can never both
 * believe they exclusively own the item.
 */
export async function assignCase(input: AssignInput, db: Db = prisma) {
  return db.$transaction(async (tx) => {
    const current = await tx.learnerOpsCase.findUnique({
      where: { id: input.caseId },
      select: { id: true, assignedStaffId: true, assignmentVersion: true, status: true, version: true },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");

    if (current.assignmentVersion !== input.expectedAssignmentVersion) {
      learnerOpsFail(
        "LEARNER_OPS_ASSIGNMENT_CONFLICT",
        `assignment is at version ${current.assignmentVersion}`,
      );
    }
    if (current.assignedStaffId === input.targetStaffId) {
      return { changed: false as const, assignmentVersion: current.assignmentVersion };
    }

    if (input.targetStaffId !== null) {
      const target = await tx.staffProfile.findUnique({
        where: { id: input.targetStaffId },
        select: { id: true },
      });
      if (!target) learnerOpsFail("LEARNER_OPS_STAFF_NOT_FOUND");
    }

    const now = new Date();
    const nextAssignmentVersion = current.assignmentVersion + 1;
    const nextVersion = current.version + 1;

    // Taking unclaimed work moves `new` to `in_progress` in the same write.
    // Leaving it at `new` would mean an owned case still showing as untriaged.
    const promoted =
      input.targetStaffId !== null && (current.status === "new" || current.status === "open")
        ? ("in_progress" as const)
        : null;

    const updated = await tx.learnerOpsCase.updateMany({
      where: { id: input.caseId, assignmentVersion: input.expectedAssignmentVersion },
      data: {
        assignedStaffId: input.targetStaffId,
        assignmentVersion: nextAssignmentVersion,
        version: nextVersion,
        lastActivityAt: now,
        ...(promoted ? { status: promoted } : {}),
      },
    });
    if (updated.count !== 1) {
      learnerOpsFail("LEARNER_OPS_ASSIGNMENT_CONFLICT", "the assignment changed while this request was in flight");
    }

    const eventType: LearnerOpsCaseEventType =
      input.targetStaffId === null
        ? "unassigned"
        : current.assignedStaffId === null
          ? "assigned"
          : "reassigned";

    await writeEvent(tx, {
      caseId: input.caseId,
      caseVersion: nextVersion,
      eventType,
      actorStaffId: input.actor.staffId,
      previousAssignedStaffId: current.assignedStaffId,
      nextAssignedStaffId: input.targetStaffId,
      ...(promoted ? { previousStatus: current.status, nextStatus: promoted } : {}),
      reason: input.reason ?? null,
      metadata: { selfClaim: input.targetStaffId === input.actor.staffId },
    });

    await writeAudit(
      tx,
      eventType === "reassigned"
        ? LEARNER_OPS_AUDIT_ACTIONS.caseReassigned
        : LEARNER_OPS_AUDIT_ACTIONS.caseAssigned,
      input.actor,
      input.caseId,
      { from: current.assignedStaffId, to: input.targetStaffId },
    );

    return { changed: true as const, assignmentVersion: nextAssignmentVersion, version: nextVersion };
  });
}

/* --------------------------------------------------------------- priority */

export async function changePriority(
  input: {
    caseId: string;
    expectedVersion: number;
    nextPriority: LearnerOpsPriority;
    actor: StaffActor;
    reason?: string;
  },
  db: Db = prisma,
) {
  return db.$transaction(async (tx) => {
    const current = await tx.learnerOpsCase.findUnique({
      where: { id: input.caseId },
      select: { id: true, priority: true, version: true, openedAt: true, firstRespondedAt: true, status: true },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      learnerOpsFail("LEARNER_OPS_VERSION_CONFLICT", `case is at version ${current.version}`);
    }
    if (current.priority === input.nextPriority) {
      return { changed: false as const, version: current.version };
    }

    // Changing priority changes which policy applies, so the targets are
    // recomputed FROM THE ORIGINAL OPEN INSTANT — not from now. Recomputing
    // from now would let an operator reset a breach by touching the priority.
    const policy = await loadPolicy(tx, input.nextPriority);
    const targets = computeTargets(policy, current.openedAt);
    const now = new Date();
    const nextVersion = current.version + 1;

    const updated = await tx.learnerOpsCase.updateMany({
      where: { id: input.caseId, version: input.expectedVersion },
      data: {
        priority: input.nextPriority,
        slaPolicyId: policy?.id ?? null,
        // A first response already given keeps its satisfied state: the target
        // moves, the historical fact does not.
        firstResponseDueAt: targets.firstResponseDueAt,
        resolutionDueAt: targets.resolutionDueAt,
        version: nextVersion,
        lastActivityAt: now,
      },
    });
    if (updated.count !== 1) {
      learnerOpsFail("LEARNER_OPS_VERSION_CONFLICT", "the case changed while this request was in flight");
    }

    await writeEvent(tx, {
      caseId: input.caseId,
      caseVersion: nextVersion,
      eventType: "priority_changed",
      actorStaffId: input.actor.staffId,
      previousPriority: current.priority,
      nextPriority: input.nextPriority,
      reason: input.reason ?? null,
      metadata: { slaPolicyKey: policy?.key ?? null },
    });

    await writeAudit(tx, LEARNER_OPS_AUDIT_ACTIONS.casePriorityChanged, input.actor, input.caseId, {
      from: current.priority,
      to: input.nextPriority,
    });

    return { changed: true as const, version: nextVersion };
  });
}

/* -------------------------------------------------- learner-visible message */

/**
 * Append a message the LEARNER WILL SEE.
 *
 * This function writes to `LearnerOpsMessage` and to nothing else that could
 * carry text. The internal-note table is not imported by the learner read path
 * and is not written here, so the two can never be confused at a call site.
 *
 * Recording the first response is a side effect of the first STAFF message and
 * of nothing else — a learner replying to themselves does not satisfy an SLA.
 */
export async function addMessage(
  input: {
    caseId: string;
    body: string;
    author: { kind: "staff"; staffId: string; userId: number } | { kind: "learner"; userId: number };
    db?: Db;
  },
): Promise<{
  id: string;
  firstResponseRecorded: boolean;
  /**
   * The learner to notify, or null when the author WAS the learner. Returned
   * rather than notified inline so the notification happens after the
   * transaction commits — see `notifyLearnerOfReply`.
   */
  notify: number | null;
}> {
  const db = input.db ?? prisma;
  return db.$transaction(async (tx) => {
    const current = await tx.learnerOpsCase.findUnique({
      where: { id: input.caseId },
      select: {
        id: true,
        version: true,
        status: true,
        firstRespondedAt: true,
        userId: true,
        pausedMs: true,
        clockPausedAt: true,
        slaPolicy: {
          select: {
            key: true,
            priority: true,
            firstResponseTargetMinutes: true,
            resolutionTargetMinutes: true,
            pausesOnWaitingLearner: true,
            pausesOnWaitingInternal: true,
            pausesOnWaitingExternal: true,
            origin: true,
          },
        },
      },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");

    // A learner may only ever write to their own case. The route checks this
    // too; repeating it here means the domain is safe regardless of caller.
    if (input.author.kind === "learner" && current.userId !== input.author.userId) {
      learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");
    }

    const now = new Date();
    const message = await tx.learnerOpsMessage.create({
      data: {
        caseId: input.caseId,
        authorKind: input.author.kind,
        ...(input.author.kind === "staff"
          ? { authorStaffId: input.author.staffId }
          : { authorUserId: input.author.userId }),
        body: input.body,
      },
      select: { id: true },
    });

    const recordFirstResponse = input.author.kind === "staff" && current.firstRespondedAt === null;
    const nextVersion = current.version + 1;

    /**
     * LO-SLA-WAITING-RESUME-1 — a learner reply ENDS "waiting on learner".
     *
     * The resolution clock pauses in `waiting_learner` because that delay is
     * the learner's. The moment they answer it is ours again — but the status
     * used to stay put until an operator noticed, so the clock stayed paused
     * while the ball was back in our court. That understates ATA's own delay,
     * and it understates it in the flattering direction, which is the kind of
     * SLA error that never gets questioned.
     *
     * It also left the case parked in a bucket nobody rechecks: "waiting on
     * learner" is exactly where an operator stops looking.
     *
     * So a learner message on a `waiting_learner` case moves it back to
     * `in_progress`, in the SAME transaction, with the pause folded into
     * `pausedMs` by the same helper every other transition uses and its own
     * timeline event. No other status is touched: a learner replying to a case
     * that is `waiting_internal` or `waiting_external` changes nothing, because
     * neither of those was ever waiting on them.
     */
    const resumesFromLearnerWait =
      input.author.kind === "learner" && current.status === "waiting_learner";

    const pause = resumesFromLearnerWait
      ? pauseTransition(
          { status: current.status, pausedMs: current.pausedMs, clockPausedAt: current.clockPausedAt },
          "in_progress",
          current.slaPolicy,
          now,
        )
      : null;

    await tx.learnerOpsCase.update({
      where: { id: input.caseId },
      data: {
        lastActivityAt: now,
        version: nextVersion,
        ...(recordFirstResponse ? { firstRespondedAt: now } : {}),
        ...(pause
          ? { status: "in_progress" as const, pausedMs: pause.pausedMs, clockPausedAt: pause.clockPausedAt }
          : {}),
      },
    });

    await writeEvent(tx, {
      caseId: input.caseId,
      caseVersion: nextVersion,
      eventType: recordFirstResponse ? "first_response_recorded" : "message_sent",
      actorStaffId: input.author.kind === "staff" ? input.author.staffId : null,
      ...(resumesFromLearnerWait
        ? { previousStatus: "waiting_learner" as const, nextStatus: "in_progress" as const }
        : {}),
      metadata: {
        authorKind: input.author.kind,
        messageId: message.id,
        // The BODY is deliberately absent. It lives in exactly one table.
        length: input.body.length,
        ...(resumesFromLearnerWait ? { resumedFromWaitingLearner: true } : {}),
      },
    });

    if (input.author.kind === "staff") {
      await writeAudit(
        tx,
        LEARNER_OPS_AUDIT_ACTIONS.messageSent,
        { staffId: input.author.staffId, userId: input.author.userId },
        input.caseId,
        { messageId: message.id, visibility: "learner_visible" },
      );
    }

    return {
      id: message.id,
      firstResponseRecorded: recordFirstResponse,
      notify: input.author.kind === "staff" ? current.userId : null,
    };
  });
}

/**
 * Notify the learner that staff replied.
 *
 * IT USES THE EXISTING NOTIFICATION OWNER. `createNotification` and
 * `NotificationType.support_reply` both already exist and already carry the
 * learner's delivery preferences and audit trail — building a second notifier
 * for this domain would give one concept two owners that could later disagree.
 *
 * IT RUNS AFTER THE TRANSACTION COMMITS, DELIBERATELY. A notification is a
 * side effect, not part of the operational fact. Inside the transaction a
 * notification failure would roll back the reply the learner is waiting for;
 * outside it, the reply is durable and `createNotification` already swallows
 * and logs its own failures. The message is the truth, the notification is the
 * nudge.
 *
 * NO BODY IS COPIED INTO IT. The notification says a reply exists and names the
 * case reference. The text lives in exactly one table, which is also what keeps
 * a notification from becoming a second place a message could be read from
 * after the case's own visibility rules changed.
 */
export async function notifyLearnerOfReply(input: {
  userId: number;
  caseId: string;
  reference: string;
}): Promise<void> {
  await createNotification({
    userId: input.userId,
    type: "support_reply",
    title: "Ответ поддержки",
    message: `По вашему обращению ${input.reference} есть новый ответ.`,
    metadata: { learnerOpsCaseId: input.caseId, reference: input.reference },
  });
}

/* ----------------------------------------------------------- internal note */

/**
 * Append an INTERNAL note. Writes to `LearnerOpsNote`, which no learner-facing
 * query names. It cannot record a first response and cannot become a message:
 * there is no column to flip and no shared table to leak through.
 */
export async function addNote(
  input: { caseId: string; body: string; actor: StaffActor; db?: Db },
): Promise<{ id: string }> {
  const db = input.db ?? prisma;
  return db.$transaction(async (tx) => {
    const current = await tx.learnerOpsCase.findUnique({
      where: { id: input.caseId },
      select: { id: true, version: true },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");

    const note = await tx.learnerOpsNote.create({
      data: { caseId: input.caseId, authorStaffId: input.actor.staffId, body: input.body },
      select: { id: true },
    });

    const nextVersion = current.version + 1;
    await tx.learnerOpsCase.update({
      where: { id: input.caseId },
      data: { lastActivityAt: new Date(), version: nextVersion },
    });

    await writeEvent(tx, {
      caseId: input.caseId,
      caseVersion: nextVersion,
      eventType: "note_added",
      actorStaffId: input.actor.staffId,
      metadata: { noteId: note.id, length: input.body.length },
    });

    await writeAudit(tx, LEARNER_OPS_AUDIT_ACTIONS.noteAdded, input.actor, input.caseId, {
      noteId: note.id,
      visibility: "internal_only",
    });

    return { id: note.id };
  });
}
