/**
 * PROGRAM STRUCTURE (2026-10-02) — import a program package and publish it, as
 * one checked operation, in the database this process is configured for.
 *
 *   tsx scripts/ops/activateProgramVersion.ts \
 *     --package curriculum/packages/ata-v2-funnel-30.v5.draft.json \
 *     --expect-fingerprint <64 hex> \
 *     --expect-published-version 4 \      (or `none` — see 2. below)
 *     --actor-user-id <an active admin> \
 *     [--backup /abs/path/to/backup.sqlite --apply]
 *
 * WHY THIS IS NOT `curriculum:package:import`. That command refuses a runtime
 * database unless it is handed an activation manifest — a mechanism built for
 * one activation (G2, migration lineage 41→46, an editorial overlay) whose
 * stages are written into it. And it never publishes: every publication on
 * PREPROD so far was done by scripts kept outside the repository. This command
 * is the reviewed, source-controlled way to do both, for a package whose
 * resources already ship `published` and therefore needs no overlay.
 *
 * WITHOUT `--apply` IT ONLY PLANS. It validates the package, checks every
 * expectation below against the live database and prints what it would do.
 *
 * WHAT MUST BE TRUE BEFORE IT WRITES ANYTHING
 *   1. the package validates and its fingerprint is the one named on the
 *      command line — the operator states which artifact they mean, and a file
 *      that changed since it was reviewed is refused;
 *   2. the currently published version of the package's curriculum is the one
 *      named (`--expect-published-version`), so a publication never replaces a
 *      version the operator was not looking at. On a database where the
 *      curriculum has NEVER been published (a new PROD — the importer refuses a
 *      runtime database, so this is the only reviewed way to its first
 *      version), the operator says so in words: `--expect-published-version
 *      none`. It is refused if any version is in fact published, exactly as a
 *      wrong number is; there is no default that means "whatever is there";
 *   3. the package's version does not exist yet — or exists as a DRAFT imported
 *      from this same package (a run that was interrupted between import and
 *      publication resumes; anything else is refused);
 *   4. the actor is an active admin (the publication audit names them);
 *   5. `--backup` names a readable SQLite file, written in the last 30 minutes,
 *      that passes `integrity_check` and holds the same published version and
 *      the same migrations as the live database — a backup of THIS database,
 *      taken for THIS run. The script never creates or deletes a backup.
 *
 * WHAT IT WRITES: the draft version (the importer, one transaction) and its
 * publication (the curriculum service, one transaction — which archives the
 * replaced version, and refuses a program a learner could not progress
 * through). Nothing else: no learner is enrolled, moved or touched. After each
 * step it compares the learner tables row for row by count and stops if any of
 * them moved.
 *
 * ROLLING BACK is restoring the backup. A published version cannot be
 * unpublished.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { importCurriculumPackage } from "../../src/lib/curriculum/package/import";
import { validateCurriculumPackage } from "../../src/lib/curriculum/package/validate";

class UsageError extends Error {}
class Refusal extends Error {}

const BACKUP_MAX_AGE_MS = 30 * 60 * 1000;

/** Tables no part of an activation may change. Counted before and after each step. */
const LEARNER_TABLES = [
  "User",
  "UserCurriculumEnrollment",
  "UserLevelProgress",
  "XPTransaction",
  "AssessmentAttempt",
  "ReportSubmission",
  "ReportReview",
  "PocketTraderIdentity",
  "CheckpointVerificationAttempt",
  "StagingAttestation",
  "ToolTradeCard",
  "ToolJournalEntry",
] as const;

function flag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
  return value;
}

function positive(raw: string | null, name: string): number {
  if (raw === null || !/^[1-9]\d{0,8}$/.test(raw)) {
    throw new UsageError(`${name} must be a positive integer written in digits`);
  }
  return Number(raw);
}

/** A version number, or `null` for the literal word `none`: "this curriculum has never been published". */
function expectedVersion(raw: string | null, name: string): number | null {
  if (raw === "none") return null;
  if (raw === null || !/^[1-9]\d{0,8}$/.test(raw)) {
    throw new UsageError(`${name} must be a positive integer written in digits, or the word none`);
  }
  return Number(raw);
}

async function learnerCounts(prisma: PrismaClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of LEARNER_TABLES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(`SELECT COUNT(*) AS n FROM "${table}"`);
    counts[table] = Number(rows[0].n);
  }
  return counts;
}

function assertUnchanged(before: Record<string, number>, after: Record<string, number>, step: string) {
  for (const table of LEARNER_TABLES) {
    if (before[table] !== after[table]) {
      throw new Refusal(`${step} changed ${table}: ${before[table]} → ${after[table]}. STOP and restore the backup.`);
    }
  }
}

/** One value out of the backup file, read with the sqlite3 CLI in read-only mode. */
function backupScalar(file: string, sql: string): string {
  return execFileSync("sqlite3", ["-readonly", file, sql], { encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const packagePath = flag(argv, "--package");
  const expectFingerprint = flag(argv, "--expect-fingerprint");
  const backupPath = flag(argv, "--backup");
  if (!packagePath) throw new UsageError("--package is required");
  if (!expectFingerprint || !/^[0-9a-f]{64}$/.test(expectFingerprint)) {
    throw new UsageError("--expect-fingerprint must be the package's 64-hex fingerprint");
  }
  const expectPublished = expectedVersion(flag(argv, "--expect-published-version"), "--expect-published-version");
  const actorUserId = positive(flag(argv, "--actor-user-id"), "--actor-user-id");
  if (apply && !backupPath) throw new UsageError("--apply requires --backup");

  /* 1. the artifact */
  const raw = JSON.parse(fs.readFileSync(path.resolve(packagePath), "utf8")) as unknown;
  const validation = validateCurriculumPackage(raw);
  if (!validation.ok) {
    throw new Refusal(`the package does not validate: ${validation.issues.map((item) => `${item.code} ${item.path}`).join("; ")}`);
  }
  if (validation.fingerprint !== expectFingerprint) {
    throw new Refusal(`the package's fingerprint is ${validation.fingerprint}, not the one named`);
  }
  const pkg = validation.package;
  const levels = pkg.modules.flatMap((moduleDefinition) => moduleDefinition.levels);

  const prisma = new PrismaClient();
  try {
    /* 2–4. the database it is about to change */
    const migrationRows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
      'SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL',
    );
    const migrations = Number(migrationRows[0].n);
    const programStructure = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
      `SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE "migration_name" = '20261002120000_program_structure' AND "finished_at" IS NOT NULL`,
    );
    if (Number(programStructure[0].n) !== 1) {
      throw new Refusal("migration 20261002120000_program_structure is not applied to this database");
    }
    const published = await prisma.curriculumVersion.findFirst({
      where: { code: pkg.curriculumCode, status: "published" },
      select: { id: true, versionNumber: true },
    });
    if ((published?.versionNumber ?? null) !== expectPublished) {
      throw new Refusal(
        `the published version of ${pkg.curriculumCode} is ${published?.versionNumber ?? "none"}, not ${expectPublished ?? "none"}`,
      );
    }
    const existing = await prisma.curriculumVersion.findUnique({
      where: { code_versionNumber: { code: pkg.curriculumCode, versionNumber: pkg.curriculumVersionNumber } },
      select: { id: true, status: true, changeNotes: true },
    });
    const marker = `ata-package:${pkg.packageCode}@${pkg.packageRevision}:${validation.fingerprint}`;
    if (existing && (existing.status !== "draft" || existing.changeNotes !== marker)) {
      throw new Refusal(
        `${pkg.curriculumCode} version ${pkg.curriculumVersionNumber} already exists as ${existing.status} and is not a draft of this package`,
      );
    }
    const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { role: true, status: true } });
    if (!actor || actor.role !== "admin" || actor.status !== "active") {
      throw new Refusal(`user ${actorUserId} is not an active admin`);
    }
    const enrollments = await prisma.userCurriculumEnrollment.groupBy({
      by: ["curriculumVersionId", "status"],
      _count: { _all: true },
    });

    const plan = {
      mode: apply ? "apply" : "plan",
      package: {
        path: packagePath,
        code: `${pkg.packageCode}@${pkg.packageRevision}`,
        fingerprint: validation.fingerprint,
        curriculum: `${pkg.curriculumCode}@${pkg.curriculumVersionNumber}`,
        modules: pkg.modules.length,
        levels: levels.length,
        openLevels: levels.filter((level) => level.status !== "disabled").length,
        pendingApprovals: pkg.pendingApprovals.length,
      },
      database: {
        migrations,
        publishedVersion: published?.versionNumber ?? null,
        draftAlreadyImported: Boolean(existing),
        enrollments: enrollments.map((row) => ({
          curriculumVersionId: row.curriculumVersionId,
          status: row.status,
          learners: row._count._all,
        })),
      },
      willDo: [
        ...(existing ? [] : [`import ${pkg.curriculumCode}@${pkg.curriculumVersionNumber} as a draft`]),
        published
          ? `publish it and archive version ${published.versionNumber}`
          : `publish it as the first published version of ${pkg.curriculumCode} (nothing to archive)`,
        "leave every learner on the version they are on",
      ],
    };

    if (!apply) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    /* 5. the backup */
    const backup = path.resolve(backupPath!);
    const backupStat = fs.statSync(backup);
    if (!backupStat.isFile() || backupStat.size <= 0) throw new Refusal(`${backup} is not a non-empty file`);
    if (Date.now() - backupStat.mtimeMs > BACKUP_MAX_AGE_MS) {
      throw new Refusal(`${backup} is older than 30 minutes; take a backup for this run`);
    }
    if (backupScalar(backup, "PRAGMA integrity_check;") !== "ok") throw new Refusal(`${backup} fails integrity_check`);
    const backupMigrations = Number(
      backupScalar(backup, 'SELECT COUNT(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL;'),
    );
    const backupPublished = backupScalar(
      backup,
      `SELECT "versionNumber" FROM "CurriculumVersion" WHERE "code" = '${pkg.curriculumCode.replace(/'/g, "")}' AND "status" = 'published';`,
    );
    const backupUsers = Number(backupScalar(backup, 'SELECT COUNT(*) FROM "User";'));
    const before = await learnerCounts(prisma);
    const backupPublishedMatches = published ? Number(backupPublished) === published.versionNumber : backupPublished === "";
    if (backupMigrations !== migrations || !backupPublishedMatches || backupUsers !== before.User) {
      throw new Refusal(`${backup} is not a current backup of this database`);
    }

    /* the import */
    let versionId = existing?.id ?? 0;
    let imported: unknown = null;
    if (!existing) {
      const result = await importCurriculumPackage(raw, { db: prisma });
      if (!result.ok) {
        throw new Refusal(`import refused: ${result.code} ${result.issues.map((item) => item.code).join(", ")}`);
      }
      imported = result.summary.counts;
      const created = await prisma.curriculumVersion.findUniqueOrThrow({
        where: { code_versionNumber: { code: pkg.curriculumCode, versionNumber: pkg.curriculumVersionNumber } },
        select: { id: true },
      });
      versionId = created.id;
      assertUnchanged(before, await learnerCounts(prisma), "the import");
    }

    /* the publication — imported lazily: the service reads DATABASE_URL at load. */
    const { publishCurriculumVersion } = await import("../../src/lib/curriculum/service");
    const publication = await publishCurriculumVersion({
      curriculumVersionId: versionId,
      actorId: actorUserId,
      /* null = "nothing is published"; the service refuses it if that stopped being true. */
      expectedPublishedVersionId: published?.id ?? null,
    });
    assertUnchanged(before, await learnerCounts(prisma), "the publication");

    const now = await prisma.curriculumVersion.findMany({
      where: { code: pkg.curriculumCode },
      select: { versionNumber: true, status: true },
      orderBy: { versionNumber: "asc" },
    });
    console.log(
      JSON.stringify(
        {
          ...plan,
          imported,
          published: { versionNumber: publication.published.versionNumber, replaced: publication.replaced?.versionNumber ?? null },
          versions: now,
          learnerTablesUnchanged: true,
          backup,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  if (error instanceof UsageError) console.error(`usage: ${error.message}`);
  else if (error instanceof Refusal) console.error(`REFUSED: ${error.message}`);
  else console.error(error);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
