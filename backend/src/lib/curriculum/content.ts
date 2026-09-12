import type {
  ContentAsset,
  ContentLocalization,
  ContentVersion,
  LevelResourceBinding,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { createAuditLog } from "@/lib/audit";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import {
  guardAggregateChildMutation,
  guardAggregateSelfMutation,
} from "@/lib/curriculum/authoring-mutation-guard";
import { assertEditoriallyApproved } from "@/lib/curriculum/authoring-lifecycle";
import { isAuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { staffRoleGrantsCurriculumCapability } from "@/lib/curriculum/authoring-authorization";
import { ContentDomainError, isContentDomainError } from "@/lib/curriculum/content-errors";
import type { ContentDomainErrorCode } from "@/lib/curriculum/content-errors";
import {
  archiveContentVersionSchema,
  clearContentBindingSchema,
  createContentAssetSchema,
  createContentLocalizationSchema,
  createContentVersionSchema,
  deleteContentAssetSchema,
  deleteContentLocalizationSchema,
  deleteContentVersionSchema,
  publishContentVersionSchema,
  setContentBindingSchema,
  updateContentAssetSchema,
  updateContentLocalizationSchema,
  updateContentVersionSchema,
} from "@/lib/curriculum/content-schemas";
import {
  parseContentCommand,
  validateContentPublication,
} from "@/lib/curriculum/content-validation";
import { isCurriculumV2ContentEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;
type ContentContext = Prisma.ContentVersionGetPayload<{
  include: { levelDefinition: { include: { curriculumVersion: true } } };
}>;
type ContentSnapshot = Prisma.ContentVersionGetPayload<{
  include: {
    levelDefinition: { include: { curriculumVersion: true } };
    localizations: true;
    assets: true;
    resourceBindings: true;
  };
}>;

export type PublishContentVersionResult = {
  published: ContentVersion;
  replaced: ContentVersion | null;
  bindingMoved: boolean;
  recovered: boolean;
};

export type ClearContentBindingResult = {
  binding: LevelResourceBinding | null;
  deleted: boolean;
};

function assertContentEnabled() {
  if (!isCurriculumV2ContentEnabled()) {
    throw new ContentDomainError("CONTENT_DISABLED", "V2 content mutations are disabled");
  }
}

/**
 * RUNTIME / STRUCTURAL authority: `UserRole=admin`, exactly as accepted.
 *
 * Publication, archival and resource binding keep this and only this. A content
 * editor must not be able to activate content for learners or rebind a level,
 * and that refusal lives here in the domain rather than in a hidden button.
 */
async function assertContentAdmin(actorId: number, tx: DbClient) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.role !== "admin" || actor.status !== "active") {
    throw new ContentDomainError(
      "CONTENT_ACTOR_FORBIDDEN",
      "content mutation requires an active admin actor",
    );
  }
  return actor;
}

/**
 * PHASE-G1 — SUBSTANTIVE AUTHORING authority.
 *
 * Two alternatives, never a merge, mirroring the accepted HTTP bridge:
 *
 *   PATH A — `UserRole=admin`, byte-identical to the accepted check above, so
 *            every existing caller keeps working unchanged.
 *   PATH B — an active user whose STORED StaffProfile role grants
 *            `curriculum_author`.
 *
 * The `status === "active"` requirement is the accepted one and applies to both
 * paths: a blocked staff member is refused exactly as a blocked admin is.
 */
async function assertContentAuthor(actorId: number, tx: DbClient) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    include: { staffProfile: { select: { staffRole: true } } },
  });
  if (!actor || actor.status !== "active") {
    throw new ContentDomainError(
      "CONTENT_ACTOR_FORBIDDEN",
      "content mutation requires an active actor",
    );
  }
  if (actor.role === "admin") return actor;
  if (staffRoleGrantsCurriculumCapability(actor.staffProfile?.staffRole, "author")) return actor;
  throw new ContentDomainError(
    "CONTENT_ACTOR_FORBIDDEN",
    "content mutation requires an admin or a curriculum-authoring staff actor",
  );
}

function assertParentDraft(status: "draft" | "published" | "archived") {
  if (status === "published") {
    throw new ContentDomainError(
      "CONTENT_PUBLISHED_IMMUTABLE",
      "published curriculum content is immutable",
    );
  }
  if (status === "archived") {
    throw new ContentDomainError(
      "CONTENT_ARCHIVED_IMMUTABLE",
      "archived curriculum content is immutable",
    );
  }
}

function assertDraftContent(content: Pick<ContentVersion, "status">) {
  if (content.status === "published") {
    throw new ContentDomainError(
      "CONTENT_PUBLISHED_IMMUTABLE",
      "published content is immutable; create a new version",
    );
  }
  if (content.status === "archived") {
    throw new ContentDomainError("CONTENT_ARCHIVED_IMMUTABLE", "archived content is immutable");
  }
  if (content.status !== "draft") {
    throw new ContentDomainError("CONTENT_VERSION_NOT_DRAFT", "content is not a draft");
  }
}

async function loadLevel(levelDefinitionId: number, tx: DbClient) {
  const level = await tx.levelDefinition.findUnique({
    where: { id: levelDefinitionId },
    include: { curriculumVersion: true },
  });
  if (!level) {
    throw new ContentDomainError("CONTENT_LEVEL_NOT_FOUND", "level does not exist");
  }
  assertParentDraft(level.curriculumVersion.status);
  return level;
}

async function loadContent(contentVersionId: number, tx: DbClient): Promise<ContentContext> {
  const content = await tx.contentVersion.findUnique({
    where: { id: contentVersionId },
    include: { levelDefinition: { include: { curriculumVersion: true } } },
  });
  if (!content) {
    throw new ContentDomainError("CONTENT_VERSION_NOT_FOUND", "content version does not exist");
  }
  if (content.curriculumVersionId !== content.levelDefinition.curriculumVersionId) {
    throw new ContentDomainError("CONTENT_VERSION_MISMATCH", "content ownership is inconsistent");
  }
  assertParentDraft(content.levelDefinition.curriculumVersion.status);
  return content;
}

async function loadContentSnapshot(contentVersionId: number, tx: DbClient): Promise<ContentSnapshot> {
  const content = await tx.contentVersion.findUnique({
    where: { id: contentVersionId },
    include: {
      levelDefinition: { include: { curriculumVersion: true } },
      localizations: { orderBy: { locale: "asc" } },
      assets: { orderBy: { sortOrder: "asc" } },
      resourceBindings: true,
    },
  });
  if (!content) {
    throw new ContentDomainError("CONTENT_VERSION_NOT_FOUND", "content version does not exist");
  }
  if (content.curriculumVersionId !== content.levelDefinition.curriculumVersionId) {
    throw new ContentDomainError("CONTENT_VERSION_MISMATCH", "content ownership is inconsistent");
  }
  assertParentDraft(content.levelDefinition.curriculumVersion.status);
  return content;
}

async function writeContentAudit(
  tx: DbClient,
  input: {
    actorId: number;
    action: string;
    entityType: "ContentVersion" | "ContentLocalization" | "ContentAsset" | "LevelResourceBinding";
    entityId: number;
    metadata: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: String(input.entityId),
      metadata: input.metadata,
    },
  });
}

function mapConstraintError(
  error: unknown,
  conflict: ContentDomainErrorCode,
  notFound: ContentDomainErrorCode,
): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002" || error.code === "P2003") {
      throw new ContentDomainError(conflict, "content constraint conflict");
    }
    if (error.code === "P2025") {
      throw new ContentDomainError(notFound, "content record does not exist");
    }
  }
  throw error;
}

async function runSanitized<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isContentDomainError(error)) throw error;
    // PHASE-G0 CORRECTION — an authoring refusal is a PRODUCT ANSWER, not an
    // internal fault, and must reach the caller intact. Masking it here would
    // turn "the lesson moved under you" and "this version is approved" into an
    // opaque 500, discard the `actualRevision` an editor needs to reload, and
    // leave a reviewer unable to tell a refusal from a broken server. The
    // sanitizer still swallows everything it does not recognise, which is the
    // property it exists for.
    if (isAuthoringDomainError(error)) throw error;
    throw new ContentDomainError("CONTENT_INTERNAL_ERROR", "content operation failed");
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function valuesEqual(left: unknown, right: unknown) {
  if (left === right) return true;
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function patchHasChanges(existing: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.entries(patch).some(([key, value]) => !valuesEqual(existing[key], value));
}

export async function createContentVersion(input: unknown): Promise<ContentVersion> {
  assertContentEnabled();
  const data = parseContentCommand(createContentVersionSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const level = await loadLevel(data.levelDefinitionId, tx);
      const maximum = await tx.contentVersion.aggregate({
        where: { levelDefinitionId: level.id },
        _max: { versionNumber: true },
      });
      const versionNumber = (maximum._max.versionNumber ?? 0) + 1;
      let created: ContentVersion;
      try {
        created = await tx.contentVersion.create({
          data: {
            levelDefinitionId: level.id,
            curriculumVersionId: level.curriculumVersionId,
            versionNumber,
            videoDurationSeconds: data.videoDurationSeconds ?? null,
            changeNotes: data.changeNotes ?? null,
            createdById: data.actorId,
          },
        });
      } catch (error) {
        mapConstraintError(error, "CONTENT_VERSION_CONFLICT", "CONTENT_LEVEL_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentVersionCreated,
        entityType: "ContentVersion",
        entityId: created.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: created.id,
          curriculumVersionId: created.curriculumVersionId,
          levelDefinitionId: created.levelDefinitionId,
          versionNumber: created.versionNumber,
        },
      });
      return created;
    }),
  );
}

export async function updateContentVersion(input: unknown): Promise<ContentVersion> {
  assertContentEnabled();
  const data = parseContentCommand(updateContentVersionSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const content = await loadContent(data.contentVersionId, tx);
      assertDraftContent(content);
      // PHASE-G0 CORRECTION — the aggregate authoring boundary. Refuses a
      // submitted or approved version, refuses a stale writer, moves the
      // revision and records THIS server-resolved actor as the substantive
      // author, all inside the caller's transaction so the child write below
      // rolls back with it.
      await guardAggregateChildMutation(tx, {
        kind: "content",
        aggregateId: content.id,
        expectedRevision: data.expectedRevision,
        actorId: data.actorId,
      });
      const patch = stripUndefined(data.patch);
      if (!patchHasChanges(content as unknown as Record<string, unknown>, patch)) {
        throw new ContentDomainError("CONTENT_NO_CHANGES", "content update has no changes");
      }
      let updated: ContentVersion;
      try {
        updated = await tx.contentVersion.update({ where: { id: content.id }, data: patch });
      } catch (error) {
        mapConstraintError(error, "CONTENT_VERSION_CONFLICT", "CONTENT_VERSION_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentVersionUpdated,
        entityType: "ContentVersion",
        entityId: updated.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: updated.id,
          levelDefinitionId: updated.levelDefinitionId,
          versionNumber: updated.versionNumber,
        },
      });
      return updated;
    }),
  );
}

export async function deleteContentVersion(input: unknown): Promise<ContentVersion> {
  assertContentEnabled();
  const data = parseContentCommand(deleteContentVersionSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const content = await loadContent(data.contentVersionId, tx);
      assertDraftContent(content);
      // PHASE-G0 CORRECTION — deleting the aggregate cannot bump its own
      // revision, but it is still substantive: the editorial state and the
      // expected revision are both checked so an approved version can never
      // be erased outright.
      await guardAggregateSelfMutation(tx, {
        kind: "content",
        aggregateId: content.id,
        expectedRevision: data.expectedRevision,
      });
      const [localizations, assets, bindings, progress] = await Promise.all([
        tx.contentLocalization.count({ where: { contentVersionId: content.id } }),
        tx.contentAsset.count({ where: { contentVersionId: content.id } }),
        tx.levelResourceBinding.count({ where: { contentVersionId: content.id } }),
        tx.userLessonProgress.count({ where: { contentVersionId: content.id } }),
      ]);
      if (localizations + assets + bindings + progress > 0) {
        throw new ContentDomainError("CONTENT_NOT_EMPTY", "only an empty unbound draft can be deleted");
      }
      let deleted: ContentVersion;
      try {
        deleted = await tx.contentVersion.delete({ where: { id: content.id } });
      } catch (error) {
        mapConstraintError(error, "CONTENT_NOT_EMPTY", "CONTENT_VERSION_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentVersionDeleted,
        entityType: "ContentVersion",
        entityId: deleted.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: deleted.id,
          levelDefinitionId: deleted.levelDefinitionId,
          versionNumber: deleted.versionNumber,
        },
      });
      return deleted;
    }),
  );
}

export async function createContentLocalization(input: unknown): Promise<ContentLocalization> {
  assertContentEnabled();
  const data = parseContentCommand(createContentLocalizationSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const content = await loadContent(data.contentVersionId, tx);
      assertDraftContent(content);
      // PHASE-G0 CORRECTION — the aggregate authoring boundary. Refuses a
      // submitted or approved version, refuses a stale writer, moves the
      // revision and records THIS server-resolved actor as the substantive
      // author, all inside the caller's transaction so the child write below
      // rolls back with it.
      await guardAggregateChildMutation(tx, {
        kind: "content",
        aggregateId: content.id,
        expectedRevision: data.expectedRevision,
        actorId: data.actorId,
      });
      let created: ContentLocalization;
      try {
        created = await tx.contentLocalization.create({
          data: {
            contentVersionId: content.id,
            locale: data.locale,
            title: data.title,
            subtitle: data.subtitle,
            learningObjectiveExtension: data.learningObjectiveExtension,
            summary: data.summary,
            transcript: data.transcript,
            body: data.body,
          },
        });
      } catch (error) {
        mapConstraintError(error, "CONTENT_LOCALIZATION_CONFLICT", "CONTENT_VERSION_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentLocalizationCreated,
        entityType: "ContentLocalization",
        entityId: created.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: created.contentVersionId,
          contentLocalizationId: created.id,
          locale: created.locale,
        },
      });
      return created;
    }),
  );
}

export async function updateContentLocalization(input: unknown): Promise<ContentLocalization> {
  assertContentEnabled();
  const data = parseContentCommand(updateContentLocalizationSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const localization = await tx.contentLocalization.findUnique({
        where: { id: data.contentLocalizationId },
      });
      if (!localization) {
        throw new ContentDomainError("CONTENT_LOCALIZATION_NOT_FOUND", "localization does not exist");
      }
      const content = await loadContent(localization.contentVersionId, tx);
      assertDraftContent(content);
      // PHASE-G0 CORRECTION — the aggregate authoring boundary. Refuses a
      // submitted or approved version, refuses a stale writer, moves the
      // revision and records THIS server-resolved actor as the substantive
      // author, all inside the caller's transaction so the child write below
      // rolls back with it.
      await guardAggregateChildMutation(tx, {
        kind: "content",
        aggregateId: content.id,
        expectedRevision: data.expectedRevision,
        actorId: data.actorId,
      });
      const patch = stripUndefined(data.patch);
      if (!patchHasChanges(localization as unknown as Record<string, unknown>, patch)) {
        throw new ContentDomainError("CONTENT_NO_CHANGES", "localization update has no changes");
      }
      let updated: ContentLocalization;
      try {
        updated = await tx.contentLocalization.update({
          where: { id: localization.id },
          data: patch,
        });
      } catch (error) {
        mapConstraintError(error, "CONTENT_LOCALIZATION_CONFLICT", "CONTENT_LOCALIZATION_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentLocalizationUpdated,
        entityType: "ContentLocalization",
        entityId: updated.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: updated.contentVersionId,
          contentLocalizationId: updated.id,
          locale: updated.locale,
        },
      });
      return updated;
    }),
  );
}

export async function deleteContentLocalization(input: unknown): Promise<ContentLocalization> {
  assertContentEnabled();
  const data = parseContentCommand(deleteContentLocalizationSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const localization = await tx.contentLocalization.findUnique({
        where: { id: data.contentLocalizationId },
      });
      if (!localization) {
        throw new ContentDomainError("CONTENT_LOCALIZATION_NOT_FOUND", "localization does not exist");
      }
      const content = await loadContent(localization.contentVersionId, tx);
      assertDraftContent(content);
      // PHASE-G0 CORRECTION — the aggregate authoring boundary. Refuses a
      // submitted or approved version, refuses a stale writer, moves the
      // revision and records THIS server-resolved actor as the substantive
      // author, all inside the caller's transaction so the child write below
      // rolls back with it.
      await guardAggregateChildMutation(tx, {
        kind: "content",
        aggregateId: content.id,
        expectedRevision: data.expectedRevision,
        actorId: data.actorId,
      });
      let deleted: ContentLocalization;
      try {
        deleted = await tx.contentLocalization.delete({ where: { id: localization.id } });
      } catch (error) {
        mapConstraintError(error, "CONTENT_LOCALIZATION_CONFLICT", "CONTENT_LOCALIZATION_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentLocalizationDeleted,
        entityType: "ContentLocalization",
        entityId: deleted.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: deleted.contentVersionId,
          contentLocalizationId: deleted.id,
          locale: deleted.locale,
        },
      });
      return deleted;
    }),
  );
}

export async function createContentAsset(input: unknown): Promise<ContentAsset> {
  assertContentEnabled();
  const data = parseContentCommand(createContentAssetSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const content = await loadContent(data.contentVersionId, tx);
      assertDraftContent(content);
      // PHASE-G0 CORRECTION — the aggregate authoring boundary. Refuses a
      // submitted or approved version, refuses a stale writer, moves the
      // revision and records THIS server-resolved actor as the substantive
      // author, all inside the caller's transaction so the child write below
      // rolls back with it.
      await guardAggregateChildMutation(tx, {
        kind: "content",
        aggregateId: content.id,
        expectedRevision: data.expectedRevision,
        actorId: data.actorId,
      });
      let created: ContentAsset;
      try {
        created = await tx.contentAsset.create({
          data: {
            contentVersionId: content.id,
            kind: data.kind,
            assetCode: data.assetCode,
            locale: data.locale,
            url: data.url,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            durationSeconds: data.durationSeconds,
            checksum: data.checksum,
            sortOrder: data.sortOrder,
          },
        });
      } catch (error) {
        mapConstraintError(error, "CONTENT_ASSET_CONFLICT", "CONTENT_VERSION_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentAssetCreated,
        entityType: "ContentAsset",
        entityId: created.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: created.contentVersionId,
          contentAssetId: created.id,
          assetCode: created.assetCode,
          sortOrder: created.sortOrder,
          locale: created.locale,
        },
      });
      return created;
    }),
  );
}

export async function updateContentAsset(input: unknown): Promise<ContentAsset> {
  assertContentEnabled();
  const data = parseContentCommand(updateContentAssetSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const asset = await tx.contentAsset.findUnique({ where: { id: data.contentAssetId } });
      if (!asset) {
        throw new ContentDomainError("CONTENT_ASSET_NOT_FOUND", "content asset does not exist");
      }
      const content = await loadContent(asset.contentVersionId, tx);
      assertDraftContent(content);
      // PHASE-G0 CORRECTION — the aggregate authoring boundary. Refuses a
      // submitted or approved version, refuses a stale writer, moves the
      // revision and records THIS server-resolved actor as the substantive
      // author, all inside the caller's transaction so the child write below
      // rolls back with it.
      await guardAggregateChildMutation(tx, {
        kind: "content",
        aggregateId: content.id,
        expectedRevision: data.expectedRevision,
        actorId: data.actorId,
      });
      const patch = stripUndefined(data.patch);
      if (!patchHasChanges(asset as unknown as Record<string, unknown>, patch)) {
        throw new ContentDomainError("CONTENT_NO_CHANGES", "asset update has no changes");
      }
      let updated: ContentAsset;
      try {
        updated = await tx.contentAsset.update({ where: { id: asset.id }, data: patch });
      } catch (error) {
        mapConstraintError(error, "CONTENT_ASSET_CONFLICT", "CONTENT_ASSET_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentAssetUpdated,
        entityType: "ContentAsset",
        entityId: updated.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: updated.contentVersionId,
          contentAssetId: updated.id,
          assetCode: updated.assetCode,
          sortOrder: updated.sortOrder,
          locale: updated.locale,
        },
      });
      return updated;
    }),
  );
}

export async function deleteContentAsset(input: unknown): Promise<ContentAsset> {
  assertContentEnabled();
  const data = parseContentCommand(deleteContentAssetSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAuthor(data.actorId, tx);
      const asset = await tx.contentAsset.findUnique({ where: { id: data.contentAssetId } });
      if (!asset) {
        throw new ContentDomainError("CONTENT_ASSET_NOT_FOUND", "content asset does not exist");
      }
      const content = await loadContent(asset.contentVersionId, tx);
      assertDraftContent(content);
      // PHASE-G0 CORRECTION — the aggregate authoring boundary. Refuses a
      // submitted or approved version, refuses a stale writer, moves the
      // revision and records THIS server-resolved actor as the substantive
      // author, all inside the caller's transaction so the child write below
      // rolls back with it.
      await guardAggregateChildMutation(tx, {
        kind: "content",
        aggregateId: content.id,
        expectedRevision: data.expectedRevision,
        actorId: data.actorId,
      });
      let deleted: ContentAsset;
      try {
        deleted = await tx.contentAsset.delete({ where: { id: asset.id } });
      } catch (error) {
        mapConstraintError(error, "CONTENT_ASSET_CONFLICT", "CONTENT_ASSET_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentAssetDeleted,
        entityType: "ContentAsset",
        entityId: deleted.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: deleted.contentVersionId,
          contentAssetId: deleted.id,
          assetCode: deleted.assetCode,
          sortOrder: deleted.sortOrder,
          locale: deleted.locale,
        },
      });
      return deleted;
    }),
  );
}

async function publishInTransaction(
  data: ReturnType<typeof publishContentVersionSchema.parse>,
): Promise<PublishContentVersionResult> {
  return prisma.$transaction(async (tx) => {
    await assertContentAdmin(data.actorId, tx);
    const content = await loadContentSnapshot(data.contentVersionId, tx);
    assertDraftContent(content);
    const issues = validateContentPublication({
      version: content,
      localizations: content.localizations,
      assets: content.assets,
    });
    if (issues.length > 0) {
      throw new ContentDomainError(
        "CONTENT_PUBLICATION_INVALID",
        "content failed publication validation",
        issues,
      );
    }

    // PHASE-G0 PUBLISH GATE — the governance precondition, checked from DURABLE
    // state inside the publishing transaction and BEFORE anything is written.
    //
    // ORDER: after the accepted publication validation, deliberately. Both run
    // before any write, so the safety is identical either way, and this order
    // preserves every accepted diagnostic — an author whose lesson is missing a
    // localization still gets CONTENT_PUBLICATION_INVALID with its issue codes
    // and its audit row, instead of being told only "get it approved" and
    // discovering the real problem after review. Governance is the LAST thing
    // standing between a valid version and the runtime.
    assertEditoriallyApproved(content, "content");

    const expected = data.expectedPublishedContentVersionId ?? null;
    const currentPublished = await tx.contentVersion.findFirst({
      where: { levelDefinitionId: content.levelDefinitionId, status: "published" },
    });
    if (!currentPublished && expected !== null) {
      throw new ContentDomainError(
        "CONTENT_REPLACEMENT_MISMATCH",
        "there is no published content matching the expected replacement",
      );
    }
    if (currentPublished && expected === null) {
      throw new ContentDomainError(
        "CONTENT_REPLACEMENT_REQUIRED",
        "an explicit expected published content ID is required",
      );
    }
    if (currentPublished && expected !== currentPublished.id) {
      throw new ContentDomainError(
        "CONTENT_REPLACEMENT_MISMATCH",
        "the expected published content ID is stale",
      );
    }

    const now = new Date();
    let replaced: ContentVersion | null = null;
    let bindingMoved = false;
    if (currentPublished) {
      replaced = await tx.contentVersion.update({
        where: { id: currentPublished.id },
        data: { status: "archived", archivedAt: now },
      });
    }
    const published = await tx.contentVersion.update({
      where: { id: content.id },
      data: { status: "published", publishedAt: now },
    });

    const binding = await tx.levelResourceBinding.findUnique({
      where: { levelDefinitionId: content.levelDefinitionId },
    });
    if (replaced && binding?.contentVersionId === replaced.id) {
      await tx.levelResourceBinding.update({
        where: { id: binding.id },
        data: { contentVersionId: published.id },
      });
      bindingMoved = true;
    }

    await writeContentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.contentVersionPublished,
      entityType: "ContentVersion",
      entityId: published.id,
      metadata: {
        actorId: data.actorId,
        contentVersionId: published.id,
        curriculumVersionId: published.curriculumVersionId,
        levelDefinitionId: published.levelDefinitionId,
        versionNumber: published.versionNumber,
        replacedContentVersionId: replaced?.id ?? null,
      },
    });
    if (replaced) {
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentVersionReplaced,
        entityType: "ContentVersion",
        entityId: replaced.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: replaced.id,
          levelDefinitionId: replaced.levelDefinitionId,
          versionNumber: replaced.versionNumber,
          replacedByContentVersionId: published.id,
        },
      });
    }
    if (bindingMoved && binding) {
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentBound,
        entityType: "LevelResourceBinding",
        entityId: binding.id,
        metadata: {
          actorId: data.actorId,
          levelResourceBindingId: binding.id,
          levelDefinitionId: content.levelDefinitionId,
          contentVersionId: published.id,
          replacedContentVersionId: replaced?.id ?? null,
        },
      });
    }
    return { published, replaced, bindingMoved, recovered: false };
  });
}

async function recoverPublicationConflict(
  data: ReturnType<typeof publishContentVersionSchema.parse>,
): Promise<PublishContentVersionResult> {
  const published = await prisma.contentVersion.findUnique({ where: { id: data.contentVersionId } });
  if (!published || published.status !== "published") {
    const current = published
      ? await prisma.contentVersion.findFirst({
          where: { levelDefinitionId: published.levelDefinitionId, status: "published" },
        })
      : null;
    const expected = data.expectedPublishedContentVersionId ?? null;
    if (current && expected === null) {
      throw new ContentDomainError("CONTENT_REPLACEMENT_REQUIRED", "published content already exists");
    }
    if (current && expected !== current.id) {
      throw new ContentDomainError("CONTENT_REPLACEMENT_MISMATCH", "published content changed");
    }
    throw new ContentDomainError("CONTENT_VERSION_CONFLICT", "content publication conflict");
  }
  const current = await prisma.contentVersion.findFirst({
    where: { levelDefinitionId: published.levelDefinitionId, status: "published" },
  });
  if (current?.id !== published.id) {
    throw new ContentDomainError("CONTENT_VERSION_CONFLICT", "published content could not be verified");
  }
  const expected = data.expectedPublishedContentVersionId ?? null;
  const replaced = expected === null
    ? null
    : await prisma.contentVersion.findUnique({ where: { id: expected } });
  if (
    expected !== null &&
    (!replaced || replaced.levelDefinitionId !== published.levelDefinitionId || replaced.status !== "archived")
  ) {
    throw new ContentDomainError("CONTENT_REPLACEMENT_MISMATCH", "replacement state could not be verified");
  }
  const binding = await prisma.levelResourceBinding.findUnique({
    where: { levelDefinitionId: published.levelDefinitionId },
  });
  return {
    published,
    replaced,
    bindingMoved: replaced !== null && binding?.contentVersionId === published.id,
    recovered: true,
  };
}

export async function publishContentVersion(input: unknown): Promise<PublishContentVersionResult> {
  assertContentEnabled();
  const data = parseContentCommand(publishContentVersionSchema, input);
  try {
    return await publishInTransaction(data);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return runSanitized(() => recoverPublicationConflict(data));
    }
    if (isContentDomainError(error, "CONTENT_PUBLICATION_INVALID")) {
      await createAuditLog({
        userId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentPublicationRejected,
        entityType: "ContentVersion",
        entityId: data.contentVersionId,
        metadata: {
          actorId: data.actorId,
          contentVersionId: data.contentVersionId,
          issueCodes: error.issues.map((issue) => issue.code),
        },
      });
      throw error;
    }
    if (isContentDomainError(error)) throw error;
    // PHASE-G0 PUBLISH GATE — the approval refusal is a PRODUCT answer and must
    // reach the caller intact. It is not an internal fault, and flattening it
    // into a 500 would tell an editor nothing about why their lesson did not go
    // live. Same reasoning as the sanitizer pass-through above.
    if (isAuthoringDomainError(error)) throw error;
    throw new ContentDomainError("CONTENT_INTERNAL_ERROR", "content operation failed");
  }
}

export async function archiveContentVersion(input: unknown): Promise<ContentVersion> {
  assertContentEnabled();
  const data = parseContentCommand(archiveContentVersionSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAdmin(data.actorId, tx);
      const content = await loadContent(data.contentVersionId, tx);
      if (content.status === "archived") {
        throw new ContentDomainError("CONTENT_ARCHIVED_IMMUTABLE", "content is already archived");
      }
      if (content.status !== "published") {
        throw new ContentDomainError("CONTENT_VERSION_NOT_DRAFT", "only published content can be archived");
      }
      const binding = await tx.levelResourceBinding.findFirst({
        where: { contentVersionId: content.id },
      });
      if (binding) {
        throw new ContentDomainError(
          "CONTENT_BINDING_CONFLICT",
          "bound published content must be replaced or unbound before archive",
        );
      }
      const archived = await tx.contentVersion.update({
        where: { id: content.id },
        data: { status: "archived", archivedAt: new Date() },
      });
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentVersionArchived,
        entityType: "ContentVersion",
        entityId: archived.id,
        metadata: {
          actorId: data.actorId,
          contentVersionId: archived.id,
          levelDefinitionId: archived.levelDefinitionId,
          versionNumber: archived.versionNumber,
        },
      });
      return archived;
    }),
  );
}

export async function setLevelContentBinding(input: unknown): Promise<LevelResourceBinding> {
  assertContentEnabled();
  const data = parseContentCommand(setContentBindingSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAdmin(data.actorId, tx);
      const level = await loadLevel(data.levelDefinitionId, tx);
      const content = await tx.contentVersion.findUnique({ where: { id: data.contentVersionId } });
      if (!content) {
        throw new ContentDomainError("CONTENT_VERSION_NOT_FOUND", "content version does not exist");
      }
      if (
        content.levelDefinitionId !== level.id ||
        content.curriculumVersionId !== level.curriculumVersionId
      ) {
        throw new ContentDomainError("CONTENT_VERSION_MISMATCH", "content does not belong to the level");
      }
      if (content.status !== "published") {
        throw new ContentDomainError("CONTENT_BINDING_CONFLICT", "only published content can be bound");
      }
      const existing = await tx.levelResourceBinding.findUnique({
        where: { levelDefinitionId: level.id },
      });
      if (existing?.contentVersionId === content.id) {
        throw new ContentDomainError("CONTENT_NO_CHANGES", "content binding has no changes");
      }
      let binding: LevelResourceBinding;
      try {
        binding = existing
          ? await tx.levelResourceBinding.update({
              where: { id: existing.id },
              data: { contentVersionId: content.id },
            })
          : await tx.levelResourceBinding.create({
              data: {
                levelDefinitionId: level.id,
                curriculumVersionId: level.curriculumVersionId,
                contentVersionId: content.id,
                createdById: data.actorId,
              },
            });
      } catch (error) {
        mapConstraintError(error, "CONTENT_BINDING_CONFLICT", "CONTENT_BINDING_NOT_FOUND");
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentBound,
        entityType: "LevelResourceBinding",
        entityId: binding.id,
        metadata: {
          actorId: data.actorId,
          levelResourceBindingId: binding.id,
          levelDefinitionId: binding.levelDefinitionId,
          contentVersionId: binding.contentVersionId,
          assessmentVersionId: binding.assessmentVersionId,
        },
      });
      return binding;
    }),
  );
}

export async function clearLevelContentBinding(input: unknown): Promise<ClearContentBindingResult> {
  assertContentEnabled();
  const data = parseContentCommand(clearContentBindingSchema, input);
  return runSanitized(() =>
    prisma.$transaction(async (tx) => {
      await assertContentAdmin(data.actorId, tx);
      const level = await loadLevel(data.levelDefinitionId, tx);
      const existing = await tx.levelResourceBinding.findUnique({
        where: { levelDefinitionId: level.id },
      });
      if (!existing || existing.contentVersionId === null) {
        throw new ContentDomainError("CONTENT_BINDING_NOT_FOUND", "content binding does not exist");
      }
      const previousContentVersionId = existing.contentVersionId;
      let result: ClearContentBindingResult;
      if (existing.assessmentVersionId === null) {
        await tx.levelResourceBinding.delete({ where: { id: existing.id } });
        result = { binding: null, deleted: true };
      } else {
        const binding = await tx.levelResourceBinding.update({
          where: { id: existing.id },
          data: { contentVersionId: null },
        });
        result = { binding, deleted: false };
      }
      await writeContentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.contentUnbound,
        entityType: "LevelResourceBinding",
        entityId: existing.id,
        metadata: {
          actorId: data.actorId,
          levelResourceBindingId: existing.id,
          levelDefinitionId: existing.levelDefinitionId,
          contentVersionId: previousContentVersionId,
          assessmentVersionId: existing.assessmentVersionId,
          bindingDeleted: result.deleted,
        },
      });
      return result;
    }),
  );
}
