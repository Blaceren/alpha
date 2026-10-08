/**
 * TOOLS-V2 — Trading Journal persistence.
 *
 * EVERY READ AND WRITE IS SCOPED BY OWNER. An entry id from another account is
 * «not found», never a different learner's trade — for a read, an edit and a
 * delete alike.
 *
 * ANY ENTRY CAN BE REPLACED WHOLE AND ANY ENTRY CAN BE DELETED (owner,
 * 2026-10-01; before that an entry made from a card kept the card's trade and
 * nothing was deleted). Neither touches the Trade Card: an edit changes the
 * journal's record of the trade, a delete removes that record, and the card
 * stays what it was when it was saved. Every row is read with the trade of its
 * card beside it, so the DTO can say when the two no longer agree.
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

/** An entry is always read with its broken rules and, if it came from a card, the card's trade. */
const WITH_VIOLATIONS = {
  violations: { select: { code: true } },
  tradeCard: {
    select: {
      entryTime: true,
      assetCode: true,
      direction: true,
      amountMinor: true,
      payoutPercent: true,
      expiryCode: true,
      result: true,
      reason: true,
    },
  },
} as const;

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

  return {
    rows: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    summary: await journalSummary(userId, db),
  };
}

/** The counts over the learner's whole journal. Entries are counted; money is never summed. */
export async function journalSummary(
  userId: number,
  db: Pick<PrismaClient | Tx, "toolJournalEntry"> = defaultPrisma,
): Promise<JournalSummary> {
  const [total, onPlan, violated, withoutConclusion] = await Promise.all([
    db.toolJournalEntry.count({ where: { userId } }),
    db.toolJournalEntry.count({ where: { userId, planFollowed: true } }),
    db.toolJournalEntry.count({ where: { userId, planFollowed: false } }),
    db.toolJournalEntry.count({ where: { userId, conclusion: null } }),
  ]);
  return { total, onPlan, violated, unmarked: total - onPlan - violated, withoutConclusion };
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

/**
 * Edit the review of an entry, or replace the entry whole — whichever source it
 * came from. The source and the link to the card are never changed by an edit:
 * an entry made from a card stays that card's entry, corrected.
 */
export function updateJournalEntry(
  userId: number,
  entryId: string,
  change: JournalChange,
  db: Db = defaultPrisma,
): Promise<JournalRow> {
  return db.$transaction(async (tx) => {
    const entry = await tx.toolJournalEntry.findFirst({ where: { id: entryId, userId }, select: { id: true } });
    if (!entry) throw new ToolError("JOURNAL_ENTRY_NOT_FOUND");

    const review = change.kind === "entry" ? change.entry : change.review;
    await tx.toolJournalViolation.deleteMany({ where: { entryId } });
    return tx.toolJournalEntry.update({
      where: { id: entryId },
      data: {
        ...(change.kind === "entry" ? tradeData(change.entry) : {}),
        ...reviewData(review),
        violations: { create: review.violations.map((code) => ({ code })) },
      },
      include: WITH_VIOLATIONS,
    });
  });
}

/**
 * Delete one of the learner's own entries, with the rules marked on it, and
 * return the counts of what is left.
 *
 * WHAT IS DELETED, AND WHAT IS NOT. The journal's record of one trade: the row
 * and its broken rules (the rules go by the foreign key's cascade). The Trade
 * Card the entry was made from stays saved — it is the card's own record, and
 * cards are never deleted — but it has no entry any more and gets no second
 * one: a deleted trade does not come back by itself.
 *
 * The delete is scoped by owner in the statement itself, so an id from another
 * account deletes nothing and is «not found»; the count is read in the same
 * transaction, so it is the count after THIS delete.
 */
export function deleteJournalEntry(
  userId: number,
  entryId: string,
  db: Db = defaultPrisma,
): Promise<{ readonly summary: JournalSummary }> {
  return db.$transaction(async (tx) => {
    const deleted = await tx.toolJournalEntry.deleteMany({ where: { id: entryId, userId } });
    if (deleted.count !== 1) throw new ToolError("JOURNAL_ENTRY_NOT_FOUND");
    return { summary: await journalSummary(userId, tx) };
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
