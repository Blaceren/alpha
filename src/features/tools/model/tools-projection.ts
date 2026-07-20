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
 * `available` = unlocked AND the tool's surface is actually built. A tool can be
 * unlocked-but-unimplemented: honestly "открыт по прогрессу · инструмент
 * готовится", with NO active CTA into empty functionality. As of D4-C both the
 * Trading Journal (L10) and the Risk Calculator (L15) are available for Артём.
 */

import {
  TOOL_DEFINITIONS,
  type ToolDefinition,
} from "@/features/tools/model/tool-catalog";
import {
  levelProgressState,
  type PathProgress,
} from "@/features/path/model/path-state";

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
  /** Text status — state is never conveyed by colour alone. */
  statusLabel: string;
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
export function isToolUnlocked(tool: ToolDefinition, progress: PathProgress): boolean {
  // A tool is a reward for PASSING its checkpoint: the level must read
  // "completed", not "current" (still standing on the gate) or "available".
  return levelProgressState(tool.unlockLevel, progress) === "completed";
}

function statusLabelFor(
  unlocked: boolean,
  available: boolean,
  unlockLevel: number,
): string {
  if (!unlocked) return `Откроется на уровне ${unlockLevel}`;
  if (available) return "Открыт · рабочий инструмент";
  // Unlocked, but the surface is not built — honest, and no CTA anywhere.
  return "Открыт по прогрессу · инструмент готовится";
}

/**
 * Project all tools for the hub. The `current` flag marks the single featured
 * working tool: the AVAILABLE tool with the greatest unlock level (the most
 * recently earned one the user can actually use). For Артём (L18) that is
 * Trading Journal — Risk Calculator is unlocked but not available.
 */
export function projectTools(progress: PathProgress): ToolView[] {
  const views = TOOL_DEFINITIONS.map((tool): Omit<ToolView, "current"> => {
    const unlocked = isToolUnlocked(tool, progress);
    const available = unlocked && tool.implementationStatus === "available";
    return {
      id: tool.id,
      code: tool.code,
      title: tool.title,
      description: tool.description,
      unlockLevel: tool.unlockLevel,
      unlocked,
      available,
      href: available ? toolHref(tool.code) : null,
      statusLabel: statusLabelFor(unlocked, available, tool.unlockLevel),
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

/** The resolved view of ONE tool, for the surface route. Null when unknown. */
export function projectTool(code: string, progress: PathProgress): ToolView | null {
  return projectTools(progress).find((view) => view.code === code) ?? null;
}
