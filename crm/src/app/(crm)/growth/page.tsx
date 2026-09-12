import * as React from "react";
import type { Metadata } from "next";
import { GrowthWorkspace } from "@/features/growth/growth-workspace";
import { LoadingBlock } from "@/features/growth/growth-primitives";

/**
 * G4-GROWTH — the internal staff Growth workspace route.
 *
 * Suspense-wrapped like the affiliate analytics route: the workspace is a client
 * component that fetches on mount, and the fallback is the same loading block
 * the sections use, so the first paint is consistent with every later one.
 */
export const metadata: Metadata = {
  title: "Growth",
};

export default function GrowthPage() {
  return (
    <React.Suspense fallback={<LoadingBlock label="Загружаем Growth…" />}>
      <GrowthWorkspace surface="overview" />
    </React.Suspense>
  );
}
