import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { MarketAtlasHome } from "@/components/dashboard/homes/MarketAtlasHome";
import { SYNTHETIC_DASHBOARD } from "@/data/mock/synthetic-state";

export const metadata: Metadata = { title: "Концепт · Market Atlas" };

export default function MarketAtlasConcept() {
  return (
    <AppShell
      activeId="home"
      pageContext="Главная"
      userName="Артём"
      sidebarClassName="bg-base"
      mainClassName="bg-base"
    >
      <MarketAtlasHome state={SYNTHETIC_DASHBOARD} />
    </AppShell>
  );
}
