type TaskProgressLike = {
  status: string;
  task: {
    stepNumber: number;
  };
};

type TaskWithProgressLike = {
  stepNumber: number;
  progress?: Array<{ status: string }>;
};

export function getTrainingLevelFromProgress(progress: TaskProgressLike[]) {
  if (progress.length === 0) return 1;

  const sorted = [...progress].sort((left, right) => left.task.stepNumber - right.task.stepNumber);
  const activeTask = sorted.find((item) => item.status === "active");
  if (activeTask) return activeTask.task.stepNumber;

  const firstNonCompleted = sorted.find((item) => item.status !== "completed");

  return firstNonCompleted?.task.stepNumber ?? sorted[sorted.length - 1]?.task.stepNumber ?? 1;
}

export function getTrainingLevelFromTasks(tasks: TaskWithProgressLike[]) {
  if (tasks.length === 0) return 1;

  const sorted = [...tasks].sort((left, right) => left.stepNumber - right.stepNumber);
  const activeTask = sorted.find((task) => task.progress?.[0]?.status === "active");
  if (activeTask) return activeTask.stepNumber;

  const firstNonCompleted = sorted.find((task) => task.progress?.[0]?.status !== "completed");

  return firstNonCompleted?.stepNumber ?? sorted[sorted.length - 1]?.stepNumber ?? 1;
}

export function getTrainingLevelAfterCompletion(currentStepNumber: number, nextStepNumber?: number | null) {
  return nextStepNumber ?? currentStepNumber;
}
