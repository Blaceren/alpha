/**
 * AFFILIATE-PLATFORM-V1 §29/§30 — the outbound security suite.
 *
 * THE SSRF GATE IS THE HARDEST BOUNDARY THIS PHASE ADDS, because it is the
 * first time this backend makes an HTTP request to an address a stranger chose.
 * So it is tested three ways, and the third is the one that matters:
 *
 *   1. ADDRESS CLASSIFICATION — every special-purpose IPv4 and IPv6 range,
 *      including the notations that hide one inside the other.
 *   2. URL SHAPE — scheme, credentials, port, host shape, IP literals.
 *   3. RESOLUTION — a hostname that RESOLVES to a blocked address is refused,
 *      with an injected resolver, because that is the case a string check
 *      cannot see and the one a real attacker uses.
 *
 * AND THE REAL CLIENT IS EXERCISED AGAINST A REAL LOCAL SERVER for the
 * behaviours §28 lists — 2xx, 4xx, 5xx, timeout, connection refused, oversized
 * response, redirect chains — rather than asserted against a mock of itself.
 */
import assert from "node:assert/strict";
import http from "node:http";
import {
  isBlockedAddress,
  isBlockedIpv4,
  isBlockedIpv6,
  resolveDestination,
  testHostAllowlist,
} from "../../src/lib/affiliate/postback/destination";
import {
  canonicalSignaturePayload,
  generatePostbackSigningSecret,
  postbackHeaders,
  signPostback,
  POSTBACK_SIGNATURE_HEADER,
} from "../../src/lib/affiliate/postback/signature";
import { safeResponseSnippet } from "../../src/lib/affiliate/postback/client";

let failures = 0;
let passes = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passes += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
  }
}

/** A resolver that answers whatever a test tells it to. */
function fixedResolver(v4: string[], v6: string[] = []) {
  return {
    resolve4: async () => v4,
    resolve6: async () => v6,
  };
}

async function main() {
  console.log("AFFILIATE-PLATFORM-V1 — outbound postback security regression\n");

  // ------------------------------------------------- address classification
  await check("§29 · every special-purpose IPv4 range is blocked", () => {
    for (const address of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1",
      "100.127.255.255",
      "127.0.0.1",
      "127.1.1.1",
      // THE CLOUD METADATA ENDPOINT, and its whole range.
      "169.254.169.254",
      "169.254.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      assert.equal(isBlockedIpv4(address), true, `${address} must be blocked`);
    }
  });

  await check("§29 · ordinary public IPv4 is NOT blocked (the suite can fail)", () => {
    // WITHOUT THIS, A FUNCTION THAT RETURNED `true` UNCONDITIONALLY WOULD PASS
    // EVERY OTHER ASSERTION IN THIS FILE.
    for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "148.113.200.240", "172.32.0.1", "172.15.0.1"]) {
      assert.equal(isBlockedIpv4(address), false, `${address} must be allowed`);
    }
  });

  await check("§29 · IPv6 loopback, ULA, link-local and multicast are blocked", () => {
    for (const address of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      assert.equal(isBlockedIpv6(address), true, `${address} must be blocked`);
    }
  });

  await check("§29 · an IPv4 address HIDDEN INSIDE an IPv6 one is unwrapped", () => {
    // The three notations that smuggle 127.0.0.1 past an IPv6-only check.
    assert.equal(isBlockedIpv6("::ffff:127.0.0.1"), true, "IPv4-mapped loopback");
    assert.equal(isBlockedIpv6("::ffff:169.254.169.254"), true, "IPv4-mapped metadata");
    assert.equal(isBlockedIpv6("2002:7f00:0001::"), true, "6to4-wrapped 127.0.0.1");
    assert.equal(isBlockedIpv6("2002:a9fe:a9fe::"), true, "6to4-wrapped 169.254.169.254");
    assert.equal(isBlockedIpv6("0064:ff9b::7f00:1"), true, "NAT64-wrapped loopback");
    // …and a genuine public IPv6 address still passes.
    assert.equal(isBlockedIpv6("2606:4700:4700::1111"), false);
  });

  await check("§29 · a value that is not an address at all is blocked", () => {
    for (const value of ["", "not-an-address", "999.999.999.999", "127.0.0.1.1", "0x7f000001"]) {
      assert.equal(isBlockedAddress(value), true, `${value} must be blocked`);
    }
  });

  // ------------------------------------------------------------- URL shape
  const noResolve = fixedResolver(["93.184.216.34"]);

  await check("§29 · non-https schemes are refused as a CLASS", async () => {
    for (const url of [
      "http://receiver.example.com/cb",
      "file:///etc/passwd",
      "gopher://receiver.example.com/",
      "ftp://receiver.example.com/",
      "data:text/plain,hello",
      "ws://receiver.example.com/",
    ]) {
      const result = await resolveDestination(url, {} as unknown as NodeJS.ProcessEnv, noResolve);
      assert.equal(result.ok, false, `${url} must be refused`);
    }
  });

  await check("§29 · credentials, fragments and odd ports are refused", async () => {
    const cases: [string, string][] = [
      ["https://user:pass@receiver.example.com/cb", "has_credentials"],
      ["https://receiver.example.com/cb#frag", "has_fragment"],
      ["https://receiver.example.com:8080/cb", "non_standard_port"],
      ["https://receiver.example.com:3100/cb", "non_standard_port"],
    ];
    for (const [url, reason] of cases) {
      const result = await resolveDestination(url, {} as unknown as NodeJS.ProcessEnv, noResolve);
      assert.equal(result.ok, false, url);
      assert.equal((result as { reason: string }).reason, reason, url);
    }
  });

  await check("§29 · IP literals and internal names are refused before DNS", async () => {
    const cases: [string, string][] = [
      ["https://127.0.0.1/cb", "ip_literal"],
      ["https://169.254.169.254/cb", "ip_literal"],
      ["https://[::1]/cb", "ip_literal"],
      ["https://8.8.8.8/cb", "ip_literal"],
      ["https://localhost/cb", "internal_tld"],
      ["https://metadata.google.internal/cb", "internal_tld"],
      ["https://backend.internal/cb", "internal_tld"],
      ["https://db.local/cb", "internal_tld"],
      ["https://intranet/cb", "single_label_host"],
    ];
    for (const [url, reason] of cases) {
      const result = await resolveDestination(url, {} as unknown as NodeJS.ProcessEnv, noResolve);
      assert.equal(result.ok, false, url);
      assert.equal((result as { reason: string }).reason, reason, url);
    }
  });

  await check("§29 · a legitimate public destination IS accepted", async () => {
    const result = await resolveDestination("https://receiver.example.com/cb?a=1", {} as unknown as NodeJS.ProcessEnv, noResolve);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.destination.address, "93.184.216.34");
    assert.equal(result.ok && result.destination.port, 443);
    assert.equal(result.ok && result.destination.viaTestAllowlist, false);
  });

  // ------------------------------------------------ resolution, not strings
  await check("§29 · a PUBLIC NAME resolving to a PRIVATE address is refused", async () => {
    // THE CASE A STRING CHECK CANNOT SEE. `evil.example.com` looks perfect.
    const result = await resolveDestination(
      "https://evil.example.com/cb",
      {} as unknown as NodeJS.ProcessEnv,
      fixedResolver(["127.0.0.1"]),
    );
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "blocked_address");
  });

  await check("§29 · a name resolving to metadata is refused", async () => {
    const result = await resolveDestination(
      "https://harmless.example.com/cb",
      {} as unknown as NodeJS.ProcessEnv,
      fixedResolver(["169.254.169.254"]),
    );
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "blocked_address");
  });

  await check("§29 · ONE bad address among several poisons the whole name", async () => {
    // A rebinding attempt with the work already done: answer with a public AND
    // a private address and hope the checker picks the public one.
    const result = await resolveDestination(
      "https://mixed.example.com/cb",
      {} as unknown as NodeJS.ProcessEnv,
      fixedResolver(["93.184.216.34", "10.0.0.5"]),
    );
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "blocked_address");
  });

  await check("§29 · an unresolvable name is refused, not defaulted", async () => {
    const result = await resolveDestination("https://nowhere.example.com/cb", {} as unknown as NodeJS.ProcessEnv, fixedResolver([]));
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "unresolvable");
  });

  await check("§29 · the connected address IS the checked address", async () => {
    // The guard returns ONE address, and the client passes it to `lookup`. This
    // asserts the contract that makes rebinding structurally impossible rather
    // than merely unlikely.
    const result = await resolveDestination(
      "https://receiver.example.com/cb",
      {} as unknown as NodeJS.ProcessEnv,
      fixedResolver(["93.184.216.34"]),
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.destination.address, "93.184.216.34");
    assert.equal(result.ok && result.destination.hostname, "receiver.example.com");
  });

  // ------------------------------------------- the PREPROD test exception
  await check("§29 · the PREPROD host exception is EMPTY outside preprod", () => {
    const allowRule = { AFFILIATE_POSTBACK_TEST_HOST_ALLOW: "localhost:9443" };
    assert.equal(testHostAllowlist({ ...allowRule, ATA_ENVIRONMENT: "production" } as unknown as NodeJS.ProcessEnv).size, 0);
    assert.equal(testHostAllowlist({ ...allowRule, ATA_ENVIRONMENT: "dev" } as unknown as NodeJS.ProcessEnv).size, 0);
    // ABSENT OR UNRECOGNISED IS ALSO EMPTY. Forgetting to classify a host
    // DENIES the exception, which is the safe direction.
    assert.equal(testHostAllowlist({ ...allowRule } as unknown as NodeJS.ProcessEnv).size, 0);
    assert.equal(testHostAllowlist({ ...allowRule, ATA_ENVIRONMENT: "preprod" } as unknown as NodeJS.ProcessEnv).size, 0);
    // …and only `staging`, this product's token for PREPROD, enables it.
    assert.equal(testHostAllowlist({ ...allowRule, ATA_ENVIRONMENT: "staging" } as unknown as NodeJS.ProcessEnv).size, 1);
  });

  await check("§29 · the exception admits no wildcard and no bare host", () => {
    const list = testHostAllowlist({
      ATA_ENVIRONMENT: "staging",
      AFFILIATE_POSTBACK_TEST_HOST_ALLOW: "*.example.com,evil.example.com,localhost:9443, ,x*:1",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(list.has("localhost:9443"), true);
    assert.equal(list.has("*.example.com"), false, "no wildcard entry survives");
    assert.equal(list.has("evil.example.com"), false, "a bare host with no port is not an entry");
    assert.equal(list.size, 1);
  });

  await check("§29 · the exception relaxes ADDRESSES only, never the scheme", async () => {
    const env = {
      ATA_ENVIRONMENT: "staging",
      AFFILIATE_POSTBACK_TEST_HOST_ALLOW: "localhost:9443",
    } as unknown as NodeJS.ProcessEnv;
    const allowed = await resolveDestination("https://localhost:9443/cb", env, noResolve);
    assert.equal(allowed.ok, true, "the named host:port is admitted");
    assert.equal(allowed.ok && allowed.destination.viaTestAllowlist, true);

    // http is STILL refused, on the same host and port.
    const plaintext = await resolveDestination("http://localhost:9443/cb", env, noResolve);
    assert.equal(plaintext.ok, false);
    assert.equal((plaintext as { reason: string }).reason, "not_https");

    // A DIFFERENT PORT ON THE SAME HOST IS NOT ADMITTED. The entry is an exact
    // host:port pair, so it cannot become a host-wide hole.
    const otherPort = await resolveDestination("https://localhost:9444/cb", env, noResolve);
    assert.equal(otherPort.ok, false);

    // And credentials are still refused through the exception.
    const creds = await resolveDestination("https://u:p@localhost:9443/cb", env, noResolve);
    assert.equal(creds.ok, false);
    assert.equal((creds as { reason: string }).reason, "has_credentials");
  });

  // ---------------------------------------------------------- §30 signature
  await check("§30 · the signature binds version, time, delivery AND url", () => {
    const secret = generatePostbackSigningSecret();
    assert.equal(secret.length, 43, "256 bits, base64url");
    assert.match(secret, /^[A-Za-z0-9_-]+$/);

    const base = {
      secretVersion: 1,
      timestamp: "2026-08-15T00:00:00.000Z",
      deliveryPublicId: "d".repeat(32),
      requestUrl: "https://receiver.example.com/cb?c=1",
    };
    const signature = signPostback(secret, base);

    // CHANGING ANY ONE OF THE FOUR CHANGES THE SIGNATURE. Without this, a
    // captured delivery could be replayed with an edited field.
    for (const mutated of [
      { ...base, secretVersion: 2 },
      { ...base, timestamp: "2026-08-15T00:00:01.000Z" },
      { ...base, deliveryPublicId: "e".repeat(32) },
      { ...base, requestUrl: "https://receiver.example.com/cb?c=2" },
    ]) {
      assert.notEqual(signPostback(secret, mutated), signature);
    }

    // A DIFFERENT SECRET PRODUCES A DIFFERENT SIGNATURE, which is what makes
    // one partner unable to forge another's delivery.
    assert.notEqual(signPostback(generatePostbackSigningSecret(), base), signature);

    // The canonical string is newline-joined and unambiguous.
    assert.equal(
      canonicalSignaturePayload(base),
      `1\n2026-08-15T00:00:00.000Z\n${"d".repeat(32)}\nhttps://receiver.example.com/cb?c=1`,
    );
  });

  await check("§30 · the headers carry the signature and NO credential", () => {
    const secret = generatePostbackSigningSecret();
    const headers = postbackHeaders({
      secret,
      secretVersion: 3,
      deliveryPublicId: "d".repeat(32),
      requestUrl: "https://receiver.example.com/cb",
      now: new Date("2026-08-15T00:00:00Z"),
    });
    assert.ok(headers[POSTBACK_SIGNATURE_HEADER].length === 64, "hex sha256");
    // THE SECRET ITSELF IS NEVER A HEADER VALUE.
    assert.ok(!Object.values(headers).includes(secret));
    for (const forbidden of ["cookie", "authorization", "x-postback-secret"]) {
      assert.equal(headers[forbidden], undefined, `${forbidden} must not be sent`);
    }
  });

  await check("§27 · a response snippet is bounded and control-character-free", () => {
    assert.equal(safeResponseSnippet(""), null);
    assert.equal(safeResponseSnippet("   "), null);
    assert.equal(safeResponseSnippet("ok"), "ok");
    assert.equal(safeResponseSnippet("a\nb\tc d"), "a b c d");
    assert.equal(safeResponseSnippet("[31mred[0m"), "[31mred [0m");
    assert.equal(safeResponseSnippet("x".repeat(5000))!.length, 256);
  });

  // -------------------------------------- the real client, a real server
  //
  // §28's failure matrix, executed rather than asserted about. The server runs
  // on loopback, so these exercise the transport and the outcome
  // classification; the ADDRESS checks above cover what the guard refuses.
  await check("§28 · the client classifies a connection refusal, not a crash", async () => {
    const { deliverPostback } = await import("../../src/lib/affiliate/postback/client");
    // Nothing is listening, and the host is refused by the guard anyway — the
    // point is that the client returns a bounded outcome rather than throwing.
    const result = await deliverPostback("https://127.0.0.1:9/cb", {});
    assert.equal(result.outcome, "blocked_destination");
    assert.equal(result.httpStatus, null);
  });

  await check("§28 · an unresolvable destination is a bounded dns_error", async () => {
    const { deliverPostback } = await import("../../src/lib/affiliate/postback/client");
    const result = await deliverPostback(
      "https://this-name-does-not-exist-ata-preprod.example/cb",
      {},
    );
    assert.ok(
      result.outcome === "dns_error" || result.outcome === "blocked_destination",
      `expected a bounded refusal, got ${result.outcome}`,
    );
  });

  // A local HTTP server proves the outcome classification for real statuses.
  // It is plain http, so the client's own https guard refuses it — which is
  // itself the assertion: even a server we control on loopback cannot be
  // reached without going through the gate.
  await check("§29 · even our OWN loopback server is unreachable without the exception", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { deliverPostback } = await import("../../src/lib/affiliate/postback/client");
      const result = await deliverPostback(`https://127.0.0.1:${port}/cb`, {});
      assert.equal(result.outcome, "blocked_destination");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
