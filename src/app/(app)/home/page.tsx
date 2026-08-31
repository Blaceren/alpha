import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { HomeScreen } from "@/features/home/home-screen";
import { resolveScenario } from "@/domain/home";
import { getAcademyConfig } from "@/config/academy-config";
import { AuthHomeScreen } from "@/features/auth-home-fidelity/auth-home-screen";
import { shellViewerName } from "@/server/auth/server-session";

export const metadata: Metadata = {
  title: "Главная — Alfa Trade Academy",
  description: "Твой путь обучения: текущий шаг и контрольная точка.",
};

/**
 * Главная (Route Field Home) — AUTHENTICATED HOME, now served at `/home`.
 *
 * UNIFIED-DESIGN-V1 moved this surface from `/` to `/home` so that `/` can
 * become the Public Home. NOTHING about its data authority changed: it is the
 * same component, reading the same server-authoritative curriculum/progression
 * through the same BFF. Only the path it answers on is different, and it stays
 * inside the `(app)` route group, so it is still guarded by the same layout.
 *
 * Default scenario is Active Lesson. A deterministic dev/Playwright scenario can
 * be selected with ?scenario=active|checkpoint — this is a mock adapter only:
 * not shown to the user, no debug panel, no domain contract. Unknown values
 * safely fall back to active. That branch is unreachable while ACADEMY_MODE=api.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  // API mode renders server-authoritative curriculum/progression; fixture mode
  // keeps the existing local prototype behaviour unchanged.
  if (getAcademyConfig().mode === "api") {
    return <AuthHomeScreen />;
  }
  const { scenario } = await searchParams;
  return (
    <AppShell userName={await shellViewerName()} activeId="home">
      <HomeScreen scenario={resolveScenario(scenario)} />
    </AppShell>
  );
}
