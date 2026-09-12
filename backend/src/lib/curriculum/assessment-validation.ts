import type {
  AssessmentVersion,
  LevelDefinitionType,
  QuestionDefinition,
  QuestionLocalization,
  QuestionType,
} from "@prisma/client";
import type { z } from "zod";
import { AssessmentDomainError } from "@/lib/curriculum/assessment-errors";
import type { AssessmentValidationIssue } from "@/lib/curriculum/assessment-errors";
import { isCanonicalAssessmentQuestionKey } from "@/lib/curriculum/stable-code";

/**
 * AC-1 — the ONE bounded assessment publication policy.
 *
 * `passPercent` is a general bounded integer, not a fixed product template. The
 * bounds are not invented here: `AssessmentVersion.passPercent` has carried
 * `CHECK ("passPercent" BETWEEN 1 AND 100)` since the content/assessment
 * foundation migration, and both the authoring command schema
 * (`assessment-schemas.ts`) and the package schema already accept
 * `int().min(1).max(100)`. Only this validator narrowed publication to the
 * single value 80 — the Phase 4B.3 *product standard* (V2_PRODUCT_DECISIONS §20,
 * "продуктовый стандарт 80") hardcoded as an equality. The operator-approved
 * D1–D8 first-slice decision requires 100, so the standard is expressed here as
 * the model's real contract instead of one permitted value.
 */
export const MIN_PASS_PERCENT = 1;
export const MAX_PASS_PERCENT = 100;

/**
 * Lesson assessments: bounded question count. Phase 4B.3 approved 5–7; the later
 * operator-approved D1–D8 decision approves exactly 4 for the first slice. The
 * union 4..7 is the narrowest bound satisfying both — it admits the approved 4
 * and keeps every previously valid 5/6/7 assessment valid, while still rejecting
 * zero and any unbounded count. `final_exam` (exactly 30) is unchanged.
 */
export const MIN_LESSON_QUESTIONS = 4;
export const MAX_LESSON_QUESTIONS = 7;

const OPTION_CODE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const DECIMAL = /^-?\d{1,12}(\.\d{1,6})?$/;
const NORMALIZED_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const MAX_JSON_BYTES = 16 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type Option = { code: string };
type CanonicalQuestion = {
  options: Option[] | null;
  correctAnswer: { code: string } | { codes: string[] } | { value: string };
};

function issue(
  code: string,
  entity: AssessmentValidationIssue["entity"],
  reference: string,
  message: string,
): AssessmentValidationIssue {
  return { code, entity, reference, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonIsSafe(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 20 && value.every((item) => jsonIsSafe(item, depth + 1));
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).every(
    ([key, item]) => !FORBIDDEN_KEYS.has(key) && jsonIsSafe(item, depth + 1),
  );
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function parseOptions(value: unknown, minimum: number, maximum: number): Option[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  const options: Option[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainRecord(item) || !exactKeys(item, ["code"]) || typeof item.code !== "string") return null;
    const code = item.code.trim();
    if (!OPTION_CODE.test(code) || seen.has(code)) return null;
    seen.add(code);
    options.push({ code });
  }
  return options;
}

function parseCodeAnswer(value: unknown, options: Option[]) {
  if (!isPlainRecord(value) || !exactKeys(value, ["code"]) || typeof value.code !== "string") return null;
  const code = value.code.trim();
  return options.some((option) => option.code === code) ? { code } : null;
}

function parseCodesAnswer(value: unknown, options: Option[], requirePermutation: boolean) {
  if (!isPlainRecord(value) || !exactKeys(value, ["codes"]) || !Array.isArray(value.codes)) return null;
  const codes = value.codes;
  if (codes.length === 0 || codes.some((code) => typeof code !== "string")) return null;
  const normalized = codes.map((code) => (code as string).trim());
  const unique = new Set(normalized);
  if (unique.size !== normalized.length || normalized.some((code) => !options.some((item) => item.code === code))) return null;
  if (requirePermutation && (normalized.length !== options.length || options.some((item) => !unique.has(item.code)))) return null;
  return { codes: requirePermutation ? normalized : [...normalized].sort() };
}

function canonicalDecimal(value: string) {
  let normalized = value.trim();
  if (!DECIMAL.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  if (negative) normalized = normalized.slice(1);
  const [integer, fraction = ""] = normalized.split(".");
  const cleanInteger = integer.replace(/^0+(?=\d)/, "");
  const cleanFraction = fraction.replace(/0+$/, "");
  const magnitude = cleanFraction ? `${cleanInteger}.${cleanFraction}` : cleanInteger;
  return magnitude === "0" ? "0" : negative ? `-${magnitude}` : magnitude;
}

export function parseAssessmentCommand<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AssessmentDomainError(
      "ASSESSMENT_INPUT_INVALID",
      "assessment command input is invalid",
      parsed.error.issues.map((item) =>
        issue("ASSESSMENT_FIELD_INVALID", "assessment", `input.${item.path.map(String).join(".")}`, item.message),
      ),
    );
  }
  return parsed.data;
}

export function canonicalizeQuestion(
  type: QuestionType,
  optionsValue: unknown,
  answerValue: unknown,
  reference = "draft",
): CanonicalQuestion {
  let options: Option[] | null = null;
  let correctAnswer: CanonicalQuestion["correctAnswer"] | null = null;

  if (!jsonIsSafe(optionsValue) || !jsonIsSafe(answerValue)) {
    throw new AssessmentDomainError(
      "ASSESSMENT_INPUT_INVALID",
      "question answer contract is invalid",
      [issue("ASSESSMENT_JSON_UNSAFE", "question", reference, "question JSON is unsafe or exceeds depth limits")],
    );
  }
  if (Buffer.byteLength(JSON.stringify({ optionsValue, answerValue }), "utf8") > MAX_JSON_BYTES) {
    throw new AssessmentDomainError(
      "ASSESSMENT_INPUT_INVALID",
      "question answer contract is invalid",
      [issue("ASSESSMENT_JSON_TOO_LARGE", "question", reference, "question JSON exceeds the size limit")],
    );
  }

  switch (type) {
    case "single_choice":
      options = parseOptions(optionsValue, 2, 8);
      if (options) correctAnswer = parseCodeAnswer(answerValue, options);
      break;
    case "multiple_choice":
      options = parseOptions(optionsValue, 3, 10);
      if (options) correctAnswer = parseCodesAnswer(answerValue, options, false);
      break;
    case "true_false":
      options = parseOptions(optionsValue, 2, 2);
      if (options && options[0]?.code === "true" && options[1]?.code === "false") {
        correctAnswer = parseCodeAnswer(answerValue, options);
      } else {
        options = null;
      }
      break;
    case "ordered_steps":
      options = parseOptions(optionsValue, 3, 8);
      if (options) correctAnswer = parseCodesAnswer(answerValue, options, true);
      break;
    case "scenario_choice":
      options = parseOptions(optionsValue, 2, 6);
      if (options) correctAnswer = parseCodeAnswer(answerValue, options);
      break;
    case "numeric": {
      if (optionsValue !== null) break;
      if (isPlainRecord(answerValue) && exactKeys(answerValue, ["value"]) && typeof answerValue.value === "string") {
        const value = canonicalDecimal(answerValue.value);
        if (value !== null) {
          options = null;
          correctAnswer = { value };
        }
      }
      break;
    }
    case "chart_choice":
      options = parseOptions(optionsValue, 2, 8);
      if (options) correctAnswer = parseCodeAnswer(answerValue, options);
      break;
  }

  if (!correctAnswer || (type !== "numeric" && !options)) {
    throw new AssessmentDomainError(
      "ASSESSMENT_INPUT_INVALID",
      "question answer contract is invalid",
      [issue("ASSESSMENT_ANSWER_SCHEMA_INVALID", "question", reference, "options or correct answer do not match the question type")],
    );
  }
  return { options, correctAnswer };
}

function optionCodes(question: Pick<QuestionDefinition, "type" | "options">): string[] | null {
  try {
    return canonicalizeQuestion(question.type, question.options, question.type === "numeric" ? { value: "0" } :
      question.type === "multiple_choice" ? { codes: [(question.options as Option[])?.[0]?.code] } :
      question.type === "ordered_steps" ? { codes: (question.options as Option[])?.map((item) => item.code) } :
      { code: (question.options as Option[])?.[0]?.code }).options?.map((item) => item.code) ?? [];
  } catch {
    return null;
  }
}

export function localizationIsComplete(
  question: Pick<QuestionDefinition, "type" | "options">,
  localization: Pick<QuestionLocalization, "prompt" | "optionLabels">,
) {
  if (typeof localization.prompt !== "string" || localization.prompt.trim().length === 0 || localization.prompt.length > 8_000) return false;
  const codes = question.type === "numeric" ? [] : optionCodes(question);
  if (codes === null) return false;
  if (codes.length === 0) {
    return localization.optionLabels === null ||
      (isPlainRecord(localization.optionLabels) && Object.keys(localization.optionLabels).length === 0);
  }
  if (!isPlainRecord(localization.optionLabels) || Object.keys(localization.optionLabels).some((key) => FORBIDDEN_KEYS.has(key))) return false;
  const keys = Object.keys(localization.optionLabels).sort();
  const expected = [...codes].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]) &&
    Object.values(localization.optionLabels).every((label) => typeof label === "string" && label.trim().length > 0 && label.length <= 1_000);
}

export function assertLocalizationComplete(
  question: Pick<QuestionDefinition, "id" | "type" | "options">,
  localization: Pick<QuestionLocalization, "prompt" | "optionLabels">,
) {
  if (!localizationIsComplete(question, localization)) {
    throw new AssessmentDomainError(
      "ASSESSMENT_INPUT_INVALID",
      "question localization is incomplete",
      [issue("ASSESSMENT_LOCALIZATION_INCOMPLETE", "localization", `question:${question.id}`, "localization must cover the exact option set")],
    );
  }
}

export type AssessmentPublicationSnapshot = AssessmentVersion & {
  levelDefinition: { type: LevelDefinitionType; curriculumVersion: { status: "draft" | "published" | "archived" } };
  questions: Array<QuestionDefinition & { localizations: QuestionLocalization[] }>;
};

export function validateAssessmentPublication(snapshot: AssessmentPublicationSnapshot) {
  const issues: AssessmentValidationIssue[] = [];
  const questions = snapshot.questions;
  const activeQuestions = questions.filter((question) => question.status === "active");
  if (
    !Number.isInteger(snapshot.passPercent) ||
    snapshot.passPercent < MIN_PASS_PERCENT ||
    snapshot.passPercent > MAX_PASS_PERCENT
  ) {
    issues.push(issue("ASSESSMENT_PASS_PERCENT_INVALID", "assessment", `assessment:${snapshot.id}`, `passPercent must be an integer between ${MIN_PASS_PERCENT} and ${MAX_PASS_PERCENT}`));
  }
  if (snapshot.maxAttempts !== null && snapshot.maxAttempts <= 0) {
    issues.push(issue("ASSESSMENT_MAX_ATTEMPTS_INVALID", "assessment", `assessment:${snapshot.id}`, "maxAttempts must be positive or null"));
  }
  if (activeQuestions.length === 0) {
    issues.push(issue("ASSESSMENT_QUESTION_REQUIRED", "assessment", `assessment:${snapshot.id}`, "at least one question is required"));
  }
  if (
    snapshot.levelDefinition.type === "lesson" &&
    (activeQuestions.length < MIN_LESSON_QUESTIONS || activeQuestions.length > MAX_LESSON_QUESTIONS)
  ) {
    issues.push(issue("ASSESSMENT_LESSON_QUESTION_COUNT", "assessment", `assessment:${snapshot.id}`, `lesson assessments require ${MIN_LESSON_QUESTIONS} to ${MAX_LESSON_QUESTIONS} questions`));
  } else if (snapshot.levelDefinition.type === "final_exam") {
    if (activeQuestions.length !== 30) {
      issues.push(issue("ASSESSMENT_FINAL_EXAM_QUESTION_COUNT", "assessment", `assessment:${snapshot.id}`, "final exam requires exactly 30 questions"));
    }
    if (activeQuestions.filter((question) => question.type === "scenario_choice").length < 3) {
      issues.push(issue("ASSESSMENT_FINAL_EXAM_SCENARIOS_REQUIRED", "assessment", `assessment:${snapshot.id}`, "final exam requires at least three scenario questions"));
    }
  } else if (snapshot.levelDefinition.type !== "lesson") {
    issues.push(issue("ASSESSMENT_LEVEL_TYPE_UNSUPPORTED", "assessment", `assessment:${snapshot.id}`, "assessment publication is not approved for this level type"));
  }

  const numbers = new Set<number>();
  const keys = new Set<string>();
  let commonLocales: Set<string> | null = null;
  for (const question of questions) {
    const reference = `question:${question.id}`;
    if (question.status !== "active") {
      issues.push(issue("ASSESSMENT_QUESTION_DISABLED", "question", reference, "published assessments cannot contain disabled questions"));
    }
    if (!Number.isInteger(question.questionNumber) || question.questionNumber <= 0) {
      issues.push(issue("ASSESSMENT_QUESTION_ORDER_INVALID", "question", reference, "questionNumber must be a positive integer"));
    }
    if (!isCanonicalAssessmentQuestionKey(question.stableKey)) {
      issues.push(issue("ASSESSMENT_QUESTION_KEY_INVALID", "question", reference, "stableKey is invalid"));
    }
    if (numbers.has(question.questionNumber)) issues.push(issue("ASSESSMENT_QUESTION_ORDER_DUPLICATE", "question", reference, "questionNumber must be unique"));
    if (keys.has(question.stableKey)) issues.push(issue("ASSESSMENT_QUESTION_KEY_DUPLICATE", "question", reference, "stableKey must be unique"));
    numbers.add(question.questionNumber);
    keys.add(question.stableKey);
    try {
      canonicalizeQuestion(question.type, question.options, question.correctAnswer, reference);
    } catch {
      issues.push(issue("ASSESSMENT_ANSWER_SCHEMA_INVALID", "question", reference, "question answer contract is invalid"));
    }
    if (question.type === "numeric") {
      issues.push(issue("ASSESSMENT_GRADING_UNSUPPORTED", "question", reference, "numeric grading semantics are not approved"));
    }
    if (question.type === "chart_choice") {
      issues.push(issue("ASSESSMENT_CHART_ASSET_UNRESOLVED", "question", reference, "chart asset ownership is not approved"));
    }
    const localeSeen = new Set<string>();
    for (const localization of question.localizations) {
      const localizationReference = `localization:${localization.id}`;
      if (!NORMALIZED_LOCALE.test(localization.locale) || localization.locale !== localization.locale.toLowerCase()) {
        issues.push(issue("ASSESSMENT_LOCALE_INVALID", "localization", localizationReference, "locale is not normalized"));
      }
      if (localeSeen.has(localization.locale)) {
        issues.push(issue("ASSESSMENT_LOCALE_DUPLICATE", "localization", localizationReference, "locale must be unique per question"));
      }
      if (localization.explanation !== null && (localization.explanation.trim().length === 0 || localization.explanation.length > 8_000)) {
        issues.push(issue("ASSESSMENT_EXPLANATION_INVALID", "localization", localizationReference, "explanation is invalid"));
      }
      if (!localizationIsComplete(question, localization)) {
        issues.push(issue("ASSESSMENT_LOCALIZATION_INCOMPLETE", "localization", localizationReference, "localization must cover the exact option set"));
      }
      localeSeen.add(localization.locale);
    }
    const completeLocales = new Set(
      question.localizations
        .filter((localization) => localizationIsComplete(question, localization))
        .map((localization) => localization.locale),
    );
    if (question.status === "active") {
      if (commonLocales === null) {
        commonLocales = completeLocales;
      } else {
        const previous: Set<string> = commonLocales;
        commonLocales = new Set(Array.from(previous).filter((locale: string) => completeLocales.has(locale)));
      }
    }
  }
  if (activeQuestions.length > 0 && (commonLocales === null || commonLocales.size === 0)) {
    issues.push(issue("ASSESSMENT_COMMON_LOCALE_REQUIRED", "assessment", `assessment:${snapshot.id}`, "all questions require one common complete locale"));
  }
  return issues;
}
