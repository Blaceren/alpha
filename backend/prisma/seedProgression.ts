import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { progressionLevels, progressionTasks } from "./progressionData";

const prisma = new PrismaClient();

async function main() {
  const before = {
    levels: await prisma.level.count(),
    tasks: await prisma.task.count(),
    rewards: await prisma.reward.count(),
    userTasks: await prisma.userTaskProgress.count(),
  };

  await prisma.$transaction(async (tx) => {
    for (const level of progressionLevels) {
      await tx.level.upsert({
        where: { number: level.number },
        create: {
          ...level,
          title: `Уровень ${level.number}`,
          status: level.number === 1 ? "текущий" : "заблокирован",
        },
        update: { requiredXp: level.requiredXp },
      });
    }

    for (const taskData of progressionTasks) {
      const existingByCode = await tx.task.findUnique({ where: { code: taskData.code } });
      const existingByStep = existingByCode
        ? null
        : await tx.task.findUnique({ where: { stepNumber: taskData.stepNumber } });
      const data = {
        ...taskData,
        rewardType: `${taskData.xpReward} XP`,
      };

      const task = existingByCode
        ? await tx.task.update({ where: { id: existingByCode.id }, data })
        : existingByStep
          ? await tx.task.update({ where: { id: existingByStep.id }, data })
          : await tx.task.create({ data });

      const reward = await tx.reward.findFirst({ where: { relatedTaskId: task.stepNumber } });
      const rewardData = {
        title: `Награда за уровень ${task.stepNumber}`,
        description: `${task.xpReward} XP за выполнение задания «${task.title}»`,
        type: "xp" as const,
        status: "доступно",
        relatedTaskId: task.stepNumber,
      };
      if (reward) await tx.reward.update({ where: { id: reward.id }, data: rewardData });
      else await tx.reward.create({ data: rewardData });
    }

    const users = await tx.user.findMany({ select: { id: true, currentTask: true } });
    const tasks = await tx.task.findMany({ orderBy: { stepNumber: "asc" } });
    const firstBalanceTask = tasks.find(
      (task) => task.completionMethod === "balance_check" && task.balanceThreshold,
    );

    for (const user of users) {
      const existing = await tx.userTaskProgress.findMany({ where: { userId: user.id } });
      const hasProgress = existing.length > 0;

      for (const task of tasks) {
        await tx.userTaskProgress.upsert({
          where: { userId_taskId: { userId: user.id, taskId: task.id } },
          create: {
            userId: user.id,
            taskId: task.id,
            status: !hasProgress && task.stepNumber === 1 ? "active" : "locked",
          },
          update: {},
        });
      }

      if (!hasProgress) {
        await tx.user.update({
          where: { id: user.id },
          data: { currentTask: tasks[0]?.title ?? user.currentTask },
        });
      }

      if (firstBalanceTask?.balanceThreshold) {
        await tx.checkpoint.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            title: firstBalanceTask.title,
            stepId: firstBalanceTask.stepNumber,
            requiredBalance: firstBalanceTask.balanceThreshold,
            currentBalance: 0,
            status: "active",
          },
          update: {
            title: firstBalanceTask.title,
            stepId: firstBalanceTask.stepNumber,
            requiredBalance: firstBalanceTask.balanceThreshold,
          },
        });
      }
    }
  });

  const after = {
    levels: await prisma.level.count(),
    tasks: await prisma.task.count(),
    rewards: await prisma.reward.count(),
    userTasks: await prisma.userTaskProgress.count(),
  };

  console.log(JSON.stringify({ before, after }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
