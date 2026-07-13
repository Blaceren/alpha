/**
 * Permission-aware financial projection (Phase 1B1 §10). The UI never decides
 * how much to reveal — it renders whatever this projection returns. Depends on
 * role, permission, data sensitivity, and source freshness.
 */
import type { CrmRole } from "@/domain/identity/roles";
import { canViewExactFinancials } from "@/domain/identity/access";
import { FINANCIAL_BUCKET_LABEL, toFinancialBucket, type FinancialBucket } from "./financial";

export type FinancialProjectionMode = "exact" | "bucket" | "aggregated" | "hidden";

export interface FinancialProjection {
  mode: FinancialProjectionMode;
  /** Present only when mode === "exact". */
  amountUsd: number | null;
  /** Present for bucket / aggregated modes. */
  bucket: FinancialBucket | null;
  /** Ready-to-render label respecting the mode. */
  label: string;
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
    return { mode: "hidden", amountUsd: null, bucket: null, label: "н/д", stale: true };
  }

  const bucket = toFinancialBucket(Math.round(amountUsd * 100));
  const bucketLabel = FINANCIAL_BUCKET_LABEL[bucket];

  if (canViewExactFinancials(role)) {
    return {
      mode: "exact",
      amountUsd,
      bucket,
      label: `$${amountUsd.toLocaleString("en-US")}`,
      stale: isStale,
    };
  }

  if (role === "analyst") {
    // Aggregated / pseudonymized — bucket only, no exact value.
    return { mode: "aggregated", amountUsd: null, bucket, label: bucketLabel, stale: isStale };
  }

  if (role === "mentor" || role === "support" || role === "moderator" || role === "content_manager") {
    return { mode: "bucket", amountUsd: null, bucket, label: bucketLabel, stale: isStale };
  }

  // read_only and any other role: hidden by default.
  return { mode: "hidden", amountUsd: null, bucket: null, label: "скрыто", stale: isStale };
}
