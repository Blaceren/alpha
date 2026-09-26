import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, forbiddenResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { resolveFirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { validateJsonBody } from "@/lib/validation";

const mentorMessageSchema = z.object({ message: z.string().trim().min(1).max(2000), dialogId: z.number().int().positive().optional() });

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  const parsed = await validateJsonBody(request, mentorMessageSchema);
  if (!parsed.success) return parsed.response;

  try {
    const user = await requireUser();
    if (user.role === "support" || user.role === "moderator" || user.role === "news_editor") return forbiddenResponse();
    const isStaff = user.role === "admin" || user.role === "mentor";
    let dialog = isStaff && parsed.data.dialogId
      ? await prisma.mentorChatDialog.findUnique({ where: { id: parsed.data.dialogId } })
      : await prisma.mentorChatDialog.findFirst({ where: { userId: user.id } });

    if (isStaff) {
      if (!dialog || (user.role === "mentor" && dialog.mentorId !== null && dialog.mentorId !== user.id)) return forbiddenResponse();
    } else {
      // FDCONF-1: the same entitlement as `userHasMentorAccess`, from the same
      // canonical resolver. Two copies of a gate that disagree is how a learner
      // gets listed as having access and is then refused when they use it.
      const firstDeposit = await resolveFirstDepositConfirmation(prisma, user.id);
      const step = await prisma.userTaskProgress.findFirst({ where: { userId: user.id, task: { stepNumber: 4 }, status: "completed" } });
      if (!firstDeposit.confirmed && !step) return NextResponse.json({ error: "MENTOR_CHAT_LOCKED", message: "Чат с ментором пока закрыт" }, { status: 403 });
    }

    if (!dialog && !isStaff) dialog = await prisma.mentorChatDialog.create({ data: { userId: user.id, status: "open" } });
    if (!dialog) return NextResponse.json({ error: "DIALOG_NOT_FOUND" }, { status: 404 });

    const message = await prisma.mentorChatMessage.create({ data: { dialogId: dialog.id, senderUserId: user.id, senderRole: user.role, message: parsed.data.message } });
    await prisma.mentorChatDialog.update({ where: { id: dialog.id }, data: { lastMessage: parsed.data.message, lastMessageAt: new Date(), status: "open" } });
    await createAuditLog({ userId: user.id, action: "MENTOR_CHAT_MESSAGE_SENT", entityType: "MentorChatDialog", entityId: dialog.id, request });
    if (isStaff) await createNotification({ userId: dialog.userId, type: "mentor_reply", title: "Новое сообщение ментора", message: parsed.data.message, metadata: { dialogId: dialog.id }, request });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
