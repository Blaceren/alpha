import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function AnalyticsPage() {
  return (
    <SectionPlaceholder
      title="Аналитика"
      purpose="Продуктовые метрики и воронки (агрегированные данные)."
      plannedFeatures={[
        "Retained Funded Progressing Users",
        "Checkpoint completion, reactivation",
        "Только агрегаты, без сырого PII",
      ]}
    />
  );
}
