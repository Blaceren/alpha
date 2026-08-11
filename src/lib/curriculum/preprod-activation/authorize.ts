/**
 * PREPROD ACTIVATION AUTHORIZATION — the one entry point.
 *
 * WHAT THIS IS FOR. The accepted importers refuse to write a protected runtime
 * database, and that refusal is correct: for Foundation work there was no reason
 * one should ever be permitted. A real PREPROD activation now needs a way to
 * mutate exactly one database, on exactly one machine, with exactly one reviewed
 * package and overlay, at exactly one stage — and no way to do anything else.
 *
 * WHAT IT IS NOT. It is not a force flag. There is no `--force`, no
 * `--allow-live`, no `ALLOW_PROTECTED_DB`, no `DISABLE_GUARD`, and no
 * environment variable that shortens this path. The only way past the guard is a
 * grant, and the only way to get a grant is for every precondition below to hold
 * simultaneously.
 *
 * THREAT MODEL, STATED PLAINLY. This defends against operator error: the wrong
 * database, the wrong host, the wrong package, a stale backup, a stage run out
 * of order, an environment that drifted since review. It does NOT defend against
 * a hostile operator with root, who can already open the SQLite file directly —
 * and pretending otherwise would buy complexity with no security. Fail-closed
 * operational authorization is the goal; cryptographic protection against the
 * machine's owner is not.
 *
 * THE GRANT IS NARROW BY CONSTRUCTION. It names one absolute path, one
 * `(device, inode)`, one operation, one stage and one manifest digest. The guard
 * compares all of them against the target actually in front of it, so a grant
 * issued for one database cannot admit another even within the same process.
 *
 * ORDER OF CHECKS. Cheapest and most diagnostic first — manifest identity, then
 * host, then the database, then the artifacts, then the environment, then the
 * database's contents. A refusal should name the coarsest thing that is wrong,
 * because "your manifest is for another machine" is a more useful message than a
 * digest mismatch six checks later.
 */
import fs from "node:fs";

import {
  assertBackupCoversCurrentState,
  verifyBackupArtifact,
  type BackupVerification,
} from "./backup";
import {
  assertEditorialBaselineMatches,
  assertHistoricalPrincipalsAbsent,
  assertStartingStateMatches,
  assertTargetCurriculumAbsent,
  captureCurriculumStartingState,
  captureEditorialBaseline,
  capturePrincipalPresence,
} from "./baseline";
import { PreprodActivationError, requireEqual } from "./errors";
import {
  assertHostMatches,
  readHostIdentity,
  type HostIdentity,
  type HostIdentityProvider,
} from "./host-identity";
import {
  assertAcceptedProductCheckpoint,
  assertOverlayMatchesManifest,
  assertStructuralPackageMatchesManifest,
  parseActivationManifestFile,
  type OverlayFacts,
  type PreprodActivationManifest,
  type StructuralPackageFacts,
} from "./manifest";
import {
  assertFlagBaselineMatches,
  assertReleasesMatch,
  readDeployedReleases,
  readFlagBaseline,
  type DeployedReleasesProvider,
  type FlagBaselineProvider,
} from "./runtime";
import { computeLogicalDigest, sha256File } from "./sqlite-probe";
import {
  assertOperationMatchesStage,
  assertStageOrder,
  expectedMigrationCountAtStage,
  type ActivationStage,
  type AuthorizedOperation,
} from "./stages";
import {
  assertManifestNamesSanctionedTarget,
  assertTargetMatches,
  captureTargetIdentity,
  type SanctionedTargetOverride,
  type TargetIdentity,
} from "./target";
import { classifyEnvironment } from "@/lib/environment";

/**
 * The deployment class PREPROD runs as.
 *
 * PREPROD declares `ATA_ENVIRONMENT=staging`; `preprod` is this mechanism's own
 * name for the activation, not a value the runtime uses. Requiring `staging`
 * here means a host classified `production` — or one that cannot be classified
 * at all — can never satisfy a v1 manifest, whatever the manifest says about
 * itself.
 */
export const REQUIRED_DEPLOYMENT_CLASS = "staging" as const;

/**
 * Proof that one specific mutation, on one specific file, has been authorized.
 *
 * `assertStillValid` is re-run by the guard immediately before the target is
 * opened for writing. That is the narrowest point at which the live state can be
 * re-read, and it is what turns "everything was true a moment ago" into
 * "everything is true now".
 */
export type PreprodActivationGrant = {
  readonly kind: "preprod-activation";
  readonly activationId: string;
  readonly manifestSha256: string;
  readonly operation: AuthorizedOperation;
  readonly stage: ActivationStage;
  readonly verifiedTarget: {
    readonly absolutePath: string;
    readonly device: number;
    readonly inode: number;
    readonly sha256: string;
  };
  readonly assertStillValid: () => void;
};

export type AuthorizationEvidence = {
  activationId: string;
  manifestPath: string;
  manifestSha256: string;
  environment: "preprod";
  deploymentClass: string;
  riskPolicy: string;
  operation: AuthorizedOperation;
  stage: ActivationStage;
  completedStages: ActivationStage[];
  host: HostIdentity;
  target: TargetIdentity;
  expectedMigrationCount: number;
  backup: BackupVerification;
  backupCoversCurrentState: boolean;
  deployedReleases: { backend: string; academy: string; crm: string };
  flagBaselineMatched: boolean;
  curriculumStartingStateFingerprint: string;
  editorialBaselineChecked: boolean;
  historicalPrincipalsAbsent: boolean;
  grant: PreprodActivationGrant;
};

export type AuthorizationInput = {
  /** Path to the reviewed manifest. */
  activationManifestPath: string;
  /** Its digest, supplied separately by the operator. Never computed-and-trusted. */
  expectedManifestSha256: string;
  operation: AuthorizedOperation;
  stage: ActivationStage;
  /** Stages the operator asserts have already finished, for ordering. */
  completedStages: ActivationStage[];
  /**
   * The digest the target is expected to hold right now.
   *
   * For the first mutation stage this must equal the manifest's entry digest,
   * and the check below enforces that rather than trusting the caller. For later
   * stages only the operator can know it — the migration and the structural
   * import both produce a database whose bytes were not predictable at
   * preparation time — so it is supplied per stage and compared against the
   * file. Either way, nothing proceeds against a target whose contents were not
   * stated in advance.
   */
  expectedTargetSha256: string;

  /** Facts read from the structural package this run will import. */
  structuralPackage: StructuralPackageFacts;
  /** Facts read from the overlay this run will import. Required for the overlay stage. */
  overlay?: OverlayFacts;

  /** Injected in tests; production reads the host. */
  hostIdentityProvider?: HostIdentityProvider;
  deployedReleasesProvider?: DeployedReleasesProvider;
  flagBaselineProvider?: FlagBaselineProvider;
  environmentVariables?: NodeJS.ProcessEnv;
  /** See `target.ts` — a test-only substitution, unreachable from any CLI. */
  sanctionedTargetOverride?: SanctionedTargetOverride;
};

/**
 * Authorize exactly one operation, or throw.
 *
 * Returns evidence as well as a grant: the caller writes the evidence into the
 * activation record, and hands the grant to the protected-database guard.
 */
export function assertPreprodActivationAuthorization(
  input: AuthorizationInput,
): AuthorizationEvidence {
  // ---- 1. the manifest, pinned by a digest supplied from outside it.
  const { manifest, sha256: manifestSha256 } = parseActivationManifestFile(
    input.activationManifestPath,
    input.expectedManifestSha256,
  );

  // ---- 2. sequencing. Checked before anything is opened: a run at the wrong
  // stage is wrong regardless of what the database currently holds.
  assertOperationMatchesStage(input.stage, input.operation);
  assertStageOrder(input.stage, input.completedStages);

  // ---- 3. deployment class. A manifest can only ever say `preprod` (the schema
  // is a literal), but the HOST has to agree, and a host that cannot classify
  // itself is refused rather than assumed benign.
  const classification = classifyEnvironment(input.environmentVariables ?? process.env);
  if (classification.kind !== "classified" || classification.environment !== REQUIRED_DEPLOYMENT_CLASS) {
    const observed =
      classification.kind === "classified" ? classification.environment : `unknown (${classification.reason})`;
    throw new PreprodActivationError(
      "ENVIRONMENT_NOT_PREPROD",
      `this host is classified ${observed}; a PREPROD activation manifest is only valid on a host classified ${REQUIRED_DEPLOYMENT_CLASS}. There is no production authorization in this build.`,
      { expected: REQUIRED_DEPLOYMENT_CLASS, actual: observed },
    );
  }

  // ---- 4. which machine.
  const host = (input.hostIdentityProvider ?? readHostIdentity)();
  assertHostMatches(manifest.host.machineIdSha256, host);

  // ---- 5. which database. The sanctioned path is a constant in this source; the
  // manifest's declaration is compared against it, never used in its place.
  const sanctionedPath = assertManifestNamesSanctionedTarget(
    manifest.targetDatabase.canonicalPath,
    input.sanctionedTargetOverride,
  );
  const target = captureTargetIdentity(sanctionedPath);
  const expectedMigrationCount = expectedMigrationCountAtStage(input.stage, manifest.migrationLineage);

  // WHOSE DIGEST IS AUTHORITY, AND WHEN.
  //
  // The caller supplies the digest the target is expected to hold right now,
  // and it is always compared against the file. What changes between stages is
  // whether the MANIFEST also gets a vote.
  //
  // While the target is still at the entry lineage, nothing this activation
  // authorizes has run yet, so the database must still hold exactly the bytes
  // the manifest and the rollback backup were prepared from — and the caller
  // does not get to nominate some other value. Once the migration stage has
  // moved the lineage forward the manifest cannot know the new digest (a
  // migration's output was not predictable at preparation time), so the
  // operator states it per stage and it is checked against the file alone.
  //
  // Keying this off the OBSERVED lineage rather than off the stage name is
  // deliberate: it stays true if the stage list is ever reordered, and it cannot
  // be sidestepped by declaring a different stage.
  if (target.appliedMigrationCount === manifest.migrationLineage.entryMigrationCount) {
    requireEqual(
      "TARGET_DIGEST_MISMATCH",
      "target digest while the database is still at the pre-activation lineage",
      manifest.targetDatabase.sha256,
      input.expectedTargetSha256,
    );
  }
  assertTargetMatches(
    {
      canonicalPath: sanctionedPath,
      device: manifest.targetDatabase.device,
      inode: manifest.targetDatabase.inode,
      sizeBytes: target.sizeBytes,
      sha256: input.expectedTargetSha256,
      appliedMigrationCount: expectedMigrationCount,
    },
    target,
    expectedMigrationCount,
  );

  // ---- 6. the rollback artifact. Verified from the bytes every time; nothing is
  // taken from the ops backup manifest that produced it.
  const backup = verifyBackupArtifact(manifest.backup);

  // At the entry state — and only there — the artifact must still be a complete
  // rollback point for what is actually in the database. This is the
  // live-changed-after-backup check, and it is equality rather than an age rule
  // because age answers a question nobody has.
  let backupCoversCurrentState = false;
  if (target.appliedMigrationCount === manifest.migrationLineage.entryMigrationCount) {
    const logical = computeLogicalDigest(target.canonicalPath);
    assertBackupCoversCurrentState(manifest.backup, {
      sha256: target.sha256,
      appliedMigrationCount: target.appliedMigrationCount,
      logicalDigest: logical.digest,
    });
    backupCoversCurrentState = true;
  }

  // ---- 7. the reviewed inputs.
  assertAcceptedProductCheckpoint(manifest, readCheckpointFacts(manifest.acceptedProduct.checkpointPath));
  assertStructuralPackageMatchesManifest(manifest, input.structuralPackage);
  if (input.stage === "EDITORIAL_OVERLAY") {
    if (!input.overlay) {
      throw new PreprodActivationError(
        "OVERLAY_MISMATCH",
        "the editorial-overlay stage requires the overlay artifact's facts so they can be compared against the reviewed pins",
      );
    }
    assertOverlayMatchesManifest(manifest, input.overlay);
  }

  // ---- 8. the environment around the database.
  const deployedReleases = (input.deployedReleasesProvider ?? (() => readDeployedReleases()))();
  assertReleasesMatch(manifest.deployedReleases, deployedReleases);

  const flagBaseline = (input.flagBaselineProvider ?? (() => readFlagBaseline()))();
  assertFlagBaselineMatches(manifest.flagBaseline, flagBaseline);

  // ---- 9. what the database already contains.
  const startingState = captureCurriculumStartingState(target.canonicalPath);
  let editorialBaselineChecked = false;
  let historicalPrincipalsAbsent = false;

  if (input.stage === "STRUCTURAL_IMPORT") {
    assertStartingStateMatches(manifest.curriculumStartingState.fingerprint, startingState);
    assertTargetCurriculumAbsent(startingState, {
      code: manifest.structuralPackage.curriculumCode,
      versionNumber: manifest.structuralPackage.curriculumVersionNumber,
    });
  }

  if (input.stage === "EDITORIAL_OVERLAY") {
    // M-1 and M-2: the freshly imported target must contain ONLY what the
    // structural package produced. An unexpected authority row or review note is
    // refused BEFORE the overlay runs, because the overlay must never be allowed
    // to absorb state it did not create.
    const observed = captureEditorialBaseline(target.canonicalPath, {
      code: manifest.structuralPackage.curriculumCode,
      versionNumber: manifest.structuralPackage.curriculumVersionNumber,
    });
    assertEditorialBaselineMatches(
      { curriculumVersionId: observed.curriculumVersionId, ...manifest.preOverlayEditorialBaseline },
      observed,
    );
    editorialBaselineChecked = true;

    const principals = capturePrincipalPresence(target.canonicalPath, manifest.historicalPrincipalRefs);
    assertHistoricalPrincipalsAbsent(principals.present);
    historicalPrincipalsAbsent = true;
  }

  // ---- 10. the grant. Narrow by construction, and re-validated at the guard.
  const grant: PreprodActivationGrant = {
    kind: "preprod-activation",
    activationId: manifest.activationId,
    manifestSha256,
    operation: input.operation,
    stage: input.stage,
    verifiedTarget: {
      absolutePath: target.canonicalPath,
      device: target.device,
      inode: target.inode,
      sha256: target.sha256,
    },
    assertStillValid: () => {
      const now = captureTargetIdentity(sanctionedPath);
      assertTargetMatches(
        {
          canonicalPath: target.canonicalPath,
          device: target.device,
          inode: target.inode,
          sizeBytes: target.sizeBytes,
          sha256: target.sha256,
          appliedMigrationCount: expectedMigrationCount,
        },
        now,
        expectedMigrationCount,
      );
    },
  };

  return {
    activationId: manifest.activationId,
    manifestPath: input.activationManifestPath,
    manifestSha256,
    environment: manifest.environment,
    deploymentClass: classification.environment,
    riskPolicy: manifest.riskPolicy,
    operation: input.operation,
    stage: input.stage,
    completedStages: input.completedStages,
    host,
    target,
    expectedMigrationCount,
    backup,
    backupCoversCurrentState,
    deployedReleases,
    flagBaselineMatched: true,
    curriculumStartingStateFingerprint: startingState.fingerprint,
    editorialBaselineChecked,
    historicalPrincipalsAbsent,
    grant,
  };
}

function readCheckpointFacts(checkpointPath: string): { sizeBytes: number; sha256: string } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(checkpointPath);
  } catch {
    throw new PreprodActivationError(
      "PRODUCT_CHECKPOINT_MISMATCH",
      `the accepted product checkpoint is not present at ${checkpointPath}. Its digest is the provenance anchor the overlay is checked against, so an absent checkpoint is a refusal rather than a warning.`,
    );
  }
  return { sizeBytes: stat.size, sha256: sha256File(checkpointPath) };
}

/**
 * Read a manifest without authorizing anything.
 *
 * Used by the read-only validation command, which answers "does the environment
 * still match what was reviewed" without asking for permission to change it.
 */
export function loadActivationManifest(
  manifestPath: string,
  expectedSha256: string,
): { manifest: PreprodActivationManifest; sha256: string } {
  return parseActivationManifestFile(manifestPath, expectedSha256);
}
