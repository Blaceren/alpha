import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import {
  PocketRejectionReason,
  authenticatePocketRequest,
  resolvePocketPostbackConfig,
} from "@/lib/exchange/pocketPostbackAuth";
import { processExchangePostbackPayload } from "@/lib/exchange/postbackProcessor";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import { receivePostbackSchema, validateJsonBody } from "@/lib/validation";

/**
 * DEVMECH-1 — the legacy postback intake, brought onto the single Pocket trust
 * boundary.
 *
 * WHAT WAS WRONG WITH IT
 * This route predates the hardened Pocket intake and had drifted into being a
 * weaker parallel path to the same money:
 *
 *   * it compared the secret with `secret !== getPostbackSecret()` — a plain
 *     string comparison, so the number of matching leading bytes was
 *     observable in the response time;
 *   * `getPostbackSecret()` falls back to a **development constant** when
 *     `POSTBACK_SECRET` is unset, so an unconfigured deployment authenticated
 *     against a value published in the source tree;
 *   * it was **not gated by `POCKET_POSTBACK_ENABLED`**, so disabling the
 *     Pocket integration disabled the hardened route and left this one open;
 *   * it reached `processExchangePostbackPayload`, which mutates
 *     `ExchangeAccount` money state.
 *
 * Together those made "Pocket postbacks are disabled" untrue at the platform
 * level, however carefully the hardened route was written.
 *
 * WHAT IT IS NOW
 * The same boundary as `GET /api/postbacks/pocket`: the same
 * `POCKET_POSTBACK_ENABLED` gate, the same `POSTBACK_SECRET` (there is exactly
 * one Pocket postback secret and this route does not introduce another), the
 * same timing-safe comparison helper, and a rate limit applied before any
 * database work. No mutation, no lookup and no identity-bearing audit happens
 * before authentication succeeds.
 *
 * WHAT IT STILL CANNOT DO
 * Bind or change a `PocketTraderIdentity`. Identity binding is reachable only
 * from the authenticated registration path on the Pocket route, and this route
 * does not call it — a deposit or withdrawal delivered here can never create,
 * move or erase the identity the L4 checkpoint depends on.
 */
const ROUTE = "/api/exchange/postbacks/receive";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

/** One indistinguishable rendering for every authentication failure. */
function authFailureResponse() {
  return NextResponse.json(
    { success: false, error: "FORBIDDEN" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/** Disabled and misconfigured share one response, so neither is an oracle. */
function unavailableResponse() {
  return NextResponse.json(
    { success: false, error: "POCKET_POSTBACK_UNAVAILABLE" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // 1. Integration gate. Disabling Pocket now disables EVERY Pocket intake.
  const config = resolvePocketPostbackConfig();

  if (!config.enabled) {
    return unavailableResponse();
  }

  // 2. Rate limit, before any database work including the audit write, so the
  //    secret cannot be probed at unbounded rates.
  const ip = getRequestIp(request);
  const limit = rateLimit(`postback:receive:${ip}`, RATE_LIMIT);

  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: "RATE_LIMITED" },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 3. Structural header validation, then the length-independent timing-safe
  //    comparison. Missing, malformed, ambiguous and wrong secrets are all
  //    indistinguishable to the caller; the precise reason is audited only.
  const auth = authenticatePocketRequest(request.headers, config.secret);

  if (!auth.ok) {
    await createAuditLog({
      action: "POCKET_POSTBACK_FORBIDDEN",
      entityType: "API_ROUTE",
      entityId: ROUTE,
      metadata: { route: ROUTE, reason: auth.reason },
      request,
    });

    return authFailureResponse();
  }

  // ---- authenticated boundary ----
  // No business lookup and no domain mutation occurs above this line.

  const parsed = await validateJsonBody(request, receivePostbackSchema);

  if (!parsed.success) {
    await createAuditLog({
      action: "POCKET_POSTBACK_REJECTED",
      entityType: "API_ROUTE",
      entityId: ROUTE,
      metadata: { route: ROUTE, reason: PocketRejectionReason.ValidationError },
      request,
    });

    return parsed.response;
  }

  // G4-GROWTH — the Growth V1 type boundary, applied to the SECOND receiver too.
  //
  // WHY THIS IS HERE. `receivePostbackSchema` accepts a nine-member `type` enum
  // including `Withdrawal`, `Commission`, `Successful Withdrawal` and
  // `Canceled Withdrawal`, and `processExchangePostbackPayload` below mutates
  // `ExchangeAccount` money state according to whichever the CALLER named. The
  // GET receiver's alias table was the loudest instance of that defect, but it
  // was never the only one: fixing one receiver and leaving the other would have
  // left the same capability reachable by changing the HTTP method.
  //
  // THE SCHEMA IS DELIBERATELY NOT NARROWED. It is shared with the simulator and
  // with the processor's own type inference, and rewriting it would change
  // surfaces this phase has no mandate over. The boundary belongs at the
  // receiver, which is what decides what a remote caller may ask for.
  if (!isGrowthV1PostbackType(parsed.data.type)) {
    await createAuditLog({
      action: "POCKET_POSTBACK_REJECTED",
      entityType: "API_ROUTE",
      entityId: ROUTE,
      // A bounded reason. The refused type is NOT echoed: it came from the
      // caller, and reflecting caller input into an audit row is how an
      // injection sink starts.
      metadata: { route: ROUTE, reason: "unsupported_growth_v1_type" },
      request,
    });

    return NextResponse.json(
      { success: false, error: "UNSUPPORTED_GOAL" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  return processExchangePostbackPayload(parsed.data, request);
}

/**
 * The only postback `type` values this receiver may dispatch.
 *
 * `Re-deposit` is absent for the same reason it is absent from the GET
 * receiver's map: redeposits are owned by the typed Growth V1 handler, which
 * uses exact decimal arithmetic and refuses to emit a canonical event it cannot
 * identify — neither of which is true of the legacy processor's `Float` path.
 * `Withdrawal`, `Commission` and both withdrawal-outcome types are absent
 * because §17 forbids them on a trusted Growth V1 receiver outright.
 *
 * WHAT THIS DOES NOT CLOSE, STATED PLAINLY. An ABSENT `type` is allowed through,
 * because this receiver also carries the older `eventType` contract
 * (`deposit`, `trade`, `balance`, `account_connected`, `account_rejected`) used
 * by the SANDBOX/MANUAL exchange provider — a different integration from Pocket,
 * exercised by `scripts/smoke/integrationSmoke.ts` and
 * `scripts/smoke/mvpAcceptanceSmoke.ts`. `eventType: "deposit"` with a
 * caller-supplied `externalEventId` still reaches `ExchangeAccount.depositAmount`
 * and `totalDeposits`, which are legacy `Float` columns.
 *
 * That path is deliberately left working rather than broken in an implementation
 * wave, because an accepted integration depends on it and §17 asks that this be
 * checked before deleting anything. It is bounded in three ways that matter
 * here: it requires the shared `POSTBACK_SECRET`, it cannot bind or move a
 * `PocketTraderIdentity`, and NOTHING in the G4 growth layer reads those Float
 * columns — every DEP figure the CRO/CMO surfaces publish comes from
 * `PocketProviderEvent.normalizedAmount` by way of `GrowthEvent`.
 *
 * It is carried to the deep-audit handoff as an open item rather than silently
 * accepted.
 */
function isGrowthV1PostbackType(type: string | undefined): boolean {
  return type === undefined || type === "Registration" || type === "First Deposit";
}
