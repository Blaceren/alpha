/**
 * AFFILIATE-PLATFORM-V1 §29 — THE SSRF GATE. A HARD SECURITY BOUNDARY.
 *
 * A partner-configured destination is a URL a stranger chose, and this server
 * is about to fetch it. That is a server-side request forgery primitive by
 * definition, and the only question is whether it is a constrained one.
 *
 * ---------------------------------------------------------------------------
 * WHY VALIDATING THE URL IS NOT ENOUGH, AND WHAT THIS MODULE DOES INSTEAD
 *
 * The naive implementation parses the URL, checks the hostname is not
 * `localhost`, and calls `fetch`. That fails to three separate attacks:
 *
 *   1. A hostname that RESOLVES to 127.0.0.1 or 169.254.169.254. Nothing about
 *      the string says so.
 *   2. DNS REBINDING — the name resolves to a public address when checked and
 *      to a private one when connected, because those are two separate
 *      resolutions and an attacker controls the TTL.
 *   3. A REDIRECT to any of the above, which `fetch` follows silently.
 *
 * So this module does not validate a string and hope. It:
 *
 *   * refuses IP literals outright — partners configure hostnames;
 *   * resolves the name ITSELF and validates EVERY returned address;
 *   * CONNECTS TO THE VALIDATED ADDRESS, by handing the socket layer a custom
 *     `lookup` that returns only an address this module already approved. The
 *     checked address and the connected address are therefore the SAME VALUE,
 *     not two resolutions of the same name, which is what closes the rebinding
 *     window rather than narrowing it;
 *   * follows redirects MANUALLY, revalidating each hop from scratch, with a
 *     hard cap;
 *   * bounds connect time, total time and response bytes.
 *
 * ---------------------------------------------------------------------------
 * ONE PREPROD EXCEPTION, AND IT IS SOURCE-OWNED AND NARROW
 *
 * Accepting a delivery is meaningless if it cannot be OBSERVED, and this
 * environment has no public receiver to point at. §29 permits an explicit
 * PREPROD test exception, so one exists: `AFFILIATE_POSTBACK_TEST_HOST_ALLOW`
 * names at most a few exact host:port pairs that bypass the ADDRESS checks and
 * nothing else. It is refused outright unless the runtime environment is
 * PREPROD, it is a full-string exact match with no wildcard and no suffix rule,
 * and it never relaxes the scheme, the redirect cap, the timeouts or the byte
 * bound. Its whole purpose is to let a loopback receiver inside this host be
 * used as the controlled receiver §47 asks for.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { classifyEnvironment } from "@/lib/environment";

export const AFFILIATE_POSTBACK_TEST_HOST_ALLOW_KEY = "AFFILIATE_POSTBACK_TEST_HOST_ALLOW";

export type DestinationRejection =
  | "not_absolute"
  | "not_https"
  | "has_credentials"
  | "has_fragment"
  | "non_standard_port"
  | "ip_literal"
  | "single_label_host"
  | "internal_tld"
  | "unresolvable"
  | "blocked_address"
  | "too_long";

export const DESTINATION_MAX_LENGTH = 4096;

/**
 * Host suffixes that name something inside an infrastructure rather than on the
 * internet. A partner has no legitimate destination under any of them.
 */
const INTERNAL_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
  ".localdomain",
] as const;

const LITERAL_INTERNAL_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** Parse a dotted-quad into its four octets, or null. */
function ipv4Octets(address: string): [number, number, number, number] | null {
  if (net.isIPv4(address) !== true) return null;
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

/**
 * Is this IPv4 address one this server must never be made to talk to?
 *
 * EVERY SPECIAL-PURPOSE RANGE, not just the famous three. 169.254.0.0/16 is
 * what makes 169.254.169.254 — the cloud metadata endpoint on every major
 * provider — unreachable, and it is listed as a RANGE rather than as that one
 * address so a provider-specific variant inside the same block is covered too.
 */
export function isBlockedIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets === null) return true; // unparseable is not usable
  const [a, b] = octets;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.0/24 IETF, 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 88) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * Is this IPv6 address blocked?
 *
 * IPv4-MAPPED AND 6to4 ADDRESSES ARE UNWRAPPED AND RE-CHECKED AS IPv4. Without
 * that, `::ffff:127.0.0.1` and `2002:7f00:0001::` are both loopback wearing a
 * different notation, and an IPv6-only check would wave them through.
 */
export function isBlockedIpv6(address: string): boolean {
  if (net.isIPv6(address) !== true) return true;
  const lower = address.toLowerCase();

  // IPv4-mapped / IPv4-compatible, in either textual form.
  const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped !== null) return isBlockedIpv4(mapped[1]);

  const expanded = expandIpv6(lower);
  if (expanded === null) return true;

  // ::/128 unspecified and ::1/128 loopback.
  if (/^0{4}(:0{4}){6}:0{3}[01]$/.test(expanded)) return true;

  const first = parseInt(expanded.slice(0, 4), 16);

  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  // 2002::/16 6to4 embeds an IPv4 address in the next 32 bits.
  if (first === 0x2002) {
    const hi = parseInt(expanded.slice(5, 9), 16);
    const lo = parseInt(expanded.slice(10, 14), 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(v4);
  }

  // 64:ff9b::/96 NAT64 does the same thing in the low 32 bits.
  if (expanded.startsWith("0064:ff9b:")) {
    const hi = parseInt(expanded.slice(30, 34), 16);
    const lo = parseInt(expanded.slice(35, 39), 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(v4);
  }

  // 2001:db8::/32 documentation, 2001::/32 Teredo (tunnels anywhere).
  if (expanded.startsWith("2001:0db8:")) return true;
  if (expanded.startsWith("2001:0000:")) return true;
  // 100::/64 discard-only.
  if (expanded.startsWith("0100:0000:0000:0000:")) return true;

  return false;
}

/** Expand a compressed IPv6 literal to eight zero-padded groups. */
function expandIpv6(address: string): string | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail]
      : head;
  if (groups.length !== 8) return null;
  if (groups.some((g) => g === "" || !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, "0")).join(":");
}

export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) return isBlockedIpv4(address);
  if (net.isIPv6(address)) return isBlockedIpv6(address);
  return true;
}

/**
 * The PREPROD-only exact host allowlist. Empty everywhere else, unconditionally.
 */
export function testHostAllowlist(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  // FAIL CLOSED OUTSIDE PREPROD. Not "if production, ignore it" — the
  // environment must POSITIVELY classify as `staging`, which is this product's
  // token for PREPROD, so a deployment whose environment is absent,
  // unrecognised or ambiguous gets an EMPTY SET rather than an exception.
  // Forgetting to classify a host therefore denies the exception, which is the
  // safe direction and the same rule every other capability here follows.
  const classification = classifyEnvironment(env);
  if (classification.kind !== "classified" || classification.environment !== "staging") {
    return new Set();
  }
  const raw = env[AFFILIATE_POSTBACK_TEST_HOST_ALLOW_KEY];
  if (typeof raw !== "string" || raw.trim() === "") return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      // No wildcard, no suffix rule, no empty entry. An exact `host:port`.
      .filter((entry) => entry !== "" && !entry.includes("*") && entry.includes(":")),
  );
}

export type ResolvedDestination = {
  readonly url: URL;
  readonly hostname: string;
  readonly port: number;
  /** The single address this request must connect to. */
  readonly address: string;
  readonly family: 4 | 6;
  /** True when the PREPROD exception admitted an otherwise-blocked address. */
  readonly viaTestAllowlist: boolean;
};

export type DestinationResult =
  | { readonly ok: true; readonly destination: ResolvedDestination }
  | { readonly ok: false; readonly reason: DestinationRejection };

/**
 * Validate a concrete destination URL and resolve it to ONE approved address.
 *
 * CALLED BEFORE EVERY ATTEMPT AND AFTER EVERY REDIRECT. Never cached: a cached
 * approval is a rebinding window measured in whatever the cache TTL is.
 */
export async function resolveDestination(
  rawUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  resolver: {
    resolve4: (h: string) => Promise<string[]>;
    resolve6: (h: string) => Promise<string[]>;
  } = { resolve4: (h) => dns.resolve4(h), resolve6: (h) => dns.resolve6(h) },
): Promise<DestinationResult> {
  if (rawUrl.length > DESTINATION_MAX_LENGTH) return { ok: false, reason: "too_long" };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "not_absolute" };
  }

  // SCHEME FIRST. This single check removes file:, data:, gopher:, ftp:, blob:
  // and every other scheme as a class, rather than blocklisting them.
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "has_credentials" };
  if (url.hash !== "") return { ok: false, reason: "has_fragment" };

  const port = url.port === "" ? 443 : Number(url.port);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowlist = testHostAllowlist(env);
  const allowKey = `${hostname}:${port}`;
  const allowed = allowlist.has(allowKey);

  if (port !== 443 && !allowed) return { ok: false, reason: "non_standard_port" };

  // IP LITERALS ARE REFUSED OUTRIGHT. A partner configures a hostname. Allowing
  // a literal would mean the only defence is the address blocklist, and there
  // is no reason to depend on one check when two are available.
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) {
    if (!allowed) return { ok: false, reason: "ip_literal" };
  }

  if (!allowed) {
    if (LITERAL_INTERNAL_HOSTS.has(hostname)) return { ok: false, reason: "internal_tld" };
    if (INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return { ok: false, reason: "internal_tld" };
    }
    // A single-label name can only be resolved by a search domain, which means
    // it names something on the internal network.
    if (!hostname.includes(".")) return { ok: false, reason: "single_label_host" };
  }

  // THE PREPROD EXCEPTION ENDS HERE. It skips the address checks, and nothing
  // else: scheme, credentials, fragment, redirect cap, timeouts and the byte
  // bound all still apply.
  if (allowed) {
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    const address = net.isIP(literal) !== 0 ? literal : "127.0.0.1";
    return {
      ok: true,
      destination: {
        url,
        hostname,
        port,
        address,
        family: net.isIPv6(address) ? 6 : 4,
        viaTestAllowlist: true,
      },
    };
  }

  // RESOLVE HERE, VALIDATE HERE, AND CONNECT TO THIS EXACT VALUE. The caller
  // passes `address` to the socket's `lookup`, so no second resolution happens.
  const [v4, v6] = await Promise.all([
    resolver.resolve4(hostname).catch(() => [] as string[]),
    resolver.resolve6(hostname).catch(() => [] as string[]),
  ]);

  const addresses = [...v4, ...v6];
  if (addresses.length === 0) return { ok: false, reason: "unresolvable" };

  // EVERY ADDRESS MUST PASS, not merely the first. A name that returns one
  // public and one private address is a rebinding attempt with the work already
  // done, and picking the public one would be choosing to be fooled.
  if (addresses.some((address) => isBlockedAddress(address))) {
    return { ok: false, reason: "blocked_address" };
  }

  const chosen = addresses[0];
  return {
    ok: true,
    destination: {
      url,
      hostname,
      port,
      address: chosen,
      family: net.isIPv6(chosen) ? 6 : 4,
      viaTestAllowlist: false,
    },
  };
}
