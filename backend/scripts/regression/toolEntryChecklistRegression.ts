/**
 * TOOLS-V2 — Entry Checklist persistence, against a real SQLite database.
 *
 * SELF-CONTAINED AND ISOLATED. It creates its own empty database in a fresh
 * temporary directory, applies EVERY migration with the production runner, and
 * never reads DATABASE_URL from the environment.
 *
 * What it proves:
 *   - the tool opens with L20 durably completed and not a level before;
 *   - a check is kept with the server's own verdict: a stop factor wins over
 *     any other gap, all nine confirmed allows the entry;
 *   - the newest checks come back newest first, twenty at most, and the
 *     minimum payout the learner last used comes back with them;
 *   - another learner sees none of it;
 *   - the table refuses states the service never writes (raw SQL), including a
 *     verdict that contradicts its answers;
 *   - deleting a learner deletes their checks.
 *
 *   npx tsx scripts/regression/toolEntryChecklistRegression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-tool-check-"));
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

function cleanupScratch() {
  if (scratchDir.startsWith(os.tmpdir()) && path.basename(scratchDir).startsWith("ata-tool-check-")) {
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
  const service = await import("@/lib/tools/entry-checklist-service");
  const { CHECKLIST_ITEMS, parseEntryCheck } = await import("@/lib/tools/entry-checklist");
  const { isToolUnlockedForUser } = await import("@/lib/tools/access");
  const { EXPECTED_MIGRATION_COUNT } = await import("./support/migrationCount");

  const all = Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.code, true])) as Record<string, boolean>;
  const input = (overrides: Record<string, unknown> = {}, missing: string[] = []) =>
    parseEntryCheck({
      asset: "EURUSD_OTC",
      minPayoutPercent: 85,
      answers: { ...all, ...Object.fromEntries(missing.map((code) => [code, false])) },
      ...overrides,
    });

  /* A published ata-v2 graph with twenty levels; the learners complete levels by row. */
  const version = await db.curriculumVersion.create({
    data: { code: "ata-v2", name: "check", versionNumber: 1, status: "published", publishedAt: new Date(), effectiveFrom: new Date() },
  });
  const moduleDefinition = await db.moduleDefinition.create({
    data: { curriculumVersionId: version.id, moduleNumber: 1, code: "m1", title: "M", firstLevel: 1, lastLevel: 20, learningObjective: "L" },
  });
  const levels: { id: number; levelNumber: number }[] = [];
  for (let n = 1; n <= 20; n += 1) {
    levels.push(
      await db.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleDefinition.id,
          levelNumber: n,
          stableCode: `v2.l${String(n).padStart(3, "0")}.check`,
          type: "lesson",
          title: `Level ${n}`,
          learningObjective: "L",
          completionMethod: "manual",
          requiredPreviousLevel: n === 1 ? null : n - 1,
          status: "active",
        },
      }),
    );
  }
  async function learner(email: string, completedThrough: number) {
    const user = await db.user.create({ data: { email, name: email, role: "user", passwordHash: "x" } });
    const enrollment = await db.userCurriculumEnrollment.create({
      data: {
        userId: user.id,
        curriculumVersionId: version.id,
        curriculumCode: "ata-v2",
        status: "active",
        enrolledAt: new Date(),
        currentLevel: completedThrough + 1,
        highestCompletedLevel: completedThrough,
      },
    });
    for (const level of levels.filter((candidate) => candidate.levelNumber <= completedThrough)) {
      await db.userLevelProgress.create({
        data: { enrollmentId: enrollment.id, curriculumVersionId: version.id, levelDefinitionId: level.id, status: "completed", startedAt: new Date(), completedAt: new Date() },
      });
    }
    return { user, enrollment };
  }

  const alice = await learner("check-alice@example.invalid", 19);
  const bob = await learner("check-bob@example.invalid", 20);

  try {
    await check("every migration applied, the Entry Checklist one among them", async () => {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      assert.equal(rows.length, EXPECTED_MIGRATION_COUNT);
      assert.ok(rows.some((row) => row.migration_name === "20260921220000_tool_entry_check"));
    });

    await check("the tool opens with L20 durably completed, and not a level before", async () => {
      assert.equal(await isToolUnlockedForUser(alice.user.id, "tool.entry_checklist", db), false);
      assert.equal(await isToolUnlockedForUser(bob.user.id, "tool.entry_checklist", db), true);
    });

    await check("a learner starts with no checks and no minimum", async () => {
      const state = await service.readEntryChecks(bob.user.id, db);
      assert.deepEqual(state.recent, []);
      assert.equal(state.lastMinPayoutPercent, null);
    });

    await check("all nine confirmed: the entry is allowed", async () => {
      const row = await service.createEntryCheck(bob.user.id, input(), db);
      assert.equal(row.verdict, "enter");
      assert.equal(row.missingItem, null);
      assert.equal(row.answers, "111111111");
      assert.equal(row.listVersion, 1);
    });

    await check("a stop factor wins over an earlier ordinary gap", async () => {
      const row = await service.createEntryCheck(bob.user.id, input({}, ["payout_minimum", "no_revenge"]), db);
      assert.equal(row.verdict, "skip_stop");
      assert.equal(row.missingItem, "no_revenge");
      assert.equal(row.answers, "110111101");
    });

    await check("an ordinary gap alone says «условие не выполнено», naming the first", async () => {
      const row = await service.createEntryCheck(bob.user.id, input({ minPayoutPercent: null }, ["attention", "price_at_zone"]), db);
      assert.equal(row.verdict, "skip_condition");
      assert.equal(row.missingItem, "price_at_zone");
    });

    await check("the newest checks come back newest first, with the last minimum used", async () => {
      const state = await service.readEntryChecks(bob.user.id, db);
      assert.deepEqual(
        state.recent.map((row) => row.verdict),
        ["skip_condition", "skip_stop", "enter"],
      );
      // The newest check had no minimum; the one before it did.
      assert.equal(state.lastMinPayoutPercent, 85);
    });

    await check("twenty at most", async () => {
      for (let n = 0; n < 20; n += 1) await service.createEntryCheck(bob.user.id, input({ minPayoutPercent: 80 }), db);
      const state = await service.readEntryChecks(bob.user.id, db);
      assert.equal(state.recent.length, 20);
      assert.equal(state.lastMinPayoutPercent, 80);
      assert.equal(await db.toolEntryCheck.count({ where: { userId: bob.user.id } }), 23);
    });

    await check("another learner sees none of it", async () => {
      await db.userLevelProgress.create({
        data: {
          enrollmentId: alice.enrollment.id,
          curriculumVersionId: version.id,
          levelDefinitionId: levels[19]!.id,
          status: "completed",
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      const state = await service.readEntryChecks(alice.user.id, db);
      assert.deepEqual(state.recent, []);
      assert.equal(state.lastMinPayoutPercent, null);
    });

    await check("the table refuses states the service never writes (raw SQL)", async () => {
      const insert = (answers: string, verdict: string, missing: string | null, minPayout: unknown = null, listVersion = 1) =>
        db.$executeRawUnsafe(
          `INSERT INTO "ToolEntryCheck" ("id","userId","assetCode","minPayoutPercent","listVersion","answers","verdict","missingItem","createdAt") VALUES (?,?,?,?,?,?,?,?,?)`,
          `raw${Math.random().toString(36).slice(2, 12)}`,
          bob.user.id,
          "EURUSD_OTC",
          minPayout,
          listVersion,
          answers,
          verdict,
          missing,
          Date.now(),
        );
      await assert.rejects(insert("11111111", "skip_stop", "no_news"), "eight answers");
      await assert.rejects(insert("11111111x", "skip_stop", "no_news"), "an answer that is not 0 or 1");
      await assert.rejects(insert("111111111", "skip_stop", "no_news"), "a refusal with every item confirmed");
      await assert.rejects(insert("011111111", "enter", null), "an entry with an item open");
      await assert.rejects(insert("011111111", "skip_stop", null), "a refusal that names nothing");
      await assert.rejects(insert("111111111", "enter", "no_news"), "an entry that names an item");
      await assert.rejects(insert("011111111", "maybe", "no_news"), "an unknown verdict");
      await assert.rejects(insert("011111111", "skip_stop", "No News!"), "an item code out of shape");
      await assert.rejects(insert("111111111", "enter", null, 0), "a minimum payout of nothing");
      await assert.rejects(insert("111111111", "enter", null, null, 2), "an item list that does not exist");
      assert.equal(await insert("011111111", "skip_stop", "no_news"), 1);
    });

    await check("deleting a learner deletes their checks", async () => {
      // No enrollment, so nothing but the checks hold the user row.
      const carol = await db.user.create({ data: { email: "check-carol@example.invalid", name: "c", role: "user", passwordHash: "x" } });
      await service.createEntryCheck(carol.id, input(), db);
      assert.equal(await db.toolEntryCheck.count({ where: { userId: carol.id } }), 1);
      await db.user.delete({ where: { id: carol.id } });
      assert.equal(await db.toolEntryCheck.count({ where: { userId: carol.id } }), 0);
    });
  } finally {
    await db.$disconnect();
    cleanupScratch();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanupScratch();
  process.exitCode = 1;
});
