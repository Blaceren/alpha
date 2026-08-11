/**
 * PREPROD ACTIVATION AUTHORIZATION — the rollback artifact.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves that a specific backup file
 * exists right now, is private, is byte-for-byte the artifact that was reviewed,
 * opens as a sound SQLite database, carries the expected migration lineage, and
 * holds the same rows as the database that is about to be mutated. It does NOT
 * prove that restoring it would work: `scripts/backup/restoreSqlite.ts` is known
 * defective and nothing here calls it or trusts it.
 *
 * That gap is deliberate and bounded. Under the operator's PREPROD risk policy a
 * rebuildable environment may activate against a verified LOCAL artifact. The
 * same gap is BLOCKING for production, where the offhost copy and a hardened
 * restore path are hard gates. `assertRiskPolicySupported` is the one place that
 * distinction is enforced, and it accepts exactly one value.
 *
 * WHY BOTH A DIGEST AND A LOGICAL DIGEST. `artifactSha256` answers "is this the
 * same file we reviewed". `logicalDigest` answers "was it taken from the
 * database we are about to mutate". Neither implies the other: a perfect copy of
 * the WRONG database passes the first, and a corrupted copy of the RIGHT one
 * passes the second. An activation needs both answers, so both are checked.
 */
import fs from "node:fs";
import path from "node:path";

import { PreprodActivationError, requireEqual } from "./errors";
import { computeLogicalDigest, probeSqliteDatabase, sha256File } from "./sqlite-probe";

/**
 * The only risk policy this build accepts.
 *
 * Spelled out rather than defaulted, so that an activation which has not made
 * the trade-off consciously simply does not validate. There is no PROD value
 * here on purpose: production authorization is a separate design that arrives
 * after the offhost-backup and restore-hardening gates close.
 */
export const PREPROD_RISK_POLICY = "PREPROD_REBUILDABLE_LOCAL_BACKUP_ACCEPTED" as const;
export type PreprodRiskPolicy = typeof PREPROD_RISK_POLICY;

export function assertRiskPolicySupported(declared: string): void {
  if (declared === PREPROD_RISK_POLICY) return;
  throw new PreprodActivationError(
    "RISK_POLICY_UNSUPPORTED",
    `unsupported activation risk policy ${declared}. This build implements exactly one: ${PREPROD_RISK_POLICY}, which is valid for PREPROD only and never for production.`,
    { expected: PREPROD_RISK_POLICY, actual: declared },
  );
}

/**
 * What the manifest records about the rollback artifact.
 *
 * `sourceDatabaseSha256` and `sourceLogicalDigest` are captured by the
 * preparation command from the LIVE database at the moment the manifest is cut,
 * not read out of the ops backup manifest — the sanctioned backup tool does not
 * record the source file's digest, and inventing agreement we did not measure
 * would defeat the check that depends on it.
 */
export type BackupBinding = {
  artifactPath: string;
  artifactSizeBytes: number;
  artifactSha256: string;
  createdAt: string;
  /** Digest of the LIVE database the backup was taken from. */
  sourceDatabaseSha256: string;
  sourceDatabaseAppliedMigrationCount: number;
  /** Row-level digest shared by artifact and source when the copy is faithful. */
  logicalDigest: string;
  integrityCheck: string;
  foreignKeyViolations: number;
  appliedMigrationCount: number;
  riskPolicy: PreprodRiskPolicy;
};

export type BackupVerification = {
  artifactPath: string;
  artifactSha256: string;
  artifactSizeBytes: number;
  mode: string;
  integrityCheck: string;
  foreignKeyViolations: number;
  appliedMigrationCount: number;
  failedMigrationCount: number;
  logicalDigest: string;
};

/**
 * Re-derive everything the manifest claims about the artifact, from the artifact.
 *
 * Nothing is taken on trust from the ops backup manifest that produced it. That
 * file is a useful record; it is not evidence, because it was written by the
 * same run whose output we are checking.
 */
export function verifyBackupArtifact(binding: BackupBinding): BackupVerification {
  assertRiskPolicySupported(binding.riskPolicy);

  const artifactPath = path.resolve(binding.artifactPath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(artifactPath);
  } catch {
    throw new PreprodActivationError(
      "BACKUP_ARTIFACT_MISSING",
      `the rollback backup named by this manifest is gone: ${artifactPath}. An activation without a present rollback artifact is not authorized.`,
    );
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new PreprodActivationError(
      "BACKUP_ARTIFACT_MISSING",
      `the rollback backup path is not a regular file: ${artifactPath}`,
    );
  }

  // The artifact is a full copy of a database containing real user data. A
  // group- or world-readable copy is a confidentiality regression, and it is
  // cheap to refuse here rather than discover later.
  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new PreprodActivationError(
      "BACKUP_ARTIFACT_PERMISSIVE",
      `the rollback backup is readable beyond its owner (mode ${mode.toString(8)}): ${artifactPath}. It is a full copy of the user database and must stay private.`,
      { expected: "0600", actual: mode.toString(8) },
    );
  }

  requireEqual(
    "BACKUP_ARTIFACT_SIZE_MISMATCH",
    "rollback backup size",
    binding.artifactSizeBytes,
    stat.size,
  );

  // Digest BEFORE opening. A file whose bytes moved is not a database we want
  // to reason about, whatever it would say about itself.
  const artifactSha256 = sha256File(artifactPath);
  requireEqual(
    "BACKUP_ARTIFACT_DIGEST_MISMATCH",
    "rollback backup sha256",
    binding.artifactSha256,
    artifactSha256,
  );

  const probe = probeSqliteDatabase(artifactPath, "BACKUP_INTEGRITY_FAILED");
  if (probe.integrityCheck !== "ok") {
    throw new PreprodActivationError(
      "BACKUP_INTEGRITY_FAILED",
      `the rollback backup fails PRAGMA integrity_check (${probe.integrityCheck}): ${artifactPath}`,
      { expected: "ok", actual: probe.integrityCheck },
    );
  }
  if (probe.foreignKeyViolations !== 0) {
    throw new PreprodActivationError(
      "BACKUP_FOREIGN_KEYS_FAILED",
      `the rollback backup has ${probe.foreignKeyViolations} foreign-key violation(s): ${artifactPath}`,
      { expected: "0", actual: String(probe.foreignKeyViolations) },
    );
  }
  requireEqual(
    "BACKUP_MIGRATION_MISMATCH",
    "rollback backup applied migration count",
    binding.appliedMigrationCount,
    probe.appliedMigrationCount,
  );
  if (probe.failedMigrationCount !== 0) {
    throw new PreprodActivationError(
      "BACKUP_MIGRATION_MISMATCH",
      `the rollback backup records ${probe.failedMigrationCount} failed or rolled-back migration(s): ${artifactPath}`,
      { expected: "0", actual: String(probe.failedMigrationCount) },
    );
  }

  const logical = computeLogicalDigest(artifactPath, "BACKUP_INTEGRITY_FAILED");
  requireEqual(
    "BACKUP_SOURCE_DIGEST_MISMATCH",
    "rollback backup logical content digest",
    binding.logicalDigest,
    logical.digest,
  );

  return {
    artifactPath,
    artifactSha256,
    artifactSizeBytes: stat.size,
    mode: mode.toString(8),
    integrityCheck: probe.integrityCheck,
    foreignKeyViolations: probe.foreignKeyViolations,
    appliedMigrationCount: probe.appliedMigrationCount,
    failedMigrationCount: probe.failedMigrationCount,
    logicalDigest: logical.digest,
  };
}

/**
 * THE POST-BACKUP WRITE CHECK.
 *
 * This is the reason an age-based rule ("the backup must be less than N minutes
 * old") was rejected. Age answers a question nobody has: what matters is not how
 * long ago the copy was taken but whether anything happened to the original
 * since. A five-second-old backup of a database that took a write in between is
 * useless as a rollback point; an hour-old backup of a genuinely quiescent
 * database is exact.
 *
 * So the check is equality, and it is applied at the boundary of the FIRST
 * mutation stage — the only moment at which the live database is still supposed
 * to hold precisely the bytes the backup was taken from. Later stages have
 * legitimately moved the database and are pinned by their own expected
 * pre-stage digest instead; see `stages.ts`.
 */
export function assertBackupCoversCurrentState(
  binding: BackupBinding,
  current: { sha256: string; appliedMigrationCount: number; logicalDigest: string },
): void {
  if (binding.sourceDatabaseSha256 !== current.sha256) {
    throw new PreprodActivationError(
      "BACKUP_SOURCE_DIGEST_MISMATCH",
      "the live database has changed since the rollback backup was taken, so that backup is no longer a complete rollback point. Quiesce the environment, take a fresh backup, and prepare a fresh activation manifest.",
      { expected: binding.sourceDatabaseSha256, actual: current.sha256 },
    );
  }
  requireEqual(
    "BACKUP_MIGRATION_MISMATCH",
    "live database applied migration count at backup time",
    binding.sourceDatabaseAppliedMigrationCount,
    current.appliedMigrationCount,
  );
  // Belt and braces: the artifact and the live database must agree row-for-row.
  // A file digest can match while the artifact was copied from somewhere else
  // entirely, if the manifest was assembled carelessly.
  requireEqual(
    "BACKUP_SOURCE_DIGEST_MISMATCH",
    "rollback backup logical content digest against the live database",
    binding.logicalDigest,
    current.logicalDigest,
  );
}
