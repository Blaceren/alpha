/**
 * Financial visibility primitives. Source of truth: docs/DECISIONS.md D-07.
 * Exact amounts are restricted; other roles see bucketed ranges.
 */

/** Bucketed financial ranges shown to roles without exact-financial access. */
export type FinancialBucket =
  | "below_50"
  | "50_99"
  | "100_199"
  | "200_499"
  | "500_999"
  | "1000_2499"
  | "2500_4999"
  | "5000_9999"
  | "10000_plus";

/** Checkpoint state incl. the post-L100 "not defined yet" case (DECISIONS D-10). */
export type CheckpointStatus =
  | "not_reached"
  | "approaching"
  | "met"
  | "grace"
  | "suspended"
  | "restored"
  | "future_checkpoint_not_defined";

/** Human-readable label for each bucket (UI display). */
export const FINANCIAL_BUCKET_LABEL: Record<FinancialBucket, string> = {
  below_50: "< $50",
  "50_99": "$50–99",
  "100_199": "$100–199",
  "200_499": "$200–499",
  "500_999": "$500–999",
  "1000_2499": "$1,000–2,499",
  "2500_4999": "$2,500–4,999",
  "5000_9999": "$5,000–9,999",
  "10000_plus": "$10,000+",
};

/** Map an exact USD minor-unit amount to its display bucket. */
export function toFinancialBucket(amountMinor: number): FinancialBucket {
  const usd = amountMinor / 100;
  if (usd < 50) return "below_50";
  if (usd < 100) return "50_99";
  if (usd < 200) return "100_199";
  if (usd < 500) return "200_499";
  if (usd < 1000) return "500_999";
  if (usd < 2500) return "1000_2499";
  if (usd < 5000) return "2500_4999";
  if (usd < 10000) return "5000_9999";
  return "10000_plus";
}
