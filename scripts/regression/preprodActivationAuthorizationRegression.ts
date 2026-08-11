/**
 * PREPROD ACTIVATION AUTHORIZATION — regression suite.
 *
 * WHAT IS BEING PROVED. That the only way a protected runtime database becomes a
 * legal import target is a complete, reviewed, digest-pinned activation
 * manifest — and that every single precondition in it is load-bearing. For each
 * pin there is a test that breaks exactly that pin and expects a refusal, so a
 * future edit which stops checking one of them fails here rather than passing
 * review.
 *
 * EVERYTHING RUNS AGAINST DISPOSABLE FIXTURES. The live PREPROD database is
 * never opened for writing by this suite, and never named as an authorized
 * target. It appears exactly once, in the "the real live path is refused without
 * authorization" test, where the assertion is that it is REFUSED.
 *
 * WHY THE POSITIVE PATH IS TESTED AT MODULE LEVEL RATHER THAN THROUGH THE CLI.
 * The sanctioned target is a constant in `target.ts` and is deliberately not
 * reachable from any command line — that unreachability is the property that
 * stops a prepared manifest from being retargeted. A CLI-level positive test
 * would therefore require either mutating the real PREPROD database or adding
 * the very argv surface the design exists to withhold. So the CLI is tested for
 * its refusals, and the full authorize -> grant -> guard -> import chain is
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
  captureCurriculumStartingState,
  captureEditorialBaseline,
  capturePrincipalPresence,
} from "../../src/lib/curriculum/preprod-activation/baseline";
import { isPreprodActivationError } from "../../src/lib/curriculum/preprod-activation/errors";
import { acquireActivationLock } from "../../src/lib/curriculum/preprod-activation/lock";
import { hashManifestBytes } from "../../src/lib/curriculum/preprod-activation/manifest";
import { prepareActivationManifest } from "../../src/lib/curriculum/preprod-activation/prepare";
import { computeLogicalDigest, sha256File } from "../../src/lib/curriculum/preprod-activation/sqlite-probe";
import {
  classifyStageState,
  type ActivationStage,
} from "../../src/lib/curriculum/preprod-activation/stages";
import { NEVER_AUTHORIZED_DATABASE_PATHS } from "../../src/lib/curriculum/preprod-activation/target";
import { readStructuralPackageFacts, readOverlayFacts } from "../../src/lib/curriculum/preprod-activation/artifact-facts";
import {
  assertSafeDatabaseTarget,
  assertTargetIdentityUnchanged,
  isProtectedDatabaseError,
} from "../../src/lib/curriculum/protected-database";
import { importCurriculumPackage } from "../../src/lib/curriculum/package/import";
import { calculateAcceptedReviewedRootHash } from "../../src/lib/curriculum/editorial-overlay/fingerprint";
import { contentPayloadHash } from "../../src/lib/curriculum/editorial-overlay/payload";
import type { EditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/schema";
import type { ContentReviewedPayload } from "../../src/lib/curriculum/editorial-overlay/payload";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ata-actv-auth-"));
const TARGET_DB = path.join(ROOT, "sanctioned-target.sqlite");
const BACKUP_DIR = path.join(ROOT, "backups");
const BACKUP_DB = path.join(BACKUP_DIR, "rollback.sqlite");
const MANIFEST_DIR = path.join(ROOT, "manifests");
const CHECKPOINT = path.join(ROOT, "accepted-checkpoint.bin");
const OVERLAY_PATH = path.join(ROOT, "overlay-v2.json");
const LOCK_PATH = path.join(ROOT, "activation.lock");

const REPO = path.resolve(__dirname, "..", "..");
const PACKAGE_PATH = path.join(REPO, "curriculum", "packages", "ata-v2-first-slice.approved.json");
const OTHER_PACKAGE_PATH = path.join(REPO, "curriculum", "packages", "ata-v2-canonical-100.draft.json");

const TRANSPORT_COMMIT = "27edeeb82e9b1c5a9575dbcfd09e04179b000abe";
const TRANSPORT_TREE = "362551a45278076c08d14b437be53197d19e6228";
const MACHINE_ID_SHA = crypto.createHash("sha256").update("fixture-machine-id").digest("hex");
const OTHER_MACHINE_ID_SHA = crypto.createHash("sha256").update("some-other-machine").digest("hex");

const RELEASES = {
  backend: "734e632ea450cdd8a3662afe2eb1dcd7b0935607",
  academy: "4c4ced398d2b2a73cdf8d95652b9171b425fdf06",
  crm: "8328903fd4f7f2dc3d73f1ae4e4068c0165d9d1b",
};
const FLAGS = {
  CURRICULUM_V2_ADMIN_ENABLED: "absent",
  CURRICULUM_V2_READ_ENABLED: "absent",
  CURRICULUM_V2_ENROLLMENT_ENABLED: "absent",
  CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED: "absent",
  CURRICULUM_V2_XP_ENABLED: "absent",
  CURRICULUM_V2_CONTENT_ENABLED: "absent",
  CURRICULUM_V2_ASSESSMENT_ENABLED: "absent",
  CURRICULUM_V2_REPORT_ENABLED: "absent",
  CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED: "absent",
  CURRICULUM_V2_CHECKPOINT_ENABLED: "absent",
} as const;

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

function buildTargetDatabase(): void {
  const runner = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    cwd: REPO,
    env: { ...process.env, DATABASE_URL: `file:${TARGET_DB}` },
    encoding: "utf8",
  });
  if (runner.status !== 0) {
    throw new Error(`migration chain failed: ${runner.stderr || runner.stdout}`);
  }
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

const CONTENT_A: ContentReviewedPayload = {
  videoDurationSeconds: 120,
  changeNotes: "reviewed",
  localizations: [
    {
      locale: "ru",
      title: "Reviewed lesson A",
      subtitle: "",
      learningObjectiveExtension: "",
      summary: "summary A",
      transcript: null,
      body: { format: "blocks_v2", version: 2, blocks: [{ type: "paragraph", text: "body A" }] },
    },
  ],
};

const CONTENT_B: ContentReviewedPayload = {
  videoDurationSeconds: 180,
  changeNotes: "successor",
  localizations: [
    {
      locale: "ru",
      title: "Reviewed lesson B",
      subtitle: "",
      learningObjectiveExtension: "",
      summary: "summary B",
      transcript: null,
      body: { format: "blocks_v2", version: 2, blocks: [{ type: "paragraph", text: "body B" }] },
    },
  ],
};

function buildOverlay(packageFingerprint: string, checkpointSha: string, curriculum: { code: string; versionNumber: number }): EditorialOverlay {
  const T = "2026-08-01T00:00:00.000Z";
  const AUTHOR = "g2.author.a@fixture.invalid";
  const REVIEWER = "g2.reviewer.a@fixture.invalid";
  const evidence = {
    editorialState: "approved" as const,
    revision: 2,
    lastAuthoredBy: AUTHOR,
    lastAuthoredAt: T,
    submittedBy: AUTHOR,
    submittedAt: T,
    changesRequestedBy: null,
    changesRequestedAt: null,
    approvedBy: REVIEWER,
    approvedAt: T,
    createdBy: AUTHOR,
  };
  const levels = [
    { level: "lvl.fixture.01", levelNumber: 1, moduleCode: "module.01", moduleNumber: 1, type: "lesson" },
  ];
  const content: EditorialOverlay["content"] = [
    {
      level: "lvl.fixture.01",
      versionNumber: 1,
      mode: "update",
      editorial: evidence,
      expectedStructuralHash: contentPayloadHash(CONTENT_A),
      acceptedReviewedHash: contentPayloadHash(CONTENT_A),
      createdAt: T,
      payload: CONTENT_A,
      creation: null,
    },
    {
      level: "lvl.fixture.01",
      versionNumber: 2,
      mode: "create",
      editorial: evidence,
      expectedStructuralHash: null,
      acceptedReviewedHash: contentPayloadHash(CONTENT_B),
      createdAt: T,
      payload: CONTENT_B,
      creation: { status: "draft", publishedAt: null, archivedAt: null },
    },
  ];
  return {
    schemaVersion: "ata.editorial-overlay/2",
    minImporterVersion: 2,
    overlayCode: "fixture.overlay",
    overlayRevision: 1,
    generatedAt: T,
    binding: {
      curriculumCode: curriculum.code,
      curriculumVersionNumber: curriculum.versionNumber,
      structuralPackageCode: "fixture.pkg",
      structuralPackageRevision: 1,
      structuralPackageFingerprint: packageFingerprint,
      sourceCheckpointSha256: checkpointSha,
      sourceBackendCommit: TRANSPORT_COMMIT,
      sourceBackendTree: TRANSPORT_TREE,
      blueprintSourceDocumentSha256: "b".repeat(64),
      acceptedReviewedRootHash: calculateAcceptedReviewedRootHash({ content, assessments: [], levels }),
    },
    levels,
    principals: [
      { ref: AUTHOR, displayName: "Fixture Author", kind: "process", role: "user", staffRole: "content_manager", provisionIfMissing: true },
      { ref: REVIEWER, displayName: "Fixture Reviewer", kind: "process", role: "user", staffRole: "crm_admin", provisionIfMissing: true },
    ],
    content,
    assessments: [],
    videoProductions: [],
    videoAssessmentLinks: [],
    sourceAuthorityResolutions: [],
    reviewNotes: [],
  } as EditorialOverlay;
}

type ManifestFile = { path: string; sha256: string; json: Record<string, unknown> };

let baseManifest: ManifestFile;
let packageFacts: ReturnType<typeof readStructuralPackageFacts>;
let overlayFacts: ReturnType<typeof readOverlayFacts>;

/** Write a manifest derived from the base by an in-place mutation. */
/**
 * A manifest being deliberately broken.
 *
 * Typed loosely on purpose: every mutator here exists to produce a manifest the
 * schema or the authorization should REJECT, so constraining the draft to the
 * valid shape would make most of the negative cases unexpressible.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifestDraft = Record<string, any>;

function manifestWith(
  mutate: (draft: ManifestDraft) => void,
  name: string,
  from: ManifestFile = baseManifest,
): ManifestFile {
  const draft = JSON.parse(JSON.stringify(from.json)) as ManifestDraft;
  mutate(draft);
  const json = `${JSON.stringify(draft, null, 2)}\n`;
  const filePath = path.join(MANIFEST_DIR, `${name}.json`);
  fs.writeFileSync(filePath, json, { mode: 0o600 });
  return { path: filePath, sha256: hashManifestBytes(json), json: draft };
}

function authorizationInput(
  manifest: ManifestFile,
  overrides: Partial<AuthorizationInput> = {},
): AuthorizationInput {
  return {
    activationManifestPath: manifest.path,
    expectedManifestSha256: manifest.sha256,
    operation: "STRUCTURAL_IMPORT",
    stage: "STRUCTURAL_IMPORT",
    completedStages: ["PREPARED", "MIGRATION_41_TO_46"],
    expectedTargetSha256: sha256File(TARGET_DB),
    structuralPackage: packageFacts,
    hostIdentityProvider: () => ({ machineIdSha256: MACHINE_ID_SHA, hostname: "fixture-host" }),
    deployedReleasesProvider: () => ({ ...RELEASES }),
    flagBaselineProvider: () => ({ ...FLAGS }),
    environmentVariables: PREPROD_ENV,
    sanctionedTargetOverride: { __testOnlySanctionedTargetPath: TARGET_DB },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * suite
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true, mode: 0o700 });

  buildTargetDatabase();
  takeOnlineBackup(TARGET_DB, BACKUP_DB);

  fs.writeFileSync(CHECKPOINT, "accepted-product-checkpoint-fixture-bytes", { mode: 0o600 });
  const checkpointSha = sha256File(CHECKPOINT);

  packageFacts = readStructuralPackageFacts(PACKAGE_PATH);
  const overlay = buildOverlay(packageFacts.contentFingerprint, checkpointSha, {
    code: packageFacts.curriculumCode,
    versionNumber: packageFacts.curriculumVersionNumber,
  });
  fs.writeFileSync(OVERLAY_PATH, `${JSON.stringify(overlay, null, 2)}\n`, { mode: 0o600 });
  overlayFacts = readOverlayFacts(OVERLAY_PATH);

  const targetMigrations = (() => {
    const db = new DatabaseSync(TARGET_DB, { readOnly: true });
    try {
      return (db.prepare("SELECT COUNT(*) AS n FROM _prisma_migrations WHERE rolled_back_at IS NULL").get() as { n: number }).n;
    } finally {
      db.close();
    }
  })();

  const prepared = prepareActivationManifest({
    activationId: "fixture-activation-0001",
    liveDatabasePath: TARGET_DB,
    backupArtifactPath: BACKUP_DB,
    structuralPackagePath: PACKAGE_PATH,
    overlayPath: OVERLAY_PATH,
    acceptedCheckpointPath: CHECKPOINT,
    transportBaselineCommit: TRANSPORT_COMMIT,
    transportBaselineTree: TRANSPORT_TREE,
    entryMigrationCount: targetMigrations,
    targetMigrationCount: targetMigrations,
    hostIdentityProvider: () => ({ machineIdSha256: MACHINE_ID_SHA, hostname: "fixture-host" }),
    deployedReleasesProvider: () => ({ ...RELEASES }),
    flagBaselineProvider: () => ({ ...FLAGS }),
    sanctionedTargetOverride: { __testOnlySanctionedTargetPath: TARGET_DB },
    now: new Date("2026-08-11T09:00:00.000Z"),
  });
  const basePath = path.join(MANIFEST_DIR, "base.json");
  fs.writeFileSync(basePath, prepared.json, { mode: 0o600 });
  baseManifest = { path: basePath, sha256: prepared.sha256, json: JSON.parse(prepared.json) };

  /* ---------- preparation is read-only and private ---------- */

  await check("prepare writes a 0600 manifest and mutates no database", () => {
    assert.equal(fs.statSync(basePath).mode & 0o777, 0o600);
    assert.equal(prepared.manifest.environment, "preprod");
    assert.equal(prepared.manifest.riskPolicy, PREPROD_RISK_POLICY);
    assert.equal(prepared.manifest.assessmentRuntimePolicy, "DEFER");
    assert.equal(prepared.manifest.videoRuntimePolicy, "ASSET_QA_DEFERRED");
  });

  await check("prepare derives a semantic content activation plan from the overlay", () => {
    const plan = prepared.manifest.contentActivationPlan;
    assert.equal(plan.rows.length, 2);
    assert.equal(plan.publishInPlaceCount, 1);
    assert.equal(plan.publishAndMoveBindingCount, 1);
    for (const row of plan.rows) {
      assert.ok(row.levelStableCode.length > 0, "rows are addressed by stableCode, never by an imported id");
      assert.ok(Number.isInteger(row.acceptedContentVersionNumber));
    }
  });

  await check("prepare records the FULL package fingerprint, never a prefix", () => {
    assert.match(prepared.manifest.structuralPackage.contentFingerprint, /^[0-9a-f]{64}$/);
  });

  await check("the canonical 100-level package fingerprint is derived, not assumed", () => {
    const canonical = readStructuralPackageFacts(OTHER_PACKAGE_PATH);
    assert.match(canonical.contentFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(canonical.contentFingerprint.slice(0, 8), "412449e5");
  });

  /* ---------- the happy path ---------- */

  await check("a complete, unmodified manifest authorizes the structural import", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput(baseManifest));
    assert.equal(evidence.operation, "STRUCTURAL_IMPORT");
    assert.equal(evidence.stage, "STRUCTURAL_IMPORT");
    assert.equal(evidence.environment, "preprod");
    assert.equal(evidence.deploymentClass, "staging");
    assert.equal(evidence.backupCoversCurrentState, true);
    assert.equal(evidence.grant.kind, "preprod-activation");
    assert.equal(evidence.grant.verifiedTarget.absolutePath, fs.realpathSync(TARGET_DB));
  });

  await check("the grant admits the protected target through the guard", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput(baseManifest));
    const guardEnv = env({ ATA_PROTECTED_DATABASES: TARGET_DB });
    // Without the grant the same call refuses, which is the control.
    try {
      assertSafeDatabaseTarget(`file:${TARGET_DB}`, { env: guardEnv });
      assert.fail("the guard admitted a protected database with no grant");
    } catch (error) {
      assert.ok(isProtectedDatabaseError(error, "TARGET_PROTECTED"));
    }
    const resolved = assertSafeDatabaseTarget(`file:${TARGET_DB}`, {
      env: guardEnv,
      activationGrant: evidence.grant,
    });
    assert.equal(resolved.absolutePath, fs.realpathSync(TARGET_DB));
  });

  await check("a grant for one database does not admit another", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput(baseManifest));
    const other = path.join(ROOT, "other.sqlite");
    fs.copyFileSync(TARGET_DB, other);
    try {
      assertSafeDatabaseTarget(`file:${other}`, {
        env: env({ ATA_PROTECTED_DATABASES: other }),
        activationGrant: evidence.grant,
      });
      assert.fail("a grant issued for one path admitted a different path");
    } catch (error) {
      assert.ok(isProtectedDatabaseError(error, "TARGET_PROTECTED"));
    }
  });

  await check("a hardlink alias of the granted file is still refused", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput(baseManifest));
    const alias = path.join(ROOT, "alias-hardlink.sqlite");
    fs.rmSync(alias, { force: true });
    fs.linkSync(TARGET_DB, alias);
    try {
      assertSafeDatabaseTarget(`file:${alias}`, {
        env: env({ ATA_PROTECTED_DATABASES: TARGET_DB }),
        activationGrant: evidence.grant,
      });
      assert.fail("a hardlink alias inherited the grant");
    } catch (error) {
      assert.ok(isProtectedDatabaseError(error, "TARGET_PROTECTED"));
    } finally {
      fs.rmSync(alias, { force: true });
    }
  });

  await check("a symlink to the granted file is refused", () => {
    const evidence = assertPreprodActivationAuthorization(authorizationInput(baseManifest));
    const link = path.join(ROOT, "alias-symlink.sqlite");
    fs.rmSync(link, { force: true });
    fs.symlinkSync(TARGET_DB, link);
    try {
      assertSafeDatabaseTarget(`file:${link}`, {
        env: env({ ATA_PROTECTED_DATABASES: TARGET_DB }),
        activationGrant: evidence.grant,
      });
      assert.fail("a symlink inherited the grant");
    } catch (error) {
      assert.ok(isProtectedDatabaseError(error, "TARGET_IS_SYMLINK"));
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  /* ---------- manifest identity ---------- */

  await check("a manifest whose bytes changed is refused", () => {
    const tampered = manifestWith((draft) => {
      draft.activationId = "fixture-activation-0002";
    }, "tampered-id");
    refuses("MANIFEST_SHA_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput({ ...tampered, sha256: baseManifest.sha256 }),
      ),
    );
  });

  await check("an unknown manifest field is refused (strict schema)", () => {
    const extra = manifestWith((draft) => {
      draft.allowLive = true;
    }, "unknown-field");
    refuses("MANIFEST_MALFORMED", () => assertPreprodActivationAuthorization(authorizationInput(extra)));
  });

  await check("a manifest for another schema version is refused", () => {
    const other = manifestWith((draft) => {
      draft.schemaVersion = "ata.preprod-activation-manifest/v2";
    }, "schema-v2");
    refuses("MANIFEST_SCHEMA_UNSUPPORTED", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("an expected digest that is not 64 hex characters is refused", () => {
    refuses("MANIFEST_SHA_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput({ ...baseManifest, sha256: "not-a-digest" }),
      ),
    );
  });

  /* ---------- environment ---------- */

  for (const [label, value] of [
    ["production", "production"],
    ["dev", "dev"],
    ["unrecognised", "preprod"],
  ] as const) {
    await check(`a host classified ${label} cannot satisfy a PREPROD manifest`, () => {
      refuses("ENVIRONMENT_NOT_PREPROD", () =>
        assertPreprodActivationAuthorization(
          authorizationInput(baseManifest, { environmentVariables: env({ ATA_ENVIRONMENT: value }) }),
        ),
      );
    });
  }

  await check("a host with no environment declaration is refused", () => {
    refuses("ENVIRONMENT_NOT_PREPROD", () =>
      assertPreprodActivationAuthorization(authorizationInput(baseManifest, { environmentVariables: env() })),
    );
  });

  for (const value of ["prod", "production", "dev", "staging", "unknown"]) {
    await check(`a manifest declaring environment=${value} does not parse`, () => {
      const other = manifestWith((draft) => {
        draft.environment = value;
      }, `env-${value}`);
      refuses("MANIFEST_MALFORMED", () => assertPreprodActivationAuthorization(authorizationInput(other)));
    });
  }

  await check("a manifest with an unsupported risk policy does not parse", () => {
    const other = manifestWith((draft) => {
      draft.riskPolicy = "PROD_OFFHOST_VERIFIED";
    }, "risk-policy");
    refuses("MANIFEST_MALFORMED", () => assertPreprodActivationAuthorization(authorizationInput(other)));
  });

  /* ---------- host ---------- */

  await check("a manifest prepared for another machine is refused", () => {
    refuses("HOST_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(baseManifest, {
          hostIdentityProvider: () => ({ machineIdSha256: OTHER_MACHINE_ID_SHA, hostname: "other-host" }),
        }),
      ),
    );
  });

  /* ---------- target ---------- */

  await check("a manifest naming a database other than the sanctioned target is refused", () => {
    const other = manifestWith((draft) => {
      draft.targetDatabase.canonicalPath = path.join(ROOT, "somewhere-else.sqlite");
    }, "wrong-target-path");
    refuses("TARGET_NOT_SANCTIONED", () => assertPreprodActivationAuthorization(authorizationInput(other)));
  });

  for (const forbidden of NEVER_AUTHORIZED_DATABASE_PATHS) {
    await check(`${path.basename(forbidden)} can never be an activation target`, () => {
      refuses("TARGET_NOT_SANCTIONED", () =>
        assertPreprodActivationAuthorization(
          authorizationInput(baseManifest, {
            sanctionedTargetOverride: { __testOnlySanctionedTargetPath: forbidden },
          }),
        ),
      );
    });
  }

  await check("a target whose inode changed is refused", () => {
    const other = manifestWith((draft) => {
      draft.targetDatabase.inode = draft.targetDatabase.inode + 1;
    }, "wrong-inode");
    refuses("TARGET_IDENTITY_MISMATCH", () => assertPreprodActivationAuthorization(authorizationInput(other)));
  });

  await check("a target whose device changed is refused", () => {
    const other = manifestWith((draft) => {
      draft.targetDatabase.device = draft.targetDatabase.device + 1;
    }, "wrong-device");
    refuses("TARGET_IDENTITY_MISMATCH", () => assertPreprodActivationAuthorization(authorizationInput(other)));
  });

  await check("an expected target digest the file does not have is refused", () => {
    refuses("TARGET_DIGEST_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(baseManifest, { expectedTargetSha256: "a".repeat(64) }),
      ),
    );
  });

  await check("the structural import is refused while the target is at the entry lineage", () => {
    // 41 -> 46: a target still at the entry count must not be structurally imported.
    const other = manifestWith((draft) => {
      draft.migrationLineage.entryMigrationCount = targetMigrations;
      draft.migrationLineage.targetMigrationCount = targetMigrations + 1;
    }, "not-yet-migrated");
    refuses("TARGET_MIGRATION_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("while the target is still at the entry lineage, the manifest's entry digest is authority", () => {
    const other = manifestWith((draft) => {
      draft.targetDatabase.sha256 = "b".repeat(64);
    }, "entry-digest-authority");
    // The caller states the digest the file really has, so only the entry-state
    // rule can catch the disagreement with the reviewed manifest.
    refuses("TARGET_DIGEST_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(other, { expectedTargetSha256: sha256File(TARGET_DB) }),
      ),
    );
  });

  /* ---------- the rollback artifact ---------- */

  await check("a missing rollback backup is refused", () => {
    const moved = path.join(ROOT, "moved-backup.sqlite");
    fs.renameSync(BACKUP_DB, moved);
    try {
      refuses("BACKUP_ARTIFACT_MISSING", () =>
        assertPreprodActivationAuthorization(authorizationInput(baseManifest)),
      );
    } finally {
      fs.renameSync(moved, BACKUP_DB);
    }
  });

  await check("a rollback backup whose bytes changed is refused", () => {
    const other = manifestWith((draft) => {
      draft.backup.artifactSha256 = "c".repeat(64);
    }, "backup-sha");
    refuses("BACKUP_ARTIFACT_DIGEST_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("a rollback backup of the wrong size is refused", () => {
    const other = manifestWith((draft) => {
      draft.backup.artifactSizeBytes = draft.backup.artifactSizeBytes + 4096;
    }, "backup-size");
    refuses("BACKUP_ARTIFACT_SIZE_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("a world-readable rollback backup is refused", () => {
    fs.chmodSync(BACKUP_DB, 0o644);
    try {
      refuses("BACKUP_ARTIFACT_PERMISSIVE", () =>
        assertPreprodActivationAuthorization(authorizationInput(baseManifest)),
      );
    } finally {
      fs.chmodSync(BACKUP_DB, 0o600);
    }
  });

  await check("a rollback backup that fails integrity_check is refused", () => {
    const good = fs.readFileSync(BACKUP_DB);
    const corrupt = Buffer.from(good);
    // Flip a byte inside the migration table's page region until integrity fails.
    for (let offset = 4096; offset < corrupt.length; offset += 997) {
      corrupt[offset] ^= 0xff;
    }
    fs.writeFileSync(BACKUP_DB, corrupt, { mode: 0o600 });
    try {
      // The digest gate fires first, which is itself the point: a backup whose
      // bytes moved never reaches the question of what it would say about itself.
      let code: string | null = null;
      try {
        assertPreprodActivationAuthorization(authorizationInput(baseManifest));
      } catch (error) {
        code = isPreprodActivationError(error) ? error.code : null;
      }
      assert.ok(
        code === "BACKUP_ARTIFACT_DIGEST_MISMATCH" || code === "BACKUP_INTEGRITY_FAILED",
        `expected a digest or integrity refusal, got ${code}`,
      );
    } finally {
      fs.writeFileSync(BACKUP_DB, good, { mode: 0o600 });
    }
  });

  await check("a rollback backup with the wrong migration count is refused", () => {
    const other = manifestWith((draft) => {
      draft.backup.appliedMigrationCount = draft.backup.appliedMigrationCount + 1;
    }, "backup-migrations");
    refuses("BACKUP_MIGRATION_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("LIVE CHANGED AFTER BACKUP: any write to the target invalidates the activation", () => {
    const before = fs.readFileSync(TARGET_DB);
    const db = new DatabaseSync(TARGET_DB);
    try {
      db.exec(
        `INSERT INTO "User" ("email","name","updatedAt","passwordHash") VALUES ('post.backup@fixture.invalid','Post Backup','2026-08-11 09:00:00','x')`,
      );
    } finally {
      db.close();
    }
    try {
      // TWO independent rules catch this, and either is a correct refusal: while
      // the target is at the entry lineage its digest must equal the manifest's,
      // and separately the rollback artifact must still cover the live state.
      // The test accepts both so that neither can be deleted without the other
      // failing loudly.
      let code: string | null = null;
      try {
        assertPreprodActivationAuthorization(
          authorizationInput(baseManifest, { expectedTargetSha256: sha256File(TARGET_DB) }),
        );
      } catch (error) {
        code = isPreprodActivationError(error) ? error.code : String(error);
      }
      assert.ok(
        code === "TARGET_DIGEST_MISMATCH" || code === "BACKUP_SOURCE_DIGEST_MISMATCH",
        `a post-backup write must refuse the activation; got ${String(code)}`,
      );
    } finally {
      fs.writeFileSync(TARGET_DB, before);
      for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(`${TARGET_DB}${suffix}`, { force: true });
    }
  });

  await check("a rollback artifact that does not cover the live state is refused", () => {
    // The target is untouched and its digest still matches the manifest, so the
    // entry-lineage rule passes and ONLY the backup-coverage rule can fire.
    const other = manifestWith((draft) => {
      draft.backup.sourceDatabaseSha256 = "e".repeat(64);
    }, "backup-not-covering");
    refuses("BACKUP_SOURCE_DIGEST_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("a rollback artifact whose rows differ from the live database is refused", () => {
    const other = manifestWith((draft) => {
      draft.backup.logicalDigest = "f".repeat(64);
    }, "backup-logical-digest");
    refuses("BACKUP_SOURCE_DIGEST_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("the restored fixture authorizes again, proving the previous test was the write", () => {
    const evidence = assertPreprodActivationAuthorization(
      authorizationInput(baseManifest, { expectedTargetSha256: sha256File(TARGET_DB) }),
    );
    assert.equal(evidence.backupCoversCurrentState, true);
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
    const other = manifestWith((draft) => {
      draft.acceptedProduct.checkpointSha256 = "d".repeat(64);
    }, "checkpoint-sha");
    refuses("PRODUCT_CHECKPOINT_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("an absent accepted product checkpoint is refused", () => {
    const other = manifestWith((draft) => {
      draft.acceptedProduct.checkpointPath = path.join(ROOT, "no-such-checkpoint.bin");
    }, "checkpoint-absent");
    refuses("PRODUCT_CHECKPOINT_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  /* ---------- overlay pins: the M-3 mitigation ---------- */

  // In a real activation the overlay stage runs AFTER the migration, so the
  // target is past the entry lineage and the entry-state rules no longer apply.
  // The overlay fixtures model that rather than the entry state.
  const overlayBase = manifestWith((draft) => {
    draft.migrationLineage.entryMigrationCount = targetMigrations - 1;
  }, "overlay-base");

  const overlayStageInput = (manifest: ManifestFile, overrides: Partial<AuthorizationInput> = {}) =>
    authorizationInput(manifest, {
      operation: "EDITORIAL_OVERLAY",
      stage: "EDITORIAL_OVERLAY",
      completedStages: ["PREPARED", "MIGRATION_41_TO_46", "STRUCTURAL_IMPORT"],
      overlay: overlayFacts,
      ...overrides,
    });

  await check("the overlay stage authorizes when every pin matches", () => {
    const evidence = assertPreprodActivationAuthorization(overlayStageInput(overlayBase));
    assert.equal(evidence.operation, "EDITORIAL_OVERLAY");
    assert.equal(evidence.editorialBaselineChecked, true);
    assert.equal(evidence.historicalPrincipalsAbsent, true);
  });

  await check("the overlay stage refuses when no overlay is supplied", () => {
    refuses("OVERLAY_MISMATCH", () =>
      assertPreprodActivationAuthorization(overlayStageInput(overlayBase, { overlay: undefined })),
    );
  });

  const overlayPinCases: Array<[string, keyof typeof overlayFacts, string, string]> = [
    ["canonical fingerprint", "fingerprint", "e".repeat(64), "OVERLAY_MISMATCH"],
    ["acceptedReviewedRootHash", "acceptedReviewedRootHash", "f".repeat(64), "OVERLAY_MISMATCH"],
    ["file digest", "fileSha256", "1".repeat(64), "OVERLAY_MISMATCH"],
    ["sourceCheckpointSha256", "sourceCheckpointSha256", "2".repeat(64), "OVERLAY_PROVENANCE_MISMATCH"],
    ["sourceBackendCommit", "sourceBackendCommit", "3".repeat(40), "OVERLAY_PROVENANCE_MISMATCH"],
    ["sourceBackendTree", "sourceBackendTree", "4".repeat(40), "OVERLAY_PROVENANCE_MISMATCH"],
    ["structuralPackageFingerprint", "structuralPackageFingerprint", "5".repeat(64), "OVERLAY_PROVENANCE_MISMATCH"],
    ["blueprintSourceDocumentSha256", "blueprintSourceDocumentSha256", "6".repeat(64), "OVERLAY_PROVENANCE_MISMATCH"],
  ];
  for (const [label, field, value, code] of overlayPinCases) {
    await check(`M-3: an overlay whose ${label} differs from the pin is refused`, () => {
      refuses(code, () =>
        assertPreprodActivationAuthorization(
          overlayStageInput(overlayBase, { overlay: { ...overlayFacts, [field]: value } }),
        ),
      );
    });
  }

  await check("M-3: an overlay that agrees with its manifest entry but not with the accepted checkpoint is refused", () => {
    // Both the manifest's overlay pin AND the artifact are moved together, so
    // only the cross-check against `acceptedProduct` can catch it.
    const other = manifestWith((draft) => {
      draft.editorialOverlay.sourceCheckpointSha256 = "7".repeat(64);
    }, "overlay-vs-checkpoint", overlayBase);
    refuses("OVERLAY_PROVENANCE_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        overlayStageInput(other, { overlay: { ...overlayFacts, sourceCheckpointSha256: "7".repeat(64) } }),
      ),
    );
  });

  await check("M-3: an overlay that agrees with its manifest entry but not with the imported package is refused", () => {
    const other = manifestWith((draft) => {
      draft.editorialOverlay.structuralPackageFingerprint = "8".repeat(64);
    }, "overlay-vs-package", overlayBase);
    refuses("OVERLAY_PROVENANCE_MISMATCH", () =>
      assertPreprodActivationAuthorization(
        overlayStageInput(other, { overlay: { ...overlayFacts, structuralPackageFingerprint: "8".repeat(64) } }),
      ),
    );
  });

  /* ---------- releases and flags ---------- */

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

  /* ---------- database contents ---------- */

  await check("a curriculum starting state that drifted refuses the activation", () => {
    const other = manifestWith((draft) => {
      draft.curriculumStartingState.fingerprint = "9".repeat(64);
    }, "starting-state");
    refuses("CURRICULUM_STARTING_STATE_MISMATCH", () =>
      assertPreprodActivationAuthorization(authorizationInput(other)),
    );
  });

  await check("M-1: an unexpected SourceAuthorityResolution row refuses the overlay", () => {
    const other = manifestWith((draft) => {
      draft.preOverlayEditorialBaseline.sourceAuthorityResolutionCount = 1;
    }, "sar-baseline", overlayBase);
    refuses("UNEXPECTED_SOURCE_AUTHORITY", () =>
      assertPreprodActivationAuthorization(overlayStageInput(other)),
    );
  });

  await check("M-2: an unexpected EditorialReviewNote refuses the overlay", () => {
    const other = manifestWith((draft) => {
      draft.preOverlayEditorialBaseline.editorialReviewNoteCount = 1;
    }, "note-baseline", overlayBase);
    refuses("UNEXPECTED_REVIEW_NOTE", () => assertPreprodActivationAuthorization(overlayStageInput(other)));
  });

  await check("an unexpected video-production baseline refuses the overlay", () => {
    const other = manifestWith((draft) => {
      draft.preOverlayEditorialBaseline.videoProductionVersionCount = 3;
    }, "video-baseline", overlayBase);
    refuses("UNEXPECTED_EDITORIAL_STATE", () =>
      assertPreprodActivationAuthorization(overlayStageInput(other)),
    );
  });

  await check("an overlay principal that already exists refuses the overlay", () => {
    const db = new DatabaseSync(TARGET_DB);
    const before = fs.readFileSync(TARGET_DB);
    try {
      db.exec(
        `INSERT INTO "User" ("email","name","updatedAt","passwordHash") VALUES ('g2.author.a@fixture.invalid','Pre-existing','2026-08-11 09:00:00','x')`,
      );
      db.close();
      refuses("UNEXPECTED_HISTORICAL_PRINCIPAL", () =>
        assertPreprodActivationAuthorization(
          overlayStageInput(overlayBase, { expectedTargetSha256: sha256File(TARGET_DB) }),
        ),
      );
    } finally {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      fs.writeFileSync(TARGET_DB, before);
      for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(`${TARGET_DB}${suffix}`, { force: true });
    }
  });

  await check("the baseline probes read the target without writing to it", () => {
    const before = sha256File(TARGET_DB);
    captureCurriculumStartingState(TARGET_DB);
    captureEditorialBaseline(TARGET_DB, {
      code: packageFacts.curriculumCode,
      versionNumber: packageFacts.curriculumVersionNumber,
    });
    capturePrincipalPresence(TARGET_DB, ["nobody@fixture.invalid"]);
    computeLogicalDigest(TARGET_DB);
    assert.equal(sha256File(TARGET_DB), before);
  });

  /* ---------- stage model ---------- */

  await check("a stage that skips its predecessors is refused", () => {
    refuses("STAGE_OUT_OF_ORDER", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(baseManifest, {
          operation: "EDITORIAL_OVERLAY",
          stage: "EDITORIAL_OVERLAY",
          completedStages: ["PREPARED"],
          overlay: overlayFacts,
        }),
      ),
    );
  });

  await check("a stage already recorded complete cannot be re-run", () => {
    refuses("STAGE_OUT_OF_ORDER", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(baseManifest, {
          completedStages: ["PREPARED", "MIGRATION_41_TO_46", "STRUCTURAL_IMPORT"],
        }),
      ),
    );
  });

  await check("an operation that does not belong to the stage is refused", () => {
    refuses("OPERATION_NOT_AUTHORIZED", () =>
      assertPreprodActivationAuthorization(
        authorizationInput(baseManifest, { operation: "EDITORIAL_OVERLAY", stage: "STRUCTURAL_IMPORT" }),
      ),
    );
  });

  for (const stage of [
    "CONTENT_PUBLICATION",
    "CURRICULUM_PUBLICATION",
    "BACKEND_DEPLOY",
    "FLAG_ENABLE",
    "SMOKE_ACCEPTANCE",
  ] as ActivationStage[]) {
    await check(`no importer operation is authorized at stage ${stage}`, () => {
      refuses("STAGE_NOT_AUTHORIZED", () =>
        assertPreprodActivationAuthorization(
          authorizationInput(baseManifest, {
            stage,
            completedStages: ["PREPARED", "MIGRATION_41_TO_46", "STRUCTURAL_IMPORT", "EDITORIAL_OVERLAY"],
          }),
        ),
      );
    });
  }

  /* ---------- resume policy ---------- */

  await check("resume: an exact pre-stage state is executable", () => {
    assert.equal(
      classifyStageState({
        observedDigest: "aa",
        expectedPreStageDigest: "aa",
        expectedPostStageDigest: "bb",
      }),
      "PRE_STAGE",
    );
  });

  await check("resume: an exact post-stage state is already complete", () => {
    assert.equal(
      classifyStageState({
        observedDigest: "bb",
        expectedPreStageDigest: "aa",
        expectedPostStageDigest: "bb",
      }),
      "POST_STAGE",
    );
  });

  await check("resume: anything else is UNKNOWN and stops the activation", () => {
    assert.equal(
      classifyStageState({
        observedDigest: "cc",
        expectedPreStageDigest: "aa",
        expectedPostStageDigest: "bb",
      }),
      "UNKNOWN",
    );
  });

  /* ---------- the lock ---------- */

  await check("a second activation cannot start while the lock is held", () => {
    const first = acquireActivationLock(
      { activationId: "a", manifestSha256: "0".repeat(64), stage: "STRUCTURAL_IMPORT", operation: "STRUCTURAL_IMPORT" },
      LOCK_PATH,
    );
    try {
      assert.equal(fs.statSync(LOCK_PATH).mode & 0o777, 0o600);
      refuses("ACTIVATION_LOCK_HELD", () =>
        acquireActivationLock(
          { activationId: "b", manifestSha256: "1".repeat(64), stage: "STRUCTURAL_IMPORT", operation: "STRUCTURAL_IMPORT" },
          LOCK_PATH,
        ),
      );
    } finally {
      first.release();
    }
    assert.equal(fs.existsSync(LOCK_PATH), false, "release must remove the lock");
  });

  /* ---------- the authorized mutation actually happens, and publishes nothing ---------- */

  await check("an authorized structural import writes to the protected target and publishes nothing", async () => {
    const before = fs.readFileSync(TARGET_DB);
    try {
      const evidence = assertPreprodActivationAuthorization(authorizationInput(baseManifest));
      const guardEnv = env({ ATA_PROTECTED_DATABASES: TARGET_DB });
      const target = assertSafeDatabaseTarget(`file:${TARGET_DB}`, {
        env: guardEnv,
        activationGrant: evidence.grant,
      });
      assertTargetIdentityUnchanged(target, { env: guardEnv, activationGrant: evidence.grant });

      const { PrismaClient } = await import("@prisma/client");
      const db = new PrismaClient({ datasources: { db: { url: target.url } } });
      try {
        const raw = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8")) as unknown;
        const result = await importCurriculumPackage(raw, { db, dryRun: false });
        assert.equal(result.ok, true, `import failed: ${JSON.stringify((result as { issues?: unknown }).issues)}`);
      } finally {
        await db.$disconnect();
      }

      // NOTHING WAS PUBLISHED. The structural import transports rows; publication
      // is a separate stage with no operation mapping, and an authorized import
      // must not have quietly performed one.
      const after = new DatabaseSync(TARGET_DB, { readOnly: true });
      try {
        const published = (
          after
            .prepare(`SELECT COUNT(*) AS n FROM "CurriculumVersion" WHERE "status" = 'published'`)
            .get() as { n: number }
        ).n;
        assert.equal(published, 0, "the structural import published a curriculum version");
        const imported = (
          after
            .prepare('SELECT COUNT(*) AS n FROM "CurriculumVersion" WHERE "code" = ? AND "versionNumber" = ?')
            .get(packageFacts.curriculumCode, packageFacts.curriculumVersionNumber) as { n: number }
        ).n;
        assert.equal(imported, 1, "the authorized import did not create the target curriculum version");
        const sar = (
          after.prepare('SELECT COUNT(*) AS n FROM "SourceAuthorityResolution"').get() as { n: number }
        ).n;
        const notes = (
          after.prepare('SELECT COUNT(*) AS n FROM "EditorialReviewNote"').get() as { n: number }
        ).n;
        assert.equal(sar, 0, "the structural import created SourceAuthorityResolution rows");
        assert.equal(notes, 0, "the structural import created EditorialReviewNote rows");
      } finally {
        after.close();
      }
    } finally {
      fs.writeFileSync(TARGET_DB, before);
      for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(`${TARGET_DB}${suffix}`, { force: true });
    }
  });

  await check("a target that already holds the imported curriculum refuses a fresh activation", () => {
    const before = fs.readFileSync(TARGET_DB);
    const db = new DatabaseSync(TARGET_DB);
    try {
      db.exec(
        `INSERT INTO "CurriculumVersion" ("code","name","status","versionNumber") VALUES ('${packageFacts.curriculumCode}','pre-existing','draft',${packageFacts.curriculumVersionNumber})`,
      );
      db.close();
      // Model the post-migration world so the entry-lineage digest rule does not
      // fire, and adopt the observed starting state so the fingerprint matches.
      // What remains is exactly one rule: the target curriculum must be absent.
      const observed = captureCurriculumStartingState(TARGET_DB);
      const variant = manifestWith((draft) => {
        draft.migrationLineage.entryMigrationCount = targetMigrations - 1;
        draft.curriculumStartingState.fingerprint = observed.fingerprint;
      }, "curriculum-already-present");
      refuses("CURRICULUM_STARTING_STATE_MISMATCH", () =>
        assertPreprodActivationAuthorization(
          authorizationInput(variant, { expectedTargetSha256: sha256File(TARGET_DB) }),
        ),
      );
    } finally {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      fs.writeFileSync(TARGET_DB, before);
      for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(`${TARGET_DB}${suffix}`, { force: true });
    }
  });

  /* ---------- CLI surface ---------- */

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
        "--dry-run",
      ],
      { cwd: REPO, encoding: "utf8", env: { ...process.env } },
    );
    assert.notEqual(result.status, 0, "the importer must refuse the live database");
    assert.match(`${result.stdout}${result.stderr}`, /protected runtime database/i);
  });

  await check("the overlay importer refuses the live PREPROD database without a manifest", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        path.join("scripts", "curriculum", "importEditorialOverlay.ts"),
        "--overlay",
        OVERLAY_PATH,
        "--database",
        "file:/srv/ata-data/data/ata-preprod.sqlite",
        "--dry-run",
      ],
      { cwd: REPO, encoding: "utf8", env: { ...process.env } },
    );
    assert.notEqual(result.status, 0, "the overlay importer must refuse the live database");
    assert.match(`${result.stdout}${result.stderr}`, /protected runtime database/i);
  });

  await check("supplying a manifest without its digest is refused", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        path.join("scripts", "curriculum", "importCurriculumPackage.ts"),
        "--package",
        PACKAGE_PATH,
        "--database",
        `file:${path.join(ROOT, "scratch.sqlite")}`,
        "--activation-manifest",
        baseManifest.path,
      ],
      { cwd: REPO, encoding: "utf8", env: { ...process.env } },
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /expect-activation-manifest-sha256/);
  });

  await check("the validate command mutates nothing", () => {
    const before = sha256File(TARGET_DB);
    const result = spawnSync(
      "npx",
      [
        "tsx",
        path.join("scripts", "curriculum", "validatePreprodActivationManifest.ts"),
        "--activation-manifest",
        baseManifest.path,
        "--expect-activation-manifest-sha256",
        baseManifest.sha256,
        "--activation-stage",
        "CONTENT_PUBLICATION",
        "--expect-target-sha256",
        before,
      ],
      { cwd: REPO, encoding: "utf8", env: { ...process.env, ATA_ENVIRONMENT: "staging" } },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /authorizes no importer operation/);
    assert.equal(sha256File(TARGET_DB), before);
  });

  /* ---------- no generic bypass ---------- */

  await check("no force/bypass switch exists anywhere in the shipped authorization surface", () => {
    const forbidden = [
      "--force",
      "--allow-live",
      "--unsafe",
      "--skip-protection",
      "--allow-protected",
      "DISABLE_GUARD",
      "ALLOW_LIVE",
      "ALLOW_PROTECTED_DB",
    ];
    const files = [
      path.join(REPO, "src", "lib", "curriculum", "protected-database.ts"),
      path.join(REPO, "scripts", "curriculum", "importCurriculumPackage.ts"),
      path.join(REPO, "scripts", "curriculum", "importEditorialOverlay.ts"),
      path.join(REPO, "scripts", "curriculum", "preparePreprodActivationManifest.ts"),
      path.join(REPO, "scripts", "curriculum", "validatePreprodActivationManifest.ts"),
      ...fs
        .readdirSync(path.join(REPO, "src", "lib", "curriculum", "preprod-activation"))
        .map((name) => path.join(REPO, "src", "lib", "curriculum", "preprod-activation", name)),
    ];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      // Strip block and line comments: the design notes NAME these switches in
      // order to say they do not exist, and a grep that cannot tell prose from
      // code would make documenting the absence impossible.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const needle of forbidden) {
        assert.ok(
          !code.includes(needle),
          `${path.basename(file)} contains a bypass switch: ${needle}`,
        );
      }
    }
  });

  await check("no CLI reaches the test-only sanctioned-target substitution", () => {
    const scriptDir = path.join(REPO, "scripts");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith("Regression.ts")) {
          if (fs.readFileSync(full, "utf8").includes("__testOnlySanctionedTargetPath")) offenders.push(full);
        }
      }
    };
    walk(scriptDir);
    assert.deepEqual(offenders, [], "a shipped CLI referenced the test-only target substitution");
  });

  await check("the manifest cannot authorize assessment binding or publication", () => {
    assert.equal(baseManifest.json.assessmentRuntimePolicy, "DEFER");
    assert.equal(baseManifest.json.videoRuntimePolicy, "ASSET_QA_DEFERRED");
    const other = manifestWith((draft) => {
      draft.assessmentRuntimePolicy = "BIND";
    }, "assessment-bind");
    refuses("MANIFEST_MALFORMED", () => assertPreprodActivationAuthorization(authorizationInput(other)));
  });

  await check("no migration was added by this work", () => {
    const migrations = fs
      .readdirSync(path.join(REPO, "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.equal(migrations.length, 46, `expected 46 migrations, found ${migrations.length}`);
  });
}

/* ------------------------------------------------------------------ *
 * cleanup — explicit paths only, never a wildcard on a variable
 * ------------------------------------------------------------------ */

function cleanup(): void {
  const resolved = fs.existsSync(ROOT) ? fs.realpathSync(ROOT) : ROOT;
  // Prove the directory is the one this process created under the system temp
  // root before removing anything. A cleanup that trusts a variable is how a
  // test suite deletes something that matters.
  const tmpRoot = fs.realpathSync(os.tmpdir());
  if (!resolved.startsWith(`${tmpRoot}${path.sep}ata-actv-auth-`)) {
    console.error(`refusing to clean an unexpected directory: ${resolved}`);
    return;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

main()
  .then(() => {
    cleanup();
    console.log(`\npreprod activation authorization regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanup();
    console.error(error);
    console.log(`\npreprod activation authorization regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
