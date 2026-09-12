/**
 * Signal codes and severity. Source of truth: docs/SIGNAL_CATALOG.md.
 * Signals are temporary, explainable indicators — not permanent labels.
 */
import type {
  ISODateString,
  StateEvidence,
  UserId,
} from "@/domain/shared/primitives";

export type SignalCode =
  | "registration_no_start"
  | "pocket_registration_incomplete"
  | "email_not_confirmed"
  | "lesson_abandoned"
  | "progression_stalled"
  | "repeated_test_failure"
  | "report_pending"
  | "report_rejected_no_return"
  | "mentor_sla_risk"
  | "checkpoint_approaching"
  | "checkpoint_grace_active"
  | "financial_access_suspended"
  | "balance_data_stale"
  | "pocket_data_conflict"
  | "inactive_3_days"
  | "inactive_7_days"
  | "dormant_14_days"
  | "dormant_30_days"
  | "returned_after_absence"
  | "communication_fatigue"
  | "support_blocked"
  | "frequent_redeposit_pattern"
  | "rapid_balance_decline";

export type SignalSeverity = "critical" | "high" | "medium" | "low";

export type SignalStatus = "active" | "resolved" | "expired" | "suppressed";

export interface UserSignal {
  id: string;
  userId: UserId;
  code: SignalCode;
  severity: SignalSeverity;
  status: SignalStatus;
  reasonCode: string;
  evidence: StateEvidence[];
  createdAt: ISODateString;
  calculatedAt: ISODateString;
  expiresAt: ISODateString | null;
}
