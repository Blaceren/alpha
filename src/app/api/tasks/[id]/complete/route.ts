import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import {
  createLevelUpNotification,
  createRewardGrantedNotification,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { notFoundResponse, validateNumericParam } from "@/lib/validation";
import { getTrainingLevelAfterCompletion } from "@/lib/trainingLevel";

type CompleteTaskRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

async function getTasksWithProgress(userId: number) {
  return prisma.task.findMany({
    include: {
      progress: {
        where: { userId },
      },
      reports: {
        where: { userId },
        select: { status: true },
      },
    },
    orderBy: { stepNumber: "asc" },
  });
}

export async function POST(request: Request, { params }: CompleteTaskRouteProps) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  const { id } = await params;
  const stepNumber = validateNumericParam(id, "id");

  if (!stepNumber.success) {
    return stepNumber.response;
  }

  let currentUser;

  try {
    currentUser = await requireUser();
  } catch (error) {
    return apiAuthErrorResponse(error);
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    include: {
      checkpoint: true,
    },
  });

  if (!user) {
    return notFoundResponse("Пользователь не найден");
  }

  const task = await prisma.task.findUnique({
    where: { stepNumber: stepNumber.id },
  });

  if (!task) {
    return notFoundResponse();
  }

  if (!["manual", "report_approval"].includes(task.completionMethod)) {
    return NextResponse.json(
      { error: "Это задание подтверждается автоматически после проверки внешнего условия" },
      { status: 400 },
    );
  }

  if (task.requiresReport) {
    const report = await prisma.taskReport.findUnique({
      where: {
        userId_taskId: {
          userId: user.id,
          taskId: task.id,
        },
      },
    });

    if (!report) {
      return NextResponse.json(
        { error: "Для этого задания нужно отправить отчёт на проверку" },
        { status: 400 },
      );
    }
    if (report.status === "pending") {
      return NextResponse.json({ error: "Отчёт ожидает проверки" }, { status: 400 });
    }
    if (report.status === "rejected") {
      return NextResponse.json(
        { error: "Отчёт отклонён. Отправьте исправленный отчёт" },
        { status: 400 },
      );
    }
  }

  if (user.checkpoint?.status === "frozen" && task.stepNumber > user.checkpoint.stepId) {
    return NextResponse.json(
      {
        error:
          "Прогресс заморожен. Восстановите баланс для продолжения.",
      },
      { status: 403 },
    );
  }

  const currentProgress = await prisma.userTaskProgress.findUnique({
    where: {
      userId_taskId: {
        userId: user.id,
        taskId: task.id,
      },
    },
  });

  if (currentProgress?.status === "completed") {
    return NextResponse.json({
      tasks: await getTasksWithProgress(user.id),
      user,
      xpAwarded: 0,
      message: "Задание уже выполнено",
    });
  }

  if (currentProgress?.status !== "active") {
    return NextResponse.json(
      { error: "Можно выполнить только активное задание" },
      { status: 400 },
    );
  }

  const reward = await prisma.reward.findFirst({
    where: { relatedTaskId: task.stepNumber },
  });
  const existingUserReward = reward
    ? await prisma.userReward.findUnique({
        where: {
          userId_rewardId: {
            userId: user.id,
            rewardId: reward.id,
          },
        },
      })
    : null;
  const receivedRewardStatus = "получено";

  const updatedUser = await prisma.$transaction(async (tx) => {
    await tx.userTaskProgress.update({
      where: {
        userId_taskId: {
          userId: user.id,
          taskId: task.id,
        },
      },
      data: { status: "completed" },
    });

    const nextTask = await tx.task.findUnique({
      where: { stepNumber: task.stepNumber + 1 },
    });

    if (nextTask) {
      const nextProgress = await tx.userTaskProgress.findUnique({
        where: {
          userId_taskId: {
            userId: user.id,
            taskId: nextTask.id,
          },
        },
      });

      if (nextProgress?.status === "locked") {
        await tx.userTaskProgress.update({
          where: {
            userId_taskId: {
              userId: user.id,
              taskId: nextTask.id,
            },
          },
          data: { status: "active" },
        });
      }
    }

    if (reward) {
      await tx.userReward.upsert({
        where: {
          userId_rewardId: {
            userId: user.id,
            rewardId: reward.id,
          },
        },
        create: {
          userId: user.id,
          rewardId: reward.id,
          status: receivedRewardStatus,
          receivedAt: new Date(),
        },
        update: {},
      });
    }

    const nextXp = user.xp + task.xpReward;
    const nextLevel = getTrainingLevelAfterCompletion(task.stepNumber, nextTask?.stepNumber);

    if (task.xpReward > 0) {
      await tx.xpEvent.create({
        data: {
          userId: user.id,
          amount: task.xpReward,
          source: "task",
          sourceId: String(task.id),
        },
      });
    }

    return tx.user.update({
      where: { id: user.id },
      data: {
        xp: nextXp,
        level: nextLevel,
        currentTask: nextTask?.title ?? user.currentTask,
      },
    });
  });

  await createAuditLog({
    userId: user.id,
    action: "TASK_COMPLETED",
    entityType: "Task",
    entityId: task.id,
    metadata: {
      stepNumber: task.stepNumber,
      title: task.title,
      xpAwarded: task.xpReward,
    },
    request,
  });

  if (reward && !existingUserReward) {
    await createAuditLog({
      userId: user.id,
      action: "REWARD_GRANTED",
      entityType: "Reward",
      entityId: reward.id,
      metadata: {
        title: reward.title,
        relatedTaskId: reward.relatedTaskId,
      },
      request,
    });

    await createRewardGrantedNotification({
      userId: user.id,
      rewardId: reward.id,
      rewardTitle: reward.title,
      request,
    });
  }

  if (updatedUser.level > user.level) {
    await createLevelUpNotification({
      userId: user.id,
      level: updatedUser.level,
      request,
    });
  }

  return NextResponse.json({
    tasks: await getTasksWithProgress(user.id),
    user: updatedUser,
    xpAwarded: task.xpReward,
  });
}
