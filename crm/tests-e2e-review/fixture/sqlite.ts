/**
 * Minimal SQLite access for the reviewer fixture.
 *
 * Queries run through a short `python3` subprocess rather than `node:sqlite`,
 * matching what `tests-e2e-review/support/helpers.ts` already does: that module is
 * experimental and ships no type declarations in this toolchain, and adding a
 * native driver would mean a dependency this phase must not install.
 *
 * `readOnly` opens the file with `mode=ro`, so observation can never mutate the
 * fixture it is observing. `exec` is the seeder's only write path and is used
 * exclusively against a database this run created.
 */
import { execFileSync } from "node:child_process";

export function query(databaseFile: string, sql: string, params: Array<string | number> = []): unknown[][] {
  const script = [
    "import json,sqlite3,sys",
    "conn = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)",
    "print(json.dumps([list(r) for r in conn.execute(sys.argv[2], json.loads(sys.argv[3]))]))",
  ].join("\n");
  const out = execFileSync("python3", ["-c", script, databaseFile, sql, JSON.stringify(params)], {
    encoding: "utf8",
  });
  return JSON.parse(out) as unknown[][];
}

export function scalar(databaseFile: string, sql: string, params: Array<string | number> = []): unknown {
  const rows = query(databaseFile, sql, params);
  const first = rows[0];
  if (!first) throw new Error(`query returned no rows: ${sql}`);
  return first[0];
}

/** Run a write script as ONE transaction: a half-seeded database is worse than none. */
export function exec(databaseFile: string, sqlScript: string): void {
  const script = [
    "import sqlite3,sys",
    "conn = sqlite3.connect(sys.argv[1])",
    "conn.execute('PRAGMA foreign_keys = ON')",
    "conn.executescript(sys.argv[2])",
    "conn.commit()",
    "conn.close()",
  ].join("\n");
  execFileSync("python3", ["-c", script, databaseFile, sqlScript], { encoding: "utf8" });
}

/** SQL string literal with quotes escaped. Values here are fixture-authored, never user input. */
export function lit(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${value.replace(/'/g, "''")}'`;
}
