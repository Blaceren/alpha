/**
 * PREPROD ACTIVATION AUTHORIZATION — building the manifest.
 *
 * READ-ONLY, WITHOUT EXCEPTION. Preparation measures: it opens the live database
 * read-only, digests the backup artifact, recomputes both artifacts' canonical
 * fingerprints, reads the release symlinks and the flag block, and writes ONE
 * file — the manifest. It never opens the database for writing and never calls
 * an importer.
 *
 * EVERY VALUE IS MEASURED, NOT SUPPLIED. The operator names the inputs; the
 * numbers come from reading them. That is what makes the manifest reviewable:
 * a human comparing it against the environment is comparing two independent
 * measurements, not a claim against its own restatement.
 *
 * WHAT THE OPERATOR STILL HAS TO DO. Read the manifest, agree with it, and carry
 * its digest to the mutation commands by hand. Preparation deliberately does not
 * hand the digest onward automatically: a pin that travels with the file it pins
 * is not a pin.
 *
 * AND IT REHEARSES. The states a stage will produce cannot be guessed, but they
 * can be measured on a copy. Preparation runs the whole activation — the
 * sanctioned migration, the structural package, the editorial overlay — against
 * a private copy of the rollback backup, fingerprints every state along the way,
 * and writes those fingerprints into the manifest. That is what the real run is
 * later compared against, and it is why no command needs to be told what the
 * database should contain.
 *
 * THE REHEARSAL IS THE ONLY PLACE ANYTHING IS MUTATED, AND IT MUTATES A COPY IN
 * A 0700 TEMPORARY DIRECTORY THAT IS REMOVED BY ABSOLUTE PATH. The live database
 * is opened read-only, here and everywhere else in this package.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readOverlayFacts, readStructuralPackageFacts } from "./artifact-facts";
import { assertBackupCoversCurrentState, PREPROD_RISK_POLICY } from "./backup";
import { fingerprintContentActivationPlan } from "./content-plan";
import { PreprodActivationError } from "./errors";
import { readHostIdentity, type HostIdentityProvider } from "./host-identity";
import {
  hashManifestBytes,
  preprodActivationManifestSchema,
  PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION,
  type PreprodActivationManifest,
} from "./manifest";
import {
  readDeployedReleases,
  readFlagBaseline,
  type DeployedReleasesProvider,
  type FlagBaselineProvider,
} from "./runtime";
import { captureEntryState, rehearseActivation } from "./rehearsal";
import type { StageFingerprint } from "./semantic-state";
import { computeLogicalDigest, probeSqliteDatabase, sha256File } from "./sqlite-probe";
import { ACTIVATION_STAGES } from "./stages";
import { assertManifestNamesSanctionedTarget, captureTargetIdentity, type SanctionedTargetOverride } from "./target";
import { validateEditorialOverlay } from "@/lib/curriculum/editorial-overlay/validate";

export type PrepareInput = {
  activationId: string;
  liveDatabasePath: string;
  backupArtifactPath: string;
  structuralPackagePath: string;
  overlayPath: string;
  acceptedCheckpointPath: string;
  transportBaselineCommit: string;
  transportBaselineTree: string;
  activationAuthorizationCommit?: string | null;
  activationAuthorizationTree?: string | null;
  entryMigrationCount: number;
  targetMigrationCount: number;

  hostIdentityProvider?: HostIdentityProvider;
  deployedReleasesProvider?: DeployedReleasesProvider;
  flagBaselineProvider?: FlagBaselineProvider;
  sanctionedTargetOverride?: SanctionedTargetOverride;
  /** Injected in tests so a manifest can be produced at a fixed instant. */
  now?: Date;
};

export type PrepareResult = {
  manifest: PreprodActivationManifest;
  /** Exactly the bytes to write, and the digest of exactly those bytes. */
  json: string;
  sha256: string;
};

/**
 * A state may only be PINNED if its migration lineage is clean.
 *
 * The schema types `failedCount` as the literal `0`, which is the constraint
 * rather than a formality: a manifest that pinned a state containing a
 * rolled-back or unfinished migration would be teaching the authorization to
 * accept one. Preparation refuses instead of writing it.
 */
function pinnable(fingerprint: StageFingerprint, label: string): StageFingerprint & {
  migrationLineage: StageFingerprint["migrationLineage"] & { failedCount: 0 };
} {
  if (fingerprint.migrationLineage.failedCount !== 0) {
    throw new PreprodActivationError(
      "REHEARSAL_FAILED",
      `the ${label} state carries ${fingerprint.migrationLineage.failedCount} unfinished or rolled-back migration(s); a manifest does not pin a broken lineage`,
      { expected: "0", actual: String(fingerprint.migrationLineage.failedCount) },
    );
  }
  return fingerprint as StageFingerprint & {
    migrationLineage: StageFingerprint["migrationLineage"] & { failedCount: 0 };
  };
}

export async function prepareActivationManifest(input: PrepareInput): Promise<PrepareResult> {
  const sanctionedPath = assertManifestNamesSanctionedTarget(
    input.liveDatabasePath,
    input.sanctionedTargetOverride,
  );

  // ---- the live database, as it stands
  const target = captureTargetIdentity(sanctionedPath);
  if (target.appliedMigrationCount !== input.entryMigrationCount) {
    throw new PreprodActivationError(
      "TARGET_MIGRATION_MISMATCH",
      `the live database is at ${target.appliedMigrationCount} applied migrations; this activation is being prepared for an entry lineage of ${input.entryMigrationCount}`,
      { expected: String(input.entryMigrationCount), actual: String(target.appliedMigrationCount) },
    );
  }
  const targetLogical = computeLogicalDigest(sanctionedPath);

  // ---- the rollback artifact, verified from its own bytes
  const backupPath = path.resolve(input.backupArtifactPath);
  let backupStat: fs.Stats;
  try {
    backupStat = fs.statSync(backupPath);
  } catch {
    throw new PreprodActivationError(
      "BACKUP_ARTIFACT_MISSING",
      `no rollback backup at ${backupPath}. Take a fresh sanctioned backup before preparing an activation manifest.`,
    );
  }
  const backupProbe = probeSqliteDatabase(backupPath, "BACKUP_INTEGRITY_FAILED");
  if (backupProbe.integrityCheck !== "ok") {
    throw new PreprodActivationError(
      "BACKUP_INTEGRITY_FAILED",
      `the rollback backup fails integrity_check (${backupProbe.integrityCheck}); it is not a usable rollback point`,
    );
  }
  if (backupProbe.foreignKeyViolations !== 0) {
    throw new PreprodActivationError(
      "BACKUP_FOREIGN_KEYS_FAILED",
      `the rollback backup has ${backupProbe.foreignKeyViolations} foreign-key violation(s)`,
    );
  }
  const backupLogical = computeLogicalDigest(backupPath, "BACKUP_INTEGRITY_FAILED");

  // THE CHECK THAT MAKES THE BACKUP A ROLLBACK POINT. A backup that does not
  // hold the same rows as the database it is supposed to protect is not a
  // rollback point at all, whatever its own integrity says. Refusing at
  // preparation time means the operator finds out now, while re-taking a backup
  // is cheap, rather than at the mutation boundary.
  assertBackupCoversCurrentState(
    {
      artifactPath: backupPath,
      artifactSizeBytes: backupStat.size,
      artifactSha256: sha256File(backupPath),
      createdAt: backupStat.mtime.toISOString(),
      sourceDatabaseSha256: target.sha256,
      sourceDatabaseAppliedMigrationCount: target.appliedMigrationCount,
      logicalDigest: backupLogical.digest,
      integrityCheck: "ok",
      foreignKeyViolations: 0,
      appliedMigrationCount: backupProbe.appliedMigrationCount,
      riskPolicy: PREPROD_RISK_POLICY,
    },
    {
      sha256: target.sha256,
      appliedMigrationCount: target.appliedMigrationCount,
      logicalDigest: targetLogical.digest,
    },
  );
  if (backupLogical.digest !== targetLogical.digest) {
    throw new PreprodActivationError(
      "BACKUP_SOURCE_DIGEST_MISMATCH",
      "the rollback backup does not hold the same rows as the live database. Either the database was written to after the backup was taken, or this is a backup of something else. Quiesce, take a fresh backup, and prepare again.",
      { expected: targetLogical.digest, actual: backupLogical.digest },
    );
  }

  // ---- the reviewed artifacts
  const structuralPackage = readStructuralPackageFacts(input.structuralPackagePath);
  const overlayFacts = readOverlayFacts(input.overlayPath);
  const overlayParsed = validateEditorialOverlay(
    JSON.parse(fs.readFileSync(input.overlayPath, "utf8")) as unknown,
  );
  if (!overlayParsed.ok) {
    throw new PreprodActivationError("OVERLAY_MISMATCH", "the overlay stopped validating between reads");
  }
  const overlay = overlayParsed.overlay;

  let checkpointStat: fs.Stats;
  try {
    checkpointStat = fs.statSync(input.acceptedCheckpointPath);
  } catch {
    throw new PreprodActivationError(
      "PRODUCT_CHECKPOINT_MISMATCH",
      `the accepted product checkpoint is not present at ${input.acceptedCheckpointPath}`,
    );
  }

  // ---- the environment around the database
  const host = (input.hostIdentityProvider ?? readHostIdentity)();
  const deployedReleases = (input.deployedReleasesProvider ?? (() => readDeployedReleases()))();
  const flagBaseline = (input.flagBaselineProvider ?? (() => readFlagBaseline()))();

  // ---- the entry state, measured on the live database, read-only
  const principalEmails = overlay.principals.map((principal) => principal.ref).sort();
  const entry = captureEntryState(sanctionedPath, principalEmails);

  // ---- and the states the sanctioned stages produce, measured on a copy
  const rehearsal = await rehearseActivation({
    backupArtifactPath: backupPath,
    structuralPackagePath: input.structuralPackagePath,
    overlayPath: input.overlayPath,
    target: {
      code: structuralPackage.curriculumCode,
      versionNumber: structuralPackage.curriculumVersionNumber,
    },
    principalEmails,
    entryMaxAuditLogId: entry.entryMaxAuditLogId,
    expectedEntryMigrationCount: input.entryMigrationCount,
    expectedTargetMigrationCount: input.targetMigrationCount,
  });

  // ---- the publication sequence, read off what the activation actually produced
  //
  // v1 projected this from the overlay's apply modes, which meant the plan
  // described what somebody expected rather than what the import made. It is now
  // derived from the rehearsed post-overlay database, and re-derived and compared
  // at authorization time — see `content-plan.ts`.
  const contentActivationPlan = rehearsal.contentActivationPlan;

  const manifest: PreprodActivationManifest = {
    schemaVersion: PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION,
    activationId: input.activationId,
    createdAt: (input.now ?? new Date()).toISOString(),
    environment: "preprod",
    riskPolicy: PREPROD_RISK_POLICY,

    host: { machineIdSha256: host.machineIdSha256, hostname: host.hostname },
    targetDatabase: {
      canonicalPath: target.canonicalPath,
      device: target.device,
      inode: target.inode,
      sizeBytes: target.sizeBytes,
      sha256: target.sha256,
      mtimeIso: target.mtimeIso,
      appliedMigrationCount: target.appliedMigrationCount,
      logicalDigest: targetLogical.digest,
    },
    migrationLineage: {
      entryMigrationCount: input.entryMigrationCount,
      targetMigrationCount: input.targetMigrationCount,
    },
    backup: {
      artifactPath: backupPath,
      artifactSizeBytes: backupStat.size,
      artifactSha256: sha256File(backupPath),
      createdAt: backupStat.mtime.toISOString(),
      sourceDatabaseSha256: target.sha256,
      sourceDatabaseAppliedMigrationCount: target.appliedMigrationCount,
      logicalDigest: backupLogical.digest,
      integrityCheck: "ok",
      foreignKeyViolations: 0,
      appliedMigrationCount: backupProbe.appliedMigrationCount,
      riskPolicy: PREPROD_RISK_POLICY,
    },

    acceptedBackend: {
      transportBaselineCommit: input.transportBaselineCommit,
      transportBaselineTree: input.transportBaselineTree,
      activationAuthorizationCommit: input.activationAuthorizationCommit ?? null,
      activationAuthorizationTree: input.activationAuthorizationTree ?? null,
    },
    acceptedProduct: {
      checkpointPath: path.resolve(input.acceptedCheckpointPath),
      checkpointSizeBytes: checkpointStat.size,
      checkpointSha256: sha256File(input.acceptedCheckpointPath),
    },
    structuralPackage: {
      path: path.resolve(input.structuralPackagePath),
      fileSha256: structuralPackage.fileSha256,
      packageCode: structuralPackage.packageCode,
      packageRevision: structuralPackage.packageRevision,
      contentFingerprint: structuralPackage.contentFingerprint,
      curriculumCode: structuralPackage.curriculumCode,
      curriculumVersionNumber: structuralPackage.curriculumVersionNumber,
    },
    editorialOverlay: {
      path: path.resolve(input.overlayPath),
      fileSha256: overlayFacts.fileSha256,
      schemaVersion: "ata.editorial-overlay/2",
      overlayCode: overlayFacts.overlayCode,
      overlayRevision: overlayFacts.overlayRevision,
      fingerprint: overlayFacts.fingerprint,
      acceptedReviewedRootHash: overlayFacts.acceptedReviewedRootHash,
      sourceCheckpointSha256: overlayFacts.sourceCheckpointSha256,
      sourceBackendCommit: overlayFacts.sourceBackendCommit,
      sourceBackendTree: overlayFacts.sourceBackendTree,
      structuralPackageFingerprint: overlayFacts.structuralPackageFingerprint,
      blueprintSourceDocumentSha256: overlayFacts.blueprintSourceDocumentSha256,
      curriculumCode: overlayFacts.curriculumCode,
      curriculumVersionNumber: overlayFacts.curriculumVersionNumber,
    },

    deployedReleases,
    flagBaseline,

    stateChain: {
      entry: pinnable(entry.fingerprint, "entry"),
      postMigration: pinnable(rehearsal.postMigration, "post-migration"),
      postStructural: pinnable(rehearsal.postStructural, "post-structural"),
      postOverlay: pinnable(rehearsal.postOverlay, "post-overlay"),
    },
    entryMaxAuditLogId: entry.entryMaxAuditLogId,
    // A freshly structural-imported curriculum carries no editorial history: the
    // package transports the pre-editorial baseline and nothing else. Zero is
    // therefore the reviewed expectation for all six, and writing it down is what
    // turns M-1 and M-2 from "the importer might notice" into "the activation
    // refuses".
    preOverlayEditorialBaseline: {
      sourceAuthorityResolutionCount: 0,
      editorialReviewNoteCount: 0,
      videoProductionVersionCount: 0,
      videoProductionAssessmentLinkCount: 0,
      approvedContentVersionCount: 0,
      approvedAssessmentVersionCount: 0,
    },
    historicalPrincipalRefs: principalEmails,

    contentActivationPlan: {
      rows: contentActivationPlan.rows,
      fingerprint: fingerprintContentActivationPlan(contentActivationPlan.rows),
    },

    assessmentRuntimePolicy: "DEFER",
    videoRuntimePolicy: "ASSET_QA_DEFERRED",

    stagePlan: { stages: [...ACTIVATION_STAGES] },

    carriedTransportMitigations: [
      {
        id: "M-1",
        severity: "MEDIUM",
        summary:
          "SourceAuthorityResolution lookup is slot-based, so an unexpected or tampered pre-existing row can coexist with the rows the overlay writes rather than colliding with them.",
        activationMitigation:
          "Before the overlay stage the target's SourceAuthorityResolution count for the imported curriculum must equal the reviewed baseline exactly. Any unexpected row stops the activation.",
      },
      {
        id: "M-2",
        severity: "MEDIUM",
        summary:
          "EditorialReviewNote identity has an axis the importer does not range over, so a tampered note can read as an absent one.",
        activationMitigation:
          "Before the overlay stage the target's EditorialReviewNote count for the imported curriculum must equal the reviewed baseline exactly. Any unexpected note stops the activation.",
      },
      {
        id: "M-3",
        severity: "MEDIUM",
        summary:
          "The overlay importer records sourceCheckpointSha256, sourceBackendCommit and sourceBackendTree without independently verifying them; they are provenance labels, not proofs.",
        activationMitigation:
          "The activation manifest pins all three externally, and the authorization compares the artifact against those pins and cross-checks them against the accepted checkpoint, the accepted transport baseline and the structural package this activation imports.",
      },
    ],
  };

  // Round-trip through the schema so a manifest this build cannot read is never
  // written by it.
  const parsed = preprodActivationManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PreprodActivationError(
      "MANIFEST_MALFORMED",
      `refusing to write a manifest this build cannot parse: ${first.path.join(".") || "(root)"} — ${first.message}`,
    );
  }

  const json = `${JSON.stringify(parsed.data, null, 2)}\n`;
  return { manifest: parsed.data, json, sha256: hashManifestBytes(json) };
}

/** Write the manifest privately. It describes user-data locations; it is not public. */
export function writeActivationManifest(outPath: string, json: string): string {
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, json, { mode: 0o600 });
  fs.chmodSync(resolved, 0o600);
  return crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
}
