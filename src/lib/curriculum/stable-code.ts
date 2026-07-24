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
