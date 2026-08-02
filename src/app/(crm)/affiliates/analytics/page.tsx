import * as React from "react";
import type { Metadata } from "next";
import { AffiliateAnalyticsWorkspace } from "@/features/affiliate-analytics/analytics-workspace";
import { LoadingBlock } from "@/features/affiliate-analytics/analytics-primitives";

/**
 * AFD-5C1 — the affiliate analytics workspace route.
 *
 * The workspace reads `useSearchParams()`, so Next requires it to sit under a
 * Suspense boundary; without one the whole route opts out of static rendering
 * with a build-time warning. The fallback is the same loading block the sections
 * use, so the first paint is consistent with every later one.
 */
export const metadata: Metadata = {
  title: "Аналитика аффилейтов",
};

export default function AffiliateAnalyticsPage() {
  return (
    <React.Suspense fallback={<LoadingBlock label="Загружаем аналитику…" />}>
      <AffiliateAnalyticsWorkspace />
    </React.Suspense>
  );
}
