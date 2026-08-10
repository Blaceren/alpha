/**
 * PHASE-G2 FOUNDATION — explicit source-authority adjudication (§4–§22).
 *
 * WHAT WAS MISSING. `authoring-conflict.ts` can SEE that the Blueprint proposal
 * and the durable bank disagree on a field, and it stops there — deliberately,
 * because G1 had no accepted way to record that a human compared the two and
 * chose. The only mechanical routes to a zero conflict count were to edit one
 * side into the other or to relabel `sourceProvenance`, and both destroy the
 * fact that a choice was ever made. This module is the missing sentence:
 *
 *     "a named human compared THESE TWO EXACT VALUES, chose this side, for this
 *      reason, on this evidence, at this time."
 *
 * IT RECORDS A DECISION, NEVER A VALUE. Nothing here writes a prompt, an option
 * or an answer key. The raw disagreement stays exactly where it always was —
 * recomputed live from the two sides by the accepted comparison — and stays
 * fully inspectable after adjudication. What a resolution changes is whether
 * that raw disagreement still BLOCKS, which is a different question from whether
 * it still EXISTS. Collapsing the two is precisely the evidence destruction §5
 * forbids, so this module keeps two counts and never one.
 *
 * A DECISION IS ONLY ABOUT THE PAIR IT WAS MADE ABOUT. Both sides are pinned by
 * hash at decision time. If either moves afterwards the decision stops applying
 * — it does not silently keep resolving a conflict nobody adjudicated. That is
 * the whole of §7, and it is why `evaluateApplication` below is the only place
 * allowed to decide that a stored decision is currently in force.
 *
 * DECISION IS NOT APPLICATION (§20–§22). Choosing BLUEPRINT does not make the
 * Blueprint's words appear in the bank; a later content mutation has to do that.
 * Until it does, the decision is real and recorded but NOT in force, and the
 * conflict still blocks. Only a decision whose selected side is what the bank
 * actually serves is `APPLIED`.
 *
 * PROVENANCE IS NOT TOUCHED (§8). `sourceProvenance` keeps meaning "where the
 * material came from" and is never rewritten to make a conflict disappear. The
 * projection reports origin and authority as two separate facts, so a level can
 * truthfully read: origin PROPOSED_CANON, raw conflicts 7, authority
 * ADJUDICATED_CURRENT, blocking 0.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  BLUEPRINT_CONFLICT_FIELDS,
  compareBlueprintProposal,
  type BlueprintConflict,
  type BlueprintConflictField,
} from "@/lib/curriculum/authoring-conflict";
import {
  projectAssessmentBank,
  calculateBankFingerprint,
  type AssessmentBankProjection,
} from "@/lib/curriculum/authoring-assessment-projection";
import { AuthoringDomainError, isAuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { parseContractPayload } from "@/lib/curriculum/video-production-authoring";
import {
  calculateContractFingerprint,
  type VideoProductionContract,
} from "@/lib/curriculum/video-production-contract";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;

/* ------------------------------------------------------------------ *
 * Vocabularies — closed, like every other authoring vocabulary
 * ------------------------------------------------------------------ */

/** Which side of the disagreement a human chose. */
export const SOURCE_AUTHORITY_DECISIONS = ["CURRENT", "BLUEPRINT"] as const;
export type SourceAuthorityDecision = (typeof SOURCE_AUTHORITY_DECISIONS)[number];

/**
 * Whether a recorded decision is currently IN FORCE.
 *
 * `APPLIED`              the side that was chosen is the side the bank serves.
 * `DECIDED_NOT_APPLIED`  the choice is recorded, the bank still serves the other
 *                        side, and the conflict therefore still blocks.
 * `STALE`                at least one of the two adjudicated values has moved,
 *                        so the decision no longer describes reality.
 */
export const SOURCE_AUTHORITY_APPLICATIONS = ["APPLIED", "DECIDED_NOT_APPLIED", "STALE"] as const;
export type SourceAuthorityApplication = (typeof SOURCE_AUTHORITY_APPLICATIONS)[number];

/**
 * The derived state a reviewer, readiness and the handoff all read.
 *
 * `ADJUDICATION_STALE` is its own state rather than folded into
 * `UNRESOLVED_CONFLICT` because the two need different work: an unresolved
 * conflict needs a decision, a stale one needs a decision RE-MADE against values
 * that changed underneath it. Reporting both as "unresolved" would send a
 * reviewer looking for a conflict that may no longer exist.
 */
export const SOURCE_AUTHORITY_STATES = [
  "NO_CONFLICT",
  "UNRESOLVED_CONFLICT",
  "ADJUDICATION_STALE",
  "ADJUDICATED_CURRENT",
  "ADJUDICATED_BLUEPRINT",
  "ADJUDICATED_MIXED",
] as const;
export type SourceAuthorityState = (typeof SOURCE_AUTHORITY_STATES)[number];

/* ------------------------------------------------------------------ *
 * Value identity
 * ------------------------------------------------------------------ */

/**
 * The identity of one adjudicated value.
 *
 * Hashed rather than copied because this table must never become a second home
 * for learner-facing strings: a stored copy would be one more thing that can
 * drift from the bank, and the only question a resolution has to answer is
 * "is this still the same value?", which a hash answers exactly.
 *
 * Hashed over the EXACT stored string, with the same no-normalisation rule the
 * accepted comparison uses — trimming here would let two values the comparison
 * calls different be adjudicated as one.
 */
export function hashAuthorityValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/* ------------------------------------------------------------------ *
 * The live value of every adjudicable field
 * ------------------------------------------------------------------ */

export type AuthorityFieldValues = {
  questionIndex: number;
  field: BlueprintConflictField;
  path: string;
  /** What the bank serves today. */
  currentValue: string;
  /** What the contract proposes today. */
  blueprintValue: string;
};

function correctOptionText(
  question: { options: ReadonlyArray<{ optionCode: string; text: string }>; correctOptionCode: string } | undefined,
): string {
  if (!question) return "";
  return question.options.find((option) => option.optionCode === question.correctOptionCode)?.text ?? "";
}

/**
 * Every adjudicable field, whether or not the two sides currently differ.
 *
 * The conflict list alone is not enough. A BLUEPRINT decision that has been
 * carried out makes the two sides EQUAL, so the conflict disappears while the
 * decision is still the reason the bank says what it says. Evaluating that
 * decision needs the live values, not the list of differences.
 */
export function readAuthorityFieldValues(
  bank: AssessmentBankProjection,
  contract: VideoProductionContract,
): AuthorityFieldValues[] {
  const values: AuthorityFieldValues[] = [];
  const count = Math.min(bank.questions.length, contract.questions.length);
  for (let questionIndex = 0; questionIndex < count; questionIndex += 1) {
    const current = bank.questions[questionIndex];
    const proposal = contract.questions[questionIndex];
    for (const field of BLUEPRINT_CONFLICT_FIELDS) {
      values.push({
        questionIndex,
        field,
        path: `questions[${questionIndex}].${field}`,
        currentValue: field === "prompt" ? current.prompt : correctOptionText(current),
        blueprintValue: field === "prompt" ? proposal.prompt : correctOptionText(proposal),
      });
    }
  }
  return values;
}

/* ------------------------------------------------------------------ *
 * Is a stored decision currently in force?
 * ------------------------------------------------------------------ */

export type StoredResolution = {
  id: number;
  questionIndex: number;
  field: string;
  conflictPath: string;
  decision: string;
  currentValueHash: string;
  blueprintValueHash: string;
  blueprintSourceDocumentSha256: string;
  contractFingerprintAtDecision: string;
  bankFingerprintAtDecision: string;
  assessmentRevisionAtDecision: number;
  rationale: string;
  evidenceRef: string;
  evidenceSha256: string;
  batchId: string;
  decidedById: number;
  decidedAt: Date;
};

/**
 * THE ONLY PLACE a stored decision is declared in force.
 *
 * Read the branches as one sentence: a decision is dead the moment the proposal
 * it was made against changes, and otherwise it is in force exactly when the
 * side it selected is the side the bank now serves.
 */
export function evaluateApplication(
  row: Pick<StoredResolution, "decision" | "currentValueHash" | "blueprintValueHash">,
  live: { currentValue: string; blueprintValue: string } | null,
): SourceAuthorityApplication {
  // A field that no longer exists on one of the sides cannot be in force.
  if (!live) return "STALE";

  // The proposal moved. Nothing decided against the old proposal survives it,
  // whichever side won — the human compared a pair that no longer exists.
  if (hashAuthorityValue(live.blueprintValue) !== row.blueprintValueHash) return "STALE";

  const liveCurrentHash = hashAuthorityValue(live.currentValue);

  if (row.decision === "CURRENT") {
    // CURRENT won, so the decision is in force while the bank still serves the
    // value that won. If the bank moved, nobody adjudicated what it says now.
    return liveCurrentHash === row.currentValueHash ? "APPLIED" : "STALE";
  }

  // BLUEPRINT won. It is in force only once the bank actually serves the
  // Blueprint's words — recording the decision does not move any content, and
  // claiming otherwise is exactly the false "resolved" §20 refuses.
  if (liveCurrentHash === row.blueprintValueHash) return "APPLIED";
  // The bank still serves the value that LOST. Honest, recorded, not in force.
  if (liveCurrentHash === row.currentValueHash) return "DECIDED_NOT_APPLIED";
  // The bank serves something neither side was adjudicated against.
  return "STALE";
}

/* ------------------------------------------------------------------ *
 * The projection
 * ------------------------------------------------------------------ */

export type SourceAuthorityDecisionView = {
  questionIndex: number;
  field: BlueprintConflictField;
  path: string;
  decision: SourceAuthorityDecision;
  application: SourceAuthorityApplication;
  /** True while the two sides still differ on this field. */
  rawConflictPresent: boolean;
  decidedById: number;
  decidedAt: string;
  rationale: string;
  evidenceRef: string;
  evidenceSha256: string;
  blueprintSourceDocumentSha256: string;
  batchId: string;
};

export type SourceAuthorityProjection = {
  assessmentVersionId: number;
  videoProductionVersionId: number | null;
  /** Null when the bank cannot be projected — reported, never guessed around. */
  comparable: boolean;
  unprojectableReason: string | null;
  state: SourceAuthorityState;
  /** Every field-level disagreement that exists RIGHT NOW. Never reduced by a decision. */
  rawConflictCount: number;
  /** Raw conflicts covered by a decision that is in force. */
  resolvedConflictCount: number;
  /** Raw conflicts NOT covered by a decision in force. This is what blocks. */
  blockingConflictCount: number;
  decisions: SourceAuthorityDecisionView[];
  /**
   * Identity of the adjudication lineage, or null when there is none.
   * DELIBERATELY NOT the assessment fingerprint — see §18 and
   * `calculateAuthorityResolutionFingerprint`.
   */
  resolutionFingerprint: string | null;
};

/**
 * The AUTHORITY-LINEAGE fingerprint (§18).
 *
 * SEPARATE FROM `assessmentFingerprint` ON PURPOSE. That hash answers "did the
 * questions change?" and a CURRENT adjudication changes no question, so folding
 * adjudication into it would make an editorial decision masquerade as a content
 * edit and mark recorded video QA stale for nothing. This hash answers a
 * different question — "is this the same adjudication?" — and moves whenever the
 * decisions, the values they were made against, the evidence or the deciders
 * change.
 *
 * Projected key-by-key in a fixed order over the ACTIVE decisions sorted by
 * their path, so two reads of an unchanged database produce the identical hash.
 */
export function calculateAuthorityResolutionFingerprint(
  rows: ReadonlyArray<
    Pick<
      StoredResolution,
      | "questionIndex"
      | "field"
      | "decision"
      | "currentValueHash"
      | "blueprintValueHash"
      | "blueprintSourceDocumentSha256"
      | "evidenceSha256"
      | "decidedById"
      | "decidedAt"
    >
  >,
): string | null {
  if (rows.length === 0) return null;
  const projection = [...rows]
    .sort((a, b) => a.questionIndex - b.questionIndex || a.field.localeCompare(b.field))
    .map((row) => ({
      questionIndex: row.questionIndex,
      field: row.field,
      decision: row.decision,
      currentValueHash: row.currentValueHash,
      blueprintValueHash: row.blueprintValueHash,
      blueprintSourceDocumentSha256: row.blueprintSourceDocumentSha256,
      evidenceSha256: row.evidenceSha256,
      decidedById: row.decidedById,
      decidedAt: row.decidedAt.toISOString(),
    }));
  return createHash("sha256").update(JSON.stringify(projection), "utf8").digest("hex");
}

function deriveState(input: {
  rawConflictCount: number;
  blockingConflictCount: number;
  decisions: readonly SourceAuthorityDecisionView[];
}): SourceAuthorityState {
  // Blocking first. A level that still owes a decision owes it regardless of how
  // much else was adjudicated, and an "ADJUDICATED" badge would hide that.
  if (input.blockingConflictCount > 0) return "UNRESOLVED_CONFLICT";
  if (input.decisions.some((decision) => decision.application === "STALE")) return "ADJUDICATION_STALE";
  if (input.decisions.length === 0) return "NO_CONFLICT";
  const chosen = new Set(input.decisions.map((decision) => decision.decision));
  if (chosen.size > 1) return "ADJUDICATED_MIXED";
  return chosen.has("CURRENT") ? "ADJUDICATED_CURRENT" : "ADJUDICATED_BLUEPRINT";
}

export async function readSourceAuthority(
  tx: DbClient,
  input: { assessmentVersionId: number; videoProductionVersionId: number | null; contract: VideoProductionContract | null },
): Promise<SourceAuthorityProjection> {
  const activeRows = (await tx.sourceAuthorityResolution.findMany({
    where: { assessmentVersionId: input.assessmentVersionId, supersededAt: null },
    orderBy: [{ questionIndex: "asc" }, { field: "asc" }],
  })) as unknown as StoredResolution[];

  const base = {
    assessmentVersionId: input.assessmentVersionId,
    videoProductionVersionId: input.videoProductionVersionId,
  };

  // No contract means no proposal, so there is nothing to disagree with. Any
  // stored decision is reported as stale rather than silently dropped.
  if (!input.contract || input.videoProductionVersionId === null) {
    const decisions = activeRows.map((row) => toView(row, "STALE", false));
    return {
      ...base,
      comparable: false,
      unprojectableReason: "NO_PRODUCTION_CONTRACT",
      state: decisions.length === 0 ? "NO_CONFLICT" : "ADJUDICATION_STALE",
      rawConflictCount: 0,
      resolvedConflictCount: 0,
      blockingConflictCount: 0,
      decisions,
      resolutionFingerprint: calculateAuthorityResolutionFingerprint(activeRows),
    };
  }

  let bank: AssessmentBankProjection;
  try {
    bank = await projectAssessmentBank(tx, input.assessmentVersionId);
  } catch (error) {
    if (!isAuthoringDomainError(error)) throw error;
    const decisions = activeRows.map((row) => toView(row, "STALE", false));
    return {
      ...base,
      comparable: false,
      unprojectableReason: error.code,
      rawConflictCount: 0,
      resolvedConflictCount: 0,
      blockingConflictCount: 0,
      state: decisions.length === 0 ? "NO_CONFLICT" : "ADJUDICATION_STALE",
      decisions,
      resolutionFingerprint: calculateAuthorityResolutionFingerprint(activeRows),
    };
  }

  const liveValues = new Map<string, AuthorityFieldValues>();
  for (const value of readAuthorityFieldValues(bank, input.contract)) {
    liveValues.set(value.path, value);
  }

  const rawConflictPaths = new Set<string>();
  for (const value of liveValues.values()) {
    if (value.currentValue !== value.blueprintValue) rawConflictPaths.add(value.path);
  }

  const decisions: SourceAuthorityDecisionView[] = activeRows.map((row) => {
    const live = liveValues.get(row.conflictPath) ?? null;
    return toView(row, evaluateApplication(row, live), rawConflictPaths.has(row.conflictPath));
  });

  const inForce = new Set(
    decisions.filter((decision) => decision.application === "APPLIED").map((decision) => decision.path),
  );
  const blocking = [...rawConflictPaths].filter((path) => !inForce.has(path));

  return {
    ...base,
    comparable: true,
    unprojectableReason: null,
    rawConflictCount: rawConflictPaths.size,
    resolvedConflictCount: rawConflictPaths.size - blocking.length,
    blockingConflictCount: blocking.length,
    state: deriveState({
      rawConflictCount: rawConflictPaths.size,
      blockingConflictCount: blocking.length,
      decisions,
    }),
    decisions,
    resolutionFingerprint: calculateAuthorityResolutionFingerprint(activeRows),
  };
}

function toView(
  row: StoredResolution,
  application: SourceAuthorityApplication,
  rawConflictPresent: boolean,
): SourceAuthorityDecisionView {
  return {
    questionIndex: row.questionIndex,
    field: row.field as BlueprintConflictField,
    path: row.conflictPath,
    decision: row.decision as SourceAuthorityDecision,
    application,
    rawConflictPresent,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt.toISOString(),
    rationale: row.rationale,
    evidenceRef: row.evidenceRef,
    evidenceSha256: row.evidenceSha256,
    blueprintSourceDocumentSha256: row.blueprintSourceDocumentSha256,
    batchId: row.batchId,
  };
}

/**
 * The count that BLOCKS, for readiness and the work queue.
 *
 * Its own exported helper so no caller has to remember that "conflicts" and
 * "conflicts that still block" are two numbers.
 */
export async function countBlockingConflicts(
  tx: DbClient,
  input: { assessmentVersionId: number; videoProductionVersionId: number | null; contract: VideoProductionContract | null },
): Promise<{ rawConflictCount: number; blockingConflictCount: number; state: SourceAuthorityState; resolutionFingerprint: string | null }> {
  const projection = await readSourceAuthority(tx, input);
  return {
    rawConflictCount: projection.rawConflictCount,
    blockingConflictCount: projection.blockingConflictCount,
    state: projection.state,
    resolutionFingerprint: projection.resolutionFingerprint,
  };
}

/* ------------------------------------------------------------------ *
 * The command
 * ------------------------------------------------------------------ */

export type SourceAuthorityScope =
  | { kind: "assessment" }
  | { kind: "question"; questionIndex: number };

export type SourceAuthorityDecisionInput = {
  questionIndex: number;
  field: BlueprintConflictField;
  decision: SourceAuthorityDecision;
  /** The caller's view of what it is deciding about. Verified, never trusted. */
  currentValueHash: string;
  blueprintValueHash: string;
};

export type ResolveSourceAuthorityInput = {
  assessmentVersionId: number;
  expectedAssessmentRevision: number;
  expectedVideoProductionRevision: number;
  scope: SourceAuthorityScope;
  decisions: readonly SourceAuthorityDecisionInput[];
  rationale: string;
  evidenceRef: string;
  evidenceSha256: string;
  actorId: number;
  /**
   * Re-deciding a STALE slot must be deliberate. Without this the command
   * refuses rather than quietly replacing a decision a human made about
   * different values.
   */
  supersedeStale?: boolean;
};

export type ResolveSourceAuthorityResult = {
  batchId: string;
  created: number;
  superseded: number;
  /** Slots whose identical decision already existed — the idempotent path. */
  unchanged: number;
  before: SourceAuthorityProjection;
  after: SourceAuthorityProjection;
};

const MAX_RATIONALE = 2_000;
const MAX_EVIDENCE_REF = 300;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function invalid(message: string, path = "input"): never {
  throw new AuthoringDomainError("AUTHORING_INPUT_INVALID", message, {
    issues: [{ code: "AUTHORING_SOURCE_AUTHORITY_INPUT_INVALID", path, message }],
  });
}

/**
 * Record an adjudication for a coherent set of conflicts, atomically.
 *
 * WHY THE WHOLE SET RATHER THAN ONE FIELD AT A TIME. A prompt and its answer can
 * be semantically inseparable, and seven independent writes can leave a bank in
 * a state no human ever approved — half adjudicated, with nothing recording that
 * the other half was still open. One request, one transaction, one batch.
 *
 * WHY THE CALLER SENDS HASHES. They are the caller's statement of WHICH conflict
 * it believes it is settling. If the bank or the proposal moved between the
 * reviewer reading the comparison and pressing the button, the hashes disagree
 * and the whole request is refused — a reviewer must never adjudicate a pair
 * they were not shown.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not bump the assessment aggregate,
 * does not touch `editorialState`, does not approve anything and does not write
 * a single learner-facing character. Adjudication is not authoring and it is not
 * review (§13) — after this runs, the bank still has to be submitted and
 * approved by someone else exactly as before.
 */
export async function resolveSourceAuthority(
  input: ResolveSourceAuthorityInput,
): Promise<ResolveSourceAuthorityResult> {
  if (!Number.isInteger(input.assessmentVersionId) || input.assessmentVersionId <= 0) {
    invalid("assessmentVersionId must be a positive integer", "assessmentVersionId");
  }
  if (typeof input.rationale !== "string" || input.rationale.trim().length === 0) {
    invalid("a rationale is required — an adjudication with no stated reason is not evidence", "rationale");
  }
  if (input.rationale.length > MAX_RATIONALE) invalid(`rationale exceeds ${MAX_RATIONALE} characters`, "rationale");
  if (typeof input.evidenceRef !== "string" || input.evidenceRef.trim().length === 0) {
    invalid("an evidenceRef is required", "evidenceRef");
  }
  if (input.evidenceRef.length > MAX_EVIDENCE_REF) invalid(`evidenceRef exceeds ${MAX_EVIDENCE_REF} characters`, "evidenceRef");
  if (!SHA256_PATTERN.test(input.evidenceSha256)) invalid("evidenceSha256 must be lowercase sha256 hex", "evidenceSha256");
  if (!Array.isArray(input.decisions) || input.decisions.length === 0) {
    invalid("at least one decision is required", "decisions");
  }

  const seen = new Set<string>();
  for (const decision of input.decisions) {
    if (!Number.isInteger(decision.questionIndex) || decision.questionIndex < 0) {
      invalid("questionIndex must be a non-negative integer", "decisions");
    }
    if (!(BLUEPRINT_CONFLICT_FIELDS as readonly string[]).includes(decision.field)) {
      invalid(`field "${decision.field}" is not an adjudicable conflict field`, "decisions");
    }
    if (!(SOURCE_AUTHORITY_DECISIONS as readonly string[]).includes(decision.decision)) {
      invalid(`decision "${decision.decision}" is outside the accepted CURRENT|BLUEPRINT contract`, "decisions");
    }
    if (!SHA256_PATTERN.test(decision.currentValueHash) || !SHA256_PATTERN.test(decision.blueprintValueHash)) {
      invalid("both value hashes must be lowercase sha256 hex", "decisions");
    }
    const key = `questions[${decision.questionIndex}].${decision.field}`;
    if (seen.has(key)) invalid(`duplicate decision for ${key}`, "decisions");
    seen.add(key);
  }

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessmentVersion.findUnique({
      where: { id: input.assessmentVersionId },
      select: {
        id: true,
        revision: true,
        levelDefinitionId: true,
        curriculumVersionId: true,
        videoProductionLinks: { select: { videoProductionVersionId: true } },
      },
    });
    if (!assessment) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `AssessmentVersion ${input.assessmentVersionId} does not exist`,
      );
    }
    if (assessment.revision !== input.expectedAssessmentRevision) {
      throw new AuthoringDomainError(
        "AUTHORING_REVISION_CONFLICT",
        "the assessment moved while this adjudication was being prepared",
        { actualRevision: assessment.revision },
      );
    }

    const link = assessment.videoProductionLinks[0];
    if (!link) {
      throw new AuthoringDomainError(
        "AUTHORING_ASSESSMENT_LINK_MISSING",
        "this bank is not linked to a video production contract, so it has no Blueprint proposal to adjudicate against",
      );
    }

    const videoRow = await tx.videoProductionVersion.findUnique({
      where: { id: link.videoProductionVersionId },
      select: { id: true, revision: true, contractPayload: true },
    });
    if (!videoRow) {
      throw new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", "the linked video production version is missing");
    }
    if (videoRow.revision !== input.expectedVideoProductionRevision) {
      throw new AuthoringDomainError(
        "AUTHORING_REVISION_CONFLICT",
        "the video production contract moved while this adjudication was being prepared",
        { actualRevision: videoRow.revision },
      );
    }

    const contract = parseContractPayload(videoRow.contractPayload);
    const before = await readSourceAuthority(tx, {
      assessmentVersionId: assessment.id,
      videoProductionVersionId: videoRow.id,
      contract,
    });
    if (!before.comparable) {
      throw new AuthoringDomainError(
        "AUTHORING_ASSESSMENT_PROJECTION_INVALID",
        `the bank cannot be compared to its proposal (${before.unprojectableReason}), so nothing can be adjudicated`,
      );
    }

    const bank = await projectAssessmentBank(tx, assessment.id);
    const liveValues = new Map<string, AuthorityFieldValues>();
    for (const value of readAuthorityFieldValues(bank, contract)) liveValues.set(value.path, value);

    const rawConflicts = await compareBlueprintProposal(tx, {
      contract,
      assessmentVersionId: assessment.id,
      videoProductionVersionId: videoRow.id,
    });

    /* --- structural completeness for the REQUESTED scope (§10) --- */
    const inScope = (conflict: BlueprintConflict) =>
      input.scope.kind === "assessment" ? true : conflict.questionIndex === input.scope.questionIndex;
    const required = rawConflicts.conflicts.filter(inScope);
    const requiredPaths = new Set(required.map((conflict) => conflict.path));
    const submittedPaths = new Set(
      input.decisions.map((decision) => `questions[${decision.questionIndex}].${decision.field}`),
    );

    const missing = [...requiredPaths].filter((path) => !submittedPaths.has(path)).sort();
    const extra = [...submittedPaths].filter((path) => !requiredPaths.has(path)).sort();
    if (missing.length > 0 || extra.length > 0) {
      throw new AuthoringDomainError(
        "AUTHORING_VALIDATION_FAILED",
        input.scope.kind === "assessment"
          ? "an assessment-scoped adjudication must decide every raw conflict this bank has, and only those"
          : `a question-scoped adjudication must decide every raw conflict on question ${input.scope.questionIndex}, and only those`,
        {
          issues: [
            ...missing.map((path) => ({
              code: "AUTHORING_SOURCE_AUTHORITY_INCOMPLETE",
              path,
              message: `${path} is an unresolved raw conflict in the requested scope and no decision was supplied`,
            })),
            ...extra.map((path) => ({
              code: "AUTHORING_SOURCE_AUTHORITY_OUT_OF_SCOPE",
              path,
              message: `${path} is not an unresolved raw conflict in the requested scope`,
            })),
          ],
        },
      );
    }

    /* --- the caller must be deciding about the values it was shown --- */
    const conflictByPath = new Map(required.map((conflict) => [conflict.path, conflict]));
    const mismatches: Array<{ code: string; path: string; message: string }> = [];
    for (const decision of input.decisions) {
      const path = `questions[${decision.questionIndex}].${decision.field}`;
      const conflict = conflictByPath.get(path)!;
      if (hashAuthorityValue(conflict.currentApprovedValue) !== decision.currentValueHash) {
        mismatches.push({
          code: "AUTHORING_SOURCE_AUTHORITY_VALUE_MISMATCH",
          path,
          message: "the current value moved since this comparison was read",
        });
      }
      if (hashAuthorityValue(conflict.blueprintProposalValue) !== decision.blueprintValueHash) {
        mismatches.push({
          code: "AUTHORING_SOURCE_AUTHORITY_VALUE_MISMATCH",
          path,
          message: "the Blueprint proposal moved since this comparison was read",
        });
      }
    }
    if (mismatches.length > 0) {
      throw new AuthoringDomainError(
        "AUTHORING_VALIDATION_FAILED",
        "the values being adjudicated are not the values this request was prepared against",
        { issues: mismatches },
      );
    }

    /* --- idempotent replay, refused contradiction, explicit supersession --- */
    const existing = (await tx.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: assessment.id, supersededAt: null },
    })) as unknown as StoredResolution[];
    const existingByPath = new Map(existing.map((row) => [row.conflictPath, row]));

    const contractFingerprint = calculateContractFingerprint(contract);
    const bankFingerprint = await calculateBankFingerprint(tx, assessment.id);
    const blueprintSourceDocumentSha256 = resolveBlueprintSourceSha();
    const batchId = createHash("sha256")
      .update(
        JSON.stringify({
          assessmentVersionId: assessment.id,
          contractFingerprint,
          bankFingerprint,
          evidenceSha256: input.evidenceSha256,
          decisions: [...input.decisions]
            .map((decision) => ({
              path: `questions[${decision.questionIndex}].${decision.field}`,
              decision: decision.decision,
              currentValueHash: decision.currentValueHash,
              blueprintValueHash: decision.blueprintValueHash,
            }))
            .sort((a, b) => a.path.localeCompare(b.path)),
        }),
        "utf8",
      )
      .digest("hex")
      .slice(0, 32);

    let created = 0;
    let superseded = 0;
    let unchanged = 0;

    for (const decision of input.decisions) {
      const path = `questions[${decision.questionIndex}].${decision.field}`;
      const prior = existingByPath.get(path);

      if (prior) {
        const identical =
          prior.decision === decision.decision &&
          prior.currentValueHash === decision.currentValueHash &&
          prior.blueprintValueHash === decision.blueprintValueHash &&
          prior.evidenceSha256 === input.evidenceSha256 &&
          prior.evidenceRef === input.evidenceRef;
        if (identical) {
          // The exact same decision, on the exact same values, on the exact same
          // evidence. Replay is a no-op: writing a second row would invent a
          // second adjudication that never happened.
          unchanged += 1;
          continue;
        }
        const priorApplication = evaluateApplication(prior, liveValues.get(path) ?? null);
        if (priorApplication !== "STALE" || input.supersedeStale !== true) {
          throw new AuthoringDomainError(
            "AUTHORING_STATE_INVALID",
            `${path} already carries a different active adjudication`,
            {
              issues: [
                {
                  code: "AUTHORING_SOURCE_AUTHORITY_ALREADY_DECIDED",
                  path,
                  message:
                    priorApplication === "STALE"
                      ? "the existing decision is stale — re-deciding it requires supersedeStale"
                      : "an active decision already exists and contradicts this request",
                },
              ],
            },
          );
        }
        await tx.sourceAuthorityResolution.update({
          where: { id: prior.id },
          data: { supersededAt: new Date(), supersededById: input.actorId },
        });
        superseded += 1;
      }

      await tx.sourceAuthorityResolution.create({
        data: {
          assessmentVersionId: assessment.id,
          videoProductionVersionId: videoRow.id,
          levelDefinitionId: assessment.levelDefinitionId,
          curriculumVersionId: assessment.curriculumVersionId,
          questionIndex: decision.questionIndex,
          field: decision.field,
          conflictPath: path,
          decision: decision.decision,
          currentValueHash: decision.currentValueHash,
          blueprintValueHash: decision.blueprintValueHash,
          blueprintSourceDocumentSha256,
          contractFingerprintAtDecision: contractFingerprint,
          bankFingerprintAtDecision: bankFingerprint,
          assessmentRevisionAtDecision: assessment.revision,
          rationale: input.rationale,
          evidenceRef: input.evidenceRef,
          evidenceSha256: input.evidenceSha256,
          batchId,
          decidedById: input.actorId,
        },
      });
      created += 1;
    }

    const after = await readSourceAuthority(tx, {
      assessmentVersionId: assessment.id,
      videoProductionVersionId: videoRow.id,
      contract,
    });

    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.authoringSourceAuthorityResolved,
        entityType: "AssessmentVersion",
        entityId: String(assessment.id),
        metadata: {
          batchId,
          levelDefinitionId: assessment.levelDefinitionId,
          curriculumVersionId: assessment.curriculumVersionId,
          videoProductionVersionId: videoRow.id,
          expectedAssessmentRevision: input.expectedAssessmentRevision,
          expectedVideoProductionRevision: input.expectedVideoProductionRevision,
          scope: input.scope.kind === "assessment" ? "assessment" : `question:${input.scope.questionIndex}`,
          // The exact conflicts, so the trail proves WHICH disagreement was
          // settled without anyone re-deriving it from a later database state.
          rawConflictPaths: rawConflicts.conflicts.map((conflict) => conflict.path),
          decisions: input.decisions.map((decision) => ({
            path: `questions[${decision.questionIndex}].${decision.field}`,
            decision: decision.decision,
            currentValueHash: decision.currentValueHash,
            blueprintValueHash: decision.blueprintValueHash,
          })),
          rationale: input.rationale,
          evidenceRef: input.evidenceRef,
          evidenceSha256: input.evidenceSha256,
          created,
          superseded,
          unchanged,
          beforeState: before.state,
          beforeBlockingConflictCount: before.blockingConflictCount,
          beforeResolutionFingerprint: before.resolutionFingerprint,
          afterState: after.state,
          afterBlockingConflictCount: after.blockingConflictCount,
          afterResolutionFingerprint: after.resolutionFingerprint,
        },
      },
    });

    return { batchId, created, superseded, unchanged, before, after };
  });
}

/**
 * The Blueprint document identity, read from the accepted canonical artifact.
 *
 * READ FROM SOURCE, NOT ACCEPTED FROM A CALLER. This is the one identity a
 * caller must not be able to choose: a resolution that let its own request name
 * the source document could claim to have adjudicated against any Blueprint at
 * all. The artifact is never written by this codebase, so reading it is safe and
 * its sha is the durable provenance anchor §6 asks for.
 */
let cachedBlueprintSourceSha: string | null = null;
export function resolveBlueprintSourceSha(): string {
  if (cachedBlueprintSourceSha) return cachedBlueprintSourceSha;
  // Imported lazily so the module stays usable in contexts with no filesystem
  // access to the artifact — the failure is explicit rather than a crash at load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const artifact = path.join(
    process.cwd(),
    "curriculum",
    "canonical",
    "ata-video-production-contracts.v1.json",
  );
  try {
    const parsed = JSON.parse(fs.readFileSync(artifact, "utf8")) as {
      provenance?: { sourceDocumentSha256?: unknown };
    };
    const sha = parsed.provenance?.sourceDocumentSha256;
    if (typeof sha === "string" && SHA256_PATTERN.test(sha)) {
      cachedBlueprintSourceSha = sha;
      return sha;
    }
  } catch {
    // fall through to the explicit refusal below
  }
  throw new AuthoringDomainError(
    "AUTHORING_INTERNAL_ERROR",
    "the canonical Blueprint artifact does not declare a usable sourceDocumentSha256, so an adjudication cannot record which document it was made against",
  );
}

/** Test seam: the artifact is read once per process and pinned. */
export function __resetBlueprintSourceShaCacheForTests(): void {
  cachedBlueprintSourceSha = null;
}
