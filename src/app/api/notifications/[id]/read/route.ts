import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { notFoundResponse, validateNumericParam } from "@/lib/validation";

type NotificationReadRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(
  request: Request,
  { params }: NotificationReadRouteProps,
) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const user = await requireUser();
    const { id } = await params;
    const notificationId = validateNumericParam(id, "id");

    if (!notificationId.success) {
      return notificationId.response;
    }

    const existing = await prisma.notification.findFirst({
      where: {
        id: notificationId.id,
        userId: user.id,
      },
    });

    if (!existing) {
      return notFoundResponse("Уведомление не найдено");
    }

    const notification = await prisma.notification.update({
      where: { id: existing.id },
      data: {
        readAt: existing.readAt ?? new Date(),
      },
    });

    const unreadCount = await prisma.notification.count({
      where: {
        userId: user.id,
        readAt: null,
      },
    });

    await createAuditLog({
      userId: user.id,
      action: "NOTIFICATION_READ",
      entityType: "Notification",
      entityId: notification.id,
      request,
    });

    return NextResponse.json({ notification, unreadCount });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
