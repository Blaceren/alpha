export type CheckpointStatus = "not_started" | "active" | "completed" | "frozen";

export type ProgressStatus = "active" | "frozen";

export type Checkpoint = {
  id: number;
  title: string;
  stepId: number;
  requiredBalance: number;
  currentBalance: number;
  status: CheckpointStatus;
};

export type ExchangeStatus = {
  accountStatus: "демо" | "не подключён" | "подключён";
  depositConfirmed: boolean;
  balance: number;
  lastCheckedAt: string;
};
