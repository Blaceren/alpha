import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { ProductPortalHome } from "@/components/dashboard/homes/ProductPortalHome";
import { SYNTHETIC_DASHBOARD } from "@/data/mock/synthetic-state";

export const metadata: Metadata = { title: "Концепт · Product Portal" };

export default function ProductPortalConcept() {
  return (
    <AppShell activeId="home" pageContext="Главная" userName="Артём">
      <ProductPortalHome state={SYNTHETIC_DASHBOARD} />
    </AppShell>
  );
}
