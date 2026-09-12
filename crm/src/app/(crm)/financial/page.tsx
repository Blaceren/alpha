import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function FinancialPage() {
  return (
    <SectionPlaceholder
      title="Финансы"
      purpose="Операционный обзор checkpoint-состояний и производных Pocket-данных."
      plannedFeatures={[
        "Checkpoint approaching/grace",
        "Suspended/restored и data conflicts",
        "Агрегаты Net/Gross/Redeposit",
        "Точные суммы только для разрешённых ролей",
      ]}
    />
  );
}
