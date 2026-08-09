/**
 * PHASE-G1 CORRECTION — the ONE product-profile helper the authoring surfaces
 * share.
 *
 * ======================== WHY THIS FILE HAD TO EXIST ========================
 * G1 shipped the same product question — "does this level owe the product a
 * learner-authored teaching Body?" — answered in two places that disagreed:
 *
 *   • `authoring-readiness.requiresLearnerContent` asked the CANONICAL ATA kind
 *     and said yes for `video_test` and `practical`.
 *   • `authoring-validation-service.requiresTeaching` asked the DURABLE level
 *     TYPE and said yes for everything except `external_event` and
 *     `financial_checkpoint`.
 *
 * They differ on exactly one shape in the real curriculum and it is not
 * hypothetical: L3 is a `report`. Readiness therefore reported it READY (it owes
 * nothing), the handoff bundle then re-validated it and the validator demanded a
 * `ru` teaching body it will never have — so the whole-curriculum bundle threw
 * `AUTHORING_HANDOFF_INVALID` on the real backlog and the only handoff control
 * the Studio ships could never succeed.
 *
 * A product rule that two modules answer differently is not a rule, so there is
 * now exactly one implementation and every surface imports it: readiness,
 * validation, handoff and the G2 work queue.
 *
 * ===================== WHAT THE RULE IS, AND WHERE FROM =====================
 * A level owes a learner-authored teaching Body when its canonical ATA kind is
 * `video_test` or `practical`. That is not a new list: it is the accepted
 * predicate `validateAtaProduct100Package` already applies when it decides which
 * levels are held to the editorial teaching floor, and it is what produces the
 * accepted backlog figure of 77 bodies still needing closure.
 *
 * A `report` level is deliberately NOT a teaching lesson. It carries a
 * ReportAssignmentVersion with its own fields, localizations and rubric — its
 * own domain, its own review path — and having a generic type that is not a gate
 * is not a reason to demand Body v2 prose of it. `registration` and `checkpoint`
 * levels carry system copy the Studio cannot author at all.
 *
 * ============================ THE FALLBACK ============================
 * A row that is not a canonical ATA level (a disposable fixture, a future
 * curriculum) has no ATA kind, so the durable TYPE answers instead: `lesson` and
 * `practice` teach, everything else does not. This is the accepted readiness
 * fallback, moved rather than rewritten, and it keeps `report`,
 * `external_event`, `financial_checkpoint` and `mentor_review`-without-a-body
 * out of the teaching requirement by the same reasoning as above.
 *
 * PURE. No query, no write, no I/O. Callers pass the three fields the decision
 * depends on and nothing else can influence it.
 */
import { ATA_LEVELS, canonicalLevelCode, type AtaLevelKind } from "@/lib/curriculum/product-ata-100";
import {
  ATA_VIDEO_TAKES_PER_LESSON,
  TAKE_ID_PATTERN,
  parseTakeId,
  takeIdFor,
} from "@/lib/curriculum/video-production-contract";

/** Exactly the fields the product decision depends on. */
export type LevelProfileInput = {
  levelNumber: number;
  stableCode: string;
  /** The durable `LevelDefinition.type`. */
  type: string;
};

/** Canonical ATA kinds that owe the product an authored teaching Body. */
const TEACHING_ATA_KINDS: ReadonlySet<AtaLevelKind> = new Set<AtaLevelKind>([
  "video_test",
  "practical",
]);

/** Durable types that teach, for rows that are not canonical ATA levels. */
const TEACHING_DURABLE_TYPES: ReadonlySet<string> = new Set(["lesson", "practice"]);

const ATA_BY_LEVEL_NUMBER = new Map(ATA_LEVELS.map((level) => [level.levelNumber, level] as const));

/**
 * The canonical ATA kind of a level — but only when the row really IS that
 * canonical level.
 *
 * The `stableCode` must match `canonicalLevelCode` character for character. A
 * disposable fixture that happens to number a level 7 is not ATA level 7, and
 * silently applying ATA's editorial expectations to it would produce a readiness
 * report about a curriculum that does not exist.
 */
export function canonicalAtaKind(level: LevelProfileInput): AtaLevelKind | null {
  const source = ATA_BY_LEVEL_NUMBER.get(level.levelNumber);
  if (!source) return null;
  return canonicalLevelCode(source) === level.stableCode ? source.kind : null;
}

/**
 * THE RULE. Does this level owe the product a learner-authored teaching Body?
 *
 * Every authoring surface asks this function and no surface re-derives it.
 */
export function requiresLearnerTeachingContent(level: LevelProfileInput): boolean {
  const kind = canonicalAtaKind(level);
  if (kind !== null) return TEACHING_ATA_KINDS.has(kind);
  return TEACHING_DURABLE_TYPES.has(level.type);
}

/**
 * Is this level on the ATA video profile — the 58 lessons that carry a video
 * production contract and a 4x4 assessment bank?
 *
 * Answered from the canonical structural source, so the importer can decide it
 * before any production contract row exists.
 */
export function isAtaVideoProfileLevel(level: LevelProfileInput): boolean {
  return canonicalAtaKind(level) === "video_test";
}

/* ------------------------------------------------------------------ *
 * Canonical ATA Take identity
 * ------------------------------------------------------------------ */

/**
 * PHASE-G1 CORRECTION — the ATA Take-ID vocabulary, as a first-class parser.
 *
 * `QuestionDefinition.stableKey` is where the accepted G0 validator already
 * looks for a question's take binding: `validateAuthoringAssessment` reports
 * `ASSESSMENT_TAKE_MAPPING_INVALID`, `ASSESSMENT_TAKE_LEVEL_MISMATCH`,
 * `ASSESSMENT_TAKE_DUPLICATE` and `ASSESSMENT_TAKE_UNMAPPED` at the path
 * `questions[i].stableKey`, and the deterministic handoff bundle serialises that
 * same field. The take identity is therefore not a new concept and gets no new
 * column — the write schemas simply never permitted the vocabulary the reader
 * demanded.
 *
 * WHAT IS PERMITTED IS NARROW ON PURPOSE. This is not "allow uppercase" and not
 * "allow dots". It is exactly `T{level}.{1-4}` with `level` a 1..3 digit number,
 * matched by the ACCEPTED `TAKE_ID_PATTERN` from the video contract module —
 * one definition, reused, never restated.
 */
export const CANONICAL_TAKE_ID_PATTERN = TAKE_ID_PATTERN;

/** Is this string an ATA Take identifier at all? */
export function isCanonicalTakeId(value: string): boolean {
  return CANONICAL_TAKE_ID_PATTERN.test(value);
}

/**
 * Is this the take identifier a given level may legitimately carry?
 *
 * Level-scoped on purpose: a question on L5 must never be able to claim L6's
 * take, and refusing that at the schema is cheaper than detecting it later.
 */
export function isTakeIdForLevel(value: string, levelNumber: number): boolean {
  const parsed = parseTakeId(value);
  return parsed !== null && parsed.levelNumber === levelNumber;
}

/** The four canonical take ids of an ATA video lesson, in ordinal order. */
export function canonicalTakeIdsForLevel(levelNumber: number): string[] {
  return Array.from({ length: ATA_VIDEO_TAKES_PER_LESSON }, (_, index) =>
    takeIdFor(levelNumber, index + 1),
  );
}

/**
 * THE ATA TAKE-SLOT INVARIANT — the single authority for what a question's
 * durable `stableKey` must be.
 *
 * ===================== WHY THIS IS POSITIONAL, NOT A MAPPING =====================
 * `T{level}.1` … `T{level}.4` are not labels an editor attaches to whichever
 * question they like. They are four STABLE SEMANTIC SLOTS, and the question at
 * `questionNumber` N is the editable content of slot N. The accepted assessment
 * projection has always said so — `authoring-assessment-projection` derives each
 * question's `takeId` as `takeIdFor(levelNumber, ordinal)` where `ordinal` IS
 * `questionNumber`, and the video production contract's `assessmentFingerprint`
 * is computed over exactly that.
 *
 * The G1 closeout found that the stored key and that derivation could disagree:
 * the validator accepted ANY complete permutation, so a bank could durably say
 * "question 1 answers T5.2" while the fingerprint the video evidence was
 * accepted against said "question 1 answers T5.1", and the handoff bundle
 * serialised the former. Two shipped artifacts, contradictory facts, nothing
 * detecting it.
 *
 * THE RESOLUTION IS TO ALIGN THE PRODUCT WITH THE FINGERPRINT, not to widen the
 * fingerprint. `calculateAssessmentFingerprint` is untouched and no bank
 * fingerprint moves. What changes is that a permutation is no longer a state the
 * domain will accept, so the disagreement has no way to exist.
 *
 * This function is the ONLY place the slot rule is stated. Readiness, the
 * validator, the assessment mutation commands and the importer all ask it.
 */
export function expectedTakeIdFor(levelNumber: number, questionNumber: number): string {
  return takeIdFor(levelNumber, questionNumber);
}

/**
 * Is this question sitting in its canonical take slot?
 *
 * The whole invariant in one predicate, so no caller re-derives it and no caller
 * can accidentally check only half of it (the shape, or the level, but not the
 * position).
 */
export function occupiesCanonicalTakeSlot(
  stableKey: string,
  levelNumber: number,
  questionNumber: number,
): boolean {
  return stableKey === expectedTakeIdFor(levelNumber, questionNumber);
}

/**
 * Why a proposed `stableKey` is not the slot this question must occupy, phrased
 * for a person rather than for a log.
 *
 * `null` when the value is exactly right. The three cases are separated because
 * the remedies differ: a foreign level means the bank is being pointed at
 * another lesson, a wrong ordinal means somebody is trying to REASSIGN a slot
 * (which ATA does not support), and anything else is not a take at all.
 */
export function takeSlotViolation(
  stableKey: string,
  levelNumber: number,
  questionNumber: number,
): string | null {
  const expected = expectedTakeIdFor(levelNumber, questionNumber);
  if (stableKey === expected) return null;
  const parsed = parseTakeId(stableKey);
  if (parsed === null) {
    return `"${stableKey}" is not an ATA take identifier — question ${questionNumber} must carry ${expected}`;
  }
  if (parsed.levelNumber !== levelNumber) {
    return `take ${stableKey} belongs to level ${parsed.levelNumber}, not ${levelNumber} — question ${questionNumber} must carry ${expected}`;
  }
  return `take ${stableKey} is the slot for question ${parsed.ordinal}, not ${questionNumber} — ATA take slots are fixed and cannot be reassigned; question ${questionNumber} must carry ${expected}`;
}
