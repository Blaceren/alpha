import { describe, it, expect } from "vitest";
import {
  allAnswered,
  initialState,
  phaseForError,
  reducer,
  type AssessmentState,
} from "@/features/assessment/assessment-machine";
import { makeError } from "@/lib/api/errors";
import type { AssessmentStart, AssessmentResult } from "@/lib/assessment/types";

const START: AssessmentStart = {
  created: true,
  level: { levelNumber: 2, stableCode: "v2.l002.x", title: "L2", type: "lesson" },
  attempt: { attemptId: 7, attemptNumber: 1, status: "in_progress", startedAt: "2026-06-01T00:00:00.000Z" },
  assessment: {
    versionNumber: 1,
    passPercent: 100,
    maxAttempts: null,
    locale: "ru",
    questions: [
      { questionKey: "q1", questionNumber: 1, type: "single_choice", prompt: "P1", options: [{ code: "a", label: "A" }, { code: "b", label: "B" }] },
      { questionKey: "q2", questionNumber: 2, type: "single_choice", prompt: "P2", options: [{ code: "a", label: "A" }, { code: "b", label: "B" }] },
    ],
  },
};

const failResult = (): AssessmentResult => ({ created: true, status: "failed", passed: false, attemptNumber: 1, submittedAt: "t", durationSeconds: 5, totalQuestions: 2, correctCount: 1, scoreBasisPoints: 5000, completion: null });
const passResult = (): AssessmentResult => ({ created: true, status: "passed", passed: true, attemptNumber: 2, submittedAt: "t", durationSeconds: 5, totalQuestions: 2, correctCount: 2, scoreBasisPoints: 10000, completion: { levelNumber: 2, stableCode: "v2.l002.x", xpAwarded: 0, nextLevelNumber: 3, terminal: false, completedAt: "t" } });

function loaded(): AssessmentState {
  return reducer(initialState(false), { type: "start_ok", data: START });
}

describe("assessment-machine", () => {
  it("starts in loading (or already_completed)", () => {
    expect(initialState(false).phase).toBe("loading");
    expect(initialState(true).phase).toBe("already_completed");
  });

  it("start_ok loads answer-free questions and clears selections", () => {
    const s = loaded();
    expect(s.phase).toBe("answering");
    expect(s.questions).toHaveLength(2);
    expect(s.attemptId).toBe(7);
    expect(s.selections).toEqual({});
  });

  it("submit is gated until every question is answered (no auto-preselect)", () => {
    let s = loaded();
    expect(allAnswered(s)).toBe(false);
    s = reducer(s, { type: "select", questionKey: "q1", code: "a" });
    expect(allAnswered(s)).toBe(false);
    s = reducer(s, { type: "select", questionKey: "q2", code: "b" });
    expect(allAnswered(s)).toBe(true);
  });

  it("select ignores unknown questions and never preselects", () => {
    const s = reducer(loaded(), { type: "select", questionKey: "nope", code: "a" });
    expect(s.selections).toEqual({});
  });

  it("submit_pending only transitions from a complete answering state", () => {
    let s = loaded();
    s = reducer(s, { type: "submit_pending", requestId: "r1" });
    expect(s.phase).toBe("answering"); // blocked: not all answered
    s = reducer(loaded(), { type: "select", questionKey: "q1", code: "a" });
    s = reducer(s, { type: "select", questionKey: "q2", code: "b" });
    s = reducer(s, { type: "submit_pending", requestId: "r1" });
    expect(s.phase).toBe("submitting");
    expect(s.requestId).toBe("r1");
  });

  it("pass/fail phase is derived only from the Backend result", () => {
    let s = reducer(loaded(), { type: "submit_ok", result: failResult() });
    expect(s.phase).toBe("failed");
    s = reducer(loaded(), { type: "submit_ok", result: passResult() });
    expect(s.phase).toBe("passed");
    expect(s.result?.completion?.nextLevelNumber).toBe(3);
  });

  it("retry clears selections and returns to loading (fresh attempt)", () => {
    let s = reducer(loaded(), { type: "submit_ok", result: failResult() });
    s = reducer(s, { type: "select", questionKey: "q1", code: "a" }); // failed still allows re-select
    s = reducer(s, { type: "retry" });
    expect(s.phase).toBe("loading");
    expect(s.selections).toEqual({});
    expect(s.attemptId).toBeNull();
  });

  it("maps errors to bounded phases (fail-closed)", () => {
    expect(phaseForError(makeError("UNKNOWN_ERROR", { status: 404, code: "NOT_FOUND" }))).toBe("flag_disabled");
    expect(phaseForError(makeError("CONFLICT", { status: 409, code: "ASSESSMENT_STATE_CORRUPT" }))).toBe("stale_content");
    expect(phaseForError(makeError("NETWORK_ERROR"))).toBe("error");
  });

  it("has no client-side grading: reducer never computes correctness", () => {
    // The reducer exposes no correctness/score computation; pass state requires a
    // Backend result object. A selection alone never produces a passed phase.
    const s = reducer(loaded(), { type: "select", questionKey: "q1", code: "a" });
    expect(s.phase).toBe("answering");
    expect(s.result).toBeNull();
  });
});
