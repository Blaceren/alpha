/**
 * The Trade Card client.
 *
 * Same shape as every learner client here: relative paths through the
 * `/api/backend` same-origin proxy, a CSRF token fetched per mutation, a bounded
 * JSON read, and a NORMALIZED error rather than a thrown exception.
 *
 * ONE ADDITION: the Backend names a refused plan field in `detail`
 * (`invalid_amount` …). The shared normalizer keeps only the code, so this
 * client reads `detail` itself and hands it to the form, which puts the message
 * under the right field.
 */
import { makeError, normalizeHttpError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";
import type {
  TradeCard,
  TradeCardPlanInput,
  TradeCardReference,
  TradeCardStatus,
  TradeResult,
} from "./trade-card-model";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 256 * 1024;

export type TradeCardFailure = { ok: false; error: NormalizedError; detail: string | null };
export type TradeCardResult<T> = { ok: true; data: T } | TradeCardFailure;

export type TradeCardState = { card: TradeCard | null; reference: TradeCardReference };

export type TradeCardChange =
  | { action: "refix"; plan: TradeCardPlanInput }
  | { action: "save"; result: TradeResult; observation: string | null }
  | { action: "cancel" };

async function readBoundedJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const raw = await response.arrayBuffer();
    if (raw.byteLength > MAX_RESPONSE_BYTES) return { ok: false };
    if (raw.byteLength === 0) return { ok: true, value: undefined };
    return { ok: true, value: JSON.parse(new TextDecoder().decode(raw)) as unknown };
  } catch {
    return { ok: false };
  }
}

function detailOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === "string" && /^[a-z][a-zA-Z_]{0,63}$/.test(detail) ? detail : null;
}

async function readEnvelope<T>(response: Response, guard: (value: unknown) => value is T): Promise<TradeCardResult<T>> {
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    const body = parsed.ok ? parsed.value : undefined;
    return {
      ok: false,
      error: normalizeHttpError({ status: response.status, body, requestId }),
      detail: detailOf(body),
    };
  }
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }), detail: null };
  }
  const data = (parsed.value as { data?: unknown }).data;
  if (!guard(data)) return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }), detail: null };
  return { ok: true, data };
}

async function fetchCsrfToken(): Promise<{ ok: true; token: string } | TradeCardFailure> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/csrf`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR"), detail: null };
  }
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({ status: response.status, body: parsed.ok ? parsed.value : undefined, requestId }),
      detail: null,
    };
  }
  const token =
    parsed.ok && typeof parsed.value === "object" && parsed.value !== null
      ? (parsed.value as { csrfToken?: unknown }).csrfToken
      : undefined;
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE"), detail: null };
  }
  return { ok: true, token };
}

async function send<T>(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  guard: (value: unknown) => value is T,
): Promise<TradeCardResult<T>> {
  const csrf = await fetchCsrfToken();
  if (!csrf.ok) return csrf;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { accept: "application/json", "content-type": "application/json", "x-csrf-token": csrf.token },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR"), detail: null };
  }
  return readEnvelope(response, guard);
}

/* ------------------------------------------------------------------ guards */

const STATUSES: readonly TradeCardStatus[] = ["fixed", "saved", "cancelled"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

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

function isState(value: unknown): value is TradeCardState {
  return isRecord(value) && (value.card === null || isTradeCard(value.card)) && isReference(value.reference);
}

function isCardEnvelope(value: unknown): value is { card: TradeCard } {
  return isRecord(value) && isTradeCard(value.card);
}

/* ----------------------------------------------------------------- calls */

/** The learner's open card (or none) and the lists the form picks from. */
export async function fetchTradeCardState(): Promise<TradeCardResult<TradeCardState>> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/tools/trade-cards`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR"), detail: null };
  }
  return readEnvelope(response, isState);
}

/** «Зафиксировать план». */
export async function fixTradePlan(plan: TradeCardPlanInput): Promise<TradeCardResult<TradeCard>> {
  const result = await send("POST", `${PROXY_BASE}/tools/trade-cards`, { plan }, isCardEnvelope);
  return result.ok ? { ok: true, data: result.data.card } : result;
}

/** «Изменить план», «Сохранить карточку», «Сделку не открывал». */
export async function changeTradeCard(cardId: string, change: TradeCardChange): Promise<TradeCardResult<TradeCard>> {
  const result = await send(
    "PATCH",
    `${PROXY_BASE}/tools/trade-cards/${encodeURIComponent(cardId)}`,
    change,
    isCardEnvelope,
  );
  return result.ok ? { ok: true, data: result.data.card } : result;
}
