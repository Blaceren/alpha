import * as React from "react";
import type { Metadata } from "next";
import { AffiliateLeadsWorkspace } from "@/features/affiliate-leads/leads-workspace";
import { LoadingBlock } from "@/features/affiliate-leads/lead-primitives";
import { LEADS_TITLE, LIST_LOADING } from "@/features/affiliate-leads/leads-labels";

/**
 * AFD-5C2 — the affiliate lead list route.
 *
 * The workspace reads `useSearchParams()`, so Next requires it to sit under a
 * Suspense boundary; without one the whole route opts out of static rendering
 * with a build-time warning. The fallback is the same loading block the list
 * uses, so the first paint is consistent with every later one.
 */
export const metadata: Metadata = {
  title: LEADS_TITLE,
};

export default function AffiliateLeadsPage() {
  return (
    <React.Suspense fallback={<LoadingBlock label={LIST_LOADING} />}>
      <AffiliateLeadsWorkspace />
    </React.Suspense>
  );
}
