import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireProblemAccess,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  adminTesterFeedbackUpdateSchema,
  notFoundResponse,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type AdminFeedbackRouteProps = {
  params: Promise<{ id: string }>;
};

const include = {
  user: { select: { id: true, name: true, email: true, role: true } },
  resolvedBy: { select: { id: true, name: true, email: true } },
} as const;

export async function GET(request: Request, { params }: AdminFeedbackRouteProps) {
  try {
    await requireProblemAccess();
    const { id } = await params;
    const feedbackId = validateNumericParam(id, "id");

    if (!feedbackId.success) {
      return feedbackId.response;
    }

    const feedback = await prisma.testerFeedback.findUnique({
      where: { id: feedbackId.id },
      include,
    });

    if (!feedback) {
      return notFoundResponse("Фидбек не найден");
    }

    return NextResponse.json({ feedback });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function PATCH(request: Request, { params }: AdminFeedbackRouteProps) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const admin = await requireProblemAccess();
    const limit = rateLimit(`tester-feedback:update:${admin.id}`, {
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });

    if (!limit.allowed) {
      return rateLimitedResponse();
    }

    const { id } = await params;
    const feedbackId = validateNumericParam(id, "id");

    if (!feedbackId.success) {
      return feedbackId.response;
    }

    const parsed = await validateJsonBody(
      request,
      adminTesterFeedbackUpdateSchema,
    );

    if (!parsed.success) {
      return parsed.response;
    }

    const existing = await prisma.testerFeedback.findUnique({
      where: { id: feedbackId.id },
    });

    if (!existing) {
      return notFoundResponse("Фидбек не найден");
    }

    const isTerminal =
      ["resolved", "rejected", "closed"].includes(parsed.data.status ?? "");
    const leavesTerminal =
      parsed.data.status !== undefined &&
      parsed.data.status !== "resolved" &&
      parsed.data.status !== "rejected" &&
      parsed.data.status !== "closed";
    const feedback = await prisma.testerFeedback.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        adminComment:
          parsed.data.adminComment === undefined
            ? undefined
            : parsed.data.adminComment || null,
        resolvedAt: isTerminal ? new Date() : leavesTerminal ? null : undefined,
        resolvedById: isTerminal ? admin.id : leavesTerminal ? null : undefined,
      },
      include,
    });

    const action =
      feedback.status === "resolved" && parsed.data.status === "resolved"
        ? "ADMIN_FEEDBACK_RESOLVED"
        : feedback.status === "rejected" && parsed.data.status === "rejected"
          ? "ADMIN_FEEDBACK_REJECTED"
          : "ADMIN_FEEDBACK_UPDATED";

    await createAuditLog({
      userId: admin.id,
      action,
      entityType: "TesterFeedback",
      entityId: feedback.id,
      metadata: {
        before: {
          status: existing.status,
          adminComment: existing.adminComment,
        },
        after: {
          status: feedback.status,
          adminComment: feedback.adminComment,
        },
      },
      request,
    });

    return NextResponse.json({ feedback });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
