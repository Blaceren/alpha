import { NextResponse } from "next/server";
import {
  ApiAuthError,
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  notFoundResponse,
  taskReportSubmitSchema,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type TaskReportRouteProps = { params: Promise<{ id: string }> };

async function requireReportOwner() {
  const user = await requireUser();

  if (user.role !== "user") {
    throw new ApiAuthError(403, user.id, user.role);
  }

  return user;
}

async function findTask(stepNumber: number) {
  return prisma.task.findUnique({ where: { stepNumber } });
}

export async function GET(request: Request, { params }: TaskReportRouteProps) {
  try {
    const user = await requireReportOwner();
    const { id } = await params;
    const taskId = validateNumericParam(id, "id");
    if (!taskId.success) return taskId.response;

    const task = await findTask(taskId.id);
    if (!task) return notFoundResponse("Задание не найдено");

    const report = await prisma.taskReport.findUnique({
      where: { userId_taskId: { userId: user.id, taskId: task.id } },
      include: {
        reviewer: { select: { id: true, name: true, role: true } },
        fileAsset: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
          },
        },
      },
    });

    return NextResponse.json({ task, report });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function POST(request: Request, { params }: TaskReportRouteProps) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const user = await requireReportOwner();
    const limit = rateLimit(`task-report:submit:${user.id}`, {
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!limit.allowed) return rateLimitedResponse();

    const { id } = await params;
    const taskId = validateNumericParam(id, "id");
    if (!taskId.success) return taskId.response;

    const parsed = await validateJsonBody(request, taskReportSubmitSchema);
    if (!parsed.success) return parsed.response;

    const task = await findTask(taskId.id);
    if (!task) return notFoundResponse("Задание не найдено");
    if (!task.requiresReport) {
      return NextResponse.json(
        { error: "Для этого задания отчёт не требуется" },
        { status: 400 },
      );
    }

    const existing = await prisma.taskReport.findUnique({
      where: { userId_taskId: { userId: user.id, taskId: task.id } },
    });

    if (existing?.status === "pending") {
      return NextResponse.json(
        { error: "Отчёт уже ожидает проверки" },
        { status: 400 },
      );
    }
    if (existing?.status === "approved") {
      return NextResponse.json(
        { error: "Одобренный отчёт нельзя изменить" },
        { status: 400 },
      );
    }

    let fileAsset:
      | {
          id: number;
          originalName: string;
          ownerUserId: number;
          purpose: string;
        }
      | null = null;

    if (parsed.data.fileAssetId) {
      fileAsset = await prisma.fileAsset.findUnique({
        where: { id: parsed.data.fileAssetId },
        select: {
          id: true,
          originalName: true,
          ownerUserId: true,
          purpose: true,
        },
      });

      if (
        !fileAsset ||
        fileAsset.ownerUserId !== user.id ||
        fileAsset.purpose !== "task_report"
      ) {
        return NextResponse.json(
          { error: "Файл отчёта не найден или недоступен" },
          { status: 403 },
        );
      }
    }

    const submittedAt = new Date();
    const reportData = {
      ...parsed.data,
      fileName: fileAsset?.originalName ?? parsed.data.fileName ?? null,
    };
    const report = existing
      ? await prisma.taskReport.update({
          where: { id: existing.id },
          data: {
            ...reportData,
            status: "pending",
            reviewerId: null,
            reviewComment: null,
            reviewedAt: null,
            submittedAt,
          },
        })
      : await prisma.taskReport.create({
          data: {
            userId: user.id,
            taskId: task.id,
            ...reportData,
            submittedAt,
          },
        });

    await createAuditLog({
      userId: user.id,
      action: "TASK_REPORT_SUBMITTED",
      entityType: "TaskReport",
      entityId: report.id,
      metadata: {
        taskId: task.id,
        stepNumber: task.stepNumber,
        resubmitted: Boolean(existing),
        fileAssetId: report.fileAssetId,
      },
      request,
    });

    return NextResponse.json({ report }, { status: existing ? 200 : 201 });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
