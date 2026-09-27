/**
 * Canonical curriculum progress -> the tool resolver's progress marker.
 *
 * WHAT THIS FIXES. The Tools hub derived every unlock from
 * `resolvePathScenario(...)`, a fixture marker whose default is «Артём, L18».
 * In PREPROD that meant a real learner standing on level 15 was shown the tool
 * set of a person who does not exist, and the shell above it rendered that
 * person's name. Fixture data was acting as production authority on a live
 * surface — the one thing API mode exists to prevent.
 *
 * WHAT THIS IS NOT. It is not a second unlock rule. `projectTools` and
 * `levelProgressState` still own every lock decision, unchanged; this only
 * supplies the progress marker they read, sourced from canonical curriculum
 * state instead of a scenario constant. The tool catalogue's unlock levels are
 * the canonical L10/L15/.../L100 milestones and are not touched here.
 *
 * WHY `currentLevel` IS DERIVED FROM COMPLETED LEVELS. The resolver's contract
 * is positional: a tool unlocks when its level reads `completed`, which it does
 * when `level < currentLevel`. So the marker must be "the first level not yet
 * finished" — one past the last completed one. Taking the Backend's own
 * `currentLevelCode` order would be subtly wrong for a learner sitting ON an
 * unfinished gate: level 15 unfinished must not unlock the level-15 tool.
 */
import type { PathProgress } from "@/features/path/model/path-state";
import type { AcademyCurriculumView, AcademyToolAccess } from "@/lib/curriculum/academy-view";
import type { CurriculumViewResult } from "@/lib/curriculum/provider";

/** The instrumentation fields the hub does not render. Never shown, never invented. */
const UNUSED_INSTRUMENTATION = {
  rankLabel: "",
  xpLabel: "",
  streak: 0,
} as const;

/**
 * Build the progress marker from canonical state, or null when there is no
 * enrolled progression to read. Null is a real answer — a candidate learner has
 * no unlocks — and the caller renders the honest empty hub rather than guessing.
 */
export function canonicalToolProgress(view: AcademyCurriculumView): PathProgress | null {
  if (view.state !== "enrolled" && view.state !== "completed") return null;

  const levels = view.modules.flatMap((m) => m.levels);
  if (levels.length === 0) return null;

  const completedOrders = levels.filter((l) => l.state === "completed").map((l) => l.order);
  const total = view.progress.totalLevels;
  const allCompleted = completedOrders.length >= total && total > 0;

  // The highest CONTIGUOUS completed prefix. A gap means the levels after it are
  // not really behind the learner, and treating them as passed would hand out a
  // tool the curriculum has not awarded.
  let contiguous = 0;
  const done = new Set(completedOrders);
  while (done.has(contiguous + 1)) contiguous += 1;

  return {
    // `scenario` is part of the existing marker shape. It is stamped `active`
    // because the resolver only reads currentLevel/allCompleted — but it is set
    // deliberately rather than left to a default, so nothing downstream can
    // mistake this for a fixture-selected scenario.
    scenario: "active",
    currentLevel: contiguous + 1,
    allCompleted,
    ...UNUSED_INSTRUMENTATION,
  };
}

/**
 * The Backend's tool verdict off a curriculum read, or null.
 *
 * One helper so the hub and the direct URL cannot pick it up differently. A
 * failed read, a candidate and an unavailable curriculum all resolve to null,
 * which locks every tool (TOOLS-AUTHORITY-DIVERGENCE-1).
 */
export function toolAccessOf(result: CurriculumViewResult): AcademyToolAccess | null {
  if (!result.ok) return null;
  const view = result.view;
  if (view.state !== "enrolled" && view.state !== "completed") return null;
  return view.toolAccess;
}
