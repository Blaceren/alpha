import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function AuditPage() {
  return (
    <SectionPlaceholder
      title="Audit"
      purpose="Неизменяемый журнал действий сотрудников и системы."
      plannedFeatures={[
        "Глобальный журнал с фильтрами",
        "Actor/action/entity/before-after",
        "Audit-preview в User 360",
      ]}
    />
  );
}
