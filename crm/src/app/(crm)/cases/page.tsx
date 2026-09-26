import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function CasesPage() {
  return (
    <SectionPlaceholder
      title="Кейсы"
      purpose="Контейнер сложной ситуации: задачи, заметки, таймлайн и SLA."
      plannedFeatures={[
        "Типы кейсов и SLA",
        "Связка tasks/notes/timeline",
        "Закрытие с reason и outcome",
      ]}
    />
  );
}
