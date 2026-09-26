import type { NotificationType, Prisma } from "@prisma/client";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

type CreateNotificationInput = {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
  request?: Request;
};

export async function createNotification({
  userId,
  type,
  title,
  message,
  metadata,
  request,
}: CreateNotificationInput) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        metadata,
      },
    });

    await createAuditLog({
      userId,
      action: "NOTIFICATION_CREATED",
      entityType: "Notification",
      entityId: notification.id,
      metadata: {
        type,
        title,
      },
      request,
    });

    // External channels (email, web-push, Telegram) will be connected later
    // through NotificationSettings. The in-app notification is created now.
    return notification;
  } catch (error) {
    console.warn("Не удалось создать уведомление", error);
    return null;
  }
}

export function createSupportReplyNotification(input: {
  userId: number;
  dialogId: number;
  message: string;
  request?: Request;
}) {
  return createNotification({
    userId: input.userId,
    type: "support_reply",
    title: "Ответ в чате с ментором",
    message: input.message,
    metadata: { dialogId: input.dialogId },
    request: input.request,
  });
}

export function createTaskReportApprovedNotification(input: {
  userId: number;
  taskTitle: string;
  reportId: number;
  request?: Request;
}) {
  return createNotification({
    userId: input.userId,
    type: "task_report_approved",
    title: "Отчёт принят",
    message: `Отчёт по заданию “${input.taskTitle}” принят.`,
    metadata: { reportId: input.reportId },
    request: input.request,
  });
}

export function createTaskReportRejectedNotification(input: {
  userId: number;
  taskTitle: string;
  reportId: number;
  comment?: string | null;
  request?: Request;
}) {
  const comment = input.comment ? ` Комментарий: ${input.comment}` : "";

  return createNotification({
    userId: input.userId,
    type: "task_report_rejected",
    title: "Отчёт отклонён",
    message: `Отчёт по заданию “${input.taskTitle}” отклонён.${comment}`,
    metadata: { reportId: input.reportId, comment: input.comment ?? null },
    request: input.request,
  });
}

export function createRewardGrantedNotification(input: {
  userId: number;
  rewardTitle: string;
  rewardId: number;
  request?: Request;
}) {
  return createNotification({
    userId: input.userId,
    type: "reward_granted",
    title: "Получена награда",
    message: `Вы получили награду: ${input.rewardTitle}.`,
    metadata: { rewardId: input.rewardId },
    request: input.request,
  });
}

export function createLevelUpNotification(input: {
  userId: number;
  level: number;
  request?: Request;
}) {
  return createNotification({
    userId: input.userId,
    type: "level_up",
    title: "Новый уровень",
    message: `Ваш уровень повышен до ${input.level}.`,
    metadata: { level: input.level },
    request: input.request,
  });
}

/**
 * PLPD-1: this notification no longer carries an observed balance.
 *
 * Its only caller was the legacy financial checkpoint route, which is now
 * retired fail-closed, so nothing constructs one today. The `currentBalance`
 * parameter and metadata field are removed rather than left in place: a dead
 * function whose signature still asks for a learner's balance is an invitation
 * to reintroduce the leak the moment someone wires it up again.
 */
export function createCheckpointNotification(input: {
  userId: number;
  status: "frozen" | "completed";
  checkpointId: number;
  requiredBalance: number;
  request?: Request;
}) {
  const isFrozen = input.status === "frozen";

  return createNotification({
    userId: input.userId,
    type: isFrozen ? "checkpoint_frozen" : "checkpoint_restored",
    title: isFrozen ? "Прогресс заморожен" : "Прогресс восстановлен",
    message: isFrozen
      ? "Восстановите баланс для продолжения обучения."
      : "Контрольная точка пройдена, прогресс снова активен.",
    metadata: {
      checkpointId: input.checkpointId,
      requiredBalance: input.requiredBalance,
    },
    request: input.request,
  });
}

export async function createTesterFeedbackSubmittedNotifications(input: {
  feedbackId: number;
  title: string;
  severity: string;
  request?: Request;
}) {
  const admins = await prisma.user.findMany({
    where: { role: "admin", status: "active" },
    select: { id: true },
  });

  await Promise.all(
    admins.map((admin) =>
      createNotification({
        userId: admin.id,
        type: "system",
        title: "Новый фидбек тестера",
        message: `[${input.severity}] ${input.title}`,
        metadata: { feedbackId: input.feedbackId },
        request: input.request,
      }),
    ),
  );
}
