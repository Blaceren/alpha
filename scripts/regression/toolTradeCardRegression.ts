/**
 * TOOLS-V2 — Trade Card persistence, against a real SQLite database.
 *
 * SELF-CONTAINED AND ISOLATED. It creates its own empty database in a fresh
 * temporary directory, applies EVERY migration with the production runner
 * (`prisma/migrate.ts`), and never reads DATABASE_URL from the environment —
 * so it cannot touch a live database however it is invoked.
 *
 * What it proves:
 *   - the migration applies cleanly on top of the whole chain;
 *   - one open card per learner is enforced by the database;
 *   - a learner can never read or change another learner's card;
 *   - the state machine (fixed → saved | cancelled) holds in the service AND in
 *     the table's CHECK constraints, including for raw SQL writers;
 *   - timestamps are stored as integer epoch milliseconds;
 *   - deleting a learner deletes their cards.
 *
 *   npx tsx scripts/regression/toolTradeCardRegression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-tool-trade-card-"));
const dbUrl = `file:${path.join(scratchDir, "regression.sqlite")}`;
process.env.DATABASE_URL = dbUrl;

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

/**
 * The handler is attached synchronously, in the same tick the promise is handed
 * over: awaiting anything first would leave the rejection unhandled for a moment,
 * and Node treats that as a crash rather than a failed check.
 */
function expectToolError(promise: Promise<unknown>, code: string) {
  return assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof Error && error.name === "ToolError" && (error as { code?: unknown }).code === code,
  );
}

function cleanupScratch() {
  // Only ever the directory this script created, and only inside the OS temp dir.
  if (scratchDir.startsWith(os.tmpdir()) && path.basename(scratchDir).startsWith("ata-tool-trade-card-")) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

async function main() {
  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `migrate failed: ${migrate.stderr}`);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const service = await import("@/lib/tools/trade-card-service");
  const { parseTradeCardPlan } = await import("@/lib/tools/trade-card");
  const { EXPECTED_MIGRATION_COUNT } = await import("./support/migrationCount");

  const plan = parseTradeCardPlan({
    asset: "EURUSD_OTC",
    direction: "up",
    amount: "8",
    payoutPercent: 90,
    expiry: "M3",
    entryTime: "14:32",
    reason: "Отскок от уровня, отмеченного до сессии",
  });

  const alice = await db.user.create({
    data: { email: "tool-trade-card-alice@example.invalid", name: "Alice", role: "user", passwordHash: "x" },
  });
  const bob = await db.user.create({
    data: { email: "tool-trade-card-bob@example.invalid", name: "Bob", role: "user", passwordHash: "x" },
  });

  try {
    await check("every migration applied, the Trade Card one last", async () => {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      assert.equal(rows.length, EXPECTED_MIGRATION_COUNT);
      assert.equal(rows.at(-1)?.migration_name, "20260921120000_tool_trade_card");
    });

    let aliceCardId = "";

    await check("fixing a plan creates the learner's open card", async () => {
      const card = await service.createTradeCard(alice.id, plan, db);
      aliceCardId = card.id;
      assert.equal(card.status, "fixed");
      assert.equal(card.amountMinor, 800);
      assert.equal(card.planRevisionCount, 0);
      const open = await service.getOpenTradeCard(alice.id, db);
      assert.equal(open?.id, card.id);
    });

    await check("timestamps are stored as integer epoch milliseconds", async () => {
      const rows = await db.$queryRaw<{ f: string; c: string; u: string }[]>`
        SELECT typeof("fixedAt") AS f, typeof("createdAt") AS c, typeof("updatedAt") AS u
        FROM "ToolTradeCard" WHERE "id" = ${aliceCardId}`;
      assert.deepEqual(rows[0], { f: "integer", c: "integer", u: "integer" });
    });

    await check("a second open card for the same learner is refused", async () => {
      await expectToolError(service.createTradeCard(alice.id, plan, db), "TRADE_CARD_OPEN_EXISTS");
    });

    await check("another learner can neither see nor change the card", async () => {
      assert.equal(await service.getOpenTradeCard(bob.id, db), null);
      await expectToolError(service.refixTradeCard(bob.id, aliceCardId, plan, db), "TRADE_CARD_NOT_FOUND");
      await expectToolError(
        service.saveTradeCard(bob.id, aliceCardId, { result: "profit", observation: null }, db),
        "TRADE_CARD_NOT_FOUND",
      );
      await expectToolError(service.cancelTradeCard(bob.id, aliceCardId, db), "TRADE_CARD_NOT_FOUND");
      const untouched = await db.toolTradeCard.findUniqueOrThrow({ where: { id: aliceCardId } });
      assert.equal(untouched.status, "fixed");
    });

    await check("re-fixing replaces the plan and counts the revision", async () => {
      const card = await service.refixTradeCard(alice.id, aliceCardId, { ...plan, direction: "down" }, db);
      assert.equal(card.direction, "down");
      assert.equal(card.planRevisionCount, 1);
    });

    await check("saving records the result and is terminal", async () => {
      const card = await service.saveTradeCard(alice.id, aliceCardId, { result: "profit", observation: "урок" }, db);
      assert.equal(card.status, "saved");
      assert.equal(card.result, "profit");
      assert.equal(card.observation, "урок");
      assert.ok(card.savedAt instanceof Date);
      await expectToolError(
        service.saveTradeCard(alice.id, aliceCardId, { result: "loss", observation: null }, db),
        "TRADE_CARD_STATE_CONFLICT",
      );
      await expectToolError(service.refixTradeCard(alice.id, aliceCardId, plan, db), "TRADE_CARD_STATE_CONFLICT");
      await expectToolError(service.cancelTradeCard(alice.id, aliceCardId, db), "TRADE_CARD_STATE_CONFLICT");
      assert.equal(await service.getOpenTradeCard(alice.id, db), null);
    });

    await check("after saving, a new card can be fixed and then cancelled", async () => {
      const card = await service.createTradeCard(alice.id, plan, db);
      const cancelled = await service.cancelTradeCard(alice.id, card.id, db);
      assert.equal(cancelled.status, "cancelled");
      assert.ok(cancelled.cancelledAt instanceof Date);
      assert.equal(cancelled.result, null);
      await expectToolError(service.cancelTradeCard(alice.id, card.id, db), "TRADE_CARD_STATE_CONFLICT");
      assert.equal(await db.toolTradeCard.count({ where: { userId: alice.id } }), 2);
    });

    await check("the table refuses states the service never writes (raw SQL)", async () => {
      const now = Date.now();
      const insert = (status: string, extra: string) =>
        db.$executeRawUnsafe(
          `INSERT INTO "ToolTradeCard" ("id","userId","status","assetCode","direction","amountMinor","payoutPercent",
             "expiryCode","entryTime","reason","fixedAt","updatedAt"${extra ? "," + extra.split("=")[0] : ""})
           VALUES ('raw-${status}-${now}', ${bob.id}, '${status}', 'EURUSD_OTC', 'up', 800, 90, 'M3', '14:32',
             'reason', ${now}, ${now}${extra ? "," + extra.split("=")[1] : ""})`,
        );
      await assert.rejects(insert("draft", ""), /CHECK constraint failed/);
      await assert.rejects(insert("saved", ""), /CHECK constraint failed/);
      await assert.rejects(insert("fixed", `"result"='profit'`), /CHECK constraint failed/);
      await assert.rejects(insert("fixed", `"cancelledAt"=${now}`), /CHECK constraint failed/);
      await assert.rejects(
        db.$executeRawUnsafe(
          `INSERT INTO "ToolTradeCard" ("id","userId","status","assetCode","direction","amountMinor","payoutPercent",
             "expiryCode","entryTime","reason","fixedAt","updatedAt")
           VALUES ('raw-text-ts', ${bob.id}, 'fixed', 'EURUSD_OTC', 'up', 800, 90, 'M3', '14:32', 'reason',
             '2026-09-21 14:32:00', ${now})`,
        ),
        /CHECK constraint failed/,
      );
      await assert.rejects(
        db.$executeRawUnsafe(
          `INSERT INTO "ToolTradeCard" ("id","userId","status","assetCode","direction","amountMinor","payoutPercent",
             "expiryCode","entryTime","reason","fixedAt","updatedAt")
           VALUES ('raw-bad-time', ${bob.id}, 'fixed', 'EURUSD_OTC', 'up', 800, 90, 'M3', '9:30', 'reason', ${now}, ${now})`,
        ),
        /CHECK constraint failed/,
      );
      assert.equal(await db.toolTradeCard.count({ where: { userId: bob.id } }), 0);
    });

    await check("deleting a learner deletes their cards", async () => {
      await service.createTradeCard(bob.id, plan, db);
      assert.equal(await db.toolTradeCard.count({ where: { userId: bob.id } }), 1);
      await db.user.delete({ where: { id: bob.id } });
      assert.equal(await db.toolTradeCard.count({ where: { userId: bob.id } }), 0);
    });
  } finally {
    await db.$disconnect();
  }
}

main()
  .catch((error) => {
    failed += 1;
    console.error(error);
  })
  .finally(() => {
    cleanupScratch();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
