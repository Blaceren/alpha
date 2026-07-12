import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function TasksPage() {
  return (
    <SectionPlaceholder
      title="Задачи"
      purpose="Учёт единиц работы сотрудников по пользователям и кейсам."
      plannedFeatures={[
        "Списки: мои, команды, по пользователю, по кейсу",
        "Статусы и приоритеты",
        "Outcome и follow-up",
        "Локальные mock-мутации с audit",
      ]}
    />
  );
}
