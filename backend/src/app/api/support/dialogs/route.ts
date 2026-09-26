import type { SupportDialogStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseEnumFilter } from "@/lib/adminList";
import { apiAuthErrorResponse, requireSupportAccess } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { getSupportAssignees } from "@/lib/support";
import { validationErrorResponse, type ValidationDetail } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireSupportAccess();
    const { searchParams } = new URL(request.url);
    const details: ValidationDetail[] = [];
    const status = parseEnumFilter<SupportDialogStatus>(
      searchParams,
      "status",
      ["new", "in_progress", "waiting_user", "closed"],
      details,
    );

    if (details.length > 0) {
      return validationErrorResponse(details);
    }

    const [dialogs, assignees] = await Promise.all([
      prisma.supportDialog.findMany({
        where: status ? { status } : undefined,
        include: {
          user: {
            select: { id: true, name: true, email: true, level: true, currentTask: true },
          },
          assignedTo: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        orderBy: { lastMessageAt: "desc" },
      }),
      getSupportAssignees(),
    ]);

    return NextResponse.json({ dialogs, assignees });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
