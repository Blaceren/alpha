/**
 * PHASE-G1 — the authoring route handlers.
 *
 * One factory per route file, in the style the accepted `phase4-admin-routes.ts`
 * already established, so the files under `src/app/api` stay two lines each and
 * every decision is here where it can be read together.
 *
 * VALIDATION IS SCOPED TO THE AGGREGATE BEING ACTED ON. Submitting a lesson must
 * not be blocked because the level's question bank is unfinished, and approving
 * a bank must not be blocked because the video has no script — those are
 * different aggregates with different owners and different review cycles. The
 * mapping from aggregate to validation sections is `SECTIONS_FOR_KIND` below,
 * and `cross` (answer leakage) belongs to BOTH the lesson and the bank because
 * it is a statement about the pair.
 *
 * APPROVAL NEVER PUBLISHES. Nothing in this file touches `status`, `publishedAt`
 * or a binding, and no route here calls a publish command.
 */
import type { EditorialState } from "@prisma/client";
import {
  approveVersion,
  requestChanges,
  submitForReview,
  type AuthoringTargetKind,
} from "@/lib/curriculum/authoring-lifecycle";
import {
  addReviewNote,
  listReviewNotes,
  resolveReviewNote,
  type ReviewNoteTarget,
} from "@/lib/curriculum/authoring-review-notes";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import {
  AUTHORING_LOCALE,
  readAuthoringOverview,
  readLevelAuthoringWorkspace,
  readNotesForLevel,
  resolveAuthoringCurriculumVersionId,
} from "@/lib/curriculum/authoring-read";
import {
  classifyWorkQueue,
  countWorkQueue,
  levelHandoffStatus,
  summarizeReadiness,
} from "@/lib/curriculum/authoring-readiness";
import {
  validateLevelAuthoring,
  type AuthoringValidationReport,
  type AuthoringValidationSection,
} from "@/lib/curriculum/authoring-validation-service";
import { compareBlueprintProposal } from "@/lib/curriculum/authoring-conflict";
import {
  candidateForAxis,
  type AuthoringCandidateSelection,
} from "@/lib/curriculum/authoring-candidate";
import {
  createLevelPreviewSnapshot,
  readInternalPreview,
  readLearnerPreview,
  readStructuralPreview,
} from "@/lib/curriculum/authoring-preview";
import {
  cloneAssessmentVersion,
  cloneContentVersion,
  cloneVideoProductionVersion,
} from "@/lib/curriculum/authoring-version-clone";
import { buildHandoffBundle } from "@/lib/curriculum/authoring-handoff";
import {
  createVideoProductionVersion,
  updateVideoProductionContract,
} from "@/lib/curriculum/video-production-authoring";
import { readVideoProductionCoherence } from "@/lib/curriculum/video-production-coherence";
import {
  hashAuthorityValue,
  readSourceAuthority,
  resolveAuthoritySource,
  resolveSourceAuthority,
} from "@/lib/curriculum/source-authority";
import { PRODUCT_TOOL_CODES } from "@/lib/curriculum/product-vocabulary";
import {
  authoringData,
  authoringException,
  cloneBodySchema,
  createPreviewBodySchema,
  createVideoContractBodySchema,
  gateAuthoringMutation,
  gateAuthoringRead,
  handoffBodySchema,
  lifecycleBodySchema,
  parseBody,
  parseTargetKind,
  positiveId,
  readCurriculumVersionIdQuery,
  readJsonBody,
  readPositiveIdQuery,
  reviewNoteBodySchema,
  sourceAuthorityBodySchema,
  videoContractBodySchema,
} from "@/lib/curriculum/authoring-http";
import { Phase4HttpError } from "@/lib/curriculum/phase4-http";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<Record<string, string>> };

const SECTIONS_FOR_KIND: Record<AuthoringTargetKind, readonly AuthoringValidationSection[]> = {
  content: ["content", "cross"],
  assessment: ["assessment", "cross"],
  video_production: ["video"],
};

async function resolveVersionId(request: Request): Promise<number> {
  const requested = readCurriculumVersionIdQuery(request);
  if (requested !== null) return requested;
  const resolved = await resolveAuthoringCurriculumVersionId();
  if (resolved === null) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      "no curriculum version exists to author against",
    );
  }
  return resolved;
}

/**
 * PHASE-G2 SUCCESSOR — the candidate axes, read from the query string.
 *
 * Every id is verified against the level's own versions by `resolveCandidate`
 * before it selects anything, so a hostile or mistaken value cannot reach a
 * foreign level's rows — this function only parses shape.
 */
function candidateFromQuery(request: Request): AuthoringCandidateSelection {
  return {
    contentVersionId: readPositiveIdQuery(request, "contentVersionId"),
    assessmentVersionId: readPositiveIdQuery(request, "assessmentVersionId"),
    videoProductionVersionId: readPositiveIdQuery(request, "videoProductionVersionId"),
  };
}

/** Which level does this aggregate belong to? Read server-side, never supplied. */
async function resolveAggregateLevel(
  kind: AuthoringTargetKind,
  id: number,
): Promise<{ levelDefinitionId: number; curriculumVersionId: number; editorialState: EditorialState }> {
  const row =
    kind === "content"
      ? await prisma.contentVersion.findUnique({
          where: { id },
          select: { levelDefinitionId: true, curriculumVersionId: true, editorialState: true },
        })
      : kind === "assessment"
        ? await prisma.assessmentVersion.findUnique({
            where: { id },
            select: { levelDefinitionId: true, curriculumVersionId: true, editorialState: true },
          })
        : await prisma.videoProductionVersion.findUnique({
            where: { id },
            select: { levelDefinitionId: true, curriculumVersionId: true, editorialState: true },
          });
  if (!row) {
    throw new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", `${kind} version ${id} does not exist`);
  }
  return row;
}

function scopeValidation(
  report: AuthoringValidationReport | null,
  kind: AuthoringTargetKind,
): { ok: boolean; issues: AuthoringValidationReport["issues"] } {
  if (!report) return { ok: true, issues: [] };
  const sections = SECTIONS_FOR_KIND[kind];
  const issues = report.issues.filter((issue) => sections.includes(issue.section));
  return { ok: issues.length === 0, issues };
}

function noteTarget(kind: AuthoringTargetKind, id: number): ReviewNoteTarget {
  switch (kind) {
    case "content":
      return { kind: "content", contentVersionId: id };
    case "assessment":
      return { kind: "assessment", assessmentVersionId: id };
    case "video_production":
      return { kind: "video_production", videoProductionVersionId: id };
  }
}

/* ------------------------------------------------------------------ *
 * Overview / readiness / work queue
 * ------------------------------------------------------------------ */

export function authoringOverviewRoute() {
  return async (request: Request) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const curriculumVersionId = await resolveVersionId(request);
      const levels = await readAuthoringOverview(curriculumVersionId);
      return authoringData({
        curriculumVersionId,
        locale: AUTHORING_LOCALE,
        // The CRM's `tool_link` and `open_tool` choosers are built from THIS
        // list rather than from a copy in the CRM. `isProductToolCode` refuses
        // anything outside it anyway, so a second list in another repository
        // could only ever disagree with the validator — and the disagreement
        // would surface as a rejected save an editor cannot explain.
        productToolCodes: [...PRODUCT_TOOL_CODES].sort(),
        levels: levels.map((level) => ({ ...level, handoff: levelHandoffStatus(level) })),
      });
    } catch (error) {
      return authoringException(error, "authoring overview GET");
    }
  };
}

export function authoringReadinessRoute() {
  return async (request: Request) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const curriculumVersionId = await resolveVersionId(request);
      const levels = await readAuthoringOverview(curriculumVersionId);
      const queue = classifyWorkQueue(levels);
      return authoringData({
        curriculumVersionId,
        readiness: summarizeReadiness(levels),
        workQueueCounts: countWorkQueue(queue),
      });
    } catch (error) {
      return authoringException(error, "authoring readiness GET");
    }
  };
}

export function authoringWorkQueueRoute() {
  return async (request: Request) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const curriculumVersionId = await resolveVersionId(request);
      const levels = await readAuthoringOverview(curriculumVersionId);
      const entries = classifyWorkQueue(levels);
      return authoringData({
        curriculumVersionId,
        counts: countWorkQueue(entries),
        entries,
      });
    } catch (error) {
      return authoringException(error, "authoring work queue GET");
    }
  };
}

/* ------------------------------------------------------------------ *
 * One level
 * ------------------------------------------------------------------ */

export function authoringLevelRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const levelDefinitionId = positiveId(params.levelId, "levelId");
      const curriculumVersionId = await resolveVersionId(request);
      // PHASE-G2 SUCCESSOR — optional candidate axes, so the Studio can open a
      // draft successor. Omitted, this is byte-identical to the accepted route.
      const workspace = await readLevelAuthoringWorkspace({
        curriculumVersionId,
        levelDefinitionId,
        candidate: candidateFromQuery(request),
      });
      if (!workspace) return authoringException(
        new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", "level not found in this curriculum version"),
        "authoring level GET",
      );
      return authoringData({
        ...workspace,
        handoff: levelHandoffStatus(workspace.level),
      });
    } catch (error) {
      return authoringException(error, "authoring level GET");
    }
  };
}

export function authoringLevelValidateRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const levelDefinitionId = positiveId(params.levelId, "levelId");
      const curriculumVersionId = await resolveVersionId(request);
      // PHASE-G2 SUCCESSOR — the Studio's "would this pass?" button, aimed.
      //
      // Optional query candidates, because an author validating a successor needs
      // the answer for the DRAFT, and the level-scoped answer is about the version
      // learners are on. Omitting them keeps the accepted level-wide behaviour, so
      // this is additive for every existing caller.
      const report = await validateLevelAuthoring({
        curriculumVersionId,
        levelDefinitionId,
        candidate: candidateFromQuery(request),
      });
      if (!report) {
        return authoringException(
          new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", "level not found in this curriculum version"),
          "authoring validate GET",
        );
      }
      return authoringData(report);
    } catch (error) {
      return authoringException(error, "authoring validate GET");
    }
  };
}

/**
 * The L2-style comparison surface (§16).
 *
 * READ-ONLY, and there is no sibling route that resolves anything. The Backend
 * has no conflict-resolution domain, and G1 does not invent one.
 */
export function authoringLevelConflictsRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const levelDefinitionId = positiveId(params.levelId, "levelId");
      const curriculumVersionId = await resolveVersionId(request);
      const levels = await readAuthoringOverview(curriculumVersionId);
      const level = levels.find((row) => row.levelDefinitionId === levelDefinitionId);
      if (!level) {
        return authoringException(
          new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", "level not found in this curriculum version"),
          "authoring conflicts GET",
        );
      }
      if (!level.video || !level.assessment) {
        return authoringData({
          levelNumber: level.levelNumber,
          comparable: false,
          reason: level.video ? "NO_ASSESSMENT" : "NO_PRODUCTION_CONTRACT",
          conflicts: [],
          resolutionAvailable: false,
        });
      }
      // CORRECTION-2 — the comparison surface reads the SAME canonical source as
      // the command it feeds. It used to read the level's working production
      // version directly, which is the linked one in the ordinary case but not
      // when a bank is bound to an older proposal — and a screen that shows one
      // contract's hashes while the command verifies another's can only produce
      // refusals a reviewer cannot explain.
      const source = await resolveAuthoritySource(prisma, level.assessment.id);
      if (source.unavailableReason !== null || source.contract === null) {
        return authoringData({
          levelNumber: level.levelNumber,
          comparable: false,
          reason: source.unavailableReason ?? "NO_PRODUCTION_CONTRACT",
          conflicts: [],
          resolutionAvailable: false,
        });
      }
      const contract = source.contract;
      const comparison = await compareBlueprintProposal(prisma, {
        contract,
        assessmentVersionId: level.assessment.id,
        videoProductionVersionId: source.videoProductionVersionId!,
      });
      const authority = await readSourceAuthority(prisma, {
        assessmentVersionId: level.assessment.id,
        videoProductionVersionId: source.videoProductionVersionId,
        contract,
        sourceLinked: source.link !== null,
      });
      return authoringData({
        ...comparison,
        // PHASE-G2 — each conflict now carries the identity a caller must echo
        // back to adjudicate it. Serving the hashes with the comparison is what
        // makes "decide exactly what I was shown" enforceable: a stale screen
        // produces stale hashes and the command refuses.
        conflicts: comparison.conflicts.map((conflict) => ({
          ...conflict,
          currentValueHash: hashAuthorityValue(conflict.currentApprovedValue),
          blueprintValueHash: hashAuthorityValue(conflict.blueprintProposalValue),
        })),
        sourceAuthority: authority,
        // PHASE-G2 replaced the G1 statement that no resolution domain exists.
        // It exists now, and it records a DECISION rather than rewriting either
        // side, so the raw conflicts above stay exactly as they were.
        // CORRECTION-2 — only a LINKED source is adjudicable. An unlinked bank
        // is compared honestly against the level's working proposal, but the
        // command refuses it, so the screen must not offer a button that cannot
        // work.
        resolutionAvailable: source.link !== null,
        resolutionNote:
          source.link !== null
            ? "Adjudication records which source wins per field. It rewrites no learner content, does not approve the bank, and leaves every raw conflict inspectable."
            : "This bank carries no durable link to a production contract, so there is no pinned Blueprint proposal to adjudicate against. Link the contract first.",
        expectedAssessmentRevision: level.assessment.revision,
        // CORRECTION-2 — the canonical source's revision, matching the contract
        // whose hashes are served above.
        expectedVideoProductionRevision: source.videoProductionRevision,
      });
    } catch (error) {
      return authoringException(error, "authoring conflicts GET");
    }
  };
}

/**
 * PHASE-G2 — record a source-authority adjudication (§6, §11).
 *
 * A MUTATION OF THE AUTHORITY AXIS ONLY. It writes decision rows and an audit
 * trail. It does not touch the bank, the contract, any editorial state or any
 * learner-facing string, which is why it is gated on `adjudicate` rather than on
 * `author` or `approve`: those are different authorities over different things.
 */
export function authoringSourceAuthorityRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringMutation(request, "adjudicate");
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const assessmentVersionId = positiveId(params.id, "id");
      const body = parseBody(sourceAuthorityBodySchema, await readJsonBody(request));
      const result = await resolveSourceAuthority({
        assessmentVersionId,
        expectedAssessmentRevision: body.expectedAssessmentRevision,
        expectedVideoProductionRevision: body.expectedVideoProductionRevision,
        scope: body.scope,
        decisions: body.decisions,
        rationale: body.rationale,
        evidenceRef: body.evidenceRef,
        evidenceSha256: body.evidenceSha256,
        supersedeStale: body.supersedeStale,
        // Always the gate's actor. A caller cannot name who decided.
        actorId: gate.actor.actorId,
      });
      return authoringData({
        batchId: result.batchId,
        created: result.created,
        superseded: result.superseded,
        unchanged: result.unchanged,
        before: { state: result.before.state, blockingConflictCount: result.before.blockingConflictCount },
        sourceAuthority: result.after,
      });
    } catch (error) {
      return authoringException(error, "authoring source-authority POST");
    }
  };
}

/** The authority record on its own, for a reviewer who only needs the lineage. */
export function authoringSourceAuthorityReadRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const assessmentVersionId = positiveId(params.id, "id");
      const assessment = await prisma.assessmentVersion.findUnique({
        where: { id: assessmentVersionId },
        select: { id: true, revision: true },
      });
      if (!assessment) {
        return authoringException(
          new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", "assessment version not found"),
          "authoring source-authority GET",
        );
      }
      // CORRECTION-2 (re-audit HIGH-1) — through the SHARED resolver.
      //
      // This route used to take `videoProductionLinks[0]`, which is insertion
      // order. On a bank carrying more than one link it read an older proposal
      // than the command and the handoff, and an independent audit reproduced it
      // reporting state NO_CONFLICT, 0 raw and 0 blocking for a bank that owed
      // eight decisions — while readiness on the very same row said CONFLICTING
      // and refused the handoff. A lineage surface that can disagree with the
      // command about WHICH source it is describing is worse than no surface.
      const source = await resolveAuthoritySource(prisma, assessment.id);
      const authority = await readSourceAuthority(prisma, {
        assessmentVersionId: assessment.id,
        videoProductionVersionId: source.videoProductionVersionId,
        contract: source.contract,
        sourceUnavailableReason: source.unavailableReason,
        sourceLinked: source.link !== null,
      });
      return authoringData({
        ...authority,
        expectedAssessmentRevision: assessment.revision,
        // The revision of the SAME version the projection describes, so a client
        // cannot prepare an adjudication against one contract and echo back
        // another one's revision.
        expectedVideoProductionRevision: source.videoProductionRevision,
        /** Staff-only detail. The route may say MORE than the shared truth, never something different. */
        canonicalLink: source.link,
        /**
         * REVIEW-SURFACE CORRECTION — the accepted MEDIUM, closed.
         *
         * `resolveAuthoritySource` has always known WHERE the canonical source
         * came from; this route just never said. A successor inherits its
         * ancestor's link, so `canonicalLink` above names a production version
         * this bank owns no row for, and a reviewer reading the surface could not
         * tell an own link from an inherited one — the difference between "this
         * bank was deliberately pinned to that proposal" and "its ancestor was".
         *
         * PROJECTION ONLY. Two fields already computed by the shared resolver,
         * copied onto a staff response. No semantics move, and this is a staff
         * route: no learner payload is reachable from here.
         */
        linkOrigin: source.linkOrigin,
        linkLineageDepth: source.linkLineageDepth,
        sourceContractUnavailableReason: source.unavailableReason,
      });
    } catch (error) {
      return authoringException(error, "authoring source-authority GET");
    }
  };
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

export function authoringSubmitRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringMutation(request, "author");
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const kind = parseTargetKind(params.kind);
      const id = positiveId(params.id, "id");
      const body = parseBody(lifecycleBodySchema, await readJsonBody(request));

      const target = await resolveAggregateLevel(kind, id);
      // PHASE-G2 SUCCESSOR — VALIDATE THE VERSION BEING SUBMITTED.
      //
      // `id` used to reach this line and go no further: it resolved the level and
      // was then dropped, so the validator re-derived a target through the runtime
      // binding and judged whatever the level currently serves. On any level with
      // a published predecessor that is a DIFFERENT ROW than the one being
      // submitted, which the independent audit measured in both directions — a
      // repaired successor refused because its bound predecessor was defective,
      // and, worse, a defective successor that a clean predecessor would have
      // waved through.
      const report = await validateLevelAuthoring({
        curriculumVersionId: target.curriculumVersionId,
        levelDefinitionId: target.levelDefinitionId,
        candidate: candidateForAxis(kind, id),
      });
      const scoped = scopeValidation(report, kind);
      if (!scoped.ok) {
        throw new AuthoringDomainError(
          "AUTHORING_VALIDATION_FAILED",
          "server-authoritative validation must pass before submission",
          { issues: scoped.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) },
        );
      }

      const result = await submitForReview({
        kind,
        id,
        expectedRevision: body.expectedRevision,
        actorId: gate.actor.actorId,
      });
      return authoringData(result);
    } catch (error) {
      return authoringException(error, "authoring submit POST");
    }
  };
}

export function authoringRequestChangesRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringMutation(request, "approve");
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const kind = parseTargetKind(params.kind);
      const id = positiveId(params.id, "id");
      const body = parseBody(
        lifecycleBodySchema.extend(reviewNoteBodySchema.partial().shape),
        await readJsonBody(request),
      );

      const result = await requestChanges({
        kind,
        id,
        expectedRevision: body.expectedRevision,
        actorId: gate.actor.actorId,
      });

      // The reviewer's reason, when supplied, is recorded as a real append-only
      // note rather than a column on the transition — the accepted domain owns
      // review prose, and a reviewer usually leaves several block-scoped notes
      // plus one summary.
      let note = null;
      if (body.body) {
        note = await addReviewNote({
          target: noteTarget(kind, id),
          body: body.body,
          path: body.path ?? null,
          authorId: gate.actor.actorId,
        });
      }
      return authoringData({ ...result, note });
    } catch (error) {
      return authoringException(error, "authoring request-changes POST");
    }
  };
}

export function authoringApproveRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringMutation(request, "approve");
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const kind = parseTargetKind(params.kind);
      const id = positiveId(params.id, "id");
      const body = parseBody(lifecycleBodySchema, await readJsonBody(request));

      const target = await resolveAggregateLevel(kind, id);
      // PHASE-G2 SUCCESSOR — APPROVE WHAT WAS VALIDATED.
      //
      // The same candidate-discard defect as submit, and materially worse here:
      // approval is the four-eyes gate, so validating the runtime predecessor and
      // then approving a different draft means the reviewer's `validationPassed`
      // describes a version nobody looked at.
      const report = await validateLevelAuthoring({
        curriculumVersionId: target.curriculumVersionId,
        levelDefinitionId: target.levelDefinitionId,
        candidate: candidateForAxis(kind, id),
      });
      const scoped = scopeValidation(report, kind);

      // `validationPassed` is a REQUIRED argument with no default in the accepted
      // domain, and this is the only place in the platform that computes it for
      // an HTTP approval. The domain still enforces revision, state and
      // four-eyes independently of what is passed here.
      const result = await approveVersion({
        kind,
        id,
        expectedRevision: body.expectedRevision,
        actorId: gate.actor.actorId,
        validationPassed: scoped.ok,
      });
      return authoringData({ ...result, published: false });
    } catch (error) {
      return authoringException(error, "authoring approve POST");
    }
  };
}

/**
 * §36 / §37 — the way out of an approved version.
 *
 * Requires `curriculum_author`, because creating a draft is authoring. The clone
 * lands in `draft` with the caller as `lastAuthoredById`, so the person who made
 * the copy is already excluded from approving it.
 */
export function authoringCloneRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringMutation(request, "author");
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const kind = parseTargetKind(params.kind);
      const id = positiveId(params.id, "id");
      const body = parseBody(cloneBodySchema, await readJsonBody(request));

      const result =
        kind === "content"
          ? await cloneContentVersion({
              contentVersionId: id,
              actorId: gate.actor.actorId,
              changeNotes: body.changeNotes ?? null,
            })
          : kind === "assessment"
            ? await cloneAssessmentVersion({
                assessmentVersionId: id,
                actorId: gate.actor.actorId,
                changeNotes: body.changeNotes ?? null,
              })
            : await cloneVideoProductionVersion({
                videoProductionVersionId: id,
                actorId: gate.actor.actorId,
              });
      return authoringData(result, 201);
    } catch (error) {
      return authoringException(error, "authoring clone POST");
    }
  };
}

/* ------------------------------------------------------------------ *
 * Review notes
 * ------------------------------------------------------------------ */

export function authoringNotesRoutes() {
  return {
    GET: async (request: Request, context: Context) => {
      const gate = await gateAuthoringRead(request);
      if (!gate.ok) return gate.response;
      try {
        const params = await context.params;
        const kind = parseTargetKind(params.kind);
        const id = positiveId(params.id, "id");
        await resolveAggregateLevel(kind, id);
        const notes = await listReviewNotes(noteTarget(kind, id));
        return authoringData({ kind, id, notes });
      } catch (error) {
        return authoringException(error, "authoring notes GET");
      }
    },
    POST: async (request: Request, context: Context) => {
      const gate = await gateAuthoringMutation(request, "author");
      if (!gate.ok) return gate.response;
      try {
        const params = await context.params;
        const kind = parseTargetKind(params.kind);
        const id = positiveId(params.id, "id");
        const body = parseBody(reviewNoteBodySchema, await readJsonBody(request));
        await resolveAggregateLevel(kind, id);
        // `targetRevision` is read inside the domain's transaction, never here
        // and never from the caller.
        const note = await addReviewNote({
          target: noteTarget(kind, id),
          body: body.body,
          path: body.path ?? null,
          authorId: gate.actor.actorId,
        });
        return authoringData(note, 201);
      } catch (error) {
        return authoringException(error, "authoring notes POST");
      }
    },
  };
}

export function authoringNoteResolveRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringMutation(request, "author");
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const kind = parseTargetKind(params.kind);
      const id = positiveId(params.id, "id");
      const noteId = positiveId(params.noteId, "noteId");
      // The target travels with the resolution, and the domain verifies the note
      // really belongs to it: knowing a note id is not permission to close it.
      const resolved = await resolveReviewNote({
        noteId,
        target: noteTarget(kind, id),
        actorId: gate.actor.actorId,
      });
      return authoringData(resolved);
    } catch (error) {
      return authoringException(error, "authoring note resolve POST");
    }
  };
}

/* ------------------------------------------------------------------ *
 * Video production
 * ------------------------------------------------------------------ */

export function authoringVideoProductionRoutes() {
  return {
    GET: async (request: Request, context: Context) => {
      const gate = await gateAuthoringRead(request);
      if (!gate.ok) return gate.response;
      try {
        const params = await context.params;
        const id = positiveId(params.id, "id");
        const row = await prisma.videoProductionVersion.findUnique({
          where: { id },
          select: {
            id: true,
            levelDefinitionId: true,
            levelNumber: true,
            versionNumber: true,
            revision: true,
            editorialState: true,
            contractVersion: true,
            sourceProvenance: true,
            scriptState: true,
            videoState: true,
            qaState: true,
            contractFingerprint: true,
            assessmentFingerprint: true,
            productionEvidenceStale: true,
            contractPayload: true,
          },
        });
        if (!row) {
          throw new AuthoringDomainError(
            "AUTHORING_TARGET_NOT_FOUND",
            `VideoProductionVersion ${id} does not exist`,
          );
        }
        return authoringData({
          ...row,
          // Server truth, read-only for the caller. The CRM never computes one.
          coherence: await readVideoProductionCoherence(id, prisma),
        });
      } catch (error) {
        return authoringException(error, "authoring video GET");
      }
    },
    PUT: async (request: Request, context: Context) => {
      const gate = await gateAuthoringMutation(request, "author");
      if (!gate.ok) return gate.response;
      try {
        const params = await context.params;
        const id = positiveId(params.id, "id");
        const body = parseBody(videoContractBodySchema, await readJsonBody(request));
        const updated = await updateVideoProductionContract({
          id,
          expectedRevision: body.expectedRevision,
          payload: body.payload,
          actorId: gate.actor.actorId,
        });
        return authoringData({
          id: updated.id,
          revision: updated.revision,
          editorialState: updated.editorialState,
          scriptState: updated.scriptState,
          videoState: updated.videoState,
          qaState: updated.qaState,
          contractFingerprint: updated.contractFingerprint,
          productionEvidenceStale: updated.productionEvidenceStale,
          coherence: await readVideoProductionCoherence(updated.id, prisma),
        });
      } catch (error) {
        return authoringException(error, "authoring video PUT");
      }
    },
  };
}

export function authoringCreateVideoProductionRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringMutation(request, "author");
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const levelDefinitionId = positiveId(params.levelId, "levelId");
      const body = parseBody(createVideoContractBodySchema, await readJsonBody(request));
      const level = await prisma.levelDefinition.findUnique({
        where: { id: levelDefinitionId },
        select: { curriculumVersionId: true },
      });
      if (!level) {
        throw new AuthoringDomainError(
          "AUTHORING_TARGET_NOT_FOUND",
          `LevelDefinition ${levelDefinitionId} does not exist`,
        );
      }
      const created = await createVideoProductionVersion({
        levelDefinitionId,
        curriculumVersionId: level.curriculumVersionId,
        payload: body.payload,
        actorId: gate.actor.actorId,
      });
      return authoringData({ id: created.id, revision: created.revision, versionNumber: created.versionNumber }, 201);
    } catch (error) {
      return authoringException(error, "authoring video POST");
    }
  };
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

/**
 * Create an immutable preview snapshot.
 *
 * `curriculum_read` (§6 — a read-only reviewer must be able to preview), with
 * CSRF enforced explicitly by `gateAuthoringMutation`. No revision is accepted:
 * `createPreviewSnapshot` reads each named version's revision inside its own
 * transaction.
 */
export function authoringPreviewCreateRoute() {
  return async (request: Request) => {
    const gate = await gateAuthoringMutation(request, "read");
    if (!gate.ok) return gate.response;
    try {
      const body = parseBody(createPreviewBodySchema, await readJsonBody(request));
      const created = await createLevelPreviewSnapshot({
        levelDefinitionId: body.levelDefinitionId,
        contentVersionId: body.contentVersionId,
        assessmentVersionId: body.assessmentVersionId,
        videoProductionVersionId: body.videoProductionVersionId,
        actorId: gate.actor.actorId,
      });
      return authoringData(created, 201);
    } catch (error) {
      return authoringException(error, "authoring preview POST");
    }
  };
}

/**
 * THE LEARNER-SAFE READ, served to Academy.
 *
 * `snapshotCode` is an identifier and never a credential: this handler resolves
 * the caller's staff session and re-checks `curriculum_read` exactly as every
 * other authoring surface does. An unauthenticated request is refused before the
 * code is even looked at.
 */
export function authoringPreviewReadRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const code = String(params.snapshotCode ?? "");
      if (code.length === 0 || code.length > 128) {
        throw new Phase4HttpError("AUTHORING_INPUT_INVALID", 400, [
          { code: "INPUT_INVALID", path: "snapshotCode", message: "malformed snapshot code" },
        ]);
      }
      const snapshot = await readLearnerPreview(code);
      if (!snapshot) {
        throw new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", "preview snapshot not found");
      }
      return authoringData(snapshot);
    } catch (error) {
      return authoringException(error, "authoring preview GET");
    }
  };
}

export function authoringPreviewInternalRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const code = String(params.snapshotCode ?? "");
      const snapshot = await readInternalPreview(code);
      if (!snapshot) {
        throw new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", "preview snapshot not found");
      }
      return authoringData(snapshot);
    } catch (error) {
      return authoringException(error, "authoring preview internal GET");
    }
  };
}

/* ------------------------------------------------------------------ *
 * Package handoff
 * ------------------------------------------------------------------ */

export function authoringHandoffStatusRoute() {
  return async (request: Request) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const curriculumVersionId = await resolveVersionId(request);
      const levels = await readAuthoringOverview(curriculumVersionId);
      const statuses = levels.map(levelHandoffStatus);
      return authoringData({
        curriculumVersionId,
        // Named so no reader can mistake this for a publication surface.
        meaning: "READY_FOR_PACKAGE_HANDOFF is not runtime publication and not deployment",
        readyLevels: statuses.filter((status) => status.ready).map((status) => status.levelNumber),
        blocked: statuses.filter((status) => !status.ready),
      });
    } catch (error) {
      return authoringException(error, "authoring handoff GET");
    }
  };
}

/**
 * Produce a deterministic handoff bundle.
 *
 * A POST because it records an audit row, and `curriculum_author` because
 * assembling approved editorial data for engineering is authoring work — not
 * approval, and certainly not publication. Nothing on this path writes a
 * curriculum row, touches `status`, creates a binding or reaches git (§38).
 */
export function authoringHandoffBundleRoute() {
  return async (request: Request) => {
    const gate = await gateAuthoringMutation(request, "author");
    if (!gate.ok) return gate.response;
    try {
      const body = parseBody(handoffBodySchema, await readJsonBody(request));
      const bundle = await buildHandoffBundle({
        curriculumVersionId: body.curriculumVersionId,
        levelNumbers: body.levelNumbers,
        actorId: gate.actor.actorId,
      });
      return authoringData(bundle);
    } catch (error) {
      return authoringException(error, "authoring handoff POST");
    }
  };
}

/* ------------------------------------------------------------------ *
 * Notes for a whole level (convenience read used by the workspace)
 * ------------------------------------------------------------------ */

export function authoringLevelNotesRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const levelDefinitionId = positiveId(params.levelId, "levelId");
      const curriculumVersionId = await resolveVersionId(request);
      const levels = await readAuthoringOverview(curriculumVersionId);
      const level = levels.find((row) => row.levelDefinitionId === levelDefinitionId);
      if (!level) {
        throw new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", "level not found");
      }
      const notes = await readNotesForLevel({
        contentVersionId: level.content?.id ?? null,
        assessmentVersionId: level.assessment?.id ?? null,
        videoProductionVersionId: level.video?.id ?? null,
      });
      return authoringData({ levelDefinitionId, notes });
    } catch (error) {
      return authoringException(error, "authoring level notes GET");
    }
  };
}

/**
 * PHASE-G1 CORRECTION — `GET .../levels/{levelId}/structural-preview`.
 *
 * The staff preview of a level that carries no authored learner material: the
 * registration gate, the financial checkpoints, the report level. Read-only,
 * `curriculum_read`, `no-store`, and it creates nothing — see
 * `readStructuralPreview` for why a frozen snapshot is neither possible nor
 * needed for a level whose structure the Studio cannot mutate.
 */
export function authoringStructuralPreviewRoute() {
  return async (request: Request, context: Context) => {
    const gate = await gateAuthoringRead(request);
    if (!gate.ok) return gate.response;
    try {
      const params = await context.params;
      const levelId = positiveId(params.levelId, "levelId");
      return authoringData(await readStructuralPreview(levelId));
    } catch (error) {
      return authoringException(error, "authoring structural preview GET");
    }
  };
}
