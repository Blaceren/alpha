/**
 * AFD-3B2 — what the public acquisition route is willing to read from a request,
 * and what it refuses to.
 *
 * THE SHAPE OF THE RULE. An affiliate network appends parameters to a tracking
 * URL. Which NAMES are meaningful was decided by an operator, in the CRM, and is
 * stored on the link. This module reads exactly those names and nothing else: an
 * unknown parameter is ignored and never stored, so a network that appends its
 * own diagnostics, or an attacker who appends anything at all, cannot write to
 * our database by choosing a key.
 *
 * WHY DUPLICATES ARE A REFUSAL, NOT A "FIRST ONE WINS". `?clickid=a&clickid=b`
 * has no single correct reading. Taking the first silently records a value the
 * network may not have meant, and the disagreement surfaces months later as a
 * payout dispute nobody can resolve. A 400 is a smaller problem than an
 * unfalsifiable record, and it is one the affiliate can see and fix immediately.
 */

/** The complete request target: path plus query. */
export const GO_MAX_TARGET_LENGTH = 2048;
/** Distinct query keys, counting the ones we will ignore. */
export const GO_MAX_QUERY_KEYS = 24;
export const GO_MAX_PARAM_NAME_LENGTH = 64;
/** Matches the AffiliateClick CHECK on every captured column. */
export const GO_MAX_PARAM_VALUE_LENGTH = 256;
export const GO_MAX_REFERRER_HOST_LENGTH = 253;

/**
 * C0/C1 controls plus the invisible separators and bidi overrides that make two
 * different strings render identically. The same alphabet the AFD-2 affiliate
 * validator rejects, so a value cannot enter through the traffic door that the
 * operator door would have refused.
 */
const UNSAFE_VALUE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff]/;

/** A percent sign not introducing a valid escape. */
const MALFORMED_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

export type CapturedParameters = {
  readonly externalAffiliateClickId: string | null;
  readonly sub1: string | null;
  readonly sub2: string | null;
  readonly sub3: string | null;
  readonly sub4: string | null;
  readonly sub5: string | null;
};

export const NO_CAPTURED_PARAMETERS: CapturedParameters = {
  externalAffiliateClickId: null,
  sub1: null,
  sub2: null,
  sub3: null,
  sub4: null,
  sub5: null,
};

export type ParameterMapping = {
  readonly externalClickParameter: string;
  readonly sub1Parameter: string | null;
  readonly sub2Parameter: string | null;
  readonly sub3Parameter: string | null;
  readonly sub4Parameter: string | null;
  readonly sub5Parameter: string | null;
};

export type QueryRejection =
  | "target_too_long"
  | "too_many_keys"
  | "parameter_name_too_long"
  | "value_too_long"
  | "value_unsafe"
  | "malformed_encoding"
  | "duplicate_parameter";

export type QueryCaptureResult =
  | { readonly kind: "ok"; readonly captured: CapturedParameters }
  | { readonly kind: "rejected"; readonly reason: QueryRejection };

/**
 * Read the configured parameters out of a request URL.
 *
 * The raw query string is NEVER returned, stored or logged — only the bounded
 * values of the names the operator configured leave this function.
 */
export function captureParameters(url: URL, mapping: ParameterMapping): QueryCaptureResult {
  const target = `${url.pathname}${url.search}`;
  if (target.length > GO_MAX_TARGET_LENGTH) return { kind: "rejected", reason: "target_too_long" };

  // Checked on the RAW query, before any decoder gets a chance to paper over it.
  // `URLSearchParams` leaves a broken escape as literal text, which would store
  // "%ZZ" as if the network had meant it.
  if (MALFORMED_ESCAPE.test(url.search)) return { kind: "rejected", reason: "malformed_encoding" };

  const params = url.searchParams;
  const keys = new Set(params.keys());
  if (keys.size > GO_MAX_QUERY_KEYS) return { kind: "rejected", reason: "too_many_keys" };
  for (const key of keys) {
    if (key.length > GO_MAX_PARAM_NAME_LENGTH) {
      return { kind: "rejected", reason: "parameter_name_too_long" };
    }
  }

  const wanted: Array<[keyof CapturedParameters, string | null]> = [
    ["externalAffiliateClickId", mapping.externalClickParameter],
    ["sub1", mapping.sub1Parameter],
    ["sub2", mapping.sub2Parameter],
    ["sub3", mapping.sub3Parameter],
    ["sub4", mapping.sub4Parameter],
    ["sub5", mapping.sub5Parameter],
  ];

  const captured: Record<keyof CapturedParameters, string | null> = { ...NO_CAPTURED_PARAMETERS };

  for (const [field, name] of wanted) {
    if (name === null) continue;
    const values = params.getAll(name);
    if (values.length === 0) continue;
    // A CONFIGURED name repeated is ambiguous and refused. An unknown name
    // repeated is simply ignored along with the rest of its kind.
    if (values.length > 1) return { kind: "rejected", reason: "duplicate_parameter" };

    const value = values[0].trim();
    if (value === "") continue;
    if (value.length > GO_MAX_PARAM_VALUE_LENGTH) return { kind: "rejected", reason: "value_too_long" };
    if (UNSAFE_VALUE.test(value)) return { kind: "rejected", reason: "value_unsafe" };
    captured[field] = value;
  }

  return { kind: "ok", captured };
}

/**
 * Reduce a Referer header to a bare host, or to nothing.
 *
 * A full referrer is a URL with a path and a query, and storing one would mean
 * storing whatever the sending page had in it — search terms, session ids,
 * someone else's tracking parameters. The host alone answers the only question
 * an operator legitimately asks ("which site sent this traffic") and carries
 * none of that. Anything that does not parse, or that is not a plain host,
 * becomes null rather than a best guess.
 */
export function sanitizeReferrerHost(referer: string | null | undefined): string | null {
  if (typeof referer !== "string" || referer === "" || referer.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(referer);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "" || host.length > GO_MAX_REFERRER_HOST_LENGTH) return null;
  // Hostnames and bracketed IPv6 literals only. No credentials, no port, no path.
  if (!/^[a-z0-9.\-:[\]]+$/.test(host)) return null;
  return host;
}

/**
 * Headers a client or an intermediary uses to say "this is a prefetch".
 *
 * CONSERVATIVE ON PURPOSE. Misclassifying a real visitor as a prefetch costs an
 * affiliate a conversion they earned, so only an EXPLICIT declaration counts.
 * Guessing from a User-Agent string, a missing header or a timing heuristic
 * would be a device-fingerprinting exercise with a worse error rate, and this
 * platform does not fingerprint.
 */
const PREFETCH_TOKENS = ["prefetch", "prerender", "preview", "preconnect"];

export function isPrefetchRequest(headers: Headers): boolean {
  for (const header of ["sec-purpose", "purpose", "x-purpose", "x-moz"]) {
    const value = headers.get(header);
    if (value === null) continue;
    const lowered = value.toLowerCase();
    if (PREFETCH_TOKENS.some((token) => lowered.includes(token))) return true;
  }
  return false;
}
