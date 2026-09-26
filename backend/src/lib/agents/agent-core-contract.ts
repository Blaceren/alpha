/**
 * AGENT-FOUNDATION-1 — the closed vocabularies of the shared Agent Core.
 *
 * Every enumerated value the Core can store is declared here once and mirrored
 * into `schema.prisma` as a Prisma enum. A regression compares the two lists
 * member for member, so the database and the source cannot drift.
 *
 * THE GOVERNING RULE OF THIS WHOLE MODULE. Agent Core records WHAT AN AGENT DID
 * and WHAT IT POINTED AT. It never stores a copy of the thing pointed at.
 * Authoritative product data stays with its existing owner and is re-read
 * through that owner's permission gate. This is what stops a stale agent output
 * from becoming a second, divergent source of truth, and it is also — not
 * coincidentally — what keeps PII out of these tables entirely.
 */

/* ------------------------------------------------------------------- runs */

/**
 * Why a run exists.
 *
 * `scheduled` is in the enum and NO SCHEDULER IS IMPLEMENTED. It is here so the
 * column never has to be widened later; `assertTriggerIsExecutable` refuses it.
 */
export const AGENT_TRIGGER_TYPES = [
  "interactive",
  "scheduled",
  "handoff",
  "system",
  "test",
] as const;

export type AgentTriggerType = (typeof AGENT_TRIGGER_TYPES)[number];

/** Trigger types a run may currently be CREATED with. */
export const EXECUTABLE_TRIGGER_TYPES = ["interactive", "test"] as const;

export const AGENT_RUN_STATUSES = [
  "created",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** A run in one of these is finished forever. Nothing may move it again. */
export const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"] as const;

/**
 * The COMPLETE legal state graph for a run.
 *
 * Expressed as data, not as scattered `if` statements, so that
 * `27_STATE_TRANSITIONS.json` in the audit package is generated FROM the thing
 * the runtime actually enforces rather than written alongside it.
 *
 * Note there is no edge back out of a terminal status and no self-edge: a
 * "completed → completed" retry is a duplicate, not a transition, and it is
 * rejected rather than silently absorbed.
 */
export const AGENT_RUN_TRANSITIONS: Readonly<
  Record<AgentRunStatus, readonly AgentRunStatus[]>
> = {
  created: ["running", "cancelled", "failed"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
} as const;

/**
 * The closed list of things a run can be ABOUT.
 *
 * `subjectRef` is an INTERNAL OPAQUE REFERENCE — an internal primary key
 * rendered as a string. It is never an email, a phone number, a Pocket player
 * id or an external click id, and `assertNoForbiddenValue` enforces the shape.
 *
 * `learner` is classified `pseudonymous_subject` + `staff_restricted`. It is
 * NOT anonymous and this module never claims it is: anyone with the learner
 * table can resolve it to a person in one join. That is precisely why no public
 * Agent API exposes it.
 */
export const AGENT_SUBJECT_TYPES = [
  "learner",
  "affiliate_partner",
  "affiliate_campaign",
  "affiliate_tracking_link",
  "curriculum_level",
] as const;

export type AgentSubjectType = (typeof AGENT_SUBJECT_TYPES)[number];

/* --------------------------------------------------------------- findings */

/**
 * Three levels.
 *
 * `critical` exists for a future agent that observes an operational fault.
 * Curie Atlas must never emit it — its whole contract is that it describes
 * measurements and makes no judgement — and a regression asserts the accepted
 * AFD-5D1 severity ladder still has exactly two members.
 */
export const AGENT_FINDING_SEVERITIES = ["info", "warning", "critical"] as const;

export type AgentFindingSeverity = (typeof AGENT_FINDING_SEVERITIES)[number];

export const AGENT_FINDING_STATUSES = [
  "active",
  "superseded",
  "expired",
  "withdrawn",
] as const;

export type AgentFindingStatus = (typeof AGENT_FINDING_STATUSES)[number];

/**
 * A finding's CONTENT is immutable; only its status may move, and only along
 * these edges. There is no path back to `active`: a withdrawn statement stays
 * withdrawn, and re-asserting it means a new run producing a new finding.
 */
export const AGENT_FINDING_TRANSITIONS: Readonly<
  Record<AgentFindingStatus, readonly AgentFindingStatus[]>
> = {
  active: ["superseded", "expired", "withdrawn"],
  superseded: [],
  expired: [],
  withdrawn: [],
} as const;

/**
 * How much a finding is entitled to claim.
 *
 * `measured` — every operand came from a stored value, through evidence.
 * `derived` — arithmetic over measured values, with the inputs cited.
 * `insufficient` — the honest "not enough data to say" case.
 *
 * There is no `inferred` and no `predicted` tier, because the Core has no
 * mechanism that could justify one.
 */
export const AGENT_SUPPORT_TIERS = ["measured", "derived", "insufficient"] as const;

export type AgentSupportTier = (typeof AGENT_SUPPORT_TIERS)[number];

/* --------------------------------------------------------------- evidence */

/**
 * Closed source domains, anticipating the agents that will need them.
 *
 * Only the domains in `IMPLEMENTED_EVIDENCE_DOMAINS` may be written today.
 * The rest are declared so the column never widens under time pressure, and
 * `assertEvidenceDomainIsImplemented` refuses them.
 */
export const AGENT_EVIDENCE_DOMAINS = [
  "affiliate_analytics",
  "curriculum",
  "progression",
  "assessment",
  "report",
  "pocket_event",
  "money_event",
  "product_event",
  "communication_event",
  "agent_run",
] as const;

export type AgentEvidenceDomain = (typeof AGENT_EVIDENCE_DOMAINS)[number];

/**
 * The domains that have a real, accepted owner to re-read from today.
 *
 * `affiliate_analytics` — the accepted AFD-5B1/5B2A aggregates.
 * `agent_run` — the Core citing its own prior run, which needs no new owner.
 *
 * `communication_event` and `money_event` are deliberately ABSENT: nothing in
 * the platform emits either, so an evidence row naming one would point at a
 * fact that does not exist.
 */
export const IMPLEMENTED_EVIDENCE_DOMAINS = [
  "affiliate_analytics",
  "agent_run",
] as const;

/* --------------------------------------------------------------- handoffs */

export const AGENT_HANDOFF_STATUSES = [
  "proposed",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
] as const;

export type AgentHandoffStatus = (typeof AGENT_HANDOFF_STATUSES)[number];

export const AGENT_HANDOFF_TRANSITIONS: Readonly<
  Record<AgentHandoffStatus, readonly AgentHandoffStatus[]>
> = {
  proposed: ["accepted", "rejected", "expired", "cancelled"],
  accepted: [],
  rejected: [],
  expired: [],
  cancelled: [],
} as const;

/**
 * The closed set of things one agent may ask another for.
 *
 * A handoff carries a CODE plus validated operands — never an instruction. The
 * difference matters: a code is a reviewable request whose meaning is fixed in
 * source, and a sentence is whatever the sender felt like writing.
 */
export const AGENT_HANDOFF_CODES = [
  "retention_candidate",
  "engagement_review",
  "evaluation_requested",
] as const;

export type AgentHandoffCode = (typeof AGENT_HANDOFF_CODES)[number];

/* ------------------------------------------------------------- proposals */

export const AGENT_ACTION_STATUSES = [
  "proposed",
  "awaiting_approval",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "execution_pending",
  "executed",
  "execution_failed",
] as const;

export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

export const AGENT_ACTION_TRANSITIONS: Readonly<
  Record<AgentActionStatus, readonly AgentActionStatus[]>
> = {
  proposed: ["awaiting_approval", "cancelled", "expired"],
  awaiting_approval: ["approved", "rejected", "cancelled", "expired"],
  approved: ["execution_pending", "cancelled"],
  rejected: [],
  expired: [],
  cancelled: [],
  execution_pending: ["executed", "execution_failed", "cancelled"],
  executed: [],
  execution_failed: [],
} as const;

/**
 * The closed set of actions an agent may ever PROPOSE.
 *
 * Every member is educational or supportive. Deliberately and permanently
 * ABSENT, because the platform teaches trading rather than selling it:
 *
 *   • deposit encouragement of any kind;
 *   • trading encouragement of any kind;
 *   • any bid, CPA or payout change;
 *   • affiliate enablement or disablement;
 *   • any financial-pressure or urgency messaging.
 *
 * `assertActionClassIsPermitted` rejects anything outside this list, and a
 * regression asserts each of the five forbidden shapes above by name so that
 * adding one becomes a visible test failure rather than a quiet widening.
 */
export const AGENT_ACTION_CLASSES = [
  "education_reminder",
  "continue_learning",
  "complete_registration",
  "review_feedback",
  "support_followup",
] as const;

export type AgentActionClass = (typeof AGENT_ACTION_CLASSES)[number];

/**
 * Where an action would eventually be delivered.
 *
 * NO PROVIDER IS IMPLEMENTED FOR ANY OF THESE. `human_task` — a person is asked
 * to do something — is the only one that needs no external system at all, and
 * it is the honest default for a platform with no message transport.
 */
export const AGENT_ACTION_CHANNELS = [
  "in_app",
  "email",
  "push",
  "sms",
  "human_task",
] as const;

export type AgentActionChannel = (typeof AGENT_ACTION_CHANNELS)[number];

export const AGENT_DECISIONS = ["approved", "rejected", "cancelled"] as const;

export type AgentDecision = (typeof AGENT_DECISIONS)[number];

/* ------------------------------------------------------------- executions */

export const AGENT_EXECUTION_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type AgentExecutionStatus = (typeof AGENT_EXECUTION_STATUSES)[number];

export const AGENT_EXECUTION_TRANSITIONS: Readonly<
  Record<AgentExecutionStatus, readonly AgentExecutionStatus[]>
> = {
  pending: ["running", "cancelled", "failed"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
} as const;

/**
 * The registry of things that could carry out an action.
 *
 * IT IS EMPTY, and that is the whole security property of §9. There is no
 * network client, no transport and no credential anywhere in this module, so
 * `assertExecutionProviderEnabled` cannot succeed for any input.
 */
export const ENABLED_EXECUTION_PROVIDERS: readonly string[] = [];

/* ------------------------------------------------------------ evaluations */

export const AGENT_EVALUATOR_TYPES = ["deterministic", "human", "model"] as const;

export type AgentEvaluatorType = (typeof AGENT_EVALUATOR_TYPES)[number];

/** Evaluator types permitted in this phase. `human` and `model` are not. */
export const ENABLED_EVALUATOR_TYPES = ["deterministic"] as const;

export const AGENT_EVALUATION_TARGET_TYPES = [
  "agent_run",
  "agent_finding",
  "agent_action_proposal",
] as const;

export type AgentEvaluationTargetType = (typeof AGENT_EVALUATION_TARGET_TYPES)[number];

export const AGENT_EVALUATION_RESULTS = [
  "passed",
  "failed",
  "inconclusive",
  "not_applicable",
] as const;

export type AgentEvaluationResult = (typeof AGENT_EVALUATION_RESULTS)[number];

/* -------------------------------------------------------- model invocation */

export const MODEL_INVOCATION_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type ModelInvocationStatus = (typeof MODEL_INVOCATION_STATUSES)[number];

export const MODEL_INVOCATION_TRANSITIONS: Readonly<
  Record<ModelInvocationStatus, readonly ModelInvocationStatus[]>
> = {
  pending: ["running", "cancelled", "failed"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
} as const;

export const MODEL_VALIDATION_STATUSES = [
  "not_run",
  "valid",
  "invalid_schema",
  "invalid_policy",
  "unsupported_claim",
] as const;

export type ModelValidationStatus = (typeof MODEL_VALIDATION_STATUSES)[number];

/**
 * The registry of model providers.
 *
 * IT IS EMPTY. No provider is selected, no API key is read and no network
 * client exists in this module or anywhere it imports. Every model invocation
 * attempt therefore fails closed with `MODEL_PROVIDER_DISABLED`.
 */
export const ENABLED_MODEL_PROVIDERS: readonly string[] = [];

/** The single stable code every disabled model path must fail with. */
export const MODEL_PROVIDER_DISABLED = "MODEL_PROVIDER_DISABLED" as const;

/* -------------------------------------------------------------- retention */

/**
 * Proposed retention categories. NO PURGE SCHEDULER IS IMPLEMENTED and no row
 * is automatically deleted in this phase.
 *
 * NO DURATION IS INVENTED HERE. A retention period is a legal and commercial
 * decision, not an engineering one, and a number written into this file would
 * be quoted back later as though somebody had decided it. `purgeAfter` is a
 * nullable column that stays NULL until a policy exists to fill it.
 */
export const AGENT_RETENTION_CLASSES = [
  "operational_short",
  "analytical_standard",
  "decision_record",
  "execution_record",
  "evaluation_record",
] as const;

export type AgentRetentionClass = (typeof AGENT_RETENTION_CLASSES)[number];

/* ---------------------------------------------------- privacy classification */

/**
 * The field-level data classes used by `12_PRIVACY_CLASSIFICATION.md` and by
 * `29_PRIVACY_MATRIX.csv`, which is generated from the schema rather than
 * written by hand.
 *
 * `forbidden` is a real member and no column carries it. It exists so the
 * classification can NAME what is excluded — a matrix that only lists what is
 * present cannot be checked against what must be absent.
 */
export const AGENT_DATA_CLASSES = [
  "public_configuration",
  "internal_operational",
  "pseudonymous_subject",
  "staff_restricted",
  "sensitive_usage",
  "forbidden",
] as const;

export type AgentDataClass = (typeof AGENT_DATA_CLASSES)[number];

/* ------------------------------------------------------------ permissions */

/**
 * The FUTURE Agent Core permission design. Documented, not granted.
 *
 * These four are deliberately NOT added to `CRM_PERMISSIONS` in
 * `src/lib/crm/roles.ts`, and no live or candidate role holds any of them. A
 * permission that exists in the matrix is a permission somebody can be given by
 * accident; naming them here records the intent without creating the risk.
 *
 * The current Curie Atlas endpoint continues to use `view_affiliate_analytics`
 * and this phase does not change it.
 */
export const FUTURE_AGENT_PERMISSIONS = [
  "view_agent_runs",
  "approve_agent_actions",
  "manage_agent_policy",
  "execute_agent_actions",
] as const;

export type FutureAgentPermission = (typeof FUTURE_AGENT_PERMISSIONS)[number];
