/**
 * VisiblePathWindow (Phase D2A) — which slice of the 100-level curriculum is
 * visually rendered. The window is one module (its 4–6 levels + gate); the
 * other 19 modules exist in data and in the module navigator, and appear in
 * the field only as dim continuation stubs + neighbour labels.
 */

import type { CurriculumModule } from "@/domain/curriculum";
import { CURRICULUM, getModuleByIndex } from "@/data/curriculum/fixture";
import { computeModuleLayout, type ModuleLayout } from "@/features/path/model/layout-engine";
import type { PathProgress } from "@/features/path/model/path-state";

export interface VisiblePathWindow {
  moduleIndex: number;
  layout: ModuleLayout;
  prevModule?: CurriculumModule;
  nextModule?: CurriculumModule;
}

export function computeVisibleWindow(
  moduleIndex: number,
  progress: PathProgress,
): VisiblePathWindow {
  const clamped = Math.min(Math.max(moduleIndex, 1), CURRICULUM.modules.length);
  const mod = getModuleByIndex(clamped);
  return {
    moduleIndex: clamped,
    layout: computeModuleLayout(mod, progress),
    prevModule: clamped > 1 ? getModuleByIndex(clamped - 1) : undefined,
    nextModule: clamped < 20 ? getModuleByIndex(clamped + 1) : undefined,
  };
}
