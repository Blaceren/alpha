/**
 * SECTION I — final SSRF / socket security acceptance, on the FINAL runtime.
 * Exercises the WHOLE pipeline, not just the destination guard.
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import { deliverPostback } from "@/lib/affiliate/postback/client";
import {
  isBlockedAddress,
  resolveDestination,
  testHostAllowlist,
} from "@/lib/affiliate/postback/destination";

const ENVFILE = "/srv/ata/config/backend.env";
function loadEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const line of readFileSync(ENVFILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq)] = t.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return env;
}

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) pass += 1;
  else fail += 1;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${d ? "  ::  " + d : ""}`);
};

async function refused(env: NodeJS.ProcessEnv, name: string, url: string) {
  const r = await resolveDestination(url, env);
  ok(name, r.ok === false, r.ok ? "ACCEPTED(!!)" : `reason=${r.reason}`);
}

async function main() {
  const env = loadEnv();
  console.log("ENVIRONMENT UNDER TEST");
  console.log(`  ATA_ENVIRONMENT              ${JSON.stringify(env.ATA_ENVIRONMENT)}`);
  console.log(`  test host allowlist          ${JSON.stringify([...testHostAllowlist(env)])}`);
  console.log("");

  console.log("1. ADDRESS BLOCKLIST — the primitive every branch depends on");
  for (const a of [
    "127.0.0.1", "127.9.9.9", "0.0.0.0", "10.1.2.3", "172.16.5.4", "172.31.255.255",
    "192.168.1.1", "169.254.169.254", "169.254.1.1", "100.64.0.1", "192.0.0.1",
    "198.18.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
  ]) ok(`IPv4 ${a} is blocked`, isBlockedAddress(a));
  for (const a of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])
    ok(`IPv6 ${a} is blocked`, isBlockedAddress(a));
  ok("ordinary public IPv4 is NOT blocked (the suite can fail)", !isBlockedAddress("93.184.216.34"));
  ok("ordinary public IPv6 is NOT blocked", !isBlockedAddress("2606:4700::6810:7c60"));

  console.log("");
  console.log("2. URL / PARSE / NORMALISE REJECTIONS");
  await refused(env, "http:// is refused as a class", "http://example.com/cb");
  await refused(env, "ftp:// is refused", "ftp://example.com/cb");
  await refused(env, "file:// is refused", "file:///etc/passwd");
  await refused(env, "credentials in URL are refused", "https://user:pass@example.com/cb");
  await refused(env, "a malformed URL is refused", "https://[not a url");
  await refused(env, "an empty URL is refused", "");
  await refused(env, "a fragment is refused", "https://example.com/cb#frag");

  console.log("");
  console.log("3. HOST-SHAPE REJECTIONS");
  await refused(env, "localhost is refused", "https://localhost/cb");
  await refused(env, "a single-label host is refused", "https://intranet/cb");
  await refused(env, "an .internal name is refused", "https://svc.internal/cb");
  await refused(env, "a .local name is refused", "https://printer.local/cb");
  await refused(env, "an IPv4 literal is refused", "https://127.0.0.1/cb");
  await refused(env, "an IPv6 literal is refused", "https://[::1]/cb");
  await refused(env, "a public IPv4 literal is ALSO refused (literals as a class)", "https://93.184.216.34/cb");

  console.log("");
  console.log("4. PORT AND SUBDOMAIN TRICKS");
  await refused(env, "an alternate port on a public host is refused", "https://example.com:8443/cb");
  await refused(env, "port 9443 on a DIFFERENT host is refused", "https://example.com:9443/cb");
  await refused(env, "a SUBDOMAIN of the excepted host is refused", "https://evil.preprod.alfatrade.media:9443/cb");
  await refused(env, "the excepted host on a DIFFERENT port is refused", "https://preprod.alfatrade.media:9444/cb");
  await refused(env, "the excepted host over http:// is refused", "http://preprod.alfatrade.media:9443/cb");
  await refused(env, "credentials + the excepted host:port is refused", "https://u:p@preprod.alfatrade.media:9443/cb");

  console.log("");
  console.log("5. DNS-BASED REJECTIONS (real resolution)");
  await refused(env, "a name resolving to LOOPBACK is refused", "https://localtest.me/cb");
  await refused(env, "a name resolving to cloud METADATA is refused", "https://metadata.google.internal/cb");
  await refused(env, "an unresolvable name is refused, not defaulted", "https://no-such-host-ata-preprod-test.example/cb");

  console.log("");
  console.log("6. A LEGITIMATE PUBLIC DESTINATION IS ACCEPTED, AND PINNED");
  const good = await resolveDestination("https://example.com/cb", env);
  ok("example.com is accepted", good.ok === true,
    good.ok ? `address=${good.destination.address} family=${good.destination.family}` : `reason=${good.reason}`);
  if (good.ok) {
    ok("the approved address is a real IP", net.isIP(good.destination.address) !== 0);
    ok("the approved address is NOT blocked", !isBlockedAddress(good.destination.address));
    ok("port is 443", good.destination.port === 443);
    ok("it did NOT come via the test allowlist", good.destination.viaTestAllowlist !== true);
  }

  console.log("");
  console.log("7. THE SOCKET DIALS THE APPROVED ADDRESS — Node 22 lookup contract");
  // Capture the lookup the client hands to https.request, both shapes.
  const https = await import("node:https");
  const original = https.default.request;
  let captured: ((h: string, o: unknown, cb: (e: unknown, a: unknown, f?: number) => void) => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (https.default as any).request = (options: any) => {
    captured = options.lookup;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { on() { return this; }, end() {}, destroy() {} } as any;
  };
  void deliverPostback("https://example.com/cb", {}, env).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  (https.default as unknown as { request: typeof original }).request = original;

  ok("the client installs a custom lookup at all", captured !== null);
  if (captured) {
    const shim = captured as (h: string, o: unknown, cb: (e: unknown, a: unknown, f?: number) => void) => void;
    const asAll = await new Promise<unknown>((r) => shim("example.com", { all: true }, (_e, a) => r(a)));
    ok("all=true returns an ARRAY (the shape Node 22 actually requests)", Array.isArray(asAll),
      JSON.stringify(asAll));
    const arr = (Array.isArray(asAll) ? asAll : []) as Array<{ address: string; family: number }>;
    ok("all=true returns EXACTLY ONE address", arr.length === 1);
    ok("and that address is the guard-approved one",
      good.ok === true && arr[0]?.address === good.destination.address,
      `${arr[0]?.address} vs ${good.ok ? good.destination.address : "?"}`);
    ok("all=true entry has a numeric family", typeof arr[0]?.family === "number");

    const asOne = await new Promise<{ a: unknown; f?: number }>((r) =>
      shim("example.com", { all: false }, (_e, a, f) => r({ a, f })));
    ok("all=false returns a bare STRING", typeof asOne.a === "string", String(asOne.a));
    ok("and that string is the guard-approved address",
      good.ok === true && asOne.a === good.destination.address);
    ok("all=false returns a numeric family", typeof asOne.f === "number");

    const hostile = await new Promise<unknown>((r) =>
      shim("metadata.google.internal", { all: true }, (_e, a) => r(a)));
    ok("A HOSTILE HOSTNAME HANDED TO THE SHIM IS IGNORED — no fresh DNS",
      JSON.stringify(hostile) === JSON.stringify(asAll), JSON.stringify(hostile));
  }

  console.log("");
  console.log("8. END-TO-END OUTBOUND UNDER NORMAL POLICY (no exception, no NAT)");
  const live = await deliverPostback("https://example.com/", { "User-Agent": "ATA-Postback/1" }, env);
  ok("a normal public HTTPS destination is reached and classified",
    live.outcome === "delivered" || live.outcome === "http_4xx" || live.outcome === "http_5xx",
    `outcome=${live.outcome} status=${live.httpStatus ?? "-"}`);
  const blockedE2E = await deliverPostback("https://localtest.me/cb", {}, env);
  ok("a loopback-resolving destination is refused END TO END",
    blockedE2E.outcome === "blocked_destination", `outcome=${blockedE2E.outcome}`);
  const metaE2E = await deliverPostback("https://metadata.google.internal/", {}, env);
  ok("cloud metadata is refused END TO END",
    metaE2E.outcome === "blocked_destination" || metaE2E.outcome === "dns_error",
    `outcome=${metaE2E.outcome}`);

  console.log("");
  console.log("9. TLS VERIFICATION IS NOT WEAKENED");
  ok("NODE_TLS_REJECT_UNAUTHORIZED is not disabled in the deployment env",
    env.NODE_TLS_REJECT_UNAUTHORIZED === undefined || env.NODE_TLS_REJECT_UNAUTHORIZED === "1",
    String(env.NODE_TLS_REJECT_UNAUTHORIZED));
  const badTls = await deliverPostback("https://self-signed.badssl.com/", {}, env);
  ok("a self-signed certificate is REFUSED, not accepted",
    badTls.outcome !== "delivered", `outcome=${badTls.outcome}`);
  const wrongHost = await deliverPostback("https://wrong.host.badssl.com/", {}, env);
  ok("a certificate for the wrong host is REFUSED",
    wrongHost.outcome !== "delivered", `outcome=${wrongHost.outcome}`);

  console.log("");
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}
main();
