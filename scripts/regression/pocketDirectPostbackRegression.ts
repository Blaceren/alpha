/**
 * PDP-1 — the official DIRECT Pocket registration postback.
 *
 * Synthetic database only. NO EXTERNAL REQUEST IS MADE: this suite builds real
 * `Request` objects in Pocket's exact GET format and hands them to the route
 * handler in process. Nothing contacts thedinator.com or pocketpartners.com,
 * and every secret, clickid and playerid here is synthetic.
 *
 * The claim under test: **Pocket can authenticate directly with its official
 * `ow` query secret, and that path cannot bind an identity it has not
 * authenticated, cannot overwrite one, and cannot move money.**
 *
 * Proven here:
 *   A. flag/secret  — disabled, missing secret, fail-closed.
 *   B. ow auth      — missing, duplicated, malformed, wrong, encoded, correct.
 *   C. goal         — reg only; financial goals stay header-only.
 *   D. clickid      — format, duplicates, unknown, SQL-like, path-like.
 *   E. playerid     — zero, negative, decimal, exponent, sign, oversized, dupes.
 *   F. identity     — create, idempotent replay, both conflict directions, races.
 *   G. legacy       — deposits/withdrawals never create or change an identity.
 *   H. privacy      — no secret, query string or full URL anywhere.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-pocket-direct-pdp1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/**
 * Synthetic. Never a real Pocket secret.
 *
 * Deliberately contains `&` and `%` — characters percent-encoding escapes — so
 * the encoding tests are real: with an alphanumeric-only secret,
 * `encodeURIComponent` is the identity function and a "double-encoded" value
 * would be indistinguishable from the original.
 */
const SECRET = "pdp1-synth&postback%secret-01";
const WRONG_SECRET = "pdp1-synth&postback%secret-02";
const ROUTE = "https://ata.invalid/api/postbacks/pocket";

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
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function captureConsole() {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const record = (...args: unknown[]) =>
    lines.push(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
  console.log = record; console.warn = record; console.error = record;
  return { lines, restore() { console.log = original.log; console.warn = original.warn; console.error = original.error; } };
}
function safeJson(v: unknown) { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } }

let ipSeq = 0;
/** A fresh source IP per request so the route's rate limit never masks a result. */
const nextIp = () => `10.4.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

let playerSeq = 0;
const nextPlayerId = () => String(300_000_000 + ++playerSeq);

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
  process.env.POCKET_POSTBACK_ENABLED = "true";
  // G4 made ingest GRANULAR: the master switch alone no longer admits a goal.
  // These suites predate that gate and still wrote the pre-G4 contract, so every
  // positive case answered 503 and they had been red ever since — on the
  // accepted release too, unattributed. Fixture-only and isolated: this sets
  // environment variables inside a throwaway process against a throwaway SQLite
  // file, and changes nothing about the live PREPROD flags, which stay OFF.
  process.env.POCKET_REG_INGEST_ENABLED = "true";
  process.env.POCKET_DEP_INGEST_ENABLED = "true";
  // POCKET-REG-SECURITY-CLOSURE-1 (§14): RDEP is deliberately NOT enabled here,
  // and is DELETED rather than merely left unset — several cases below assert
  // that a redeposit is refused, and an operator shell exporting the flag would
  // silently convert those refusals into acceptances.
  delete process.env.POCKET_RDEP_INGEST_ENABLED;

  const { prisma } = await import("../../src/lib/prisma");
  const route = await import("../../src/app/api/postbacks/pocket/route");
  const auth = await import("../../src/lib/exchange/pocketPostbackAuth");

  let learnerSeq = 0;
  /** A learner whose ExchangeAccount carries a real ATA-format clickid. */
  async function createLearner() {
    learnerSeq += 1;
    const user = await prisma.user.create({
      data: { email: `pdp1-${learnerSeq}@example.invalid`, name: "PDP1" },
    });
    const clickId = `tq-${crypto.randomUUID()}`;
    await prisma.exchangeAccount.create({
      data: {
        userId: user.id, provider: "real_placeholder",
        referralLink: "https://example.invalid/ref",
        exchangeAccountId: `pocket-pending-${user.id}`, clickId, status: "pending",
      },
    });
    return { userId: user.id, clickId };
  }

  /**
   * The synthetic DIRECT Pocket sender — exactly the official field shape:
   *   GET <url>?clickid=...&goal=reg&ow=<secret>&playerid=...
   * `raw` allows deliberately malformed query strings (duplicates, encoding).
   */
  function send(input: {
    clickid?: string; goal?: string; ow?: string | null; playerid?: string;
    extra?: Record<string, string>; raw?: string; header?: string;
  }) {
    let qs: string;
    if (input.raw !== undefined) {
      qs = input.raw;
    } else {
      const p = new URLSearchParams();
      if (input.clickid !== undefined) p.set("clickid", input.clickid);
      if (input.goal !== undefined) p.set("goal", input.goal);
      if (input.ow !== undefined && input.ow !== null) p.set("ow", input.ow);
      if (input.playerid !== undefined) p.set("playerid", input.playerid);
      for (const [k, v] of Object.entries(input.extra ?? {})) p.set(k, v);
      qs = p.toString();
    }
    const headers: Record<string, string> = { "x-forwarded-for": nextIp() };
    if (input.header) headers["x-postback-secret"] = input.header;
    return route.GET(new Request(`${ROUTE}?${qs}`, { method: "GET", headers }));
  }

  const reg = (clickid: string, playerid: string, over: Partial<Parameters<typeof send>[0]> = {}) =>
    send({ clickid, goal: "reg", ow: SECRET, playerid, ...over });

  const bindingFor = (userId: number) =>
    prisma.pocketTraderIdentity.findUnique({ where: { userId } });

  /* ------------------------------------------------------------------ */
  /* A. Flag and secret                                                  */
  /* ------------------------------------------------------------------ */

  await check("A1 flag disabled: 503, no identity, no lookup", async () => {
    const learner = await createLearner();
    process.env.POCKET_POSTBACK_ENABLED = "false";
    try {
      const r = await reg(learner.clickId, nextPlayerId());
      assert.equal(r.status, 503);
      assert.equal(await bindingFor(learner.userId), null);
    } finally { process.env.POCKET_POSTBACK_ENABLED = "true"; }
  });

  await check("A2 secret missing: fail-closed 503, no identity", async () => {
    const learner = await createLearner();
    const saved = process.env.POSTBACK_SECRET;
    delete process.env.POSTBACK_SECRET;
    try {
      const r = await reg(learner.clickId, nextPlayerId());
      assert.equal(r.status, 503);
      assert.equal(await bindingFor(learner.userId), null);
    } finally { process.env.POSTBACK_SECRET = saved; }
  });

  await check("A3 a too-short secret is treated as absent", async () => {
    const learner = await createLearner();
    const saved = process.env.POSTBACK_SECRET;
    process.env.POSTBACK_SECRET = "short";
    try {
      const r = await reg(learner.clickId, nextPlayerId());
      assert.equal(r.status, 503);
      assert.equal(await bindingFor(learner.userId), null);
    } finally { process.env.POSTBACK_SECRET = saved; }
  });

  /* ------------------------------------------------------------------ */
  /* B. ow authentication                                                */
  /* ------------------------------------------------------------------ */

  await check("B1 a valid direct registration binds the learner", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    const r = await reg(learner.clickId, playerId);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    const bound = await bindingFor(learner.userId);
    assert.ok(bound);
    assert.equal(bound.pocketUserId, playerId);
    assert.equal(bound.clickId, learner.clickId);
    assert.equal(bound.source, "registration_postback");
  });

  await check("B2 missing ow binds nothing", async () => {
    const learner = await createLearner();
    const r = await send({ clickid: learner.clickId, goal: "reg", playerid: nextPlayerId() });
    assert.equal(r.status, 403);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("B3 a wrong ow binds nothing", async () => {
    const learner = await createLearner();
    const r = await reg(learner.clickId, nextPlayerId(), { ow: WRONG_SECRET });
    assert.equal(r.status, 403);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("B4 a duplicated ow is ambiguous, never first-wins", async () => {
    const learner = await createLearner();
    const raw = `clickid=${learner.clickId}&goal=reg&ow=${encodeURIComponent(SECRET)}&ow=${encodeURIComponent(WRONG_SECRET)}&playerid=${nextPlayerId()}`;
    const r = await send({ raw });
    assert.equal(r.status, 403);
    assert.equal(await bindingFor(learner.userId), null);
    // And in the other order, so it is not merely "last one loses".
    const learner2 = await createLearner();
    const raw2 = `clickid=${learner2.clickId}&goal=reg&ow=${encodeURIComponent(WRONG_SECRET)}&ow=${encodeURIComponent(SECRET)}&playerid=${nextPlayerId()}`;
    assert.equal((await send({ raw: raw2 })).status, 403);
    assert.equal(await bindingFor(learner2.userId), null);
  });

  await check("B5 the secret is not trimmed, lower-cased or re-decoded", async () => {
    const learner = await createLearner();
    for (const mutated of [
      ` ${SECRET}`, `${SECRET} `, SECRET.toUpperCase(), SECRET.slice(0, -1),
      `${SECRET}x`, SECRET.slice(1), "",
    ]) {
      const r = await reg(learner.clickId, nextPlayerId(), { ow: mutated });
      assert.equal(r.status, 403, `mutation ${JSON.stringify(mutated)} must not authenticate`);
    }
    // Double-encoded: URLSearchParams decodes exactly once, so %2520 must not
    // become the literal secret on a second pass.
    const doubled = encodeURIComponent(encodeURIComponent(SECRET));
    const raw = `clickid=${learner.clickId}&goal=reg&ow=${doubled}&playerid=${nextPlayerId()}`;
    assert.equal((await send({ raw })).status, 403);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("B6 a correctly percent-encoded ow authenticates", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    const raw = `clickid=${learner.clickId}&goal=reg&ow=${encodeURIComponent(SECRET)}&playerid=${playerId}`;
    const r = await send({ raw });
    assert.equal(r.status, 200);
    assert.equal((await bindingFor(learner.userId))?.pocketUserId, playerId);
  });

  await check("B7 the timing-safe helper rejects prefix/suffix/length variants", () => {
    assert.equal(auth.timingSafeSecretEqual(SECRET, SECRET), true);
    for (const variant of [
      SECRET.slice(0, 8), `${SECRET}${SECRET}`, "", " ",
      SECRET.replace(/.$/, "X"), SECRET.toUpperCase(),
    ]) {
      assert.equal(auth.timingSafeSecretEqual(variant, SECRET), false, JSON.stringify(variant));
    }
  });

  /* ------------------------------------------------------------------ */
  /* C. Goal                                                             */
  /* ------------------------------------------------------------------ */

  // AFD-4 amended this contract for `dep` ALONE, and only behind
  // POCKET_FIRST_DEPOSIT_ENABLED (default false, and unset in this suite). Every
  // goal OUTSIDE the Growth V1 vocabulary stays header-only unconditionally,
  // which is what this case now pins. The deposit contract itself is proven in
  // pocketFirstDepositRegression.
  //
  // POCKET-REG-INGRESS-1 — the post-G4 refusal contract, stated once
  // (TEST-POCKET-REFUSAL-CONTRACT). G4 made ingest granular: a goal the
  // allowlist SUPPORTS (`reg`/`dep`/`redep`) whose own family switch is off is
  // answered `503 POCKET_POSTBACK_UNAVAILABLE` BEFORE authentication — a
  // disabled feature is not an authentication failure, 503 is retry-safe so a
  // delivery during a rollout window is not lost, and no lookup or write has
  // happened yet. `redep` therefore answers 503 here (RDEP is off in this
  // suite), while goals with NO Growth V1 mandate (`ftd`, `commission`,
  // `withdrawal`, `email`) still treat a query-borne secret as forbidden auth
  // material and answer the one indistinguishable 403. Both refusals are total:
  // nothing authenticates, nothing binds, nothing is written.
  await check("C1 ow cannot authenticate any financial goal", async () => {
    const learner = await createLearner();
    for (const goal of ["ftd", "commission", "withdrawal", "email"]) {
      const r = await send({
        clickid: learner.clickId, goal, ow: SECRET,
        playerid: nextPlayerId(), extra: { sum: "10", event_id: `pdp1-fin-${goal}` },
      });
      assert.equal(r.status, 403, `${goal} must stay header-only`);
    }
    const redep = await send({
      clickid: learner.clickId, goal: "redep", ow: SECRET,
      playerid: nextPlayerId(), extra: { sum: "10", event_id: "pdp1-fin-redep" },
    });
    // Unavailable rather than forbidden — the family is off, not the secret.
    assert.equal(redep.status, 503, "redep while RDEP is off must be unavailable, pre-auth");
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("C1b ow cannot authenticate a deposit while first deposit is off", async () => {
    const learner = await createLearner();
    const r = await send({
      clickid: learner.clickId, goal: "dep", ow: SECRET,
      playerid: nextPlayerId(), extra: { sum: "10", event_id: "pdp1-fin-dep" },
    });
    // Unavailable rather than forbidden -- the feature is off, not the secret.
    assert.equal(r.status, 503);
    // And whichever answer it gives, a deposit still binds no identity.
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("C2 an unknown goal with ow is refused", async () => {
    const learner = await createLearner();
    for (const goal of ["register", "REG", "reg ", "signup", ""]) {
      const r = await send({ clickid: learner.clickId, goal, ow: SECRET, playerid: nextPlayerId() });
      assert.equal(r.status, 403, `goal ${JSON.stringify(goal)} must not use ow`);
    }
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("C3 a duplicated goal selects the safe header-only mode", async () => {
    const learner = await createLearner();
    const raw = `clickid=${learner.clickId}&goal=reg&goal=reg&ow=${encodeURIComponent(SECRET)}&playerid=${nextPlayerId()}`;
    const r = await send({ raw });
    assert.equal(r.status, 403);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("C4 legacy query aliases remain rejected on the reg path", async () => {
    const learner = await createLearner();
    for (const key of ["secret", "token"]) {
      const r = await reg(learner.clickId, nextPlayerId(), { extra: { [key]: SECRET } });
      assert.equal(r.status, 403, `${key} must be rejected outright`);
    }
    assert.equal(await bindingFor(learner.userId), null);
  });

  /* ------------------------------------------------------------------ */
  /* D. clickid                                                          */
  /* ------------------------------------------------------------------ */

  await check("D1 an unknown clickid binds nothing and does not reveal itself", async () => {
    const unknown = `tq-${crypto.randomUUID()}`;
    const before = await prisma.pocketTraderIdentity.count();
    const r = await reg(unknown, nextPlayerId());
    assert.equal(r.status, 400);
    const body = await r.text();
    assert.ok(!body.includes(unknown), "the clickid must not be reflected");
    assert.equal(await prisma.pocketTraderIdentity.count(), before);
  });

  await check("D2 malformed clickids are refused before any lookup", async () => {
    for (const bad of [
      "", "tq-", "not-a-click", "tq-12345", `tq-${crypto.randomUUID()}x`,
      "tq-../../etc/passwd", "tq-' OR 1=1--", "tq-%00", "TQ-" + crypto.randomUUID(),
      `tq-${crypto.randomUUID()}`.toUpperCase(), "x".repeat(300),
    ]) {
      const r = await reg(bad, nextPlayerId());
      assert.equal(r.status, 400, `clickid ${JSON.stringify(bad.slice(0, 40))}`);
    }
  });

  await check("D3 a duplicated clickid is ambiguous", async () => {
    const a = await createLearner();
    const b = await createLearner();
    const raw = `clickid=${a.clickId}&clickid=${b.clickId}&goal=reg&ow=${encodeURIComponent(SECRET)}&playerid=${nextPlayerId()}`;
    const r = await send({ raw });
    assert.equal(r.status, 400);
    assert.equal(await bindingFor(a.userId), null);
    assert.equal(await bindingFor(b.userId), null);
  });

  await check("D4 a missing clickid is refused", async () => {
    const r = await send({ goal: "reg", ow: SECRET, playerid: nextPlayerId() });
    assert.equal(r.status, 400);
  });

  /* ------------------------------------------------------------------ */
  /* E. playerid                                                         */
  /* ------------------------------------------------------------------ */

  await check("E1 malformed playerids are all refused", async () => {
    const learner = await createLearner();
    for (const bad of [
      "", "0", "-5", "+5", "1.5", "1e3", "0123", " 12", "12 ", "abc",
      "12abc", "٧", "9".repeat(20), "1,2", "1;2", "NaN", "Infinity",
    ]) {
      const r = await reg(learner.clickId, bad);
      assert.equal(r.status, 400, `playerid ${JSON.stringify(bad)}`);
    }
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("E2 a missing playerid is refused", async () => {
    const learner = await createLearner();
    const r = await send({ clickid: learner.clickId, goal: "reg", ow: SECRET });
    assert.equal(r.status, 400);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("E3 a duplicated playerid is ambiguous", async () => {
    const learner = await createLearner();
    const raw = `clickid=${learner.clickId}&goal=reg&ow=${encodeURIComponent(SECRET)}&playerid=${nextPlayerId()}&playerid=${nextPlayerId()}`;
    const r = await send({ raw });
    assert.equal(r.status, 400);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("E4 the maximum safe playerid is accepted losslessly", async () => {
    const learner = await createLearner();
    const big = "9007199254740991"; // Number.MAX_SAFE_INTEGER
    const r = await reg(learner.clickId, big);
    assert.equal(r.status, 200);
    const bound = await bindingFor(learner.userId);
    assert.equal(bound?.pocketUserId, big, "stored as an exact decimal string");
    assert.equal(Number(bound!.pocketUserId), Number.MAX_SAFE_INTEGER);
    // Beyond the safe range the Partner API comparison could lose precision.
    const learner2 = await createLearner();
    assert.equal((await reg(learner2.clickId, "9007199254740993")).status, 400);
  });

  /* ------------------------------------------------------------------ */
  /* F. Identity contract                                                */
  /* ------------------------------------------------------------------ */

  await check("F1 an identical duplicate registration is idempotent", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    assert.equal((await reg(learner.clickId, playerId)).status, 200);
    const first = await bindingFor(learner.userId);

    const again = await reg(learner.clickId, playerId);
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), { ok: true });

    const second = await bindingFor(learner.userId);
    assert.equal(second!.id, first!.id);
    assert.equal(second!.boundAt.getTime(), first!.boundAt.getTime());
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  await check("F2 the same learner with a different playerid never overwrites", async () => {
    const learner = await createLearner();
    const original = nextPlayerId();
    await reg(learner.clickId, original);
    const r = await reg(learner.clickId, nextPlayerId());
    assert.equal(r.status, 200, "the response must not become an oracle");
    assert.equal((await bindingFor(learner.userId))?.pocketUserId, original);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  await check("F3 the same playerid for a different learner is refused", async () => {
    const first = await createLearner();
    const second = await createLearner();
    const shared = nextPlayerId();
    await reg(first.clickId, shared);
    const r = await reg(second.clickId, shared);
    assert.equal(r.status, 200);
    assert.equal((await bindingFor(first.userId))?.pocketUserId, shared);
    assert.equal(await bindingFor(second.userId), null);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { pocketUserId: shared } }), 1);
  });

  await check("F4 concurrent identical registrations create exactly one row", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    const replies = await Promise.all(
      Array.from({ length: 6 }, () => reg(learner.clickId, playerId)),
    );
    for (const r of replies) assert.ok(r.status < 500, `unexpected ${r.status}`);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  await check("F5 concurrent conflicting registrations produce one winner", async () => {
    const learner = await createLearner();
    const replies = await Promise.all([
      reg(learner.clickId, nextPlayerId()),
      reg(learner.clickId, nextPlayerId()),
      reg(learner.clickId, nextPlayerId()),
    ]);
    for (const r of replies) assert.ok(r.status < 500);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  await check("F6 a conflict is audited with a bounded, non-identifying reason", async () => {
    const learner = await createLearner();
    await reg(learner.clickId, nextPlayerId());
    const attacker = nextPlayerId();
    await reg(learner.clickId, attacker);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "POCKET_IDENTITY_BINDING_REJECTED" }, orderBy: { id: "desc" },
    });
    assert.ok(audit);
    const metadata = JSON.stringify(audit.metadata ?? {});
    assert.ok(metadata.includes("conflict_learner_bound"));
    assert.ok(!metadata.includes(attacker), "the claimed playerid must not be audited");
    assert.ok(!metadata.includes(learner.clickId), "the clickid must not be audited");
  });

  /* ------------------------------------------------------------------ */
  /* G. Legacy events never touch identity                               */
  /* ------------------------------------------------------------------ */

  await check("G1 a header-authenticated deposit is refused and creates no identity", async () => {
    // G4-H5 — STRONGER THAN IT WAS. This used to assert that a legacy
    // header-authenticated `goal=dep` was ACCEPTED (200) and merely did not bind
    // an identity. It was accepted straight into the legacy `Float` processor
    // while emitting no canonical growth event, so a real Pocket deposit could
    // move money on a path the growth ledger never heard about.
    //
    // `goalToPocketType` maps only `reg` now, so the deposit goal is refused at
    // the receiver. The original claim — no identity — still holds, and is still
    // asserted.
    const learner = await createLearner();
    const r = await send({
      clickid: learner.clickId, goal: "dep", playerid: nextPlayerId(),
      extra: { sum: "100", event_id: "pdp1-dep-1" }, header: SECRET,
    });
    assert.equal(r.status, 400, await r.clone().text());
    assert.equal((await r.clone().json()).error, "UNKNOWN_GOAL");
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("G2 later financial events cannot change a bound identity", async () => {
    const learner = await createLearner();
    const original = nextPlayerId();
    await reg(learner.clickId, original);

    for (const [goal, id] of [["dep", nextPlayerId()], ["withdrawal", nextPlayerId()], ["commission", nextPlayerId()]] as const) {
      await send({
        clickid: learner.clickId, goal, playerid: id,
        extra: { sum: "50", event_id: `pdp1-${goal}-x` }, header: SECRET,
      });
    }
    assert.equal((await bindingFor(learner.userId))?.pocketUserId, original);

    // A financial event with NO playerid must not erase the identity either.
    await send({
      clickid: learner.clickId, goal: "dep",
      extra: { sum: "25", event_id: "pdp1-dep-noplayer" }, header: SECRET,
    });
    assert.equal((await bindingFor(learner.userId))?.pocketUserId, original);
  });

  await check("G3 the legacy ExchangeAccount.traderId is not the identity", async () => {
    const learner = await createLearner();
    const original = nextPlayerId();
    await reg(learner.clickId, original);
    await prisma.exchangeAccount.update({
      where: { userId: learner.userId }, data: { traderId: "999888777" },
    });
    assert.equal((await bindingFor(learner.userId))?.pocketUserId, original);
  });

  /* ------------------------------------------------------------------ */
  /* H. Bounds and privacy                                               */
  /* ------------------------------------------------------------------ */

  await check("H1 an oversized query is refused before authentication", async () => {
    const learner = await createLearner();
    const r = await reg(learner.clickId, nextPlayerId(), { extra: { pad: "x".repeat(1200) } });
    assert.equal(r.status, 400);
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < 50; i += 1) tooMany[`k${i}`] = "v";
    assert.equal((await reg(learner.clickId, nextPlayerId(), { extra: tooMany })).status, 400);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("H2 no response body reflects a supplied value", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    const bodies: string[] = [];
    bodies.push(await (await reg(learner.clickId, playerId)).text());
    bodies.push(await (await reg(learner.clickId, playerId)).text());
    bodies.push(await (await reg(learner.clickId, nextPlayerId())).text());
    bodies.push(await (await reg(learner.clickId, "0")).text());
    bodies.push(await (await reg(learner.clickId, nextPlayerId(), { ow: WRONG_SECRET })).text());
    bodies.push(await (await reg(`tq-${crypto.randomUUID()}`, nextPlayerId())).text());
    for (const body of bodies) {
      for (const forbidden of [SECRET, WRONG_SECRET, learner.clickId, playerId, "ow="]) {
        assert.ok(!body.includes(forbidden), `response leaked ${forbidden}: ${body}`);
      }
      assert.ok(body.length < 200, "responses stay bounded");
    }
  });

  await check("H3 authentication failures are indistinguishable", async () => {
    const learner = await createLearner();
    const missing = await reg(learner.clickId, nextPlayerId(), { ow: undefined as never });
    const wrong = await reg(learner.clickId, nextPlayerId(), { ow: WRONG_SECRET });
    assert.equal(missing.status, wrong.status);
    assert.equal(await missing.text(), await wrong.text());
  });

  await check("H4 unknown clickid and malformed clickid are indistinguishable", async () => {
    const unknown = await reg(`tq-${crypto.randomUUID()}`, nextPlayerId());
    const malformed = await reg("tq-not-a-uuid", nextPlayerId());
    assert.equal(unknown.status, malformed.status);
    assert.equal(await unknown.text(), await malformed.text());
  });

  await check("H5 nothing logs the secret, query string or full URL", async () => {
    const capture = captureConsole();
    try {
      const learner = await createLearner();
      await reg(learner.clickId, nextPlayerId());
      await reg(learner.clickId, nextPlayerId(), { ow: WRONG_SECRET });
      await reg("tq-bad", nextPlayerId());
      await send({ clickid: learner.clickId, goal: "dep", ow: SECRET, playerid: "1" });
    } finally { capture.restore(); }
    const logged = capture.lines.join("\n");
    for (const forbidden of [SECRET, WRONG_SECRET, "ow=", "api/postbacks/pocket?", ROUTE]) {
      assert.ok(!logged.includes(forbidden), `logged ${forbidden}: ${logged.slice(0, 300)}`);
    }
  });

  await check("H6 no audit row or stored payload retains the secret", async () => {
    const audits = await prisma.auditLog.findMany();
    const dump = safeJson(audits);
    for (const forbidden of [SECRET, WRONG_SECRET, "ow="]) {
      assert.ok(!dump.includes(forbidden), `AuditLog leaked ${forbidden}`);
    }
    for (const event of await prisma.postbackEvent.findMany()) {
      assert.ok(!event.rawPayload.includes(SECRET), "rawPayload leaked the secret");
      assert.ok(!safeJson(event.payload ?? {}).includes(SECRET), "payload leaked the secret");
    }
  });

  await check("H7 no identity exists that was not authenticated", async () => {
    // Every row in the table must be traceable to a learner whose clickid we
    // created — an unauthenticated request can never have produced one.
    const rows = await prisma.pocketTraderIdentity.findMany();
    assert.ok(rows.length > 0, "the suite did bind identities");
    for (const row of rows) {
      assert.equal(row.source, "registration_postback");
      assert.match(row.clickId, /^tq-[0-9a-f-]{36}$/);
      assert.match(row.pocketUserId, /^[1-9][0-9]*$/);
    }
  });

  await check("H8 the identity table holds no financial field", async () => {
    const rows = await prisma.pocketTraderIdentity.findMany();
    const keys = new Set(rows.flatMap((r) => Object.keys(r)));
    for (const forbidden of ["balance", "realBalance", "demoBalance", "amount", "deposit", "ftd"]) {
      assert.ok(!keys.has(forbidden), `identity exposed ${forbidden}`);
    }
  });

  await prisma.$disconnect();
  cleanup();
  console.log(`\nPDP-1 direct pocket postback: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); cleanup(); process.exitCode = 1; });
