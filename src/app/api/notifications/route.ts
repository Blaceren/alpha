import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { learnerListWhere } from "@/lib/notification-list";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireUser();

    const [items, unreadCount] = await Promise.all([
      /* A notification the learner cleared is not in their list (DD-349). */
      prisma.notification.findMany({
        where: learnerListWhere(user.id),
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({
        where: { ...learnerListWhere(user.id), readAt: null },
      }),
    ]);

    return NextResponse.json({ items, unreadCount });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
