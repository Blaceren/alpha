import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireTaskReportReviewer,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import {
  createTaskReportApprovedNotification,
  createTaskReportRejectedNotification,
  createRewardGrantedNotification,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { completeProgressionTask } from "@/lib/taskProgression";
import {
  notFoundResponse,
  taskReportReviewSchema,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type TaskReportReviewRouteProps = { params: Promise<{ id: string }> };

const include = {
  user: { select: { id: true, name: true, email: true } },
  task: { select: { id: true, stepNumber: true, title: true, requiresReport: true } },
  reviewer: { select: { id: true, name: true, role: true } },
  fileAsset: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      purpose: true,
    },
  },
} as const;

export async function GET(request: Request, { params }: TaskReportReviewRouteProps) {
  try {
    await requireTaskReportReviewer();
    const { id } = await params;
    const reportId = validateNumericParam(id, "id");
    if (!reportId.success) return reportId.response;

    const report = await prisma.taskReport.findUnique({
      where: { id: reportId.id },
      include,
    });
    if (!report) return notFoundResponse("Отчёт не найден");
    return NextResponse.json({ report });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function PATCH(request: Request, { params }: TaskReportReviewRouteProps) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const reviewer = await requireTaskReportReviewer();
    const limit = rateLimit(`task-report:review:${reviewer.id}`, {
      limit: 30,
      windowMs: 10 * 60 * 1000,
    });
    if (!limit.allowed) return rateLimitedResponse();

    const { id } = await params;
    const reportId = validateNumericParam(id, "id");
    if (!reportId.success) return reportId.response;

    const parsed = await validateJsonBody(request, taskReportReviewSchema);
    if (!parsed.success) return parsed.response;

    const existing = await prisma.taskReport.findUnique({ where: { id: reportId.id } });
    if (!existing) return notFoundResponse("Отчёт не найден");
    if (existing.status === "approved" || existing.status === "rejected") {
      return NextResponse.json(
        {
          error: "REPORT_ALREADY_REVIEWED",
          message: "Отчёт уже проверен",
          status: existing.status,
        },
        { status: 400 },
      );
    }

    const report = await prisma.taskReport.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        reviewComment: parsed.data.reviewComment ?? null,
        reviewerId: reviewer.id,
        reviewedAt: new Date(),
      },
      include,
    });

    await createAuditLog({
      userId: reviewer.id,
      action: parsed.data.status === "approved" ? "TASK_REPORT_APPROVED" : "TASK_REPORT_REJECTED",
      entityType: "TaskReport",
      entityId: report.id,
      metadata: {
        userId: report.userId,
        taskId: report.taskId,
        before: existing.status,
        after: report.status,
      },
      request,
    });

    if (report.status === "approved") {
      const completion = await completeProgressionTask(report.userId, report.taskId);
      if (!completion.alreadyCompleted && completion.reward) {
        await createRewardGrantedNotification({
          userId: report.userId,
          rewardId: completion.reward.id,
          rewardTitle: completion.reward.title,
          request,
        });
      }
      await createTaskReportApprovedNotification({
        userId: report.userId,
        taskTitle: report.task.title,
        reportId: report.id,
        request,
      });
    } else {
      await createTaskReportRejectedNotification({
        userId: report.userId,
        taskTitle: report.task.title,
        reportId: report.id,
        comment: report.reviewComment,
        request,
      });
    }

    return NextResponse.json({ report });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
