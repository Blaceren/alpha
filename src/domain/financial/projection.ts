/**
 * Permission-aware financial projection (Phase 1B1 §10). The UI never decides
 * how much to reveal — it renders whatever this projection returns. Depends on
 * role, permission, data sensitivity, and source freshness.
 */
import type { CrmRole } from "@/domain/identity/roles";
import { canViewExactFinancials } from "@/domain/identity/access";
import { FINANCIAL_BUCKET_LABEL, toFinancialBucket, type FinancialBucket } from "./financial";

export type FinancialProjectionMode = "exact" | "bucket" | "aggregated" | "hidden";

/**
 * Why a value is hidden. `mode: "hidden"` alone conflates two very different
 * facts — "this role may not see it" and "there is no value to see" — and a UI
 * that mixes them tells an admin they lack permission when the data simply does
 * not exist. Always null unless mode === "hidden".
 */
export type FinancialHiddenReason = "no_data" | "not_permitted";

export interface FinancialProjection {
  mode: FinancialProjectionMode;
  /** Present only when mode === "exact". */
  amountUsd: number | null;
  /** Present for bucket / aggregated modes. */
  bucket: FinancialBucket | null;
  /** Ready-to-render label respecting the mode. */
  label: string;
  /** Set only when mode === "hidden" — distinguishes absence from restriction. */
  hiddenReason: FinancialHiddenReason | null;
  /** True when the underlying value is stale/unknown (still surfaced honestly). */
  stale: boolean;
}

export interface ProjectFinancialInput {
  role: CrmRole;
  amountUsd: number | null;
  isStale: boolean;
}

export function projectFinancial({ role, amountUsd, isStale }: ProjectFinancialInput): FinancialProjection {
  if (amountUsd === null) {
    // No value exists — nothing to do with permission.
    return {
      mode: "hidden",
      amountUsd: null,
      bucket: null,
      label: "нет данных",
      hiddenReason: "no_data",
      stale: true,
    };
  }

  const bucket = toFinancialBucket(Math.round(amountUsd * 100));
  const bucketLabel = FINANCIAL_BUCKET_LABEL[bucket];

  if (canViewExactFinancials(role)) {
    return {
      mode: "exact",
      amountUsd,
      bucket,
      label: `$${amountUsd.toLocaleString("en-US")}`,
      hiddenReason: null,
      stale: isStale,
    };
  }

  if (role === "analyst") {
    // Aggregated / pseudonymized — bucket only, no exact value.
    return {
      mode: "aggregated",
      amountUsd: null,
      bucket,
      label: bucketLabel,
      hiddenReason: null,
      stale: isStale,
    };
  }

  if (role === "mentor" || role === "support" || role === "moderator" || role === "content_manager") {
    return {
      mode: "bucket",
      amountUsd: null,
      bucket,
      label: bucketLabel,
      hiddenReason: null,
      stale: isStale,
    };
  }

  // read_only and any other role: restricted by permission, value does exist.
  return {
    mode: "hidden",
    amountUsd: null,
    bucket: null,
    label: "скрыто",
    hiddenReason: "not_permitted",
    stale: isStale,
  };
}
