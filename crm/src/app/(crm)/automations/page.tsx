import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function AutomationsPage() {
  return (
    <SectionPlaceholder
      title="Автоматизации"
      purpose="Просмотр правил автоматизаций и их срабатываний (runs)."
      plannedFeatures={[
        "Правила: trigger/conditions/cooldown",
        "История срабатываний (runs)",
        "Объяснимые действия с audit",
      ]}
    />
  );
}
