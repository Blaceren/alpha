import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function User360Page({ params }: { params: { id: string } }) {
  return (
    <SectionPlaceholder
      title={`User 360 · ${params.id}`}
      purpose="Полная карточка пользователя: состояние (5 измерений), прогресс, финансы, единый таймлайн и операции."
      plannedFeatures={[
        "Header с пятью бейджами состояния",
        "Progression, Learning, Financial (с freshness)",
        "Единый Timeline из всех источников",
        "Operations-панель: signals, tasks, notes",
        "PII Reveal-flow для разрешённых ролей",
        "Данные строго через CrmDataProvider",
      ]}
    />
  );
}
