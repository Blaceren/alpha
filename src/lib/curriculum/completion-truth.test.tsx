import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMPLETION_METHOD_LABEL,
  completionMethodLabel,
  mapCompletionMethod,
  type AcademyCompletionMethod,
  type BackendCompletionMethod,
} from "@/lib/curriculum/completion-method";
import { COMPLETION_SOURCE_LABEL, completionSourceLabel } from "@/lib/curriculum/completion-source";
import { mapLevelType, type BackendLevelType } from "@/lib/curriculum/level-type";

/**
 * ATA-COMPLETION-TRUTH-1B — the label follows the METHOD, never the type.
 *
 * A level's type says what shape of work it is; its completion method says how
 * it actually closes. Those are two different things, and the screen used to
 * derive one from the other: `report_approval` and `mentor_review` both live on
 * report-shaped work, so L3 — whose method is `report_approval` — told the
 * learner a mentor decides it.
 *
 * The fourth row of the matrix below is the one that matters: a report-shaped
 * level whose method is `mentor_review` must read «Проверка ментором». If the
 * label were still type-derived that row would pass by accident, so it is paired
 * with the first row, which fails the moment anyone reintroduces the shortcut.
 */

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const DETAIL = "src/features/academy-experience/level-detail-screen.tsx";
const HOME = "src/features/academy-experience/home-screen.tsx";
const API = "src/features/curriculum-api/api-level-detail.tsx";
const METHOD = "src/lib/curriculum/completion-method.ts";

/**
 * Every completion method the published programme actually uses, read off the
 * curriculum on 2026-08-31: assessment_pass ×58, balance_check ×20, manual ×13,
 * mentor_review ×7, report_approval ×1, pocket_postback ×1. Six, not three.
 */
const REAL_METHODS: ReadonlyArray<[BackendCompletionMethod, AcademyCompletionMethod, string]> = [
  ["assessment_pass", "assessment", "Проверка знаний"],
  ["balance_check", "checkpoint", "Контрольная точка"],
  ["manual", "manual", "Самостоятельно"],
  ["mentor_review", "mentor-review", "Проверка ментором"],
  ["report_approval", "report", "Одобрение отчёта"],
  ["pocket_postback", "external-event", "Внешнее событие"],
];

describe("completion method — the truth matrix", () => {
  it("labels every method the published programme really uses", () => {
    for (const [raw, normalised, label] of REAL_METHODS) {
      expect(mapCompletionMethod(raw), raw).toBe(normalised);
      expect(completionMethodLabel(normalised), raw).toBe(label);
    }
  });

  it("labels a report-shaped level by its method, not its shape", () => {
    // Row 1 and row 4 of the matrix, together. Same level type, two methods,
    // two labels — the pair a type-derived label cannot satisfy.
    expect(completionMethodLabel(mapCompletionMethod("report_approval"))).toBe("Одобрение отчёта");
    expect(completionMethodLabel(mapCompletionMethod("mentor_review"))).toBe("Проверка ментором");
    expect(completionMethodLabel(mapCompletionMethod("report_approval"))).not.toBe(
      completionMethodLabel(mapCompletionMethod("mentor_review")),
    );
  });

  it("names the two methods of the 30-level program, and neither borrows a mentor", () => {
    // `lesson:lesson` — a lesson with no test; `report:formal_check` — a report
    // the platform accepts by itself. Both had fallen to «Не определён».
    expect(mapCompletionMethod("lesson")).toBe("lesson");
    expect(mapCompletionMethod("formal_check")).toBe("formal-report");
    expect(completionMethodLabel(mapCompletionMethod("lesson"))).toBe("Просмотр урока");
    const formal = completionMethodLabel(mapCompletionMethod("formal_check"));
    expect(formal).toBe("Отчёт, проверка автоматическая");
    expect(formal).not.toMatch(/ментор|наставник/i);
    expect(formal).not.toBe(completionMethodLabel(mapCompletionMethod("report_approval")));
  });

  it("fails closed on an unknown method, and never guesses from the type", () => {
    expect(mapCompletionMethod("some_future_method")).toBe("unsupported");
    expect(completionMethodLabel("some_future_method")).toBe(COMPLETION_METHOD_LABEL.unsupported);
    expect(completionMethodLabel("some_future_method")).not.toBe("Проверка ментором");
    expect(completionMethodLabel("some_future_method")).not.toContain("some_future_method");
  });

  it("fails closed on null and undefined", () => {
    for (const value of [null, undefined]) {
      expect(completionMethodLabel(value)).toBe(COMPLETION_METHOD_LABEL.unsupported);
      expect(completionMethodLabel(value).trim().length).toBeGreaterThan(0);
    }
  });

  it("covers the method vocabulary exhaustively, with no machine value showing", () => {
    const methods: AcademyCompletionMethod[] = [
      "external-event", "assessment", "report", "formal-report", "checkpoint",
      "manual", "lesson", "mentor-review", "unsupported",
    ];
    expect(Object.keys(COMPLETION_METHOD_LABEL).sort()).toEqual([...methods].sort());
    for (const m of methods) {
      const label = COMPLETION_METHOD_LABEL[m];
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).not.toBe(m);
      expect(label).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });
});

/**
 * The published curriculum as it actually stands (CurriculumVersion status
 * `published`, 100 levels, read as aggregate counts on 2026-08-31). Each row is
 * a (backend type, completion method) pair that really occurs, with how many
 * levels carry it.
 *
 * The `lesson` rows are the reason this phase exists: one level TYPE, two
 * different completion methods. Any rule that reads the type cannot tell 58
 * levels that close on a passed assessment apart from 13 that the learner
 * closes alone — it must call them the same thing, and it did.
 */
const PUBLISHED: ReadonlyArray<[BackendLevelType, BackendCompletionMethod, number]> = [
  ["external_event", "pocket_postback", 1],
  ["financial_checkpoint", "balance_check", 20],
  ["lesson", "assessment_pass", 58],
  ["lesson", "manual", 13],
  ["mentor_review", "mentor_review", 7],
  ["report", "report_approval", 1],
];

/** The rule this phase replaced: level type -> source -> label. */
const TYPE_SOURCE: Record<string, string> = {
  external: "external_event",
  checkpoint: "financial_checkpoint",
  report: "mentor_review",
  "mentor-review": "mentor_review",
  lesson: "self",
  scenario: "self",
  practice: "self",
  "final-exam": "final_exam",
  unsupported: "unknown",
};
const oldLabel = (backendType: BackendLevelType) =>
  completionSourceLabel(TYPE_SOURCE[mapLevelType(backendType).type]);

describe("against the published curriculum", () => {
  it("covers all 100 published levels with no fallback", () => {
    expect(PUBLISHED.reduce((n, [, , c]) => n + c, 0)).toBe(100);
    for (const [, method] of PUBLISHED) {
      expect(mapCompletionMethod(method), method).not.toBe("unsupported");
      expect(completionMethodLabel(mapCompletionMethod(method)), method).not.toBe(
        COMPLETION_METHOD_LABEL.unsupported,
      );
    }
  });

  it("corrects exactly the 59 levels the old rule described wrongly", () => {
    const changed = PUBLISHED.filter(
      ([t, m]) => oldLabel(t) !== completionMethodLabel(mapCompletionMethod(m)),
    );
    // 58 lessons that in fact require a passed assessment, and the one report.
    expect(changed.map(([t, m]) => `${t}/${m}`)).toEqual([
      "lesson/assessment_pass",
      "report/report_approval",
    ]);
    expect(changed.reduce((n, [, , c]) => n + c, 0)).toBe(59);
  });

  it("says what those 59 levels used to say, and what they say now", () => {
    // 58 levels closed by a graded assessment were called self-completed.
    expect(oldLabel("lesson")).toBe("Самостоятельно");
    expect(completionMethodLabel(mapCompletionMethod("assessment_pass"))).toBe("Проверка знаний");
    // The one report level named the wrong decider.
    expect(oldLabel("report")).toBe("Проверка ментором");
    expect(completionMethodLabel(mapCompletionMethod("report_approval"))).toBe("Одобрение отчёта");
  });

  it("leaves the 41 levels the old rule already described correctly untouched", () => {
    for (const [t, m] of PUBLISHED.filter(([tt, mm]) =>
      oldLabel(tt) === completionMethodLabel(mapCompletionMethod(mm)),
    )) {
      expect(completionMethodLabel(mapCompletionMethod(m)), `${t}/${m}`).toBe(oldLabel(t));
    }
    expect(
      PUBLISHED.filter(([t, m]) => oldLabel(t) === completionMethodLabel(mapCompletionMethod(m)))
        .reduce((n, [, , c]) => n + c, 0),
    ).toBe(41);
  });
});

describe("method and source stay separate things", () => {
  it("leaves the level-type source map and its labels untouched", () => {
    // `CompletionSource` describes how a level is CLASSIFIED, not how it closes.
    // This phase added a vocabulary beside it and renamed nothing.
    expect(COMPLETION_SOURCE_LABEL.mentor_review).toBe("Проверка ментором");
    expect(COMPLETION_SOURCE_LABEL.external_event).toBe("Внешнее событие");
    expect(COMPLETION_SOURCE_LABEL).not.toHaveProperty("report_approval");
    expect(COMPLETION_SOURCE_LABEL).not.toHaveProperty("assessment_pass");
  });

  it("never derives a learner-facing method label from the level type", () => {
    for (const f of [DETAIL, HOME, API]) {
      const s = src(f);
      expect(s, `${f} must not read the type for a completion label`).not.toMatch(
        /completionMethodLabel\(\s*summary\.typeInfo/,
      );
      expect(s).not.toMatch(/COMPLETION_SOURCE\[/);
    }
  });
});

describe("one dictionary, three surfaces", () => {
  it("defines the labels in exactly one module", () => {
    expect(src(METHOD)).toContain("export const COMPLETION_METHOD_LABEL");
    for (const f of [DETAIL, HOME, API]) {
      const s = src(f);
      // A consumer may CALL the helper; it may not restate the vocabulary.
      expect(s, `${f} duplicates the dictionary`).not.toContain("COMPLETION_METHOD_LABEL");
      for (const label of ["Одобрение отчёта", "Проверка знаний"]) {
        expect(s, `${f} hardcodes "${label}"`).not.toContain(label);
      }
    }
  });

  it("binds all three consumers to the same helper", () => {
    /* Lesson hi-fi (DD-336): the level page no longer prints the label in a
       table; it reads the method as a fact under the title — from the SAME
       module, through its second, learner-worded dictionary. */
    expect(src(DETAIL)).toContain("completionMethodFact(summary.completionMethod)");
    expect(src(DETAIL)).toMatch(/import \{[^}]*completionMethodFact[^}]*\} from "@\/lib\/curriculum\/completion-method"/);
    expect(src(API)).toContain("completionMethodLabel(summary.completionMethod)");
    expect(src(HOME)).toContain("completionMethodLabel(level.completionMethod)");
    for (const f of [HOME, API]) {
      expect(src(f)).toMatch(/import \{[^}]*completionMethodLabel[^}]*\} from "@\/lib\/curriculum\/completion-method"/);
    }
    // The page restates neither vocabulary.
    expect(src(DETAIL)).not.toContain("COMPLETION_METHOD_FACT");
    expect(src(DETAIL)).not.toContain("тест после урока");
  });

  it("leaves no surface still rendering the type-derived label", () => {
    for (const f of [DETAIL, HOME, API]) {
      expect(src(f), `${f} still renders completionSourceLabel`).not.toContain(
        "completionSourceLabel",
      );
    }
  });
});

describe("XP is a secondary metric", () => {
  /* Lesson hi-fi (DD-336): the table of parameters is gone. XP is one fact in
     the line under the title — after the video's length and the method, never
     leading. Since 2026-10-06 (DD-348, owner: «сделать подсвечивание +xp») it
     is the one lit chip of that line; the line's other facts stay quiet. */
  const detail = src(DETAIL);
  const factsAt = detail.indexOf("export function levelFacts");
  const facts = detail.slice(factsAt, detail.indexOf("\n}\n", factsAt));

  it("is out of any row of leading parameters: there is no such row", () => {
    expect(factsAt, "levelFacts is missing").toBeGreaterThan(-1);
    expect(detail).not.toContain('<dl className="ax-lvlmeta">');
    // The method comes before it in the line.
    expect(facts.indexOf("completionMethodFact(summary")).toBeLessThan(facts.indexOf("summary.xpReward > 0"));
  });

  it("is still shown, as the server's value, only when there is any", () => {
    expect(facts).toMatch(/if \(summary\.xpReward > 0\) facts\.push\(`\+\$\{summary\.xpReward\} XP`\);/);
  });

  it("keeps the server value and appears exactly once", () => {
    expect((detail.match(/ XP`/g) ?? []).length).toBe(1);
    // Never a literal: the number belongs to Backend.
    expect(detail).not.toMatch(/\+500 XP/);
    expect(detail).not.toMatch(/xpReward\s*=\s*\d/);
  });

  it("leaves the line's other facts without Signal, frame, icon or animation", () => {
    const css = src("src/features/level-detail-fidelity/level-hifi.css");
    const at = css.indexOf(".ld.ld--hifi .ld-fact {");
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).not.toMatch(/signal|border|anim|icon/i);
  });

  it("is lit — the owner's request of 2026-10-06 (DD-348): a Signal chip, no animation", () => {
    const css = src("src/features/level-detail-fidelity/level-hifi.css");
    const at = css.indexOf(".ld.ld--hifi .ld-fact--xp {");
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toMatch(/var\(--signal\)/);
    expect(rule).not.toMatch(/anim/i);
    // The markup marks exactly the XP fact (and, since 2026-10-07, the video's length, which a phone hides).
    expect(detail).toMatch(/fact\.endsWith\(" XP"\)\s*\?\s*"ld-fact ld-fact--xp"/);
  });

  it("the video's length is not said in the header on a phone or a tablet — the player shows it (owner 2026-10-07)", () => {
    expect(detail).toMatch(/fact\.startsWith\("видео "\)\s*\?\s*"ld-fact ld-fact--video"/);
    const css = src("src/features/level-detail-fidelity/level-hifi.css");
    expect(css).toMatch(/@media \(max-width: 899px\) \{\s*\.ld\.ld--hifi \.ld-fact--video \{\s*display: none;/);
    // The desktop keeps it: no rule outside that block hides it.
    expect(css.match(/\.ld-fact--video/g)?.length).toBe(1);
  });
});


describe("the lesson header shares one corner (DD-350, owner 2026-10-06: «одинаковые углы закругления»)", () => {
  const css = src("src/features/level-detail-fidelity/level-hifi.css");
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("the plate and the rail: the same radius", () => {
    expect(rule(".ld.ld--hifi .ld-plate")).toContain("border-radius: var(--hf-radius-window)");
    expect(rule(".ld.ld--hifi .ax-lvlhead > .ld-facts")).toContain("border-radius: var(--hf-radius-window)");
  });

  it("the state mark and the XP chip inside it: one smaller radius", () => {
    expect(rule(".ld.ld--hifi .ld-fact--xp")).toContain("border-radius: 8px");
    expect(rule(".ld.ld--hifi .ax-lvlhead > .ld-facts .ax-mark")).toContain("border-radius: 8px");
  });
});
