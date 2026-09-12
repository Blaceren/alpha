import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireSupportAccess,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { createSupportReplyNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { serializeSupportDialog, supportDialogInclude } from "@/lib/support";
import {
  notFoundResponse,
  supportStaffMessageSchema,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type SupportMessageRouteProps = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: SupportMessageRouteProps) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const actor = await requireSupportAccess();
    const limit = rateLimit(`support:staff-message:${actor.id}`, {
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });
    if (!limit.allowed) return rateLimitedResponse();

    const { id } = await params;
    const dialogId = validateNumericParam(id, "id");
    if (!dialogId.success) return dialogId.response;

    const parsed = await validateJsonBody(request, supportStaffMessageSchema);
    if (!parsed.success) return parsed.response;

    const existing = await prisma.supportDialog.findUnique({
      where: { id: dialogId.id },
    });
    if (!existing) return notFoundResponse("Диалог не найден");
    if (existing.status === "closed") {
      return NextResponse.json(
        { error: "DIALOG_CLOSED", message: "Закрытый диалог доступен только для чтения" },
        { status: 400 },
      );
    }

    const fileAsset = parsed.data.fileAssetId
      ? await prisma.fileAsset.findUnique({
          where: { id: parsed.data.fileAssetId },
          select: {
            id: true,
            ownerUserId: true,
            purpose: true,
            originalName: true,
          },
        })
      : null;

    if (
      parsed.data.fileAssetId &&
      (!fileAsset ||
        fileAsset.ownerUserId !== actor.id ||
        fileAsset.purpose !== "support_attachment")
    ) {
      return NextResponse.json(
        { error: "Файл не найден или недоступен" },
        { status: 403 },
      );
    }

    const messageText = parsed.data.message || fileAsset?.originalName || "Файл";

    const dialog = await prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: {
          dialogId: existing.id,
          senderUserId: actor.id,
          senderRole: actor.role,
          message: messageText,
          fileAssetId: parsed.data.fileAssetId ?? null,
          internalNote: parsed.data.internalNote,
        },
      });

      return tx.supportDialog.update({
        where: { id: existing.id },
        data: parsed.data.internalNote
          ? {}
          : { lastMessage: messageText, lastMessageAt: new Date() },
        include: supportDialogInclude,
      });
    });

    await createAuditLog({
      userId: actor.id,
      action: parsed.data.internalNote
        ? "SUPPORT_INTERNAL_NOTE_ADDED"
        : "SUPPORT_REPLY_SENT",
      entityType: "SupportDialog",
      entityId: dialog.id,
      metadata: {
        messageLength: messageText.length,
        fileAssetId: parsed.data.fileAssetId ?? null,
      },
      request,
    });

    if (!parsed.data.internalNote) {
      await createSupportReplyNotification({
        userId: dialog.userId,
        dialogId: dialog.id,
        message: messageText,
        request,
      });
    }

    return NextResponse.json(
      { dialog: serializeSupportDialog(dialog) },
      { status: 201 },
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
