import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireUser();
    const levels = await prisma.level.findMany({
      orderBy: { number: "asc" },
    });
    const passedStatus =
      levels.find((level) => level.number === 1)?.status ?? "пройден";
    const currentStatus =
      levels.find((level) => level.number === 2)?.status ?? "текущий";
    const lockedStatus =
      levels.find((level) => level.number === 3)?.status ?? "заблокирован";

    return NextResponse.json({
      levels: levels.map((level) => ({
        ...level,
        status:
          level.number < user.level
            ? passedStatus
            : level.number === user.level
              ? currentStatus
              : lockedStatus,
      })),
    });
  } catch (error) {
    return apiAuthErrorResponse(error);
  }
}
