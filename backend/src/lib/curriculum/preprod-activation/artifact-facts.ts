/**
 * PREPROD ACTIVATION AUTHORIZATION — reading the two artifacts' own claims.
 *
 * These helpers exist so that the manifest's pins are compared against values
 * that were RECOMPUTED from the artifact, not against values copied out of the
 * artifact's own header. The distinction matters most for the overlay: its
 * `fingerprint` is a canonical digest over its contents, so recomputing it
 * catches an artifact whose body was edited after the fingerprint was written.
 *
 * The provenance fields — `sourceCheckpointSha256`, `sourceBackendCommit`,
 * `sourceBackendTree` — cannot be recomputed from anything the artifact carries.
 * They are labels, which is precisely the accepted M-3 finding. What this module
 * does is surface them faithfully; what makes them trustworthy is that
 * `assertOverlayMatchesManifest` compares them against externally pinned values
 * in a separately-digested manifest, and cross-checks them against the rest of
 * the reviewed activation.
 */
import fs from "node:fs";

import { PreprodActivationError } from "./errors";
import { sha256File } from "./sqlite-probe";
import type { OverlayFacts, StructuralPackageFacts } from "./manifest";

import { calculateFingerprint } from "@/lib/curriculum/package/fingerprint";
import { curriculumPackageSchema } from "@/lib/curriculum/package/schema";
import { calculateOverlayFingerprint } from "@/lib/curriculum/editorial-overlay/fingerprint";
import { validateEditorialOverlay } from "@/lib/curriculum/editorial-overlay/validate";

function readJson(filePath: string, code: "PACKAGE_MISMATCH" | "OVERLAY_MISMATCH"): unknown {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new PreprodActivationError(code, `cannot read the artifact at ${filePath}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PreprodActivationError(
      code,
      `the artifact at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Facts about a structural curriculum package.
 *
 * The fingerprint is RECOMPUTED, then compared against the declared one before
 * anything else looks at it. A package whose declared fingerprint disagrees with
 * its contents is refused here rather than being carried forward as two
 * different answers to the same question.
 */
export function readStructuralPackageFacts(packagePath: string): StructuralPackageFacts {
  const raw = readJson(packagePath, "PACKAGE_MISMATCH") as Record<string, unknown>;
  const declared = typeof raw.contentFingerprint === "string" ? raw.contentFingerprint : "";

  // Parse with a placeholder fingerprint so a schema error surfaces before the
  // hash does; the canonical projection excludes the field anyway.
  const parsed = curriculumPackageSchema.safeParse({ ...raw, contentFingerprint: "0".repeat(64) });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PreprodActivationError(
      "PACKAGE_MISMATCH",
      `the structural package at ${packagePath} does not satisfy the package schema: ${first.path.join(".") || "(root)"} — ${first.message}`,
    );
  }
  const recomputed = calculateFingerprint(parsed.data);
  if (declared !== recomputed) {
    throw new PreprodActivationError(
      "PACKAGE_MISMATCH",
      `the structural package's declared contentFingerprint does not match its contents (${packagePath})`,
      { expected: recomputed, actual: declared || "(absent)" },
    );
  }

  return {
    fileSha256: sha256File(packagePath),
    packageCode: parsed.data.packageCode,
    packageRevision: parsed.data.packageRevision,
    contentFingerprint: recomputed,
    curriculumCode: parsed.data.curriculumCode,
    curriculumVersionNumber: parsed.data.curriculumVersionNumber,
  };
}

/**
 * Facts about an editorial overlay.
 *
 * Validation runs first: an overlay that does not satisfy v2 has no facts worth
 * comparing, and the validator is also what refuses a superseded v1 artifact by
 * name rather than reinterpreting it.
 */
export function readOverlayFacts(overlayPath: string): OverlayFacts {
  const raw = readJson(overlayPath, "OVERLAY_MISMATCH");
  const result = validateEditorialOverlay(raw);
  if (!result.ok) {
    const first = result.issues[0];
    throw new PreprodActivationError(
      "OVERLAY_MISMATCH",
      `the editorial overlay at ${overlayPath} is not a valid v2 artifact: ${first.code} at ${first.path} — ${first.message}`,
    );
  }
  const overlay = result.overlay;
  const recomputed = calculateOverlayFingerprint(overlay);
  if (recomputed !== result.fingerprint) {
    throw new PreprodActivationError(
      "OVERLAY_MISMATCH",
      `the editorial overlay's canonical fingerprint is not stable across recomputation (${overlayPath})`,
      { expected: result.fingerprint, actual: recomputed },
    );
  }

  return {
    fileSha256: sha256File(overlayPath),
    schemaVersion: overlay.schemaVersion,
    overlayCode: overlay.overlayCode,
    overlayRevision: overlay.overlayRevision,
    fingerprint: recomputed,
    acceptedReviewedRootHash: overlay.binding.acceptedReviewedRootHash,
    sourceCheckpointSha256: overlay.binding.sourceCheckpointSha256,
    sourceBackendCommit: overlay.binding.sourceBackendCommit,
    sourceBackendTree: overlay.binding.sourceBackendTree,
    structuralPackageFingerprint: overlay.binding.structuralPackageFingerprint,
    blueprintSourceDocumentSha256: overlay.binding.blueprintSourceDocumentSha256,
    curriculumCode: overlay.binding.curriculumCode,
    curriculumVersionNumber: overlay.binding.curriculumVersionNumber,
    /*
     * CORRECTION-5. The declared historical principals, not merely their
     * addresses.
     *
     * Authorization has to decide whether an EXISTING account at a declared
     * address is the same principal or a different one, and that question is
     * answered by `role`, `staffRole` and `kind` — which the manifest's
     * `historicalPrincipalRefs` does not carry. They are read from the overlay
     * rather than added to the manifest because the overlay is already pinned by
     * `editorialOverlay.fileSha256`, which `assertOverlayMatchesManifest` checks
     * before any of this is consulted. No new trust, and no new manifest field.
     */
    principals: overlay.principals.map((principal) => ({
      ref: principal.ref,
      displayName: principal.displayName,
      kind: principal.kind,
      role: principal.role,
      staffRole: principal.staffRole,
      provisionIfMissing: principal.provisionIfMissing,
    })),
  };
}
