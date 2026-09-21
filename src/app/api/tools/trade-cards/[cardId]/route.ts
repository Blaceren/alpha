/**
 * TOOLS-V2 — Trade Card (L5): change the learner's open card.
 *
 *   PATCH /api/tools/trade-cards/:cardId
 *     { "action": "refix", "plan": {…} }                        "Изменить план"
 *     { "action": "save", "result": "profit"|"loss",
 *       "observation": "…" | null }                              "Сохранить карточку"
 *     { "action": "cancel" }                                     "Сделку не открывал"
 *
 * Only the owner's own card in state `fixed` can change. Anything else answers
 * TRADE_CARD_NOT_FOUND (not theirs, or not there) or TRADE_CARD_STATE_CONFLICT
 * (already saved or cancelled).
 */
import { assertToolUnlocked } from "@/lib/tools/access";
import {
  assertNoQueryParams,
  enforceToolRateLimit,
  parseJsonObject,
  requireToolLearner,
  toolData,
  toolErrorResponse,
  validateCardId,
} from "@/lib/tools/http";
import { TRADE_CARD_TOOL_CODE, parseTradeCardChange, toTradeCardDto } from "@/lib/tools/trade-card";
import { cancelTradeCard, refixTradeCard, saveTradeCard } from "@/lib/tools/trade-card-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const gate = await requireToolLearner(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "write");
    await assertToolUnlocked(gate.userId, TRADE_CARD_TOOL_CODE);
    const cardId = validateCardId((await params).cardId);
    const change = parseTradeCardChange(await parseJsonObject(request));

    const card =
      change.action === "refix"
        ? await refixTradeCard(gate.userId, cardId, change.plan)
        : change.action === "save"
          ? await saveTradeCard(gate.userId, cardId, change)
          : await cancelTradeCard(gate.userId, cardId);

    return toolData({ card: toTradeCardDto(card) });
  } catch (error) {
    return toolErrorResponse(error, "PATCH /api/tools/trade-cards/:cardId");
  }
}
