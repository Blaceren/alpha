import crypto from "node:crypto";

// Fail-closed authentication contract for the Pocket postback intake.
//
// The previous contract read POCKET_POSTBACK_REQUIRE_SECRET and skipped the
// secret check entirely whenever that variable was absent or not "true", so a
// missing environment variable disabled authentication on a route that mutates
// ExchangeAccount money state and money-linked progression. That interpretation
// is removed: the integration is disabled unless POCKET_POSTBACK_ENABLED is
// exactly "true", and when it is enabled a valid header secret is mandatory.

/** The single documented authentication header for Pocket postbacks. */
export const POCKET_POSTBACK_SECRET_HEADER = "x-postback-secret";

/** Bounded secret strength. Documented in docs/env.md. */
export const POCKET_SECRET_MIN_LENGTH = 16;
export const POCKET_SECRET_MAX_LENGTH = 200;

/** Printable ASCII, no whitespace, no comma (comma would make a duplicated header ambiguous). */
const SECRET_CHARSET = /^[\x21-\x2b\x2d-\x7e]+$/;

/**
 * Bounded rejection reason enum. Every security event records one of these and
 * nothing else — no secret, no payload, no header value.
 */
export const PocketRejectionReason = {
  Disabled: "integration_disabled",
  QueryAuthMaterial: "query_auth_material",
  MissingHeader: "missing_auth_header",
  MalformedHeader: "malformed_auth_header",
  AmbiguousHeader: "ambiguous_auth_header",
  SecretMismatch: "secret_mismatch",
  RateLimited: "rate_limited",
  QueryShape: "query_shape",
  UnknownGoal: "unknown_goal",
  InvalidAmount: "invalid_amount",
  MissingClickId: "missing_click_id",
  UnknownClickId: "unknown_click_id",
  ValidationError: "validation_error",
  // PDP-1 — the official direct Pocket registration contract carries its shared
  // secret as the `ow` QUERY parameter. These reasons describe that path only.
  MissingQuerySecret: "missing_query_secret",
  AmbiguousQuerySecret: "ambiguous_query_secret",
  MalformedQuerySecret: "malformed_query_secret",
  InvalidClickId: "invalid_click_id",
  InvalidPlayerId: "invalid_player_id",
  AmbiguousRegistrationParam: "ambiguous_registration_param",
} as const;

export type PocketRejectionReason =
  (typeof PocketRejectionReason)[keyof typeof PocketRejectionReason];

export type PocketPostbackConfig =
  | { enabled: true; secret: string }
  | { enabled: false };

/**
 * The one authoritative Pocket secret resolver. There is no default secret, no
 * development fallback and no code path that returns a secret while reporting
 * the integration as disabled. A weak or malformed secret is treated exactly
 * like an absent one, so a misconfiguration can never widen the auth surface.
 *
 * Errors are never thrown from here and no value is ever echoed, so the secret
 * cannot escape through a stack trace or a log line.
 */
export function resolvePocketPostbackConfig(
  env: Record<string, string | undefined> = process.env,
): PocketPostbackConfig {
  if (env.POCKET_POSTBACK_ENABLED !== "true") {
    return { enabled: false };
  }

  const secret = env.POSTBACK_SECRET;

  if (typeof secret !== "string" || !isAcceptableSecret(secret)) {
    return { enabled: false };
  }

  return { enabled: true, secret };
}

/** Whitespace-only, too short, too long and non-printable secrets are all invalid. */
export function isAcceptableSecret(secret: string): boolean {
  return (
    secret.trim() === secret &&
    secret.length >= POCKET_SECRET_MIN_LENGTH &&
    secret.length <= POCKET_SECRET_MAX_LENGTH &&
    SECRET_CHARSET.test(secret)
  );
}

/**
 * Length-independent constant-time comparison.
 *
 * crypto.timingSafeEqual throws on unequal lengths, which would itself leak the
 * expected length. HMAC-ing both sides under a per-process random key produces
 * two fixed-width digests that can always be compared in constant time, and the
 * key is never persisted or exposed.
 */
const COMPARISON_KEY = crypto.randomBytes(32);

export function timingSafeSecretEqual(provided: string, expected: string): boolean {
  const a = crypto.createHmac("sha256", COMPARISON_KEY).update(provided, "utf8").digest();
  const b = crypto.createHmac("sha256", COMPARISON_KEY).update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

export type PocketAuthOutcome =
  | { ok: true }
  | { ok: false; reason: PocketRejectionReason };

/**
 * Structural validation of the authentication header followed by a timing-safe
 * comparison. Missing, empty, malformed and wrong secrets all resolve to a
 * rejection the caller renders identically, so the response is not an oracle.
 *
 * Node joins duplicate header values with ", "; because an acceptable secret
 * can never contain a comma, a comma in the received value means the caller
 * sent the header more than once and the request is ambiguous.
 */
export function authenticatePocketRequest(
  headers: Headers,
  expectedSecret: string,
): PocketAuthOutcome {
  const raw = headers.get(POCKET_POSTBACK_SECRET_HEADER);

  if (raw === null || raw.length === 0) {
    return { ok: false, reason: PocketRejectionReason.MissingHeader };
  }

  if (raw.includes(",")) {
    return { ok: false, reason: PocketRejectionReason.AmbiguousHeader };
  }

  if (!isAcceptableSecret(raw)) {
    return { ok: false, reason: PocketRejectionReason.MalformedHeader };
  }

  if (!timingSafeSecretEqual(raw, expectedSecret)) {
    return { ok: false, reason: PocketRejectionReason.SecretMismatch };
  }

  return { ok: true };
}

/**
 * True when the caller tried to authenticate through the URL. Checked before
 * the header so a legacy `?ow=<secret>` integration fails loudly instead of
 * silently continuing to transmit a secret in a URL.
 */
export function hasQueryAuthMaterial(
  params: URLSearchParams,
  secretQueryKeys: readonly string[],
): boolean {
  for (const key of params.keys()) {
    if (secretQueryKeys.includes(key.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Non-reversible fingerprint of an event identifier, safe for AuditLog metadata.
 * The raw identifier is never audited on a security-rejection path.
 */
export function fingerprintEventId(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/* ------------------------------------------------------------------------ */
/* PDP-1 — the official DIRECT Pocket registration postback                  */
/* ------------------------------------------------------------------------ */

/**
 * The official Pocket postback authentication field.
 *
 * Pocket sends its shared secret as a QUERY parameter named `ow`. That is the
 * provider's protocol, not ATA's preference: a URL-borne secret is written into
 * every access log, proxy log, browser history and error report that touches
 * the request. ATA cannot change Pocket's contract, so it supports it under
 * strictly bounded conditions (see `POCKET_QUERY_SECRET_GOALS`) and compensates
 * with redaction everywhere the value could otherwise be recorded.
 *
 * The stronger `x-postback-secret` header contract is NOT removed. It remains
 * the only accepted authentication for every financial event.
 */
export const POCKET_POSTBACK_QUERY_SECRET_KEY = "ow";

/**
 * The ONLY goals for which a query-borne secret is accepted.
 *
 * Registration is the single event Pocket must deliver directly for the L4
 * identity chain to exist, and it mutates no money. Deposits, re-deposits,
 * commissions and withdrawals continue to require the header, so a leaked `ow`
 * cannot fabricate a financial event — it could at worst attempt an identity
 * binding, which the uniqueness constraints already make non-destructive.
 */
export const POCKET_QUERY_SECRET_GOALS: readonly string[] = ["reg"];

/**
 * AFD-4 — the goal that MAY join the list above, and only when the operator has
 * switched first-deposit ingestion on.
 *
 * WHY THIS IS A DELIBERATE POLICY AMENDMENT, NOT A LOOSENING. PS-1/PS-2 made
 * every financial goal header-only, and AFD-1 confirmed that `goal=dep` with
 * `ow` returns 403 today. Pocket's actual deposit callback carries `ow` and
 * nothing else, so ATA either accepts that contract for `dep` or never receives
 * a deposit at all. What keeps the amendment narrow:
 *
 *   - `dep` is the ONLY financial goal added. `ftd`, `redep`, `commission` and
 *     `withdrawal` still reject `ow` unconditionally and are unaffected by the
 *     flag.
 *   - It is off by default and requires `POCKET_POSTBACK_ENABLED` as well.
 *   - The blast radius of a leaked `ow` is bounded by the domain, not by the
 *     transport: a forged deposit cannot bind an identity, cannot complete a
 *     level, cannot award XP, cannot move a balance, and cannot produce a second
 *     event for a player that already has one. At worst it records one
 *     quarantined or pending row for a player nobody registered.
 */
export const POCKET_FIRST_DEPOSIT_QUERY_SECRET_GOAL = "dep";

/**
 * Query aliases that are NEVER acceptable as authentication material.
 *
 * `ow` is deliberately absent: it is the official field and is handled by
 * `authenticatePocketQuerySecret` under the goal restriction above. `secret`
 * and `token` were legacy ATA aliases with no provider mandate, so they stay
 * rejected outright.
 */
export const POCKET_FORBIDDEN_QUERY_SECRET_KEYS: readonly string[] = ["secret", "token"];

/**
 * Authenticate a direct Pocket postback from its `ow` query parameter.
 *
 * The raw value is used exactly as `URLSearchParams` decoded it: it is NOT
 * trimmed, NOT lower-cased and NOT decoded a second time. A secret that only
 * matches after normalisation is not the secret, and double-decoding would let
 * `%2520` smuggle a different value past this check than the one an operator
 * configured.
 *
 * `getAll` rather than `get`: a duplicated `?ow=a&ow=b` must be an explicit
 * ambiguity rejection, never a silent "first one wins".
 */
export function authenticatePocketQuerySecret(
  params: URLSearchParams,
  expectedSecret: string,
): PocketAuthOutcome {
  const supplied = params.getAll(POCKET_POSTBACK_QUERY_SECRET_KEY);

  if (supplied.length === 0) {
    return { ok: false, reason: PocketRejectionReason.MissingQuerySecret };
  }
  if (supplied.length > 1) {
    return { ok: false, reason: PocketRejectionReason.AmbiguousQuerySecret };
  }

  const raw = supplied[0];

  if (raw.length === 0 || !isAcceptableSecret(raw)) {
    return { ok: false, reason: PocketRejectionReason.MalformedQuerySecret };
  }
  if (!timingSafeSecretEqual(raw, expectedSecret)) {
    return { ok: false, reason: PocketRejectionReason.SecretMismatch };
  }

  return { ok: true };
}

/**
 * The goal value, read for the sole purpose of choosing an authentication mode.
 *
 * This runs BEFORE authentication, so it must do nothing but read a string: no
 * lookup, no write, no audit. A duplicated or absent `goal` yields `null`,
 * which selects the strict header-only mode — the safe default.
 */
export function readPostbackGoalForAuthMode(params: URLSearchParams): string | null {
  const goals = params.getAll("goal");
  if (goals.length !== 1) return null;
  return goals[0];
}

/**
 * True when this goal may authenticate with the official `ow` query secret.
 *
 * `firstDepositEnabled` is passed in rather than read here so this module stays
 * a pure protocol layer with no configuration dependency, and so a test can
 * exercise both policies without mutating the environment.
 */
export function goalAcceptsQuerySecret(
  goal: string | null,
  firstDepositEnabled = false,
): boolean {
  if (goal === null) return false;
  if (POCKET_QUERY_SECRET_GOALS.includes(goal)) return true;
  return firstDepositEnabled && goal === POCKET_FIRST_DEPOSIT_QUERY_SECRET_GOAL;
}

/**
 * True when this request is attempting the query-authenticated DEPOSIT contract
 * — regardless of whether the feature is currently switched on.
 *
 * Used to answer a disabled deposit with "unavailable" rather than "forbidden".
 * The distinction matters operationally: 403 tells Pocket its credentials are
 * wrong and invites an operator to go looking for a secret mismatch that does
 * not exist, whereas 503 says "not accepting these yet" and is retry-safe. It
 * discloses only that a feature is off, which the route already discloses for
 * the integration as a whole at step 1.
 */
export function isQueryAuthenticatedDepositAttempt(params: URLSearchParams): boolean {
  return (
    readPostbackGoalForAuthMode(params) === POCKET_FIRST_DEPOSIT_QUERY_SECRET_GOAL &&
    params.has(POCKET_POSTBACK_QUERY_SECRET_KEY)
  );
}

/**
 * The exact shape of an ATA-generated clickid: `tq-<uuid v4>`.
 *
 * Generated by `POST /api/exchange/referral-link` as `tq-${crypto.randomUUID()}`.
 * Matching it exactly means a path-like, SQL-like or oversized value is refused
 * before it ever reaches a database lookup.
 */
const ATA_CLICK_ID = /^tq-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Pocket trader identifiers are strictly positive base-10 integers.
 *
 * No sign, no decimal point, no exponent, no leading zero, and bounded to 16
 * digits so the value stays inside `Number.MAX_SAFE_INTEGER` — the Partner API
 * returns `user_id` as a JSON number, and an identifier that cannot survive
 * that round-trip must be refused rather than silently mis-compared.
 */
const POCKET_PLAYER_ID = /^[1-9][0-9]{0,15}$/;

export type PocketRegistrationFields =
  | { ok: true; clickId: string; playerId: string }
  | { ok: false; reason: PocketRejectionReason };

/**
 * Strictly parse the two identity-bearing fields of a registration postback.
 *
 * Every field is read with `getAll` and required to appear EXACTLY once. The
 * legacy route accepts a family of aliases (`click_id`, `trader_id`, `user_id`,
 * …) because affiliate networks historically differed; the direct Pocket
 * contract has one spelling for each, so accepting more here would only widen
 * the surface for no provider benefit.
 */
export function parsePocketRegistrationFields(
  params: URLSearchParams,
): PocketRegistrationFields {
  const clickIds = params.getAll("clickid");
  const playerIds = params.getAll("playerid");

  if (clickIds.length > 1 || playerIds.length > 1) {
    return { ok: false, reason: PocketRejectionReason.AmbiguousRegistrationParam };
  }
  if (clickIds.length === 0) {
    return { ok: false, reason: PocketRejectionReason.MissingClickId };
  }
  if (!ATA_CLICK_ID.test(clickIds[0])) {
    return { ok: false, reason: PocketRejectionReason.InvalidClickId };
  }
  if (playerIds.length === 0 || !POCKET_PLAYER_ID.test(playerIds[0])) {
    return { ok: false, reason: PocketRejectionReason.InvalidPlayerId };
  }
  if (!Number.isSafeInteger(Number(playerIds[0]))) {
    return { ok: false, reason: PocketRejectionReason.InvalidPlayerId };
  }

  return { ok: true, clickId: clickIds[0], playerId: playerIds[0] };
}

/* ------------------------------------------------------------------------ */
/* AFD-4 — the direct Pocket FIRST DEPOSIT postback                          */
/* ------------------------------------------------------------------------ */

/**
 * Control characters are refused everywhere in the deposit contract.
 *
 * None of the four fields can legitimately contain one, and a stray CR or LF in
 * a value is the classic way a log line or a header is split in two.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type PocketDepositFields =
  | { ok: true; clickId: string; playerId: string; sum: string }
  | { ok: false; reason: PocketRejectionReason };

/**
 * Strictly parse the identity- and money-bearing fields of a deposit postback.
 *
 * EVERY FIELD MUST APPEAR EXACTLY ONCE. `getAll` rather than `get` throughout,
 * because "first one wins" on a duplicated parameter is how a request that says
 * two different things gets silently resolved into whichever the parser happened
 * to read first — and for `sum` that would be a silent choice about money.
 *
 * THE CLICK ID ACCEPTS TWO SPELLINGS BUT NEVER BOTH. Pocket's own contract uses
 * `clickid`, while ATA's generated affiliate URL carries `click_id` as well
 * (POCKETCTA-1 established that both are intentional). Exactly one of the two
 * must be present: a request carrying both is ambiguous and is refused rather
 * than resolved by precedence.
 *
 * THE AMOUNT IS NOT PARSED HERE. This function establishes only that a single,
 * bounded, control-character-free `sum` was supplied. Its decimal validity is
 * `parsePocketDepositAmount`'s job, so the money contract lives in exactly one
 * place.
 */
export function parsePocketDepositFields(params: URLSearchParams): PocketDepositFields {
  const clickIds = [...params.getAll("clickid"), ...params.getAll("click_id")];
  const playerIds = params.getAll("playerid");
  const sums = params.getAll("sum");

  // Ambiguity first: a request that says two things must never be partially
  // interpreted, whichever field is duplicated.
  if (clickIds.length > 1 || playerIds.length > 1 || sums.length > 1) {
    return { ok: false, reason: PocketRejectionReason.AmbiguousRegistrationParam };
  }

  if (clickIds.length === 0) {
    return { ok: false, reason: PocketRejectionReason.MissingClickId };
  }
  if (playerIds.length === 0 || sums.length === 0) {
    return { ok: false, reason: PocketRejectionReason.QueryShape };
  }

  if (
    CONTROL_CHARACTERS.test(clickIds[0]) ||
    CONTROL_CHARACTERS.test(playerIds[0]) ||
    CONTROL_CHARACTERS.test(sums[0])
  ) {
    return { ok: false, reason: PocketRejectionReason.QueryShape };
  }

  if (!ATA_CLICK_ID.test(clickIds[0])) {
    return { ok: false, reason: PocketRejectionReason.InvalidClickId };
  }
  if (!POCKET_PLAYER_ID.test(playerIds[0]) || !Number.isSafeInteger(Number(playerIds[0]))) {
    return { ok: false, reason: PocketRejectionReason.InvalidPlayerId };
  }

  return { ok: true, clickId: clickIds[0], playerId: playerIds[0], sum: sums[0] };
}
