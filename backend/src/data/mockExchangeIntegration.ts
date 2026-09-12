import type { ExchangeIntegration } from "@/types/exchange";
import { mockPostbacks } from "@/data/mockPostbacks";

export const mockExchangeIntegration: ExchangeIntegration = {
  exchangeAccountId: "EX-DEMO-2048",
  referralLink: "https://exchange.example/ref/alex",
  registrationStatus: false,
  emailConfirmed: false,
  firstDepositConfirmed: false,
  totalDeposits: 0,
  totalWithdrawals: 0,
  currentBalance: 1500,
  postbackHistory: mockPostbacks,
};
