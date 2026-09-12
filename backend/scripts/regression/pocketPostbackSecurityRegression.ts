import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  PocketRejectionReason,
  authenticatePocketRequest,
  fingerprintEventId,
  hasQueryAuthMaterial,
  isAcceptableSecret,
  resolvePocketPostbackConfig,
  timingSafeSecretEqual,
} from "../../src/lib/exchange/pocketPostbackAuth";

// Real HTTP regression for the fail-closed Pocket postback contract:
//   GET /api/postbacks/pocket
//
// Isolated `next dev` servers against throwaway /tmp SQLite databases. No
// deployed database, no external service, no contact with Pocket. Every secret
// used here is synthetic.
//
// Three server configurations are exercised in sequence:
//   A. integration disabled (POCKET_POSTBACK_ENABLED absent)
//   B. enabled but the secret is too weak to be usable
//   C. enabled with a valid synthetic secret
const dbPath = `/tmp/ata-pocket-security-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3860 + (process.pid % 30);
const baseUrl = `http://127.0.0.1:${port}`;

const SECRET = "pocket-ps1-synthetic-secret-value";
const WRONG_SECRET = "pocket-ps1-synthetic-secret-wrong";
const WEAK_SECRET = "short";
const SESSION_SECRET = "pocket-ps1-session-secret";
const CLICK_ID = "tq-ps1-known-click";

let passed = 0;
let failed = 0;
let logs = "";

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    if (logs) console.error(`--- server log tail ---\n${logs.slice(-1200)}\n--- end ---`);
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET,
  POSTBACK_SECRET: SECRET,
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};
for (const key of [
  "NODE_ENV",
  "POCKET_POSTBACK_ENABLED",
  "POCKET_POSTBACK_REQUIRE_SECRET",
  // POCKET-REG-INGRESS-1: the granular family switches are THIS SUITE'S
  // fixtures, never inherited — an operator shell that happens to export one
  // must not silently convert a disabled-family refusal case into an accepted
  // mutation. Each server start states exactly the families it turns on.
  "POCKET_REG_INGEST_ENABLED",
  "POCKET_DEP_INGEST_ENABLED",
  "POCKET_RDEP_INGEST_ENABLED",
  "POCKET_FIRST_DEPOSIT_ENABLED",
  "CURRICULUM_V2_ADMIN_ENABLED",
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_XP_ENABLED",
  "CURRICULUM_V2_CONTENT_ENABLED",
  "CURRICULUM_V2_ASSESSMENT_ENABLED",
]) {
  delete baseEnv[key];
}

async function start(overrides: Record<string, string | undefined>) {
  const env = { ...baseEnv, ...overrides };
  // POCKET-REG-INGRESS-1: `--turbopack` removed. The accepted phase-worktree
  // layout provisions node_modules as per-package symlinks into the canonical
  // store, and Turbopack's dev resolver refuses to cross them ("Next.js
  // package not found" / jsx-runtime unresolved), which failed this suite on
  // an environment property rather than on its subject. The suite's subject is
  // the route's HTTP behaviour; the webpack dev server resolves the symlinked
  // store correctly and serves the identical routes.
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value) => {
    logs += String(value);
  });
  child.stderr?.on("data", (value) => {
    logs += String(value);
  });

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-4000)}`);
}

async function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // already gone
  }
}

type Reply = { status: number; headers: Headers; body: Record<string, unknown>; text: string };

async function postback(
  query: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const url = new URL(`${baseUrl}/api/postbacks/pocket`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers, redirect: "manual" });
  const text = await response.text();
  let value: unknown = {};
  try {
    value = JSON.parse(text);
  } catch {
    // non-JSON body is asserted on via `text`
  }
  return { status: response.status, headers: response.headers, body: value as Record<string, unknown>, text };
}

function authed(extra: Record<string, string> = {}) {
  return { "x-postback-secret": SECRET, ...extra };
}

function regQuery(eventId: string, extra: Record<string, string> = {}) {
  return { goal: "reg", clickid: CLICK_ID, playerid: "ps1-player", event_id: eventId, ...extra };
}

async function main() {
  cleanup();
  let server: ChildProcess | null = null;

  try {
    const migration = spawnSync(
      process.execPath,
      [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
      { env: baseEnv, encoding: "utf8" },
    );
    if (migration.status !== 0) {
      throw new Error(`${migration.stdout}\n${migration.stderr}`);
    }

    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");

    const user = await prisma.user.create({
      data: { email: "pocket-ps1@example.com", name: "Pocket PS1", role: "user", passwordHash: "x" },
    });
    await prisma.exchangeAccount.create({
      data: {
        userId: user.id,
        provider: "manual",
        status: "pending",
        clickId: CLICK_ID,
        referralLink: `https://example.com/ref?click_id=${CLICK_ID}`,
        exchangeAccountId: "ps1-exchange-account",
      },
    });

    // ---------------------------------------------------------------- unit --
    // Pure contract tests: no server, no database.

    await check("unit: absent enable flag disables the integration", () => {
      assert.deepEqual(resolvePocketPostbackConfig({ POSTBACK_SECRET: SECRET }), { enabled: false });
    });

    await check("unit: the removed fail-open flag cannot enable the route", () => {
      const config = resolvePocketPostbackConfig({
        POSTBACK_SECRET: SECRET,
        POCKET_POSTBACK_REQUIRE_SECRET: "false",
      });
      assert.deepEqual(config, { enabled: false });
    });

    await check("unit: enabled without a secret stays disabled", () => {
      assert.deepEqual(resolvePocketPostbackConfig({ POCKET_POSTBACK_ENABLED: "true" }), {
        enabled: false,
      });
    });

    await check("unit: whitespace-only and weak secrets are rejected", () => {
      for (const secret of ["   ", "\t\n", WEAK_SECRET, `  ${SECRET}  `, "a".repeat(201)]) {
        assert.equal(isAcceptableSecret(secret), false, `expected ${JSON.stringify(secret)} invalid`);
        assert.deepEqual(
          resolvePocketPostbackConfig({ POCKET_POSTBACK_ENABLED: "true", POSTBACK_SECRET: secret }),
          { enabled: false },
        );
      }
      assert.equal(isAcceptableSecret(SECRET), true);
    });

    await check("unit: enabled with a valid secret resolves", () => {
      assert.deepEqual(
        resolvePocketPostbackConfig({ POCKET_POSTBACK_ENABLED: "true", POSTBACK_SECRET: SECRET }),
        { enabled: true, secret: SECRET },
      );
    });

    await check("unit: timing-safe comparison is correct for equal and unequal lengths", () => {
      assert.equal(timingSafeSecretEqual(SECRET, SECRET), true);
      assert.equal(timingSafeSecretEqual(WRONG_SECRET, SECRET), false);
      assert.equal(timingSafeSecretEqual("", SECRET), false);
      assert.equal(timingSafeSecretEqual(`${SECRET}x`, SECRET), false, "longer must not match");
      assert.equal(timingSafeSecretEqual(SECRET.slice(0, -1), SECRET), false, "shorter must not match");
    });

    await check("unit: header structural validation covers every rejection", () => {
      const cases: Array<[Record<string, string>, string]> = [
        [{}, PocketRejectionReason.MissingHeader],
        [{ "x-postback-secret": "" }, PocketRejectionReason.MissingHeader],
        // HTTP strips optional whitespace, so a space-only header arrives empty.
        [{ "x-postback-secret": " " }, PocketRejectionReason.MissingHeader],
        [{ "x-postback-secret": WEAK_SECRET }, PocketRejectionReason.MalformedHeader],
        [{ "x-postback-secret": "has an internal space value" }, PocketRejectionReason.MalformedHeader],
        [{ "x-postback-secret": `${SECRET},${SECRET}` }, PocketRejectionReason.AmbiguousHeader],
        [{ "x-postback-secret": WRONG_SECRET }, PocketRejectionReason.SecretMismatch],
      ];
      for (const [headers, reason] of cases) {
        const outcome = authenticatePocketRequest(new Headers(headers), SECRET);
        assert.equal(outcome.ok, false, `expected rejection for ${JSON.stringify(headers)}`);
        assert.equal(outcome.ok === false && outcome.reason, reason);
      }
      assert.deepEqual(authenticatePocketRequest(new Headers(authed()), SECRET), { ok: true });
    });

    await check("unit: query auth material is detected case-insensitively", () => {
      const keys = ["ow", "secret", "token"];
      for (const key of ["ow", "OW", "Secret", "TOKEN"]) {
        assert.equal(hasQueryAuthMaterial(new URLSearchParams({ [key]: "x" }), keys), true, key);
      }
      assert.equal(hasQueryAuthMaterial(new URLSearchParams({ goal: "reg" }), keys), false);
    });

    await check("unit: event fingerprint is short and non-reversible", () => {
      const fingerprint = fingerprintEventId(CLICK_ID);
      assert.equal(fingerprint.length, 12);
      assert.match(fingerprint, /^[0-9a-f]{12}$/);
      assert.ok(!fingerprint.includes(CLICK_ID));
      assert.equal(fingerprint, fingerprintEventId(CLICK_ID), "must be deterministic");
    });

    // ------------------------------------------- A. integration disabled ----
    server = await start({});

    await check("disabled: an unauthenticated postback is refused", async () => {
      const reply = await postback(regQuery("disabled-1"));
      assert.equal(reply.status, 503);
      assert.equal(reply.body.error, "POCKET_POSTBACK_UNAVAILABLE");
    });

    await check("disabled: a correctly authenticated postback is still refused", async () => {
      const reply = await postback(regQuery("disabled-2"), authed());
      assert.equal(reply.status, 503);
    });

    await check("disabled: zero domain rows changed", async () => {
      assert.equal(await prisma.postbackEvent.count(), 0);
      const account = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });
      assert.equal(account?.registrationStatus, false);
    });

    await stop(server);
    server = null;

    // ------------------------------------- B. enabled, secret unusable ------
    server = await start({ POCKET_POSTBACK_ENABLED: "true", POSTBACK_SECRET: WEAK_SECRET });

    await check("weak secret: the route is unavailable, not open", async () => {
      const reply = await postback(regQuery("weak-1"));
      assert.equal(reply.status, 503);
      assert.equal(reply.body.error, "POCKET_POSTBACK_UNAVAILABLE");
    });

    await check("weak secret: the configured weak value does not authenticate", async () => {
      const reply = await postback(regQuery("weak-2"), { "x-postback-secret": WEAK_SECRET });
      assert.equal(reply.status, 503);
    });

    await check("weak secret: disabled and misconfigured are indistinguishable", async () => {
      const reply = await postback(regQuery("weak-3"), authed());
      assert.equal(reply.status, 503);
      assert.equal(reply.body.error, "POCKET_POSTBACK_UNAVAILABLE");
    });

    await check("weak secret: zero domain rows changed", async () => {
      assert.equal(await prisma.postbackEvent.count(), 0);
    });

    await stop(server);
    server = null;

    // --------------------------------------- C. enabled and configured ------
    // POCKET-REG-INGRESS-1: the REG family switch is stated explicitly — G4 made
    // ingest granular, and the master alone admits nothing. DEP/RDEP stay off:
    // this suite's deposit cases assert the DISABLED behaviour.
    server = await start({ POCKET_POSTBACK_ENABLED: "true", POCKET_REG_INGEST_ENABLED: "true" });

    await check("auth: a missing header is refused", async () => {
      const reply = await postback(regQuery("auth-1"));
      assert.equal(reply.status, 403);
      assert.equal(reply.body.error, "FORBIDDEN");
    });

    await check("auth: an empty header is refused", async () => {
      const reply = await postback(regQuery("auth-2"), { "x-postback-secret": "" });
      assert.equal(reply.status, 403);
    });

    await check("auth: a malformed header is refused", async () => {
      const reply = await postback(regQuery("auth-3"), { "x-postback-secret": WEAK_SECRET });
      assert.equal(reply.status, 403);
    });

    await check("auth: a wrong secret is refused", async () => {
      const reply = await postback(regQuery("auth-4"), { "x-postback-secret": WRONG_SECRET });
      assert.equal(reply.status, 403);
    });

    await check("auth: missing and wrong secrets are byte-identical responses", async () => {
      const missing = await postback(regQuery("auth-5"));
      const wrong = await postback(regQuery("auth-5"), { "x-postback-secret": WRONG_SECRET });
      assert.equal(missing.status, wrong.status);
      assert.equal(missing.text, wrong.text);
    });

    // PDP-1 changed this contract deliberately. Pocket's official DIRECT
    // postback carries its shared secret as the `ow` QUERY parameter, so `ow`
    // now authenticates — but ONLY for `goal=reg`, which moves no money. The
    // legacy ATA aliases had no provider mandate and stay rejected everywhere,
    // and every financial goal remains header-only.
    await check("auth: legacy query-secret aliases are refused, not accepted", async () => {
      for (const key of ["secret", "token"]) {
        const reply = await postback(regQuery(`auth-q-${key}`, { [key]: SECRET }));
        assert.equal(reply.status, 403, `${key} must not authenticate`);
      }
    });

    // AFD-4 amended this contract for `dep` ALONE, and only behind
    // POCKET_FIRST_DEPOSIT_ENABLED (default false, and unset in this suite).
    // POCKET-REG-INGRESS-1 (TEST-POCKET-REFUSAL-CONTRACT): `redep` is a Growth
    // V1 goal with its own switch, so with the family off a query-authenticated
    // attempt is `503` BEFORE authentication — retry-safe, and not a secret
    // problem. Goals with no Growth V1 mandate keep the indistinguishable 403.
    await check("auth: ow cannot authenticate a financial goal", async () => {
      for (const goal of ["ftd", "commission", "withdrawal"]) {
        const reply = await postback({
          goal, clickid: CLICK_ID, playerid: "ps1-player",
          event_id: `auth-q-fin-${goal}`, sum: "10", ow: SECRET,
        });
        assert.equal(reply.status, 403, `${goal} must stay header-only`);
      }
      const redep = await postback({
        goal: "redep", clickid: CLICK_ID, playerid: "ps1-player",
        event_id: "auth-q-fin-redep", sum: "10", ow: SECRET,
      });
      assert.equal(redep.status, 503, "redep while RDEP is off is unavailable, pre-auth");
    });

    await check("auth: ow cannot authenticate a deposit while first deposit is off", async () => {
      const reply = await postback({
        goal: "dep", clickid: CLICK_ID, playerid: "ps1-player",
        event_id: "auth-q-fin-dep", sum: "10", ow: SECRET,
      });
      // Unavailable rather than forbidden: the feature is off, the credentials
      // are not in question, and 503 is retry-safe. Nothing is processed either
      // way -- no provider event, no conversion, no identity.
      assert.equal(reply.status, 503, "a disabled deposit must not be processed");
    });

    await check("auth: a wrong ow is refused on the registration path too", async () => {
      const reply = await postback(regQuery("auth-q-wrong", { ow: WRONG_SECRET }));
      assert.equal(reply.status, 403, "a wrong query secret must not authenticate");
    });

    await check("auth: a valid header does not rescue a legacy query alias", async () => {
      for (const key of ["secret", "token"]) {
        const reply = await postback(regQuery(`auth-q-both-${key}`, { [key]: SECRET }), authed());
        assert.equal(reply.status, 403, "legacy query auth material is rejected outright");
      }
    });

    await check("auth: a correct ow authenticates a registration", async () => {
      // It passes authentication and is then judged on its FIELDS: this legacy
      // fixture uses an affiliate-era clickid and a non-numeric playerid, so
      // the strict direct-registration parser refuses it with a bounded 400 —
      // decisively not the 403 an authentication failure produces.
      const reply = await postback(regQuery("auth-q-ok", { ow: SECRET }));
      assert.equal(reply.status, 400, "authenticated, then rejected on field shape");
      assert.notEqual(reply.status, 403);
    });

    await check("auth: a duplicated header is refused as ambiguous", async () => {
      const reply = await postback(regQuery("auth-6"), {
        "x-postback-secret": `${SECRET},${WRONG_SECRET}`,
      });
      assert.equal(reply.status, 403);
    });

    await check("auth: rejected requests performed zero business work", async () => {
      assert.equal(await prisma.postbackEvent.count(), 0);
      const account = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });
      assert.equal(account?.registrationStatus, false);
      assert.equal(account?.status, "pending");
    });

    await check("privacy: no rejection response contains the secret", async () => {
      const replies = [
        await postback(regQuery("privacy-1")),
        await postback(regQuery("privacy-2"), { "x-postback-secret": WRONG_SECRET }),
        await postback(regQuery("privacy-3", { ow: SECRET })),
      ];
      for (const reply of replies) {
        assert.ok(!reply.text.includes(SECRET), "response leaked the expected secret");
        assert.ok(!reply.text.includes(WRONG_SECRET), "response leaked the received secret");
        assert.ok(!reply.text.toLowerCase().includes("prisma"), "response leaked a Prisma error");
        assert.ok(!reply.text.includes("at "), "response leaked a stack frame");
      }
    });

    await check("privacy: AuditLog security metadata is allow-listed only", async () => {
      const rows = await prisma.auditLog.findMany({
        where: { action: { in: ["POCKET_POSTBACK_FORBIDDEN", "POCKET_POSTBACK_REJECTED"] } },
      });
      assert.ok(rows.length > 0, "expected security audit rows");
      const allowed = new Set(["route", "reason", "eventFingerprint"]);
      const reasons = new Set<string>(Object.values(PocketRejectionReason));
      for (const row of rows) {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        for (const key of Object.keys(metadata)) {
          assert.ok(allowed.has(key), `unexpected audit metadata key ${key}`);
        }
        assert.equal(metadata.route, "/api/postbacks/pocket");
        assert.ok(reasons.has(String(metadata.reason)), `unbounded reason ${metadata.reason}`);
        const serialized = JSON.stringify(metadata);
        assert.ok(!serialized.includes(SECRET), "audit leaked the secret");
        assert.ok(!serialized.includes(WRONG_SECRET), "audit leaked the received secret");
        assert.ok(!serialized.includes("pocket-ps1@example.com"), "audit leaked an email");
      }
    });

    await check("headers: every response is no-store and correlated", async () => {
      const rejected = await postback(regQuery("hdr-1"));
      assert.equal(rejected.headers.get("cache-control"), "no-store");
      assert.match(String(rejected.headers.get("x-request-id")), /^[0-9a-f-]{36}$/);
    });

    await check("validation: an unknown goal is refused after authentication", async () => {
      const reply = await postback({ goal: "not-a-goal", clickid: CLICK_ID }, authed());
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "UNKNOWN_GOAL");
    });

    await check("validation: a non-numeric amount is refused", async () => {
      const reply = await postback(regQuery("val-1", { sum: "abc" }), authed());
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "INVALID_AMOUNT");
    });

    await check("validation: a negative amount is refused", async () => {
      const reply = await postback(regQuery("val-2", { sum: "-5" }), authed());
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "INVALID_AMOUNT");
    });

    await check("validation: a missing click id is refused", async () => {
      const reply = await postback({ goal: "reg", playerid: "x" }, authed());
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "CLICK_ID_REQUIRED");
    });

    await check("validation: an overlong parameter is refused", async () => {
      const reply = await postback(regQuery("val-3", { promo: "a".repeat(1001) }), authed());
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "PARAM_TOO_LONG");
    });

    await check("validation: an unknown click id is refused without creating an account", async () => {
      const before = await prisma.exchangeAccount.count();
      const reply = await postback(
        { goal: "reg", clickid: "no-such-click", playerid: "x", event_id: "val-4" },
        authed(),
      );
      assert.equal(reply.status, 404);
      assert.equal(reply.body.error, "UNKNOWN_CLICK_ID");
      assert.equal(await prisma.exchangeAccount.count(), before);
    });

    await check("validation: still zero postback events for the known account", async () => {
      assert.equal(await prisma.postbackEvent.count({ where: { exchangeAccountId: { not: null } } }), 0);
    });

    // ------------------------------------------------ idempotency/replay ----
    await check("replay: the first authenticated event is applied once", async () => {
      const reply = await postback(regQuery("evt-registration"), authed());
      assert.equal(reply.status, 200);
      assert.equal(reply.body.success, true);
      assert.equal(reply.body.duplicate, false);

      const account = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });
      assert.equal(account?.registrationStatus, true);
      assert.equal(account?.status, "connected");
    });

    await check("replay: an exact duplicate does not mutate twice", async () => {
      const events = await prisma.postbackEvent.count({ where: { externalEventId: "evt-registration" } });
      const reply = await postback(regQuery("evt-registration"), authed());
      assert.equal(reply.status, 200);
      assert.equal(reply.body.duplicate, true);
      assert.equal(await prisma.postbackEvent.count({ where: { externalEventId: "evt-registration" } }), events);
    });

    await check("replay: the duplicate response is deterministic", async () => {
      const first = await postback(regQuery("evt-registration"), authed());
      const second = await postback(regQuery("evt-registration"), authed());
      assert.deepEqual(first.body, second.body);
    });

    // POCKET-REG-INGRESS-1 (post-G4 restatement). This case used to prove the
    // legacy header deposit was credited exactly once. G4 closed that path by
    // REMOVAL — `goal=dep` on the header channel is the shadow money path the
    // ledger never heard about, so it no longer exists; the canonical replay
    // and conflict proofs for deposits live in pocketFirstDepositRegression.
    // What this case pins now is the removal itself: however many times the
    // legacy delivery is sent, it is refused and moves NOTHING.
    await check("replay: a legacy header deposit is refused every time, moving nothing", async () => {
      const query = { goal: "dep", clickid: CLICK_ID, playerid: "ps1-player", event_id: "evt-dep", sum: "100" };
      for (let i = 0; i < 4; i += 1) {
        const reply = await postback(query, authed());
        assert.equal(reply.status, 400, "the legacy header deposit goal is gone");
        assert.equal(reply.body.error, "UNKNOWN_GOAL");
      }
      assert.equal(
        await prisma.postbackEvent.count({ where: { externalEventId: "evt-dep" } }),
        0,
        "a refused delivery must not leave a receipt",
      );

      const account = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });
      assert.equal(account?.totalDeposits, 0, "a refused deposit must credit nothing");
      // DEVACT-1 — a deposit must NOT credit a current trading balance.
      //
      // This assertion previously required `balance` to track the deposit
      // total. That is a CURRENT TRADING BALANCE, which the platform is
      // forbidden to persist: PLPD-1 removed it from every API response, but
      // the postback path kept writing the column, so the figure accumulated
      // where nothing displayed it. Historical accounting (`totalDeposits`,
      // `depositAmount`, `firstDepositConfirmed`) is what carries the deposit,
      // and it is asserted immediately above. The idempotency property this
      // test exists to prove is unchanged and still enforced.
      assert.equal(account?.balance, 0, "a deposit must never persist a current balance");
      assert.equal(account?.firstDepositConfirmed, false, "a refused deposit confirms nothing");
    });

    // POCKET-REG-INGRESS-1 (post-G4 restatement). The header `redep` goal went
    // the way of `dep`: removed outright. Concurrency-exactly-once for the
    // surviving canonical paths is pinned in pocketDirectPostbackRegression
    // (F4/F5) and pocketFirstDepositRegression; what a concurrent legacy burst
    // must prove now is that every request is refused and nothing races at all.
    await check("replay: concurrent legacy redeposits are all refused, mutating nothing", async () => {
      const query = {
        goal: "redep",
        clickid: CLICK_ID,
        playerid: "ps1-player",
        event_id: "evt-concurrent",
        sum: "50",
      };

      const replies = await Promise.all(
        Array.from({ length: 6 }, () => postback(query, authed())),
      );

      for (const reply of replies) {
        assert.equal(reply.status, 400, `unexpected status ${reply.status}: ${reply.text}`);
        assert.equal(reply.body.error, "UNKNOWN_GOAL");
      }

      assert.equal(
        await prisma.postbackEvent.count({ where: { externalEventId: "evt-concurrent" } }),
        0,
        "a refused delivery must not leave a receipt",
      );

      const account = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });
      assert.equal(account?.totalDeposits, 0, "a refused redeposit must credit nothing");
      // DEVACT-1 — a deposit must NOT credit a current trading balance.
      //
      // This assertion previously required `balance` to track the deposit
      // total. That is a CURRENT TRADING BALANCE, which the platform is
      // forbidden to persist: PLPD-1 removed it from every API response, but
      // the postback path kept writing the column, so the figure accumulated
      // where nothing displayed it. Historical accounting (`totalDeposits`,
      // `depositAmount`, `firstDepositConfirmed`) is what carries the deposit,
      // and it is asserted immediately above. The idempotency property this
      // test exists to prove is unchanged and still enforced.
      assert.equal(account?.balance, 0, "a deposit must never persist a current balance");
    });

    // POCKET-REG-INGRESS-1 (post-G4 restatement). With the legacy goal removed
    // there is no receipt for a conflicting redelivery to collide with — the
    // conflict-never-overwrites proof for canonical deposits lives in
    // pocketFirstDepositRegression. A conflicting legacy delivery is simply
    // refused like every other one, and stores nothing to conflict WITH.
    await check("replay: a conflicting legacy duplicate is refused and stores nothing", async () => {
      const conflicting = {
        goal: "redep",
        clickid: CLICK_ID,
        playerid: "ps1-player",
        event_id: "evt-concurrent",
        sum: "9999",
      };
      const reply = await postback(conflicting, authed());
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "UNKNOWN_GOAL");

      const stored = await prisma.postbackEvent.findUnique({ where: { externalEventId: "evt-concurrent" } });
      assert.equal(stored, null, "a refused delivery must not store a receipt");

      const account = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });
      assert.equal(account?.totalDeposits, 0, "a refused conflict must not move money");
      // DEVACT-1 — a deposit must NOT credit a current trading balance.
      //
      // This assertion previously required `balance` to track the deposit
      // total. That is a CURRENT TRADING BALANCE, which the platform is
      // forbidden to persist: PLPD-1 removed it from every API response, but
      // the postback path kept writing the column, so the figure accumulated
      // where nothing displayed it. Historical accounting (`totalDeposits`,
      // `depositAmount`, `firstDepositConfirmed`) is what carries the deposit,
      // and it is asserted immediately above. The idempotency property this
      // test exists to prove is unchanged and still enforced.
      assert.equal(account?.balance, 0, "a deposit must never persist a current balance");
    });

    await check("replay: idempotency is durable, not process memory", async () => {
      // The receipt is a database row with a UNIQUE column; prove the constraint
      // itself rejects a second insert independently of any route or cache.
      // POCKET-REG-INGRESS-1: the first row is seeded directly now — the legacy
      // route no longer writes one — so this stays a pure database proof.
      await prisma.postbackEvent.create({
        data: {
          externalEventId: "evt-concurrent",
          type: "Re-deposit",
          eventType: "deposit",
          status: "processed",
          rawPayload: "{}",
        },
      });
      await assert.rejects(
        prisma.postbackEvent.create({
          data: {
            externalEventId: "evt-concurrent",
            type: "Re-deposit",
            eventType: "deposit",
            status: "processed",
            rawPayload: "{}",
          },
        }),
        (error: unknown) =>
          typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002",
      );
    });

    await check("replay: progression completed at most once", async () => {
      const completions = await prisma.auditLog.count({
        where: { userId: user.id, action: "POSTBACK_RECEIVED" },
      });
      const receipts = await prisma.postbackEvent.count({ where: { exchangeAccountId: { not: null } } });
      assert.equal(completions, receipts, "one accepted receipt must produce one POSTBACK_RECEIVED");
    });

    await check("privacy: accepted responses expose no internal detail", async () => {
      const reply = await postback(regQuery("evt-registration"), authed());
      assert.deepEqual(Object.keys(reply.body).sort(), ["duplicate", "success"]);
      assert.ok(!reply.text.includes(SECRET));
      assert.ok(!reply.text.includes("pocket-ps1@example.com"));
      assert.equal(reply.headers.get("cache-control"), "no-store");
    });

    await check("privacy: no stored payload retains a secret alias value", async () => {
      const events = await prisma.postbackEvent.findMany();
      for (const event of events) {
        assert.ok(!event.rawPayload.includes(SECRET), "rawPayload leaked the secret");
        assert.ok(!JSON.stringify(event.payload ?? {}).includes(SECRET), "payload leaked the secret");
      }
    });

    // ------------------------------------------------------ rate limiting --
    await check("rate limit: a burst is bounded and returns a safe 429", async () => {
      const replies: Reply[] = [];
      for (let i = 0; i < 80; i += 1) {
        replies.push(await postback(regQuery(`rl-${i}`), { "x-forwarded-for": "203.0.113.77" }));
      }
      const limited = replies.filter((reply) => reply.status === 429);
      assert.ok(limited.length > 0, "expected the per-IP budget to engage");
      for (const reply of limited) {
        assert.equal(reply.body.error, "RATE_LIMITED");
        assert.equal(reply.headers.get("cache-control"), "no-store");
        assert.ok(!reply.text.includes(SECRET), "429 leaked the secret");
        assert.ok(!reply.text.includes("203.0.113.77"), "429 echoed the bucket key");
      }
    });

    // POCKET-REG-INGRESS-1 (post-G4 restatement). The budgets were deliberately
    // SPLIT by G4's rate policy: authentication failures draw from their own far
    // tighter budget, and accepted traffic from a generous provider-shaped one —
    // precisely so a flood of wrong secrets cannot lock the real provider out
    // (rate-policy.ts states the design). The failure flood above was limited by
    // the failure budget; the correctly authenticated request that follows must
    // therefore SUCCEED, not inherit the attacker's exhaustion.
    await check("rate limit: an auth-failure flood cannot lock out the provider", async () => {
      const reply = await postback(regQuery("rl-authed"), {
        ...authed(),
        "x-forwarded-for": "203.0.113.77",
      });
      assert.equal(reply.status, 200, "a valid request must not pay for the attacker's failures");
    });

    await check("rate limit: buckets are isolated per IP", async () => {
      const reply = await postback(regQuery("iso-other"), {
        ...authed(),
        "x-forwarded-for": "203.0.113.9",
      });
      assert.notEqual(reply.status, 429, "a different IP must have its own budget");
    });

    await check("rate limit: the exhausted bucket wrote no domain rows", async () => {
      // Every rejected or rate-limited "rl-" request must have reached no
      // database. The ONE accepted request above ("rl-authed") legitimately
      // wrote exactly its own receipt — that is the provider not being locked
      // out, not a leak.
      const stray = await prisma.postbackEvent.count({
        where: { externalEventId: { startsWith: "rl-" }, NOT: { externalEventId: "rl-authed" } },
      });
      assert.equal(stray, 0, "rate-limited and rejected requests must not create receipts");
      assert.equal(
        await prisma.postbackEvent.count({ where: { externalEventId: "rl-authed" } }),
        1,
        "the accepted request writes exactly one receipt",
      );
    });
  } finally {
    await stop(server);
    cleanup();
  }

  console.log(`\npocket postback security: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
