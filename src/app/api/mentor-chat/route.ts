import { NextResponse } from "next/server";
import { apiAuthErrorResponse, forbiddenResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

async function userHasMentorAccess(userId: number) {
  const [account, step] = await Promise.all([
    prisma.exchangeAccount.findUnique({ where: { userId } }),
    prisma.userTaskProgress.findFirst({ where: { userId, task: { stepNumber: 4 }, status: "completed" } }),
  ]);
  return Boolean(account?.firstDepositConfirmed || step);
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
