/**
 * TOOLS-V2 — Trading Journal persistence.
 *
 * EVERY READ AND WRITE IS SCOPED BY OWNER. An entry id from another account is
 * «not found», never a different learner's trade. There is no delete (owner
 * decision): a learner keeps the whole history, and a correction is an edit.
 *
 * AN ENTRY MADE FROM A TRADE CARD keeps the card's trade. Only its review —
 * plan followed, violations, execution, conclusion — is edited here; replacing
 * the trade is refused with JOURNAL_TRADE_FROM_CARD.
 */
import type { Prisma, PrismaClient, ToolTradeCard } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { ToolError } from "./errors";
import {
  JOURNAL_LIMITS,
  tradeFromCard,
  type JournalChange,
  type JournalFilter,
  type JournalManualEntry,
  type JournalQuery,
  type JournalReview,
  type JournalRow,
  type JournalTrade,
} from "./journal";

type Db = Pick<PrismaClient, "toolJournalEntry" | "$transaction">;
type Tx = Prisma.TransactionClient;

const WITH_VIOLATIONS = { violations: { select: { code: true } } } as const;

/** Newest trade first; entries recorded for the same minute in the order they were written. */
const ORDER: Prisma.ToolJournalEntryOrderByWithRelationInput[] = [
  { tradeDate: "desc" },
  { entryTime: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

function whereFor(userId: number, filter: JournalFilter): Prisma.ToolJournalEntryWhereInput {
  if (filter === "violated") return { userId, planFollowed: false };
  if (filter === "no_conclusion") return { userId, conclusion: null };
  return { userId };
}

function tradeData(trade: JournalTrade) {
  return {
    tradeDate: trade.tradeDate,
    entryTime: trade.entryTime,
    assetCode: trade.assetCode,
    direction: trade.direction,
    amountMinor: trade.amountMinor,
    payoutPercent: trade.payoutPercent,
    expiryCode: trade.expiryCode,
    result: trade.result,
    plan: trade.plan,
  };
}

function reviewData(review: JournalReview) {
  return {
    planFollowed: review.planFollowed,
    execution: review.execution,
    conclusion: review.conclusion,
  };
}

export type JournalSummary = {
  readonly total: number;
  readonly onPlan: number;
  readonly violated: number;
  readonly unmarked: number;
  readonly withoutConclusion: number;
};

export type JournalPage = {
  readonly rows: JournalRow[];
  readonly nextCursor: string | null;
  readonly summary: JournalSummary;
};

/** One page of the learner's journal, and counts over the whole of it. */
export async function listJournal(
  userId: number,
  query: JournalQuery,
  db: Pick<PrismaClient, "toolJournalEntry"> = defaultPrisma,
): Promise<JournalPage> {
  if (query.before) {
    // A cursor is only ever one of the learner's own entries.
    const anchor = await db.toolJournalEntry.findFirst({ where: { id: query.before, userId }, select: { id: true } });
    if (!anchor) throw new ToolError("TOOL_VALIDATION", "invalid_before");
  }
  const rows = await db.toolJournalEntry.findMany({
    where: whereFor(userId, query.filter),
    orderBy: ORDER,
    take: JOURNAL_LIMITS.pageSize + 1,
    ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    include: WITH_VIOLATIONS,
  });
  const hasMore = rows.length > JOURNAL_LIMITS.pageSize;
  const page = hasMore ? rows.slice(0, JOURNAL_LIMITS.pageSize) : rows;

  const [total, onPlan, violated, withoutConclusion] = await Promise.all([
    db.toolJournalEntry.count({ where: { userId } }),
    db.toolJournalEntry.count({ where: { userId, planFollowed: true } }),
    db.toolJournalEntry.count({ where: { userId, planFollowed: false } }),
    db.toolJournalEntry.count({ where: { userId, conclusion: null } }),
  ]);

  return {
    rows: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    summary: { total, onPlan, violated, unmarked: total - onPlan - violated, withoutConclusion },
  };
}

/** «Новая запись»: a trade recorded by hand. */
export function createManualJournalEntry(
  userId: number,
  entry: JournalManualEntry,
  db: Pick<PrismaClient, "toolJournalEntry"> = defaultPrisma,
): Promise<JournalRow> {
  return db.toolJournalEntry.create({
    data: {
      userId,
      source: "manual",
      ...tradeData(entry),
      ...reviewData(entry),
      violations: { create: entry.violations.map((code) => ({ code })) },
    },
    include: WITH_VIOLATIONS,
  });
}

/** Edit the review of any entry, or replace a hand-recorded one whole. */
export function updateJournalEntry(
  userId: number,
  entryId: string,
  change: JournalChange,
  db: Db = defaultPrisma,
): Promise<JournalRow> {
  return db.$transaction(async (tx) => {
    const entry = await tx.toolJournalEntry.findFirst({ where: { id: entryId, userId }, select: { source: true } });
    if (!entry) throw new ToolError("JOURNAL_ENTRY_NOT_FOUND");
    if (change.kind === "manual" && entry.source !== "manual") throw new ToolError("JOURNAL_TRADE_FROM_CARD");

    const review = change.kind === "manual" ? change.entry : change.review;
    await tx.toolJournalViolation.deleteMany({ where: { entryId } });
    return tx.toolJournalEntry.update({
      where: { id: entryId },
      data: {
        ...(change.kind === "manual" ? tradeData(change.entry) : {}),
        ...reviewData(review),
        violations: { create: review.violations.map((code) => ({ code })) },
      },
      include: WITH_VIOLATIONS,
    });
  });
}

/**
 * A saved Trade Card becomes a journal entry. Called INSIDE the transaction that
 * saves the card, and only when the journal is open for the learner at that
 * moment — which is what «только новые» means: a card saved before the journal
 * opened never arrives.
 */
export function createJournalEntryFromCard(tx: Tx, card: ToolTradeCard, tradeDate: string) {
  const trade = tradeFromCard(card, tradeDate);
  return tx.toolJournalEntry.create({
    data: {
      userId: card.userId,
      source: "trade_card",
      tradeCardId: card.id,
      ...tradeData(trade),
      conclusion: trade.conclusion,
      planFollowed: null,
    },
  });
}
