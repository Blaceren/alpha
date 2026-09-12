/**
 * SLA durations and warning threshold. Mirrors docs/SLA_POLICY.md (DECISIONS D-05).
 * Mock uses calendar hours (no business-calendar).
 */
export type SlaKey =
  | "mentor_review"
  | "retention_follow_up"
  | "support_critical"
  | "support_high"
  | "support_normal"
  | "financial_data_conflict";

export const SLA_DURATION_HOURS: Record<SlaKey, number> = {
  mentor_review: 24,
  retention_follow_up: 24,
  support_critical: 1,
  support_high: 4,
  support_normal: 24,
  financial_data_conflict: 4,
};

/** Default warning threshold as a fraction of the SLA duration. */
export const SLA_WARN_AT_PCT = 0.8;

export const CHECKPOINT_GRACE_HOURS = 24;
