/**
 * LEARNER-OPERATIONS-V1 — the inbox, the queue reads and the case projection.
 *
 * ONE ENTRY POINT, MANY VIEWS. The unified inbox is a filter over one table,
 * not a union of unrelated screens, which is what makes "what needs my
 * attention" answerable at all. Report review and mentor review appear in it as
 * TYPES, beside support — they are not separate products.
 *
 * WHAT THIS MODULE READS AND WHAT IT REFUSES TO. It projects the operational
 * row and, for a case with a canonical anchor, it RE-READS the educational
 * object from its owner's tables at request time and labels it as such. It
 * never stores that value, never caches it and never lets an operational field
 * shadow it. If the report owner says the submission is `approved`, this says
 * `approved` because it just asked — not because a case once recorded it.
 */
import type { Prisma } from "@prisma/client";
import type {
  LearnerOpsCaseStatus,
  LearnerOpsCaseType,
  LearnerOpsPriority,
} from "@prisma/client";
import {
  LEARNER_OPS_ACTIVE_STATUSES,
  LEARNER_OPS_TERMINAL_STATUSES,
  LEARNER_OPS_TRANSITIONS,
} from "@/lib/learner-ops/contract";
import { learnerOpsFail } from "@/lib/learner-ops/errors";
import { terminalStatesBlockedByCanonicalReview } from "@/lib/learner-ops/review-work-item-invariants";
import { computeSlaView, type SlaView } from "@/lib/learner-ops/sla";
import { prisma } from "@/lib/prisma";

export type QueueFilter = {
  readonly queueKey?: string;
  readonly status?: LearnerOpsCaseStatus;
  readonly type?: LearnerOpsCaseType;
  readonly priority?: LearnerOpsPriority;
  readonly assignment: "any" | "me" | "unassigned";
  readonly breached: "any" | "only";
  readonly limit: number;
  readonly cursor?: string;
  /** Always from the gate, never from the request. */
  readonly viewerStaffId: string;
};

export type QueueItem = {
  readonly id: string;
  readonly reference: string;
  readonly type: LearnerOpsCaseType;
  readonly status: LearnerOpsCaseStatus;
  readonly priority: LearnerOpsPriority;
  readonly subject: string;
  readonly queueKey: string;
  readonly queueName: string;
  readonly learner: { readonly id: number; readonly name: string };
  readonly assignedTo: { readonly staffId: string; readonly displayName: string } | null;
  readonly assignmentVersion: number;
  readonly version: number;
  readonly openedAt: string;
  readonly lastActivityAt: string;
  readonly reopenCount: number;
  readonly sla: SlaView;
};

const caseSelect = {
  id: true,
  reference: true,
  type: true,
  status: true,
  priority: true,
  subject: true,
  details: true,
  version: true,
  assignmentVersion: true,
  openedAt: true,
  lastActivityAt: true,
  resolvedAt: true,
  closedAt: true,
  reopenCount: true,
  reopenedAt: true,
  pausedMs: true,
  clockPausedAt: true,
  firstResponseDueAt: true,
  resolutionDueAt: true,
  firstRespondedAt: true,
  reportSubmissionId: true,
  userLevelProgressId: true,
  supportDialogId: true,
  queue: { select: { key: true, name: true } },
  user: { select: { id: true, name: true } },
  assignedStaff: { select: { id: true, displayName: true } },
  reasonCode: { select: { code: true, category: true, label: true } },
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
} satisfies Prisma.LearnerOpsCaseSelect;

type CaseRow = Prisma.LearnerOpsCaseGetPayload<{ select: typeof caseSelect }>;

function toQueueItem(row: CaseRow, now: Date): QueueItem {
  return {
    id: row.id,
    reference: row.reference,
    type: row.type,
    status: row.status,
    priority: row.priority,
    subject: row.subject,
    queueKey: row.queue.key,
    queueName: row.queue.name,
    learner: { id: row.user.id, name: row.user.name },
    assignedTo: row.assignedStaff
      ? { staffId: row.assignedStaff.id, displayName: row.assignedStaff.displayName }
      : null,
    assignmentVersion: row.assignmentVersion,
    version: row.version,
    openedAt: row.openedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    reopenCount: row.reopenCount,
    sla: computeSlaView(row, row.slaPolicy, now),
  };
}

/**
 * THE INBOX.
 *
 * The cursor is the opaque `id` of the last row of the previous page, and the
 * sort is `(lastActivityAt DESC, id DESC)` so the tuple is total and no row can
 * be skipped or repeated when activity timestamps collide.
 *
 * `breached: "only"` is applied AFTER the database page rather than in SQL,
 * because breach is a derived value and pushing it into SQL would mean storing
 * it. The page size is bounded, so the cost is bounded — and the alternative is
 * a stored flag that goes stale, which is the trade this domain refuses.
 */
export async function listQueue(filter: QueueFilter): Promise<{
  items: QueueItem[];
  nextCursor: string | null;
}> {
  const now = new Date();

  const where: Prisma.LearnerOpsCaseWhereInput = {
    ...(filter.queueKey ? { queue: { key: filter.queueKey } } : {}),
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.priority ? { priority: filter.priority } : {}),
    // With no explicit status the inbox shows LIVE work only. A closed case is
    // not "what needs attention", and defaulting to everything would bury the
    // queue under its own history.
    ...(filter.status ? { status: filter.status } : { status: { in: [...LEARNER_OPS_ACTIVE_STATUSES] } }),
    ...(filter.assignment === "me"
      ? { assignedStaffId: filter.viewerStaffId }
      : filter.assignment === "unassigned"
        ? { assignedStaffId: null }
        : {}),
  };

  const rows = await prisma.learnerOpsCase.findMany({
    where,
    select: caseSelect,
    orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    take: filter.limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const items = page
    .map((row) => toQueueItem(row, now))
    .filter((item) => (filter.breached === "only" ? item.sla.breached : true));

  return {
    items,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/* --------------------------------------------------------- case detail */

/**
 * The anchored educational object, RE-READ from its canonical owner on every
 * request. `source` names that owner so the CRM can render provenance rather
 * than presenting an operational projection as fact.
 */
export type CanonicalAnchorView =
  | {
      readonly kind: "report_submission";
      readonly source: "curriculum.report";
      readonly submissionId: number;
      readonly status: string;
      readonly levelNumber: number | null;
      readonly submittedAt: string | null;
      readonly claimedByStaffDisplayName: string | null;
    }
  | {
      readonly kind: "user_level_progress";
      readonly source: "curriculum.progression";
      readonly progressId: number;
      readonly status: string;
      readonly levelNumber: number | null;
    }
  | null;

export type CaseDetail = QueueItem & {
  /**
   * The transitions the domain will actually accept from this case's CURRENT
   * state, projected from `LEARNER_OPS_TRANSITIONS` — the same table
   * `transitionCase` refuses against.
   *
   * LO-UI-TRANSITION-CHOICES-1. The CRM used to render a fixed list of every
   * status, so a resolved case offered `in_progress`, `waiting_learner` and the
   * rest; the server correctly answered 400 ILLEGAL_TRANSITION every time, and
   * the operator was left with controls that could only fail.
   *
   * It is a SERVER-PROVIDED PROJECTION rather than a second table shipped to the
   * client. A duplicated state machine is one that drifts, and the whole point
   * of this field is that the list an operator sees and the list the domain
   * enforces cannot disagree — they are the same object, read once.
   *
   * IT PROJECTS EVERY REFUSAL, NOT ONLY THE TABLE. The state machine is not the
   * only thing `transitionCase` refuses on: while an escalation is unanswered a
   * case may not become terminal (LO-ESCALATION-RESOLVE-AUTHORITY-1 §4). A
   * projection that showed the table alone would again promise what the domain
   * declines — the same defect in a new place — so the terminal pair is
   * withheld exactly when the transition would be refused. There are two such
   * refusals today: an unanswered escalation, and a review work item whose
   * canonical report or progress row has not reached its own terminal state.
   */
  readonly allowedTransitions: readonly LearnerOpsCaseStatus[];
  readonly details: string;
  readonly reasonCode: { readonly code: string; readonly category: string; readonly label: string } | null;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
  readonly reopenedAt: string | null;
  readonly firstRespondedAt: string | null;
  readonly anchor: CanonicalAnchorView;
};

async function loadAnchor(row: CaseRow): Promise<CanonicalAnchorView> {
  if (row.reportSubmissionId !== null) {
    const submission = await prisma.reportSubmission.findUnique({
      where: { id: row.reportSubmissionId },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        levelDefinition: { select: { levelNumber: true } },
        claimedBy: { select: { staffProfile: { select: { displayName: true } } } },
      },
    });
    if (!submission) return null;
    return {
      kind: "report_submission",
      source: "curriculum.report",
      submissionId: submission.id,
      status: submission.status,
      levelNumber: submission.levelDefinition?.levelNumber ?? null,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      claimedByStaffDisplayName: submission.claimedBy?.staffProfile?.displayName ?? null,
    };
  }
  if (row.userLevelProgressId !== null) {
    const progress = await prisma.userLevelProgress.findUnique({
      where: { id: row.userLevelProgressId },
      select: { id: true, status: true, levelDefinition: { select: { levelNumber: true } } },
    });
    if (!progress) return null;
    return {
      kind: "user_level_progress",
      source: "curriculum.progression",
      progressId: progress.id,
      status: progress.status,
      levelNumber: progress.levelDefinition?.levelNumber ?? null,
    };
  }
  return null;
}

/**
 * Every transition the domain would actually accept right now.
 *
 * The table first, then each additional refusal `transitionCase` enforces. Kept
 * beside the projection it feeds so a future invariant added to the transition
 * has one obvious place to be mirrored.
 */
function allowedTransitionsFor(
  status: LearnerOpsCaseStatus,
  terminalBlocked: boolean,
): readonly LearnerOpsCaseStatus[] {
  const fromTable = LEARNER_OPS_TRANSITIONS[status];
  if (!terminalBlocked) return fromTable;
  return fromTable.filter(
    (next) => !(LEARNER_OPS_TERMINAL_STATUSES as readonly string[]).includes(next),
  );
}

export async function getCaseDetail(caseId: string): Promise<CaseDetail> {
  const row = await prisma.learnerOpsCase.findUnique({ where: { id: caseId }, select: caseSelect });
  if (!row) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");

  // Asked as a count rather than a boolean column, because there is exactly one
  // escalation truth and this reads it. It is a separate statement from the
  // transition's own check by design: this one informs a screen, that one
  // decides an outcome inside the write transaction, and only the second is
  // authority.
  const openEscalations = await prisma.learnerOpsEscalation.count({
    where: { caseId, resolvedAt: null },
  });
  // LO-REVIEW-WORKITEM-UNREACHABLE-1 §6/§9 — the second reason a terminal
  // transition can be refused. Asked through the same predicate the write path
  // uses, so the screen and the domain cannot disagree about it.
  const canonicalReviewOpen = await terminalStatesBlockedByCanonicalReview(prisma, caseId);

  const now = new Date();
  return {
    ...toQueueItem(row, now),
    allowedTransitions: allowedTransitionsFor(
      row.status,
      openEscalations > 0 || canonicalReviewOpen,
    ),
    details: row.details,
    reasonCode: row.reasonCode,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
    anchor: await loadAnchor(row),
  };
}

/* ------------------------------------------------------- thread + history */

/**
 * The learner-visible thread. This function selects from `LearnerOpsMessage`
 * and names no other table — it is the same projection the learner receives,
 * with staff display names added.
 */
export async function listMessages(caseId: string, limit: number, cursor?: string) {
  const rows = await prisma.learnerOpsMessage.findMany({
    where: { caseId },
    select: {
      id: true,
      authorKind: true,
      body: true,
      createdAt: true,
      readByLearnerAt: true,
      authorStaff: { select: { displayName: true } },
      authorUser: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id,
      authorKind: row.authorKind,
      authorName: row.authorStaff?.displayName ?? row.authorUser?.name ?? "—",
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      readByLearnerAt: row.readByLearnerAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * The INTERNAL notes. A separate function over a separate table, called only
 * from the staff route. There is no parameter that turns `listMessages` into
 * this, and no parameter that turns this into `listMessages`.
 */
export async function listNotes(caseId: string, limit: number, cursor?: string) {
  const rows = await prisma.learnerOpsNote.findMany({
    where: { caseId },
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorStaff: { select: { displayName: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id,
      authorName: row.authorStaff.displayName,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** The immutable operational timeline. */
export async function listEvents(caseId: string, limit: number, cursor?: string) {
  const rows = await prisma.learnerOpsCaseEvent.findMany({
    where: { caseId },
    select: {
      id: true,
      caseVersion: true,
      eventType: true,
      previousStatus: true,
      nextStatus: true,
      previousPriority: true,
      nextPriority: true,
      reason: true,
      createdAt: true,
      actorStaff: { select: { displayName: true } },
      previousAssignedStaff: { select: { displayName: true } },
      nextAssignedStaff: { select: { displayName: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id,
      caseVersion: row.caseVersion,
      eventType: row.eventType,
      // A system action has no actor, and the UI says "система" rather than
      // inventing one.
      actorName: row.actorStaff?.displayName ?? null,
      previousStatus: row.previousStatus,
      nextStatus: row.nextStatus,
      previousPriority: row.previousPriority,
      nextPriority: row.nextPriority,
      previousAssignee: row.previousAssignedStaff?.displayName ?? null,
      nextAssignee: row.nextAssignedStaff?.displayName ?? null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
