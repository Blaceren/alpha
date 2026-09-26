/**
 * Canonical filter options (post Phase 1B1.1). Values come from the domain enums;
 * labels come from the central config — raw codes are never shown to the user.
 */
import type { UserFilters } from "@/data/contracts/CrmDataProvider";
import { PRIMARY_OWNER_CANDIDATES } from "@/domain/identity/employees";
import {
  BLOCKER_LABEL,
  ENGAGEMENT_LABEL,
  FUNDING_LABEL,
  LIFECYCLE_LABEL,
  PRIORITY_LABEL,
  REGISTRATION_STATUS_LABEL,
  USERS_COLUMN_LABEL,
  VALUE_SEGMENT_LABEL,
  ownerLabel,
} from "@/config/labels";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDef {
  /** Key into UserFilters (array-valued). */
  key: keyof UserFilters;
  label: string;
  options: FilterOption[];
}

const opts = <T extends string>(labels: Record<T, string>): FilterOption[] =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

/**
 * Owner filter options — DERIVED from the canonical employee directory
 * (Phase 1B4-C), where they used to be a hand-kept array.
 *
 * The set is the primary-owner candidates, which is exactly the set of values
 * `ownerId` can ever hold: fixtures seed it and `assignPrimaryOwner` may only
 * write a candidate. The old array additionally offered `emp_mod1`, who owns
 * nobody and never could — a filter that always returns empty (Today builds its
 * owner options from the real queue for the same reason).
 */
const OWNER_IDS: string[] = PRIMARY_OWNER_CANDIDATES.map((e) => e.employeeId);

/** The five canonical state dimensions (primary filters). */
export const DIMENSION_FILTERS: FilterDef[] = [
  { key: "lifecycleStage", label: USERS_COLUMN_LABEL.lifecycle, options: opts(LIFECYCLE_LABEL) },
  { key: "fundingStatus", label: USERS_COLUMN_LABEL.funding, options: opts(FUNDING_LABEL) },
  { key: "engagementStatus", label: USERS_COLUMN_LABEL.engagement, options: opts(ENGAGEMENT_LABEL) },
  { key: "valueSegment", label: USERS_COLUMN_LABEL.valueSegments, options: opts(VALUE_SEGMENT_LABEL) },
  { key: "blocker", label: "Блокеры", options: opts(BLOCKER_LABEL) },
];

/** Allowed secondary filters (kept small, per spec §8). */
export const SECONDARY_FILTERS: FilterDef[] = [
  {
    key: "priority",
    label: "Приоритет",
    options: (["critical", "high", "normal", "low"] as const).map((v) => ({ value: v, label: PRIORITY_LABEL[v] })),
  },
  {
    key: "registrationStatus",
    label: "Регистрация Pocket",
    options: opts(REGISTRATION_STATUS_LABEL),
  },
  {
    key: "ownerId",
    label: USERS_COLUMN_LABEL.owner,
    options: OWNER_IDS.map((id) => ({ value: id, label: ownerLabel(id) })),
  },
];

export const ALL_FILTERS: FilterDef[] = [...DIMENSION_FILTERS, ...SECONDARY_FILTERS];

/** Human label for an active (key,value) pair — for filter chips. */
export function optionLabel(key: keyof UserFilters, value: string): string {
  const def = ALL_FILTERS.find((f) => f.key === key);
  return def?.options.find((o) => o.value === value)?.label ?? value;
}
