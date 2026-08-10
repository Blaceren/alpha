/**
 * PHASE-G2 TRANSPORT regression — Editorial Overlay v1 and the protected-database
 * guard.
 *
 * Everything runs against throwaway SQLite files under the OS temp directory.
 * The suite builds its own schema from `prisma/migrations`, imports a
 * SYNTHETIC_TEST_ONLY structural package, and then exercises the overlay against
 * it. No accepted checkpoint, no live database and no network are required.
 *
 * The synthetic corpus deliberately reproduces the SHAPES that made the real
 * transport hard, at miniature scale: a level whose approved successor does not
 * exist in the structural package, a video contract linked to the PREDECESSOR
 * bank rather than the latest one, historical adjudications on that predecessor,
 * and two process principals that the target does not have. A suite that only
 * tested the easy shapes would pass while the real corpus failed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertSafeDatabaseTarget,
  assertTargetIdentityUnchanged,
  isProtectedDatabaseError,
  resolveProtectedDatabases,
  type ProtectedDatabase,
} from "../../src/lib/curriculum/protected-database";
import { assertSafeDatabaseUrl } from "../curriculum/importCurriculumPackage";
import { validateEditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/validate";
import {
  calculateNoteKey,
  calculateOverlayFingerprint,
  canonicalOverlayProjection,
} from "../../src/lib/curriculum/editorial-overlay/fingerprint";
import { importEditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/import";
import { exportEditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/export";
import type { EditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/schema";

let passed = 0;
let failed = 0;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ata-overlay-${process.pid}-`));

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/* ------------------------------------------------------------------ *
 * schema bootstrap
 * ------------------------------------------------------------------ */

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

function buildSchema(dbFile: string): void {
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA foreign_keys = OFF");
  const names = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  db.exec(
    `CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL,
      "finished_at" DATETIME, "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`,
  );
  db.close();
}

/* ------------------------------------------------------------------ *
 * the synthetic corpus
 * ------------------------------------------------------------------ */

const L_LESSON = "v2.l002.sinteticheskiy-urok";
const AUTHOR = "synthetic.author@ata-overlay-test.invalid";
const REVIEWER = "synthetic.reviewer@ata-overlay-test.invalid";
const PACKAGE_FINGERPRINT = "a".repeat(64);
const CHECKPOINT_SHA = "b".repeat(64);
const COMMIT = "c".repeat(40);
const TREE = "d".repeat(40);
const BLUEPRINT_SHA = "e".repeat(64);
const CONTRACT_FP = "1".repeat(64);
const BANK_FP = "2".repeat(64);
const EVIDENCE_SHA = "3".repeat(64);
const CURRENT_HASH = "4".repeat(64);
const BLUEPRINT_HASH = "5".repeat(64);

const T0 = "2026-08-01T10:00:00.000Z";
const T1 = "2026-08-02T11:00:00.000Z";
const T2 = "2026-08-03T12:00:00.000Z";

/**
 * A target that already contains the structural baseline, built directly rather
 * than through the package importer so the suite stays independent of it.
 * Integer ids are seeded to COLLIDE with the ids a real editorial source would
 * use, which is the point: the overlay must resolve semantically or attribute
 * evidence to the wrong rows.
 */
function seedTarget(dbFile: string): void {
  buildSchema(dbFile);
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA foreign_keys = ON");
  // Unrelated principals occupying ids 1 and 2 — exactly the collision that
  // makes raw-id transport unsafe.
  db.exec(`INSERT INTO "User" (id,email,referralCode,passwordHash,role,status,name,createdAt,updatedAt)
           VALUES (1,'unrelated.admin@example.invalid','ref-1','!x!','admin','active','Unrelated Admin',1,1),
                  (2,'unrelated.support@example.invalid','ref-2','!x!','support','active','Unrelated Support',1,1)`);
  db.exec(`INSERT INTO "CurriculumVersion" (id,code,name,status,versionNumber,createdAt,changeNotes)
           VALUES (7,'ata-v2','Synthetic','draft',3,1,'ata-package:synthetic.pkg@1:${PACKAGE_FINGERPRINT}')`);
  db.exec(`INSERT INTO "ModuleDefinition" (id,curriculumVersionId,moduleNumber,code,title,firstLevel,lastLevel,learningObjective)
           VALUES (5,7,1,'module.01','Synthetic module',1,4,'obj')`);
  db.exec(`INSERT INTO "LevelDefinition" (id,curriculumVersionId,moduleId,levelNumber,stableCode,type,title,completionMethod)
           VALUES (9,7,5,2,'${L_LESSON}','lesson','Synthetic lesson','assessment_pass')`);
  // The structural baseline: v1 of each aggregate, at editorial baseline.
  db.exec(`INSERT INTO "ContentVersion" (id,levelDefinitionId,curriculumVersionId,versionNumber,status,createdAt,updatedAt,revision,editorialState)
           VALUES (11,9,7,1,'draft',1,1,1,'draft')`);
  db.exec(`INSERT INTO "ContentLocalization" (id,contentVersionId,locale,title,body,createdAt,updatedAt)
           VALUES (11,11,'ru','Synthetic','{"format":"blocks_v2","version":2,"blocks":[]}',1,1)`);
  db.exec(`INSERT INTO "AssessmentVersion" (id,levelDefinitionId,curriculumVersionId,versionNumber,status,passPercent,createdAt,updatedAt,revision,editorialState)
           VALUES (12,9,7,1,'draft',80,1,1,1,'draft')`);
  db.exec(`INSERT INTO "QuestionDefinition" (id,assessmentVersionId,questionNumber,stableKey,type,correctAnswer,createdAt,updatedAt)
           VALUES (21,12,1,'T2.1','single_choice','{"optionCodes":["a"]}',1,1)`);
  db.exec(`INSERT INTO "LevelResourceBinding" (id,levelDefinitionId,curriculumVersionId,contentVersionId,createdAt,updatedAt)
           VALUES (3,9,7,11,1,1)`);
  db.close();
}

function noteOf(input: {
  kind: "content" | "assessment" | "video";
  versionNumber: number;
  targetRevision: number;
  body: string;
  author: string;
  createdAt: string;
}) {
  const shaped = {
    target: { kind: input.kind, level: L_LESSON, versionNumber: input.versionNumber },
    targetRevision: input.targetRevision,
    path: null,
    body: input.body,
    author: input.author,
    createdAt: input.createdAt,
    resolvedAt: null,
    resolvedBy: null,
  };
  return { noteKey: calculateNoteKey(shaped), ...shaped };
}

/** The synthetic overlay, mirroring the real corpus's hard shapes. */
function baseOverlay(): EditorialOverlay {
  const approvedEvidence = {
    editorialState: "approved" as const,
    revision: 2,
    createdBy: AUTHOR,
    lastAuthoredBy: AUTHOR,
    lastAuthoredAt: T0,
    submittedBy: AUTHOR,
    submittedAt: T1,
    changesRequestedBy: null,
    changesRequestedAt: null,
    approvedBy: REVIEWER,
    approvedAt: T2,
  };
  const baselineEvidence = {
    editorialState: "draft" as const,
    revision: 1,
    createdBy: null,
    lastAuthoredBy: null,
    lastAuthoredAt: null,
    submittedBy: null,
    submittedAt: null,
    changesRequestedBy: null,
    changesRequestedAt: null,
    approvedBy: null,
    approvedAt: null,
  };
  return {
    schemaVersion: "ata.editorial-overlay/1",
    minImporterVersion: 1,
    overlayCode: "synthetic.overlay",
    overlayRevision: 1,
    generatedAt: T2,
    binding: {
      curriculumCode: "ata-v2",
      curriculumVersionNumber: 3,
      structuralPackageCode: "synthetic.pkg",
      structuralPackageRevision: 1,
      structuralPackageFingerprint: PACKAGE_FINGERPRINT,
      sourceCheckpointSha256: CHECKPOINT_SHA,
      sourceBackendCommit: COMMIT,
      sourceBackendTree: TREE,
      blueprintSourceDocumentSha256: BLUEPRINT_SHA,
    },
    principals: [
      { ref: AUTHOR, displayName: "Synthetic Author", role: "user", staffRole: "content_manager", provisionIfMissing: true },
      { ref: REVIEWER, displayName: "Synthetic Reviewer", role: "user", staffRole: "crm_admin", provisionIfMissing: true },
    ],
    content: [
      { level: L_LESSON, versionNumber: 1, mode: "update", editorial: baselineEvidence, payload: null },
      {
        level: L_LESSON,
        versionNumber: 2,
        mode: "create",
        editorial: approvedEvidence,
        payload: {
          status: "draft",
          videoDurationSeconds: null,
          changeNotes: null,
          createdAt: T0,
          publishedAt: null,
          archivedAt: null,
          localizations: [
            {
              locale: "ru",
              title: "Successor",
              subtitle: "",
              learningObjectiveExtension: "",
              summary: "",
              transcript: null,
              body: { format: "blocks_v2", version: 2, blocks: [] },
            },
          ],
        },
      },
    ],
    assessments: [
      { level: L_LESSON, versionNumber: 1, mode: "update", editorial: baselineEvidence, predecessor: null, payload: null },
      {
        level: L_LESSON,
        versionNumber: 2,
        mode: "create",
        editorial: approvedEvidence,
        predecessor: { level: L_LESSON, versionNumber: 1 },
        payload: {
          status: "draft",
          passPercent: 80,
          maxAttempts: null,
          showExplanation: false,
          changeNotes: null,
          createdAt: T0,
          publishedAt: null,
          archivedAt: null,
          questions: [
            {
              stableKey: "T2.1",
              questionNumber: 1,
              type: "single_choice",
              skillTag: null,
              status: "active",
              options: { optionCodes: ["a", "b"] },
              correctAnswer: { optionCodes: ["a"] },
              createdAt: T0,
              localizations: [{ locale: "ru", prompt: "Prompt", optionLabels: ["А", "Б"], explanation: null }],
            },
          ],
        },
      },
    ],
    videoProductions: [
      {
        level: L_LESSON,
        versionNumber: 1,
        levelNumber: 2,
        revision: 2,
        editorialState: "approved",
        contractVersion: 1,
        sourceProvenance: "PROPOSED_CANON",
        scriptState: "SCRIPT_READY",
        videoState: "NOT_RECORDED",
        qaState: "QA_PENDING",
        contractPayload: { takes: [] },
        contractFingerprint: CONTRACT_FP,
        assessmentFingerprint: BANK_FP,
        productionEvidenceStale: false,
        createdAt: T0,
        evidence: {
          createdBy: AUTHOR,
          lastAuthoredBy: AUTHOR,
          lastAuthoredAt: T0,
          submittedBy: AUTHOR,
          submittedAt: T1,
          changesRequestedBy: null,
          changesRequestedAt: null,
          approvedBy: REVIEWER,
          approvedAt: T2,
        },
      },
    ],
    // The link points at the PREDECESSOR bank, exactly as the real corpus does.
    videoAssessmentLinks: [
      {
        video: { level: L_LESSON, versionNumber: 1 },
        assessment: { level: L_LESSON, versionNumber: 1 },
        assessmentRevision: 1,
        assessmentBankFingerprint: BANK_FP,
        linkedBy: AUTHOR,
        linkedAt: T1,
      },
    ],
    // Adjudications live on the predecessor; the successor inherits them.
    sourceAuthorityResolutions: [
      {
        assessment: { level: L_LESSON, versionNumber: 1 },
        video: { level: L_LESSON, versionNumber: 1 },
        level: L_LESSON,
        questionIndex: 0,
        field: "prompt",
        conflictPath: "questions[0].prompt",
        decision: "CURRENT",
        currentValueHash: CURRENT_HASH,
        blueprintValueHash: BLUEPRINT_HASH,
        blueprintSourceDocumentSha256: BLUEPRINT_SHA,
        contractFingerprintAtDecision: CONTRACT_FP,
        bankFingerprintAtDecision: BANK_FP,
        assessmentRevisionAtDecision: 1,
        rationale: "synthetic decision",
        evidenceRef: "scripts/regression/curriculumEditorialOverlayRegression.ts",
        evidenceSha256: EVIDENCE_SHA,
        batchId: "synthetic-batch",
        decidedBy: REVIEWER,
        decidedAt: T2,
        createdAt: T2,
        supersededAt: null,
        supersededBy: null,
      },
    ],
    reviewNotes: [
      noteOf({ kind: "content", versionNumber: 2, targetRevision: 2, body: "note on successor", author: REVIEWER, createdAt: T2 }),
      noteOf({ kind: "video", versionNumber: 1, targetRevision: 2, body: "note on video", author: AUTHOR, createdAt: T1 }),
    ],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function withTarget<T>(
  name: string,
  fn: (db: import("@prisma/client").PrismaClient, file: string) => Promise<T>,
  seed: (file: string) => void = seedTarget,
): Promise<T> {
  const file = path.join(tmpRoot, `${name}.sqlite`);
  fs.rmSync(file, { force: true });
  seed(file);
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  try {
    return await fn(db, file);
  } finally {
    await db.$disconnect();
  }
}

function tableCounts(file: string, tables: string[]): Record<string, number> {
  const db = new DatabaseSync(file, { readOnly: true });
  const out: Record<string, number> = {};
  for (const table of tables) {
    out[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  }
  db.close();
  return out;
}

/* ------------------------------------------------------------------ *
 * the suite
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  /* ================= A. protected-database guard ================= */
  const guardDir = fs.mkdtempSync(path.join(tmpRoot, "guard-"));
  const protectedFile = path.join(guardDir, "protected.sqlite");
  fs.writeFileSync(protectedFile, "protected");
  const protectedStat = fs.statSync(protectedFile);
  const injected: ProtectedDatabase[] = [
    {
      declaredPath: protectedFile,
      resolvedPath: fs.realpathSync(protectedFile),
      identity: { dev: protectedStat.dev, ino: protectedStat.ino },
      source: "default",
    },
  ];
  const guardOpts = { protectedDatabases: injected, env: {} as NodeJS.ProcessEnv };
  const refuses = (url: string) => {
    assert.throws(
      () => assertSafeDatabaseTarget(url, guardOpts),
      (error: unknown) => isProtectedDatabaseError(error),
    );
  };

  await check("A1 literal protected path refused", () => refuses(`file:${protectedFile}`));

  await check("A2 symlink to a protected database refused", () => {
    const link = path.join(guardDir, "sym.sqlite");
    fs.rmSync(link, { force: true });
    fs.symlinkSync(protectedFile, link);
    refuses(`file:${link}`);
  });

  await check("A3 hardlink to a protected database refused (same inode)", () => {
    const link = path.join(guardDir, "hard.sqlite");
    fs.rmSync(link, { force: true });
    fs.linkSync(protectedFile, link);
    refuses(`file:${link}`);
  });

  await check("A4 ../ traversal alias refused", () => {
    fs.mkdirSync(path.join(guardDir, "sub"), { recursive: true });
    refuses(`file:${path.join(guardDir, "sub", "..", "protected.sqlite")}`);
  });

  await check("A5 normalized alias refused", () => refuses(`file:${guardDir}/./protected.sqlite`));

  await check("A6 DANGLING symlink refused — fails closed (regression for check 49)", () => {
    const link = path.join(guardDir, "dangling.sqlite");
    fs.rmSync(link, { force: true });
    fs.symlinkSync("/nonexistent/runtime/ata-dev-v2/data/ata-dev.sqlite", link);
    assert.throws(
      () => assertSafeDatabaseTarget(`file:${link}`, guardOpts),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_IS_SYMLINK"),
    );
  });

  await check("A7 an honest byte-copy with a different inode is allowed", () => {
    const copy = path.join(guardDir, "copy.sqlite");
    fs.copyFileSync(protectedFile, copy);
    const resolved = assertSafeDatabaseTarget(`file:${copy}`, guardOpts);
    assert.equal(resolved.absolutePath, fs.realpathSync(copy));
    assert.ok(resolved.identity);
  });

  await check("A8 a target that does not exist yet is allowed when its parent resolves", () => {
    const fresh = assertSafeDatabaseTarget(`file:${path.join(guardDir, "fresh.sqlite")}`, guardOpts);
    assert.equal(fresh.existed, false);
    assert.equal(fresh.identity, null);
  });

  await check("A9 an unresolvable parent is refused", () => {
    assert.throws(
      () => assertSafeDatabaseTarget("file:/nonexistent-root/nowhere/x.sqlite", guardOpts),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_PARENT_UNRESOLVABLE"),
    );
  });

  await check("A10 non-file URLs and relative paths refused", () => {
    assert.throws(() => assertSafeDatabaseTarget("postgres://u:p@h/d", guardOpts));
    assert.throws(() => assertSafeDatabaseTarget("http://example.com/db", guardOpts));
    assert.throws(() => assertSafeDatabaseTarget("file:relative/path.sqlite", guardOpts));
  });

  await check("A11 the LIVE PREPROD path is protected by default", () => {
    // No injected set: this is the real default registry.
    assert.throws(
      () => assertSafeDatabaseUrl("file:/srv/ata-data/data/ata-preprod.sqlite"),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_PROTECTED"),
    );
  });

  await check("A12 the live DEV path is protected by default", () => {
    assert.throws(
      () => assertSafeDatabaseUrl("file:/home/ubuntu/runtime/ata-dev-v2/data/ata-dev.sqlite"),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_PROTECTED"),
    );
  });

  await check("A13 ATA_PROTECTED_DATABASES extends the protected set", () => {
    const extra = path.join(guardDir, "extra.sqlite");
    fs.writeFileSync(extra, "x");
    const set = resolveProtectedDatabases({
      ATA_PROTECTED_DATABASES: extra,
      ATA_RUNTIME_CONFIG_DIR: path.join(guardDir, "no-such-config"),
    } as unknown as NodeJS.ProcessEnv);
    assert.ok(set.some((entry) => entry.resolvedPath === fs.realpathSync(extra)));
    assert.throws(() => assertSafeDatabaseTarget(`file:${extra}`, { protectedDatabases: set, env: {} as NodeJS.ProcessEnv }));
  });

  await check("A14 identity re-verification detects a target swapped for a symlink", () => {
    const swap = path.join(guardDir, "swap.sqlite");
    fs.rmSync(swap, { force: true });
    fs.writeFileSync(swap, "x");
    const resolved = assertSafeDatabaseTarget(`file:${swap}`, guardOpts);
    fs.rmSync(swap, { force: true });
    fs.symlinkSync(protectedFile, swap);
    assert.throws(
      () => assertTargetIdentityUnchanged(resolved),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_IDENTITY_CHANGED"),
    );
    fs.rmSync(swap, { force: true });
  });

  /* ================= B. overlay validation ================= */
  await check("B1 the synthetic overlay validates and fingerprints", () => {
    const result = validateEditorialOverlay(baseOverlay());
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
    if (!result.ok) return;
    assert.equal(result.fingerprint, calculateOverlayFingerprint(baseOverlay()));
  });

  await check("B2 an unknown field is a hard error, never a silent drop", () => {
    const overlay = clone(baseOverlay()) as unknown as Record<string, unknown>;
    overlay.unexpected = true;
    const result = validateEditorialOverlay(overlay);
    assert.equal(result.ok, false);
  });

  await check("B3 approved without an approver is refused", () => {
    const overlay = clone(baseOverlay());
    overlay.content[1].editorial.approvedBy = null;
    overlay.content[1].editorial.approvedAt = null;
    const result = validateEditorialOverlay(overlay);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "APPROVED_WITHOUT_EVIDENCE"));
  });

  await check("B4 an undeclared principal is refused", () => {
    const overlay = clone(baseOverlay());
    overlay.content[1].editorial.approvedBy = "stranger@example.invalid";
    const result = validateEditorialOverlay(overlay);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "UNDECLARED_PRINCIPAL"));
  });

  await check("B5 a duplicate semantic key is refused", () => {
    const overlay = clone(baseOverlay());
    overlay.content.push(clone(overlay.content[1]));
    const result = validateEditorialOverlay(overlay);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "DUPLICATE_SEMANTIC_KEY"));
  });

  await check("B6 a predecessor the overlay does not describe is refused", () => {
    const overlay = clone(baseOverlay());
    overlay.assessments[1].predecessor = { level: L_LESSON, versionNumber: 9 };
    const result = validateEditorialOverlay(overlay);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "PREDECESSOR_UNRESOLVED"));
  });

  await check("B7 QA_PASSED on a never-recorded asset is refused as fabricated evidence", () => {
    const overlay = clone(baseOverlay());
    overlay.videoProductions[0].qaState = "QA_PASSED";
    const result = validateEditorialOverlay(overlay);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "IMPOSSIBLE_PRODUCTION_STATE"));
  });

  await check("B8 a tampered note body invalidates its noteKey", () => {
    const overlay = clone(baseOverlay());
    overlay.reviewNotes[0].body = "tampered";
    const result = validateEditorialOverlay(overlay);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "NOTE_KEY_MISMATCH"));
  });

  await check("B9 an adjudication naming a foreign Blueprint document is refused", () => {
    const overlay = clone(baseOverlay());
    overlay.sourceAuthorityResolutions[0].blueprintSourceDocumentSha256 = "f".repeat(64);
    const result = validateEditorialOverlay(overlay);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "AUTHORITY_SOURCE_DOCUMENT_MISMATCH"));
  });

  await check("B10 the fingerprint ignores generatedAt and nothing else", () => {
    const a = baseOverlay();
    const b = clone(a);
    b.generatedAt = "2027-01-01T00:00:00.000Z";
    assert.equal(calculateOverlayFingerprint(a), calculateOverlayFingerprint(b));
    const c = clone(a);
    c.content[1].editorial.approvedAt = "2027-01-01T00:00:00.000Z";
    assert.notEqual(calculateOverlayFingerprint(a), calculateOverlayFingerprint(c));
    const d = clone(a);
    d.content[1].editorial.approvedBy = AUTHOR;
    assert.notEqual(calculateOverlayFingerprint(a), calculateOverlayFingerprint(d));
  });

  /* ================= C. target and principal preflight ================= */
  await check("C1 a missing principal fails BEFORE any editorial write", async () => {
    await withTarget("c1", async (db, file) => {
      const before = tableCounts(file, ["ContentVersion", "VideoProductionVersion", "User", "AuditLog"]);
      const result = await importEditorialOverlay(baseOverlay(), { db });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "PRINCIPAL_PREFLIGHT_FAILED");
      const after = tableCounts(file, ["ContentVersion", "VideoProductionVersion", "User", "AuditLog"]);
      assert.deepEqual(after, before);
    });
  });

  await check("C2 a principal with the same address but an incompatible role is refused", async () => {
    await withTarget("c2", async (db, file) => {
      const raw = new DatabaseSync(file);
      raw.exec(`INSERT INTO "User" (id,email,referralCode,passwordHash,role,status,name,createdAt,updatedAt)
                VALUES (40,'${REVIEWER}','ref-40','!x!','user','blocked','Synthetic Reviewer',1,1)`);
      raw.exec(`INSERT INTO "StaffProfile" (id,userId,displayName,staffRole,permissionVersion,createdAt,updatedAt)
                VALUES ('sp-40',40,'Synthetic Reviewer','read_only',1,1,1)`);
      raw.close();
      const result = await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "PRINCIPAL_PREFLIGHT_FAILED");
      assert.ok(result.issues.some((i) => i.code === "PRINCIPAL_INCOMPATIBLE"));
      assert.equal(tableCounts(file, ["VideoProductionVersion"]).VideoProductionVersion, 0);
    });
  });

  await check("C3 an overlay bound to a different structural package is refused", async () => {
    await withTarget("c3", async (db) => {
      const overlay = clone(baseOverlay());
      overlay.binding.structuralPackageFingerprint = "9".repeat(64);
      const result = await importEditorialOverlay(overlay, { db, allowPrincipalProvisioning: true });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "TARGET_PREFLIGHT_FAILED");
      assert.ok(result.issues.some((i) => i.code === "PACKAGE_MARKER_MISMATCH"));
    });
  });

  await check("C4 an update whose target row is absent is refused", async () => {
    await withTarget("c4", async (db) => {
      const overlay = clone(baseOverlay());
      overlay.content.push({
        level: L_LESSON,
        versionNumber: 5,
        mode: "update",
        editorial: overlay.content[0].editorial,
        payload: null,
      });
      const result = await importEditorialOverlay(overlay, { db, allowPrincipalProvisioning: true });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "TARGET_PREFLIGHT_FAILED");
      assert.ok(result.issues.some((i) => i.code === "CONTENT_NOT_FOUND"));
    });
  });

  /* ================= D. dry run ================= */
  await check("D1 dry run writes nothing and leaves the file byte-identical", async () => {
    await withTarget("d1", async (db, file) => {
      const before = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      const result = await importEditorialOverlay(baseOverlay(), {
        db,
        dryRun: true,
        allowPrincipalProvisioning: true,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.summary.outcome, "dry-run");
      assert.equal(result.summary.auditEventId, null);
      assert.equal(result.summary.counts.videoProductions.created, 1);
      await db.$disconnect();
      const after = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      assert.equal(after, before);
    });
  });

  /* ================= E. apply, identity and provenance ================= */
  await check("E1 apply transports evidence and provisions blocked principals", async () => {
    await withTarget("e1", async (db, file) => {
      const result = await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true, importActorId: 1 });
      assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
      if (!result.ok) return;
      assert.equal(result.summary.outcome, "applied");
      assert.equal(result.summary.counts.contentVersions.created, 1);
      assert.equal(result.summary.counts.contentVersions.updated, 0);
      assert.equal(result.summary.counts.contentVersions.unchanged, 1);
      assert.equal(result.summary.counts.videoProductions.created, 1);
      assert.equal(result.summary.counts.sourceAuthorityResolutions.created, 1);
      assert.equal(result.summary.counts.reviewNotes.created, 2);
      assert.equal(result.summary.counts.assessmentLineage.updated, 1);

      const raw = new DatabaseSync(file, { readOnly: true });
      // Principals are blocked, so they carry history and can never act.
      const author = raw
        .prepare(`SELECT id,status,role FROM "User" WHERE email = ?`)
        .get(AUTHOR) as { id: number; status: string; role: string };
      assert.equal(author.status, "blocked");
      // Their ids are NOT the ids the source used, which is the whole point.
      assert.notEqual(author.id, 1);
      assert.notEqual(author.id, 2);
      const reviewer = raw.prepare(`SELECT id FROM "User" WHERE email = ?`).get(REVIEWER) as { id: number };
      const successor = raw
        .prepare(`SELECT approvedById, approvedAt, submittedById FROM "ContentVersion" WHERE versionNumber = 2`)
        .get() as { approvedById: number; approvedAt: number; submittedById: number };
      assert.equal(successor.approvedById, reviewer.id);
      assert.equal(successor.submittedById, author.id);
      // The historical instant survives, rather than becoming import time.
      assert.equal(successor.approvedAt, new Date(T2).getTime());
      raw.close();
    });
  });

  await check("E2 no evidence is attributed to the unrelated principals occupying ids 1 and 2", async () => {
    await withTarget("e2", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const raw = new DatabaseSync(file, { readOnly: true });
      for (const table of ["ContentVersion", "AssessmentVersion", "VideoProductionVersion"]) {
        const n = (
          raw.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE approvedById IN (1,2)`).get() as { n: number }
        ).n;
        assert.equal(n, 0, `${table} attributed approvals to a colliding id`);
      }
      const decided = (
        raw.prepare(`SELECT COUNT(*) AS n FROM "SourceAuthorityResolution" WHERE decidedById IN (1,2)`).get() as {
          n: number;
        }
      ).n;
      assert.equal(decided, 0);
      raw.close();
    });
  });

  await check("E3 the successor's lineage points at the predecessor resolved semantically", async () => {
    await withTarget("e3", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const raw = new DatabaseSync(file, { readOnly: true });
      const row = raw
        .prepare(
          `SELECT s.predecessorVersionId AS pred, p.versionNumber AS predVersion
           FROM "AssessmentVersion" s JOIN "AssessmentVersion" p ON p.id = s.predecessorVersionId
           WHERE s.versionNumber = 2`,
        )
        .get() as { pred: number; predVersion: number };
      assert.equal(row.predVersion, 1);
      raw.close();
    });
  });

  await check("E4 the video link stays on the predecessor bank, not the latest one", async () => {
    await withTarget("e4", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const raw = new DatabaseSync(file, { readOnly: true });
      const link = raw
        .prepare(
          `SELECT a.versionNumber AS v FROM "VideoProductionAssessmentLink" l
           JOIN "AssessmentVersion" a ON a.id = l.assessmentVersionId`,
        )
        .get() as { v: number };
      assert.equal(link.v, 1, "the durable link must remain on the predecessor");
      raw.close();
    });
  });

  await check("E5 the import writes one audit event that is not an approval", async () => {
    await withTarget("e5", async (db, file) => {
      const result = await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true, importActorId: 1 });
      assert.equal(result.ok, true);
      const raw = new DatabaseSync(file, { readOnly: true });
      const rows = raw.prepare(`SELECT action, userId FROM "AuditLog"`).all() as Array<{ action: string; userId: number }>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].action, "G2_EDITORIAL_BASELINE_IMPORTED");
      assert.equal(rows[0].userId, 1);
      raw.close();
    });
  });

  await check("E6 the import publishes nothing and binds nothing", async () => {
    await withTarget("e6", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const raw = new DatabaseSync(file, { readOnly: true });
      const curriculum = raw.prepare(`SELECT status FROM "CurriculumVersion"`).get() as { status: string };
      assert.equal(curriculum.status, "draft");
      const published = (
        raw.prepare(`SELECT COUNT(*) AS n FROM "ContentVersion" WHERE status = 'published'`).get() as { n: number }
      ).n;
      assert.equal(published, 0);
      const bound = (
        raw.prepare(`SELECT COUNT(*) AS n FROM "LevelResourceBinding" WHERE assessmentVersionId IS NOT NULL`).get() as {
          n: number;
        }
      ).n;
      assert.equal(bound, 0);
      // The binding still points at the ORIGINAL content — publication, not
      // transport, is what moves it.
      const binding = raw.prepare(`SELECT contentVersionId FROM "LevelResourceBinding"`).get() as {
        contentVersionId: number;
      };
      assert.equal(binding.contentVersionId, 11);
      raw.close();
    });
  });

  /* ================= F. idempotency and contradiction ================= */
  await check("F1 an identical replay reports everything unchanged and duplicates nothing", async () => {
    await withTarget("f1", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const after = tableCounts(file, [
        "ContentVersion",
        "AssessmentVersion",
        "QuestionDefinition",
        "VideoProductionVersion",
        "VideoProductionAssessmentLink",
        "SourceAuthorityResolution",
        "EditorialReviewNote",
        "User",
      ]);
      const replay = await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      assert.equal(replay.ok, true, JSON.stringify(replay.ok ? [] : replay.issues));
      if (!replay.ok) return;
      for (const [name, counts] of Object.entries(replay.summary.counts)) {
        assert.equal(counts.created, 0, `${name} created rows on replay`);
        assert.equal(counts.updated, 0, `${name} updated rows on replay`);
      }
      assert.equal(replay.summary.counts.contentVersions.unchanged, 2);
      assert.equal(replay.summary.counts.sourceAuthorityResolutions.unchanged, 1);
      assert.equal(replay.summary.counts.reviewNotes.unchanged, 2);
      assert.deepEqual(tableCounts(file, Object.keys(after)), after);
      // Principals are matched on replay, never minted twice.
      assert.ok(replay.summary.principals.every((p) => p.status === "matched"));
    });
  });

  await check("F2 a target holding a DIFFERENT approver is a refusal, not an overwrite", async () => {
    await withTarget("f2", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const overlay = clone(baseOverlay());
      overlay.content[1].editorial.approvedBy = AUTHOR; // author approving their own work
      const result = await importEditorialOverlay(overlay, { db, allowPrincipalProvisioning: true });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "TARGET_CONTRADICTION");
      // and the original evidence is intact
      const raw = new DatabaseSync(file, { readOnly: true });
      const reviewer = raw.prepare(`SELECT id FROM "User" WHERE email = ?`).get(REVIEWER) as { id: number };
      const row = raw.prepare(`SELECT approvedById FROM "ContentVersion" WHERE versionNumber = 2`).get() as {
        approvedById: number;
      };
      assert.equal(row.approvedById, reviewer.id);
      raw.close();
    });
  });

  await check("F3 a target holding a DIFFERENT approval time is a refusal", async () => {
    await withTarget("f3", async (db) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const overlay = clone(baseOverlay());
      overlay.content[1].editorial.approvedAt = "2026-09-09T09:09:09.000Z";
      const result = await importEditorialOverlay(overlay, { db, allowPrincipalProvisioning: true });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "TARGET_CONTRADICTION");
    });
  });

  await check("F4 a target holding a DIFFERENT source-authority decision is a refusal", async () => {
    await withTarget("f4", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const overlay = clone(baseOverlay());
      overlay.sourceAuthorityResolutions[0].decision = "BLUEPRINT";
      const result = await importEditorialOverlay(overlay, { db, allowPrincipalProvisioning: true });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "APPLY_FAILED");
      const raw = new DatabaseSync(file, { readOnly: true });
      const row = raw.prepare(`SELECT decision FROM "SourceAuthorityResolution"`).get() as { decision: string };
      assert.equal(row.decision, "CURRENT");
      assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM "SourceAuthorityResolution"`).get() as { n: number }).n, 1);
      raw.close();
    });
  });

  /* ================= G. atomicity ================= */
  await check("G1 a failure mid-apply rolls back every editorial row", async () => {
    await withTarget("g1", async (db, file) => {
      const overlay = clone(baseOverlay());
      // A link naming a video the overlay describes but whose assessment end will
      // fail the FK at write time: point it at a bank version that validation
      // accepts (it exists) but delete the row the importer would resolve.
      overlay.videoProductions.push({
        ...clone(overlay.videoProductions[0]),
        versionNumber: 2,
        contractFingerprint: "7".repeat(64),
        // level 999 does not exist in the target — resolution yields undefined and
        // the create throws inside the transaction.
        level: L_LESSON,
        levelNumber: 101 as unknown as number,
      });
      const result = await importEditorialOverlay(overlay, { db, allowPrincipalProvisioning: true });
      assert.equal(result.ok, false);
      if (result.ok) return;
      const counts = tableCounts(file, [
        "VideoProductionVersion",
        "SourceAuthorityResolution",
        "EditorialReviewNote",
        "User",
        "AuditLog",
      ]);
      assert.equal(counts.VideoProductionVersion, 0, "a rolled-back apply left video rows behind");
      assert.equal(counts.SourceAuthorityResolution, 0);
      assert.equal(counts.EditorialReviewNote, 0);
      assert.equal(counts.AuditLog, 0);
      assert.equal(counts.User, 2, "a rolled-back apply left provisioned principals behind");
      const raw = new DatabaseSync(file, { readOnly: true });
      const approved = (
        raw.prepare(`SELECT COUNT(*) AS n FROM "ContentVersion" WHERE editorialState = 'approved'`).get() as {
          n: number;
        }
      ).n;
      assert.equal(approved, 0, "a rolled-back apply left approvals behind");
      raw.close();
    });
  });

  /* ================= H. non-interference ================= */
  await check("H1 learner, staff and financial tables are untouched by the overlay", async () => {
    await withTarget("h1", async (db, file) => {
      const watched = [
        "UserCurriculumEnrollment",
        "UserLevelProgress",
        "UserLessonProgress",
        "AssessmentAttempt",
        "XPTransaction",
        "XpEvent",
        "PocketProviderEvent",
        "PocketTraderIdentity",
        "PostbackEvent",
        "ExchangeAccount",
        "AffiliateConversionEvent",
        "Referral",
        "ReportSubmission",
        "ReportReview",
        "CheckpointVerificationAttempt",
        "LevelResourceBinding",
        "ModuleDefinition",
        "LevelDefinition",
        "CurriculumVersion",
      ];
      const before = tableCounts(file, watched);
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      assert.deepEqual(tableCounts(file, watched), before);
    });
  });

  /* ================= J. the ordering trap ================= */
  //
  // Publishing the curriculum version BEFORE its content makes that content
  // immutable, and curriculum publication cannot be undone by any domain
  // primitive. The transport importer must never publish a curriculum, and the
  // activation order must stay CONTENT FIRST. Both are regressed here so the
  // hazard cannot quietly return.
  await check("J1 the overlay importer never publishes the curriculum version", async () => {
    await withTarget("j1", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const raw = new DatabaseSync(file, { readOnly: true });
      const status = (raw.prepare(`SELECT status FROM "CurriculumVersion"`).get() as { status: string }).status;
      raw.close();
      assert.equal(status, "draft");
    });
  });

  await check("J2 publishing the curriculum first freezes its content (CONTENT FIRST)", async () => {
    await withTarget("j2", async (db, file) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
      process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
      // `publishContentVersion` uses the shared client, which binds DATABASE_URL
      // when the module is first evaluated. Point it at this fixture BEFORE the
      // dynamic import below, or the domain would answer about another database.
      const previousUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = `file:${file}`;
      try {
        const raw = new DatabaseSync(file);
        raw.exec(`UPDATE "CurriculumVersion" SET status='published', publishedAt=${Date.now()}`);
        raw.close();
        const { publishContentVersion } = await import("../../src/lib/curriculum/content");
        const successor = await db.contentVersion.findFirst({ where: { versionNumber: 2 }, select: { id: true } });
        let code: string | null = null;
        try {
          await publishContentVersion({ contentVersionId: successor!.id, actorId: 1 } as never);
        } catch (error) {
          code = (error as { code?: string }).code ?? null;
        }
        assert.equal(
          code,
          "CONTENT_PUBLISHED_IMMUTABLE",
          "publishing the curriculum before its content must make the content immutable",
        );
      } finally {
        delete process.env.CURRICULUM_V2_CONTENT_ENABLED;
        delete process.env.CURRICULUM_V2_ADMIN_ENABLED;
        if (previousUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousUrl;
      }
    });
  });

  /* ================= I. exporter round trip ================= */
  await check("I1 exporting an imported target reproduces the overlay's editorial claims", async () => {
    await withTarget("i1", async (db) => {
      await importEditorialOverlay(baseOverlay(), { db, allowPrincipalProvisioning: true });
      const structuralPackage = {
        curriculumCode: "ata-v2",
        curriculumVersionNumber: 3,
        packageCode: "synthetic.pkg",
        packageRevision: 1,
        contentFingerprint: PACKAGE_FINGERPRINT,
        modules: [
          {
            levels: [{ levelCode: L_LESSON, content: { versionNumber: 1 }, assessment: { versionNumber: 1 } }],
          },
        ],
      };
      const exported = await exportEditorialOverlay({
        db,
        structuralPackage,
        binding: {
          sourceCheckpointSha256: CHECKPOINT_SHA,
          sourceBackendCommit: COMMIT,
          sourceBackendTree: TREE,
          blueprintSourceDocumentSha256: BLUEPRINT_SHA,
        },
        overlayCode: "synthetic.overlay",
        overlayRevision: 1,
        generatedAt: new Date(T2),
      });
      const check = validateEditorialOverlay(exported);
      assert.equal(check.ok, true, JSON.stringify(check.ok ? [] : check.issues));
      // The round trip must agree on every claim, not merely be valid. Compare
      // section by section so a failure names WHICH claim moved.
      const left = canonicalOverlayProjection(baseOverlay()) as Record<string, unknown>;
      const right = canonicalOverlayProjection(exported) as Record<string, unknown>;
      for (const key of Object.keys(left)) {
        assert.equal(
          JSON.stringify(right[key]),
          JSON.stringify(left[key]),
          `round trip changed section "${key}"`,
        );
      }
      assert.equal(calculateOverlayFingerprint(exported), calculateOverlayFingerprint(baseOverlay()));
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exitCode = 1;
});
