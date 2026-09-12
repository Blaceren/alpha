import type { Prisma } from "@prisma/client";
import { ReportDomainError } from "@/lib/curriculum/report-errors";
import type { ReportDomainErrorCode } from "@/lib/curriculum/report-errors";
import { prisma } from "@/lib/prisma";

// Read-only admin query service for the V2 report authoring API (Phase 5B.6).
// Everything here is a pure deterministic query: no audits, no timestamp
// touches, no mutations. Path identity is always cross-checked against the
// parent curriculum version and level; any mismatch fails with the same
// not-found family so foreign resources stay hidden. Projections are strict
// allowlists: command receipts, fingerprints, user submissions, audit
// metadata, credentials and raw Prisma rows never leave this module.

function fail(code: ReportDomainErrorCode, message: string): never {
  throw new ReportDomainError(code, message);
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

type CreatedBy = { name: string } | null;

function safeCreatedBy(createdBy: CreatedBy) {
  return createdBy ? { displayName: createdBy.name } : null;
}

// --- scope assertions (shared with the mutation routes) ---------------------

export async function assertAdminReportLevel(curriculumVersionId: number, levelDefinitionId: number) {
  const level = await prisma.levelDefinition.findFirst({
    where: { id: levelDefinitionId, curriculumVersionId },
    select: { id: true },
  });
  if (!level) fail("REPORT_LEVEL_NOT_FOUND", "report level was not found");
}

export async function assertAdminReportAssignment(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
) {
  const assignment = await prisma.reportAssignmentVersion.findFirst({
    where: { id: reportAssignmentVersionId, levelDefinitionId, curriculumVersionId },
    select: { id: true },
  });
  if (!assignment) fail("REPORT_ASSIGNMENT_NOT_FOUND", "report assignment was not found");
}

export async function assertAdminReportAssignmentLocalization(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  localizationId: number,
) {
  await assertAdminReportAssignment(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId);
  const localization = await prisma.reportAssignmentLocalization.findFirst({
    where: { id: localizationId, reportAssignmentVersionId },
    select: { id: true },
  });
  if (!localization) fail("REPORT_LOCALIZATION_NOT_FOUND", "report localization was not found");
}

export async function assertAdminReportField(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  fieldId: number,
) {
  await assertAdminReportAssignment(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId);
  const field = await prisma.reportFieldDefinition.findFirst({
    where: { id: fieldId, reportAssignmentVersionId },
    select: { id: true },
  });
  if (!field) fail("REPORT_FIELD_NOT_FOUND", "report field was not found");
}

export async function assertAdminReportFieldLocalization(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  fieldId: number,
  localizationId: number,
) {
  await assertAdminReportField(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId, fieldId);
  const localization = await prisma.reportFieldLocalization.findFirst({
    where: { id: localizationId, reportFieldDefinitionId: fieldId },
    select: { id: true },
  });
  if (!localization) fail("REPORT_FIELD_LOCALIZATION_NOT_FOUND", "report field localization was not found");
}

export async function assertAdminReportRubric(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  rubricId: number,
) {
  await assertAdminReportAssignment(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId);
  const rubric = await prisma.reportRubricVersion.findFirst({
    where: { id: rubricId, reportAssignmentVersionId },
    select: { id: true },
  });
  if (!rubric) fail("REPORT_RUBRIC_NOT_FOUND", "report rubric was not found");
}

export async function assertAdminReportCriterion(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  rubricId: number,
  criterionId: number,
) {
  await assertAdminReportRubric(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId, rubricId);
  const criterion = await prisma.reportRubricCriterion.findFirst({
    where: { id: criterionId, reportRubricVersionId: rubricId },
    select: { id: true },
  });
  if (!criterion) fail("REPORT_CRITERION_NOT_FOUND", "report criterion was not found");
}

export async function assertAdminReportCriterionLocalization(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  rubricId: number,
  criterionId: number,
  localizationId: number,
) {
  await assertAdminReportCriterion(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId, rubricId, criterionId);
  const localization = await prisma.reportRubricCriterionLocalization.findFirst({
    where: { id: localizationId, reportRubricCriterionId: criterionId },
    select: { id: true },
  });
  if (!localization) fail("REPORT_CRITERION_LOCALIZATION_NOT_FOUND", "report criterion localization was not found");
}

export async function assertAdminReportScaleOption(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  rubricId: number,
  scaleOptionId: number,
) {
  await assertAdminReportRubric(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId, rubricId);
  const option = await prisma.reportRubricScaleOption.findFirst({
    where: { id: scaleOptionId, reportRubricVersionId: rubricId },
    select: { id: true },
  });
  if (!option) fail("REPORT_SCALE_OPTION_NOT_FOUND", "report scale option was not found");
}

export async function assertAdminReportScaleLocalization(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  rubricId: number,
  scaleOptionId: number,
  localizationId: number,
) {
  await assertAdminReportScaleOption(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId, rubricId, scaleOptionId);
  const localization = await prisma.reportRubricScaleOptionLocalization.findFirst({
    where: { id: localizationId, reportRubricScaleOptionId: scaleOptionId },
    select: { id: true },
  });
  if (!localization) fail("REPORT_SCALE_LOCALIZATION_NOT_FOUND", "report scale localization was not found");
}

export async function assertAdminReportReason(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  rubricId: number,
  reasonId: number,
) {
  await assertAdminReportRubric(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId, rubricId);
  const reason = await prisma.reportRejectionReason.findFirst({
    where: { id: reasonId, reportRubricVersionId: rubricId },
    select: { id: true },
  });
  if (!reason) fail("REPORT_REASON_NOT_FOUND", "report rejection reason was not found");
}

export async function assertAdminReportReasonLocalization(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  rubricId: number,
  reasonId: number,
  localizationId: number,
) {
  await assertAdminReportReason(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId, rubricId, reasonId);
  const localization = await prisma.reportRejectionReasonLocalization.findFirst({
    where: { id: localizationId, reportRejectionReasonId: reasonId },
    select: { id: true },
  });
  if (!localization) fail("REPORT_REASON_LOCALIZATION_NOT_FOUND", "report reason localization was not found");
}

// --- safe projections -------------------------------------------------------

type AssignmentRow = Prisma.ReportAssignmentVersionGetPayload<{ include: { createdBy: { select: { name: true } } } }>;
type RubricRow = Prisma.ReportRubricVersionGetPayload<{ include: { createdBy: { select: { name: true } } } }>;

export function safeReportAssignment(row: AssignmentRow) {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: iso(row.publishedAt),
    archivedAt: iso(row.archivedAt),
    changeNotes: row.changeNotes,
    createdBy: safeCreatedBy(row.createdBy),
  };
}

export function safeReportRubric(row: RubricRow) {
  return {
    id: row.id,
    reportAssignmentVersionId: row.reportAssignmentVersionId,
    versionNumber: row.versionNumber,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: iso(row.publishedAt),
    archivedAt: iso(row.archivedAt),
    changeNotes: row.changeNotes,
    createdBy: safeCreatedBy(row.createdBy),
  };
}

// --- admin reads ------------------------------------------------------------

export async function listAdminReportAssignments(curriculumVersionId: number, levelDefinitionId: number) {
  await assertAdminReportLevel(curriculumVersionId, levelDefinitionId);
  const rows = await prisma.reportAssignmentVersion.findMany({
    where: { levelDefinitionId, curriculumVersionId },
    include: { createdBy: { select: { name: true } } },
    orderBy: { versionNumber: "asc" },
  });
  return rows.map(safeReportAssignment);
}

export async function getAdminReportAssignment(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
) {
  const row = await prisma.reportAssignmentVersion.findFirst({
    where: { id: reportAssignmentVersionId, levelDefinitionId, curriculumVersionId },
    include: {
      createdBy: { select: { name: true } },
      localizations: { orderBy: { locale: "asc" } },
      fields: { orderBy: { sortOrder: "asc" }, include: { localizations: { orderBy: { locale: "asc" } } } },
    },
  });
  if (!row) fail("REPORT_ASSIGNMENT_NOT_FOUND", "report assignment was not found");
  const binding = await prisma.levelReportBinding.findFirst({
    where: { levelDefinitionId, curriculumVersionId, reportAssignmentVersionId },
    select: { reportRubricVersionId: true, revision: true, updatedAt: true },
  });
  return {
    ...safeReportAssignment(row),
    localizations: row.localizations.map((localization) => ({
      id: localization.id,
      locale: localization.locale,
      title: localization.title,
      instructions: localization.instructions,
      successCriteriaSummary: localization.successCriteriaSummary,
      submitLabel: localization.submitLabel,
    })),
    fields: row.fields.map((field) => ({
      id: field.id,
      stableKey: field.stableKey,
      type: field.type,
      required: field.required,
      sortOrder: field.sortOrder,
      validationRules: field.validationRules,
      choiceCodes: field.choiceCodes,
      localizations: field.localizations.map((localization) => ({
        id: localization.id,
        locale: localization.locale,
        label: localization.label,
        helpText: localization.helpText,
        placeholder: localization.placeholder,
        choiceLabels: localization.choiceLabels,
      })),
    })),
    binding: binding
      ? { reportRubricVersionId: binding.reportRubricVersionId, revision: binding.revision, updatedAt: binding.updatedAt.toISOString() }
      : null,
  };
}

export async function listAdminReportRubrics(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
) {
  await assertAdminReportAssignment(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId);
  const rows = await prisma.reportRubricVersion.findMany({
    where: { reportAssignmentVersionId },
    include: { createdBy: { select: { name: true } } },
    orderBy: { versionNumber: "asc" },
  });
  return rows.map(safeReportRubric);
}

export async function getAdminReportRubric(
  curriculumVersionId: number,
  levelDefinitionId: number,
  reportAssignmentVersionId: number,
  rubricId: number,
) {
  await assertAdminReportAssignment(curriculumVersionId, levelDefinitionId, reportAssignmentVersionId);
  const row = await prisma.reportRubricVersion.findFirst({
    where: { id: rubricId, reportAssignmentVersionId },
    include: {
      createdBy: { select: { name: true } },
      criteria: { orderBy: { sortOrder: "asc" }, include: { localizations: { orderBy: { locale: "asc" } } } },
      scaleOptions: { orderBy: { ordinal: "asc" }, include: { localizations: { orderBy: { locale: "asc" } } } },
      rejectionReasons: { orderBy: { sortOrder: "asc" }, include: { localizations: { orderBy: { locale: "asc" } } } },
    },
  });
  if (!row) fail("REPORT_RUBRIC_NOT_FOUND", "report rubric was not found");
  return {
    ...safeReportRubric(row),
    criteria: row.criteria.map((criterion) => ({
      id: criterion.id,
      stableKey: criterion.stableKey,
      categoryCode: criterion.categoryCode,
      sortOrder: criterion.sortOrder,
      commentRequired: criterion.commentRequired,
      localizations: criterion.localizations.map((localization) => ({
        id: localization.id,
        locale: localization.locale,
        title: localization.title,
        description: localization.description,
      })),
    })),
    scaleOptions: row.scaleOptions.map((option) => ({
      id: option.id,
      stableKey: option.stableKey,
      ordinal: option.ordinal,
      localizations: option.localizations.map((localization) => ({
        id: localization.id,
        locale: localization.locale,
        label: localization.label,
        description: localization.description,
      })),
    })),
    rejectionReasons: row.rejectionReasons.map((reason) => ({
      id: reason.id,
      stableKey: reason.stableKey,
      sortOrder: reason.sortOrder,
      active: reason.active,
      localizations: reason.localizations.map((localization) => ({
        id: localization.id,
        locale: localization.locale,
        title: localization.title,
        guidance: localization.guidance,
      })),
    })),
  };
}
