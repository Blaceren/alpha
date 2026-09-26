import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { canAccessChannel } from "@/lib/chatModeration";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const channels = await prisma.chatChannel.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });

    const items = await Promise.all(
      channels.map(async (channel) => ({
        ...channel,
        unlocked: await canAccessChannel(user, channel.id),
      })),
    );

    return NextResponse.json({ items });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
