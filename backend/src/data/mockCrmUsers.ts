export type MockCrmUser = {
  id: number;
  name: string;
  email: string;
  level: number;
  currentStep: string;
  exchangeStatus: string;
  depositStatus: string;
  balance: number;
  lastActiveAt: string;
  cohort: string;
  status?: string;
  xp?: number;
  registrationStatus?: boolean;
  emailConfirmed?: boolean;
  firstDepositConfirmed?: boolean;
  traderId?: string | null;
  clickId?: string | null;
  totalDeposits?: number;
  totalWithdrawals?: number;
  totalCommission?: number;
  checkpointStatus?: string;
  checkpointBalance?: number;
  attribution?: Record<string, string>;
  postbackEvents?: Array<{ id: number; eventType: string; amount: number | null; currency: string | null; status: string; createdAt: string }>;
  referralSummary?: { invited: number; invitedByUserId: number | null };
};

export const mockCrmUsers: MockCrmUser[] = [
  {
    id: 1,
    name: "Алекс Кюри",
    email: "alex@example.com",
    level: 2,
    currentStep: "Пополнение баланса на бирже",
    exchangeStatus: "зарегистрирован",
    depositStatus: "не подтверждён",
    balance: 0,
    lastActiveAt: "2026-06-27",
    cohort: "registered-no-deposit",
  },
  {
    id: 2,
    name: "Марина Волкова",
    email: "marina@example.com",
    level: 3,
    currentStep: "50 сделок по стохастику + отчёт",
    exchangeStatus: "подключён",
    depositStatus: "первый депозит подтверждён",
    balance: 1200,
    lastActiveAt: "2026-06-26",
    cohort: "deposit-no-checkpoint",
  },
  {
    id: 3,
    name: "Илья Смирнов",
    email: "ilya@example.com",
    level: 4,
    currentStep: "Контрольная точка: баланс ≥ $2000",
    exchangeStatus: "подключён",
    depositStatus: "подтверждён",
    balance: 1500,
    lastActiveAt: "2026-06-25",
    cohort: "stuck-checkpoint",
  },
  {
    id: 4,
    name: "Ольга Романова",
    email: "olga@example.com",
    level: 1,
    currentStep: "Базовое обучение",
    exchangeStatus: "не подключён",
    depositStatus: "нет депозита",
    balance: 0,
    lastActiveAt: "2026-06-01",
    cohort: "inactive",
  },
  {
    id: 5,
    name: "Денис Карпов",
    email: "denis@example.com",
    level: 5,
    currentStep: "50 сделок по Боллинджеру + отчёт",
    exchangeStatus: "подключён",
    depositStatus: "подтверждён",
    balance: 2600,
    lastActiveAt: "2026-06-27",
    cohort: "active",
  },
  {
    id: 6,
    name: "Екатерина Ли",
    email: "katya@example.com",
    level: 2,
    currentStep: "Контрольная точка: баланс ≥ $2000",
    exchangeStatus: "подключён",
    depositStatus: "подтверждён",
    balance: 1400,
    lastActiveAt: "2026-06-24",
    cohort: "frozen",
  },
];
