import type { CurriculumVersion, Prisma } from "@prisma/client";
import { createAuditLog } from "@/lib/audit";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { CurriculumDomainError } from "@/lib/curriculum/errors";
import { validateCurriculumResourceCompleteness } from "@/lib/curriculum/resource-completeness";
import { validateCurriculumDraft } from "@/lib/curriculum/validation";
import type {
  ArchiveCurriculumInput,
  CurriculumDraftSnapshot,
  PublishCurriculumInput,
  PublishCurriculumResult,
} from "@/lib/curriculum/types";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;

export async function loadCurriculumSnapshot(
  curriculumVersionId: number,
  client: DbClient = prisma,
): Promise<CurriculumDraftSnapshot> {
  const version = await client.curriculumVersion.findUnique({
    where: { id: curriculumVersionId },
  });

  if (!version) {
    throw new CurriculumDomainError(
      "CURRICULUM_NOT_FOUND",
      `CurriculumVersion ${curriculumVersionId} does not exist`,
    );
  }

  const [modules, levels] = await Promise.all([
    client.moduleDefinition.findMany({
      where: { curriculumVersionId },
      orderBy: { moduleNumber: "asc" },
    }),
    client.levelDefinition.findMany({
      where: { curriculumVersionId },
      orderBy: { levelNumber: "asc" },
    }),
  ]);

  return { version, modules, levels };
}

// Shared guard for every current and future mutate operation on curriculum
// definitions: only draft versions are editable.
export function assertCurriculumEditable(version: Pick<CurriculumVersion, "id" | "status">) {
  if (version.status === "published") {
    throw new CurriculumDomainError(
      "CURRICULUM_PUBLISHED_IMMUTABLE",
      `CurriculumVersion ${version.id} is published and immutable; create a new version instead`,
    );
  }
  if (version.status === "archived") {
    throw new CurriculumDomainError(
      "CURRICULUM_ARCHIVED_IMMUTABLE",
      `CurriculumVersion ${version.id} is archived and immutable`,
    );
  }
}

export async function assertAdminActor(actorId: number, client: DbClient) {
  const actor = await client.user.findUnique({ where: { id: actorId } });

  if (!actor || actor.role !== "admin" || actor.status !== "active") {
    throw new CurriculumDomainError(
      "CURRICULUM_ACTOR_FORBIDDEN",
      `actor ${actorId} is not an active admin`,
    );
  }

  return actor;
}

// Audit inside the lifecycle transaction must not be swallowed: if the audit
// insert fails the whole status change has to roll back (unlike the generic
// createAuditLog helper, which is fire-and-forget by design).
export async function writeAuditInTransaction(
  tx: DbClient,
  input: {
    actorId: number;
    action: string;
    entityId: number;
    metadata: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: input.action,
      entityType: "CurriculumVersion",
      entityId: String(input.entityId),
      metadata: input.metadata,
    },
  });
}

export async function publishCurriculumVersion(
  input: PublishCurriculumInput,
): Promise<PublishCurriculumResult> {
  const { curriculumVersionId, actorId } = input;
  const expectedPublishedVersionId = input.expectedPublishedVersionId ?? null;

  try {
    return await prisma.$transaction(async (tx) => {
      await assertAdminActor(actorId, tx);

      const snapshot = await loadCurriculumSnapshot(curriculumVersionId, tx);
      const { version } = snapshot;

      if (version.status !== "draft") {
        throw new CurriculumDomainError(
          "CURRICULUM_NOT_DRAFT",
          `CurriculumVersion ${version.id} has status "${version.status}", only drafts can be published`,
        );
      }

      const now = new Date();

      if (version.effectiveFrom !== null && version.effectiveFrom.getTime() > now.getTime()) {
        throw new CurriculumDomainError(
          "CURRICULUM_EFFECTIVE_FROM_FUTURE",
          `CurriculumVersion ${version.id} has effectiveFrom in the future; scheduled publication is not supported`,
        );
      }

      const validation = validateCurriculumDraft(snapshot, { now });
      // The shape checks above and the resource checks below answer different
      // questions, and a curriculum has to pass BOTH to reach the runtime: one
      // proves the route is well formed, the other proves a learner standing on
      // each level has something that can complete it. They are reported
      // together so an operator sees every reason at once rather than fixing
      // shape, republishing, and discovering the resource gap afterwards.
      const resourceIssues = await validateCurriculumResourceCompleteness(tx, version.id);
      const allIssues = [...validation.issues, ...resourceIssues];
      if (allIssues.length > 0) {
        throw new CurriculumDomainError(
          "CURRICULUM_INVALID",
          `CurriculumVersion ${version.id} failed publish validation with ${allIssues.length} issue(s)`,
          allIssues,
        );
      }

      const currentPublished = await tx.curriculumVersion.findFirst({
        where: { code: version.code, status: "published" },
      });

      if (!currentPublished && expectedPublishedVersionId !== null) {
        throw new CurriculumDomainError(
          "CURRICULUM_REPLACEMENT_MISMATCH",
          `no published version exists for code "${version.code}", but expectedPublishedVersionId ${expectedPublishedVersionId} was provided`,
        );
      }

      let replaced: CurriculumVersion | null = null;

      if (currentPublished) {
        if (expectedPublishedVersionId === null) {
          throw new CurriculumDomainError(
            "CURRICULUM_REPLACEMENT_REQUIRED",
            `code "${version.code}" already has published version ${currentPublished.id}; pass expectedPublishedVersionId to replace it`,
          );
        }
        if (expectedPublishedVersionId !== currentPublished.id) {
          throw new CurriculumDomainError(
            "CURRICULUM_REPLACEMENT_MISMATCH",
            `expectedPublishedVersionId ${expectedPublishedVersionId} does not match current published version ${currentPublished.id}`,
          );
        }

        replaced = await tx.curriculumVersion.update({
          where: { id: currentPublished.id },
          data: { status: "archived" },
        });
      }

      const published = await tx.curriculumVersion.update({
        where: { id: version.id },
        data: { status: "published", publishedAt: now },
      });

      await writeAuditInTransaction(tx, {
        actorId,
        action: CURRICULUM_AUDIT_ACTIONS.published,
        entityId: published.id,
        metadata: {
          curriculumVersionId: published.id,
          code: published.code,
          versionNumber: published.versionNumber,
          replacedVersionId: replaced?.id ?? null,
          actorId,
        },
      });

      if (replaced) {
        await writeAuditInTransaction(tx, {
          actorId,
          action: CURRICULUM_AUDIT_ACTIONS.replaced,
          entityId: replaced.id,
          metadata: {
            curriculumVersionId: replaced.id,
            code: replaced.code,
            versionNumber: replaced.versionNumber,
            replacedByVersionId: published.id,
            actorId,
          },
        });
      }

      return { published, replaced };
    });
  } catch (error) {
    // Rejected publications are audited outside the rolled-back transaction,
    // following the existing fire-and-forget audit policy.
    if (error instanceof CurriculumDomainError && error.code === "CURRICULUM_INVALID") {
      await createAuditLog({
        userId: actorId,
        action: CURRICULUM_AUDIT_ACTIONS.publicationRejected,
        entityType: "CurriculumVersion",
        entityId: curriculumVersionId,
        metadata: {
          curriculumVersionId,
          actorId,
          issueCodes: error.issues.map((item) => item.code),
        },
      });
    }
    throw error;
  }
}

export async function archiveCurriculumVersion(
  input: ArchiveCurriculumInput,
): Promise<CurriculumVersion> {
  const { curriculumVersionId, actorId } = input;

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(actorId, tx);

    const version = await tx.curriculumVersion.findUnique({
      where: { id: curriculumVersionId },
    });

    if (!version) {
      throw new CurriculumDomainError(
        "CURRICULUM_NOT_FOUND",
        `CurriculumVersion ${curriculumVersionId} does not exist`,
      );
    }

    if (version.status !== "published") {
      throw new CurriculumDomainError(
        "CURRICULUM_NOT_PUBLISHED",
        `CurriculumVersion ${version.id} has status "${version.status}", only published versions can be archived`,
      );
    }

    const archived = await tx.curriculumVersion.update({
      where: { id: version.id },
      data: { status: "archived" },
    });

    await writeAuditInTransaction(tx, {
      actorId,
      action: CURRICULUM_AUDIT_ACTIONS.archived,
      entityId: archived.id,
      metadata: {
        curriculumVersionId: archived.id,
        code: archived.code,
        versionNumber: archived.versionNumber,
        actorId,
      },
    });

    return archived;
  });
}
