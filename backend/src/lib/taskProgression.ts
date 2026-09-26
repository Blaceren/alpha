import { prisma } from "@/lib/prisma";
import { getTrainingLevelAfterCompletion } from "@/lib/trainingLevel";

export async function completeProgressionTask(userId: number, taskId: number) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    const user = await tx.user.findUnique({ where: { id: userId } });
    const progress = await tx.userTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });

    if (!task || !user || !progress) {
      return { completed: false, alreadyCompleted: false, xpAwarded: 0, reason: "not_found" as const };
    }
    if (progress.status === "completed") {
      return { completed: true, alreadyCompleted: true, xpAwarded: 0, task };
    }
    if (progress.status !== "active") {
      return { completed: false, alreadyCompleted: false, xpAwarded: 0, reason: "not_active" as const, task };
    }

    await tx.userTaskProgress.update({
      where: { userId_taskId: { userId, taskId } },
      data: { status: "completed" },
    });

    const nextTask = await tx.task.findUnique({ where: { stepNumber: task.stepNumber + 1 } });
    if (nextTask) {
      await tx.userTaskProgress.updateMany({
        where: { userId, taskId: nextTask.id, status: "locked" },
        data: { status: "active" },
      });
    }

    const nextXp = user.xp + task.xpReward;
    const nextLevel = getTrainingLevelAfterCompletion(task.stepNumber, nextTask?.stepNumber);
    if (task.xpReward > 0) {
      await tx.xpEvent.create({
        data: {
          userId,
          amount: task.xpReward,
          source: "task",
          sourceId: task.code ?? String(task.id),
        },
      });
    }
    const reward = await tx.reward.findFirst({ where: { relatedTaskId: task.stepNumber } });
    if (reward) {
      await tx.userReward.upsert({
        where: { userId_rewardId: { userId, rewardId: reward.id } },
        create: {
          userId,
          rewardId: reward.id,
          status: "получено",
          receivedAt: new Date(),
        },
        update: {},
      });
    }
    await tx.user.update({
      where: { id: userId },
      data: {
        xp: nextXp,
        level: nextLevel,
        currentTask: nextTask?.title ?? user.currentTask,
      },
    });

    return {
      completed: true,
      alreadyCompleted: false,
      xpAwarded: task.xpReward,
      task,
      reward,
    };
  });
}

export async function completeProgressionTaskByCode(userId: number, code: string) {
  const task = await prisma.task.findUnique({ where: { code } });
  if (!task) {
    return { completed: false, alreadyCompleted: false, xpAwarded: 0, reason: "not_found" as const };
  }
  return completeProgressionTask(userId, task.id);
}
