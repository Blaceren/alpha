import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function SupportPage() {
  return (
    <SectionPlaceholder
      title="Support"
      purpose="Очередь обращений и блокеров поддержки."
      plannedFeatures={[
        "Очередь по приоритету и SLA",
        "Ограниченный контекст пользователя",
        "Эскалация в кейс",
      ]}
    />
  );
}
