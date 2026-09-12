import * as React from "react";
import type { Metadata } from "next";
import { CurieAtlasWorkspace } from "@/features/curie-atlas/atlas-workspace";

/**
 * AFD-5D2 — the Curie Atlas route.
 *
 * Nested under `/affiliates/analytics/` so the URL states the information
 * architecture: this reads the affiliate analytics the section already
 * publishes and owns no data of its own.
 *
 * NO SUSPENSE BOUNDARY IS NEEDED HERE, unlike the analytics workspace. That one
 * reads `useSearchParams()`, which forces a boundary; this workspace keeps its
 * draft selection in local state precisely because an Atlas result is not
 * addressable by URL, so it never suspends on search params.
 */
export const metadata: Metadata = {
  title: "Curie Atlas — детерминированный анализ трафика",
};

export default function CurieAtlasPage() {
  return <CurieAtlasWorkspace />;
}
