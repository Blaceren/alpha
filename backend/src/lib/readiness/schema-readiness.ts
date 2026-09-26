/**
 * SCHEMA READINESS — the dependency check `/api/readiness` was missing.
 *
 * WHY THIS EXISTS. Readiness answered `ok:true` on a database that did not carry
 * the schema this build requires. It probed the connection, the storage adapter
 * and the environment — all real dependencies — and then stopped, so a build
 * shipping migration 47 could be told "ready" by a database still at 46, on
 * which five of its routes answer 500. That is the exact failure a readiness
 * gate exists to prevent, and it was the one it could not see.
 *
 * WHAT READINESS MEANS HERE. Health says the process is alive. Readiness says
 * every dependency required to serve the contract this build advertises is
 * usable. A schema older than the build is an unusable dependency, so it is a
 * readiness failure, not a warning.
 *
 * DELIBERATELY GENERAL, NOT GROWTH-SPECIFIC. The trap was found through Growth,
 * but a probe for `GrowthEvent` would only have closed the instance and left the
 * shape: the next migration would arrive with the same gap. The contract this
 * module states instead is "the migrations this release ships are applied" —
 * which covers migration 47 today and every later one without being edited.
 *
 * READ-ONLY AND CHEAP. One directory read, cached for the process lifetime
 * because a release's migration set is immutable, plus one indexed query over a
 * table with one row per migration. It creates nothing, mutates nothing and
 * applies nothing: discovering a missing migration is not licence to run it.
 *
 * FAIL-CLOSED. Every failure mode — no `_prisma_migrations` table, an
 * unreadable migrations directory, a query error — reports NOT ready. A
 * readiness probe that cannot prove the schema must never claim it.
 */
import fs from "node:fs";
import path from "node:path";

import type { Prisma, PrismaClient } from "@prisma/client";

export type SchemaReadiness =
  | { readonly ready: true; readonly shipped: number; readonly applied: number }
  | {
      readonly ready: false;
      readonly reason: string;
      readonly shipped: number;
      readonly applied: number;
      /** Migration names this build ships that the database does not carry. */
      readonly missing: readonly string[];
    };

/**
 * How many missing migration names are named in the response.
 *
 * Bounded on purpose. The operator needs to know WHICH migration is missing —
 * that is the difference between "roll forward" and "this is the wrong
 * database" — but an unbounded list turns a health payload into a schema dump.
 */
export const MAX_REPORTED_MISSING = 5;

let cachedShippedMigrations: readonly string[] | null = null;

/**
 * The migration names this release ships, read from the release tree.
 *
 * Cached because a release directory is immutable by construction — the
 * publisher refuses a pre-existing destination — so re-reading it on every
 * probe would buy nothing and cost a syscall per request.
 */
export function readShippedMigrations(migrationsRoot?: string): readonly string[] {
  if (cachedShippedMigrations && !migrationsRoot) return cachedShippedMigrations;

  const root = migrationsRoot ?? path.join(process.cwd(), "prisma", "migrations");
  const names = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (!migrationsRoot) cachedShippedMigrations = names;
  return names;
}

/** Test seam. The cache is a process-lifetime optimisation, not state. */
export function resetShippedMigrationsCache(): void {
  cachedShippedMigrations = null;
}

type MigrationRow = { migration_name: string };

/**
 * Is the database carrying every migration this build ships?
 *
 * A migration counts as applied only when it FINISHED and was not rolled back —
 * the same predicate the runner writes and the same one an operator would use
 * by hand. A row that started and never finished is a half-applied migration,
 * and treating it as present is how a partially migrated database gets called
 * ready.
 */
export async function checkSchemaReadiness(
  db: Pick<PrismaClient, "$queryRaw">,
  migrationsRoot?: string,
): Promise<SchemaReadiness> {
  let shipped: readonly string[];
  try {
    shipped = readShippedMigrations(migrationsRoot);
  } catch {
    return {
      ready: false,
      reason: "migration set for this release could not be read",
      shipped: 0,
      applied: 0,
      missing: [],
    };
  }

  // A release with no migrations directory at all is not a schema claim this
  // module can validate, and inventing a pass for it would defeat the point.
  if (shipped.length === 0) {
    return {
      ready: false,
      reason: "this release declares no migrations",
      shipped: 0,
      applied: 0,
      missing: [],
    };
  }

  let rows: MigrationRow[];
  try {
    rows = await db.$queryRaw<MigrationRow[]>`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
    `;
  } catch {
    // Includes the case that matters most: the table does not exist, because
    // no migration has ever been applied to this database.
    return {
      ready: false,
      reason: "migration state is unreadable",
      shipped: shipped.length,
      applied: 0,
      missing: shipped.slice(0, MAX_REPORTED_MISSING),
    };
  }

  const applied = new Set(rows.map((row) => row.migration_name));
  const missing = shipped.filter((name) => !applied.has(name));

  if (missing.length > 0) {
    return {
      ready: false,
      reason: `${missing.length} migration(s) this release requires are not applied`,
      shipped: shipped.length,
      applied: applied.size,
      missing: missing.slice(0, MAX_REPORTED_MISSING),
    };
  }

  return { ready: true, shipped: shipped.length, applied: applied.size };
}
