import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { getTrainingLevelFromProgress } from "@/lib/trainingLevel";

const periods = new Set(["daily", "weekly", "monthly", "all-time"]);

function getPeriodStart(period: string) {
  const now = new Date();
  if (period === "daily") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "weekly") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - day + 1);
    return start;
  }
  if (period === "monthly") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return null;
}

export async function GET(request: Request) {
  let currentUser;
  try {
    currentUser = await requireUser();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
  const requestedPeriod = new URL(request.url).searchParams.get("period") ?? "all-time";
  const period = periods.has(requestedPeriod) ? requestedPeriod : "all-time";
  const periodStart = getPeriodStart(period);
  const users = await prisma.user.findMany({
    where: {
      status: "active",
      leaderboardExcluded: false,
      role: "user",
    },
    orderBy: [{ xp: "desc" }, { level: "desc" }],
    take: 50,
    select: {
      id: true,
      name: true,
      email: true,
      level: true,
      xp: true,
      taskProgress: {
        select: { status: true, task: { select: { stepNumber: true } } },
        orderBy: { task: { stepNumber: "asc" } },
      },
    },
  });

  const periodXp = periodStart
    ? await prisma.xpEvent.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: periodStart }, user: { status: "active", role: "user", leaderboardExcluded: false } },
        _sum: { amount: true },
      })
    : [];
  const periodXpByUser = new Map(periodXp.map((item) => [item.userId, item._sum.amount ?? 0]));
  const ranked = users
    .map((user) => ({ ...user, score: periodStart ? periodXpByUser.get(user.id) ?? 0 : user.xp }))
    .filter((user) => !periodStart || user.score > 0)
    .map((user) => ({ ...user, trainingLevel: getTrainingLevelFromProgress(user.taskProgress) }))
    .sort((left, right) => right.score - left.score || right.trainingLevel - left.trainingLevel)
    .slice(0, 50);

  return NextResponse.json({
    period,
    items: ranked.map((user, index) => ({
      rank: index + 1,
      displayName: user.name || user.email,
      level: user.trainingLevel,
      storedLevel: user.level,
      xp: user.score,
      isCurrent: user.id === currentUser.id,
    })),
  });
}
