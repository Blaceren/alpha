import type {
  LevelReportBinding,
  ReportAssignmentLocalization,
  ReportAssignmentVersion,
  ReportFieldDefinition,
  ReportFieldLocalization,
  ReportRejectionReason,
  ReportRejectionReasonLocalization,
  ReportRubricCriterion,
  ReportRubricCriterionLocalization,
  ReportRubricScaleOption,
  ReportRubricScaleOptionLocalization,
  ReportRubricVersion,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { ReportDomainError, isReportDomainError } from "@/lib/curriculum/report-errors";
import {
  archiveReportAssignmentSchema,
  archiveReportRubricSchema,
  clearReportBindingSchema,
  createReportAssignmentLocalizationSchema,
  createReportAssignmentSchema,
  createReportCriterionLocalizationSchema,
  createReportCriterionSchema,
  createReportFieldLocalizationSchema,
  createReportFieldSchema,
  createReportReasonLocalizationSchema,
  createReportReasonSchema,
  createReportRubricSchema,
  createReportScaleLocalizationSchema,
  createReportScaleOptionSchema,
  deleteReportAssignmentLocalizationSchema,
  deleteReportAssignmentSchema,
  deleteReportCriterionLocalizationSchema,
  deleteReportCriterionSchema,
  deleteReportFieldLocalizationSchema,
  deleteReportFieldSchema,
  deleteReportReasonLocalizationSchema,
  deleteReportReasonSchema,
  deleteReportRubricSchema,
  deleteReportScaleLocalizationSchema,
  deleteReportScaleOptionSchema,
  publishReportAssignmentSchema,
  publishReportRubricSchema,
  reportFieldDefinitionPayloadSchema,
  setReportBindingSchema,
  updateReportAssignmentLocalizationSchema,
  updateReportAssignmentSchema,
  updateReportCriterionLocalizationSchema,
  updateReportCriterionSchema,
  updateReportFieldLocalizationSchema,
  updateReportFieldSchema,
  updateReportReasonLocalizationSchema,
  updateReportReasonSchema,
  updateReportRubricSchema,
  updateReportScaleLocalizationSchema,
  updateReportScaleOptionSchema,
} from "@/lib/curriculum/report-schemas";
import {
  parseReportCommand,
  validateReportAssignmentPublication,
  validateReportRubricPublication,
} from "@/lib/curriculum/report-validation";
import { isCurriculumV2ReportEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;
type AssignmentContext = Prisma.ReportAssignmentVersionGetPayload<{
  include: { levelDefinition: { include: { curriculumVersion: true } } };
}>;
type RubricContext = Prisma.ReportRubricVersionGetPayload<{
  include: { assignment: { include: { levelDefinition: { include: { curriculumVersion: true } } } } };
}>;
type AssignmentSnapshot = Prisma.ReportAssignmentVersionGetPayload<{
  include: {
    levelDefinition: { include: { curriculumVersion: true } };
    localizations: true;
    fields: { include: { localizations: true } };
  };
}>;
type RubricSnapshot = Prisma.ReportRubricVersionGetPayload<{
  include: {
    assignment: { include: { levelDefinition: { include: { curriculumVersion: true } } } };
    criteria: { include: { localizations: true } };
    scaleOptions: { include: { localizations: true } };
    rejectionReasons: { include: { localizations: true } };
  };
}>;

export type PublishReportAssignmentResult = {
  published: ReportAssignmentVersion;
  replaced: ReportAssignmentVersion | null;
  binding: LevelReportBinding | null;
  recovered: boolean;
};

export type PublishReportRubricResult = {
  published: ReportRubricVersion;
  replaced: ReportRubricVersion | null;
  binding: LevelReportBinding | null;
  recovered: boolean;
};

function assertReportEnabled() {
  if (!isCurriculumV2ReportEnabled()) {
    throw new ReportDomainError("REPORT_DISABLED", "V2 report-definition mutations are disabled");
  }
}

async function assertReportAdmin(actorId: number, tx: DbClient) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.role !== "admin" || actor.status !== "active") {
    throw new ReportDomainError("REPORT_ACTOR_FORBIDDEN", "report authoring requires an active admin actor");
  }
  return actor;
}

function assertParentDraft(status: string) {
  if (status === "published") throw new ReportDomainError("REPORT_PUBLISHED_IMMUTABLE", "published curriculum is immutable");
  if (status === "archived") throw new ReportDomainError("REPORT_ARCHIVED_IMMUTABLE", "archived curriculum is immutable");
  if (status !== "draft") throw new ReportDomainError("REPORT_VERSION_MISMATCH", "curriculum is not an editable draft");
}

function assertDraft(status: string, entity: "assignment" | "rubric") {
  if (status === "published") throw new ReportDomainError("REPORT_PUBLISHED_IMMUTABLE", `published ${entity} is immutable`);
  if (status === "archived") throw new ReportDomainError("REPORT_ARCHIVED_IMMUTABLE", `archived ${entity} is immutable`);
  if (status !== "draft") {
    throw new ReportDomainError(entity === "assignment" ? "REPORT_ASSIGNMENT_NOT_DRAFT" : "REPORT_RUBRIC_CONFLICT", `${entity} is not a draft`);
  }
}

async function loadReportLevel(levelDefinitionId: number, tx: DbClient) {
  const level = await tx.levelDefinition.findUnique({ where: { id: levelDefinitionId }, include: { curriculumVersion: true } });
  if (!level) throw new ReportDomainError("REPORT_LEVEL_NOT_FOUND", "level does not exist");
  assertParentDraft(level.curriculumVersion.status);
  if (level.type !== "report" || level.completionMethod !== "report_approval") {
    throw new ReportDomainError("REPORT_LEVEL_TYPE_INVALID", "report authoring requires a report/report_approval level");
  }
  return level;
}

async function loadAssignment(id: number, tx: DbClient): Promise<AssignmentContext> {
  const assignment = await tx.reportAssignmentVersion.findUnique({
    where: { id }, include: { levelDefinition: { include: { curriculumVersion: true } } },
  });
  if (!assignment) throw new ReportDomainError("REPORT_ASSIGNMENT_NOT_FOUND", "report assignment does not exist");
  if (assignment.curriculumVersionId !== assignment.levelDefinition.curriculumVersionId) {
    throw new ReportDomainError("REPORT_VERSION_MISMATCH", "assignment curriculum ownership is inconsistent");
  }
  assertParentDraft(assignment.levelDefinition.curriculumVersion.status);
  if (assignment.levelDefinition.type !== "report" || assignment.levelDefinition.completionMethod !== "report_approval") {
    throw new ReportDomainError("REPORT_LEVEL_TYPE_INVALID", "assignment owner is not a report level");
  }
  return assignment;
}

async function loadRubric(id: number, tx: DbClient): Promise<RubricContext> {
  const rubric = await tx.reportRubricVersion.findUnique({
    where: { id },
    include: { assignment: { include: { levelDefinition: { include: { curriculumVersion: true } } } } },
  });
  if (!rubric) throw new ReportDomainError("REPORT_RUBRIC_NOT_FOUND", "report rubric does not exist");
  if (rubric.assignment.curriculumVersionId !== rubric.assignment.levelDefinition.curriculumVersionId) {
    throw new ReportDomainError("REPORT_VERSION_MISMATCH", "rubric assignment ownership is inconsistent");
  }
  assertParentDraft(rubric.assignment.levelDefinition.curriculumVersion.status);
  if (rubric.assignment.status === "archived") {
    throw new ReportDomainError("REPORT_ARCHIVED_IMMUTABLE", "archived assignment rubric graph is immutable");
  }
  return rubric;
}

async function writeReportAudit(tx: DbClient, input: {
  actorId: number; action: string; entityType: string; entityId: number; metadata: Prisma.InputJsonValue;
}) {
  await tx.auditLog.create({ data: {
    userId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: String(input.entityId),
    metadata: input.metadata,
  } });
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
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

function nullableJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function isPrismaCode(error: unknown, ...codes: string[]) {
  return error instanceof Prisma.PrismaClientKnownRequestError && codes.includes(error.code);
}

async function assertNoAssignmentConflict(tx: DbClient, levelDefinitionId: number, versionNumber: number, excludeId?: number) {
  const conflict = await tx.reportAssignmentVersion.findFirst({ where: {
    levelDefinitionId, versionNumber, ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
  } });
  if (conflict) throw new ReportDomainError("REPORT_ASSIGNMENT_CONFLICT", "assignment version conflicts with an existing row");
}

async function assertNoFieldConflict(tx: DbClient, assignmentId: number, stableKey: string, sortOrder: number, excludeId?: number) {
  const conflict = await tx.reportFieldDefinition.findFirst({ where: {
    reportAssignmentVersionId: assignmentId,
    OR: [{ stableKey }, { sortOrder }],
    ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
  } });
  if (conflict) throw new ReportDomainError("REPORT_ASSIGNMENT_CONFLICT", "field key or order conflicts with an existing field");
}

export async function createReportAssignment(input: unknown): Promise<ReportAssignmentVersion> {
  assertReportEnabled();
  const data = parseReportCommand(createReportAssignmentSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const level = await loadReportLevel(data.levelDefinitionId, tx);
    const maximum = await tx.reportAssignmentVersion.aggregate({ where: { levelDefinitionId: level.id }, _max: { versionNumber: true } });
    const versionNumber = (maximum._max.versionNumber ?? 0) + 1;
    await assertNoAssignmentConflict(tx, level.id, versionNumber);
    let created: ReportAssignmentVersion;
    try {
      created = await tx.reportAssignmentVersion.create({ data: {
        levelDefinitionId: level.id,
        curriculumVersionId: level.curriculumVersionId,
        versionNumber,
        changeNotes: data.changeNotes ?? null,
        createdById: data.actorId,
      } });
    } catch (error) {
      if (isPrismaCode(error, "P2002")) {
        await assertNoAssignmentConflict(tx, level.id, versionNumber);
      }
      throw error;
    }
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentCreated, entityType: "ReportAssignmentVersion", entityId: created.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: created.id, curriculumVersionId: created.curriculumVersionId,
      levelDefinitionId: created.levelDefinitionId, versionNumber: created.versionNumber,
    } });
    return created;
  });
}

export async function updateReportAssignment(input: unknown): Promise<ReportAssignmentVersion> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportAssignmentSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const assignment = await loadAssignment(data.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(assignment as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "assignment update has no changes");
    const updated = await tx.reportAssignmentVersion.update({ where: { id: assignment.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentUpdated, entityType: "ReportAssignmentVersion", entityId: updated.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: updated.id, levelDefinitionId: updated.levelDefinitionId, versionNumber: updated.versionNumber,
    } });
    return updated;
  });
}

export async function deleteReportAssignment(input: unknown): Promise<ReportAssignmentVersion> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportAssignmentSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const assignment = await loadAssignment(data.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    const [localizations, fields, rubrics, bindings, submissions] = await Promise.all([
      tx.reportAssignmentLocalization.count({ where: { reportAssignmentVersionId: assignment.id } }),
      tx.reportFieldDefinition.count({ where: { reportAssignmentVersionId: assignment.id } }),
      tx.reportRubricVersion.count({ where: { reportAssignmentVersionId: assignment.id } }),
      tx.levelReportBinding.count({ where: { reportAssignmentVersionId: assignment.id } }),
      tx.reportSubmission.count({ where: { reportAssignmentVersionId: assignment.id } }),
    ]);
    if (localizations + fields + rubrics + bindings + submissions > 0) throw new ReportDomainError("REPORT_NOT_EMPTY", "only an empty unbound assignment draft can be deleted");
    const deleted = await tx.reportAssignmentVersion.delete({ where: { id: assignment.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentDeleted, entityType: "ReportAssignmentVersion", entityId: deleted.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: deleted.id, levelDefinitionId: deleted.levelDefinitionId, versionNumber: deleted.versionNumber,
    } });
    return deleted;
  });
}

export async function createReportAssignmentLocalization(input: unknown): Promise<ReportAssignmentLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(createReportAssignmentLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const assignment = await loadAssignment(data.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    const existing = await tx.reportAssignmentLocalization.findUnique({ where: { reportAssignmentVersionId_locale: { reportAssignmentVersionId: assignment.id, locale: data.locale } } });
    if (existing) throw new ReportDomainError("REPORT_ASSIGNMENT_CONFLICT", "assignment locale already exists");
    const created = await tx.reportAssignmentLocalization.create({ data: {
      reportAssignmentVersionId: assignment.id, locale: data.locale, title: data.title, instructions: data.instructions,
      successCriteriaSummary: data.successCriteriaSummary, submitLabel: data.submitLabel,
    } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentLocalizationCreated, entityType: "ReportAssignmentLocalization", entityId: created.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportAssignmentLocalizationId: created.id, locale: created.locale,
    } });
    return created;
  });
}

export async function updateReportAssignmentLocalization(input: unknown): Promise<ReportAssignmentLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportAssignmentLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportAssignmentLocalization.findUnique({ where: { id: data.reportAssignmentLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_LOCALIZATION_NOT_FOUND", "assignment localization does not exist");
    const assignment = await loadAssignment(localization.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(localization as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "localization update has no changes");
    if (patch.locale !== undefined) {
      const conflict = await tx.reportAssignmentLocalization.findFirst({ where: { reportAssignmentVersionId: assignment.id, locale: patch.locale, id: { not: localization.id } } });
      if (conflict) throw new ReportDomainError("REPORT_ASSIGNMENT_CONFLICT", "assignment locale already exists");
    }
    const updated = await tx.reportAssignmentLocalization.update({ where: { id: localization.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentLocalizationUpdated, entityType: "ReportAssignmentLocalization", entityId: updated.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportAssignmentLocalizationId: updated.id, locale: updated.locale,
    } });
    return updated;
  });
}

export async function deleteReportAssignmentLocalization(input: unknown): Promise<ReportAssignmentLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportAssignmentLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportAssignmentLocalization.findUnique({ where: { id: data.reportAssignmentLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_LOCALIZATION_NOT_FOUND", "assignment localization does not exist");
    const assignment = await loadAssignment(localization.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    const deleted = await tx.reportAssignmentLocalization.delete({ where: { id: localization.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentLocalizationDeleted, entityType: "ReportAssignmentLocalization", entityId: deleted.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportAssignmentLocalizationId: deleted.id, locale: deleted.locale,
    } });
    return deleted;
  });
}

function parseFieldPayload(value: { stableKey: string; type: string; required: boolean; sortOrder: number; validationRules: unknown; choiceCodes: unknown }) {
  return parseReportCommand(reportFieldDefinitionPayloadSchema, {
    stableKey: value.stableKey,
    type: value.type,
    required: value.required,
    sortOrder: value.sortOrder,
    validationRules: value.validationRules,
    choiceCodes: value.choiceCodes,
  });
}

export async function createReportField(input: unknown): Promise<ReportFieldDefinition> {
  assertReportEnabled();
  const data = parseReportCommand(createReportFieldSchema, input);
  const field = parseFieldPayload(data);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const assignment = await loadAssignment(data.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    await assertNoFieldConflict(tx, assignment.id, field.stableKey, field.sortOrder);
    const created = await tx.reportFieldDefinition.create({ data: {
      reportAssignmentVersionId: assignment.id, stableKey: field.stableKey, type: field.type, required: field.required,
      sortOrder: field.sortOrder, validationRules: nullableJson(field.validationRules),
      choiceCodes: nullableJson(field.choiceCodes),
    } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportFieldCreated, entityType: "ReportFieldDefinition", entityId: created.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportFieldDefinitionId: created.id, stableKey: created.stableKey, sortOrder: created.sortOrder,
    } });
    return created;
  });
}

export async function updateReportField(input: unknown): Promise<ReportFieldDefinition> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportFieldSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const existing = await tx.reportFieldDefinition.findUnique({ where: { id: data.reportFieldDefinitionId } });
    if (!existing) throw new ReportDomainError("REPORT_FIELD_NOT_FOUND", "report field does not exist");
    const assignment = await loadAssignment(existing.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    const patch = stripUndefined(data.patch);
    const merged = parseFieldPayload({
      stableKey: (patch.stableKey ?? existing.stableKey) as string,
      type: (patch.type ?? existing.type) as string,
      required: (patch.required ?? existing.required) as boolean,
      sortOrder: (patch.sortOrder ?? existing.sortOrder) as number,
      validationRules: patch.validationRules === undefined ? existing.validationRules : patch.validationRules,
      choiceCodes: patch.choiceCodes === undefined ? existing.choiceCodes : patch.choiceCodes,
    });
    if (!patchHasChanges(existing as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "field update has no changes");
    await assertNoFieldConflict(tx, assignment.id, merged.stableKey, merged.sortOrder, existing.id);
    const updated = await tx.reportFieldDefinition.update({ where: { id: existing.id }, data: {
      stableKey: merged.stableKey, type: merged.type, required: merged.required, sortOrder: merged.sortOrder,
      validationRules: nullableJson(merged.validationRules),
      choiceCodes: nullableJson(merged.choiceCodes),
    } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportFieldUpdated, entityType: "ReportFieldDefinition", entityId: updated.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportFieldDefinitionId: updated.id, stableKey: updated.stableKey, sortOrder: updated.sortOrder,
    } });
    return updated;
  });
}

export async function deleteReportField(input: unknown): Promise<ReportFieldDefinition> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportFieldSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const field = await tx.reportFieldDefinition.findUnique({ where: { id: data.reportFieldDefinitionId } });
    if (!field) throw new ReportDomainError("REPORT_FIELD_NOT_FOUND", "report field does not exist");
    const assignment = await loadAssignment(field.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    if (await tx.reportFieldLocalization.count({ where: { reportFieldDefinitionId: field.id } })) throw new ReportDomainError("REPORT_NOT_EMPTY", "field localization must be deleted first");
    const deleted = await tx.reportFieldDefinition.delete({ where: { id: field.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportFieldDeleted, entityType: "ReportFieldDefinition", entityId: deleted.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportFieldDefinitionId: deleted.id, stableKey: deleted.stableKey, sortOrder: deleted.sortOrder,
    } });
    return deleted;
  });
}

function assertChoiceLabels(field: ReportFieldDefinition, choiceLabels: unknown) {
  const choiceField = field.type === "single_choice" || field.type === "multi_choice";
  if (!choiceField) {
    if (choiceLabels !== null) throw new ReportDomainError("REPORT_INPUT_INVALID", "non-choice field localization must not contain choice labels");
    return;
  }
  const codes = Array.isArray(field.choiceCodes) ? field.choiceCodes.filter((item): item is string => typeof item === "string").sort() : [];
  if (choiceLabels === null || typeof choiceLabels !== "object" || Array.isArray(choiceLabels)) throw new ReportDomainError("REPORT_INPUT_INVALID", "choice field localization requires choice labels");
  const labels = Object.keys(choiceLabels as Record<string, unknown>).sort();
  if (JSON.stringify(codes) !== JSON.stringify(labels)) throw new ReportDomainError("REPORT_INPUT_INVALID", "choice labels must match exact stable choice codes");
}

export async function createReportFieldLocalization(input: unknown): Promise<ReportFieldLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(createReportFieldLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const field = await tx.reportFieldDefinition.findUnique({ where: { id: data.reportFieldDefinitionId } });
    if (!field) throw new ReportDomainError("REPORT_FIELD_NOT_FOUND", "report field does not exist");
    const assignment = await loadAssignment(field.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    assertChoiceLabels(field, data.choiceLabels);
    const conflict = await tx.reportFieldLocalization.findUnique({ where: { reportFieldDefinitionId_locale: { reportFieldDefinitionId: field.id, locale: data.locale } } });
    if (conflict) throw new ReportDomainError("REPORT_ASSIGNMENT_CONFLICT", "field locale already exists");
    const created = await tx.reportFieldLocalization.create({ data: {
      reportFieldDefinitionId: field.id, locale: data.locale, label: data.label, helpText: data.helpText,
      placeholder: data.placeholder, choiceLabels: nullableJson(data.choiceLabels),
    } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportFieldLocalizationCreated, entityType: "ReportFieldLocalization", entityId: created.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportFieldDefinitionId: field.id, reportFieldLocalizationId: created.id, locale: created.locale,
    } });
    return created;
  });
}

export async function updateReportFieldLocalization(input: unknown): Promise<ReportFieldLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportFieldLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportFieldLocalization.findUnique({ where: { id: data.reportFieldLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_FIELD_LOCALIZATION_NOT_FOUND", "field localization does not exist");
    const field = await tx.reportFieldDefinition.findUnique({ where: { id: localization.reportFieldDefinitionId } });
    if (!field) throw new ReportDomainError("REPORT_FIELD_NOT_FOUND", "report field does not exist");
    const assignment = await loadAssignment(field.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(localization as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "field localization update has no changes");
    assertChoiceLabels(field, patch.choiceLabels === undefined ? localization.choiceLabels : patch.choiceLabels);
    if (patch.locale !== undefined) {
      const conflict = await tx.reportFieldLocalization.findFirst({ where: { reportFieldDefinitionId: field.id, locale: patch.locale, id: { not: localization.id } } });
      if (conflict) throw new ReportDomainError("REPORT_ASSIGNMENT_CONFLICT", "field locale already exists");
    }
    const { choiceLabels, ...scalarPatch } = patch;
    const updated = await tx.reportFieldLocalization.update({ where: { id: localization.id }, data: {
      ...scalarPatch,
      ...(choiceLabels === undefined ? {} : { choiceLabels: nullableJson(choiceLabels) }),
    } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportFieldLocalizationUpdated, entityType: "ReportFieldLocalization", entityId: updated.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportFieldDefinitionId: field.id, reportFieldLocalizationId: updated.id, locale: updated.locale,
    } });
    return updated;
  });
}

export async function deleteReportFieldLocalization(input: unknown): Promise<ReportFieldLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportFieldLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportFieldLocalization.findUnique({ where: { id: data.reportFieldLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_FIELD_LOCALIZATION_NOT_FOUND", "field localization does not exist");
    const field = await tx.reportFieldDefinition.findUnique({ where: { id: localization.reportFieldDefinitionId } });
    if (!field) throw new ReportDomainError("REPORT_FIELD_NOT_FOUND", "report field does not exist");
    const assignment = await loadAssignment(field.reportAssignmentVersionId, tx);
    assertDraft(assignment.status, "assignment");
    const deleted = await tx.reportFieldLocalization.delete({ where: { id: localization.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportFieldLocalizationDeleted, entityType: "ReportFieldLocalization", entityId: deleted.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportFieldDefinitionId: field.id, reportFieldLocalizationId: deleted.id, locale: deleted.locale,
    } });
    return deleted;
  });
}

async function assertNoRubricConflict(tx: DbClient, assignmentId: number, versionNumber: number) {
  const conflict = await tx.reportRubricVersion.findFirst({ where: { reportAssignmentVersionId: assignmentId, versionNumber } });
  if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "rubric version conflicts with an existing row");
}

async function assertNoCriterionConflict(tx: DbClient, rubricId: number, stableKey: string, sortOrder: number, excludeId?: number) {
  const conflict = await tx.reportRubricCriterion.findFirst({ where: {
    reportRubricVersionId: rubricId, OR: [{ stableKey }, { sortOrder }],
    ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
  } });
  if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "criterion key or order conflicts with an existing criterion");
}

async function assertNoScaleConflict(tx: DbClient, rubricId: number, stableKey: string, ordinal: number, excludeId?: number) {
  const conflict = await tx.reportRubricScaleOption.findFirst({ where: {
    reportRubricVersionId: rubricId, OR: [{ stableKey }, { ordinal }],
    ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
  } });
  if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "scale key or ordinal conflicts with an existing option");
}

async function assertNoReasonConflict(tx: DbClient, rubricId: number, stableKey: string, sortOrder: number, excludeId?: number) {
  const conflict = await tx.reportRejectionReason.findFirst({ where: {
    reportRubricVersionId: rubricId, OR: [{ stableKey }, { sortOrder }],
    ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
  } });
  if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "reason key or order conflicts with an existing reason");
}

export async function createReportRubric(input: unknown): Promise<ReportRubricVersion> {
  assertReportEnabled();
  const data = parseReportCommand(createReportRubricSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const assignment = await loadAssignment(data.reportAssignmentVersionId, tx);
    if (assignment.status === "archived") throw new ReportDomainError("REPORT_ARCHIVED_IMMUTABLE", "archived assignment cannot receive a rubric version");
    const maximum = await tx.reportRubricVersion.aggregate({ where: { reportAssignmentVersionId: assignment.id }, _max: { versionNumber: true } });
    const versionNumber = (maximum._max.versionNumber ?? 0) + 1;
    await assertNoRubricConflict(tx, assignment.id, versionNumber);
    const created = await tx.reportRubricVersion.create({ data: {
      reportAssignmentVersionId: assignment.id, versionNumber, changeNotes: data.changeNotes ?? null, createdById: data.actorId,
    } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportRubricCreated, entityType: "ReportRubricVersion", entityId: created.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: assignment.id, reportRubricVersionId: created.id, versionNumber: created.versionNumber,
    } });
    return created;
  });
}

export async function updateReportRubric(input: unknown): Promise<ReportRubricVersion> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportRubricSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const rubric = await loadRubric(data.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(rubric as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "rubric update has no changes");
    const updated = await tx.reportRubricVersion.update({ where: { id: rubric.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportRubricUpdated, entityType: "ReportRubricVersion", entityId: updated.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: updated.reportAssignmentVersionId, reportRubricVersionId: updated.id, versionNumber: updated.versionNumber,
    } });
    return updated;
  });
}

export async function deleteReportRubric(input: unknown): Promise<ReportRubricVersion> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportRubricSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const rubric = await loadRubric(data.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    const [criteria, scale, reasons, bindings, submissions, reviews] = await Promise.all([
      tx.reportRubricCriterion.count({ where: { reportRubricVersionId: rubric.id } }),
      tx.reportRubricScaleOption.count({ where: { reportRubricVersionId: rubric.id } }),
      tx.reportRejectionReason.count({ where: { reportRubricVersionId: rubric.id } }),
      tx.levelReportBinding.count({ where: { reportRubricVersionId: rubric.id } }),
      tx.reportSubmission.count({ where: { reportRubricVersionId: rubric.id } }),
      tx.reportReview.count({ where: { reportRubricVersionId: rubric.id } }),
    ]);
    if (criteria + scale + reasons + bindings + submissions + reviews > 0) throw new ReportDomainError("REPORT_NOT_EMPTY", "only an empty unreferenced rubric draft can be deleted");
    const deleted = await tx.reportRubricVersion.delete({ where: { id: rubric.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportRubricDeleted, entityType: "ReportRubricVersion", entityId: deleted.id, metadata: {
      actorId: data.actorId, reportAssignmentVersionId: deleted.reportAssignmentVersionId, reportRubricVersionId: deleted.id, versionNumber: deleted.versionNumber,
    } });
    return deleted;
  });
}

export async function createReportCriterion(input: unknown): Promise<ReportRubricCriterion> {
  assertReportEnabled();
  const data = parseReportCommand(createReportCriterionSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const rubric = await loadRubric(data.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    await assertNoCriterionConflict(tx, rubric.id, data.stableKey, data.sortOrder);
    const created = await tx.reportRubricCriterion.create({ data: {
      reportRubricVersionId: rubric.id, stableKey: data.stableKey, categoryCode: data.categoryCode,
      sortOrder: data.sortOrder, commentRequired: data.commentRequired,
    } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportCriterionCreated, entityType: "ReportRubricCriterion", entityId: created.id, metadata: {
      actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricCriterionId: created.id, stableKey: created.stableKey, sortOrder: created.sortOrder,
    } });
    return created;
  });
}

export async function updateReportCriterion(input: unknown): Promise<ReportRubricCriterion> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportCriterionSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const criterion = await tx.reportRubricCriterion.findUnique({ where: { id: data.reportRubricCriterionId } });
    if (!criterion) throw new ReportDomainError("REPORT_CRITERION_NOT_FOUND", "criterion does not exist");
    const rubric = await loadRubric(criterion.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(criterion as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "criterion update has no changes");
    await assertNoCriterionConflict(tx, rubric.id, (patch.stableKey ?? criterion.stableKey) as string, (patch.sortOrder ?? criterion.sortOrder) as number, criterion.id);
    const updated = await tx.reportRubricCriterion.update({ where: { id: criterion.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportCriterionUpdated, entityType: "ReportRubricCriterion", entityId: updated.id, metadata: {
      actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricCriterionId: updated.id, stableKey: updated.stableKey, sortOrder: updated.sortOrder,
    } });
    return updated;
  });
}

export async function deleteReportCriterion(input: unknown): Promise<ReportRubricCriterion> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportCriterionSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const criterion = await tx.reportRubricCriterion.findUnique({ where: { id: data.reportRubricCriterionId } });
    if (!criterion) throw new ReportDomainError("REPORT_CRITERION_NOT_FOUND", "criterion does not exist");
    const rubric = await loadRubric(criterion.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    const [localizations, scores] = await Promise.all([
      tx.reportRubricCriterionLocalization.count({ where: { reportRubricCriterionId: criterion.id } }),
      tx.reportReviewScore.count({ where: { rubricCriterionId: criterion.id } }),
    ]);
    if (localizations + scores > 0) throw new ReportDomainError("REPORT_NOT_EMPTY", "criterion is referenced or localized");
    const deleted = await tx.reportRubricCriterion.delete({ where: { id: criterion.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportCriterionDeleted, entityType: "ReportRubricCriterion", entityId: deleted.id, metadata: {
      actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricCriterionId: deleted.id, stableKey: deleted.stableKey, sortOrder: deleted.sortOrder,
    } });
    return deleted;
  });
}

export async function createReportCriterionLocalization(input: unknown): Promise<ReportRubricCriterionLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(createReportCriterionLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const criterion = await tx.reportRubricCriterion.findUnique({ where: { id: data.reportRubricCriterionId } });
    if (!criterion) throw new ReportDomainError("REPORT_CRITERION_NOT_FOUND", "criterion does not exist");
    const rubric = await loadRubric(criterion.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    const conflict = await tx.reportRubricCriterionLocalization.findUnique({ where: { reportRubricCriterionId_locale: { reportRubricCriterionId: criterion.id, locale: data.locale } } });
    if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "criterion locale already exists");
    const created = await tx.reportRubricCriterionLocalization.create({ data: {
      reportRubricCriterionId: criterion.id, locale: data.locale, title: data.title, description: data.description,
    } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportCriterionLocalizationCreated, entityType: "ReportRubricCriterionLocalization", entityId: created.id, metadata: {
      actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricCriterionId: criterion.id, reportRubricCriterionLocalizationId: created.id, locale: created.locale,
    } });
    return created;
  });
}

export async function updateReportCriterionLocalization(input: unknown): Promise<ReportRubricCriterionLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportCriterionLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportRubricCriterionLocalization.findUnique({ where: { id: data.reportRubricCriterionLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_CRITERION_LOCALIZATION_NOT_FOUND", "criterion localization does not exist");
    const criterion = await tx.reportRubricCriterion.findUnique({ where: { id: localization.reportRubricCriterionId } });
    if (!criterion) throw new ReportDomainError("REPORT_CRITERION_NOT_FOUND", "criterion does not exist");
    const rubric = await loadRubric(criterion.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(localization as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "criterion localization update has no changes");
    if (patch.locale !== undefined) {
      const conflict = await tx.reportRubricCriterionLocalization.findFirst({ where: { reportRubricCriterionId: criterion.id, locale: patch.locale, id: { not: localization.id } } });
      if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "criterion locale already exists");
    }
    const updated = await tx.reportRubricCriterionLocalization.update({ where: { id: localization.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportCriterionLocalizationUpdated, entityType: "ReportRubricCriterionLocalization", entityId: updated.id, metadata: {
      actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricCriterionId: criterion.id, reportRubricCriterionLocalizationId: updated.id, locale: updated.locale,
    } });
    return updated;
  });
}

export async function deleteReportCriterionLocalization(input: unknown): Promise<ReportRubricCriterionLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportCriterionLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportRubricCriterionLocalization.findUnique({ where: { id: data.reportRubricCriterionLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_CRITERION_LOCALIZATION_NOT_FOUND", "criterion localization does not exist");
    const criterion = await tx.reportRubricCriterion.findUnique({ where: { id: localization.reportRubricCriterionId } });
    if (!criterion) throw new ReportDomainError("REPORT_CRITERION_NOT_FOUND", "criterion does not exist");
    const rubric = await loadRubric(criterion.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    const deleted = await tx.reportRubricCriterionLocalization.delete({ where: { id: localization.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportCriterionLocalizationDeleted, entityType: "ReportRubricCriterionLocalization", entityId: deleted.id, metadata: {
      actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricCriterionId: criterion.id, reportRubricCriterionLocalizationId: deleted.id, locale: deleted.locale,
    } });
    return deleted;
  });
}

async function loadScaleOption(id: number, tx: DbClient) {
  const option = await tx.reportRubricScaleOption.findUnique({ where: { id } });
  if (!option) throw new ReportDomainError("REPORT_SCALE_OPTION_NOT_FOUND", "scale option does not exist");
  const rubric = await loadRubric(option.reportRubricVersionId, tx);
  assertDraft(rubric.status, "rubric");
  return { option, rubric };
}

export async function createReportScaleOption(input: unknown): Promise<ReportRubricScaleOption> {
  assertReportEnabled();
  const data = parseReportCommand(createReportScaleOptionSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const rubric = await loadRubric(data.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    await assertNoScaleConflict(tx, rubric.id, data.stableKey, data.ordinal);
    const created = await tx.reportRubricScaleOption.create({ data: { reportRubricVersionId: rubric.id, stableKey: data.stableKey, ordinal: data.ordinal } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportScaleOptionCreated, entityType: "ReportRubricScaleOption", entityId: created.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricScaleOptionId: created.id, stableKey: created.stableKey, ordinal: created.ordinal } });
    return created;
  });
}

export async function updateReportScaleOption(input: unknown): Promise<ReportRubricScaleOption> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportScaleOptionSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const { option, rubric } = await loadScaleOption(data.reportRubricScaleOptionId, tx);
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(option as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "scale option update has no changes");
    await assertNoScaleConflict(tx, rubric.id, patch.stableKey ?? option.stableKey, patch.ordinal ?? option.ordinal, option.id);
    const updated = await tx.reportRubricScaleOption.update({ where: { id: option.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportScaleOptionUpdated, entityType: "ReportRubricScaleOption", entityId: updated.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricScaleOptionId: updated.id, stableKey: updated.stableKey, ordinal: updated.ordinal } });
    return updated;
  });
}

export async function deleteReportScaleOption(input: unknown): Promise<ReportRubricScaleOption> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportScaleOptionSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const { option, rubric } = await loadScaleOption(data.reportRubricScaleOptionId, tx);
    const [localizations, scores] = await Promise.all([
      tx.reportRubricScaleOptionLocalization.count({ where: { reportRubricScaleOptionId: option.id } }),
      tx.reportReviewScore.count({ where: { rubricScaleOptionId: option.id } }),
    ]);
    if (localizations + scores > 0) throw new ReportDomainError("REPORT_NOT_EMPTY", "scale option is referenced or localized");
    const deleted = await tx.reportRubricScaleOption.delete({ where: { id: option.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportScaleOptionDeleted, entityType: "ReportRubricScaleOption", entityId: deleted.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricScaleOptionId: deleted.id, stableKey: deleted.stableKey, ordinal: deleted.ordinal } });
    return deleted;
  });
}

export async function createReportScaleLocalization(input: unknown): Promise<ReportRubricScaleOptionLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(createReportScaleLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const { option, rubric } = await loadScaleOption(data.reportRubricScaleOptionId, tx);
    const conflict = await tx.reportRubricScaleOptionLocalization.findUnique({ where: { reportRubricScaleOptionId_locale: { reportRubricScaleOptionId: option.id, locale: data.locale } } });
    if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "scale locale already exists");
    const created = await tx.reportRubricScaleOptionLocalization.create({ data: { reportRubricScaleOptionId: option.id, locale: data.locale, label: data.label, description: data.description } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportScaleLocalizationCreated, entityType: "ReportRubricScaleOptionLocalization", entityId: created.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricScaleOptionId: option.id, reportRubricScaleOptionLocalizationId: created.id, locale: created.locale } });
    return created;
  });
}

export async function updateReportScaleLocalization(input: unknown): Promise<ReportRubricScaleOptionLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportScaleLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportRubricScaleOptionLocalization.findUnique({ where: { id: data.reportRubricScaleOptionLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_SCALE_LOCALIZATION_NOT_FOUND", "scale localization does not exist");
    const { option, rubric } = await loadScaleOption(localization.reportRubricScaleOptionId, tx);
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(localization as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "scale localization update has no changes");
    if (patch.locale !== undefined) {
      const conflict = await tx.reportRubricScaleOptionLocalization.findFirst({ where: { reportRubricScaleOptionId: option.id, locale: patch.locale, id: { not: localization.id } } });
      if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "scale locale already exists");
    }
    const updated = await tx.reportRubricScaleOptionLocalization.update({ where: { id: localization.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportScaleLocalizationUpdated, entityType: "ReportRubricScaleOptionLocalization", entityId: updated.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricScaleOptionId: option.id, reportRubricScaleOptionLocalizationId: updated.id, locale: updated.locale } });
    return updated;
  });
}

export async function deleteReportScaleLocalization(input: unknown): Promise<ReportRubricScaleOptionLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportScaleLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportRubricScaleOptionLocalization.findUnique({ where: { id: data.reportRubricScaleOptionLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_SCALE_LOCALIZATION_NOT_FOUND", "scale localization does not exist");
    const { option, rubric } = await loadScaleOption(localization.reportRubricScaleOptionId, tx);
    const deleted = await tx.reportRubricScaleOptionLocalization.delete({ where: { id: localization.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportScaleLocalizationDeleted, entityType: "ReportRubricScaleOptionLocalization", entityId: deleted.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRubricScaleOptionId: option.id, reportRubricScaleOptionLocalizationId: deleted.id, locale: deleted.locale } });
    return deleted;
  });
}

async function loadReason(id: number, tx: DbClient) {
  const reason = await tx.reportRejectionReason.findUnique({ where: { id } });
  if (!reason) throw new ReportDomainError("REPORT_REASON_NOT_FOUND", "rejection reason does not exist");
  const rubric = await loadRubric(reason.reportRubricVersionId, tx);
  assertDraft(rubric.status, "rubric");
  return { reason, rubric };
}

export async function createReportReason(input: unknown): Promise<ReportRejectionReason> {
  assertReportEnabled();
  const data = parseReportCommand(createReportReasonSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const rubric = await loadRubric(data.reportRubricVersionId, tx);
    assertDraft(rubric.status, "rubric");
    await assertNoReasonConflict(tx, rubric.id, data.stableKey, data.sortOrder);
    const created = await tx.reportRejectionReason.create({ data: { reportRubricVersionId: rubric.id, stableKey: data.stableKey, sortOrder: data.sortOrder, active: data.active } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportReasonCreated, entityType: "ReportRejectionReason", entityId: created.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRejectionReasonId: created.id, stableKey: created.stableKey, sortOrder: created.sortOrder } });
    return created;
  });
}

export async function updateReportReason(input: unknown): Promise<ReportRejectionReason> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportReasonSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const { reason, rubric } = await loadReason(data.reportRejectionReasonId, tx);
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(reason as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "reason update has no changes");
    await assertNoReasonConflict(tx, rubric.id, patch.stableKey ?? reason.stableKey, patch.sortOrder ?? reason.sortOrder, reason.id);
    const updated = await tx.reportRejectionReason.update({ where: { id: reason.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportReasonUpdated, entityType: "ReportRejectionReason", entityId: updated.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRejectionReasonId: updated.id, stableKey: updated.stableKey, sortOrder: updated.sortOrder } });
    return updated;
  });
}

export async function deleteReportReason(input: unknown): Promise<ReportRejectionReason> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportReasonSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const { reason, rubric } = await loadReason(data.reportRejectionReasonId, tx);
    const [localizations, reviews] = await Promise.all([tx.reportRejectionReasonLocalization.count({ where: { reportRejectionReasonId: reason.id } }), tx.reportReview.count({ where: { rejectionReasonId: reason.id } })]);
    if (localizations + reviews > 0) throw new ReportDomainError("REPORT_NOT_EMPTY", "reason is referenced or localized");
    const deleted = await tx.reportRejectionReason.delete({ where: { id: reason.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportReasonDeleted, entityType: "ReportRejectionReason", entityId: deleted.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRejectionReasonId: deleted.id, stableKey: deleted.stableKey, sortOrder: deleted.sortOrder } });
    return deleted;
  });
}

export async function createReportReasonLocalization(input: unknown): Promise<ReportRejectionReasonLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(createReportReasonLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const { reason, rubric } = await loadReason(data.reportRejectionReasonId, tx);
    const conflict = await tx.reportRejectionReasonLocalization.findUnique({ where: { reportRejectionReasonId_locale: { reportRejectionReasonId: reason.id, locale: data.locale } } });
    if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "reason locale already exists");
    const created = await tx.reportRejectionReasonLocalization.create({ data: { reportRejectionReasonId: reason.id, locale: data.locale, title: data.title, guidance: data.guidance } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportReasonLocalizationCreated, entityType: "ReportRejectionReasonLocalization", entityId: created.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRejectionReasonId: reason.id, reportRejectionReasonLocalizationId: created.id, locale: created.locale } });
    return created;
  });
}

export async function updateReportReasonLocalization(input: unknown): Promise<ReportRejectionReasonLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(updateReportReasonLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportRejectionReasonLocalization.findUnique({ where: { id: data.reportRejectionReasonLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_REASON_LOCALIZATION_NOT_FOUND", "reason localization does not exist");
    const { reason, rubric } = await loadReason(localization.reportRejectionReasonId, tx);
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(localization as unknown as Record<string, unknown>, patch)) throw new ReportDomainError("REPORT_NO_CHANGES", "reason localization update has no changes");
    if (patch.locale !== undefined) {
      const conflict = await tx.reportRejectionReasonLocalization.findFirst({ where: { reportRejectionReasonId: reason.id, locale: patch.locale, id: { not: localization.id } } });
      if (conflict) throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "reason locale already exists");
    }
    const updated = await tx.reportRejectionReasonLocalization.update({ where: { id: localization.id }, data: patch });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportReasonLocalizationUpdated, entityType: "ReportRejectionReasonLocalization", entityId: updated.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRejectionReasonId: reason.id, reportRejectionReasonLocalizationId: updated.id, locale: updated.locale } });
    return updated;
  });
}

export async function deleteReportReasonLocalization(input: unknown): Promise<ReportRejectionReasonLocalization> {
  assertReportEnabled();
  const data = parseReportCommand(deleteReportReasonLocalizationSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const localization = await tx.reportRejectionReasonLocalization.findUnique({ where: { id: data.reportRejectionReasonLocalizationId } });
    if (!localization) throw new ReportDomainError("REPORT_REASON_LOCALIZATION_NOT_FOUND", "reason localization does not exist");
    const { reason, rubric } = await loadReason(localization.reportRejectionReasonId, tx);
    const deleted = await tx.reportRejectionReasonLocalization.delete({ where: { id: localization.id } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportReasonLocalizationDeleted, entityType: "ReportRejectionReasonLocalization", entityId: deleted.id, metadata: { actorId: data.actorId, reportRubricVersionId: rubric.id, reportRejectionReasonId: reason.id, reportRejectionReasonLocalizationId: deleted.id, locale: deleted.locale } });
    return deleted;
  });
}

async function loadRubricSnapshot(id: number, tx: DbClient): Promise<RubricSnapshot> {
  const rubric = await tx.reportRubricVersion.findUnique({
    where: { id },
    include: {
      assignment: { include: { levelDefinition: { include: { curriculumVersion: true } } } },
      criteria: { include: { localizations: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      scaleOptions: { include: { localizations: true }, orderBy: [{ ordinal: "asc" }, { id: "asc" }] },
      rejectionReasons: { include: { localizations: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  if (!rubric) throw new ReportDomainError("REPORT_RUBRIC_NOT_FOUND", "report rubric does not exist");
  assertParentDraft(rubric.assignment.levelDefinition.curriculumVersion.status);
  if (rubric.assignment.status === "archived") {
    throw new ReportDomainError("REPORT_ARCHIVED_IMMUTABLE", "archived assignment rubric graph is immutable");
  }
  return rubric;
}

async function loadAssignmentSnapshot(id: number, tx: DbClient): Promise<AssignmentSnapshot> {
  const assignment = await tx.reportAssignmentVersion.findUnique({
    where: { id },
    include: {
      levelDefinition: { include: { curriculumVersion: true } },
      localizations: { orderBy: [{ locale: "asc" }, { id: "asc" }] },
      fields: { include: { localizations: { orderBy: [{ locale: "asc" }, { id: "asc" }] } }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  if (!assignment) throw new ReportDomainError("REPORT_ASSIGNMENT_NOT_FOUND", "report assignment does not exist");
  assertParentDraft(assignment.levelDefinition.curriculumVersion.status);
  return assignment;
}

function assertExpectedReplacement(currentId: number | null, expectedId: number | null | undefined) {
  if (currentId === null) {
    if (expectedId !== undefined && expectedId !== null) throw new ReportDomainError("REPORT_REPLACEMENT_MISMATCH", "no published report version exists");
    return;
  }
  if (expectedId === undefined || expectedId === null) throw new ReportDomainError("REPORT_REPLACEMENT_REQUIRED", "expected published report version is required");
  if (expectedId !== currentId) throw new ReportDomainError("REPORT_REPLACEMENT_MISMATCH", "published report version changed");
}

function assertBindingRevision(binding: LevelReportBinding | null, expected: number | null | undefined) {
  if (!binding) {
    if (expected !== undefined && expected !== null) throw new ReportDomainError("REPORT_VERSION_MISMATCH", "report binding no longer exists");
    return;
  }
  if (expected === undefined || expected === null) throw new ReportDomainError("REPORT_REPLACEMENT_REQUIRED", "expected binding revision is required");
  if (expected !== binding.revision) throw new ReportDomainError("REPORT_VERSION_MISMATCH", "report binding revision changed");
}

async function recoverRubricPublication(data: {
  reportRubricVersionId: number;
  expectedPublishedReportRubricVersionId?: number | null;
}): Promise<PublishReportRubricResult | null> {
  const published = await prisma.reportRubricVersion.findUnique({ where: { id: data.reportRubricVersionId } });
  if (!published || published.status !== "published") return null;
  const current = await prisma.reportRubricVersion.findFirst({ where: { reportAssignmentVersionId: published.reportAssignmentVersionId, status: "published" } });
  if (current?.id !== published.id) return null;
  let replaced: ReportRubricVersion | null = null;
  if (data.expectedPublishedReportRubricVersionId != null) {
    replaced = await prisma.reportRubricVersion.findUnique({ where: { id: data.expectedPublishedReportRubricVersionId } });
    if (!replaced || replaced.status !== "archived") return null;
  }
  const binding = await prisma.levelReportBinding.findFirst({ where: { reportAssignmentVersionId: published.reportAssignmentVersionId } });
  if (binding && binding.reportRubricVersionId !== published.id) return null;
  return { published, replaced, binding, recovered: true };
}

export async function publishReportRubric(input: unknown): Promise<PublishReportRubricResult> {
  assertReportEnabled();
  const data = parseReportCommand(publishReportRubricSchema, input);
  try {
    return await prisma.$transaction(async (tx) => {
      await assertReportAdmin(data.actorId, tx);
      const snapshot = await loadRubricSnapshot(data.reportRubricVersionId, tx);
      assertDraft(snapshot.status, "rubric");
      const issues = validateReportRubricPublication(snapshot);
      if (issues.length > 0) throw new ReportDomainError("REPORT_PUBLICATION_INVALID", "report rubric publication is invalid", issues);
      const current = await tx.reportRubricVersion.findFirst({ where: { reportAssignmentVersionId: snapshot.reportAssignmentVersionId, status: "published" } });
      assertExpectedReplacement(current?.id ?? null, data.expectedPublishedReportRubricVersionId);
      const binding = await tx.levelReportBinding.findFirst({ where: { reportAssignmentVersionId: snapshot.reportAssignmentVersionId } });
      if (binding && !current) throw new ReportDomainError("REPORT_BINDING_CONFLICT", "binding exists without a published rubric");
      if (binding && current && binding.reportRubricVersionId !== current.id) throw new ReportDomainError("REPORT_BINDING_CONFLICT", "binding does not point to the published rubric");
      assertBindingRevision(binding, data.expectedBindingRevision);
      const now = new Date();
      let replaced: ReportRubricVersion | null = null;
      if (current) {
        replaced = await tx.reportRubricVersion.update({ where: { id: current.id }, data: { status: "archived", archivedAt: now } });
        await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportRubricReplaced, entityType: "ReportRubricVersion", entityId: replaced.id, metadata: { actorId: data.actorId, reportAssignmentVersionId: snapshot.reportAssignmentVersionId, replacedReportRubricVersionId: replaced.id, replacementReportRubricVersionId: snapshot.id, versionNumber: replaced.versionNumber } });
      }
      const published = await tx.reportRubricVersion.update({ where: { id: snapshot.id }, data: { status: "published", publishedAt: now, archivedAt: null } });
      let updatedBinding: LevelReportBinding | null = binding;
      if (binding) {
        const changed = await tx.levelReportBinding.updateMany({ where: { id: binding.id, revision: binding.revision }, data: { reportRubricVersionId: published.id, revision: { increment: 1 } } });
        if (changed.count !== 1) throw new ReportDomainError("REPORT_VERSION_MISMATCH", "report binding revision changed");
        updatedBinding = await tx.levelReportBinding.findUnique({ where: { id: binding.id } });
        if (!updatedBinding) throw new ReportDomainError("REPORT_INTERNAL_ERROR", "updated report binding is missing");
        await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportBound, entityType: "LevelReportBinding", entityId: binding.id, metadata: { actorId: data.actorId, levelDefinitionId: binding.levelDefinitionId, reportAssignmentVersionId: binding.reportAssignmentVersionId, reportRubricVersionId: published.id, revision: updatedBinding.revision } });
      }
      await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportRubricPublished, entityType: "ReportRubricVersion", entityId: published.id, metadata: { actorId: data.actorId, reportAssignmentVersionId: snapshot.reportAssignmentVersionId, reportRubricVersionId: published.id, versionNumber: published.versionNumber } });
      return { published, replaced, binding: updatedBinding, recovered: false };
    });
  } catch (error) {
    if (isReportDomainError(error) || !isPrismaCode(error, "P2002")) throw error;
    const recovered = await recoverRubricPublication(data);
    if (recovered) return recovered;
    throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "rubric publication lost a concurrent race");
  }
}

export async function archiveReportRubric(input: unknown): Promise<ReportRubricVersion> {
  assertReportEnabled();
  const data = parseReportCommand(archiveReportRubricSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const rubric = await loadRubric(data.reportRubricVersionId, tx);
    if (rubric.status === "draft") throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "draft rubric cannot be archived");
    if (rubric.status === "archived") throw new ReportDomainError("REPORT_ARCHIVED_IMMUTABLE", "rubric is already archived");
    const bound = await tx.levelReportBinding.findFirst({ where: { reportRubricVersionId: rubric.id } });
    if (bound) throw new ReportDomainError("REPORT_BINDING_CONFLICT", "bound rubric cannot be archived");
    const archived = await tx.reportRubricVersion.update({ where: { id: rubric.id }, data: { status: "archived", archivedAt: new Date() } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportRubricArchived, entityType: "ReportRubricVersion", entityId: archived.id, metadata: { actorId: data.actorId, reportAssignmentVersionId: archived.reportAssignmentVersionId, reportRubricVersionId: archived.id, versionNumber: archived.versionNumber } });
    return archived;
  });
}

async function recoverAssignmentPublication(data: {
  reportAssignmentVersionId: number;
  expectedPublishedReportAssignmentVersionId?: number | null;
}): Promise<PublishReportAssignmentResult | null> {
  const published = await prisma.reportAssignmentVersion.findUnique({ where: { id: data.reportAssignmentVersionId } });
  if (!published || published.status !== "published") return null;
  const current = await prisma.reportAssignmentVersion.findFirst({ where: { levelDefinitionId: published.levelDefinitionId, status: "published" } });
  if (current?.id !== published.id) return null;
  let replaced: ReportAssignmentVersion | null = null;
  if (data.expectedPublishedReportAssignmentVersionId != null) {
    replaced = await prisma.reportAssignmentVersion.findUnique({ where: { id: data.expectedPublishedReportAssignmentVersionId } });
    if (!replaced || replaced.status !== "archived") return null;
  }
  const binding = await prisma.levelReportBinding.findUnique({ where: { levelDefinitionId: published.levelDefinitionId } });
  if (binding && binding.reportAssignmentVersionId !== published.id) return null;
  return { published, replaced, binding, recovered: true };
}

export async function publishReportAssignment(input: unknown): Promise<PublishReportAssignmentResult> {
  assertReportEnabled();
  const data = parseReportCommand(publishReportAssignmentSchema, input);
  try {
    return await prisma.$transaction(async (tx) => {
      await assertReportAdmin(data.actorId, tx);
      const [assignment, rubric] = await Promise.all([loadAssignmentSnapshot(data.reportAssignmentVersionId, tx), loadRubricSnapshot(data.reportRubricVersionId, tx)]);
      assertDraft(assignment.status, "assignment");
      if (rubric.reportAssignmentVersionId !== assignment.id || rubric.status !== "published") throw new ReportDomainError("REPORT_RUBRIC_CONFLICT", "exact published rubric must belong to the assignment");
      const issues = [...validateReportRubricPublication(rubric), ...validateReportAssignmentPublication({ ...assignment, rubric })];
      if (issues.length > 0) throw new ReportDomainError("REPORT_PUBLICATION_INVALID", "report assignment publication is invalid", issues);
      const current = await tx.reportAssignmentVersion.findFirst({ where: { levelDefinitionId: assignment.levelDefinitionId, status: "published" } });
      assertExpectedReplacement(current?.id ?? null, data.expectedPublishedReportAssignmentVersionId);
      const binding = await tx.levelReportBinding.findUnique({ where: { levelDefinitionId: assignment.levelDefinitionId } });
      if (binding && !current) throw new ReportDomainError("REPORT_BINDING_CONFLICT", "binding exists without a published assignment");
      if (binding && current && binding.reportAssignmentVersionId !== current.id) throw new ReportDomainError("REPORT_BINDING_CONFLICT", "binding does not point to the published assignment");
      assertBindingRevision(binding, data.expectedBindingRevision);
      const now = new Date();
      let replaced: ReportAssignmentVersion | null = null;
      if (current) {
        const draftRubrics = await tx.reportRubricVersion.count({ where: { reportAssignmentVersionId: current.id, status: "draft" } });
        if (draftRubrics > 0) throw new ReportDomainError("REPORT_NOT_EMPTY", "published assignment has draft rubric versions that must be removed before replacement");
        await tx.reportRubricVersion.updateMany({ where: { reportAssignmentVersionId: current.id, status: "published" }, data: { status: "archived", archivedAt: now } });
        replaced = await tx.reportAssignmentVersion.update({ where: { id: current.id }, data: { status: "archived", archivedAt: now } });
        await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentReplaced, entityType: "ReportAssignmentVersion", entityId: replaced.id, metadata: { actorId: data.actorId, levelDefinitionId: assignment.levelDefinitionId, replacedReportAssignmentVersionId: replaced.id, replacementReportAssignmentVersionId: assignment.id, versionNumber: replaced.versionNumber } });
      }
      const published = await tx.reportAssignmentVersion.update({ where: { id: assignment.id }, data: { status: "published", publishedAt: now, archivedAt: null } });
      let updatedBinding: LevelReportBinding | null = binding;
      if (binding) {
        const changed = await tx.levelReportBinding.updateMany({ where: { id: binding.id, revision: binding.revision }, data: { reportAssignmentVersionId: published.id, reportRubricVersionId: rubric.id, revision: { increment: 1 } } });
        if (changed.count !== 1) throw new ReportDomainError("REPORT_VERSION_MISMATCH", "report binding revision changed");
        updatedBinding = await tx.levelReportBinding.findUnique({ where: { id: binding.id } });
        if (!updatedBinding) throw new ReportDomainError("REPORT_INTERNAL_ERROR", "updated report binding is missing");
        await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportBound, entityType: "LevelReportBinding", entityId: binding.id, metadata: { actorId: data.actorId, levelDefinitionId: binding.levelDefinitionId, reportAssignmentVersionId: published.id, reportRubricVersionId: rubric.id, revision: updatedBinding.revision } });
      }
      await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentPublished, entityType: "ReportAssignmentVersion", entityId: published.id, metadata: { actorId: data.actorId, levelDefinitionId: published.levelDefinitionId, reportAssignmentVersionId: published.id, reportRubricVersionId: rubric.id, versionNumber: published.versionNumber } });
      return { published, replaced, binding: updatedBinding, recovered: false };
    });
  } catch (error) {
    if (isReportDomainError(error) || !isPrismaCode(error, "P2002")) throw error;
    const recovered = await recoverAssignmentPublication(data);
    if (recovered) return recovered;
    throw new ReportDomainError("REPORT_ASSIGNMENT_CONFLICT", "assignment publication lost a concurrent race");
  }
}

export async function archiveReportAssignment(input: unknown): Promise<ReportAssignmentVersion> {
  assertReportEnabled();
  const data = parseReportCommand(archiveReportAssignmentSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const assignment = await loadAssignment(data.reportAssignmentVersionId, tx);
    if (assignment.status === "draft") throw new ReportDomainError("REPORT_ASSIGNMENT_CONFLICT", "draft assignment cannot be archived");
    if (assignment.status === "archived") throw new ReportDomainError("REPORT_ARCHIVED_IMMUTABLE", "assignment is already archived");
    const bound = await tx.levelReportBinding.findFirst({ where: { reportAssignmentVersionId: assignment.id } });
    if (bound) throw new ReportDomainError("REPORT_BINDING_CONFLICT", "bound assignment cannot be archived");
    const draftRubrics = await tx.reportRubricVersion.count({ where: { reportAssignmentVersionId: assignment.id, status: "draft" } });
    if (draftRubrics > 0) throw new ReportDomainError("REPORT_NOT_EMPTY", "draft rubric versions must be removed before assignment archive");
    const now = new Date();
    await tx.reportRubricVersion.updateMany({ where: { reportAssignmentVersionId: assignment.id, status: "published" }, data: { status: "archived", archivedAt: now } });
    const archived = await tx.reportAssignmentVersion.update({ where: { id: assignment.id }, data: { status: "archived", archivedAt: now } });
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportAssignmentArchived, entityType: "ReportAssignmentVersion", entityId: archived.id, metadata: { actorId: data.actorId, levelDefinitionId: archived.levelDefinitionId, reportAssignmentVersionId: archived.id, versionNumber: archived.versionNumber } });
    return archived;
  });
}

export async function setReportBinding(input: unknown): Promise<LevelReportBinding> {
  assertReportEnabled();
  const data = parseReportCommand(setReportBindingSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    const level = await loadReportLevel(data.levelDefinitionId, tx);
    const [assignment, rubric] = await Promise.all([loadAssignment(data.reportAssignmentVersionId, tx), loadRubric(data.reportRubricVersionId, tx)]);
    if (assignment.levelDefinitionId !== level.id || assignment.curriculumVersionId !== level.curriculumVersionId || assignment.status !== "published") throw new ReportDomainError("REPORT_BINDING_CONFLICT", "binding requires the exact published assignment for the level");
    if (rubric.reportAssignmentVersionId !== assignment.id || rubric.status !== "published") throw new ReportDomainError("REPORT_BINDING_CONFLICT", "binding requires the exact published rubric for the assignment");
    const existing = await tx.levelReportBinding.findUnique({ where: { levelDefinitionId: level.id } });
    if (existing?.reportAssignmentVersionId === assignment.id && existing.reportRubricVersionId === rubric.id) throw new ReportDomainError("REPORT_NO_CHANGES", "report binding already points to this snapshot");
    assertBindingRevision(existing, data.expectedBindingRevision);
    let binding: LevelReportBinding;
    if (existing) {
      const changed = await tx.levelReportBinding.updateMany({ where: { id: existing.id, revision: existing.revision }, data: { reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id, revision: { increment: 1 } } });
      if (changed.count !== 1) throw new ReportDomainError("REPORT_VERSION_MISMATCH", "report binding revision changed");
      const updated = await tx.levelReportBinding.findUnique({ where: { id: existing.id } });
      if (!updated) throw new ReportDomainError("REPORT_INTERNAL_ERROR", "updated report binding is missing");
      binding = updated;
    } else {
      binding = await tx.levelReportBinding.create({ data: { levelDefinitionId: level.id, curriculumVersionId: level.curriculumVersionId, reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id, createdById: data.actorId } });
    }
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportBound, entityType: "LevelReportBinding", entityId: binding.id, metadata: { actorId: data.actorId, levelDefinitionId: level.id, reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id, revision: binding.revision } });
    return binding;
  });
}

export async function clearReportBinding(input: unknown): Promise<LevelReportBinding> {
  assertReportEnabled();
  const data = parseReportCommand(clearReportBindingSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertReportAdmin(data.actorId, tx);
    await loadReportLevel(data.levelDefinitionId, tx);
    const existing = await tx.levelReportBinding.findUnique({ where: { levelDefinitionId: data.levelDefinitionId } });
    if (!existing) throw new ReportDomainError("REPORT_BINDING_NOT_FOUND", "report binding does not exist");
    if (existing.revision !== data.expectedBindingRevision) throw new ReportDomainError("REPORT_VERSION_MISMATCH", "report binding revision changed");
    const removed = await tx.levelReportBinding.deleteMany({ where: { id: existing.id, revision: data.expectedBindingRevision } });
    if (removed.count !== 1) throw new ReportDomainError("REPORT_VERSION_MISMATCH", "report binding revision changed");
    await writeReportAudit(tx, { actorId: data.actorId, action: CURRICULUM_AUDIT_ACTIONS.reportUnbound, entityType: "LevelReportBinding", entityId: existing.id, metadata: { actorId: data.actorId, levelDefinitionId: existing.levelDefinitionId, reportAssignmentVersionId: existing.reportAssignmentVersionId, reportRubricVersionId: existing.reportRubricVersionId, revision: existing.revision } });
    return existing;
  });
}
