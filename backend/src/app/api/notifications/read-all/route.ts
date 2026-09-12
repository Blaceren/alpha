import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const user = await requireUser();
    const readAt = new Date();

    const result = await prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
      },
      data: { readAt },
    });

    await createAuditLog({
      userId: user.id,
      action: "NOTIFICATIONS_READ_ALL",
      entityType: "Notification",
      metadata: { count: result.count },
      request,
    });

    return NextResponse.json({ unreadCount: 0, updatedCount: result.count });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
