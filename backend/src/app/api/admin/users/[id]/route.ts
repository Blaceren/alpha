import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { getTrainingLevelFromProgress } from "@/lib/trainingLevel";
import {
  adminUserUpdateSchema,
  notFoundResponse,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type AdminUserRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

function getProgressStatus(xp: number) {
  if (xp >= 1000) {
    return "advanced";
  }

  if (xp >= 300) {
    return "in_progress";
  }

  return "new";
}

export async function GET(request: Request, { params }: AdminUserRouteProps) {
  try {
    await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const userId = validateNumericParam(id, "id");

  if (!userId.success) {
    return userId.response;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      level: true,
      xp: true,
      referralCode: true,
      invitedReferrals: { select: { id: true } },
      invitedByReferral: { select: { inviterUserId: true, bonusGrantedAt: true } },
      mentorDialogs: { select: { mentorId: true }, take: 1 },
      taskProgress: {
        select: { status: true, task: { select: { stepNumber: true, title: true } } },
        orderBy: { task: { stepNumber: "asc" } },
      },
      taskReports: { select: { status: true, updatedAt: true } },
      exchangeAccount: {
        select: {
          status: true,
          registrationStatus: true,
          emailConfirmed: true,
          firstDepositConfirmed: true,
          updatedAt: true,
        },
      },
      testerFeedback: { select: { status: true, severity: true, updatedAt: true } },
      supportDialogs: {
        select: { id: true, status: true, assignedToId: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    return notFoundResponse("Пользователь не найден");
  }

  const trainingLevel = getTrainingLevelFromProgress(user.taskProgress);

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      level: trainingLevel,
      currentLevel: trainingLevel,
      trainingLevel,
      storedLevel: user.level,
      xp: user.xp,
      referralCode: user.referralCode,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      mentorId: user.mentorDialogs[0]?.mentorId ?? null,
      referralSummary: { invited: user.invitedReferrals.length, invitedByUserId: user.invitedByReferral?.inviterUserId ?? null },
      progressStatus: getProgressStatus(user.xp),
      betaSummary: {
        activeStep: user.taskProgress.find((item) => item.status === "active")?.task ?? null,
        completedTasks: user.taskProgress.filter((item) => item.status === "completed").length,
        totalTasks: user.taskProgress.length,
        reports: user.taskReports.reduce<Record<string, number>>((counts, report) => {
          counts[report.status] = (counts[report.status] ?? 0) + 1;
          return counts;
        }, {}),
        exchange: user.exchangeAccount,
        feedback: {
          total: user.testerFeedback.length,
          unresolved: user.testerFeedback.filter((item) => !["resolved", "rejected"].includes(item.status)).length,
          critical: user.testerFeedback.filter((item) => ["high", "blocker"].includes(item.severity) && !["resolved", "rejected"].includes(item.status)).length,
        },
        support: user.supportDialogs[0] ?? null,
        lastActivityAt: [
          user.updatedAt,
          ...user.taskReports.map((item) => item.updatedAt),
          ...user.testerFeedback.map((item) => item.updatedAt),
          ...(user.exchangeAccount ? [user.exchangeAccount.updatedAt] : []),
          ...user.supportDialogs.map((item) => item.updatedAt),
        ].sort((left, right) => right.getTime() - left.getTime())[0],
      },
    },
  });
}

export async function PATCH(request: Request, { params }: AdminUserRouteProps) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  let adminUser;

  try {
    adminUser = await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const userId = validateNumericParam(id, "id");

  if (!userId.success) {
    return userId.response;
  }

  const parsed = await validateJsonBody(request, adminUserUpdateSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: userId.id },
  });

  if (!existingUser) {
    return notFoundResponse("Пользователь не найден");
  }

  const { mentorId, ...userData } = parsed.data;
  if (mentorId !== undefined) {
    if (mentorId !== null) {
      const mentor = await prisma.user.findFirst({ where: { id: mentorId, role: "mentor", status: "active" } });
      if (!mentor) return NextResponse.json({ error: "MENTOR_NOT_FOUND" }, { status: 400 });
    }
    const dialog = await prisma.mentorChatDialog.findFirst({ where: { userId: userId.id } });
    if (dialog) await prisma.mentorChatDialog.update({ where: { id: dialog.id }, data: { mentorId } });
    else if (existingUser.role === "user") await prisma.mentorChatDialog.create({ data: { userId: userId.id, mentorId, status: "locked" } });
  }

  const user = await prisma.user.update({
    where: { id: userId.id },
    data: userData,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      level: true,
      xp: true,
      createdAt: true,
    },
  });

  await createAuditLog({
    userId: adminUser.id,
    action: "ADMIN_USER_UPDATED",
    entityType: "User",
    entityId: user.id,
    metadata: {
      before: {
        role: existingUser.role,
        status: existingUser.status,
        level: existingUser.level,
        xp: existingUser.xp,
      },
      after: parsed.data,
    },
    request,
  });

  if (
    parsed.data.status === "blocked" &&
    existingUser.status !== "blocked"
  ) {
    await createAuditLog({
      userId: adminUser.id,
      action: "ADMIN_USER_BLOCKED",
      entityType: "User",
      entityId: user.id,
      metadata: {
        email: user.email,
      },
      request,
    });
  }

  if (
    parsed.data.status === "active" &&
    existingUser.status === "blocked"
  ) {
    await createAuditLog({
      userId: adminUser.id,
      action: "ADMIN_USER_UNBLOCKED",
      entityType: "User",
      entityId: user.id,
      metadata: {
        email: user.email,
      },
      request,
    });
  }

  return NextResponse.json({ user });
}
