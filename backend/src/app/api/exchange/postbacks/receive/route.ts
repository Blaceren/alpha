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
 * G4-H5 — `Registration` AND `First Deposit` ARE NOW BOTH REFUSED HERE.
 *
 * The deep audit found that both reached `processExchangePostbackPayload` and
 * produced no canonical growth event: a POST-shaped Pocket registration or first
 * deposit could move legacy `ExchangeAccount` money state and write a
 * `PostbackEvent` while the growth ledger never heard about it. Fixing the GET
 * receiver and leaving these two here would have left the same shadow path
 * reachable by changing the HTTP method — exactly the mistake the previous wave
 * made in the other direction.
 *
 * They are refused rather than re-routed because this receiver is not the Pocket
 * contract. Pocket sends the `ow` query shape to `/api/postbacks/pocket`, which
 * owns both semantics, is gated per family, uses exact decimal arithmetic and
 * always projects. A second, laxer intake for the same two business facts is the
 * thing being removed.
 *
 * WHAT REMAINS, AND WHY IT IS NOT A HOLE. An ABSENT `type` is still allowed,
 * because this receiver also carries the older `eventType` contract (`deposit`,
 * `trade`, `balance`, `account_connected`, `account_rejected`) used by the
 * SANDBOX/MANUAL exchange provider — a different integration from Pocket,
 * exercised by `scripts/smoke/integrationSmoke.ts` and
 * `scripts/smoke/mvpAcceptanceSmoke.ts`, both of which send `eventType` and no
 * `type` at all. That path is bounded in three ways that matter: it requires the
 * shared `POSTBACK_SECRET`, it CANNOT bind or move a `PocketTraderIdentity` and
 * it CANNOT write a `PocketProviderEvent` — so it cannot create canonical Pocket
 * identity or first-deposit business state — and nothing in the growth layer
 * reads the legacy `Float` columns it does touch. Every DEP figure the CRO/CMO
 * surfaces publish comes from `PocketProviderEvent.normalizedAmount` by way of
 * `GrowthEvent`.
 *
 * §34 of the fix brief asks for an explicit decision per legacy path rather than
 * a blanket one. This is it: Pocket-shaped types are obsolete here and fail
 * closed; the non-Pocket sandbox provider keeps its accepted contract.
 */
function isGrowthV1PostbackType(type: string | undefined): boolean {
  return type === undefined;
}
