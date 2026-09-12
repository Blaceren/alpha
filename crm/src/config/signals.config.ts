/**
 * Signal thresholds — the single configurable source for the signal engine.
 * Values mirror docs/SIGNAL_CATALOG.md (DECISIONS D-04). Components/engine read
 * from here; thresholds are never hardcoded in derivation logic or UI.
 */
export const SIGNAL_THRESHOLDS = {
  registration_no_start: { hours: 24 },
  pocket_registration_incomplete: { hours: 24 },
  email_not_confirmed: { hours: 12 },
  lesson_abandoned: { hours: 24 },
  progression_stalled: { hours: 72 },
  repeated_test_failure: { count: 3, windowHours: 24 },
  report_rejected_no_return: { hours: 48 },
  checkpoint_approaching: { deltaPct: 15 },
  inactive_3_days: { hours: 72 },
  inactive_7_days: { days: 7 },
  dormant_14_days: { days: 14 },
  dormant_30_days: { days: 30 },
  returned_after_absence: { minAbsentDays: 7 },
  communication_fatigue: { max24h: 2, max7d: 5 },
  balance_data_stale: { warnMinutes: 15, staleMinutes: 60 },
  frequent_redeposit_pattern: { minRedeposits: 4 },
  rapid_balance_decline: { dropPct: 40, windowHours: 24 },
  mentor_sla_risk: { warnAtPct: 80 },
} as const;

/** Default signal lifetime (used when a signal has no natural expiry anchor). */
export const DEFAULT_SIGNAL_TTL_HOURS = 24;
