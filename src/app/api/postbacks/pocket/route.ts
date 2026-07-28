import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import {
  POCKET_FORBIDDEN_QUERY_SECRET_KEYS,
  POCKET_POSTBACK_QUERY_SECRET_KEY,
  PocketRejectionReason,
  authenticatePocketQuerySecret,
  authenticatePocketRequest,
  fingerprintEventId,
  goalAcceptsQuerySecret,
  hasQueryAuthMaterial,
  parsePocketRegistrationFields,
  readPostbackGoalForAuthMode,
  resolvePocketPostbackConfig,
} from "@/lib/exchange/pocketPostbackAuth";
import { bindPocketTraderIdentity } from "@/lib/exchange/pocketTraderIdentity";
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
 * Every query key that may carry a secret, for REDACTION purposes.
 *
 * Declared here, in the route itself, because the secret auditor
 * (scripts/security/sqlAuditCore.ts) proves this file covers every alias. All
 * three are stripped from anything that could be persisted or echoed — the
 * official `ow` included, precisely because PDP-1 now accepts it.
 *
 * REDACTION is not the same list as REJECTION. `secret` and `token` were legacy
 * ATA aliases with no provider mandate and remain rejected outright
 * (`POCKET_FORBIDDEN_QUERY_SECRET_KEYS`); `ow` is Pocket's official field and is
 * accepted only for the goals in `POCKET_QUERY_SECRET_GOALS`.
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

/**
 * PDP-1 — the official direct Pocket registration postback, past authentication.
 *
 * Pocket → ATA → PocketTraderIdentity, with no intermediary. The response is
 * deliberately the smallest thing that can mean "received": a bounded
 * `{ ok: true }` that is byte-identical whether the binding was created, was
 * already present, or conflicted. An upstream postback sender has no business
 * learning whether a clickid exists, whether a trader is already bound, or to
 * whom — and an attacker who has stolen the secret must not be handed an
 * enumeration oracle on top of it.
 *
 * Conflicts and validation failures are recorded for operators through the
 * existing bounded AuditLog reasons, never through the response body.
 */
async function handleDirectRegistration(params: URLSearchParams, request: Request) {
  const fields = parsePocketRegistrationFields(params);

  if (!fields.ok) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: fields.reason,
      request,
    });

    return fail(400, "INVALID_REGISTRATION");
  }

  const learner = await prisma.exchangeAccount.findFirst({
    where: { clickId: fields.clickId },
    select: { userId: true },
  });

  if (!learner) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: PocketRejectionReason.UnknownClickId,
      request,
      // Non-reversible: an operator can correlate a support report without the
      // raw attribution identifier ever entering the audit trail.
      eventFingerprint: fingerprintEventId(fields.clickId),
    });

    // The same bounded 400 an invalid field shape produces, so a caller cannot
    // distinguish "this clickid is unknown" from "this clickid is malformed".
    return fail(400, "INVALID_REGISTRATION");
  }

  const result = await bindPocketTraderIdentity({
    userId: learner.userId,
    pocketUserId: fields.playerId,
    clickId: fields.clickId,
    db: prisma,
  });

  // `bound` and `already_bound` are the two expected outcomes and are silent;
  // everything else is a conflict an operator should be able to see.
  if (result.outcome !== "bound" && result.outcome !== "already_bound") {
    await createAuditLog({
      action: "POCKET_IDENTITY_BINDING_REJECTED",
      entityType: "PocketTraderIdentity",
      entityId: String(learner.userId),
      metadata: { route: ROUTE, reason: result.outcome },
      request,
    });
  }

  return respond(200, { ok: true });
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

  // 4. Choose the authentication mode from the goal alone.
  //
  //    PDP-1: Pocket's official DIRECT postback carries its shared secret as the
  //    `ow` query parameter, so a registration event authenticates that way.
  //    Everything else — every event that moves money — still requires the
  //    stronger `x-postback-secret` header, and still rejects URL-borne secrets
  //    outright. Reading `goal` here is a pure string read: no lookup, no write
  //    and no audit happens before authentication succeeds.
  const authGoal = readPostbackGoalForAuthMode(params);
  const directRegistration = goalAcceptsQuerySecret(authGoal);

  // The legacy aliases have no provider mandate and are never acceptable. For
  // non-registration goals `ow` joins them, preserving the header-only contract
  // for financial events exactly as PS-1/PS-2 established it.
  const forbiddenQueryKeys = directRegistration
    ? POCKET_FORBIDDEN_QUERY_SECRET_KEYS
    : SECRET_QUERY_KEYS;

  if (hasQueryAuthMaterial(params, forbiddenQueryKeys)) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_FORBIDDEN",
      reason: PocketRejectionReason.QueryAuthMaterial,
      request,
    });

    return authFailureResponse();
  }

  // 5-6. Structural validation, then timing-safe comparison. A registration may
  //      present EITHER the official `ow` query secret OR the header, so an
  //      existing header-based integration keeps working unchanged.
  const usedQuerySecret =
    directRegistration && params.has(POCKET_POSTBACK_QUERY_SECRET_KEY);

  const auth = usedQuerySecret
    ? authenticatePocketQuerySecret(params, config.secret)
    : authenticatePocketRequest(request.headers, config.secret);

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

  // 7. PDP-1 direct registration: strict, single-spelling field validation and
  //    an identity binding that is the whole point of the event.
  //
  //    Scoped to requests that actually authenticated with the official `ow`
  //    secret — i.e. the direct Pocket contract. A header-authenticated
  //    `goal=reg` is an existing ATA/affiliate integration and continues down
  //    the legacy path below with its established response shape, so nothing
  //    that works today changes.
  if (usedQuerySecret) {
    return handleDirectRegistration(params, request);
  }

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

  // L4PA-1 — authoritative Pocket identity binding.
  //
  // Only here: past the enabled gate, the rate limit, the query-shape bound, the
  // URL-auth-material rejection and the timing-safe header secret, and only
  // after the clickid resolved to a real learner and the event itself was
  // accepted. A registration postback is the single trusted source of the Pocket
  // trader id the Partner API is later asked about.
  //
  // The binding NEVER affects this response. A conflict is a security fact for
  // an operator, not something an upstream caller may probe by watching status
  // codes, so every outcome still returns the same 200 the postback earned.
  if (type === "Registration" && traderId) {
    await bindRegistrationIdentity({
      userId: knownClick.userId,
      pocketUserId: traderId,
      clickId,
      request,
    });
  }

  return respond(200, {
    success: true,
    duplicate: Boolean(body.duplicate),
  });
}

/**
 * Record the learner-to-Pocket binding, auditing anything that is not routine.
 *
 * `bound` is the expected first-registration outcome and `already_bound` is an
 * ordinary replay; neither is audited, because auditing every duplicate
 * postback would bury the events that matter. A conflict, a malformed
 * identifier or an unexpected failure IS audited — with a bounded reason only,
 * never the claimed Pocket id, the clickid or a database error.
 *
 * A failure here never fails the postback: the financial event was already
 * accepted and committed, and reversing it because an identity could not be
 * recorded would lose a real event to protect a derived one.
 */
async function bindRegistrationIdentity(input: {
  userId: number;
  pocketUserId: string;
  clickId: string;
  request: Request;
}) {
  try {
    const result = await bindPocketTraderIdentity({
      userId: input.userId,
      pocketUserId: input.pocketUserId,
      clickId: input.clickId,
      db: prisma,
    });

    if (result.outcome === "bound" || result.outcome === "already_bound") return;

    await createAuditLog({
      action: "POCKET_IDENTITY_BINDING_REJECTED",
      entityType: "PocketTraderIdentity",
      entityId: String(input.userId),
      metadata: { route: ROUTE, reason: result.outcome },
      request: input.request,
    });
  } catch {
    // The thrown value is deliberately not inspected: a Prisma error can quote
    // the conflicting row, and this path must not be the way an identifier
    // reaches a log.
    await createAuditLog({
      action: "POCKET_IDENTITY_BINDING_REJECTED",
      entityType: "PocketTraderIdentity",
      entityId: String(input.userId),
      metadata: { route: ROUTE, reason: "binding_error" },
      request: input.request,
    }).catch(() => undefined);
  }
}
