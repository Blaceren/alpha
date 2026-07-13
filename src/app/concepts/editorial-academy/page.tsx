import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { EditorialAcademyHome } from "@/components/dashboard/homes/EditorialAcademyHome";
import { SYNTHETIC_DASHBOARD } from "@/data/mock/synthetic-state";

export const metadata: Metadata = { title: "Концепт · Editorial Academy" };

export default function EditorialAcademyConcept() {
  return (
    <AppShell activeId="home" pageContext="Главная" userName="Артём">
      <EditorialAcademyHome state={SYNTHETIC_DASHBOARD} />
    </AppShell>
  );
}
