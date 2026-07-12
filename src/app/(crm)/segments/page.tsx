import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function SegmentsPage() {
  return (
    <SectionPlaceholder
      title="Сегменты"
      purpose="Системные и сохранённые выборки пользователей для retention- и аналитической работы."
      plannedFeatures={[
        "Системные сегменты по состояниям и сигналам",
        "Сохранённые пользовательские сегменты",
        "Счётчики состава с freshness",
        "Переход к составу (переиспользует таблицу Users)",
      ]}
    />
  );
}
