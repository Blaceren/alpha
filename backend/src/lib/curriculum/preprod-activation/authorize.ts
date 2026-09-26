/**
 * PREPROD ACTIVATION AUTHORIZATION — the one entry point.
 *
 * WHAT THIS IS FOR. The accepted importers refuse to write a protected runtime
 * database, and that refusal is correct: for Foundation work there was no reason
 * one should ever be permitted. A real PREPROD activation needs a way to mutate
 * exactly one database, on exactly one machine, with exactly one reviewed
 * package and overlay, at exactly one stage — and no way to do anything else.
 *
 * WHAT IT IS NOT. It is not a force flag. There is no `--force`, no
 * `--allow-live`, no `ALLOW_PROTECTED_DB`, no `DISABLE_GUARD`, and no
 * environment variable that shortens this path. The only way past the guard is a
 * capability, and the only way to obtain one is for every precondition below to
 * hold simultaneously.
 *
 * WHAT THE INDEPENDENT AUDIT CHANGED. Two things were load-bearing and are gone.
 *
 *   THE GRANT WAS A SHAPE. The guard authenticated it from public fields and
 *   then called a validator the caller had supplied. An eight-line object
 *   literal carried full authority. Authority now lives in a module-private
 *   registry in `grant.ts`; the handle returned here is a label, and the claims
 *   that decide anything — including the revalidation closure — are held where
 *   no caller can reach them.
 *
 *   THE STAGE STATE WAS A CALLER'S ASSERTION. `--expect-target-sha256` was
 *   compared against the file itself once the lineage had moved, so anybody who
 *   ran `sha256sum` could bless a tampered database. There is no such argument
 *   any more. The manifest carries a rehearsal-derived fingerprint for every
 *   state in the chain, and the live target is matched against those.
 *
 * THREAT MODEL, STATED PLAINLY. This defends against operator error: the wrong
 * database, the wrong host, the wrong package, a stale backup, a stage run out
 * of order, an environment that drifted since review, and a database somebody
 * else changed in between. It does NOT defend against a hostile operator with
 * root, who can already open the SQLite file directly.
 *
 * ORDER OF CHECKS. Cheapest and most diagnostic first — manifest identity, then
 * host, then the database's physical identity, then the artifacts, then the
 * environment, then the semantic state. A refusal should name the coarsest thing
 * that is wrong, because "your manifest is for another machine" is a more useful
 * message than a digest mismatch six checks later.
 */
import fs from "node:fs";

import {
  assertBackupCoversEntryState,
  verifyBackupArtifact,
  type BackupVerification,
} from "./backup";
import {
  assertEditorialBaselineMatches,
  assertHistoricalPrincipalsAuthorized,
  classifyHistoricalPrincipals,
  type HistoricalPrincipalDisposition,
  assertTargetCurriculumAbsent,
  captureCurriculumStartingState,
  captureEditorialBaseline,
} from "./baseline";
import {
  assertContentActivationPlanMatches,
  deriveContentActivationPlan,
} from "./content-plan";
import { PreprodActivationError } from "./errors";
import { runWithGrantIssuer, type PreprodActivationGrant } from "./grant";
import {
  assertHostMatches,
  readHostIdentity,
  type HostIdentity,
  type HostIdentityProvider,
} from "./host-identity";
import {
  assertAcceptedProductCheckpoint,
  assertOverlayMatchesManifest,
  assertOverlayPrincipalsAreReviewed,
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
import { sha256File } from "./sqlite-probe";
import {
  captureStageFingerprint,
  diffStageFingerprint,
  type BusinessContinuityFilter,
} from "./semantic-state";
import {
  assertOperationMatchesStage,
  classifyTargetState,
  decideStageDisposition,
  expectedMigrationCountAtState,
  stageTransition,
  type ActivationStage,
  type ActivationStateChain,
  type AuthorizedOperation,
  type StageDisposition,
} from "./stages";
import {
  assertManifestNamesSanctionedTarget,
  assertTargetPhysicalIdentity,
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
 * at all — can never satisfy a manifest, whatever the manifest says about
 * itself. It is defence in depth rather than the primary control: the sanctioned
 * target constant and the machine-id pin are what actually keep this off a
 * production box.
 */
export const REQUIRED_DEPLOYMENT_CLASS = "staging" as const;

export type { PreprodActivationGrant } from "./grant";

export type AuthorizationEvidence = {
  activationId: string;
  manifestPath: string;
  manifestSha256: string;
  environment: "preprod";
  deploymentClass: string;
  riskPolicy: string;
  operation: AuthorizedOperation;
  stage: ActivationStage;
  /** What the observed state says should happen. `ALREADY_COMPLETE` runs nothing. */
  disposition: StageDisposition;
  /** Which reviewed state the target was actually in. Measured, never asserted. */
  observedState: string;
  host: HostIdentity;
  target: TargetIdentity;
  expectedMigrationCount: number;
  backup: BackupVerification;
  deployedReleases: { backend: string; academy: string; crm: string };
  flagBaselineMatched: boolean;
  contentActivationPlanChecked: boolean;
  editorialBaselineChecked: boolean;
  /** True once the overlay stage has classified every declared principal. */
  historicalPrincipalsChecked: boolean;
  /** What was decided for each, so an operator can see reuse rather than infer it. */
  historicalPrincipalDispositions: ReadonlyArray<{
    ref: string;
    disposition: HistoricalPrincipalDisposition;
    matchedUserId: number | null;
  }>;
  /** Absent when the disposition is ALREADY_COMPLETE: nothing is authorized. */
  grant: PreprodActivationGrant | null;
};

export type AuthorizationInput = {
  /** Path to the reviewed manifest. */
  activationManifestPath: string;
  /** Its digest, supplied separately by the operator. Never computed-and-trusted. */
  expectedManifestSha256: string;
  operation: AuthorizedOperation;
  stage: ActivationStage;

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
 * Returns evidence, and — when the stage actually has work to do — a capability.
 * The caller writes the evidence into the activation record and hands the
 * capability to the protected-database guard.
 */
export function assertPreprodActivationAuthorization(
  input: AuthorizationInput,
): AuthorizationEvidence {
  // ---- 1. the manifest, pinned by a digest supplied from outside it.
  const { manifest, sha256: manifestSha256 } = parseActivationManifestFile(
    input.activationManifestPath,
    input.expectedManifestSha256,
  );

  // ---- 2. is this operation even the one this stage performs?
  assertOperationMatchesStage(input.stage, input.operation);
  const transition = stageTransition(input.stage);

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

  // Physical identity — path, device, inode — is still pinned. The file's DIGEST
  // is deliberately not compared here: after a sanctioned stage the bytes have
  // legitimately moved, and what must be proved is that they moved to the state
  // the rehearsal produced. That is step 8.
  assertTargetPhysicalIdentity(
    {
      canonicalPath: sanctionedPath,
      device: manifest.targetDatabase.device,
      inode: manifest.targetDatabase.inode,
    },
    target,
  );

  // ---- 6. the rollback artifact.
  //
  // Verified from its own bytes at EVERY stage, not only the first: an artifact
  // deleted, replaced or corrupted after the migration would leave the remaining
  // stages with no way back, so its continued existence is a precondition for
  // each of them.
  const backup = verifyBackupArtifact(manifest.backup);

  // The backup covers the ENTRY snapshot, and that is all it ever claimed to
  // cover. Comparing it against the CURRENT file would be wrong after a
  // sanctioned stage has run — the audit's own note — so what is checked is that
  // it still matches the entry state the manifest pins.
  assertBackupCoversEntryState(manifest.backup, {
    entrySha256: manifest.targetDatabase.sha256,
    entryMigrationCount: manifest.migrationLineage.entryMigrationCount,
    entryLogicalDigest: manifest.targetDatabase.logicalDigest,
  });

  // ---- 7. the reviewed inputs.
  assertAcceptedProductCheckpoint(manifest, readCheckpointFacts(manifest.acceptedProduct.checkpointPath));
  assertStructuralPackageMatchesManifest(manifest, input.structuralPackage);
  // Narrowed once, here, where its presence is proved — step 10 needs the
  // overlay's principal declarations and cannot re-derive that proof.
  let overlayFacts: OverlayFacts | null = null;
  if (input.stage === "EDITORIAL_OVERLAY") {
    if (!input.overlay) {
      throw new PreprodActivationError(
        "OVERLAY_MISMATCH",
        "the editorial-overlay stage requires the overlay artifact's facts so they can be compared against the reviewed pins",
      );
    }
    assertOverlayMatchesManifest(manifest, input.overlay);
    overlayFacts = input.overlay;
  }

  // ---- 8. the environment around the database.
  const deployedReleases = (input.deployedReleasesProvider ?? (() => readDeployedReleases()))();
  assertReleasesMatch(manifest.deployedReleases, deployedReleases);

  const flagBaseline = (input.flagBaselineProvider ?? (() => readFlagBaseline()))();
  assertFlagBaselineMatches(manifest.flagBaseline, flagBaseline);

  // ---- 9. WHERE IN THE REVIEWED CHAIN IS THIS DATABASE.
  //
  // This is what replaces `--expect-target-sha256`. The four states were
  // measured — one from the live database at preparation time, three by
  // rehearsing the sanctioned stages on a copy of the rollback backup — and they
  // are pinned by the manifest's own digest. The target is measured now and
  // matched against them. There is no argument that participates in this.
  const filter: BusinessContinuityFilter = {
    principalEmails: manifest.historicalPrincipalRefs,
    entryMaxAuditLogId: manifest.entryMaxAuditLogId,
  };
  const observed = captureStageFingerprint(target.canonicalPath, filter);
  const chain = manifest.stateChain as ActivationStateChain;

  const expectedMigrationCount = expectedMigrationCountAtState(transition.from, manifest.migrationLineage);
  const observedState = classifyTargetState(observed, chain);
  const observedStateName = observedState.kind === "AT" ? observedState.state : "UNKNOWN";

  // ---- 10. named checks, run BEFORE the generic state comparison.
  //
  // Everything these look for is already implied by the fingerprint: a database
  // in the exact post-structural state cannot be carrying an unexpected
  // authority row. But "editorial evidence differs" is a poor thing to hand an
  // operator when the truth is "somebody added a SourceAuthorityResolution row",
  // and M-1 and M-2 are carried mitigations that should fail BY NAME. So when
  // the target is at — or nearest to — the state the overlay is entered from,
  // these run first and produce the specific refusal.
  //
  // Gated on proximity to POST_STRUCTURAL because the editorial tables do not
  // exist at the entry lineage, and a stage-ordering refusal is the right answer
  // there rather than an unreadable-table error.
  let editorialBaselineChecked = false;
  let historicalPrincipalsChecked = false;
  let historicalPrincipalDispositions: AuthorizationEvidence["historicalPrincipalDispositions"] = [];
  let contentActivationPlanChecked = false;

  const nearPostStructural =
    (observedState.kind === "AT" && observedState.state === "POST_STRUCTURAL") ||
    (observedState.kind === "UNKNOWN" && observedState.nearest === "POST_STRUCTURAL");

  if (input.stage === "EDITORIAL_OVERLAY" && nearPostStructural) {
    const editorial = captureEditorialBaseline(target.canonicalPath, {
      code: manifest.structuralPackage.curriculumCode,
      versionNumber: manifest.structuralPackage.curriculumVersionNumber,
    });
    assertEditorialBaselineMatches(
      { curriculumVersionId: editorial.curriculumVersionId, ...manifest.preOverlayEditorialBaseline },
      editorial,
    );
    editorialBaselineChecked = true;

    /*
     * CORRECTION-5. The overlay may only speak for the principal set the
     * manifest reviewed.
     *
     * The declarations used below come from the overlay file. Its bytes are
     * already pinned (`assertOverlayMatchesManifest`, step 7), but pinning the
     * bytes does not by itself say the reviewed principal SET is the one being
     * asked for — so the refs are compared against the manifest's own list
     * before any of them is classified. A swapped-but-validly-signed overlay
     * cannot smuggle a principal past the review this way.
     */
    assertOverlayPrincipalsAreReviewed(manifest.historicalPrincipalRefs, overlayFacts!.principals);

    const principals = classifyHistoricalPrincipals(target.canonicalPath, overlayFacts!.principals);
    assertHistoricalPrincipalsAuthorized(principals);
    historicalPrincipalDispositions = principals.map((entry) => ({
      ref: entry.ref,
      disposition: entry.disposition,
      matchedUserId: entry.matchedUserId,
    }));
    historicalPrincipalsChecked = true;
  }

  // ---- 11. and then the state chain itself, which is the authority.
  const disposition = decideStageDisposition(input.stage, observed, chain);

  if (input.stage === "STRUCTURAL_IMPORT" && disposition === "EXECUTE") {
    const startingState = captureCurriculumStartingState(target.canonicalPath);
    assertTargetCurriculumAbsent(startingState, {
      code: manifest.structuralPackage.curriculumCode,
      versionNumber: manifest.structuralPackage.curriculumVersionNumber,
    });
  }

  // ---- 11. the publication sequence, recomputed rather than trusted.
  //
  // Only meaningful once the overlay has been applied, because before that the
  // reviewed content versions do not exist to compare against. At that point the
  // manifest's plan must describe exactly what is in the database.
  if (observedStateName === "POST_OVERLAY") {
    const derived = deriveContentActivationPlan(target.canonicalPath, {
      code: manifest.structuralPackage.curriculumCode,
      versionNumber: manifest.structuralPackage.curriculumVersionNumber,
    });
    assertContentActivationPlanMatches(manifest.contentActivationPlan.rows, derived.rows);
    contentActivationPlanChecked = true;
  }

  const evidenceBase = {
    activationId: manifest.activationId,
    manifestPath: input.activationManifestPath,
    manifestSha256,
    environment: manifest.environment,
    deploymentClass: classification.environment,
    riskPolicy: manifest.riskPolicy,
    operation: input.operation,
    stage: input.stage,
    disposition,
    observedState: observedStateName,
    host,
    target,
    expectedMigrationCount,
    backup,
    deployedReleases,
    flagBaselineMatched: true,
    contentActivationPlanChecked,
    editorialBaselineChecked,
    historicalPrincipalsChecked,
    historicalPrincipalDispositions,
  };

  // ---- 12. an already-completed stage gets evidence and NO capability.
  //
  // This is the resume answer. The target is in the exact state this stage
  // produces, so the mutation has run; issuing a capability would let it run
  // again over its own output. The caller records the stage as done.
  if (disposition === "ALREADY_COMPLETE") {
    return { ...evidenceBase, grant: null };
  }

  // ---- 13. the capability.
  //
  // Minted inside `runWithGrantIssuer`, which is the only path into the private
  // registry and is revoked the moment this call returns. The revalidation
  // closure below belongs to this module: it re-reads the live target at the
  // guard's last possible moment and refuses anything that moved since. A caller
  // cannot supply it, replace it or observe it.
  const grant = runWithGrantIssuer((issue) =>
    issue({
      activationId: manifest.activationId,
      manifestSha256,
      operation: input.operation,
      stage: input.stage,
      targetPath: target.canonicalPath,
      targetDevice: target.device,
      targetInode: target.inode,
      revalidate: () => {
        const now = captureTargetIdentity(sanctionedPath);
        assertTargetPhysicalIdentity(
          { canonicalPath: target.canonicalPath, device: target.device, inode: target.inode },
          now,
        );
        const nowState = captureStageFingerprint(now.canonicalPath, filter);
        const drift = diffStageFingerprint(chain[stateKeyOf(transition.from)], nowState);
        if (drift.length > 0) {
          throw new PreprodActivationError(
            "STAGE_STATE_UNKNOWN",
            `the activation target changed between authorization and the moment it was opened (${drift.join("; ")}). Refusing to write to a database that is no longer the one that was authorized.`,
            { expected: transition.from, actual: "changed since authorization" },
          );
        }
      },
    }),
  );

  return { ...evidenceBase, grant };
}

function stateKeyOf(state: "ENTRY" | "POST_MIGRATION" | "POST_STRUCTURAL" | "POST_OVERLAY"): keyof ActivationStateChain {
  switch (state) {
    case "ENTRY":
      return "entry";
    case "POST_MIGRATION":
      return "postMigration";
    case "POST_STRUCTURAL":
      return "postStructural";
    default:
      return "postOverlay";
  }
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

/** Where the target sits in the reviewed chain, without asking for permission. */
export function describeTargetState(
  manifest: PreprodActivationManifest,
  absolutePath: string,
): { state: string; drift: string[] } {
  const observed = captureStageFingerprint(absolutePath, {
    principalEmails: manifest.historicalPrincipalRefs,
    entryMaxAuditLogId: manifest.entryMaxAuditLogId,
  });
  const classification = classifyTargetState(observed, manifest.stateChain as ActivationStateChain);
  return classification.kind === "AT"
    ? { state: classification.state, drift: [] }
    : { state: `UNKNOWN (nearest ${classification.nearest})`, drift: classification.drift };
}
