import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { DAILY_REWARD_STREAK_BONUS_XP, DAILY_REWARD_STREAK_LENGTH, DAILY_REWARD_XP, previousDateKey } from "@/lib/dailyRewards";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const items = await prisma.dailyLoginReward.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 14,
    });
    const claimedToday = items.some((item) => item.rewardDate === todayKey());
    return NextResponse.json({ items, claimedToday });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const user = await requireUser();
    const rewardDate = todayKey();
    const existing = await prisma.dailyLoginReward.findUnique({
      where: { userId_rewardDate: { userId: user.id, rewardDate } },
    });

    if (existing) {
      return NextResponse.json({ reward: existing, duplicate: true });
    }

    const previous = await prisma.dailyLoginReward.findFirst({
      where: { userId: user.id },
      orderBy: { rewardDate: "desc" },
    });
    const streak = previous?.rewardDate === previousDateKey(rewardDate) ? previous.streak + 1 : 1;
    const xpGranted = streak % DAILY_REWARD_STREAK_LENGTH === 0 ? DAILY_REWARD_STREAK_BONUS_XP : DAILY_REWARD_XP;

    const reward = await prisma.$transaction(async (tx) => {
      const created = await tx.dailyLoginReward.create({
        data: {
          userId: user.id,
          rewardDate,
          streak,
          xpGranted,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { xp: { increment: xpGranted } },
      });
      await tx.xpEvent.create({
        data: { userId: user.id, amount: xpGranted, source: "daily_reward", sourceId: rewardDate },
      });
      return created;
    });

    await createAuditLog({
      userId: user.id,
      action: "DAILY_REWARD_CLAIMED",
      entityType: "DailyLoginReward",
      entityId: reward.id,
      metadata: { xpGranted, streak },
      request,
    });
    await createNotification({
      userId: user.id,
      type: "daily_reward",
      title: "Ежедневная награда получена",
      message: `Начислено ${xpGranted} XP. Серия: ${streak}.`,
      metadata: { rewardId: reward.id, xpGranted, streak },
      request,
    });

    return NextResponse.json({ reward, duplicate: false });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
