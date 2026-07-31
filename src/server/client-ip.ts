/**
 * Trusted client-IP derivation for the CRM login route (SERVER-ONLY, AFD-3A3).
 *
 * ## Why this exists
 *
 * The backend rate-limits login on (client IP, email) — 5 attempts per 10
 * minutes. The CRM reaches the backend over a server-to-server `fetch`, so
 * unless a client IP is deliberately carried across that hop the backend sees
 * only the loopback address and buckets EVERY staff login attempt under one key.
 * That is not a rate limit; it is a shared five-attempt budget that any one
 * employee's typo can exhaust for the whole company, and that an attacker can
 * exhaust deliberately.
 *
 * ## Why `x-real-ip` is the trustworthy input and `x-forwarded-for` is not
 *
 * The deployed chain is:
 *
 *     browser → nginx (public TLS ingress) → CRM (127.0.0.1) → backend
 *
 * The ingress sets, for every proxied request:
 *
 *     proxy_set_header X-Real-IP        $remote_addr;
 *     proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
 *
 * `proxy_set_header` REPLACES the header, so `X-Real-IP` as observed here is
 * always the TCP peer address nginx measured. A browser cannot influence it —
 * whatever it sends under that name is overwritten.
 *
 * `$proxy_add_x_forwarded_for` by contrast APPENDS: it expands to
 * `"<client-supplied X-Forwarded-For>, <real peer>"`, so its first element is
 * attacker-controlled — and the backend's `getRequestIp` reads exactly the first
 * element. Reading or forwarding the incoming `X-Forwarded-For` would hand any
 * client a trivial rate-limit bypass. So this module NEVER reads it.
 *
 * The CRM port stays bound to 127.0.0.1, so the ingress is the only way a public
 * client can reach it; there is no path that delivers an un-overwritten
 * `X-Real-IP` from the internet.
 *
 * ## Fail-safe direction
 *
 * A missing or malformed value yields `null` and NOTHING is forwarded. The
 * backend then falls back to whatever its own server injected for the loopback
 * hop, which lumps callers together — more restrictive, never less. We never
 * invent, guess or widen an address.
 *
 * This mirrors the Academy's `src/server/proxy/client-ip.ts`. The two frontends
 * share no module boundary; the contract is duplicated rather than depended on,
 * and both are asserted by their own suites.
 */

/** The one header the trusted ingress hop stamps. The only header we READ. */
export const TRUSTED_CLIENT_IP_HEADER = "x-real-ip";

/**
 * Headers we WRITE towards the backend, both set to the single trusted address.
 *
 * `x-forwarded-for` is not optional: the backend's `getRequestIp` checks it
 * FIRST and only then falls back to `x-real-ip`, and the backend's own Node
 * server injects `x-forwarded-for: 127.0.0.1` for any request that arrives
 * without one. Sending only `x-real-ip` would therefore be silently useless.
 */
export const FORWARDED_CLIENT_IP_HEADERS = ["x-forwarded-for", "x-real-ip"] as const;

/**
 * Headers that carry a client-controlled forwarding chain. The CRM's backend
 * client builds its outbound headers from scratch, so none of these is ever
 * forwarded; the login suite asserts that they are absent.
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

  if (
    groups.some((group, index) => {
      const isLast = index === groups.length - 1;
      if (isLast && group.includes(".")) return false;
      return !/^[0-9a-fA-F]{1,4}$/.test(group);
    })
  ) {
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
 * Derive the client IP the backend should rate-limit on, or `null` when no
 * trustworthy value is available.
 */
export function deriveTrustedClientIp(request: Request): string | null {
  const raw = request.headers.get(TRUSTED_CLIENT_IP_HEADER);
  if (raw === null) return null;

  // A single header value only. A comma means someone tried to smuggle a chain
  // through a field defined to hold exactly one address — reject it rather than
  // picking an element.
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.includes(",")) return null;

  // Strip an optional IPv6 bracket form; keep everything else verbatim.
  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;

  return isIpLiteral(unbracketed) ? unbracketed : null;
}
