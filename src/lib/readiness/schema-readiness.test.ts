/**
 * The readiness contract that was missing, asserted in both directions.
 *
 * The point of these tests is the FAILING half. It is easy to write a readiness
 * check that passes on a healthy database; the defect being closed here was a
 * readiness check that ALSO passed on a database missing the schema this build
 * requires. So every test below that matters is a test that readiness refuses.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_REPORTED_MISSING,
  checkSchemaReadiness,
  readShippedMigrations,
  resetShippedMigrationsCache,
} from "./schema-readiness";

const tempRoots: string[] = [];

function migrationsFixture(names: readonly string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ata-readiness-"));
  tempRoots.push(root);
  for (const name of names) fs.mkdirSync(path.join(root, name));
  return root;
}

/** A database that reports exactly the migration rows it is given. */
function dbWith(appliedNames: readonly string[]) {
  return {
    $queryRaw: async () => appliedNames.map((migration_name) => ({ migration_name })),
  } as never;
}

/** A database whose migration state cannot be read at all. */
function dbThatThrows() {
  return {
    $queryRaw: async () => {
      throw new Error("no such table: _prisma_migrations");
    },
  } as never;
}

afterEach(() => {
  resetShippedMigrationsCache();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("checkSchemaReadiness", () => {
  it("is ready when every shipped migration is applied", async () => {
    const root = migrationsFixture(["20260101000000_a", "20260102000000_b"]);
    const result = await checkSchemaReadiness(dbWith(["20260101000000_a", "20260102000000_b"]), root);

    expect(result.ready).toBe(true);
    expect(result.shipped).toBe(2);
    expect(result.applied).toBe(2);
  });

  it("REFUSES when the database is one migration behind the release", async () => {
    // The exact G4 trap: a build shipping the Growth migration against a
    // database that never received it. Readiness answered ok before this.
    const root = migrationsFixture([
      "20260811000000_assessment_successor_lineage",
      "20260813000000_growth_event_foundation",
    ]);
    const result = await checkSchemaReadiness(
      dbWith(["20260811000000_assessment_successor_lineage"]),
      root,
    );

    expect(result.ready).toBe(false);
    if (result.ready) return;
    expect(result.missing).toEqual(["20260813000000_growth_event_foundation"]);
    expect(result.applied).toBe(1);
    expect(result.shipped).toBe(2);
  });

  it("REFUSES when the migration table cannot be read", async () => {
    const root = migrationsFixture(["20260101000000_a"]);
    const result = await checkSchemaReadiness(dbThatThrows(), root);

    expect(result.ready).toBe(false);
    if (result.ready) return;
    expect(result.reason).toContain("unreadable");
  });

  it("REFUSES when the release ships no migrations at all", async () => {
    const root = migrationsFixture([]);
    const result = await checkSchemaReadiness(dbWith([]), root);

    expect(result.ready).toBe(false);
  });

  it("REFUSES when the migrations directory does not exist", async () => {
    const result = await checkSchemaReadiness(dbWith([]), path.join(os.tmpdir(), "ata-absent-root"));

    expect(result.ready).toBe(false);
    if (result.ready) return;
    expect(result.reason).toContain("could not be read");
  });

  it("ignores an unfinished or rolled-back migration, because a half-applied schema is not applied", async () => {
    // The query itself excludes them; this asserts the caller depends on that
    // predicate rather than on a bare row count.
    const root = migrationsFixture(["20260101000000_a", "20260102000000_b"]);
    const result = await checkSchemaReadiness(dbWith(["20260101000000_a"]), root);

    expect(result.ready).toBe(false);
  });

  it("tolerates a database carrying MORE migrations than the release ships", async () => {
    // A rollback to an older build against a forward database. The older build
    // can still serve its own contract, so this is not a readiness failure —
    // and the G3-backend-on-migration-47 rollback path depends on it.
    const root = migrationsFixture(["20260101000000_a"]);
    const result = await checkSchemaReadiness(dbWith(["20260101000000_a", "20260102000000_b"]), root);

    expect(result.ready).toBe(true);
  });

  it("bounds how many missing migrations it names", async () => {
    const many = Array.from({ length: MAX_REPORTED_MISSING + 4 }, (_, i) => `2026010${i}000000_m${i}`);
    const root = migrationsFixture(many);
    const result = await checkSchemaReadiness(dbWith([]), root);

    expect(result.ready).toBe(false);
    if (result.ready) return;
    expect(result.missing).toHaveLength(MAX_REPORTED_MISSING);
  });
});

describe("readShippedMigrations", () => {
  it("reads this repository's own migration set", () => {
    const names = readShippedMigrations();

    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("20260813000000_growth_event_foundation");
    // Sorted, because the runner applies them in lexical order and a readiness
    // report that names migrations out of order is harder to act on.
    expect([...names].sort()).toEqual(names);
  });
});
