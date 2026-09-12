export type TaskStatus = "completed" | "active" | "locked" | "frozen";

export type MockTask = {
  id: number;
  code?: string | null;
  title: string;
  description: string;
  reward: string;
  status: TaskStatus;
  actionLabel: string;
  kind?: string;
  completionMethod?: string;
  balanceThreshold?: number | null;
  requiresReport?: boolean;
  reportStatus?: "pending" | "approved" | "rejected" | null;
};

export type TaskStatusLabel =
  | "выполнено"
  | "активно"
  | "заблокировано"
  | "заморожено";
