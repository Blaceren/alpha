/**
 * PREPROD ACTIVATION AUTHORIZATION — the argument surface, in one place.
 *
 * WHY THIS IS SHARED. Two importer CLIs need the same authorization, and two
 * copies of a security-relevant argument parser is two chances to omit a check
 * in one of them. Both call `resolveActivationAuthorization`, so both accept
 * exactly the same flags and refuse for exactly the same reasons.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THIS SURFACE:
 *
 *   --force            --allow-live        --unsafe
 *   --skip-protection  --allow-protected   ALLOW_LIVE
 *   DISABLE_GUARD      ALLOW_PROTECTED_DB
 *
 * None of these exist, and no environment variable read anywhere in this package
 * produces a capability. The regression suite greps the shipped sources for each
 * of them, so adding one later fails a test rather than passing review quietly.
 *
 * TWO FLAGS WERE REMOVED AFTER THE INDEPENDENT AUDIT, AND THEY ARE NOT COMING
 * BACK:
 *
 *   --expect-target-sha256   named the digest the target was expected to hold.
 *                            Once the migration stage had moved the lineage it
 *                            was compared only against the file itself, so
 *                            anybody who ran `sha256sum` could bless a database
 *                            nobody had reviewed. Expected state now comes from
 *                            the manifest's rehearsal-derived chain, and nothing
 *                            on a command line participates in it.
 *
 *   --completed-stages       let the caller assert which stages had finished.
 *                            Sequencing is now read from the database: the stage
 *                            a target is in is the state it is in.
 *
 *   --activation-lock        let two concurrent sessions each name a different
 *                            lock file. The lock path is a constant in `lock.ts`.
 *
 * THE MANIFEST DIGEST IS A SEPARATE ARGUMENT ON PURPOSE. `--activation-manifest`
 * says which file; `--expect-activation-manifest-sha256` says which BYTES. A CLI
 * that only took the path would be trusting whatever it happened to read, which
 * is the failure mode the flag exists to prevent — the operator pins one
 * reviewed identity, and an edited file stops the run instead of changing it.
 */
import {
  assertPreprodActivationAuthorization,
  type AuthorizationEvidence,
  type PreprodActivationGrant,
} from "./authorize";
import { readOverlayFacts, readStructuralPackageFacts } from "./artifact-facts";
import { PreprodActivationError } from "./errors";
import { acquireActivationLock, type ActivationLock, type ActivationLockOverride } from "./lock";
import { ACTIVATION_STAGES, type ActivationStage, type AuthorizedOperation } from "./stages";
import type { SanctionedTargetOverride } from "./target";

export const ACTIVATION_FLAGS = {
  manifest: "--activation-manifest",
  manifestSha: "--expect-activation-manifest-sha256",
  stage: "--activation-stage",
} as const;

export type ActivationArgs = {
  manifestPath: string;
  manifestSha256: string;
  stage: ActivationStage;
};

function valueOf(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

/** Is the caller asking for an authorized activation at all? */
export function hasActivationArgs(argv: string[]): boolean {
  return argv.includes(ACTIVATION_FLAGS.manifest);
}

/**
 * Parse the activation flags, refusing a partial set.
 *
 * All three are mandatory once `--activation-manifest` appears. A run that
 * supplies the manifest but omits its digest, or omits the stage, is not a
 * slightly-less-checked activation — it is an unreviewed one, and it stops here.
 */
export function parseActivationArgs(argv: string[]): ActivationArgs {
  const manifestPath = valueOf(argv, ACTIVATION_FLAGS.manifest);
  if (!manifestPath) {
    throw new PreprodActivationError(
      "MANIFEST_UNREADABLE",
      `${ACTIVATION_FLAGS.manifest} <path> is required to request an authorized activation`,
    );
  }
  const manifestSha256 = valueOf(argv, ACTIVATION_FLAGS.manifestSha);
  if (!manifestSha256) {
    throw new PreprodActivationError(
      "MANIFEST_SHA_MISMATCH",
      `${ACTIVATION_FLAGS.manifestSha} <64hex> is required: the manifest does not certify itself, so the reviewed digest must be supplied separately`,
    );
  }
  const stageRaw = valueOf(argv, ACTIVATION_FLAGS.stage);
  if (!stageRaw || !(ACTIVATION_STAGES as readonly string[]).includes(stageRaw)) {
    throw new PreprodActivationError(
      "STAGE_NOT_AUTHORIZED",
      `${ACTIVATION_FLAGS.stage} must be one of: ${ACTIVATION_STAGES.join(", ")}`,
      { expected: ACTIVATION_STAGES.join("|"), actual: stageRaw ?? "(absent)" },
    );
  }

  return { manifestPath, manifestSha256, stage: stageRaw as ActivationStage };
}

export type ResolvedActivation = {
  evidence: AuthorizationEvidence;
  /**
   * The capability, or null when the observed state says this stage has already
   * been applied. A null grant is a successful outcome that authorizes nothing.
   */
  grant: PreprodActivationGrant | null;
  lock: ActivationLock;
};

export type ResolveActivationInput = {
  argv: string[];
  operation: AuthorizedOperation;
  /** The structural package this run will import. Always required. */
  packagePath: string;
  /** The overlay this run will import. Required for the overlay stage. */
  overlayPath?: string;
  /** Test-only; no CLI passes these. See `target.ts` and `lock.ts`. */
  sanctionedTargetOverride?: SanctionedTargetOverride;
  activationLockOverride?: ActivationLockOverride;
  hostIdentityProvider?: Parameters<typeof assertPreprodActivationAuthorization>[0]["hostIdentityProvider"];
  deployedReleasesProvider?: Parameters<typeof assertPreprodActivationAuthorization>[0]["deployedReleasesProvider"];
  flagBaselineProvider?: Parameters<typeof assertPreprodActivationAuthorization>[0]["flagBaselineProvider"];
  environmentVariables?: NodeJS.ProcessEnv;
};

/**
 * Authorize, then take the lock — in that order.
 *
 * Authorizing first means a run that was never going to be permitted does not
 * leave a lock behind for the next operator to puzzle over. The window between
 * the two is closed by the capability's own revalidation, which re-reads the
 * target at the moment of opening, so a second session that acquired the lock in
 * between and changed something is caught there rather than here.
 *
 * The caller MUST release the lock in a `finally`.
 */
export function resolveActivationAuthorization(input: ResolveActivationInput): ResolvedActivation {
  const args = parseActivationArgs(input.argv);

  const structuralPackage = readStructuralPackageFacts(input.packagePath);
  const overlay =
    args.stage === "EDITORIAL_OVERLAY"
      ? readOverlayFacts(
          input.overlayPath ??
            (() => {
              throw new PreprodActivationError(
                "OVERLAY_MISMATCH",
                "the editorial-overlay stage requires an overlay artifact",
              );
            })(),
        )
      : undefined;

  const evidence = assertPreprodActivationAuthorization({
    activationManifestPath: args.manifestPath,
    expectedManifestSha256: args.manifestSha256,
    operation: input.operation,
    stage: args.stage,
    structuralPackage,
    overlay,
    sanctionedTargetOverride: input.sanctionedTargetOverride,
    hostIdentityProvider: input.hostIdentityProvider,
    deployedReleasesProvider: input.deployedReleasesProvider,
    flagBaselineProvider: input.flagBaselineProvider,
    environmentVariables: input.environmentVariables,
  });

  const lock = acquireActivationLock(
    {
      activationId: evidence.activationId,
      manifestSha256: evidence.manifestSha256,
      stage: evidence.stage,
      operation: evidence.operation,
    },
    input.activationLockOverride,
  );

  return { evidence, grant: evidence.grant, lock };
}

/** Evidence rendered for the activation record. Contains no secret. */
export function describeAuthorization(evidence: AuthorizationEvidence): Record<string, unknown> {
  return {
    activationId: evidence.activationId,
    manifestSha256: evidence.manifestSha256,
    environment: evidence.environment,
    deploymentClass: evidence.deploymentClass,
    riskPolicy: evidence.riskPolicy,
    operation: evidence.operation,
    stage: evidence.stage,
    disposition: evidence.disposition,
    observedState: evidence.observedState,
    host: { machineIdSha256: evidence.host.machineIdSha256, hostname: evidence.host.hostname },
    target: {
      canonicalPath: evidence.target.canonicalPath,
      device: evidence.target.device,
      inode: evidence.target.inode,
      sizeBytes: evidence.target.sizeBytes,
      sha256: evidence.target.sha256,
      appliedMigrationCount: evidence.target.appliedMigrationCount,
      expectedMigrationCount: evidence.expectedMigrationCount,
    },
    backup: {
      artifactPath: evidence.backup.artifactPath,
      artifactSha256: evidence.backup.artifactSha256,
      artifactSizeBytes: evidence.backup.artifactSizeBytes,
      mode: evidence.backup.mode,
      integrityCheck: evidence.backup.integrityCheck,
      foreignKeyViolations: evidence.backup.foreignKeyViolations,
      appliedMigrationCount: evidence.backup.appliedMigrationCount,
      logicalDigest: evidence.backup.logicalDigest,
      covers: "ENTRY_SNAPSHOT",
    },
    deployedReleases: evidence.deployedReleases,
    flagBaselineMatched: evidence.flagBaselineMatched,
    contentActivationPlanChecked: evidence.contentActivationPlanChecked,
    editorialBaselineChecked: evidence.editorialBaselineChecked,
    historicalPrincipalsChecked: evidence.historicalPrincipalsChecked,
    historicalPrincipalDispositions: evidence.historicalPrincipalDispositions,
  };
}
