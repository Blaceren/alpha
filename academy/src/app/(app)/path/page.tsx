import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { PathWorkspace } from "@/features/path/components/path-workspace";
import { resolvePathScenario } from "@/features/path/model/path-state";
import { getAcademyConfig } from "@/config/academy-config";
import { PathFidelityScreen } from "@/features/path-fidelity/path-fidelity-screen";
import "@/features/path/path.css";
import { shellViewerName } from "@/server/auth/server-session";

export const metadata: Metadata = {
  title: "Путь — Alfa Trade Academy",
  description: "Маршрут обучения: 20 модулей, 100 уровней, контрольные точки и инструменты.",
};

/**
 * Путь (/path) — the explorable learning route. Deterministic dev scenarios via
 * ?scenario=active|checkpoint|early|advanced|completed (unknown → active; the
 * query is a development adapter, never shown in the UI).
 */
export default async function PathPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; module?: string }>;
}) {
  const params = await searchParams;
  if (getAcademyConfig().mode === "api") {
    /* API MODE IS THE PRODUCT. `?module=` is gone with `ExperiencePath`: the
       frozen Path shows the module the learner is actually in, chosen from
       canonical progress, and a query parameter that moved the focus elsewhere
       would be a second authority over "where am I". Browsing other modules is
       the Lessons Index's job. */
    return <PathFidelityScreen />;
  }
  const { scenario } = params;
  return (
    <AppShell userName={await shellViewerName()} activeId="path">
      <PathWorkspace scenario={resolvePathScenario(scenario)} />
    </AppShell>
  );
}
