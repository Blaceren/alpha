/**
 * Canonical 5-dimension user state model.
 * Source of truth: docs/STATE_MODEL.md (DECISIONS D-01). Framework-agnostic.
 *
 * The five dimensions are orthogonal: a user can simultaneously be `active`
 * (lifecycle) + `funded` (funding) + `inactive_7d` (engagement) +
 * `repeat_funder` (value) + `support_blocked` (blocker) without data loss.
 */
import type {
  EmployeeId,
  ISODateString,
  StateEvidence,
  UserId,
} from "@/domain/shared/primitives";

/** LifecycleStage — exactly one, versioned with history. */
export type LifecycleStage =
  | "registered"
  | "pocket_registered"
  | "pre_ftd"
  | "first_depositor"
  | "active"
  | "at_risk"
  | "dormant"
  | "reactivated"
  | "completed_current_curriculum";

/** FundingStatus — exactly one. CRM only displays it (backend is authoritative). */
export type FundingStatus =
  | "not_available"
  | "unfunded"
  | "funded"
  | "checkpoint_grace"
  | "financial_access_suspended"
  | "balance_unknown";

/** EngagementStatus — exactly one. Thresholds from docs/SIGNAL_CATALOG.md. */
export type EngagementStatus =
  | "not_started"
  | "active"
  | "progression_stalled"
  | "inactive_3d"
  | "inactive_7d"
  | "dormant_14d"
  | "dormant_30d"
  | "returned";

/** ValueSegment — zero or more non-exclusive tags. */
export type ValueSegment =
  | "first_depositor"
  | "repeat_funder"
  | "frequent_repeat_funder"
  | "high_value_candidate"
  | "advanced_learner";

/** OperationalBlocker — zero or more active blockers. */
export type OperationalBlocker =
  | "email_unconfirmed"
  | "pocket_registration_incomplete"
  | "report_pending"
  | "mentor_blocked"
  | "support_blocked"
  | "financial_data_conflict"
  | "communication_fatigue";

export interface ManualOverride {
  by: EmployeeId;
  at: ISODateString;
  reason: string;
  expiresAt: ISODateString | null;
}

export interface LifecycleTransition {
  from: LifecycleStage | null;
  to: LifecycleStage;
  at: ISODateString;
  reasonCode: string;
  evidence: StateEvidence[];
  source: "system" | "automation" | "manual";
  actorId: EmployeeId | null;
}

/** The single versioned lifecycle dimension. */
export interface LifecycleState {
  version: string;
  current: LifecycleStage;
  enteredAt: ISODateString;
  previous: LifecycleStage | null;
  reasonCode: string;
  evidence: StateEvidence[];
  history: LifecycleTransition[];
  manualOverride: ManualOverride | null;
}

/** Wrapper for single-value dimensions (funding / engagement). */
export interface DimensionState<T extends string> {
  value: T;
  reasonCode: string;
  evidence: StateEvidence[];
  calculatedAt: ISODateString;
  expiresAt: ISODateString | null;
}

/** Tag element for array dimensions (value segments / blockers). */
export interface StateTag<T extends string> {
  tag: T;
  reasonCode: string;
  evidence: StateEvidence[];
  calculatedAt: ISODateString;
  expiresAt: ISODateString | null;
  status: "active" | "expired" | "suppressed";
}

/** Full composed user state profile — replaces the former lifecycle mega-enum. */
export interface UserStateProfile {
  userId: UserId;
  lifecycle: LifecycleState;
  funding: DimensionState<FundingStatus>;
  engagement: DimensionState<EngagementStatus>;
  valueSegments: StateTag<ValueSegment>[];
  blockers: StateTag<OperationalBlocker>[];
}
