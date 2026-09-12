import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { getTrainingLevelFromTasks } from "@/lib/trainingLevel";

function taskWithStatus<T extends { id: number; progress: Array<{ status: string }> }>(
  task: T,
  userId: number,
  status: string,
) {
  const progress = task.progress[0]
    ? [{ ...task.progress[0], status }]
    : [{ id: 0, userId, taskId: task.id, status, updatedAt: new Date() }];

  return { ...task, progress };
}

export async function GET() {
  try {
    const user = await requireUser();
    const [tasks, exchangeAccount] = await Promise.all([
      prisma.task.findMany({
        include: {
          progress: {
            where: { userId: user.id },
          },
          reports: {
            where: { userId: user.id },
            select: { status: true },
          },
        },
        orderBy: { stepNumber: "asc" },
      }),
      prisma.exchangeAccount.findUnique({
        where: { userId: user.id },
        select: {
          status: true,
          registrationStatus: true,
          traderId: true,
        },
      }),
    ]);

    const hasConfirmedPocketRegistration = Boolean(
      exchangeAccount?.registrationStatus ||
        exchangeAccount?.status === "connected" ||
        exchangeAccount?.traderId,
    );

    const normalizedTasks = hasConfirmedPocketRegistration
      ? tasks.map((task) => {
          if (task.code === "lvl_01_pocket_registration") {
            return taskWithStatus(task, user.id, "completed");
          }

          if (
            task.code === "lvl_02_platform_intro_lesson" &&
            task.progress[0]?.status === "locked"
          ) {
            return taskWithStatus(task, user.id, "active");
          }

          return task;
        })
      : tasks;

    const trainingLevel = getTrainingLevelFromTasks(normalizedTasks);

    return NextResponse.json(
      { tasks: normalizedTasks, currentLevel: trainingLevel, trainingLevel },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return apiAuthErrorResponse(error);
  }
}
