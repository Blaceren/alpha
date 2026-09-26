/**
 * TOOLS-V2 — Personal Stats, read from the learner's own journal.
 *
 * READ-ONLY. Nothing is stored for this tool: every figure is computed on
 * request from the learner's journal entries and the rules they marked, over
 * the window asked for. Only the four fields the figures need are read.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { computeStats, type JournalStats, type StatsQuery } from "./stats";

type Db = Pick<PrismaClient, "toolJournalEntry">;

export async function readJournalStats(userId: number, query: StatsQuery, db: Db = defaultPrisma): Promise<JournalStats> {
  const entries = await db.toolJournalEntry.findMany({
    where: {
      userId,
      ...(query.window ? { tradeDate: { gte: query.window.from, lte: query.window.to } } : {}),
    },
    select: { result: true, planFollowed: true, payoutPercent: true, violations: { select: { code: true } } },
  });
  return computeStats(entries);
}
