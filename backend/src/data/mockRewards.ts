export type RewardStatus = "получено" | "доступно" | "заблокировано";

export type MockReward = {
  id: number;
  title: string;
  description: string;
  status: RewardStatus;
  relatedTaskId: number;
};

export const mockRewards: MockReward[] = [
  {
    id: 1,
    title: "Очки опыта",
    description: "Начисляются за регистрацию, практику и прохождение этапов.",
    status: "получено",
    relatedTaskId: 1,
  },
  {
    id: 2,
    title: "Обучающий урок",
    description: "Открывается после базового обучения.",
    status: "получено",
    relatedTaskId: 2,
  },
  {
    id: 3,
    title: "Гайд / чек-лист",
    description: "Помогает закрепить первые сделки на демо-счёте.",
    status: "получено",
    relatedTaskId: 3,
  },
  {
    id: 4,
    title: "Доступ в закрытый чат",
    description: "Следующая награда после проверки учебного депозита.",
    status: "доступно",
    relatedTaskId: 4,
  },
  {
    id: 5,
    title: "Консультация",
    description: "Связана с отчётом по 50 сделкам по стохастику.",
    status: "заблокировано",
    relatedTaskId: 5,
  },
  {
    id: 6,
    title: "Доступ в канал с аналитикой",
    description: "Открывается после практики сделок по новостям.",
    status: "заблокировано",
    relatedTaskId: 7,
  },
];
