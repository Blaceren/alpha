/**
 * PHASE-G0 — the durable video-production authoring domain.
 *
 * WHAT MOVED AND WHAT DID NOT.
 * `curriculum/canonical/ata-video-production-contracts.v1.json` REMAINS the
 * canonical provenance and the bootstrap input. Its historical meaning is not
 * rewritten by this module and it is never written back to. What moves into the
 * database is the EDITABLE DRAFT of a contract, so a content editor can change a
 * take without an engineering commit — and nothing else.
 *
 * ONE WRITABLE SURFACE. `contractPayload` holds the exact accepted contract
 * object, parsed by the EXISTING `videoProductionContractSchema`. No production
 * field is invented here and none is dropped: if the accepted contract does not
 * have it, this domain does not store it.
 *
 * EVERY DERIVED VALUE IS SERVER-OWNED. `contractFingerprint`,
 * `assessmentFingerprint` and `productionEvidenceStale` are recomputed from the
 * payload on EVERY write by `calculateContractFingerprint`,
 * `calculateAssessmentFingerprint` and `isProductionEvidenceStale` — the
 * existing Phase-C functions. There is no second fingerprint implementation
 * anywhere in this file, and `projectContract` below is the only path by which
 * any of them reaches a column. A caller that sends `contractFingerprint`,
 * `assessmentFingerprint`, `approvedBy`, `approvedAt`, `revision` or `actorId`
 * has those fields ignored by construction: the write helpers take the payload
 * and the actor from the gate, and derive the rest.
 *
 * PROVENANCE IS NOT APPROVAL. `sourceProvenance` and `editorialState` are two
 * columns because L18 is SOURCE_BACKED and NOT approved. The bootstrap below
 * imports all 58 contracts as `editorialState: draft` regardless of what their
 * source `approval` field says, so no migration can mass-approve the 57
 * PROPOSED_CANON banks and L18 does not become approved by being imported.
 */
import { Prisma } from "@prisma/client";
import type { VideoProductionVersion } from "@prisma/client";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { bumpAggregate } from "@/lib/curriculum/authoring-lifecycle";
import {
  calculateAssessmentFingerprint,
  calculateContractFingerprint,
  isProductionEvidenceStale,
  videoProductionContractSchema,
  type VideoProductionContract,
  type VideoProductionContractsFile,
} from "@/lib/curriculum/video-production-contract";
import {
  linkVideoProductionAssessment,
  resolveCanonicalAssessmentVersion,
} from "@/lib/curriculum/video-production-coherence";
import { isAuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;

/**
 * The server-derived projection of a contract payload.
 *
 * THE ONLY place any of these values is produced. Every write path calls this
 * and spreads the result, so a column can never disagree with the payload it is
 * supposed to describe, and no caller-supplied value can reach one.
 */
export function projectContract(contract: VideoProductionContract) {
  return {
    levelNumber: contract.levelNumber,
    contractVersion: contract.contractVersion,
    sourceProvenance: contract.sourceProvenance,
    scriptState: contract.production.script,
    videoState: contract.production.video,
    qaState: contract.production.qa,
    contractFingerprint: calculateContractFingerprint(contract),
    assessmentFingerprint: calculateAssessmentFingerprint(contract),
    productionEvidenceStale: isProductionEvidenceStale(contract),
  };
}

/**
 * Parse an untrusted payload into an accepted contract.
 *
 * `strictObject` throughout the accepted schema means an unknown key is a
 * REJECTION, not a silently dropped field — which is what stops a caller from
 * smuggling `contractFingerprint` into the stored JSON and having a later reader
 * trust it.
 */
export function parseContractPayload(value: unknown): VideoProductionContract {
  const parsed = videoProductionContractSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthoringDomainError(
      "AUTHORING_INPUT_INVALID",
      "video production contract payload is not the accepted contract shape",
      {
        issues: parsed.error.issues.map((issue) => ({
          code: "CONTRACT_INPUT_INVALID",
          path: issue.path.join(".") || "payload",
          message: issue.message,
        })),
      },
    );
  }
  return parsed.data;
}

async function nextVersionNumber(tx: DbClient, levelDefinitionId: number): Promise<number> {
  const latest = await tx.videoProductionVersion.findFirst({
    where: { levelDefinitionId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return (latest?.versionNumber ?? 0) + 1;
}

/**
 * Create a new durable production version for a level.
 *
 * Always lands in `editorialState: draft`. There is deliberately no parameter
 * to create one in any other state — an approved row can only be reached by a
 * human going through `approveVersion`, which enforces four-eyes.
 */
export async function createVideoProductionVersion(input: {
  levelDefinitionId: number;
  curriculumVersionId: number;
  payload: unknown;
  actorId: number;
}): Promise<VideoProductionVersion> {
  const contract = parseContractPayload(input.payload);

  return prisma.$transaction(async (tx) => {
    const level = await tx.levelDefinition.findUnique({
      where: { id: input.levelDefinitionId },
      select: { id: true, curriculumVersionId: true },
    });
    if (!level || level.curriculumVersionId !== input.curriculumVersionId) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `LevelDefinition ${input.levelDefinitionId} is not in curriculum version ${input.curriculumVersionId}`,
      );
    }

    const created = await tx.videoProductionVersion.create({
      data: {
        levelDefinitionId: input.levelDefinitionId,
        curriculumVersionId: input.curriculumVersionId,
        versionNumber: await nextVersionNumber(tx, input.levelDefinitionId),
        revision: 1,
        editorialState: "draft",
        contractPayload: contract as unknown as Prisma.InputJsonValue,
        ...projectContract(contract),
        createdById: input.actorId,
        lastAuthoredById: input.actorId,
        lastAuthoredAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.authoringVideoProductionCreated,
        entityType: "VideoProductionVersion",
        entityId: String(created.id),
        metadata: {
          levelNumber: created.levelNumber,
          versionNumber: created.versionNumber,
          contractFingerprint: created.contractFingerprint,
          assessmentFingerprint: created.assessmentFingerprint,
          sourceProvenance: created.sourceProvenance,
        },
      },
    });

    return created;
  });
}

/**
 * Replace the contract payload of a draft, under the aggregate revision guard.
 *
 * WHY THE WHOLE PAYLOAD RATHER THAN A PATCH. The fingerprints are computed over
 * a projection of the WHOLE contract, so a partial update would have to merge
 * first and then hash — and a merge whose result nobody validated is exactly how
 * a take ends up bound to a question that no longer exists. Sending the whole
 * accepted object means the thing that gets hashed is the thing that got
 * validated.
 *
 * THE STALENESS SEMANTICS ARE THE ACCEPTED ONES. `isProductionEvidenceStale` is
 * called on the new payload and its verdict is stored. A SEMANTIC edit — a take
 * text, a question prompt, a correct answer — moves `contractFingerprint`, so
 * evidence reviewed against the old fingerprint becomes stale and a green QA
 * turns into a visible warning. A NON-SEMANTIC edit — the shot list, the target
 * duration, the acceptance checklist — is excluded from the fingerprint
 * projection by the accepted Phase-C definition, so it does NOT invalidate a QA
 * pass. This module does not re-decide either rule.
 */
export async function updateVideoProductionContract(input: {
  id: number;
  expectedRevision: number;
  payload: unknown;
  actorId: number;
}): Promise<VideoProductionVersion> {
  const contract = parseContractPayload(input.payload);

  return prisma.$transaction(async (tx) => {
    // The guard runs FIRST and inside this transaction. If it throws, the
    // payload write below never happens and the losing writer changes nothing.
    const nextRevision = await bumpAggregate(tx, {
      kind: "video_production",
      id: input.id,
      expectedRevision: input.expectedRevision,
      actorId: input.actorId,
    });

    const before = await tx.videoProductionVersion.findUnique({
      where: { id: input.id },
      select: { contractFingerprint: true, assessmentFingerprint: true },
    });

    const projected = projectContract(contract);
    const updated = await tx.videoProductionVersion.update({
      where: { id: input.id },
      data: {
        contractPayload: contract as unknown as Prisma.InputJsonValue,
        ...projected,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.authoringVideoProductionUpdated,
        entityType: "VideoProductionVersion",
        entityId: String(updated.id),
        metadata: {
          revision: nextRevision,
          // Both fingerprints, before and after, so the trail proves whether an
          // edit was semantic without anyone re-hashing the payload later.
          contractFingerprintBefore: before?.contractFingerprint ?? null,
          contractFingerprintAfter: projected.contractFingerprint,
          assessmentFingerprintBefore: before?.assessmentFingerprint ?? null,
          assessmentFingerprintAfter: projected.assessmentFingerprint,
          productionEvidenceStale: projected.productionEvidenceStale,
        },
      },
    });

    return updated;
  });
}

export type BootstrapSummary = {
  levelsConsidered: number;
  created: number;
  skippedExisting: number;
  takes: number;
  questions: number;
  takeQuestionMappings: number;
  sourceBacked: number;
  proposedCanon: number;
  /** Always 0. The bootstrap cannot approve anything — see below. */
  approved: number;
  /** PHASE-G0 CORRECTION — contracts bound to a durable AssessmentVersion. */
  assessmentLinked: number;
  /**
   * Contracts left UNLINKED because the level's bank was absent, ambiguous, or
   * not projectable. Reported rather than guessed: a wrong link would silently
   * claim a coherence check that never happened.
   */
  assessmentUnlinked: number;
};

/**
 * Deterministic bootstrap of the 58 accepted contracts into the durable model.
 *
 * FOR A DISPOSABLE OR TEST DATABASE. Nothing in this phase runs it against
 * preprod, and it is not wired to any HTTP route.
 *
 * DETERMINISTIC. Contracts are processed in ascending level order, each becomes
 * exactly one row at `versionNumber` 1 / `revision` 1, and a level that already
 * has a production version is SKIPPED rather than duplicated or overwritten —
 * so running it twice produces the same database as running it once.
 *
 * IT CANNOT APPROVE. Every row is written `editorialState: draft` no matter what
 * the source contract's own `approval` field says. That is the whole point: the
 * 57 PROPOSED_CANON banks stay proposals, L18 stays SOURCE_BACKED-and-not-
 * approved, and there is no code path here that could mass-approve them. The
 * source `approval` value is preserved inside `contractPayload`, where it
 * remains readable as PROVENANCE without being mistaken for a platform
 * decision.
 */
export async function bootstrapVideoProductionVersions(input: {
  file: VideoProductionContractsFile;
  curriculumVersionId: number;
  actorId: number;
}): Promise<BootstrapSummary> {
  const contracts = [...input.file.contracts].sort((a, b) => a.levelNumber - b.levelNumber);

  const summary: BootstrapSummary = {
    levelsConsidered: contracts.length,
    created: 0,
    skippedExisting: 0,
    takes: 0,
    questions: 0,
    takeQuestionMappings: 0,
    sourceBacked: 0,
    proposedCanon: 0,
    approved: 0,
    assessmentLinked: 0,
    assessmentUnlinked: 0,
  };

  for (const contract of contracts) {
    const level = await prisma.levelDefinition.findFirst({
      where: { curriculumVersionId: input.curriculumVersionId, levelNumber: contract.levelNumber },
      select: { id: true },
    });
    if (!level) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `no LevelDefinition for level ${contract.levelNumber} in curriculum version ${input.curriculumVersionId}`,
      );
    }

    const existing = await prisma.videoProductionVersion.findFirst({
      where: { levelDefinitionId: level.id },
      select: { id: true },
    });
    if (existing) {
      summary.skippedExisting += 1;
      continue;
    }

    const created = await createVideoProductionVersion({
      levelDefinitionId: level.id,
      curriculumVersionId: input.curriculumVersionId,
      payload: contract,
      actorId: input.actorId,
    });

    // PHASE-G0 CORRECTION -- bind the contract to the level's REAL bank so the
    // future Studio can see production evidence go stale when the questions
    // change. A level with no bank, an ambiguous bank, or a bank that does not
    // project into the accepted fingerprint shape is left UNLINKED and counted:
    // guessing here would claim a coherence check nobody performed. Linking
    // approves nothing and moves no editorial state.
    try {
      const assessmentVersionId = await resolveCanonicalAssessmentVersion(prisma, level.id);
      await linkVideoProductionAssessment(prisma, {
        videoProductionVersionId: created.id,
        assessmentVersionId,
        actorId: input.actorId,
      });
      summary.assessmentLinked += 1;
    } catch (error) {
      if (!isAuthoringDomainError(error)) throw error;
      summary.assessmentUnlinked += 1;
    }

    summary.created += 1;
    summary.takes += contract.takes.length;
    summary.questions += contract.questions.length;
    summary.takeQuestionMappings += contract.questions.filter((q) => q.takeId.length > 0).length;
    if (contract.sourceProvenance === "SOURCE_BACKED") summary.sourceBacked += 1;
    else summary.proposedCanon += 1;
  }

  await prisma.auditLog.create({
    data: {
      userId: input.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.authoringVideoProductionBootstrapped,
      entityType: "CurriculumVersion",
      entityId: String(input.curriculumVersionId),
      metadata: { ...summary },
    },
  });

  return summary;
}

/** Read one durable contract back as the accepted object. */
export function contractFromRow(row: VideoProductionVersion): VideoProductionContract {
  return parseContractPayload(row.contractPayload);
}
