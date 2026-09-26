export type PostbackType =
  | "Registration"
  | "Email Confirmation"
  | "First Deposit"
  | "Re-deposit"
  | "Withdrawal"
  | "Commission"
  | "New Withdrawal"
  | "Canceled Withdrawal"
  | "Successful Withdrawal";

export type PostbackStatus = "получено" | "обработано" | "отклонено";

export type ExchangePostback = {
  id: number;
  type: PostbackType;
  date: string;
  amount: number;
  status: PostbackStatus;
  rawPayload: string;
};

export type ExchangeIntegration = {
  exchangeAccountId: string;
  referralLink: string;
  registrationStatus: boolean;
  emailConfirmed: boolean;
  firstDepositConfirmed: boolean;
  totalDeposits: number;
  totalWithdrawals: number;
  currentBalance: number;
  postbackHistory: ExchangePostback[];
};
