/**
 * PREPROD ACTIVATION AUTHORIZATION — reading a SQLite file's own account of itself.
 *
 * This module never writes. It opens read-only, asks the four questions that
 * decide whether a file is a usable rollback artifact or a usable mutation
 * target, and closes.
 *
 * WHY NOT REUSE THE RESTORE TOOL. `scripts/backup/restoreSqlite.ts` is known
 * defective — the PREPROD backup/restore hard-gate session demonstrated it
 * installing a database whose `integrity_check` fails and exiting 0. Nothing in
 * this authorization path calls it, and nothing here trusts a verdict it
 * produced. The checks below are run here, against the bytes, every time.
 *
 * WHY `integrity_check` IS NOT ENOUGH ON ITS OWN. The same session flipped
 * single bytes that changed a file's sha256 while `integrity_check` still
 * returned `ok`, because the flip landed in unused page space. `integrity_check`
 * validates b-tree and index structure; it does not validate that the bytes are
 * the bytes you backed up. Callers here always pair it with a digest comparison,
 * and the digest is checked first.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { PreprodActivationError, type PreprodActivationErrorCode } from "./errors";

export type SqliteProbe = {
  /** `ok`, or SQLite's first complaint. */
  integrityCheck: string;
  /** Number of rows `PRAGMA foreign_key_check` returned. Zero is the only pass. */
  foreignKeyViolations: number;
  /** Applied, not-rolled-back migrations. */
  appliedMigrationCount: number;
  /** Rows in `_prisma_migrations` that record a failure or a rollback. */
  failedMigrationCount: number;
  /** Lexically newest applied migration name, for diagnostics. */
  newestMigration: string | null;
  /** User tables, excluding SQLite internals. */
  tableCount: number;
};

/** Full sha256 of a file, streamed so a large artifact does not land in memory. */
export function sha256File(absolutePath: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Open read-only and report. Any failure to open at all is surfaced under the
 * caller's chosen code, because "this file is not a readable SQLite database"
 * means something different for a backup artifact than for a mutation target.
 */
export function probeSqliteDatabase(
  absolutePath: string,
  unreadableCode: PreprodActivationErrorCode = "TARGET_UNREADABLE",
): SqliteProbe {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(absolutePath, { readOnly: true });
  } catch (error) {
    throw new PreprodActivationError(
      unreadableCode,
      `cannot open ${absolutePath} as a read-only SQLite database: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const integrityRows = db.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
    const integrityCheck = integrityRows.length > 0 ? String(Object.values(integrityRows[0])[0]) : "empty";

    const fkRows = db.prepare("PRAGMA foreign_key_check").all();
    const foreignKeyViolations = fkRows.length;

    const tableRow = db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get() as { n: number };

    // A database that predates the migration table is not a candidate for
    // anything this module authorizes, so an absent table is a hard zero rather
    // than an exception to interpret.
    const hasMigrations =
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'")
          .get() as { n: number }
      ).n > 0;

    let appliedMigrationCount = 0;
    let failedMigrationCount = 0;
    let newestMigration: string | null = null;
    if (hasMigrations) {
      appliedMigrationCount = (
        db
          .prepare("SELECT COUNT(*) AS n FROM _prisma_migrations WHERE rolled_back_at IS NULL")
          .get() as { n: number }
      ).n;
      failedMigrationCount = (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL",
          )
          .get() as { n: number }
      ).n;
      const newest = db
        .prepare(
          "SELECT migration_name AS name FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1",
        )
        .get() as { name: string } | undefined;
      newestMigration = newest?.name ?? null;
    }

    return {
      integrityCheck,
      foreignKeyViolations,
      appliedMigrationCount,
      failedMigrationCount,
      newestMigration,
      tableCount: tableRow.n,
    };
  } finally {
    db.close();
  }
}

export type LogicalDigest = {
  /** One digest over every row of every user table, in a deterministic order. */
  digest: string;
  tableCount: number;
  totalRows: number;
};

/**
 * A content-addressed summary of what a database MEANS, independent of how
 * SQLite happened to lay it out on disk.
 *
 * WHY THIS IS NEEDED AT ALL. The sanctioned backup tool uses the SQLite Online
 * Backup API, which rebuilds the destination page image rather than cloning the
 * source file. A backup is therefore never byte-identical to the database it was
 * taken from, so `sha256(backup) === sha256(live)` is the wrong question and
 * would fail every time it was asked. This digest is the right question: it is
 * equal exactly when the two databases hold the same rows.
 *
 * DETERMINISM. Tables are visited in name order; rows within a table are ordered
 * by every column in declaration order, so the result does not depend on rowid
 * assignment, on page layout, or on which of the two files we happen to read
 * first. Values are length-prefixed before hashing so that adjacent fields
 * cannot be shifted between one another without changing the digest.
 *
 * `_prisma_migrations` is included. Migration lineage is part of what a rollback
 * artifact has to reproduce.
 */
export function computeLogicalDigest(
  absolutePath: string,
  unreadableCode: PreprodActivationErrorCode = "TARGET_UNREADABLE",
): LogicalDigest {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(absolutePath, { readOnly: true });
  } catch (error) {
    throw new PreprodActivationError(
      unreadableCode,
      `cannot open ${absolutePath} to compute a logical digest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    const hash = crypto.createHash("sha256");
    let totalRows = 0;

    for (const table of tables) {
      const columns = (
        db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>
      ).map((row) => row.name);

      hash.update(`T:${table}:${columns.join(",")}\n`);
      if (columns.length === 0) continue;

      const order = columns.map((column) => quoteIdentifier(column)).join(", ");
      const select = `SELECT ${columns.map((c) => quoteIdentifier(c)).join(", ")} FROM ${quoteIdentifier(table)} ORDER BY ${order}`;
      const rows = db.prepare(select).all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        totalRows += 1;
        for (const column of columns) {
          hash.update(encodeValue(row[column]));
        }
        hash.update("\u0000R\n");
      }
    }

    return { digest: hash.digest("hex"), tableCount: tables.length, totalRows };
  } finally {
    db.close();
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Length-prefixed, type-tagged encoding.
 *
 * The tag keeps `NULL`, the empty string and the number 0 from colliding, and
 * the length prefix keeps `"ab" + "c"` from hashing the same as `"a" + "bc"`.
 */
function encodeValue(value: unknown): string {
  if (value === null || value === undefined) return "n:\n";
  if (typeof value === "number") return `d:${String(value)}\n`;
  if (typeof value === "bigint") return `i:${value.toString()}\n`;
  if (value instanceof Uint8Array) {
    const hex = Buffer.from(value).toString("hex");
    return `b:${hex.length}:${hex}\n`;
  }
  const text = String(value);
  return `s:${text.length}:${text}\n`;
}
