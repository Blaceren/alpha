import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { ToolsHub } from "@/features/tool-windows/components/tools-hub";
import { fixtureToolAccess, resolveToolWindows, toolAccessOf, toolReadFailed } from "@/features/tool-windows/model/access";
import { resolvePathScenario } from "@/features/path/model/path-state";
import { getAcademyConfig } from "@/config/academy-config";
import { getServerViewer, shellViewerName } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import "@/features/tool-windows/tool-windows.css";
import "@/features/tool-windows/tools-hifi.css";

export const metadata: Metadata = {
  title: "Инструменты — Alpha Trade Academy",
  description: "Рабочие инструменты Академии: план сделки, журнал, расчёт риска, чек-лист входа, статистика и новости.",
};

/**
 * Инструменты (/tools) — the six tools of TOOLS-V2, in the order they open.
 *
 * API MODE READS THE BACKEND'S VERDICT. The viewer and the tool access both
 * come from the server; a failed read locks every tool rather than guessing
 * (TOOLS-AUTHORITY-DIVERGENCE-1). Fixture mode keeps its scenario marker for
 * local development, and states its unlocks literally.
 *
 * Each open tool links to its own page, /tools/<slug>, in the SAME tab (owner
 * decision 2026-09-21), and every tool page leads back here.
 *
 * `frozenSurface`: the page carries its own container geometry and paints the
 * flat Ink field the product's other pages use; the shell's older decorative
 * wash is not shown behind it.
 */
export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (getAcademyConfig().mode === "api") {
    const [viewer, result] = await Promise.all([getServerViewer(), getCurriculumView()]);
    return (
      <AppShell userName={viewer?.name ?? "Ученик"} activeId="tools" frozenSurface notificationPresence={<UnreadPresence />}>
        <ToolsHub tools={resolveToolWindows(toolAccessOf(result))} readFailed={toolReadFailed(result)} />
      </AppShell>
    );
  }

  const params = await searchParams;
  const rawScenario = params.scenario;
  const scenario = resolvePathScenario(Array.isArray(rawScenario) ? rawScenario[0] : rawScenario);

  return (
    <AppShell userName={await shellViewerName()} activeId="tools" frozenSurface notificationPresence={<UnreadPresence />}>
      <ToolsHub tools={resolveToolWindows(fixtureToolAccess(scenario))} />
    </AppShell>
  );
}
