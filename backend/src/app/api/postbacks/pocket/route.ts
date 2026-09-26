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
  hasQueryAuthMaterial,
  parsePocketDepositFields,
  parsePocketRegistrationFields,
  readPostbackGoalForAuthMode,
  resolvePocketPostbackConfig,
} from "@/lib/exchange/pocketPostbackAuth";
import { resolveGrowthV1Goal } from "@/lib/growth/pocket/goal-allowlist";
import {
  isPocketDepIngestEnabled,
  isPocketRdepIngestEnabled,
  isPocketRegIngestEnabled,
} from "@/lib/growth/ingress-config";
import { ingestPocketRedeposit } from "@/lib/growth/pocket/redeposit";
import {
  bindPocketIdentityCanonical,
  bindingEstablishedIdentity,
} from "@/lib/growth/pocket/identity-authority";
import { recordProviderIngressSafely } from "@/lib/growth/pocket/ingress";
import {
  POCKET_CALLBACK_AUTH_FAILURE_LIMIT,
  POCKET_CALLBACK_RATE_LIMIT,
  pocketCallbackAuthFailureKey,
  pocketCallbackRateKey,
} from "@/lib/growth/pocket/rate-policy";
import { parsePocketDepositAmount } from "@/lib/exchange/pocketDepositAmount";
import {
  isPocketFirstDepositEnabled,
  resolvePocketFirstDepositConfig,
} from "@/lib/exchange/pocketFirstDepositConfig";
import {
  ingestPocketFirstDeposit,
  reconcileFirstDepositAfterRegistration,
} from "@/lib/exchange/pocketFirstDeposit";
import { reconcilePocketRegistrationLevelCompletion } from "@/lib/curriculum/pocket-registration-completion";
import type { PocketIdentityBindResult } from "@/lib/exchange/pocketTraderIdentity";
import { processExchangePostbackPayload } from "@/lib/exchange/postbackProcessor";
import type { PocketPostbackType } from "@/lib/exchange/pocket";
import { prisma } from "@/lib/prisma";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import { receivePostbackSchema } from "@/lib/validation";

/**
 * G4-GROWTH — the goals the LEGACY header-authenticated path may still dispatch.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WAS THE PROBLEM. This map had FOURTEEN
 * entries, including `commission`, `withdrawal`, `successful_withdrawal` and
 * `canceled_withdrawal`. Every one of them reached
 * `processExchangePostbackPayload`, which mutates `ExchangeAccount` money state
 * — and the caller chose which by sending a string. One authenticated request
 * could therefore select any financial behaviour the processor implemented.
 *
 * G4-H5 — WHY `dep` IS NOW GONE TOO. The deep audit proved that a
 * header-authenticated `goal=dep` reached the legacy `Float` processor, moved
 * `ExchangeAccount.depositAmount`/`totalDeposits`, wrote a `PostbackEvent`, and
 * produced NEITHER a `PocketProviderEvent` NOR a canonical `dep` growth event. So
 * a real Pocket deposit could be taken on a path the growth ledger — and every
 * DEP figure the CRO/CMO surfaces publish — never heard about. That is the
 * "shadow money path" §31 of the fix brief forbids.
 *
 * It is closed by REMOVAL rather than by re-routing. Routing it into
 * `ingestPocketFirstDeposit` would have made a legacy header request able to
 * write canonical provider-event money while `POCKET_DEP_INGEST_ENABLED` was off,
 * which is a wider capability than the flag contract grants. The typed `ow`
 * contract — the shape Pocket actually sends — is now the SOLE Pocket
 * first-deposit intake, it is gated on its own switch, it uses exact decimal
 * arithmetic, and it always emits the canonical event.
 *
 * WHAT REMAINS. One goal: `reg`. It is the only legacy Pocket semantic with an
 * accepted, tested contract that this receiver still owns, and as of this wave it
 * runs through the SAME canonical domain authority the `ow` path uses, so it can
 * no longer bind an identity without projecting it.
 *
 * WHERE WITHDRAWAL AND COMMISSION WENT. Nowhere: `postbackProcessor` still
 * implements them for owners that legitimately need them. What changed is that
 * NO Pocket receiver can reach them.
 */
const goalToPocketType: Record<string, PocketPostbackType> = {
  reg: "Registration",
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

// G4-GROWTH — a PROVIDER budget, not a consumer one. See rate-policy.ts: a
// login-shaped ceiling would throttle the whole integration during a catch-up
// burst, and the events it refused would be real conversions. Authentication
// failures are additionally bounded by a much tighter separate budget, so
// raising this ceiling does not raise the rate at which a secret can be probed.
const RATE_LIMIT = POCKET_CALLBACK_RATE_LIMIT;

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
    select: { id: true, userId: true },
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

  // G4-H5 — the canonical domain operation. Binding and `pocket_reg` emission are
  // one operation now, so no receiver can create the binding without the event.
  //
  // The ingress evidence row is written BEFORE the binding rather than after, so
  // the canonical event can name the delivery it arrived on. Evidence is a
  // measurement and cannot fail the postback (`recordProviderIngressSafely`).
  const ingress = await recordProviderIngressSafely(prisma, {
    goal: "reg",
    params,
    receivedAt: new Date(),
    // Provisional: the delivery arrived and validated. Corrected below once the
    // binding outcome is known.
    processingStatus: "accepted_processed",
    playerIdNormalized: fields.playerId,
    clickId: fields.clickId,
  });

  const canonical = await bindPocketIdentityCanonical({
    userId: learner.userId,
    pocketUserId: fields.playerId,
    clickId: fields.clickId,
    db: prisma,
    ingressEventId: ingress?.id ?? null,
  });
  const result = canonical.binding;

  await settleRegistrationIngress(ingress?.id ?? null, result);

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

  // DEVACT-1 — record the registration as product state, not only as identity.
  //
  // The direct `ow` path bound the identity and stopped there, so a learner who
  // completed the OFFICIAL Pocket registration still read as `registrationStatus
  // = false` everywhere — CRM included. The header-authenticated path has always
  // set it (via buildPostbackAccountUpdate), so the two spellings of "the same
  // event happened" disagreed, and the one that will actually be used in
  // production was the one that under-reported.
  //
  // Deliberately narrow: registration status and a durable receipt only. No XP,
  // no progression reward, no level completion, no balance, and the identity
  // binding above is untouched — a conflicting binding still leaves the original
  // identity in place while the account still records that a registration
  // arrived.
  if (result.outcome === "bound" || result.outcome === "already_bound") {
    await prisma.exchangeAccount.update({
      where: { id: learner.id },
      data: { registrationStatus: true, status: "connected", rejectionReason: null },
    });

    await prisma.postbackEvent.create({
      data: {
        exchangeAccountId: learner.id,
        // Pocket documents no transaction identifier for a registration, and a
        // fabricated one would be a lie about provenance. Registration is not
        // monetary, so nothing depends on deduplicating it.
        externalEventId: null,
        type: "Registration",
        eventType: "registration",
        normalizedEventType: "registration",
        traderId: fields.playerId,
        clickId: fields.clickId,
        status: "processed",
        rawPayload: "{}",
        processedAt: new Date(),
      },
    });
  }

  // L1OWNER-1 — the legal Level 1 completion.
  //
  // Reached only after the enabled gate, the rate limit, the timing-safe `ow`
  // authentication, strict field validation, clickid resolution and a
  // successful (or identically idempotent) identity binding. The reconciliation
  // service re-verifies every one of those facts from durable state before it
  // completes anything, so nothing here is trusted on the strength of having
  // got this far.
  //
  // Deliberately NOT gated on `result.outcome === "bound"`: a request can bind
  // the identity and then fail before completing, and gating on "newly created"
  // would strand that learner forever. An identical replay must reconcile.
  if (result.outcome === "bound" || result.outcome === "already_bound") {
    const reconciled = await reconcilePocketRegistrationLevelCompletion(learner.userId);

    // A transient failure must not be reported as a final success: Pocket's
    // retry is the recovery path, and an identical replay reconciles.
    if (reconciled.outcome === "transient_failure") {
      await createAuditLog({
        action: "POCKET_REGISTRATION_LEVEL_RECONCILE_DEFERRED",
        entityType: "API_ROUTE",
        entityId: ROUTE,
        metadata: { route: ROUTE, outcome: reconciled.outcome },
        request,
      });
      return respond(503, { ok: false });
    }
  }

  // AFD-4 — reconcile a deposit that arrived BEFORE this registration.
  //
  // Placed last, after the identity binding and the Level 1 completion have both
  // committed on their own merits. A deposit is a measurement; it must never be
  // able to fail a registration, roll back an identity binding or undo a level
  // completion, so it runs outside their transaction and swallows its own
  // failures. Nothing is lost when it does: the operator command re-reaches the
  // same pending rows, and reconciliation is idempotent by construction.
  if (result.outcome === "bound" || result.outcome === "already_bound") {
    await reconcileFirstDepositAfterRegistration(prisma, fields.playerId);
  }

  // G4-H5 — the canonical `pocket_reg` event was emitted by
  // `bindPocketIdentityCanonical` above, in the same domain operation as the
  // binding it projects. There is deliberately no second emitter call here: a
  // receiver that can bind without projecting is the defect this wave closed.

  return respond(200, { ok: true });
}

/**
 * G4-H5 — record how the registration delivery was finally treated.
 *
 * The evidence row is written before the binding so the canonical event can point
 * at it, which means its status starts optimistic and is corrected here. A failure
 * to correct it is swallowed for the same reason the write itself is: evidence is
 * a measurement and must not fail a binding that already committed.
 */
async function settleRegistrationIngress(
  ingressEventId: number | null,
  result: PocketIdentityBindResult,
): Promise<void> {
  if (ingressEventId === null) return;

  const established = bindingEstablishedIdentity(result);
  try {
    await prisma.providerIngressEvent.update({
      where: { id: ingressEventId },
      data: {
        processingStatus:
          result.outcome === "bound"
            ? "accepted_processed"
            : result.outcome === "already_bound"
              ? "accepted_duplicate"
              : "quarantined",
        rejectionCode: established ? null : "player_conflict",
      },
    });
  } catch {
    // Bounded on purpose: a Prisma error can quote the conflicting row.
  }
}

/**
 * AFD-4 — the official direct Pocket FIRST DEPOSIT postback, past authentication.
 *
 * WHAT THIS HANDLER MAY NOT DO. It never binds a Pocket identity, never completes
 * a level, never unlocks a level, never awards XP and never records a balance.
 * `goal=reg` remains the sole owner of all of those, and the database itself
 * enforces the identity half: `PocketTraderIdentity.source` is constrained to
 * `registration_postback`.
 *
 * ONE RESPONSE FOR EVERY BUSINESS OUTCOME. Matched, pending, replayed and
 * quarantined all return the same bounded `{ ok: true }`. An upstream postback
 * sender has no business learning whether a click id exists, whether a player is
 * already registered, whose learner a deposit landed on, or whether its delivery
 * disagreed with an earlier one — and an attacker holding a stolen `ow` must not
 * be handed an enumeration oracle on top of it.
 *
 * A CONFLICT IS ACKNOWLEDGED, NOT REJECTED. Returning an error for a business
 * conflict would make Pocket retry an event that can never succeed, forever. The
 * conflict is durable in the provider event row and in one bounded audit entry,
 * which is where an operator should learn about it — not through a status code
 * that also drives a retry storm.
 */
async function handleDirectFirstDeposit(params: URLSearchParams, request: Request) {
  const fields = parsePocketDepositFields(params);

  if (!fields.ok) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: fields.reason,
      request,
    });

    return fail(400, "INVALID_DEPOSIT");
  }

  // Exact decimal, never a float. See pocketDepositAmount.ts for why.
  const amount = parsePocketDepositAmount(fields.sum);

  if (!amount.ok) {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: PocketRejectionReason.InvalidAmount,
      request,
    });

    // Deliberately the same bounded body a malformed field produces: the amount
    // is not echoed back and its rejection reason is not disclosed.
    return fail(400, "INVALID_DEPOSIT");
  }

  // Re-resolved here rather than trusted from the gate above, so the currency
  // stamped on the row comes from a single authoritative read.
  const resolution = resolvePocketFirstDepositConfig();

  if (resolution.kind !== "resolved" || !resolution.config.enabled) {
    return unavailableResponse();
  }

  const result = await ingestPocketFirstDeposit(prisma, {
    pocketClickId: fields.clickId,
    pocketPlayerId: fields.playerId,
    normalizedAmount: amount.normalized,
    currency: resolution.config.currency,
    now: new Date(),
  });

  if (result.outcome === "unknown_click") {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: PocketRejectionReason.UnknownClickId,
      request,
      // Non-reversible: an operator can correlate a support report without the
      // raw click id ever entering the audit trail.
      eventFingerprint: fingerprintEventId(fields.clickId),
    });

    // The same bounded 400 a malformed field produces, so a caller cannot
    // distinguish "unknown click" from "malformed click".
    return fail(400, "INVALID_DEPOSIT");
  }

  // G4-GROWTH — durable ingress evidence for the deposit delivery.
  //
  // The canonical `dep` growth event is NOT written here: it is emitted inside
  // `emitFirstDepositConversion`, in the same transaction as the affiliate
  // conversion row, so the two ledgers cannot disagree about whether a deposit
  // happened. This call records only that a delivery arrived and how it was
  // treated, and it cannot fail the postback.
  await recordProviderIngressSafely(prisma, {
    goal: "dep",
    params,
    receivedAt: new Date(),
    processingStatus:
      result.outcome === "matched"
        ? "accepted_processed"
        : result.outcome === "pending_identity"
          ? "accepted_pending_linkage"
          : result.outcome === "replayed" || result.outcome === "unchanged_pending"
            ? "accepted_duplicate"
            : "quarantined",
    rejectionCode:
      result.outcome === "conflict"
        ? result.conflictCode === "identity_owner_mismatch"
          ? "identity_owner_mismatch"
          : "player_conflict"
        : null,
    playerIdNormalized: fields.playerId,
    clickId: fields.clickId,
    amount: amount.normalized,
  });

  // Only conflicts are audited. A successful replay is ordinary transport
  // behaviour and auditing every one of them would bury the events that matter
  // under unbounded noise — the replay counter on the row already records it.
  if (result.outcome === "conflict") {
    await createAuditLog({
      action: "POCKET_FIRST_DEPOSIT_CONFLICT",
      entityType: "PocketProviderEvent",
      entityId: String(result.providerEventId ?? ""),
      // A bounded reason only. No click id, no player id, no amount.
      metadata: { route: ROUTE, reason: result.conflictCode ?? "conflict" },
      request,
    });
  }

  return respond(200, { ok: true });
}

/**
 * G4-GROWTH — the official direct Pocket REDEPOSIT postback, past authentication.
 *
 * WHAT THIS HANDLER MAY NOT DO. It never binds a Pocket identity, never
 * completes a level, never awards XP, never records a balance, and never creates
 * or modifies a FIRST deposit. `goal=reg` owns identity and `goal=dep` owns the
 * first deposit, and neither is reachable from here.
 *
 * WHAT IT DOES. Records durable, sanitized evidence AND emits a canonical
 * redeposit, keyed on the identity ATA derives from the authenticated provider
 * attributes. It no longer stops at evidence: this text used to say it did,
 * "because Pocket supplies no unique event identifier and ATA therefore cannot
 * tell a retried delivery from a genuinely new deposit", which was the
 * superseded design. A retry now reproduces the same derived key and is
 * recognised rather than double-counted.
 *
 * `identity_unresolved` survives as a NARROWER terminal state: a delivery whose
 * identity could not be DERIVED, typically for want of a usable provider event
 * time. Still an honest outcome, not an error.
 *
 * ONE RESPONSE FOR EVERY BUSINESS OUTCOME. Emitted, unresolved, pending linkage
 * and quarantined all return the same bounded `{ ok: true }`, for exactly the
 * reason the deposit handler does: an upstream sender has no business learning
 * whether a player exists, whether a first deposit preceded this one, or whose
 * learner it landed on, and an attacker holding a stolen `ow` must not be handed
 * an enumeration oracle on top of it.
 *
 * A MALFORMED DELIVERY IS 400. Unlike a business outcome, a schema failure is
 * the caller's to fix and telling them so does not disclose business state.
 */
async function handleDirectRedeposit(params: URLSearchParams, request: Request) {
  const result = await ingestPocketRedeposit(prisma, { params, now: new Date() });

  if (result.kind === "rejected") {
    await auditSecurityEvent({
      action: "POCKET_POSTBACK_REJECTED",
      reason: PocketRejectionReason.ValidationError,
      request,
    });

    // The same bounded body every malformed field produces. The specific reason
    // is durable in the ingress row, which is where an operator reads it.
    return fail(400, "INVALID_REDEPOSIT");
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
  const limit = rateLimit(pocketCallbackRateKey(ip), RATE_LIMIT);

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
  //    AFD-4 extends this by exactly one goal: `dep` may also authenticate with
  //    `ow`, and ONLY while first-deposit ingestion is switched on. Every other
  //    financial goal is unaffected and still rejects URL-borne secrets.
  //
  //    G4-GROWTH generalises that rule instead of adding a third special case.
  //    The `ow` contract is open to exactly the three Growth V1 goals, and each
  //    one only while ITS OWN switch is on. `reg` is no longer unconditional:
  //    §16 requires that enabling one family cannot enable another, and the
  //    registration family now has a switch like the other two.
  const authGoal = readPostbackGoalForAuthMode(params);
  const growthGoalForAuth = resolveGrowthV1Goal(params);
  const enabledGrowthGoals = {
    reg: isPocketRegIngestEnabled(),
    dep: isPocketDepIngestEnabled(),
    redep: isPocketRdepIngestEnabled(),
  } as const;

  // A Growth V1 goal offered on the query contract while ITS feature is off is
  // answered "unavailable", not "forbidden". 403 would send an operator hunting
  // for a secret mismatch that does not exist, and — unlike a rejection — 503 is
  // retry-safe, so an event delivered during a rollout window is not lost. It
  // reveals only that a feature is off, which step 1 already reveals for the
  // integration as a whole, and it happens before any lookup or write.
  //
  // Checked on the presence of `ow`, so this branch describes only callers that
  // actually attempted the direct contract.
  if (
    growthGoalForAuth.kind === "supported" &&
    !enabledGrowthGoals[growthGoalForAuth.goal] &&
    params.has(POCKET_POSTBACK_QUERY_SECRET_KEY)
  ) {
    return unavailableResponse();
  }

  const directRegistration =
    growthGoalForAuth.kind === "supported" && enabledGrowthGoals[growthGoalForAuth.goal];

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
    // G4-GROWTH — the tight budget, consumed only by FAILURES.
    //
    // The accepted-traffic ceiling above is deliberately high so a provider
    // catch-up burst is never refused. That would, on its own, also raise the
    // rate at which somebody could hunt for the secret — so failures draw from
    // their own far smaller budget, in a separate namespace. A correctly
    // configured provider never touches it.
    //
    // Charged BEFORE the audit write, so a flood of wrong secrets cannot turn
    // the audit log into the amplifier.
    const failures = rateLimit(
      pocketCallbackAuthFailureKey(ip),
      POCKET_CALLBACK_AUTH_FAILURE_LIMIT,
    );

    if (!failures.allowed) {
      return fail(429, "RATE_LIMITED");
    }

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
    // G4-GROWTH — typed dispatch on an explicit allowlist, with a SEPARATE
    // switch per family.
    //
    // Three handlers, three owners, no shared mutation path: registration binds
    // identity and completes Level 1 and never touches money; first deposit
    // records money and never touches identity or progression; redeposit records
    // evidence and refuses to emit a canonical event it cannot identify.
    //
    // `resolveGrowthV1Goal` re-reads the goal from the query rather than trusting
    // `authGoal`, so the string that selected the AUTH MODE and the string that
    // selects the HANDLER are derived by the same rules from the same source — a
    // request cannot present one goal to the authenticator and another to the
    // dispatcher.
    const growthGoal = resolveGrowthV1Goal(params);

    if (growthGoal.kind !== "supported") {
      await auditSecurityEvent({
        action: "POCKET_POSTBACK_REJECTED",
        reason: PocketRejectionReason.UnknownGoal,
        request,
      });
      return fail(400, "UNSUPPORTED_GOAL");
    }

    // Each family is gated on its own switch. Disabled is 503 and not 403: a
    // disabled feature is not an authentication failure, and 503 is retry-safe
    // so a delivery during a rollout window is not lost.
    switch (growthGoal.goal) {
      case "reg":
        if (!isPocketRegIngestEnabled()) return unavailableResponse();
        return handleDirectRegistration(params, request);
      case "dep":
        if (!isPocketDepIngestEnabled()) return unavailableResponse();
        return handleDirectFirstDeposit(params, request);
      case "redep":
        if (!isPocketRdepIngestEnabled()) return unavailableResponse();
        return handleDirectRedeposit(params, request);
    }
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

  // POCKET-REG-INGRESS-1 — the REG family switch applies to EVERY receiver
  // channel, the legacy header one included.
  //
  // ingress-config.ts states the rule this route must implement: "A family is
  // enabled only when the MASTER gate and its OWN switch are both on", and
  // "turning POCKET_POSTBACK_ENABLED=true on its own no longer admits
  // goal=reg". The `ow` channel honoured that; this legacy branch did not — a
  // header-authenticated `goal=reg` still bound an identity, projected the
  // canonical event and mutated ExchangeAccount state with the master on and
  // the REG family off. While the receiver was loopback-only that gap was
  // unreachable in practice; the moment this route is publicly routable, "REG
  // is disabled" must mean disabled on every channel, or disabling the family
  // fails open for anyone holding the header secret.
  //
  // Same refusal the `ow` channel gives a disabled family: 503, before any
  // lookup or write. Not 403 — the secret was fine; the feature is off — and
  // 503 is retry-safe, so a delivery during a rollout window is not lost. In
  // the intended operating states this branch is invisible: with the master
  // off everything is already 503, and activation sets the master and the REG
  // family together.
  if (type === "Registration" && !isPocketRegIngestEnabled()) {
    return unavailableResponse();
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
    // DEVACT-1 — the provider's identifier only, never a derived one.
    //
    // This used to fall back to a SHA-256 of
    // clickId|traderId|type|amount|dateTime. That is a forbidden deduplication
    // key in both directions: two legitimate same-amount deposits in the same
    // second collapse into one, and a redelivery whose timestamp differs looks
    // like a new deposit. `undefined` here means the processor records the
    // event without applying accounting — see PROVIDER_EVENT_IDENTITY_MISSING.
    externalEventId: eventId,
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
 *
 * G4-H5 — THIS IS THE LEGACY HEADER PATH, AND IT NOW PROJECTS. It used to call
 * `bindPocketTraderIdentity` directly and emit nothing, so a header-authenticated
 * `goal=reg` created a real `PocketTraderIdentity` that the canonical ledger never
 * learned about — while migration 47 backfilled `pocket_reg` from exactly those
 * rows. It calls the same canonical domain operation as the `ow` path now, so both
 * receivers produce one binding and one event, and the emission is idempotent on
 * the Pocket player so a delivery arriving on both contracts still yields one.
 */
async function bindRegistrationIdentity(input: {
  userId: number;
  pocketUserId: string;
  clickId: string;
  request: Request;
}) {
  try {
    const { binding: result } = await bindPocketIdentityCanonical({
      userId: input.userId,
      pocketUserId: input.pocketUserId,
      clickId: input.clickId,
      db: prisma,
      // The legacy path writes no `ProviderIngressEvent`: that table is the
      // Growth V1 ingress evidence contract, and inventing a row for a delivery
      // this receiver never validated under that contract would put a fact in it
      // that is not one. The canonical event is still emitted.
      ingressEventId: null,
    });

    if (bindingEstablishedIdentity(result)) return;

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
