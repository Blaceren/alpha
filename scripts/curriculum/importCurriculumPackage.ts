/**
 * Curriculum package CLI (CV-1).
 *
 *   tsx scripts/curriculum/importCurriculumPackage.ts \
 *     --package curriculum/packages/<file>.json \
 *     --database file:/absolute/path/to/synthetic.sqlite \
 *     [--validate-only | --dry-run] [--json]
 *
 * The database target is ALWAYS explicit — there is no default, and the live DEV
 * runtime database is refused outright (CV-1 must never touch it). Nothing is
 * published, activated or enrolled by this command.
 */
import fs from "node:fs";
import path from "node:path";
import { validateCurriculumPackage } from "../../src/lib/curriculum/package/validate";
import { importCurriculumPackage, type ImportSummary } from "../../src/lib/curriculum/package/import";

/** Paths CV-1 refuses to write to under any circumstance. */
const FORBIDDEN_DB_SUBSTRINGS = ["/runtime/ata-dev", "/runtime/ata-suite", "ata-dev.sqlite", "ata-prod"];

type Args = {
  packagePath: string;
  database: string;
  validateOnly: boolean;
  dryRun: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
  };
  const packagePath = get("--package");
  if (!packagePath) throw new Error("--package <file.json> is required");
  const validateOnly = argv.includes("--validate-only");
  const database = get("--database") ?? "";
  if (!validateOnly && !database) throw new Error("--database <url> is required (no default target exists)");
  return {
    packagePath,
    database,
    validateOnly,
    dryRun: argv.includes("--dry-run"),
    json: argv.includes("--json"),
  };
}

/**
 * Refuse anything that is not an explicit local SQLite file, and anything that
 * resolves (including through a symlink) into the live runtime.
 */
export function assertSafeDatabaseUrl(url: string): void {
  if (!url.startsWith("file:")) {
    throw new Error("refusing non-file database URL: only local synthetic SQLite targets are allowed");
  }
  const raw = url.slice("file:".length);
  if (!path.isAbsolute(raw)) {
    throw new Error("refusing relative database path: pass an absolute path");
  }
  const candidates = new Set([path.resolve(raw)]);
  try {
    // Resolve symlinks/aliases; also resolve the parent for not-yet-created files.
    candidates.add(fs.realpathSync(raw));
  } catch {
    try {
      candidates.add(path.join(fs.realpathSync(path.dirname(raw)), path.basename(raw)));
    } catch {
      /* target directory does not exist yet — the resolved path above is enough */
    }
  }
  for (const candidate of candidates) {
    for (const forbidden of FORBIDDEN_DB_SUBSTRINGS) {
      if (candidate.includes(forbidden)) {
        throw new Error(`refusing to operate on a protected database path (${forbidden})`);
      }
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(fs.readFileSync(args.packagePath, "utf8")) as unknown;

  if (args.validateOnly) {
    const result = validateCurriculumPackage(raw);
    if (!result.ok) {
      console.error(args.json ? JSON.stringify({ ok: false, issues: result.issues }, null, 2) : formatIssues(result.issues));
      process.exitCode = 1;
      return;
    }
    const payload = { ok: true, fingerprint: result.fingerprint, status: result.package.status, warnings: result.warnings };
    console.log(args.json ? JSON.stringify(payload, null, 2) : `ok  fingerprint=${result.fingerprint}  warnings=${result.warnings.length}`);
    return;
  }

  assertSafeDatabaseUrl(args.database);
  process.env.DATABASE_URL = args.database;

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: args.database } } });
  try {
    const result = await importCurriculumPackage(raw, { db, dryRun: args.dryRun });
    if (!result.ok) {
      console.error(args.json ? JSON.stringify(result, null, 2) : `${result.code}\n${formatIssues(result.issues)}`);
      process.exitCode = 1;
      return;
    }
    console.log(args.json ? JSON.stringify(result.summary, null, 2) : formatSummary(result.summary));
  } finally {
    await db.$disconnect();
  }
}

function formatIssues(issues: Array<{ code: string; path: string; message: string }>): string {
  return issues.map((i) => `  ${i.code}  ${i.path}: ${i.message}`).join("\n");
}

function formatSummary(summary: ImportSummary): string {
  const counts = Object.entries(summary.counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return [
    `outcome=${summary.outcome} status=${summary.curriculumVersionStatus}`,
    `fingerprint=${summary.fingerprint}`,
    counts,
    ...summary.notes.map((n) => `note: ${n}`),
    ...summary.warnings.map((w) => `warn: ${w.code} ${w.path}`),
  ].join("\n");
}

// Only run when invoked directly, so the guard can be unit-tested by importing.
if (process.argv[1] && process.argv[1].endsWith("importCurriculumPackage.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
