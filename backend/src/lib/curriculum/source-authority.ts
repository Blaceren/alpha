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
import { staffRoleGrantsCurriculumCapability } from "@/lib/curriculum/authoring-authorization";
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
  /**
   * CORRECTION-2 — the comparison could not be made at all.
   *
   * SEPARATE FROM `NO_CONFLICT`, and the whole reason this state exists. "The
   * two sides agree" and "we could not find out whether they agree" are
   * different facts, and the second used to be reported as the first: a bank
   * whose canonical source contract no longer parsed projected `NO_CONFLICT`,
   * zero raw conflicts, provenance `APPROVED_CURRENT`, and went handoff-ready.
   * An unknown source is never evidence of agreement.
   */
  "SOURCE_UNAVAILABLE",
] as const;
export type SourceAuthorityState = (typeof SOURCE_AUTHORITY_STATES)[number];

/**
 * CORRECTION-2 — WHY the canonical Blueprint source could not be established.
 *
 * `SOURCE_CONTRACT_UNPARSEABLE` the bank's canonical production version exists
 *                               but its `contractPayload` no longer parses, so
 *                               there is no proposal to compare against.
 * `SOURCE_LINK_INCOMPATIBLE`    the bank carries a durable link to a production
 *                               version belonging to a DIFFERENT level or
 *                               curriculum version. The lineage is ambiguous, so
 *                               it is refused rather than silently stepped over.
 */
export const AUTHORITY_SOURCE_UNAVAILABLE_REASONS = [
  "SOURCE_CONTRACT_UNPARSEABLE",
  "SOURCE_LINK_INCOMPATIBLE",
] as const;
export type AuthoritySourceUnavailableReason = (typeof AUTHORITY_SOURCE_UNAVAILABLE_REASONS)[number];

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

/**
 * CORRECTION-1 (audit LOW-3) — the ONE key a conflict slot is looked up by.
 *
 * A row carries its identity twice: as `(questionIndex, field)`, which the
 * partial unique index enforces, and as the human-readable `conflictPath`. The
 * projection used to join on the PATH while the database guaranteed uniqueness on
 * the PAIR, so two representations of one identity had to agree with nothing
 * making them. Every lookup now uses the pair the index itself uses, and
 * `conflictPath` goes back to being what it was always documented as — a stored,
 * readable rendering of that pair, never the join key.
 *
 * The ordinal is a non-negative integer and the field comes from the closed
 * `BLUEPRINT_CONFLICT_FIELDS` vocabulary, so `<ordinal>:<field>` is unambiguous
 * and two distinct slots can never render to the same key.
 */
function slotKey(questionIndex: number, field: string): string {
  return `${questionIndex}:${field}`;
}

/** The accepted path grammar, rendered from the identity — never parsed back. */
export function conflictPathFor(questionIndex: number, field: string): string {
  return `questions[${questionIndex}].${field}`;
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
        path: conflictPathFor(questionIndex, field),
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

/**
 * PHASE-G2 SUCCESSOR — WHY an inherited decision was refused.
 *
 * Each value names a guard that failed, because "not inherited" is not one fact.
 * A moved prompt and a switched source contract need different work from a
 * reviewer, and collapsing them into a bare STALE would send someone looking for
 * an edit that never happened.
 */
export const AUTHORITY_INHERITANCE_REFUSALS = [
  /** The successor no longer serves the value that was adjudicated. */
  "VALUE_MOVED",
  /** The canonical source contract is not the one the decision was made against. */
  "SOURCE_CONTRACT_CHANGED",
  /** The canonical Blueprint source document has been replaced. */
  "SOURCE_DOCUMENT_CHANGED",
  /** The question occupying this ordinal is not the one that was adjudicated. */
  "SLOT_IDENTITY_CHANGED",
  /** The ancestor's bank cannot be projected, so nothing can be verified against it. */
  "ANCESTOR_UNPROJECTABLE",
] as const;
export type AuthorityInheritanceRefusal = (typeof AUTHORITY_INHERITANCE_REFUSALS)[number];

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
  /**
   * PHASE-G2 SUCCESSOR — was this decision made ON this bank, or inherited from
   * an ancestor?
   *
   * THE FIELD EXISTS SO NOTHING HAS TO INFER IT. An inherited decision is a real
   * decision by a real named human about two exact values — but it was made about
   * a DIFFERENT AssessmentVersion, and every surface that shows it must be able
   * to say so. Without this a successor would display seven adjudications that
   * look as though somebody sat down and made them here, which is precisely the
   * fabricated evidence the whole source-authority design refuses to produce.
   *
   * `decidedById`, `decidedAt`, `rationale`, `evidenceRef`, `evidenceSha256` and
   * `batchId` above are the ORIGINAL values, unmodified. Inheritance carries the
   * effect of a decision, never authorship of it.
   */
  inherited: boolean;
  /** The AssessmentVersion the decision row actually lives on. */
  originAssessmentVersionId: number;
  /** 0 for a local decision, 1 for the immediate predecessor, and so on. */
  inheritanceDepth: number;
  /** Set only when an inherited decision was refused. Null otherwise. */
  inheritanceRefusal: AuthorityInheritanceRefusal | null;
};

export type SourceAuthorityProjection = {
  assessmentVersionId: number;
  videoProductionVersionId: number | null;
  /** Null when the bank cannot be projected — reported, never guessed around. */
  comparable: boolean;
  unprojectableReason: string | null;
  state: SourceAuthorityState;
  /**
   * CORRECTION-2 — is the contract this projection describes bound to the bank
   * by a durable `VideoProductionAssessmentLink`?
   *
   * False means the projection is REPORTING against the level's working
   * production version because the bank carries no link. That is a truthful
   * comparison but not an adjudicable one: `resolveSourceAuthority` requires a
   * real link, so a caller must never treat an unlinked projection as something
   * it can decide.
   */
  sourceLinked: boolean;
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
   *
   * PHASE-G2 SUCCESSOR — UNCHANGED IN MEANING AND IN FORMULA. It identifies the
   * ADJUDICATION, so a successor that inherits its predecessor's decisions has
   * the SAME value — which is the truthful answer, because it is the same
   * adjudication by the same human on the same evidence. Anything that
   * distinguishes "reached locally" from "reached by inheritance" belongs to
   * `authorityLineageFingerprint` below, and keeping the two apart is what lets
   * the accepted value for an existing bank stay byte-identical.
   */
  resolutionFingerprint: string | null;
  /**
   * PHASE-G2 SUCCESSOR — how many of the decisions above came from an ancestor.
   * Zero for every bank with no lineage, which is every pre-migration bank.
   */
  inheritedDecisionCount: number;
  /** How many ancestors the walk actually traversed. Zero when there is none. */
  lineageDepth: number;
  /**
   * PHASE-G2 SUCCESSOR (§23) — identity of HOW this bank's authority was reached.
   *
   * Distinct from `resolutionFingerprint`, which identifies WHAT was decided.
   * Two banks can share an adjudication and differ in how they came by it: v1
   * decided it, v2 inherited it. That difference is real, a reviewer must be able
   * to see it, and folding it into the existing hash would have changed the
   * recorded fingerprint of every already-adjudicated bank in the corpus.
   *
   * Binds, per decision in a fixed sorted order: the slot, the decision, the
   * origin AssessmentVersion, the inheritance depth, and the application state.
   * So it moves when a decision is re-made locally, when the chain changes shape,
   * or when a decision stops applying — and does NOT move when a distractor, an
   * option order or an explanation changes, because none of those is an
   * adjudication.
   */
  authorityLineageFingerprint: string | null;
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

/* ------------------------------------------------------------------ *
 * PHASE-G2 SUCCESSOR — the lineage walk
 * ------------------------------------------------------------------ */

/**
 * How far the walk will go before it stops.
 *
 * A level accumulates versions one editorial round at a time, so a real chain is
 * a handful deep. The bound exists so a corrupt chain costs a bounded number of
 * queries rather than a hung request, and it is a REFUSAL rather than a
 * truncation: stopping quietly at the limit would silently drop decisions that
 * do exist, which is a different answer wearing the same shape.
 */
const MAX_LINEAGE_DEPTH = 32;

type LineageCandidate = {
  row: StoredResolution;
  originAssessmentVersionId: number;
  depth: number;
  /** The ancestor's own slot keys, for the slot-identity guard. Null at depth 0. */
  ancestorSlotKeys: ReadonlyMap<number, string> | null;
};

type LineageIdentity = {
  id: number;
  levelDefinitionId: number;
  curriculumVersionId: number;
  predecessorVersionId: number | null;
};

/**
 * Every decision that could apply to this bank — its own first, then the nearest
 * ancestor's for each slot still uncovered.
 *
 * NEAREST WINS, AND LOCAL BEATS EVERYTHING. A slot decided on this bank is never
 * overridden by an ancestor's decision about the same slot: re-adjudicating a
 * single field is exactly how an author legitimately changes one prompt, and an
 * older decision reasserting itself over the newer one would undo that silently.
 * Between two ancestors the closer one wins for the same reason.
 *
 * THE WALK IS OVER THE EXPLICIT RELATION AND NOTHING ELSE. Not `versionNumber`
 * arithmetic, not timestamps, not an AuditLog row. A bank with no
 * `predecessorVersionId` has no ancestors, full stop — which is every bank that
 * predates the lineage migration.
 *
 * FAIL CLOSED AT EVERY EDGE. A missing ancestor row, an ancestor on another
 * level or curriculum version, a cycle, or a chain past the depth bound all STOP
 * the walk. Stopping yields fewer inherited decisions, so the failure direction
 * is always "this slot still blocks" and never "this slot is quietly settled".
 */
async function collectLineageCandidates(
  tx: DbClient,
  assessmentVersionId: number,
): Promise<{ candidates: LineageCandidate[]; lineageDepth: number }> {
  const local = (await tx.sourceAuthorityResolution.findMany({
    where: { assessmentVersionId, supersededAt: null },
    orderBy: [{ questionIndex: "asc" }, { field: "asc" }],
  })) as unknown as StoredResolution[];

  const candidates: LineageCandidate[] = local.map((row) => ({
    row,
    originAssessmentVersionId: assessmentVersionId,
    depth: 0,
    ancestorSlotKeys: null,
  }));
  const covered = new Set(local.map((row) => slotKey(row.questionIndex, row.field)));

  const self = (await tx.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    select: { id: true, levelDefinitionId: true, curriculumVersionId: true, predecessorVersionId: true },
  })) as LineageIdentity | null;
  if (!self) return { candidates, lineageDepth: 0 };

  const seen = new Set<number>([assessmentVersionId]);
  let cursor: LineageIdentity = self;
  let depth = 0;

  while (cursor.predecessorVersionId !== null && depth < MAX_LINEAGE_DEPTH) {
    const ancestorId = cursor.predecessorVersionId;
    // A cycle is corruption, not a chain. Stop rather than loop, and stop rather
    // than pretend the remainder was inspected.
    if (seen.has(ancestorId)) break;
    seen.add(ancestorId);

    const ancestor = (await tx.assessmentVersion.findUnique({
      where: { id: ancestorId },
      select: { id: true, levelDefinitionId: true, curriculumVersionId: true, predecessorVersionId: true },
    })) as LineageIdentity | null;
    // The relation names a bank that is not there. RESTRICT should make this
    // impossible, so reaching it means the record disagrees with itself.
    if (!ancestor) break;
    // Lineage may never cross a level or a curriculum version. `LevelDefinition`
    // is keyed by the composite, so both halves are checked.
    if (
      ancestor.levelDefinitionId !== self.levelDefinitionId ||
      ancestor.curriculumVersionId !== self.curriculumVersionId
    ) {
      break;
    }

    depth += 1;
    const ancestorRows = (await tx.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: ancestorId, supersededAt: null },
      orderBy: [{ questionIndex: "asc" }, { field: "asc" }],
    })) as unknown as StoredResolution[];

    const uncovered = ancestorRows.filter((row) => !covered.has(slotKey(row.questionIndex, row.field)));
    if (uncovered.length > 0) {
      // Projected ONCE per contributing ancestor, so the slot-identity guard can
      // compare the ordinal-to-stableKey mapping the decision was made under
      // against the one this bank serves now.
      let ancestorSlotKeys: ReadonlyMap<number, string> | null = null;
      try {
        const ancestorBank = await projectAssessmentBank(tx, ancestorId);
        ancestorSlotKeys = new Map(
          ancestorBank.questions.map((question, index) => [index, question.questionId]),
        );
      } catch (error) {
        if (!isAuthoringDomainError(error)) throw error;
        ancestorSlotKeys = null;
      }
      for (const row of uncovered) {
        candidates.push({ row, originAssessmentVersionId: ancestorId, depth, ancestorSlotKeys });
        covered.add(slotKey(row.questionIndex, row.field));
      }
    }

    cursor = ancestor;
  }

  return { candidates, lineageDepth: depth };
}

/**
 * THE INHERITANCE GUARDS — everything that must still be true for an ancestor's
 * decision to describe THIS bank.
 *
 * Applied ONLY to inherited candidates. A local decision is already about the
 * bank it lives on, and subjecting it to these would change accepted behaviour
 * for every bank in the corpus.
 *
 * WHY THESE AND NOT THE BANK FINGERPRINT. `bankFingerprintAtDecision` moves
 * whenever a distractor, an option order or an explanation changes — all of which
 * are exactly what a successor is FOR. Using it as a guard would refuse
 * inheritance for every legitimate successor and force a human to re-decide
 * authority truth that never moved, which is the fabricated adjudication §13
 * forbids. `contractFingerprintAtDecision` is the opposite: it is computed over
 * the SOURCE contract, which no amount of bank authoring can move, so it answers
 * "is this still the same proposal?" precisely.
 */
function inheritanceRefusal(input: {
  row: StoredResolution;
  ancestorSlotKeys: ReadonlyMap<number, string> | null;
  successorSlotKeys: ReadonlyMap<number, string>;
  liveContractFingerprint: string | null;
  liveSourceDocumentSha: string | null;
}): AuthorityInheritanceRefusal | null {
  const { row } = input;

  // The ancestor bank could not be read, so its slot mapping is unknown and the
  // guard below cannot be evaluated. Unknown is refused, never assumed equal.
  if (input.ancestorSlotKeys === null) return "ANCESTOR_UNPROJECTABLE";

  // SLOT IDENTITY. A decision is about `questions[N]`, and N is only meaningful
  // while the same question occupies it. The ATA profile already forbids
  // renumbering, so for those levels this can never fire — it is here for the
  // generic profile, where `stableKey` is a free key and IS editable.
  const ancestorKey = input.ancestorSlotKeys.get(row.questionIndex);
  const successorKey = input.successorSlotKeys.get(row.questionIndex);
  if (ancestorKey === undefined || successorKey === undefined || ancestorKey !== successorKey) {
    return "SLOT_IDENTITY_CHANGED";
  }

  // SOURCE CONTRACT LINEAGE. Unknown is refused for the same reason as above.
  if (input.liveContractFingerprint === null) return "SOURCE_CONTRACT_CHANGED";
  if (input.liveContractFingerprint !== row.contractFingerprintAtDecision) {
    return "SOURCE_CONTRACT_CHANGED";
  }

  // SOURCE DOCUMENT. A replaced canonical Blueprint artifact is a new proposal
  // even when a fingerprint happens to survive it.
  if (input.liveSourceDocumentSha === null) return "SOURCE_DOCUMENT_CHANGED";
  if (input.liveSourceDocumentSha !== row.blueprintSourceDocumentSha256) {
    return "SOURCE_DOCUMENT_CHANGED";
  }

  return null;
}

/** The current canonical source document sha, or null when it cannot be read. */
function liveSourceDocumentShaOrNull(): string | null {
  try {
    return resolveBlueprintSourceSha();
  } catch {
    // A READ must not throw because an artifact is missing. Null refuses every
    // inheritance, which is the fail-closed direction.
    return null;
  }
}

/**
 * The AUTHORITY-LINEAGE fingerprint (§23) — identity of HOW authority was reached.
 *
 * Projected key-by-key in a fixed order over the decisions sorted by slot, so two
 * reads of an unchanged database produce the identical hash. Deliberately carries
 * NO value hash, NO evidence and NO actor: those identify the adjudication and
 * already live in `calculateAuthorityResolutionFingerprint`. This one answers a
 * question that hash cannot — "did this bank decide it, or inherit it, and from
 * where?"
 */
export function calculateAuthorityLineageFingerprint(
  decisions: ReadonlyArray<
    Pick<
      SourceAuthorityDecisionView,
      "questionIndex" | "field" | "decision" | "application" | "originAssessmentVersionId" | "inheritanceDepth"
    >
  >,
): string | null {
  if (decisions.length === 0) return null;
  const projection = [...decisions]
    .sort((a, b) => a.questionIndex - b.questionIndex || a.field.localeCompare(b.field))
    .map((decision) => ({
      questionIndex: decision.questionIndex,
      field: decision.field,
      decision: decision.decision,
      application: decision.application,
      originAssessmentVersionId: decision.originAssessmentVersionId,
      inheritanceDepth: decision.inheritanceDepth,
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
  input: {
    assessmentVersionId: number;
    videoProductionVersionId: number | null;
    contract: VideoProductionContract | null;
    /**
     * CORRECTION-2 — set when the canonical source could not be ESTABLISHED, as
     * opposed to not existing. Never conflated with "no proposal": see
     * `SOURCE_UNAVAILABLE`.
     */
    sourceUnavailableReason?: AuthoritySourceUnavailableReason | null;
    /** CORRECTION-2 — is the contract bound by a durable link? Defaults to false. */
    sourceLinked?: boolean;
  },
): Promise<SourceAuthorityProjection> {
  // PHASE-G2 SUCCESSOR — local decisions, then the nearest ancestor's for slots
  // this bank has not decided itself. A bank with no `predecessorVersionId` gets
  // exactly the local set, byte-identically to the accepted behaviour.
  const { candidates, lineageDepth } = await collectLineageCandidates(tx, input.assessmentVersionId);
  const activeRows = candidates.map((candidate) => candidate.row);

  const base = {
    assessmentVersionId: input.assessmentVersionId,
    videoProductionVersionId: input.videoProductionVersionId,
    sourceLinked: input.sourceLinked === true,
  };
  const unavailableReason = input.sourceUnavailableReason ?? null;

  // CORRECTION-2 — the source could not be established. This is NOT the branch
  // below: there, no proposal exists and there is genuinely nothing to disagree
  // with; here a proposal exists and we cannot read it. Reporting the second as
  // the first is exactly the fail-open the re-audit found, so the state says so
  // and every readiness surface treats it as blocking.
  if (unavailableReason !== null) {
    const decisions = candidates.map((candidate) => toView(candidate, "STALE", false, null));
    return {
      ...base,
      comparable: false,
      unprojectableReason: unavailableReason,
      state: "SOURCE_UNAVAILABLE",
      rawConflictCount: 0,
      resolvedConflictCount: 0,
      blockingConflictCount: 0,
      decisions,
      resolutionFingerprint: calculateAuthorityResolutionFingerprint(activeRows),
      inheritedDecisionCount: decisions.filter((decision) => decision.inherited).length,
      lineageDepth,
      authorityLineageFingerprint: calculateAuthorityLineageFingerprint(decisions),
    };
  }

  // No contract means no proposal, so there is nothing to disagree with. Any
  // stored decision is reported as stale rather than silently dropped.
  if (!input.contract || input.videoProductionVersionId === null) {
    const decisions = candidates.map((candidate) => toView(candidate, "STALE", false, null));
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
      inheritedDecisionCount: decisions.filter((decision) => decision.inherited).length,
      lineageDepth,
      authorityLineageFingerprint: calculateAuthorityLineageFingerprint(decisions),
    };
  }

  let bank: AssessmentBankProjection;
  try {
    bank = await projectAssessmentBank(tx, input.assessmentVersionId);
  } catch (error) {
    if (!isAuthoringDomainError(error)) throw error;
    const decisions = candidates.map((candidate) => toView(candidate, "STALE", false, null));
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
      inheritedDecisionCount: decisions.filter((decision) => decision.inherited).length,
      lineageDepth,
      authorityLineageFingerprint: calculateAuthorityLineageFingerprint(decisions),
    };
  }

  // CORRECTION-1 — keyed by (questionIndex, field), the same identity the unique
  // index enforces, so a stored `conflictPath` can never steer a lookup.
  const liveValues = new Map<string, AuthorityFieldValues>();
  for (const value of readAuthorityFieldValues(bank, input.contract)) {
    liveValues.set(slotKey(value.questionIndex, value.field), value);
  }

  const rawConflictSlots = new Set<string>();
  for (const value of liveValues.values()) {
    if (value.currentValue !== value.blueprintValue) rawConflictSlots.add(slotKey(value.questionIndex, value.field));
  }

  // PHASE-G2 SUCCESSOR — this bank's own ordinal-to-slot mapping, and the two
  // source identities, read ONCE for every inherited candidate to check against.
  const successorSlotKeys = new Map<number, string>(
    bank.questions.map((question, index) => [index, question.questionId]),
  );
  const liveContractFingerprint = calculateContractFingerprint(input.contract);
  const liveSourceDocumentSha = liveSourceDocumentShaOrNull();

  const decisions: SourceAuthorityDecisionView[] = candidates.map((candidate) => {
    const { row } = candidate;
    const key = slotKey(row.questionIndex, row.field);
    const live = liveValues.get(key) ?? null;

    // THE VALUE TEST IS THE SAME ONE, FOR LOCAL AND INHERITED ALIKE. A decision
    // is in force exactly when the side it chose is the side this bank serves,
    // and `evaluateApplication` is not weakened, widened or bypassed for an
    // inherited row — it is asked the same question about a different bank.
    const application = evaluateApplication(row, live);

    if (candidate.depth === 0) {
      return toView(candidate, application, rawConflictSlots.has(key), null);
    }

    // INHERITED. The value test above must pass AND every lineage guard must
    // hold. A guard failure yields STALE rather than silent omission: a reviewer
    // needs to know an ancestor decided this slot and that the decision no longer
    // reaches it, which is different information from "nobody ever decided".
    if (application !== "APPLIED") {
      return toView(candidate, application, rawConflictSlots.has(key), application === "STALE" ? "VALUE_MOVED" : null);
    }
    const refusal = inheritanceRefusal({
      row,
      ancestorSlotKeys: candidate.ancestorSlotKeys,
      successorSlotKeys,
      liveContractFingerprint,
      liveSourceDocumentSha,
    });
    if (refusal !== null) {
      return toView(candidate, "STALE", rawConflictSlots.has(key), refusal);
    }
    return toView(candidate, "APPLIED", rawConflictSlots.has(key), null);
  });

  const inForce = new Set(
    candidates
      .filter((_, index) => decisions[index].application === "APPLIED")
      .map((candidate) => slotKey(candidate.row.questionIndex, candidate.row.field)),
  );
  const blocking = [...rawConflictSlots].filter((key) => !inForce.has(key));

  return {
    ...base,
    comparable: true,
    unprojectableReason: null,
    rawConflictCount: rawConflictSlots.size,
    resolvedConflictCount: rawConflictSlots.size - blocking.length,
    blockingConflictCount: blocking.length,
    state: deriveState({
      rawConflictCount: rawConflictSlots.size,
      blockingConflictCount: blocking.length,
      decisions,
    }),
    decisions,
    resolutionFingerprint: calculateAuthorityResolutionFingerprint(activeRows),
    inheritedDecisionCount: decisions.filter((decision) => decision.inherited).length,
    lineageDepth,
    authorityLineageFingerprint: calculateAuthorityLineageFingerprint(decisions),
  };
}

function toView(
  candidate: LineageCandidate,
  application: SourceAuthorityApplication,
  rawConflictPresent: boolean,
  inheritanceRefusalReason: AuthorityInheritanceRefusal | null,
): SourceAuthorityDecisionView {
  const { row } = candidate;
  return {
    questionIndex: row.questionIndex,
    field: row.field as BlueprintConflictField,
    path: row.conflictPath,
    decision: row.decision as SourceAuthorityDecision,
    application,
    rawConflictPresent,
    // THE ORIGINAL ADJUDICATION, CARRIED VERBATIM. Not re-attributed, not
    // re-timestamped, not re-evidenced. An inherited decision names the human
    // who actually made it, on the bank they actually made it about.
    decidedById: row.decidedById,
    decidedAt: row.decidedAt.toISOString(),
    rationale: row.rationale,
    evidenceRef: row.evidenceRef,
    evidenceSha256: row.evidenceSha256,
    blueprintSourceDocumentSha256: row.blueprintSourceDocumentSha256,
    batchId: row.batchId,
    inherited: candidate.depth > 0,
    originAssessmentVersionId: candidate.originAssessmentVersionId,
    inheritanceDepth: candidate.depth,
    inheritanceRefusal: inheritanceRefusalReason,
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

/* ------------------------------------------------------------------ *
 * CORRECTION-1 (audit MEDIUM-1) — the DOMAIN decides who may adjudicate
 * ------------------------------------------------------------------ */

/**
 * The adjudicating actor, verified against stored truth, inside the transaction.
 *
 * WHY THE HTTP GATE IS NOT ENOUGH. `gateCurriculumAuthoring` is the only caller
 * today, but this command persists `decidedById` as durable provenance — the row
 * says a NAMED HUMAN chose a source of truth. A command that took that name on
 * trust would let any future internal caller (a script, an importer, a batch job)
 * attribute a source-authority decision to anyone at all, including a blocked
 * account or someone with no curriculum permission whatsoever. The independent
 * audit recorded exactly that gap, and the content and assessment domains already
 * carry their own actor assertions for the same reason.
 *
 * IT IS THE SAME RULE THE GATE APPLIES, NOT A SECOND ONE. `UserRole=admin` is the
 * accepted compatibility authority that `authorizeAuthoringIdentity` PATH A
 * recognises, and the staff path resolves the permission set from the STORED role
 * through the same accepted `staffRoleGrantsCurriculumCapability`. Asserting a
 * STRICTER rule here than the gate applies would produce a studio whose every
 * adjudication is refused by the layer underneath it — the exact failure G1
 * documented when it widened only the HTTP edge.
 *
 * IT RUNS BEFORE ANY WRITE. Called as the first statement of the transaction, so
 * an unauthorised caller produces no resolution row, no supersession and no audit
 * event — the refusal is total.
 */
async function assertSourceAuthorityActor(tx: DbClient, actorId: number): Promise<void> {
  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw new AuthoringDomainError(
      "AUTHORING_ACTOR_FORBIDDEN",
      "source-authority adjudication requires an identified actor",
    );
  }
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { id: true, role: true, status: true, staffProfile: { select: { staffRole: true } } },
  });
  // A missing account and a blocked one are refused identically: an adjudication
  // may only ever be attributed to a real, currently-active human.
  if (!actor || actor.status !== "active") {
    throw new AuthoringDomainError(
      "AUTHORING_ACTOR_FORBIDDEN",
      "source-authority adjudication requires an active actor",
    );
  }
  if (actor.role === "admin") return;
  if (staffRoleGrantsCurriculumCapability(actor.staffProfile?.staffRole, "adjudicate")) return;
  throw new AuthoringDomainError(
    "AUTHORING_ACTOR_FORBIDDEN",
    "source-authority adjudication requires curriculum_source_authority — authoring or approving a bank does not confer it",
  );
}

/* ------------------------------------------------------------------ *
 * CORRECTION-1 (audit MEDIUM-2) — ONE canonical link, for every reader
 * ------------------------------------------------------------------ */

export type CanonicalAuthorityLink = {
  videoProductionVersionId: number;
  videoProductionVersionNumber: number;
  /** Every link this bank carries, newest first — for reporting, never for choosing. */
  candidateCount: number;
};

/**
 * WHICH production contract is THE Blueprint proposal for this bank.
 *
 * THE PROBLEM THIS CLOSES. `VideoProductionAssessmentLink` is unique on
 * `videoProductionVersionId` but NOT on `assessmentVersionId`, so one bank may
 * legitimately be linked from several production versions — a level's v1 and its
 * v2 clone both bound to the same approved bank. Reading "the first link" left
 * the answer to insertion order and the query plan, and the command and the
 * handoff could in principle have disagreed about which contract a decision was
 * even about.
 *
 * THE RULE IS THE ACCEPTED ONE, NOT A NEW ONE. `authoring-read`'s
 * `pickWorkingVersion` already defines the level's working production version as
 * the HIGHEST `versionNumber` (there is no `LevelResourceBinding` column for
 * video, so the binding branch cannot apply). This applies that same rule to the
 * linked set: among the production versions actually bound to THIS bank, the
 * newest is the proposal in force. Anything older is a superseded proposal, and
 * adjudicating against it would settle a disagreement nobody is looking at.
 *
 * DETERMINISTIC BY CONSTRUCTION. `versionNumber` is unique per level, so the
 * reduction below has no ties to break and cannot depend on row order. The `id`
 * tie-break exists only so a corrupt duplicate could never make the answer vary
 * between two reads of the same database.
 *
 * NULL, NEVER A GUESS. With no link there is no canonical proposal, and every
 * caller is required to treat that as "cannot adjudicate" rather than picking a
 * candidate. §13 of the correction brief: fail closed, do not invent lineage.
 */
export async function resolveCanonicalAuthorityLink(
  tx: DbClient,
  assessmentVersionId: number,
): Promise<CanonicalAuthorityLink | null> {
  // CORRECTION-2 (re-audit MUTANT Y) — the bank's own level identity, because
  // "newest version" is only meaningful among versions that belong to the SAME
  // level. `versionNumber` is unique per level, not globally, so without this
  // the reduction below could compare v99 of a foreign level against v2 of this
  // one and hand back an unrelated source contract as the canonical proposal.
  const assessment = await tx.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    select: { id: true, levelDefinitionId: true, curriculumVersionId: true },
  });
  if (!assessment) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `AssessmentVersion ${assessmentVersionId} does not exist`,
    );
  }

  const links = await tx.videoProductionAssessmentLink.findMany({
    where: { assessmentVersionId },
    select: {
      videoProductionVersionId: true,
      videoProductionVersion: {
        select: { id: true, versionNumber: true, levelDefinitionId: true, curriculumVersionId: true },
      },
    },
  });
  if (links.length === 0) return null;

  // WHAT "COMPATIBLE" MEANS, read off the accepted schema rather than invented.
  // `LevelDefinition` is keyed `(id, curriculumVersionId)` and every authoring
  // aggregate — content, assessment, video production, and this table's own
  // level foreign key — is scoped by that composite. A production version that
  // does not share BOTH halves with the bank is not a proposal about this bank.
  const incompatible = links.filter(
    (link) =>
      link.videoProductionVersion.levelDefinitionId !== assessment.levelDefinitionId ||
      link.videoProductionVersion.curriculumVersionId !== assessment.curriculumVersionId,
  );
  if (incompatible.length > 0) {
    // REFUSED, NOT FILTERED. An incompatible durable link is corruption, and the
    // presence of corruption in the lineage is itself the finding: quietly
    // picking one of the remaining rows would adjudicate against a source while
    // hiding that the record disagrees with itself. §17 — fail closed.
    throw new AuthoringDomainError(
      "AUTHORING_ASSESSMENT_LINK_INVALID",
      "this bank is linked to a video production version from another level or curriculum version, so its Blueprint lineage is ambiguous and cannot be used",
      {
        issues: incompatible.map((link) => ({
          code: "AUTHORING_SOURCE_AUTHORITY_LINK_INCOMPATIBLE",
          path: `videoProductionVersion[${link.videoProductionVersion.id}]`,
          message: `VideoProductionVersion ${link.videoProductionVersion.id} belongs to level ${link.videoProductionVersion.levelDefinitionId} / curriculum version ${link.videoProductionVersion.curriculumVersionId}, but this bank belongs to level ${assessment.levelDefinitionId} / curriculum version ${assessment.curriculumVersionId}`,
        })),
      },
    );
  }

  const best = links.reduce((winner, candidate) => {
    if (candidate.videoProductionVersion.versionNumber !== winner.videoProductionVersion.versionNumber) {
      return candidate.videoProductionVersion.versionNumber > winner.videoProductionVersion.versionNumber
        ? candidate
        : winner;
    }
    return candidate.videoProductionVersion.id > winner.videoProductionVersion.id ? candidate : winner;
  });
  return {
    videoProductionVersionId: best.videoProductionVersion.id,
    videoProductionVersionNumber: best.videoProductionVersion.versionNumber,
    candidateCount: links.length,
  };
}

/* ------------------------------------------------------------------ *
 * CORRECTION-2 — ONE source-authority truth, for EVERY reader
 * ------------------------------------------------------------------ */

export type CanonicalAuthoritySource = {
  /** The canonical link, or null when the bank carries none. */
  link: CanonicalAuthorityLink | null;
  /**
   * PHASE-G2 SUCCESSOR — how the link above was reached.
   *
   * `own`      the bank carries the durable link itself.
   * `lineage`  the bank has no link and an ANCESTOR does, so the ancestor's pin
   *            is this bank's proposal. Truthful because a clone is a copy of
   *            that ancestor's questions: the proposal it must be measured
   *            against is the one its predecessor was measured against.
   * `none`     no link anywhere in the lineage. The level's working production
   *            version is used for REPORTING only, and nothing may be
   *            adjudicated against it.
   */
  linkOrigin: "own" | "lineage" | "none";
  /** How many ancestors were crossed to find the link. 0 for `own` and `none`. */
  linkLineageDepth: number;
  /** The production version this bank's authority axis is measured against. */
  videoProductionVersionId: number | null;
  /** Its revision, so every surface quotes the SAME expected revision. */
  videoProductionRevision: number | null;
  /** Null whenever the source could not be established — never "no conflict". */
  contract: VideoProductionContract | null;
  /** Non-null means FAIL CLOSED. */
  unavailableReason: AuthoritySourceUnavailableReason | null;
};

/**
 * PHASE-G2 SUCCESSOR — the nearest ANCESTOR's canonical link.
 *
 * Walks the same explicit `predecessorVersionId` relation the decision walk uses,
 * under the same bounds and the same refusals: a missing ancestor, a cycle, a
 * cross-level or cross-curriculum ancestor, or the depth limit all STOP the walk
 * and yield no link, which leaves the caller on the accepted unpinned fallback.
 *
 * An INCOMPATIBLE link on an ancestor is escalated rather than skipped, exactly
 * as it is for the bank's own link: corruption in the lineage is itself the
 * finding, and stepping over it would derive a proposal from a record that
 * disagrees with itself.
 */
async function resolveLineageAuthorityLink(
  tx: DbClient,
  assessmentVersionId: number,
): Promise<{ link: CanonicalAuthorityLink | null; depth: number; unavailable: boolean }> {
  const self = await tx.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    select: { levelDefinitionId: true, curriculumVersionId: true, predecessorVersionId: true },
  });
  if (!self) return { link: null, depth: 0, unavailable: false };

  const seen = new Set<number>([assessmentVersionId]);
  let cursor = self;
  let depth = 0;

  while (cursor.predecessorVersionId !== null && depth < MAX_LINEAGE_DEPTH) {
    const ancestorId: number = cursor.predecessorVersionId;
    if (seen.has(ancestorId)) break;
    seen.add(ancestorId);

    const ancestor = await tx.assessmentVersion.findUnique({
      where: { id: ancestorId },
      select: { levelDefinitionId: true, curriculumVersionId: true, predecessorVersionId: true },
    });
    if (!ancestor) break;
    if (
      ancestor.levelDefinitionId !== self.levelDefinitionId ||
      ancestor.curriculumVersionId !== self.curriculumVersionId
    ) {
      break;
    }
    depth += 1;

    try {
      const link = await resolveCanonicalAuthorityLink(tx, ancestorId);
      if (link) return { link, depth, unavailable: false };
    } catch (error) {
      if (isAuthoringDomainError(error) && error.code === "AUTHORING_ASSESSMENT_LINK_INVALID") {
        return { link: null, depth, unavailable: true };
      }
      throw error;
    }
    cursor = ancestor;
  }
  return { link: null, depth: 0, unavailable: false };
}

/**
 * WHICH contract is this bank's Blueprint proposal, and can it be read?
 *
 * THE SINGLE ANSWER, FOR ALL FOUR READERS. The independent re-audit found the
 * dedicated staff GET still resolving its own source through
 * `videoProductionLinks[0]`, and reporting `NO_CONFLICT` for a bank that owed
 * eight decisions purely because an older link happened to sit first. The fix is
 * not a second correct implementation — it is one function that
 * `readAuthoringOverview`, the handoff projection and the staff GET all call, so
 * a future reader cannot quietly grow a third rule.
 *
 * PRECEDENCE, IN ORDER:
 *
 *   1. An incompatible durable link anywhere on this bank → UNAVAILABLE. The
 *      lineage disagrees with itself and nothing may be derived from it.
 *   2. A compatible durable link → the canonical one (highest `versionNumber`
 *      among the linked set, `id` only as an impossible-tie guard).
 *   3. NO link at all → the level's working production version, which is the
 *      rule `readAuthoringOverview` has always applied and the reason an
 *      unlinked-but-conflicting bank still blocks today. It is a REPORTING
 *      fallback only: `sourceLinked` is false and `resolveSourceAuthority`
 *      still refuses, because an unpinned proposal is not adjudicable.
 *   4. The chosen payload does not parse → UNAVAILABLE.
 *
 * NEVER A SILENT ZERO. Every failure above yields `unavailableReason`, and every
 * caller is required to treat that as blocking rather than as agreement.
 */
export async function resolveAuthoritySource(
  tx: DbClient,
  assessmentVersionId: number,
): Promise<CanonicalAuthoritySource> {
  const empty = {
    link: null,
    videoProductionVersionId: null,
    videoProductionRevision: null,
    contract: null,
    linkOrigin: "none" as const,
    linkLineageDepth: 0,
  };

  let link: CanonicalAuthorityLink | null;
  let linkOrigin: "own" | "lineage" | "none" = "none";
  let linkLineageDepth = 0;
  try {
    link = await resolveCanonicalAuthorityLink(tx, assessmentVersionId);
    if (link) linkOrigin = "own";
  } catch (error) {
    if (isAuthoringDomainError(error) && error.code === "AUTHORING_ASSESSMENT_LINK_INVALID") {
      return { ...empty, unavailableReason: "SOURCE_LINK_INCOMPATIBLE" };
    }
    throw error;
  }

  // PHASE-G2 SUCCESSOR — THE SOURCE FOLLOWS THE LINEAGE BEFORE IT FOLLOWS THE
  // LEVEL.
  //
  // `VideoProductionAssessmentLink.videoProductionVersionId` is unique, so one
  // production version pins exactly one bank and a clone cannot share its
  // predecessor's link row. Without this walk a cloned bank fell through to the
  // level's WORKING production version — the highest versionNumber — which is a
  // guess that gets worse the moment the level grows a newer contract: the
  // successor would silently be compared against a proposal its predecessor was
  // never measured against, and the regression proved it (eight raw conflicts
  // where the ancestor had seven).
  //
  // A clone is a copy of its ancestor's questions, so the proposal it must be
  // measured against is the one its ancestor is pinned to. That is a statement
  // about descent, which is exactly what the lineage relation records, and it is
  // narrower than the old fallback rather than wider: it can only ever select a
  // contract some ancestor was DELIBERATELY linked to.
  //
  // The level-working fallback below survives untouched for a bank with no link
  // and no lineage — every bank that predates this phase — and still reports
  // `sourceLinked: false`, so an unpinned proposal remains unadjudicable.
  if (!link) {
    const inherited = await resolveLineageAuthorityLink(tx, assessmentVersionId);
    if (inherited.unavailable) return { ...empty, unavailableReason: "SOURCE_LINK_INCOMPATIBLE" };
    if (inherited.link) {
      link = inherited.link;
      linkOrigin = "lineage";
      linkLineageDepth = inherited.depth;
    }
  }

  let videoRow: { id: number; revision: number; contractPayload: unknown } | null = null;
  if (link) {
    videoRow = await tx.videoProductionVersion.findUnique({
      where: { id: link.videoProductionVersionId },
      select: { id: true, revision: true, contractPayload: true },
    });
  } else {
    // The unlinked reporting fallback — the accepted `pickWorkingVersion` rule
    // (highest `versionNumber`; video has no `LevelResourceBinding` column), read
    // here so the staff GET cannot disagree with the overview about a bank that
    // was never linked.
    const assessment = await tx.assessmentVersion.findUnique({
      where: { id: assessmentVersionId },
      select: { levelDefinitionId: true, curriculumVersionId: true },
    });
    if (!assessment) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `AssessmentVersion ${assessmentVersionId} does not exist`,
      );
    }
    videoRow = await tx.videoProductionVersion.findFirst({
      where: {
        levelDefinitionId: assessment.levelDefinitionId,
        curriculumVersionId: assessment.curriculumVersionId,
      },
      orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
      select: { id: true, revision: true, contractPayload: true },
    });
  }

  // A link whose target row has vanished is the same ambiguity as an
  // incompatible one: the record names a source that is not there.
  if (link && !videoRow) return { ...empty, link, linkOrigin, linkLineageDepth, unavailableReason: "SOURCE_LINK_INCOMPATIBLE" };
  // No production version at all is NOT a failure — there is genuinely no
  // proposal for this bank to disagree with, which is what §14 protects.
  if (!videoRow) return { ...empty, link: null, unavailableReason: null };

  let contract: VideoProductionContract;
  try {
    contract = parseContractPayload(videoRow.contractPayload);
  } catch {
    return {
      link,
      linkOrigin,
      linkLineageDepth,
      videoProductionVersionId: videoRow.id,
      videoProductionRevision: videoRow.revision,
      contract: null,
      unavailableReason: "SOURCE_CONTRACT_UNPARSEABLE",
    };
  }

  return {
    link,
    linkOrigin,
    linkLineageDepth,
    videoProductionVersionId: videoRow.id,
    videoProductionRevision: videoRow.revision,
    contract,
    unavailableReason: null,
  };
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
    const key = conflictPathFor(decision.questionIndex, decision.field);
    if (seen.has(key)) invalid(`duplicate decision for ${key}`, "decisions");
    seen.add(key);
  }

  return prisma.$transaction(async (tx) => {
    // CORRECTION-1 — WHO, before anything else. Nothing below this line may run
    // for a caller the domain has not itself authorised.
    await assertSourceAuthorityActor(tx, input.actorId);

    const assessment = await tx.assessmentVersion.findUnique({
      where: { id: input.assessmentVersionId },
      select: {
        id: true,
        revision: true,
        levelDefinitionId: true,
        curriculumVersionId: true,
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

    // CORRECTION-1 — the SAME canonical link every other reader uses, never "the
    // first row". With no link there is no proposal, and the command refuses
    // rather than adjudicating against an arbitrary contract.
    //
    // PHASE-G2 SUCCESSOR — the accepted resolution runs FIRST and unchanged, so
    // every accepted refusal keeps its exact code: an incompatible link still
    // raises AUTHORING_ASSESSMENT_LINK_INVALID from here, and an unreadable
    // payload still reaches the parse below and raises
    // AUTHORING_SOURCE_CONTRACT_UNREADABLE.
    //
    // Lineage is consulted ONLY when the bank carries no link of its own. That
    // admits one new case and no others: a clone, which cannot carry its
    // predecessor's link row because `videoProductionVersionId` is unique.
    // Refusing it would leave a successor able to INHERIT authority but never to
    // correct it — inheriting a decision while being permanently unable to
    // re-decide a slot the author legitimately changed, which is the worse of
    // the two failures. A bank with no link anywhere in its lineage is refused
    // exactly as before.
    let link = await resolveCanonicalAuthorityLink(tx, assessment.id);
    if (!link) {
      const inherited = await resolveLineageAuthorityLink(tx, assessment.id);
      if (inherited.unavailable) {
        throw new AuthoringDomainError(
          "AUTHORING_ASSESSMENT_LINK_INVALID",
          "an ancestor of this bank is linked to a video production version from another level or curriculum version, so its Blueprint lineage is ambiguous and cannot be used",
        );
      }
      link = inherited.link;
    }
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

    // CORRECTION-2 — an unreadable proposal is refused as its own condition
    // rather than escaping as a raw parse error. A caller must be told that the
    // SOURCE cannot be read, not handed a 500.
    let contract: VideoProductionContract;
    try {
      contract = parseContractPayload(videoRow.contractPayload);
    } catch {
      throw new AuthoringDomainError(
        "AUTHORING_SOURCE_CONTRACT_UNREADABLE",
        "the linked video production contract cannot be parsed, so there is no Blueprint proposal to adjudicate against",
      );
    }
    const before = await readSourceAuthority(tx, {
      assessmentVersionId: assessment.id,
      videoProductionVersionId: videoRow.id,
      contract,
      sourceLinked: true,
    });
    if (!before.comparable) {
      throw new AuthoringDomainError(
        "AUTHORING_ASSESSMENT_PROJECTION_INVALID",
        `the bank cannot be compared to its proposal (${before.unprojectableReason}), so nothing can be adjudicated`,
      );
    }

    const bank = await projectAssessmentBank(tx, assessment.id);
    const liveValues = new Map<string, AuthorityFieldValues>();
    for (const value of readAuthorityFieldValues(bank, contract)) {
      liveValues.set(slotKey(value.questionIndex, value.field), value);
    }

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
      input.decisions.map((decision) => conflictPathFor(decision.questionIndex, decision.field)),
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
      const path = conflictPathFor(decision.questionIndex, decision.field);
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
    // CORRECTION-1 (audit LOW-3) — joined on the identity the unique index
    // enforces, not on the stored path string. This is the one place a STORED
    // value used to steer a lookup, and it is the only place the two
    // representations could ever have disagreed.
    const existingBySlot = new Map(existing.map((row) => [slotKey(row.questionIndex, row.field), row]));

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
              path: conflictPathFor(decision.questionIndex, decision.field),
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
      const path = conflictPathFor(decision.questionIndex, decision.field);
      const prior = existingBySlot.get(slotKey(decision.questionIndex, decision.field));

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
        const priorApplication = evaluateApplication(
          prior,
          liveValues.get(slotKey(decision.questionIndex, decision.field)) ?? null,
        );
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
      sourceLinked: true,
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
            path: conflictPathFor(decision.questionIndex, decision.field),
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
