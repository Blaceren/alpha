import { describe, it, expect } from "vitest";
import { getLesson } from "@/features/lesson/data/lesson-fixtures";
import {
  assessmentStateLabel,
  createLessonSession,
  deriveLessonExperience,
  lessonAvailability,
  lessonStateLabel,
  lockedLessonReason,
  type LessonSession,
} from "@/features/lesson/model/lesson-state-machine";
import { stateAtVerifiedPercent } from "@/features/lesson/model/lesson-progress";
import { correctOptionId, createAssessmentProgress } from "@/features/lesson/model/assessment";
import {
  resolveLessonScenario,
  scenarioProgress,
  scenarioSession,
  type LessonScenario,
} from "@/features/lesson/model/lesson-scenarios";
import { getPathProgress } from "@/features/path/model/path-state";

const lesson = getLesson(18);
const AT_18 = getPathProgress("active"); // Артём on level 18
const AT_19 = { ...AT_18, currentLevel: 19 };

const sessionAt = (percent: number, assessment = createAssessmentProgress()): LessonSession => ({
  media: stateAtVerifiedPercent(lesson.media.durationSeconds, percent),
  assessment,
});

/** Every question answered correctly. */
const finished = createAssessmentProgress({
  started: true,
  currentIndex: lesson.assessment.questions.length - 1,
  answeredCorrectly: lesson.assessment.questions.map((q) => q.id),
  submittedOptionId: correctOptionId(lesson.assessment.questions.at(-1)!),
});

describe("lesson availability", () => {
  it("opens the level the user is on", () => {
    expect(lessonAvailability(18, AT_18)).toBe("available");
  });

  it("marks passed levels completed", () => {
    expect(lessonAvailability(17, AT_18)).toBe("completed");
    expect(lessonAvailability(1, AT_18)).toBe("completed");
  });

  it("locks the next level — being next in line is not an open lesson", () => {
    expect(lessonAvailability(19, AT_18)).toBe("locked");
    expect(lessonAvailability(20, AT_18)).toBe("locked");
    expect(lessonAvailability(85, AT_18)).toBe("locked");
  });

  it("opens level 19 once the marker has advanced past 18", () => {
    expect(lessonAvailability(19, AT_19)).toBe("available");
    expect(lessonAvailability(18, AT_19)).toBe("completed");
  });

  it("counts a lesson finished in this session as completed", () => {
    expect(lessonAvailability(18, AT_18, true)).toBe("completed");
  });

  it("explains a lock by sequence only — never by a financial condition", () => {
    const reason = lockedLessonReason(19, AT_18);
    expect(reason).toContain("уровень 18");
    expect(reason).toContain("Поддержка и сопротивление");
    expect(reason).not.toMatch(/баланс|Pocket|\$|деньг|депозит/i);
  });
});

describe("experience states", () => {
  const derive = (session: LessonSession, progress = AT_18) =>
    deriveLessonExperience(lesson, session, progress);

  it("starts available, with the test locked and nothing watched", () => {
    const e = derive(createLessonSession(lesson));
    expect(e.state).toBe("available");
    expect(e.watchPercent).toBe(0);
    expect(e.testUnlocked).toBe(false);
    expect(e.assessment).toBe("locked");
    expect(e.lessonComplete).toBe(false);
  });

  it("moves to watching once any verified progress exists", () => {
    expect(derive(sessionAt(25)).state).toBe("watching");
    expect(derive(sessionAt(25)).mediaProgress).toBe("watching");
  });

  it("keeps the test locked at 49%", () => {
    const e = derive(sessionAt(49));
    expect(e.state).toBe("watching");
    expect(e.testUnlocked).toBe(false);
    expect(e.assessment).toBe("locked");
  });

  it("unlocks the test at exactly 50% without completing the lesson", () => {
    const e = derive(sessionAt(50));
    expect(e.state).toBe("test_unlocked");
    expect(e.testUnlocked).toBe(true);
    expect(e.assessment).toBe("ready");
    expect(e.lessonComplete).toBe(false);
  });

  it("watching 100% still does not complete the lesson", () => {
    const e = derive(sessionAt(100));
    expect(e.watchPercent).toBe(100);
    expect(e.lessonComplete).toBe(false);
    expect(e.state).toBe("test_unlocked");
  });

  it("moves to testing once the assessment is opened", () => {
    const e = derive(sessionAt(60, createAssessmentProgress({ started: true })));
    expect(e.state).toBe("testing");
    expect(e.assessment).toBe("answering");
  });

  it("completes only with both the watch gate and every question", () => {
    const e = derive(sessionAt(60, finished));
    expect(e.state).toBe("completed");
    expect(e.lessonComplete).toBe(true);
    expect(e.availability).toBe("completed");
  });

  it("does not complete on questions alone if the gate somehow was not passed", () => {
    const e = derive(sessionAt(10, finished));
    expect(e.testUnlocked).toBe(false);
    expect(e.lessonComplete).toBe(false);
    expect(e.assessment).toBe("locked");
  });

  it("reports locked for a level the user has not reached", () => {
    const e = deriveLessonExperience(lesson, createLessonSession(lesson), {
      ...AT_18,
      currentLevel: 5,
    });
    expect(e.availability).toBe("locked");
    expect(e.state).toBe("locked");
  });
});

describe("the next-lesson gate", () => {
  it("keeps the next lesson closed until this one is complete", () => {
    for (const percent of [0, 25, 49, 50, 100]) {
      const e = deriveLessonExperience(lesson, sessionAt(percent), AT_18);
      expect(e.nextLessonUnlocked).toBe(false);
    }
  });

  it("opens the next lesson only after completion", () => {
    const e = deriveLessonExperience(lesson, sessionAt(60, finished), AT_18);
    expect(e.nextLessonUnlocked).toBe(true);
    expect(e.nextLevelNumber).toBe(19);
  });

  it("has no next level at the end of the curriculum", () => {
    const last = { ...lesson, level: { ...lesson.level, number: 100 } };
    const e = deriveLessonExperience(last, sessionAt(60, finished), { ...AT_18, currentLevel: 100 });
    expect(e.nextLevelNumber).toBeNull();
    expect(e.nextLessonUnlocked).toBe(false);
  });
});

describe("XP is never invented", () => {
  it("leaves the canonical instrumentation untouched by lesson progress", () => {
    const before = deriveLessonExperience(lesson, createLessonSession(lesson), AT_18);
    const after = deriveLessonExperience(lesson, sessionAt(60, finished), AT_18);
    expect(before.session).not.toHaveProperty("xp");
    expect(after.session).not.toHaveProperty("xp");
    // The shared marker is the only XP source, and completing a lesson never touches it.
    expect(AT_18.xpLabel).toBe("2 480 XP");
    expect(scenarioProgress("completed").xpLabel).toBe("2 480 XP");
    expect(scenarioProgress("initial").xpLabel).toBe(scenarioProgress("completed").xpLabel);
  });
});

describe("labels", () => {
  it("never leaks a raw enum to the user", () => {
    const states = [
      "locked",
      "available",
      "watching",
      "test_unlocked",
      "testing",
      "completed",
    ] as const;
    for (const s of states) {
      const label = lessonStateLabel(s);
      expect(label).not.toContain("_");
      expect(label).toMatch(/[а-яё]/i);
    }
    for (const s of ["locked", "ready", "answering", "feedback_correct", "feedback_incorrect", "completed"] as const) {
      const label = assessmentStateLabel(s);
      expect(label).not.toContain("_");
      expect(label).toMatch(/[а-яё]/i);
    }
  });
});

describe("dev scenarios", () => {
  it("falls back to initial for anything unknown", () => {
    for (const bad of ["nope", "", undefined, null, 42, {}, "INITIAL"]) {
      expect(resolveLessonScenario(bad)).toBe("initial");
    }
  });

  it("resolves every supported scenario", () => {
    const all: LessonScenario[] = [
      "initial",
      "watching",
      "threshold-49",
      "threshold-50",
      "testing",
      "incorrect",
      "completed",
      "locked",
      "unlocked",
    ];
    for (const s of all) expect(resolveLessonScenario(s)).toBe(s);
  });

  it("seeds the exact state each scenario names", () => {
    const at = (s: LessonScenario) =>
      deriveLessonExperience(lesson, scenarioSession(lesson, s), scenarioProgress(s));

    expect(at("initial").state).toBe("available");
    expect(at("watching").state).toBe("watching");

    expect(at("threshold-49").watchPercent).toBe(49);
    expect(at("threshold-49").testUnlocked).toBe(false);

    expect(at("threshold-50").watchPercent).toBe(50);
    expect(at("threshold-50").testUnlocked).toBe(true);

    expect(at("testing").state).toBe("testing");
    expect(at("incorrect").assessment).toBe("feedback_incorrect");
    expect(at("completed").state).toBe("completed");
  });

  it("only the unlocked scenario advances the progress marker", () => {
    expect(scenarioProgress("initial").currentLevel).toBe(18);
    expect(scenarioProgress("completed").currentLevel).toBe(18);
    expect(scenarioProgress("locked").currentLevel).toBe(18);
    expect(scenarioProgress("unlocked").currentLevel).toBe(19);
  });

  it("is deterministic — the same scenario yields the same session every time", () => {
    for (const s of ["initial", "watching", "threshold-50", "incorrect", "completed"] as const) {
      expect(scenarioSession(lesson, s)).toEqual(scenarioSession(lesson, s));
    }
  });

  it("never seeds a scenario past the completion rule by accident", () => {
    for (const s of ["initial", "watching", "threshold-49", "threshold-50", "testing", "incorrect"] as const) {
      expect(deriveLessonExperience(lesson, scenarioSession(lesson, s), scenarioProgress(s)).lessonComplete).toBe(
        false,
      );
    }
  });
});
