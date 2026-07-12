import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { validateJsonBody } from "@/lib/validation";

const redeemSchema = z.object({
  code: z.string().trim().min(1).transform((value) => value.toUpperCase()),
});

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  const parsed = await validateJsonBody(request, redeemSchema);
  if (!parsed.success) return parsed.response;

  try {
    const user = await requireUser();
    const promocode = await prisma.promocode.findUnique({
      where: { code: parsed.data.code },
    });
    const now = new Date();

    if (
      !promocode ||
      !promocode.isActive ||
      (promocode.startsAt && promocode.startsAt > now) ||
      (promocode.expiresAt && promocode.expiresAt < now) ||
      (promocode.maxUses !== null && promocode.usedCount >= promocode.maxUses)
    ) {
      await createAuditLog({
        userId: user.id,
        action: "PROMOCODE_REJECTED",
        metadata: { code: parsed.data.code },
        request,
      });
      return NextResponse.json(
        { error: "PROMOCODE_INVALID", message: "Промокод недоступен" },
        { status: 400 },
      );
    }

    const redemptionCount = await prisma.promocodeRedemption.count({
      where: { promocodeId: promocode.id, userId: user.id },
    });

    if (redemptionCount >= promocode.perUserLimit) {
      return NextResponse.json(
        { error: "PROMOCODE_ALREADY_USED", message: "Промокод уже использован" },
        { status: 400 },
      );
    }

    const value = promocode.value as { xp?: number; achievementSlug?: string };
    await prisma.$transaction(async (tx) => {
      await tx.promocodeRedemption.create({
        data: { promocodeId: promocode.id, userId: user.id },
      });
      await tx.promocode.update({
        where: { id: promocode.id },
        data: { usedCount: { increment: 1 } },
      });
      if (promocode.type === "xp_bonus" && value.xp) {
        await tx.user.update({
          where: { id: user.id },
          data: { xp: { increment: value.xp } },
        });
        await tx.xpEvent.create({
          data: { userId: user.id, amount: value.xp, source: "promocode", sourceId: String(promocode.id) },
        });
      }
      if (promocode.type === "unlock_reward" && typeof (value as { rewardId?: unknown }).rewardId === "number") {
        const rewardId = (value as { rewardId: number }).rewardId;
        await tx.userReward.upsert({
          where: { userId_rewardId: { userId: user.id, rewardId } },
          update: {},
          create: { userId: user.id, rewardId, status: "received", receivedAt: new Date() },
        });
      }
      if (promocode.type === "grant_achievement" && value.achievementSlug) {
        const achievement = await tx.achievement.findUnique({
          where: { slug: value.achievementSlug },
        });
        if (achievement) {
          await tx.userAchievement.upsert({
            where: { userId_achievementId: { userId: user.id, achievementId: achievement.id } },
            update: {},
            create: {
              userId: user.id,
              achievementId: achievement.id,
              source: "promocode",
            },
          });
        }
      }
    });

    await createAuditLog({
      userId: user.id,
      action: "PROMOCODE_REDEEMED",
      entityType: "Promocode",
      entityId: promocode.id,
      metadata: { code: promocode.code, type: promocode.type },
      request,
    });
    await createNotification({
      userId: user.id,
      type: "promocode_redeemed",
      title: "Промокод применён",
      message: `Промокод ${promocode.code} успешно применён.`,
      metadata: { promocodeId: promocode.id },
      request,
    });

    return NextResponse.json({ ok: true, promocode });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
