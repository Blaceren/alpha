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

/**
 * The разбор of one WRONG answer (2026-10-02).
 *
 * «При неверном ответе показывать разбор, а не только слово „неверно“» and
 * «указывать конкретный отрезок видео для пересмотра». The Backend sends one of
 * these per wrongly answered question of a graded attempt, and only when the
 * assessment's author asked for explanations to be shown.
 *
 * It names the question and never the answer: there is no option code, no
 * "correct" flag and no key here. The explanation is the author's own prose and
 * may well say the answer in words — that is what a разбор is.
 */
export type AssessmentReviewItem = {
  questionKey: string;
  questionNumber: number;
  /** The author's explanation, or null when this question has none. */
  explanation: string | null;
  /** «Пересмотреть с 1:55» — seconds from the start of the lesson video. */
  rewatchFromSeconds: number | null;
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
  /**
   * Null when this assessment shows no разбор (or the Backend predates it): the
   * result is then the aggregate alone, as it always was. An array — possibly
   * empty, on a pass — names exactly the questions answered wrongly.
   */
  review: AssessmentReviewItem[] | null;
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

/** Longest разбор the page will print; anything longer is not one. */
const MAX_EXPLANATION_LENGTH = 4_000;
/** A lesson video is not longer than a day. */
const MAX_REWATCH_SECONDS = 86_400;

/**
 * Read the review defensively.
 *
 * Absent, null or not a list → null: «this result has no разбор», which the
 * page renders exactly as it did before the field existed. A malformed ITEM is
 * dropped on its own, and what survives is still true: every item left names a
 * question the Backend said was answered wrongly.
 */
export function readAssessmentReview(value: unknown): AssessmentReviewItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: AssessmentReviewItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isObject(raw)) continue;
    const { questionKey, questionNumber, explanation, rewatchFromSeconds } = raw;
    if (typeof questionKey !== "string" || questionKey === "" || seen.has(questionKey)) continue;
    if (typeof questionNumber !== "number" || !Number.isInteger(questionNumber) || questionNumber < 1) continue;
    seen.add(questionKey);
    items.push({
      questionKey,
      questionNumber,
      explanation:
        typeof explanation === "string" && explanation.trim() !== "" && explanation.length <= MAX_EXPLANATION_LENGTH
          ? explanation
          : null,
      rewatchFromSeconds:
        typeof rewatchFromSeconds === "number" &&
        Number.isInteger(rewatchFromSeconds) &&
        rewatchFromSeconds >= 0 &&
        rewatchFromSeconds <= MAX_REWATCH_SECONDS
          ? rewatchFromSeconds
          : null,
    });
  }
  return items;
}

export function assessmentResultData(value: unknown): AssessmentResult {
  const data = unwrapData(value) as AssessmentResult & { review?: unknown };
  return { ...data, review: readAssessmentReview(data.review) };
}
