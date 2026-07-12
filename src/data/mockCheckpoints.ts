import { mockExchangeStatus } from "@/data/mockExchangeStatus";
import type { Checkpoint } from "@/types/checkpoints";

export const mockCheckpoints: Checkpoint[] = [
  {
    id: 1,
    title: "Проверка баланса 500 USD",
    stepId: 8,
    requiredBalance: 500,
    currentBalance: mockExchangeStatus.balance,
    status: "active",
  },
];
