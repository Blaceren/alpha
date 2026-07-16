/**
 * Assessment model (Phase D2B). Pure, deterministic, framework-free.
 *
 * Product rules encoded here (not in components):
 *   - one question is shown at a time, in fixture order (never shuffled);
 *   - a question cannot be skipped and the next one cannot open before the
 *     current one is answered correctly;
 *   - the correct option is never exposed before submit;
 *   - an incorrect answer costs nothing — no XP loss, no lives, no streak break,
 *     no timer. It yields an explanation and the question stays open for retry;
 *   - completion requires every REQUIRED question answered correctly once.
 */

import type { AssessmentQuestion, LessonAssessment } from "@/features/lesson/model/lesson";

export type AssessmentState =
  | "locked"
  | "ready"
  | "answering"
  | "feedback_correct"
  | "feedback_incorrect"
  | "completed";

export interface AssessmentProgress {
  /** Index of the question currently shown (0-based). */
  currentIndex: number;
  /** Option id selected but not yet submitted, or null. */
  selectedOptionId: string | null;
  /** The submitted option id for the current question, or null before submit. */
  submittedOptionId: string | null;
  /** Question ids answered correctly at least once. Order-independent. */
  answeredCorrectly: string[];
  /** True once the user opened the assessment (ready → answering). */
  started: boolean;
  /** Set when a submit was attempted with nothing selected. */
  submitAttemptedWithoutSelection: boolean;
}

export function createAssessmentProgress(
  overrides: Partial<AssessmentProgress> = {},
): AssessmentProgress {
  return {
    currentIndex: 0,
    selectedOptionId: null,
    submittedOptionId: null,
    answeredCorrectly: [],
    started: false,
    submitAttemptedWithoutSelection: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------ */

export function currentQuestion(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
): AssessmentQuestion {
  const index = Math.min(Math.max(progress.currentIndex, 0), assessment.questions.length - 1);
  const question = assessment.questions[index];
  if (!question) throw new Error(`Assessment ${assessment.id} has no questions`);
  return question;
}

export function correctOptionId(question: AssessmentQuestion): string {
  const option = question.options.find((o) => o.correct);
  if (!option) throw new Error(`Question ${question.id} has no correct option`);
  return option.id;
}

export function isSubmittedAnswerCorrect(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
): boolean | null {
  if (progress.submittedOptionId === null) return null;
  return progress.submittedOptionId === correctOptionId(currentQuestion(assessment, progress));
}

export function requiredQuestions(assessment: LessonAssessment): AssessmentQuestion[] {
  return assessment.questions.filter((q) => q.required);
}

/** Every required question answered correctly at least once. */
export function allRequiredAnswered(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
): boolean {
  return requiredQuestions(assessment).every((q) => progress.answeredCorrectly.includes(q.id));
}

/** Assessment state given the unlock gate and the progress record. */
export function assessmentState(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
  unlocked: boolean,
): AssessmentState {
  if (!unlocked) return "locked";
  if (allRequiredAnswered(assessment, progress)) return "completed";
  if (!progress.started) return "ready";
  const correct = isSubmittedAnswerCorrect(assessment, progress);
  if (correct === true) return "feedback_correct";
  if (correct === false) return "feedback_incorrect";
  return "answering";
}

/** Can the user move to the next question right now? Only after a correct answer. */
export function canAdvance(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
): boolean {
  return isSubmittedAnswerCorrect(assessment, progress) === true;
}

/* ------------------------------------------------------------------ *
 * Transitions — each returns a NEW progress; none mutate.
 * ------------------------------------------------------------------ */

/** Open the assessment. Rejected while locked — the gate lives in one place. */
export function start(progress: AssessmentProgress, unlocked: boolean): AssessmentProgress {
  if (!unlocked || progress.started) return progress;
  return { ...progress, started: true };
}

/** Select an option. Ignored after submit — the answer is settled until retry. */
export function select(progress: AssessmentProgress, optionId: string): AssessmentProgress {
  if (progress.submittedOptionId !== null) return progress;
  return { ...progress, selectedOptionId: optionId, submitAttemptedWithoutSelection: false };
}

/**
 * Submit the selected option. With nothing selected it does NOT fail silently:
 * it records the attempt so the UI can explain what is missing.
 */
export function submit(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
  unlocked: boolean,
): AssessmentProgress {
  if (!unlocked || !progress.started) return progress;
  if (progress.submittedOptionId !== null) return progress;
  if (progress.selectedOptionId === null) {
    return { ...progress, submitAttemptedWithoutSelection: true };
  }

  const question = currentQuestion(assessment, progress);
  const correct = progress.selectedOptionId === correctOptionId(question);
  return {
    ...progress,
    submittedOptionId: progress.selectedOptionId,
    submitAttemptedWithoutSelection: false,
    answeredCorrectly:
      correct && !progress.answeredCorrectly.includes(question.id)
        ? [...progress.answeredCorrectly, question.id]
        : progress.answeredCorrectly,
  };
}

/** Retry after an incorrect answer. Clears the submission; costs nothing. */
export function retry(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
): AssessmentProgress {
  if (isSubmittedAnswerCorrect(assessment, progress) !== false) return progress;
  return { ...progress, submittedOptionId: null, selectedOptionId: null };
}

/** Move to the next question. Rejected unless the current answer was correct. */
export function next(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
): AssessmentProgress {
  if (!canAdvance(assessment, progress)) return progress;
  const last = assessment.questions.length - 1;
  if (progress.currentIndex >= last) return progress;
  return {
    ...progress,
    currentIndex: progress.currentIndex + 1,
    selectedOptionId: null,
    submittedOptionId: null,
    submitAttemptedWithoutSelection: false,
  };
}

/** "Вопрос N из M" — 1-based, for UI and announcements. */
export function questionPosition(
  assessment: LessonAssessment,
  progress: AssessmentProgress,
): { position: number; total: number } {
  return {
    position: Math.min(progress.currentIndex, assessment.questions.length - 1) + 1,
    total: assessment.questions.length,
  };
}
