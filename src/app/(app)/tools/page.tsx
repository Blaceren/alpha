import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { ToolsHub } from "@/features/tools/components/tools-hub";
import { ToolsRegister } from "@/features/tools-fidelity/tools-fidelity";
import { projectTools } from "@/features/tools/model/tools-projection";
import { resolvePathScenario } from "@/features/path/model/path-state";
import { getAcademyConfig } from "@/config/academy-config";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { canonicalToolProgress } from "@/features/tools/model/canonical-progress";
import "@/features/tools/tools.css";

export const metadata: Metadata = {
  title: "Инструменты — Alfa Trade Academy",
  description:
    "Личные browser-local инструменты дисциплины: текущий рабочий инструмент, открытые по прогрессу и следующие в последовательности.",
};

/**
 * Инструменты (/tools) — the Tools Hub, direction «Structured Operational
 * Spine» (DD-308): a wide operational ledger of the whole tool progression.
 *
 * API MODE READS CANONICAL PROGRESS. This page used to render the hub from
 * `?scenario=` with a hardcoded «Артём» in the shell, in every mode. On PREPROD
 * that showed a real learner somebody else's name and somebody else's unlocks —
 * fixture data acting as production authority. In api mode the viewer and the
 * progress marker now both come from the server; the fixture scenario path is
 * untouched for local development.
 *
 * Tool unlock is still derived by the canonical resolver. The hub never
 * re-decides a lock.
 */
export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (getAcademyConfig().mode === "api") {
    const [viewer, result] = await Promise.all([getServerViewer(), getCurriculumView()]);
    const progress = result.ok ? canonicalToolProgress(result.view) : null;
    /* No enrolled progression means no unlocks — an honest empty register, not
       a guess. `projectTools` still owns every lock decision; the register only
       renders what it returns. */
    return (
      <AppShell userName={viewer?.name ?? "Ученик"} activeId="tools" frozenSurface>
        <ToolsRegister tools={progress ? projectTools(progress) : []} />
      </AppShell>
    );
  }

  const params = await searchParams;
  const rawScenario = params.scenario;
  const scenario = resolvePathScenario(Array.isArray(rawScenario) ? rawScenario[0] : rawScenario);

  return (
    <AppShell userName="Артём" activeId="tools">
      <ToolsHub scenario={scenario} />
    </AppShell>
  );
}
