import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { PathWorkspace } from "@/features/path/components/path-workspace";
import { resolvePathScenario } from "@/features/path/model/path-state";
import { getAcademyConfig } from "@/config/academy-config";
import { ApiPath } from "@/features/curriculum-api/api-screens";
import "@/features/path/path.css";

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
  searchParams: Promise<{ scenario?: string }>;
}) {
  if (getAcademyConfig().mode === "api") {
    return <ApiPath />;
  }
  const { scenario } = await searchParams;
  return (
    <AppShell userName="Артём" activeId="path">
      <PathWorkspace scenario={resolvePathScenario(scenario)} />
    </AppShell>
  );
}
