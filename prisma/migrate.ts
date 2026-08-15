/**
 * The migration runner.
 *
 * ONE INTERACTIVE TRANSACTION PER MIGRATION FILE. The `_prisma_migrations` row,
 * every statement in the file, and the completion update all commit together or
 * not at all. That is what makes an interrupted migration leave no partial state
 * and a retry reach the same final state, and it is preserved deliberately: §39
 * of the fix brief forbids splitting a migration into non-atomic phases to make
 * it finish.
 *
 * G4-H6 -- WHY THE TIMEOUT IS NAMED HERE.
 *
 * `prisma.$transaction(fn)` takes its bounds from Prisma's defaults when none are
 * given: `timeout` 5000 ms and `maxWait` 2000 ms. Those are REQUEST defaults. A
 * migration is not a request -- it runs once, offline, in a maintenance window,
 * against the whole table -- and the deep audit measured what the request default
 * does to one: migration 47 applied cleanly at 12,044 users and failed at 16,044
 * with `P2028 Transaction not found ... refers to an old closed transaction`. It
 * failed SAFELY (full rollback, no `_prisma_migrations` row, retry-safe), but it
 * was simply unappliable above that size, and nothing in the source said so.
 *
 * The values below are therefore migration-appropriate, source-owned, documented
 * and deterministic. They are NOT silently infinite: a migration that exceeds
 * `MIGRATION_TRANSACTION_TIMEOUT_MS` still fails loudly and still rolls back
 * cleanly, which is the property that makes a stuck migration recoverable rather
 * than a mystery. They are separate from every application transaction setting --
 * nothing outside this file reads them.
 *
 * A timeout is a CEILING, not a target. It exists so a correct migration is not
 * killed by an arbitrary request-shaped bound; it does not make a badly-scaling
 * migration acceptable. The backfill's own cost is measured separately and
 * recorded in the release evidence.
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * ONE CONNECTION, DELIBERATELY.
 *
 * A `PRAGMA` in SQLite is CONNECTION-SCOPED, and `foreign_keys` in particular is
 * a no-op inside an open transaction. So a migration that needs foreign keys
 * disabled needs the pragma executed OUTSIDE the transaction and on the SAME
 * connection the transaction will use. Prisma's default pool is
 * `num_cpus * 2 + 1`, which would let the pragma land on a connection the
 * migration never touches — the pragma would appear to succeed and change
 * nothing.
 *
 * `connection_limit=1` removes the question. A migration runs once, offline, in
 * a maintenance window, so there is nothing to gain from a pool here anyway.
 */
function singleConnectionUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return raw;
  if (raw.includes("connection_limit=")) return raw;
  return raw.includes("?") ? `${raw}&connection_limit=1` : `${raw}?connection_limit=1`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: singleConnectionUrl(process.env.DATABASE_URL) ?? "" } },
});
const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");

/**
 * How long ONE migration file may take before the runner gives up and rolls back.
 *
 * 30 minutes. Chosen as a maintenance-window ceiling with several orders of
 * magnitude of headroom over the measured cost of the largest migration in this
 * repository, so a correct migration is never killed by the clock, while an
 * unbounded or pathological one still terminates and still leaves the database
 * exactly as it found it.
 */
export const MIGRATION_TRANSACTION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * How long the runner may wait to OPEN the transaction.
 *
 * 2 minutes. Distinct from the timeout above: this bounds contention for the
 * connection, not the work. A migration that cannot even start within two minutes
 * is contending with live traffic, which is an operational fact worth failing on
 * rather than waiting out.
 */
export const MIGRATION_TRANSACTION_MAX_WAIT_MS = 2 * 60 * 1000;

function splitSqlStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * The SQL of a statement with its LEADING COMMENT LINES REMOVED.
 *
 * WHY THIS EXISTS, AND WHAT IT COST TO LEARN. `splitSqlStatements` splits on
 * `;` and keeps everything before it, so the first "statement" of a
 * well-documented migration is its entire header comment block followed by the
 * first real line. A test like `/^\s*PRAGMA/` against that string matches
 * NOTHING — the string starts with `-- ====`.
 *
 * That is exactly how migration 50's `PRAGMA foreign_keys=OFF` was silently
 * left inside the transaction on the first attempt at hoisting it: the hoisting
 * code was correct and the predicate never fired. Recognising a statement by
 * its first REAL line is the difference between a rule and a rule that happens
 * to be unreachable.
 */
function effectiveSql(statement: string): string {
  return statement
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== "" && !trimmed.startsWith("--");
    })
    .join("\n")
    .trim();
}

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);

  const migrationNames = fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const migrationPath = path.join(migrationsRoot, migrationName, "migration.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    const checksum = crypto
      .createHash("sha256")
      .update(migrationSql)
      .digest("hex");

    const existingMigration = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "_prisma_migrations" WHERE "migration_name" = ? AND "rolled_back_at" IS NULL',
      migrationName,
    );

    if (existingMigration.length > 0) {
      console.log(`Migration ${migrationName} already applied.`);
      continue;
    }

    const migrationId = crypto.randomUUID();

    // ---------------------------------------------------------------------
    // MAKING `PRAGMA foreign_keys=OFF` IN A MIGRATION FILE ACTUALLY MEAN
    // SOMETHING.
    //
    // THIS WAS A LATENT DEFECT AND IT WAS FOUND THE HARD WAY. Migration 49
    // already contained `PRAGMA foreign_keys=OFF`, and this runner executed it
    // as the first statement INSIDE the interactive transaction, where SQLite
    // documents it as a silent no-op. It appeared to work only because nothing
    // referenced the table 49 rebuilt, so foreign keys never needed disabling.
    //
    // Migration 50 rebuilds `AffiliateTrackingLink`, which `AffiliateClick` and
    // `AffiliateConversionEvent` both reference with RESTRICT. Its `DROP TABLE`
    // failed with `FOREIGN KEY constraint failed`, the whole transaction rolled
    // back, and the database was left byte-identical — the atomicity guarantee
    // working exactly as intended, on a defect that had been sitting there for
    // one migration.
    //
    // THE MECHANISM THAT ACTUALLY WORKS IS `defer_foreign_keys`, not
    // `foreign_keys`. It is settable INSIDE a transaction, it postpones every
    // foreign-key check to COMMIT, and it resets itself at the end of the
    // transaction. By commit time the 12-step rebuild has put a table of the
    // same name back with the same rows, so every child reference resolves and
    // the deferred check passes. Disabling enforcement outright is neither
    // necessary nor, through a pooled client, reliable.
    //
    // The file's own `PRAGMA foreign_keys` lines are still hoisted out of the
    // transaction — they are harmless there and they are what a reader of the
    // migration expects to see honoured — but they are NOT what this depends on.
    // ---------------------------------------------------------------------
    const allStatements = splitSqlStatements(migrationSql);
    const isPragma = (statement: string) => /^PRAGMA\b/i.test(effectiveSql(statement));
    const pragmas = allStatements.filter(isPragma);
    const statements = allStatements.filter((statement) => !isPragma(statement));
    const wantsForeignKeysOff = pragmas.some((statement) =>
      /^PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(effectiveSql(statement)),
    );

    if (wantsForeignKeysOff) {
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys=OFF");
    }

    const startedAt = Date.now();

    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "applied_steps_count") VALUES (?, ?, ?, ?)',
          migrationId,
          checksum,
          migrationName,
          0,
        );

        // The real mechanism, issued INSIDE the transaction where it is legal
        // and effective. See the block above for why this and not the other one.
        if (wantsForeignKeysOff) {
          await tx.$executeRawUnsafe("PRAGMA defer_foreign_keys=ON");
        }

        for (const statement of statements) {
          await tx.$executeRawUnsafe(statement);
        }

        await tx.$executeRawUnsafe(
          'UPDATE "_prisma_migrations" SET "finished_at" = CURRENT_TIMESTAMP, "applied_steps_count" = ? WHERE "id" = ?',
          statements.length,
          migrationId,
        );
      },
      // G4-H6. See the module header: migration bounds, not request bounds.
      {
        timeout: MIGRATION_TRANSACTION_TIMEOUT_MS,
        maxWait: MIGRATION_TRANSACTION_MAX_WAIT_MS,
      },
    );

    if (wantsForeignKeysOff) {
      // RESTORE, THEN PROVE. Turning enforcement back on is not the same as
      // proving nothing was broken while it was off, so the runner runs SQLite's
      // own checker and refuses to report success if it finds anything. A
      // migration that left a dangling reference must be visible immediately,
      // not at the next write that happens to touch the row.
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON");
      const violations = await prisma.$queryRawUnsafe<Array<unknown>>("PRAGMA foreign_key_check");
      if (violations.length > 0) {
        throw new Error(
          `${migrationName} left ${violations.length} foreign key violation(s) — investigate before using this database`,
        );
      }
    }

    // Recorded so a cutover has a measured duration to plan a window around,
    // rather than an assumption. Statement count and elapsed time only — no SQL,
    // no row contents.
    console.log(
      `Migration ${migrationName} applied. (${statements.length} statements, ${Date.now() - startedAt} ms)`,
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
