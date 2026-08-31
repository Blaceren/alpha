import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { ToolSurface } from "@/features/tools/components/tool-surface";
import { ToolFidelitySurface } from "@/features/tools-fidelity/tool-fidelity-surface";
import { resolvePathScenario } from "@/features/path/model/path-state";
import { getAcademyConfig } from "@/config/academy-config";
import { getServerViewer } from "@/server/auth/server-session";
import { shellViewerName } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { canonicalToolProgress, toolAccessOf } from "@/features/tools/model/canonical-progress";
import "@/features/tools/tools.css";

export const metadata: Metadata = {
  title: "Инструмент — Alfa Trade Academy",
  description: "Личный browser-local инструмент дисциплины.",
};

/**
 * Инструмент (/tools/[toolCode]) — one tool surface (Phase D4-B).
 * `[toolCode]` is the canonical curriculum tool code (tool.trading_journal …),
 * the same code-as-address convention the lesson route uses for `level.NNN`.
 *
 * The surface DISPATCHES on the resolved tool view, never on a raw query:
 *   - unknown code → the existing not-found convention (no generic crash);
 *   - locked       → a locked state with target level, no form, no data;
 *   - unlocked but not implemented (Risk Calculator) → a calm coming-soon state;
 *   - available (Trading Journal) → the full workspace.
 *
 * `?scenario=` is the development-and-test marker adapter only; unknown → the
 * canonical marker. It never appears in a user-facing href.
 */
export default async function ToolSurfacePage({
  params,
  searchParams,
}: {
  params: Promise<{ toolCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { toolCode } = await params;

  /* API MODE READS CANONICAL PROGRESS — AND USED NOT TO.
     The hub was moved onto canonical progress and the real viewer; this page
     was not, so it still resolved every lock from the fixture marker whose
     default is «Артём, L18» and rendered that name in the shell. A learner
     standing on level 12 could open a tool their own progression has not
     awarded, and see somebody else's name above it. Same resolver, same
     catalogue, same unlock rule — only the marker and the viewer are now real. */
  if (getAcademyConfig().mode === "api") {
    const [viewer, result] = await Promise.all([getServerViewer(), getCurriculumView()]);
    const progress = result.ok ? canonicalToolProgress(result.view) : null;
    const access = toolAccessOf(result);
    return (
      <AppShell userName={viewer?.name ?? "Ученик"} activeId="tools" frozenSurface notificationPresence={<UnreadPresence />}>
        <ToolFidelitySurface toolCode={toolCode} progress={progress} access={access} />
      </AppShell>
    );
  }

  const sp = await searchParams;
  const rawScenario = sp.scenario;
  const scenario = resolvePathScenario(Array.isArray(rawScenario) ? rawScenario[0] : rawScenario);

  return (
    <AppShell userName={await shellViewerName()} activeId="tools" notificationPresence={<UnreadPresence />}>
      <ToolSurface toolCode={toolCode} scenario={scenario} />
    </AppShell>
  );
}
