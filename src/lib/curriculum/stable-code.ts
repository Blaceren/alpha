/**
 * The ONE canonical Curriculum V2 stable-code contract.
 *
 * Every write path that can persist a stable code and every read path that
 * parses one must go through this module. It deliberately does not define a new
 * grammar: the level grammar is `STABLE_CODE_PATTERN` from `./constants`
 * (approved in V2_PRODUCT_DECISIONS.md §8), which is the same regex the learner
 * content route already parses with. Re-declaring it here would be exactly the
 * duplication that let `level.00N` be persisted while `/content` rejected it.
 *
 * Two acceptance levels are exposed on purpose:
 *
 *   isCanonicalLevelCode(value)   — EXACT. No trimming, no case folding, no
 *                                   normalisation. This is what a stored code
 *                                   and a package field must satisfy.
 *   acceptsAsLevelCode(value)     — models the *effective* behaviour of the
 *                                   existing zod consumers, which are written
 *                                   `z.string().trim().regex(STABLE_CODE_PATTERN)`
 *                                   and therefore trim before matching.
 *
 * The safety invariant CV-1 must hold is the one-way implication:
 *   isCanonicalLevelCode(c)  ==>  acceptsAsLevelCode(c)
 * i.e. anything the package/importer persists is accepted by the learner
 * content route. The strict form is intentionally the stronger of the two, so a
 * package can never introduce a code that only survives because something
 * trimmed it.
 */
import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";

/** Defensive upper bound; the grammar is already bounded but length is cheap to pin. */
export const MAX_STABLE_CODE_LENGTH = 128;

/**
 * Module codes. The authoring service only requires non-empty (see
 * `moduleStateIssues`), so this is the package-level tightening, not a claim
 * about existing persisted data.
 */
export const MODULE_CODE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Curriculum codes, e.g. the `DEFAULT_CURRICULUM_CODE` "ata-v2". */
export const CURRICULUM_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Assessment question keys (`QuestionDefinition.stableKey`).
 *
 * AC-1: this is a *distinct* identifier class from the level stable code and is
 * deliberately NOT `STABLE_CODE_PATTERN` — a question key carries no level
 * number and is never a URL path segment (it appears only inside JSON bodies as
 * `questionKey`). Before AC-1 the assessment publication validator reused a
 * level-flavoured `/^[a-z0-9][a-z0-9-]{0,63}$/`, which rejected every editorial
 * question code the package grammar produces (`ata-v2.l002.q1` — dots), so the
 * approved assessment could never publish. The grammar below is the package
 * `questionCode` grammar, which is what the importer actually persists.
 *
 * Properties (all required by the AC-1 identifier contract):
 *  - lowercase-only, explicit `.`/`_`/`-` separators, alphanumeric segments;
 *  - no leading/trailing separator and no repeated separator, so `..` — and
 *    therefore any path-traversal or URL semantics — is unrepresentable;
 *  - no whitespace, no case folding and no trimming, so two distinct stored keys
 *    can never collide under normalisation;
 *  - bounded at 64 characters to match the `QuestionDefinition.stableKey`
 *    CHECK constraint (`length(trim(stableKey)) BETWEEN 1 AND 64`). The package
 *    schema allows 120, so this is the binding limit and is enforced at import.
 */
export const ASSESSMENT_QUESTION_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** Matches the DB CHECK on `QuestionDefinition.stableKey`. */
export const MAX_ASSESSMENT_QUESTION_KEY_LENGTH = 64;

/**
 * Exact canonical check for an assessment question key. No trimming, no case
 * folding — a key that only survives normalisation is rejected.
 */
export function isCanonicalAssessmentQuestionKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_ASSESSMENT_QUESTION_KEY_LENGTH) return false;
  if (value !== value.trim()) return false;
  return ASSESSMENT_QUESTION_KEY_PATTERN.test(value);
}

export type StableCodeIssue =
  | "NOT_A_STRING"
  | "EMPTY"
  | "NOT_TRIMMED"
  | "TOO_LONG"
  | "PATTERN_MISMATCH"
  | "LEVEL_NUMBER_MISMATCH";

export type ParsedLevelCode =
  | { ok: true; code: string; levelNumber: number }
  | { ok: false; issue: StableCodeIssue };

function preflight(value: unknown): StableCodeIssue | null {
  if (typeof value !== "string") return "NOT_A_STRING";
  if (value.length === 0) return "EMPTY";
  if (value !== value.trim()) return "NOT_TRIMMED";
  if (value.length > MAX_STABLE_CODE_LENGTH) return "TOO_LONG";
  return null;
}

/**
 * Parse a level stable code exactly. `expectedLevelNumber` additionally pins the
 * embedded NNN against the level's own number — the same rule the authoring
 * service enforces (`LEVEL_STABLE_CODE_NUMBER_MISMATCH`).
 */
export function parseLevelCode(value: unknown, expectedLevelNumber?: number): ParsedLevelCode {
  const issue = preflight(value);
  if (issue) return { ok: false, issue };

  const code = value as string;
  const match = STABLE_CODE_PATTERN.exec(code);
  if (!match) return { ok: false, issue: "PATTERN_MISMATCH" };

  const levelNumber = Number(match[1]);
  if (expectedLevelNumber !== undefined && levelNumber !== expectedLevelNumber) {
    return { ok: false, issue: "LEVEL_NUMBER_MISMATCH" };
  }
  return { ok: true, code, levelNumber };
}

/** Exact canonical check — no normalisation of any kind. */
export function isCanonicalLevelCode(value: unknown, expectedLevelNumber?: number): value is string {
  return parseLevelCode(value, expectedLevelNumber).ok;
}

/**
 * The effective acceptance of the existing `z.string().trim().regex(...)`
 * consumers (learner content route, report routes, assessment runtime). Used by
 * the equivalence corpus to prove the package contract is a strict subset.
 */
export function acceptsAsLevelCode(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return STABLE_CODE_PATTERN.test(value.trim());
}

export function isCanonicalModuleCode(value: unknown): value is string {
  if (preflight(value)) return false;
  return MODULE_CODE_PATTERN.test(value as string);
}

export function isCanonicalCurriculumCode(value: unknown): value is string {
  if (preflight(value)) return false;
  return CURRICULUM_CODE_PATTERN.test(value as string);
}

/** Human-readable reason, safe for validation output (never echoes user data). */
export function describeStableCodeIssue(issue: StableCodeIssue): string {
  switch (issue) {
    case "NOT_A_STRING":
      return "stable code must be a string";
    case "EMPTY":
      return "stable code must not be empty";
    case "NOT_TRIMMED":
      return "stable code must not contain leading or trailing whitespace";
    case "TOO_LONG":
      return `stable code must be at most ${MAX_STABLE_CODE_LENGTH} characters`;
    case "PATTERN_MISMATCH":
      return "stable code must match v2.lNNN.<lowercase-kebab-slug>";
    case "LEVEL_NUMBER_MISMATCH":
      return "stable code number does not match levelNumber";
  }
}
