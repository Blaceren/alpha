import * as React from "react";
import type { Metadata } from "next";
import { GrowthWorkspace } from "@/features/growth/growth-workspace";
import { LoadingBlock } from "@/features/growth/growth-primitives";

/**
 * G4-R1 — Качество трафика.
 *
 * One route per Growth surface, so each is addressable, reloadable and
 * reachable with the browser's back button. The path is declared once in
 * `growth-routes.ts` and this page renders the surface that registry names.
 */
export const metadata: Metadata = {
  title: "Growth — Качество трафика",
};

export default function GrowthPage() {
  return (
    <React.Suspense fallback={<LoadingBlock label="Загружаем Growth…" />}>
      <GrowthWorkspace surface="acquisition" />
    </React.Suspense>
  );
}
