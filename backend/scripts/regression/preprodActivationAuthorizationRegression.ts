/**
 * PREPROD ACTIVATION AUTHORIZATION — regression suite.
 *
 * WHAT IS BEING PROVED. That the only way a protected runtime database becomes a
 * legal import target is a runtime capability issued by this process after a
 * complete, reviewed, digest-pinned activation manifest has been satisfied — and
 * that every precondition in it is load-bearing.
 *
 * THE THREE THINGS THE INDEPENDENT AUDIT BROKE, AND THE TESTS THAT NOW HOLD THEM
 * SHUT:
 *
 *   B1  a grant was authenticated from its own public fields, so an object
 *       literal carried authority. `grant forgery matrix` builds every copy,
 *       clone, serialisation and look-alike the audit used — and the exploit
 *       itself, against the real importer — and requires each to be refused.
 *
 *   H1  `--expect-target-sha256` let a caller nominate the digest the target was
 *       expected to hold, so a tampered post-migration database could be blessed
 *       by whoever ran `sha256sum`. `post-migration trust` tampers with a user
 *       row, a financial row, the schema and the migration table, and requires a
 *       refusal in each case. The flag no longer exists, which the argument
 *       surface test asserts directly.
 *
 *   M1  the content activation plan was pinned but never checked, so a wrong
 *       code, version, mode, or a missing or extra row all authorized. `content
 *       plan matrix` runs all six and requires refusals.
 *
 * EVERYTHING RUNS AGAINST DISPOSABLE FIXTURES. The live PREPROD database is
 * never opened for writing and never named as an authorized target. It appears
 * only in the tests that assert it is REFUSED.
 *
 * WHY THE POSITIVE PATH IS TESTED AT MODULE LEVEL RATHER THAN THROUGH THE CLI.
 * The sanctioned target is a constant in `target.ts` and is deliberately not
 * reachable from any command line — that unreachability is the property that
 * stops a prepared manifest from being retargeted. A CLI-level positive test
 * would therefore require either mutating the real PREPROD database or adding
 * the very argv surface the design exists to withhold. So the CLI is tested for
 * its refusals, and the full authorize -> capability -> guard -> import chain is
 * exercised in-process with the test-only substitution.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import {
  assertPreprodActivationAuthorization,
  type AuthorizationInput,
} from "../../src/lib/curriculum/preprod-activation/authorize";
import { PREPROD_RISK_POLICY } from "../../src/lib/curriculum/preprod-activation/backup";
import {
  assertContentActivationPlanMatches,
  deriveContentActivationPlan,
  summarizeContentActivationPlan,
  type ContentActivationRow,
} from "../../src/lib/curriculum/preprod-activation/content-plan";
import { isPreprodActivationError } from "../../src/lib/curriculum/preprod-activation/errors";
import {
  isAuthenticActivationGrant,
  type PreprodActivationGrant,
} from "../../src/lib/curriculum/preprod-activation/grant";
import { ACTIVATION_LOCK_PATH, acquireActivationLock } from "../../src/lib/curriculum/preprod-activation/lock";
import { hashManifestBytes } from "../../src/lib/curriculum/preprod-activation/manifest";
import { prepareActivationManifest } from "../../src/lib/curriculum/preprod-activation/prepare";
import {
  captureStageFingerprint,
  canonicalPrincipalIdentity,
  classifyCredential,
  diffStageFingerprint,
  listAvailableProjections,
  readPrincipalRowSets,
  readSemanticCoverage,
  AUDIT_METADATA_NORMALISATIONS,
  FILTERED_BUSINESS_TABLES,
  FILTERED_TABLE_STAGE_OWNERS,
  OVERLAY_NO_LOGIN_MARKER,
  SEMANTIC_STATE_VERSION,
  type StageFingerprint,
} from "../../src/lib/curriculum/preprod-activation/semantic-state";
import { rehearseActivation } from "../../src/lib/curriculum/preprod-activation/rehearsal";
import { classifyTargetState, type ActivationStateChain } from "../../src/lib/curriculum/preprod-activation/stages";
import { ACTIVATION_STAGES } from "../../src/lib/curriculum/preprod-activation/stages";
import { NEVER_AUTHORIZED_DATABASE_PATHS } from "../../src/lib/curriculum/preprod-activation/target";
import {
  assertSafeDatabaseTarget,
  assertTargetIdentityUnchanged,
  isProtectedDatabaseError,
} from "../../src/lib/curriculum/protected-database";
import { readStructuralPackageFacts, readOverlayFacts } from "../../src/lib/curriculum/preprod-activation/artifact-facts";
import { importCurriculumPackage } from "../../src/lib/curriculum/package/import";
import { importEditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/import";

const ROOT = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ata-actv-auth-"));
const REPO = path.resolve(__dirname, "..", "..");

const PREP_DB = path.join(ROOT, "prep-target.sqlite");
const PREP_BACKUP = path.join(ROOT, "backups", "rollback.sqlite");
const RUN_DB = path.join(ROOT, "run-target.sqlite");
const MANIFEST_DIR = path.join(ROOT, "manifests");
const CHECKPOINT = path.join(ROOT, "accepted-checkpoint.sqlite");
const OVERLAY_PATH = path.join(ROOT, "overlay-v2.json");
const OVERLAY_AUTHOR = "g2.author.a@fixture.invalid";
const OVERLAY_REVIEWER = "g2.reviewer.r@fixture.invalid";
const LOCK_PATH = path.join(ROOT, "activation.lock");

const PACKAGE_PATH = path.join(REPO, "curriculum", "packages", "ata-v2-first-slice.approved.json");
const OTHER_PACKAGE_PATH = path.join(REPO, "curriculum", "packages", "ata-v2-canonical-100.draft.json");

/**
 * The transport baseline the FIXTURE overlay was exported from.
 *
 * Read from this checkout rather than hard-coded: the exporter stamps the commit
 * and tree it was run at, and the authorization cross-checks that against the
 * manifest. Pinning a literal here would mean the suite could only ever pass at
 * one commit — and the thing under test is that the cross-check fires, not which
 * hash it happens to see.
 */
function gitObject(rev: string): string {
  const result = spawnSync("git", ["rev-parse", rev], { cwd: REPO, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`cannot resolve ${rev}: ${result.stderr}`);
  return result.stdout.trim();
}
const TRANSPORT_COMMIT = gitObject("HEAD");
const TRANSPORT_TREE = gitObject("HEAD^{tree}");
const MACHINE_ID_SHA = crypto.createHash("sha256").update("fixture-machine-id").digest("hex");
const OTHER_MACHINE_ID_SHA = crypto.createHash("sha256").update("some-other-machine").digest("hex");

const RELEASES = {
  backend: "734e632ea450cdd8a3662afe2eb1dcd7b0935607",
  academy: "4c4ced398d2b2a73cdf8d95652b9171b425fdf06",
  crm: "8328903fd4f7f2dc3d73f1ae4e4068c0165d9d1b",
};
const FLAG_KEYS = [
  "CURRICULUM_V2_ADMIN_ENABLED",
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED",
  "CURRICULUM_V2_XP_ENABLED",
  "CURRICULUM_V2_CONTENT_ENABLED",
  "CURRICULUM_V2_ASSESSMENT_ENABLED",
  "CURRICULUM_V2_REPORT_ENABLED",
  "CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED",
  "CURRICULUM_V2_CHECKPOINT_ENABLED",
];
const FLAGS = Object.fromEntries(FLAG_KEYS.map((key) => [key, "absent" as const]));

/**
 * A minimal, explicit environment.
 *
 * Built from nothing rather than spread from `process.env`, so a stray
 * `ATA_ENVIRONMENT` or `APP_URL` in the shell running the suite cannot decide
 * the outcome of an environment-classification test.
 */
function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as unknown as NodeJS.ProcessEnv;
}
const PREPROD_ENV: NodeJS.ProcessEnv = env({ ATA_ENVIRONMENT: "staging" });

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Assert that `fn` refuses with one of `codes`, and returns which one.
 *
 * Used where two refusals are BOTH correct and the more specific one is
 * preferred: an unexpected historical principal before the overlay is caught by
 * name (`UNEXPECTED_HISTORICAL_PRINCIPAL`) when the stage runs that check, and by
 * the state chain (`STAGE_STATE_UNKNOWN`) when it does not. Pinning one string
 * would make the test about which message won rather than about the refusal.
 */
function refusesOneOf(codes: readonly string[], fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (isPreprodActivationError(error)) {
      assert.ok(codes.includes(error.code), `expected one of ${codes.join("|")}, got ${error.code}: ${error.message}`);
      return error.code;
    }
    assert.fail(`expected a PreprodActivationError, got: ${String(error)}`);
  }
  assert.fail(`expected a refusal (${codes.join("|")}), but the call succeeded`);
}

/** Assert that `fn` throws a PreprodActivationError with exactly `code`. */
function refuses(code: string, fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    if (isPreprodActivationError(error)) {
      assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
      return;
    }
    assert.fail(`expected a PreprodActivationError(${code}), got: ${String(error)}`);
  }
  assert.fail(`expected a refusal with code ${code}, but the call succeeded`);
}

/* ------------------------------------------------------------------ *
 * fixtures
 * ------------------------------------------------------------------ */

function migrate(databasePath: string): void {
  const runner = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    cwd: REPO,
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    encoding: "utf8",
  });
  if (runner.status !== 0) throw new Error(`migration chain failed: ${runner.stderr || runner.stdout}`);
  dropSidecars(databasePath);
}

function dropSidecars(databasePath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

/** A faithful copy, taken exactly the way the sanctioned ops tool takes one. */
function takeOnlineBackup(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.rmSync(destination, { force: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    // `VACUUM INTO` produces a logically identical database in one statement and,
    // like the Online Backup API, does not clone the source file byte-for-byte —
    // which is precisely the property the logical-digest check exists to handle.
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  fs.chmodSync(destination, 0o600);
}

function query(databasePath: string, sql: string, params: Array<string | number> = []): number {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (db.prepare(sql).get(...params) as { n: number }).n;
  } finally {
    db.close();
  }
}

function exec(databasePath: string, sql: string): void {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
  dropSidecars(databasePath);
}

/** Every migration directory, in the order the runner applies them. */
function migrationNames(): string[] {
  return fs
    .readdirSync(path.join(REPO, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Apply the FIRST `count` migrations, exactly the way `prisma/migrate.ts` does.
 *
 * The suite has to exercise a genuine 41 -> 46 transition, because that is the
 * branch the independent audit found untested and the one the whole trust chain
 * turns on. The runner has no "migrate to N" mode, so the entry lineage is built
 * here — same statement splitting, same checksum, same bookkeeping — and the
 * REAL runner then finishes the job during the test.
 */
function buildLineage(target: string, count: number): void {
  const db = new DatabaseSync(target);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    for (const name of migrationNames().slice(0, count)) {
      const sql = fs.readFileSync(path.join(REPO, "prisma", "migrations", name, "migration.sql"), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
        db.exec(statement);
      }
      const insert = db.prepare(
        'INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","applied_steps_count","finished_at") VALUES (?,?,?,?,?)',
      );
      insert.run(crypto.randomUUID(), checksum, name, 1, Date.now());
    }
  } finally {
    db.close();
  }
  dropSidecars(target);
}

/**
 * An ENTRY-state fixture: the schema at the pre-activation lineage, with enough
 * business rows for the continuity digest to have something to protect.
 */
function buildEntryFixture(target: string, entryCount: number): void {
  fs.rmSync(target, { force: true });
  buildLineage(target, entryCount);
  const db = new DatabaseSync(target);
  try {
    db.exec(`INSERT INTO "User" ("email","name","passwordHash","role","status","level","xp","createdAt","updatedAt")
             VALUES ('learner.one@fixture.invalid','Learner One','x','user','active',1,0,1786000000000,1786000000000),
                    ('learner.two@fixture.invalid','Learner Two','x','user','active',2,50,1786000001000,1786000001000)`);
    db.exec(`INSERT INTO "AuditLog" ("userId","action","entityType","entityId","createdAt")
             VALUES (1,'fixture.seed','User',1,1786000000000)`);
    db.exec(`INSERT INTO "Reward" ("title","description","status","type")
             VALUES ('seed reward','a pre-existing business row','active','bonus')`);
  } finally {
    db.close();
  }
  dropSidecars(target);
}

/**
 * A GENUINE overlay for the package under test, produced by the real exporter.
 *
 * A hand-written artifact would prove only that hand-written JSON parses. The
 * rehearsal now IMPORTS the overlay, so it has to be one that actually belongs
 * to the package it names: a throwaway checkpoint is migrated, given the
 * structural import, marked up as a completed review, and exported through
 * `exportEditorialOverlay.ts` — the same command that produced the accepted
 * artifact. The scratch checkpoint is removed by absolute path afterwards.
 */
async function buildOverlayFixture(): Promise<void> {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ata-actv-overlay-"));
  const checkpoint = path.join(scratch, "checkpoint.sqlite");
  try {
    migrate(checkpoint);

    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: `file:${checkpoint}` } } });
    try {
      const raw = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8")) as unknown;
      const result = await importCurriculumPackage(raw, { db, dryRun: false });
      if (!result.ok) throw new Error("overlay fixture: structural import failed");
    } finally {
      await db.$disconnect();
    }
    dropSidecars(checkpoint);

    const sql = new DatabaseSync(checkpoint);
    try {
      const T = 1786000000000;
      sql.exec(
        `INSERT INTO "User" ("email","name","passwordHash","role","status","level","xp","createdAt","updatedAt")
         VALUES ('${OVERLAY_AUTHOR}','Fixture Author','x','user','active',1,0,${T},${T}),
                ('${OVERLAY_REVIEWER}','Fixture Reviewer','x','user','active',1,0,${T},${T})`,
      );
      const author = (sql.prepare(`SELECT id AS n FROM "User" WHERE email = ?`).get(OVERLAY_AUTHOR) as { n: number }).n;
      const reviewer = (sql.prepare(`SELECT id AS n FROM "User" WHERE email = ?`).get(OVERLAY_REVIEWER) as { n: number }).n;
      sql.exec(
        `INSERT INTO "StaffProfile" ("id","userId","displayName","staffRole","permissionVersion","createdAt","updatedAt")
         VALUES ('sp-author',${author},'Fixture Author','content_manager',1,${T},${T}),
                ('sp-reviewer',${reviewer},'Fixture Reviewer','crm_admin',1,${T},${T})`,
      );
      for (const table of ["ContentVersion", "AssessmentVersion"]) {
        sql.exec(
          `UPDATE "${table}" SET "editorialState"='approved', "revision"=2,
             "createdById"=${author}, "lastAuthoredById"=${author}, "lastAuthoredAt"=${T},
             "submittedById"=${author}, "submittedAt"=${T},
             "approvedById"=${reviewer}, "approvedAt"=${T}`,
        );
      }
    } finally {
      sql.close();
    }
    dropSidecars(checkpoint);

    const exported = spawnSync(
      "npx",
      [
        "tsx",
        path.join("scripts", "curriculum", "exportEditorialOverlay.ts"),
        "--source",
        `file:${checkpoint}`,
        "--package",
        PACKAGE_PATH,
        "--out",
        OVERLAY_PATH,
        "--json",
      ],
      { cwd: REPO, encoding: "utf8" },
    );
    if (exported.status !== 0) {
      throw new Error(`overlay export failed: ${exported.stderr || exported.stdout}`);
    }
    fs.chmodSync(OVERLAY_PATH, 0o600);

    // The overlay records the digest of the source it was exported from, and the
    // authorization cross-checks that against the manifest's accepted-checkpoint
    // pin. So the file the overlay names becomes the checkpoint the manifest
    // names — keeping the cross-check load-bearing instead of routing around it.
    fs.copyFileSync(checkpoint, CHECKPOINT);
    fs.chmodSync(CHECKPOINT, 0o600);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * A manifest being deliberately broken.
 *
 * Typed loosely on purpose: every mutator here exists to produce a manifest the
 * schema or the authorization should REJECT, so constraining the draft to the
 * valid shape would make most of the negative cases unexpressible.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifestDraft = Record<string, any>;

type ManifestFile = { path: string; sha256: string; json: ManifestDraft };

let baseManifest: ManifestFile;
let packageFacts: ReturnType<typeof readStructuralPackageFacts>;
let overlayFacts: ReturnType<typeof readOverlayFacts>;

function manifestWith(mutate: (draft: ManifestDraft) => void, name: string): ManifestFile {
  const draft = JSON.parse(JSON.stringify(baseManifest.json)) as ManifestDraft;
  mutate(draft);
  const json = `${JSON.stringify(draft, null, 2)}\n`;
  const filePath = path.join(MANIFEST_DIR, `${name}.json`);
  fs.writeFileSync(filePath, json, { mode: 0o600 });
  return { path: filePath, sha256: hashManifestBytes(json), json: draft };
}

function authorizationInput(
  manifest: ManifestFile = baseManifest,
  overrides: Partial<AuthorizationInput> = {},
): AuthorizationInput {
  return {
    activationManifestPath: manifest.path,
    expectedManifestSha256: manifest.sha256,
    operation: "STRUCTURAL_IMPORT",
    stage: "STRUCTURAL_IMPORT",
    structuralPackage: packageFacts,
    hostIdentityProvider: () => ({ machineIdSha256: MACHINE_ID_SHA, hostname: "fixture-host" }),
    deployedReleasesProvider: () => ({ ...RELEASES }),
    flagBaselineProvider: () => ({ ...FLAGS }),
    environmentVariables: PREPROD_ENV,
    sanctionedTargetOverride: { __testOnlySanctionedTargetPath: RUN_DB },
    ...overrides,
  };
}

const overlayInput = (overrides: Partial<AuthorizationInput> = {}): AuthorizationInput =>
  authorizationInput(baseManifest, {
    operation: "EDITORIAL_OVERLAY",
    stage: "EDITORIAL_OVERLAY",
    overlay: overlayFacts,
    ...overrides,
  });

const GUARD_ENV = () => env({ ATA_PROTECTED_DATABASES: RUN_DB });

/** Snapshot / restore, so a destructive test cannot leak into the next one. */
function snapshot(databasePath: string): Buffer {
  return fs.readFileSync(databasePath);
}
function restore(databasePath: string, bytes: Buffer): void {
  fs.writeFileSync(databasePath, bytes);
  dropSidecars(databasePath);
}

/* ------------------------------------------------------------------ *
 * suite
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true, mode: 0o700 });

  const allMigrations = migrationNames();
  const targetMigrationCount = allMigrations.length;
  // Five short of the head, so the rehearsal and the real run both perform a
  // genuine multi-migration transition rather than a no-op.
  const entryMigrationCount = targetMigrationCount - 5;

  packageFacts = readStructuralPackageFacts(PACKAGE_PATH);

  // The overlay fixture also produces the accepted checkpoint it was exported
  // from, so it runs before anything that pins a checkpoint digest.
  await buildOverlayFixture();
  overlayFacts = readOverlayFacts(OVERLAY_PATH);

  buildEntryFixture(PREP_DB, entryMigrationCount);
  takeOnlineBackup(PREP_DB, PREP_BACKUP);

  // ---- preparation, WITH the rehearsal. This is the thing that produces the
  // state chain every later check is made against.
  const prepared = await prepareActivationManifest({
    activationId: "fixture-activation-0001",
    liveDatabasePath: PREP_DB,
    backupArtifactPath: PREP_BACKUP,
    structuralPackagePath: PACKAGE_PATH,
    overlayPath: OVERLAY_PATH,
    acceptedCheckpointPath: CHECKPOINT,
    transportBaselineCommit: TRANSPORT_COMMIT,
    transportBaselineTree: TRANSPORT_TREE,
    entryMigrationCount,
    targetMigrationCount,
    hostIdentityProvider: () => ({ machineIdSha256: MACHINE_ID_SHA, hostname: "fixture-host" }),
    deployedReleasesProvider: () => ({ ...RELEASES }),
    flagBaselineProvider: () => ({ ...FLAGS }),
    sanctionedTargetOverride: { __testOnlySanctionedTargetPath: PREP_DB },
    now: new Date("2026-08-11T09:00:00.000Z"),
  });

  // ---- the run target: a second fixture identical to the one prepared against.
  fs.copyFileSync(PREP_DB, RUN_DB);
  fs.chmodSync(RUN_DB, 0o600);
  const runStat = fs.statSync(RUN_DB);
  const draft = JSON.parse(prepared.json) as ManifestDraft;
  draft.targetDatabase.canonicalPath = RUN_DB;
  draft.targetDatabase.device = runStat.dev;
  draft.targetDatabase.inode = runStat.ino;
  const baseJson = `${JSON.stringify(draft, null, 2)}\n`;
  const basePath = path.join(MANIFEST_DIR, "base.json");
  fs.writeFileSync(basePath, baseJson, { mode: 0o600 });
  baseManifest = { path: basePath, sha256: hashManifestBytes(baseJson), json: draft };

  const entryBytes = snapshot(RUN_DB);

  await check(`the fixture exercises a real ${entryMigrationCount} -> ${targetMigrationCount} transition`, () => {
    assert.equal(query(RUN_DB, "SELECT COUNT(*) AS n FROM _prisma_migrations WHERE rolled_back_at IS NULL"), entryMigrationCount);
    assert.notEqual(
      prepared.manifest.stateChain.entry.compositeDigest,
      prepared.manifest.stateChain.postMigration.compositeDigest,
    );
  });

  // The sanctioned migration stage, run by the REAL runner.
  migrate(RUN_DB);
  const migratedBytes = snapshot(RUN_DB);

  /* ---------- preparation ---------- */

  await check("prepare writes a 0600 manifest and mutates no database", () => {
    assert.equal(fs.statSync(basePath).mode & 0o777, 0o600);
    assert.equal(prepared.manifest.environment, "preprod");
    assert.equal(prepared.manifest.riskPolicy, PREPROD_RISK_POLICY);
    assert.equal(prepared.manifest.assessmentRuntimePolicy, "DEFER");
    assert.equal(prepared.manifest.videoRuntimePolicy, "ASSET_QA_DEFERRED");
    // the database preparation read is untouched by the rehearsal
    assert.equal(query(PREP_DB, 'SELECT COUNT(*) AS n FROM "CurriculumVersion"'), 0);
  });

  await check("prepare rehearses all four states and pins them", () => {
    const chain = prepared.manifest.stateChain;
    const digests = [
      chain.entry.compositeDigest,
      chain.postMigration.compositeDigest,
      chain.postStructural.compositeDigest,
      chain.postOverlay.compositeDigest,
    ];
    assert.equal(new Set(digests).size, 4, "the four rehearsed states must be distinguishable");
    for (const state of Object.values(chain)) {
      assert.equal(state.migrationLineage.failedCount, 0);
      assert.match(state.compositeDigest, /^[0-9a-f]{64}$/);
    }
  });

  await check("prepare leaves no rehearsal scratch directory behind", () => {
    const leftovers = fs
      .readdirSync(fs.realpathSync(os.tmpdir()))
      .filter((name) => name.startsWith("ata-activation-rehearsal-"));
    assert.deepEqual(leftovers, [], `rehearsal scratch survived: ${leftovers.join(", ")}`);
  });

  await check("every semantic projection is answerable at the activation lineage", () => {
    const available = listAvailableProjections(RUN_DB);
    assert.equal(
      available.curriculum.length,
      available.curriculumTotal,
      `curriculum projections unavailable: ${available.curriculumTotal - available.curriculum.length}`,
    );
    assert.equal(
      available.editorial.length,
      available.editorialTotal,
      `editorial projections unavailable: ${available.editorialTotal - available.editorial.length}`,
    );
  });

  /* ---------- B1: the capability cannot be forged ---------- */

  await check("a complete, unmodified manifest authorizes the structural import", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    assert.equal(evidence.disposition, "EXECUTE");
    assert.equal(evidence.observedState, "POST_MIGRATION");
    assert.ok(evidence.grant, "an executable stage must yield a capability");
    assert.equal(isAuthenticActivationGrant(evidence.grant), true);
  });

  await check("the authentic capability admits the protected target through the guard", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    const resolved = assertSafeDatabaseTarget(`file:${RUN_DB}`, {
      env: GUARD_ENV(),
      activationGrant: evidence.grant!,
      activationOperation: "STRUCTURAL_IMPORT",
    });
    assert.equal(resolved.absolutePath, RUN_DB);
  });

  await check("without a capability the same target is refused", () => {
    assert.throws(
      () => assertSafeDatabaseTarget(`file:${RUN_DB}`, { env: GUARD_ENV() }),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_PROTECTED"),
    );
  });

  // THE FORGERY MATRIX. Every one of these was ALLOWED before the correction.
  await check("GRANT FORGERY MATRIX: no constructed look-alike is accepted", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    const real = evidence.grant!;
    const stat = fs.statSync(RUN_DB);

    const literal = {
      kind: "preprod-activation" as const,
      activationId: "forged",
      manifestSha256: baseManifest.sha256,
      operation: "STRUCTURAL_IMPORT",
      stage: "STRUCTURAL_IMPORT",
      target: { absolutePath: RUN_DB, device: stat.dev, inode: stat.ino },
      // the audit's own trick: the caller supplies the validator
      assertStillValid: () => {},
    };

    class LookAlike {
      kind = "preprod-activation" as const;
      activationId = "forged";
      manifestSha256 = baseManifest.sha256;
      operation = "STRUCTURAL_IMPORT";
      stage = "STRUCTURAL_IMPORT";
      target = { absolutePath: RUN_DB, device: stat.dev, inode: stat.ino };
      assertStillValid(): void {}
    }

    const candidates: Array<[string, unknown]> = [
      ["a hand-built object literal", literal],
      ["a spread clone of the literal", { ...literal }],
      ["Object.assign onto a fresh object", Object.assign({}, literal)],
      ["a JSON round-trip of the literal", JSON.parse(JSON.stringify(literal))],
      ["a class instance shaped like a grant", new LookAlike()],
      ["a prototype-spoofed object", Object.create(Object.getPrototypeOf(real) as object, Object.getOwnPropertyDescriptors(literal))],
      ["a spread clone of the REAL capability", { ...real }],
      ["a JSON round-trip of the REAL capability", JSON.parse(JSON.stringify(real))],
      ["Object.assign of the REAL capability", Object.assign({}, real)],
      ["a structuredClone of the REAL capability", structuredClone({ ...real })],
      ["null", null],
      ["a bare string", "preprod-activation"],
    ];

    for (const [label, candidate] of candidates) {
      assert.equal(isAuthenticActivationGrant(candidate), false, `${label} must not be in the registry`);
      assert.throws(
        () =>
          assertSafeDatabaseTarget(`file:${RUN_DB}`, {
            env: GUARD_ENV(),
            activationGrant: candidate as PreprodActivationGrant,
            activationOperation: "STRUCTURAL_IMPORT",
          }),
        (error: unknown) =>
          isPreprodActivationError(error, "GRANT_NOT_AUTHENTIC") || isProtectedDatabaseError(error),
        `${label} was accepted by the guard`,
      );
    }
  });

  await check("REAL IMPORTER FORGERY: the audit's exploit writes nothing", async () => {
    const before = query(RUN_DB, 'SELECT COUNT(*) AS n FROM "CurriculumVersion"');
    const stat = fs.statSync(RUN_DB);
    const forged = {
      kind: "preprod-activation" as const,
      activationId: "no-manifest-was-ever-reviewed",
      manifestSha256: "0".repeat(64),
      operation: "STRUCTURAL_IMPORT",
      stage: "STRUCTURAL_IMPORT",
      target: { absolutePath: RUN_DB, device: stat.dev, inode: stat.ino },
      assertStillValid: () => {},
    };
    let admitted = false;
    try {
      assertSafeDatabaseTarget(`file:${RUN_DB}`, {
        env: GUARD_ENV(),
        activationGrant: forged as unknown as PreprodActivationGrant,
        activationOperation: "STRUCTURAL_IMPORT",
      });
      admitted = true;
    } catch {
      /* expected */
    }
    assert.equal(admitted, false, "the forged capability reached the importer");
    assert.equal(query(RUN_DB, 'SELECT COUNT(*) AS n FROM "CurriculumVersion"'), before);
  });

  await check("a capability is bound to one operation and does not generalise", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    assert.throws(
      () =>
        assertSafeDatabaseTarget(`file:${RUN_DB}`, {
          env: GUARD_ENV(),
          activationGrant: evidence.grant!,
          activationOperation: "EDITORIAL_OVERLAY",
        }),
      (error: unknown) => isPreprodActivationError(error, "GRANT_OPERATION_MISMATCH"),
    );
  });

  await check("a capability supplied without naming an operation is refused", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    assert.throws(
      () => assertSafeDatabaseTarget(`file:${RUN_DB}`, { env: GUARD_ENV(), activationGrant: evidence.grant! }),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_PROTECTED"),
    );
  });

  await check("a capability for one database does not admit another", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    const other = path.join(ROOT, "other.sqlite");
    fs.copyFileSync(RUN_DB, other);
    assert.throws(
      () =>
        assertSafeDatabaseTarget(`file:${other}`, {
          env: env({ ATA_PROTECTED_DATABASES: other }),
          activationGrant: evidence.grant!,
          activationOperation: "STRUCTURAL_IMPORT",
        }),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_PROTECTED"),
    );
  });

  await check("a hardlink alias of the granted file is still refused", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    const alias = path.join(ROOT, "alias.sqlite");
    fs.rmSync(alias, { force: true });
    fs.linkSync(RUN_DB, alias);
    assert.throws(
      () =>
        assertSafeDatabaseTarget(`file:${alias}`, {
          env: GUARD_ENV(),
          activationGrant: evidence.grant!,
          activationOperation: "STRUCTURAL_IMPORT",
        }),
      (error: unknown) => isProtectedDatabaseError(error, "TARGET_PROTECTED"),
    );
  });

  await check("a STALE capability is refused once the target has moved on", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    const before = snapshot(RUN_DB);
    try {
      exec(RUN_DB, `UPDATE "User" SET "xp" = "xp" + 1 WHERE "id" = (SELECT MIN("id") FROM "User")`);
      assert.throws(
        () =>
          assertSafeDatabaseTarget(`file:${RUN_DB}`, {
            env: GUARD_ENV(),
            activationGrant: evidence.grant!,
            activationOperation: "STRUCTURAL_IMPORT",
          }),
        (error: unknown) => isPreprodActivationError(error, "STAGE_STATE_UNKNOWN"),
      );
    } finally {
      restore(RUN_DB, before);
    }
  });

  /* ---------- H1: no caller-controlled trust reset ---------- */

  await check("the argument surface has no target-digest, completed-stages or lock flag", () => {
    const sources = [
      "src/lib/curriculum/preprod-activation/cli.ts",
      "scripts/curriculum/importCurriculumPackage.ts",
      "scripts/curriculum/importEditorialOverlay.ts",
      "scripts/curriculum/validatePreprodActivationManifest.ts",
    ].map((rel) => fs.readFileSync(path.join(REPO, rel), "utf8"));
    for (const forbidden of ['"--expect-target-sha256"', '"--completed-stages"', '"--activation-lock"']) {
      for (const source of sources) {
        assert.equal(source.includes(forbidden), false, `${forbidden} is still a parsed flag`);
      }
    }
  });

  await check("AuthorizationInput accepts no expected-state field of any kind", () => {
    const input = authorizationInput() as Record<string, unknown>;
    for (const banned of ["expectedTargetSha256", "completedStages", "expectedState", "expectedCompositeDigest"]) {
      assert.equal(banned in input, false, `${banned} is still part of the authorization input`);
    }
  });

  for (const [label, sql] of [
    ["a user row", `UPDATE "User" SET "updatedAt" = "updatedAt" + 1 WHERE "id" = (SELECT MIN("id") FROM "User")`],
    ["a pre-existing reward row", `UPDATE "Reward" SET "description" = 'rewritten' WHERE "id" = (SELECT MIN("id") FROM "Reward")`],
    ["a pre-existing audit row", `UPDATE "AuditLog" SET "action" = 'rewritten' WHERE "id" = (SELECT MIN("id") FROM "AuditLog")`],
  ] as const) {
    await check(`POST-MIGRATION TRUST: tampering with ${label} refuses the structural import`, () => {
      const before = snapshot(RUN_DB);
      try {
        exec(RUN_DB, sql);
        refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(authorizationInput()));
      } finally {
        restore(RUN_DB, before);
      }
    });
  }

  await check("POST-MIGRATION TRUST: a schema change refuses the structural import", () => {
    const before = snapshot(RUN_DB);
    try {
      exec(RUN_DB, `CREATE TABLE "InjectedTable" ("id" INTEGER PRIMARY KEY)`);
      refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(authorizationInput()));
    } finally {
      restore(RUN_DB, before);
    }
  });

  for (const [label, sql] of [
    ["a migration checksum", `UPDATE _prisma_migrations SET checksum = 'tampered' WHERE rowid = (SELECT MIN(rowid) FROM _prisma_migrations)`],
    ["a migration name", `UPDATE _prisma_migrations SET migration_name = 'not_a_sanctioned_migration' WHERE rowid = (SELECT MIN(rowid) FROM _prisma_migrations)`],
    ["a rolled-back marker", `UPDATE _prisma_migrations SET rolled_back_at = 1786000000000 WHERE rowid = (SELECT MAX(rowid) FROM _prisma_migrations)`],
    ["an unfinished marker", `UPDATE _prisma_migrations SET finished_at = NULL WHERE rowid = (SELECT MAX(rowid) FROM _prisma_migrations)`],
  ] as const) {
    await check(`MIGRATION TABLE: tampering with ${label} refuses the structural import`, () => {
      const before = snapshot(RUN_DB);
      try {
        exec(RUN_DB, sql);
        refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(authorizationInput()));
      } finally {
        restore(RUN_DB, before);
      }
    });
  }

  /* ---------- manifest identity ---------- */

  await check("a manifest whose bytes changed is refused", () => {
    const variant = manifestWith((d) => {
      d.activationId = `${String(d.activationId)}X`;
    }, "byte-changed");
    refuses("MANIFEST_SHA_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(variant, { expectedManifestSha256: baseManifest.sha256 })),
    );
  });

  await check("an unknown manifest field is refused (strict schema)", () => {
    const variant = manifestWith((d) => {
      d.stateChain.extra = "surprise";
    }, "unknown-field");
    refuses("MANIFEST_MALFORMED", () => assertPreprodActivationAuthorization(authorizationInput(variant)));
  });

  await check("a v1 activation manifest is refused with an explanation", () => {
    const variant = manifestWith((d) => {
      d.schemaVersion = "ata.preprod-activation-manifest/v1";
    }, "v1-manifest");
    try {
      assertPreprodActivationAuthorization(authorizationInput(variant));
      assert.fail("a v1 manifest parsed");
    } catch (error) {
      assert.equal(isPreprodActivationError(error, "MANIFEST_SCHEMA_UNSUPPORTED"), true);
      assert.match((error as Error).message, /target digest supplied on the command line/);
    }
  });

  await check("tampering with any pinned stage fingerprint changes the manifest digest", () => {
    const variant = manifestWith((d) => {
      d.stateChain.postStructural.curriculumDigest = "0".repeat(64);
    }, "tampered-chain");
    assert.notEqual(variant.sha256, baseManifest.sha256);
    refuses("MANIFEST_SHA_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(variant, { expectedManifestSha256: baseManifest.sha256 })),
    );
  });

  await check("a re-digested manifest with a tampered stage fingerprint still refuses", () => {
    const variant = manifestWith((d) => {
      d.stateChain.postMigration.businessContinuityDigest = "0".repeat(64);
    }, "rehashed-chain");
    refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(authorizationInput(variant)));
  });

  /* ---------- environment, host, target ---------- */

  for (const [label, overrides] of [
    ["production", { ATA_ENVIRONMENT: "production" }],
    ["dev", { ATA_ENVIRONMENT: "dev" }],
    ["absent", {}],
    ["a value that is not a deployment class", { ATA_ENVIRONMENT: "preprod" }],
  ] as const) {
    await check(`a host classified ${label} cannot satisfy a PREPROD manifest`, () => {
      refuses("ENVIRONMENT_NOT_PREPROD", () =>
        assertPreprodActivationAuthorization(authorizationInput(baseManifest, { environmentVariables: env(overrides) })),
      );
    });
  }

  for (const value of ["prod", "production", "dev", "local", "test"]) {
    await check(`a manifest declaring environment=${value} does not parse`, () => {
      const variant = manifestWith((d) => {
        d.environment = value;
      }, `env-${value}`);
      refuses("MANIFEST_MALFORMED", () => assertPreprodActivationAuthorization(authorizationInput(variant)));
    });
  }

  await check("a manifest prepared for another machine is refused", () => {
    const variant = manifestWith((d) => {
      d.host.machineIdSha256 = OTHER_MACHINE_ID_SHA;
    }, "other-machine");
    refuses("HOST_MISMATCH", () => assertPreprodActivationAuthorization(authorizationInput(variant)));
  });

  for (const forbidden of NEVER_AUTHORIZED_DATABASE_PATHS) {
    await check(`${path.basename(forbidden)} can never be an activation target`, () => {
      refuses("TARGET_NOT_SANCTIONED", () =>
        assertPreprodActivationAuthorization(
          authorizationInput(baseManifest, { sanctionedTargetOverride: { __testOnlySanctionedTargetPath: forbidden } }),
        ),
      );
    });
  }

  await check("a manifest naming a database other than the sanctioned target is refused", () => {
    const variant = manifestWith((d) => {
      d.targetDatabase.canonicalPath = "/srv/ata-data/data/ata-prod.sqlite";
    }, "other-target");
    refuses("TARGET_NOT_SANCTIONED", () => assertPreprodActivationAuthorization(authorizationInput(variant)));
  });

  await check("a target whose inode changed is refused", () => {
    const variant = manifestWith((d) => {
      d.targetDatabase.inode = Number(d.targetDatabase.inode) + 1;
    }, "inode");
    refuses("TARGET_IDENTITY_MISMATCH", () => assertPreprodActivationAuthorization(authorizationInput(variant)));
  });

  /* ---------- the rollback artifact, at every stage ---------- */

  await check("a missing rollback backup is refused", () => {
    const bytes = fs.readFileSync(PREP_BACKUP);
    fs.rmSync(PREP_BACKUP, { force: true });
    try {
      refuses("BACKUP_ARTIFACT_MISSING", () => assertPreprodActivationAuthorization(authorizationInput()));
    } finally {
      fs.writeFileSync(PREP_BACKUP, bytes, { mode: 0o600 });
    }
  });

  await check("a rollback backup whose bytes changed is refused", () => {
    const bytes = fs.readFileSync(PREP_BACKUP);
    const mutated = Buffer.from(bytes);
    mutated[mutated.length - 1] ^= 0xff;
    fs.writeFileSync(PREP_BACKUP, mutated, { mode: 0o600 });
    try {
      refuses("BACKUP_ARTIFACT_DIGEST_MISMATCH", () => assertPreprodActivationAuthorization(authorizationInput()));
    } finally {
      fs.writeFileSync(PREP_BACKUP, bytes, { mode: 0o600 });
    }
  });

  await check("a world-readable rollback backup is refused", () => {
    fs.chmodSync(PREP_BACKUP, 0o644);
    try {
      refuses("BACKUP_ARTIFACT_PERMISSIVE", () => assertPreprodActivationAuthorization(authorizationInput()));
    } finally {
      fs.chmodSync(PREP_BACKUP, 0o600);
    }
  });

  await check("the backup is pinned to the ENTRY snapshot, not to the current file", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    assert.equal(evidence.backup.artifactSha256, baseManifest.json.backup.artifactSha256);
    // the target has moved past entry; the backup still validates
    assert.equal(evidence.observedState, "POST_MIGRATION");
  });

  await check("a backup taken from a different entry state is refused", () => {
    const variant = manifestWith((d) => {
      d.backup.sourceDatabaseSha256 = "0".repeat(64);
    }, "backup-other-source");
    refuses("BACKUP_SOURCE_DIGEST_MISMATCH", () => assertPreprodActivationAuthorization(authorizationInput(variant)));
  });

  /* ---------- reviewed inputs ---------- */

  await check("a different structural package is refused", () => {
    refuses("PACKAGE_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(baseManifest, { structuralPackage: readStructuralPackageFacts(OTHER_PACKAGE_PATH) }),
      ),
    );
  });

  await check("a changed accepted product checkpoint is refused", () => {
    const bytes = fs.readFileSync(CHECKPOINT);
    fs.writeFileSync(CHECKPOINT, Buffer.concat([bytes, Buffer.from("x")]), { mode: 0o600 });
    try {
      refuses("PRODUCT_CHECKPOINT_MISMATCH", () => assertPreprodActivationAuthorization(authorizationInput()));
    } finally {
      fs.writeFileSync(CHECKPOINT, bytes, { mode: 0o600 });
    }
  });

  for (const [label, field] of [
    ["sourceCheckpointSha256", "sourceCheckpointSha256"],
    ["sourceBackendCommit", "sourceBackendCommit"],
    ["sourceBackendTree", "sourceBackendTree"],
    ["structuralPackageFingerprint", "structuralPackageFingerprint"],
    ["acceptedReviewedRootHash", "acceptedReviewedRootHash"],
    ["canonical fingerprint", "fingerprint"],
  ] as const) {
    await check(`M-3: an overlay whose ${label} differs from the pin is refused`, () => {
      const variant = manifestWith((d) => {
        const current = String(d.editorialOverlay[field]);
        d.editorialOverlay[field] = current.length === 40 ? "0".repeat(40) : "0".repeat(64);
      }, `m3-${field}`);
      try {
        assertPreprodActivationAuthorization(overlayInput({ activationManifestPath: variant.path, expectedManifestSha256: variant.sha256 }));
        assert.fail("an overlay disagreeing with its pin was accepted");
      } catch (error) {
        assert.equal(isPreprodActivationError(error), true);
        assert.match(String((error as { code?: string }).code), /OVERLAY/);
      }
    });
  }

  for (const app of ["backend", "academy", "crm"] as const) {
    await check(`a redeployed ${app} release refuses the activation`, () => {
      refuses("RELEASE_MISMATCH", () =>
        assertPreprodActivationAuthorization(
          authorizationInput(baseManifest, {
            deployedReleasesProvider: () => ({ ...RELEASES, [app]: "0".repeat(40) }),
          }),
        ),
      );
    });
  }

  await check("a curriculum flag enabled since review refuses the activation", () => {
    refuses("FLAG_BASELINE_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(baseManifest, {
          flagBaselineProvider: () => ({ ...FLAGS, CURRICULUM_V2_CONTENT_ENABLED: "true" }),
        }),
      ),
    );
  });

  await check("a flag written as an explicit false is still a baseline change", () => {
    refuses("FLAG_BASELINE_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(baseManifest, {
          flagBaselineProvider: () => ({ ...FLAGS, CURRICULUM_V2_READ_ENABLED: "false" }),
        }),
      ),
    );
  });

  /* ---------- the positive chain, and the states it must reproduce ---------- */

  await check("POSITIVE STRUCTURAL IMPORT: the full chain runs and publishes nothing", async () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    assert.equal(evidence.disposition, "EXECUTE");
    const target = assertSafeDatabaseTarget(`file:${RUN_DB}`, {
      env: GUARD_ENV(),
      activationGrant: evidence.grant!,
      activationOperation: "STRUCTURAL_IMPORT",
    });
    assertTargetIdentityUnchanged(target, {
      env: GUARD_ENV(),
      activationGrant: evidence.grant!,
      activationOperation: "STRUCTURAL_IMPORT",
    });

    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: target.url } } });
    try {
      const raw = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8")) as unknown;
      const result = await importCurriculumPackage(raw, { db, dryRun: false });
      assert.equal(result.ok, true, `import failed: ${JSON.stringify((result as { issues?: unknown }).issues)}`);
    } finally {
      await db.$disconnect();
    }
    dropSidecars(RUN_DB);

    assert.equal(query(RUN_DB, `SELECT COUNT(*) AS n FROM "CurriculumVersion" WHERE "status" = 'published'`), 0);
    assert.equal(
      query(RUN_DB, 'SELECT COUNT(*) AS n FROM "CurriculumVersion" WHERE "code" = ? AND "versionNumber" = ?', [
        packageFacts.curriculumCode,
        packageFacts.curriculumVersionNumber,
      ]),
      1,
    );
    assert.equal(query(RUN_DB, 'SELECT COUNT(*) AS n FROM "SourceAuthorityResolution"'), 0);
    assert.equal(query(RUN_DB, 'SELECT COUNT(*) AS n FROM "EditorialReviewNote"'), 0);
  });

  await check("the real run reproduced the rehearsed post-structural state exactly", () => {
    const evidence = assertPreprodActivationAuthorization(overlayInput());
    assert.equal(evidence.observedState, "POST_STRUCTURAL");
    assert.equal(evidence.disposition, "EXECUTE");
  });

  // CORRECTION-2 works across three states, so each one is kept to restore to.
  const structuralBytes = snapshot(RUN_DB);

  await check("RESUME: repeating the structural stage is ALREADY_COMPLETE and grants nothing", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput());
    assert.equal(evidence.disposition, "ALREADY_COMPLETE");
    assert.equal(evidence.grant, null);
  });

  for (const [label, sql] of [
    ["a level title", `UPDATE "LevelDefinition" SET "title" = 'tampered' WHERE "id" = (SELECT MIN("id") FROM "LevelDefinition")`],
    ["a content body", `UPDATE "ContentLocalization" SET "summary" = 'tampered' WHERE "id" = (SELECT MIN("id") FROM "ContentLocalization")`],
    ["a question", `UPDATE "QuestionDefinition" SET "correctAnswer" = '"tampered"' WHERE "id" = (SELECT MIN("id") FROM "QuestionDefinition")`],
    ["a level's xp reward", `UPDATE "LevelDefinition" SET "xpReward" = "xpReward" + 1 WHERE "id" = (SELECT MIN("id") FROM "LevelDefinition")`],
  ] as const) {
    await check(`POST-STRUCTURAL TAMPER: ${label} refuses the overlay`, () => {
      const before = snapshot(RUN_DB);
      try {
        exec(RUN_DB, sql);
        refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(overlayInput()));
      } finally {
        restore(RUN_DB, before);
      }
    });
  }

  await check("M-1: an unexpected SourceAuthorityResolution row refuses the overlay", () => {
    const before = snapshot(RUN_DB);
    try {
      const cvId = query(RUN_DB, 'SELECT "id" AS n FROM "CurriculumVersion" WHERE "code" = ? AND "versionNumber" = ?', [
        packageFacts.curriculumCode,
        packageFacts.curriculumVersionNumber,
      ]);
      const levelId = query(RUN_DB, 'SELECT MIN("id") AS n FROM "LevelDefinition" WHERE "curriculumVersionId" = ?', [cvId]);
      const assessmentId = query(
        RUN_DB,
        'SELECT MIN("id") AS n FROM "AssessmentVersion" WHERE "curriculumVersionId" = ?',
        [cvId],
      );
      exec(
        RUN_DB,
        `INSERT INTO "VideoProductionVersion"
           ("levelDefinitionId","curriculumVersionId","versionNumber","levelNumber","contractVersion",
            "sourceProvenance","scriptState","videoState","qaState","contractPayload",
            "contractFingerprint","assessmentFingerprint","createdAt","updatedAt")
         VALUES (${levelId}, ${cvId}, 1, 1, 'v1', 'SOURCE_BACKED', 'SCRIPT_PENDING', 'NOT_RECORDED', 'QA_PENDING', '{}',
                 '${"0".repeat(64)}', '${"0".repeat(64)}', 1786000000000, 1786000000000)`,
      );
      const videoId = query(RUN_DB, 'SELECT MIN("id") AS n FROM "VideoProductionVersion"');
      exec(
        RUN_DB,
        `INSERT INTO "SourceAuthorityResolution"
           ("curriculumVersionId","levelDefinitionId","assessmentVersionId","videoProductionVersionId",
            "questionIndex","field","conflictPath","decision",
            "currentValueHash","blueprintValueHash","blueprintSourceDocumentSha256",
            "contractFingerprintAtDecision","bankFingerprintAtDecision","assessmentRevisionAtDecision",
            "rationale","evidenceRef","evidenceSha256","batchId","decidedById","decidedAt","createdAt")
         VALUES (${cvId}, ${levelId}, ${assessmentId}, ${videoId}, 0, 'prompt', 'q0.prompt', 'BLUEPRINT',
                 '${"1".repeat(64)}', '${"2".repeat(64)}', '${"3".repeat(64)}',
                 '${"4".repeat(64)}', '${"5".repeat(64)}', 1,
                 'injected by the M-1 regression', 'fixture://evidence', '${"6".repeat(64)}',
                 'fixture-batch', 1, 1786000000000, 1786000000000)`,
      );
      refuses("UNEXPECTED_SOURCE_AUTHORITY", () => assertPreprodActivationAuthorization(overlayInput()));
    } finally {
      restore(RUN_DB, before);
    }
  });

  await check("M-2: an unexpected EditorialReviewNote refuses the overlay", () => {
    const before = snapshot(RUN_DB);
    try {
      const cvId = query(RUN_DB, 'SELECT "id" AS n FROM "CurriculumVersion" WHERE "code" = ? AND "versionNumber" = ?', [
        packageFacts.curriculumCode,
        packageFacts.curriculumVersionNumber,
      ]);
      const contentId = query(
        RUN_DB,
        'SELECT MIN(cv."id") AS n FROM "ContentVersion" cv WHERE cv."curriculumVersionId" = ?',
        [cvId],
      );
      exec(
        RUN_DB,
        `INSERT INTO "EditorialReviewNote" ("contentVersionId","targetRevision","path","body","authorId","createdAt")
         VALUES (${contentId}, 1, 'summary', 'injected', 1, 1786000000000)`,
      );
      refuses("UNEXPECTED_REVIEW_NOTE", () => assertPreprodActivationAuthorization(overlayInput()));
    } finally {
      restore(RUN_DB, before);
    }
  });

  /*
   * CORRECTION-5 replaced "the principal must be absent" with "absent-and-creatable
   * or present-and-exactly-compatible". Both halves are pinned here, at the
   * authorization surface, against the real fixture manifest and overlay.
   */
  await check("an INCOMPATIBLE existing overlay principal refuses the overlay", () => {
    const before = snapshot(RUN_DB);
    try {
      const ref = String((baseManifest.json.historicalPrincipalRefs as string[])[0]);
      // Loginable, and carrying none of the declared staff identity: an account
      // that merely squats the reserved address is not the historical principal.
      exec(
        RUN_DB,
        `INSERT INTO "User" ("email","name","passwordHash","role","status","level","xp","createdAt","updatedAt")
         VALUES ('${ref}','Squatter','x','user','active',1,0,1786000000000,1786000000000)`,
      );
      refuses("UNEXPECTED_HISTORICAL_PRINCIPAL", () => assertPreprodActivationAuthorization(overlayInput()));
    } finally {
      restore(RUN_DB, before);
    }
  });

  /*
   * The POSITIVE half — an exactly compatible existing principal being reused —
   * is proved at the operator surface instead of here. This suite's manifest is
   * rehearsed against a fixture that has no principals at all, so its reviewed
   * `postStructural` state pins `userRowCount = 0`; inserting two would refuse on
   * the state chain before the principal check was ever reached, which would
   * test the fixture rather than the contract. A live-shaped target carries the
   * principals at entry, so every reviewed state carries them too.
   * See `curriculum-overlay-principal-reuse` for the classifier, and
   * `12_OPERATOR_SURFACE_PROOF.md` for the end-to-end run.
   */
  await check("the overlay may not name a principal the manifest never reviewed", () => {
    const tampered = JSON.parse(fs.readFileSync(OVERLAY_PATH, "utf8")) as {
      principals: Array<Record<string, unknown>>;
    };
    tampered.principals.push({
      ref: "not.reviewed@fixture.invalid",
      displayName: "Unreviewed",
      kind: "process",
      role: "user",
      staffRole: null,
      provisionIfMissing: true,
    });
    const tamperedPath = path.join(MANIFEST_DIR, "overlay-extra-principal.json");
    fs.writeFileSync(tamperedPath, JSON.stringify(tampered), { mode: 0o600 });
    // The file digest is checked first, so the manifest is re-pointed at the
    // tampered file: this isolates the principal-set check from the byte pin.
    const draft = JSON.parse(JSON.stringify(baseManifest.json)) as ManifestDraft;
    const facts = readOverlayFacts(tamperedPath);
    (draft.editorialOverlay as Record<string, unknown>).path = tamperedPath;
    (draft.editorialOverlay as Record<string, unknown>).fileSha256 = facts.fileSha256;
    (draft.editorialOverlay as Record<string, unknown>).fingerprint = facts.fingerprint;
    const json = `${JSON.stringify(draft, null, 2)}\n`;
    const manifestPath = path.join(MANIFEST_DIR, "overlay-extra-principal-manifest.json");
    fs.writeFileSync(manifestPath, json, { mode: 0o600 });
    refuses("OVERLAY_PROVENANCE_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput({ path: manifestPath, sha256: hashManifestBytes(json), json: draft }, {
          operation: "EDITORIAL_OVERLAY",
          stage: "EDITORIAL_OVERLAY",
          overlay: facts,
        }),
      ),
    );
  });

  await check("POSITIVE OVERLAY IMPORT: the full chain runs against the real artifact", async () => {
    const evidence = assertPreprodActivationAuthorization(overlayInput());
    const target = assertSafeDatabaseTarget(`file:${RUN_DB}`, {
      env: GUARD_ENV(),
      activationGrant: evidence.grant!,
      activationOperation: "EDITORIAL_OVERLAY",
    });

    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: target.url } } });
    try {
      const raw = JSON.parse(fs.readFileSync(OVERLAY_PATH, "utf8")) as unknown;
      const result = await importEditorialOverlay(raw, {
        db,
        dryRun: false,
        importActorId: null,
        allowPrincipalProvisioning: true,
      });
      assert.equal(result.ok, true, `overlay failed: ${JSON.stringify((result as { issues?: unknown }).issues)}`);
    } finally {
      await db.$disconnect();
    }
    dropSidecars(RUN_DB);
  });

  await check("the real run reproduced the rehearsed post-overlay state exactly", () => {
    const evidence = assertPreprodActivationAuthorization(overlayInput());
    assert.equal(evidence.observedState, "POST_OVERLAY");
    assert.equal(evidence.disposition, "ALREADY_COMPLETE");
    assert.equal(evidence.grant, null);
    assert.equal(evidence.contentActivationPlanChecked, true);
  });

  const overlayBytes = snapshot(RUN_DB);

  await check("RUNTIME INERTNESS: nothing was published, bound or flagged", () => {
    const cvId = query(RUN_DB, 'SELECT "id" AS n FROM "CurriculumVersion" WHERE "code" = ? AND "versionNumber" = ?', [
      packageFacts.curriculumCode,
      packageFacts.curriculumVersionNumber,
    ]);
    const status = (() => {
      const db = new DatabaseSync(RUN_DB, { readOnly: true });
      try {
        return (db.prepare('SELECT "status" AS s FROM "CurriculumVersion" WHERE "id" = ?').get(cvId) as { s: string }).s;
      } finally {
        db.close();
      }
    })();
    assert.equal(status, "draft");
    /*
     * INERTNESS IS "NOT SERVABLE", NOT "NOT NAMED".
     *
     * This assertion used to require ZERO assessment bindings. That was the
     * right test until the accepted assessment-binding correction, which makes
     * the structural importer create the binding where it creates the bank —
     * precisely so a level cannot reach `published` with its assessment unbound,
     * which is the defect that made `ata-v2@v3` permanently unusable.
     *
     * So a binding after the sanctioned stages is now EXPECTED, and it is still
     * inert: the binding only NAMES a resource, and the runtime refuses a bank
     * that is not published. What must remain zero is anything a learner could
     * actually be served, so that is what is measured — bound banks whose status
     * is `published`. Keeping the old count would have made the suite assert the
     * absence of the correction.
     */
    /*
     * The measure is "did a stage PUBLISH anything the artifact did not already
     * declare published", because publication is what makes a resource servable
     * and it is the operator's separate, reviewed act. The package is the
     * authority for what arrives already published — the approved first slice
     * ships its level-2 bank that way — so the expectation is read from the
     * artifact rather than hard-coded, and a stage that published one more row
     * than the artifact declares still fails.
     */
    const declared = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8")) as {
      modules: Array<{ levels: Array<{ assessment: { status: string } | null; content: { status: string } | null }> }>;
    };
    const declaredLevels = declared.modules.flatMap((moduleRow) => moduleRow.levels);
    const declaredPublishedAssessments = declaredLevels.filter((l) => l.assessment?.status === "published").length;
    const declaredPublishedContent = declaredLevels.filter((l) => l.content?.status === "published").length;

    assert.equal(
      query(
        RUN_DB,
        `SELECT COUNT(*) AS n FROM "AssessmentVersion" WHERE "curriculumVersionId" = ? AND "status" = 'published'`,
        [cvId],
      ),
      declaredPublishedAssessments,
      "a sanctioned stage published an assessment the package did not declare published",
    );
    assert.equal(
      query(
        RUN_DB,
        `SELECT COUNT(*) AS n FROM "ContentVersion" WHERE "curriculumVersionId" = ? AND "status" = 'published'`,
        [cvId],
      ),
      declaredPublishedContent,
      "a sanctioned stage published content the package did not declare published",
    );
  });

  /* ---------- M1: the content activation plan is recomputed ---------- */

  await check("the content plan derived at authorization matches the manifest", () => {
    const derived = deriveContentActivationPlan(RUN_DB, {
      code: packageFacts.curriculumCode,
      versionNumber: packageFacts.curriculumVersionNumber,
    });
    assertContentActivationPlanMatches(baseManifest.json.contentActivationPlan.rows as ContentActivationRow[], derived.rows);
    const summary = summarizeContentActivationPlan(derived.rows);
    assert.ok(summary.total > 0);
    assert.equal(summary.publishInPlace + summary.publishAndMoveBinding, summary.total);
  });

  for (const [label, mutate] of [
    ["a wrong stable code", (rows: ContentActivationRow[]) => { rows[0].levelStableCode = "v2.l999.not-a-level"; }],
    ["a wrong level number", (rows: ContentActivationRow[]) => { rows[0].levelNumber = 999; }],
    ["a wrong version", (rows: ContentActivationRow[]) => { rows[0].acceptedContentVersionNumber = 99; }],
    ["a wrong mode", (rows: ContentActivationRow[]) => { rows[0].action = rows[0].action === "PUBLISH_IN_PLACE" ? "PUBLISH_AND_MOVE_BINDING" : "PUBLISH_IN_PLACE"; }],
    ["a wrong pre-binding expectation", (rows: ContentActivationRow[]) => { rows[0].expectedPreBindingIdentity = "v2.l001.x@v9"; }],
    ["a wrong post-binding expectation", (rows: ContentActivationRow[]) => { rows[0].expectedPostBindingIdentity = "v2.l001.x@v9"; }],
    ["a wrong pre-publication status", (rows: ContentActivationRow[]) => { rows[0].expectedPreContentStatus = `not-${rows[0].expectedPreContentStatus}`; }],
    ["a missing row", (rows: ContentActivationRow[]) => { rows.splice(0, 1); }],
    ["an extra row", (rows: ContentActivationRow[]) => { rows.push({ ...rows[0], levelStableCode: "v2.l999.injected", levelNumber: 999 }); }],
    ["a duplicated row", (rows: ContentActivationRow[]) => { rows.push({ ...rows[0] }); }],
  ] as const) {
    await check(`CONTENT PLAN: ${label} is refused`, () => {
      const derived = deriveContentActivationPlan(RUN_DB, {
        code: packageFacts.curriculumCode,
        versionNumber: packageFacts.curriculumVersionNumber,
      });
      const rows = JSON.parse(JSON.stringify(derived.rows)) as ContentActivationRow[];
      mutate(rows);
      refuses("CONTENT_PLAN_MISMATCH", () => assertContentActivationPlanMatches(rows, derived.rows));
    });
  }

  await check("a re-digested manifest with a tampered content plan is refused at authorization", () => {
    const variant = manifestWith((d) => {
      d.contentActivationPlan.rows[0].acceptedContentVersionNumber = 99;
    }, "plan-tampered");
    refuses("CONTENT_PLAN_MISMATCH", () =>
      assertPreprodActivationAuthorization(overlayInput({ activationManifestPath: variant.path, expectedManifestSha256: variant.sha256 })),
    );
  });

  /* ---------- POST-OVERLAY tamper ---------- */

  for (const [label, sql] of [
    ["reviewed content", `UPDATE "ContentLocalization" SET "summary" = 'tampered' WHERE "id" = (SELECT MIN("id") FROM "ContentLocalization")`],
    ["a content revision", `UPDATE "ContentVersion" SET "revision" = "revision" + 1 WHERE "id" = (SELECT MIN("id") FROM "ContentVersion")`],
    ["an editorial state", `UPDATE "AssessmentVersion" SET "editorialState" = 'draft' WHERE "id" = (SELECT MIN("id") FROM "AssessmentVersion")`],
    ["an injected review note", `INSERT INTO "EditorialReviewNote" ("contentVersionId","targetRevision","path","body","authorId","createdAt")
        VALUES ((SELECT MIN("id") FROM "ContentVersion"), 1, 'summary', 'injected after the overlay', 1, 1786000000000)`],
  ] as const) {
    await check(`POST-OVERLAY TAMPER: ${label} is UNKNOWN, never ALREADY_COMPLETE`, () => {
      const before = snapshot(RUN_DB);
      try {
        exec(RUN_DB, sql);
        refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(overlayInput()));
      } finally {
        restore(RUN_DB, before);
      }
    });
  }


  /* ---------------------------------------------------------------- *
   * CORRECTION-2 — complete semantic business continuity
   *
   * The independent audit found two rows that no fingerprint measured: a `User`
   * (and its `StaffProfile`) on a pinned historical-principal address, and any
   * `AuditLog` row above the entry watermark. Both were excluded so a rehearsal
   * could reproduce them; both are now PROJECTED instead. These checks are the
   * permanent proof that the exclusions did not come back.
   * ---------------------------------------------------------------- */

  /** The pinned principal addresses, from the manifest the run is authorized by. */
  const principalRefs = baseManifest.json.historicalPrincipalRefs as string[];
  const auditFilter = () => ({
    principalEmails: principalRefs,
    entryMaxAuditLogId: baseManifest.json.entryMaxAuditLogId as number,
  });
  const fingerprintOf = (db: string): StageFingerprint => captureStageFingerprint(db, auditFilter());
  const chainOf = (): ActivationStateChain => baseManifest.json.stateChain as unknown as ActivationStateChain;
  /** Where the chain says this database is, measured rather than asserted. */
  const stateOf = (db: string): string => {
    const c = classifyTargetState(fingerprintOf(db), chainOf());
    return c.kind === "AT" ? c.state : "UNKNOWN";
  };
  const auditRows = (db: string): number =>
    query(db, 'SELECT COUNT(*) AS n FROM "AuditLog" WHERE "id" > ?', [baseManifest.json.entryMaxAuditLogId as number]);
  /** Insert a principal-shaped account the way an attacker would: on a pinned address. */
  const injectPrincipal = (db: string, email: string, role = "admin"): void => {
    exec(
      db,
      `INSERT INTO "User" ("email","name","passwordHash","role","status","referralCode","level","xp","createdAt","updatedAt")
       VALUES ('${email}','Injected','$2b$10$injected','${role}','active','injected-${email.replace(/[^a-z0-9]+/g, "-")}',1,0,1786000000000,1786000000000)`,
    );
  };

  await check("CORRECTION-2: every filtered business table names the projection that owns it", () => {
    for (const table of FILTERED_BUSINESS_TABLES) {
      const owner = FILTERED_TABLE_STAGE_OWNERS[table];
      assert.ok(owner, `${table} is filtered out of the raw digest and nothing owns what it removes`);
      assert.ok(
        ["historicalPrincipals", "activationAuditDelta"].includes(owner),
        `${table} names an owner that is not a fingerprint component: ${owner}`,
      );
    }
    // Both owners must actually be part of the composite, or naming them proves nothing.
    const fp = fingerprintOf(RUN_DB);
    assert.equal(fp.version, SEMANTIC_STATE_VERSION);
    assert.equal(typeof fp.historicalPrincipals.digest, "string");
    assert.equal(typeof fp.historicalPrincipals.userRowCount, "number");
    assert.equal(typeof fp.historicalPrincipals.staffProfileRowCount, "number");
    assert.equal(typeof fp.activationAuditDelta.digest, "string");
    assert.equal(typeof fp.activationAuditDelta.rowCount, "number");
  });

  /* ---- historical principals ---- */

  await check("PRINCIPALS 1: the reviewed pre-overlay state has none, and is accepted", () => {
    restore(RUN_DB, structuralBytes);
    for (const ref of principalRefs) {
      assert.equal(query(RUN_DB, 'SELECT COUNT(*) AS n FROM "User" WHERE lower("email") = lower(?)', [ref]), 0);
    }
    assert.equal(stateOf(RUN_DB), "POST_STRUCTURAL");
    const evidence = assertPreprodActivationAuthorization(overlayInput());
    assert.equal(evidence.disposition, "EXECUTE");
    assert.equal(evidence.observedState, "POST_STRUCTURAL");
    assert.ok(evidence.grant);
  });

  for (const [stateLabel, bytes, expectedState, input] of [
    ["POST_MIGRATION", () => migratedBytes, "POST_MIGRATION", () => authorizationInput()],
    ["POST_STRUCTURAL", () => structuralBytes, "POST_STRUCTURAL", () => overlayInput()],
  ] as const) {
    await check(`PRINCIPALS 2: a principal present at ${stateLabel} is no longer that state`, () => {
      restore(RUN_DB, bytes());
      assert.equal(stateOf(RUN_DB), expectedState, "the fixture must start at the reviewed state");
      const beforeDigest = fingerprintOf(RUN_DB).historicalPrincipals.digest;
      injectPrincipal(RUN_DB, principalRefs[0]);
      // The defect was that this row moved NOTHING. It must move the component
      // that owns it, and therefore the classification.
      assert.notEqual(fingerprintOf(RUN_DB).historicalPrincipals.digest, beforeDigest);
      assert.equal(stateOf(RUN_DB), "UNKNOWN");
      // Either refusal is correct: the state chain no longer recognises this
      // database, and where the stage also runs the named principal check that
      // one fires first and says so more precisely. What must never happen is a
      // capability.
      refusesOneOf(["STAGE_STATE_UNKNOWN", "UNEXPECTED_HISTORICAL_PRINCIPAL"], () =>
        assertPreprodActivationAuthorization(input()),
      );
    });

    await check(`PRINCIPALS 3: a StaffProfile for that principal at ${stateLabel} is no longer that state`, () => {
      restore(RUN_DB, bytes());
      injectPrincipal(RUN_DB, principalRefs[0]);
      exec(
        RUN_DB,
        `INSERT INTO "StaffProfile" ("id","userId","displayName","staffRole","permissionVersion","createdAt","updatedAt")
         VALUES ('injected-profile',(SELECT "id" FROM "User" WHERE lower("email") = lower('${principalRefs[0]}')),
                 'Injected','admin',1,1786000000000,1786000000000)`,
      );
      assert.equal(stateOf(RUN_DB), "UNKNOWN");
      refusesOneOf(["STAGE_STATE_UNKNOWN", "UNEXPECTED_HISTORICAL_PRINCIPAL"], () =>
        assertPreprodActivationAuthorization(input()),
      );
    });
  }

  await check("PRINCIPALS 4: the overlay-created principals in their exact reviewed state are accepted", () => {
    restore(RUN_DB, overlayBytes);
    for (const ref of principalRefs) {
      assert.equal(query(RUN_DB, 'SELECT COUNT(*) AS n FROM "User" WHERE lower("email") = lower(?)', [ref]), 1);
      // Provenance identities, never accounts: the overlay writes `blocked`.
      assert.equal(
        query(RUN_DB, `SELECT COUNT(*) AS n FROM "User" WHERE lower("email") = lower(?) AND "status" = 'blocked'`, [ref]),
        1,
      );
    }
    assert.equal(stateOf(RUN_DB), "POST_OVERLAY");
    const evidence = assertPreprodActivationAuthorization(overlayInput());
    assert.equal(evidence.disposition, "ALREADY_COMPLETE");
    assert.equal(evidence.grant, null);
  });

  for (const [label, sql] of [
    ["its role", `UPDATE "User" SET "role" = 'admin' WHERE lower("email") = lower('${"REF"}')`],
    ["its status (loginability)", `UPDATE "User" SET "status" = 'active' WHERE lower("email") = lower('${"REF"}')`],
    ["its credential shape", `UPDATE "User" SET "passwordHash" = '$2b$10$a-real-looking-bcrypt-digest' WHERE lower("email") = lower('${"REF"}')`],
    ["its name", `UPDATE "User" SET "name" = 'Someone Else' WHERE lower("email") = lower('${"REF"}')`],
  ] as const) {
    await check(`PRINCIPALS 5: changing ${label} after the overlay is no longer POST_OVERLAY`, () => {
      restore(RUN_DB, overlayBytes);
      exec(RUN_DB, sql.replace(/REF/g, principalRefs[0]));
      assert.equal(stateOf(RUN_DB), "UNKNOWN");
      const evidence = (() => {
        try {
          return assertPreprodActivationAuthorization(overlayInput());
        } catch (error) {
          assert.ok(isPreprodActivationError(error) && error.code === "STAGE_STATE_UNKNOWN", String(error));
          return null;
        }
      })();
      assert.equal(evidence, null, "a tampered principal must never read as ALREADY_COMPLETE");
    });
  }

  await check("PRINCIPALS 6: changing an expected StaffProfile after the overlay is no longer POST_OVERLAY", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).historicalPrincipals.digest;
    exec(
      RUN_DB,
      `UPDATE "StaffProfile" SET "staffRole" = 'admin'
        WHERE "userId" = (SELECT "id" FROM "User" WHERE lower("email") = lower('${principalRefs[0]}'))`,
    );
    assert.notEqual(fingerprintOf(RUN_DB).historicalPrincipals.digest, before);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(overlayInput()));
  });

  await check("PRINCIPALS: removing an expected principal after the overlay is no longer POST_OVERLAY", () => {
    restore(RUN_DB, overlayBytes);
    exec(RUN_DB, `DELETE FROM "StaffProfile" WHERE "userId" = (SELECT "id" FROM "User" WHERE lower("email") = lower('${principalRefs[0]}'))`);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
  });

  /* ---- AuditLog ---- */

  await check("AUDIT 7: the untouched entry history is accepted at every reviewed state", () => {
    restore(RUN_DB, migratedBytes);
    assert.equal(stateOf(RUN_DB), "POST_MIGRATION");
    assert.equal(auditRows(RUN_DB), 0, "the migration stage owns no audit rows");
    restore(RUN_DB, structuralBytes);
    assert.equal(stateOf(RUN_DB), "POST_STRUCTURAL");
    assert.equal(auditRows(RUN_DB), 0, "the structural stage owns no audit rows");
  });

  await check("AUDIT 8: the sanctioned overlay audit delta is expected, counted and accepted", () => {
    restore(RUN_DB, overlayBytes);
    const fp = fingerprintOf(RUN_DB);
    assert.equal(fp.activationAuditDelta.rowCount, 1, "the overlay writes exactly one import event");
    assert.equal(auditRows(RUN_DB), 1);
    assert.equal(fp.activationAuditDelta.digest, chainOf().postOverlay.activationAuditDelta.digest);
    assert.equal(stateOf(RUN_DB), "POST_OVERLAY");
  });

  for (const [stateLabel, bytes, input] of [
    ["POST_MIGRATION", () => migratedBytes, () => authorizationInput()],
    ["POST_STRUCTURAL", () => structuralBytes, () => overlayInput()],
    ["POST_OVERLAY", () => overlayBytes, () => overlayInput()],
  ] as const) {
    await check(`AUDIT 9: an unexpected audit row at ${stateLabel} is no longer that state`, () => {
      restore(RUN_DB, bytes());
      const before = fingerprintOf(RUN_DB).activationAuditDelta;
      exec(RUN_DB, `INSERT INTO "AuditLog" ("userId","action","entityType","entityId","createdAt")
                    VALUES (NULL,'INJECTED_BY_REGRESSION','Nothing','0',1786000000000)`);
      const after = fingerprintOf(RUN_DB).activationAuditDelta;
      assert.equal(after.rowCount, before.rowCount + 1);
      assert.notEqual(after.digest, before.digest);
      assert.equal(stateOf(RUN_DB), "UNKNOWN");
      refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(input()));
    });
  }

  await check("AUDIT 9b: a DUPLICATE of the expected overlay event is still unexpected", () => {
    restore(RUN_DB, overlayBytes);
    exec(
      RUN_DB,
      `INSERT INTO "AuditLog" ("userId","action","entityType","entityId","metadata","ip","userAgent","createdAt")
       SELECT "userId","action","entityType","entityId","metadata","ip","userAgent",1786000000001
         FROM "AuditLog" WHERE "id" > ${baseManifest.json.entryMaxAuditLogId as number} LIMIT 1`,
    );
    assert.equal(fingerprintOf(RUN_DB).activationAuditDelta.rowCount, 2);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
  });

  await check("AUDIT 9c: altering the sanctioned event's own metadata is unexpected", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).activationAuditDelta;
    exec(
      RUN_DB,
      `UPDATE "AuditLog" SET "metadata" = json_set("metadata", '$.overlayFingerprint', '${"0".repeat(64)}')
        WHERE "id" > ${baseManifest.json.entryMaxAuditLogId as number}`,
    );
    const after = fingerprintOf(RUN_DB).activationAuditDelta;
    assert.equal(after.rowCount, before.rowCount, "the count is unchanged; only the event differs");
    assert.notEqual(after.digest, before.digest);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
  });

  await check("AUDIT 10: mutating protected pre-entry audit history is no longer the reviewed state", () => {
    restore(RUN_DB, overlayBytes);
    exec(RUN_DB, `UPDATE "AuditLog" SET "action" = 'tampered' WHERE "id" = (SELECT MIN("id") FROM "AuditLog")`);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(overlayInput()));
  });

  await check("AUDIT 11: removing protected pre-entry audit history is no longer the reviewed state", () => {
    restore(RUN_DB, overlayBytes);
    exec(RUN_DB, `DELETE FROM "AuditLog" WHERE "id" = (SELECT MIN("id") FROM "AuditLog")`);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(overlayInput()));
  });

  await check("AUDIT 12: resume after the exact stage-owned audit delta still reports ALREADY_COMPLETE", () => {
    restore(RUN_DB, overlayBytes);
    const evidence = assertPreprodActivationAuthorization(overlayInput());
    assert.equal(evidence.observedState, "POST_OVERLAY");
    assert.equal(evidence.disposition, "ALREADY_COMPLETE");
    assert.equal(evidence.grant, null);
    assert.equal(evidence.contentActivationPlanChecked, true);
  });

  /* ---- general ---- */

  await check("GENERAL 13/14: exact pre-state EXECUTEs, exact post-state is ALREADY_COMPLETE", () => {
    restore(RUN_DB, migratedBytes);
    const pre = assertPreprodActivationAuthorization(authorizationInput());
    assert.equal(pre.observedState, "POST_MIGRATION");
    assert.equal(pre.disposition, "EXECUTE");
    assert.ok(pre.grant);
    restore(RUN_DB, structuralBytes);
    const post = assertPreprodActivationAuthorization(authorizationInput());
    assert.equal(post.observedState, "POST_STRUCTURAL");
    assert.equal(post.disposition, "ALREADY_COMPLETE");
    assert.equal(post.grant, null);
  });

  await check("GENERAL 15: an unreviewed business mutation matches no reviewed state", () => {
    restore(RUN_DB, migratedBytes);
    exec(RUN_DB, `UPDATE "User" SET "role" = 'admin' WHERE "id" = (SELECT MIN("id") FROM "User")`);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    const chain = chainOf();
    for (const key of ["entry", "postMigration", "postStructural", "postOverlay"] as const) {
      assert.notEqual(fingerprintOf(RUN_DB).compositeDigest, chain[key].compositeDigest);
    }
    refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(authorizationInput()));
    restore(RUN_DB, overlayBytes);
  });

  await check("GENERAL 16: rehearsal and authorization derive the same state semantics", () => {
    restore(RUN_DB, overlayBytes);
    const observed = fingerprintOf(RUN_DB);
    const rehearsed = chainOf().postOverlay;
    // Component by component, so a future change that silently drops one of them
    // from the composite cannot pass this by accident.
    assert.equal(observed.version, rehearsed.version);
    assert.equal(observed.schemaDigest, rehearsed.schemaDigest);
    assert.equal(observed.migrationLineage.digest, rehearsed.migrationLineage.digest);
    assert.equal(observed.businessContinuityDigest, rehearsed.businessContinuityDigest);
    assert.equal(observed.historicalPrincipals.digest, rehearsed.historicalPrincipals.digest);
    assert.equal(observed.historicalPrincipals.userRowCount, rehearsed.historicalPrincipals.userRowCount);
    assert.equal(observed.historicalPrincipals.staffProfileRowCount, rehearsed.historicalPrincipals.staffProfileRowCount);
    assert.equal(observed.activationAuditDelta.rowCount, rehearsed.activationAuditDelta.rowCount);
    assert.equal(observed.activationAuditDelta.digest, rehearsed.activationAuditDelta.digest);
    assert.equal(observed.curriculumDigest, rehearsed.curriculumDigest);
    assert.equal(observed.editorialDigest, rehearsed.editorialDigest);
    assert.equal(observed.compositeDigest, rehearsed.compositeDigest);
  });

  await check("GENERAL 17: a second independent rehearsal reproduces the semantics, not the bytes", async () => {
    const second = await rehearseActivation({
      backupArtifactPath: PREP_BACKUP,
      structuralPackagePath: PACKAGE_PATH,
      overlayPath: OVERLAY_PATH,
      target: { code: packageFacts.curriculumCode, versionNumber: packageFacts.curriculumVersionNumber },
      principalEmails: principalRefs,
      entryMaxAuditLogId: baseManifest.json.entryMaxAuditLogId as number,
      expectedEntryMigrationCount: entryMigrationCount,
      expectedTargetMigrationCount: targetMigrationCount,
    });
    const first = chainOf();
    for (const [label, a, b] of [
      ["post-migration", second.postMigration, first.postMigration],
      ["post-structural", second.postStructural, first.postStructural],
      ["post-overlay", second.postOverlay, first.postOverlay],
    ] as const) {
      assert.equal(a.compositeDigest, b.compositeDigest, `${label} composite differs between two rehearsals`);
      assert.equal(a.historicalPrincipals.digest, b.historicalPrincipals.digest, `${label} principals differ`);
      assert.equal(a.historicalPrincipals.userRowCount, b.historicalPrincipals.userRowCount, `${label} principal row count differs`);
      assert.equal(a.activationAuditDelta.digest, b.activationAuditDelta.digest, `${label} audit delta differs`);
      assert.equal(a.activationAuditDelta.rowCount, b.activationAuditDelta.rowCount, `${label} audit row count differs`);
    }
    assert.equal(second.businessContinuityHeld, true);
    // The raw bytes are NOT expected to match: the whole reason these components
    // are projections is that `cuid()`, `Date.now()` and autoincrement ids differ.
    assert.notEqual(second.postOverlay.activationAuditDelta.rowCount, 0);
  });

  /* ---------------------------------------------------------------- *
   * CORRECTION-3 — semantic-state coverage is TOTAL
   *
   * The second independent audit proved the CORRECTION-2 fence was written as
   * two SQL predicates that did not select the same rows: the raw digest removed
   * every case variant of a pinned address (`lower(email) NOT IN (...)`) while
   * the projection read back one row (`get()`). `User.email` is unique
   * case-SENSITIVELY, so a second row on `Editor.One@…` beside a sanctioned
   * `editor.one@…` belonged to no component at all — an unreviewed active admin
   * with a usable credential measured as exactly the reviewed state, and at
   * POST_MIGRATION that authorized the structural import.
   *
   * These checks are the permanent proof that the partition holds, that
   * multiplicity is visible, that the credential test is closed, and that audit
   * metadata is normalised by an explicit registry rather than by field name.
   * ---------------------------------------------------------------- */

  /** A canonical-equivalent spelling of a pinned address: same identity, different row. */
  const caseVariantOf = (email: string): string => {
    const [local, domain] = email.split("@");
    const flipped = local.replace(/(^.)|(\.)(.)/g, (m, first: string, dot: string, after: string) =>
      first ? first.toUpperCase() : `${dot}${after.toUpperCase()}`,
    );
    assert.notEqual(flipped, local, "the fixture address must have a letter to re-case");
    assert.equal(canonicalPrincipalIdentity(`${flipped}@${domain}`), canonicalPrincipalIdentity(email));
    return `${flipped}@${domain}`;
  };

  /** Insert a login-capable account on an arbitrary address. Synthetic digest only. */
  const injectAccount = (
    db: string,
    email: string,
    options: { role?: string; status?: string; passwordHash?: string; id?: number } = {},
  ): void => {
    const role = options.role ?? "admin";
    const status = options.status ?? "active";
    // A synthetic value with the SHAPE of a bcrypt digest. It is not a hash of
    // anything and no password exists for it.
    const hash = options.passwordHash ?? `$2b$10$${"S".repeat(53)}`;
    exec(
      db,
      `INSERT INTO "User" ("email","name","passwordHash","role","status","referralCode","level","xp","createdAt","updatedAt")
       VALUES ('${email}','Injected','${hash}','${role}','${status}','ref-${email.replace(/[^A-Za-z0-9]+/g, "-")}',1,0,1786000000000,1786000000000)`,
    );
  };

  const coverageOf = (db: string): Record<string, { total: number; fenced: number; specialised: number; unowned: number; ambiguous: number }> =>
    readSemanticCoverage(db, auditFilter());

  const assertPartitionHolds = (db: string, label: string): void => {
    const coverage = coverageOf(db);
    for (const table of FILTERED_BUSINESS_TABLES) {
      const c = coverage[table];
      assert.ok(c, `${table} is filtered but reports no coverage`);
      assert.equal(c.unowned, 0, `${label}: ${table} has ${c.unowned} row(s) owned by nothing`);
      assert.equal(c.ambiguous, 0, `${label}: ${table} has ${c.ambiguous} ambiguously owned row(s)`);
      assert.equal(
        c.fenced + c.specialised,
        c.total,
        `${label}: ${table} fenced(${c.fenced}) + specialised(${c.specialised}) != total(${c.total})`,
      );
    }
  };

  await check("COVERAGE 1: the fence and the projection partition every filtered table, at every reviewed state", () => {
    for (const [label, bytes] of [
      ["entry", entryBytes],
      ["post-migration", migratedBytes],
      ["post-structural", structuralBytes],
      ["post-overlay", overlayBytes],
    ] as const) {
      restore(RUN_DB, bytes);
      assertPartitionHolds(RUN_DB, label);
    }
    restore(RUN_DB, overlayBytes);
  });

  await check("COVERAGE 2: a case-variant row is owned — the partition holds where HIGH-1 lost a row", () => {
    restore(RUN_DB, overlayBytes);
    const before = coverageOf(RUN_DB);
    injectAccount(RUN_DB, caseVariantOf(principalRefs[0]));
    const after = coverageOf(RUN_DB);
    assert.equal(after.User.total, before.User.total + 1);
    // The row joins the SPECIALISED side, because it belongs to a pinned identity
    // class. Under the previous build it left the fence and joined nothing.
    assert.equal(after.User.specialised, before.User.specialised + 1);
    assert.equal(after.User.fenced, before.User.fenced);
    assertPartitionHolds(RUN_DB, "post-overlay + case variant");
  });

  await check("PRINCIPALS C3-1: the reviewed POST_OVERLAY cardinality is exact and accepted", () => {
    restore(RUN_DB, overlayBytes);
    const fp = fingerprintOf(RUN_DB);
    assert.equal(fp.historicalPrincipals.userRowCount, principalRefs.length, "one row per pinned address");
    assert.equal(fp.historicalPrincipals.staffProfileRowCount, principalRefs.length, "one profile per principal");
    const sets = readPrincipalRowSets(RUN_DB, principalRefs);
    for (const ref of principalRefs) {
      assert.equal(sets.rowCountByIdentity[canonicalPrincipalIdentity(ref)], 1);
    }
    assert.equal(stateOf(RUN_DB), "POST_OVERLAY");
    const evidence = assertPreprodActivationAuthorization(overlayInput());
    assert.equal(evidence.disposition, "ALREADY_COMPLETE");
    assert.equal(evidence.grant, null);
  });

  await check("PRINCIPALS C3-2: HIGH-1 — a canonical-equivalent row beside the sanctioned one moves the state", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).historicalPrincipals;
    const variant = caseVariantOf(principalRefs[0]);
    injectAccount(RUN_DB, variant, { role: "admin", status: "active" });

    // Two rows now share one canonical identity, and BOTH are separately
    // reachable by the login route's exact `findUnique`.
    assert.equal(
      query(RUN_DB, 'SELECT COUNT(*) AS n FROM "User" WHERE "email" = ?', [variant]),
      1,
      "the injected row is addressable by its exact spelling",
    );
    const after = fingerprintOf(RUN_DB).historicalPrincipals;
    assert.equal(after.userRowCount, before.userRowCount + 1, "cardinality is semantic state");
    assert.notEqual(after.digest, before.digest);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    // And the refusal must name the cardinality rather than a bare digest.
    const drift = diffStageFingerprint(chainOf().postOverlay, fingerprintOf(RUN_DB));
    assert.ok(
      drift.some((entry) => entry.includes("historical editorial principal rows")),
      `the drift must name the row count, got: ${drift.join("; ")}`,
    );
    refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(overlayInput()));
  });

  for (const [label, options] of [
    ["a privileged role", { role: "admin", status: "blocked" }],
    ["an active, login-capable account", { role: "user", status: "active" }],
  ] as const) {
    await check(`PRINCIPALS C3-3: a canonical-equivalent row with ${label} matches no reviewed state`, () => {
      for (const [stateLabel, bytes] of [
        ["POST_MIGRATION", migratedBytes],
        ["POST_STRUCTURAL", structuralBytes],
        ["POST_OVERLAY", overlayBytes],
      ] as const) {
        restore(RUN_DB, bytes);
        injectAccount(RUN_DB, caseVariantOf(principalRefs[0]), options);
        assert.equal(stateOf(RUN_DB), "UNKNOWN", `${stateLabel} still matched with an injected variant`);
        const chain = chainOf();
        for (const key of ["entry", "postMigration", "postStructural", "postOverlay"] as const) {
          assert.notEqual(
            fingerprintOf(RUN_DB).compositeDigest,
            chain[key].compositeDigest,
            `matched ${key} with an injected canonical-equivalent row`,
          );
        }
      }
      restore(RUN_DB, overlayBytes);
    });
  }

  await check("PRINCIPALS C3-4: several canonical-equivalent rows are all represented, and counted", () => {
    restore(RUN_DB, overlayBytes);
    const base = fingerprintOf(RUN_DB).historicalPrincipals.userRowCount;
    const ref = principalRefs[0];
    const [local, domain] = ref.split("@");
    const variants = [`${local.toUpperCase()}@${domain}`, `${local}@${domain.toUpperCase()}`];
    variants.forEach((email, index) => injectAccount(RUN_DB, email, { role: index === 0 ? "admin" : "support" }));
    const fp = fingerprintOf(RUN_DB).historicalPrincipals;
    assert.equal(fp.userRowCount, base + variants.length, "every row in the class is counted");
    assert.equal(
      readPrincipalRowSets(RUN_DB, principalRefs).rowCountByIdentity[canonicalPrincipalIdentity(ref)],
      1 + variants.length,
    );
    assertPartitionHolds(RUN_DB, "post-overlay + two variants");
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
  });

  await check("PRINCIPALS C3-5: insertion order does not change the fingerprint", () => {
    const ref = principalRefs[0];
    const [local, domain] = ref.split("@");
    const a = `${local.toUpperCase()}@${domain}`;
    const b = `${local}@${domain.toUpperCase()}`;

    restore(RUN_DB, overlayBytes);
    injectAccount(RUN_DB, a, { role: "admin" });
    injectAccount(RUN_DB, b, { role: "support" });
    const forward = fingerprintOf(RUN_DB);

    restore(RUN_DB, overlayBytes);
    injectAccount(RUN_DB, b, { role: "support" });
    injectAccount(RUN_DB, a, { role: "admin" });
    const reversed = fingerprintOf(RUN_DB);

    // Different row ids, same set of rows: the projection sorts by rendered form,
    // so the value is a function of the state and not of the write order.
    assert.equal(forward.historicalPrincipals.digest, reversed.historicalPrincipals.digest);
    assert.equal(forward.historicalPrincipals.userRowCount, reversed.historicalPrincipals.userRowCount);
    assert.equal(forward.compositeDigest, reversed.compositeDigest);
    restore(RUN_DB, overlayBytes);
  });

  await check("PRINCIPALS C3-6: an extra StaffProfile inside the class matches no reviewed state", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).historicalPrincipals;
    const variant = caseVariantOf(principalRefs[0]);
    injectAccount(RUN_DB, variant, { role: "admin" });
    exec(
      RUN_DB,
      `INSERT INTO "StaffProfile" ("id","userId","displayName","staffRole","permissionVersion","createdAt","updatedAt")
       VALUES ('injected-variant-profile',(SELECT "id" FROM "User" WHERE "email" = '${variant}'),
               'Injected','superadmin',9,1786000000000,1786000000000)`,
    );
    const after = fingerprintOf(RUN_DB).historicalPrincipals;
    assert.equal(after.staffProfileRowCount, before.staffProfileRowCount + 1);
    assert.notEqual(after.digest, before.digest);
    assertPartitionHolds(RUN_DB, "post-overlay + variant profile");
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    restore(RUN_DB, overlayBytes);
  });

  await check("PRINCIPALS C3-7: moving a principal's profile onto a different user moves the state", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).historicalPrincipals;
    // `StaffProfile.userId` is unique, so re-pointing is how a profile changes
    // owner. It must never be invisible in either direction.
    exec(
      RUN_DB,
      `UPDATE "StaffProfile"
          SET "userId" = (SELECT MIN("id") FROM "User" WHERE "id" NOT IN
                           (SELECT "id" FROM "User" WHERE "email" IN ('${principalRefs.join("','")}'))
                             AND "id" NOT IN (SELECT "userId" FROM "StaffProfile"))
        WHERE "userId" = (SELECT "id" FROM "User" WHERE "email" = '${principalRefs[0]}')`,
    );
    const after = fingerprintOf(RUN_DB).historicalPrincipals;
    assert.equal(after.staffProfileRowCount, before.staffProfileRowCount - 1, "it left the principal class");
    assert.notEqual(after.digest, before.digest);
    assertPartitionHolds(RUN_DB, "post-overlay + repointed profile");
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    restore(RUN_DB, overlayBytes);
  });

  await check("PRINCIPALS C3-8: removing an expected principal row moves the cardinality", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).historicalPrincipals;
    exec(RUN_DB, `DELETE FROM "StaffProfile" WHERE "userId" = (SELECT "id" FROM "User" WHERE "email" = '${principalRefs[0]}')`);
    exec(RUN_DB, `DELETE FROM "User" WHERE "email" = '${principalRefs[0]}'`);
    const after = fingerprintOf(RUN_DB).historicalPrincipals;
    assert.equal(after.userRowCount, before.userRowCount - 1);
    assert.equal(after.staffProfileRowCount, before.staffProfileRowCount - 1);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(overlayInput()));
    restore(RUN_DB, overlayBytes);
  });

  await check("PRINCIPALS C3-9: non-principal User and StaffProfile rows stay in the raw fence", () => {
    restore(RUN_DB, overlayBytes);
    const coverage = coverageOf(RUN_DB);
    assert.ok(coverage.User.fenced > 0, "ordinary accounts must still be digested whole");
    // A tampered ordinary account is caught by business continuity, not by the
    // principal projection — the specialised path was not widened.
    const beforePrincipals = fingerprintOf(RUN_DB).historicalPrincipals.digest;
    const beforeBusiness = fingerprintOf(RUN_DB).businessContinuityDigest;
    exec(RUN_DB, `UPDATE "User" SET "role" = 'admin' WHERE "id" = (SELECT MIN("id") FROM "User")`);
    assert.equal(fingerprintOf(RUN_DB).historicalPrincipals.digest, beforePrincipals, "not a principal change");
    assert.notEqual(fingerprintOf(RUN_DB).businessContinuityDigest, beforeBusiness);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    restore(RUN_DB, overlayBytes);
  });

  /* ---- credential classification (MEDIUM-1) ---- */

  await check("CREDENTIAL 1: the classifier is closed over the provisioner's actual format", () => {
    // Exactly what `editorial-overlay/import.ts` writes, generated the same way.
    const genuine = `${OVERLAY_NO_LOGIN_MARKER}${Date.now().toString(36)}`;
    assert.equal(classifyCredential(genuine), "overlay-no-login-placeholder");
    // Independently generated placeholders are the same class, which is what
    // makes a rehearsal reproducible.
    const other = `${OVERLAY_NO_LOGIN_MARKER}${(Date.now() + 987_654).toString(36)}`;
    assert.equal(classifyCredential(other), "overlay-no-login-placeholder");
    assert.notEqual(genuine, other);

    // The MEDIUM-1 exploit: the marker with a usable digest appended. Synthetic.
    assert.equal(classifyCredential(`${OVERLAY_NO_LOGIN_MARKER}$2b$10$${"S".repeat(53)}`), "unrecognized");
    // Truncated, padded, re-cased and prefix-only look-alikes are all rejected.
    assert.equal(classifyCredential(OVERLAY_NO_LOGIN_MARKER), "unrecognized");
    assert.equal(classifyCredential(`${OVERLAY_NO_LOGIN_MARKER}0${Date.now().toString(36)}`), "unrecognized");
    assert.equal(classifyCredential(`${OVERLAY_NO_LOGIN_MARKER}${Date.now().toString(36).toUpperCase()}`), "unrecognized");
    assert.equal(classifyCredential(`${OVERLAY_NO_LOGIN_MARKER}${Date.now().toString(36)} `), "unrecognized");
    assert.equal(classifyCredential(`${OVERLAY_NO_LOGIN_MARKER}${Date.now().toString(36)}x!`), "unrecognized");
    // A recognised login credential is its own class; nothing else is.
    assert.equal(classifyCredential(`$2b$10$${"S".repeat(53)}`), "bcrypt-login-credential");
    assert.equal(classifyCredential(`$2a$12$${"S".repeat(53)}`), "bcrypt-login-credential");
    assert.equal(classifyCredential(""), "absent");
    assert.equal(classifyCredential(null), "absent");
    assert.equal(classifyCredential("x"), "unrecognized");
    assert.equal(classifyCredential(`$2b$10$${"S".repeat(52)}`), "unrecognized");
  });

  await check("CREDENTIAL 2: a prefix-preserving credential swap after the overlay moves the state", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).historicalPrincipals.digest;
    // The exact value the previous build accepted as equivalent. Synthetic digest.
    exec(
      RUN_DB,
      `UPDATE "User" SET "passwordHash" = '${OVERLAY_NO_LOGIN_MARKER}$2b$10$${"S".repeat(53)}'
        WHERE "email" = '${principalRefs[0]}'`,
    );
    assert.notEqual(fingerprintOf(RUN_DB).historicalPrincipals.digest, before, "MEDIUM-1 regression");
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    refuses("STAGE_STATE_UNKNOWN", () => assertPreprodActivationAuthorization(overlayInput()));
    restore(RUN_DB, overlayBytes);
  });

  /* ---- AuditLog metadata normalisation (MEDIUM-2) ---- */

  const overlayAuditWhere = `"id" > ${baseManifest.json.entryMaxAuditLogId as number}`;
  const setMetadata = (db: string, patch: string): void =>
    exec(db, `UPDATE "AuditLog" SET "metadata" = ${patch} WHERE ${overlayAuditWhere}`);

  await check("METADATA 1: normalisation is an explicit registry, not a naming rule", () => {
    // Every rule names a stage, an exact path and a reason. Nothing is a pattern.
    assert.ok(AUDIT_METADATA_NORMALISATIONS.length > 0);
    for (const rule of AUDIT_METADATA_NORMALISATIONS) {
      assert.ok(rule.action.length > 0, "a rule must name the action that produces the field");
      assert.ok(rule.reason.length > 20, "a rule must say why the value cannot be compared");
      assert.ok(!/[*?]/.test(rule.path), `the path must be exact, not a pattern: ${rule.path}`);
    }
  });

  await check("METADATA 2: MEDIUM-2 — an unregistered identifier-like numeric field stays visible", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).activationAuditDelta;
    // Named exactly like the fields the old wildcard erased, and at top level.
    setMetadata(RUN_DB, `json_set("metadata", '$.grantedRoleId', 1)`);
    const withOne = fingerprintOf(RUN_DB).activationAuditDelta;
    assert.equal(withOne.rowCount, before.rowCount, "no row was added");
    assert.notEqual(withOne.digest, before.digest, "an unregistered *Id field must be compared by value");

    // And its VALUE matters: 1 and 99 are different states.
    setMetadata(RUN_DB, `json_set("metadata", '$.grantedRoleId', 99)`);
    assert.notEqual(fingerprintOf(RUN_DB).activationAuditDelta.digest, withOne.digest);
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    restore(RUN_DB, overlayBytes);
  });

  await check("METADATA 3: an unregistered NESTED identifier-like field stays visible", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).activationAuditDelta.digest;
    setMetadata(RUN_DB, `json_set("metadata", '$.principals[0].shadowUserId', 7)`);
    const after = fingerprintOf(RUN_DB).activationAuditDelta.digest;
    assert.notEqual(after, before, "a nested unregistered *Id field must be compared by value");
    setMetadata(RUN_DB, `json_set("metadata", '$.principals[0].shadowUserId', 8)`);
    assert.notEqual(fingerprintOf(RUN_DB).activationAuditDelta.digest, after);
    restore(RUN_DB, overlayBytes);
  });

  await check("METADATA 4: registered fields resolve to a stable identity, so a rebinding is visible", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).activationAuditDelta.digest;
    // `principals[].targetUserId` is registered, so its raw id is replaced — but
    // by the canonical identity of the account it names, not by a marker. Point it
    // at a DIFFERENT account and the resolved identity, and the digest, must move.
    setMetadata(
      RUN_DB,
      `json_set("metadata", '$.principals[0].targetUserId', (SELECT MIN("id") FROM "User" WHERE "email" NOT IN ('${principalRefs.join("','")}')))`,
    );
    assert.notEqual(
      fingerprintOf(RUN_DB).activationAuditDelta.digest,
      before,
      "a principal bound to a different account must not normalise to the same value",
    );
    assert.equal(stateOf(RUN_DB), "UNKNOWN");
    restore(RUN_DB, overlayBytes);
  });

  await check("METADATA 5: re-serialising the same metadata with different key order is not a change", () => {
    restore(RUN_DB, overlayBytes);
    const before = fingerprintOf(RUN_DB).activationAuditDelta.digest;
    // `json_patch` with an empty object rewrites the JSON text through SQLite's
    // own serialiser: same content, different byte order of keys.
    setMetadata(RUN_DB, `json_patch("metadata", '{}')`);
    const rawChanged = query(
      RUN_DB,
      `SELECT COUNT(*) AS n FROM "AuditLog" WHERE ${overlayAuditWhere} AND "metadata" IS NOT NULL`,
    );
    assert.equal(rawChanged, 1, "the fixture still has exactly the one activation-owned row");
    assert.equal(
      fingerprintOf(RUN_DB).activationAuditDelta.digest,
      before,
      "key ordering must not create a false state change",
    );
    assert.equal(stateOf(RUN_DB), "POST_OVERLAY");
    restore(RUN_DB, overlayBytes);
  });

  restore(RUN_DB, overlayBytes);

  /* ---------- stage ordering ---------- */

  await check("the structural import is refused while the target is still at entry", () => {
    const before = snapshot(RUN_DB);
    try {
      restore(RUN_DB, entryBytes);
      void migratedBytes;
      refuses("STAGE_OUT_OF_ORDER", () => assertPreprodActivationAuthorization(authorizationInput()));
    } finally {
      restore(RUN_DB, before);
    }
  });

  await check("the overlay is refused while the target is still at entry", () => {
    const before = snapshot(RUN_DB);
    try {
      restore(RUN_DB, entryBytes);
      refuses("STAGE_OUT_OF_ORDER", () => assertPreprodActivationAuthorization(overlayInput()));
    } finally {
      restore(RUN_DB, before);
    }
  });

  await check("an operation that does not belong to the stage is refused", () => {
    refuses("OPERATION_NOT_AUTHORIZED", () =>
      assertPreprodActivationAuthorization(authorizationInput(baseManifest, { operation: "EDITORIAL_OVERLAY" })),
    );
  });

  for (const stage of ACTIVATION_STAGES.filter(
    (s) => s !== "STRUCTURAL_IMPORT" && s !== "EDITORIAL_OVERLAY",
  )) {
    await check(`no importer operation is authorized at stage ${stage}`, () => {
      refuses("STAGE_NOT_AUTHORIZED", () =>
        assertPreprodActivationAuthorization(authorizationInput(baseManifest, { stage })),
      );
    });
  }

  /* ---------- M2: the lock ---------- */

  await check("the production activation lock path is a source constant", () => {
    assert.equal(ACTIVATION_LOCK_PATH, "/srv/ata-data/activation/preprod-activation.lock");
    const lockSource = fs.readFileSync(path.join(REPO, "src/lib/curriculum/preprod-activation/lock.ts"), "utf8");
    assert.equal(lockSource.includes("process.env"), false, "the lock path must not be readable from the environment");
  });

  await check("a second activation cannot start while the lock is held", () => {
    const first = acquireActivationLock(
      { activationId: "a1", manifestSha256: baseManifest.sha256, stage: "STRUCTURAL_IMPORT", operation: "STRUCTURAL_IMPORT" },
      { __testOnlyActivationLockPath: LOCK_PATH },
    );
    try {
      refuses("ACTIVATION_LOCK_HELD", () =>
        acquireActivationLock(
          { activationId: "a2", manifestSha256: "c".repeat(64), stage: "EDITORIAL_OVERLAY", operation: "EDITORIAL_OVERLAY" },
          { __testOnlyActivationLockPath: LOCK_PATH },
        ),
      );
      const record = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as Record<string, unknown>;
      assert.equal(record.activationId, "a1");
      assert.equal(record.manifestSha256, baseManifest.sha256);
      assert.equal(record.pid, process.pid);
      assert.equal(fs.statSync(LOCK_PATH).mode & 0o777, 0o600);
    } finally {
      first.release();
    }
    assert.equal(fs.existsSync(LOCK_PATH), false, "release must remove the lock");
  });

  await check("holding the lock grants no database capability", () => {
    const held = acquireActivationLock(
      { activationId: "a3", manifestSha256: baseManifest.sha256, stage: "STRUCTURAL_IMPORT", operation: "STRUCTURAL_IMPORT" },
      { __testOnlyActivationLockPath: LOCK_PATH },
    );
    try {
      assert.throws(
        () => assertSafeDatabaseTarget(`file:${RUN_DB}`, { env: GUARD_ENV() }),
        (error: unknown) => isProtectedDatabaseError(error, "TARGET_PROTECTED"),
      );
    } finally {
      held.release();
    }
  });

  /* ---------- surface ---------- */

  await check("no force/bypass switch exists anywhere in the shipped authorization surface", () => {
    const files = [
      ...fs
        .readdirSync(path.join(REPO, "src/lib/curriculum/preprod-activation"))
        .map((name) => path.join(REPO, "src/lib/curriculum/preprod-activation", name)),
      path.join(REPO, "src/lib/curriculum/protected-database.ts"),
      path.join(REPO, "scripts/curriculum/importCurriculumPackage.ts"),
      path.join(REPO, "scripts/curriculum/importEditorialOverlay.ts"),
      path.join(REPO, "scripts/curriculum/preparePreprodActivationManifest.ts"),
      path.join(REPO, "scripts/curriculum/validatePreprodActivationManifest.ts"),
    ];
    const forbidden = [
      "--force",
      "--allow-live",
      "--unsafe",
      "--skip-protection",
      "--allow-protected",
      "ALLOW_LIVE",
      "DISABLE_GUARD",
      "ALLOW_PROTECTED_DB",
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      // strip block comments: the modules DESCRIBE the flags they refuse to have
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const token of forbidden) {
        assert.equal(code.includes(token), false, `${path.basename(file)} mentions ${token} outside a comment`);
      }
    }
  });

  await check("no exported function mints a capability without authorization", () => {
    const grantSource = fs.readFileSync(path.join(REPO, "src/lib/curriculum/preprod-activation/grant.ts"), "utf8");
    for (const banned of ["export function issueActivationGrant", "export function registerGrant", "export function brandGrant"]) {
      assert.equal(grantSource.includes(banned), false, `${banned} is exported`);
    }
    assert.equal(grantSource.includes("export function runWithGrantIssuer"), true);
    // and only the authorization module uses it
    const users = fs
      .readdirSync(path.join(REPO, "src/lib/curriculum/preprod-activation"))
      .filter((name) => name.endsWith(".ts"))
      .filter((name) =>
        fs.readFileSync(path.join(REPO, "src/lib/curriculum/preprod-activation", name), "utf8").includes("runWithGrantIssuer"),
      );
    assert.deepEqual(users.sort(), ["authorize.ts", "grant.ts"]);
  });

  await check("no CLI reaches the test-only substitutions", () => {
    for (const rel of [
      "scripts/curriculum/importCurriculumPackage.ts",
      "scripts/curriculum/importEditorialOverlay.ts",
      "scripts/curriculum/preparePreprodActivationManifest.ts",
      "scripts/curriculum/validatePreprodActivationManifest.ts",
    ]) {
      const source = fs.readFileSync(path.join(REPO, rel), "utf8");
      assert.equal(source.includes("__testOnlySanctionedTargetPath"), false, `${rel} reaches the target substitution`);
      assert.equal(source.includes("__testOnlyActivationLockPath"), false, `${rel} reaches the lock substitution`);
    }
  });

  await check("the real live PREPROD database is refused without an activation manifest", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        path.join("scripts", "curriculum", "importCurriculumPackage.ts"),
        "--package",
        PACKAGE_PATH,
        "--database",
        "file:/srv/ata-data/data/ata-preprod.sqlite",
      ],
      { cwd: REPO, encoding: "utf8" },
    );
    assert.match(`${result.stdout}${result.stderr}`, /protected runtime database/);
  });

  await check("the manifest cannot authorize assessment binding or publication", () => {
    assert.equal(prepared.manifest.assessmentRuntimePolicy, "DEFER");
    for (const value of ["BIND", "ACTIVATE", "ENABLE"]) {
      const variant = manifestWith((d) => {
        d.assessmentRuntimePolicy = value;
      }, `assessment-${value}`);
      refuses("MANIFEST_MALFORMED", () => assertPreprodActivationAuthorization(authorizationInput(variant)));
    }
  });

  await check("no migration was added by this work", () => {
    const migrations = fs
      .readdirSync(path.join(REPO, "prisma", "migrations"))
      .filter((name) => /^\d/.test(name));
    assert.equal(migrations.length, 46, `expected 46 migrations, found ${migrations.length}`);
  });

  console.log(`\npreprod activation authorization regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}



main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
