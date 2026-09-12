/**
 * Tools presentation projector (Phase D4-B).
 *
 * Turns the tool catalog + the shared progress marker into a ready-to-render
 * list. Unlock is decided in exactly ONE place: the canonical progression
 * resolver `levelProgressState` from `path-state.ts` — the same authority Home,
 * Path and the lessons library read. A tool is unlocked when its checkpoint
 * level is COMPLETED (passed), never when the user is merely standing on it.
 *
 * React never re-decides any of this: no component compares `currentLevel`, no
 * component hardcodes L10/L15, no component reads a URL query to bypass a lock
 * (DD-308). Components receive `ToolView`s and render them.
 *
 * `available` = unlocked AND the tool's surface is actually built. Only the
 * Trading Journal (L10) and the Risk Calculator (L15) are built in this
 * release; the other seventeen are catalogue entries with NO active CTA into
 * empty functionality.
 *
 * `projectTools` returns ALL nineteen — the catalogue is the catalogue, and the
 * direct route resolves against it unchanged. What a learner is SHOWN is a
 * separate question, answered by `learnerCatalog` below.
 */

import {
  TOOL_DEFINITIONS,
  type ToolDefinition,
} from "@/features/tools/model/tool-catalog";
import {
  levelProgressState,
  type PathProgress,
} from "@/features/path/model/path-state";
import type { AcademyToolAccess } from "@/lib/curriculum/academy-view";

export interface ToolView {
  id: string;
  code: string;
  title: string;
  description: string;
  unlockLevel: number;
  /** Resolver says the checkpoint level is passed. */
  unlocked: boolean;
  /** Unlocked AND the surface exists — the only state that gets a working route. */
  available: boolean;
  /** The featured working tool of the hub (the highest-level available one). */
  current: boolean;
  /** Working route, or null when there is nothing honest to open. */
  href: string | null;
  /** Whether the tool's working surface exists in this build at all. */
  implemented: boolean;
  /**
   * PRODUCT READINESS. For an unbuilt tool this says so at every level, because
   * a learner deciding what to work towards is owed that before the gate, not
   * after it.
   */
  statusLabel: string;
  /**
   * LEARNER PROGRESS — the other, independent dimension. Present only where the
   * two can disagree: a tool that is built says everything it needs to in
   * `statusLabel`, and a second line there would just repeat it.
   */
  requirementLabel: string | null;
  /** Tool-specific CTA copy, rendered only when the tool is available. */
  ctaLabel: string;
}

/** Canonical hub href of a tool surface. Only ever built for available tools. */
export function toolHref(code: string): string {
  return `/tools/${code}`;
}

/**
 * Whether a tool is unlocked under the given progress, via the canonical
 * resolver. Exported so tests can pin the resolver-owned rule without reaching
 * into a component.
 */
/**
 * The Academy's historical derivation — NO LONGER AN AUTHORITY.
 *
 * Kept exported for one reason: the truth matrix compares it against the
 * Backend verdict, and a rule you have deleted is a rule you can no longer
 * prove you stopped using. Nothing in this module calls it.
 */
export function isToolUnlockedByLocalJoin(tool: ToolDefinition, progress: PathProgress): boolean {
  // A tool is a reward for PASSING its checkpoint: the level must read
  // "completed", not "current" (still standing on the gate) or "available".
  return levelProgressState(tool.unlockLevel, progress) === "completed";
}

/**
 * TWO DIMENSIONS, NOT ONE LADDER.
 *
 * A row used to answer only "how far away is this?", so seventeen tools that do
 * not exist told a learner at level 2 that they would open at level 20. That is
 * a promise the build cannot keep, and the learner had no way to know until
 * they arrived.
 *
 * Product readiness and learner progress are independent, so they are stated
 * independently: an unbuilt tool says «В разработке» at every level and never
 * «Откроется», and its progression requirement — met or not met — is a separate,
 * secondary line. A built tool has only one thing to say and keeps saying it.
 */
function statusLabelFor(implemented: boolean, unlocked: boolean, unlockLevel: number): string {
  if (!implemented) return "В разработке";
  if (!unlocked) return `Откроется на уровне ${unlockLevel}`;
  return "Открыт · рабочий инструмент";
}

function requirementLabelFor(implemented: boolean, unlocked: boolean, unlockLevel: number): string | null {
  if (implemented) return null;
  return unlocked ? "Требование доступа выполнено" : `Требование доступа: уровень ${unlockLevel}`;
}

/**
 * Project all tools for the hub. The `current` flag marks the single featured
 * working tool: the AVAILABLE tool with the greatest unlock level (the most
 * recently earned one the user can actually use). For Артём (L18) that is
 * Trading Journal — Risk Calculator is unlocked but not available.
 */
export function projectTools(
  progress: PathProgress,
  access: AcademyToolAccess | null,
): ToolView[] {
  /* THE VERDICT IS THE BACKEND'S, AND NOTHING ELSE DECIDES.
     `progress` is still here because the surface reads rank, XP and the
     featured-tool ordering from it — but it no longer decides access.

     A null verdict locks everything: absent field, malformed payload,
     duplicate code, unreachable Backend. A tool this map does not mention is
     locked for the same reason, since an unknown code is an answer nobody gave
     (TOOLS-AUTHORITY-DIVERGENCE-1). */
  const verdict = new Map<string, boolean>();
  for (const entry of access?.tools ?? []) verdict.set(entry.code, entry.unlocked);

  const views = TOOL_DEFINITIONS.map((tool): Omit<ToolView, "current"> => {
    const unlocked = verdict.get(tool.id) === true;
    const implemented = tool.implementationStatus === "available";
    const available = unlocked && implemented;
    return {
      id: tool.id,
      code: tool.code,
      title: tool.title,
      description: tool.description,
      unlockLevel: tool.unlockLevel,
      unlocked,
      available,
      implemented,
      href: available ? toolHref(tool.code) : null,
      statusLabel: statusLabelFor(implemented, unlocked, tool.unlockLevel),
      requirementLabel: requirementLabelFor(implemented, unlocked, tool.unlockLevel),
      ctaLabel: tool.ctaLabel,
    };
  });

  // The featured tool: the highest-level available one. Undefined when none is
  // available yet (an early user), which is a legitimate, honest hub state.
  let currentCode: string | null = null;
  let currentLevel = -1;
  for (const view of views) {
    if (view.available && view.unlockLevel > currentLevel) {
      currentLevel = view.unlockLevel;
      currentCode = view.code;
    }
  }

  return views.map((view) => ({ ...view, current: view.code === currentCode }));
}

/**
 * THE LEARNER CATALOGUE — what a person is shown, as opposed to what exists.
 *
 * The register listed all nineteen catalogue entries, so seventeen tools that
 * have no working surface occupied the screen and told the learner which level
 * would open them. Two of those nineteen are built. A catalogue that is 89%
 * announcements is not a catalogue of tools; it is a roadmap wearing one.
 *
 * WHAT THIS FILTERS ON, AND WHAT IT DOES NOT. Only `implemented`, which is
 * `implementationStatus` off the catalogue — the single declared answer to
 * "does this surface exist in this build". It is NOT derived from the unlock
 * level, the learner's progress, the row's position or any wording. Access is
 * untouched: a built tool that the Backend says is locked stays visible and
 * stays locked, because a tool you have not earned yet is still a real part of
 * the product you are working towards.
 *
 * WHAT THIS IS NOT. It is not a second unlock rule, and it is not applied to
 * `projectTool`: the direct route keeps resolving every catalogue code exactly
 * as it did, so a deep link to an unbuilt tool still reaches its own honest
 * state rather than a not-found page.
 */
export function learnerCatalog(views: ToolView[]): ToolView[] {
  return views.filter((view) => view.implemented);
}

/** The resolved view of ONE tool, for the surface route. Null when unknown. */
export function projectTool(
  code: string,
  progress: PathProgress,
  access: AcademyToolAccess | null,
): ToolView | null {
  // The hub and the direct URL resolve through the same call, so they cannot
  // disagree about whether a tool is open.
  return projectTools(progress, access).find((view) => view.code === code) ?? null;
}
