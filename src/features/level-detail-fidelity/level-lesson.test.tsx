/**
 * THE LESSON ON THE LEVEL PAGE — what governs this tree (2026-10-02).
 *
 * `navigation-transition.test.ts` used to freeze `src/features/level-detail-
 * fidelity` whole. The 30-level program made the level page a lesson page, and
 * a freeze cannot describe a page that was asked to change. This file is what
 * replaced it, and it holds the properties that must survive the next change:
 *
 *   1. WHICH TEXT IS PRINTED ON THE PAGE. A short lesson text beside a video
 *      is; a reading lesson keeps its own surface. The line is measured.
 *   2. THE TEXT IS TEXT. No control, no link, no injected markup, no progress.
 *   3. THE TOOL BLOCK IS THE BACKEND'S VERDICT. A tool is shown under the level
 *      the verdict attaches it to, and is a link only when the verdict opened it.
 *   4. THE WORDS AROUND «НАЧАТЬ» ARE TRUE OF THE LEVEL. No promise of a test on
 *      a level that has none, and no mentor on a report nobody reviews.
 *   5. THE SHEET STAYS INSIDE THE PAGE. Every rule under `.ld`, the page's own
 *      tokens and breakpoints, nothing forced, and the player restyled nowhere
 *      but in the player.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import type { LessonBlock, LessonBody } from "@/lib/curriculum/lesson-body";
import type { AcademyToolAccess } from "@/lib/curriculum/academy-view";
import type { AcademyCompletionMethod } from "@/lib/curriculum/completion-method";
import {
  INLINE_LESSON_MAX_CHARACTERS,
  INLINE_LESSON_MAX_SECTIONS,
  isInlineLessonBody,
} from "@/features/level-detail-fidelity/level-lesson-shape";
import { LevelLessonText } from "@/features/level-detail-fidelity/level-lesson-text";
import { LevelUnlocks } from "@/features/level-detail-fidelity/level-unlocks";

const HERE = join(process.cwd(), "src/features/level-detail-fidelity");
const read = (file: string) => readFileSync(join(HERE, file), "utf8");

function body(sections: Array<{ code?: string; title?: string; blocks: LessonBlock[] }>): LessonBody {
  return {
    sourceFormat: "blocks_v2",
    sections: sections.map((section, index) => ({
      code: section.code ?? `s${index + 1}`,
      title: section.title ?? `Раздел ${index + 1}`,
      blocks: section.blocks,
    })),
    appendix: [],
  };
}
const prose = (text: string): LessonBlock => ({ type: "rich_text", paragraphs: [text] });

/* The shapes the 30-level program actually publishes. */
const VIDEO_LESSON = body([{ code: "o-chem", title: "О чём урок", blocks: [prose("Свеча — четыре числа за период.")] }]);
const PRACTICE = body([
  { code: "o-chem", title: "О чём урок", blocks: [prose("Ученик пишет план на восемь пунктов.")] },
  {
    code: "zadanie",
    title: "Задание",
    blocks: [
      prose("Написать два документа."),
      { type: "heading", level: 3, text: "Risk Plan · восемь пунктов" },
      { type: "list", ordered: true, items: ["Торговый капитал", "Размер сделки", "Дневной предел"] },
      { type: "callout", variant: "key_idea", title: null, body: "Семь — потолок, не цель." },
    ],
  },
  { code: "tri-proverki", title: "Три проверки руками", blocks: [{ type: "list", ordered: false, items: ["Раз", "Два"] }] },
]);

describe("which lesson text is printed on the level page", () => {
  it("a video lesson's one paragraph, and a practical level's assignment, are", () => {
    expect(isInlineLessonBody(VIDEO_LESSON)).toBe(true);
    expect(isInlineLessonBody(PRACTICE)).toBe(true);
  });

  it("no body, an empty body and a body with a legacy appendix are not", () => {
    expect(isInlineLessonBody(null)).toBe(false);
    expect(isInlineLessonBody(body([]))).toBe(false);
    expect(isInlineLessonBody({ ...VIDEO_LESSON, appendix: [prose("приложение")] })).toBe(false);
  });

  it("a reading lesson — many sections, or a lot of text — keeps its own surface", () => {
    const many = body(Array.from({ length: INLINE_LESSON_MAX_SECTIONS + 1 }, () => ({ blocks: [prose("текст")] })));
    expect(isInlineLessonBody(many)).toBe(false);
    const long = body([{ blocks: [prose("а".repeat(INLINE_LESSON_MAX_CHARACTERS + 1))] }]);
    expect(isInlineLessonBody(long)).toBe(false);
    const justFits = body([{ blocks: [prose("а".repeat(INLINE_LESSON_MAX_CHARACTERS))] }]);
    expect(isInlineLessonBody(justFits)).toBe(true);
  });

  it("anything richer than prose, a sub-heading, a list, a callout or a rule keeps its own surface", () => {
    const rich: LessonBlock[] = [
      { type: "table", caption: null, headers: ["a"], rows: [["1"]] },
      { type: "example", title: "Пример", body: "текст" },
      { type: "common_mistake", mistake: "так", correction: "иначе" },
      { type: "glossary", entries: [{ term: "t", definition: "d" }] },
      { type: "exercise", code: "e1", title: "Задание", instructions: "i", expectedAction: "a", estimatedMinutes: null },
      { type: "tool_link", toolCode: "tool.trade_card", label: "Открыть", context: null },
      { type: "cta", action: "next_level", label: "Дальше", body: null, toolCode: null },
      { type: "image", asset: { url: "https://x.example/a.png", mimeType: "image/png", sizeBytes: null, durationSeconds: null }, alt: "a", caption: null },
    ];
    for (const block of rich) {
      expect(isInlineLessonBody(body([{ blocks: [prose("текст"), block] }])), block.type).toBe(false);
    }
    expect(isInlineLessonBody(body([{ blocks: [prose("текст"), { type: "divider" }] }]))).toBe(true);
  });
});

describe("the lesson text on the page is text", () => {
  it("prints every section under its own heading, in order", () => {
    render(<LevelLessonText body={PRACTICE} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "О чём урок",
      "Задание",
      "Три проверки руками",
    ]);
    expect(screen.getByRole("heading", { level: 4, name: "Risk Plan · восемь пунктов" })).toBeInTheDocument();
  });

  it("keeps an author's numbered list numbered, and a plain list plain", () => {
    const { container } = render(<LevelLessonText body={PRACTICE} />);
    const ordered = container.querySelector("ol.ld-text__list")!;
    expect(within(ordered as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Торговый капитал",
      "Размер сделки",
      "Дневной предел",
    ]);
    expect(container.querySelector("ul.ld-text__list")).not.toBeNull();
    // …and the sheet gives them their markers back from the product's reset.
    const css = read("level-lesson.css");
    expect(css).toMatch(/\.ld ol\.ld-text__list\s*\{\s*list-style:\s*decimal/);
    expect(css).toMatch(/\.ld ul\.ld-text__list\s*\{\s*list-style:\s*disc/);
  });

  it("labels a callout by its kind when the author gave it no title", () => {
    render(<LevelLessonText body={PRACTICE} />);
    expect(screen.getByText("Ключевая мысль")).toBeInTheDocument();
    expect(screen.getByText("Семь — потолок, не цель.")).toBeInTheDocument();
  });

  it("splits prose on blank lines and prints markup characters as characters", () => {
    const { container } = render(
      <LevelLessonText body={body([{ blocks: [prose("Первый абзац.\n\nВторой <b>абзац</b> & [ссылка](x).")] }])} />,
    );
    const paragraphs = [...container.querySelectorAll(".ld-text__p")].map((p) => p.textContent);
    expect(paragraphs).toEqual(["Первый абзац.", "Второй <b>абзац</b> & [ссылка](x)."]);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("carries no control and reports nothing: no button, link, input or progress mark", () => {
    const { container } = render(<LevelLessonText body={PRACTICE} />);
    expect(container.querySelectorAll("button, a, input, textarea, select, [role=button]").length).toBe(0);
    const source = read("level-lesson-text.tsx");
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toMatch(/"use client"/);
    expect(source).not.toMatch(/fetch\(|useEffect|onClick/);
  });
});

describe("what a level opens is the Backend's verdict", () => {
  const verdict = (tools: AcademyToolAccess["tools"]): AcademyToolAccess => ({
    total: tools.length,
    unlockedCount: tools.filter((t) => t.unlocked).length,
    tools,
  });
  const FUNNEL = verdict([
    { code: "tool.trade_card", unlocked: true, unlockLevel: 5 },
    { code: "tool.trading_journal", unlocked: false, unlockLevel: 9 },
    { code: "tool.risk_calculator", unlocked: false, unlockLevel: 13 },
    { code: "tool.entry_checklist", unlocked: false, unlockLevel: 13 },
  ]);

  it("shows the tool the verdict attaches to this level, and no other", () => {
    render(<LevelUnlocks levelOrder={9} toolAccess={FUNNEL} />);
    expect(screen.getByRole("heading", { name: "Этот уровень открывает инструмент" })).toBeInTheDocument();
    expect(screen.getByText("Trading Journal")).toBeInTheDocument();
    expect(screen.queryByText("Trade Card")).toBeNull();
  });

  it("uses the verdict's level, not the catalogue's memory of another program", () => {
    // The catalogue still says the journal opens after level 10.
    const { container } = render(<LevelUnlocks levelOrder={10} toolAccess={FUNNEL} />);
    expect(container.firstChild).toBeNull();
  });

  it("names both tools of a level that opens two", () => {
    render(<LevelUnlocks levelOrder={13} toolAccess={FUNNEL} />);
    expect(screen.getByRole("heading", { name: "Этот уровень открывает инструменты" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("a tool the verdict has not opened is never a link", () => {
    render(<LevelUnlocks levelOrder={9} toolAccess={FUNNEL} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Откроется, когда уровень будет завершён")).toBeInTheDocument();
  });

  it("an opened tool links to its own page", () => {
    render(<LevelUnlocks levelOrder={5} toolAccess={FUNNEL} />);
    expect(screen.getByRole("link", { name: "Открыть" })).toHaveAttribute("href", "/tools/trade-card");
  });

  it("renders nothing without a verdict, for a level that opens nothing, or for a code it does not know", () => {
    expect(render(<LevelUnlocks levelOrder={9} toolAccess={null} />).container.firstChild).toBeNull();
    expect(render(<LevelUnlocks levelOrder={4} toolAccess={FUNNEL} />).container.firstChild).toBeNull();
    const unknown = verdict([{ code: "tool.future_thing", unlocked: true, unlockLevel: 9 }]);
    expect(render(<LevelUnlocks levelOrder={9} toolAccess={unknown} />).container.firstChild).toBeNull();
  });

  it("decides no access itself: it compares a level number and reads a flag", () => {
    const source = read("level-unlocks.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/state\s*===|completed|highestCompleted|currentLevel/);
  });
});

describe("the words around the start control are true of the level", async () => {
  /* The screen module is a server component with server-only imports; only its
     two pure helpers are exercised here, loaded with those imports stubbed. */
  const { vi } = await import("vitest");
  vi.mock("@/server/auth/server-session", () => ({ getServerViewer: vi.fn() }));
  vi.mock("@/lib/curriculum/provider", () => ({ getLevelDetail: vi.fn() }));
  vi.mock("@/server/learner-ops/server-read", () => ({ readLevelMentorFeedback: vi.fn() }));
  vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));
  const { startCopyFor, afterVideoAction } = await import("@/features/academy-experience/level-detail-screen");

  const METHODS: AcademyCompletionMethod[] = [
    "external-event", "assessment", "report", "formal-report", "checkpoint", "manual", "lesson", "mentor-review", "unsupported",
  ];

  it("promises a test only where there is one", () => {
    expect(startCopyFor("assessment", true).explain).toMatch(/откроется тест/);
    for (const method of METHODS.filter((m) => m !== "assessment")) {
      expect(startCopyFor(method, true).explain, method).not.toMatch(/тест по уроку|проверк[аи] знаний/);
    }
    expect(startCopyFor("lesson", true).explain).toMatch(/нет теста/);
  });

  it("names a mentor only on the report a mentor reads", () => {
    expect(startCopyFor("report", false).explain).toMatch(/наставник/);
    expect(startCopyFor("formal-report", false).explain).not.toMatch(/наставник/);
    expect(startCopyFor("formal-report", false).explain).toMatch(/автоматическая/);
  });

  it("mentions the video only when the page has one", () => {
    for (const method of ["assessment", "lesson", "manual"] as const) {
      expect(startCopyFor(method, true).explain).toMatch(/Видео можно смотреть уже сейчас/);
      expect(startCopyFor(method, false).explain).not.toMatch(/Видео/);
    }
  });

  it("every method gets a title, a sentence and a label — an unknown one a neutral set", () => {
    for (const method of METHODS) {
      const copy = startCopyFor(method, false);
      expect(copy.title.length, method).toBeGreaterThan(3);
      expect(copy.explain.length, method).toBeGreaterThan(10);
      expect(copy.action.length, method).toBeGreaterThan(3);
    }
    expect(startCopyFor("unsupported", false).action).toBe("Начать");
  });

  it("after the video, the player points at what the level asks next — and at nothing on a finished one", () => {
    expect(afterVideoAction("assessment", "in_progress")).toEqual({ label: "Перейти к тесту", href: "#task" });
    expect(afterVideoAction("lesson", "in_progress")).toEqual({ label: "Отметить урок пройденным", href: "#task" });
    expect(afterVideoAction("formal-report", "in_progress")).toEqual({ label: "К отчёту", href: "#task" });
    expect(afterVideoAction("assessment", "available")).toEqual({ label: "Начать урок", href: "#task" });
    for (const state of ["completed", "locked", "pending_review", "checkpoint_unverified"] as const) {
      expect(afterVideoAction("assessment", state), state).toBeUndefined();
    }
    expect(afterVideoAction("checkpoint", "in_progress")).toBeUndefined();
  });
});

describe("the sheet stays inside the page", () => {
  const css = read("level-lesson.css");
  const root = postcss.parse(css);

  it("scopes every rule to the level page", () => {
    const stray: string[] = [];
    root.walkRules((rule) => {
      for (const selector of rule.selectors) {
        if (!selector.trim().startsWith(".ld")) stray.push(selector.trim());
      }
    });
    expect(stray).toEqual([]);
  });

  it("forces nothing", () => {
    expect(css).not.toContain("!important");
  });

  it("brings no colour of its own: every colour is a token", () => {
    const literals: string[] = [];
    root.walkDecls((decl) => {
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(decl.value)) literals.push(`${decl.prop}: ${decl.value}`);
    });
    expect(literals).toEqual([]);
  });

  it("uses only the page's own two width steps", () => {
    const widths = new Set<string>();
    root.walkAtRules("media", (rule) => {
      for (const match of rule.params.matchAll(/(max|min)-width:\s*([0-9.]+)px/g)) widths.add(`${match[1]}-${match[2]}`);
    });
    expect([...widths].sort()).toEqual(["max-420", "max-860"]);
  });

  it("answers reduced motion for everything it animates", () => {
    const animated = new Set<string>();
    root.walkDecls("transition", (decl) => {
      const rule = decl.parent as postcss.Rule;
      if (rule.parent?.type === "root") for (const selector of rule.selectors) animated.add(selector.trim());
    });
    expect(animated.size).toBeGreaterThan(3);
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    for (const selector of animated) {
      // `.ld .a, .ld .b { transition }` is answered per selector.
      expect(reduced, selector).toContain(selector);
    }
  });

  it("restyles the player nowhere: its look lives in the player's own sheet", () => {
    for (const sheet of ["level-lesson.css", "level-detail-fidelity.css"]) {
      const offenders: string[] = [];
      postcss.parse(read(sheet)).walkRules((rule) => {
        if (/\.avp\b|\.avp__/.test(rule.selector)) offenders.push(`${sheet}: ${rule.selector}`);
      });
      expect(offenders, sheet).toEqual([]);
    }
  });

  it("keeps the page's one lit colour for what can be pressed or was chosen", () => {
    const lit: string[] = [];
    root.walkDecls((decl) => {
      if (!/--signal-active|--ata-signal-/.test(decl.value)) return;
      const selector = (decl.parent as postcss.Rule).selector;
      lit.push(`${selector.replace(/\s+/g, " ")} { ${decl.prop} }`);
    });
    // A verdict, a разбор and a wrong answer are never among them.
    for (const entry of lit) {
      expect(entry).not.toMatch(/asmt__verdict|asmt__review|rf__error|rpt-summary/);
    }
    expect(lit.length).toBeGreaterThan(5);
  });
});
