/**
 * Canonical filter options (post Phase 1B1.1). Values come from the domain enums;
 * labels come from the central config — raw codes are never shown to the user.
 */
import type { UserFilters } from "@/data/contracts/CrmDataProvider";
import {
  BLOCKER_LABEL,
  ENGAGEMENT_LABEL,
  FUNDING_LABEL,
  LIFECYCLE_LABEL,
  PRIORITY_LABEL,
  REGISTRATION_STATUS_LABEL,
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

const OWNER_IDS = ["emp_ret1", "emp_ret2", "emp_men1", "emp_sup1", "emp_mgr", "emp_mod1"];

/** The five canonical state dimensions (primary filters). */
export const DIMENSION_FILTERS: FilterDef[] = [
  { key: "lifecycleStage", label: "Lifecycle", options: opts(LIFECYCLE_LABEL) },
  { key: "fundingStatus", label: "Финансовый статус", options: opts(FUNDING_LABEL) },
  { key: "engagementStatus", label: "Engagement", options: opts(ENGAGEMENT_LABEL) },
  { key: "valueSegment", label: "Value-сегменты", options: opts(VALUE_SEGMENT_LABEL) },
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
    label: "Owner",
    options: OWNER_IDS.map((id) => ({ value: id, label: ownerLabel(id) })),
  },
];

export const ALL_FILTERS: FilterDef[] = [...DIMENSION_FILTERS, ...SECONDARY_FILTERS];

/** Human label for an active (key,value) pair — for filter chips. */
export function optionLabel(key: keyof UserFilters, value: string): string {
  const def = ALL_FILTERS.find((f) => f.key === key);
  return def?.options.find((o) => o.value === value)?.label ?? value;
}
