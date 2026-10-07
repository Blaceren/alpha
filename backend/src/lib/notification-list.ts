import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

/**
 * THE LEARNER'S OWN LIST OF NOTIFICATIONS (DD-349, 2026-10-06).
 *
 * The learner can clear it («Очистить всё» in the bell's window, the owner's
 * choice «как в примере»). Clearing hides; it never deletes: a cleared row keeps
 * existing for the staff's learner view and for the audit trail, and only the
 * learner's list — its items, its unread count, «Прочитать все» — stops seeing it.
 */
export function learnerListWhere(userId: number): Prisma.NotificationWhereInput {
  return { userId, clearedAt: null };
}

type Db = Pick<PrismaClient, "$transaction">;

/**
 * «Очистить всё»: every notification still in the learner's list is read and
 * cleared, in one transaction, at one instant. Returns how many were cleared.
 */
export async function clearLearnerNotifications(
  userId: number,
  now: Date = new Date(),
  db: Db = defaultPrisma,
): Promise<number> {
  return db.$transaction(async (tx) => {
    await tx.notification.updateMany({
      where: { ...learnerListWhere(userId), readAt: null },
      data: { readAt: now },
    });
    const cleared = await tx.notification.updateMany({
      where: learnerListWhere(userId),
      data: { clearedAt: now },
    });
    return cleared.count;
  });
}
