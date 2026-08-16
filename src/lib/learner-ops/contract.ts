/**
 * LEARNER-OPERATIONS-V1 — the domain contract.
 *
 * The single place the operational vocabulary, the legal state transitions and
 * the SLA clock rules are written down. Everything else in this domain reads
 * from here, so a rule cannot be enforced in one code path and forgotten in
 * another.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN.
 *
 * No business SLA durations. The product owner has supplied none, so the
 * numbers live in `LearnerOpsSlaPolicy` rows stamped with their origin, and
 * this file only says how a clock BEHAVES, never how long it may run.
 *
 * No progression vocabulary. `pending_review`, `approved`, `revision_requested`
 * and `completed` belong to the canonical Academy owners. A case has its own
 * lifecycle and the two are never mapped onto one another, because a mapping is
 * how an operational status quietly becomes an educational one.
 */
import type {
  LearnerOpsCaseStatus,
  LearnerOpsCaseType,
  LearnerOpsPriority,
} from "@prisma/client";

/* ------------------------------------------------------------------ status */

export const LEARNER_OPS_STATUSES = [
  "new",
  "open",
  "in_progress",
  "waiting_learner",
  "waiting_internal",
  "waiting_external",
  "escalated",
  "resolved",
  "closed",
] as const satisfies readonly LearnerOpsCaseStatus[];

/**
 * Statuses in which a case is still LIVE work. Used by every queue read and by
 * the "does this learner already have an open case" check.
 */
export const LEARNER_OPS_ACTIVE_STATUSES = [
  "new",
  "open",
  "in_progress",
  "waiting_learner",
  "waiting_internal",
  "waiting_external",
  "escalated",
] as const satisfies readonly LearnerOpsCaseStatus[];

/**
 * The two statuses that assert the operational work is FINISHED.
 *
 * Named here rather than inlined because more than one invariant needs to ask
 * "is this state a claim of completion?" — LO-ESCALATION-RESOLVE-AUTHORITY-1
 * refuses to enter either while an escalation is unanswered. It is the exact
 * complement of `LEARNER_OPS_ACTIVE_STATUSES` and is asserted to be by the
 * regression, so the two can never drift into overlapping or leaving a gap.
 */
export const LEARNER_OPS_TERMINAL_STATUSES = [
  "resolved",
  "closed",
] as const satisfies readonly LearnerOpsCaseStatus[];

/** The three waits, named once so no caller re-derives the list. */
export const LEARNER_OPS_WAITING_STATUSES = [
  "waiting_learner",
  "waiting_internal",
  "waiting_external",
] as const satisfies readonly LearnerOpsCaseStatus[];

export function isWaitingStatus(status: LearnerOpsCaseStatus): boolean {
  return (LEARNER_OPS_WAITING_STATUSES as readonly string[]).includes(status);
}

export function isActiveStatus(status: LearnerOpsCaseStatus): boolean {
  return (LEARNER_OPS_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * THE STATE MACHINE, declared as data.
 *
 * A transition that is not listed here does not exist. The domain refuses it
 * before touching the database, and the database's own CHECK constraints refuse
 * the invalid COMBINATIONS that would result — the two are independent, which
 * is deliberate: an application bug should not be able to store a state the
 * schema says is impossible, and a raw-SQL writer should not be able to either.
 *
 * WHY `closed` IS NOT TERMINAL. It is reachable from `resolved` and from
 * itself-forward only, but `reopened` is expressed as a transition BACK to
 * `open` from `resolved` or `closed`, with `reopenCount` incremented. There is
 * no `reopened` status: see the schema comment on why a durable counter beats a
 * status that the next transition erases.
 *
 * WHY `escalated` RETURNS TO `in_progress`. An escalation does not transfer the
 * case. When it resolves, the case comes back to the operator who owned it, and
 * the ownership column was never changed — so there is nothing to restore.
 */
export const LEARNER_OPS_TRANSITIONS: Readonly<
  Record<LearnerOpsCaseStatus, readonly LearnerOpsCaseStatus[]>
> = {
  // `new` is untriaged, not inert. An operator who opens an untriaged case and
  // immediately needs more information from the learner, or who sees at once
  // that it needs a methodologist, must be able to act — so `new` reaches the
  // same set `open` does. Forcing a pointless hop through `open` first would
  // have made the timeline record a triage step that never happened, and it
  // made `raiseEscalation` fail outright on exactly the cases most likely to
  // need escalating. Found by the domain regression, not by reading.
  new: [
    "open",
    "in_progress",
    "waiting_learner",
    "waiting_internal",
    "waiting_external",
    "escalated",
    "resolved",
    "closed",
  ],
  open: ["in_progress", "waiting_learner", "waiting_internal", "waiting_external", "escalated", "resolved", "closed"],
  in_progress: ["open", "waiting_learner", "waiting_internal", "waiting_external", "escalated", "resolved", "closed"],
  waiting_learner: ["in_progress", "open", "waiting_internal", "waiting_external", "escalated", "resolved", "closed"],
  waiting_internal: ["in_progress", "open", "waiting_learner", "waiting_external", "escalated", "resolved", "closed"],
  waiting_external: ["in_progress", "open", "waiting_learner", "waiting_internal", "escalated", "resolved", "closed"],
  escalated: ["in_progress", "waiting_learner", "waiting_internal", "waiting_external", "resolved", "closed"],
  // Reopen. Both terminal states lead back to `open`, never straight to
  // `in_progress`: a reopened case is unclaimed work again until somebody takes
  // it, and pretending otherwise would leave it invisible in the unassigned
  // backlog.
  resolved: ["open", "closed"],
  closed: ["open"],
};

export function isLegalTransition(
  from: LearnerOpsCaseStatus,
  to: LearnerOpsCaseStatus,
): boolean {
  return (LEARNER_OPS_TRANSITIONS[from] as readonly string[]).includes(to);
}

/** The transitions that mean "this case has come back from a terminal state". */
export function isReopenTransition(
  from: LearnerOpsCaseStatus,
  to: LearnerOpsCaseStatus,
): boolean {
  return (from === "resolved" || from === "closed") && to === "open";
}

/* -------------------------------------------------------------------- type */

export const LEARNER_OPS_TYPES = [
  "support_request",
  "report_review",
  "mentor_review",
  "educational_escalation",
  "complaint",
  "service_recovery",
  "operational_followup",
] as const satisfies readonly LearnerOpsCaseType[];

/**
 * Which canonical anchor each type may carry. Mirrors the CHECK constraints in
 * migration 51 exactly — the database is the enforcement, this is the same rule
 * expressed where the application can give a useful error instead of a
 * constraint violation.
 */
export const LEARNER_OPS_REQUIRED_ANCHOR: Readonly<
  Partial<Record<LearnerOpsCaseType, "reportSubmission" | "userLevelProgress">>
> = {
  report_review: "reportSubmission",
  mentor_review: "userLevelProgress",
};

/**
 * The types whose outcome is decided by a CANONICAL EDUCATIONAL OWNER rather
 * than by the operator handling the case. Resolving one of these does not and
 * cannot change the educational object — the case merely stops being work.
 */
export const LEARNER_OPS_CANONICAL_DECISION_TYPES = [
  "report_review",
  "mentor_review",
] as const satisfies readonly LearnerOpsCaseType[];

export function requiresCanonicalDecision(type: LearnerOpsCaseType): boolean {
  return (LEARNER_OPS_CANONICAL_DECISION_TYPES as readonly string[]).includes(type);
}

/* ---------------------------------------------------------------- priority */

export const LEARNER_OPS_PRIORITIES = [
  "urgent",
  "high",
  "normal",
  "low",
] as const satisfies readonly LearnerOpsPriority[];

/* --------------------------------------------------------------- SLA clock */

/**
 * HOW THE TWO CLOCKS BEHAVE. The durations come from the policy row, the
 * behaviour comes from here, and neither is inferable from the other.
 *
 * FIRST RESPONSE runs until the first learner-visible staff message exists.
 * It does not pause for `waiting_internal` or `waiting_external`, because a
 * learner waiting for their first reply does not care which internal party we
 * are waiting on — that delay is ours. It stops permanently once recorded, and
 * a reopen never restarts it: the first response happened, and rewriting that
 * fact would be rewriting history.
 *
 * RESOLUTION pauses according to the policy's three flags. A pause is
 * ACCUMULATED on exit rather than recomputed, so elapsed time never depends on
 * replaying the event log and no background job is needed to keep it true.
 *
 * BREACH IS NEVER STORED. It is computed at read time from `openedAt`,
 * `pausedMs`, `clockPausedAt` and the live clock. A stored breach flag is wrong
 * from the instant a deadline passes until something happens to rewrite it,
 * which is precisely the window in which an operator is looking at it.
 */
export type SlaPauseFlags = {
  readonly pausesOnWaitingLearner: boolean;
  readonly pausesOnWaitingInternal: boolean;
  readonly pausesOnWaitingExternal: boolean;
};

export function resolutionClockPauses(
  status: LearnerOpsCaseStatus,
  flags: SlaPauseFlags,
): boolean {
  switch (status) {
    case "waiting_learner":
      return flags.pausesOnWaitingLearner;
    case "waiting_internal":
      return flags.pausesOnWaitingInternal;
    case "waiting_external":
      return flags.pausesOnWaitingExternal;
    default:
      return false;
  }
}

/** Terminal for clock purposes: both clocks stop and never resume here. */
export function clockStopped(status: LearnerOpsCaseStatus): boolean {
  return status === "resolved" || status === "closed";
}

/* ------------------------------------------------------------ audit action */

/**
 * The AuditLog action vocabulary for this domain. AuditLog is documented as the
 * single audit surface that "must not become chatty", so exactly the sensitive
 * operations are recorded here and routine reads are not. The case's own
 * `LearnerOpsCaseEvent` timeline carries the full operational history.
 */
export const LEARNER_OPS_AUDIT_ACTIONS = {
  caseCreated: "learner_ops.case.created",
  caseAssigned: "learner_ops.case.assigned",
  caseReassigned: "learner_ops.case.reassigned",
  caseStatusChanged: "learner_ops.case.status_changed",
  casePriorityChanged: "learner_ops.case.priority_changed",
  caseReopened: "learner_ops.case.reopened",
  messageSent: "learner_ops.message.sent",
  noteAdded: "learner_ops.note.added",
  escalationRaised: "learner_ops.escalation.raised",
  escalationResolved: "learner_ops.escalation.resolved",
  qaRecorded: "learner_ops.qa.recorded",
  configChanged: "learner_ops.config.changed",
  knowledgeChanged: "learner_ops.knowledge.changed",
  vocChanged: "learner_ops.voc.changed",
} as const;

/* ---------------------------------------------------------------- limits */

/** Bounds every list read. A caller cannot ask for an unbounded page. */
export const LEARNER_OPS_PAGE_DEFAULT = 25;
export const LEARNER_OPS_PAGE_MAX = 100;

/** Bounds on free text, matching the report domain's conventions. */
export const LEARNER_OPS_SUBJECT_MAX = 200;
export const LEARNER_OPS_BODY_MAX = 8_000;
export const LEARNER_OPS_REASON_MAX = 2_000;
