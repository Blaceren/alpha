/**
 * PHASE-G1 — "create a new draft from this version" (§36, §37).
 *
 * THE TRAP THIS AVOIDS. G0 made an approved version immutable: `assertEditable`
 * refuses every substantive write with `AUTHORING_APPROVED_IMMUTABLE` and tells
 * the caller to create a new version instead. Nothing in the platform could do
 * that. `createContentVersion` produces an EMPTY version — no localizations, no
 * assets, no questions — so the documented remedy meant re-typing a lesson, and
 * an editor who needed one word changed after approval was, in practice, trapped.
 *
 * WHY ONE TRANSACTION AND NOT N ACCEPTED COMMANDS. Calling
 * `createContentLocalization` and `createContentAsset` in a loop would have been
 * tempting — they are the accepted commands — but each one bumps the aggregate,
 * so a five-asset lesson would land at revision 6 and the copy would not be
 * atomic: a failure halfway leaves a version carrying half a lesson, in `draft`,
 * indistinguishable from work in progress. A clone is ONE editorial act. It runs
 * in one transaction and the new aggregate is `revision: 1`.
 *
 * This is not a bypass of the G0 mutation boundary. That boundary guards
 * MUTATIONS OF AN EXISTING AGGREGATE, and G0 states explicitly that version
 * CREATE is out of its scope because there is no revision to be stale against
 * until the row exists. The clone creates; it never writes a child of a version
 * that already had one.
 *
 * THE SOURCE IS NEVER TOUCHED. Every statement below writes to the NEW row. The
 * approved version keeps its `editorialState`, its `approvedById`, its
 * `approvedAt`, its revision and its children, and the regression asserts all of
 * them byte-identical after a clone.
 *
 * APPROVAL DOES NOT TRAVEL. The new row is `editorialState: draft`,
 * `status: draft`, with every lifecycle actor column NULL except
 * `lastAuthoredById`, which names the actor who asked for the copy — so the
 * four-eyes rule already applies to the clone and the person who created it
 * cannot approve it.
 */
import { Prisma } from "@prisma/client";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { projectContract, parseContractPayload } from "@/lib/curriculum/video-production-authoring";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;

export type ClonedVersion = {
  kind: "content" | "assessment" | "video_production";
  id: number;
  versionNumber: number;
  revision: number;
  sourceVersionId: number;
  sourceVersionNumber: number;
  sourceEditorialState: string;
  copiedChildren: number;
};

async function nextVersionNumber(
  tx: DbClient,
  table: "contentVersion" | "assessmentVersion" | "videoProductionVersion",
  levelDefinitionId: number,
): Promise<number> {
  const delegate = tx[table] as {
    findFirst: (args: unknown) => Promise<{ versionNumber: number } | null>;
  };
  const latest = await delegate.findFirst({
    where: { levelDefinitionId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return (latest?.versionNumber ?? 0) + 1;
}

/* ------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------ */

export async function cloneContentVersion(input: {
  contentVersionId: number;
  actorId: number;
  changeNotes?: string | null;
}): Promise<ClonedVersion> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.contentVersion.findUnique({
      where: { id: input.contentVersionId },
      select: {
        id: true,
        versionNumber: true,
        editorialState: true,
        levelDefinitionId: true,
        curriculumVersionId: true,
        videoDurationSeconds: true,
        localizations: true,
        assets: true,
      },
    });
    if (!source) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `ContentVersion ${input.contentVersionId} does not exist`,
      );
    }

    const created = await tx.contentVersion.create({
      data: {
        levelDefinitionId: source.levelDefinitionId,
        curriculumVersionId: source.curriculumVersionId,
        versionNumber: await nextVersionNumber(tx, "contentVersion", source.levelDefinitionId),
        status: "draft",
        editorialState: "draft",
        revision: 1,
        videoDurationSeconds: source.videoDurationSeconds,
        changeNotes:
          input.changeNotes ?? `Копия версии ${source.versionNumber} для новой редакторской правки`,
        createdById: input.actorId,
        lastAuthoredById: input.actorId,
        lastAuthoredAt: new Date(),
      },
      select: { id: true, versionNumber: true, revision: true },
    });

    for (const localization of source.localizations) {
      await tx.contentLocalization.create({
        data: {
          contentVersionId: created.id,
          locale: localization.locale,
          title: localization.title,
          subtitle: localization.subtitle,
          learningObjectiveExtension: localization.learningObjectiveExtension,
          summary: localization.summary,
          transcript: localization.transcript,
          body: localization.body as Prisma.InputJsonValue,
        },
      });
    }
    for (const asset of source.assets) {
      await tx.contentAsset.create({
        data: {
          contentVersionId: created.id,
          kind: asset.kind,
          assetCode: asset.assetCode,
          locale: asset.locale,
          url: asset.url,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          durationSeconds: asset.durationSeconds,
          checksum: asset.checksum,
          sortOrder: asset.sortOrder,
        },
      });
    }

    const copiedChildren = source.localizations.length + source.assets.length;
    await writeCloneAudit(tx, {
      actorId: input.actorId,
      entityType: "ContentVersion",
      createdId: created.id,
      source,
      copiedChildren,
    });

    return {
      kind: "content" as const,
      id: created.id,
      versionNumber: created.versionNumber,
      revision: created.revision,
      sourceVersionId: source.id,
      sourceVersionNumber: source.versionNumber,
      sourceEditorialState: source.editorialState,
      copiedChildren,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Assessment
 * ------------------------------------------------------------------ */

export async function cloneAssessmentVersion(input: {
  assessmentVersionId: number;
  actorId: number;
  changeNotes?: string | null;
}): Promise<ClonedVersion> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.assessmentVersion.findUnique({
      where: { id: input.assessmentVersionId },
      select: {
        id: true,
        versionNumber: true,
        editorialState: true,
        levelDefinitionId: true,
        curriculumVersionId: true,
        passPercent: true,
        maxAttempts: true,
        showExplanation: true,
        questions: { include: { localizations: true }, orderBy: { questionNumber: "asc" } },
      },
    });
    if (!source) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `AssessmentVersion ${input.assessmentVersionId} does not exist`,
      );
    }

    const created = await tx.assessmentVersion.create({
      data: {
        levelDefinitionId: source.levelDefinitionId,
        curriculumVersionId: source.curriculumVersionId,
        versionNumber: await nextVersionNumber(tx, "assessmentVersion", source.levelDefinitionId),
        status: "draft",
        editorialState: "draft",
        revision: 1,
        // PHASE-G2 SUCCESSOR — THE LINEAGE FACT, recorded where it is true.
        //
        // Set from `source.id`, which this transaction just loaded, and never
        // from anything the caller sent: `cloneAssessmentVersion` takes one id
        // and that id IS the predecessor, so there is no input a caller could
        // use to claim descent from a bank it did not copy. This is the only
        // write to this column in the platform.
        predecessorVersionId: source.id,
        passPercent: source.passPercent,
        maxAttempts: source.maxAttempts,
        showExplanation: source.showExplanation,
        changeNotes:
          input.changeNotes ?? `Копия версии ${source.versionNumber} для новой редакторской правки`,
        createdById: input.actorId,
        lastAuthoredById: input.actorId,
        lastAuthoredAt: new Date(),
      },
      select: { id: true, versionNumber: true, revision: true },
    });

    let copiedChildren = 0;
    for (const question of source.questions) {
      const clonedQuestion = await tx.questionDefinition.create({
        data: {
          assessmentVersionId: created.id,
          questionNumber: question.questionNumber,
          stableKey: question.stableKey,
          type: question.type,
          skillTag: question.skillTag,
          status: question.status,
          options: question.options as Prisma.InputJsonValue,
          // The answer key travels with the copy. A bank cloned without its
          // answers is not a draft of the bank — it is a broken bank, and the
          // editor would have to re-key four answers to change one prompt.
          correctAnswer: question.correctAnswer as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      copiedChildren += 1;
      for (const localization of question.localizations) {
        await tx.questionLocalization.create({
          data: {
            questionId: clonedQuestion.id,
            locale: localization.locale,
            prompt: localization.prompt,
            optionLabels: localization.optionLabels as Prisma.InputJsonValue,
            explanation: localization.explanation,
          },
        });
        copiedChildren += 1;
      }
    }

    await writeCloneAudit(tx, {
      actorId: input.actorId,
      entityType: "AssessmentVersion",
      createdId: created.id,
      source,
      copiedChildren,
      // Recorded so the trail shows the lineage relation was established, and by
      // whom. The AuditLog remains a trail: the DOMAIN reads the column.
      predecessorVersionId: source.id,
    });

    return {
      kind: "assessment" as const,
      id: created.id,
      versionNumber: created.versionNumber,
      revision: created.revision,
      sourceVersionId: source.id,
      sourceVersionNumber: source.versionNumber,
      sourceEditorialState: source.editorialState,
      copiedChildren,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Video production (§37)
 * ------------------------------------------------------------------ */

/**
 * A new editable production version carrying the same contract.
 *
 * The projected columns are RECOMPUTED by the accepted `projectContract` rather
 * than copied off the source row, so a clone can never inherit a fingerprint
 * that disagrees with its own payload. The `VideoProductionAssessmentLink` is
 * NOT copied: the link records what a reviewer checked against, and asserting
 * that a brand-new version was reviewed would be exactly the false freshness the
 * G0 correction fixed. The clone reads `UNLINKED` — stale — until it is linked.
 */
export async function cloneVideoProductionVersion(input: {
  videoProductionVersionId: number;
  actorId: number;
}): Promise<ClonedVersion> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.videoProductionVersion.findUnique({
      where: { id: input.videoProductionVersionId },
      select: {
        id: true,
        versionNumber: true,
        editorialState: true,
        levelDefinitionId: true,
        curriculumVersionId: true,
        contractPayload: true,
      },
    });
    if (!source) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `VideoProductionVersion ${input.videoProductionVersionId} does not exist`,
      );
    }

    const contract = parseContractPayload(source.contractPayload);
    const created = await tx.videoProductionVersion.create({
      data: {
        levelDefinitionId: source.levelDefinitionId,
        curriculumVersionId: source.curriculumVersionId,
        versionNumber: await nextVersionNumber(
          tx,
          "videoProductionVersion",
          source.levelDefinitionId,
        ),
        revision: 1,
        editorialState: "draft",
        contractPayload: contract as unknown as Prisma.InputJsonValue,
        ...projectContract(contract),
        createdById: input.actorId,
        lastAuthoredById: input.actorId,
        lastAuthoredAt: new Date(),
      },
      select: { id: true, versionNumber: true, revision: true },
    });

    await writeCloneAudit(tx, {
      actorId: input.actorId,
      entityType: "VideoProductionVersion",
      createdId: created.id,
      source,
      copiedChildren: 0,
    });

    return {
      kind: "video_production" as const,
      id: created.id,
      versionNumber: created.versionNumber,
      revision: created.revision,
      sourceVersionId: source.id,
      sourceVersionNumber: source.versionNumber,
      sourceEditorialState: source.editorialState,
      copiedChildren: 0,
    };
  });
}

async function writeCloneAudit(
  tx: DbClient,
  input: {
    actorId: number;
    entityType: string;
    createdId: number;
    source: { id: number; versionNumber: number; editorialState: string };
    copiedChildren: number;
    /** PHASE-G2 SUCCESSOR — present only where a durable lineage row was written. */
    predecessorVersionId?: number;
  },
) {
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.authoringVersionCloned,
      entityType: input.entityType,
      entityId: String(input.createdId),
      metadata: {
        sourceVersionId: input.source.id,
        sourceVersionNumber: input.source.versionNumber,
        // Recorded so the trail proves the approval did not travel: the source
        // was `approved`, the copy is `draft`.
        sourceEditorialState: input.source.editorialState,
        createdEditorialState: "draft",
        copiedChildren: input.copiedChildren,
        predecessorVersionId: input.predecessorVersionId ?? null,
      },
    },
  });
}
