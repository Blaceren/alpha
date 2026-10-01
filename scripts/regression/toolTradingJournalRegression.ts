/**
 * TOOLS-V2 — Trading Journal persistence, against a real SQLite database.
 *
 * SELF-CONTAINED AND ISOLATED. It creates its own empty database in a fresh
 * temporary directory, applies EVERY migration with the production runner, and
 * never reads DATABASE_URL from the environment.
 *
 * What it proves:
 *   - «только новые»: a card saved while the journal is locked never arrives;
 *     a card saved after L10 is completed becomes exactly one entry, in the SAME
 *     transaction as the save (a failed entry rolls the save back);
 *   - the entry carries the card's trade, its reason as the plan and its
 *     observation as the conclusion, dated by the learner's own calendar;
 *   - a hand-recorded entry, its review and broken rules;
 *   - any entry is replaced whole (owner, 2026-10-01): an entry made from a
 *     card too — the entry changes, the card never does, and the entry stays
 *     that card's entry;
 *   - an entry is deleted with its rules and nothing else: the card it came
 *     from stays saved, the counts are those after the delete, a second delete
 *     and another learner's delete are «not found»;
 *   - filters, counts and pages, and a cursor is only ever the learner's own;
 *   - another learner can neither see nor change an entry;
 *   - the tables refuse states the service never writes (raw SQL);
 *   - deleting a learner deletes their journal.
 *
 *   npx tsx scripts/regression/toolTradingJournalRegression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-tool-journal-"));
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

/** Handler attached in the same tick: an unhandled rejection would crash the run. */
function expectToolError(promise: Promise<unknown>, code: string, detail?: string) {
  return assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ToolError" &&
      (error as { code?: unknown }).code === code &&
      (detail === undefined || (error as { detail?: unknown }).detail === detail),
  );
}

function cleanupScratch() {
  if (scratchDir.startsWith(os.tmpdir()) && path.basename(scratchDir).startsWith("ata-tool-journal-")) {
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
  const cards = await import("@/lib/tools/trade-card-service");
  const journal = await import("@/lib/tools/journal-service");
  const { parseTradeCardPlan } = await import("@/lib/tools/trade-card");
  const { parseJournalManualEntry, parseJournalChange, toJournalEntryDto } = await import("@/lib/tools/journal");
  const { isToolUnlockedForUser } = await import("@/lib/tools/access");
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
  const manual = (overrides: Record<string, unknown> = {}) =>
    parseJournalManualEntry(
      {
        tradeDate: "2026-09-20",
        entryTime: "10:15",
        asset: "GBPUSD_OTC",
        direction: "down",
        amount: "16",
        payoutPercent: 85,
        expiry: "M1",
        result: "loss",
        plan: null,
        ...overrides,
      },
      new Date("2026-09-21T12:00:00.000Z"),
    );

  /* A published ata-v2 graph with twelve levels; the learners complete levels by row. */
  const version = await db.curriculumVersion.create({
    data: { code: "ata-v2", name: "journal", versionNumber: 1, status: "published", publishedAt: new Date(), effectiveFrom: new Date() },
  });
  const moduleDefinition = await db.moduleDefinition.create({
    data: { curriculumVersionId: version.id, moduleNumber: 1, code: "m1", title: "M", firstLevel: 1, lastLevel: 12, learningObjective: "L" },
  });
  const levels: { id: number; levelNumber: number }[] = [];
  for (let n = 1; n <= 12; n += 1) {
    levels.push(
      await db.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleDefinition.id,
          levelNumber: n,
          stableCode: `v2.l${String(n).padStart(3, "0")}.journal`,
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
  async function completeLevel(enrollmentId: number, levelNumber: number) {
    await db.userLevelProgress.create({
      data: { enrollmentId, curriculumVersionId: version.id, levelDefinitionId: levels[levelNumber - 1]!.id, status: "completed", startedAt: new Date(), completedAt: new Date() },
    });
  }
  /** What the route does: a save becomes an entry only once the journal is open. */
  async function saveLikeTheRoute(userId: number, cardId: string, tradeDate: string | null) {
    const open = await isToolUnlockedForUser(userId, "tool.trading_journal", db);
    return cards.saveTradeCard(userId, cardId, { result: "profit", observation: "Вошёл по плану", journal: open ? { tradeDate } : null }, db);
  }

  const alice = await learner("journal-alice@example.invalid", 9);
  const bob = await learner("journal-bob@example.invalid", 12);

  try {
    await check("every migration applied, the journal one among them", async () => {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      assert.equal(rows.length, EXPECTED_MIGRATION_COUNT);
      assert.ok(rows.some((row) => row.migration_name === "20260921180000_tool_trading_journal"));
    });

    await check("«только новые»: a card saved while the journal is locked never arrives", async () => {
      const card = await cards.createTradeCard(alice.user.id, plan, db);
      await saveLikeTheRoute(alice.user.id, card.id, "2026-09-18");
      assert.equal(await db.toolJournalEntry.count({ where: { userId: alice.user.id } }), 0);
    });

    let aliceCardEntryId = "";
    await check("after L10 a saved card becomes exactly one entry, dated by the learner", async () => {
      await completeLevel(alice.enrollment.id, 10);
      const card = await cards.createTradeCard(alice.user.id, plan, db);
      await saveLikeTheRoute(alice.user.id, card.id, "2026-09-21");
      const entries = await db.toolJournalEntry.findMany({ where: { userId: alice.user.id } });
      assert.equal(entries.length, 1);
      const entry = entries[0]!;
      aliceCardEntryId = entry.id;
      assert.equal(entry.source, "trade_card");
      assert.equal(entry.tradeCardId, card.id);
      assert.equal(entry.tradeDate, "2026-09-21");
      assert.equal(entry.entryTime, "14:32");
      assert.equal(entry.plan, plan.reason);
      assert.equal(entry.conclusion, "Вошёл по плану");
      assert.equal(entry.result, "profit");
      assert.equal(entry.planFollowed, null);
    });

    await check("without the learner's date the UTC date of the fixing stands in", async () => {
      const card = await cards.createTradeCard(alice.user.id, plan, db);
      await saveLikeTheRoute(alice.user.id, card.id, null);
      const entry = await db.toolJournalEntry.findUniqueOrThrow({ where: { tradeCardId: card.id } });
      assert.equal(entry.tradeDate, card.fixedAt.toISOString().slice(0, 10));
    });

    await check("the save and its entry are one transaction: a failed entry keeps the card open", async () => {
      const card = await cards.createTradeCard(bob.user.id, plan, db);
      const now = Date.now();
      // Occupy the card's one journal slot behind the service's back.
      await db.$executeRawUnsafe(
        `INSERT INTO "ToolJournalEntry" ("id","userId","source","tradeCardId","tradeDate","entryTime","assetCode","direction",
           "amountMinor","payoutPercent","expiryCode","result","updatedAt")
         VALUES ('squatter-${now}', ${bob.user.id}, 'trade_card', '${card.id}', '2026-09-21', '14:32', 'EURUSD_OTC', 'up', 800, 90, 'M3', 'profit', ${now})`,
      );
      await assert.rejects(saveLikeTheRoute(bob.user.id, card.id, "2026-09-21"));
      const still = await db.toolTradeCard.findUniqueOrThrow({ where: { id: card.id } });
      assert.equal(still.status, "fixed");
      assert.equal(still.result, null);
      await db.$executeRawUnsafe(`DELETE FROM "ToolJournalEntry" WHERE "id" = 'squatter-${now}'`);
      await cards.cancelTradeCard(bob.user.id, card.id, db);
    });

    let aliceManualId = "";
    await check("a hand-recorded trade, with its review and broken rules", async () => {
      const row = await journal.createManualJournalEntry(
        alice.user.id,
        manual({ planFollowed: false, violations: ["revenge", "no_reason"], execution: "Вход через минуту после убытка, сумма удвоена." }),
        db,
      );
      aliceManualId = row.id;
      assert.equal(row.source, "manual");
      assert.equal(row.tradeCardId, null);
      assert.deepEqual(row.violations.map((violation) => violation.code).sort(), ["no_reason", "revenge"]);
    });

    await check("newest trade first, with counts over the whole journal", async () => {
      const page = await journal.listJournal(alice.user.id, { filter: "all", before: null }, db);
      assert.deepEqual(
        page.rows.map((row) => row.tradeDate),
        [...page.rows.map((row) => row.tradeDate)].sort().reverse(),
      );
      assert.equal(page.summary.total, 3);
      assert.equal(page.summary.violated, 1);
      assert.equal(page.summary.onPlan, 0);
      assert.equal(page.summary.unmarked, 2);
      assert.equal(page.summary.withoutConclusion, 1);
      assert.equal(page.nextCursor, null);
    });

    await check("filters: a broken plan, and no conclusion", async () => {
      const violated = await journal.listJournal(alice.user.id, { filter: "violated", before: null }, db);
      assert.deepEqual(violated.rows.map((row) => row.id), [aliceManualId]);
      const noConclusion = await journal.listJournal(alice.user.id, { filter: "no_conclusion", before: null }, db);
      assert.deepEqual(noConclusion.rows.map((row) => row.id), [aliceManualId]);
    });

    await check("the review of a card entry is the learner's to edit, and leaves it the card's entry", async () => {
      const reviewed = await journal.updateJournalEntry(
        alice.user.id,
        aliceCardEntryId,
        parseJournalChange({ kind: "review", planFollowed: true, execution: "Вошёл после закрытия свечи", conclusion: "Ждать закрытия" }),
        db,
      );
      assert.equal(reviewed.planFollowed, true);
      assert.equal(reviewed.execution, "Вошёл после закрытия свечи");
      assert.equal(toJournalEntryDto(reviewed).editedAfterCard, false);
    });

    await check("an entry made from a card is replaced whole too: the entry changes, the card does not", async () => {
      const card = await db.toolTradeCard.findFirstOrThrow({ where: { journalEntry: { id: aliceCardEntryId } } });
      const before = await db.toolJournalEntry.findUniqueOrThrow({ where: { id: aliceCardEntryId } });
      // The result was marked wrongly on the card: a profit that was a loss.
      const corrected = await journal.updateJournalEntry(
        alice.user.id,
        aliceCardEntryId,
        parseJournalChange(
          {
            kind: "entry",
            tradeDate: before.tradeDate,
            entryTime: before.entryTime,
            asset: before.assetCode,
            direction: before.direction,
            amount: "8",
            payoutPercent: before.payoutPercent,
            expiry: before.expiryCode,
            result: "loss",
            plan: before.plan,
            planFollowed: true,
            conclusion: "Ждать закрытия",
          },
          NOW(),
        ),
        db,
      );
      assert.equal(corrected.result, "loss");
      // Still that card's entry — corrected, and said to be.
      assert.equal(corrected.source, "trade_card");
      assert.equal(corrected.tradeCardId, card.id);
      const dto = toJournalEntryDto(corrected);
      assert.equal(dto.editedAfterCard, true);
      assert.equal(dto.resultAmount, "8.00");
      // The card is what it was when it was saved.
      const cardAfter = await db.toolTradeCard.findUniqueOrThrow({ where: { id: card.id } });
      assert.equal(cardAfter.result, "profit");
      assert.equal(cardAfter.status, "saved");
      assert.deepEqual(cardAfter.updatedAt, card.updatedAt);
      // Put back, it is the card's entry again.
      const restored = await journal.updateJournalEntry(
        alice.user.id,
        aliceCardEntryId,
        parseJournalChange(
          {
            kind: "manual",
            tradeDate: before.tradeDate,
            entryTime: before.entryTime,
            asset: before.assetCode,
            direction: before.direction,
            amount: "8",
            payoutPercent: before.payoutPercent,
            expiry: before.expiryCode,
            result: "profit",
            plan: before.plan,
            planFollowed: true,
            execution: "Вошёл после закрытия свечи",
            conclusion: "Ждать закрытия",
          },
          NOW(),
        ),
        db,
      );
      assert.equal(toJournalEntryDto(restored).editedAfterCard, false);
    });

    await check("a hand-recorded entry is replaced whole, and its rules with it", async () => {
      const replaced = await journal.updateJournalEntry(
        alice.user.id,
        aliceManualId,
        parseJournalChange({ kind: "entry", ...manualBody(), planFollowed: false, violations: ["tired"] }, NOW()),
        db,
      );
      assert.equal(replaced.assetCode, "XAUUSD_OTC");
      assert.deepEqual(replaced.violations.map((violation) => violation.code), ["tired"]);
      assert.equal(await db.toolJournalViolation.count({ where: { entryId: aliceManualId } }), 1);
    });

    await check("another learner can neither see nor change an entry, nor page from it", async () => {
      const bobs = await journal.listJournal(bob.user.id, { filter: "all", before: null }, db);
      assert.equal(bobs.rows.length, 0);
      await expectToolError(
        journal.updateJournalEntry(bob.user.id, aliceManualId, parseJournalChange({ kind: "review", planFollowed: true }), db),
        "JOURNAL_ENTRY_NOT_FOUND",
      );
      await expectToolError(journal.listJournal(bob.user.id, { filter: "all", before: aliceManualId }, db), "TOOL_VALIDATION", "invalid_before");
    });

    await check("pages of twenty, continued from the learner's own cursor", async () => {
      for (let n = 0; n < 23; n += 1) {
        await journal.createManualJournalEntry(bob.user.id, manual({ tradeDate: `2026-08-${String(n + 1).padStart(2, "0")}` }), db);
      }
      const first = await journal.listJournal(bob.user.id, { filter: "all", before: null }, db);
      assert.equal(first.rows.length, 20);
      assert.ok(first.nextCursor);
      const second = await journal.listJournal(bob.user.id, { filter: "all", before: first.nextCursor }, db);
      assert.equal(second.rows.length, 3);
      assert.equal(second.nextCursor, null);
      const ids = new Set([...first.rows, ...second.rows].map((row) => row.id));
      assert.equal(ids.size, 23);
      assert.equal(first.rows[0]!.tradeDate, "2026-08-23");
      assert.equal(second.rows.at(-1)!.tradeDate, "2026-08-01");
    });

    await check("an entry is deleted with its rules, and the counts are those after the delete", async () => {
      const doomed = await journal.createManualJournalEntry(
        alice.user.id,
        manual({ tradeDate: "2026-09-18", planFollowed: false, violations: ["revenge", "tired"], conclusion: null }),
        db,
      );
      const before = (await journal.listJournal(alice.user.id, { filter: "all", before: null }, db)).summary;
      assert.equal(await db.toolJournalViolation.count({ where: { entryId: doomed.id } }), 2);

      // Another learner's delete is «not found» and deletes nothing.
      await expectToolError(journal.deleteJournalEntry(bob.user.id, doomed.id, db), "JOURNAL_ENTRY_NOT_FOUND");
      assert.equal(await db.toolJournalEntry.count({ where: { id: doomed.id } }), 1);

      const { summary } = await journal.deleteJournalEntry(alice.user.id, doomed.id, db);
      assert.equal(await db.toolJournalEntry.count({ where: { id: doomed.id } }), 0);
      assert.equal(await db.toolJournalViolation.count({ where: { entryId: doomed.id } }), 0);
      assert.deepEqual(summary, {
        total: before.total - 1,
        onPlan: before.onPlan,
        violated: before.violated - 1,
        unmarked: before.unmarked,
        withoutConclusion: before.withoutConclusion - 1,
      });
      assert.deepEqual((await journal.listJournal(alice.user.id, { filter: "all", before: null }, db)).summary, summary);

      // Deleted is deleted: a second delete, an edit and a page from it are all refused.
      await expectToolError(journal.deleteJournalEntry(alice.user.id, doomed.id, db), "JOURNAL_ENTRY_NOT_FOUND");
      await expectToolError(
        journal.updateJournalEntry(alice.user.id, doomed.id, parseJournalChange({ kind: "review", planFollowed: true }), db),
        "JOURNAL_ENTRY_NOT_FOUND",
      );
      await expectToolError(journal.listJournal(alice.user.id, { filter: "all", before: doomed.id }, db), "TOOL_VALIDATION", "invalid_before");
    });

    await check("deleting a card's entry leaves the card saved, and gives the card no second entry", async () => {
      const card = await db.toolTradeCard.findFirstOrThrow({ where: { journalEntry: { id: aliceCardEntryId } } });
      const others = await db.toolJournalEntry.count({ where: { userId: alice.user.id, id: { not: aliceCardEntryId } } });
      const { summary } = await journal.deleteJournalEntry(alice.user.id, aliceCardEntryId, db);
      assert.equal(summary.total, others);
      const kept = await db.toolTradeCard.findUniqueOrThrow({ where: { id: card.id }, include: { journalEntry: true } });
      assert.equal(kept.status, "saved");
      assert.equal(kept.result, "profit");
      assert.equal(kept.journalEntry, null);
      assert.deepEqual(kept.updatedAt, card.updatedAt);
      // The card is terminal: it cannot be saved again, so the trade does not come back by itself.
      await expectToolError(saveLikeTheRoute(alice.user.id, card.id, "2026-09-21"), "TRADE_CARD_STATE_CONFLICT");
      assert.equal(await db.toolJournalEntry.count({ where: { tradeCardId: card.id } }), 0);
    });

    await check("the tables refuse states the service never writes (raw SQL)", async () => {
      const now = Date.now();
      const insert = (id: string, source: string, cardRef: string, date = "2026-09-21") =>
        db.$executeRawUnsafe(
          `INSERT INTO "ToolJournalEntry" ("id","userId","source","tradeCardId","tradeDate","entryTime","assetCode","direction",
             "amountMinor","payoutPercent","expiryCode","result","updatedAt")
           VALUES ('${id}', ${bob.user.id}, '${source}', ${cardRef}, '${date}', '14:32', 'EURUSD_OTC', 'up', 800, 90, 'M3', 'profit', ${now})`,
        );
      const aCard = await db.toolTradeCard.findFirstOrThrow({ where: { userId: alice.user.id } });
      await assert.rejects(insert(`raw1-${now}`, "manual", `'${aCard.id}'`), /CHECK constraint failed/);
      await assert.rejects(insert(`raw2-${now}`, "trade_card", "NULL"), /CHECK constraint failed/);
      await assert.rejects(insert(`raw3-${now}`, "import", "NULL"), /CHECK constraint failed/);
      await assert.rejects(insert(`raw4-${now}`, "manual", "NULL", "21.09.2026"), /CHECK constraint failed/);
      await assert.rejects(
        db.$executeRawUnsafe(`INSERT INTO "ToolJournalViolation" ("id","entryId","code") VALUES ('rawv-${now}', '${aliceManualId}', 'DROP TABLE')`),
        /CHECK constraint failed/,
      );
    });

    await check("deleting a learner deletes their journal and its rules", async () => {
      // A learner with no enrollment: the enrollment itself is not a cascade.
      const carol = await db.user.create({ data: { email: "journal-carol@example.invalid", name: "Carol", role: "user", passwordHash: "x" } });
      const row = await journal.createManualJournalEntry(carol.id, manual({ planFollowed: false, violations: ["other"] }), db);
      assert.equal(await db.toolJournalViolation.count({ where: { entryId: row.id } }), 1);
      await db.user.delete({ where: { id: carol.id } });
      assert.equal(await db.toolJournalEntry.count({ where: { userId: carol.id } }), 0);
      assert.equal(await db.toolJournalViolation.count({ where: { entryId: row.id } }), 0);
    });
  } finally {
    await db.$disconnect();
  }
}

function NOW() {
  return new Date("2026-09-21T12:00:00.000Z");
}

function manualBody() {
  return {
    tradeDate: "2026-09-19",
    entryTime: "11:00",
    asset: "XAUUSD_OTC",
    direction: "up",
    amount: "5",
    payoutPercent: 80,
    expiry: "M5",
    result: "profit",
    plan: "Пробой уровня",
  };
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
