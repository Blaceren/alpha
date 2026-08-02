/**
 * L4PA-1 — official Pocket Partner adapter: hash, configuration, HTTP client,
 * response validation, error matrix and redaction.
 *
 * NO EXTERNAL REQUEST IS MADE. The only endpoint contacted is the deterministic
 * loopback mock started by this suite on an ephemeral 127.0.0.1 port. There is
 * no real Partner ID, no real trader id and no real API token anywhere in this
 * file — only the synthetic values the phase mandates.
 *
 * Proven here:
 *   A. hash        — the exact documented preimage, determinism, sensitivity.
 *   B. config      — every rejection reason; production host; loopback rules.
 *   C. transport   — method, path shape, redirect refusal, size cap, timeout.
 *   D. validation  — identity, status, real/demo/ftd/deposit field discipline.
 *   E. threshold   — 49.99 fails, 50.00 passes, demo never contributes.
 *   F. errors      — the full HTTP matrix; infrastructure is never `not_met`.
 *   G. redaction   — token, hash, URL and balance appear nowhere in any output.
 */
import assert from "node:assert/strict";

import { leaksValue } from "../../src/lib/testing/leakDetection";
import crypto from "node:crypto";

// `NODE_ENV` is typed read-only, but the loopback base URL is only accepted in
// a genuine test process — so the suite must actually be one.
Object.assign(process.env, { NODE_ENV: "test" });

import {
  POCKET_PARTNER_TEST_MARKER,
  resolvePocketPartnerConfig,
  type PocketPartnerConfig,
} from "../../src/lib/exchange/pocketPartnerConfig";
import { buildPocketPartnerHash } from "../../src/lib/exchange/pocketPartnerHash";
import { verifyPocketPartnerThreshold } from "../../src/lib/exchange/pocketPartnerClient";
import { createPocketPartnerBalanceProvider } from "../../src/lib/curriculum/checkpoint-provider-pocket";
import {
  startPocketPartnerMockServer,
  type PocketMockScenario,
  type PocketMockServer,
} from "./support/pocketPartnerMockServer";

/** Synthetic, mandated by the phase. None of these is a real credential. */
const PARTNER_ID = 424242;
const USER_ID = "101010";
const TOKEN = "test-token-not-a-real-pocket-secret";
const THRESHOLD = 5000; // USD 50.00 in minor units.

/** Known-answer vectors, computed independently of the implementation. */
const VECTOR_BASE = "e7cbc19281b23a2aca937888339b6086";
const VECTOR_OTHER_USER = "e5cd194e54683735cf92a330f0eb5c60";
const VECTOR_OTHER_PARTNER = "3882e78752a880567ff9ef1c77761d58";
const VECTOR_ROTATED_TOKEN = "3a3d9f573afd7623aac1a65a83b2aadf";

/** Values that must never appear in any result, log line or serialised output. */
const FORBIDDEN_TOKENS = [
  TOKEN,
  VECTOR_BASE,
  "api/user-info",
  "real_balance",
  "demo_balance",
  "ftd_amount",
  "total_deposits",
  "260",
  "10000",
  "49.99",
];

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/** Captures console output so "never logged" is proven, not assumed. */
function captureConsole() {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
  };
  console.log = record;
  console.warn = record;
  console.error = record;
  return {
    lines,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function testEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    NODE_ENV: "test",
    POCKET_PARTNER_API_BASE_URL: "https://pocketpartners.com",
    POCKET_PARTNER_ID: String(PARTNER_ID),
    POCKET_PARTNER_API_TOKEN: "a-sufficiently-long-production-shaped-token",
    ...overrides,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return env as NodeJS.ProcessEnv;
}

function loopbackConfig(server: PocketMockServer): PocketPartnerConfig {
  const resolved = resolvePocketPartnerConfig(
    testEnv({
      POCKET_PARTNER_API_BASE_URL: server.baseUrl,
      POCKET_PARTNER_API_TOKEN: TOKEN,
      POCKET_PARTNER_API_TEST_MODE: POCKET_PARTNER_TEST_MARKER,
    }),
  );
  assert.equal(resolved.configured, true, "loopback test config must resolve");
  return resolved as PocketPartnerConfig;
}

async function callMock(
  server: PocketMockServer,
  scenario: PocketMockScenario,
  overrides: { timeoutMs?: number; userId?: string; threshold?: number } = {},
) {
  server.setScenario(scenario);
  const config = loopbackConfig(server);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), overrides.timeoutMs ?? 5_000);
  try {
    return await verifyPocketPartnerThreshold({
      config,
      pocketUserId: overrides.userId ?? USER_ID,
      thresholdMinorUnits: overrides.threshold ?? THRESHOLD,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  /* ------------------------------------------------------------------ */
  /* A. Hash — the official contract                                     */
  /* ------------------------------------------------------------------ */

  await check("A1 hash matches the documented preimage exactly", () => {
    assert.equal(buildPocketPartnerHash(101010, PARTNER_ID, TOKEN), VECTOR_BASE);
    // Independently: MD5 of `{user_id}:{partner_id}:{api_token}` in UTF-8.
    assert.equal(
      VECTOR_BASE,
      crypto.createHash("md5").update(`101010:${PARTNER_ID}:${TOKEN}`, "utf8").digest("hex"),
    );
  });

  await check("A2 hash is lowercase hexadecimal and 32 chars", () => {
    const hash = buildPocketPartnerHash(101010, PARTNER_ID, TOKEN);
    assert.match(hash, /^[0-9a-f]{32}$/);
    assert.equal(hash, hash.toLowerCase());
  });

  await check("A3 hash is deterministic", () => {
    const a = buildPocketPartnerHash(101010, PARTNER_ID, TOKEN);
    const b = buildPocketPartnerHash(101010, PARTNER_ID, TOKEN);
    assert.equal(a, b);
  });

  await check("A4 user id change changes the hash", () => {
    assert.equal(buildPocketPartnerHash(101011, PARTNER_ID, TOKEN), VECTOR_OTHER_USER);
    assert.notEqual(VECTOR_OTHER_USER, VECTOR_BASE);
  });

  await check("A5 partner id change changes the hash", () => {
    assert.equal(buildPocketPartnerHash(101010, PARTNER_ID + 1, TOKEN), VECTOR_OTHER_PARTNER);
    assert.notEqual(VECTOR_OTHER_PARTNER, VECTOR_BASE);
  });

  await check("A6 token rotation changes the hash", () => {
    assert.equal(
      buildPocketPartnerHash(101010, PARTNER_ID, `${TOKEN}-2`),
      VECTOR_ROTATED_TOKEN,
    );
    assert.notEqual(VECTOR_ROTATED_TOKEN, VECTOR_BASE);
  });

  await check("A7 separator and ordering are exactly as documented", () => {
    // Any other separator, order, padding or encoding yields a different digest.
    const wrongSeparator = crypto
      .createHash("md5")
      .update(`101010|${PARTNER_ID}|${TOKEN}`, "utf8")
      .digest("hex");
    const wrongOrder = crypto
      .createHash("md5")
      .update(`${PARTNER_ID}:101010:${TOKEN}`, "utf8")
      .digest("hex");
    const withSpaces = crypto
      .createHash("md5")
      .update(`101010 : ${PARTNER_ID} : ${TOKEN}`, "utf8")
      .digest("hex");
    const quoted = crypto
      .createHash("md5")
      .update(`"101010":"${PARTNER_ID}":"${TOKEN}"`, "utf8")
      .digest("hex");
    for (const other of [wrongSeparator, wrongOrder, withSpaces, quoted]) {
      assert.notEqual(other, VECTOR_BASE);
    }
  });

  await check("A8 invalid identifiers are refused, and no value is echoed", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => buildPocketPartnerHash(bad, PARTNER_ID, TOKEN));
      assert.throws(() => buildPocketPartnerHash(101010, bad, TOKEN));
    }
    assert.throws(() => buildPocketPartnerHash(101010, PARTNER_ID, ""));
    try {
      buildPocketPartnerHash(101010, PARTNER_ID, "");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(!message.includes(TOKEN));
    }
  });

  /* ------------------------------------------------------------------ */
  /* B. Configuration                                                    */
  /* ------------------------------------------------------------------ */

  await check("B1 production HTTPS on the exact approved host resolves", () => {
    const resolved = resolvePocketPartnerConfig(testEnv());
    assert.equal(resolved.configured, true);
    if (resolved.configured) {
      assert.equal(resolved.baseUrl, "https://pocketpartners.com");
      assert.equal(resolved.partnerId, PARTNER_ID);
      assert.equal(resolved.timeoutMs, 5_000);
      assert.equal(resolved.testMode, false);
    }
  });

  await check("B2 absent configuration is unconfigured, never a default", () => {
    for (const [key, reason] of [
      ["POCKET_PARTNER_API_BASE_URL", "missing_base_url"],
      ["POCKET_PARTNER_ID", "missing_partner_id"],
      ["POCKET_PARTNER_API_TOKEN", "missing_api_token"],
    ] as const) {
      const resolved = resolvePocketPartnerConfig(testEnv({ [key]: undefined }));
      assert.equal(resolved.configured, false);
      if (!resolved.configured) assert.equal(resolved.reason, reason);
    }
  });

  await check("B3 production rejects HTTP, unexpected hosts and lookalikes", () => {
    const cases: Array<[string, string]> = [
      ["http://pocketpartners.com", "insecure_scheme"],
      ["https://evil.example.com", "unexpected_host"],
      ["https://api.pocketpartners.com", "unexpected_host"],
      ["https://pocketpartners.com.evil.test", "unexpected_host"],
      ["ftp://pocketpartners.com", "insecure_scheme"],
    ];
    for (const [base, reason] of cases) {
      const resolved = resolvePocketPartnerConfig(
        testEnv({ POCKET_PARTNER_API_BASE_URL: base }),
      );
      assert.equal(resolved.configured, false, base);
      if (!resolved.configured) assert.equal(resolved.reason, reason, base);
    }
  });

  await check("B4 production rejects credentials, query, fragment and base path", () => {
    const cases: Array<[string, string]> = [
      ["https://user:pass@pocketpartners.com", "url_credentials_present"],
      ["https://pocketpartners.com?x=1", "url_query_present"],
      ["https://pocketpartners.com#frag", "url_fragment_present"],
      ["https://pocketpartners.com/some/base", "unexpected_base_path"],
    ];
    for (const [base, reason] of cases) {
      const resolved = resolvePocketPartnerConfig(
        testEnv({ POCKET_PARTNER_API_BASE_URL: base }),
      );
      assert.equal(resolved.configured, false, base);
      if (!resolved.configured) assert.equal(resolved.reason, reason, base);
    }
  });

  await check("B5 loopback is refused without NODE_ENV=test AND the marker", () => {
    const base = "http://127.0.0.1:9999";
    // No marker at all.
    const noMarker = resolvePocketPartnerConfig(
      testEnv({ POCKET_PARTNER_API_BASE_URL: base, POCKET_PARTNER_API_TOKEN: TOKEN }),
    );
    assert.equal(noMarker.configured, false);
    if (!noMarker.configured) assert.equal(noMarker.reason, "insecure_scheme");

    // Marker present but NODE_ENV is not test.
    const wrongNodeEnv = resolvePocketPartnerConfig(
      testEnv({
        NODE_ENV: "production",
        POCKET_PARTNER_API_BASE_URL: base,
        POCKET_PARTNER_API_TOKEN: TOKEN,
        POCKET_PARTNER_API_TEST_MODE: POCKET_PARTNER_TEST_MARKER,
      }),
    );
    assert.equal(wrongNodeEnv.configured, false);
    if (!wrongNodeEnv.configured) assert.equal(wrongNodeEnv.reason, "test_marker_not_allowed");

    // HTTPS loopback still needs the marker.
    const httpsLoopback = resolvePocketPartnerConfig(
      testEnv({ POCKET_PARTNER_API_BASE_URL: "https://127.0.0.1:9999" }),
    );
    assert.equal(httpsLoopback.configured, false);
    if (!httpsLoopback.configured) assert.equal(httpsLoopback.reason, "loopback_not_allowed");
  });

  await check("B6 the synthetic test token can never reach a real host", () => {
    const resolved = resolvePocketPartnerConfig(
      testEnv({ POCKET_PARTNER_API_TOKEN: TOKEN }),
    );
    assert.equal(resolved.configured, false);
    if (!resolved.configured) assert.equal(resolved.reason, "test_token_rejected");

    // Even with the marker set, a non-loopback host refuses the synthetic token.
    const marked = resolvePocketPartnerConfig(
      testEnv({
        POCKET_PARTNER_API_TOKEN: TOKEN,
        POCKET_PARTNER_API_TEST_MODE: POCKET_PARTNER_TEST_MARKER,
      }),
    );
    assert.equal(marked.configured, false);
    if (!marked.configured) assert.equal(marked.reason, "test_token_rejected");
  });

  await check("B7 partner id and token shape are validated", () => {
    for (const bad of ["0", "-5", "abc", "12.5", "1e3", "٧", "07"]) {
      const resolved = resolvePocketPartnerConfig(testEnv({ POCKET_PARTNER_ID: bad }));
      assert.equal(resolved.configured, false, bad);
    }
    // Surrounding whitespace in an environment variable is tolerated: it is an
    // unambiguous transcription artefact, not a different Partner ID. The value
    // is still required to be a canonical decimal integer after trimming.
    const padded = resolvePocketPartnerConfig(testEnv({ POCKET_PARTNER_ID: "  424242  " }));
    assert.equal(padded.configured, true);
    if (padded.configured) assert.equal(padded.partnerId, PARTNER_ID);
    const shortToken = resolvePocketPartnerConfig(
      testEnv({ POCKET_PARTNER_API_TOKEN: "short" }),
    );
    assert.equal(shortToken.configured, false);
    if (!shortToken.configured) assert.equal(shortToken.reason, "invalid_api_token");
  });

  await check("B8 timeout is bounded and falls back rather than throwing", () => {
    for (const [raw, expected] of [
      ["3000", 3000],
      ["999", 5000],
      ["999999", 5000],
      ["abc", 5000],
      ["", 5000],
    ] as const) {
      const resolved = resolvePocketPartnerConfig(
        testEnv({ POCKET_PARTNER_API_TIMEOUT_MS: raw || undefined }),
      );
      assert.equal(resolved.configured, true, raw);
      if (resolved.configured) assert.equal(resolved.timeoutMs, expected, raw);
    }
  });

  /* ------------------------------------------------------------------ */
  /* C-F. Transport, validation, threshold and error matrix              */
  /* ------------------------------------------------------------------ */

  const server = await startPocketPartnerMockServer({
    partnerId: PARTNER_ID,
    apiToken: TOKEN,
    delayMs: 10_000,
  });

  try {
    await check("C1 the adapter sends GET on the exact documented path", async () => {
      server.reset();
      await callMock(server, "real_above_threshold");
      const observed = server.lastObservation();
      assert.ok(observed);
      assert.equal(observed.method, "GET");
      assert.equal(observed.segmentCount, 5);
      assert.equal(observed.userIdSegment, USER_ID);
      assert.equal(observed.partnerIdSegment, String(PARTNER_ID));
      assert.equal(observed.hashLength, 32);
      assert.equal(observed.hashIsLowercaseHex, true);
    });

    await check("C2 the mock independently verifies the hash the adapter built", async () => {
      server.reset();
      await callMock(server, "real_above_threshold");
      assert.equal(server.lastObservation()?.hashMatched, true);
      assert.equal(server.authenticatedCallCount(), 1);
    });

    await check("C3 a wrong hash is rejected by the provider contract", async () => {
      server.reset();
      const result = await callMock(server, "hash_rejected");
      // The mock answers 403; the adapter must read that as OUR credential
      // problem, never as a statement about the learner.
      assert.equal(result.outcome.kind, "unavailable");
      if (result.outcome.kind === "unavailable") {
        assert.equal(result.outcome.reason, "provider_maintenance");
      }
    });

    await check("C4 exactly one request per verification — no retry", async () => {
      for (const scenario of ["http_500", "http_503", "malformed_json"] as const) {
        server.reset();
        await callMock(server, scenario);
        assert.equal(server.callCount(), 1, scenario);
      }
    });

    await check("C5 a redirect is refused, never followed", async () => {
      server.reset();
      const result = await callMock(server, "redirect");
      assert.equal(result.outcome.kind, "invalid_provider_response");
      assert.equal(server.callCount(), 1);
    });

    await check("C6 an oversized response is abandoned at the cap", async () => {
      const result = await callMock(server, "oversized_response");
      assert.equal(result.outcome.kind, "invalid_provider_response");
    });

    await check("C7 a dropped connection is unavailable, never not_met", async () => {
      const result = await callMock(server, "connection_close");
      assert.equal(result.outcome.kind, "unavailable");
    });

    await check("C8 the deadline is honoured and reported as a timeout", async () => {
      const started = Date.now();
      const result = await callMock(server, "delayed_timeout", { timeoutMs: 400 });
      const elapsed = Date.now() - started;
      assert.equal(result.outcome.kind, "unavailable");
      if (result.outcome.kind === "unavailable") {
        assert.equal(result.outcome.reason, "provider_timeout");
      }
      assert.ok(elapsed < 5_000, `timed out promptly (${elapsed}ms)`);
    });

    await check("D1 identity: response user_id must equal the requested id", async () => {
      const result = await callMock(server, "user_id_mismatch");
      assert.equal(result.outcome.kind, "identity_mismatch");
    });

    await check("D2 identity: response partner_id must equal the configured id", async () => {
      const result = await callMock(server, "partner_id_mismatch");
      assert.equal(result.outcome.kind, "identity_mismatch");
    });

    await check("D3 status: only exact `active` may be evaluated", async () => {
      for (const scenario of ["status_inactive", "status_unknown", "status_missing"] as const) {
        const result = await callMock(server, scenario);
        assert.equal(result.outcome.kind, "invalid_provider_response", scenario);
        // Critically: an inactive account is NOT reported as `not_met`.
        assert.notEqual(result.outcome.kind, "not_met", scenario);
      }
    });

    await check("D4 real_balance must be a finite non-negative number", async () => {
      for (const scenario of [
        "real_balance_missing",
        "real_balance_string",
        "real_balance_negative",
        "real_balance_null",
      ] as const) {
        const result = await callMock(server, scenario);
        assert.equal(result.outcome.kind, "invalid_provider_response", scenario);
      }
    });

    await check("D5 malformed JSON and array roots are refused", async () => {
      for (const scenario of ["malformed_json", "array_response"] as const) {
        const result = await callMock(server, scenario);
        assert.equal(result.outcome.kind, "invalid_provider_response", scenario);
      }
    });

    await check("E1 real_balance 50.00 meets the USD 50 threshold", async () => {
      const result = await callMock(server, "real_at_threshold");
      assert.equal(result.outcome.kind, "met");
    });

    await check("E2 real_balance 49.99 does NOT meet it and is never rounded up", async () => {
      const result = await callMock(server, "real_just_below_threshold");
      assert.equal(result.outcome.kind, "not_met");
    });

    await check("E3 real_balance well above the threshold meets it", async () => {
      const result = await callMock(server, "real_above_threshold");
      assert.equal(result.outcome.kind, "met");
    });

    await check("E4 a huge demo balance never passes a below-threshold real one", async () => {
      const result = await callMock(server, "demo_huge_real_below");
      assert.equal(result.outcome.kind, "not_met");
    });

    await check("E5 a met real balance passes with demo zero", async () => {
      const result = await callMock(server, "real_met_demo_zero");
      assert.equal(result.outcome.kind, "met");
    });

    await check("F1 the HTTP error matrix maps conservatively", async () => {
      const matrix: Array<[PocketMockScenario, string, string | null]> = [
        ["http_401", "unavailable", "provider_maintenance"],
        ["http_403", "unavailable", "provider_maintenance"],
        ["http_404", "invalid_provider_response", null],
        ["http_408", "unavailable", "provider_timeout"],
        ["http_429", "unavailable", "provider_rate_limited"],
        ["http_500", "unavailable", "provider_maintenance"],
        ["http_503", "unavailable", "provider_maintenance"],
      ];
      for (const [scenario, kind, reason] of matrix) {
        const result = await callMock(server, scenario);
        assert.equal(result.outcome.kind, kind, scenario);
        if (reason && result.outcome.kind === "unavailable") {
          assert.equal(result.outcome.reason, reason, scenario);
        }
      }
    });

    await check("F2 no infrastructure failure is ever reported as not_met", async () => {
      const infrastructure: PocketMockScenario[] = [
        "http_401", "http_403", "http_404", "http_408", "http_429",
        "http_500", "http_503", "malformed_json", "array_response",
        "oversized_response", "redirect", "connection_close",
        "status_inactive", "status_unknown", "status_missing",
        "real_balance_missing", "real_balance_string",
        "real_balance_negative", "real_balance_null",
      ];
      for (const scenario of infrastructure) {
        const result = await callMock(server, scenario);
        assert.notEqual(result.outcome.kind, "not_met", scenario);
        assert.notEqual(result.outcome.kind, "met", scenario);
      }
    });

    await check("F3 429 back-pressure is bounded and surfaced", async () => {
      const result = await callMock(server, "http_429");
      if (result.outcome.kind === "unavailable") {
        assert.equal(result.outcome.retryAfterSeconds, 90);
      }
    });

    await check("F4 a connect failure to a dead port is unavailable", async () => {
      const dead = await startPocketPartnerMockServer({
        partnerId: PARTNER_ID,
        apiToken: TOKEN,
      });
      const config = loopbackConfig(dead);
      await dead.close();
      const controller = new AbortController();
      const result = await verifyPocketPartnerThreshold({
        config,
        pocketUserId: USER_ID,
        thresholdMinorUnits: THRESHOLD,
        signal: controller.signal,
      });
      assert.equal(result.outcome.kind, "unavailable");
      if (result.outcome.kind === "unavailable") {
        assert.equal(result.outcome.reason, "provider_maintenance");
      }
    });

    /* ---------------------------------------------------------------- */
    /* G. Redaction                                                      */
    /* ---------------------------------------------------------------- */

    await check("G1 no result carries a token, hash, URL or balance", async () => {
      const scenarios: PocketMockScenario[] = [
        "real_at_threshold", "real_above_threshold", "real_just_below_threshold",
        "demo_huge_real_below", "real_met_demo_zero", "user_id_mismatch",
        "partner_id_mismatch", "status_inactive", "real_balance_string",
        "malformed_json", "http_401", "http_429", "http_500", "redirect",
        "oversized_response", "connection_close",
      ];
      for (const scenario of scenarios) {
        const result = await callMock(server, scenario);
        const serialised = safeJson(result);
        for (const forbidden of FORBIDDEN_TOKENS) {
          // AFD-5B2A-FINAL — a raw substring match here failed a run with
          // `http_500 leaked 260` because the random correlation handle was
          // `pp-8bfefe8f-2609-…`. A leaked value appears in JSON as a value, on
          // token boundaries; a coincidence is glued to identifier characters.
          // See `leaksValue`: detection of a real leak is unchanged.
          assert.ok(
            !leaksValue(serialised, forbidden),
            `${scenario} leaked ${forbidden}: ${serialised}`,
          );
        }
        // The correlation handle is opaque and is not the Pocket trader id.
        assert.match(result.providerRequestId, /^pp-[0-9a-f-]{36}$/);
        assert.ok(!result.providerRequestId.includes(USER_ID));
      }
    });

    await check("G2 nothing is written to the console during any call", async () => {
      const capture = captureConsole();
      try {
        for (const scenario of [
          "real_above_threshold", "malformed_json", "http_500",
          "connection_close", "redirect", "oversized_response",
        ] as PocketMockScenario[]) {
          await callMock(server, scenario);
        }
      } finally {
        capture.restore();
      }
      assert.equal(
        capture.lines.length,
        0,
        `adapter logged: ${capture.lines.join(" | ")}`,
      );
    });

    await check("G3 a thrown transport error never escapes with the URL", async () => {
      // undici embeds the full request URL in `error.cause`. The adapter must
      // classify and drop it rather than propagate it.
      const config = loopbackConfig(server);
      const controller = new AbortController();
      const result = await verifyPocketPartnerThreshold({
        config,
        pocketUserId: USER_ID,
        thresholdMinorUnits: THRESHOLD,
        signal: controller.signal,
        fetchImpl: async () => {
          throw new Error(
            `connect ECONNREFUSED ${config.baseUrl}/api/user-info/${USER_ID}/${PARTNER_ID}/${VECTOR_BASE}`,
          );
        },
      });
      const serialised = safeJson(result);
      assert.equal(result.outcome.kind, "unavailable");
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!serialised.includes(forbidden), `leaked ${forbidden}`);
      }
    });

    /* ---------------------------------------------------------------- */
    /* H. The provider facade                                            */
    /* ---------------------------------------------------------------- */

    await check("H1 provider reports identity_unlinked without a binding", async () => {
      const provider = createPocketPartnerBalanceProvider(loopbackConfig(server), {
        resolveIdentity: async () => null,
      });
      server.reset();
      const result = await provider.verifyThreshold({
        learnerId: 1, enrollmentId: 1, levelDefinitionId: 1,
        integrationCode: "checkpoint.module-01",
        thresholdCurrency: "USD", thresholdMinorUnits: THRESHOLD,
        requestId: "pa1-request-1", timeoutSignal: new AbortController().signal,
      });
      assert.equal(result.outcome, "identity_unlinked");
      // Decisive: no provider call is made for an unbound learner.
      assert.equal(server.callCount(), 0);
    });

    await check("H2 provider refuses a non-USD threshold rather than converting", async () => {
      const provider = createPocketPartnerBalanceProvider(loopbackConfig(server), {
        resolveIdentity: async () => USER_ID,
      });
      server.reset();
      const result = await provider.verifyThreshold({
        learnerId: 1, enrollmentId: 1, levelDefinitionId: 1,
        integrationCode: "checkpoint.module-01",
        thresholdCurrency: "EUR" as "USD", thresholdMinorUnits: THRESHOLD,
        requestId: "pa1-request-2", timeoutSignal: new AbortController().signal,
      });
      assert.equal(result.outcome, "unsupported_currency");
      assert.equal(server.callCount(), 0);
    });

    await check("H3 provider maps met / not_met from the trusted identity", async () => {
      const provider = createPocketPartnerBalanceProvider(loopbackConfig(server), {
        resolveIdentity: async () => USER_ID,
      });
      const request = {
        learnerId: 1, enrollmentId: 1, levelDefinitionId: 1,
        integrationCode: "checkpoint.module-01",
        thresholdCurrency: "USD" as const, thresholdMinorUnits: THRESHOLD,
        requestId: "pa1-request-3", timeoutSignal: new AbortController().signal,
      };

      server.setScenario("real_just_below_threshold");
      assert.equal((await provider.verifyThreshold(request)).outcome, "not_met");

      server.setScenario("real_at_threshold");
      assert.equal((await provider.verifyThreshold(request)).outcome, "met");
    });

    await check("H4 provider results carry no financial or credential field", async () => {
      const provider = createPocketPartnerBalanceProvider(loopbackConfig(server), {
        resolveIdentity: async () => USER_ID,
      });
      for (const scenario of [
        "real_above_threshold", "real_just_below_threshold", "http_429",
        "malformed_json", "user_id_mismatch",
      ] as PocketMockScenario[]) {
        server.setScenario(scenario);
        const result = await provider.verifyThreshold({
          learnerId: 1, enrollmentId: 1, levelDefinitionId: 1,
          integrationCode: "checkpoint.module-01",
          thresholdCurrency: "USD", thresholdMinorUnits: THRESHOLD,
          requestId: "pa1-request-4", timeoutSignal: new AbortController().signal,
        });
        const keys = Object.keys(result);
        for (const key of keys) {
          assert.ok(
            ["outcome", "reason", "providerRequestId", "observedAt", "retryAfterSeconds"].includes(key),
            `${scenario} exposed key ${key}`,
          );
        }
        const serialised = safeJson(result);
        for (const forbidden of FORBIDDEN_TOKENS) {
          // AFD-5B2B — the SECOND call site of the same rule. AFD-5B2A replaced
          // the raw substring match above with `leaksValue` after `260` matched
          // inside a random correlation handle, but this one kept `includes`
          // and failed the same way: `real_just_below_threshold leaked 260`,
          // where the 260 lived inside the opaque `providerRequestId`. Short
          // numeric tokens will keep colliding with UUIDs and timestamps, so
          // both sites now use the boundary-aware matcher. Detection of a real
          // leak — a value appearing as a JSON value — is unchanged.
          assert.ok(
            !leaksValue(serialised, forbidden),
            `${scenario} leaked ${forbidden}: ${serialised}`,
          );
        }
      }
    });
  } finally {
    await server.close();
  }

  console.log(`\nL4PA-1 pocket partner adapter: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
