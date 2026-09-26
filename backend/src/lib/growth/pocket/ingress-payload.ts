/**
 * G4-GROWTH — turning a provider request into durable evidence, safely.
 *
 * THREE JOBS, AND THE ORDER MATTERS.
 *   1. REDACT. Authentication material is replaced before anything else touches
 *      the payload, so no later step — hashing, storing, logging — can see it.
 *   2. BOUND. Keys and values are capped and control characters refused, so a
 *      hostile or broken sender cannot write unbounded data into a JSON column.
 *   3. HASH. Over the REDACTED structure, never the raw one. A hash of the raw
 *      query would be an offline oracle for the secret: an attacker holding the
 *      stored hash could confirm a guessed secret without ever calling ATA.
 *
 * WHAT THE HASH IS FOR, AND WHAT IT IS NOT FOR. It identifies a repeated
 * DELIVERY — the same bytes arriving twice. It does NOT identify a repeated
 * DEPOSIT. Two legitimate redeposits by one player, of the same amount, in the
 * same second, produce byte-identical payloads and therefore one hash. Nothing
 * in this module or downstream of it treats the hash as an event identity, and
 * `POCKET_CONVERSION_CONTRACT.md` states the same limitation for readers who
 * arrive without this file.
 */
import crypto from "node:crypto";

/**
 * Every query key that may carry a secret.
 *
 * The same three the Pocket route already redacts. `ow` is Pocket's official
 * field and is redacted PRECISELY BECAUSE it is accepted — an accepted secret is
 * the one most likely to be present.
 */
export const SECRET_QUERY_KEYS: readonly string[] = ["ow", "secret", "token"];

/**
 * G4-M4 — a secret must not survive by being RENAMED.
 *
 * The exact list above is the REJECTION set: those three names are the ones the
 * route refuses a delivery over, and it stays exact because rejecting on a
 * guess would refuse legitimate provider traffic. Recasing was already handled
 * (`OW`, `Ow`, `oW` all redact, because keys are lower-cased first). Renaming
 * was not: `?authorization=Bearer%20abc` and `?x-postback-secret=hdr` were
 * persisted VERBATIM into `sanitizedPayload` and kept indefinitely.
 *
 * That is credential material at rest in a JSON column. It is reachable only
 * past the authenticated boundary — so the writer already holds the shared
 * secret — but a MISCONFIGURED PROVIDER putting a live secret in an unexpected
 * parameter is exactly the scenario this evidence row exists to survive.
 *
 * So redaction is broader than rejection, deliberately. A key that merely LOOKS
 * like credential material is redacted and still recorded as present, which
 * loses an operator nothing: the fact that the parameter arrived is preserved,
 * only its value is not.
 */
const SECRET_SHAPED_KEY =
  /(secret|token|auth|apikey|api_key|passw|credential|signature|\bsig\b|bearer|session|cookie)/i;

export const REDACTED = "[redacted]";

const MAX_KEYS = 40;
const MAX_KEY_LENGTH = 80;
const MAX_VALUE_LENGTH = 1000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Provider fields captured into typed columns, so the ingress-health and
 * acquisition surfaces do not have to read JSON.
 *
 * An allowlist. A macro Pocket adds tomorrow lands in the sanitized payload and
 * is visible, but it does not silently become a queryable dimension nobody
 * reviewed.
 */
export const CAPTURED_PROVIDER_FIELDS = {
  campaignId: "cid",
  campaignName: "ac",
  sub1: "sub_id1",
  sub2: "sub_id2",
  sub3: "sub_id3",
  sub4: "sub_id4",
  sub5: "sub_id5",
  country: "country",
  deviceType: "device_type",
} as const;

export type CapturedProviderFields = {
  [K in keyof typeof CAPTURED_PROVIDER_FIELDS]: string | null;
};

/**
 * Redact and bound a provider query into something safe to persist.
 *
 * A key that is too long, a value that is too long, or anything carrying control
 * characters is dropped rather than truncated: this structure is evidence, and
 * evidence that has been silently reshaped is worse than evidence that says a
 * field was refused.
 */
export function sanitizeProviderQuery(params: URLSearchParams): Record<string, string> {
  const secretKeys = new Set(SECRET_QUERY_KEYS);
  const out: Record<string, string> = {};
  let count = 0;

  for (const [rawKey, rawValue] of params.entries()) {
    if (count >= MAX_KEYS) break;

    const key = rawKey.toLowerCase();

    if (secretKeys.has(key) || SECRET_SHAPED_KEY.test(key)) {
      // Recorded as present-but-redacted rather than dropped: "the caller sent a
      // secret" is itself a fact an operator may need, and the value never is.
      out[key] = REDACTED;
      count += 1;
      continue;
    }

    if (rawKey.length > MAX_KEY_LENGTH) continue;
    if (rawValue.length > MAX_VALUE_LENGTH) continue;
    if (CONTROL_CHARACTERS.test(rawKey) || CONTROL_CHARACTERS.test(rawValue)) continue;

    out[key] = rawValue;
    count += 1;
  }

  return out;
}

/**
 * SHA-256 over the sanitized structure, with keys sorted.
 *
 * Sorted because `?a=1&b=2` and `?b=2&a=1` are the same delivery, and an
 * order-sensitive hash would report a redelivery as a new one every time an
 * intermediary reordered the query.
 */
export function hashSanitizedPayload(sanitized: Record<string, string>): string {
  // G4-L1 — LENGTH-PREFIXED, so the canonical form is injective.
  //
  // Joining `key=value` with `&` is ambiguous the moment a value contains one
  // of the separators: `{a:"b&c=d"}` and `{a:"b",c:"d"}` produced the SAME
  // digest. Nothing branches on this hash today — it is a delivery fingerprint
  // — but a fingerprint that collides on two different deliveries cannot do the
  // one job it has.
  //
  // Safe to change: it is not stored in any index, no code compares it against
  // a previously computed value, and no ProviderIngressEvent row exists on any
  // accepted database.
  const canonical = Object.keys(sanitized)
    .sort()
    .map((key) => {
      const value = sanitized[key];
      return `${key.length}:${key}${value.length}:${value}`;
    })
    .join("");

  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function captureProviderFields(sanitized: Record<string, string>): CapturedProviderFields {
  const read = (name: string): string | null => {
    const value = sanitized[name];
    if (value === undefined || value === REDACTED) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return null;
    return trimmed;
  };

  return {
    campaignId: read(CAPTURED_PROVIDER_FIELDS.campaignId),
    campaignName: read(CAPTURED_PROVIDER_FIELDS.campaignName),
    sub1: read(CAPTURED_PROVIDER_FIELDS.sub1),
    sub2: read(CAPTURED_PROVIDER_FIELDS.sub2),
    sub3: read(CAPTURED_PROVIDER_FIELDS.sub3),
    sub4: read(CAPTURED_PROVIDER_FIELDS.sub4),
    sub5: read(CAPTURED_PROVIDER_FIELDS.sub5),
    country: read(CAPTURED_PROVIDER_FIELDS.country),
    deviceType: read(CAPTURED_PROVIDER_FIELDS.deviceType),
  };
}

export type ProviderEventTime =
  | { readonly status: "absent"; readonly at: null; readonly raw: null }
  | { readonly status: "parsed"; readonly at: Date; readonly raw: null }
  | { readonly status: "unparseable"; readonly at: null; readonly raw: string };

/**
 * Pocket's `DATE_TIME`, parsed only when its meaning is unambiguous.
 *
 * THE ONE THING THIS MUST NEVER DO IS GUESS A TIMEZONE. A deposit timestamp that
 * is silently four hours wrong is worse than one that is honestly missing,
 * because nothing downstream can detect it. So:
 *
 *   * an ISO-8601 value carrying an explicit offset or `Z` is parsed — its
 *     instant is stated by the sender and no assumption is required;
 *   * anything else, INCLUDING the bare `YYYY-MM-DD HH:MM:SS` form Pocket's
 *     macro documentation shows, is recorded as `unparseable` with the raw
 *     string kept beside it.
 *
 * The bare form is the common case, and calling it unparseable is the point:
 * ATA does not know which clock produced it. `receivedAt` remains available and
 * is never presented as the provider's own time. If Pocket later documents the
 * zone, this function gains one branch and the stored raw strings can be
 * reinterpreted, which is only possible because they were kept.
 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|z|[+-]\d{2}:?\d{2})$/;

export function parseProviderEventTime(raw: string | undefined | null): ProviderEventTime {
  if (raw === undefined || raw === null) return { status: "absent", at: null, raw: null };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { status: "absent", at: null, raw: null };

  const bounded = trimmed.slice(0, 64);

  // INGRESS-TIME-1 — WHAT `unparseable` MEANS HERE, PRECISELY.
  //
  // It means "no ABSOLUTE INSTANT could be derived", NOT "these bytes are
  // malformed". Pocket's real DATE_TIME is `YYYY-MM-DD HH:MM:SS` with no zone,
  // so every genuine provider delivery lands here — 22 of them at the time of
  // writing, all perfectly well-formed.
  //
  // THE STORED DATA IS CORRECT AND COMPLETE: the raw value is preserved verbatim
  // in providerEventAtRaw and no instant is invented. Only the LABEL is coarse,
  // and this enum has no third state available: the column is CHECK-constrained
  // to ('absent','parsed','unparseable'), so widening it would cost a migration
  // for a status that NO route and NO analytics query selects.
  //
  // THE CANONICAL LAYER IS THE ONE THAT DECIDES MONEY, AND IT IS RIGHT.
  // PocketProviderEvent carries the full three-state model
  // (absent / local_only / absolute_from_sender) through
  // redeposit-identity.normaliseProviderEventTime, and records `local_only` for
  // exactly the value this function calls unparseable. Do NOT reconcile the two
  // by making this one claim an instant it does not have.
  if (!ISO_WITH_ZONE.test(bounded)) {
    return { status: "unparseable", at: null, raw: bounded };
  }

  const normalised = bounded.replace(" ", "T");
  const parsed = new Date(normalised);

  if (Number.isNaN(parsed.getTime())) {
    return { status: "unparseable", at: null, raw: bounded };
  }

  return { status: "parsed", at: parsed, raw: null };
}

/** The parameter names `DATE_TIME` may arrive under, in provider spelling. */
export function readProviderEventTimeRaw(params: URLSearchParams): string | undefined {
  for (const name of ["date_time", "datetime", "date"]) {
    const values = params.getAll(name);
    // Ambiguity is refused rather than resolved, exactly as elsewhere.
    if (values.length === 1 && values[0].trim().length > 0) return values[0];
  }
  return undefined;
}
