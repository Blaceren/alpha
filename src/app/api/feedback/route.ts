import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { createTesterFeedbackSubmittedNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  testerFeedbackSubmitSchema,
  validateJsonBody,
} from "@/lib/validation";

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const user = await requireUser();
    const limit = rateLimit(`tester-feedback:submit:${user.id}`, {
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });

    if (!limit.allowed) {
      return rateLimitedResponse();
    }

    const parsed = await validateJsonBody(request, testerFeedbackSubmitSchema);

    if (!parsed.success) {
      return parsed.response;
    }

    const feedback = await prisma.testerFeedback.create({
      data: {
        userId: user.id,
        role: user.role,
        type: parsed.data.type,
        severity: parsed.data.severity,
        title: parsed.data.title,
        message: parsed.data.message,
        pageUrl: parsed.data.pageUrl || null,
        browserInfo: parsed.data.browserInfo || null,
      },
    });

    await createAuditLog({
      userId: user.id,
      action: "TESTER_FEEDBACK_SUBMITTED",
      entityType: "TesterFeedback",
      entityId: feedback.id,
      metadata: {
        type: feedback.type,
        severity: feedback.severity,
        pageUrl: feedback.pageUrl,
      },
      request,
    });

    await createTesterFeedbackSubmittedNotifications({
      feedbackId: feedback.id,
      title: feedback.title,
      severity: feedback.severity,
      request,
    });

    return NextResponse.json({ feedback }, { status: 201 });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
