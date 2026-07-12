import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { toPublicUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { verifyCaptcha } from "@/lib/captcha";
import { createEmailVerificationToken, isEmailVerificationRequired } from "@/lib/emailVerification";
import { prisma } from "@/lib/prisma";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session";
import { registerSchema, validateJsonBody } from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = await validateJsonBody(request, registerSchema);
  const ip = getRequestIp(request);
  const email = parsed.success ? parsed.data.email : "invalid-email";
  const limit = rateLimit(`auth:register:${ip}`, {
    limit: 3,
    windowMs: 30 * 60 * 1000,
  });

  if (!limit.allowed) {
    await createAuditLog({
      action: "RATE_LIMITED",
      entityType: "API_ROUTE",
      entityId: "/api/auth/register",
      metadata: { email, resetAt: limit.resetAt },
      request,
    });

    return rateLimitedResponse();
  }

  if (!parsed.success) {
    await createAuditLog({
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: "/api/auth/register",
      metadata: { email, details: parsed.details },
      request,
    });

    return parsed.response;
  }

  const captcha = await verifyCaptcha({
    token: parsed.data.captchaToken,
    purpose: "register",
    request,
  });

  if (!captcha.ok) {
    return NextResponse.json(
      { error: "CAPTCHA_FAILED", message: captcha.message ?? "Captcha не пройдена" },
      { status: 400 },
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "Email уже занят" },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const referralConfig = parsed.data.referralCode
    ? await prisma.referralBonusConfig.findUnique({ where: { slug: "default" } })
    : null;
  const inviter = parsed.data.referralCode
    ? await prisma.user.findUnique({ where: { referralCode: parsed.data.referralCode } })
    : null;

  if (parsed.data.referralCode && (!inviter || !referralConfig?.isActive)) {
    return NextResponse.json(
      { error: "REFERRAL_INVALID", message: "Реферальная ссылка недействительна" },
      { status: 400 },
    );
  }

  const invitedXp = inviter && referralConfig ? referralConfig.invitedXp : 0;
  const user = await prisma.$transaction(async (tx) => {
    let created = await tx.user.create({
      data: {
        email: parsed.data.email,
        passwordHash,
        role: "user",
        name: parsed.data.name ?? `Трейдер-${Math.floor(1000 + Math.random() * 9000)}`,
        level: 1,
        xp: invitedXp,
        notificationSettings: {
          create: {
            emailEnabled: true,
            webPushEnabled: false,
            telegramEnabled: false,
          },
        },
      },
    });

    const tasks = await tx.task.findMany({ orderBy: { stepNumber: "asc" } });
    if (tasks.length > 0) {
      await tx.userTaskProgress.createMany({
        data: tasks.map((task, index) => ({
          userId: created.id,
          taskId: task.id,
          status: index === 0 ? "active" : "locked",
        })),
      });
      created = await tx.user.update({
        where: { id: created.id },
        data: { currentTask: tasks[0].title },
      });

      const checkpointTask = tasks.find(
        (task) => task.completionMethod === "balance_check" && task.balanceThreshold,
      );
      if (checkpointTask?.balanceThreshold) {
        await tx.checkpoint.create({
          data: {
            userId: created.id,
            title: checkpointTask.title,
            stepId: checkpointTask.stepNumber,
            requiredBalance: checkpointTask.balanceThreshold,
            currentBalance: 0,
            status: "active",
          },
        });
      }
      await tx.mentorChatDialog.create({
        data: {
          userId: created.id,
          status: "locked",
          unlockReason: "Доступ открывается после First Deposit / шага 4",
        },
      });
    }

    if (inviter && referralConfig) {
      await tx.referral.create({
        data: {
          inviterUserId: inviter.id,
          invitedUserId: created.id,
          xpEarned: referralConfig.inviterXp,
          invitedXpEarned: referralConfig.invitedXp,
          bonusGrantedAt: new Date(),
        },
      });
      await tx.user.update({
        where: { id: inviter.id },
        data: { xp: { increment: referralConfig.inviterXp } },
      });
      await tx.xpEvent.createMany({
        data: [
          { userId: inviter.id, amount: referralConfig.inviterXp, source: "referral_inviter", sourceId: String(created.id) },
          { userId: created.id, amount: referralConfig.invitedXp, source: "referral_invited", sourceId: String(inviter.id) },
        ],
      });
    }

    return created;
  });
  const verificationRequired = isEmailVerificationRequired();
  const verificationToken = verificationRequired
    ? await createEmailVerificationToken(user.id)
    : null;

  await createAuditLog({
    userId: user.id,
    action: "AUTH_REGISTER",
    metadata: { email: parsed.data.email },
    request,
  });

  if (inviter && referralConfig) {
    await prisma.notification.createMany({
      data: [
        {
          userId: inviter.id,
          type: "referral_bonus",
          title: "Реферальный бонус",
          message: `Начислено ${referralConfig.inviterXp} XP за приглашённого пользователя.`,
          metadata: { invitedUserId: user.id },
        },
        {
          userId: user.id,
          type: "referral_bonus",
          title: "Стартовый реферальный бонус",
          message: `Начислено ${referralConfig.invitedXp} XP.`,
          metadata: { inviterUserId: inviter.id },
        },
      ],
    });
    await createAuditLog({
      userId: inviter.id,
      action: "REFERRAL_BONUS_GRANTED",
      entityType: "User",
      entityId: user.id,
      metadata: { inviterXp: referralConfig.inviterXp, invitedXp: referralConfig.invitedXp },
      request,
    });
  }

  const response = NextResponse.json(
    {
      user: toPublicUser(user),
      verification: {
        required: verificationRequired,
        devToken:
          verificationRequired && process.env.NODE_ENV !== "production"
            ? verificationToken
            : undefined,
      },
    },
    { status: 201 },
  );
  if (!verificationRequired) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      createSessionToken(user.id, user.role),
      sessionCookieOptions,
    );
  }

  return response;
}
