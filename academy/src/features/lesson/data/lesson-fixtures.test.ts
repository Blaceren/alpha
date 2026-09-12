import { describe, it, expect } from "vitest";
import { getLevel, getModuleForLevel } from "@/data/curriculum/fixture";
import {
  ASSESSMENT_UNLOCK_PERCENT,
  CURRENT_LESSON_LEVEL,
  getLesson,
  getLessonEntry,
} from "@/features/lesson/data/lesson-fixtures";
import { formatDuration, levelCodeFor, parseLevelCode } from "@/features/lesson/model/lesson";

const lesson = getLesson(18);

describe("the lesson fixture agrees with the curriculum canon", () => {
  it("mirrors level 18 exactly — the curriculum stays the source of structure", () => {
    const level = getLevel(18);
    expect(lesson.level).toBe(level);
    expect(lesson.code).toBe("level.018");
    expect(lesson.level.number).toBe(18);
    expect(lesson.level.title).toBe("Поддержка и сопротивление");
    expect(lesson.level.kind).toBe("video-test");
  });

  it("sits in module 4 «Чтение графика», matching Home and Путь", () => {
    const mod = getModuleForLevel(18);
    expect(mod.index).toBe(4);
    expect(mod.title).toBe("Чтение графика");
    expect(lesson.level.moduleCode).toBe("module.04");
  });

  it("keeps the curriculum sequence: 17 before, 19 after, checkpoint at 20", () => {
    expect(getLevel(17).title).toBe("Тренд и диапазон");
    expect(getLevel(19).title).toBe("Разметка графика");
    expect(getLevel(20).kind).toBe("checkpoint");
    expect(CURRENT_LESSON_LEVEL).toBe(18);
  });

  it("does not attach a report or mentor review to level 18", () => {
    expect(lesson.level.artifact).toBeUndefined();
    expect(lesson.level.mentorReview).toBe(false);
  });
});

describe("assessment integrity", () => {
  it("has 4–5 questions", () => {
    expect(lesson.assessment.questions.length).toBeGreaterThanOrEqual(4);
    expect(lesson.assessment.questions.length).toBeLessThanOrEqual(5);
  });

  it("gives every question a unique stable id", () => {
    const ids = lesson.assessment.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every option a unique id across the whole assessment", () => {
    const ids = lesson.assessment.questions.flatMap((q) => q.options.map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has exactly one correct option per question", () => {
    for (const q of lesson.assessment.questions) {
      expect(q.options.filter((o) => o.correct)).toHaveLength(1);
    }
  });

  it("offers a real choice — at least three options per question", () => {
    for (const q of lesson.assessment.questions) {
      expect(q.options.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("explains both outcomes of every question", () => {
    for (const q of lesson.assessment.questions) {
      expect(q.feedback.correct.length).toBeGreaterThan(20);
      expect(q.feedback.incorrect.length).toBeGreaterThan(20);
    }
  });

  it("makes every question required — there is no passing score", () => {
    expect(lesson.assessment.questions.every((q) => q.required)).toBe(true);
    expect(lesson.completionRule.requiresAllRequiredQuestionsCorrect).toBe(true);
  });

  it("uses single choice only in D2B", () => {
    expect(lesson.assessment.questions.every((q) => q.kind === "single-choice")).toBe(true);
  });

  it("never names the correct option in the incorrect explanation", () => {
    for (const q of lesson.assessment.questions) {
      const correctText = q.options.find((o) => o.correct)!.text;
      expect(q.feedback.incorrect).not.toContain(correctText);
    }
  });
});

describe("the completion rule", () => {
  it("unlocks at the canonical 50% and never demands a full watch", () => {
    expect(ASSESSMENT_UNLOCK_PERCENT).toBe(50);
    expect(lesson.completionRule.unlockWatchPercent).toBe(50);
    expect(lesson.completionRule.requiresFullWatch).toBe(false);
  });

  it("is marked provisional — it is a frontend rule, not a backend contract", () => {
    expect(lesson.completionRule.provisional).toBe(true);
  });
});

describe("content safety", () => {
  const allText = [
    lesson.goal,
    ...lesson.outcomes.map((o) => o.text),
    ...lesson.sections.flatMap((s) => [s.title, s.body]),
    ...lesson.requirements.map((r) => r.label),
    ...lesson.assessment.questions.flatMap((q) => [
      q.prompt,
      q.feedback.correct,
      q.feedback.incorrect,
      ...q.options.map((o) => o.text),
    ]),
  ].join(" ");

  it("never mentions money, deposits or earnings", () => {
    for (const banned of ["прибыл", "депозит", "пополн", "заработ", "доход", "TradeQuest", "lorem"]) {
      expect(allText.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("only ever mentions a guarantee in order to deny it", () => {
    // The lesson teaches that a level guarantees nothing, so the root is allowed —
    // but only negated. An unnegated "гарантирует" would be a promise.
    expect(allText).toMatch(/не гарантир/i);
    expect(allText).not.toMatch(/(?<!не )гарантир/i);
  });

  it("gives no buy/sell signal and no personal recommendation", () => {
    expect(allText).not.toMatch(/\bкупить сейчас\b/i);
    expect(allText).not.toMatch(/\bпродавай\b/i);
    expect(allText).not.toMatch(/\bоткрой сделку\b/i);
  });

  it("carries no fabricated market data — no prices, no instruments", () => {
    expect(allText).not.toMatch(/\d+[.,]\d{4}/); // quote-like numbers
    expect(allText).not.toMatch(/EUR\/USD|BTC|\$\d/);
  });

  it("is flagged as provisional development content", () => {
    expect(lesson.contentProvisional).toBe(true);
    expect(lesson.media.kind).toBe("simulated");
  });

  it("points at no external media URL", () => {
    expect(JSON.stringify(lesson.media)).not.toMatch(/https?:\/\//);
  });
});

describe("lesson resolution", () => {
  it("resolves level 18 as a fully authored lesson", () => {
    expect(getLessonEntry(18)).toEqual({ kind: "full", lesson });
  });

  it("resolves level 19 as a stub only — no lesson body is invented for it", () => {
    const entry = getLessonEntry(19);
    expect(entry?.kind).toBe("stub");
    if (entry?.kind === "stub") {
      expect(entry.stub.level.number).toBe(19);
      expect(entry.stub.level.kind).toBe("practical");
      expect(entry.stub.note).toContain("Практические уровни");
    }
  });

  it("authors no other lesson — D2B builds the experience, not the course", () => {
    expect(getLessonEntry(1)).toBeNull();
    expect(getLessonEntry(20)).toBeNull();
    expect(getLessonEntry(100)).toBeNull();
    expect(() => getLesson(19)).toThrow();
  });
});

describe("level codes", () => {
  it("formats and parses the canonical route segment", () => {
    expect(levelCodeFor(18)).toBe("level.018");
    expect(levelCodeFor(1)).toBe("level.001");
    expect(levelCodeFor(100)).toBe("level.100");
    expect(parseLevelCode("level.018")).toBe(18);
    expect(parseLevelCode("level.001")).toBe(1);
  });

  it("rejects anything that is not a canonical level code", () => {
    for (const bad of ["18", "level.18", "level.000", "level.101", "level.abc", "", "../etc", undefined, 18, null]) {
      expect(parseLevelCode(bad)).toBeNull();
    }
  });
});

describe("duration formatting", () => {
  it("renders minutes and seconds deterministically", () => {
    expect(formatDuration(480)).toBe("8:00");
    expect(formatDuration(240)).toBe("4:00");
    expect(formatDuration(95)).toBe("1:35");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("puts the assessment gate at 4:00 of the 8:00 media", () => {
    expect(formatDuration(lesson.media.durationSeconds)).toBe("8:00");
    expect(formatDuration((lesson.media.durationSeconds * ASSESSMENT_UNLOCK_PERCENT) / 100)).toBe("4:00");
  });
});
