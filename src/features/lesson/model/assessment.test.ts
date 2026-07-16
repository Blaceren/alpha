import { describe, it, expect } from "vitest";
import {
  allRequiredAnswered,
  assessmentState,
  canAdvance,
  createAssessmentProgress,
  correctOptionId,
  currentQuestion,
  isSubmittedAnswerCorrect,
  next,
  questionPosition,
  retry,
  select,
  start,
  submit,
} from "@/features/lesson/model/assessment";
import { getLesson } from "@/features/lesson/data/lesson-fixtures";

const lesson = getLesson(18);
const A = lesson.assessment;

const wrongOptionId = (index: number) => {
  const q = A.questions[index]!;
  return q.options.find((o) => !o.correct)!.id;
};
const rightOptionId = (index: number) => correctOptionId(A.questions[index]!);

/** Open the assessment and answer question `index` correctly. */
function answerCorrectly(progress = start(createAssessmentProgress(), true), index = 0) {
  return submit(A, select(progress, rightOptionId(index)), true);
}

describe("assessment gating", () => {
  it("is locked while the watch gate is closed, whatever the progress says", () => {
    expect(assessmentState(A, createAssessmentProgress(), false)).toBe("locked");
    expect(assessmentState(A, createAssessmentProgress({ started: true }), false)).toBe("locked");
  });

  it("cannot be started while locked", () => {
    const progress = createAssessmentProgress();
    expect(start(progress, false)).toBe(progress);
    expect(start(progress, false).started).toBe(false);
  });

  it("is ready once unlocked, and answering once started", () => {
    expect(assessmentState(A, createAssessmentProgress(), true)).toBe("ready");
    expect(assessmentState(A, start(createAssessmentProgress(), true), true)).toBe("answering");
  });

  it("rejects a submit while locked", () => {
    const progress = select(start(createAssessmentProgress(), true), rightOptionId(0));
    expect(submit(A, progress, false)).toBe(progress);
  });
});

describe("one question at a time", () => {
  it("shows the first question first, in fixture order", () => {
    const progress = createAssessmentProgress();
    expect(currentQuestion(A, progress).id).toBe(A.questions[0]!.id);
    expect(questionPosition(A, progress)).toEqual({ position: 1, total: A.questions.length });
  });

  it("keeps question order deterministic across reads", () => {
    const first = A.questions.map((q) => q.id);
    const second = getLesson(18).assessment.questions.map((q) => q.id);
    expect(second).toEqual(first);
  });

  it("cannot advance before answering", () => {
    const progress = start(createAssessmentProgress(), true);
    expect(canAdvance(A, progress)).toBe(false);
    expect(next(A, progress)).toBe(progress);
    expect(next(A, progress).currentIndex).toBe(0);
  });

  it("cannot advance on an incorrect answer — the question stays open", () => {
    const progress = submit(A, select(start(createAssessmentProgress(), true), wrongOptionId(0)), true);
    expect(canAdvance(A, progress)).toBe(false);
    expect(next(A, progress).currentIndex).toBe(0);
  });

  it("advances only after a correct answer, and resets the new question", () => {
    const answered = answerCorrectly();
    expect(canAdvance(A, answered)).toBe(true);

    const second = next(A, answered);
    expect(second.currentIndex).toBe(1);
    expect(second.selectedOptionId).toBeNull();
    expect(second.submittedOptionId).toBeNull();
    expect(questionPosition(A, second).position).toBe(2);
  });

  it("does not run past the last question", () => {
    let progress = start(createAssessmentProgress(), true);
    for (let i = 0; i < A.questions.length; i += 1) {
      progress = submit(A, select(progress, rightOptionId(i)), true);
      progress = next(A, progress);
    }
    expect(progress.currentIndex).toBe(A.questions.length - 1);
  });
});

describe("submitting", () => {
  it("does not fail silently with nothing selected", () => {
    const progress = submit(A, start(createAssessmentProgress(), true), true);
    expect(progress.submitAttemptedWithoutSelection).toBe(true);
    expect(progress.submittedOptionId).toBeNull();
    expect(assessmentState(A, progress, true)).toBe("answering");
  });

  it("clears the missing-selection notice once an option is chosen", () => {
    const attempted = submit(A, start(createAssessmentProgress(), true), true);
    expect(select(attempted, rightOptionId(0)).submitAttemptedWithoutSelection).toBe(false);
  });

  it("does not reveal correctness before submit", () => {
    const selected = select(start(createAssessmentProgress(), true), rightOptionId(0));
    expect(selected.submittedOptionId).toBeNull();
    expect(isSubmittedAnswerCorrect(A, selected)).toBeNull();
  });

  it("settles the answer — selecting again after submit does nothing", () => {
    const answered = answerCorrectly();
    expect(select(answered, wrongOptionId(0))).toBe(answered);
  });

  it("ignores a second submit for the same question", () => {
    const answered = answerCorrectly();
    expect(submit(A, answered, true)).toBe(answered);
  });

  it("reports correct and incorrect submissions", () => {
    expect(isSubmittedAnswerCorrect(A, answerCorrectly())).toBe(true);
    const wrong = submit(A, select(start(createAssessmentProgress(), true), wrongOptionId(0)), true);
    expect(isSubmittedAnswerCorrect(A, wrong)).toBe(false);
    expect(assessmentState(A, wrong, true)).toBe("feedback_incorrect");
  });
});

describe("an incorrect answer costs nothing", () => {
  it("does not record the question as answered", () => {
    const wrong = submit(A, select(start(createAssessmentProgress(), true), wrongOptionId(0)), true);
    expect(wrong.answeredCorrectly).toEqual([]);
    expect(allRequiredAnswered(A, wrong)).toBe(false);
  });

  it("retry reopens the same question with a clean selection", () => {
    const wrong = submit(A, select(start(createAssessmentProgress(), true), wrongOptionId(0)), true);
    const again = retry(A, wrong);
    expect(again.currentIndex).toBe(0);
    expect(again.submittedOptionId).toBeNull();
    expect(again.selectedOptionId).toBeNull();
    expect(assessmentState(A, again, true)).toBe("answering");
  });

  it("allows an unlimited number of retries and still credits a later correct answer", () => {
    let progress = start(createAssessmentProgress(), true);
    for (let i = 0; i < 5; i += 1) {
      progress = retry(A, submit(A, select(progress, wrongOptionId(0)), true));
    }
    progress = submit(A, select(progress, rightOptionId(0)), true);
    expect(progress.answeredCorrectly).toEqual([A.questions[0]!.id]);
  });

  it("does not retry a correct answer away", () => {
    const answered = answerCorrectly();
    expect(retry(A, answered)).toBe(answered);
  });
});

describe("completion", () => {
  it("needs every required question, not a passing score", () => {
    let progress = start(createAssessmentProgress(), true);
    for (let i = 0; i < A.questions.length - 1; i += 1) {
      progress = next(A, submit(A, select(progress, rightOptionId(i)), true));
      expect(allRequiredAnswered(A, progress)).toBe(false);
    }
    progress = submit(A, select(progress, rightOptionId(A.questions.length - 1)), true);
    expect(allRequiredAnswered(A, progress)).toBe(true);
    expect(assessmentState(A, progress, true)).toBe("completed");
  });

  it("does not record a question twice", () => {
    const answered = answerCorrectly();
    const resubmitted = submit(A, answered, true);
    expect(resubmitted.answeredCorrectly).toEqual([A.questions[0]!.id]);
  });

  it("is not completed by watching alone", () => {
    expect(allRequiredAnswered(A, createAssessmentProgress())).toBe(false);
    expect(assessmentState(A, createAssessmentProgress(), true)).toBe("ready");
  });
});
