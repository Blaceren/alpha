import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import {
  PocketRejectionReason,
  authenticatePocketRequest,
  fingerprintEventId,
  hasQueryAuthMaterial,
  resolvePocketPostbackConfig,
} from "@/lib/exchange/pocketPostbackAuth";
import { processExchangePostbackPayload } from "@/lib/exchange/postbackProcessor";
import type { PocketPostbackType } from "@/lib/exchange/pocket";
import { prisma } from "@/lib/prisma";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import { receivePostbackSchema } from "@/lib/validation";

const goalToPocketType: Record<string, PocketPostbackType> = {
  reg: "Registration",
  registration: "Registration",
  dep: "First Deposit",
  ftd: "First Deposit",
  first_deposit: "First Deposit",
  redep: "Re-deposit",
  redeposit: "Re-deposit",
  email: "Email Confirmation",
  email_confirmed: "Email Confirmation",
  email_confirmation: "Email Confirmation",
  commission: "Commission",
  withdrawal: "Withdrawal",
  successful_withdrawal: "Successful Withdrawal",
  canceled_withdrawal: "Canceled Withdrawal",
};

const ROUTE = "/api/postbacks/pocket";

/**
 * Query aliases the legacy contract accepted as authentication material. They
 * are declared here, in the route itself, because the secret auditor
 * (scripts/security/sqlAuditCore.ts) proves this file covers every alias. A
 * request carrying any of them is rejected outright, and the names stay on the
 * redaction list so a legacy caller's secret is never persisted.
 */
const SECRET_QUERY_KEYS = ["ow", "secret", "token"] as const;

const MAX_QUERY_PARAMS = 40;
const MAX_QUERY_KEY_LENGTH = 80;
const MAX_QUERY_VALUE_LENGTH = 1000;

// Bounded per-IP budget, applied before any database work. Authentication
// failures consume the same budget as accepted events, so an attacker cannot
// probe the secret at unbounded rates.
const RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

/** Every response is uncacheable and carries a correlation id. */
function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": crypto.randomUUID(),
    },
  });
}

function fail(status: number, error: string) {
  return respond(status, { success: false, error });
}

/**
 * The single rendering of every authentication failure. Missing, empty,
 * malformed, ambiguous, query-supplied and simply wrong secrets are all
 * indistinguishable to the caller; the precise reason is recorded only in the
 * AuditLog. Integration-disabled and server-secret-missing deliberately share
 * one 503 so the response cannot reveal whether a secret is configured.
 */
function authFailureResponse() {
  return fail(403, "FORBIDDEN");
}

function unavailableResponse() {
  return fail(503, "POCKET_POSTBACK_UNAVAILABLE");
}

type SecurityAudit = {
  action: "POCKET_POSTBACK_FORBIDDEN" | "POCKET_POSTBACK_REJECTED";
  reason: string;
  request: Request;
  eventFingerprint?: string;
};

/**
 * Allow-listed security metadata. Only the route, a bounded reason enum and an
 * optional non-reversible fingerprint are ever stored — never the secret, the
 * auth header, the raw payload, an email, an external account identifier or a
 * database error. AuditLog already records IP/User-Agent separately; this slice
 * does not widen that surface.
 */
async function auditSecurityEvent({ action, reason, request, eventFingerprint }: SecurityAudit) {
  await createAuditLog({
    action,
    entityType: "API_ROUTE",
    entityId: ROUTE,
    metadata: eventFingerprint ? { route: ROUTE, reason, eventFingerprint } : { route: ROUTE, reason },
    request,
  });
}

function firstParam(params: URLSearchParams, names: string[]) {
  for (const name of names) {
    const value = params.get(name);
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function parseAmount(value?: string) {
  if (!value) return undefined;
  const amount = Number(value.replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function buildFallbackEventId(input: {
  clickId?: string;
  traderId?: string;
  type: PocketPostbackType;
  amount?: number;
  dateTime?: string;
}) {
  const fingerprint = [
    input.clickId,
    input.traderId,
    input.type,
    input.amount ?? "",
    input.dateTime ?? "",
  ].join("|");

  return `pocket-${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 32)}`;
}

async function jsonFrom(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function validateQueryShape(params: URLSearchParams) {
  const entries = Array.from(params.entries());
  if (entries.length > MAX_QUERY_PARAMS) return "TOO_MANY_PARAMS";

  for (const [key, value] of entries) {
    if (key.length > MAX_QUERY_KEY_LENGTH || value.length > MAX_QUERY_VALUE_LENGTH) {
      return "PARAM_TOO_LONG";
    }
  }

  return undefined;
}

/**
 * Query params captured for provenance. Authentication material can no longer
 * reach this point (the request is rejected first), but the aliases stay
 * redacted so a legacy caller's secret can never be persisted even in transit.
 */
function sanitizedRawPayload(params: URLSearchParams) {
  const secretKeys = new Set<string>(SECRET_QUERY_KEYS);

  return Object.fromEntries(
    Array.from(params.entries()).map(([key, value]) => [
      key,
      secretKeys.has(key.toLowerCase()) ? "[redacted]" : value,
    ]),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  // 1. Integration gate. Disabled and misconfigured are one indistinguishable
  //    response, and neither reaches the database.
  const config = resolvePocketPostbackConfig();

  if (!config.enabled) {
    return unavailableResponse();
  }

  // 2. Rate limit, before any database work including the audit write.
  const ip = getRequestIp(request);
  const limit = rateLimit(`postback:pocket:${ip}`, RATE_LIMIT);

  if (!limit.allowed) {
    return fail(429, "RATE_LIMITED");
  }

  // 3. Bounded query shape.
  const queryShapeError = validateQueryShape(params);

  if (queryShapeError) {
    return fail(400, queryShapeError);
  }

  // 4. Authentication material must never arrive in the URL.
  if (hasQueryAuthMaterial(params, SECRET_QUERY_KEYS)) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_FORBIDDEN",
      reason: PocketRejectionReason.QueryAuthMaterial,
      request,
    });

    return authFailureResponse();
  }

  // 5-6. Structural header validation, then timing-safe comparison.
  const auth = authenticatePocketRequest(request.headers, config.secret);

  if (!auth.ok) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_FORBIDDEN",
      reason: auth.reason,
      request,
    });

    return authFailureResponse();
  }

  // ---- authenticated boundary ----
  // No business lookup and no domain mutation occurs above this line.

  const clickId = firstParam(params, ["clickid", "click_id"]);
  const goal = firstParam(params, ["goal", "event", "type"])?.toLowerCase();
  const traderId = firstParam(params, ["playerid", "trader_id", "traderId", "user_id"]);
  const eventId = firstParam(params, [
    "externalEventId",
    "event_id",
    "transaction_id",
    "conversion_id",
  ]);
  const amount = parseAmount(firstParam(params, ["sum", "sumdep", "amount", "deposit_amount"]));
  const currency = firstParam(params, ["currency"]) ?? "USD";
  const dateTime = firstParam(params, ["date_time", "datetime", "date"]);
  const type = goal ? goalToPocketType[goal] : undefined;

  if (!type) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: PocketRejectionReason.UnknownGoal,
      request,
    });

    return fail(400, "UNKNOWN_GOAL");
  }

  if (amount === null) {
    return fail(400, "INVALID_AMOUNT");
  }

  if (!clickId) {
    return fail(400, "CLICK_ID_REQUIRED");
  }

  const knownClick = await prisma.exchangeAccount.findFirst({
    where: { clickId },
    select: { id: true, userId: true },
  });

  if (!knownClick) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: PocketRejectionReason.UnknownClickId,
      request,
      eventFingerprint: fingerprintEventId(clickId),
    });

    return fail(404, "UNKNOWN_CLICK_ID");
  }

  const payload = {
    type,
    userId: knownClick.userId,
    trader_id: traderId,
    externalEventId:
      eventId ??
      buildFallbackEventId({
        clickId,
        traderId,
        type,
        amount,
        dateTime,
      }),
    amount,
    currency,
    click_id: clickId,
    site_id: firstParam(params, ["site_id"]),
    cid: firstParam(params, ["cid"]),
    ac: firstParam(params, ["ac"]),
    sub_id1: firstParam(params, ["sub_id1"]),
    sub_id2: firstParam(params, ["sub_id2"]),
    sub_id3: firstParam(params, ["sub_id3"]),
    sub_id4: firstParam(params, ["sub_id4"]),
    sub_id5: firstParam(params, ["sub_id5"]),
    country: firstParam(params, ["country"]),
    promo: firstParam(params, ["promo"]),
    device_type: firstParam(params, ["device_type"]),
    os_version: firstParam(params, ["os_version"]),
    browser: firstParam(params, ["browser"]),
    link_type: firstParam(params, ["link_type"]),
    date_time: dateTime,
    visitor_id: firstParam(params, ["visitor_id"]),
    country_ip: firstParam(params, ["country_ip"]),
    rawPayload: {
      ...sanitizedRawPayload(params),
      securityMode: "header_secret",
    },
  };

  const parsed = receivePostbackSchema.safeParse(payload);

  if (!parsed.success) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: PocketRejectionReason.ValidationError,
      request,
    });

    return fail(400, "VALIDATION_ERROR");
  }

  const response = await processExchangePostbackPayload(parsed.data, request);
  const body = await jsonFrom(response);

  if (!response.ok) {
    // Upstream sees a bounded code only. The processor's own message may name a
    // business entity, so it is deliberately not forwarded.
    return fail(
      response.status,
      response.status === 409 ? "POSTBACK_CONFLICT" : "POSTBACK_REJECTED",
    );
  }

  return respond(200, {
    success: true,
    duplicate: Boolean(body.duplicate),
  });
}
