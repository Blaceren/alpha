/**
 * PREPROD ACTIVATION AUTHORIZATION — rehearsing the activation before it happens.
 *
 * THE PROBLEM THIS SOLVES. An activation is a chain of irreversible steps, and
 * authorization for each one has to answer "is the database in the state the
 * previous step was supposed to leave it in". The first implementation answered
 * that by asking the caller, which the independent audit showed is not an answer
 * at all: a tampered post-migration database was authorized because whoever ran
 * the command supplied its freshly computed sha256.
 *
 * The state a stage produces cannot be guessed, but it CAN be measured — on a
 * copy, before anything real is touched. So manifest preparation runs the whole
 * activation against a private copy of the rollback backup: the same migration,
 * the same structural package, the same overlay. Every state along the way is
 * fingerprinted, and those fingerprints go into the manifest and are pinned by
 * the manifest's own digest. The real run then has something to be compared
 * against that nobody typed.
 *
 * WHY THE COPY IS TAKEN FROM THE BACKUP AND NOT THE LIVE FILE. Two reasons, and
 * the second is the important one. First, it is one fewer read of a live runtime
 * database. Second, the backup has already been proved byte-identical to the
 * live entry state — `prepare.ts` refuses otherwise — so rehearsing on it
 * rehearses on the entry state by construction, and if that equality ever failed
 * the manifest would not be written in the first place.
 *
 * NOTHING HERE TOUCHES ANYTHING REAL. The copy lives in a 0700 directory created
 * by `mkdtemp`, it is removed by absolute path when the rehearsal ends, and the
 * removal is guarded by a prefix assertion so a bug in path handling cannot turn
 * cleanup into deletion of something else. No glob is ever expanded.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  deriveContentActivationPlan,
  type ContentActivationPlan,
} from "./content-plan";
import { PreprodActivationError } from "./errors";
import {
  captureStageFingerprint,
  readMaxAuditLogId,
  type BusinessContinuityFilter,
  type StageFingerprint,
} from "./semantic-state";

const SCRATCH_PREFIX = "ata-activation-rehearsal-";

/** Repo root, resolved from this file rather than from the working directory. */
function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

export type RehearsalInput = {
  /** The verified rollback artifact. Copied, never opened for writing. */
  backupArtifactPath: string;
  structuralPackagePath: string;
  overlayPath: string;
  /** Which curriculum the package transports, for the plan and the baselines. */
  target: { code: string; versionNumber: number };
  /** The overlay's historical principals, for the business-continuity filter. */
  principalEmails: readonly string[];
  entryMaxAuditLogId: number;
  expectedEntryMigrationCount: number;
  expectedTargetMigrationCount: number;
};

export type RehearsalResult = {
  postMigration: StageFingerprint;
  postStructural: StageFingerprint;
  postOverlay: StageFingerprint;
  contentActivationPlan: ContentActivationPlan;
  /** Proof, recorded as evidence, that no business row moved during the rehearsal. */
  businessContinuityHeld: boolean;
};

function assertUnderScratch(directory: string): void {
  const base = path.basename(directory);
  const parent = path.dirname(directory);
  if (!base.startsWith(SCRATCH_PREFIX) || parent !== fs.realpathSync(os.tmpdir())) {
    throw new PreprodActivationError(
      "REHEARSAL_FAILED",
      `refusing to remove ${directory}: it is not a rehearsal scratch directory this process created`,
    );
  }
}

/**
 * Run one of the shipped commands against the scratch copy.
 *
 * WHY A SUBPROCESS RATHER THAN AN IMPORT. Two reasons, and both matter.
 *
 * The architectural one: `curriculum-authoring-surface-guard` requires that
 * nothing under `src/` reference the editorial-overlay importer — it is a
 * CLI/bootstrap primitive, and pulling it into a library would put a historical
 * import one `import` away from application code. A rehearsal that called it
 * directly would break that rule for the convenience of the caller.
 *
 * The honest one: rehearsing through the same commands an operator runs means
 * the rehearsal exercises the actual path, including each command's own guard.
 * The scratch copy is not a protected database, so they proceed without any
 * activation argument — which is also a useful proof that the ordinary path
 * still works exactly as it did.
 */
function runCommand(label: string, script: string, args: string[], databasePath: string): void {
  const result = spawnSync("npx", ["tsx", script, ...args], {
    cwd: repoRoot(),
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new PreprodActivationError(
      "REHEARSAL_FAILED",
      `${label} failed during rehearsal: ${(result.stderr || result.stdout || "").slice(-500)}. The manifest is not written when the activation it describes cannot be carried out.`,
    );
  }
}

/** Remove the SQLite sidecars a connection may leave, so the copy is one file. */
function dropSidecars(databasePath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

/**
 * Run the activation on a copy and report what each stage produced.
 *
 * The importers are the REAL ones. A rehearsal against a mock would prove
 * nothing about the states the real run has to reproduce, and the whole value of
 * this function is that the expectation and the event are produced by the same
 * code.
 */
export async function rehearseActivation(input: RehearsalInput): Promise<RehearsalResult> {
  const scratchDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), SCRATCH_PREFIX));
  fs.chmodSync(scratchDir, 0o700);
  const rehearsalDb = path.join(scratchDir, "rehearsal.sqlite");

  try {
    fs.copyFileSync(path.resolve(input.backupArtifactPath), rehearsalDb);
    fs.chmodSync(rehearsalDb, 0o600);

    const filter: BusinessContinuityFilter = {
      principalEmails: input.principalEmails,
      entryMaxAuditLogId: input.entryMaxAuditLogId,
    };

    const atEntry = captureStageFingerprint(rehearsalDb, filter);
    if (atEntry.migrationLineage.appliedCount !== input.expectedEntryMigrationCount) {
      throw new PreprodActivationError(
        "REHEARSAL_FAILED",
        `the rollback artifact is at ${atEntry.migrationLineage.appliedCount} applied migrations; this activation is prepared for an entry lineage of ${input.expectedEntryMigrationCount}`,
        {
          expected: String(input.expectedEntryMigrationCount),
          actual: String(atEntry.migrationLineage.appliedCount),
        },
      );
    }

    // ---- stage A: the sanctioned migration.
    runCommand("the sanctioned migration chain", path.join("prisma", "migrate.ts"), [], rehearsalDb);
    dropSidecars(rehearsalDb);
    const postMigration = captureStageFingerprint(rehearsalDb, filter);
    if (postMigration.migrationLineage.appliedCount !== input.expectedTargetMigrationCount) {
      throw new PreprodActivationError(
        "REHEARSAL_FAILED",
        `the migration rehearsal produced ${postMigration.migrationLineage.appliedCount} applied migrations, not the expected ${input.expectedTargetMigrationCount}`,
        {
          expected: String(input.expectedTargetMigrationCount),
          actual: String(postMigration.migrationLineage.appliedCount),
        },
      );
    }

    // ---- stage B: the structural import, through the shipped command.
    runCommand(
      "the structural import",
      path.join("scripts", "curriculum", "importCurriculumPackage.ts"),
      ["--package", path.resolve(input.structuralPackagePath), "--database", `file:${rehearsalDb}`],
      rehearsalDb,
    );
    dropSidecars(rehearsalDb);
    const postStructural = captureStageFingerprint(rehearsalDb, filter);

    // ---- stage C: the editorial overlay, through the shipped command.
    runCommand(
      "the editorial overlay",
      path.join("scripts", "curriculum", "importEditorialOverlay.ts"),
      [
        "--overlay",
        path.resolve(input.overlayPath),
        "--database",
        `file:${rehearsalDb}`,
        "--allow-principal-provisioning",
      ],
      rehearsalDb,
    );
    dropSidecars(rehearsalDb);
    const postOverlay = captureStageFingerprint(rehearsalDb, filter);

    // ---- the publication sequence, derived from what the activation produced.
    const contentActivationPlan = deriveContentActivationPlan(rehearsalDb, input.target);

    // ---- and the invariant the whole design rests on: the sanctioned stages do
    // not touch business data. Recorded as evidence rather than assumed, so a
    // future importer that started writing outside its own surface would fail
    // manifest preparation instead of being discovered on the live database.
    const businessContinuityHeld =
      postMigration.businessContinuityDigest === postStructural.businessContinuityDigest &&
      postStructural.businessContinuityDigest === postOverlay.businessContinuityDigest;
    if (!businessContinuityHeld) {
      throw new PreprodActivationError(
        "REHEARSAL_FAILED",
        "a sanctioned stage changed business data during the rehearsal. The activation is not authorized: the stages are supposed to touch only the curriculum surface, and this manifest would be pinning a state that violates that.",
      );
    }

    return { postMigration, postStructural, postOverlay, contentActivationPlan, businessContinuityHeld };
  } finally {
    assertUnderScratch(scratchDir);
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

/** Entry-side measurement of the live database. Read-only. */
export function captureEntryState(
  liveDatabasePath: string,
  principalEmails: readonly string[],
): { fingerprint: StageFingerprint; entryMaxAuditLogId: number } {
  const entryMaxAuditLogId = readMaxAuditLogId(liveDatabasePath);
  return {
    fingerprint: captureStageFingerprint(liveDatabasePath, { principalEmails, entryMaxAuditLogId }),
    entryMaxAuditLogId,
  };
}
