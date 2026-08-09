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
 * The take identifier a question at `questionNumber` must carry.
 *
 * DELIBERATELY THE SAME DERIVATION the accepted fingerprint projection already
 * uses (`authoring-assessment-projection` binds `takeIdFor(levelNumber,
 * questionNumber)`). Keeping the two identical is what makes it safe to store
 * the take id durably: the stored mapping and the fingerprinted mapping cannot
 * drift, and the assessment fingerprint of an existing bank does not move.
 */
export function expectedTakeIdFor(levelNumber: number, questionNumber: number): string {
  return takeIdFor(levelNumber, questionNumber);
}
