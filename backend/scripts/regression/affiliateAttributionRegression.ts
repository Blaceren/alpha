/**
 * AFD-3B2 — acquisition attribution: configuration, token, cookie, click
 * capture, link activation, touch selection and schema.
 *
 * WHAT THIS SUITE IS. Everything that can be proven without an HTTP server, run
 * against a SYNTHETIC database built from the repository's own migrations. No
 * live port is contacted, no live database is opened, no live secret is read and
 * every fixture below is invented here.
 *
 * The HTTP contract of `/go` and the registration binding are proven separately
 * by `affiliateAcquisitionHttpRegression.ts`, which needs a real server.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ATTRIBUTION_SECRET_MIN_LENGTH,
  ATTRIBUTION_TOKEN_SECRET_KEY,
  AFFILIATE_ATTRIBUTION_ENABLED_KEY,
  describeSecretRejection,
  isAffiliateAttributionEnabled,
  requireAttributionSecret,
  resolveAttributionConfig,
} from "../../src/lib/affiliate/attribution-config";
import {
  ATTRIBUTION_TOKEN_MAX_LENGTH,
  ATTRIBUTION_TOKEN_VERSION,
  createAttributionToken,
  verifyAttributionToken,
} from "../../src/lib/affiliate/attribution-token";
import {
  ATTRIBUTION_COOKIE_NAME,
  attributionCookieOptions,
  clearedAttributionCookieOptions,
  readAttributionCookie,
} from "../../src/lib/affiliate/attribution-cookie";
import {
  captureParameters,
  isPrefetchRequest,
  sanitizeReferrerHost,
  GO_MAX_PARAM_VALUE_LENGTH,
  GO_MAX_QUERY_KEYS,
  GO_MAX_TARGET_LENGTH,
} from "../../src/lib/affiliate/click-capture";
import {
  AFFILIATE_ID_PATTERN,
  randomBase32Id,
} from "../../src/lib/affiliate/random-id";
import { resolveVisitorJourney } from "../../src/lib/affiliate/acquisition-click";
import {
  assertLinkTransition,
  describeLinkActivationRefusal,
  effectiveAvailability,
  isLinkEffectivelyActive,
  TRACKING_LINK_STATUSES,
  type AffiliateStatus,
  type TrackingLinkStatus,
} from "../../src/lib/crm/affiliates";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

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

/* ------------------------------------------------------------------ fixture */

const dbPath = path.join(os.tmpdir(), `ata-afd3b2-attribution-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const projectRoot = path.resolve(__dirname, "../..");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** A 44-character value with plenty of variety. Synthetic, never a real key. */
const TEST_SECRET = "afd3b2-SYNTHETIC-token-key-9182736450-QxZvWk";
const OTHER_SECRET = "afd3b2-SYNTHETIC-other-key-5647382910-WkYbQx";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A synthetic environment. Cast rather than declared, because `NodeJS.ProcessEnv`
 * requires `NODE_ENV` in this project's type setup and every resolver under test
 * takes an arbitrary environment on purpose — the point of these cases is to
 * present environments a real process might never produce.
 */
function asEnv(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = {
    [AFFILIATE_ATTRIBUTION_ENABLED_KEY]: "true",
    [ATTRIBUTION_TOKEN_SECRET_KEY]: TEST_SECRET,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return asEnv(base);
}

async function main() {
  cleanup();
  process.env.DATABASE_URL = dbUrl;

  /* =================== A. CONFIGURATION AND THE FEATURE SWITCH ============ */

  await check("A1 attribution is DISABLED when the flag is absent", () => {
    assert.equal(isAffiliateAttributionEnabled(asEnv({})), false);
    const resolution = resolveAttributionConfig(asEnv({}));
    assert.equal(resolution.kind, "resolved");
    assert.equal(resolution.kind === "resolved" && resolution.config.enabled, false);
  });

  await check("A2 a disabled deployment needs no secret at all", () => {
    const resolution = resolveAttributionConfig(
      asEnv({ [AFFILIATE_ATTRIBUTION_ENABLED_KEY]: "false" }),
    );
    assert.equal(resolution.kind, "resolved");
  });

  await check("A3 anything other than the exact string 'true' is disabled", () => {
    for (const value of ["TRUE", "True", "1", "yes", "on", " true"]) {
      assert.equal(
        isAffiliateAttributionEnabled(asEnv({ [AFFILIATE_ATTRIBUTION_ENABLED_KEY]: value })),
        false,
        value,
      );
    }
  });

  await check("A4 enabled with a valid secret resolves", () => {
    const resolution = resolveAttributionConfig(env());
    assert.equal(resolution.kind, "resolved");
    assert.equal(resolution.kind === "resolved" && resolution.config.enabled, true);
    assert.equal(requireAttributionSecret(env()), TEST_SECRET);
  });

  await check("A5 enabled with NO secret is invalid", () => {
    const resolution = resolveAttributionConfig(env({ [ATTRIBUTION_TOKEN_SECRET_KEY]: undefined }));
    assert.equal(resolution.kind, "invalid");
    assert.equal(resolution.kind === "invalid" && resolution.reason, "missing");
  });

  await check("A6 a short secret is invalid", () => {
    const short = "x".repeat(ATTRIBUTION_SECRET_MIN_LENGTH - 1);
    assert.equal(describeSecretRejection(short), "too_short");
  });

  await check("A7 a long but low-variety secret is invalid", () => {
    assert.equal(describeSecretRejection("ab".repeat(40)), "low_variety");
  });

  await check("A8 placeholder secrets are refused", () => {
    for (const value of [
      "change-me-change-me-change-me-change-me-change",
      "PLACEHOLDER-PLACEHOLDER-value-1234567890-abcd",
      "your-secret-here-1234567890-abcdefghij-klmno",
      "xxxxxxxxxxxxxx-9182736450-QxZvWkYb-attrib-01",
    ]) {
      assert.equal(describeSecretRejection(value), "placeholder", value);
    }
  });

  await check("A9 the attribution secret may not be any other secret's value", () => {
    assert.equal(
      describeSecretRejection(TEST_SECRET, asEnv({ SESSION_SECRET: TEST_SECRET })),
      "reused_session_secret",
    );
    assert.equal(
      describeSecretRejection(TEST_SECRET, asEnv({ POSTBACK_SECRET: TEST_SECRET })),
      "reused_postback_secret",
    );
    assert.equal(
      describeSecretRejection(TEST_SECRET, asEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET })),
      "reused_captcha_secret",
    );
  });

  await check("A10 requireAttributionSecret THROWS rather than falling back", () => {
    assert.throws(() => requireAttributionSecret(asEnv({})), /disabled/);
    assert.throws(
      () => requireAttributionSecret(env({ [ATTRIBUTION_TOKEN_SECRET_KEY]: undefined })),
      /missing/,
    );
  });

  await check("A11 no rejection message ever quotes the secret", async () => {
    const { describeAttributionConfigRejection } = await import(
      "../../src/lib/affiliate/attribution-config"
    );
    for (const reason of [
      "missing",
      "too_short",
      "low_variety",
      "placeholder",
      "reused_session_secret",
      "reused_postback_secret",
      "reused_captcha_secret",
    ] as const) {
      const message = describeAttributionConfigRejection(reason);
      assert.ok(!message.includes(TEST_SECRET), reason);
    }
  });

  await check("A12 startup validation fails closed when enabled without a secret", async () => {
    const { validateRuntimeEnv } = await import("../../src/lib/env");
    const result = validateRuntimeEnv({
      ...process.env,
      [AFFILIATE_ATTRIBUTION_ENABLED_KEY]: "true",
      [ATTRIBUTION_TOKEN_SECRET_KEY]: "",
    } as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes(ATTRIBUTION_TOKEN_SECRET_KEY)),
      result.errors.join(" | "),
    );
  });

  await check("A13 startup validation fails closed for a PRODUCTION deployment too", async () => {
    const { validateRuntimeEnv } = await import("../../src/lib/env");
    const result = validateRuntimeEnv({
      ...process.env,
      NODE_ENV: "production",
      ATA_ENVIRONMENT: "production",
      [AFFILIATE_ATTRIBUTION_ENABLED_KEY]: "true",
      [ATTRIBUTION_TOKEN_SECRET_KEY]: "changeme",
    } as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes(ATTRIBUTION_TOKEN_SECRET_KEY)));
  });

  /* ============================ B. THE SIGNED TOKEN ====================== */

  const visitorId = randomBase32Id();
  const issuedAt = new Date("2026-07-31T10:00:00.000Z");
  const expiresAt = new Date(issuedAt.getTime() + 30 * DAY_MS);
  const token = createAttributionToken({
    secret: TEST_SECRET,
    anonymousVisitorId: visitorId,
    issuedAt,
    expiresAt,
  });

  await check("B1 a token is version.payload.signature and stays inside its bound", () => {
    const parts = token.split(".");
    assert.equal(parts.length, 3);
    assert.equal(parts[0], String(ATTRIBUTION_TOKEN_VERSION));
    assert.ok(token.length <= ATTRIBUTION_TOKEN_MAX_LENGTH, `length ${token.length}`);
  });

  await check("B2 a valid token verifies and returns exactly the payload", () => {
    const result = verifyAttributionToken(token, TEST_SECRET, issuedAt);
    assert.equal(result.kind, "valid");
    if (result.kind !== "valid") return;
    assert.equal(result.payload.anonymousVisitorId, visitorId);
    assert.equal(result.payload.version, ATTRIBUTION_TOKEN_VERSION);
    assert.equal(result.payload.issuedAt, Math.floor(issuedAt.getTime() / 1000));
    assert.equal(result.payload.expiresAt, Math.floor(expiresAt.getTime() / 1000));
  });

  await check("B3 the payload carries NO affiliate or learner identity", () => {
    const decoded = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(Object.keys(decoded).sort(), ["exp", "iat", "v", "vid"]);
    const serialized = JSON.stringify(decoded);
    for (const forbidden of [
      "affiliate",
      "campaign",
      "trackingLink",
      "publicCode",
      "clickid",
      "ataClickId",
      "email",
      "userId",
      "playerid",
      "secret",
    ]) {
      assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), forbidden);
    }
  });

  await check("B4 a token signed with another key is rejected", () => {
    const result = verifyAttributionToken(token, OTHER_SECRET, issuedAt);
    assert.equal(result.kind, "invalid");
    assert.equal(result.kind === "invalid" && result.reason, "bad_signature");
  });

  await check("B5 a tampered visitor id is rejected", () => {
    const [v, payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.vid = randomBase32Id();
    const forged = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
    const result = verifyAttributionToken(`${v}.${forged}.${signature}`, TEST_SECRET, issuedAt);
    assert.equal(result.kind === "invalid" && result.reason, "bad_signature");
  });

  await check("B6 an expired token is rejected as expired, not accepted", () => {
    const later = new Date(expiresAt.getTime() + 1000);
    const result = verifyAttributionToken(token, TEST_SECRET, later);
    assert.equal(result.kind === "invalid" && result.reason, "expired");
  });

  await check("B7 a FUTURE token version is refused distinctly", () => {
    const [, payload, signature] = token.split(".");
    const result = verifyAttributionToken(`2.${payload}.${signature}`, TEST_SECRET, issuedAt);
    assert.equal(result.kind === "invalid" && result.reason, "future_version");
  });

  await check("B8 malformed tokens are refused without throwing", () => {
    for (const bad of ["", "abc", "1.abc", "1.abc.def.ghi", "1..sig", "1.payload.", "x.y.z"]) {
      const result = verifyAttributionToken(bad, TEST_SECRET, issuedAt);
      assert.equal(result.kind, "invalid", JSON.stringify(bad));
    }
    assert.equal(verifyAttributionToken(undefined, TEST_SECRET).kind, "invalid");
  });

  await check("B9 an over-long token is refused before it is parsed", () => {
    const result = verifyAttributionToken(
      `1.${"A".repeat(ATTRIBUTION_TOKEN_MAX_LENGTH)}.sig`,
      TEST_SECRET,
      issuedAt,
    );
    assert.equal(result.kind === "invalid" && result.reason, "too_long");
  });

  await check("B10 a signed payload with an extra key is refused", () => {
    const decoded = { v: 1, vid: visitorId, iat: 1, exp: 2_000_000_000, extra: "x" };
    const payload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
    const signature = crypto
      .createHmac("sha256", TEST_SECRET)
      .update(`1.${payload}`)
      .digest("base64url");
    const result = verifyAttributionToken(`1.${payload}.${signature}`, TEST_SECRET, issuedAt);
    assert.equal(result.kind === "invalid" && result.reason, "bad_payload");
  });

  await check("B11 a signed token claiming a lifetime beyond 365 days is refused", () => {
    const iat = Math.floor(issuedAt.getTime() / 1000);
    const decoded = { v: 1, vid: visitorId, iat, exp: iat + 400 * 24 * 60 * 60 };
    const payload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
    const signature = crypto
      .createHmac("sha256", TEST_SECRET)
      .update(`1.${payload}`)
      .digest("base64url");
    const result = verifyAttributionToken(`1.${payload}.${signature}`, TEST_SECRET, issuedAt);
    assert.equal(result.kind === "invalid" && result.reason, "implausible_lifetime");
  });

  await check("B12 the issuer refuses to mint an over-long or malformed token", () => {
    assert.throws(() =>
      createAttributionToken({
        secret: TEST_SECRET,
        anonymousVisitorId: "not-a-visitor-id",
        issuedAt,
        expiresAt,
      }),
    );
    assert.throws(() =>
      createAttributionToken({
        secret: TEST_SECRET,
        anonymousVisitorId: visitorId,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 400 * DAY_MS),
      }),
    );
  });

  /* ================================ C. COOKIE ============================ */

  await check("C1 the cookie name is the __Host- prefixed one", () => {
    assert.equal(ATTRIBUTION_COOKIE_NAME, "__Host-ata_attribution");
  });

  await check("C2 the cookie attributes are Secure/HttpOnly/Lax/Path=/ with no Domain", () => {
    const options = attributionCookieOptions(3600) as Record<string, unknown>;
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/");
    assert.equal(options.maxAge, 3600);
    assert.ok(!("domain" in options), "a Domain attribute would void the __Host- prefix");
  });

  await check("C3 clearing uses Max-Age=0 with identical attributes", () => {
    const cleared = clearedAttributionCookieOptions() as Record<string, unknown>;
    assert.equal(cleared.maxAge, 0);
    assert.equal(cleared.path, "/");
    assert.equal(cleared.secure, true);
    assert.equal(cleared.httpOnly, true);
    assert.equal(cleared.sameSite, "lax");
  });

  await check("C4 the cookie reader finds exactly one value", () => {
    assert.equal(
      readAttributionCookie(`a=1; ${ATTRIBUTION_COOKIE_NAME}=${token}; b=2`),
      token,
    );
    assert.equal(readAttributionCookie("a=1; b=2"), null);
    assert.equal(readAttributionCookie(null), null);
    assert.equal(readAttributionCookie(""), null);
  });

  await check("C5 a DUPLICATED attribution cookie is treated as absent, not first-wins", () => {
    assert.equal(
      readAttributionCookie(`${ATTRIBUTION_COOKIE_NAME}=a; ${ATTRIBUTION_COOKIE_NAME}=b`),
      null,
    );
  });

  await check("C6 a pathological Cookie header is not parsed", () => {
    assert.equal(readAttributionCookie(`${ATTRIBUTION_COOKIE_NAME}=${"x".repeat(9000)}`), null);
  });

  /* ============================ D. QUERY CONTRACT ======================== */

  const mapping = {
    externalClickParameter: "clickid",
    sub1Parameter: "sub1",
    sub2Parameter: "sub2",
    sub3Parameter: null,
    sub4Parameter: null,
    sub5Parameter: null,
  };

  await check("D1 the configured external click parameter is captured", () => {
    const result = captureParameters(new URL("https://x.invalid/go/c?clickid=NET-123"), mapping);
    assert.equal(result.kind, "ok");
    assert.equal(result.kind === "ok" && result.captured.externalAffiliateClickId, "NET-123");
  });

  await check("D2 configured sub parameters are captured, unconfigured ones are not", () => {
    const result = captureParameters(
      new URL("https://x.invalid/go/c?sub1=a&sub2=b&sub3=c"),
      mapping,
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.captured.sub1, "a");
    assert.equal(result.captured.sub2, "b");
    // sub3 is NOT configured on this link, so its value is not ours to store.
    assert.equal(result.captured.sub3, null);
  });

  await check("D3 unknown parameters are ignored and never persisted", () => {
    const result = captureParameters(
      new URL("https://x.invalid/go/c?clickid=A&utm_source=x&gclid=y&whatever=z"),
      mapping,
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.captured.externalAffiliateClickId, "A");
    assert.deepEqual(
      { ...result.captured, externalAffiliateClickId: null },
      { externalAffiliateClickId: null, sub1: null, sub2: null, sub3: null, sub4: null, sub5: null },
    );
  });

  await check("D4 a DUPLICATED configured parameter is rejected", () => {
    const result = captureParameters(new URL("https://x.invalid/go/c?clickid=a&clickid=b"), mapping);
    assert.equal(result.kind === "rejected" && result.reason, "duplicate_parameter");
  });

  await check("D5 a duplicated UNKNOWN parameter is merely ignored", () => {
    const result = captureParameters(new URL("https://x.invalid/go/c?zz=a&zz=b"), mapping);
    assert.equal(result.kind, "ok");
  });

  await check("D6 control characters are rejected", () => {
    const result = captureParameters(
      new URL(`https://x.invalid/go/c?clickid=${encodeURIComponent("ab cd")}`),
      mapping,
    );
    assert.equal(result.kind === "rejected" && result.reason, "value_unsafe");
  });

  await check("D7 an excessive value is rejected", () => {
    const long = "a".repeat(GO_MAX_PARAM_VALUE_LENGTH + 1);
    const result = captureParameters(new URL(`https://x.invalid/go/c?clickid=${long}`), mapping);
    assert.equal(result.kind === "rejected" && result.reason, "value_too_long");
  });

  await check("D8 malformed percent-encoding is rejected, not stored literally", () => {
    const result = captureParameters(new URL("https://x.invalid/go/c?clickid=%ZZ"), mapping);
    assert.equal(result.kind === "rejected" && result.reason, "malformed_encoding");
  });

  await check("D9 an over-long request target is rejected", () => {
    const url = new URL(`https://x.invalid/go/c?clickid=${"a".repeat(GO_MAX_TARGET_LENGTH)}`);
    const result = captureParameters(url, mapping);
    assert.equal(result.kind === "rejected" && result.reason, "target_too_long");
  });

  await check("D10 too many query keys is rejected", () => {
    const query = Array.from({ length: GO_MAX_QUERY_KEYS + 1 }, (_, i) => `k${i}=1`).join("&");
    const result = captureParameters(new URL(`https://x.invalid/go/c?${query}`), mapping);
    assert.equal(result.kind === "rejected" && result.reason, "too_many_keys");
  });

  await check("D11 an empty configured value stores null rather than an empty string", () => {
    const result = captureParameters(new URL("https://x.invalid/go/c?clickid="), mapping);
    assert.equal(result.kind, "ok");
    assert.equal(result.kind === "ok" && result.captured.externalAffiliateClickId, null);
  });

  await check("D12 the referrer is reduced to a bare host or to nothing", () => {
    assert.equal(sanitizeReferrerHost("https://Partner.Example/path?q=secret"), "partner.example");
    assert.equal(sanitizeReferrerHost("http://a.b:8443/x"), "a.b");
    assert.equal(sanitizeReferrerHost("not a url"), null);
    assert.equal(sanitizeReferrerHost("javascript:alert(1)"), null);
    assert.equal(sanitizeReferrerHost(null), null);
  });

  await check("D13 prefetch is detected only from an EXPLICIT declaration", () => {
    assert.equal(isPrefetchRequest(new Headers({ "sec-purpose": "prefetch;prerender" })), true);
    assert.equal(isPrefetchRequest(new Headers({ purpose: "prefetch" })), true);
    assert.equal(isPrefetchRequest(new Headers({ "x-purpose": "preview" })), true);
    assert.equal(isPrefetchRequest(new Headers({ "x-moz": "prefetch" })), true);
    assert.equal(isPrefetchRequest(new Headers({ "user-agent": "SomeBot/1.0" })), false);
    assert.equal(isPrefetchRequest(new Headers()), false);
  });

  /* =========================== E. IDENTIFIERS ============================ */

  await check("E1 generated identifiers have the documented shape", () => {
    for (let i = 0; i < 50; i += 1) {
      assert.ok(AFFILIATE_ID_PATTERN.test(randomBase32Id()));
    }
  });

  await check("E2 identifiers are unique and non-sequential across 20000 draws", () => {
    const seen = new Set<string>();
    let previousDiffers = 0;
    let previous = randomBase32Id();
    for (let i = 0; i < 20_000; i += 1) {
      const id = randomBase32Id();
      assert.ok(!seen.has(id), "collision");
      seen.add(id);
      if (id.slice(0, 4) !== previous.slice(0, 4)) previousDiffers += 1;
      previous = id;
    }
    // A counter or a timestamp would share long prefixes; CSPRNG output does not.
    assert.ok(previousDiffers > 19_000, `only ${previousDiffers} differing prefixes`);
  });

  await check("E3 identifier entropy is at least 128 bits", () => {
    // 32 base32 characters carry 160 bits.
    assert.ok(randomBase32Id().length * 5 >= 128);
  });

  /* ========================= F. THE VISITOR JOURNEY ====================== */

  const now = new Date("2026-07-31T12:00:00.000Z");

  await check("F1 a click with no cookie starts a new visitor journey", () => {
    const journey = resolveVisitorJourney({
      existingToken: null,
      secret: TEST_SECRET,
      effectiveWindowDays: 30,
      now,
    });
    assert.equal(journey.reused, false);
    assert.ok(AFFILIATE_ID_PATTERN.test(journey.anonymousVisitorId));
    assert.equal(journey.expiresAt.getTime(), now.getTime() + 30 * DAY_MS);
    assert.equal(journey.extended, true);
  });

  await check("F2 a second click REUSES the existing visitor id", () => {
    const first = resolveVisitorJourney({
      existingToken: null,
      secret: TEST_SECRET,
      effectiveWindowDays: 30,
      now,
    });
    const firstToken = createAttributionToken({
      secret: TEST_SECRET,
      anonymousVisitorId: first.anonymousVisitorId,
      issuedAt: first.issuedAt,
      expiresAt: first.expiresAt,
    });
    const second = resolveVisitorJourney({
      existingToken: firstToken,
      secret: TEST_SECRET,
      effectiveWindowDays: 30,
      now: new Date(now.getTime() + DAY_MS),
    });
    assert.equal(second.reused, true);
    assert.equal(second.anonymousVisitorId, first.anonymousVisitorId);
  });

  await check("F3 expiry is EXTENDED by a click with a longer window", () => {
    const first = resolveVisitorJourney({
      existingToken: null,
      secret: TEST_SECRET,
      effectiveWindowDays: 7,
      now,
    });
    const firstToken = createAttributionToken({
      secret: TEST_SECRET,
      anonymousVisitorId: first.anonymousVisitorId,
      issuedAt: first.issuedAt,
      expiresAt: first.expiresAt,
    });
    const second = resolveVisitorJourney({
      existingToken: firstToken,
      secret: TEST_SECRET,
      effectiveWindowDays: 90,
      now,
    });
    assert.ok(second.expiresAt.getTime() > first.expiresAt.getTime());
    assert.equal(second.extended, true);
  });

  await check("F4 expiry is NEVER shortened by a click with a shorter window", () => {
    const first = resolveVisitorJourney({
      existingToken: null,
      secret: TEST_SECRET,
      effectiveWindowDays: 90,
      now,
    });
    const firstToken = createAttributionToken({
      secret: TEST_SECRET,
      anonymousVisitorId: first.anonymousVisitorId,
      issuedAt: first.issuedAt,
      expiresAt: first.expiresAt,
    });
    const second = resolveVisitorJourney({
      existingToken: firstToken,
      secret: TEST_SECRET,
      effectiveWindowDays: 1,
      now: new Date(now.getTime() + DAY_MS),
    });
    assert.equal(second.expiresAt.getTime(), first.expiresAt.getTime());
    assert.equal(second.extended, false, "an unchanged expiry must not re-issue the cookie");
  });

  await check("F5 an EXPIRED token starts a NEW visitor rather than reviving the old one", () => {
    const stale = createAttributionToken({
      secret: TEST_SECRET,
      anonymousVisitorId: visitorId,
      issuedAt: new Date(now.getTime() - 40 * DAY_MS),
      expiresAt: new Date(now.getTime() - DAY_MS),
    });
    const journey = resolveVisitorJourney({
      existingToken: stale,
      secret: TEST_SECRET,
      effectiveWindowDays: 30,
      now,
    });
    assert.equal(journey.reused, false);
    assert.notEqual(journey.anonymousVisitorId, visitorId);
  });

  await check("F6 a FORGED token starts a new visitor and cannot inject a chosen id", () => {
    const forged = createAttributionToken({
      secret: OTHER_SECRET,
      anonymousVisitorId: visitorId,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + DAY_MS),
    });
    const journey = resolveVisitorJourney({
      existingToken: forged,
      secret: TEST_SECRET,
      effectiveWindowDays: 30,
      now,
    });
    assert.equal(journey.reused, false);
    assert.notEqual(journey.anonymousVisitorId, visitorId);
  });

  await check("F7 a journey never lives beyond 365 days from its own start", () => {
    const old = new Date(now.getTime() - 360 * DAY_MS);
    const nearlySpent = createAttributionToken({
      secret: TEST_SECRET,
      anonymousVisitorId: visitorId,
      issuedAt: old,
      expiresAt: new Date(now.getTime() + DAY_MS),
    });
    const journey = resolveVisitorJourney({
      existingToken: nearlySpent,
      secret: TEST_SECRET,
      effectiveWindowDays: 365,
      now,
    });
    assert.equal(journey.reused, true);
    assert.ok(journey.expiresAt.getTime() <= old.getTime() + 365 * DAY_MS);
    // And still never shorter than what the visitor already held.
    assert.ok(journey.expiresAt.getTime() >= now.getTime() + DAY_MS);
  });

  /* ==================== G. LINK STATUS AND ACTIVATION ==================== */

  await check("G1 the stored status alphabet is exactly draft/active/paused/archived", () => {
    assert.deepEqual([...TRACKING_LINK_STATUSES], ["draft", "active", "paused", "archived"]);
  });

  const ALLOWED: Array<[TrackingLinkStatus, TrackingLinkStatus]> = [
    ["draft", "active"],
    ["draft", "paused"],
    ["draft", "archived"],
    ["active", "paused"],
    ["active", "archived"],
    ["paused", "active"],
    ["paused", "draft"],
    ["paused", "archived"],
  ];
  const FORBIDDEN: Array<[TrackingLinkStatus, TrackingLinkStatus]> = [
    ["active", "draft"],
    ["archived", "draft"],
    ["archived", "active"],
    ["archived", "paused"],
  ];

  await check("G2 every allowed transition is allowed", () => {
    for (const [from, to] of ALLOWED) assertLinkTransition(from, to);
  });

  await check("G3 active -> draft is forbidden", () => {
    assert.throws(() => assertLinkTransition("active", "draft"));
  });

  await check("G4 archived is terminal in every direction", () => {
    for (const to of ["draft", "active", "paused"] as TrackingLinkStatus[]) {
      assert.throws(() => assertLinkTransition("archived", to), to);
    }
  });

  await check("G5 the complete transition matrix has no accidental edges", () => {
    for (const from of TRACKING_LINK_STATUSES) {
      for (const to of TRACKING_LINK_STATUSES) {
        if (from === to) {
          assert.throws(() => assertLinkTransition(from, to), `${from}->${to}`);
          continue;
        }
        const expected = ALLOWED.some(([f, t]) => f === from && t === to);
        let allowed = true;
        try {
          assertLinkTransition(from, to);
        } catch {
          allowed = false;
        }
        assert.equal(allowed, expected, `${from} -> ${to}`);
        if (!expected) {
          assert.ok(FORBIDDEN.some(([f, t]) => f === from && t === to), `${from}->${to}`);
        }
      }
    }
  });

  const activatable = {
    publicCode: "a".repeat(32),
    landingKey: "academy_registration",
    partnerStatus: "active" as AffiliateStatus,
    campaignStatus: "active" as AffiliateStatus | null,
    externalClickParameter: "clickid",
    subParameters: ["sub1", null, null, null, null],
    attributionWindowDays: 30,
    partnerDefaultAttributionWindowDays: 30,
  };

  await check("G6 a well-formed link with an active parent may activate", () => {
    assert.equal(describeLinkActivationRefusal(activatable, true), null);
  });

  await check("G7 activation is refused when the feature is disabled", () => {
    assert.equal(describeLinkActivationRefusal(activatable, false), "attribution_disabled");
  });

  await check("G8 activation is refused under a paused or archived parent", () => {
    for (const status of ["paused", "archived"] as AffiliateStatus[]) {
      assert.equal(
        describeLinkActivationRefusal({ ...activatable, partnerStatus: status }, true),
        "partner_not_active",
      );
      assert.equal(
        describeLinkActivationRefusal({ ...activatable, campaignStatus: status }, true),
        "campaign_not_active",
      );
    }
  });

  await check("G9 activation is refused for an unsupported landing key", () => {
    assert.equal(
      describeLinkActivationRefusal({ ...activatable, landingKey: "somewhere_else" }, true),
      "landing_key_unsupported",
    );
  });

  await check("G10 activation is refused for a malformed public code", () => {
    assert.equal(
      describeLinkActivationRefusal({ ...activatable, publicCode: "short" }, true),
      "public_code_invalid",
    );
  });

  await check("G11 activation is refused for an invalid or duplicated parameter mapping", () => {
    assert.equal(
      describeLinkActivationRefusal(
        { ...activatable, subParameters: ["clickid", null, null, null, null] },
        true,
      ),
      "parameter_mapping_invalid",
    );
    assert.equal(
      describeLinkActivationRefusal({ ...activatable, externalClickParameter: "token" }, true),
      "parameter_mapping_invalid",
    );
    assert.equal(
      describeLinkActivationRefusal({ ...activatable, externalClickParameter: "BAD NAME" }, true),
      "parameter_mapping_invalid",
    );
  });

  await check("G12 activation is refused for an out-of-range attribution window", () => {
    assert.equal(
      describeLinkActivationRefusal(
        { ...activatable, attributionWindowDays: null, partnerDefaultAttributionWindowDays: 0 },
        true,
      ),
      "attribution_window_invalid",
    );
    assert.equal(
      describeLinkActivationRefusal({ ...activatable, attributionWindowDays: 400 }, true),
      "attribution_window_invalid",
    );
  });

  await check("G13 an active link stops serving the moment the feature is switched off", () => {
    const live = {
      linkStatus: "active" as TrackingLinkStatus,
      partnerStatus: "active" as AffiliateStatus,
      campaignStatus: "active" as AffiliateStatus | null,
      attributionEnabled: true,
    };
    assert.equal(isLinkEffectivelyActive(live), true);
    assert.equal(isLinkEffectivelyActive({ ...live, attributionEnabled: false }), false);
  });

  await check("G14 an active link stops serving under a paused or archived parent", () => {
    const live = {
      linkStatus: "active" as TrackingLinkStatus,
      partnerStatus: "active" as AffiliateStatus,
      campaignStatus: "active" as AffiliateStatus | null,
      attributionEnabled: true,
    };
    for (const status of ["paused", "archived"] as AffiliateStatus[]) {
      assert.equal(isLinkEffectivelyActive({ ...live, partnerStatus: status }), false, status);
      assert.equal(isLinkEffectivelyActive({ ...live, campaignStatus: status }), false, status);
    }
    // And the CHILD's stored status is untouched by any of that.
    assert.equal(effectiveAvailability("active", ["paused"]), "paused");
    assert.equal(effectiveAvailability("active", ["active"]), "available");
  });

  await check("G15 a draft or paused link never serves", () => {
    for (const status of ["draft", "paused", "archived"] as TrackingLinkStatus[]) {
      assert.equal(
        isLinkEffectivelyActive({
          linkStatus: status,
          partnerStatus: "active",
          campaignStatus: null,
          attributionEnabled: true,
        }),
        false,
        status,
      );
    }
  });

  /* ============ H. SCHEMA, CONSTRAINTS AND TOUCH SELECTION =============== */

  const migrate = spawnSync("npx", ["tsx", "prisma/migrate.ts"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migrate.status !== 0) {
    console.error(migrate.stdout);
    console.error(migrate.stderr);
    throw new Error("migrations failed");
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  await check("H1 the fresh schema is at the canonical migration count", async () => {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) c FROM _prisma_migrations",
    )) as Array<{ c: number | bigint }>;
    assert.equal(Number(rows[0].c), EXPECTED_MIGRATION_COUNT);
  });

  await check("H2 the three attribution tables exist and nothing else was added", async () => {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Affiliate%' ORDER BY name",
    )) as Array<{ name: string }>;
    assert.deepEqual(
      rows.map((r) => r.name),
      [
        "AffiliateAttribution",
        "AffiliateCampaign",
        "AffiliateClick",
        "AffiliateConversionEvent",
        "AffiliatePartner",
        "AffiliateTrackingLink",
      ],
    );
  });

  await check("H3 no first-deposit, provider-event, outbox or analytics table appeared", async () => {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table'",
    )) as Array<{ name: string }>;
    const names = rows.map((r) => r.name.toLowerCase());
    for (const forbidden of [
      "firstdeposit",
      "redeposit",
      "affiliateprovider",
      "affiliateoutbox",
      "outbox",
      "affiliatepostback",
      "producteventlog",
      "affiliateanalytics",
    ]) {
      assert.ok(!names.includes(forbidden), forbidden);
    }
  });

  await check("H4 integrity_check is ok and foreign_key_check is empty", async () => {
    const ic = (await prisma.$queryRawUnsafe("PRAGMA integrity_check")) as Array<
      Record<string, string>
    >;
    assert.equal(Object.values(ic[0])[0], "ok");
    const fk = (await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")) as unknown[];
    assert.equal(fk.length, 0);
  });

  await check("H5 the tracking-link status CHECK now admits exactly four values", async () => {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='AffiliateTrackingLink'",
    )) as Array<{ sql: string }>;
    assert.ok(rows[0].sql.includes("'draft', 'active', 'paused', 'archived'"), rows[0].sql);
  });

  await check("H6 every required unique constraint exists", async () => {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT name, tbl_name FROM sqlite_master WHERE type='index'",
    )) as Array<{ name: string; tbl_name: string }>;
    const names = rows.map((r) => r.name);
    for (const expected of [
      "AffiliateClick_ataClickId_key",
      "AffiliateAttribution_userId_key",
      "AffiliateAttribution_anonymousVisitorId_key",
      "AffiliateConversionEvent_eventId_key",
      "AffiliateConversionEvent_source_key",
    ]) {
      assert.ok(names.includes(expected), expected);
    }
  });

  await check("H7 every required index exists", async () => {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='index'",
    )) as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    for (const expected of [
      "AffiliateClick_trackingLinkId_occurredAt_idx",
      "AffiliateClick_anonymousVisitorId_occurredAt_idx",
      "AffiliateClick_externalAffiliateClickId_idx",
      "AffiliateClick_classification_occurredAt_idx",
      "AffiliateAttribution_selectedClickId_idx",
      "AffiliateAttribution_selectedAt_idx",
      "AffiliateConversionEvent_eventType_occurredAt_idx",
      "AffiliateConversionEvent_affiliatePartnerId_occurredAt_idx",
      "AffiliateConversionEvent_affiliateCampaignId_occurredAt_idx",
      "AffiliateConversionEvent_trackingLinkId_occurredAt_idx",
      "AffiliateConversionEvent_userId_occurredAt_idx",
    ]) {
      assert.ok(names.includes(expected), expected);
    }
  });

  await check("H8 the click table has no column for an IP, a UA or a request URL", async () => {
    const columns = (await prisma.$queryRawUnsafe(
      'PRAGMA table_info("AffiliateClick")',
    )) as Array<{ name: string }>;
    const names = columns.map((c) => c.name.toLowerCase());
    for (const forbidden of [
      "ip",
      "ipaddress",
      "remoteaddr",
      "useragent",
      "ua",
      "requesturl",
      "url",
      "querystring",
      "cookie",
      "fingerprint",
      "playerid",
      "pocketclickid",
    ]) {
      assert.ok(!names.includes(forbidden), forbidden);
    }
  });

  /* -------------------------- synthetic fixtures ------------------------- */

  const stamp = Date.now();
  const staff = await prisma.user.create({
    data: {
      email: `afd3b2-staff-${stamp}@example.invalid`,
      name: "AFD3B2 Synthetic Staff",
      passwordHash: "synthetic-not-a-real-hash",
    },
  });

  async function makePartner(code: string, windowDays = 30) {
    return prisma.affiliatePartner.create({
      data: {
        code,
        displayName: code,
        defaultAttributionWindowDays: windowDays,
        createdByUserId: staff.id,
      },
    });
  }

  async function makeLink(partnerId: number, windowDays: number | null = null) {
    return prisma.affiliateTrackingLink.create({
      data: {
        affiliatePartnerId: partnerId,
        publicCode: randomBase32Id(),
        displayName: "synthetic link",
        attributionWindowDays: windowDays,
        createdByUserId: staff.id,
      },
    });
  }

  const alpha = await makePartner(`afd3b2-alpha-${stamp % 100000}`);
  const beta = await makePartner(`afd3b2-beta-${stamp % 100000}`, 7);
  const alphaLink1 = await makeLink(alpha.id);
  const alphaLink2 = await makeLink(alpha.id);
  const betaLink = await makeLink(beta.id);

  await check("H9 a link can be stored as active", async () => {
    const updated = await prisma.affiliateTrackingLink.update({
      where: { id: alphaLink1.id },
      data: { status: "active" },
      select: { status: true },
    });
    assert.equal(updated.status, "active");
    await prisma.affiliateTrackingLink.update({
      where: { id: alphaLink1.id },
      data: { status: "draft" },
    });
  });

  await check("H10 the database refuses a click classification outside the enum", async () => {
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AffiliateClick" ("ataClickId","trackingLinkId","classification","effectiveAttributionWindowDays","occurredAt","createdAt")
         VALUES ('${randomBase32Id()}', ${alphaLink1.id}, 'bogus', 30, 1, 1)`,
      ),
    );
  });

  await check("H11 the database refuses a visitor id on a non-qualified click", async () => {
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AffiliateClick" ("ataClickId","trackingLinkId","anonymousVisitorId","classification","effectiveAttributionWindowDays","occurredAt","createdAt")
         VALUES ('${randomBase32Id()}', ${alphaLink1.id}, '${randomBase32Id()}', 'prefetch', 30, 1, 1)`,
      ),
    );
  });

  await check("H12 the database refuses a window outside 1..365", async () => {
    for (const bad of [0, 366]) {
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "AffiliateClick" ("ataClickId","trackingLinkId","classification","effectiveAttributionWindowDays","occurredAt","createdAt")
           VALUES ('${randomBase32Id()}', ${alphaLink1.id}, 'qualified', ${bad}, 1, 1)`,
        ),
        String(bad),
      );
    }
  });

  await check("H13 the database refuses a half-attributed conversion event", async () => {
    const user = await prisma.user.create({
      data: {
        email: `afd3b2-half-${stamp}@example.invalid`,
        name: "half",
        passwordHash: "x",
      },
    });
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AffiliateConversionEvent"
          ("eventId","eventType","userId","affiliatePartnerId","sourceOwner","sourceEventId","occurredAt","createdAt")
         VALUES ('${randomBase32Id()}', 'academy_registration', ${user.id}, ${alpha.id}, 'auth_register', 'user:${user.id}', 1, 1)`,
      ),
    );
  });

  /* ----------------------- touch selection over clicks ------------------- */

  const {
    selectEligibleClicks,
    freezeAttribution,
    recordRegistrationConversion,
    registrationSourceEventId,
  } = await import("../../src/lib/affiliate/registration-attribution");

  const journeyVisitor = randomBase32Id();
  const t0 = new Date("2026-07-01T00:00:00.000Z");

  async function click(
    linkId: number,
    at: Date,
    windowDays: number,
    classification: "qualified" | "prefetch" | "authenticated_user" = "qualified",
    visitor: string | null = journeyVisitor,
  ) {
    return prisma.affiliateClick.create({
      data: {
        ataClickId: randomBase32Id(),
        trackingLinkId: linkId,
        anonymousVisitorId: classification === "qualified" ? visitor : null,
        classification,
        effectiveAttributionWindowDays: windowDays,
        occurredAt: at,
      },
      select: { id: true },
    });
  }

  const c1 = await click(alphaLink1.id, t0, 30);
  const c2 = await click(betaLink.id, new Date(t0.getTime() + DAY_MS), 7);
  const c3 = await click(alphaLink2.id, new Date(t0.getTime() + 2 * DAY_MS), 30);
  await click(alphaLink1.id, new Date(t0.getTime() + 3 * DAY_MS), 30, "prefetch");
  await click(alphaLink1.id, new Date(t0.getTime() + 4 * DAY_MS), 30, "authenticated_user");

  const atRegistration = new Date(t0.getTime() + 5 * DAY_MS);

  await check("H14 first touch is the earliest eligible qualified click", async () => {
    const touches = await selectEligibleClicks(prisma, journeyVisitor, atRegistration);
    assert.ok(touches);
    assert.equal(touches!.firstTouchClickId, c1.id);
  });

  await check("H15 last touch is the latest eligible qualified click", async () => {
    const touches = await selectEligibleClicks(prisma, journeyVisitor, atRegistration);
    assert.equal(touches!.lastTouchClickId, c3.id);
  });

  await check("H16 prefetch and authenticated-user clicks are never selected", async () => {
    const touches = await selectEligibleClicks(prisma, journeyVisitor, atRegistration);
    // c3 is the last QUALIFIED click even though two later clicks exist.
    assert.equal(touches!.lastTouchClickId, c3.id);
  });

  await check("H17 a mixed-affiliate journey selects the LAST eligible click, not the first", async () => {
    const touches = await selectEligibleClicks(prisma, journeyVisitor, atRegistration);
    const selected = await prisma.affiliateClick.findUniqueOrThrow({
      where: { id: touches!.lastTouchClickId },
      select: { trackingLink: { select: { affiliatePartnerId: true } } },
    });
    assert.equal(selected.trackingLink.affiliatePartnerId, alpha.id);
    // Beta's click is genuinely in the journey — it simply is not the last one.
    assert.notEqual(touches!.lastTouchClickId, c2.id);
  });

  await check("H18 a click whose OWN window has run out is no longer eligible", async () => {
    // Ten days after Beta's 7-day click, but still inside Alpha's 30-day ones.
    const later = new Date(t0.getTime() + 10 * DAY_MS);
    const touches = await selectEligibleClicks(prisma, journeyVisitor, later);
    assert.equal(touches!.firstTouchClickId, c1.id);
    assert.equal(touches!.lastTouchClickId, c3.id);

    // Forty days after everything: nothing is eligible any more.
    const muchLater = new Date(t0.getTime() + 40 * DAY_MS);
    assert.equal(await selectEligibleClicks(prisma, journeyVisitor, muchLater), null);
  });

  await check("H19 a click made AFTER the registration instant is never eligible", async () => {
    const future = await click(alphaLink1.id, new Date(t0.getTime() + 100 * DAY_MS), 30);
    const touches = await selectEligibleClicks(prisma, journeyVisitor, atRegistration);
    assert.notEqual(touches!.lastTouchClickId, future.id);
    await prisma.affiliateClick.delete({ where: { id: future.id } });
  });

  await check("H20 a PAUSED-after-click link keeps its historical eligibility", async () => {
    await prisma.affiliateTrackingLink.update({
      where: { id: alphaLink2.id },
      data: { status: "paused" },
    });
    const touches = await selectEligibleClicks(prisma, journeyVisitor, atRegistration);
    assert.equal(touches!.lastTouchClickId, c3.id, "a later pause must not erase earned traffic");
  });

  await check("H21 an unknown visitor journey selects nothing", async () => {
    assert.equal(await selectEligibleClicks(prisma, randomBase32Id(), atRegistration), null);
  });

  /* ------------------------ freeze and the ledger ------------------------ */

  const learner = await prisma.user.create({
    data: {
      email: `afd3b2-learner-${stamp}@example.invalid`,
      name: "AFD3B2 Synthetic Learner",
      passwordHash: "synthetic-not-a-real-hash",
    },
  });

  const selection = {
    anonymousVisitorId: journeyVisitor,
    firstTouchClickId: c1.id,
    lastTouchClickId: c3.id,
    selectedClickId: c3.id,
    trackingLinkId: alphaLink2.id,
    affiliatePartnerId: alpha.id,
    affiliateCampaignId: null,
    affiliateCodeSnapshot: alpha.code,
    campaignCodeSnapshot: null,
    trackingLinkPublicCodeSnapshot: alphaLink2.publicCode,
  };

  let attributionId = 0;

  await check("H22 an attribution freezes with the model and reason recorded", async () => {
    attributionId = await freezeAttribution(prisma, learner.id, selection, atRegistration);
    const row = await prisma.affiliateAttribution.findUniqueOrThrow({
      where: { id: attributionId },
    });
    assert.equal(row.userId, learner.id);
    assert.equal(row.anonymousVisitorId, journeyVisitor);
    assert.equal(row.firstTouchClickId, c1.id);
    assert.equal(row.lastTouchClickId, c3.id);
    assert.equal(row.selectedClickId, c3.id);
    assert.equal(row.selectedClickId, row.lastTouchClickId);
    assert.equal(row.attributionModel, "last_eligible_affiliate_click");
    assert.equal(row.selectionReason, "registration_cookie");
    assert.equal(row.frozenAt.getTime(), atRegistration.getTime());
  });

  await check("H23 all three click references belong to the SAME visitor journey", async () => {
    const row = await prisma.affiliateAttribution.findUniqueOrThrow({
      where: { id: attributionId },
    });
    const clicks = await prisma.affiliateClick.findMany({
      where: { id: { in: [row.firstTouchClickId, row.lastTouchClickId, row.selectedClickId] } },
      select: { anonymousVisitorId: true },
    });
    for (const c of clicks) assert.equal(c.anonymousVisitorId, journeyVisitor);
  });

  await check("H24 one user cannot acquire a second attribution", async () => {
    await assert.rejects(freezeAttribution(prisma, learner.id, selection, atRegistration));
  });

  await check("H25 one visitor journey cannot be spent twice", async () => {
    const other = await prisma.user.create({
      data: { email: `afd3b2-thief-${stamp}@example.invalid`, name: "thief", passwordHash: "x" },
    });
    await assert.rejects(freezeAttribution(prisma, other.id, selection, atRegistration));
  });

  await check("H26 an attributed conversion event carries every affiliate coordinate", async () => {
    await recordRegistrationConversion(prisma, {
      userId: learner.id,
      attributionId,
      selection,
      occurredAt: atRegistration,
    });
    const event = await prisma.affiliateConversionEvent.findFirstOrThrow({
      where: { userId: learner.id },
    });
    assert.equal(event.eventType, "academy_registration");
    assert.equal(event.sourceOwner, "auth_register");
    assert.equal(event.sourceEventId, registrationSourceEventId(learner.id));
    assert.equal(event.attributionId, attributionId);
    assert.equal(event.selectedClickId, c3.id);
    assert.equal(event.affiliatePartnerId, alpha.id);
    assert.equal(event.trackingLinkId, alphaLink2.id);
    assert.equal(event.affiliateCodeSnapshot, alpha.code);
    assert.equal(event.trackingLinkPublicCodeSnapshot, alphaLink2.publicCode);
    assert.ok(AFFILIATE_ID_PATTERN.test(event.eventId));
  });

  await check("H27 the conversion ledger is idempotent per user", async () => {
    await assert.rejects(
      recordRegistrationConversion(prisma, {
        userId: learner.id,
        attributionId,
        selection,
        occurredAt: atRegistration,
      }),
    );
  });

  await check("H28 a DIRECT registration produces one unattributed event", async () => {
    const direct = await prisma.user.create({
      data: { email: `afd3b2-direct-${stamp}@example.invalid`, name: "direct", passwordHash: "x" },
    });
    await recordRegistrationConversion(prisma, {
      userId: direct.id,
      attributionId: null,
      selection: null,
      occurredAt: atRegistration,
    });
    const event = await prisma.affiliateConversionEvent.findFirstOrThrow({
      where: { userId: direct.id },
    });
    assert.equal(event.eventType, "academy_registration");
    assert.equal(event.attributionId, null);
    assert.equal(event.selectedClickId, null);
    assert.equal(event.affiliatePartnerId, null);
    assert.equal(event.affiliateCampaignId, null);
    assert.equal(event.trackingLinkId, null);
    assert.equal(event.affiliateCodeSnapshot, null);
    assert.equal(event.campaignCodeSnapshot, null);
    assert.equal(event.trackingLinkPublicCodeSnapshot, null);
  });

  await check("H29 the idempotency key is NOT the email address", async () => {
    assert.equal(registrationSourceEventId(4242), "user:4242");
    assert.ok(!registrationSourceEventId(4242).includes("@"));
  });

  await check("H30 no XP, reward, Pocket identity or balance was created by any of this", async () => {
    assert.equal(await prisma.xpEvent.count(), 0);
    assert.equal(await prisma.xPTransaction.count(), 0);
    assert.equal(await prisma.pocketTraderIdentity.count(), 0);
    assert.equal(await prisma.exchangeAccount.count(), 0);
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
  });

  await prisma.$disconnect();
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
