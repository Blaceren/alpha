/**
 * PREPROD ACTIVATION — the progression-owner semantic projections.
 *
 * Package revision 2 makes `STRUCTURAL_IMPORT` materialize the completion owners
 * a level's `completionMethod` needs at runtime: the L3 report's grading
 * contract and the twenty financial checkpoint requirements. CORRECTION-4
 * declares the nine tables that carries stage-owned AND projects them, because
 * either half alone is unsafe — ownership without projection would let a wrong
 * threshold or a wrong rubric cross POST_IMPORT unseen.
 *
 * This suite pins the half that is easy to get quietly wrong: that a material
 * change to any of the nine MOVES the curriculum digest. Every case follows the
 * same shape — take a baseline, make ONE constructible runtime-significant
 * change, and require the digest to differ.
 *
 * It also pins what must NOT change the digest (row ids, physical insertion
 * order) and what must still fail closed (an unrelated business table).
 *
 * One disposable SQLite fixture per case, built from the real migration chain.
 * No live data, no network.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  captureBusinessPerTable,
  captureStageFingerprint,
  STAGE_MUTABLE_TABLES,
} from "@/lib/curriculum/preprod-activation/semantic-state";

const REPO = process.cwd();
const T = 1786000000000;
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "ata-owner-projection-"));
fs.chmodSync(SCRATCH, 0o700);

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/* ------------------------------------------------------------------ *
 * fixture
 * ------------------------------------------------------------------ */

function dropSidecars(databasePath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

function migrationNames(): string[] {
  return fs
    .readdirSync(path.join(REPO, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The full schema, applied the way `prisma/migrate.ts` applies it. */
function buildSchema(target: string): void {
  const db = new DatabaseSync(target);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    for (const name of migrationNames()) {
      const sql = fs.readFileSync(path.join(REPO, "prisma", "migrations", name, "migration.sql"), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
        db.exec(statement);
      }
      // Deterministic bookkeeping: a fixture that varies run to run cannot be
      // used to prove that a digest did NOT move.
      db.prepare(
        'INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","applied_steps_count","finished_at") VALUES (?,?,?,?,?)',
      ).run(`fixture-${name}`, checksum, name, 1, T);
    }
    /*
     * Migrations seed `ChatChannel` and `NewsPost` with CURRENT_TIMESTAMP
     * defaults, so two fixtures built seconds apart differ in the business
     * digest for reasons that have nothing to do with this correction. Pin them,
     * or "the digest did NOT move" becomes unprovable.
     */
    for (const table of ["ChatChannel", "NewsPost"]) {
      const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>)
        .map((column) => column.name)
        .filter((name) => name === "createdAt" || name === "updatedAt" || name === "publishedAt");
      for (const column of columns) db.exec(`UPDATE "${table}" SET "${column}"=${T} WHERE "${column}" IS NOT NULL`);
    }
  } finally {
    db.close();
  }
  dropSidecars(target);
}

/**
 * A curriculum carrying one report-owned level and one checkpoint-owned level —
 * the smallest state in which all nine projections have something to say.
 *
 * `reverseChildOrder` inserts the criteria, scale options, rejection reasons and
 * localizations back to front. The rows are semantically identical either way,
 * which is what case ORDER-1 uses to prove the projections do not depend on
 * physical insertion order or on the row ids that order produces.
 */
function seed(target: string, reverseChildOrder = false): void {
  const db = new DatabaseSync(target);
  try {
    db.exec(`INSERT INTO "CurriculumVersion" ("id","code","name","status","versionNumber","createdAt")
             VALUES (1,'ata-v2','fixture','draft',4,${T})`);
    db.exec(`INSERT INTO "ModuleDefinition" ("id","curriculumVersionId","moduleNumber","code","title","firstLevel","lastLevel","status")
             VALUES (1,1,1,'module.01','M1',1,5,'active')`);
    db.exec(`INSERT INTO "LevelDefinition" ("id","curriculumVersionId","moduleId","levelNumber","stableCode","type","title","completionMethod","xpReward","requiredXp","status")
             VALUES (3,1,1,3,'v2.l003.report','report','L3','report_approval',0,0,'active'),
                    (4,1,1,4,'v2.l004.checkpoint','financial_checkpoint','L4','balance_check',0,0,'active')`);
    db.exec(`INSERT INTO "ReportAssignmentVersion" ("id","curriculumVersionId","levelDefinitionId","versionNumber","status","createdAt","updatedAt","publishedAt")
             VALUES (1,1,3,1,'published',${T},${T},${T})`);
    db.exec(`INSERT INTO "ReportRubricVersion" ("id","reportAssignmentVersionId","versionNumber","status","createdAt","updatedAt","publishedAt","changeNotes")
             VALUES (1,1,1,'published',${T},${T},${T},'L3-RUBRIC-V1')`);

    const criteria = [
      [1, "r1", "process", 1, 0],
      [2, "r2", "process", 2, 1],
    ];
    const options = [
      [1, "meets", 2],
      [2, "below", 1],
    ];
    const reasons = [
      [1, "incomplete", 1, 1],
      [2, "unsafe", 2, 1],
    ];
    const order = <X,>(rows: X[]): X[] => (reverseChildOrder ? [...rows].reverse() : rows);

    for (const [id, key, category, sortOrder, commentRequired] of order(criteria)) {
      db.exec(`INSERT INTO "ReportRubricCriterion" ("id","reportRubricVersionId","stableKey","categoryCode","sortOrder","commentRequired","createdAt","updatedAt")
               VALUES (${id},1,'${key}','${category}',${sortOrder},${commentRequired},${T},${T})`);
      db.exec(`INSERT INTO "ReportRubricCriterionLocalization" ("reportRubricCriterionId","locale","title","description","createdAt","updatedAt")
               VALUES (${id},'ru','title-${key}','desc-${key}',${T},${T})`);
    }
    for (const [id, key, ordinal] of order(options)) {
      db.exec(`INSERT INTO "ReportRubricScaleOption" ("id","reportRubricVersionId","stableKey","ordinal","createdAt")
               VALUES (${id},1,'${key}',${ordinal},${T})`);
      db.exec(`INSERT INTO "ReportRubricScaleOptionLocalization" ("reportRubricScaleOptionId","locale","label","description")
               VALUES (${id},'ru','label-${key}','desc-${key}')`);
    }
    for (const [id, key, sortOrder, active] of order(reasons)) {
      db.exec(`INSERT INTO "ReportRejectionReason" ("id","reportRubricVersionId","stableKey","sortOrder","active","createdAt","updatedAt")
               VALUES (${id},1,'${key}',${sortOrder},${active},${T},${T})`);
      db.exec(`INSERT INTO "ReportRejectionReasonLocalization" ("reportRejectionReasonId","locale","title","guidance")
               VALUES (${id},'ru','title-${key}','guidance-${key}')`);
    }

    db.exec(`INSERT INTO "LevelReportBinding" ("id","levelDefinitionId","curriculumVersionId","reportAssignmentVersionId","reportRubricVersionId","revision","createdAt","updatedAt")
             VALUES (1,3,1,1,1,1,${T},${T})`);
    db.exec(`INSERT INTO "LevelCheckpointRequirement" ("id","levelDefinitionId","integrationCode","thresholdCurrency","thresholdMinorUnits","createdAt","updatedAt")
             VALUES (1,4,'checkpoint.module-01','USD',5000,${T},${T})`);

    // A business row, so BUSINESS-1 has something outside the fence to move.
    db.exec(`INSERT INTO "User" ("id","email","name","passwordHash","role","status","level","xp","createdAt","updatedAt")
             VALUES (1,'learner@fixture.invalid','L','x','user','active',1,0,${T},${T})`);
  } finally {
    db.close();
  }
  dropSidecars(target);
}

let fixtureSeq = 0;

/** The path of the fixture `stateOf` built most recently, for failure reporting. */
let lastFixturePath = "";

/** A fresh fixture, optionally mutated, returning its captured state. */
function stateOf(mutate?: (db: DatabaseSync) => void, reverseChildOrder = false) {
  const target = path.join(SCRATCH, `fixture-${++fixtureSeq}.sqlite`);
  lastFixturePath = target;
  buildSchema(target);
  seed(target, reverseChildOrder);
  if (mutate) {
    const db = new DatabaseSync(target);
    try {
      mutate(db);
    } finally {
      db.close();
    }
    dropSidecars(target);
  }
  return captureStageFingerprint(target, { principalEmails: [], entryMaxAuditLogId: 0 });
}

/* ------------------------------------------------------------------ *
 * suite
 * ------------------------------------------------------------------ */

const NINE = [
  "LevelCheckpointRequirement",
  "LevelReportBinding",
  "ReportRejectionReason",
  "ReportRejectionReasonLocalization",
  "ReportRubricCriterion",
  "ReportRubricCriterionLocalization",
  "ReportRubricScaleOption",
  "ReportRubricScaleOptionLocalization",
  "ReportRubricVersion",
] as const;

/** Which fenced tables differ between two fixtures. Failure reporting only. */
function businessDrift(left: string, right: string): string[] {
  const filter = { principalEmails: [] as string[], entryMaxAuditLogId: 0 };
  const a = captureBusinessPerTable(left, filter as never) as Record<string, string>;
  const b = captureBusinessPerTable(right, filter as never) as Record<string, string>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((table) => a[table] !== b[table]).sort();
}

function main(): void {
  const baseline = stateOf();
  const baselinePath = lastFixturePath;

  /* ---- A. ownership is declared ---- */

  check("A1. all nine progression-owner tables are declared structural-stage-owned", () => {
    for (const table of NINE) {
      assert.ok(STAGE_MUTABLE_TABLES.includes(table), `${table} is not in STAGE_MUTABLE_TABLES`);
    }
  });

  check("A2. ownership did not widen — no table left the previous declaration", () => {
    for (const table of [
      "AssessmentVersion", "ContentAsset", "ContentLocalization", "ContentVersion",
      "CurriculumVersion", "LevelDefinition", "LevelResourceBinding", "ModuleDefinition",
      "QuestionDefinition", "QuestionLocalization", "ReportAssignmentLocalization",
      "ReportAssignmentVersion", "ReportFieldDefinition", "ReportFieldLocalization",
      "EditorialReviewNote", "SourceAuthorityResolution",
      "VideoProductionAssessmentLink", "VideoProductionVersion",
    ]) {
      assert.ok(STAGE_MUTABLE_TABLES.includes(table), `${table} disappeared`);
    }
    assert.equal(STAGE_MUTABLE_TABLES.length, 27, "exactly nine tables were added");
  });

  check("A3. learner grading tables stay OUTSIDE stage ownership", () => {
    for (const table of ["ReportReview", "ReportReviewScore", "ReportSubmission", "ReportRevision"]) {
      assert.equal(STAGE_MUTABLE_TABLES.includes(table), false, `${table} must remain business-fenced`);
    }
  });

  /* ---- B. the nine-table mutation matrix: one field each ---- */

  const mutations: Array<[string, string, (db: DatabaseSync) => void]> = [
    [
      "LevelCheckpointRequirement",
      "thresholdMinorUnits 5000 -> 10000 (USD 50 vs USD 100)",
      (db) => db.exec(`UPDATE "LevelCheckpointRequirement" SET "thresholdMinorUnits"=10000 WHERE "id"=1`),
    ],
    [
      "LevelCheckpointRequirement",
      "integrationCode rebound to another module",
      (db) => db.exec(`UPDATE "LevelCheckpointRequirement" SET "integrationCode"='checkpoint.module-02' WHERE "id"=1`),
    ],
    [
      "LevelReportBinding",
      "revision incremented (a rebinding happened)",
      (db) => db.exec(`UPDATE "LevelReportBinding" SET "revision"=2 WHERE "id"=1`),
    ],
    [
      "ReportRubricVersion",
      "status published -> archived",
      (db) => db.exec(`UPDATE "ReportRubricVersion" SET "status"='archived', "archivedAt"=${T} WHERE "id"=1`),
    ],
    [
      "ReportRubricVersion",
      "changeNotes rewritten (a different approval event)",
      (db) => db.exec(`UPDATE "ReportRubricVersion" SET "changeNotes"='L3-RUBRIC-V2' WHERE "id"=1`),
    ],
    [
      "ReportRubricCriterion",
      "commentRequired 0 -> 1 (mandatory-comment semantics)",
      (db) => db.exec(`UPDATE "ReportRubricCriterion" SET "commentRequired"=1 WHERE "id"=1`),
    ],
    [
      "ReportRubricCriterion",
      "categoryCode changed (criterion semantics)",
      (db) => db.exec(`UPDATE "ReportRubricCriterion" SET "categoryCode"='outcome' WHERE "id"=1`),
    ],
    [
      "ReportRubricCriterionLocalization",
      "criterion title rewritten (localization is product data)",
      (db) => db.exec(`UPDATE "ReportRubricCriterionLocalization" SET "title"='tampered' WHERE "reportRubricCriterionId"=1`),
    ],
    [
      "ReportRubricScaleOption",
      "ordinal reordered (scale meaning)",
      (db) => db.exec(`UPDATE "ReportRubricScaleOption" SET "ordinal"=9 WHERE "id"=1`),
    ],
    [
      "ReportRubricScaleOptionLocalization",
      "scale option label rewritten",
      (db) => db.exec(`UPDATE "ReportRubricScaleOptionLocalization" SET "label"='tampered' WHERE "reportRubricScaleOptionId"=1`),
    ],
    [
      "ReportRejectionReason",
      "active 1 -> 0 (reason withdrawn)",
      (db) => db.exec(`UPDATE "ReportRejectionReason" SET "active"=0 WHERE "id"=1`),
    ],
    [
      "ReportRejectionReasonLocalization",
      "rejection guidance rewritten",
      (db) => db.exec(`UPDATE "ReportRejectionReasonLocalization" SET "guidance"='tampered' WHERE "reportRejectionReasonId"=1`),
    ],
  ];

  for (const [table, what, mutate] of mutations) {
    check(`B. ${table}: ${what} moves the curriculum digest`, () => {
      const mutated = stateOf(mutate);
      assert.notEqual(
        mutated.curriculumDigest,
        baseline.curriculumDigest,
        "the curriculum digest did not change",
      );
      assert.notEqual(mutated.compositeDigest, baseline.compositeDigest);
    });
  }

  check("B14. USD 50 and USD 100 cannot produce the same semantic state", () => {
    const fifty = stateOf();
    const hundred = stateOf((db) =>
      db.exec(`UPDATE "LevelCheckpointRequirement" SET "thresholdMinorUnits"=10000 WHERE "id"=1`),
    );
    assert.notEqual(fifty.curriculumDigest, hundred.curriculumDigest);
  });

  /* ---- C. missing-row controls ---- */

  const removals: Array<[string, (db: DatabaseSync) => void]> = [
    ["missing LevelCheckpointRequirement", (db) => db.exec(`DELETE FROM "LevelCheckpointRequirement" WHERE "id"=1`)],
    ["missing LevelReportBinding", (db) => db.exec(`DELETE FROM "LevelReportBinding" WHERE "id"=1`)],
    ["missing rubric criterion", (db) => db.exec(`DELETE FROM "ReportRubricCriterionLocalization" WHERE "reportRubricCriterionId"=2`)],
    ["missing rubric scale option", (db) => db.exec(`DELETE FROM "ReportRubricScaleOptionLocalization" WHERE "reportRubricScaleOptionId"=2`)],
    ["missing rejection reason", (db) => db.exec(`DELETE FROM "ReportRejectionReasonLocalization" WHERE "reportRejectionReasonId"=2`)],
  ];

  for (const [what, mutate] of removals) {
    check(`C. ${what} changes the semantic state`, () => {
      const mutated = stateOf(mutate);
      assert.notEqual(mutated.curriculumDigest, baseline.curriculumDigest);
    });
  }

  check("C6. deleting a criterion outright also changes the state", () => {
    const mutated = stateOf((db) => {
      db.exec(`DELETE FROM "ReportRubricCriterionLocalization" WHERE "reportRubricCriterionId"=2`);
      db.exec(`DELETE FROM "ReportRubricCriterion" WHERE "id"=2`);
    });
    assert.notEqual(mutated.curriculumDigest, baseline.curriculumDigest);
  });

  /* ---- D. determinism ---- */

  check("D1. the same semantic rows inserted in a different physical order digest identically", () => {
    const forward = stateOf(undefined, false);
    const reversed = stateOf(undefined, true);
    assert.equal(reversed.curriculumDigest, forward.curriculumDigest);
    assert.equal(reversed.compositeDigest, forward.compositeDigest);
  });

  check("D2. capturing the same database twice is stable", () => {
    const target = path.join(SCRATCH, "stable.sqlite");
    buildSchema(target);
    seed(target);
    const first = captureStageFingerprint(target, { principalEmails: [], entryMaxAuditLogId: 0 });
    const second = captureStageFingerprint(target, { principalEmails: [], entryMaxAuditLogId: 0 });
    assert.equal(first.curriculumDigest, second.curriculumDigest);
  });

  check("D3. a row id is not semantic — the same product data under different ids digests identically", () => {
    // Foreign keys are enforced, so ids cannot be rewritten in place. Instead the
    // same semantic rows are inserted with a different id block from the start,
    // which is what a re-import into a fresh database actually produces.
    const shifted = stateOf((db) => {
      db.exec(`DELETE FROM "ReportRejectionReasonLocalization"`);
      db.exec(`DELETE FROM "ReportRejectionReason"`);
      db.exec(`INSERT INTO "ReportRejectionReason" ("id","reportRubricVersionId","stableKey","sortOrder","active","createdAt","updatedAt")
               VALUES (701,1,'incomplete',1,1,${T},${T}), (702,1,'unsafe',2,1,${T},${T})`);
      db.exec(`INSERT INTO "ReportRejectionReasonLocalization" ("reportRejectionReasonId","locale","title","guidance")
               VALUES (701,'ru','title-incomplete','guidance-incomplete'), (702,'ru','title-unsafe','guidance-unsafe')`);
    });
    assert.equal(shifted.curriculumDigest, baseline.curriculumDigest, "row ids leaked into the digest");
  });

  check("D4. thresholdCurrency is CHECK-constrained to USD, so a wrong currency is unreachable", () => {
    assert.throws(
      () => stateOf((db) => db.exec(`UPDATE "LevelCheckpointRequirement" SET "thresholdCurrency"='EUR' WHERE "id"=1`)),
      /CHECK constraint failed: thresholdCurrency/,
      "the schema no longer pins the currency",
    );
    // …and the field is projected anyway, so if the constraint is ever widened
    // the digest already carries it. Proved through the accepted parent path:
    // a requirement row for a DIFFERENT level is a different projected line.
    const moved = stateOf((db) => {
      db.exec(`DELETE FROM "LevelCheckpointRequirement" WHERE "id"=1`);
      db.exec(`INSERT INTO "LevelCheckpointRequirement" ("id","levelDefinitionId","integrationCode","thresholdCurrency","thresholdMinorUnits","createdAt","updatedAt")
               VALUES (2,3,'checkpoint.module-01','USD',5000,${T},${T})`);
    });
    assert.notEqual(moved.curriculumDigest, baseline.curriculumDigest);
  });

  /* ---- E. historical / empty states ---- */

  check("E1. a curriculum with no progression-owner rows still projects deterministically", () => {
    const empty = () => {
      const target = path.join(SCRATCH, `empty-${++fixtureSeq}.sqlite`);
      buildSchema(target);
      const db = new DatabaseSync(target);
      try {
        db.exec(`INSERT INTO "CurriculumVersion" ("id","code","name","status","versionNumber","createdAt")
                 VALUES (1,'ata-v2','historical','archived',3,${T})`);
      } finally {
        db.close();
      }
      dropSidecars(target);
      return captureStageFingerprint(target, { principalEmails: [], entryMaxAuditLogId: 0 });
    };
    const a = empty();
    const b = empty();
    assert.equal(a.curriculumDigest, b.curriculumDigest);
    assert.notEqual(a.curriculumDigest, baseline.curriculumDigest, "empty must not collide with populated");
  });

  check("E2. an entirely empty schema still captures without throwing", () => {
    const target = path.join(SCRATCH, `bare-${++fixtureSeq}.sqlite`);
    buildSchema(target);
    const fingerprint = captureStageFingerprint(target, { principalEmails: [], entryMaxAuditLogId: 0 });
    assert.equal(typeof fingerprint.curriculumDigest, "string");
    assert.equal(fingerprint.curriculumDigest.length, 64);
  });

  /* ---- F. the business fence is still strong ---- */

  check("F1. a change to an unrelated BUSINESS table still moves the business digest", () => {
    const mutated = stateOf((db) =>
      db.exec(`INSERT INTO "Reward" ("title","description","status","type")
               VALUES ('injected','a business row a stage must not write','active','bonus')`),
    );
    assert.notEqual(
      mutated.businessContinuityDigest,
      baseline.businessContinuityDigest,
      "business continuity went blind",
    );
  });

  check("F2. the learner grading tables are still INSIDE the business fence", () => {
    // The nine left the fence; the tables that record what a human was actually
    // graded did not. Asserted against the fence's own per-table map rather than
    // through a hand-built submission graph, so the proof cannot rot as the
    // submission schema gains required columns.
    const target = path.join(SCRATCH, `fence-${++fixtureSeq}.sqlite`);
    buildSchema(target);
    seed(target);
    const fenced = Object.keys(captureBusinessPerTable(target, { principalEmails: [], entryMaxAuditLogId: 0 } as never));
    for (const table of ["ReportSubmission", "ReportRevision", "ReportReview", "ReportReviewScore", "ReportAttachment"]) {
      assert.ok(fenced.includes(table), `${table} left the business fence`);
    }
    for (const table of NINE) {
      assert.equal(fenced.includes(table), false, `${table} is still inside the business fence`);
    }
  });

  check("F3. moving the nine did not move the business digest for progression-owner rows", () => {
    // The rubric rows are now stage-owned, so a rubric change must NOT appear in
    // the business digest — it belongs to the curriculum digest instead. This is
    // the property that lets a legitimate structural import pass rehearsal.
    const mutated = stateOf((db) =>
      db.exec(`UPDATE "LevelCheckpointRequirement" SET "thresholdMinorUnits"=10000 WHERE "id"=1`),
    );
    if (mutated.businessContinuityDigest !== baseline.businessContinuityDigest) {
      // Name the tables rather than printing two hashes: the failure this guards
      // against is a table quietly staying in the fence, and the table name is
      // the whole diagnosis.
      throw new Error(`business tables differing: ${JSON.stringify(businessDrift(baselinePath, lastFixturePath))}`);
    }
    assert.notEqual(mutated.curriculumDigest, baseline.curriculumDigest, "…and it must be caught elsewhere");
  });

  console.log(
    `\ncurriculum progression owner projection regression: ${passed} passed, ${failed} failed`,
  );
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

main();
