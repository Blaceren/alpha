import { NextResponse } from "next/server";
import { apiAuthErrorResponse, rateLimitedResponse, requireSupportAccess } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  getSupportAssignees,
  serializeSupportDialog,
  supportDialogInclude,
} from "@/lib/support";
import {
  notFoundResponse,
  supportDialogUpdateSchema,
  validateJsonBody,
  validateNumericParam,
  validationErrorResponse,
} from "@/lib/validation";

type SupportDialogRouteProps = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: SupportDialogRouteProps) {
  try {
    await requireSupportAccess();
    const { id } = await params;
    const dialogId = validateNumericParam(id, "id");

    if (!dialogId.success) return dialogId.response;

    const [dialog, assignees] = await Promise.all([
      prisma.supportDialog.findUnique({
        where: { id: dialogId.id },
        include: supportDialogInclude,
      }),
      getSupportAssignees(),
    ]);

    if (!dialog) return notFoundResponse("Диалог не найден");

    return NextResponse.json({ dialog: serializeSupportDialog(dialog), assignees });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function PATCH(request: Request, { params }: SupportDialogRouteProps) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const actor = await requireSupportAccess();
    const limit = rateLimit(`support:dialog-update:${actor.id}`, {
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });

    if (!limit.allowed) return rateLimitedResponse();

    const { id } = await params;
    const dialogId = validateNumericParam(id, "id");
    if (!dialogId.success) return dialogId.response;

    const parsed = await validateJsonBody(request, supportDialogUpdateSchema);
    if (!parsed.success) return parsed.response;

    const existing = await prisma.supportDialog.findUnique({ where: { id: dialogId.id } });
    if (!existing) return notFoundResponse("Диалог не найден");

    if (parsed.data.assignedToId !== undefined && parsed.data.assignedToId !== null) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: parsed.data.assignedToId,
          status: "active",
          role: { in: ["support", "mentor"] },
        },
      });
      if (!assignee) {
        return validationErrorResponse([
          { field: "assignedToId", message: "Можно назначить только активного support или mentor" },
        ]);
      }
    }

    const dialog = await prisma.supportDialog.update({
      where: { id: dialogId.id },
      data: parsed.data,
      include: supportDialogInclude,
    });

    if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
      await createAuditLog({
        userId: actor.id,
        action: "SUPPORT_DIALOG_STATUS_CHANGED",
        entityType: "SupportDialog",
        entityId: dialog.id,
        metadata: { before: existing.status, after: parsed.data.status },
        request,
      });
      if (parsed.data.status === "closed") {
        await createAuditLog({
          userId: actor.id,
          action: "SUPPORT_DIALOG_CLOSED",
          entityType: "SupportDialog",
          entityId: dialog.id,
          request,
        });
      }
    }

    if (parsed.data.assignedToId !== undefined && parsed.data.assignedToId !== existing.assignedToId) {
      await createAuditLog({
        userId: actor.id,
        action: "SUPPORT_DIALOG_ASSIGNED",
        entityType: "SupportDialog",
        entityId: dialog.id,
        metadata: { before: existing.assignedToId, after: parsed.data.assignedToId },
        request,
      });
    }

    return NextResponse.json({ dialog: serializeSupportDialog(dialog) });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
