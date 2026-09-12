import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const achievements = await prisma.achievement.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
      include: {
        users: {
          where: { userId: user.id },
        },
      },
    });

    return NextResponse.json({
      items: achievements.map((achievement) => ({
        id: achievement.id,
        slug: achievement.slug,
        title: achievement.title,
        description: achievement.description,
        rarity: achievement.rarity,
        iconKey: achievement.iconKey,
        granted: achievement.users.length > 0,
      })),
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
