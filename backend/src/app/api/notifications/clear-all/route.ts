import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { clearLearnerNotifications } from "@/lib/notification-list";

/**
 * «Очистить всё» (DD-349, owner 2026-10-06 — the bell's window, «как в примере»).
 *
 * Clears the learner's own list: every notification still in it is stamped
 * `clearedAt` (and read, so nothing cleared can light the bell). NOTHING IS
 * DELETED — the rows stay for the staff's learner view and the audit trail; the
 * learner's list, its unread count and «Прочитать все» simply no longer see them.
 * The answer is the list's new state: empty, nothing unread.
 */
export async function PATCH(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const user = await requireUser();
    const now = new Date();

    const clearedCount = await clearLearnerNotifications(user.id, now);

    await createAuditLog({
      userId: user.id,
      action: "NOTIFICATIONS_CLEARED_ALL",
      entityType: "Notification",
      metadata: { count: clearedCount },
      request,
    });

    return NextResponse.json({ unreadCount: 0, clearedCount });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
