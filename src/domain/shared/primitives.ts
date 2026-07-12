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
 * Reusable explainability primitive. Never contains secrets or raw PII.
 * Source of truth: docs/CRM_DOMAIN_MODEL.md §19 / STATE_MODEL.md §6.
 */
export interface StateEvidence {
  kind: "metric" | "event" | "threshold" | "timestamp" | "reference";
  label: string;
  value: string | number | null;
  observedAt: ISODateString;
  sensitivity: DataSensitivity;
}
