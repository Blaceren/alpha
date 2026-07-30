/**
 * POCKETCTA-1 — the operator-supplied Pocket affiliate registration base URL.
 *
 * WHAT THIS IS
 * `POCKET_AFFILIATE_BASE_URL` is the external Pocket registration link, carrying
 * the operator's fixed affiliate tracking parameters. The referral-link owner
 * parses it, adds the authenticated learner's clickid, and hands the result to
 * that one learner. Nothing else reads it.
 *
 * WHY IT NEEDS ITS OWN VALIDATOR
 * It was validated by `z.string().url()`, which accepts `http://`, embedded
 * credentials, a fragment, `https://127.0.0.1`, and an internal service port.
 * Every one of those is a real failure for a URL that gets opened in a learner's
 * browser: plain http strips the affiliate attribution in transit, a loopback or
 * internal-port host makes the link dead for everyone but this machine, and
 * embedded credentials leak into the learner's history and Referer chain.
 *
 * WHY A QUERY STRING IS ALLOWED HERE BUT NOT IN `PUBLIC_APP_URL`
 * The opposite of the invite-link contract: the affiliate base URL's *whole
 * point* is its fixed query parameters (campaign, source, medium, affiliate id,
 * …). They are preserved verbatim. So a query is expected, and a path is
 * expected — the operator's URL ends in `/register`.
 *
 * WHAT THE BASE URL MUST NEVER CARRY
 * A learner identity or a secret. The clickid is minted per learner by the
 * referral-link owner; a clickid baked into configuration would hand every
 * learner the *same* one, silently attributing every future registration to
 * whoever registered first. `ow` is Pocket's official query-secret parameter and
 * belongs only on an inbound postback, never on an outbound link a learner can
 * read. These are rejected by PARAMETER NAME — this module never reads, compares
 * against, or otherwise touches `POSTBACK_SECRET`.
 */

/** The configuration keys this module validates, in resolution order. */
export const POCKET_AFFILIATE_BASE_URL_KEY = "POCKET_AFFILIATE_BASE_URL";
/** Historical alias, still honoured by `getPocketReferralUrl`. */
export const POCKET_AFFILIATE_LEGACY_KEY = "POCKET_REFERRAL_URL";

/**
 * Ports belonging to internal services that must never appear in a
 * learner-facing URL: Backend, Academy and CRM respectively.
 */
const INTERNAL_SERVICE_PORTS = new Set(["3100", "3050", "3010"]);

/** Hosts that are only ever reachable from the machine itself. */
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "[::]",
]);

/**
 * Parameter names the *configured base* may never contain.
 *
 * `click_id`/`clickid` are the learner-owned tracking values and are added
 * per-request by the owner. `playerid` is Pocket's identifier for an account
 * that does not exist yet at link time. `ow` is the official postback query
 * secret. Matching is on the NAME only.
 */
const FORBIDDEN_BASE_PARAMS = new Set(["click_id", "clickid", "playerid", "ow"]);

/** Any parameter whose name suggests it carries a shared secret. */
const SECRET_NAME_PATTERN = /secret/i;

export type PocketAffiliateUrlResolution =
  /** A usable external base URL, with its operator query preserved verbatim. */
  | { readonly kind: "configured"; readonly url: string; readonly key: string }
  /** Not set. Legal at validation time; the owner fails closed when asked. */
  | { readonly kind: "absent" }
  /** Set but unusable. Always an error — never silently ignored. */
  | { readonly kind: "invalid"; readonly reason: PocketAffiliateUrlRejection; readonly key: string };

export type PocketAffiliateUrlRejection =
  | "empty"
  | "unparseable"
  | "not_https"
  | "has_credentials"
  | "has_fragment"
  | "loopback_host"
  | "internal_service_port"
  | "non_standard_port"
  | "no_path"
  | "embeds_learner_identifier"
  | "embeds_secret_parameter";

const REJECTION_DETAIL: Record<PocketAffiliateUrlRejection, string> = {
  empty: "must not be empty",
  unparseable: "must be an absolute URL",
  not_https: "must use https",
  has_credentials: "must not contain a username or password",
  has_fragment: "must not contain a fragment",
  loopback_host: "must not be a loopback or wildcard host",
  internal_service_port: "must not name an internal service port",
  non_standard_port: "must not name a non-standard port",
  no_path: "must name the affiliate registration path",
  embeds_learner_identifier:
    "must not embed a clickid or playerid — the referral owner adds the learner's own",
  embeds_secret_parameter: "must not embed a postback secret parameter",
};

/** A human-readable reason, for runtime-environment validation output. */
export function describePocketAffiliateUrlRejection(
  reason: PocketAffiliateUrlRejection,
  key: string = POCKET_AFFILIATE_BASE_URL_KEY,
): string {
  return `${key} ${REJECTION_DETAIL[reason]}`;
}

/**
 * Resolve and validate the configured affiliate base URL.
 *
 * Takes configuration only. No function here accepts a request, so no `Host` or
 * `X-Forwarded-Host` header can influence the result — a header-derived
 * affiliate link would be a redirect gadget pointed at the learner.
 */
export function resolvePocketAffiliateUrl(
  env: NodeJS.ProcessEnv = process.env,
): PocketAffiliateUrlResolution {
  const key =
    env[POCKET_AFFILIATE_BASE_URL_KEY] !== undefined
      ? POCKET_AFFILIATE_BASE_URL_KEY
      : POCKET_AFFILIATE_LEGACY_KEY;
  const raw = env[key];
  if (raw === undefined) return { kind: "absent" };

  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "invalid", reason: "empty", key };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: "invalid", reason: "unparseable", key };
  }

  if (url.protocol !== "https:") return { kind: "invalid", reason: "not_https", key };
  if (url.username !== "" || url.password !== "") {
    return { kind: "invalid", reason: "has_credentials", key };
  }
  if (url.hash !== "") return { kind: "invalid", reason: "has_fragment", key };
  if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return { kind: "invalid", reason: "loopback_host", key };
  }
  // `new URL` drops an explicit `:443` on https, so a port still present here is
  // non-standard. The internal-service case is reported separately because it is
  // the one an operator is most likely to reach for by mistake.
  if (url.port !== "") {
    if (INTERNAL_SERVICE_PORTS.has(url.port)) {
      return { kind: "invalid", reason: "internal_service_port", key };
    }
    return { kind: "invalid", reason: "non_standard_port", key };
  }
  // A bare origin is not a registration endpoint. `new URL("https://h")`
  // normalises the path to "/", so that is the "no path" case.
  if (url.pathname === "" || url.pathname === "/") {
    return { kind: "invalid", reason: "no_path", key };
  }

  for (const name of url.searchParams.keys()) {
    const lowered = name.toLowerCase();
    if (FORBIDDEN_BASE_PARAMS.has(lowered)) {
      return { kind: "invalid", reason: "embeds_learner_identifier", key };
    }
    if (SECRET_NAME_PATTERN.test(lowered)) {
      return { kind: "invalid", reason: "embeds_secret_parameter", key };
    }
  }

  // Returned as `href`, not as reassembled parts: the operator's parameter order
  // and encoding are preserved exactly as supplied.
  return { kind: "configured", url: url.href, key };
}

/**
 * The learner-owned click-tracking parameter names the referral owner adds.
 *
 * BOTH SPELLINGS ARE DELIBERATE, and each has a proven consumer:
 *   - `clickid`  — the OFFICIAL direct Pocket postback contract. See
 *     `parsePocketRegistrationFields`, which reads `getAll("clickid")` and
 *     requires exactly one occurrence.
 *   - `click_id` — the legacy postback alias (`getPocketClickId`) and the key
 *     under which attribution is persisted on `ExchangeAccount` (`attributionKeys`).
 *
 * They are two distinct NAMES carrying one value, which is not the same thing as
 * a duplicated parameter: `searchParams.set` guarantees each appears exactly
 * once, and a repeated `clickid` is precisely what the direct postback parser
 * rejects as ambiguous.
 */
export const POCKET_DYNAMIC_PARAM_NAMES = ["click_id", "clickid"] as const;

/**
 * A system-owned static parameter the referral owner has always added, distinct
 * from the operator-supplied set. Kept exactly once.
 */
export const POCKET_LANDING_PARAM = "landing";
export const POCKET_LANDING_VALUE = "Landing_1";

export type PocketReferralUrlShape = {
  readonly origin: string;
  readonly pathname: string;
  /** Every parameter name that is not learner-owned, sorted. */
  readonly staticParamNames: readonly string[];
  /** The learner-owned parameter names actually present, sorted. */
  readonly dynamicParamNames: readonly string[];
  readonly paramCount: number;
};

/**
 * Describe a generated referral URL by STRUCTURE ONLY — never by value.
 *
 * This is what may legally reach an audit record: it proves the contract (the
 * operator's parameters survived, the clickid was added, nothing forbidden
 * appeared) while carrying no learner identifier. No parameter *value* is read
 * here at all, so there is nothing to redact.
 */
export function describePocketReferralUrlShape(url: URL): PocketReferralUrlShape {
  const dynamic = new Set<string>(POCKET_DYNAMIC_PARAM_NAMES);
  const staticNames: string[] = [];
  const dynamicNames: string[] = [];
  let paramCount = 0;

  for (const name of url.searchParams.keys()) {
    paramCount += 1;
    if (dynamic.has(name)) dynamicNames.push(name);
    else staticNames.push(name);
  }

  return {
    origin: url.origin,
    pathname: url.pathname,
    staticParamNames: staticNames.sort(),
    dynamicParamNames: dynamicNames.sort(),
    paramCount,
  };
}
