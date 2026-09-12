import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function SettingsPage() {
  return (
    <SectionPlaceholder
      title="Настройки"
      purpose="Конфигурация CRM, роли (mock) и профиль сотрудника."
      plannedFeatures={[
        "Профиль и timezone",
        "Роль (mock RBAC, не production)",
        "Управление saved views",
        "Density и тема",
      ]}
    />
  );
}
