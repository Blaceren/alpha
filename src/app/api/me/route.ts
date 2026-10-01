import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { validateJsonBody } from "@/lib/validation";
import { getTrainingLevelFromProgress } from "@/lib/trainingLevel";
import { z } from "zod";
import { buildReferralInviteLink } from "@/lib/publicUrl";
import { resolveFirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getRankTitle(level: number) {
  if (level >= 17) return "Мастер";
  if (level >= 13) return "Профи";
  if (level >= 9) return "Трейдер";
  if (level >= 5) return "Практик";
  return "Новичок";
}

function getProgressStatus(checkpointStatus?: string) {
  return checkpointStatus === "frozen" ? "frozen" : "active";
}

export async function GET() {
  try {
    const currentUser = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      include: {
        checkpoint: true,
        notificationSettings: true,
        invitedReferrals: {
          include: {
            invited: true,
          },
        },
        exchangeAccount: {
          include: {
            postbackEvents: {
              orderBy: { createdAt: "desc" },
              take: 10,
            },
          },
        },
        rewards: {
          include: { reward: true },
        },
        taskProgress: {
          include: { task: true },
          orderBy: { task: { stepNumber: "asc" } },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ user: null });
    }

    const trainingLevel = getTrainingLevelFromProgress(user.taskProgress);
    const firstDeposit = await resolveFirstDepositConfirmation(prisma, user.id);

    return NextResponse.json({
      user: {
        id: user.id,
        profile: {
          id: user.id,
          name: user.name,
          email: user.email,
          pendingEmail: user.pendingEmail,
          emailVerified: Boolean(user.emailVerifiedAt),
        },
        name: user.name,
        email: user.email,
        role: user.role,
        pendingEmail: user.pendingEmail,
        pendingEmailRequestedAt: user.pendingEmailRequestedAt,
        emailVerified: Boolean(user.emailVerifiedAt),
        level: trainingLevel,
        currentLevel: trainingLevel,
        trainingLevel,
        storedLevel: user.level,
        xp: user.xp,
        rank: getRankTitle(trainingLevel),
        currentTask: user.currentTask,
        rewards: user.rewards.map((userReward) => ({
          id: userReward.id,
          rewardId: userReward.rewardId,
          title: userReward.reward.title,
          description: userReward.reward.description,
          status: userReward.status,
          relatedTaskId: userReward.reward.relatedTaskId,
          receivedAt: userReward.receivedAt,
        })),
        referrals: {
          // PUBLICURL-1: the learner-facing origin comes from PUBLIC_APP_URL, not
          // from APP_URL (which must stay a loopback origin so the DEV simulator
          // interlock keeps classifying this deployment as `dev`) and not from any
          // request header (which an attacker controls). Empty when no public
          // origin is configured — see buildReferralInviteLink.
          link: buildReferralInviteLink(user.referralCode),
          invitedCount: user.invitedReferrals.length,
          earnedXp: user.invitedReferrals.reduce(
            (total, referral) => total + referral.xpEarned,
            0,
          ),
          users: user.invitedReferrals.map((referral) => ({
            id: referral.invited.id,
            name: referral.invited.name,
            level: referral.invited.level,
            earnedXp: referral.xpEarned,
          })),
        },
        notificationSettings: user.notificationSettings
          ? {
              email: user.notificationSettings.emailEnabled,
              webPush: user.notificationSettings.webPushEnabled,
              telegramBot: user.notificationSettings.telegramEnabled,
            }
          : null,
        exchangeAccount: user.exchangeAccount
          ? {
              id: user.exchangeAccount.id,
              referralLink: user.exchangeAccount.referralLink,
              exchangeAccountId: user.exchangeAccount.exchangeAccountId,
              status: user.exchangeAccount.status,
              traderId: user.exchangeAccount.traderId,
              registrationStatus: user.exchangeAccount.registrationStatus,
              emailConfirmed: user.exchangeAccount.emailConfirmed,
              // FDCONF-1: the canonical ledger's answer, never the legacy
              // column. This is the payload the learner's own dashboard reads.
              firstDepositConfirmed: firstDeposit.confirmed,
              firstDepositConfirmedSource: firstDeposit.source,
              // DEVMECH-1: no current trading balance is returned to a
              // learner. Historical deposit totals remain.
              totalDeposits: user.exchangeAccount.totalDeposits,
              totalWithdrawals: user.exchangeAccount.totalWithdrawals,
              postbackEvents: user.exchangeAccount.postbackEvents.map(
                (event) => ({
                  id: event.id,
                  type: event.type,
                  amount: event.amount,
                  status: event.status,
                  rawPayload: event.rawPayload,
                  createdAt: event.createdAt,
                }),
              ),
            }
          : null,
        checkpoint: user.checkpoint
          ? {
              id: user.checkpoint.id,
              title: user.checkpoint.title,
              stepId: user.checkpoint.stepId,
              // The configured THRESHOLD is retained: it is published
              // platform configuration, not an observation about this
              // learner's money.
              requiredBalance: user.checkpoint.requiredBalance,
              // DEVMECH-1/PLPD-1: the legacy checkpoint's CURRENT balance
              // is an observed trading balance and is never returned.
              status: user.checkpoint.status,
            }
          : null,
        progressStatus: getProgressStatus(user.checkpoint?.status),
        taskProgress: user.taskProgress.map((progress) => ({
          id: progress.id,
          status: progress.status,
          stepNumber: progress.task.stepNumber,
          title: progress.task.title,
        })),
        fallbackFields: {},
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return apiAuthErrorResponse(error);
  }
}

/* ACCOUNT RECOVERY (2026-10-01): this endpoint used to accept `email` and write
   it to `pendingEmail` for anyone holding a session — with no password, no
   confirmation and nothing that ever resolved it. An address now changes
   through `/api/me/email-change`, which asks for the current password and
   takes effect only when the new mailbox answers. `.strict()` makes a request
   that still sends `email` a loud 400 rather than a silently ignored field. */
const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(50),
}).strict();

export async function PATCH(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const currentUser = await requireUser();
    const parsed = await validateJsonBody(request, profileUpdateSchema);
    if (!parsed.success) return parsed.response;

    const user = await prisma.user.update({
      where: { id: currentUser.id },
      data: { name: parsed.data.name },
      select: { id: true, name: true, email: true, pendingEmail: true, pendingEmailRequestedAt: true, emailVerifiedAt: true },
    });

    await createAuditLog({
      userId: currentUser.id,
      action: "PROFILE_UPDATED",
      entityType: "User",
      entityId: currentUser.id,
      metadata: { nameChanged: true },
      request,
    });

    return NextResponse.json({ user: { ...user, emailVerified: Boolean(user.emailVerifiedAt) } });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
