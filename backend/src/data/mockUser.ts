export type ProgressStepStatus = "completed" | "active" | "locked" | "frozen";

export type ProgressStep = {
  id: number;
  title: string;
  status: ProgressStepStatus;
};

export type RewardHistoryItem = {
  id: number;
  title: string;
  receivedAt: string;
  status: "получено" | "доступно" | "заблокировано";
};

export type ReferralUser = {
  id: number;
  name: string;
  level: number;
  earnedXp: number;
};

export const mockUser = {
  id: "user-1001",
  name: "Алекс",
  email: "alex@example.com",
  level: 6,
  xp: {
    current: 420,
    target: 500,
  },
  currentTask: "Сделать первый депозит",
  nextReward: "Доступ в закрытый чат",
  exchangeStatus: "Демо-биржа подключена",
  freezeStatus: "Прогресс не заморожен",
  rewardHistory: [
    {
      id: 1,
      title: "Очки опыта",
      receivedAt: "2026-06-20",
      status: "получено",
    },
    {
      id: 2,
      title: "Обучающий урок",
      receivedAt: "2026-06-21",
      status: "получено",
    },
    {
      id: 3,
      title: "Гайд / чек-лист",
      receivedAt: "2026-06-22",
      status: "получено",
    },
  ] satisfies RewardHistoryItem[],
  referrals: {
    link: "https://example.local/ref/alex",
    invitedCount: 3,
    earnedXp: 180,
    users: [
      {
        id: 1,
        name: "Марина",
        level: 2,
        earnedXp: 80,
      },
      {
        id: 2,
        name: "Игорь",
        level: 1,
        earnedXp: 40,
      },
      {
        id: 3,
        name: "Сергей",
        level: 3,
        earnedXp: 60,
      },
    ] satisfies ReferralUser[],
  },
  exchange: {
    account: "демо",
    depositConfirmed: false,
    balance: 1250,
    currency: "USD",
  },
  notifications: {
    email: true,
    webPush: false,
    telegramBot: false,
  },
  progressSteps: [
    {
      id: 1,
      title: "Регистрация на сайте",
      status: "completed",
    },
    {
      id: 2,
      title: "Базовое обучение",
      status: "completed",
    },
    {
      id: 3,
      title: "Несколько сделок на демо-счёте",
      status: "completed",
    },
    {
      id: 4,
      title: "Пополнение баланса на бирже",
      status: "active",
    },
    {
      id: 5,
      title: "50 сделок по стохастику + отчёт",
      status: "locked",
    },
    {
      id: 6,
      title: "50 сделок по Боллинджеру + отчёт",
      status: "locked",
    },
    {
      id: 7,
      title: "5 сделок по новостям + отчёт",
      status: "locked",
    },
    {
      id: 8,
      title: "Контрольная точка: баланс ≥ $2000",
      status: "frozen",
    },
  ] satisfies ProgressStep[],
};
