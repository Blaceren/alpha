/**
 * The six tools as ONE learner sees them — open, locked, or not built yet.
 *
 * THE VERDICT IS THE BACKEND'S. `toolAccess` arrives on the curriculum read and
 * this file only joins it to the catalogue. A tool the verdict does not mention
 * is locked, a null verdict (no enrollment, failed read, malformed payload)
 * locks everything, and no level arithmetic happens here: a learner standing
 * on level 40 with level 10 unfinished has no Trading Journal, and that is the
 * right answer (TOOLS-AUTHORITY-DIVERGENCE-1).
 */
import type { PathScenario } from "@/features/path/model/path-state";
import type { AcademyCurriculumView, AcademyToolAccess } from "@/lib/curriculum/academy-view";
import type { CurriculumViewResult } from "@/lib/curriculum/provider";
import { TOOL_WINDOWS, toolWindowHref, type ToolWindowDefinition } from "./catalog";

/**
 * `open`   — unlocked, and this build contains the window;
 * `locked` — the releasing level is not completed;
 * `soon`   — unlocked, but the window is not built yet. Said plainly rather
 *            than hidden: the learner has earned it and deserves to know.
 */
export type ToolWindowState = "open" | "locked" | "soon";

export interface ToolWindowView {
  readonly tool: ToolWindowDefinition;
  /** The Backend's level when it sent one; the catalogue's otherwise. */
  readonly unlockLevel: number;
  readonly state: ToolWindowState;
  readonly href: string;
}

export function resolveToolWindows(
  access: AcademyToolAccess | null,
  /** The catalogue; the real one everywhere but in the tests of a tool not built yet. */
  catalogue: readonly ToolWindowDefinition[] = TOOL_WINDOWS,
): ToolWindowView[] {
  const verdict = new Map((access?.tools ?? []).map((entry) => [entry.code, entry]));
  return catalogue.map((tool) => {
    const entry = verdict.get(tool.code);
    const unlocked = entry?.unlocked === true;
    return {
      tool,
      unlockLevel: entry?.unlockLevel ?? tool.unlockLevel,
      state: !unlocked ? "locked" : tool.built ? "open" : "soon",
      href: toolWindowHref(tool.slug),
    };
  });
}

export function resolveToolWindow(slug: string, access: AcademyToolAccess | null): ToolWindowView | null {
  return resolveToolWindows(access).find((view) => view.tool.slug === slug) ?? null;
}

/**
 * The Backend's verdict off a curriculum read, or null. A failed read, a
 * candidate and an unavailable curriculum all resolve to null, which locks
 * every tool. The hub and the tool page both call this, so they cannot pick the
 * verdict up differently.
 */
export function toolAccessOf(result: CurriculumViewResult): AcademyToolAccess | null {
  if (!result.ok) return null;
  const view = result.view;
  if (view.state !== "enrolled" && view.state !== "completed") return null;
  return view.toolAccess;
}

/**
 * Answers that are about the learner — not enrolled, no program published, the
 * section switched off, no access. Every other failed read is the Backend's
 * trouble.
 */
const ANSWERS_ABOUT_THE_LEARNER: ReadonlySet<string> = new Set([
  "NOT_ENROLLED",
  "NO_ACTIVE_CURRICULUM",
  "FEATURE_DISABLED",
  "FORBIDDEN",
  "UNAUTHENTICATED",
]);

/**
 * The read FAILED, as opposed to answering (2026-10-04, launch audit).
 *
 * A failed read still locks every tool — nothing is opened on a guess — but it
 * no longer SAYS «Закрыто · откроется после уровня 10/15/20…» with the
 * catalogue's old levels, as if the learner had fallen behind. The hub and the
 * tool page say the tools could not be loaded and offer a retry.
 */
export function toolReadFailed(result: CurriculumViewResult): boolean {
  if (result.ok) return false;
  return !ANSWERS_ABOUT_THE_LEARNER.has(String(result.error?.category));
}

/** The title of the level that releases a tool, for the locked page's sentence. */
export function levelTitleOf(view: AcademyCurriculumView, levelNumber: number): string | null {
  if (view.state === "unavailable") return null;
  const level = view.modules.flatMap((module) => module.levels).find((candidate) => candidate.order === levelNumber);
  return level?.title ?? null;
}

/**
 * The level whose completion releases a tool, as the learner's own program
 * has it — for the locked page's sentence, never for a decision.
 *
 * `kind` is what that level IS in this program: a checkpoint, an ordinary
 * lesson, or another kind of level (a report, a practical one). It is `unknown`
 * when the view does not say, and the caller then falls back to what the
 * catalogue remembers. The 100-level program releases five of the six tools at
 * checkpoints; the 30-level program has no checkpoint levels and releases them
 * after a lesson, a report and a practice — which is why the sentence can no
 * longer be read off the catalogue.
 */
export type ReleasingLevel = {
  readonly title: string | null;
  readonly kind: "checkpoint" | "lesson" | "level" | "unknown";
  /** The level is defined and not open yet, so the tool cannot be earned today. */
  readonly inProduction: boolean;
};

export function releasingLevelOf(view: AcademyCurriculumView, levelNumber: number): ReleasingLevel | null {
  if (view.state !== "enrolled" && view.state !== "completed") return null;
  const level = view.modules.flatMap((module) => module.levels).find((candidate) => candidate.order === levelNumber);
  if (!level) return null;
  const typeInfo = (level as { typeInfo?: { isCheckpoint?: unknown; type?: unknown } }).typeInfo;
  const kind: ReleasingLevel["kind"] = !typeInfo
    ? "unknown"
    : typeInfo.isCheckpoint === true
      ? "checkpoint"
      : level.kind === "lesson" || (level.kind == null && typeInfo.type === "lesson")
        ? "lesson"
        : "level";
  return { title: level.title ?? null, kind, inProduction: level.inProduction === true };
}

/**
 * The level the learner stands on: one past the highest CONTIGUOUS completed
 * level. Only said on a locked tool («сейчас L8»), never used to decide one.
 * Null when there is no enrolled progression to read.
 */
export function learnerCurrentLevel(view: AcademyCurriculumView): number | null {
  if (view.state !== "enrolled" && view.state !== "completed") return null;
  const done = new Set(
    view.modules.flatMap((module) => module.levels).filter((level) => level.state === "completed").map((level) => level.order),
  );
  let contiguous = 0;
  while (done.has(contiguous + 1)) contiguous += 1;
  return contiguous + 1;
}

/**
 * FIXTURE MODE ONLY. There is no Backend there, so each prototype scenario
 * STATES which tools are open, by code. The lists are literal on purpose:
 * computing them from the scenario's level would rebuild the local rule the
 * Backend verdict replaced.
 */
const FIXTURE_UNLOCKED: Record<PathScenario, readonly string[]> = {
  // Level 18: past L5, L10 and L15.
  active: ["tool.trade_card", "tool.trading_journal", "tool.risk_calculator"],
  // Level 20, standing ON the checkpoint, which does not open it.
  checkpoint: ["tool.trade_card", "tool.trading_journal", "tool.risk_calculator"],
  // Level 2: nothing earned yet.
  early: [],
  // Level 3.
  report: [],
  // Level 85 and the finished programme: the whole block.
  advanced: TOOL_WINDOWS.map((tool) => tool.code),
  completed: TOOL_WINDOWS.map((tool) => tool.code),
};

export function fixtureToolAccess(scenario: PathScenario): AcademyToolAccess {
  return toolAccessOpening(FIXTURE_UNLOCKED[scenario]);
}

/** A verdict that opens exactly the named codes. For fixture mode and tests. */
export function toolAccessOpening(codes: readonly string[]): AcademyToolAccess {
  const open = new Set(codes);
  const tools = TOOL_WINDOWS.map((tool) => ({
    code: tool.code,
    unlocked: open.has(tool.code),
    unlockLevel: tool.unlockLevel,
  }));
  return { total: tools.length, unlockedCount: tools.filter((tool) => tool.unlocked).length, tools };
}
