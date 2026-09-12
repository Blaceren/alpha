/**
 * Wire DTOs for the Backend learner ASSESSMENT contract, plus narrow runtime
 * type guards. Mirrors the auth DTO approach in `src/lib/api/types.ts`: explicit
 * guards validate exactly the fields the Academy consumes and nothing more.
 *
 * CRITICAL — answer isolation: the pre-submit question DTO carries NO correct
 * answer, no answer key, no scoring truth. `AssessmentQuestion.options` is only
 * `{ code, label }`. Correct answers live only on the Backend and are never part
 * of any pre-submit type or payload.
 */

/** A single selectable option shown to the learner (never marks correctness). */
export type AssessmentOption = {
  code: string;
  label: string;
};

/** Answer-free question projection (Backend `SafeQuestion`). */
export type AssessmentQuestion = {
  questionKey: string;
  questionNumber: number;
  type: string;
  prompt: string;
  options: AssessmentOption[];
};

/** Result of starting (or resuming) an attempt: the questions to answer. */
export type AssessmentStart = {
  created: boolean;
  level: { levelNumber: number; stableCode: string; title: string; type: string };
  attempt: { attemptId: number; attemptNumber: number; status: "in_progress"; startedAt: string };
  assessment: {
    versionNumber: number;
    passPercent: number;
    maxAttempts: number | null;
    locale: string;
    questions: AssessmentQuestion[];
  };
};

/** One learner answer: a stable questionKey + the selected option code. */
export type AssessmentAnswer = {
  questionKey: string;
  answer: { code: string };
};

/** Server-graded result of a submission (aggregate only — no per-question key). */
export type AssessmentCompletion = {
  levelNumber: number;
  stableCode: string;
  xpAwarded: number;
  nextLevelNumber: number | null;
  terminal: boolean;
  completedAt: string;
};

export type AssessmentResult = {
  created: boolean;
  status: "passed" | "failed";
  passed: boolean;
  attemptNumber: number;
  submittedAt: string;
  durationSeconds: number;
  totalQuestions: number;
  correctCount: number;
  scoreBasisPoints: number;
  completion: AssessmentCompletion | null;
};

/* --------------------------------- guards --------------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOption(value: unknown): value is AssessmentOption {
  return isObject(value) && typeof value.code === "string" && typeof value.label === "string";
}

function isQuestion(value: unknown): value is AssessmentQuestion {
  return (
    isObject(value) &&
    typeof value.questionKey === "string" &&
    typeof value.questionNumber === "number" &&
    typeof value.type === "string" &&
    typeof value.prompt === "string" &&
    Array.isArray(value.options) &&
    value.options.every(isOption) &&
    // Defence in depth: a pre-submit question must not carry any answer key.
    !("correctAnswer" in value) &&
    !("correctOptionCodes" in value) &&
    !("codes" in value)
  );
}

/** The Backend wraps payloads in `{ data: ... }`; unwrap defensively. */
export function unwrapData(value: unknown): unknown {
  if (isObject(value) && "data" in value) return (value as { data: unknown }).data;
  return value;
}

export function isAssessmentStart(value: unknown): value is AssessmentStart {
  const data = unwrapData(value);
  if (!isObject(data)) return false;
  const assessment = data.assessment;
  const attempt = data.attempt;
  if (!isObject(assessment) || !isObject(attempt)) return false;
  if (!Array.isArray(assessment.questions) || !assessment.questions.every(isQuestion)) return false;
  if (typeof attempt.attemptId !== "number" || !Number.isFinite(attempt.attemptId)) return false;
  return true;
}

export function isAssessmentResult(value: unknown): value is AssessmentResult {
  const data = unwrapData(value);
  if (!isObject(data)) return false;
  if (data.status !== "passed" && data.status !== "failed") return false;
  if (typeof data.passed !== "boolean") return false;
  if (typeof data.totalQuestions !== "number" || typeof data.correctCount !== "number") return false;
  const completion = data.completion;
  if (completion !== null && !isObject(completion)) return false;
  return true;
}

export function assessmentStartData(value: unknown): AssessmentStart {
  return unwrapData(value) as AssessmentStart;
}

export function assessmentResultData(value: unknown): AssessmentResult {
  return unwrapData(value) as AssessmentResult;
}
