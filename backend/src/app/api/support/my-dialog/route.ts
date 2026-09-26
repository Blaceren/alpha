import { NextResponse } from "next/server";
import { ApiAuthError, apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import {
  activeSupportDialogStatuses,
  serializeSupportDialog,
  supportDialogInclude,
} from "@/lib/support";

export async function GET(request: Request) {
  try {
    const user = await requireUser();

    if (user.role !== "user") {
      throw new ApiAuthError(403, user.id, user.role);
    }

    const dialog = await prisma.supportDialog.findFirst({
      where: {
        userId: user.id,
        status: { in: activeSupportDialogStatuses },
      },
      include: supportDialogInclude,
      orderBy: { updatedAt: "desc" },
    });

    if (!dialog) {
      return NextResponse.json({ dialog: null });
    }

    const visibleDialog = serializeSupportDialog(dialog);

    return NextResponse.json({
      dialog: {
        ...visibleDialog,
        messages: visibleDialog.messages.filter((message) => !message.internalNote),
      },
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
