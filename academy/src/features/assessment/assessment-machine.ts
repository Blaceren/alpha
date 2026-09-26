/**
 * Pure state model for the L2 assessment experience (no React, fully testable).
 *
 * Completion and pass/fail are ALWAYS derived from Backend responses. This
 * reducer never computes a score, never infers correctness from option position,
 * and never treats local selections as authority. Selections are transient UI
 * state only.
 */
import type { NormalizedError } from "@/lib/api/errors";
import type { AssessmentQuestion, AssessmentResult, AssessmentStart } from "@/lib/assessment/types";

export type AssessmentPhase =
  | "loading" // start request in flight
  | "answering" // questions loaded; learner selecting
  | "submitting" // submit request in flight (bounded)
  | "failed" // Backend graded < pass threshold
  | "passed" // Backend confirmed pass
  | "already_completed" // level already completed server-side (no start call)
  | "flag_disabled" // assessment feature disabled (fails closed)
  | "stale_content" // pinned assessment/content no longer valid
  | "error"; // bounded generic error

export type AssessmentState = {
  phase: AssessmentPhase;
  questions: AssessmentQuestion[];
  attemptId: number | null;
  /** questionKey -> selected option code. Transient UI state only. */
  selections: Record<string, string>;
  result: AssessmentResult | null;
  error: NormalizedError | null;
  /** Idempotency key for the in-flight submit (one per submit action). */
  requestId: string | null;
};

export type AssessmentAction =
  | { type: "start_pending" }
  | { type: "start_ok"; data: AssessmentStart }
  | { type: "start_err"; error: NormalizedError }
  | { type: "select"; questionKey: string; code: string }
  | { type: "submit_pending"; requestId: string }
  | { type: "submit_ok"; result: AssessmentResult }
  | { type: "submit_err"; error: NormalizedError }
  | { type: "retry" };

export function initialState(alreadyCompleted: boolean): AssessmentState {
  return {
    phase: alreadyCompleted ? "already_completed" : "loading",
    questions: [],
    attemptId: null,
    selections: {},
    result: null,
    error: null,
    requestId: null,
  };
}

/** Map a normalized error to a bounded terminal phase. */
export function phaseForError(error: NormalizedError): Extract<AssessmentPhase, "flag_disabled" | "stale_content" | "error"> {
  // Feature disabled fails closed as 404 / NOT_FOUND.
  if (error.status === 404 || error.code === "NOT_FOUND") return "flag_disabled";
  if (error.code === "ASSESSMENT_STATE_CORRUPT") return "stale_content";
  return "error";
}

/** True once every loaded question has a selection (submit precondition). */
export function allAnswered(state: AssessmentState): boolean {
  return (
    state.questions.length > 0 &&
    state.questions.every((q) => typeof state.selections[q.questionKey] === "string")
  );
}

export function reducer(state: AssessmentState, action: AssessmentAction): AssessmentState {
  switch (action.type) {
    case "start_pending":
      return { ...state, phase: "loading", error: null };
    case "start_ok":
      return {
        ...state,
        phase: "answering",
        questions: action.data.assessment.questions,
        attemptId: action.data.attempt.attemptId,
        selections: {}, // a fresh/resumed attempt starts with a clean answer state
        result: null,
        error: null,
        requestId: null,
      };
    case "start_err":
      return { ...state, phase: phaseForError(action.error), error: action.error };
    case "select":
      // Only mutate for a known question while answering; never auto-preselect.
      if (state.phase !== "answering" && state.phase !== "failed") return state;
      if (!state.questions.some((q) => q.questionKey === action.questionKey)) return state;
      return {
        ...state,
        phase: "answering",
        selections: { ...state.selections, [action.questionKey]: action.code },
      };
    case "submit_pending":
      // Guard: only submit from answering with a complete answer set.
      if (state.phase !== "answering" || !allAnswered(state)) return state;
      return { ...state, phase: "submitting", requestId: action.requestId, error: null };
    case "submit_ok":
      return {
        ...state,
        phase: action.result.passed ? "passed" : "failed",
        result: action.result,
        error: null,
      };
    case "submit_err":
      return { ...state, phase: phaseForError(action.error), error: action.error };
    case "retry":
      // Immediate retry: clean answer state, re-start a fresh attempt.
      return {
        ...state,
        phase: "loading",
        selections: {},
        result: null,
        error: null,
        attemptId: null,
        requestId: null,
      };
    default:
      return state;
  }
}
