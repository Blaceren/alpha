/**
 * DEVACT-1 — Pocket deposit event boundaries.
 *
 * Synthetic database only. NO EXTERNAL REQUEST IS MADE. Every secret and
 * identifier here is synthetic and the real POSTBACK_SECRET is never read.
 *
 * Three claims, each of which was FALSE before this phase:
 *
 *   A. A deposit postback cannot persist a CURRENT TRADING BALANCE.
 *      `buildPostbackAccountUpdate` incremented `ExchangeAccount.balance` on
 *      every deposit and decremented it on withdrawal, and a provider "balance"
 *      event wrote it outright. PLPD-1 had removed `balance` from every API
 *      response, so the column was accumulating a forbidden figure that nothing
 *      displayed — the leak was in the database, not the API.
 *
 *   B. A monetary event with NO provider event identity cannot move money.
 *      The processor fell back to `crypto.randomUUID()`, which is unique by
 *      construction and therefore defeated the unique index it was written to:
 *      two deliveries of one deposit produced two rows and incremented the
 *      totals twice. The route separately hashed
 *      clickId|traderId|type|amount|dateTime — a forbidden key that collapses
 *      two legitimate same-amount deposits into one.
 *
 *   C. When the provider DOES supply an identity, duplicates are idempotent and
 *      same-amount distinct deposits stay independent.
 *
 * Registration is asserted to keep working throughout, because closing deposit
 * accounting must not close identity binding.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-devact1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** Synthetic. Never the real POSTBACK_SECRET, which this suite never reads. */
const SECRET = "devact1-synthetic-postback-secret";

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

let ipSeq = 0;
const nextIp = () => `10.21.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

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
  // POCKET-REG-SECURITY-CLOSURE-1 (§14): this suite OWNS its fixture flags.
  // It set only the master gate, so after G4 made ingest granular it was green
  // solely because an operator exported the family switches — and red for
  // anyone who ran it plainly. Families this suite does not exercise are
  // DELETED rather than left inherited, so an exported flag cannot turn one of
  // its refusal assertions into an acceptance.
  process.env.POCKET_REG_INGEST_ENABLED = "true";
  process.env.POCKET_DEP_INGEST_ENABLED = "true";
  process.env.POCKET_FIRST_DEPOSIT_ENABLED = "true";
  delete process.env.POCKET_RDEP_INGEST_ENABLED;

  const { prisma } = await import("../../src/lib/prisma");
  const processor = await import("../../src/lib/exchange/postbackProcessor");
  const pocketRoute = await import("../../src/app/api/postbacks/pocket/route");

  let seq = 0;
  async function createLearner() {
    seq += 1;
    const user = await prisma.user.create({
      data: { email: `devact1-${seq}-${Date.now()}@example.invalid`, name: "DEVACT1" },
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

  const account = (userId: number) =>
    prisma.exchangeAccount.findUniqueOrThrow({ where: { userId } });

  /**
   * G4-H5 — the DEVACT-1 claims, addressed to their actual owner.
   *
   * These assertions have always been about `processExchangePostbackPayload`:
   * that it persists no trading balance, that it moves no money without a
   * provider event identity, and that it is idempotent when it has one. They
   * used to reach it through the Pocket receiver's `goal=dep` dispatch, which
   * this wave removed because that path emitted no canonical growth event and
   * was therefore a shadow money path. The claims are unchanged; only the way
   * they reach the processor is.
   */
  const sendDirect = async (input: {
    userId: number;
    clickId: string;
    amount: number;
    externalEventId?: string;
    type?: string;
  }) =>
    processor.processExchangePostbackPayload(
      {
        type: input.type ?? "First Deposit",
        userId: input.userId,
        amount: input.amount,
        currency: "USD",
        click_id: input.clickId,
        ...(input.externalEventId ? { externalEventId: input.externalEventId } : {}),
      } as never,
      new Request("https://ata.invalid/direct", { method: "POST" }),
    );

  /** A header-authenticated Pocket event, exactly as the live route accepts it. */
  const sendPocket = (params: Record<string, string>) => {
    const p = new URLSearchParams(params);
    return pocketRoute.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
      method: "GET",
      headers: { "x-postback-secret": SECRET, "x-forwarded-for": nextIp() },
    }));
  };

  /* ================================================================== */
  /* A. No current trading balance may ever be persisted                */
  /* ================================================================== */

  await check("A1 the account-update builder writes NO balance for any event", () => {
    const cases: Array<[string, string, number]> = [
      ["first_deposit", "deposit", 100],
      ["redeposit", "deposit", 250],
      ["deposit", "deposit", 75],
      ["successful_withdrawal", "withdrawal", 40],
      ["withdrawal", "withdrawal", 40],
      ["balance", "balance", 9999],
      ["registration", "registration", 0],
      ["email_confirmation", "email_confirmation", 0],
    ];
    for (const [normalized, eventType, amount] of cases) {
      const update = processor.buildPostbackAccountUpdate(normalized, eventType, amount) as Record<string, unknown>;
      assert.ok(!("balance" in update), `${normalized}/${eventType} writes balance`);
    }
  });

  await check("A2 the SIMULATED builder writes no balance either", () => {
    for (const t of ["Registration", "Email Confirmation", "First Deposit", "Re-deposit", "Withdrawal"] as const) {
      const update = processor.buildSimulatedPostbackAccountUpdate(t, 500) as Record<string, unknown>;
      assert.ok(!("balance" in update), `${t} writes balance`);
    }
  });

  await check("A3 historical deposit accounting SURVIVES", () => {
    const fd = processor.buildPostbackAccountUpdate("first_deposit", "deposit", 100) as Record<string, unknown>;
    assert.equal(fd.firstDepositConfirmed, true);
    assert.deepEqual(fd.depositAmount, { increment: 100 });
    assert.deepEqual(fd.totalDeposits, { increment: 100 });
    const wd = processor.buildPostbackAccountUpdate("successful_withdrawal", "withdrawal", 40) as Record<string, unknown>;
    assert.deepEqual(wd.totalWithdrawals, { increment: 40 });
  });

  await check("A4 a provider balance event changes no account state at all", () => {
    const update = processor.buildPostbackAccountUpdate("balance", "balance", 12_345) as Record<string, unknown>;
    assert.deepEqual(update, {});
  });

  await check("A5 no executable line in the processor writes ExchangeAccount.balance", () => {
    const source = fs.readFileSync(path.join("src", "lib", "exchange", "postbackProcessor.ts"), "utf8");
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    assert.ok(!/balance:\s*\{/.test(executable), "an increment/decrement of balance survives");
    assert.ok(!/balance:\s*amount/.test(executable), "a direct balance assignment survives");
  });

  /* ================================================================== */
  /* B. No provider event identity => no money movement                 */
  /* ================================================================== */

  await check("B1 the forbidden derived-fingerprint fallback is gone from the route", () => {
    const source = fs.readFileSync(path.join("src", "app", "api", "postbacks", "pocket", "route.ts"), "utf8");
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    assert.ok(!executable.includes("buildFallbackEventId"), "the derived key builder is still used");
  });

  await check("B2 the random-UUID event id fabrication is gone from the processor", () => {
    const source = fs.readFileSync(path.join("src", "lib", "exchange", "postbackProcessor.ts"), "utf8");
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    assert.ok(!/randomUUID/.test(executable), "a fabricated event id survives");
  });

  await check("B3 a deposit with NO provider event id moves no money", async () => {
    const learner = await createLearner();
    const before = await account(learner.userId);
    // G4-H5 — THE LEGACY HEADER PATH NO LONGER DISPATCHES `goal=dep` AT ALL.
    //
    // It used to reach `processExchangePostbackPayload` and move
    // `ExchangeAccount` Float state while emitting no canonical growth event, so
    // a real Pocket deposit could be taken on a path the growth ledger never
    // heard about. `goalToPocketType` now maps only `reg`, and the typed `ow`
    // contract is the sole Pocket first-deposit intake. The refusal is asserted
    // here; every DEVACT-1 claim about the PROCESSOR's own behaviour is asserted
    // directly against the processor below, which is where it always belonged.
    const response = await sendPocket({ clickid: learner.clickId, goal: "dep", sumdep: "150", playerid: "500100" });
    assert.equal(response.status, 400, await response.clone().text());
    assert.equal((await response.clone().json()).error, "UNKNOWN_GOAL");

    const direct = await processor.processExchangePostbackPayload(
      {
        type: "First Deposit", userId: learner.userId, amount: 175, currency: "USD",
        click_id: learner.clickId,
      } as never,
      new Request("https://ata.invalid/direct", { method: "POST" }),
    );
    assert.equal(direct.status, 202);
    const directBody = await direct.json();
    assert.equal(directBody.processed, false);
    assert.equal(directBody.reason, processor.PROVIDER_EVENT_IDENTITY_MISSING);

    const after = await account(learner.userId);
    assert.equal(after.totalDeposits, before.totalDeposits, "totalDeposits moved");
    assert.equal(after.depositAmount, before.depositAmount, "depositAmount moved");
    assert.equal(after.balance, before.balance, "balance moved");
    assert.equal(after.firstDepositConfirmed, before.firstDepositConfirmed);
  });

  await check("B4 the unidentified deposit is still DURABLY RECORDED as evidence", async () => {
    const learner = await createLearner();
    // The receiver refuses `goal=dep` now (G4-H5). The evidence claim belongs to
    // the processor, so it is made there.
    assert.equal(
      (await sendPocket({ clickid: learner.clickId, goal: "dep", sumdep: "220", playerid: "500101" })).status,
      400,
    );
    await sendDirect({ userId: learner.userId, clickId: learner.clickId, amount: 220 });
    const acct = await account(learner.userId);
    const events = await prisma.postbackEvent.findMany({ where: { exchangeAccountId: acct.id } });
    assert.equal(events.length, 1);
    assert.equal(events[0].status, "not_processed");
    assert.equal(events[0].rejectionReason, processor.PROVIDER_EVENT_IDENTITY_MISSING);
    assert.equal(events[0].externalEventId, null, "an identifier was fabricated");
    assert.equal(events[0].amount, 220, "the historical amount is still evidence");
    assert.equal(events[0].processedAt, null);
  });

  await check("B5 repeated unidentified deposits never accumulate a total", async () => {
    const learner = await createLearner();
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        (await sendPocket({ clickid: learner.clickId, goal: "dep", sumdep: "100", playerid: "500102" })).status,
        400,
        "the receiver must refuse the legacy deposit goal",
      );
      await sendDirect({ userId: learner.userId, clickId: learner.clickId, amount: 100 });
    }
    const acct = await account(learner.userId);
    assert.equal(acct.totalDeposits, 0);
    assert.equal(acct.depositAmount, 0);
    assert.equal(acct.balance, 0);
    const events = await prisma.postbackEvent.count({ where: { exchangeAccountId: acct.id } });
    assert.equal(events, 5, "every delivery is still recorded");
  });

  await check("B6 unidentified deposits never mark the first deposit confirmed", async () => {
    const learner = await createLearner();
    await sendPocket({ clickid: learner.clickId, goal: "ftd", sumdep: "500", playerid: "500103" });
    const acct = await account(learner.userId);
    assert.equal(acct.firstDepositConfirmed, false);
  });

  /* ================================================================== */
  /* C. With a provider identity, idempotency works                      */
  /* ================================================================== */

  await check("C1 an identified deposit IS processed and moves historical totals", async () => {
    const learner = await createLearner();
    const response = await sendDirect({
      userId: learner.userId, clickId: learner.clickId, amount: 120,
      externalEventId: "pocket-txn-devact1-0001",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const acct = await account(learner.userId);
    assert.equal(acct.totalDeposits, 120);
    assert.equal(acct.depositAmount, 120);
    assert.equal(acct.balance, 0, "a current balance was persisted");
  });

  await check("C2 a duplicate delivery of the same event is IDEMPOTENT", async () => {
    const learner = await createLearner();
    const params = {
      userId: learner.userId, clickId: learner.clickId, amount: 300,
      externalEventId: "pocket-txn-devact1-0002",
    };
    await sendDirect(params);
    await sendDirect(params);
    await sendDirect(params);
    const acct = await account(learner.userId);
    assert.equal(acct.totalDeposits, 300, "a duplicate was counted twice");
    const events = await prisma.postbackEvent.count({
      where: { exchangeAccountId: acct.id, externalEventId: "pocket-txn-devact1-0002" },
    });
    assert.equal(events, 1);
  });

  await check("C3 two SAME-AMOUNT deposits with distinct ids stay independent", async () => {
    // The precise case the removed fingerprint key destroyed: identical amount,
    // identical learner, identical type — distinguished only by the provider's
    // own transaction id.
    const learner = await createLearner();
    const base = { userId: learner.userId, clickId: learner.clickId, amount: 250 };
    await sendDirect({ ...base, externalEventId: "pocket-txn-devact1-0003-a" });
    await sendDirect({ ...base, externalEventId: "pocket-txn-devact1-0003-b" });
    const acct = await account(learner.userId);
    assert.equal(acct.totalDeposits, 500, "two distinct same-amount deposits were merged");
    assert.equal(await prisma.postbackEvent.count({ where: { exchangeAccountId: acct.id } }), 2);
  });

  await check("C4 concurrent duplicate deliveries are database-safe", async () => {
    const learner = await createLearner();
    const params = {
      userId: learner.userId, clickId: learner.clickId, amount: 410,
      externalEventId: "pocket-txn-devact1-0004",
    };
    await Promise.all([sendDirect(params), sendDirect(params), sendDirect(params), sendDirect(params)]);
    const acct = await account(learner.userId);
    assert.equal(acct.totalDeposits, 410, "a concurrent duplicate double-counted");
    assert.equal(
      await prisma.postbackEvent.count({ where: { externalEventId: "pocket-txn-devact1-0004" } }),
      1,
    );
  });

  // POCKET-REG-INGRESS-1 — updated to the post-G4 contract. This case used to
  // prove "an identified `ftd` deposit moves the legacy money state but never a
  // balance". G4 removed `ftd` (and every legacy financial alias) from the
  // Pocket receiver outright — the typed `ow` contract is the sole first-deposit
  // intake — so the honest post-G4 statement is stronger: the delivery is
  // refused entirely, and NOTHING moves. Not the balance, not the legacy
  // first-deposit marker, not the totals.
  await check("C5 a legacy ftd delivery is refused and moves nothing", async () => {
    const learner = await createLearner();
    const response = await sendPocket({
      clickid: learner.clickId, goal: "ftd", sumdep: "900", playerid: "500204",
      transaction_id: "pocket-txn-devact1-0005",
    });
    assert.equal(response.status, 400, "ftd has no post-G4 mandate");
    const acct = await account(learner.userId);
    assert.equal(acct.balance, 0);
    assert.equal(acct.firstDepositConfirmed, false, "a refused goal must not move legacy state");
    assert.equal(acct.totalDeposits, 0);
  });

  /* ================================================================== */
  /* D. Deposits may not touch identity, L4 or XP                        */
  /* ================================================================== */

  await check("D1 no deposit — identified or not — creates or changes an identity", async () => {
    const learner = await createLearner();
    const before = await prisma.pocketTraderIdentity.count();
    assert.equal(
      (await sendPocket({ clickid: learner.clickId, goal: "dep", sumdep: "100", playerid: "500300" })).status,
      400,
    );
    await sendPocket({ clickid: learner.clickId, goal: "ftd", sumdep: "100", playerid: "500301", transaction_id: "pocket-txn-devact1-0006" });
    await sendPocket({ clickid: learner.clickId, goal: "redep", sumdep: "100", playerid: "500302", transaction_id: "pocket-txn-devact1-0007" });
    assert.equal(await prisma.pocketTraderIdentity.count(), before, "a deposit bound an identity");
  });

  await check("D2 no deposit creates a verification attempt, XP or L4 completion", async () => {
    const learner = await createLearner();
    await sendPocket({ clickid: learner.clickId, goal: "ftd", sumdep: "5000", playerid: "500303", transaction_id: "pocket-txn-devact1-0008" });
    assert.equal(await prisma.checkpointVerificationAttempt.count(), 0);
    assert.equal(await prisma.xPTransaction.count(), 0);
    const progress = await prisma.userLevelProgress.count({ where: { status: "completed" } });
    assert.equal(progress, 0);
    void learner;
  });

  /* ================================================================== */
  /* E. Registration must keep working                                   */
  /* ================================================================== */

  await check("E1 direct registration still binds exactly one identity", async () => {
    const learner = await createLearner();
    const p = new URLSearchParams({ clickid: learner.clickId, goal: "reg", ow: SECRET, playerid: "600400" });
    const r = await pocketRoute.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
      method: "GET", headers: { "x-forwarded-for": nextIp() },
    }));
    assert.equal(r.status, 200, await r.clone().text());
    const rows = await prisma.pocketTraderIdentity.findMany({ where: { userId: learner.userId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pocketUserId, "600400");
  });

  await check("E2 duplicate registration is idempotent; a conflict never overwrites", async () => {
    const learner = await createLearner();
    const send = (playerId: string) => {
      const p = new URLSearchParams({ clickid: learner.clickId, goal: "reg", ow: SECRET, playerid: playerId });
      return pocketRoute.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
        method: "GET", headers: { "x-forwarded-for": nextIp() },
      }));
    };
    assert.equal((await send("600401")).status, 200);
    assert.equal((await send("600401")).status, 200);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);

    // A conflicting playerid must not rebind the learner.
    await send("600499");
    const row = await prisma.pocketTraderIdentity.findUniqueOrThrow({ where: { userId: learner.userId } });
    assert.equal(row.pocketUserId, "600401", "a conflicting registration overwrote the identity");
  });

  await check("E3 direct registration records product state and no balance", async () => {
    const learner = await createLearner();
    const p = new URLSearchParams({ clickid: learner.clickId, goal: "reg", ow: SECRET, playerid: "600402" });
    const r = await pocketRoute.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
      method: "GET", headers: { "x-forwarded-for": nextIp() },
    }));
    assert.equal(r.status, 200);
    const acct = await account(learner.userId);
    assert.equal(acct.registrationStatus, true);
    assert.equal(acct.balance, 0);
  });

  await check("E4 the monetary classifier is correct in both directions", () => {
    const m = processor.isMonetaryPostbackEvent;
    assert.equal(m("first_deposit", "deposit", 0), true);
    assert.equal(m("redeposit", "deposit", 0), true);
    assert.equal(m("successful_withdrawal", "withdrawal", 0), true);
    assert.equal(m("other", "deposit", 10), true);
    assert.equal(m("other", "withdrawal", 10), true);
    assert.equal(m("other", "deposit", 0), false);
    assert.equal(m("registration", "registration", 0), false);
    assert.equal(m("email_confirmation", "email_confirmation", 0), false);
  });

  await check("E5 the whole database holds no non-zero balance", async () => {
    const withBalance = await prisma.exchangeAccount.count({ where: { NOT: { balance: 0 } } });
    assert.equal(withBalance, 0, "an account carries a current balance");
  });

  console.log(`\nDEVACT-1 pocket deposit events: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
