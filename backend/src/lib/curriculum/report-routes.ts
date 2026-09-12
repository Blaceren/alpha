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
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertAdminReportAssignment,
  assertAdminReportAssignmentLocalization,
  assertAdminReportCriterion,
  assertAdminReportCriterionLocalization,
  assertAdminReportField,
  assertAdminReportFieldLocalization,
  assertAdminReportLevel,
  assertAdminReportReason,
  assertAdminReportReasonLocalization,
  assertAdminReportRubric,
  assertAdminReportScaleLocalization,
  assertAdminReportScaleOption,
  getAdminReportAssignment,
  getAdminReportRubric,
  listAdminReportAssignments,
  listAdminReportRubrics,
} from "./report-admin-read";
import {
  archiveReportAssignment,
  archiveReportRubric,
  clearReportBinding,
  createReportAssignment,
  createReportAssignmentLocalization,
  createReportCriterion,
  createReportCriterionLocalization,
  createReportField,
  createReportFieldLocalization,
  createReportReason,
  createReportReasonLocalization,
  createReportRubric,
  createReportScaleLocalization,
  createReportScaleOption,
  deleteReportAssignment,
  deleteReportAssignmentLocalization,
  deleteReportCriterion,
  deleteReportCriterionLocalization,
  deleteReportField,
  deleteReportFieldLocalization,
  deleteReportReason,
  deleteReportReasonLocalization,
  deleteReportRubric,
  deleteReportScaleLocalization,
  deleteReportScaleOption,
  publishReportAssignment,
  publishReportRubric,
  setReportBinding,
  updateReportAssignment,
  updateReportAssignmentLocalization,
  updateReportCriterion,
  updateReportCriterionLocalization,
  updateReportField,
  updateReportFieldLocalization,
  updateReportReason,
  updateReportReasonLocalization,
  updateReportRubric,
  updateReportScaleLocalization,
  updateReportScaleOption,
} from "./report-authoring";
import {
  deleteOwnReportAttachment,
  finalizeOwnReportAttachment,
  initiateOwnReportAttachment,
  resolveOwnReportAttachmentDownload,
  resolveReviewerReportAttachmentDownload,
  type SafeReportAttachmentDownload,
} from "./report-attachments";
import { isReportDomainError } from "./report-errors";
import {
  gateReportAdmin,
  gateReportDownload,
  gateReportReviewer,
  gateReportSelf,
  positiveReportPathId,
  reportData,
  reportDisabled,
  reportError,
  reportException,
  ReportHttpError,
  reportIdempotencyKey,
  reportJsonBody,
  strictReportBody,
  strictReportQuery,
  submissionRefPath,
} from "./report-http";
import {
  approveReportSubmission,
  claimReportForReview,
  getReportReviewDetail,
  listReportReviewQueue,
  reassignReportClaim,
  rejectReportSubmission,
  releaseOwnReportClaim,
  renewOwnReportClaim,
  startOwnReportReview,
} from "./report-review";
import {
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
  clearReportBindingSchema,
  publishReportAssignmentSchema,
  publishReportRubricSchema,
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
} from "./report-schemas";
import {
  getOwnReportRevision,
  listOwnReportRevisions,
  resolveOwnReportContext,
  resubmitOwnReport,
  saveOwnReportDraft,
  submitOwnReport,
} from "./report-submission";

// Route factories for the feature-gated V2 report HTTP API (Phase 5B.6).
// Every handler is thin glue: gate -> strict path/query/body -> domain
// service -> safe projection. No Prisma mutation or domain rule lives here.

type Params = Record<string, string>;
type Context = { params: Promise<Params> };

const MAX_INT = 2_147_483_647;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const emptyBody = z.strictObject({});

// --- shared helpers ---------------------------------------------------------

function ids(params: Params) {
  return {
    curriculumVersionId: positiveReportPathId(params.id, "id"),
    levelDefinitionId: positiveReportPathId(params.levelId, "levelId"),
  };
}

async function admin(request: Request, write: boolean) {
  const gate = await gateReportAdmin(request, write);
  if (!gate.ok) return gate;
  try {
    strictReportQuery(request, []);
  } catch (error) {
    return { ok: false as const, response: reportException(error, "report admin query") };
  }
  return gate;
}

function requiredLocale(request: Request, allowed: readonly string[]) {
  const query = strictReportQuery(request, allowed);
  const locale = query.get("locale");
  if (!locale) {
    throw new ReportHttpError("REPORT_QUERY_INVALID", 400, [{ code: "INPUT_INVALID", reference: "locale" }]);
  }
  return { query, locale };
}

// --- safe admin projections (mutation responses) ----------------------------

function iso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function safeAssignmentRow(row: ReportAssignmentVersion) {
  return {
    id: row.id, versionNumber: row.versionNumber, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    publishedAt: iso(row.publishedAt), archivedAt: iso(row.archivedAt), changeNotes: row.changeNotes,
  };
}

function safeAssignmentLocalizationRow(row: ReportAssignmentLocalization) {
  return {
    id: row.id, locale: row.locale, title: row.title, instructions: row.instructions,
    successCriteriaSummary: row.successCriteriaSummary, submitLabel: row.submitLabel,
  };
}

function safeFieldRow(row: ReportFieldDefinition) {
  return {
    id: row.id, stableKey: row.stableKey, type: row.type, required: row.required,
    sortOrder: row.sortOrder, validationRules: row.validationRules, choiceCodes: row.choiceCodes,
  };
}

function safeFieldLocalizationRow(row: ReportFieldLocalization) {
  return {
    id: row.id, locale: row.locale, label: row.label, helpText: row.helpText,
    placeholder: row.placeholder, choiceLabels: row.choiceLabels,
  };
}

function safeRubricRow(row: ReportRubricVersion) {
  return {
    id: row.id, reportAssignmentVersionId: row.reportAssignmentVersionId,
    versionNumber: row.versionNumber, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    publishedAt: iso(row.publishedAt), archivedAt: iso(row.archivedAt), changeNotes: row.changeNotes,
  };
}

function safeCriterionRow(row: ReportRubricCriterion) {
  return {
    id: row.id, stableKey: row.stableKey, categoryCode: row.categoryCode,
    sortOrder: row.sortOrder, commentRequired: row.commentRequired,
  };
}

function safeCriterionLocalizationRow(row: ReportRubricCriterionLocalization) {
  return { id: row.id, locale: row.locale, title: row.title, description: row.description };
}

function safeScaleOptionRow(row: ReportRubricScaleOption) {
  return { id: row.id, stableKey: row.stableKey, ordinal: row.ordinal };
}

function safeScaleLocalizationRow(row: ReportRubricScaleOptionLocalization) {
  return { id: row.id, locale: row.locale, label: row.label, description: row.description };
}

function safeReasonRow(row: ReportRejectionReason) {
  return { id: row.id, stableKey: row.stableKey, sortOrder: row.sortOrder, active: row.active };
}

function safeReasonLocalizationRow(row: ReportRejectionReasonLocalization) {
  return { id: row.id, locale: row.locale, title: row.title, guidance: row.guidance };
}

function safeBindingRow(row: LevelReportBinding) {
  return {
    reportAssignmentVersionId: row.reportAssignmentVersionId,
    reportRubricVersionId: row.reportRubricVersionId,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- admin body contracts (actor and path identity are injected) ------------

const assignmentCreate = createReportAssignmentSchema.omit({ actorId: true, levelDefinitionId: true });
const assignmentPatch = updateReportAssignmentSchema.shape.patch;
const assignmentLocalizationCreate = createReportAssignmentLocalizationSchema.omit({ actorId: true, reportAssignmentVersionId: true });
const assignmentLocalizationPatch = updateReportAssignmentLocalizationSchema.shape.patch;
const fieldCreate = createReportFieldSchema.omit({ actorId: true, reportAssignmentVersionId: true });
const fieldPatch = updateReportFieldSchema.shape.patch;
const fieldLocalizationCreate = createReportFieldLocalizationSchema.omit({ actorId: true, reportFieldDefinitionId: true });
const fieldLocalizationPatch = updateReportFieldLocalizationSchema.shape.patch;
const rubricCreate = createReportRubricSchema.omit({ actorId: true, reportAssignmentVersionId: true });
const rubricPatch = updateReportRubricSchema.shape.patch;
const criterionCreate = createReportCriterionSchema.omit({ actorId: true, reportRubricVersionId: true });
const criterionPatch = updateReportCriterionSchema.shape.patch;
const criterionLocalizationCreate = createReportCriterionLocalizationSchema.omit({ actorId: true, reportRubricCriterionId: true });
const criterionLocalizationPatch = updateReportCriterionLocalizationSchema.shape.patch;
const scaleOptionCreate = createReportScaleOptionSchema.omit({ actorId: true, reportRubricVersionId: true });
const scaleOptionPatch = updateReportScaleOptionSchema.shape.patch;
const scaleLocalizationCreate = createReportScaleLocalizationSchema.omit({ actorId: true, reportRubricScaleOptionId: true });
const scaleLocalizationPatch = updateReportScaleLocalizationSchema.shape.patch;
const reasonCreate = createReportReasonSchema.omit({ actorId: true, reportRubricVersionId: true });
const reasonPatch = updateReportReasonSchema.shape.patch;
const reasonLocalizationCreate = createReportReasonLocalizationSchema.omit({ actorId: true, reportRejectionReasonId: true });
const reasonLocalizationPatch = updateReportReasonLocalizationSchema.shape.patch;
const rubricPublish = publishReportRubricSchema.omit({ actorId: true, reportRubricVersionId: true });
const assignmentPublish = publishReportAssignmentSchema.omit({ actorId: true, reportAssignmentVersionId: true });
const bindingPut = setReportBindingSchema.omit({ actorId: true, levelDefinitionId: true });
const bindingClear = clearReportBindingSchema.omit({ actorId: true, levelDefinitionId: true });

// --- admin routes -----------------------------------------------------------

export function reportAssignmentsCollectionRoutes() {
  return {
    GET: async (request: Request, context: Context) => {
      const gate = await admin(request, false); if (!gate.ok) return gate.response;
      try { const scope = ids(await context.params); return reportData(await listAdminReportAssignments(scope.curriculumVersionId, scope.levelDefinitionId)); }
      catch (error) { return reportException(error, "report assignments GET"); }
    },
    POST: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const scope = ids(await context.params);
        await assertAdminReportLevel(scope.curriculumVersionId, scope.levelDefinitionId);
        const body = strictReportBody(assignmentCreate, await reportJsonBody(request));
        return reportData(safeAssignmentRow(await createReportAssignment({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId, ...body })), 201);
      } catch (error) { return reportException(error, "report assignment POST"); }
    },
  };
}

export function reportAssignmentItemRoutes() {
  return {
    GET: async (request: Request, context: Context) => {
      const gate = await admin(request, false); if (!gate.ok) return gate.response;
      try { const p = await context.params; const scope = ids(p); return reportData(await getAdminReportAssignment(scope.curriculumVersionId, scope.levelDefinitionId, positiveReportPathId(p.assignmentId, "assignmentId"))); }
      catch (error) { return reportException(error, "report assignment GET"); }
    },
    PATCH: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const p = await context.params; const scope = ids(p); const id = positiveReportPathId(p.assignmentId, "assignmentId");
        await assertAdminReportAssignment(scope.curriculumVersionId, scope.levelDefinitionId, id);
        const patch = strictReportBody(assignmentPatch, await reportJsonBody(request));
        return reportData(safeAssignmentRow(await updateReportAssignment({ actorId: gate.actorId, reportAssignmentVersionId: id, patch })));
      } catch (error) { return reportException(error, "report assignment PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const p = await context.params; const scope = ids(p); const id = positiveReportPathId(p.assignmentId, "assignmentId");
        await assertAdminReportAssignment(scope.curriculumVersionId, scope.levelDefinitionId, id);
        return reportData(safeAssignmentRow(await deleteReportAssignment({ actorId: gate.actorId, reportAssignmentVersionId: id })));
      } catch (error) { return reportException(error, "report assignment DELETE"); }
    },
  };
}

export function reportAssignmentLocalizationCollectionRoute() {
  return async (request: Request, context: Context) => {
    const gate = await admin(request, true); if (!gate.ok) return gate.response;
    try {
      const p = await context.params; const scope = ids(p); const id = positiveReportPathId(p.assignmentId, "assignmentId");
      await assertAdminReportAssignment(scope.curriculumVersionId, scope.levelDefinitionId, id);
      const body = strictReportBody(assignmentLocalizationCreate, await reportJsonBody(request));
      return reportData(safeAssignmentLocalizationRow(await createReportAssignmentLocalization({ actorId: gate.actorId, reportAssignmentVersionId: id, ...body })), 201);
    } catch (error) { return reportException(error, "report localization POST"); }
  };
}

export function reportAssignmentLocalizationItemRoutes() {
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const id = positiveReportPathId(p.localizationId, "localizationId");
        await assertAdminReportAssignmentLocalization(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, id);
        const patch = strictReportBody(assignmentLocalizationPatch, await reportJsonBody(request));
        return reportData(safeAssignmentLocalizationRow(await updateReportAssignmentLocalization({ actorId: gate.actorId, reportAssignmentLocalizationId: id, patch })));
      } catch (error) { return reportException(error, "report localization PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const id = positiveReportPathId(p.localizationId, "localizationId");
        await assertAdminReportAssignmentLocalization(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, id);
        return reportData(safeAssignmentLocalizationRow(await deleteReportAssignmentLocalization({ actorId: gate.actorId, reportAssignmentLocalizationId: id })));
      } catch (error) { return reportException(error, "report localization DELETE"); }
    },
  };
}

export function reportFieldCollectionRoute() {
  return async (request: Request, context: Context) => {
    const gate = await admin(request, true); if (!gate.ok) return gate.response;
    try {
      const p = await context.params; const scope = ids(p); const id = positiveReportPathId(p.assignmentId, "assignmentId");
      await assertAdminReportAssignment(scope.curriculumVersionId, scope.levelDefinitionId, id);
      const body = strictReportBody(fieldCreate, await reportJsonBody(request));
      return reportData(safeFieldRow(await createReportField({ actorId: gate.actorId, reportAssignmentVersionId: id, ...body })), 201);
    } catch (error) { return reportException(error, "report field POST"); }
  };
}

export function reportFieldItemRoutes() {
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const id = positiveReportPathId(p.fieldId, "fieldId");
        await assertAdminReportField(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, id);
        const patch = strictReportBody(fieldPatch, await reportJsonBody(request));
        return reportData(safeFieldRow(await updateReportField({ actorId: gate.actorId, reportFieldDefinitionId: id, patch })));
      } catch (error) { return reportException(error, "report field PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const id = positiveReportPathId(p.fieldId, "fieldId");
        await assertAdminReportField(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, id);
        return reportData(safeFieldRow(await deleteReportField({ actorId: gate.actorId, reportFieldDefinitionId: id })));
      } catch (error) { return reportException(error, "report field DELETE"); }
    },
  };
}

export function reportFieldLocalizationCollectionRoute() {
  return async (request: Request, context: Context) => {
    const gate = await admin(request, true); if (!gate.ok) return gate.response;
    try {
      const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const fieldId = positiveReportPathId(p.fieldId, "fieldId");
      await assertAdminReportField(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, fieldId);
      const body = strictReportBody(fieldLocalizationCreate, await reportJsonBody(request));
      return reportData(safeFieldLocalizationRow(await createReportFieldLocalization({ actorId: gate.actorId, reportFieldDefinitionId: fieldId, ...body })), 201);
    } catch (error) { return reportException(error, "report field localization POST"); }
  };
}

export function reportFieldLocalizationItemRoutes() {
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const fieldId = positiveReportPathId(p.fieldId, "fieldId"); const id = positiveReportPathId(p.localizationId, "localizationId");
        await assertAdminReportFieldLocalization(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, fieldId, id);
        const patch = strictReportBody(fieldLocalizationPatch, await reportJsonBody(request));
        return reportData(safeFieldLocalizationRow(await updateReportFieldLocalization({ actorId: gate.actorId, reportFieldLocalizationId: id, patch })));
      } catch (error) { return reportException(error, "report field localization PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const fieldId = positiveReportPathId(p.fieldId, "fieldId"); const id = positiveReportPathId(p.localizationId, "localizationId");
        await assertAdminReportFieldLocalization(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, fieldId, id);
        return reportData(safeFieldLocalizationRow(await deleteReportFieldLocalization({ actorId: gate.actorId, reportFieldLocalizationId: id })));
      } catch (error) { return reportException(error, "report field localization DELETE"); }
    },
  };
}

export function reportRubricsCollectionRoutes() {
  return {
    GET: async (request: Request, context: Context) => {
      const gate = await admin(request, false); if (!gate.ok) return gate.response;
      try { const p = await context.params; const scope = ids(p); return reportData(await listAdminReportRubrics(scope.curriculumVersionId, scope.levelDefinitionId, positiveReportPathId(p.assignmentId, "assignmentId"))); }
      catch (error) { return reportException(error, "report rubrics GET"); }
    },
    POST: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const p = await context.params; const scope = ids(p); const id = positiveReportPathId(p.assignmentId, "assignmentId");
        await assertAdminReportAssignment(scope.curriculumVersionId, scope.levelDefinitionId, id);
        const body = strictReportBody(rubricCreate, await reportJsonBody(request));
        return reportData(safeRubricRow(await createReportRubric({ actorId: gate.actorId, reportAssignmentVersionId: id, ...body })), 201);
      } catch (error) { return reportException(error, "report rubric POST"); }
    },
  };
}

export function reportRubricItemRoutes() {
  return {
    GET: async (request: Request, context: Context) => {
      const gate = await admin(request, false); if (!gate.ok) return gate.response;
      try { const p = await context.params; const scope = ids(p); return reportData(await getAdminReportRubric(scope.curriculumVersionId, scope.levelDefinitionId, positiveReportPathId(p.assignmentId, "assignmentId"), positiveReportPathId(p.rubricId, "rubricId"))); }
      catch (error) { return reportException(error, "report rubric GET"); }
    },
    PATCH: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const id = positiveReportPathId(p.rubricId, "rubricId");
        await assertAdminReportRubric(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, id);
        const patch = strictReportBody(rubricPatch, await reportJsonBody(request));
        return reportData(safeRubricRow(await updateReportRubric({ actorId: gate.actorId, reportRubricVersionId: id, patch })));
      } catch (error) { return reportException(error, "report rubric PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const p = await context.params; const scope = ids(p); const assignmentId = positiveReportPathId(p.assignmentId, "assignmentId"); const id = positiveReportPathId(p.rubricId, "rubricId");
        await assertAdminReportRubric(scope.curriculumVersionId, scope.levelDefinitionId, assignmentId, id);
        return reportData(safeRubricRow(await deleteReportRubric({ actorId: gate.actorId, reportRubricVersionId: id })));
      } catch (error) { return reportException(error, "report rubric DELETE"); }
    },
  };
}

function rubricScope() {
  return async (request: Request, context: Context, write: boolean) => {
    const gate = await admin(request, write);
    if (!gate.ok) return gate;
    const p = await context.params;
    const scope = ids(p);
    return {
      ...gate,
      params: p,
      scope,
      assignmentId: positiveReportPathId(p.assignmentId, "assignmentId"),
      rubricId: positiveReportPathId(p.rubricId, "rubricId"),
    };
  };
}

export function reportCriterionCollectionRoute() {
  const resolve = rubricScope();
  return async (request: Request, context: Context) => {
    const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
    try {
      await assertAdminReportRubric(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId);
      const body = strictReportBody(criterionCreate, await reportJsonBody(request));
      return reportData(safeCriterionRow(await createReportCriterion({ actorId: gate.actorId, reportRubricVersionId: gate.rubricId, ...body })), 201);
    } catch (error) { return reportException(error, "report criterion POST"); }
  };
}

export function reportCriterionItemRoutes() {
  const resolve = rubricScope();
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        const id = positiveReportPathId(gate.params.criterionId, "criterionId");
        await assertAdminReportCriterion(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, id);
        const patch = strictReportBody(criterionPatch, await reportJsonBody(request));
        return reportData(safeCriterionRow(await updateReportCriterion({ actorId: gate.actorId, reportRubricCriterionId: id, patch })));
      } catch (error) { return reportException(error, "report criterion PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const id = positiveReportPathId(gate.params.criterionId, "criterionId");
        await assertAdminReportCriterion(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, id);
        return reportData(safeCriterionRow(await deleteReportCriterion({ actorId: gate.actorId, reportRubricCriterionId: id })));
      } catch (error) { return reportException(error, "report criterion DELETE"); }
    },
  };
}

export function reportCriterionLocalizationCollectionRoute() {
  const resolve = rubricScope();
  return async (request: Request, context: Context) => {
    const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
    try {
      const criterionId = positiveReportPathId(gate.params.criterionId, "criterionId");
      await assertAdminReportCriterion(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, criterionId);
      const body = strictReportBody(criterionLocalizationCreate, await reportJsonBody(request));
      return reportData(safeCriterionLocalizationRow(await createReportCriterionLocalization({ actorId: gate.actorId, reportRubricCriterionId: criterionId, ...body })), 201);
    } catch (error) { return reportException(error, "report criterion localization POST"); }
  };
}

export function reportCriterionLocalizationItemRoutes() {
  const resolve = rubricScope();
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        const criterionId = positiveReportPathId(gate.params.criterionId, "criterionId");
        const id = positiveReportPathId(gate.params.localizationId, "localizationId");
        await assertAdminReportCriterionLocalization(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, criterionId, id);
        const patch = strictReportBody(criterionLocalizationPatch, await reportJsonBody(request));
        return reportData(safeCriterionLocalizationRow(await updateReportCriterionLocalization({ actorId: gate.actorId, reportRubricCriterionLocalizationId: id, patch })));
      } catch (error) { return reportException(error, "report criterion localization PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const criterionId = positiveReportPathId(gate.params.criterionId, "criterionId");
        const id = positiveReportPathId(gate.params.localizationId, "localizationId");
        await assertAdminReportCriterionLocalization(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, criterionId, id);
        return reportData(safeCriterionLocalizationRow(await deleteReportCriterionLocalization({ actorId: gate.actorId, reportRubricCriterionLocalizationId: id })));
      } catch (error) { return reportException(error, "report criterion localization DELETE"); }
    },
  };
}

export function reportScaleOptionCollectionRoute() {
  const resolve = rubricScope();
  return async (request: Request, context: Context) => {
    const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
    try {
      await assertAdminReportRubric(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId);
      const body = strictReportBody(scaleOptionCreate, await reportJsonBody(request));
      return reportData(safeScaleOptionRow(await createReportScaleOption({ actorId: gate.actorId, reportRubricVersionId: gate.rubricId, ...body })), 201);
    } catch (error) { return reportException(error, "report scale option POST"); }
  };
}

export function reportScaleOptionItemRoutes() {
  const resolve = rubricScope();
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        const id = positiveReportPathId(gate.params.scaleOptionId, "scaleOptionId");
        await assertAdminReportScaleOption(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, id);
        const patch = strictReportBody(scaleOptionPatch, await reportJsonBody(request));
        return reportData(safeScaleOptionRow(await updateReportScaleOption({ actorId: gate.actorId, reportRubricScaleOptionId: id, patch })));
      } catch (error) { return reportException(error, "report scale option PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const id = positiveReportPathId(gate.params.scaleOptionId, "scaleOptionId");
        await assertAdminReportScaleOption(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, id);
        return reportData(safeScaleOptionRow(await deleteReportScaleOption({ actorId: gate.actorId, reportRubricScaleOptionId: id })));
      } catch (error) { return reportException(error, "report scale option DELETE"); }
    },
  };
}

export function reportScaleLocalizationCollectionRoute() {
  const resolve = rubricScope();
  return async (request: Request, context: Context) => {
    const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
    try {
      const scaleOptionId = positiveReportPathId(gate.params.scaleOptionId, "scaleOptionId");
      await assertAdminReportScaleOption(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, scaleOptionId);
      const body = strictReportBody(scaleLocalizationCreate, await reportJsonBody(request));
      return reportData(safeScaleLocalizationRow(await createReportScaleLocalization({ actorId: gate.actorId, reportRubricScaleOptionId: scaleOptionId, ...body })), 201);
    } catch (error) { return reportException(error, "report scale localization POST"); }
  };
}

export function reportScaleLocalizationItemRoutes() {
  const resolve = rubricScope();
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        const scaleOptionId = positiveReportPathId(gate.params.scaleOptionId, "scaleOptionId");
        const id = positiveReportPathId(gate.params.localizationId, "localizationId");
        await assertAdminReportScaleLocalization(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, scaleOptionId, id);
        const patch = strictReportBody(scaleLocalizationPatch, await reportJsonBody(request));
        return reportData(safeScaleLocalizationRow(await updateReportScaleLocalization({ actorId: gate.actorId, reportRubricScaleOptionLocalizationId: id, patch })));
      } catch (error) { return reportException(error, "report scale localization PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const scaleOptionId = positiveReportPathId(gate.params.scaleOptionId, "scaleOptionId");
        const id = positiveReportPathId(gate.params.localizationId, "localizationId");
        await assertAdminReportScaleLocalization(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, scaleOptionId, id);
        return reportData(safeScaleLocalizationRow(await deleteReportScaleLocalization({ actorId: gate.actorId, reportRubricScaleOptionLocalizationId: id })));
      } catch (error) { return reportException(error, "report scale localization DELETE"); }
    },
  };
}

export function reportReasonCollectionRoute() {
  const resolve = rubricScope();
  return async (request: Request, context: Context) => {
    const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
    try {
      await assertAdminReportRubric(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId);
      const body = strictReportBody(reasonCreate, await reportJsonBody(request));
      return reportData(safeReasonRow(await createReportReason({ actorId: gate.actorId, reportRubricVersionId: gate.rubricId, ...body })), 201);
    } catch (error) { return reportException(error, "report reason POST"); }
  };
}

export function reportReasonItemRoutes() {
  const resolve = rubricScope();
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        const id = positiveReportPathId(gate.params.reasonId, "reasonId");
        await assertAdminReportReason(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, id);
        const patch = strictReportBody(reasonPatch, await reportJsonBody(request));
        return reportData(safeReasonRow(await updateReportReason({ actorId: gate.actorId, reportRejectionReasonId: id, patch })));
      } catch (error) { return reportException(error, "report reason PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const id = positiveReportPathId(gate.params.reasonId, "reasonId");
        await assertAdminReportReason(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, id);
        return reportData(safeReasonRow(await deleteReportReason({ actorId: gate.actorId, reportRejectionReasonId: id })));
      } catch (error) { return reportException(error, "report reason DELETE"); }
    },
  };
}

export function reportReasonLocalizationCollectionRoute() {
  const resolve = rubricScope();
  return async (request: Request, context: Context) => {
    const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
    try {
      const reasonId = positiveReportPathId(gate.params.reasonId, "reasonId");
      await assertAdminReportReason(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, reasonId);
      const body = strictReportBody(reasonLocalizationCreate, await reportJsonBody(request));
      return reportData(safeReasonLocalizationRow(await createReportReasonLocalization({ actorId: gate.actorId, reportRejectionReasonId: reasonId, ...body })), 201);
    } catch (error) { return reportException(error, "report reason localization POST"); }
  };
}

export function reportReasonLocalizationItemRoutes() {
  const resolve = rubricScope();
  return {
    PATCH: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        const reasonId = positiveReportPathId(gate.params.reasonId, "reasonId");
        const id = positiveReportPathId(gate.params.localizationId, "localizationId");
        await assertAdminReportReasonLocalization(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, reasonId, id);
        const patch = strictReportBody(reasonLocalizationPatch, await reportJsonBody(request));
        return reportData(safeReasonLocalizationRow(await updateReportReasonLocalization({ actorId: gate.actorId, reportRejectionReasonLocalizationId: id, patch })));
      } catch (error) { return reportException(error, "report reason localization PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
      try {
        strictReportBody(emptyBody, await reportJsonBody(request));
        const reasonId = positiveReportPathId(gate.params.reasonId, "reasonId");
        const id = positiveReportPathId(gate.params.localizationId, "localizationId");
        await assertAdminReportReasonLocalization(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId, reasonId, id);
        return reportData(safeReasonLocalizationRow(await deleteReportReasonLocalization({ actorId: gate.actorId, reportRejectionReasonLocalizationId: id })));
      } catch (error) { return reportException(error, "report reason localization DELETE"); }
    },
  };
}

export function reportRubricPublishRoute() {
  const resolve = rubricScope();
  return async (request: Request, context: Context) => {
    const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
    try {
      await assertAdminReportRubric(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId);
      const body = strictReportBody(rubricPublish, await reportJsonBody(request));
      const result = await publishReportRubric({ actorId: gate.actorId, reportRubricVersionId: gate.rubricId, ...body });
      return reportData({
        recovered: result.recovered,
        published: safeRubricRow(result.published),
        replaced: result.replaced ? safeRubricRow(result.replaced) : null,
        binding: result.binding ? safeBindingRow(result.binding) : null,
      });
    } catch (error) { return reportException(error, "report rubric publish POST"); }
  };
}

export function reportRubricArchiveRoute() {
  const resolve = rubricScope();
  return async (request: Request, context: Context) => {
    const gate = await resolve(request, context, true); if (!gate.ok) return gate.response;
    try {
      strictReportBody(emptyBody, await reportJsonBody(request));
      await assertAdminReportRubric(gate.scope.curriculumVersionId, gate.scope.levelDefinitionId, gate.assignmentId, gate.rubricId);
      return reportData(safeRubricRow(await archiveReportRubric({ actorId: gate.actorId, reportRubricVersionId: gate.rubricId })));
    } catch (error) { return reportException(error, "report rubric archive POST"); }
  };
}

export function reportAssignmentPublishRoute() {
  return async (request: Request, context: Context) => {
    const gate = await admin(request, true); if (!gate.ok) return gate.response;
    try {
      const p = await context.params; const scope = ids(p); const id = positiveReportPathId(p.assignmentId, "assignmentId");
      await assertAdminReportAssignment(scope.curriculumVersionId, scope.levelDefinitionId, id);
      const body = strictReportBody(assignmentPublish, await reportJsonBody(request));
      await assertAdminReportRubric(scope.curriculumVersionId, scope.levelDefinitionId, id, body.reportRubricVersionId);
      const result = await publishReportAssignment({ actorId: gate.actorId, reportAssignmentVersionId: id, ...body });
      return reportData({
        recovered: result.recovered,
        published: safeAssignmentRow(result.published),
        replaced: result.replaced ? safeAssignmentRow(result.replaced) : null,
        binding: result.binding ? safeBindingRow(result.binding) : null,
      });
    } catch (error) { return reportException(error, "report assignment publish POST"); }
  };
}

export function reportAssignmentArchiveRoute() {
  return async (request: Request, context: Context) => {
    const gate = await admin(request, true); if (!gate.ok) return gate.response;
    try {
      strictReportBody(emptyBody, await reportJsonBody(request));
      const p = await context.params; const scope = ids(p); const id = positiveReportPathId(p.assignmentId, "assignmentId");
      await assertAdminReportAssignment(scope.curriculumVersionId, scope.levelDefinitionId, id);
      return reportData(safeAssignmentRow(await archiveReportAssignment({ actorId: gate.actorId, reportAssignmentVersionId: id })));
    } catch (error) { return reportException(error, "report assignment archive POST"); }
  };
}

export function reportBindingRoutes() {
  return {
    PUT: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const scope = ids(await context.params);
        await assertAdminReportLevel(scope.curriculumVersionId, scope.levelDefinitionId);
        const body = strictReportBody(bindingPut, await reportJsonBody(request));
        await assertAdminReportRubric(scope.curriculumVersionId, scope.levelDefinitionId, body.reportAssignmentVersionId, body.reportRubricVersionId);
        return reportData(safeBindingRow(await setReportBinding({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId, ...body })));
      } catch (error) { return reportException(error, "report binding PUT"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await admin(request, true); if (!gate.ok) return gate.response;
      try {
        const scope = ids(await context.params);
        await assertAdminReportLevel(scope.curriculumVersionId, scope.levelDefinitionId);
        const body = strictReportBody(bindingClear, await reportJsonBody(request));
        return reportData(safeBindingRow(await clearReportBinding({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId, ...body })));
      } catch (error) { return reportException(error, "report binding DELETE"); }
    },
  };
}

// --- self routes ------------------------------------------------------------

const OWN_RESOLVED_KINDS = new Set(["available", "draft", "pending_review", "rejected", "approved"]);

function ownFailureResponse(result: { kind: string; reason?: string }): NextResponse {
  if (result.kind === "disabled") return reportDisabled();
  if (result.kind === "user_not_found") return reportError("REPORT_ACTOR_FORBIDDEN", 403);
  if (result.kind === "not_enrolled") return reportError("REPORT_NOT_ENROLLED", 409);
  if (result.kind === "locked") return reportError("REPORT_LEVEL_NOT_STARTED", 409);
  if (result.kind === "no_submission") return reportError("REPORT_SUBMISSION_NOT_FOUND", 404);
  if (result.kind === "not_found") return reportError("REPORT_NOT_FOUND", 404);
  if (result.kind === "unavailable") {
    if (result.reason === "report_not_configured") return reportError("REPORT_NOT_CONFIGURED", 404);
    if (result.reason === "localization_unavailable") return reportError("REPORT_LOCALIZATION_UNAVAILABLE", 422);
    if (result.reason === "wrong_level_type") return reportError("REPORT_LEVEL_WRONG_TYPE", 409);
    if (result.reason === "level_not_started") return reportError("REPORT_LEVEL_NOT_STARTED", 409);
    return reportError("REPORT_NOT_FOUND", 404);
  }
  return reportError("REPORT_STATE_CORRUPT", 409);
}

const draftBody = z.strictObject({
  expectedRevision: z.number().int().min(0).max(MAX_INT - 1),
  fieldValues: z.record(z.string(), z.unknown()),
});

const transitionBody = z.strictObject({
  expectedRevision: z.number().int().min(0).max(MAX_INT - 1),
});

export function selfReportRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateReportSelf(request, false); if (!gate.ok) return gate.response;
    try {
      const { locale } = requiredLocale(request, ["locale"]);
      const params = await context.params;
      const result = await resolveOwnReportContext({ actorUserId: gate.actorId, locale, stableCode: params.stableCode });
      if (OWN_RESOLVED_KINDS.has(result.kind)) return reportData(result);
      return ownFailureResponse(result);
    } catch (error) { return reportException(error, "self report GET"); }
  };
}

export function selfReportDraftRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateReportSelf(request, true); if (!gate.ok) return gate.response;
    try {
      strictReportQuery(request, []);
      const requestId = reportIdempotencyKey(request);
      const params = await context.params;
      const body = strictReportBody(draftBody, await reportJsonBody(request));
      return reportData(await saveOwnReportDraft(gate.actorId, { stableCode: params.stableCode, requestId, ...body }));
    } catch (error) { return reportException(error, "self report draft PUT"); }
  };
}

function selfTransitionRoute(kind: "submit" | "resubmit") {
  return async (request: Request, context: Context) => {
    const gate = await gateReportSelf(request, true); if (!gate.ok) return gate.response;
    try {
      strictReportQuery(request, []);
      const requestId = reportIdempotencyKey(request);
      const params = await context.params;
      const body = strictReportBody(transitionBody, await reportJsonBody(request));
      const input = { stableCode: params.stableCode, requestId, ...body };
      const result = kind === "submit"
        ? await submitOwnReport(gate.actorId, input)
        : await resubmitOwnReport(gate.actorId, input);
      return reportData(result);
    } catch (error) { return reportException(error, `self report ${kind} POST`); }
  };
}

export function selfReportSubmitRoute() {
  return selfTransitionRoute("submit");
}

export function selfReportResubmitRoute() {
  return selfTransitionRoute("resubmit");
}

const historyQuery = z.strictObject({
  locale: z.string(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.coerce.number().int().min(1).max(MAX_INT).optional(),
});

export function selfReportRevisionsRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateReportSelf(request, false); if (!gate.ok) return gate.response;
    try {
      const { query, locale } = requiredLocale(request, ["locale", "limit", "cursor"]);
      const parsed = strictReportBody(historyQuery, {
        locale,
        ...(query.get("limit") !== null ? { limit: query.get("limit") } : {}),
        ...(query.get("cursor") !== null ? { cursor: query.get("cursor") } : {}),
      });
      const params = await context.params;
      const result = await listOwnReportRevisions(gate.actorId, {
        stableCode: params.stableCode,
        locale: parsed.locale,
        ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
        ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
      });
      if (result.kind === "resolved") return reportData(result);
      return ownFailureResponse(result);
    } catch (error) { return reportException(error, "self report revisions GET"); }
  };
}

export function selfReportRevisionItemRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateReportSelf(request, false); if (!gate.ok) return gate.response;
    try {
      const { locale } = requiredLocale(request, ["locale"]);
      const params = await context.params;
      const revisionNumber = positiveReportPathId(params.revisionId, "revisionId");
      const result = await getOwnReportRevision(gate.actorId, {
        stableCode: params.stableCode,
        locale,
        revisionNumber,
      });
      if (result.kind === "resolved") return reportData(result);
      return ownFailureResponse(result);
    } catch (error) { return reportException(error, "self report revision GET"); }
  };
}

// --- attachment routes ------------------------------------------------------

const attachmentInitiateBody = z.strictObject({
  fileName: z.string().min(1).max(512),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export function reportAttachmentInitiateRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateReportSelf(request, true, { attachments: true }); if (!gate.ok) return gate.response;
    try {
      strictReportQuery(request, []);
      const requestId = reportIdempotencyKey(request);
      const params = await context.params;
      const body = strictReportBody(attachmentInitiateBody, await reportJsonBody(request));
      return reportData(await initiateOwnReportAttachment(gate.actorId, { stableCode: params.stableCode, requestId, ...body }), 201);
    } catch (error) { return reportException(error, "report attachment initiate POST"); }
  };
}

// Backend-proxied raw upload: the request body is the exact file bytes. File
// metadata was declared at initiate; nothing is trusted from Content-Type or
// any client filename here, and the stream hard-stops at the size limit.
async function readBoundedRawBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const trimmed = declared.trim();
    if (!/^[0-9]+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
      throw new ReportHttpError("REPORT_INPUT_INVALID", 400, [{ code: "INPUT_INVALID", reference: "Content-Length" }]);
    }
    if (Number(trimmed) > MAX_UPLOAD_BYTES) {
      throw new ReportHttpError("REPORT_ATTACHMENT_TOO_LARGE", 413);
    }
  }
  const body = request.body;
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > MAX_UPLOAD_BYTES) {
        throw new ReportHttpError("REPORT_ATTACHMENT_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream already settled */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function reportAttachmentFinalizeRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateReportSelf(request, true, { attachments: true }); if (!gate.ok) return gate.response;
    try {
      strictReportQuery(request, []);
      const requestId = reportIdempotencyKey(request);
      const params = await context.params;
      const attachmentId = positiveReportPathId(params.attachmentId, "attachmentId");
      const bytes = await readBoundedRawBody(request);
      return reportData(await finalizeOwnReportAttachment(gate.actorId, { attachmentId, requestId }, bytes));
    } catch (error) { return reportException(error, "report attachment finalize POST"); }
  };
}

export function reportAttachmentItemRoutes() {
  return {
    DELETE: async (request: Request, context: Context) => {
      const gate = await gateReportSelf(request, true, { attachments: true }); if (!gate.ok) return gate.response;
      try {
        strictReportQuery(request, []);
        const requestId = reportIdempotencyKey(request);
        strictReportBody(emptyBody, await reportJsonBody(request));
        const params = await context.params;
        const attachmentId = positiveReportPathId(params.attachmentId, "attachmentId");
        return reportData(await deleteOwnReportAttachment(gate.actorId, { attachmentId, requestId }));
      } catch (error) { return reportException(error, "report attachment DELETE"); }
    },
  };
}

// One private download route serves both principals: owner authorization is
// tried first; only a reviewer-role session may fall back to the claim-gated
// reviewer service. Every unauthorized combination stays the same not-found.
export function reportAttachmentDownloadRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateReportDownload(request); if (!gate.ok) return gate.response;
    try {
      strictReportQuery(request, []);
      const params = await context.params;
      const attachmentId = positiveReportPathId(params.attachmentId, "attachmentId");
      let download: SafeReportAttachmentDownload;
      try {
        download = await resolveOwnReportAttachmentDownload(gate.actorId, { attachmentId });
      } catch (error) {
        if ((gate.role === "admin" || gate.role === "mentor") && isReportDomainError(error, "REPORT_ATTACHMENT_NOT_FOUND")) {
          download = await resolveReviewerReportAttachmentDownload(gate.actorId, { attachmentId });
        } else {
          throw error;
        }
      }
      const bytes = Buffer.from(download.bytes);
      const safeName = download.attachment.fileName.replace(/["\\\r\n]/g, "_");
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": download.attachment.mimeType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(download.attachment.fileName)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    } catch (error) { return reportException(error, "report attachment download GET"); }
  };
}

// --- reviewer routes --------------------------------------------------------

export function reviewerQueueRoute() {
  return async (request: Request) => {
    const gate = await gateReportReviewer(request, false); if (!gate.ok) return gate.response;
    try {
      const { query, locale } = requiredLocale(request, ["locale", "limit", "cursor"]);
      const limitRaw = query.get("limit");
      const parsedQuery = strictReportBody(
        z.strictObject({
          locale: z.string(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
          cursor: z.string().trim().min(8).max(256).optional(),
        }),
        {
          locale,
          ...(limitRaw !== null ? { limit: limitRaw } : {}),
          ...(query.get("cursor") !== null ? { cursor: query.get("cursor") } : {}),
        },
      );
      const result = await listReportReviewQueue(gate.actorId, {
        locale: parsedQuery.locale,
        ...(parsedQuery.limit !== undefined ? { limit: parsedQuery.limit } : {}),
        ...(parsedQuery.cursor !== undefined ? { cursor: parsedQuery.cursor } : {}),
      });
      if (result.kind === "disabled") return reportDisabled();
      if (result.kind === "forbidden") return reportError("REPORT_REVIEWER_FORBIDDEN", 403);
      return reportData({ items: result.items, nextCursor: result.nextCursor });
    } catch (error) { return reportException(error, "review queue GET"); }
  };
}

export function reviewerSubmissionDetailRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateReportReviewer(request, false); if (!gate.ok) return gate.response;
    try {
      const { locale } = requiredLocale(request, ["locale"]);
      const params = await context.params;
      const submissionRef = submissionRefPath(params.submissionId);
      const result = await getReportReviewDetail(gate.actorId, { submissionRef, locale });
      if (result.kind === "disabled") return reportDisabled();
      if (result.kind === "forbidden") return reportError("REPORT_REVIEWER_FORBIDDEN", 403);
      return reportData(result.detail);
    } catch (error) { return reportException(error, "review detail GET"); }
  };
}

const reviewCommandBody = z.strictObject({
  expectedWorkflowVersion: z.number().int().min(0).max(MAX_INT - 1),
  expectedClaimVersion: z.number().int().min(0).max(MAX_INT - 1),
  expectedSubmittedRevision: z.number().int().min(1).max(MAX_INT),
});

const reviewScoreBody = z.strictObject({
  criterionCode: z.string().trim().min(1).max(64),
  scaleCode: z.string().trim().min(1).max(64),
  comment: z.string().trim().min(1).max(4_000).optional(),
});

const reassignBody = reviewCommandBody.extend({
  targetReviewerId: z.number().int().min(1).max(MAX_INT),
  reasonCode: z.enum(["reviewer_unavailable", "claim_stale", "workload_rebalance", "operational_override"]),
});

const evidenceBody = reviewCommandBody.extend({
  scores: z.array(reviewScoreBody).min(1).max(100),
});

const rejectBody = evidenceBody.extend({
  reasonCode: z.string().trim().min(1).max(64),
  humanComment: z.string().trim().min(1).max(4_000),
  correctiveAction: z.string().trim().min(1).max(4_000),
});

type ReviewerService = (actorUserId: number, input: unknown) => Promise<unknown>;

function reviewerCommandRoute<T extends z.ZodType>(
  service: ReviewerService,
  bodySchema: T,
  label: string,
  options: { adminOnly?: boolean } = {},
) {
  return async (request: Request, context: Context) => {
    const gate = await gateReportReviewer(request, true); if (!gate.ok) return gate.response;
    try {
      if (options.adminOnly && gate.role !== "admin") {
        return reportError("REPORT_REVIEWER_FORBIDDEN", 403);
      }
      strictReportQuery(request, []);
      const requestId = reportIdempotencyKey(request);
      const params = await context.params;
      const submissionRef = submissionRefPath(params.submissionId);
      const body = strictReportBody(bodySchema, await reportJsonBody(request));
      return reportData(await service(gate.actorId, { submissionRef, requestId, ...(body as Record<string, unknown>) }));
    } catch (error) { return reportException(error, label); }
  };
}

export function reviewerClaimRoute() {
  return reviewerCommandRoute(claimReportForReview, reviewCommandBody, "review claim POST");
}

export function reviewerRenewRoute() {
  return reviewerCommandRoute(renewOwnReportClaim, reviewCommandBody, "review renew POST");
}

export function reviewerReleaseRoute() {
  return reviewerCommandRoute(releaseOwnReportClaim, reviewCommandBody, "review release POST");
}

export function reviewerStartReviewRoute() {
  return reviewerCommandRoute(startOwnReportReview, reviewCommandBody, "review start POST");
}

export function reviewerReassignRoute() {
  return reviewerCommandRoute(reassignReportClaim, reassignBody, "review reassign POST", { adminOnly: true });
}

export function reviewerRejectRoute() {
  return reviewerCommandRoute(rejectReportSubmission, rejectBody, "review reject POST");
}

export function reviewerApproveRoute() {
  // No { xp: true }: the XP flag is enforced reward-conditionally by the completion
  // primitive (positive reward only), not as a blanket reviewer-gate precondition,
  // so a zero-reward level's approval succeeds with the XP flag disabled.
  return reviewerCommandRoute(approveReportSubmission, evidenceBody, "review approve POST");
}
