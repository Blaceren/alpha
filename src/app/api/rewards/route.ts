import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireUser();
    const rewards = await prisma.reward.findMany({
      include: {
        users: {
          where: { userId: user.id },
        },
      },
      orderBy: { id: "asc" },
    });

    return NextResponse.json({ rewards });
  } catch (error) {
    return apiAuthErrorResponse(error);
  }
}
