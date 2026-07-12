import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { forbiddenResponse } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { getPostbackSecret, isPocketPostbackSecretRequired } from "@/lib/env";
import { processExchangePostbackPayload } from "@/lib/exchange/postbackProcessor";
import type { PocketPostbackType } from "@/lib/exchange/pocket";
import { prisma } from "@/lib/prisma";
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

const MAX_QUERY_PARAMS = 40;
const MAX_QUERY_KEY_LENGTH = 80;
const MAX_QUERY_VALUE_LENGTH = 1000;
const SECRET_QUERY_KEYS = new Set(["ow", "secret", "token"]);

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

function fail(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
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

function sanitizedRawPayload(params: URLSearchParams) {
  return Object.fromEntries(
    Array.from(params.entries()).map(([key, value]) => [
      key,
      SECRET_QUERY_KEYS.has(key.toLowerCase()) ? "[redacted]" : value,
    ]),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const queryShapeError = validateQueryShape(params);

  if (queryShapeError) {
    return fail(400, queryShapeError);
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
    await createAuditLog({
      action: "POCKET_POSTBACK_REJECTED",
      entityType: "API_ROUTE",
      entityId: "/api/postbacks/pocket",
      metadata: { reason: "unknown_goal", goal, clickId, traderId },
      request,
    });

    return fail(400, "UNKNOWN_GOAL");
  }

  if (amount === null) {
    return fail(400, "INVALID_AMOUNT");
  }

  const secretRequired = isPocketPostbackSecretRequired();
  const providedSecret =
    request.headers.get("x-postback-secret") ??
    firstParam(params, ["ow", "secret", "token"]);

  if (secretRequired && providedSecret !== getPostbackSecret()) {
    await createAuditLog({
      action: "POCKET_POSTBACK_FORBIDDEN",
      entityType: "API_ROUTE",
      entityId: "/api/postbacks/pocket",
      metadata: { securityMode: "secret", clickId, traderId },
      request,
    });

    return forbiddenResponse();
  }

  if (!clickId) {
    return fail(400, "CLICK_ID_REQUIRED");
  }

  const knownClick = await prisma.exchangeAccount.findFirst({
    where: { clickId },
    select: { id: true, userId: true },
  });

  if (!knownClick) {
    await createAuditLog({
      action: "POCKET_POSTBACK_REJECTED",
      entityType: "API_ROUTE",
      entityId: "/api/postbacks/pocket",
      metadata: {
        securityMode: secretRequired ? "secret" : "no_secret",
        reason: "unknown_clickid",
        clickId,
        traderId,
      },
      request,
    });

    return fail(404, "UNKNOWN_CLICK_ID");
  }

  const rawPayload = sanitizedRawPayload(params);
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
      ...rawPayload,
      securityMode: secretRequired ? "secret" : "no_secret",
    },
  };

  const parsed = receivePostbackSchema.safeParse(payload);

  if (!parsed.success) {
    await createAuditLog({
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: "/api/postbacks/pocket",
      metadata: { details: parsed.error.issues.map((issue) => issue.message) },
      request,
    });

    return fail(400, "VALIDATION_ERROR");
  }

  const response = await processExchangePostbackPayload(parsed.data, request);
  const body = await jsonFrom(response);

  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : "POSTBACK_REJECTED",
      },
      { status: response.status },
    );
  }

  return NextResponse.json({
    success: true,
    duplicate: Boolean(body.duplicate),
  });
}
