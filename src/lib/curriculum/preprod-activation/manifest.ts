/**
 * PREPROD ACTIVATION AUTHORIZATION — the manifest format.
 *
 * ONE REVIEWED OBJECT, PINNED BY ITS OWN DIGEST. Everything an activation is
 * allowed to assume lives in this file: which machine, which database, which
 * rollback artifact, which source baseline, which package, which overlay, what
 * the environment looked like, and what the database already contained. Nothing
 * is defaulted and nothing is inferred at run time, because a default is a
 * decision nobody reviewed.
 *
 * STRICT EVERYWHERE. `z.strictObject` throughout, so an unknown field is a
 * refusal rather than a silently ignored instruction. A manifest carrying a
 * field this build does not implement is a manifest written against a different
 * contract, and reading it under these rules would mean guessing what the extra
 * field was supposed to do.
 *
 * THE MANIFEST IS NOT SELF-CERTIFYING. Its own digest is supplied SEPARATELY, on
 * the command line, by the operator who reviewed it. A file that hashes itself
 * proves nothing: an attacker or a careless edit changes the bytes and the
 * self-hash together. See `parseActivationManifestFile`, which requires the
 * expected digest as an argument and has no mode that computes-and-trusts.
 *
 * M-3 LIVES HERE. The accepted transport audit recorded that the overlay
 * importer stores `sourceCheckpointSha256`, `sourceBackendCommit` and
 * `sourceBackendTree` without independently verifying them — they are provenance
 * LABELS, not proofs. The manifest carries the operator's externally pinned
 * expectation for each, and `assertOverlayMatchesManifest` compares the artifact
 * against the pin rather than against itself.
 *
 * NO SECRETS. Nothing in this schema holds a credential, a token or a session
 * value, and the preparation command never reads one.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { z } from "zod";

import { PREPROD_RISK_POLICY } from "./backup";
import { PreprodActivationError, requireEqual } from "./errors";
import { ACTIVATION_STAGES } from "./stages";

export const PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION = "ata.preprod-activation-manifest/v1" as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase sha256 hex digest");
const gitObjectId = z.string().regex(/^[0-9a-f]{40}$/, "expected a 40-character git object id");
const isoTimestamp = z.string().datetime({ offset: true });
const absolutePath = z
  .string()
  .min(1)
  .refine((value) => value.startsWith("/"), "expected an absolute path");
const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().positive();

/* ------------------------------------------------------------------ *
 * host and target
 * ------------------------------------------------------------------ */

const hostSchema = z.strictObject({
  machineIdSha256: sha256,
  /** Diagnostic only. Never compared — see `host-identity.ts`. */
  hostname: z.string().trim().min(1).max(255),
});

const targetDatabaseSchema = z.strictObject({
  canonicalPath: absolutePath,
  device: nonNegativeInt,
  inode: nonNegativeInt,
  sizeBytes: positiveInt,
  sha256,
  /** Evidence only. A file's mtime is not authority for anything here. */
  mtimeIso: isoTimestamp,
  appliedMigrationCount: nonNegativeInt,
  /** Row-level digest of the entry state, shared with the rollback artifact. */
  logicalDigest: sha256,
});

const migrationLineageSchema = z.strictObject({
  entryMigrationCount: positiveInt,
  targetMigrationCount: positiveInt,
});

/* ------------------------------------------------------------------ *
 * rollback artifact
 * ------------------------------------------------------------------ */

const backupSchema = z.strictObject({
  artifactPath: absolutePath,
  artifactSizeBytes: positiveInt,
  artifactSha256: sha256,
  createdAt: isoTimestamp,
  sourceDatabaseSha256: sha256,
  sourceDatabaseAppliedMigrationCount: nonNegativeInt,
  logicalDigest: sha256,
  integrityCheck: z.literal("ok"),
  foreignKeyViolations: z.literal(0),
  appliedMigrationCount: nonNegativeInt,
  riskPolicy: z.literal(PREPROD_RISK_POLICY),
});

/* ------------------------------------------------------------------ *
 * reviewed inputs
 * ------------------------------------------------------------------ */

/**
 * Two different commits, deliberately separate fields.
 *
 * `transportBaseline` is the source that CREATED the overlay — the commit whose
 * exporter produced the reviewed bytes, and the value the overlay's own
 * `sourceBackendCommit` must equal. `activationAuthorization` is the source that
 * IMPLEMENTS this mechanism. They are the same today and will diverge the moment
 * this authorization work is itself accepted, at which point conflating them
 * would silently start comparing the overlay against the wrong baseline.
 */
const acceptedBackendSchema = z.strictObject({
  transportBaselineCommit: gitObjectId,
  transportBaselineTree: gitObjectId,
  activationAuthorizationCommit: gitObjectId.nullable(),
  activationAuthorizationTree: gitObjectId.nullable(),
});

const acceptedProductSchema = z.strictObject({
  checkpointPath: absolutePath,
  checkpointSizeBytes: positiveInt,
  checkpointSha256: sha256,
});

const structuralPackageSchema = z.strictObject({
  path: absolutePath,
  fileSha256: sha256,
  packageCode: z.string().trim().min(1).max(120),
  packageRevision: positiveInt,
  /** The FULL canonical fingerprint. Never a prefix. */
  contentFingerprint: sha256,
  curriculumCode: z.string().trim().min(1).max(80),
  curriculumVersionNumber: positiveInt,
});

const editorialOverlaySchema = z.strictObject({
  path: absolutePath,
  fileSha256: sha256,
  schemaVersion: z.literal("ata.editorial-overlay/2"),
  overlayCode: z.string().trim().min(1).max(120),
  overlayRevision: positiveInt,
  /** Canonical overlay fingerprint, recomputed from the artifact at prepare time. */
  fingerprint: sha256,
  acceptedReviewedRootHash: sha256,
  sourceCheckpointSha256: sha256,
  sourceBackendCommit: gitObjectId,
  sourceBackendTree: gitObjectId,
  structuralPackageFingerprint: sha256,
  blueprintSourceDocumentSha256: sha256,
  curriculumCode: z.string().trim().min(1).max(80),
  curriculumVersionNumber: positiveInt,
});

/* ------------------------------------------------------------------ *
 * environment and starting state
 * ------------------------------------------------------------------ */

const deployedReleasesSchema = z.strictObject({
  backend: gitObjectId,
  academy: gitObjectId,
  crm: gitObjectId,
});

const flagStateSchema = z.enum(["absent", "true", "false", "other"]);

const curriculumStartingStateSchema = z.strictObject({
  fingerprint: sha256,
  /** Rendered for review. The fingerprint is what is compared. */
  versions: z.array(z.string().trim().min(1).max(200)),
  publishedIdentity: z.string().trim().min(1).max(200).nullable(),
  levelDefinitionCount: nonNegativeInt,
  moduleDefinitionCount: nonNegativeInt,
  levelResourceBindingCount: nonNegativeInt,
  contentVersionCount: nonNegativeInt,
  assessmentVersionCount: nonNegativeInt,
});

/**
 * What the target must contain immediately BEFORE the overlay runs.
 *
 * Zero SAR rows and zero review notes is the expected truth for a freshly
 * structural-imported curriculum, and it is written down rather than assumed so
 * that a future package which legitimately produces something else has to say so
 * in a reviewed manifest.
 */
const editorialBaselineSchema = z.strictObject({
  sourceAuthorityResolutionCount: nonNegativeInt,
  editorialReviewNoteCount: nonNegativeInt,
  videoProductionVersionCount: nonNegativeInt,
  videoProductionAssessmentLinkCount: nonNegativeInt,
  approvedContentVersionCount: nonNegativeInt,
  approvedAssessmentVersionCount: nonNegativeInt,
});

/* ------------------------------------------------------------------ *
 * plan and policy
 * ------------------------------------------------------------------ */

/**
 * One future content-publication decision, addressed semantically.
 *
 * `stableCode` and `versionNumber`, never an imported row id: ids are assigned
 * by the structural import and are meaningless until it has run, so a plan
 * written in terms of them could not be reviewed before the thing it plans.
 *
 * NOTHING HERE IS AUTHORIZED BY THIS BUILD. Content publication is a separate
 * stage with no operation mapping; the plan is carried so the later session has
 * a reviewed target to check itself against, not so that anything can act on it.
 */
const contentActivationRowSchema = z.strictObject({
  levelStableCode: z.string().trim().min(1).max(120),
  levelNumber: positiveInt,
  acceptedContentVersionNumber: positiveInt,
  action: z.enum(["PUBLISH_IN_PLACE", "PUBLISH_AND_MOVE_BINDING"]),
  expectedPreBindingIdentity: z.string().trim().min(1).max(200).nullable(),
  expectedPostBindingIdentity: z.string().trim().min(1).max(200),
});

const contentActivationPlanSchema = z.strictObject({
  rows: z.array(contentActivationRowSchema),
  publishInPlaceCount: nonNegativeInt,
  publishAndMoveBindingCount: nonNegativeInt,
});

const carriedMitigationSchema = z.strictObject({
  id: z.enum(["M-1", "M-2", "M-3"]),
  severity: z.literal("MEDIUM"),
  summary: z.string().trim().min(1).max(400),
  activationMitigation: z.string().trim().min(1).max(600),
});

/* ------------------------------------------------------------------ *
 * the manifest
 * ------------------------------------------------------------------ */

export const preprodActivationManifestSchema = z.strictObject({
  schemaVersion: z.literal(PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION),
  activationId: z.string().trim().min(8).max(120),
  createdAt: isoTimestamp,

  /**
   * A literal, not an enum.
   *
   * An enum would be a place for `"prod"` to appear later without anyone
   * designing production authorization. v1 authorizes exactly one deployment
   * class, and a manifest that says anything else fails to parse.
   */
  environment: z.literal("preprod"),
  riskPolicy: z.literal(PREPROD_RISK_POLICY),

  host: hostSchema,
  targetDatabase: targetDatabaseSchema,
  migrationLineage: migrationLineageSchema,
  backup: backupSchema,

  acceptedBackend: acceptedBackendSchema,
  acceptedProduct: acceptedProductSchema,
  structuralPackage: structuralPackageSchema,
  editorialOverlay: editorialOverlaySchema,

  deployedReleases: deployedReleasesSchema,
  flagBaseline: z.record(z.string(), flagStateSchema),
  curriculumStartingState: curriculumStartingStateSchema,
  preOverlayEditorialBaseline: editorialBaselineSchema,
  historicalPrincipalRefs: z.array(z.string().trim().min(3).max(320)),

  contentActivationPlan: contentActivationPlanSchema,

  /** No assessment binding is authorized by this manifest. A literal, not a flag. */
  assessmentRuntimePolicy: z.literal("DEFER"),
  /** Scripts and direction are approved; nothing is recorded and QA has not run. */
  videoRuntimePolicy: z.literal("ASSET_QA_DEFERRED"),

  stagePlan: z.strictObject({
    stages: z.array(z.enum(ACTIVATION_STAGES)).min(1),
  }),

  carriedTransportMitigations: z.array(carriedMitigationSchema),
});

export type PreprodActivationManifest = z.infer<typeof preprodActivationManifestSchema>;

export type ManifestParseResult = {
  manifest: PreprodActivationManifest;
  /** Digest of the exact bytes on disk. */
  sha256: string;
};

/** sha256 over the raw file bytes — not over a re-serialisation of the parse. */
export function hashManifestBytes(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read, pin, then parse — in that order.
 *
 * The digest is compared BEFORE the JSON is interpreted, so a manifest whose
 * bytes are not the reviewed bytes never reaches the schema at all. That
 * ordering also means a malformed-but-expected file reports a schema error while
 * a well-formed-but-substituted one reports a digest error, which is the more
 * useful of the two messages in each case.
 */
export function parseActivationManifestFile(
  manifestPath: string,
  expectedSha256: string,
): ManifestParseResult {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new PreprodActivationError(
      "MANIFEST_SHA_MISMATCH",
      "an expected activation-manifest sha256 must be supplied as 64 lowercase hex characters. The manifest does not certify itself.",
      { expected: "64 hex characters", actual: expectedSha256 },
    );
  }

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(manifestPath);
  } catch {
    throw new PreprodActivationError(
      "MANIFEST_UNREADABLE",
      `cannot read the activation manifest at ${manifestPath}`,
    );
  }

  const actualSha256 = hashManifestBytes(bytes);
  requireEqual("MANIFEST_SHA_MISMATCH", "activation manifest sha256", expectedSha256, actualSha256);

  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new PreprodActivationError(
      "MANIFEST_MALFORMED",
      `the activation manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "schemaVersion" in raw &&
    (raw as { schemaVersion: unknown }).schemaVersion !== PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION
  ) {
    throw new PreprodActivationError(
      "MANIFEST_SCHEMA_UNSUPPORTED",
      `unsupported activation manifest schema ${String((raw as { schemaVersion: unknown }).schemaVersion)}; this build implements ${PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION}`,
      {
        expected: PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION,
        actual: String((raw as { schemaVersion: unknown }).schemaVersion),
      },
    );
  }

  const parsed = preprodActivationManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PreprodActivationError(
      "MANIFEST_MALFORMED",
      `the activation manifest does not satisfy ${PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION}: ${first.path.join(".") || "(root)"} — ${first.message}`,
      { expected: PREPROD_ACTIVATION_MANIFEST_SCHEMA_VERSION, actual: first.code },
    );
  }

  return { manifest: parsed.data, sha256: actualSha256 };
}

/* ------------------------------------------------------------------ *
 * artifact comparison
 * ------------------------------------------------------------------ */

export type StructuralPackageFacts = {
  fileSha256: string;
  packageCode: string;
  packageRevision: number;
  contentFingerprint: string;
  curriculumCode: string;
  curriculumVersionNumber: number;
};

export function assertStructuralPackageMatchesManifest(
  manifest: PreprodActivationManifest,
  actual: StructuralPackageFacts,
): void {
  const expected = manifest.structuralPackage;
  requireEqual("PACKAGE_MISMATCH", "structural package file sha256", expected.fileSha256, actual.fileSha256);
  requireEqual("PACKAGE_MISMATCH", "structural package code", expected.packageCode, actual.packageCode);
  requireEqual("PACKAGE_MISMATCH", "structural package revision", expected.packageRevision, actual.packageRevision);
  requireEqual(
    "PACKAGE_MISMATCH",
    "structural package content fingerprint",
    expected.contentFingerprint,
    actual.contentFingerprint,
  );
  requireEqual("PACKAGE_MISMATCH", "structural package curriculum code", expected.curriculumCode, actual.curriculumCode);
  requireEqual(
    "PACKAGE_MISMATCH",
    "structural package curriculum version",
    expected.curriculumVersionNumber,
    actual.curriculumVersionNumber,
  );
}

export type OverlayFacts = {
  fileSha256: string;
  schemaVersion: string;
  overlayCode: string;
  overlayRevision: number;
  fingerprint: string;
  acceptedReviewedRootHash: string;
  sourceCheckpointSha256: string;
  sourceBackendCommit: string;
  sourceBackendTree: string;
  structuralPackageFingerprint: string;
  blueprintSourceDocumentSha256: string;
  curriculumCode: string;
  curriculumVersionNumber: number;
};

/**
 * THE M-3 MITIGATION, IN ONE FUNCTION.
 *
 * Every field below is something the overlay says about itself and that the
 * overlay importer records without checking. Here each one is compared against
 * an expectation the operator pinned in a separately-digested manifest, and two
 * of them are additionally cross-checked against OTHER pins in the same manifest
 * — the overlay's declared source checkpoint against the accepted product
 * checkpoint, and its declared structural-package fingerprint against the
 * package this activation will actually import. An artifact that agrees with
 * itself but disagrees with the reviewed activation is refused.
 */
export function assertOverlayMatchesManifest(
  manifest: PreprodActivationManifest,
  actual: OverlayFacts,
): void {
  const expected = manifest.editorialOverlay;

  requireEqual("OVERLAY_MISMATCH", "overlay schema version", expected.schemaVersion, actual.schemaVersion);
  requireEqual("OVERLAY_MISMATCH", "overlay file sha256", expected.fileSha256, actual.fileSha256);
  requireEqual("OVERLAY_MISMATCH", "overlay code", expected.overlayCode, actual.overlayCode);
  requireEqual("OVERLAY_MISMATCH", "overlay revision", expected.overlayRevision, actual.overlayRevision);
  requireEqual("OVERLAY_MISMATCH", "overlay canonical fingerprint", expected.fingerprint, actual.fingerprint);
  requireEqual(
    "OVERLAY_MISMATCH",
    "overlay acceptedReviewedRootHash",
    expected.acceptedReviewedRootHash,
    actual.acceptedReviewedRootHash,
  );
  requireEqual("OVERLAY_MISMATCH", "overlay curriculum code", expected.curriculumCode, actual.curriculumCode);
  requireEqual(
    "OVERLAY_MISMATCH",
    "overlay curriculum version",
    expected.curriculumVersionNumber,
    actual.curriculumVersionNumber,
  );

  // ---- provenance labels: pinned externally, never taken on the artifact's word
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay sourceCheckpointSha256",
    expected.sourceCheckpointSha256,
    actual.sourceCheckpointSha256,
  );
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay sourceBackendCommit",
    expected.sourceBackendCommit,
    actual.sourceBackendCommit,
  );
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay sourceBackendTree",
    expected.sourceBackendTree,
    actual.sourceBackendTree,
  );
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay structuralPackageFingerprint",
    expected.structuralPackageFingerprint,
    actual.structuralPackageFingerprint,
  );
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay blueprintSourceDocumentSha256",
    expected.blueprintSourceDocumentSha256,
    actual.blueprintSourceDocumentSha256,
  );

  // ---- and the cross-checks: the overlay must agree with the REST of the
  // reviewed activation, not merely with its own manifest entry.
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay source checkpoint against the accepted product checkpoint",
    manifest.acceptedProduct.checkpointSha256,
    actual.sourceCheckpointSha256,
  );
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay structural-package fingerprint against the package this activation imports",
    manifest.structuralPackage.contentFingerprint,
    actual.structuralPackageFingerprint,
  );
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay source Backend commit against the accepted transport baseline",
    manifest.acceptedBackend.transportBaselineCommit,
    actual.sourceBackendCommit,
  );
  requireEqual(
    "OVERLAY_PROVENANCE_MISMATCH",
    "overlay source Backend tree against the accepted transport baseline",
    manifest.acceptedBackend.transportBaselineTree,
    actual.sourceBackendTree,
  );
}

/** Verify the accepted product checkpoint is present and unchanged. */
export function assertAcceptedProductCheckpoint(
  manifest: PreprodActivationManifest,
  actual: { sizeBytes: number; sha256: string },
): void {
  requireEqual(
    "PRODUCT_CHECKPOINT_MISMATCH",
    "accepted product checkpoint size",
    manifest.acceptedProduct.checkpointSizeBytes,
    actual.sizeBytes,
  );
  requireEqual(
    "PRODUCT_CHECKPOINT_MISMATCH",
    "accepted product checkpoint sha256",
    manifest.acceptedProduct.checkpointSha256,
    actual.sha256,
  );
}
