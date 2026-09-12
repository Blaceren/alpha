/**
 * AFD-3B2 — the bounded abuse limit for the public acquisition route.
 *
 * THE PROBLEM THIS SOLVES, AND THE ONE IT DOES NOT. `/go` is the only route in
 * this platform that an anonymous stranger can call and cause a database write.
 * It therefore needs a ceiling. But a ceiling keyed on a client address is worse
 * than useless when the address is not trustworthy: today every request reaching
 * Backend arrives from a loopback hop, so a per-IP bucket would put every paying
 * visitor in the world into ONE bucket and start refusing legitimate traffic at
 * whatever number was chosen. That failure mode is silent, looks like a working
 * limiter, and costs the affiliate real conversions.
 *
 * SO THE KEY IS CHOSEN HONESTLY:
 *
 *   - A per-TRACKING-LINK ceiling always applies. It needs no client identity at
 *     all, it is meaningful on its own ("one link cannot be hammered"), and it
 *     cannot collapse unrelated visitors together because different links have
 *     different buckets.
 *
 *   - A per-CLIENT ceiling applies only when the deployment explicitly declares
 *     that a trusted ingress hop is rewriting the forwarding headers. Until it
 *     does, those headers are not read at all — so a browser that invents
 *     `x-forwarded-for: 9.9.9.9` gets no bucket of its own, cannot evade the
 *     per-link ceiling by rotating the value, and cannot exhaust another
 *     visitor's bucket by claiming their address.
 *
 * WHAT REMAINS FOR PRODUCTION. Application-level limiting is a backstop, not an
 * edge. Rate calibration at the real ingress — connection limits, per-IP limits
 * measured at the hop that actually sees the client, and bot filtering — belongs
 * to the production domain and ingress phase, and this module does not pretend
 * to replace it.
 *
 * NO ADDRESS IS EVER PERSISTED. The bucket keys live in the process-local map
 * owned by src/lib/rateLimit.ts and are never written to a row, a log or an
 * audit entry.
 */
import { getRequestIp, rateLimit } from "@/lib/rateLimit";

export const AFFILIATE_GO_TRUST_FORWARDED_FOR_KEY = "AFFILIATE_GO_TRUST_FORWARDED_FOR";
export const AFFILIATE_GO_IP_LIMIT_KEY = "AFFILIATE_GO_IP_LIMIT";
export const AFFILIATE_GO_LINK_LIMIT_KEY = "AFFILIATE_GO_LINK_LIMIT";
export const AFFILIATE_GO_LIMIT_WINDOW_SECONDS_KEY = "AFFILIATE_GO_LIMIT_WINDOW_SECONDS";

/**
 * Deliberately generous. A paid campaign can legitimately send a burst, and the
 * cost of refusing a real visitor is a lost conversion an affiliate will
 * (rightly) dispute. These are ceilings against runaway abuse, not traffic
 * shaping.
 */
export const AFFILIATE_GO_DEFAULT_IP_LIMIT = 120;
export const AFFILIATE_GO_DEFAULT_LINK_LIMIT = 3_000;
export const AFFILIATE_GO_DEFAULT_WINDOW_SECONDS = 600;

const MAX_CONFIGURED_LIMIT = 1_000_000;
const MAX_CONFIGURED_WINDOW_SECONDS = 24 * 60 * 60;

function boundedInteger(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 1 || value > max) return fallback;
  return value;
}

export function isForwardedForTrusted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AFFILIATE_GO_TRUST_FORWARDED_FOR_KEY] === "true";
}

export type GoAbuseDecision = {
  readonly allowed: boolean;
  /** Which ceiling refused, for a bounded internal reason. Never an address. */
  readonly refusedBy: "link" | "client" | null;
  /** Whether a per-client ceiling was applicable at all, for operator reporting. */
  readonly clientLimitApplied: boolean;
  readonly resetAt: number | null;
};

/**
 * Apply both ceilings. The link ceiling is evaluated FIRST so that a flood
 * against one link cannot be laundered through many forged client identities.
 *
 * IMPORTANT: this is called before any row is written, and a refusal returns
 * without writing one. A limiter that recorded the click it just refused would
 * be an amplification vector rather than a limit.
 */
export function applyGoAbuseLimit(
  request: Request,
  publicCode: string,
  env: NodeJS.ProcessEnv = process.env,
): GoAbuseDecision {
  const windowMs =
    boundedInteger(
      env[AFFILIATE_GO_LIMIT_WINDOW_SECONDS_KEY],
      AFFILIATE_GO_DEFAULT_WINDOW_SECONDS,
      MAX_CONFIGURED_WINDOW_SECONDS,
    ) * 1000;

  const linkLimit = boundedInteger(
    env[AFFILIATE_GO_LINK_LIMIT_KEY],
    AFFILIATE_GO_DEFAULT_LINK_LIMIT,
    MAX_CONFIGURED_LIMIT,
  );

  const link = rateLimit(`affiliate:go:link:${publicCode}`, { limit: linkLimit, windowMs });
  if (!link.allowed) {
    return { allowed: false, refusedBy: "link", clientLimitApplied: false, resetAt: link.resetAt };
  }

  if (!isForwardedForTrusted(env)) {
    // The forwarding headers were not consulted. Nothing the browser sent could
    // have produced, changed or exhausted a bucket here.
    return { allowed: true, refusedBy: null, clientLimitApplied: false, resetAt: null };
  }

  const clientIp = getRequestIp(request);
  if (clientIp === "unknown") {
    return { allowed: true, refusedBy: null, clientLimitApplied: false, resetAt: null };
  }

  const clientLimit = boundedInteger(
    env[AFFILIATE_GO_IP_LIMIT_KEY],
    AFFILIATE_GO_DEFAULT_IP_LIMIT,
    MAX_CONFIGURED_LIMIT,
  );
  const client = rateLimit(`affiliate:go:client:${clientIp}`, { limit: clientLimit, windowMs });

  return {
    allowed: client.allowed,
    refusedBy: client.allowed ? null : "client",
    clientLimitApplied: true,
    resetAt: client.allowed ? null : client.resetAt,
  };
}
