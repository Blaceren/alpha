/**
 * PHASE-G0 CORRECTION — video production evidence, bound to the REAL bank.
 *
 * THE DEFECT. G0 stored an `assessmentFingerprint` on VideoProductionVersion,
 * but it was computed from the video contract's own embedded questions. Both
 * sides of every comparison came from the same JSON document, so editing the
 * question bank a learner is actually graded against could not make video
 * evidence stale. The independent audit changed a real correct answer and
 * watched `productionEvidenceStale` stay false.
 *
 * THE ARCHITECTURE, AND WHY THIS ONE. Two designs were available:
 *
 *   (a) recompute and WRITE a staleness flag onto the video row during every
 *       assessment mutation, or
 *   (b) DERIVE staleness on read from the linked bank's current state.
 *
 * This module implements (b). Design (a) would have made every question edit
 * take a write lock on an unrelated aggregate, coupling two editorial domains
 * inside one transaction so that a failure in the video row could roll back a
 * legitimate assessment edit — and it would have created a second copy of a
 * fact that is already derivable, which is exactly the duplicated state that
 * goes stale in its own right. Under (b) there is ONE authority for "what the
 * bank says": the bank. The stored fingerprint is evidence of what was
 * reviewed, never a cache of what is true now.
 *
 * NO SECOND HASH ANYWHERE. `calculateAssessmentFingerprint` — the accepted
 * Phase-C function — is applied to `projectAssessmentBank`. This module reads
 * and compares; it does not hash.
 *
 * FAIL CLOSED. A level whose canonical bank is ambiguous gets NO link rather
 * than a guessed one, and an unlinked contract reports its coherence as
 * `unlinked` rather than as `fresh`. Absence of evidence is never reported as
 * evidence of freshness.
 */
import { Prisma } from "@prisma/client";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { calculateBankFingerprint } from "@/lib/curriculum/authoring-assessment-projection";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;

/**
 * Which AssessmentVersion is a level's canonical bank?
 *
 * THE BINDING WINS. `LevelResourceBinding` is what the runtime actually serves,
 * so it is the level's current truth and the only non-guessing answer when a
 * level carries several banks. This is also what keeps L2 honest: its existing
 * bound bank stays the durable identity, and the Blueprint's PROPOSED_CANON
 * questions remain a proposal inside `contractPayload` rather than being
 * promoted to truth by a link.
 *
 * With no binding, exactly one bank is unambiguous and is accepted. Two or more
 * unbound banks are AMBIGUOUS and raise — the correction requires a fail-closed
 * answer, not a most-recent-wins heuristic.
 */
export async function resolveCanonicalAssessmentVersion(
  tx: DbClient,
  levelDefinitionId: number,
): Promise<number> {
  const binding = await tx.levelResourceBinding.findUnique({
    where: { levelDefinitionId },
    select: { assessmentVersionId: true },
  });
  if (binding?.assessmentVersionId) return binding.assessmentVersionId;

  const candidates = await tx.assessmentVersion.findMany({
    where: { levelDefinitionId },
    select: { id: true },
    orderBy: { versionNumber: "asc" },
  });
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length === 0) {
    throw new AuthoringDomainError(
      "AUTHORING_ASSESSMENT_LINK_MISSING",
      `LevelDefinition ${levelDefinitionId} has no AssessmentVersion to link`,
    );
  }
  throw new AuthoringDomainError(
    "AUTHORING_ASSESSMENT_LINK_AMBIGUOUS",
    `LevelDefinition ${levelDefinitionId} has ${candidates.length} unbound AssessmentVersions — bind one before linking video evidence`,
  );
}

/**
 * Bind a production contract to a bank and record what that bank said.
 *
 * The fingerprint and the revision are both read from the database inside this
 * transaction. Neither is a parameter, so there is no caller-supplied value to
 * forge, and the pair is written together or not at all.
 */
export async function linkVideoProductionAssessment(
  tx: DbClient,
  input: {
    videoProductionVersionId: number;
    assessmentVersionId: number;
    actorId: number | null;
  },
): Promise<{ assessmentRevision: number; assessmentBankFingerprint: string }> {
  const bank = await tx.assessmentVersion.findUnique({
    where: { id: input.assessmentVersionId },
    select: { id: true, revision: true },
  });
  if (!bank) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `AssessmentVersion ${input.assessmentVersionId} does not exist`,
    );
  }

  const assessmentBankFingerprint = await calculateBankFingerprint(tx, bank.id);

  await tx.videoProductionAssessmentLink.upsert({
    where: { videoProductionVersionId: input.videoProductionVersionId },
    create: {
      videoProductionVersionId: input.videoProductionVersionId,
      assessmentVersionId: bank.id,
      assessmentRevision: bank.revision,
      assessmentBankFingerprint,
      linkedById: input.actorId,
    },
    update: {
      assessmentVersionId: bank.id,
      assessmentRevision: bank.revision,
      assessmentBankFingerprint,
      linkedById: input.actorId,
    },
  });

  return { assessmentRevision: bank.revision, assessmentBankFingerprint };
}

export type VideoProductionCoherence = {
  videoProductionVersionId: number;
  /** No link at all. NOT the same as fresh, and deliberately not reported as such. */
  linked: boolean;
  assessmentVersionId: number | null;
  /** The bank revision the stored fingerprint was taken at. */
  reviewedAssessmentRevision: number | null;
  currentAssessmentRevision: number | null;
  reviewedBankFingerprint: string | null;
  /** Recomputed from the bank right now. Null when the bank cannot be projected. */
  currentBankFingerprint: string | null;
  /** THE ANSWER the future Studio renders. */
  assessmentEvidenceStale: boolean;
  /** The contract's own Phase-C staleness, unchanged and still meaningful. */
  contractEvidenceStale: boolean;
  /** Why, in a closed vocabulary a UI can switch on. */
  reason:
    | "UNLINKED"
    | "COHERENT"
    | "ASSESSMENT_BANK_CHANGED"
    | "ASSESSMENT_REVISION_MOVED"
    | "ASSESSMENT_UNPROJECTABLE";
};

/**
 * Derive, never trust.
 *
 * Recomputes the bank fingerprint from the durable rows and compares it with
 * what the link recorded. A production contract whose bank has moved reads
 * stale the moment the bank moves, with nothing written to the video row and
 * nobody having to remember to mark it.
 */
export async function readVideoProductionCoherence(
  videoProductionVersionId: number,
  client: DbClient | typeof prisma = prisma,
): Promise<VideoProductionCoherence> {
  const tx = client as DbClient;
  const row = await tx.videoProductionVersion.findUnique({
    where: { id: videoProductionVersionId },
    select: {
      id: true,
      productionEvidenceStale: true,
      assessmentLink: {
        select: {
          assessmentVersionId: true,
          assessmentRevision: true,
          assessmentBankFingerprint: true,
        },
      },
    },
  });
  if (!row) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `VideoProductionVersion ${videoProductionVersionId} does not exist`,
    );
  }

  const base = {
    videoProductionVersionId: row.id,
    contractEvidenceStale: row.productionEvidenceStale,
  };

  if (!row.assessmentLink) {
    return {
      ...base,
      linked: false,
      assessmentVersionId: null,
      reviewedAssessmentRevision: null,
      currentAssessmentRevision: null,
      reviewedBankFingerprint: null,
      currentBankFingerprint: null,
      // An unlinked contract has no assessment evidence to be fresh, so it is
      // reported stale. Silence must never read as a pass.
      assessmentEvidenceStale: true,
      reason: "UNLINKED",
    };
  }

  const link = row.assessmentLink;
  const bank = await tx.assessmentVersion.findUnique({
    where: { id: link.assessmentVersionId },
    select: { revision: true },
  });

  let currentBankFingerprint: string | null = null;
  try {
    currentBankFingerprint = await calculateBankFingerprint(tx, link.assessmentVersionId);
  } catch {
    // A bank that no longer projects cannot be declared coherent. The specific
    // projection failure is available from `projectAssessmentBank` when a caller
    // wants to show it; here it only has to stop a false pass.
    return {
      ...base,
      linked: true,
      assessmentVersionId: link.assessmentVersionId,
      reviewedAssessmentRevision: link.assessmentRevision,
      currentAssessmentRevision: bank?.revision ?? null,
      reviewedBankFingerprint: link.assessmentBankFingerprint,
      currentBankFingerprint: null,
      assessmentEvidenceStale: true,
      reason: "ASSESSMENT_UNPROJECTABLE",
    };
  }

  const contentChanged = currentBankFingerprint !== link.assessmentBankFingerprint;
  const revisionMoved = (bank?.revision ?? null) !== link.assessmentRevision;

  return {
    ...base,
    linked: true,
    assessmentVersionId: link.assessmentVersionId,
    reviewedAssessmentRevision: link.assessmentRevision,
    currentAssessmentRevision: bank?.revision ?? null,
    reviewedBankFingerprint: link.assessmentBankFingerprint,
    currentBankFingerprint,
    assessmentEvidenceStale: contentChanged || revisionMoved,
    reason: contentChanged
      ? "ASSESSMENT_BANK_CHANGED"
      : revisionMoved
        // The bank moved but its fingerprinted semantics did not — a
        // non-semantic edit. Reported separately so a reviewer can tell
        // "somebody touched this" from "the questions changed".
        ? "ASSESSMENT_REVISION_MOVED"
        : "COHERENT",
  };
}
