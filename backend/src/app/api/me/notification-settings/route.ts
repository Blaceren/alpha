import { NextResponse } from "next/server";
import { apiAuthErrorResponse, rateLimitedResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { notificationSettingsSchema, validateJsonBody } from "@/lib/validation";

export async function PATCH(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  const parsed = await validateJsonBody(request, notificationSettingsSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const user = await requireUser();
    const limit = rateLimit(`notifications:update:${user.id}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });

    if (!limit.allowed) {
      await createAuditLog({
        userId: user.id,
        action: "RATE_LIMITED",
        entityType: "API_ROUTE",
        entityId: "/api/me/notification-settings",
        metadata: { resetAt: limit.resetAt },
        request,
      });

      return rateLimitedResponse();
    }

    const settings = await prisma.notificationSettings.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        emailEnabled: parsed.data.emailEnabled,
        webPushEnabled: parsed.data.webPushEnabled,
        telegramEnabled: parsed.data.telegramEnabled,
      },
      update: parsed.data,
    });

    await createAuditLog({
      userId: user.id,
      action: "NOTIFICATION_SETTINGS_UPDATED",
      entityType: "NotificationSettings",
      entityId: settings.id,
      metadata: {
        emailEnabled: settings.emailEnabled,
        webPushEnabled: settings.webPushEnabled,
        telegramEnabled: settings.telegramEnabled,
      },
      request,
    });

    return NextResponse.json({
      notificationSettings: {
        email: settings.emailEnabled,
        webPush: settings.webPushEnabled,
        telegramBot: settings.telegramEnabled,
      },
    });
  } catch (error) {
    return apiAuthErrorResponse(error);
  }
}
