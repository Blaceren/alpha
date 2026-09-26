/**
 * The Trade Card client: its paths and the shapes it guards. The transport —
 * the proxy, the CSRF token, the bounded read, the refused field in `detail` —
 * is the tools' shared one (`tools-client-core.ts`).
 */
import {
  PROXY_BASE,
  isNullableString,
  isRecord,
  toolGet,
  toolSend,
  type ToolFailure,
  type ToolResult,
} from "../tools-client-core";
import type {
  TradeCard,
  TradeCardPlanInput,
  TradeCardReference,
  TradeCardStatus,
  TradeResult,
} from "./trade-card-model";

export type TradeCardFailure = ToolFailure;
export type TradeCardResult<T> = ToolResult<T>;

export type TradeCardState = { card: TradeCard | null; reference: TradeCardReference };

export type TradeCardChange =
  | { action: "refix"; plan: TradeCardPlanInput }
  | { action: "save"; result: TradeResult; observation: string | null; tradeDate?: string | null }
  | { action: "cancel" };

/* ------------------------------------------------------------------ guards */

const STATUSES: readonly TradeCardStatus[] = ["fixed", "saved", "cancelled"];

export function isTradeCard(value: unknown): value is TradeCard {
  if (!isRecord(value) || !isRecord(value.plan) || !isRecord(value.outcomes)) return false;
  const plan = value.plan;
  const asset = plan.asset;
  const expiry = plan.expiry;
  return (
    typeof value.id === "string" &&
    STATUSES.includes(value.status as TradeCardStatus) &&
    isRecord(asset) &&
    typeof asset.code === "string" &&
    typeof asset.label === "string" &&
    (plan.direction === "up" || plan.direction === "down") &&
    typeof plan.amount === "string" &&
    typeof plan.payoutPercent === "number" &&
    isRecord(expiry) &&
    typeof expiry.code === "string" &&
    typeof expiry.label === "string" &&
    typeof expiry.seconds === "number" &&
    typeof plan.entryTime === "string" &&
    typeof plan.reason === "string" &&
    typeof value.outcomes.ifRight === "string" &&
    typeof value.outcomes.ifWrong === "string" &&
    typeof value.fixedAt === "string" &&
    typeof value.planRevisionCount === "number" &&
    (value.result === null || value.result === "profit" || value.result === "loss") &&
    isNullableString(value.observation) &&
    isNullableString(value.savedAt) &&
    isNullableString(value.cancelledAt) &&
    typeof value.createdAt === "string"
  );
}

function isReference(value: unknown): value is TradeCardReference {
  if (!isRecord(value) || !Array.isArray(value.assets) || !Array.isArray(value.expiries)) return false;
  return (
    value.assets.length > 0 &&
    value.expiries.length > 0 &&
    value.assets.every(
      (asset) => isRecord(asset) && typeof asset.code === "string" && typeof asset.label === "string" && typeof asset.group === "string",
    ) &&
    value.expiries.every(
      (expiry) =>
        isRecord(expiry) && typeof expiry.code === "string" && typeof expiry.label === "string" && typeof expiry.seconds === "number",
    )
  );
}

export function isTradeCardState(value: unknown): value is TradeCardState {
  return isRecord(value) && (value.card === null || isTradeCard(value.card)) && isReference(value.reference);
}

function isCardEnvelope(value: unknown): value is { card: TradeCard } {
  return isRecord(value) && isTradeCard(value.card);
}

/* ----------------------------------------------------------------- calls */

/** The learner's open card (or none) and the lists the form picks from. */
export function fetchTradeCardState(): Promise<TradeCardResult<TradeCardState>> {
  return toolGet(`${PROXY_BASE}/tools/trade-cards`, isTradeCardState);
}

/** «Зафиксировать план». */
export async function fixTradePlan(plan: TradeCardPlanInput): Promise<TradeCardResult<TradeCard>> {
  const result = await toolSend("POST", `${PROXY_BASE}/tools/trade-cards`, { plan }, isCardEnvelope);
  return result.ok ? { ok: true, data: result.data.card } : result;
}

/** «Изменить план», «Сохранить карточку», «Сделку не открывал». */
export async function changeTradeCard(cardId: string, change: TradeCardChange): Promise<TradeCardResult<TradeCard>> {
  const result = await toolSend(
    "PATCH",
    `${PROXY_BASE}/tools/trade-cards/${encodeURIComponent(cardId)}`,
    change,
    isCardEnvelope,
  );
  return result.ok ? { ok: true, data: result.data.card } : result;
}
