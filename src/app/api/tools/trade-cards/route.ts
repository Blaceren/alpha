/**
 * TOOLS-V2 — Trade Card (L5).
 *
 *   GET  /api/tools/trade-cards   the learner's open card (or null) + the lists
 *   POST /api/tools/trade-cards   "Зафиксировать план": create the open card
 *
 * Gate order: learner session (+ CSRF on POST) → rate limit → tool unlocked
 * (L5 durably completed) → input. A locked tool answers `TOOL_LOCKED` and reads
 * nothing.
 */
import { assertToolUnlocked } from "@/lib/tools/access";
import {
  assertNoQueryParams,
  enforceToolRateLimit,
  parseJsonObject,
  requireToolLearner,
  toolData,
  toolErrorResponse,
} from "@/lib/tools/http";
import { tradeCardReference } from "@/lib/tools/reference";
import { TRADE_CARD_TOOL_CODE, parseTradeCardPlan, toTradeCardDto } from "@/lib/tools/trade-card";
import { createTradeCard, getOpenTradeCard } from "@/lib/tools/trade-card-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const gate = await requireToolLearner(request, { mutation: false });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "read");
    await assertToolUnlocked(gate.userId, TRADE_CARD_TOOL_CODE);
    const card = await getOpenTradeCard(gate.userId);
    return toolData({ card: card ? toTradeCardDto(card) : null, reference: tradeCardReference() });
  } catch (error) {
    return toolErrorResponse(error, "GET /api/tools/trade-cards");
  }
}

export async function POST(request: Request) {
  const gate = await requireToolLearner(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "write");
    await assertToolUnlocked(gate.userId, TRADE_CARD_TOOL_CODE);
    const body = await parseJsonObject(request);
    const plan = parseTradeCardPlan(body.plan);
    const card = await createTradeCard(gate.userId, plan);
    return toolData({ card: toTradeCardDto(card) }, 201);
  } catch (error) {
    return toolErrorResponse(error, "POST /api/tools/trade-cards");
  }
}
