/**
 * PREPROD ACTIVATION AUTHORIZATION — pinning the exact file that may be mutated.
 *
 * THE SANCTIONED TARGET IS A CONSTANT IN THIS SOURCE. It is not read from argv,
 * not read from the environment, and not taken from the manifest. The manifest
 * declares which database it was prepared for, and that declaration is COMPARED
 * against the constant — a manifest naming any other path is refused, which is
 * what stops a prepared manifest from being retargeted at `ata-dev`, at a
 * production database, or at an arbitrary file the caller happens to own.
 *
 * WHY A CONSTANT AND NOT A LIST. A list invites a second entry, and the second
 * entry is always the one nobody reviewed. PROD gets its own authorization
 * design after the offhost and restore gates close; it does not get a row here.
 *
 * IDENTITY IS `(realpath, dev, ino, size, sha256)`, NOT A PATH STRING. A path is
 * a label. `assertSafeDatabaseTarget` already refuses symlinks and resolves the
 * parent, so by the time a target reaches this module it is a real file; what
 * remains is proving it is the SAME real file the manifest was reviewed against,
 * and that its contents have not moved since. The digest is what catches "the
 * database was written to after the backup", which is the failure this whole
 * mechanism exists to catch.
 */
import fs from "node:fs";
import path from "node:path";

import { PreprodActivationError, requireEqual } from "./errors";
import { probeSqliteDatabase, sha256File, type SqliteProbe } from "./sqlite-probe";

/**
 * The only database a v1 activation manifest may name.
 *
 * Changing this constant is a reviewed source change, which is the intended
 * cost. See `__testOnlySanctionedTargetPath` below for why tests do not need to.
 */
export const SANCTIONED_PREPROD_DATABASE_PATH = "/srv/ata-data/data/ata-preprod.sqlite" as const;

/**
 * Paths that must NEVER be authorized, named explicitly so a future edit to the
 * sanctioned constant cannot quietly select one of them.
 */
export const NEVER_AUTHORIZED_DATABASE_PATHS: readonly string[] = [
  "/srv/ata-data/data/ata-prod.sqlite",
  "/home/ubuntu/runtime/ata-dev-v2/data/ata-dev.sqlite",
  "/home/ubuntu/runtime/ata-suite/data/ata-suite.sqlite",
];

export type TargetIdentity = {
  /** Canonical absolute path after realpath resolution. */
  canonicalPath: string;
  device: number;
  inode: number;
  sizeBytes: number;
  /** Whole-file sha256. The load-bearing field. */
  sha256: string;
  /** ISO-8601 mtime, evidence only — never compared as authority. */
  mtimeIso: string;
  appliedMigrationCount: number;
};

/**
 * Test-only substitution of the sanctioned path.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A BYPASS. A regression suite must be able to
 * prove that a VALID authorization actually permits a mutation, and doing that
 * against the real live PREPROD database is precisely what the mandate forbids.
 * So the suite designates a disposable fixture as "the sanctioned target" for
 * the duration of one in-process test.
 *
 * It is a function PARAMETER on an options object, reachable only by a caller
 * that already has code execution inside this process. It is deliberately NOT
 * an argv flag and NOT an environment variable: no CLI in `scripts/` passes it,
 * and the regression suite asserts that none ever does. An operator cannot reach
 * it, which is the distinction that matters — the threat model here is operator
 * error, not a hostile process that already runs our code.
 */
export type SanctionedTargetOverride = {
  readonly __testOnlySanctionedTargetPath: string;
};

export function resolveSanctionedTargetPath(override?: SanctionedTargetOverride): string {
  const candidate = override?.__testOnlySanctionedTargetPath ?? SANCTIONED_PREPROD_DATABASE_PATH;
  for (const forbidden of NEVER_AUTHORIZED_DATABASE_PATHS) {
    if (path.resolve(candidate) === forbidden) {
      throw new PreprodActivationError(
        "TARGET_NOT_SANCTIONED",
        `refusing to treat ${forbidden} as an activation target: this database is never authorized by a PREPROD manifest`,
        { expected: SANCTIONED_PREPROD_DATABASE_PATH, actual: candidate },
      );
    }
  }
  return path.resolve(candidate);
}

/**
 * Refuse a manifest that names a database other than the sanctioned one.
 *
 * This runs before anything is opened. A manifest for the wrong database is
 * wrong regardless of what that database currently contains.
 */
export function assertManifestNamesSanctionedTarget(
  declaredPath: string,
  override?: SanctionedTargetOverride,
): string {
  const sanctioned = resolveSanctionedTargetPath(override);
  if (path.resolve(declaredPath) !== sanctioned) {
    throw new PreprodActivationError(
      "TARGET_NOT_SANCTIONED",
      `this manifest names a database that is not the sanctioned PREPROD target; only ${sanctioned} may be activated`,
      { expected: sanctioned, actual: declaredPath },
    );
  }
  return sanctioned;
}

/** Capture the full identity of a database file as it stands right now. */
export function captureTargetIdentity(absolutePath: string): TargetIdentity {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    throw new PreprodActivationError(
      "TARGET_UNREADABLE",
      `activation target does not exist or cannot be stat'ed: ${absolutePath}`,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new PreprodActivationError(
      "TARGET_IDENTITY_MISMATCH",
      `activation target is a symlink: ${absolutePath}. Pass the real file — an indirection can change meaning between check and write.`,
    );
  }
  if (!stat.isFile()) {
    throw new PreprodActivationError(
      "TARGET_UNREADABLE",
      `activation target is not a regular file: ${absolutePath}`,
    );
  }
  const canonicalPath = fs.realpathSync(absolutePath);
  const probe: SqliteProbe = probeSqliteDatabase(canonicalPath, "TARGET_UNREADABLE");
  return {
    canonicalPath,
    device: stat.dev,
    inode: stat.ino,
    sizeBytes: stat.size,
    sha256: sha256File(canonicalPath),
    mtimeIso: stat.mtime.toISOString(),
    appliedMigrationCount: probe.appliedMigrationCount,
  };
}

export type ExpectedPhysicalIdentity = {
  canonicalPath: string;
  device: number;
  inode: number;
};

/**
 * Prove the file in front of us is the same FILE the manifest was reviewed
 * against.
 *
 * WHAT THIS DELIBERATELY NO LONGER DOES. It used to compare the target's sha256
 * as well, against a value the caller supplied. After a sanctioned stage the
 * bytes have legitimately moved, so that comparison could only be made to pass
 * by letting the caller nominate the new digest — which is exactly the trust
 * reset the independent audit demonstrated. Content is now proved by matching
 * the target against the rehearsal-derived state chain in `semantic-state.ts`;
 * what remains here is identity, which does not change when a stage runs.
 *
 * ORDER IS DELIBERATE. Path, then `(dev, ino)` — coarsest and most diagnostic
 * first, so a refusal says "you are pointed at a different file" rather than
 * something subtler further down.
 */
export function assertTargetPhysicalIdentity(
  expected: ExpectedPhysicalIdentity,
  actual: TargetIdentity,
): void {
  requireEqual("TARGET_PATH_MISMATCH", "activation target path", expected.canonicalPath, actual.canonicalPath);
  requireEqual("TARGET_IDENTITY_MISMATCH", "activation target device", expected.device, actual.device);
  requireEqual("TARGET_IDENTITY_MISMATCH", "activation target inode", expected.inode, actual.inode);
}
