import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { HomeScreen } from "@/features/home/home-screen";
import { resolveScenario } from "@/domain/home";

export const metadata: Metadata = {
  title: "Главная — Alfa Trade Academy",
  description: "Твой путь обучения: текущий шаг и контрольная точка.",
};

/**
 * Главная (Route Field Home). Default scenario is Active Lesson. A deterministic
 * dev/Playwright scenario can be selected with ?scenario=active|checkpoint — this
 * is a mock adapter only: not shown to the user, no debug panel, no domain contract.
 * Unknown values safely fall back to active.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario } = await searchParams;
  return (
    <AppShell userName="Артём" activeId="home">
      <HomeScreen scenario={resolveScenario(scenario)} />
    </AppShell>
  );
}
