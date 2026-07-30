/**
 * PUBLICURL-1 — the public, learner-facing origin.
 *
 * WHY THIS IS NOT `APP_URL`
 * `APP_URL` had accumulated four unrelated jobs: it decides whether session
 * cookies get `Secure` (`session.ts`), it is required in production
 * (`env.ts`), it is a **provider-safety input** — `classifyEnvironment` demotes a
 * `dev` declaration to `unknown` when `APP_URL` is not a loopback origin, which
 * makes `CHECKPOINT_PROVIDER_MODE=dev_simulator` a fatal error — and it was the
 * base of the learner's referral link.
 *
 * Those last two are in direct conflict on a publicly served DEV box. Naming the
 * public origin in `APP_URL` fixes the link and takes the Backend down; keeping it
 * loopback keeps the Backend up and hands learners a `https://127.0.0.1/...` link
 * nobody else can open. The variable was doing two jobs that wanted opposite
 * values, so this module gives the learner-facing one its own name.
 *
 * WHAT THIS VARIABLE MUST NEVER TOUCH
 * `ATA_ENVIRONMENT`, `CHECKPOINT_PROVIDER_MODE`, the simulator's production
 * prohibition, Partner provider selection, postback authentication,
 * `POSTBACK_SECRET`, the session secret, the CSRF secret, and cookie policy.
 * It is read in exactly one place — the referral link — and a regression suite
 * asserts that the classification and cookie decisions ignore it entirely.
 *
 * WHY NOT DERIVE IT FROM THE REQUEST
 * A `Host` or `X-Forwarded-Host` header is attacker-controlled. A referral link
 * built from one is a redirect gadget: an attacker sends a request with their own
 * host, and the link the learner later copies points at the attacker. This
 * resolver takes configuration only — there is no request parameter to poison,
 * because no function here accepts a request.
 */

/** The one configuration key this module reads. */
export const PUBLIC_APP_URL_KEY = "PUBLIC_APP_URL";

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

export type PublicAppUrlResolution =
  /** A usable public origin, normalised with no trailing slash. */
  | { readonly kind: "configured"; readonly origin: string }
  /** Not set. Legal, and handled by an explicit fail-closed policy. */
  | { readonly kind: "absent" }
  /** Set but unusable. Always an error — never silently ignored. */
  | { readonly kind: "invalid"; readonly reason: PublicAppUrlRejection };

export type PublicAppUrlRejection =
  | "unparseable"
  | "not_https"
  | "has_credentials"
  | "has_query"
  | "has_fragment"
  | "has_path"
  | "loopback_host"
  | "internal_service_port"
  | "empty";

const REJECTION_DETAIL: Record<PublicAppUrlRejection, string> = {
  unparseable: "must be an absolute URL",
  not_https: "must use https",
  has_credentials: "must not contain a username or password",
  has_query: "must not contain a query string",
  has_fragment: "must not contain a fragment",
  has_path: "must not contain a path",
  loopback_host: "must not be a loopback or wildcard host",
  internal_service_port: "must not name an internal service port",
  empty: "must not be empty",
};

/** A human-readable reason, for runtime-environment validation output. */
export function describePublicAppUrlRejection(reason: PublicAppUrlRejection): string {
  return `${PUBLIC_APP_URL_KEY} ${REJECTION_DETAIL[reason]}`;
}

/**
 * Resolve the configured public origin.
 *
 * Fails closed in both directions: an unusable value is `invalid` (which
 * `validateRuntimeEnv` turns into a startup error) and an absent value is
 * `absent` — never quietly replaced by an internal origin, and never defaulted to
 * a public address in source, because a source default would silently point every
 * other deployment at this one server.
 */
export function resolvePublicAppUrl(
  env: NodeJS.ProcessEnv = process.env,
): PublicAppUrlResolution {
  const raw = env[PUBLIC_APP_URL_KEY];
  if (raw === undefined) return { kind: "absent" };

  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "invalid", reason: "empty" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: "invalid", reason: "unparseable" };
  }

  if (url.protocol !== "https:") return { kind: "invalid", reason: "not_https" };
  if (url.username !== "" || url.password !== "") {
    return { kind: "invalid", reason: "has_credentials" };
  }
  if (url.search !== "") return { kind: "invalid", reason: "has_query" };
  if (url.hash !== "") return { kind: "invalid", reason: "has_fragment" };
  // `new URL("https://host")` normalises the path to "/", so only a path beyond
  // that is a real path. The existing referral contract appends its own path, so
  // a base path here would produce a double-pathed link.
  if (url.pathname !== "/" && url.pathname !== "") {
    return { kind: "invalid", reason: "has_path" };
  }
  if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return { kind: "invalid", reason: "loopback_host" };
  }
  if (url.port !== "" && INTERNAL_SERVICE_PORTS.has(url.port)) {
    return { kind: "invalid", reason: "internal_service_port" };
  }

  // `url.origin` is already scheme + host + non-default port with no trailing
  // slash, which removes the trailing-slash ambiguity at the source rather than
  // leaving every caller to strip it.
  return { kind: "configured", origin: url.origin };
}

/**
 * The public origin for building a learner-facing URL, or `null` when there is
 * none to use.
 *
 * `null` covers both "not configured" and "configured badly": a caller building a
 * link for a learner has no business distinguishing them, and an invalid value has
 * already failed runtime validation loudly elsewhere.
 */
export function publicAppOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const resolved = resolvePublicAppUrl(env);
  return resolved.kind === "configured" ? resolved.origin : null;
}

/**
 * Build the learner's ATA invite link.
 *
 * Returns `""` when no public origin is configured. That is the fail-closed
 * answer and it is deliberately the shape the existing clients already handle —
 * `lib/api.ts` and the dashboard both default this field to `""`. Emitting an
 * internal origin instead would hand the learner a link only this machine can
 * open; emitting a request-derived origin would hand them whatever an attacker
 * put in a header.
 */
export function buildReferralInviteLink(
  referralCode: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const origin = publicAppOrigin(env);
  if (origin === null) return "";
  return `${origin}/register?ref=${encodeURIComponent(referralCode)}`;
}
