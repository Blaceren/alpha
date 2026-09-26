export type SupportDialogStatus =
  | "новый"
  | "в работе"
  | "ожидает ответа пользователя"
  | "закрыт";

export type SupportDialog = {
  id: number;
  userName: string;
  userLevel: number;
  currentStep: string;
  status: SupportDialogStatus;
  assignedTo: string;
  lastMessage: string;
  lastMessageAt: string;
  internalNote?: string;
};

export const supportDialogStatuses: SupportDialogStatus[] = [
  "новый",
  "в работе",
  "ожидает ответа пользователя",
  "закрыт",
];

export const mockSupportDialogs: SupportDialog[] = [
  {
    id: 1,
    userName: "Алекс Кюри",
    userLevel: 2,
    currentStep: "Пополнение баланса на бирже",
    status: "новый",
    assignedTo: "Ментор Ирина",
    lastMessage: "Не понимаю, что делать, если аккаунт уже есть.",
    lastMessageAt: "2026-06-27 12:20",
  },
  {
    id: 2,
    userName: "Марина Волкова",
    userLevel: 3,
    currentStep: "50 сделок по стохастику + отчёт",
    status: "в работе",
    assignedTo: "Саппорт Антон",
    lastMessage: "Отчёт загрузила, нужна проверка.",
    lastMessageAt: "2026-06-27 12:05",
  },
  {
    id: 3,
    userName: "Илья Смирнов",
    userLevel: 4,
    currentStep: "Контрольная точка: баланс ≥ $2000",
    status: "ожидает ответа пользователя",
    assignedTo: "Ментор Олег",
    lastMessage: "Попросили прислать актуальный баланс.",
    lastMessageAt: "2026-06-26 18:40",
  },
  {
    id: 4,
    userName: "Ольга Романова",
    userLevel: 1,
    currentStep: "Базовое обучение",
    status: "закрыт",
    assignedTo: "Саппорт Антон",
    lastMessage: "Вопрос по доступу к уроку решён.",
    lastMessageAt: "2026-06-25 15:10",
  },
  {
    id: 5,
    userName: "Екатерина Ли",
    userLevel: 2,
    currentStep: "Контрольная точка: баланс ≥ $2000",
    status: "в работе",
    assignedTo: "Ментор Ирина",
    lastMessage: "Прогресс заморожен, нужен план восстановления.",
    lastMessageAt: "2026-06-27 09:30",
  },
];
