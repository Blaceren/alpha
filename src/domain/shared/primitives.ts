/**
 * Shared domain primitives. Framework-agnostic — MUST NOT import React/Next.
 * Source of truth: docs/CRM_DOMAIN_MODEL.md §0.
 */

export type ISODateString = string;
export type UserId = string;
export type EmployeeId = string;

/** Money stored in minor units to avoid floating-point errors. */
export interface Money {
  amountMinor: number;
  currency: "USD";
}

/** Data sensitivity level (docs/CRM_DOMAIN_MODEL.md §0). */
export type DataSensitivity = "LOW" | "MEDIUM" | "HIGH" | "RESTRICTED";

/** Freshness metadata that must accompany financial and aggregate values. */
export interface Freshness {
  asOf: ISODateString;
  isStale: boolean;
}

/**
 * What a piece of evidence measures. A closed enum, NOT free text: evidence is
 * produced in the domain and rendered in the UI, so an ad-hoc English label like
 * "hours since registration" would either reach the screen verbatim or force
 * every renderer to invent its own wording. The code carries the meaning; the
 * Russian wording lives in ONE presentation map (config/labels.ts,
 * STATE_EVIDENCE_LABEL) that a consistency test pins to this list.
 */
export type StateEvidenceCode =
  | "hours_since_registration"
  | "pocket_registration_status"
  | "email_confirmed"
  | "lesson_progress_pct"
  | "hours_since_last_action"
  | "test_attempts"
  | "latest_test_score"
  | "report_state"
  | "hours_since_report_rejection"
  | "sla_elapsed_pct"
  | "sla_breached"
  | "checkpoint_delta_pct"
  | "grace_confirmations_below_threshold"
  | "financial_access_suspended"
  | "balance_age_minutes"
  | "pocket_data_conflict"
  | "days_inactive"
  | "engagement_status"
  | "communications_24h"
  | "communications_7d"
  | "support_state"
  | "redeposit_count"
  | "balance_drop_pct";

/** Canonical list of every evidence code — drives iteration + the label test. */
export const STATE_EVIDENCE_CODES: StateEvidenceCode[] = [
  "hours_since_registration",
  "pocket_registration_status",
  "email_confirmed",
  "lesson_progress_pct",
  "hours_since_last_action",
  "test_attempts",
  "latest_test_score",
  "report_state",
  "hours_since_report_rejection",
  "sla_elapsed_pct",
  "sla_breached",
  "checkpoint_delta_pct",
  "grace_confirmations_below_threshold",
  "financial_access_suspended",
  "balance_age_minutes",
  "pocket_data_conflict",
  "days_inactive",
  "engagement_status",
  "communications_24h",
  "communications_7d",
  "support_state",
  "redeposit_count",
  "balance_drop_pct",
];

/**
 * Reusable explainability primitive. Never contains secrets or raw PII.
 * Source of truth: docs/CRM_DOMAIN_MODEL.md §19 / STATE_MODEL.md §6.
 *
 * `value` holds the raw measurement — a number, a domain enum member, or a
 * boolean flag. It is NOT display text: rendering (units, Да/Нет, enum wording)
 * belongs to `formatEvidence`, so the domain never encodes Russian strings and
 * the UI never invents its own.
 */
export interface StateEvidence {
  kind: "metric" | "event" | "threshold" | "timestamp" | "reference";
  code: StateEvidenceCode;
  value: string | number | boolean | null;
  observedAt: ISODateString;
  sensitivity: DataSensitivity;
}
