import type {
  CheckpointStatus,
  ProgressStatus,
} from "@/types/checkpoints";

export function checkCheckpointStatus(
  balance: number,
  requiredBalance: number,
): CheckpointStatus {
  return balance >= requiredBalance ? "completed" : "frozen";
}

export function isProgressFrozen(checkpointStatus: CheckpointStatus) {
  return checkpointStatus === "frozen";
}

export function getProgressStatus(checkpointStatus: CheckpointStatus): ProgressStatus {
  return isProgressFrozen(checkpointStatus) ? "frozen" : "active";
}

export function getProgressMessage(progressStatus: ProgressStatus) {
  if (progressStatus === "frozen") {
    return "Восстановите баланс для продолжения";
  }

  return "Прогресс активен";
}

export function getCheckpointStatusLabel(status: CheckpointStatus) {
  const labels: Record<CheckpointStatus, string> = {
    not_started: "не начата",
    active: "активна",
    completed: "пройдена",
    frozen: "заморожена",
  };

  return labels[status];
}

export function getProgressStatusLabel(status: ProgressStatus) {
  return status === "frozen" ? "Прогресс заморожен" : "Прогресс активен";
}
