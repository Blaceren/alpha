import { NextResponse } from "next/server";
import {
  ApiAuthError,
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  activeSupportDialogStatuses,
  serializeSupportDialog,
  supportDialogInclude,
} from "@/lib/support";
import { supportMessageSchema, validateJsonBody } from "@/lib/validation";

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const user = await requireUser();

    if (user.role !== "user") {
      throw new ApiAuthError(403, user.id, user.role);
    }

    const limit = rateLimit(`support:user-message:${user.id}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });

    if (!limit.allowed) {
      await createAuditLog({
        userId: user.id,
        action: "RATE_LIMITED",
        entityType: "API_ROUTE",
        entityId: "/api/support/my-dialog/messages",
        metadata: { resetAt: limit.resetAt },
        request,
      });
      return rateLimitedResponse();
    }

    const parsed = await validateJsonBody(request, supportMessageSchema);

    if (!parsed.success) {
      return parsed.response;
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
        fileAsset.ownerUserId !== user.id ||
        fileAsset.purpose !== "support_attachment")
    ) {
      return NextResponse.json(
        { error: "Файл не найден или недоступен" },
        { status: 403 },
      );
    }

    const messageText = parsed.data.message || fileAsset?.originalName || "Файл";

    const result = await prisma.$transaction(async (tx) => {
      const existingDialog = await tx.supportDialog.findFirst({
        where: {
          userId: user.id,
          status: { in: activeSupportDialogStatuses },
        },
        orderBy: { updatedAt: "desc" },
      });

      if (!existingDialog) {
        const dialog = await tx.supportDialog.create({
          data: {
            userId: user.id,
            userName: user.name,
            userLevel: user.level,
            currentStep: user.currentTask ?? "Не указан",
            status: "new",
            lastMessage: messageText,
            lastMessageAt: new Date(),
            messages: {
              create: {
                senderUserId: user.id,
                senderRole: user.role,
                message: messageText,
                fileAssetId: parsed.data.fileAssetId ?? null,
                internalNote: false,
              },
            },
          },
          include: supportDialogInclude,
        });

        return { dialog, created: true };
      }

      await tx.supportMessage.create({
        data: {
          dialogId: existingDialog.id,
          senderUserId: user.id,
          senderRole: user.role,
          message: messageText,
          fileAssetId: parsed.data.fileAssetId ?? null,
          internalNote: false,
        },
      });

      const dialog = await tx.supportDialog.update({
        where: { id: existingDialog.id },
        data: {
          lastMessage: messageText,
          lastMessageAt: new Date(),
        },
        include: supportDialogInclude,
      });

      return { dialog, created: false };
    });

    if (result.created) {
      await createAuditLog({
        userId: user.id,
        action: "SUPPORT_DIALOG_CREATED",
        entityType: "SupportDialog",
        entityId: result.dialog.id,
        metadata: { source: "user_message" },
        request,
      });
    }

    await createAuditLog({
      userId: user.id,
      action: "SUPPORT_MESSAGE_SENT",
      entityType: "SupportDialog",
      entityId: result.dialog.id,
      metadata: {
        messageLength: messageText.length,
        fileAssetId: parsed.data.fileAssetId ?? null,
      },
      request,
    });

    const dialog = serializeSupportDialog(result.dialog);

    return NextResponse.json(
      {
        dialog: {
          ...dialog,
          messages: dialog.messages.filter((message) => !message.internalNote),
        },
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
