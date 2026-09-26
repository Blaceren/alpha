/**
 * L4PA-1 — the official Pocket Partner user-info client.
 *
 * THIS FILE IS THE TRUST BOUNDARY. It is the only place in the platform where a
 * Pocket balance exists as a number. It takes a threshold in and returns a
 * VERDICT out; the amount is compared here and then goes out of scope. Nothing
 * downstream can leak a balance because nothing downstream is ever given one.
 *
 * WHAT NEVER LEAVES THIS MODULE
 *   - the API token and the MD5 derived from it;
 *   - the request URL (its PATH contains that derived credential);
 *   - `real_balance`, `demo_balance`, `ftd_amount`, `total_deposits`;
 *   - the raw response body, in whole or in part.
 * Consequently NOTHING here is logged. Not the URL on failure, not the body on
 * a parse error, not the caught exception — `fetch` rejections routinely embed
 * the full URL in `error.cause`, so thrown values are classified by shape and
 * then dropped, never stringified, never re-thrown and never attached.
 *
 * ONLY `real_balance` DECIDES. `demo_balance` is validated (a malformed one
 * means the payload is not trustworthy) and then ignored. It is never compared,
 * never blended, and never reported as a smaller number: an account with
 * $10,000 demo and $0 real is `not_met`, with no hint that demo funds exist.
 */
import crypto from "node:crypto";
import {
  POCKET_PARTNER_USER_INFO_PATH,
  type PocketPartnerConfig,
} from "./pocketPartnerConfig";
import { buildPocketPartnerHash } from "./pocketPartnerHash";

/** Hard ceiling on the response body. A user-info document is a few hundred bytes. */
export const POCKET_PARTNER_MAX_RESPONSE_BYTES = 64 * 1024;

/** The only `status` value that may be evaluated at all. */
export const POCKET_PARTNER_ACTIVE_STATUS = "active";

/**
 * Operational unavailability reasons, mirroring the checkpoint core's vocabulary
 * so the provider is a pure rename rather than a translation with judgement in
 * it.
 */
export type PocketUnavailableReason =
  | "provider_timeout"
  | "provider_maintenance"
  | "provider_rate_limited";

/**
 * The complete answer this module is willing to give. Note what is absent:
 * there is no field an amount could occupy, in any branch.
 */
export type PocketThresholdOutcome =
  | { readonly kind: "met" }
  | { readonly kind: "not_met" }
  | { readonly kind: "identity_mismatch" }
  | { readonly kind: "invalid_provider_response" }
  | {
      readonly kind: "unavailable";
      readonly reason: PocketUnavailableReason;
      readonly retryAfterSeconds?: number | null;
    };

export type PocketThresholdResult = {
  readonly outcome: PocketThresholdOutcome;
  /**
   * Opaque, platform-generated correlation handle. Deliberately NOT the Pocket
   * trader id: a support handle should not spread a third-party account
   * identifier through logs and audit rows.
   */
  readonly providerRequestId: string;
  /** When the answer was received. The provider returns no balance timestamp. */
  readonly observedAt: Date;
};

/** Injectable purely so tests can drive the client without a global stub. */
export type PocketFetch = (
  url: string,
  init: { method: string; redirect: "manual"; signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

export type VerifyPocketThresholdInput = {
  readonly config: PocketPartnerConfig;
  /** Canonical decimal string, already resolved from server-side storage. */
  readonly pocketUserId: string;
  /** Integer minor units. USD 50.00 is 5000. */
  readonly thresholdMinorUnits: number;
  /** The engine's deadline. Honoured, never extended, never retried past. */
  readonly signal: AbortSignal;
  readonly fetchImpl?: PocketFetch;
  readonly now?: () => Date;
};

/**
 * Ask the official endpoint whether one trader meets one threshold.
 *
 * Exactly ONE request is made. There is no retry, no backoff and no second
 * attempt on any failure: retry policy belongs to the engine, and it is
 * deliberately zero so a failing provider is not amplified and a learner-visible
 * cooldown is not bypassed.
 */
export async function verifyPocketPartnerThreshold(
  input: VerifyPocketThresholdInput,
): Promise<PocketThresholdResult> {
  const providerRequestId = `pp-${crypto.randomUUID()}`;
  const now = input.now ?? (() => new Date());
  const done = (outcome: PocketThresholdOutcome): PocketThresholdResult => ({
    outcome,
    providerRequestId,
    observedAt: now(),
  });

  const userId = Number(input.pocketUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    // The caller is supposed to have canonicalised this. If it did not, the
    // request is not safe to make: a malformed id would be hashed and sent.
    return done({ kind: "invalid_provider_response" });
  }
  if (!Number.isSafeInteger(input.thresholdMinorUnits) || input.thresholdMinorUnits <= 0) {
    return done({ kind: "invalid_provider_response" });
  }

  let response: Response;
  try {
    const hash = buildPocketPartnerHash(userId, input.config.partnerId, input.config.apiToken);
    const url = `${input.config.baseUrl}${POCKET_PARTNER_USER_INFO_PATH}/${userId}/${input.config.partnerId}/${hash}`;
    const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as PocketFetch);
    response = await fetchImpl(url, {
      method: "GET",
      // Never follow a redirect: a 3xx would replay the credential-bearing path
      // at a host this platform never approved.
      redirect: "manual",
      signal: input.signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    // Classified by shape only. The value is never inspected for a message,
    // never logged and never re-thrown — `fetch` puts the full URL, and
    // therefore the derived credential, inside its rejections.
    return done(
      isAbortError(error)
        ? { kind: "unavailable", reason: "provider_timeout" }
        : { kind: "unavailable", reason: "provider_maintenance" },
    );
  }

  const statusOutcome = classifyHttpStatus(response);
  if (statusOutcome) return done(statusOutcome);

  const body = await readBoundedJson(response);
  if (body === null) return done({ kind: "invalid_provider_response" });

  return done(evaluateUserInfo(body, userId, input.config.partnerId, input.thresholdMinorUnits));
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Map the HTTP status onto an outcome, or `null` when the body should be read.
 *
 * Infrastructure failure and malformed data NEVER become `not_met`. "We could
 * not find out" and "you have not got there" are different facts, and conflating
 * them would fail a learner for the provider's outage.
 */
function classifyHttpStatus(response: Response): PocketThresholdOutcome | null {
  const status = response.status;

  // `redirect: "manual"` surfaces a 3xx as an opaque response (status 0) or as
  // the raw status; both are refused rather than followed.
  if (response.type === "opaqueredirect" || (status >= 300 && status < 400)) {
    return { kind: "invalid_provider_response" };
  }

  if (status === 200) {
    const contentType = response.headers.get("content-type") ?? "";
    // A success that is not JSON is not the documented contract — an HTML error
    // page or a login redirect body must never be parsed hopefully.
    return contentType.toLowerCase().includes("application/json")
      ? null
      : { kind: "invalid_provider_response" };
  }

  if (status === 401 || status === 403) {
    // OUR credential is wrong or revoked. This is a platform configuration
    // fault, not a statement about the learner, so it must not read as
    // `identity_*` and must never read as `not_met`.
    return { kind: "unavailable", reason: "provider_maintenance" };
  }

  if (status === 404) {
    // Deliberately NOT `identity_unlinked`. The official contract does not
    // define 404, and this URL encodes the user id, the partner id AND the
    // token-derived hash — a wrong token or a moved route produces the same 404
    // as an unknown trader. Reading it as "you have no Pocket account" would
    // present a credential outage to the learner as a fact about themselves.
    return { kind: "invalid_provider_response" };
  }

  if (status === 408) return { kind: "unavailable", reason: "provider_timeout" };

  if (status === 429) {
    return {
      kind: "unavailable",
      reason: "provider_rate_limited",
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    };
  }

  if (status >= 500 && status <= 599) {
    return { kind: "unavailable", reason: "provider_maintenance" };
  }

  return { kind: "invalid_provider_response" };
}

/** Bounded back-pressure. A malformed or absurd value is simply absent. */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw || !/^[0-9]+$/.test(raw.trim())) return null;
  const seconds = Number(raw.trim());
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3_600 ? seconds : null;
}

/**
 * Read at most `POCKET_PARTNER_MAX_RESPONSE_BYTES` and parse strictly.
 *
 * The body is streamed with a running byte count rather than buffered whole, so
 * an oversized or endless response is abandoned at the cap instead of consuming
 * memory. Anything that is not a plain JSON object — array, `null`, string,
 * number, truncated text — collapses to `null`, and the offending text is never
 * carried into an error message.
 */
async function readBoundedJson(response: Response): Promise<Record<string, unknown> | null> {
  const stream = response.body;
  let text: string;

  try {
    if (!stream) {
      text = await response.text();
      if (Buffer.byteLength(text, "utf8") > POCKET_PARTNER_MAX_RESPONSE_BYTES) return null;
    } else {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > POCKET_PARTNER_MAX_RESPONSE_BYTES) {
            await reader.cancel().catch(() => undefined);
            return null;
          }
          chunks.push(value);
        }
      }
      text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    }
  } catch {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A finite, non-negative JSON number. Strings are NOT coerced. */
function readMoney(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** A positive integer identifier, accepted as a JSON number only. */
function readIdentifier(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Validate the official payload and decide the verdict.
 *
 * Order matters and is not cosmetic. Identity is proven BEFORE anything
 * financial is read, so a response about the wrong trader can never contribute a
 * balance to a comparison. Status is proven before the balance, so a closed or
 * suspended account is never passed on the strength of a stale figure.
 *
 * Every failure is `invalid_provider_response` or `identity_mismatch` — never
 * `not_met`. A payload we cannot trust says nothing about the learner's money.
 */
function evaluateUserInfo(
  body: Record<string, unknown>,
  expectedUserId: number,
  expectedPartnerId: number,
  thresholdMinorUnits: number,
): PocketThresholdOutcome {
  const responseUserId = readIdentifier(body.user_id);
  const responsePartnerId = readIdentifier(body.partner_id);
  if (responseUserId === null || responsePartnerId === null) {
    return { kind: "invalid_provider_response" };
  }
  // The answer must be about the trader we asked about, from the partner
  // account we hold. Either mismatch means the response cannot authorise
  // anything, whatever it says about money.
  if (responseUserId !== expectedUserId || responsePartnerId !== expectedPartnerId) {
    return { kind: "identity_mismatch" };
  }

  const status = body.status;
  if (typeof status !== "string" || status.length === 0) {
    return { kind: "invalid_provider_response" };
  }
  if (status !== POCKET_PARTNER_ACTIVE_STATUS) {
    // Inactive, blocked, unknown — all fail closed and NONE of them is
    // `not_met`: a suspended account is not a statement about its balance.
    return { kind: "invalid_provider_response" };
  }

  const realBalance = readMoney(body.real_balance);
  if (realBalance === null) return { kind: "invalid_provider_response" };

  // Validated, then discarded. A malformed demo balance means the document is
  // not the documented contract, so it is not trusted for the real figure
  // either — but a well-formed one is never looked at again.
  if (body.demo_balance !== undefined && readMoney(body.demo_balance) === null) {
    return { kind: "invalid_provider_response" };
  }
  // Optional fields are validated for shape only. They take no part in the
  // decision and are never read again.
  if (body.ftd_amount !== undefined && readMoney(body.ftd_amount) === null) {
    return { kind: "invalid_provider_response" };
  }
  if (body.total_deposits !== undefined && readMoney(body.total_deposits) === null) {
    return { kind: "invalid_provider_response" };
  }
  if (body.country !== undefined && !isBoundedString(body.country)) {
    return { kind: "invalid_provider_response" };
  }
  if (body.registered_at !== undefined && !isValidTimestamp(body.registered_at)) {
    return { kind: "invalid_provider_response" };
  }

  // THE COMPARISON. Pocket support confirmed `real_balance` is USD, and the
  // threshold is USD minor units, so there is no conversion and no FX call —
  // only a change of unit. The balance is scaled to minor units and floored:
  // 49.99 becomes 4999 and fails, and it is never rounded up to meet the gate.
  // `Math.round` on the scaled value first absorbs binary-float error (49.99 *
  // 100 is 4998.999...), then `Math.floor` on the original discards sub-cent
  // dust, so a value cannot be promoted across the threshold by either.
  const observedMinorUnits = Math.floor(Math.round(realBalance * 100 * 1e6) / 1e6);

  return observedMinorUnits >= thresholdMinorUnits ? { kind: "met" } : { kind: "not_met" };
}

function isBoundedString(value: unknown): boolean {
  return typeof value === "string" && value.length <= 128;
}

function isValidTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  return !Number.isNaN(Date.parse(value));
}
