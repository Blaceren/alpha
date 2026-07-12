import type {
  Prisma,
  TesterFeedbackSeverity,
  TesterFeedbackStatus,
  TesterFeedbackType,
} from "@prisma/client";
import { NextResponse } from "next/server";
import {
  paginatedResponse,
  parseAdminListQuery,
  parseEnumFilter,
} from "@/lib/adminList";
import { apiAuthErrorResponse, requireProblemAccess } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import {
  validationErrorResponse,
  type ValidationDetail,
} from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireProblemAccess();
    const parsed = parseAdminListQuery(
      request,
      ["id", "type", "severity", "status", "createdAt", "updatedAt", "resolvedAt"],
      "createdAt",
    );

    if (!parsed.success) {
      return parsed.response;
    }

    const details: ValidationDetail[] = [];
    const type = parseEnumFilter<TesterFeedbackType>(
      parsed.searchParams,
      "type",
      ["bug", "ux", "question", "idea", "other"],
      details,
    );
    const severity = parseEnumFilter<TesterFeedbackSeverity>(
      parsed.searchParams,
      "severity",
      ["low", "medium", "high", "blocker"],
      details,
    );
    const status = parseEnumFilter<TesterFeedbackStatus>(
      parsed.searchParams,
      "status",
      ["new", "triaged", "in_progress", "resolved", "rejected", "closed"],
      details,
    );
    const unresolved = parsed.searchParams.get("unresolved");
    const critical = parsed.searchParams.get("critical");
    if (unresolved && unresolved !== "true") details.push({ field: "unresolved", message: "Допустимо только true" });
    if (critical && critical !== "true") details.push({ field: "critical", message: "Допустимо только true" });

    if (details.length > 0) {
      return validationErrorResponse(details);
    }

    const where: Prisma.TesterFeedbackWhereInput = {
      ...(type ? { type } : {}),
      ...(severity
        ? { severity }
        : critical === "true"
          ? { severity: { in: ["high", "blocker"] } }
          : {}),
      ...(status
        ? { status }
        : unresolved === "true"
          ? { status: { in: ["new", "triaged", "in_progress"] } }
          : {}),
      ...(parsed.query.q
        ? {
            OR: [
              { title: { contains: parsed.query.q } },
              { message: { contains: parsed.query.q } },
              { adminComment: { contains: parsed.query.q } },
              { user: { name: { contains: parsed.query.q } } },
              { user: { email: { contains: parsed.query.q } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.testerFeedback.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          resolvedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { [parsed.query.sort ?? "createdAt"]: parsed.query.order },
        skip: parsed.query.skip,
        take: parsed.query.pageSize,
      }),
      prisma.testerFeedback.count({ where }),
    ]);

    return NextResponse.json(
      paginatedResponse(items, total, parsed.query.page, parsed.query.pageSize),
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
