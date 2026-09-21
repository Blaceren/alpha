/**
 * TOOLS-V2 — Entry Checklist persistence.
 *
 * APPEND-ONLY. A check is written once, with the verdict the server computed
 * from its answers, and never edited or deleted. The learner's minimum payout is
 * remembered as the one they used in their newest check that had one.
 */
import type { PrismaClient, ToolEntryCheck } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { CHECKLIST_LIMITS, CHECKLIST_VERSION, checklistVerdict, encodeAnswers, type EntryCheckInput } from "./entry-checklist";

type Db = Pick<PrismaClient, "toolEntryCheck">;

const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

export type EntryCheckState = {
  /** The newest checks, newest first. */
  readonly recent: readonly ToolEntryCheck[];
  /** The minimum payout from the newest check that had one, to start the next check with. */
  readonly lastMinPayoutPercent: number | null;
};

export async function readEntryChecks(userId: number, db: Db = defaultPrisma): Promise<EntryCheckState> {
  const [recent, lastWithMinimum] = await Promise.all([
    db.toolEntryCheck.findMany({ where: { userId }, orderBy: NEWEST_FIRST, take: CHECKLIST_LIMITS.recentSize }),
    db.toolEntryCheck.findFirst({
      where: { userId, minPayoutPercent: { not: null } },
      orderBy: NEWEST_FIRST,
      select: { minPayoutPercent: true },
    }),
  ]);
  return { recent, lastMinPayoutPercent: lastWithMinimum?.minPayoutPercent ?? null };
}

/** «Записать проверку»: the check as it was, with the server's own verdict. */
export async function createEntryCheck(
  userId: number,
  input: EntryCheckInput,
  db: Db = defaultPrisma,
): Promise<ToolEntryCheck> {
  const { verdict, missingItem } = checklistVerdict(input.answers);
  return db.toolEntryCheck.create({
    data: {
      userId,
      assetCode: input.assetCode,
      minPayoutPercent: input.minPayoutPercent,
      listVersion: CHECKLIST_VERSION,
      answers: encodeAnswers(input.answers),
      verdict,
      missingItem,
    },
  });
}
