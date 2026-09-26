import type { Prisma, TaskReportStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { paginatedResponse, parseAdminListQuery, parseEnumFilter } from "@/lib/adminList";
import { apiAuthErrorResponse, requireTaskReportReviewer } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { validationErrorResponse, type ValidationDetail } from "@/lib/validation";

function parseIdFilter(searchParams: URLSearchParams, field: string, details: ValidationDetail[]) {
  const raw = searchParams.get(field);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    details.push({ field, message: "Должно быть положительным целым числом" });
    return undefined;
  }
  return value;
}

export async function GET(request: Request) {
  try {
    await requireTaskReportReviewer();
    const parsed = parseAdminListQuery(
      request,
      ["id", "status", "submittedAt", "reviewedAt", "createdAt", "updatedAt"],
      "submittedAt",
    );
    if (!parsed.success) return parsed.response;

    const details: ValidationDetail[] = [];
    const status = parseEnumFilter<TaskReportStatus>(
      parsed.searchParams,
      "status",
      ["pending", "approved", "rejected"],
      details,
    );
    const taskId = parseIdFilter(parsed.searchParams, "taskId", details);
    const userId = parseIdFilter(parsed.searchParams, "userId", details);
    if (details.length > 0) return validationErrorResponse(details);

    const where: Prisma.TaskReportWhereInput = {
      ...(status ? { status } : {}),
      ...(taskId ? { taskId } : {}),
      ...(userId ? { userId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.taskReport.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          task: { select: { id: true, stepNumber: true, title: true, requiresReport: true } },
          reviewer: { select: { id: true, name: true, role: true } },
        },
        orderBy: { [parsed.query.sort ?? "submittedAt"]: parsed.query.order },
        skip: parsed.query.skip,
        take: parsed.query.pageSize,
      }),
      prisma.taskReport.count({ where }),
    ]);

    return NextResponse.json(paginatedResponse(items, total, parsed.query.page, parsed.query.pageSize));
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
