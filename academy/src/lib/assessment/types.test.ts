import { describe, it, expect } from "vitest";
import {
  isAssessmentResult,
  isAssessmentStart,
  assessmentResultData,
  assessmentStartData,
  readAssessmentReview,
  type AssessmentStart,
} from "@/lib/assessment/types";

const validStart = {
  data: {
    created: true,
    level: { levelNumber: 2, stableCode: "v2.l002.x", title: "L2", type: "lesson" },
    attempt: { attemptId: 5, attemptNumber: 1, status: "in_progress", startedAt: "t" },
    assessment: {
      versionNumber: 1,
      passPercent: 100,
      maxAttempts: null,
      locale: "ru",
      questions: [
        { questionKey: "q1", questionNumber: 1, type: "single_choice", prompt: "P", options: [{ code: "a", label: "A" }, { code: "b", label: "B" }, { code: "c", label: "C" }, { code: "d", label: "D" }] },
      ],
    },
  },
};

describe("assessment DTO guards — answer isolation", () => {
  it("accepts a valid answer-free start payload and unwraps data", () => {
    expect(isAssessmentStart(validStart)).toBe(true);
    const data: AssessmentStart = assessmentStartData(validStart);
    expect(data.assessment.questions[0]!.options).toHaveLength(4);
  });

  it("rejects a question that leaks a correct-answer field", () => {
    const leaky = structuredClone(validStart);
    (leaky.data.assessment.questions[0] as Record<string, unknown>).correctAnswer = { code: "c" };
    expect(isAssessmentStart(leaky)).toBe(false);
  });

  it("rejects a question that leaks correctOptionCodes or codes", () => {
    const a = structuredClone(validStart);
    (a.data.assessment.questions[0] as Record<string, unknown>).correctOptionCodes = ["c"];
    expect(isAssessmentStart(a)).toBe(false);
    const b = structuredClone(validStart);
    (b.data.assessment.questions[0] as Record<string, unknown>).codes = ["c"];
    expect(isAssessmentStart(b)).toBe(false);
  });

  it("option shape is only {code,label} — no correctness marker", () => {
    const start = assessmentStartData(validStart);
    for (const opt of start.assessment.questions[0]!.options) {
      expect(Object.keys(opt).sort()).toEqual(["code", "label"]);
    }
  });

  it("validates a graded result payload", () => {
    expect(isAssessmentResult({ data: { created: true, status: "failed", passed: false, totalQuestions: 4, correctCount: 3, completion: null } })).toBe(true);
    expect(isAssessmentResult({ data: { created: true, status: "passed", passed: true, totalQuestions: 4, correctCount: 4, completion: { levelNumber: 2, nextLevelNumber: 3 } } })).toBe(true);
  });

  it("rejects a malformed result", () => {
    expect(isAssessmentResult({ data: { status: "maybe" } })).toBe(false);
    expect(isAssessmentResult({ data: { status: "passed", passed: "yes" } })).toBe(false);
  });
});

/**
 * THE РАЗБОР (2026-10-02) — read defensively, because it is printed.
 */
describe("readAssessmentReview", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    questionKey: "q1",
    questionNumber: 1,
    explanation: "Тело — расстояние между открытием и закрытием.",
    rewatchFromSeconds: 220,
    ...over,
  });

  it("is null when the result carries no review — the aggregate-only result of before", () => {
    for (const absent of [undefined, null, "no", 3, {}]) expect(readAssessmentReview(absent)).toBeNull();
  });

  it("is an empty list on a pass, which is not the same as null", () => {
    expect(readAssessmentReview([])).toEqual([]);
  });

  it("keeps a well-formed item as it is", () => {
    expect(readAssessmentReview([item()])).toEqual([item()]);
  });

  it("keeps an item with no explanation or no second, as nulls", () => {
    expect(readAssessmentReview([item({ explanation: null, rewatchFromSeconds: null })])).toEqual([
      item({ explanation: null, rewatchFromSeconds: null }),
    ]);
    expect(readAssessmentReview([item({ explanation: "   " })])![0]!.explanation).toBeNull();
  });

  it("drops a second that is not a whole, sane number of seconds", () => {
    for (const bad of [-1, 1.5, Number.NaN, 90_000, "115"]) {
      expect(readAssessmentReview([item({ rewatchFromSeconds: bad })])![0]!.rewatchFromSeconds, String(bad)).toBeNull();
    }
    expect(readAssessmentReview([item({ rewatchFromSeconds: 0 })])![0]!.rewatchFromSeconds).toBe(0);
  });

  it("drops a malformed item and a repeated question without losing the rest", () => {
    const read = readAssessmentReview([
      item(),
      "nope",
      item({ questionKey: "" }),
      item({ questionKey: "q2", questionNumber: 0 }),
      item({ questionKey: "q1", explanation: "second opinion" }),
      item({ questionKey: "q3", questionNumber: 3 }),
    ]);
    expect(read!.map((entry) => entry.questionKey)).toEqual(["q1", "q3"]);
    expect(read![0]!.explanation).toBe("Тело — расстояние между открытием и закрытием.");
  });

  it("never carries an answer key through, whatever the payload held", () => {
    const read = readAssessmentReview([item({ correctAnswer: { code: "b" }, correctOptionCodes: ["b"], selected: "a" })]);
    expect(Object.keys(read![0]!).sort()).toEqual(["explanation", "questionKey", "questionNumber", "rewatchFromSeconds"]);
  });

  it("assessmentResultData normalises the review of a graded result", () => {
    const graded = assessmentResultData({
      data: {
        created: true, status: "failed", passed: false, attemptNumber: 1, submittedAt: "t", durationSeconds: 3,
        totalQuestions: 4, correctCount: 3, scoreBasisPoints: 7500, completion: null,
        review: [item({ rewatchFromSeconds: "soon" })],
      },
    });
    expect(graded.review).toEqual([item({ rewatchFromSeconds: null })]);
    // An older Backend sends no `review` at all.
    const old = assessmentResultData({
      data: { created: true, status: "failed", passed: false, attemptNumber: 1, submittedAt: "t", durationSeconds: 3, totalQuestions: 4, correctCount: 3, scoreBasisPoints: 7500, completion: null },
    });
    expect(old.review).toBeNull();
  });
});
