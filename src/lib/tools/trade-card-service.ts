/**
 * TOOLS-V2 — Trade Card persistence.
 *
 * EVERY WRITE IS SCOPED BY OWNER AND STATE IN ONE STATEMENT. `updateMany` with
 * `{ id, userId, status: "fixed" }` either changes exactly the learner's own open
 * card or changes nothing, so a card id guessed from another account, or a card
 * that has already been saved, can never be modified — and the follow-up read
 * only decides WHICH refusal to report.
 *
 * ONE OPEN CARD PER LEARNER is a database invariant (a partial unique index on
 * `userId` where `status = 'fixed'`), not only a check here: a second open card
 * fails at the database whichever writer attempts it.
 */
import { Prisma, type PrismaClient, type ToolTradeCard } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { utcDate } from "./dates";
import { ToolError } from "./errors";
import { createJournalEntryFromCard } from "./journal-service";
import type { TradeCardPlan, TradeCardResult } from "./trade-card";

type Db = Pick<PrismaClient, "toolTradeCard">;

function planData(plan: TradeCardPlan) {
  return {
    assetCode: plan.assetCode,
    direction: plan.direction,
    amountMinor: plan.amountMinor,
    payoutPercent: plan.payoutPercent,
    expiryCode: plan.expiryCode,
    entryTime: plan.entryTime,
    reason: plan.reason,
  };
}

/** The learner's open card, or null. */
export function getOpenTradeCard(userId: number, db: Db = defaultPrisma): Promise<ToolTradeCard | null> {
  return db.toolTradeCard.findFirst({ where: { userId, status: "fixed" } });
}

/** "Зафиксировать план": create the learner's open card. */
export async function createTradeCard(
  userId: number,
  plan: TradeCardPlan,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<ToolTradeCard> {
  try {
    return await db.toolTradeCard.create({
      data: { userId, status: "fixed", fixedAt: now, ...planData(plan) },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ToolError("TRADE_CARD_OPEN_EXISTS");
    }
    throw error;
  }
}

/** Distinguish "not yours / not there" from "not in a state that allows it". */
async function refusalFor(userId: number, cardId: string, db: Db): Promise<ToolError> {
  const card = await db.toolTradeCard.findFirst({ where: { id: cardId, userId }, select: { status: true } });
  return card ? new ToolError("TRADE_CARD_STATE_CONFLICT") : new ToolError("TRADE_CARD_NOT_FOUND");
}

async function readBack(userId: number, cardId: string, db: Db): Promise<ToolTradeCard> {
  const card = await db.toolTradeCard.findFirst({ where: { id: cardId, userId } });
  if (!card) throw new ToolError("TRADE_CARD_NOT_FOUND");
  return card;
}

/** "Изменить план": replace the plan of the open card and fix it again. */
export async function refixTradeCard(
  userId: number,
  cardId: string,
  plan: TradeCardPlan,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<ToolTradeCard> {
  const { count } = await db.toolTradeCard.updateMany({
    where: { id: cardId, userId, status: "fixed" },
    data: { ...planData(plan), fixedAt: now, planRevisionCount: { increment: 1 } },
  });
  if (count !== 1) throw await refusalFor(userId, cardId, db);
  return readBack(userId, cardId, db);
}

/**
 * "Сохранить карточку": record the result after expiry. Terminal.
 *
 * With `journal`, the Trading Journal is open for the learner, and the saved card
 * becomes a journal entry IN THE SAME TRANSACTION: either both happen or
 * neither does. `journal.tradeDate` is the learner's own calendar date; without
 * it the UTC date of the plan's fixing stands in.
 */
export async function saveTradeCard(
  userId: number,
  cardId: string,
  outcome: {
    readonly result: TradeCardResult;
    readonly observation: string | null;
    readonly journal?: { readonly tradeDate: string | null } | null;
  },
  db: Pick<PrismaClient, "toolTradeCard" | "$transaction"> = defaultPrisma,
  now: Date = new Date(),
): Promise<ToolTradeCard> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.toolTradeCard.updateMany({
      where: { id: cardId, userId, status: "fixed" },
      data: { status: "saved", result: outcome.result, observation: outcome.observation, savedAt: now },
    });
    if (count !== 1) throw await refusalFor(userId, cardId, tx);
    const card = await readBack(userId, cardId, tx);
    if (outcome.journal) {
      await createJournalEntryFromCard(tx, card, outcome.journal.tradeDate ?? utcDate(card.fixedAt));
    }
    return card;
  });
}

/** "Сделку не открывал": withdraw the open card. Terminal, never deleted. */
export async function cancelTradeCard(
  userId: number,
  cardId: string,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<ToolTradeCard> {
  const { count } = await db.toolTradeCard.updateMany({
    where: { id: cardId, userId, status: "fixed" },
    data: { status: "cancelled", cancelledAt: now },
  });
  if (count !== 1) throw await refusalFor(userId, cardId, db);
  return readBack(userId, cardId, db);
}
