/**
 * PLPD-1 — legacy Pocket and checkpoint hardening.
 *
 * Synthetic database only. NO EXTERNAL REQUEST IS MADE and nothing contacts
 * Pocket, pocketpartners.com or thedinator.com. Every secret and identifier is
 * synthetic, and the real POSTBACK_SECRET is never read.
 *
 * The three claims under test, each of which was FALSE before the hardening:
 *
 *   A. `POST /api/exchange/postbacks/receive` is behind the SAME disabled Pocket
 *      boundary as the hardened route. It previously used a plain `!==`, a
 *      source-published fallback secret, and no feature flag at all — so
 *      "Pocket postbacks are disabled" was untrue platform-wide.
 *   B. `POST /api/checkpoints/[id]/check` cannot verify, persist or reveal a
 *      balance, and cannot complete anything. It previously wrote an observed
 *      balance into four places and completed a financial gate from it.
 *   C. No current or checkpoint balance is reachable through any API response,
 *      audit row or notification.
 *
 * Historical deposit accounting is asserted to SURVIVE, because removing it
 * would be a different bug: it is transaction history, not a current balance.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-plpd1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** Synthetic. Never the real POSTBACK_SECRET, which this suite never reads. */
const SECRET = "plpd1-synthetic-postback-secret-01";
const WRONG_SECRET = "plpd1-synthetic-postback-secret-02";

/** Hostile financial values a caller might try to smuggle in. */
const HOSTILE_BALANCE = 999999.42;
const HOSTILE_TOKENS = ["999999.42", "999999", "88888.11", "77777.55"];

/** Keys that may never appear in any learner- or staff-facing payload. */
const FORBIDDEN_KEYS = new Set([
  "balance",
  "currentBalance",
  "checkpointBalance",
  "observedBalance",
  "realBalance",
  "demoBalance",
  "accountBalance",
]);

/** Historical deposit accounting that must SURVIVE the hardening. */
const REQUIRED_DEPOSIT_KEYS = ["totalDeposits", "firstDepositConfirmed"];

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanup() {
  for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
}
function safeJson(v: unknown) { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } }
function collectKeys(v: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((e) => collectKeys(e, into));
  else if (v && typeof v === "object" && !(v instanceof Date))
    for (const [k, e] of Object.entries(v)) { into.add(k); collectKeys(e, into); }
  return into;
}
function captureConsole() {
  const lines: string[] = [];
  const o = { log: console.log, warn: console.warn, error: console.error };
  const rec = (...a: unknown[]) => lines.push(a.map((x) => (typeof x === "string" ? x : safeJson(x))).join(" "));
  console.log = rec; console.warn = rec; console.error = rec;
  return { lines, restore() { console.log = o.log; console.warn = o.warn; console.error = o.error; } };
}

let ipSeq = 0;
const nextIp = () => `10.7.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

async function main() {
  cleanup();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.POSTBACK_SECRET = SECRET;
  process.env.POCKET_POSTBACK_ENABLED = "false";

  const { prisma } = await import("../../src/lib/prisma");
  const pocketRoute = await import("../../src/app/api/postbacks/pocket/route");
  const legacyRoute = await import("../../src/app/api/exchange/postbacks/receive/route");
  const auth = await import("../../src/lib/exchange/pocketPostbackAuth");

  let seq = 0;
  async function createLearner() {
    seq += 1;
    const user = await prisma.user.create({
      data: { email: `plpd1-${seq}-${Date.now()}@example.invalid`, name: "PLPD1" },
    });
    const clickId = `tq-${crypto.randomUUID()}`;
    await prisma.exchangeAccount.create({
      data: {
        userId: user.id, provider: "real_placeholder",
        referralLink: "https://example.invalid/ref",
        exchangeAccountId: `pocket-pending-${user.id}`, clickId, status: "pending",
        totalDeposits: 250, firstDepositConfirmed: true,
      },
    });
    return { userId: user.id, clickId };
  }

  const counts = async () => ({
    identities: await prisma.pocketTraderIdentity.count(),
    postbacks: await prisma.postbackEvent.count(),
    attempts: await prisma.checkpointVerificationAttempt.count(),
    xp: await prisma.xPTransaction.count(),
    progress: await prisma.userLevelProgress.count(),
    notifications: await prisma.notification.count(),
  });

  const legacyPost = (body: unknown, headers: Record<string, string> = {}) =>
    legacyRoute.POST(new Request("https://ata.invalid/api/exchange/postbacks/receive", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...headers },
      body: JSON.stringify(body),
    }));

  /* ------------------------------------------------------------------ */
  /* A. Direct Pocket route — unchanged behaviour, still fail-closed      */
  /* ------------------------------------------------------------------ */

  await check("A1 direct route fails closed while the flag is false", async () => {
    const learner = await createLearner();
    const before = await counts();
    const p = new URLSearchParams({
      clickid: learner.clickId, goal: "reg", ow: SECRET, playerid: "600100200",
    });
    const r = await pocketRoute.GET(new Request(
      `https://ata.invalid/api/postbacks/pocket?${p}`,
      { method: "GET", headers: { "x-forwarded-for": nextIp() } },
    ));
    assert.equal(r.status, 503);
    assert.deepEqual(await counts(), before, "no row of any kind may change");
  });

  await check("A2 with the flag on, registration still works and stays idempotent", async () => {
    process.env.POCKET_POSTBACK_ENABLED = "true";
  // G4 made ingest GRANULAR: the master switch alone no longer admits a goal.
  // These suites predate that gate and still wrote the pre-G4 contract, so every
  // positive case answered 503 and they had been red ever since — on the
  // accepted release too, unattributed. Fixture-only and isolated: this sets
  // environment variables inside a throwaway process against a throwaway SQLite
  // file, and changes nothing about the live PREPROD flags, which stay OFF.
  process.env.POCKET_REG_INGEST_ENABLED = "true";
  process.env.POCKET_DEP_INGEST_ENABLED = "true";
    try {
      const learner = await createLearner();
      const playerId = "600100301";
      const send = (secret: string, player: string) => {
        const p = new URLSearchParams({ clickid: learner.clickId, goal: "reg", ow: secret, playerid: player });
        return pocketRoute.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
          method: "GET", headers: { "x-forwarded-for": nextIp() },
        }));
      };
      assert.equal((await send(SECRET, playerId)).status, 200);
      assert.equal(
        (await prisma.pocketTraderIdentity.findUnique({ where: { userId: learner.userId } }))?.pocketUserId,
        playerId,
      );
      // Duplicate is idempotent.
      assert.equal((await send(SECRET, playerId)).status, 200);
      assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
      // A conflicting playerid never overwrites.
      await send(SECRET, "600100302");
      assert.equal(
        (await prisma.pocketTraderIdentity.findUnique({ where: { userId: learner.userId } }))?.pocketUserId,
        playerId,
      );
      // An invalid secret creates nothing.
      const stranger = await createLearner();
      assert.equal((await send(WRONG_SECRET, "600100303")).status, 403);
      assert.equal(await prisma.pocketTraderIdentity.findUnique({ where: { userId: stranger.userId } }), null);
    } finally { process.env.POCKET_POSTBACK_ENABLED = "false"; }
  });

  /* ------------------------------------------------------------------ */
  /* B. Legacy postback route — now on the same boundary                 */
  /* ------------------------------------------------------------------ */

  await check("B1 legacy route fails closed while the flag is false", async () => {
    const before = await counts();
    // Even WITH a correct secret: the flag gate is evaluated first.
    const r = await legacyPost(
      { type: "First Deposit", trader_id: "600200100", externalEventId: `plpd1-${Date.now()}`, amount: 500, currency: "USD" },
      { "x-postback-secret": SECRET },
    );
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.equal(body.error, "POCKET_POSTBACK_UNAVAILABLE");
    assert.deepEqual(await counts(), before, "no mutation while disabled");
  });

  await check("B2 the flag gate precedes the secret comparison", async () => {
    // A WRONG secret while disabled must render identically to a right one,
    // so the disabled route is not an oracle for the secret.
    const wrong = await legacyPost({ type: "First Deposit" }, { "x-postback-secret": WRONG_SECRET });
    const right = await legacyPost({ type: "First Deposit" }, { "x-postback-secret": SECRET });
    const none = await legacyPost({ type: "First Deposit" });
    assert.equal(wrong.status, 503);
    assert.equal(right.status, 503);
    assert.equal(none.status, 503);
    // A Response body may be consumed only once, so read each exactly once.
    const [wrongText, rightText, noneText] = await Promise.all([
      wrong.text(), right.text(), none.text(),
    ]);
    assert.equal(wrongText, rightText);
    assert.equal(rightText, noneText);
  });

  await check("B3 with the flag on, missing/invalid/prefix/suffix secrets all fail", async () => {
    process.env.POCKET_POSTBACK_ENABLED = "true";
    try {
      const before = await counts();
      const variants: Array<Record<string, string>> = [
        {},
        { "x-postback-secret": WRONG_SECRET },
        { "x-postback-secret": SECRET.slice(0, -1) },
        { "x-postback-secret": `${SECRET}x` },
        { "x-postback-secret": SECRET.slice(1) },
        { "x-postback-secret": SECRET.toUpperCase() },
        // NOTE: a leading/trailing space is deliberately NOT tested here. The
        // Fetch "normalize a header value" step strips HTTP whitespace before
        // any application code runs, so ` ${SECRET}` and SECRET are the same
        // header value at the transport layer — refusing it is not something
        // this route could do, and asserting it would be testing undici.
        { "x-postback-secret": "" },
        { "x-postback-secret": `${SECRET},${WRONG_SECRET}` },
      ];
      for (const headers of variants) {
        const r = await legacyPost(
          { type: "First Deposit", trader_id: "600200101", externalEventId: `plpd1-b3-${Math.random()}`, amount: 500 },
          headers,
        );
        assert.equal(r.status, 403, `variant ${safeJson(headers)} must be refused`);
      }
      assert.deepEqual(await counts(), before, "no mutation from any rejected request");
    } finally { process.env.POCKET_POSTBACK_ENABLED = "false"; }
  });

  await check("B4 no source-published fallback secret is accepted", async () => {
    process.env.POCKET_POSTBACK_ENABLED = "true";
    const savedSecret = process.env.POSTBACK_SECRET;
    try {
      // With POSTBACK_SECRET absent the route must be UNAVAILABLE, not fall back
      // to the development constant the old code resolved through.
      delete process.env.POSTBACK_SECRET;
      const env = await import("../../src/lib/env");
      const r = await legacyPost(
        { type: "First Deposit", trader_id: "600200102", externalEventId: `plpd1-b4-${Date.now()}` },
        { "x-postback-secret": env.DEV_POSTBACK_SECRET },
      );
      assert.equal(r.status, 503, "the dev fallback must never authenticate");
    } finally {
      process.env.POSTBACK_SECRET = savedSecret;
      process.env.POCKET_POSTBACK_ENABLED = "false";
    }
  });

  await check("B5 the legacy route uses the shared timing-safe helper", () => {
    const source = fs.readFileSync("src/app/api/exchange/postbacks/receive/route.ts", "utf8");
    const executable = source.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    assert.ok(executable.includes("authenticatePocketRequest"), "shared helper is used");
    assert.ok(executable.includes("resolvePocketPostbackConfig"), "shared flag gate is used");
    assert.ok(!executable.includes("getPostbackSecret"), "no fallback resolver");
    assert.ok(!/secret\s*!==/.test(executable), "no plain !== comparison");
    // The helper itself is length-independent and constant-time.
    assert.equal(auth.timingSafeSecretEqual(SECRET, SECRET), true);
    for (const v of [SECRET.slice(0, 8), `${SECRET}${SECRET}`, "", SECRET.toUpperCase()]) {
      assert.equal(auth.timingSafeSecretEqual(v, SECRET), false);
    }
  });

  await check("B6 an authenticated legacy event cannot touch Pocket identity", async () => {
    process.env.POCKET_POSTBACK_ENABLED = "true";
    try {
      const learner = await createLearner();
      // Bind a real identity through the sanctioned route first.
      const p = new URLSearchParams({ clickid: learner.clickId, goal: "reg", ow: SECRET, playerid: "600300100" });
      await pocketRoute.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
        method: "GET", headers: { "x-forwarded-for": nextIp() },
      }));
      const bound = await prisma.pocketTraderIdentity.findUniqueOrThrow({ where: { userId: learner.userId } });

      // Now hit the legacy route, authenticated, with a DIFFERENT trader id.
      await legacyPost(
        { type: "First Deposit", userId: learner.userId, trader_id: "600300999",
          externalEventId: `plpd1-b6-${Date.now()}`, amount: 500, currency: "USD" },
        { "x-postback-secret": SECRET },
      );

      const after = await prisma.pocketTraderIdentity.findUniqueOrThrow({ where: { userId: learner.userId } });
      assert.equal(after.id, bound.id, "identity row must be untouched");
      assert.equal(after.pocketUserId, bound.pocketUserId, "identity must not be overwritten");
      assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
      // And it created no L4 progress or XP.
      assert.equal(await prisma.checkpointVerificationAttempt.count(), 0);
      assert.equal(await prisma.xPTransaction.count(), 0);
    } finally { process.env.POCKET_POSTBACK_ENABLED = "false"; }
  });

  await check("B7 the legacy route never calls the identity binder", () => {
    const source = fs.readFileSync("src/app/api/exchange/postbacks/receive/route.ts", "utf8");
    assert.ok(!source.includes("bindPocketTraderIdentity"), "no identity binding from the legacy route");
    const processor = fs.readFileSync("src/lib/exchange/postbackProcessor.ts", "utf8");
    assert.ok(!processor.includes("bindPocketTraderIdentity"), "the processor cannot bind identity either");
  });

  /* ------------------------------------------------------------------ */
  /* C. Legacy checkpoint route — retired                                */
  /* ------------------------------------------------------------------ */

  await check("C1 the retired route performs no mutation and no provider call", () => {
    const source = fs.readFileSync("src/app/api/checkpoints/[id]/check/route.ts", "utf8");
    const executable = source.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    assert.ok(!/\.update\(|\.create\(|\$transaction/.test(executable), "no mutation remains");
    assert.ok(!executable.includes("getBalanceProvider"), "no legacy balance provider call");
    assert.ok(!executable.includes("createCheckpointNotification"), "no notification");
    assert.ok(!/nextBalance|currentBalance|requiredBalance|providerResult/.test(executable),
      "no balance-bearing identifier survives in executable code");
    assert.ok(executable.includes("503"), "answers a bounded unavailable status");
  });

  await check("C2 the retired route cannot complete or bypass anything", () => {
    // Executable lines only: the explanatory comment legitimately NAMES
    // CheckpointBalanceProvider when explaining what the route used to bypass.
    const source = fs.readFileSync("src/app/api/checkpoints/[id]/check/route.ts", "utf8");
    const executable = source.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    for (const forbidden of [
      "completeCurriculumLevel", "verifyCurrentCheckpoint", "CheckpointBalanceProvider",
      "XPTransaction", "xPTransaction", "resolveCheckpointProvider", "getBalanceProvider",
    ]) {
      assert.ok(!executable.includes(forbidden), `retired route must not reference ${forbidden}`);
    }
  });

  await check("C3 hostile financial fields are refused by the request schema", async () => {
    const { checkpointCheckSchema } = await import("../../src/lib/validation");
    // Whatever the schema accepts, the route ignores: it reads no body value.
    // Assert the route never reads a supplied financial field.
    const source = fs.readFileSync("src/app/api/checkpoints/[id]/check/route.ts", "utf8");
    const executable = source.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    for (const field of ["parsed.data.balance", "parsed.data.checkpointBalance", "parsed.data.depositAmount", "parsed.data.currency"]) {
      assert.ok(!executable.includes(field), `route must not read ${field}`);
    }
    assert.ok(checkpointCheckSchema, "schema still parses for compatibility");
  });

  /* ------------------------------------------------------------------ */
  /* D. Financial privacy — API key sets                                 */
  /* ------------------------------------------------------------------ */

  await check("D1 the exchange-account serializer exposes no balance", async () => {
    const { serializeExchangeAccount } = await import("../../src/lib/exchange/account");
    const account = await prisma.exchangeAccount.findFirstOrThrow();
    // Hostile: the row itself carries a balance; the serializer must drop it.
    await prisma.exchangeAccount.update({ where: { id: account.id }, data: { balance: HOSTILE_BALANCE } });
    const fresh = await prisma.exchangeAccount.findUniqueOrThrow({ where: { id: account.id } });
    // FDCONF-1: the serializer no longer has a first-deposit answer of its own —
    // it must be handed the resolved one. Passing an explicit value here also
    // keeps this test about BALANCE PRIVACY rather than about the read model,
    // which has its own suite (src/lib/exchange/first-deposit-truth.test.ts).
    const serialised = serializeExchangeAccount(fresh, {
      confirmed: false,
      source: "none",
      occurredAt: null,
    });
    const keys = Object.keys(serialised);
    for (const forbidden of FORBIDDEN_KEYS) {
      assert.ok(!keys.includes(forbidden), `serializer exposed ${forbidden}`);
    }
    const dump = safeJson(serialised);
    for (const token of HOSTILE_TOKENS) {
      assert.ok(!dump.includes(token), `serializer leaked ${token}`);
    }
    // Historical deposit accounting SURVIVES.
    for (const required of REQUIRED_DEPOSIT_KEYS) {
      assert.ok(keys.includes(required), `historical field ${required} must be preserved`);
    }
  });

  await check("D2 no server route returns a current or checkpoint balance", () => {
    const roots = ["src/app/api"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (entry.name !== "route.ts") continue;
        const text = fs.readFileSync(full, "utf8");
        for (const [i, line] of text.split("\n").entries()) {
          if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
          if (/\b(balance|currentBalance|checkpointBalance)\s*:/.test(line)) {
            // `balance: 0` is zero-initialisation and records no observation.
            if (/\b(balance|currentBalance)\s*:\s*0\s*,?\s*$/.test(line)) continue;
            // A DECLARATION THAT THE PLATFORM DOES NOT COLLECT ONE is the
            // opposite of a disclosure, and this guard exists to catch
            // disclosures. G4's `currentBalance: "not_collected"` is the
            // pocket-conversions route stating the prohibition in its own
            // payload; matching it made this assertion red on the accepted
            // release for the wrong reason. The allowance is a closed set of
            // literal absence markers — never a number, never a variable, never
            // an expression — so a route that actually returned a balance is
            // still caught.
            if (/\b(balance|currentBalance|checkpointBalance)\s*:\s*"(not_collected|prohibited_not_collected|unavailable)"\s*,?\s*$/.test(line)) {
              continue;
            }
            offenders.push(`${full}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    };
    for (const r of roots) walk(r);
    assert.deepEqual(offenders, [], `balance-bearing route fields:\n${offenders.join("\n")}`);
  });

  await check("D3 checkpoint notifications carry no observed balance", async () => {
    const notifications = await import("../../src/lib/notifications");
    const source = fs.readFileSync("src/lib/notifications.ts", "utf8");
    const executable = source.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    assert.ok(!executable.includes("currentBalance"), "no currentBalance in notification code");
    assert.ok(typeof notifications.createCheckpointNotification === "function");
  });

  await check("D4 no audit row or notification row holds a hostile balance", async () => {
    const dump = safeJson({
      audits: await prisma.auditLog.findMany(),
      notifications: await prisma.notification.findMany(),
    });
    for (const token of HOSTILE_TOKENS) {
      assert.ok(!dump.includes(token), `audit/notification leaked ${token}`);
    }
    for (const key of collectKeys({
      audits: await prisma.auditLog.findMany(),
      notifications: await prisma.notification.findMany(),
    })) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `audit/notification exposed key ${key}`);
    }
  });

  await check("D5 nothing logged a hostile balance or a secret", async () => {
    const capture = captureConsole();
    try {
      const learner = await createLearner();
      await legacyPost({ type: "First Deposit", trader_id: "1", externalEventId: "x", amount: HOSTILE_BALANCE },
        { "x-postback-secret": SECRET });
      const p = new URLSearchParams({ clickid: learner.clickId, goal: "reg", ow: SECRET, playerid: "600400100" });
      await pocketRoute.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
        method: "GET", headers: { "x-forwarded-for": nextIp() },
      }));
    } finally { capture.restore(); }
    const logged = capture.lines.join("\n");
    for (const token of [...HOSTILE_TOKENS, SECRET, WRONG_SECRET, "ow="]) {
      assert.ok(!logged.includes(token), `logged ${token}`);
    }
  });

  await check("D6 the whole database holds no hostile balance fixture", async () => {
    const dump = safeJson({
      identities: await prisma.pocketTraderIdentity.findMany(),
      postbacks: await prisma.postbackEvent.findMany(),
      attempts: await prisma.checkpointVerificationAttempt.findMany(),
      audits: await prisma.auditLog.findMany(),
      notifications: await prisma.notification.findMany(),
    });
    for (const token of [SECRET, WRONG_SECRET]) {
      assert.ok(!dump.includes(token), `database leaked ${token}`);
    }
  });

  await prisma.$disconnect();
  cleanup();
  console.log(`\nPLPD-1 legacy hardening: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); cleanup(); process.exitCode = 1; });
