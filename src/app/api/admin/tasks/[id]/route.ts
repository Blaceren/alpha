import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import {
  adminTaskUpdateSchema,
  notFoundResponse,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type AdminTaskRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, { params }: AdminTaskRouteProps) {
  try {
    await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const taskId = validateNumericParam(id, "id");

  if (!taskId.success) {
    return taskId.response;
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId.id },
  });

  if (!task) {
    return notFoundResponse("Задание не найдено");
  }

  return NextResponse.json({ task });
}

export async function PATCH(request: Request, { params }: AdminTaskRouteProps) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  let adminUser;

  try {
    adminUser = await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const taskId = validateNumericParam(id, "id");

  if (!taskId.success) {
    return taskId.response;
  }

  const parsed = await validateJsonBody(request, adminTaskUpdateSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const existingTask = await prisma.task.findUnique({
    where: { id: taskId.id },
  });

  if (!existingTask) {
    return notFoundResponse("Задание не найдено");
  }

  const task = await prisma.task.update({
    where: { id: taskId.id },
    data: parsed.data,
  });

  await createAuditLog({
    userId: adminUser.id,
    action: "ADMIN_TASK_UPDATED",
    entityType: "Task",
    entityId: task.id,
    metadata: {
      before: {
        title: existingTask.title,
        description: existingTask.description,
        xpReward: existingTask.xpReward,
        rewardType: existingTask.rewardType,
        isCheckpoint: existingTask.isCheckpoint,
      },
      after: parsed.data,
    },
    request,
  });

  return NextResponse.json({ task });
}
