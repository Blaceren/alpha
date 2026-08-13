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

const prisma = new PrismaClient();
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
    const statements = splitSqlStatements(migrationSql);

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
