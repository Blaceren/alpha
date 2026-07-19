import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { ToolsHub } from "@/features/tools/components/tools-hub";
import { resolvePathScenario } from "@/features/path/model/path-state";
import "@/features/tools/tools.css";

export const metadata: Metadata = {
  title: "Инструменты — Alfa Trade Academy",
  description:
    "Личные browser-local инструменты дисциплины: текущий рабочий инструмент, открытые по прогрессу и следующие в последовательности.",
};

/**
 * Инструменты (/tools) — the Tools Hub (Phase D4-B), direction «Structured
 * Operational Spine» (DD-308): a wide operational ledger of the whole tool
 * progression, not a marketplace of cards.
 *
 * `?scenario=` is the SAME development-and-test marker adapter the Path reads
 * (DD-273): it seeds a deterministic progress marker and is never produced by a
 * user-facing link. Unknown → the canonical marker (Артём, L18). Tool unlock is
 * derived from that marker by the canonical resolver — the hub never re-decides
 * a lock.
 */
export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawScenario = params.scenario;
  const scenario = resolvePathScenario(Array.isArray(rawScenario) ? rawScenario[0] : rawScenario);

  return (
    <AppShell userName="Артём" activeId="tools">
      <ToolsHub scenario={scenario} />
    </AppShell>
  );
}
