import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function CommunicationsPage() {
  return (
    <SectionPlaceholder
      title="Коммуникации"
      purpose="История коммуникаций и контроль перегрузки (communication fatigue)."
      plannedFeatures={[
        "История отправленных коммуникаций",
        "Лимиты частоты и suppression",
        "Связь с автоматизациями",
      ]}
    />
  );
}
