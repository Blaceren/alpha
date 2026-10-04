/**
 * TOOLS-V2 — Personal Stats, against a real SQLite database.
 *
 * SELF-CONTAINED AND ISOLATED. It creates its own empty database in a fresh
 * temporary directory, applies EVERY migration with the production runner, and
 * never reads DATABASE_URL from the environment.
 *
 * What it proves:
 *   - the tool opens with L25 durably completed and not a level before;
 *   - the figures come from the learner's own journal entries and marked rules;
 *   - 7 and 30 days are the learner's own calendar days, both ends included;
 *   - another learner's journal never counts;
 *   - reading stats writes nothing.
 *
 *   npx tsx scripts/regression/toolPersonalStatsRegression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedLegacyToolUnlocks } from "./support/toolUnlocks";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-tool-stats-"));
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
  if (scratchDir.startsWith(os.tmpdir()) && path.basename(scratchDir).startsWith("ata-tool-stats-")) {
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
  const { readJournalStats } = await import("@/lib/tools/stats-service");
  const { parseStatsQuery } = await import("@/lib/tools/stats");
  const { isToolUnlockedForUser } = await import("@/lib/tools/access");
  const { EXPECTED_MIGRATION_COUNT } = await import("./support/migrationCount");
  const NOW = new Date("2026-09-21T12:00:00.000Z");
  const query = (raw: string) => parseStatsQuery(new URLSearchParams(raw), NOW);

  /* A published ata-v2 graph with twenty-five levels. */
  const version = await db.curriculumVersion.create({
    data: { code: "ata-v2", name: "stats", versionNumber: 1, status: "published", publishedAt: new Date(), effectiveFrom: new Date() },
  });
  const moduleDefinition = await db.moduleDefinition.create({
    data: { curriculumVersionId: version.id, moduleNumber: 1, code: "m1", title: "M", firstLevel: 1, lastLevel: 25, learningObjective: "L" },
  });
  const levels: { id: number; levelNumber: number }[] = [];
  for (let n = 1; n <= 25; n += 1) {
    levels.push(
      await db.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleDefinition.id,
          levelNumber: n,
          stableCode: `v2.l${String(n).padStart(3, "0")}.stats`,
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
  await seedLegacyToolUnlocks(db, version.id, levels);
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
    return user;
  }
  async function entry(userId: number, tradeDate: string, result: "profit" | "loss", planFollowed: boolean | null, codes: string[] = []) {
    await db.toolJournalEntry.create({
      data: {
        userId,
        source: "manual",
        tradeDate,
        entryTime: "12:00",
        assetCode: "EURUSD_OTC",
        direction: "up",
        amountMinor: 800,
        payoutPercent: 90,
        expiryCode: "M3",
        result,
        planFollowed,
        violations: codes.length ? { create: codes.map((code) => ({ code })) } : undefined,
      },
    });
  }

  const early = await learner("stats-early@example.invalid", 24);
  const alice = await learner("stats-alice@example.invalid", 25);
  const bob = await learner("stats-bob@example.invalid", 25);

  // Alice: today 2026-09-21. 7 days = 09-15..09-21, 30 days = 08-23..09-21.
  await entry(alice.id, "2026-09-21", "profit", true);
  await entry(alice.id, "2026-09-15", "loss", false, ["revenge", "amount_above_plan"]);
  await entry(alice.id, "2026-09-14", "profit", true);
  await entry(alice.id, "2026-08-23", "loss", null);
  await entry(alice.id, "2026-08-22", "profit", false, ["revenge"]);
  // Bob's journal must never count for Alice.
  for (let n = 0; n < 5; n += 1) await entry(bob.id, "2026-09-20", "loss", false, ["tired"]);

  try {
    await check("every migration applied", async () => {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      assert.equal(rows.length, EXPECTED_MIGRATION_COUNT);
    });

    await check("the tool opens with L25 durably completed, and not a level before", async () => {
      assert.equal(await isToolUnlockedForUser(early.id, "tool.personal_stats", db), false);
      assert.equal(await isToolUnlockedForUser(alice.id, "tool.personal_stats", db), true);
    });

    await check("all time counts every one of the learner's own entries", async () => {
      const stats = await readJournalStats(alice.id, query("period=all"), db);
      assert.equal(stats.trades, 5);
      assert.equal(stats.wins, 3);
      assert.equal(stats.onPlan, 2);
      assert.equal(stats.unmarked, 1);
      assert.deepEqual(stats.split.broken, { trades: 2, wins: 1, winRateBasisPoints: 5000 });
      assert.deepEqual(
        stats.violations.items.map((item) => [item.code, item.count]),
        [
          ["revenge", 2],
          ["amount_above_plan", 1],
        ],
      );
    });

    await check("7 days are the learner's last seven calendar days, both ends included", async () => {
      const stats = await readJournalStats(alice.id, query("period=7d&today=2026-09-21"), db);
      assert.equal(stats.trades, 2);
      assert.equal(stats.wins, 1);
      assert.equal(stats.violations.total, 2);
    });

    await check("30 days reach back to the thirtieth day and no further", async () => {
      const stats = await readJournalStats(alice.id, query("period=30d&today=2026-09-21"), db);
      assert.equal(stats.trades, 4);
      assert.equal(stats.unmarked, 1);
    });

    await check("another learner's journal never counts", async () => {
      const stats = await readJournalStats(bob.id, query("period=all"), db);
      assert.equal(stats.trades, 5);
      assert.equal(stats.wins, 0);
      assert.deepEqual(stats.violations.items, [{ code: "tired", label: "Усталость или невнимательность", count: 5 }]);
      const alicesAgain = await readJournalStats(alice.id, query("period=all"), db);
      assert.equal(alicesAgain.trades, 5);
    });

    await check("reading stats writes nothing", async () => {
      const before = await db.toolJournalEntry.count();
      const beforeRules = await db.toolJournalViolation.count();
      await readJournalStats(alice.id, query("period=all"), db);
      assert.equal(await db.toolJournalEntry.count(), before);
      assert.equal(await db.toolJournalViolation.count(), beforeRules);
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
