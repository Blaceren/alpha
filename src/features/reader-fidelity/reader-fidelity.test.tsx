/**
 * THE READER — the reading composition, the five unavailability classes, and
 * the disclosure rules that go with them.
 *
 * The composition tests are ordinary. The ones worth reading are about what the
 * page is allowed to SAY: a locked level never discloses its title, a checkpoint
 * is never described as "not published", an unknown block renders nothing rather
 * than a placeholder, and a rejected save never leaves a position on screen that
 * the server refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderBody } from "@/features/reader-fidelity/reader-body";
import { ReaderBlock } from "@/features/reader-fidelity/reader-blocks";
import { ReaderUnavailable } from "@/features/reader-fidelity/reader-unavailable";
import {
  AVAILABILITY,
  BOUNDARY_TEXT,
  SAVE_FAILED_NOTE,
  availabilityOf,
  boundaryOf,
} from "@/features/reader-fidelity/reader-state";
import type { LessonBody, LessonBlock } from "@/lib/curriculum/lesson-body";
import type { AcademyLevelDetail, AcademyLevelSummary } from "@/lib/curriculum/academy-view";

const save = vi.fn();
vi.mock("@/lib/curriculum/lesson-progress-client", () => ({
  saveLessonReadingProgress: (...args: unknown[]) => save(...args),
  newLessonProgressRequestId: () => "req-1",
}));

const body = (sections: LessonBody["sections"] = defaultSections): LessonBody => ({
  sourceFormat: "blocks_v2",
  sections,
  appendix: [],
});

const defaultSections: LessonBody["sections"] = [
  {
    code: "s1",
    title: "Что такое уровень",
    blocks: [{ type: "rich_text", paragraphs: ["Первый абзац.\n\nВторой абзац."] }],
  },
  { code: "s2", title: "Как читать график", blocks: [{ type: "divider" }] },
];

const readerProps = {
  body: body(),
  stableCode: "v2.l042",
  levelHref: "/lessons/v2.l042",
  levelOrder: 42,
  nextLevelHref: "/lessons/v2.l043",
  moduleOrder: 9,
  moduleTitle: "Чтение графика",
  title: "Чёткие правила входа",
  subtitle: "Подзаголовок",
  objective: "Научиться формулировать условия допуска.",
  objectiveExt: null,
  initialReading: null,
  canTrackReading: false,
  playbackPositionSeconds: 0,
  posture: "act" as const,
  boundary: "act" as const,
  completionMethod: "assessment",
  hasAuthoredCta: false,
};

const summary = (over: Partial<AcademyLevelSummary> = {}): AcademyLevelSummary =>
  ({
    levelCode: "v2.l042",
    order: 42,
    title: "Чёткие правила входа",
    state: "in_progress",
    typeInfo: { type: "lesson", label: "Урок", isCheckpoint: false, supported: true },
    ...over,
  }) as AcademyLevelSummary;

const detail = (over: Partial<AcademyLevelDetail> = {}): AcademyLevelDetail =>
  ({
    summary: summary(),
    moduleCode: "m09",
    content: { available: true, body: body(), unavailableReason: null },
    navigation: { previousLevelCode: null, nextLevelCode: null },
    ...over,
  }) as AcademyLevelDetail;

const SRC = (f: string) => readFileSync(join(process.cwd(), "src/features/reader-fidelity", f), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  save.mockReset();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------- availability class */

describe("Reader — five reasons, never collapsed into one", () => {
  it("calls a checkpoint's absence what it is, whatever the content payload says", () => {
    expect(
      availabilityOf(
        detail({
          summary: summary({ typeInfo: { isCheckpoint: true, label: "Контрольная точка" } as never }),
          content: { available: true, body: body(), unavailableReason: null } as never,
        }),
      ),
    ).toBe("nature");
  });

  it("puts «not yours yet» ahead of anything about publication", () => {
    expect(
      availabilityOf(
        detail({ content: { available: false, body: null, unavailableReason: "locked" } as never }),
      ),
    ).toBe("locked");
    expect(availabilityOf(detail({ summary: summary({ state: "locked" }) }))).toBe("locked");
  });

  it("separates «not published» from «cannot be shown right now»", () => {
    expect(
      availabilityOf(
        detail({ content: { available: false, body: null, unavailableReason: "not_configured" } as never }),
      ),
    ).toBe("notpublished");
    expect(
      availabilityOf(
        detail({ content: { available: false, body: null, unavailableReason: "unavailable" } as never }),
      ),
    ).toBe("cannotshow");
  });

  it("returns null when the material really is readable", () => {
    expect(availabilityOf(detail())).toBeNull();
  });

  it("never discloses a locked level's title, and shows no identity at all for a bad address", () => {
    const locked = render(
      <ReaderUnavailable
        availability="locked"
        identity={{ moduleOrder: 4, levelOrder: 18, typeLabel: "Урок", title: null }}
      />,
    );
    expect(locked.container.querySelector(".kicker")!.textContent).toBe("МОДУЛЬ 04 · УРОВЕНЬ 18 · УРОК");
    expect(locked.container.querySelector(".subtitle")).toBeNull();
    locked.unmount();

    const invalid = render(<ReaderUnavailable availability="invalid" />);
    expect(invalid.container.querySelector(".kicker")).toBeNull();
    expect(invalid.container.querySelector(".subtitle")).toBeNull();
    expect(invalid.container.querySelector("h1")!.textContent).toBe(AVAILABILITY.invalid.heading);
  });

  it("exits somewhere useful, and somewhere different, per class", () => {
    const locked = render(<ReaderUnavailable availability="locked" />);
    expect(
      Array.from(locked.container.querySelectorAll(".exits a")).map((a) => a.getAttribute("href")),
    ).toEqual(["/path", "/lessons"]);
    locked.unmount();

    const nature = render(<ReaderUnavailable availability="nature" levelHref="/lessons/v2.l015" />);
    expect(
      Array.from(nature.container.querySelectorAll(".exits a")).map((a) => a.getAttribute("href")),
    ).toEqual(["/lessons/v2.l015", "/lessons"]);
  });
});

/* ------------------------------------------------------------- composition */

describe("Reader — the frozen reading composition", () => {
  it("states the address, the title and the objective in the opening", () => {
    const { container } = render(<ReaderBody {...readerProps} />);
    expect(container.querySelector(".kicker__ctx")!.textContent).toBe("МОДУЛЬ 09 · ЧТЕНИЕ ГРАФИКА");
    expect(container.querySelector(".kicker__lvl")!.textContent).toBe("УРОВЕНЬ 42");
    expect(container.querySelector(".opening h1")!.textContent).toBe("Чёткие правила входа");
    expect(container.querySelector(".subtitle")!.textContent).toBe("Подзаголовок");
    expect(container.querySelector(".objective__label")!.textContent).toBe("Чему учит материал");
    expect(container.querySelector(".objective__text")!.textContent).toBe(
      "Научиться формулировать условия допуска.",
    );
  });

  it("carries exactly one h1, and one h2 per section", () => {
    const { container } = render(<ReaderBody {...readerProps} />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll(".section")).toHaveLength(2);
    expect(container.querySelectorAll(".section h2")).toHaveLength(2);
  });

  it("numbers the structure and anchors it on canonical section codes", () => {
    const { container } = render(<ReaderBody {...readerProps} />);
    const links = Array.from(container.querySelectorAll(".toc a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#s1", "#s2"]);
    expect(container.querySelector(".toc__num")!.textContent).toBe("01");
    expect(container.querySelectorAll(".section")[0]!.id).toBe("s1");
    expect(container.querySelector(".section__ord")!.textContent).toBe("01");
  });

  it("makes every section heading a focus target for its own anchor", () => {
    const { container } = render(<ReaderBody {...readerProps} />);
    for (const heading of Array.from(container.querySelectorAll(".section h2"))) {
      expect(heading.getAttribute("tabindex")).toBe("-1");
      expect(heading.id).toMatch(/^h-/);
    }
  });

  it("keeps the context strip hidden until the opening leaves view", () => {
    const { container } = render(<ReaderBody {...readerProps} />);
    expect((container.querySelector(".strip") as HTMLElement).hidden).toBe(true);
    expect((container.querySelector(".panel") as HTMLElement).hidden).toBe(true);
  });

  it("opens the structure panel from the strip, and says so", async () => {
    const { container } = render(<ReaderBody {...readerProps} />);
    const button = container.querySelector(".strip__btn") as HTMLButtonElement;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("strip-panel");
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect((container.querySelector(".panel") as HTMLElement).hidden).toBe(false);
  });

  it("closes the material with the boundary its state calls for", () => {
    const { container } = render(<ReaderBody {...readerProps} />);
    expect(container.querySelector(".boundary__label")!.textContent).toBe("КОНЕЦ МАТЕРИАЛА");
    expect(container.querySelector(".boundary__text")!.textContent).toBe(BOUNDARY_TEXT.act);
    expect(container.querySelector(".boundary__act")!.textContent).toBe("Открыть задание уровня");
    expect(container.querySelector(".boundary__quiet")).toBeNull();
  });

  it("does not say the action twice when the author already wrote it", () => {
    const { container } = render(<ReaderBody {...readerProps} hasAuthoredCta />);
    expect(container.querySelector(".boundary__act")).toBeNull();
  });

  it("goes quiet on a finished or waiting level", () => {
    for (const boundary of ["revisit", "waiting", "none"] as const) {
      const { container, unmount } = render(<ReaderBody {...readerProps} boundary={boundary} />);
      expect(container.querySelector(".boundary__text")!.textContent).toBe(BOUNDARY_TEXT[boundary]);
      expect(container.querySelector(".boundary__act")).toBeNull();
      expect(container.querySelector(".boundary__quiet")!.textContent).toBe("Вернуться к уровню");
      unmount();
    }
  });

  it("derives the boundary from the level's own state", () => {
    expect(boundaryOf(summary({ state: "completed" }))).toBe("revisit");
    expect(boundaryOf(summary({ state: "pending_review" }))).toBe("waiting");
    expect(boundaryOf(summary({ state: "in_progress" }))).toBe("act");
    expect(boundaryOf(summary({ state: "locked" }))).toBe("none");
  });
});

/* --------------------------------------------------------- reading position */

describe("Reader — the reading position is the server's", () => {
  it("offers no marking control where the server would refuse the write", () => {
    const { container } = render(<ReaderBody {...readerProps} canTrackReading={false} />);
    expect(container.querySelectorAll(".section button")).toHaveLength(0);
    /* The text is fully readable either way. */
    expect(container.querySelectorAll(".section")).toHaveLength(2);
  });

  it("does not offer a resume position on a level that is not being read", () => {
    const { container } = render(
      <ReaderBody
        {...readerProps}
        canTrackReading={false}
        initialReading={{ revision: 3, completedSections: [], activeSectionCode: null }}
      />,
    );
    expect(container.querySelector(".resume")).toBeNull();
  });

  it("resumes from the server's own active marker", () => {
    const { container } = render(
      <ReaderBody
        {...readerProps}
        canTrackReading
        initialReading={{ revision: 3, completedSections: ["s1"], activeSectionCode: "s2" }}
      />,
    );
    expect(container.querySelector(".resume")!.textContent).toContain(
      "Вы остановились на разделе 2 — «Как читать график»",
    );
    expect(container.querySelector(".resume a")!.getAttribute("href")).toBe("#s2");
  });

  it("sends the revision it believed it was updating, and the next unread section", async () => {
    save.mockResolvedValue({
      ok: true,
      data: { acceptedRevision: 4, completedSections: ["s1"], activeSectionCode: "s2" },
    });
    const { container } = render(
      <ReaderBody
        {...readerProps}
        canTrackReading
        initialReading={{ revision: 3, completedSections: [], activeSectionCode: "s1" }}
      />,
    );
    await userEvent.click(container.querySelectorAll(".section button")[0]!);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toBe("v2.l042");
    expect(save.mock.calls[0]![1]).toMatchObject({
      expectedRevision: 3,
      completedSections: ["s1"],
      activeSectionCode: "s2",
    });
  });

  it("never leaves a position on screen that the server refused", async () => {
    save.mockResolvedValue({ ok: false, error: { category: "BACKEND_UNAVAILABLE" } });
    const { container } = render(
      <ReaderBody
        {...readerProps}
        canTrackReading
        initialReading={{ revision: 3, completedSections: [], activeSectionCode: "s1" }}
      />,
    );
    await userEvent.click(container.querySelectorAll(".section button")[0]!);
    await waitFor(() =>
      expect(container.querySelector(".savenote")!.textContent).toBe(SAVE_FAILED_NOTE),
    );
    expect(container.querySelectorAll('[data-read="true"]')).toHaveLength(0);
    expect(container.querySelector(".savenote")!.getAttribute("role")).toBe("status");
  });
});

/* -------------------------------------------------------------- the blocks */

describe("Reader — the block vocabulary is the frozen one", () => {
  const block = (b: LessonBlock) =>
    render(<ReaderBlock block={b} levelHref="/lessons/v2.l042" nextLevelHref={null} actionable />);

  it("splits prose on blank lines, as the frozen renderer does", () => {
    const { container } = block({ type: "rich_text", paragraphs: ["Один.\n\nДва."] });
    expect(container.querySelectorAll("p.p")).toHaveLength(2);
  });

  it("labels a callout from its own title, or from its variant", () => {
    const named = block({ type: "callout", variant: "risk", title: "Своё название", body: "Текст" });
    expect(named.container.querySelector(".callout__label")!.textContent).toBe("Своё название");
    expect(named.container.querySelector(".callout")!.className).toBe("callout callout--risk");
    named.unmount();
    const unnamed = block({ type: "callout", variant: "key_idea", title: null, body: "Текст" });
    expect(unnamed.container.querySelector(".callout__label")!.textContent).toBe("Ключевая мысль");
  });

  it("makes a wide table reachable by keyboard", () => {
    const { container } = block({
      type: "table",
      caption: "Сравнение",
      headers: ["A", "B"],
      rows: [["1", "2"]],
    });
    const wrap = container.querySelector(".tablewrap")!;
    expect(wrap.getAttribute("tabindex")).toBe("0");
    expect(wrap.getAttribute("role")).toBe("group");
    expect(wrap.getAttribute("aria-label")).toBe("Сравнение");
    expect(container.querySelector("th")!.getAttribute("scope")).toBe("col");
  });

  it("gives an exercise no completion control of any kind", () => {
    const { container } = block({
      type: "exercise",
      code: "e1",
      title: "Записать правило",
      instructions: "Сформулируйте условие.",
      expectedAction: "Одна строка в журнале.",
      estimatedMinutes: 10,
    });
    expect(container.querySelector(".exercise__kicker")!.textContent).toBe("Задание · ≈10 мин");
    expect(container.querySelectorAll("button, input")).toHaveLength(0);
  });

  it("routes a CTA through the product's own rule and marks whether it is lit", () => {
    const { container } = block({
      type: "cta",
      action: "start_assessment",
      label: "Перейти к проверке",
      body: "Текст",
      toolCode: null,
    });
    const link = container.querySelector(".acta__link")!;
    expect(link.getAttribute("href")).toBe("/lessons/v2.l042#task");
    expect(link.getAttribute("data-lit")).toBe("true");
  });

  it("points a tool link at the real tool route", () => {
    const { container } = block({
      type: "tool_link",
      toolCode: "tool.trading_journal",
      label: "Открыть журнал",
      context: "для этого раздела",
    });
    expect(container.querySelector(".toollink")!.getAttribute("href")).toBe(
      "/tools/tool.trading_journal",
    );
  });

  it("renders nothing at all for a type this build does not know", () => {
    const { container } = block({ type: "not_a_real_block" } as unknown as LessonBlock);
    expect(container.innerHTML).toBe("");
  });
});

/* ------------------------------------------------ the prototype stays behind */

describe("Reader — what did not cross over", () => {
  const sources = [
    codeOnly(SRC("reader-body.tsx")),
    codeOnly(SRC("reader-blocks.tsx")),
    codeOnly(SRC("reader-state.ts")),
    codeOnly(SRC("reader-unavailable.tsx")),
  ].join("\n");

  it("ships no QA markers", () => {
    expect(sources).not.toContain("WORKING COPY");
    expect(sources).not.toContain("avail__wc");
  });

  it("has no scenario registry, no QA panel and no simulated read", () => {
    expect(sources).not.toContain("ATA_READER_SCENARIOS");
    expect(sources).not.toContain("qa-panel");
    expect(sources).not.toContain("?lf=");
    expect(sources).not.toContain("setTimeout");
  });

  it("does not re-create the prototype's shell or its exploration variant", () => {
    expect(sources).not.toContain("topbar");
    expect(sources).not.toContain("skip-link");
    expect(sources).not.toContain("<main");
    expect(sources).not.toContain("altmargin");
  });

  it("never injects markup", () => {
    expect(sources).not.toContain("dangerouslySetInnerHTML");
    expect(sources).not.toContain("innerHTML");
  });
});

/* ------------------------------------------------------------------ styles */

describe("Reader — the stylesheet is scoped and local", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/reader-fidelity/reader-fidelity.css"),
    "utf8",
  );
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("makes no remote request", () => {
    expect(bare).not.toContain("@import");
    expect(bare).not.toMatch(/https?:\/\//);
  });

  it("binds both families to the product's local faces", () => {
    expect(bare).toContain('"ATA Manrope"');
    expect(bare).toContain('"ATA IBM Plex Mono"');
    expect(bare).not.toMatch(/"Manrope"/);
    expect(bare).not.toMatch(/"IBM Plex Mono"/);
  });

  it("lets no selector escape the .rdr namespace", () => {
    const escapees: string[] = [];
    const walk = (block: string) => {
      let i = 0;
      while (i < block.length) {
        const open = block.indexOf("{", i);
        if (open === -1) break;
        const prelude = block.slice(i, open).trim();
        let depth = 1;
        let k = open + 1;
        while (k < block.length && depth > 0) {
          if (block[k] === "{") depth++;
          else if (block[k] === "}") depth--;
          k++;
        }
        const inner = block.slice(open + 1, k - 1);
        if (prelude.startsWith("@")) {
          if (/^@(media|supports)/.test(prelude)) walk(inner);
        } else {
          for (const part of prelude.split(",")) {
            const s = part.trim();
            if (s && !s.startsWith(".rdr") && !s.startsWith("html.rdr-root-scope")) escapees.push(s);
          }
        }
        i = k;
      }
    };
    walk(bare);
    expect(escapees).toEqual([]);
  });
});
