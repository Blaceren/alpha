import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireUser();

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({
        where: {
          userId: user.id,
          readAt: null,
        },
      }),
    ]);

    return NextResponse.json({ items, unreadCount });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
