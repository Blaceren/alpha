import { NextResponse } from "next/server";
import { apiAuthErrorResponse, forbiddenResponse, requireUser } from "@/lib/apiAuth";
import { resolveFirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";
import { prisma } from "@/lib/prisma";

/**
 * FDCONF-1 — mentor access is an ENTITLEMENT, and it was gated on the stale
 * legacy column.
 *
 * A learner who made a canonical first deposit — provider event, conversion, CPA
 * qualification, commission paid to a partner — was refused mentor chat, because
 * the boolean this read is only written by the legacy processor. The learner had
 * paid for access the product then denied them. The step-4 alternative masked
 * how often it mattered, which is why it survived so long.
 */
async function userHasMentorAccess(userId: number) {
  const [firstDeposit, step] = await Promise.all([
    resolveFirstDepositConfirmation(prisma, userId),
    prisma.userTaskProgress.findFirst({ where: { userId, task: { stepNumber: 4 }, status: "completed" } }),
  ]);
  return Boolean(firstDeposit.confirmed || step);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (user.role === "support" || user.role === "moderator" || user.role === "news_editor") return forbiddenResponse();

    if (user.role === "admin" || user.role === "mentor") {
      const requestedDialogId = Number(new URL(request.url).searchParams.get("dialogId") ?? 0);
      const where = user.role === "mentor" ? { OR: [{ mentorId: user.id }, { mentorId: null }] } : {};
      const dialogs = await prisma.mentorChatDialog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true, level: true } } },
        orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
      });
      const selectedId = Number.isInteger(requestedDialogId) && requestedDialogId > 0 ? requestedDialogId : dialogs[0]?.id;
      const dialog = selectedId
        ? await prisma.mentorChatDialog.findFirst({ where: { id: selectedId, ...where }, include: { messages: { orderBy: { createdAt: "asc" } }, user: { select: { id: true, name: true, email: true, level: true } } } })
        : null;
      return NextResponse.json({ unlocked: true, staff: true, dialogs, dialog });
    }

    const unlocked = await userHasMentorAccess(user.id);
    let dialog = await prisma.mentorChatDialog.findFirst({ where: { userId: user.id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    if (!dialog) {
      dialog = await prisma.mentorChatDialog.create({
        data: { userId: user.id, status: unlocked ? "open" : "locked", unlockReason: "Доступ открывается после First Deposit или завершения шага 4" },
        include: { messages: true },
      });
    } else if (unlocked && dialog.status === "locked") {
      dialog = await prisma.mentorChatDialog.update({ where: { id: dialog.id }, data: { status: "open" }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    }
    return NextResponse.json({ unlocked, staff: false, dialogs: [], dialog });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
