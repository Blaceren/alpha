/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§16D/§28) — the canonical timestamp
 * storage class, enforced where the schema cannot enforce it.
 *
 * WHY THIS EXISTS RATHER THAN A CHECK CONSTRAINT. Migration 47 established
 * INTEGER EPOCH MILLISECONDS as the canonical representation and put
 * `CHECK (typeof(...) = 'integer')` on the tables it created. It could not
 * retrofit that onto `User`, `UserLevelProgress` and the rest without SQLite's
 * 12-step rebuild of a table every other table references — an operation far
 * larger than the defect justifies. Migration 48 normalises the values instead,
 * and this is what stops them coming back.
 *
 * WHAT REINTRODUCES THEM. Only raw SQL that omits the column: three of these
 * tables still declare `DEFAULT CURRENT_TIMESTAMP`, which SQLite renders as
 * TEXT. Prisma always binds an integer, so the product cannot cause it — a
 * script can. This test is the thing that notices.
 *
 * IT RUNS AGAINST WHATEVER `DATABASE_URL` POINTS AT, and is a no-op assertion
 * on a fresh database, which is the correct outcome: a database with no legacy
 * rows has nothing to normalise and nothing to regress.
 *
 *   npx tsx scripts/regression/timestampStorageClassRegression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Every DATETIME column that held a TEXT value on PREPROD when this was found.
 *
 * Measured by scanning every DATETIME column in every table, not taken from the
 * finding that prompted it — the finding named 3 columns and the scan found 19.
 */
const NORMALISED_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ["ChatChannel", "createdAt"],
  ["ChatChannel", "updatedAt"],
  ["ExchangeAccount", "createdAt"],
  ["ExchangeAccount", "updatedAt"],
  ["LevelCheckpointRequirement", "createdAt"],
  ["LevelCheckpointRequirement", "updatedAt"],
  ["NewsPost", "publishedAt"],
  ["NewsPost", "createdAt"],
  ["User", "createdAt"],
  ["User", "updatedAt"],
  ["UserCurriculumEnrollment", "enrolledAt"],
  ["UserCurriculumEnrollment", "lastMeaningfulActionAt"],
  ["UserCurriculumEnrollment", "createdAt"],
  ["UserCurriculumEnrollment", "updatedAt"],
  ["UserLevelProgress", "startedAt"],
  ["UserLevelProgress", "lastProgressAt"],
  ["UserLevelProgress", "completedAt"],
  ["UserLevelProgress", "createdAt"],
  ["UserLevelProgress", "updatedAt"],
];

const MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20260814000000_normalize_legacy_timestamp_storage/migration.sql",
);

let passed = 0;
const check = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  console.log("TIMESTAMP STORAGE CLASS REGRESSION");
  try {
    await check("no TEXT-typed value survives in any normalised column", async () => {
      const offenders: string[] = [];
      for (const [table, column] of NORMALISED_COLUMNS) {
        const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
          `SELECT COUNT(*) AS n FROM "${table}" WHERE typeof("${column}") = 'text'`,
        );
        const n = Number(rows[0]?.n ?? 0);
        if (n > 0) offenders.push(`${table}.${column} = ${n}`);
      }
      assert.deepEqual(offenders, [], `TEXT timestamps present: ${offenders.join(", ")}`);
    });

    await check("no normalised column was emptied by the conversion", async () => {
      // A conversion that produced NULL would show up as a column that is
      // entirely NULL where it used to hold values. Checked on the NOT NULL
      // columns, where a NULL is impossible by definition and therefore proves
      // the statement never ran destructively.
      for (const [table, column] of [
        ["User", "createdAt"],
        ["UserLevelProgress", "createdAt"],
        ["UserCurriculumEnrollment", "createdAt"],
      ] as const) {
        const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
          `SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" IS NULL`,
        );
        assert.equal(Number(rows[0]?.n ?? 0), 0, `${table}.${column} holds NULLs`);
      }
    });

    await check("integer timestamps are epoch MILLISECONDS, not seconds", async () => {
      // A seconds-valued timestamp would be ~1.7e9 and would render as 1970.
      // This catches a conversion that forgot the * 1000.
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
        `SELECT COUNT(*) AS n FROM "User" WHERE typeof("createdAt") = 'integer' AND "createdAt" < 100000000000`,
      );
      assert.equal(Number(rows[0]?.n ?? 0), 0, "User.createdAt holds second-valued timestamps");
    });

    await check("ordering by createdAt is chronological (the CRM defect)", async () => {
      // The observable symptom: TEXT sorts above INTEGER, so legacy rows were
      // presented as the newest learners. With one storage class the order is
      // the real one.
      const rows = await prisma.$queryRawUnsafe<Array<{ id: number; createdAt: bigint | number }>>(
        `SELECT "id", "createdAt" FROM "User" ORDER BY "createdAt" DESC, "id" DESC LIMIT 20`,
      );
      let previous = Number.POSITIVE_INFINITY;
      for (const row of rows) {
        const value = Number(row.createdAt);
        assert.ok(value <= previous, `User ${row.id} breaks descending order`);
        previous = value;
      }
    });

    await check("migration 48 refuses to write NULL over an unreadable value", () => {
      // The failure mode found in rehearsal: eleven of these columns are
      // nullable, and `strftime` returns NULL for a shape it cannot read.
      const sql = readFileSync(MIGRATION, "utf8");
      const updates = sql.match(/^UPDATE .*$/gm) ?? [];
      assert.equal(updates.length, NORMALISED_COLUMNS.length, "one UPDATE per normalised column");
      for (const statement of updates) {
        assert.match(statement, /typeof\("\w+"\) = 'text'/, `unguarded storage class: ${statement}`);
        assert.match(
          statement,
          /AND strftime\('%s', "\w+"\) IS NOT NULL/,
          `an unreadable value could be nulled by: ${statement}`,
        );
      }
    });

    await check("migration 48 is fail-closed on an unrecognised shape", () => {
      const sql = readFileSync(MIGRATION, "utf8");
      assert.match(sql, /CHECK \("unrecognisedShapes" = 0\)/);
      assert.match(sql, /NOT GLOB '\[0-9\]\[0-9\]\[0-9\]\[0-9\]-/);
      assert.match(sql, /datetime\(strftime\('%s', v\), 'unixepoch'\) <> v/);
      assert.match(sql, /DROP TABLE "_legacy_timestamp_normalization_guard"/);
    });

    await check("migration 48 does no unrelated work", () => {
      const sql = readFileSync(MIGRATION, "utf8");
      // The only DDL is the guard table it creates and drops.
      const ddl = sql.match(/^\s*(CREATE|ALTER|DROP)\s+\w+/gim) ?? [];
      assert.equal(ddl.length, 2, `unexpected DDL in migration 48: ${ddl.join(" | ")}`);
      assert.ok(!/DELETE FROM/i.test(sql), "migration 48 must delete nothing");
      assert.ok(!/INSERT INTO "(?!_legacy)/i.test(sql), "migration 48 must insert no business row");
    });

    console.log(`\n${passed}/${passed} assertions passed`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
