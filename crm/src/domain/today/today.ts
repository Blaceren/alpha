/**
 * Today workspace — the permission-projected read model behind `/today`.
 * Returned by CrmDataProvider.getTodayWorkspace (Phase 1B3).
 *
 * Like User 360, every field here is ALREADY projected for the caller's role.
 * The UI renders what it receives: it never re-decides visibility, never
 * recomputes priority, and never decides who belongs in the queue. A value a
 * role may not see is absent from the result, so it cannot leak through the DOM,
 * props, aria/title attributes, or serialized page data.
 *
 * Framework-agnostic — no React/Next imports.
 */
import type { EmployeeId, Freshness, ISODateString, StateEvidence, UserId } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";
import type { FinancialProjection } from "@/domain/financial/projection";
import type { IdentityProjection } from "@/domain/identity/identity-projection";
import type { PriorityBand } from "@/domain/priority/priority";
import type { SignalCode, SignalSeverity } from "@/domain/signals/signal";
import type { RecommendedActionCode } from "@/domain/recommendations/catalog";
import type { SlaState } from "@/domain/users/user-360";
import type { TodayBasisCode, TodaySectionKey } from "@/config/queues";

export type { TodayBasisCode, TodaySectionKey };

/**
 * Why this user is in the queue. Never a bare "требует внимания": `code` names
 * the kind of grounds and `text` states the concrete fact behind it, in Russian,
 * from the domain (the triggering signal's own reason).
 */
export interface TodayBasis {
  code: TodayBasisCode;
  text: string;
  /** The signal this basis was read from, when it came from one. */
  signalCode: SignalCode | null;
  severity: SignalSeverity | null;
}

/** A deadline. `isSla` separates a contractual SLA from a planned follow-up. */
export interface TodayDue {
  at: ISODateString;
  state: SlaState;
  /** SLA key (e.g. mentor_review) — null for a plain follow-up date. */
  key: string | null;
  isSla: boolean;
  /** Hours until due; negative when passed. From the provider clock, never Date.now(). */
  hoursUntil: number;
}

/**
 * The single next action, as the domain recommends it. Today never performs it.
 *
 * Carries the CODE, not a title: the wording is authored once in the
 * recommendation catalog and reaches every screen through the single
 * `config/labels`.RECOMMENDATION_LABEL mapping derived from it (D-52). Shipping a
 * second Russian string inside the read model is how the same action ends up
 * worded two ways on two screens — which is exactly what happened before D-52.
 */
export interface TodayRecommendation {
  code: RecommendedActionCode;
  /** False when the catalog does not allow this role to carry the action out. */
  allowedForRole: boolean;
}

/** An event from today's operational window. Distinct from `lastActivityAt`. */
export interface TodayEvent {
  at: ISODateString;
  title: string;
}

/** One user in the queue: everything triage needs, and nothing more. */
export interface TodayQueueItem {
  userId: UserId;
  /** The ONLY source of a name/email/pseudonym. `list` context — never a full email. */
  identity: IdentityProjection;
  section: TodaySectionKey;
  priority: PriorityBand;
  /**
   * Which priority rule ranked this user (PRIORITY_REASON_LABEL, never raw).
   *
   * Carried for parity with `UserSummary.priorityReasonCode` and for callers
   * that audit the ladder — but the Today ROW does not render it. The priority
   * ladder and the bases read the same signal catalog, so the reason is always a
   * coarser restatement of the basis the row already shows: "Критический
   * support-блокер" directly above "Открыт support-блокер." is one fact printed
   * twice (§10). The badge gives the band, the basis gives the why, and User
   * 360's «Основание приоритета» is where the rule itself is on the record.
   */
  priorityReasonCode: string;
  /** The canonical basis. Drives the section and the visible explanation. */
  basis: TodayBasis;
  /** Further grounds, as compact chips. Never repeats `basis.code`. */
  additionalBasisCodes: TodayBasisCode[];
  recommendation: TodayRecommendation | null;
  ownerId: EmployeeId | null;
  due: TodayDue | null;
  /** Current state: the last meaningful action, however old. */
  lastActivityAt: ISODateString | null;
  /** Recent event INSIDE today's window; null when nothing happened today. */
  todayEvent: TodayEvent | null;
  /** Small, permission-safe explanation of the basis. Empty when unsafe/absent. */
  evidence: StateEvidence[];
  /**
   * Balance, permission-projected — or NULL when a balance is simply not part of
   * this row's story (§10: a support agent chasing a report does not need one).
   *
   * Null rather than a `hidden` projection on purpose: `FinancialHiddenReason`
   * answers "no_data" vs "not_permitted", and neither is true here — telling an
   * admin "Недоступно для роли" about a value they may see and do not need would
   * be false. Relevance is Today's decision; permission stays the projection's.
   */
  financial: FinancialProjection | null;
}

/** A section of the queue. Only non-empty sections are returned. */
export interface TodayQueueSection {
  key: TodaySectionKey;
  title: string;
  hint: string;
  items: TodayQueueItem[];
}

/**
 * A few operational counts — not a KPI board. Always describes the CURRENT
 * (filtered, permission-safe) queue, so it can never count a user the role
 * cannot see, and never implies work that the visible queue does not contain.
 */
export interface TodaySummary {
  /** Users in the queue right now. */
  totalAttention: number;
  critical: number;
  slaBreached: number;
  /** Users with no owner — real gap in the fixtures, not a decorative metric. */
  unassigned: number;
}

/** Freshness of the whole workspace. Ages are computed against the provider clock. */
export interface TodayFreshness extends Freshness {
  generatedAt: ISODateString;
  /** Age of the data in whole minutes, computed by the provider (never in React). */
  ageMinutes: number;
}

/** Filter values that actually occur in this role's queue — so no filter is dead. */
export interface TodayFilterOptions {
  priority: PriorityBand[];
  basis: TodayBasisCode[];
  owners: EmployeeId[];
  /** SLA states present in the queue. Empty when nothing here is under an SLA. */
  sla: SlaState[];
  /** True when at least one queue member has no owner. */
  hasUnassigned: boolean;
}

export type TodaySortField = "urgency" | "last_activity" | "owner";

export interface TodayWorkspace {
  /** Working date/instant from the provider clock — the UI never reads a wall clock. */
  generatedAt: ISODateString;
  role: CrmRole;
  sections: TodayQueueSection[];
  summary: TodaySummary;
  filterOptions: TodayFilterOptions;
  freshness: TodayFreshness;
  /** The window "recent activity" was read over (Phase 1B3 §21). */
  window: { from: ISODateString; to: ISODateString };
  /**
   * True when the dataset has users but none of them need attention — lets the
   * UI say "нет работы" rather than "ничего не найдено" (§19).
   */
  hasCalmUsers: boolean;
}
