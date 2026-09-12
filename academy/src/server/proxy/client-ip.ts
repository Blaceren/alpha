/**
 * Trusted client-IP derivation for the registration proxy (SERVER-ONLY).
 *
 * ## Why this exists
 *
 * The Backend registration owner rate-limits by client IP (3 attempts / 30 min,
 * keyed on `getRequestIp`). The Academy proxy reaches Backend over a loopback
 * `fetch`, so unless we deliberately carry a client IP across that hop the
 * Backend sees no IP at all and buckets EVERY registration attempt on the
 * public internet under one key. That is not a rate limit, it is a global
 * three-attempts-per-half-hour outage.
 *
 * ## Why `x-real-ip` is the trustworthy input and `x-forwarded-for` is not
 *
 * The deployed chain is:
 *
 *     browser → nginx (public TLS ingress) → Academy (127.0.0.1:3050) → Backend
 *
 * The ingress sets, for every proxied request:
 *
 *     proxy_set_header X-Real-IP        $remote_addr;
 *     proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
 *
 * `proxy_set_header` REPLACES the header, so `X-Real-IP` as observed by the
 * Academy is always the TCP peer address nginx measured. A browser cannot
 * influence it — whatever it sends under that name is overwritten.
 *
 * `$proxy_add_x_forwarded_for` by contrast APPENDS: it expands to
 * `"<client-supplied X-Forwarded-For>, <real peer>"`. The first element is
 * therefore attacker-controlled, and Backend's `getRequestIp` reads exactly the
 * first element. Forwarding `X-Forwarded-For` would hand any client a trivial
 * rate-limit bypass (send a fresh fake head on every attempt). So this module
 * NEVER forwards it, and the proxy's header allow-list never includes it.
 *
 * The application ports stay bound to 127.0.0.1, so the ingress is the only way
 * a public client can reach the Academy — there is no path that delivers an
 * un-overwritten `X-Real-IP` from the internet.
 *
 * ## Fail-safe direction
 *
 * A missing or malformed value yields `null` and NOTHING is forwarded. Backend
 * then falls back to whatever its own server injected for the loopback hop,
 * which lumps callers together — more restrictive, never less. We never invent,
 * guess or widen an IP.
 */

/**
 * The one header the trusted ingress hop stamps with the real peer address.
 * This is the only header we ever READ.
 */
export const TRUSTED_CLIENT_IP_HEADER = "x-real-ip";

/**
 * Headers we WRITE towards Backend, both set to the single trusted address.
 *
 * `x-forwarded-for` is not optional here, and the reason is subtle enough to be
 * worth stating: Backend's `getRequestIp` checks `x-forwarded-for` FIRST and
 * only falls back to `x-real-ip`. Backend also runs behind its own Next.js Node
 * server, which injects `x-forwarded-for` for any request that arrives without
 * one — for our loopback hop that value is `127.0.0.1`. So forwarding only
 * `x-real-ip` is silently useless: Backend reads the injected `127.0.0.1`
 * instead and every registration on the internet lands in ONE bucket. This was
 * observed, not assumed (isolated probe: a second distinct client was already
 * rate-limited on its first attempt).
 *
 * We therefore SET `x-forwarded-for` to exactly one address — the trusted one.
 * We never append to, and never pass through, the browser's value, so the
 * first (and only) element Backend reads is always ingress-measured.
 */
export const FORWARDED_CLIENT_IP_HEADERS = ["x-forwarded-for", "x-real-ip"] as const;

/**
 * Headers that carry a client-controlled forwarding chain. These must never be
 * forwarded to Backend and are asserted absent by the proxy tests.
 */
export const UNTRUSTED_FORWARDING_HEADERS = [
  "x-forwarded-for",
  "forwarded",
  "x-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
] as const;

/** Bounded so a hostile value can never become an unbounded upstream header. */
const MAX_IP_LENGTH = 45; // longest possible IPv6 textual form

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    // Reject leading zeros: "01" and "0001" are ambiguous octal-looking forms.
    if (part.length > 1 && part.startsWith("0")) return false;
    return Number(part) <= 255;
  });
}

function isIpv6(value: string): boolean {
  // Reject anything with characters outside the IPv6 alphabet before the more
  // permissive structural check below.
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return false;
  if (!value.includes(":")) return false;
  // At most one "::" compression group.
  if (value.split("::").length > 2) return false;

  const compressed = value.includes("::");
  const segments = value.split("::");
  const head = segments[0] ?? "";
  const tail = segments[1] ?? "";
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === "" ? [] : tail.split(":");
  const groups = [...headGroups, ...tailGroups];

  // A trailing IPv4 form (e.g. ::ffff:127.0.0.1) occupies two 16-bit groups.
  let groupCount = groups.length;
  const last = groups[groups.length - 1];
  if (last !== undefined && last.includes(".")) {
    if (!isIpv4(last)) return false;
    groupCount += 1;
  }

  if (groups.some((group, index) => {
    const isLast = index === groups.length - 1;
    if (isLast && group.includes(".")) return false;
    return !/^[0-9a-fA-F]{1,4}$/.test(group);
  })) {
    return false;
  }

  return compressed ? groupCount <= 8 : groupCount === 8;
}

/** True only for a well-formed IPv4 or IPv6 literal. */
export function isIpLiteral(value: string): boolean {
  if (value.length === 0 || value.length > MAX_IP_LENGTH) return false;
  return isIpv4(value) || isIpv6(value);
}

/**
 * Derive the client IP the Backend should rate-limit on, or `null` when no
 * trustworthy value is available.
 *
 * Reads ONLY `x-real-ip` — the header the trusted ingress overwrites. The
 * client-controlled forwarding chain is ignored entirely, so a spoofed
 * `X-Forwarded-For` can neither set nor shift the value returned here.
 */
export function deriveTrustedClientIp(request: Request): string | null {
  const raw = request.headers.get(TRUSTED_CLIENT_IP_HEADER);
  if (raw === null) return null;

  // A single header value only. A comma means someone tried to smuggle a chain
  // through a field that is defined to hold exactly one address — reject it
  // rather than picking an element.
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.includes(",")) return null;

  // Strip an optional IPv6 bracket form; keep everything else verbatim.
  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;

  return isIpLiteral(unbracketed) ? unbracketed : null;
}
