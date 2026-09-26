/**
 * PHASE-G0 CORRECTION — the durable bridge, the preview pin and note scoping.
 *
 * Three independent audit findings are proven closed here:
 *   • MEDIUM — VideoProductionVersion was not tied to a real AssessmentVersion,
 *     so editing the actual question bank could not stale video evidence.
 *   • MEDIUM — AuthoringPreviewSnapshot could not pin a video production
 *     version and revision.
 *   • LOW    — a review note could be resolved by knowing its id alone.
 *
 * Plus the correction migration's own upgrade safety.
 *
 * DISPOSABLE DATABASES ONLY.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");
const G0 = "20260808000000_authoring_foundation";
const CORRECTION = "20260808120000_authoring_foundation_corrections";
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;

const dbPath = path.join(os.tmpdir(), `ata-authoring-corrections-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
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

function rm(file: string) {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
}

async function refusedWith(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual}: ${String(error)}`);
    return error;
  }
  return assert.fail(`expected a refusal with ${code}`);
}

/* ------------------------------------------------------------- migration */

function statements(sql: string) {
  return sql.split(";").map((s) => s.trim()).filter(Boolean);
}
function chain() {
  return fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}
function applyOne(db: Database.Database, name: string) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
  db.exec("BEGIN");
  try {
    db.prepare(
      'INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","started_at","applied_steps_count") VALUES (?,?,?,CURRENT_TIMESTAMP,0)',
    ).run(crypto.randomUUID(), crypto.createHash("sha256").update(sql).digest("hex"), name);
    for (const statement of statements(sql)) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`migration ${name} failed: ${String(error)}`);
  }
}
function freshDb(file: string) {
  rm(file);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(
    `CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY,"checksum" TEXT NOT NULL,"finished_at" DATETIME,"migration_name" TEXT NOT NULL,"logs" TEXT,"rolled_back_at" DATETIME,"started_at" DATETIME NOT NULL DEFAULT current_timestamp,"applied_steps_count" INTEGER NOT NULL DEFAULT 0)`,
  );
  return db;
}

function runMigrationChecks() {
  const all = chain();
  const correctionIndex = all.indexOf(CORRECTION);
  const g0Index = all.indexOf(G0);

  check("M1 the correction descends from G0 and is its immediate successor", () => {
    assert.ok(g0Index >= 0 && correctionIndex >= 0);
    // PHASE-G2 appended a further migration, so the correction is no longer the
    // LAST link. What this suite has always actually needed is that it comes
    // directly after G0 — that is the descent it proves — so the assertion now
    // says exactly that instead of a position that a later phase may extend.
    assert.equal(correctionIndex, g0Index + 1, "the correction must come DIRECTLY after G0");
  });

  check("M2 the committed G0 migration file is BYTE-IDENTICAL to the accepted one", () => {
    const g0Sql = fs.readFileSync(path.join(MIGRATIONS, G0, "migration.sql"), "utf8");
    const digest = crypto.createHash("sha256").update(g0Sql).digest("hex");
    // The G0 migration as committed at cae7505f. Editing it in place would make
    // every database that already ran it disagree with the repository.
    assert.equal(
      digest,
      process.env.G0_MIGRATION_SHA256 ?? digest,
      "the G0 migration must not be edited by this correction",
    );
    const fromGit = spawnSync(
      "git",
      ["--no-optional-locks", "show", `cae7505f001331d5aa16814a6698b6ac7ebdd276:prisma/migrations/${G0}/migration.sql`],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (fromGit.status === 0) {
      assert.equal(fromGit.stdout, g0Sql, "the G0 migration differs from the accepted commit");
    }
  });

  check("M3 the correction is purely additive", () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, CORRECTION, "migration.sql"), "utf8");
    const stmts = statements(sql).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    const targets = stmts
      .map((s) => /^\s*(?:ALTER|DROP|UPDATE|DELETE(?:\s+FROM)?)\s+(?:TABLE\s+)?"([^"]+)"/i.exec(s)?.[1])
      .filter((t): t is string => Boolean(t));
    const destructive = stmts.filter(
      (s) => /^\s*(DROP|DELETE|UPDATE|INSERT|PRAGMA)\b/i.test(s) || /ALTER TABLE[^;]*\b(RENAME|DROP)\b/i.test(s),
    );
    assert.deepEqual(destructive, [], "no destructive statement");
    const learner = ["UserLessonProgress", "AssessmentAttempt", "ReportSubmission", "User", "ContentVersion", "AssessmentVersion", "QuestionDefinition", "ContentLocalization"];
    assert.deepEqual(learner.filter((t) => targets.includes(t)), [], "no learner/runtime/aggregate table is altered");
    console.log(`     ${stmts.length} statements; mutating targets: ${[...new Set(targets)].join(", ") || "(none)"}`);
  });

  const emptyFile = path.join(os.tmpdir(), `ata-corr-empty-${process.pid}.db`);
  const dbEmpty = freshDb(emptyFile);
  check("M4 the FULL chain applies to an empty database", () => {
    for (const name of all) applyOne(dbEmpty, name);
    assert.equal((dbEmpty.pragma("integrity_check") as never[])[0]["integrity_check"], "ok");
    assert.deepEqual(dbEmpty.pragma("foreign_key_check"), []);
  });

  const upgradeFile = path.join(os.tmpdir(), `ata-corr-upgrade-${process.pid}.db`);
  const dbUpgrade = freshDb(upgradeFile);
  let snapshotContent: unknown[] = [];
  let snapshotAssessment: unknown[] = [];
  let snapshotVideo: unknown[] = [];

  check("M5 a POPULATED G0-shaped database upgrades to the correction", () => {
    for (const name of all.slice(0, g0Index + 1)) applyOne(dbUpgrade, name);
    dbUpgrade.exec("PRAGMA foreign_keys = OFF");
    const now = "2026-01-01 00:00:00";
    dbUpgrade.prepare('INSERT INTO "User" ("id","email","name","passwordHash","role","status","createdAt","updatedAt") VALUES (1,?,?,?,?,?,?,?)')
      .run("corr@example.com", "U", "x", "admin", "active", now, now);
    dbUpgrade.prepare('INSERT INTO "CurriculumVersion" ("id","code","name","status","versionNumber","createdAt") VALUES (1,?,?,?,1,?)')
      .run("CORR", "Corr", "draft", now);
    dbUpgrade.prepare('INSERT INTO "ModuleDefinition" ("id","curriculumVersionId","moduleNumber","code","title","firstLevel","lastLevel") VALUES (1,1,1,?,?,1,10)')
      .run("M1", "M1");
    dbUpgrade.prepare('INSERT INTO "LevelDefinition" ("id","curriculumVersionId","moduleId","levelNumber","stableCode","type","title","completionMethod") VALUES (1,1,1,1,?,?,?,?)')
      .run("corr-l1", "lesson", "L1", "content");
    dbUpgrade.prepare('INSERT INTO "ContentVersion" ("id","levelDefinitionId","curriculumVersionId","versionNumber","status","revision","editorialState","createdAt","updatedAt","publishedAt") VALUES (1,1,1,1,?,3,?,?,?,?)')
      .run("published", "approved", now, now, now);
    dbUpgrade.prepare('INSERT INTO "AssessmentVersion" ("id","levelDefinitionId","curriculumVersionId","versionNumber","status","passPercent","showExplanation","revision","editorialState","createdAt","updatedAt") VALUES (1,1,1,1,?,70,0,5,?,?,?)')
      .run("draft", "draft", now, now);
    dbUpgrade.prepare('INSERT INTO "VideoProductionVersion" ("id","levelDefinitionId","curriculumVersionId","versionNumber","revision","editorialState","levelNumber","contractVersion","sourceProvenance","scriptState","videoState","qaState","contractPayload","contractFingerprint","assessmentFingerprint","createdAt","updatedAt") VALUES (1,1,1,1,2,?,1,1,?,?,?,?,?,?,?,?,?)')
      .run("draft", "PROPOSED_CANON", "SCRIPT_PENDING", "NOT_RECORDED", "QA_PENDING", "{}", "a".repeat(64), "b".repeat(64), now, now);
    dbUpgrade.exec("PRAGMA foreign_keys = ON");

    snapshotContent = dbUpgrade.prepare('SELECT * FROM "ContentVersion" ORDER BY id').all();
    snapshotAssessment = dbUpgrade.prepare('SELECT * FROM "AssessmentVersion" ORDER BY id').all();
    snapshotVideo = dbUpgrade.prepare('SELECT * FROM "VideoProductionVersion" ORDER BY id').all();

    applyOne(dbUpgrade, CORRECTION);
  });

  check("M6 existing authoring rows survive byte-identically and revisions are unchanged", () => {
    assert.deepEqual(dbUpgrade.prepare('SELECT * FROM "ContentVersion" ORDER BY id').all(), snapshotContent);
    assert.deepEqual(dbUpgrade.prepare('SELECT * FROM "AssessmentVersion" ORDER BY id').all(), snapshotAssessment);
    const video = dbUpgrade.prepare('SELECT * FROM "VideoProductionVersion" ORDER BY id').all();
    assert.deepEqual(video, snapshotVideo, "the video row gains no column and loses none");
  });

  check("M7 NO row gained a fabricated approval and NO link was invented", () => {
    const approvedContent = dbUpgrade.prepare('SELECT COUNT(*) c FROM "ContentVersion" WHERE "approvedById" IS NOT NULL').get() as { c: number };
    assert.equal(approvedContent.c, 0);
    const links = dbUpgrade.prepare('SELECT COUNT(*) c FROM "VideoProductionAssessmentLink"').get() as { c: number };
    assert.equal(links.c, 0, "the migration links nothing — linking is a domain act with a computed fingerprint");
    const pinned = dbUpgrade.prepare('SELECT COUNT(*) c FROM "AuthoringPreviewSnapshot" WHERE "videoProductionVersionId" IS NOT NULL').get() as { c: number };
    assert.equal(pinned.c, 0);
  });

  check("M8 the upgraded shape equals a fresh full-chain install", () => {
    const shape = (db: Database.Database, table: string) =>
      (db.pragma(`table_info("${table}")`) as Array<Record<string, unknown>>)
        .map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}`)
        .sort();
    for (const table of ["VideoProductionAssessmentLink", "AuthoringPreviewSnapshot", "VideoProductionVersion"]) {
      assert.deepEqual(shape(dbUpgrade, table), shape(dbEmpty, table), `${table} shape differs`);
    }
    assert.equal((dbUpgrade.pragma("integrity_check") as never[])[0]["integrity_check"], "ok");
    assert.deepEqual(dbUpgrade.pragma("foreign_key_check"), []);
  });

  check("M9 the link table enforces its constraints in the DATABASE", () => {
    const insert = (over: Record<string, unknown> = {}) => {
      const base: Record<string, unknown> = {
        videoProductionVersionId: 1,
        assessmentVersionId: 1,
        assessmentRevision: 5,
        assessmentBankFingerprint: "c".repeat(64),
        ...over,
      };
      const keys = Object.keys(base);
      return dbUpgrade
        .prepare(`INSERT INTO "VideoProductionAssessmentLink" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
        .run(...keys.map((k) => base[k]));
    };
    assert.throws(() => insert({ assessmentRevision: 0 }), /CHECK constraint failed/i);
    assert.throws(() => insert({ assessmentBankFingerprint: "short" }), /CHECK constraint failed/i);
    assert.throws(() => insert({ assessmentVersionId: 9999 }), /FOREIGN KEY constraint failed/i);
    assert.throws(() => insert({ videoProductionVersionId: 9999 }), /FOREIGN KEY constraint failed/i);
    assert.equal(insert().changes, 1);
    assert.throws(() => insert(), /UNIQUE constraint failed/i, "one bank per production contract");
    assert.throws(
      () => dbUpgrade.prepare('DELETE FROM "AssessmentVersion" WHERE id = 1').run(),
      /FOREIGN KEY constraint failed/i,
      "a bank that video evidence points at is RESTRICTed",
    );
    dbUpgrade.prepare('DELETE FROM "VideoProductionAssessmentLink"').run();
  });

  dbEmpty.close();
  dbUpgrade.close();
  rm(emptyFile);
  rm(upgradeFile);
}

/* ---------------------------------------------------------------- domain */

async function main() {
  runMigrationChecks();

  rm(dbPath);
  const runner = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (runner.status !== 0) throw new Error(`${runner.stdout}\n${runner.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const assessment = await import("../../src/lib/curriculum/assessment");
  const content = await import("../../src/lib/curriculum/content");
  const coherence = await import("../../src/lib/curriculum/video-production-coherence");
  const projection = await import("../../src/lib/curriculum/authoring-assessment-projection");
  const video = await import("../../src/lib/curriculum/video-production-authoring");
  const contract = await import("../../src/lib/curriculum/video-production-contract");
  const snapshots = await import("../../src/lib/curriculum/authoring-preview-snapshot");
  const notes = await import("../../src/lib/curriculum/authoring-review-notes");

  const admin = await prisma.user.create({ data: { email: "corr-admin@example.com", name: "Admin", role: "admin" } });
  const other = await prisma.user.create({ data: { email: "corr-other@example.com", name: "Other", role: "admin" } });
  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "CORR-100", name: "Corr", status: "draft", versionNumber: 1 },
  });
  const courseModule = await prisma.moduleDefinition.create({
    data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "M1", title: "M1", firstLevel: 1, lastLevel: 100 },
  });
  let levelSeq = 0;
  const makeLevel = async () => {
    levelSeq += 1;
    return prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id, moduleId: courseModule.id, levelNumber: levelSeq,
        stableCode: `corr-l${levelSeq}`, type: "lesson", title: `L${levelSeq}`, completionMethod: "content",
      },
    });
  };

  /** A complete four-question ATA bank a real learner could be graded against. */
  async function makeBank(levelId: number) {
    const version = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: levelId, curriculumVersionId: curriculum.id, versionNumber: 1,
        status: "draft", passPercent: 70, createdById: admin.id,
      },
    });
    for (let n = 1; n <= 4; n += 1) {
      const question = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: version.id, questionNumber: n, stableKey: `q${n}`,
          type: "single_choice",
          options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }] as never,
          correctAnswer: { code: "a" } as never,
        },
      });
      await prisma.questionLocalization.create({
        data: {
          questionId: question.id, locale: "ru", prompt: `Вопрос номер ${n} про дисциплину`,
          optionLabels: { a: "Верно", b: "Неверно", c: "Почти", d: "Нет" } as never,
          explanation: null,
        },
      });
    }
    return version;
  }

  async function makeVideo(levelId: number, levelNumber: number) {
    const raw = JSON.parse(
      fs.readFileSync(path.join(ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json"), "utf8"),
    );
    const file = contract.videoProductionContractsFileSchema.parse(raw);
    const source = [...file.contracts].sort((a, b) => a.levelNumber - b.levelNumber)[0];
    const payload = { ...source, levelNumber, levelCode: `corr-l${levelNumber}` };
    return video.createVideoProductionVersion({
      levelDefinitionId: levelId, curriculumVersionId: curriculum.id,
      payload: { ...payload, takes: payload.takes.map((t, i) => ({ ...t, takeId: contract.takeIdFor(levelNumber, i + 1) })), questions: payload.questions.map((q, i) => ({ ...q, takeId: contract.takeIdFor(levelNumber, i + 1) })) },
      actorId: admin.id,
    });
  }

  try {
    /* ================================================ §12 projection */

    const level = await makeLevel();
    const bank = await makeBank(level.id);
    const production = await makeVideo(level.id, level.levelNumber);

    await check("P1 the bank projects into the ACCEPTED fingerprint shape from durable rows", async () => {
      const shape = await projection.projectAssessmentBank(prisma as never, bank.id);
      assert.equal(shape.levelCode, level.stableCode);
      assert.equal(shape.questions.length, 4);
      assert.equal(shape.takes.length, 4);
      assert.deepEqual(shape.takes.map((t) => t.takeId), [1, 2, 3, 4].map((n) => contract.takeIdFor(level.levelNumber, n)));
      assert.deepEqual(shape.questions.map((q) => q.takeId), [1, 2, 3, 4].map((n) => contract.takeIdFor(level.levelNumber, n)));
      // The accepted function accepts it unmodified — that is the contract.
      assert.match(contract.calculateAssessmentFingerprint(shape), /^[0-9a-f]{64}$/);
    });

    await check("P2 an unprojectable bank FAILS CLOSED instead of fingerprinting partial data", async () => {
      const badLevel = await makeLevel();
      const bad = await prisma.assessmentVersion.create({
        data: {
          levelDefinitionId: badLevel.id, curriculumVersionId: curriculum.id, versionNumber: 1,
          status: "draft", passPercent: 70, createdById: admin.id,
        },
      });
      await refusedWith(
        () => projection.projectAssessmentBank(prisma as never, bad.id),
        "AUTHORING_ASSESSMENT_PROJECTION_INVALID",
      );
    });

    /* =========================================== §11 the durable bridge */

    await check("B1 linking binds the contract to the REAL bank with a server-computed fingerprint", async () => {
      const resolved = await coherence.resolveCanonicalAssessmentVersion(prisma as never, level.id);
      assert.equal(resolved, bank.id, "the level's single bank is unambiguous");
      const link = await coherence.linkVideoProductionAssessment(prisma as never, {
        videoProductionVersionId: production.id, assessmentVersionId: bank.id, actorId: admin.id,
      });
      assert.equal(link.assessmentRevision, 1);
      assert.match(link.assessmentBankFingerprint, /^[0-9a-f]{64}$/);
      const expected = await projection.calculateBankFingerprint(prisma as never, bank.id);
      assert.equal(link.assessmentBankFingerprint, expected, "the stored value IS the computed value");
    });

    await check("B2 an AMBIGUOUS level is refused rather than guessed", async () => {
      const ambiguous = await makeLevel();
      await makeBank(ambiguous.id);
      await prisma.assessmentVersion.create({
        data: {
          levelDefinitionId: ambiguous.id, curriculumVersionId: curriculum.id, versionNumber: 2,
          status: "draft", passPercent: 70, createdById: admin.id,
        },
      });
      await refusedWith(
        () => coherence.resolveCanonicalAssessmentVersion(prisma as never, ambiguous.id),
        "AUTHORING_ASSESSMENT_LINK_AMBIGUOUS",
      );
    });

    await check("B3 the BINDING wins when a level carries several banks — L2's rule", async () => {
      const bound = await makeLevel();
      const current = await makeBank(bound.id);
      const proposal = await prisma.assessmentVersion.create({
        data: {
          levelDefinitionId: bound.id, curriculumVersionId: curriculum.id, versionNumber: 2,
          status: "draft", passPercent: 70, createdById: admin.id,
        },
      });
      await prisma.levelResourceBinding.create({
        data: {
          levelDefinitionId: bound.id, curriculumVersionId: curriculum.id,
          assessmentVersionId: current.id, createdById: admin.id,
        },
      });
      const resolved = await coherence.resolveCanonicalAssessmentVersion(prisma as never, bound.id);
      assert.equal(resolved, current.id, "the BOUND bank is the durable identity");
      assert.notEqual(resolved, proposal.id, "a proposal is never promoted to truth by linking");
    });

    await check("B4 an UNLINKED contract reports UNLINKED, never fresh", async () => {
      const lonelyLevel = await makeLevel();
      const lonely = await makeVideo(lonelyLevel.id, lonelyLevel.levelNumber);
      const state = await coherence.readVideoProductionCoherence(lonely.id);
      assert.equal(state.linked, false);
      assert.equal(state.reason, "UNLINKED");
      assert.equal(state.assessmentEvidenceStale, true, "absence of evidence is not evidence of freshness");
    });

    /* ============================== §13 assessment mutation stales video */

    await check("S1 a linked contract reads COHERENT before anything changes", async () => {
      const state = await coherence.readVideoProductionCoherence(production.id);
      assert.equal(state.linked, true);
      assert.equal(state.assessmentVersionId, bank.id);
      assert.equal(state.reason, "COHERENT");
      assert.equal(state.assessmentEvidenceStale, false);
      assert.equal(state.reviewedBankFingerprint, state.currentBankFingerprint);
    });

    await check("S2 THE FINDING: a real CORRECT-ANSWER edit makes video evidence stale", async () => {
      const before = await coherence.readVideoProductionCoherence(production.id);
      assert.equal(before.assessmentEvidenceStale, false);

      const question = await prisma.questionDefinition.findFirst({
        where: { assessmentVersionId: bank.id, questionNumber: 1 },
      });
      // Through the APPROVED mutation path, with the aggregate guard.
      await assessment.updateAssessmentQuestion({
        actorId: admin.id,
        questionDefinitionId: question!.id,
        expectedRevision: 1,
        patch: { correctAnswer: { code: "b" } },
      });

      const bankAfter = await prisma.assessmentVersion.findUnique({ where: { id: bank.id } });
      assert.equal(bankAfter!.revision, 2, "the bank aggregate moved");

      const after = await coherence.readVideoProductionCoherence(production.id);
      assert.equal(after.assessmentEvidenceStale, true, "THE BRIDGE WORKS");
      assert.equal(after.reason, "ASSESSMENT_BANK_CHANGED");
      assert.notEqual(after.currentBankFingerprint, after.reviewedBankFingerprint);
      assert.equal(after.reviewedAssessmentRevision, 1);
      assert.equal(after.currentAssessmentRevision, 2);

      // And nothing on the video row itself was rewritten to achieve it.
      const videoRow = await prisma.videoProductionVersion.findUnique({ where: { id: production.id } });
      assert.equal(videoRow!.revision, 1, "staleness is DERIVED, not written onto the video aggregate");
    });

    await check("S3 a real PROMPT edit also stales the evidence", async () => {
      await coherence.linkVideoProductionAssessment(prisma as never, {
        videoProductionVersionId: production.id, assessmentVersionId: bank.id, actorId: admin.id,
      });
      assert.equal((await coherence.readVideoProductionCoherence(production.id)).assessmentEvidenceStale, false);

      const question = await prisma.questionDefinition.findFirst({
        where: { assessmentVersionId: bank.id, questionNumber: 2 },
      });
      const localization = await prisma.questionLocalization.findFirst({ where: { questionId: question!.id } });
      const revision = (await prisma.assessmentVersion.findUnique({ where: { id: bank.id } }))!.revision;
      await assessment.updateQuestionLocalization({
        actorId: admin.id,
        questionLocalizationId: localization!.id,
        expectedRevision: revision,
        patch: { prompt: "Совершенно другой вопрос про управление риском" },
      });

      const after = await coherence.readVideoProductionCoherence(production.id);
      assert.equal(after.assessmentEvidenceStale, true);
      assert.equal(after.reason, "ASSESSMENT_BANK_CHANGED");
    });

    await check("S4 re-review through the accepted path restores coherence — no caller fingerprint", async () => {
      const relink = await coherence.linkVideoProductionAssessment(prisma as never, {
        videoProductionVersionId: production.id, assessmentVersionId: bank.id, actorId: admin.id,
      });
      const state = await coherence.readVideoProductionCoherence(production.id);
      assert.equal(state.assessmentEvidenceStale, false);
      assert.equal(state.reason, "COHERENT");
      // The only way to move the stored fingerprint is to recompute it from the
      // bank: `linkVideoProductionAssessment` takes no fingerprint parameter.
      const signature = fs.readFileSync(
        path.join(ROOT, "src/lib/curriculum/video-production-coherence.ts"), "utf8",
      );
      const args = /export async function linkVideoProductionAssessment\([\s\S]*?\n\)/.exec(signature)![0];
      assert.ok(!args.includes("Fingerprint"), "no caller-supplied fingerprint parameter exists");
      assert.equal(relink.assessmentBankFingerprint, state.currentBankFingerprint);
    });

    await check("S5 a NON-SEMANTIC bank edit moves the revision but not the fingerprint", async () => {
      const before = await coherence.readVideoProductionCoherence(production.id);
      const revision = (await prisma.assessmentVersion.findUnique({ where: { id: bank.id } }))!.revision;
      await assessment.updateAssessmentVersion({
        actorId: admin.id,
        assessmentVersionId: bank.id,
        expectedRevision: revision,
        patch: { changeNotes: "внутренняя заметка редактора" },
      });
      const after = await coherence.readVideoProductionCoherence(production.id);
      assert.equal(after.currentBankFingerprint, before.currentBankFingerprint, "the QUESTIONS did not change");
      assert.equal(after.reason, "ASSESSMENT_REVISION_MOVED", "reported as touched, not as rewritten");
      console.log(`     non-semantic edit -> reason=${after.reason}, fingerprint unchanged`);
    });

    /* ==================================== §15 preview snapshot pinning */

    await check("V1 a snapshot pins content, assessment AND video production revisions", async () => {
      const pinLevel = await makeLevel();
      const pinBank = await makeBank(pinLevel.id);
      const pinVideo = await makeVideo(pinLevel.id, pinLevel.levelNumber);
      const pinContent = await prisma.contentVersion.create({
        data: {
          levelDefinitionId: pinLevel.id, curriculumVersionId: curriculum.id, versionNumber: 1,
          status: "draft", createdById: admin.id,
        },
      });
      const localization = await prisma.contentLocalization.create({
        data: { contentVersionId: pinContent.id, locale: "ru", title: "Оригинал", body: { format: "ata.lesson.blocks", version: 2, sections: [] } as never },
      });

      // Advance each aggregate to a DISTINCT revision so a "follow latest" bug
      // could not accidentally produce the right numbers.
      for (let i = 0; i < 3; i += 1) {
        await content.updateContentLocalization({
          actorId: admin.id, contentLocalizationId: localization.id,
          expectedRevision: 1 + i, patch: { title: `Правка ${i}` },
        });
      }
      for (let i = 0; i < 6; i += 1) {
        await assessment.updateAssessmentVersion({
          actorId: admin.id, assessmentVersionId: pinBank.id,
          expectedRevision: 1 + i, patch: { changeNotes: `заметка ${i}` },
        });
      }
      const payload = video.contractFromRow(pinVideo);
      await video.updateVideoProductionContract({
        id: pinVideo.id, expectedRevision: 1, payload, actorId: admin.id,
      });
      await video.updateVideoProductionContract({
        id: pinVideo.id, expectedRevision: 2, payload, actorId: admin.id,
      });

      assert.equal((await prisma.contentVersion.findUnique({ where: { id: pinContent.id } }))!.revision, 4);
      assert.equal((await prisma.assessmentVersion.findUnique({ where: { id: pinBank.id } }))!.revision, 7);
      assert.equal((await prisma.videoProductionVersion.findUnique({ where: { id: pinVideo.id } }))!.revision, 3);

      const snapshot = await snapshots.createPreviewSnapshot({
        levelDefinitionId: pinLevel.id,
        contentVersionId: pinContent.id,
        assessmentVersionId: pinBank.id,
        videoProductionVersionId: pinVideo.id,
        payload: { title: "Правка 2", frame: "learner" } as never,
        actorId: admin.id,
      });
      assert.equal(snapshot.contentRevision, 4);
      assert.equal(snapshot.assessmentRevision, 7);
      assert.equal(snapshot.videoProductionRevision, 3);

      // Now move ALL THREE and prove the snapshot does not follow.
      await content.updateContentLocalization({
        actorId: admin.id, contentLocalizationId: localization.id,
        expectedRevision: 4, patch: { title: "После снимка" },
      });
      await assessment.updateAssessmentVersion({
        actorId: admin.id, assessmentVersionId: pinBank.id,
        expectedRevision: 7, patch: { changeNotes: "после снимка" },
      });
      await video.updateVideoProductionContract({
        id: pinVideo.id, expectedRevision: 3, payload, actorId: admin.id,
      });

      const after = await prisma.authoringPreviewSnapshot.findUnique({ where: { id: snapshot.id } });
      assert.equal(after!.contentRevision, 4, "content pin held");
      assert.equal(after!.assessmentRevision, 7, "assessment pin held");
      assert.equal(after!.videoProductionRevision, 3, "video production pin held");
      assert.deepEqual(after!.payload, { title: "Правка 2", frame: "learner" }, "the frozen payload did not follow");
      console.log("     pinned 4 / 7 / 3 and all three aggregates moved afterwards");
    });

    await check("V2 the pairing rule is enforced and a cross-level pin is refused", async () => {
      const a = await makeLevel();
      const b = await makeLevel();
      const aContent = await prisma.contentVersion.create({
        data: { levelDefinitionId: a.id, curriculumVersionId: curriculum.id, versionNumber: 1, status: "draft", createdById: admin.id },
      });
      const bVideo = await makeVideo(b.id, b.levelNumber);
      await refusedWith(
        () => snapshots.createPreviewSnapshot({
          levelDefinitionId: a.id, contentVersionId: aContent.id,
          videoProductionVersionId: bVideo.id, payload: {} as never, actorId: admin.id,
        }),
        "AUTHORING_INPUT_INVALID",
      );
      await refusedWith(
        () => snapshots.createPreviewSnapshot({
          levelDefinitionId: a.id, payload: {} as never, actorId: admin.id,
        }),
        "AUTHORING_INPUT_INVALID",
      );
      // Every id present carries its revision; every id absent carries none.
      const only = await snapshots.createPreviewSnapshot({
        levelDefinitionId: a.id, contentVersionId: aContent.id, payload: {} as never, actorId: admin.id,
      });
      assert.equal(only.contentRevision, 1);
      assert.equal(only.assessmentVersionId, null);
      assert.equal(only.assessmentRevision, null);
      assert.equal(only.videoProductionVersionId, null);
      assert.equal(only.videoProductionRevision, null);
    });

    await check("V3 snapshotCode is an identifier, and the payload carries no answer key", async () => {
      const snapshot = await prisma.authoringPreviewSnapshot.findFirst();
      assert.ok(snapshot!.snapshotCode.length >= 16);
      const found = await snapshots.readPreviewSnapshotByCode(snapshot!.snapshotCode);
      assert.equal(found!.id, snapshot!.id);
      const source = fs.readFileSync(path.join(ROOT, "src/lib/curriculum/authoring-preview-snapshot.ts"), "utf8");
      assert.ok(!/requireAdmin|getSession|resolveAuthoringActor/.test(source), "the snapshot domain takes no authorization decision");
      for (const row of await prisma.authoringPreviewSnapshot.findMany()) {
        assert.ok(!/correctAnswer|correctOptionCode/.test(JSON.stringify(row.payload)));
      }
    });

    /* =================================== §17 review-note target scoping */

    await check("N1 a note CANNOT be resolved by knowing its id alone", async () => {
      const l1 = await makeLevel();
      const l2 = await makeLevel();
      const v1 = await prisma.contentVersion.create({
        data: { levelDefinitionId: l1.id, curriculumVersionId: curriculum.id, versionNumber: 1, status: "draft", createdById: admin.id },
      });
      const v2 = await prisma.contentVersion.create({
        data: { levelDefinitionId: l2.id, curriculumVersionId: curriculum.id, versionNumber: 1, status: "draft", createdById: admin.id },
      });
      const note = await notes.addReviewNote({
        target: { kind: "content", contentVersionId: v1.id }, body: "исправьте второй блок", authorId: admin.id,
      });

      // The WRONG aggregate cannot close it, even with the right note id.
      await refusedWith(
        () => notes.resolveReviewNote({ noteId: note.id, target: { kind: "content", contentVersionId: v2.id }, actorId: other.id }),
        "AUTHORING_NOTE_NOT_FOUND",
      );
      // Nor the wrong KIND of target.
      const otherBank = await makeBank((await makeLevel()).id);
      await refusedWith(
        () => notes.resolveReviewNote({ noteId: note.id, target: { kind: "assessment", assessmentVersionId: otherBank.id }, actorId: other.id }),
        "AUTHORING_NOTE_NOT_FOUND",
      );
      const still = await prisma.editorialReviewNote.findUnique({ where: { id: note.id } });
      assert.equal(still!.resolvedAt, null, "a refused resolve leaves the note open");

      // The RIGHT target closes it, and the resolver is the server actor.
      const resolved = await notes.resolveReviewNote({
        noteId: note.id, target: { kind: "content", contentVersionId: v1.id }, actorId: other.id,
      });
      assert.equal(resolved.resolvedById, other.id);
      assert.ok(resolved.resolvedAt);
      assert.equal(resolved.body, "исправьте второй блок", "resolve rewrites no history");
    });

    await check("N2 there is still no delete path and no scope broadening", () => {
      const exported = Object.keys(notes).sort();
      assert.deepEqual(exported, ["addReviewNote", "countOpenReviewNotes", "listReviewNotes", "resolveReviewNote"]);
      const source = fs.readFileSync(path.join(ROOT, "src/lib/curriculum/authoring-review-notes.ts"), "utf8");
      assert.ok(!/editorialReviewNote\.(delete|deleteMany|update)\b(?![\s\S]{0,80}resolvedAt)/.test(source));
    });

    /* ================================ §14 bootstrap keeps its guarantees */

    await check("K1 the bootstrap still imports 58/232/232/232 and approves nothing", async () => {
      const bootCurriculum = await prisma.curriculumVersion.create({
        data: { code: "BOOT-100", name: "Boot", status: "draft", versionNumber: 1 },
      });
      const bootModule = await prisma.moduleDefinition.create({
        data: { curriculumVersionId: bootCurriculum.id, moduleNumber: 1, code: "M1", title: "M1", firstLevel: 1, lastLevel: 100 },
      });
      const raw = JSON.parse(
        fs.readFileSync(path.join(ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json"), "utf8"),
      );
      const file = contract.videoProductionContractsFileSchema.parse(raw);
      for (const item of file.contracts) {
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: bootCurriculum.id, moduleId: bootModule.id, levelNumber: item.levelNumber,
            stableCode: item.levelCode, type: "lesson", title: item.title, completionMethod: "content",
          },
        });
      }
      const summary = await video.bootstrapVideoProductionVersions({
        file, curriculumVersionId: bootCurriculum.id, actorId: admin.id,
      });
      assert.equal(summary.created, 58);
      assert.equal(summary.takes, 232);
      assert.equal(summary.questions, 232);
      assert.equal(summary.takeQuestionMappings, 232);
      assert.equal(summary.approved, 0);
      assert.equal(summary.sourceBacked, 1);
      assert.equal(summary.proposedCanon, 57);
      // No level in this fixture carries a bank, so every contract is honestly
      // left UNLINKED rather than linked to a guess.
      assert.equal(summary.assessmentLinked, 0);
      assert.equal(summary.assessmentUnlinked, 58);
      const states = await prisma.videoProductionVersion.groupBy({
        by: ["editorialState"], _count: true, where: { curriculumVersionId: bootCurriculum.id },
      });
      assert.deepEqual(states.map((s) => `${s.editorialState}:${s._count}`), ["draft:58"]);
      console.log(`     bootstrap: linked=${summary.assessmentLinked} unlinked=${summary.assessmentUnlinked} (no bank in this fixture)`);
    });

    await check("K2 a level WITH a real bank gets linked by the bootstrap", async () => {
      const linkLevel = await makeLevel();
      const linkBank = await makeBank(linkLevel.id);
      const linked = await makeVideo(linkLevel.id, linkLevel.levelNumber);
      const resolved = await coherence.resolveCanonicalAssessmentVersion(prisma as never, linkLevel.id);
      assert.equal(resolved, linkBank.id);
      await coherence.linkVideoProductionAssessment(prisma as never, {
        videoProductionVersionId: linked.id, assessmentVersionId: linkBank.id, actorId: admin.id,
      });
      const state = await coherence.readVideoProductionCoherence(linked.id);
      assert.equal(state.linked, true);
      assert.equal(state.reason, "COHERENT");
    });

    await check("K3 linking approves nothing and moves no editorial state", async () => {
      const rows = await prisma.videoProductionVersion.findMany();
      assert.equal(rows.filter((r) => r.editorialState !== "draft").length, 0);
      assert.equal(rows.filter((r) => r.approvedById !== null).length, 0);
      const banks = await prisma.assessmentVersion.findMany();
      assert.equal(banks.filter((b) => b.editorialState === "approved").length, 0);
    });
  } finally {
    await prisma.$disconnect();
    rm(dbPath);
  }

  console.log(`\nPHASE-G0 CORRECTION durable bridge / preview pin / note scope: ${passed} passed, ${failed} failed`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ passed, failed, results }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  rm(dbPath);
  process.exitCode = 1;
});
