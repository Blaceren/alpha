/**
 * POCKET-REG-SECURITY-CLOSURE-1 (F2/P4) — the ledger verifier must validate the
 * COMPLETE ledger without confusing provenance, and must still catch real
 * divergence.
 *
 * THE DEFECT THIS PINS. `verifyGrowthLedgerProjection` compared the owner
 * tables against `origin='backfill'` rows only. That was true to the ledger it
 * was written for and became wrong the moment the first provider registration
 * was accepted: the owner row existed, the canonical event existed as
 * `origin='runtime'`, and the tool reported a healthy ledger as `missing`.
 *
 * The fix widens the ledger side to every origin. The risk of a widening fix is
 * that it stops detecting things, so this suite asserts BOTH directions:
 *
 *   A. healthy ledger with runtime rows  -> exit 0, no divergence
 *   B. each real defect class            -> still detected, exit 1
 *
 * Synthetic database only, built by migrating a throwaway file and inserting
 * rows directly. No live database, no network, no secrets.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-ledger-verifier-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const VERIFIER = path.join("scripts", "ops", "verifyGrowthLedgerProjection.ts");

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanup() {
  for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
}

function sql(statements: string) {
  const r = spawnSync("sqlite3", [dbPath], { input: statements, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sqlite3 failed: ${r.stderr}`);
  return r.stdout;
}

/** Run the verifier against the fixture and return its exit code + stdout. */
function runVerifier() {
  const r = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), VERIFIER],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function main() {
  cleanup();

  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migrate.status !== 0) throw new Error(`${migrate.stdout}\n${migrate.stderr}`);

  // One learner, one Pocket identity, and its canonical pocket_reg event —
  // emitted as RUNTIME, which is exactly the shape the old tool mis-read.
  const BOUND_AT = 1786697189175;
  sql(`
    INSERT INTO "User" ("id","email","name","status","createdAt","updatedAt")
      VALUES (9001,'ledger-fixture-9001@example.invalid','LEDGER','active',${BOUND_AT},${BOUND_AT});
    INSERT INTO "User" ("id","email","name","status","createdAt","updatedAt")
      VALUES (9003,'ledger-fixture-9003@example.invalid','LEDGER-SPARE','active',${BOUND_AT},${BOUND_AT});
    INSERT INTO "PocketTraderIdentity" ("id","userId","pocketUserId","clickId","source","boundAt","createdAt","updatedAt")
      VALUES (9001,9001,'900100001','tq-00000000-0000-4000-8000-000000000001','registration_postback',${BOUND_AT},${BOUND_AT},${BOUND_AT});
    INSERT INTO "GrowthEvent"
      ("id","eventId","eventType","origin","occurredAt","recordedAt","sourceOwner","sourceEventId",
       "sourceEntityType","sourceEntityId","userId","provider")
      VALUES (9001,'evtledger9001aaaaaaaaaaaaaaaaaaa','pocket_reg','runtime',${BOUND_AT},${BOUND_AT},
              'pocket_identity_binding','pocket:player:900100001','PocketTraderIdentity','9001',9001,'pocket');
    INSERT INTO "GrowthEventOutbox" ("id","growthEventId","eventType","status","createdAt","availableAt")
      VALUES (9001,9001,'pocket_reg','pending',${BOUND_AT},${BOUND_AT});
  `);

  /* ---------------- A. the healthy case the old tool failed ---------------- */

  check("A1 a runtime event satisfies its owner row — no false missing", () => {
    const { status, out } = runVerifier();
    assert.match(out, /OK\s+pocket_reg/, "pocket_reg must reconcile");
    assert.doesNotMatch(out, /MISSING\s+pocket:player:900100001/, "runtime event reported missing");
    assert.equal(status, 0, `expected exit 0, got ${status}`);
  });

  check("A2 provenance is preserved in the report, not collapsed", () => {
    const { out } = runVerifier();
    assert.match(out, /pocket_reg.*\[backfill=0 runtime=1\]/, "origin breakdown must be printed");
  });

  /* ---------------- B. every real defect class still detected -------------- */

  check("B1 DIVERGENT: a runtime event whose occurredAt drifts is caught", () => {
    sql(`UPDATE "GrowthEvent" SET "occurredAt" = ${BOUND_AT + 60000} WHERE "id" = 9001;`);
    const { status, out } = runVerifier();
    assert.match(out, /DIVERGENT pocket:player:900100001 column=occurredAt/, "drift not detected");
    assert.equal(status, 1, "a divergent runtime event must fail the run");
    sql(`UPDATE "GrowthEvent" SET "occurredAt" = ${BOUND_AT} WHERE "id" = 9001;`);
  });

  // NULL is not usable here: the ledger's own CHECK constraint already forbids a
  // null userId on every family except `traffic_click`, so the drift is modelled
  // as the more realistic one — the event pointing at the WRONG learner.
  check("B2 DIVERGENT: a runtime event pointing at the wrong learner is caught", () => {
    sql(`UPDATE "GrowthEvent" SET "userId" = 9003 WHERE "id" = 9001;`);
    const { status, out } = runVerifier();
    assert.match(out, /DIVERGENT pocket:player:900100001 column=userId/, "userId drift not detected");
    assert.equal(status, 1);
    sql(`UPDATE "GrowthEvent" SET "userId" = 9001 WHERE "id" = 9001;`);
  });

  check("B3 MISSING: an owner row with no event at all is still caught", () => {
    sql(`DELETE FROM "GrowthEventOutbox" WHERE "growthEventId" = 9001;
         DELETE FROM "GrowthEvent" WHERE "id" = 9001;`);
    const { status, out } = runVerifier();
    assert.match(out, /MISSING   pocket:player:900100001/, "genuinely missing event not detected");
    assert.equal(status, 1);
    sql(`
      INSERT INTO "GrowthEvent"
        ("id","eventId","eventType","origin","occurredAt","recordedAt","sourceOwner","sourceEventId",
         "sourceEntityType","sourceEntityId","userId","provider")
        VALUES (9001,'evtledger9001aaaaaaaaaaaaaaaaaaa','pocket_reg','runtime',${BOUND_AT},${BOUND_AT},
                'pocket_identity_binding','pocket:player:900100001','PocketTraderIdentity','9001',9001,'pocket');
      INSERT INTO "GrowthEventOutbox" ("id","growthEventId","eventType","status","createdAt","availableAt")
        VALUES (9001,9001,'pocket_reg','pending',${BOUND_AT},${BOUND_AT});
    `);
  });

  check("B4 ORPHANED: a runtime event with no owner row is caught", () => {
    sql(`DELETE FROM "PocketTraderIdentity" WHERE "id" = 9001;`);
    const { status, out } = runVerifier();
    assert.match(out, /ORPHANED  pocket:player:900100001/, "orphaned runtime event not detected");
    assert.equal(status, 1);
    sql(`INSERT INTO "PocketTraderIdentity" ("id","userId","pocketUserId","clickId","source","boundAt","createdAt","updatedAt")
         VALUES (9001,9001,'900100001','tq-00000000-0000-4000-8000-000000000001','registration_postback',${BOUND_AT},${BOUND_AT},${BOUND_AT});`);
  });

  check("B5 outbox coverage: an event with no outbox row is caught", () => {
    sql(`DELETE FROM "GrowthEventOutbox" WHERE "growthEventId" = 9001;`);
    const { status, out } = runVerifier();
    assert.match(out, /FAIL outbox coverage/, "missing outbox row not detected");
    assert.equal(status, 1);
    sql(`INSERT INTO "GrowthEventOutbox" ("id","growthEventId","eventType","status","createdAt","availableAt")
         VALUES (9001,9001,'pocket_reg','pending',${BOUND_AT},${BOUND_AT});`);
  });

  check("B6 backfill reconciliation still works alongside runtime rows", () => {
    // A second identity whose event is BACKFILLED. Both origins must reconcile
    // in the same run, and the report must show one of each.
    sql(`
      INSERT INTO "User" ("id","email","name","status","createdAt","updatedAt")
        VALUES (9002,'ledger-fixture-9002@example.invalid','LEDGER2','active',${BOUND_AT},${BOUND_AT});
      INSERT INTO "PocketTraderIdentity" ("id","userId","pocketUserId","clickId","source","boundAt","createdAt","updatedAt")
        VALUES (9002,9002,'900100002','tq-00000000-0000-4000-8000-000000000002','registration_postback',${BOUND_AT},${BOUND_AT},${BOUND_AT});
      INSERT INTO "GrowthEvent"
        ("id","eventId","eventType","origin","occurredAt","recordedAt","sourceOwner","sourceEventId",
         "sourceEntityType","sourceEntityId","userId","provider")
        VALUES (9002,'evtledger9002aaaaaaaaaaaaaaaaaaa','pocket_reg','backfill',${BOUND_AT},${BOUND_AT},
                'pocket_identity_binding','pocket:player:900100002','PocketTraderIdentity','9002',9002,'pocket');
      INSERT INTO "GrowthEventOutbox" ("id","growthEventId","eventType","status","createdAt","availableAt")
        VALUES (9002,9002,'pocket_reg','pending',${BOUND_AT},${BOUND_AT});
    `);
    const { status, out } = runVerifier();
    assert.match(out, /OK\s+pocket_reg.*\[backfill=1 runtime=1\]/, "mixed-origin reconciliation failed");
    assert.equal(status, 0, "a healthy mixed-origin ledger must pass");
  });

  console.log(`\nGrowth ledger verifier regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cleanup();
}
