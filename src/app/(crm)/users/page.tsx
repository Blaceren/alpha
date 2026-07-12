import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function UsersPage() {
  return (
    <SectionPlaceholder
      title="Пользователи"
      purpose="Рабочий реестр пользователей с поиском, фильтрами по 5 измерениям состояния и переходом в User 360."
      plannedFeatures={[
        "Плотная конфигурируемая таблица (TanStack Table)",
        "Фильтры: lifecycle, funding, engagement, value, blockers",
        "Saved views и конфигурация колонок",
        "Маскирование финансов по роли (бакеты)",
        "Курсорная пагинация через CrmDataProvider",
        "Переход в карточку User 360",
      ]}
    />
  );
}
