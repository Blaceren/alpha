import { z } from "zod";
import { expectedRevisionSchema } from "@/lib/curriculum/authoring-mutation-guard";
import {
  archiveContentVersion, clearLevelContentBinding, createContentAsset, createContentLocalization,
  createContentVersion, deleteContentAsset, deleteContentLocalization, deleteContentVersion,
  publishContentVersion, setLevelContentBinding, updateContentAsset, updateContentLocalization,
  updateContentVersion,
} from "./content";
import {
  archiveAssessmentVersion, clearLevelAssessmentBinding, createAssessmentQuestion,
  createAssessmentVersion, createQuestionLocalization, deleteAssessmentQuestion,
  deleteAssessmentVersion, deleteQuestionLocalization, publishAssessmentVersion,
  setLevelAssessmentBinding, updateAssessmentQuestion, updateAssessmentVersion,
  updateQuestionLocalization,
} from "./assessment";
import {
  archiveContentVersionSchema, createContentAssetSchema, createContentLocalizationSchema,
  createContentVersionSchema, publishContentVersionSchema, setContentBindingSchema,
  updateContentAssetSchema, updateContentLocalizationSchema, updateContentVersionSchema,
} from "./content-schemas";
import {
  archiveAssessmentVersionSchema, createAssessmentQuestionSchema, createAssessmentVersionSchema,
  createQuestionLocalizationSchema, publishAssessmentVersionSchema, setAssessmentBindingSchema,
  updateAssessmentQuestionSchema, updateAssessmentVersionSchema, updateQuestionLocalizationSchema,
} from "./assessment-schemas";
import {
  assertAdminAssessmentVersionScope, assertAdminContentAssetScope,
  assertAdminContentLocalizationScope, assertAdminContentVersionScope, assertAdminLevelScope,
  assertAdminQuestionLocalizationScope, assertAdminQuestionScope, getAdminAssessmentVersion,
  getAdminContentVersion, listAdminAssessmentVersions, listAdminContentVersions, safeAssessmentVersion,
  safeBinding, safeContentAsset, safeContentLocalization, safeContentVersion, safeQuestion,
  safeQuestionLocalization,
} from "./phase4-admin-read";
import {
  gatePhase4Admin, gatePhase4Authoring, jsonBody, phase4Data, phase4Exception, positivePathId,
  strictBody, strictQuery, type Phase4GrantedGate,
} from "./phase4-http";

type Params = Record<string, string>;
type Context = { params: Promise<Params> };
const empty = z.strictObject({});

/**
 * PHASE-G0 CORRECTION — the revision transport at the HTTP edge.
 *
 * Every substantive mutation body now carries `expectedRevision`. The route
 * schemas below are still derived from the accepted command schemas by omitting
 * only the SERVER-derived identity (`actorId` and the path ids), so the field
 * arrives as a required, bounded integer through the existing `strictBody`
 * validation rather than through a second parser. A DELETE that previously took
 * an empty body now takes exactly this one field and nothing else.
 */
const revisionOnly = z.strictObject({ expectedRevision: expectedRevisionSchema });

function ids(params: Params) {
  return {
    curriculumVersionId: positivePathId(params.id, "id"),
    levelDefinitionId: positivePathId(params.levelId, "levelId"),
  };
}

/**
 * The RUNTIME / STRUCTURAL gate: `UserRole=admin` only.
 *
 * Publication, archival and resource binding keep it. Publishing activates
 * content for learners and a binding decides which version a level serves —
 * neither is editorial work, and §35 is explicit that an ordinary content editor
 * must not be able to rebind a level or push text to the runtime.
 */
async function admin(request: Request, profile: "content" | "assessment", write: boolean) {
  const gate = await gatePhase4Admin(request, profile, write);
  if (!gate.ok) return gate;
  return withStrictQuery(request, gate);
}

/**
 * PHASE-G1 — the SUBSTANTIVE AUTHORING gate.
 *
 * Same routes, same paths, same methods, same command schemas, same aggregate
 * guard. The only change is WHO may call them: `UserRole=admin` as before, or a
 * StaffProfile holding `curriculum_read` (reads) / `curriculum_author` (writes).
 * These are exactly the operations the visual Studio drives — the version, its
 * localizations (the learner Body v2), its assets, the questions and their
 * prompts and option labels.
 */
async function authoring(request: Request, profile: "content" | "assessment", write: boolean) {
  const gate = await gatePhase4Authoring(request, profile, write);
  if (!gate.ok) return gate;
  return withStrictQuery(request, gate);
}

function withStrictQuery<T extends Phase4GrantedGate>(
  request: Request,
  gate: T,
): T | { ok: false; response: ReturnType<typeof phase4Exception> } {
  try {
    strictQuery(request, []);
  } catch (error) {
    return { ok: false as const, response: phase4Exception(error, "admin query") };
  }
  return gate;
}

const contentCreate = createContentVersionSchema.omit({ actorId: true, levelDefinitionId: true });
const contentPatch = updateContentVersionSchema.omit({ actorId: true, contentVersionId: true });
const localizationCreate = createContentLocalizationSchema.omit({ actorId: true, contentVersionId: true });
const localizationPatch = updateContentLocalizationSchema.omit({ actorId: true, contentLocalizationId: true });
const assetCreate = createContentAssetSchema.omit({ actorId: true, contentVersionId: true });
const assetPatch = updateContentAssetSchema.omit({ actorId: true, contentAssetId: true });
const contentPublish = publishContentVersionSchema.omit({ actorId: true, contentVersionId: true });
const contentBind = setContentBindingSchema.omit({ actorId: true, levelDefinitionId: true });

export function contentVersionsCollectionRoutes() {
  return {
    GET: async (request: Request, context: Context) => {
      const gate = await authoring(request, "content", false); if (!gate.ok) return gate.response;
      try { const scope = ids(await context.params); return phase4Data(await listAdminContentVersions(scope.curriculumVersionId, scope.levelDefinitionId)); }
      catch (error) { return phase4Exception(error, "content versions GET"); }
    },
    POST: async (request: Request, context: Context) => {
      const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response;
      try {
        const scope = ids(await context.params); await assertAdminLevelScope(scope.curriculumVersionId, scope.levelDefinitionId);
        const body = strictBody(contentCreate, await jsonBody(request));
        return phase4Data(safeContentVersion(await createContentVersion({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId, ...body })), 201);
      } catch (error) { return phase4Exception(error, "content version POST"); }
    },
  };
}

export function contentVersionItemRoutes() {
  return {
    GET: async (request: Request, context: Context) => {
      const gate = await authoring(request, "content", false); if (!gate.ok) return gate.response;
      try { const p = await context.params; const scope = ids(p); return phase4Data(await getAdminContentVersion(scope.curriculumVersionId, scope.levelDefinitionId, positivePathId(p.contentVersionId, "contentVersionId"))); }
      catch (error) { return phase4Exception(error, "content version GET"); }
    },
    PATCH: async (request: Request, context: Context) => {
      const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response;
      try { const p = await context.params; const scope = ids(p); const id = positivePathId(p.contentVersionId, "contentVersionId"); await assertAdminContentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); const body = strictBody(contentPatch, await jsonBody(request)); return phase4Data(safeContentVersion(await updateContentVersion({ actorId: gate.actorId, contentVersionId: id, ...body }))); }
      catch (error) { return phase4Exception(error, "content version PATCH"); }
    },
    DELETE: async (request: Request, context: Context) => {
      const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response;
      try { const body = strictBody(revisionOnly, await jsonBody(request)); const p = await context.params; const scope = ids(p); const id = positivePathId(p.contentVersionId, "contentVersionId"); await assertAdminContentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); return phase4Data(safeContentVersion(await deleteContentVersion({ actorId: gate.actorId, contentVersionId: id, ...body }))); }
      catch (error) { return phase4Exception(error, "content version DELETE"); }
    },
  };
}

export function contentVersionPublishRoute() {
  return async (request: Request, context: Context) => {
    const gate = await admin(request, "content", true); if (!gate.ok) return gate.response;
    try { const p = await context.params; const scope = ids(p); const id = positivePathId(p.contentVersionId, "contentVersionId"); await assertAdminContentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); const body = strictBody(contentPublish, await jsonBody(request)); const result = await publishContentVersion({ actorId: gate.actorId, contentVersionId: id, ...body }); return phase4Data({ ...result, published: safeContentVersion(result.published), replaced: result.replaced ? safeContentVersion(result.replaced) : null }); }
    catch (error) { return phase4Exception(error, "content publish POST"); }
  };
}

export function contentVersionArchiveRoute() {
  return async (request: Request, context: Context) => {
    const gate = await admin(request, "content", true); if (!gate.ok) return gate.response;
    try { strictBody(empty, await jsonBody(request)); const p = await context.params; const scope = ids(p); const id = positivePathId(p.contentVersionId, "contentVersionId"); await assertAdminContentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); strictBody(archiveContentVersionSchema.omit({ actorId: true, contentVersionId: true }), {}); return phase4Data(safeContentVersion(await archiveContentVersion({ actorId: gate.actorId, contentVersionId: id }))); }
    catch (error) { return phase4Exception(error, "content archive POST"); }
  };
}

export function contentLocalizationCollectionRoute() {
  return async (request: Request, context: Context) => {
    const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response;
    try { const p = await context.params; const scope = ids(p); const id = positivePathId(p.contentVersionId, "contentVersionId"); await assertAdminContentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); const body = strictBody(localizationCreate, await jsonBody(request)); return phase4Data(safeContentLocalization(await createContentLocalization({ actorId: gate.actorId, contentVersionId: id, ...body })), 201); }
    catch (error) { return phase4Exception(error, "content localization POST"); }
  };
}

export function contentLocalizationItemRoutes() {
  return {
    PATCH: async (request: Request, context: Context) => { const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const contentId = positivePathId(p.contentVersionId); const id = positivePathId(p.localizationId, "localizationId"); await assertAdminContentLocalizationScope(scope.curriculumVersionId, scope.levelDefinitionId, contentId, id); const body = strictBody(localizationPatch, await jsonBody(request)); return phase4Data(safeContentLocalization(await updateContentLocalization({ actorId: gate.actorId, contentLocalizationId: id, ...body }))); } catch (error) { return phase4Exception(error, "content localization PATCH"); } },
    DELETE: async (request: Request, context: Context) => { const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response; try { const body = strictBody(revisionOnly, await jsonBody(request)); const p = await context.params; const scope = ids(p); const contentId = positivePathId(p.contentVersionId); const id = positivePathId(p.localizationId, "localizationId"); await assertAdminContentLocalizationScope(scope.curriculumVersionId, scope.levelDefinitionId, contentId, id); return phase4Data(safeContentLocalization(await deleteContentLocalization({ actorId: gate.actorId, contentLocalizationId: id, ...body }))); } catch (error) { return phase4Exception(error, "content localization DELETE"); } },
  };
}

export function contentAssetCollectionRoute() {
  return async (request: Request, context: Context) => { const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const id = positivePathId(p.contentVersionId); await assertAdminContentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); const body = strictBody(assetCreate, await jsonBody(request)); return phase4Data(safeContentAsset(await createContentAsset({ actorId: gate.actorId, contentVersionId: id, ...body })), 201); } catch (error) { return phase4Exception(error, "content asset POST"); } };
}

export function contentAssetItemRoutes() {
  return {
    PATCH: async (request: Request, context: Context) => { const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const contentId = positivePathId(p.contentVersionId); const id = positivePathId(p.assetId, "assetId"); await assertAdminContentAssetScope(scope.curriculumVersionId, scope.levelDefinitionId, contentId, id); const body = strictBody(assetPatch, await jsonBody(request)); return phase4Data(safeContentAsset(await updateContentAsset({ actorId: gate.actorId, contentAssetId: id, ...body }))); } catch (error) { return phase4Exception(error, "content asset PATCH"); } },
    DELETE: async (request: Request, context: Context) => { const gate = await authoring(request, "content", true); if (!gate.ok) return gate.response; try { const body = strictBody(revisionOnly, await jsonBody(request)); const p = await context.params; const scope = ids(p); const contentId = positivePathId(p.contentVersionId); const id = positivePathId(p.assetId, "assetId"); await assertAdminContentAssetScope(scope.curriculumVersionId, scope.levelDefinitionId, contentId, id); return phase4Data(safeContentAsset(await deleteContentAsset({ actorId: gate.actorId, contentAssetId: id, ...body }))); } catch (error) { return phase4Exception(error, "content asset DELETE"); } },
  };
}

export function contentBindingRoutes() {
  return {
    PUT: async (request: Request, context: Context) => { const gate = await admin(request, "content", true); if (!gate.ok) return gate.response; try { const scope = ids(await context.params); await assertAdminLevelScope(scope.curriculumVersionId, scope.levelDefinitionId); const body = strictBody(contentBind, await jsonBody(request)); await assertAdminContentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, body.contentVersionId); return phase4Data(safeBinding(await setLevelContentBinding({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId, ...body }))); } catch (error) { return phase4Exception(error, "content binding PUT"); } },
    DELETE: async (request: Request, context: Context) => { const gate = await admin(request, "content", true); if (!gate.ok) return gate.response; try { strictBody(empty, await jsonBody(request)); const scope = ids(await context.params); await assertAdminLevelScope(scope.curriculumVersionId, scope.levelDefinitionId); const result = await clearLevelContentBinding({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId }); return phase4Data({ ...result, binding: safeBinding(result.binding) }); } catch (error) { return phase4Exception(error, "content binding DELETE"); } },
  };
}

const assessmentCreate = createAssessmentVersionSchema.omit({ actorId: true, levelDefinitionId: true });
const assessmentPatch = updateAssessmentVersionSchema.omit({ actorId: true, assessmentVersionId: true });
const assessmentPublish = publishAssessmentVersionSchema.omit({ actorId: true, assessmentVersionId: true });
const assessmentBind = setAssessmentBindingSchema.omit({ actorId: true, levelDefinitionId: true });
const questionCreate = createAssessmentQuestionSchema.omit({ actorId: true, assessmentVersionId: true });
const questionPatch = updateAssessmentQuestionSchema.omit({ actorId: true, questionDefinitionId: true });
const qlocCreate = createQuestionLocalizationSchema.omit({ actorId: true, questionDefinitionId: true });
const qlocPatch = updateQuestionLocalizationSchema.omit({ actorId: true, questionLocalizationId: true });

export function assessmentVersionsCollectionRoutes() {
  return {
    GET: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", false); if (!gate.ok) return gate.response; try { const scope = ids(await context.params); return phase4Data(await listAdminAssessmentVersions(scope.curriculumVersionId, scope.levelDefinitionId)); } catch (error) { return phase4Exception(error, "assessment versions GET"); } },
    POST: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const scope = ids(await context.params); await assertAdminLevelScope(scope.curriculumVersionId, scope.levelDefinitionId); const body = strictBody(assessmentCreate, await jsonBody(request)); return phase4Data(safeAssessmentVersion(await createAssessmentVersion({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId, ...body })), 201); } catch (error) { return phase4Exception(error, "assessment version POST"); } },
  };
}

export function assessmentVersionItemRoutes() {
  return {
    GET: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", false); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); return phase4Data(await getAdminAssessmentVersion(scope.curriculumVersionId, scope.levelDefinitionId, positivePathId(p.assessmentVersionId))); } catch (error) { return phase4Exception(error, "assessment version GET"); } },
    PATCH: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const id = positivePathId(p.assessmentVersionId); await assertAdminAssessmentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); const body = strictBody(assessmentPatch, await jsonBody(request)); return phase4Data(safeAssessmentVersion(await updateAssessmentVersion({ actorId: gate.actorId, assessmentVersionId: id, ...body }))); } catch (error) { return phase4Exception(error, "assessment version PATCH"); } },
    DELETE: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const body = strictBody(revisionOnly, await jsonBody(request)); const p = await context.params; const scope = ids(p); const id = positivePathId(p.assessmentVersionId); await assertAdminAssessmentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); return phase4Data(safeAssessmentVersion(await deleteAssessmentVersion({ actorId: gate.actorId, assessmentVersionId: id, ...body }))); } catch (error) { return phase4Exception(error, "assessment version DELETE"); } },
  };
}

export function assessmentPublishRoute() { return async (request: Request, context: Context) => { const gate = await admin(request, "assessment", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const id = positivePathId(p.assessmentVersionId); await assertAdminAssessmentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); const body = strictBody(assessmentPublish, await jsonBody(request)); const result = await publishAssessmentVersion({ actorId: gate.actorId, assessmentVersionId: id, ...body }); return phase4Data({ ...result, published: safeAssessmentVersion(result.published), replaced: result.replaced ? safeAssessmentVersion(result.replaced) : null }); } catch (error) { return phase4Exception(error, "assessment publish POST"); } }; }
export function assessmentArchiveRoute() { return async (request: Request, context: Context) => { const gate = await admin(request, "assessment", true); if (!gate.ok) return gate.response; try { strictBody(empty, await jsonBody(request)); const p = await context.params; const scope = ids(p); const id = positivePathId(p.assessmentVersionId); await assertAdminAssessmentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, id); strictBody(archiveAssessmentVersionSchema.omit({ actorId: true, assessmentVersionId: true }), {}); return phase4Data(safeAssessmentVersion(await archiveAssessmentVersion({ actorId: gate.actorId, assessmentVersionId: id }))); } catch (error) { return phase4Exception(error, "assessment archive POST"); } }; }

export function questionCollectionRoute() { return async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const assessmentId = positivePathId(p.assessmentVersionId); await assertAdminAssessmentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, assessmentId); const body = strictBody(questionCreate, await jsonBody(request)); return phase4Data(safeQuestion(await createAssessmentQuestion({ actorId: gate.actorId, assessmentVersionId: assessmentId, ...body })), 201); } catch (error) { return phase4Exception(error, "question POST"); } }; }
export function questionItemRoutes() { return {
  PATCH: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const assessmentId = positivePathId(p.assessmentVersionId); const id = positivePathId(p.questionId); await assertAdminQuestionScope(scope.curriculumVersionId, scope.levelDefinitionId, assessmentId, id); const body = strictBody(questionPatch, await jsonBody(request)); return phase4Data(safeQuestion(await updateAssessmentQuestion({ actorId: gate.actorId, questionDefinitionId: id, ...body }))); } catch (error) { return phase4Exception(error, "question PATCH"); } },
  DELETE: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const body = strictBody(revisionOnly, await jsonBody(request)); const p = await context.params; const scope = ids(p); const assessmentId = positivePathId(p.assessmentVersionId); const id = positivePathId(p.questionId); await assertAdminQuestionScope(scope.curriculumVersionId, scope.levelDefinitionId, assessmentId, id); return phase4Data(safeQuestion(await deleteAssessmentQuestion({ actorId: gate.actorId, questionDefinitionId: id, ...body }))); } catch (error) { return phase4Exception(error, "question DELETE"); } },
}; }

export function questionLocalizationCollectionRoute() { return async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const assessmentId = positivePathId(p.assessmentVersionId); const questionId = positivePathId(p.questionId); await assertAdminQuestionScope(scope.curriculumVersionId, scope.levelDefinitionId, assessmentId, questionId); const body = strictBody(qlocCreate, await jsonBody(request)); return phase4Data(safeQuestionLocalization(await createQuestionLocalization({ actorId: gate.actorId, questionDefinitionId: questionId, ...body })), 201); } catch (error) { return phase4Exception(error, "question localization POST"); } }; }
export function questionLocalizationItemRoutes() { return {
  PATCH: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const p = await context.params; const scope = ids(p); const assessmentId = positivePathId(p.assessmentVersionId); const questionId = positivePathId(p.questionId); const id = positivePathId(p.localizationId); await assertAdminQuestionLocalizationScope(scope.curriculumVersionId, scope.levelDefinitionId, assessmentId, questionId, id); const body = strictBody(qlocPatch, await jsonBody(request)); return phase4Data(safeQuestionLocalization(await updateQuestionLocalization({ actorId: gate.actorId, questionLocalizationId: id, ...body }))); } catch (error) { return phase4Exception(error, "question localization PATCH"); } },
  DELETE: async (request: Request, context: Context) => { const gate = await authoring(request, "assessment", true); if (!gate.ok) return gate.response; try { const body = strictBody(revisionOnly, await jsonBody(request)); const p = await context.params; const scope = ids(p); const assessmentId = positivePathId(p.assessmentVersionId); const questionId = positivePathId(p.questionId); const id = positivePathId(p.localizationId); await assertAdminQuestionLocalizationScope(scope.curriculumVersionId, scope.levelDefinitionId, assessmentId, questionId, id); return phase4Data(safeQuestionLocalization(await deleteQuestionLocalization({ actorId: gate.actorId, questionLocalizationId: id, ...body }))); } catch (error) { return phase4Exception(error, "question localization DELETE"); } },
}; }

export function assessmentBindingRoutes() { return {
  PUT: async (request: Request, context: Context) => { const gate = await admin(request, "assessment", true); if (!gate.ok) return gate.response; try { const scope = ids(await context.params); await assertAdminLevelScope(scope.curriculumVersionId, scope.levelDefinitionId); const body = strictBody(assessmentBind, await jsonBody(request)); await assertAdminAssessmentVersionScope(scope.curriculumVersionId, scope.levelDefinitionId, body.assessmentVersionId); return phase4Data(safeBinding(await setLevelAssessmentBinding({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId, ...body }))); } catch (error) { return phase4Exception(error, "assessment binding PUT"); } },
  DELETE: async (request: Request, context: Context) => { const gate = await admin(request, "assessment", true); if (!gate.ok) return gate.response; try { strictBody(empty, await jsonBody(request)); const scope = ids(await context.params); await assertAdminLevelScope(scope.curriculumVersionId, scope.levelDefinitionId); const result = await clearLevelAssessmentBinding({ actorId: gate.actorId, levelDefinitionId: scope.levelDefinitionId }); return phase4Data({ ...result, binding: safeBinding(result.binding) }); } catch (error) { return phase4Exception(error, "assessment binding DELETE"); } },
}; }
