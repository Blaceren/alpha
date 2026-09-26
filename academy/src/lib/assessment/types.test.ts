import { describe, it, expect } from "vitest";
import {
  isAssessmentResult,
  isAssessmentStart,
  assessmentStartData,
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
