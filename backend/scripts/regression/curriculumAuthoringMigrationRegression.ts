/**
 * PHASE-G0 — the migration-upgrade regression.
 *
 * The foundation suite proves the model on a database built from the FULL
 * chain. This one proves the harder and more important thing: that an existing
 * database — one that already carries published content, learner progress and
 * XP — survives the upgrade unchanged and gains no fabricated editorial claim.
 *
 * HOW. The chain is applied in two halves against ONE disposable database:
 *   1. every migration BEFORE 20260808000000_authoring_foundation
 *   2. seed realistic pre-Phase-G data through that older schema
 *   3. apply ONLY the authoring-foundation migration
 *   4. assert every seeded row is byte-identical, and that the new columns
 *      defaulted honestly
 *
 * Step 1 is what makes this a real upgrade test rather than a fresh install
 * test. Applying the whole chain and then inserting rows would prove nothing
 * about ALTER TABLE against populated tables.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-authoring-migration-${process.pid}.db`);
const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");
const G0 = "20260808000000_authoring_foundation";
const CORRECTION = "20260808120000_authoring_foundation_corrections";
const SOURCE_AUTHORITY = "20260810000000_source_authority_resolution";
const SUCCESSOR_LINEAGE = "20260811000000_assessment_successor_lineage";
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, ok: false, error: message });
    console.error(`FAIL ${name}`);
    console.error(message);
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** The same splitter prisma/migrate.ts uses, so this runs what the runner runs. */
function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function applyMigration(db: Database.Database, name: string) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  db.exec("BEGIN");
  try {
    db.prepare(
      'INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","started_at","applied_steps_count") VALUES (?,?,?,CURRENT_TIMESTAMP,0)',
    ).run(crypto.randomUUID(), checksum, name);
    for (const statement of statements(sql)) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`migration ${name} failed: ${String(error)}`);
  }
}

function main() {
  cleanup();
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);

  const all = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const g0Index = all.indexOf(G0);
  assert.ok(g0Index >= 0, "the authoring-foundation migration must exist");
  // PHASE-G0 CORRECTION — G0 is no longer the last link. It is now followed by
  // exactly the correction migration, and this suite still proves the G0 UPGRADE
  // in isolation: everything before G0, then G0 alone, against populated tables.
  // The correction's own upgrade is proven by the corrections suite, and the
  // combined chain is proven by both.
  // PHASE-G2 appended the source-authority resolution table, and PHASE-G2
  // SUCCESSOR appended the assessment lineage column. The list stays EXACT
  // rather than becoming a prefix match: an unexpected migration landing after
  // G0 is precisely what this assertion exists to catch, and loosening it to
  // "starts with" would retire the check the first time it mattered. Declaring
  // each new migration here by name is the intended cost of that strictness.
  const after = all.slice(g0Index + 1);
  assert.deepEqual(
    after,
    [CORRECTION, SOURCE_AUTHORITY, SUCCESSOR_LINEAGE],
    "G0 must be followed by exactly the authoring-foundation correction, the source-authority table, then the successor lineage column",
  );

  const before = all.slice(0, g0Index);

  try {
    check("1 the pre-Phase-G chain applies to an empty database", () => {
      for (const name of before) applyMigration(db, name);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const names = new Set(tables.map((row) => row.name));
      assert.ok(names.has("ContentVersion"));
      assert.ok(names.has("AssessmentVersion"));
      // The G0 entities must NOT exist yet — otherwise this is not an upgrade.
      assert.ok(!names.has("VideoProductionVersion"));
      assert.ok(!names.has("EditorialReviewNote"));
      assert.ok(!names.has("AuthoringPreviewSnapshot"));
    });

    check("2 the OLD schema has none of the new columns", () => {
      for (const table of ["ContentVersion", "AssessmentVersion"]) {
        const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
        const names = new Set(columns.map((column) => column.name));
        for (const added of ["revision", "editorialState", "approvedById", "lastAuthoredById"]) {
          assert.ok(!names.has(added), `${table}.${added} must not exist before the migration`);
        }
      }
    });

    let seeded: {
      publishedContentId: number;
      draftContentId: number;
      assessmentId: number;
      questionId: number;
      xpId: number;
    };

    check("3 seed realistic pre-Phase-G data through the OLD schema", () => {
      db.prepare(
        `INSERT INTO "User" ("id","email","name","role","status","updatedAt") VALUES (1,'legacy@example.com','Legacy','admin','active',CURRENT_TIMESTAMP)`,
      ).run();
      db.prepare(
        `INSERT INTO "User" ("id","email","name","role","status","updatedAt") VALUES (2,'learner@example.com','Learner','user','active',CURRENT_TIMESTAMP)`,
      ).run();
      db.prepare(
        `INSERT INTO "CurriculumVersion" ("id","code","name","versionNumber","status","createdAt","publishedAt") VALUES (1,'legacy','Legacy',1,'published',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ).run();
      db.prepare(
        `INSERT INTO "ModuleDefinition" ("id","curriculumVersionId","moduleNumber","code","title","firstLevel","lastLevel") VALUES (1,1,1,'m1','Module 1',1,2)`,
      ).run();
      for (const [id, n] of [[1, 1], [2, 2]]) {
        db.prepare(
          `INSERT INTO "LevelDefinition" ("id","curriculumVersionId","moduleId","levelNumber","stableCode","type","title","completionMethod")
           VALUES (?,1,1,?,?,'lesson',?, 'manual')`,
        ).run(id, n, `v2.l00${n}.legacy`, `Level ${n}`);
      }
      db.prepare(
        `INSERT INTO "UserCurriculumEnrollment" ("id","userId","curriculumVersionId","curriculumCode","status","updatedAt")
         VALUES (1,2,1,'legacy','active',CURRENT_TIMESTAMP)`,
      ).run();

      // A PUBLISHED content version — the row whose meaning must not change.
      db.prepare(
        `INSERT INTO "ContentVersion" ("id","levelDefinitionId","curriculumVersionId","versionNumber","status","publishedAt","createdById","createdAt","updatedAt","changeNotes")
         VALUES (1,1,1,1,'published',CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'shipped long ago')`,
      ).run();
      db.prepare(
        `INSERT INTO "ContentLocalization" ("id","contentVersionId","locale","title","subtitle","learningObjectiveExtension","summary","body","createdAt","updatedAt")
         VALUES (1,1,'ru','Живой урок','','','','{"sections":[]}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ).run();
      db.prepare(
        `INSERT INTO "ContentVersion" ("id","levelDefinitionId","curriculumVersionId","versionNumber","status","createdById","createdAt","updatedAt")
         VALUES (2,2,1,1,'draft',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ).run();
      db.prepare(
        `INSERT INTO "AssessmentVersion" ("id","levelDefinitionId","curriculumVersionId","versionNumber","status","passPercent","publishedAt","createdById","createdAt","updatedAt")
         VALUES (1,1,1,1,'published',75,CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ).run();
      db.prepare(
        `INSERT INTO "QuestionDefinition" ("id","assessmentVersionId","questionNumber","stableKey","type","status","options","correctAnswer","createdAt","updatedAt")
         VALUES (1,1,1,'T1.1','single_choice','active','["a","b","c","d"]','"a"',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ).run();
      db.prepare(
        `INSERT INTO "XPTransaction" ("id","userId","enrollmentId","curriculumVersionId","levelDefinitionId","sourceType","idempotencyKey","payloadFingerprint","amount","createdAt")
         VALUES (1,2,1,1,1,'level_completion','legacy-xp-1','fp-legacy-1',100,CURRENT_TIMESTAMP)`,
      ).run();

      seeded = {
        publishedContentId: 1,
        draftContentId: 2,
        assessmentId: 1,
        questionId: 1,
        xpId: 1,
      };
      assert.ok(seeded.publishedContentId);
    });

    const fingerprintBefore = () =>
      JSON.stringify({
        content: db.prepare(`SELECT * FROM "ContentVersion" ORDER BY id`).all(),
        localizations: db.prepare(`SELECT * FROM "ContentLocalization" ORDER BY id`).all(),
        assessments: db.prepare(`SELECT * FROM "AssessmentVersion" ORDER BY id`).all(),
        questions: db.prepare(`SELECT * FROM "QuestionDefinition" ORDER BY id`).all(),
        xp: db.prepare(`SELECT * FROM "XPTransaction" ORDER BY id`).all(),
      });

    let snapshotBefore = "";
    check("4 capture the pre-migration state", () => {
      snapshotBefore = fingerprintBefore();
      assert.ok(snapshotBefore.length > 0);
    });

    check("5 THE AUTHORING-FOUNDATION MIGRATION APPLIES TO THE POPULATED DATABASE", () => {
      applyMigration(db, G0);
      const applied = db
        .prepare('SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name" = ?')
        .get(G0);
      assert.ok(applied, "the migration must be recorded");
    });

    check("6 every pre-existing row survives with its old columns untouched", () => {
      // The added columns are excluded from the comparison because they are the
      // change. Every column that existed BEFORE must be identical.
      const oldColumns = JSON.parse(snapshotBefore) as Record<string, Array<Record<string, unknown>>>;
      const now = JSON.parse(fingerprintBefore()) as Record<string, Array<Record<string, unknown>>>;

      for (const table of Object.keys(oldColumns)) {
        assert.equal(now[table].length, oldColumns[table].length, `${table} row count changed`);
        for (const [index, oldRow] of oldColumns[table].entries()) {
          for (const [column, value] of Object.entries(oldRow)) {
            assert.deepEqual(
              now[table][index][column],
              value,
              `${table}[${index}].${column} changed during the migration`,
            );
          }
        }
      }
    });

    check("7 NO HISTORICAL ROW GAINED A FABRICATED APPROVAL", () => {
      const rows = db
        .prepare(
          `SELECT "id","status","editorialState","revision","approvedById","approvedAt","submittedById","lastAuthoredById" FROM "ContentVersion" ORDER BY id`,
        )
        .all() as Array<Record<string, unknown>>;
      assert.equal(rows.length, 2);

      const published = rows.find((row) => row.status === "published")!;
      // The runtime axis is exactly as it was.
      assert.equal(published.status, "published");
      // The editorial axis makes NO claim. This is the whole point of the
      // default: a published row that nobody ever reviewed must not read as
      // approved, or the ATA-100 package's 154 open gaps would close themselves.
      assert.equal(published.editorialState, "draft");
      assert.equal(published.approvedById, null);
      assert.equal(published.approvedAt, null);
      assert.equal(published.submittedById, null);
      assert.equal(published.lastAuthoredById, null);
      assert.equal(published.revision, 1);

      const assessments = db
        .prepare(`SELECT "status","editorialState","approvedById","revision" FROM "AssessmentVersion"`)
        .all() as Array<Record<string, unknown>>;
      for (const row of assessments) {
        assert.equal(row.editorialState, "draft");
        assert.equal(row.approvedById, null);
        assert.equal(row.revision, 1);
      }

      const approvedAnywhere = db
        .prepare(
          `SELECT COUNT(*) AS n FROM "ContentVersion" WHERE "editorialState" = 'approved'
           UNION ALL SELECT COUNT(*) FROM "AssessmentVersion" WHERE "editorialState" = 'approved'`,
        )
        .all() as Array<{ n: number }>;
      for (const row of approvedAnywhere) assert.equal(row.n, 0);
    });

    check("8 the new tables exist and enforce their integrity", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const names = new Set(tables.map((row) => row.name));
      assert.ok(names.has("VideoProductionVersion"));
      assert.ok(names.has("EditorialReviewNote"));
      assert.ok(names.has("AuthoringPreviewSnapshot"));

      // The exactly-one-target rule is a DATABASE constraint, not a convention.
      assert.throws(() =>
        db
          .prepare(
            `INSERT INTO "EditorialReviewNote" ("contentVersionId","assessmentVersionId","targetRevision","body","authorId") VALUES (1,1,1,'two',1)`,
          )
          .run(),
      );
      assert.throws(() =>
        db
          .prepare(
            `INSERT INTO "EditorialReviewNote" ("targetRevision","body","authorId") VALUES (1,'none',1)`,
          )
          .run(),
      );
      // Exactly one target is accepted.
      db.prepare(
        `INSERT INTO "EditorialReviewNote" ("contentVersionId","targetRevision","body","authorId") VALUES (1,1,'one target',1)`,
      ).run();

      // An approved video row must carry its approver.
      assert.throws(() =>
        db
          .prepare(
            `INSERT INTO "VideoProductionVersion" ("levelDefinitionId","curriculumVersionId","versionNumber","editorialState","levelNumber","contractVersion","sourceProvenance","scriptState","videoState","qaState","contractPayload","contractFingerprint","assessmentFingerprint")
             VALUES (1,1,1,'approved',1,1,'SOURCE_BACKED','SCRIPT_PENDING','NOT_RECORDED','QA_PENDING','{}',?,?)`,
          )
          .run("a".repeat(64), "b".repeat(64)),
      );
    });

    check("9 learner and runtime data is completely untouched", () => {
      const xp = db.prepare(`SELECT * FROM "XPTransaction"`).all() as Array<Record<string, unknown>>;
      assert.equal(xp.length, 1);
      assert.equal(xp[0].amount, 100);
      const localization = db
        .prepare(`SELECT "title" FROM "ContentLocalization" WHERE id = 1`)
        .get() as { title: string };
      assert.equal(localization.title, "Живой урок");
    });

    check("10 the G0 upgrade is contiguous up to and including G0", () => {
      const applied = db
        .prepare('SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "migration_name"')
        .all() as Array<{ migration_name: string }>;
      // PHASE-G0 CORRECTION — this suite deliberately stops AT G0, which is what
      // makes it a real upgrade test of G0 alone against populated tables. The
      // links after it are applied and proven by the corrections suite.
      assert.deepEqual(
        applied.map((row) => row.migration_name),
        all.slice(0, g0Index + 1),
        "every migration up to and including G0 must be applied exactly once, in order",
      );
    });
  } finally {
    db.close();
    cleanup();
  }

  if (OUT) {
    fs.writeFileSync(
      OUT,
      JSON.stringify({ suite: "g0-authoring-migration", passed, failed, results }, null, 2),
    );
  }

  console.log(`\nPHASE-G0 authoring migration upgrade: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error);
  cleanup();
  process.exit(1);
}
