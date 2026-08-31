/**
 * LESSONS — the reference corpus, its derivation, and its search grammar.
 *
 * Two things here are worth more than the composition checks: the corpus is
 * derived from the product's own accessibility gate and never from a position
 * guess, and the Russian plural forms come from one module rather than from a
 * ternary that gets `2 материала` wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LessonsCorpus, type CorpusMaterial } from "@/features/lessons-fidelity/lessons-corpus";
import { countPhrase, foundPhrase, select } from "@/features/lessons-fidelity/ru-plural";
import {
  LESSONS_SEARCH_CAPABILITY,
  corpusOf,
} from "@/features/lessons-fidelity/lessons-fidelity-screen";
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";

type Enrolled = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

function level(over: Partial<AcademyLevelSummary> & { order: number }): AcademyLevelSummary {
  const code = over.levelCode ?? `v2.l${String(over.order).padStart(3, "0")}`;
  return {
    levelCode: code,
    order: over.order,
    title: over.title ?? `Тема ${over.order}`,
    shortDescription: null,
    learningObjective: "цель",
    typeInfo: {
      type: "lesson",
      label: "Урок",
      isCheckpoint: false,
      isExternal: false,
      supported: over.typeInfo?.supported ?? true,
      ...(over.typeInfo ?? {}),
    },
    state: over.state ?? "completed",
    lockReason: null,
    stateLabel: "Пройден",
    completionSource: "learner",
    completionSourceLabel: "Проверка знаний",
    requirements: { previousLevel: null, requiredXp: 0, checkpointLevel: null },
    routeAccessible: over.routeAccessible ?? true,
    actions: ["view"],
    href: `/lessons/${code}`,
    xpReward: 100,
    progressVersion: null,
    checkpoint: null,
    completionMethod: "assessment",
  } as AcademyLevelSummary;
}

function moduleOf(order: number, levels: AcademyLevelSummary[], title: string): AcademyModuleSummary {
  return {
    moduleCode: `m${String(order).padStart(2, "0")}`,
    order,
    title,
    description: null,
    learningObjective: "цель",
    status: "active",
    levels,
    progress: { total: levels.length, completed: levels.filter((l) => l.state === "completed").length },
  };
}

function viewOf(modules: AcademyModuleSummary[]): Enrolled {
  const all = modules.flatMap((m) => m.levels);
  return {
    state: "enrolled",
    toolAccess: null, // no Backend verdict in this fixture; null locks every tool
    curriculum: {
      curriculumCode: "v2",
      curriculumVersion: 2,
      title: "Программа",
      status: "published",
      publishedAt: null,
    },
    modules,
    progress: {
      currentLevelCode: null,
      currentModuleCode: null,
      nextAvailableLevelCode: null,
      completedLevels: all.filter((l) => l.state === "completed").length,
      totalLevels: all.length,
      xp: { available: false },
      updatedAt: null,
    },
  };
}

const material = (over: Partial<CorpusMaterial> & { order: number }): CorpusMaterial => ({
  levelCode: over.levelCode ?? `v2.l${String(over.order).padStart(3, "0")}`,
  order: over.order,
  title: over.title ?? `Тема ${over.order}`,
  href: over.href ?? `/lessons/v2.l${String(over.order).padStart(3, "0")}`,
  moduleOrder: over.moduleOrder ?? 1,
  moduleTitle: over.moduleTitle ?? "Первый модуль",
  unavailable: over.unavailable ?? false,
});

/* --------------------------------------------------------------- derivation */

describe("Lessons — the corpus is derived, not guessed", () => {
  it("admits only material the product itself says is reachable", () => {
    const view = viewOf([
      moduleOf(
        1,
        [
          level({ order: 1 }),
          level({ order: 2, state: "locked", routeAccessible: false }),
          level({ order: 3, routeAccessible: false }),
        ],
        "Первый модуль",
      ),
    ]);
    expect(corpusOf(view).map((m) => m.order)).toEqual([1]);
  });

  it("keeps the canonical level code as the material's identity", () => {
    const view = viewOf([moduleOf(1, [level({ order: 7, levelCode: "v2.l007" })], "Первый")]);
    const [only] = corpusOf(view);
    expect(only!.levelCode).toBe("v2.l007");
    expect(only!.href).toBe("/lessons/v2.l007");
  });

  it("lists a reached level whose type this build cannot render as unavailable, not as a link", () => {
    const view = viewOf([
      moduleOf(1, [level({ order: 1, typeInfo: { supported: false } as never })], "Первый"),
    ]);
    expect(corpusOf(view)[0]!.unavailable).toBe(true);
  });

  it("keeps search at the frozen safe default until Product sets the rule", () => {
    expect(LESSONS_SEARCH_CAPABILITY).toBe("hidden");
  });
});

/* ------------------------------------------------------------------ plurals */

describe("Lessons — one owner for the Russian plural rule", () => {
  it("counts materials in all three forms", () => {
    expect(countPhrase(1)).toBe("1 материал");
    expect(countPhrase(2)).toBe("2 материала");
    expect(countPhrase(5)).toBe("5 материалов");
    expect(countPhrase(21)).toBe("21 материал");
    expect(countPhrase(11)).toBe("11 материалов");
    expect(countPhrase(46)).toBe("46 материалов");
  });

  it("announces results in all three forms", () => {
    expect(foundPhrase(1)).toBe("Найден 1 материал.");
    expect(foundPhrase(3)).toBe("Найдено 3 материала.");
    expect(foundPhrase(12)).toBe("Найдено 12 материалов.");
  });

  it("fails to `many` rather than to nothing", () => {
    expect(select(1.5, { one: "a", few: "b", many: "c" })).toBe("c");
  });
});

/* --------------------------------------------------------------- composition */

describe("Lessons — the frozen register", () => {
  const three = [
    material({ order: 1, title: "Знакомство", moduleOrder: 1, moduleTitle: "Первый модуль" }),
    material({ order: 2, title: "Вторая тема", moduleOrder: 1, moduleTitle: "Первый модуль" }),
    material({ order: 5, title: "Риск", moduleOrder: 2, moduleTitle: "Второй модуль" }),
  ];

  it("groups by module, names each group once for assistive technology", () => {
    const { container } = render(<LessonsCorpus materials={three} capability="hidden" />);
    const groups = container.querySelectorAll(".group");
    expect(groups).toHaveLength(2);
    const first = groups[0]!;
    expect(first.querySelector("h2")!.className).toContain("visually-hidden");
    expect(first.querySelector("h2")!.textContent).toBe("Модуль 01 · Первый модуль");
    /* The two visible lines are the same information, split for the eye — so
       they are hidden from the accessibility tree and not read twice. */
    expect(first.querySelector(".group__kicker")!.getAttribute("aria-hidden")).toBe("true");
    expect(first.querySelector(".group__name")!.getAttribute("aria-hidden")).toBe("true");
    expect(first.querySelectorAll(".material")).toHaveLength(2);
  });

  it("makes each material one full-row link named by its title alone", () => {
    const { container } = render(<LessonsCorpus materials={three} capability="hidden" />);
    const row = container.querySelector(".material")!;
    const link = row.querySelector("a")!;
    expect(row.querySelectorAll("a, button")).toHaveLength(1);
    expect(link.className).toBe("material__open");
    expect(link.getAttribute("href")).toBe("/lessons/v2.l001");
    const named = link.getAttribute("aria-labelledby")!;
    expect(row.querySelector(`#${named}`)!.textContent).toBe("Знакомство");
    expect(link.querySelector(".material__aff")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not make an unavailable material a link", () => {
    const { container } = render(
      <LessonsCorpus
        materials={[material({ order: 1, title: "Закрытая тема", unavailable: true })]}
        capability="hidden"
      />,
    );
    const row = container.querySelector(".material")!;
    expect(row.className).toContain("material--unavailable");
    expect(row.querySelector("a")).toBeNull();
    expect(row.querySelector(".material__meta")!.textContent).toBe("Материал сейчас недоступен.");
  });

  it("says nothing is open yet without calling it an error", () => {
    const { container } = render(<LessonsCorpus materials={[]} capability="hidden" />);
    expect(container.querySelector(".corpus-zero__title")!.textContent).toBe(
      "Материалы пока не открыты",
    );
    expect(container.querySelectorAll(".corpus-zero__line")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("hides the search control at the safe default capability", () => {
    const { container } = render(<LessonsCorpus materials={three} capability="hidden" />);
    expect(container.querySelector("#search-slot")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    /* The status region still exists — it is the surface's one live region. */
    expect(container.querySelector("#search-status")!.getAttribute("role")).toBe("status");
  });
});

/* -------------------------------------------------------------------- search */

describe("Lessons — search, when the capability is granted", () => {
  const many = [
    material({ order: 1, title: "Знакомство", moduleOrder: 1, moduleTitle: "Первый модуль" }),
    material({ order: 2, title: "Риск и позиция", moduleOrder: 1, moduleTitle: "Первый модуль" }),
    material({ order: 9, title: "Дневник", moduleOrder: 2, moduleTitle: "Дисциплина" }),
  ];

  it("renders a labelled search field and never focuses it on arrival", () => {
    const { container } = render(<LessonsCorpus materials={many} capability="available" />);
    const input = screen.getByLabelText("Поиск по материалам") as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("search");
    expect(document.activeElement).not.toBe(input);
    expect(container.querySelector("#corpus-body")!.getAttribute("data-mode")).toBe("browse");
  });

  it("filters immediately and atomically — headers and materials as one set", async () => {
    const { container } = render(<LessonsCorpus materials={many} capability="available" />);
    await userEvent.type(screen.getByLabelText("Поиск по материалам"), "риск");
    expect(container.querySelectorAll(".material")).toHaveLength(1);
    expect(container.querySelectorAll(".group")).toHaveLength(1);
    expect(container.querySelector(".material__title")!.textContent).toBe("Риск и позиция");
    expect(container.querySelector(".material")!.className).toContain("material--hit");
  });

  it("matches a module name and a level number, as the frozen search does", async () => {
    const { container } = render(<LessonsCorpus materials={many} capability="available" />);
    const input = screen.getByLabelText("Поиск по материалам");
    await userEvent.type(input, "дисциплина");
    expect(container.querySelectorAll(".material")).toHaveLength(1);
    await userEvent.clear(input);
    await userEvent.type(input, "9");
    expect(container.querySelectorAll(".material")).toHaveLength(1);
    expect(container.querySelector(".material__title")!.textContent).toBe("Дневник");
  });

  it("says nothing was found without emptying the page or losing the field", async () => {
    const { container } = render(<LessonsCorpus materials={many} capability="available" />);
    await userEvent.type(screen.getByLabelText("Поиск по материалам"), "zzz");
    expect(container.querySelector("#corpus-body")!.getAttribute("data-mode")).toBe("zero");
    expect(container.querySelector(".corpus__search-empty")!.textContent).toBe(
      "По вашему запросу ничего не найдено.",
    );
    expect(container.querySelector("#search-slot")).not.toBeNull();
    /* Not the empty-corpus state: the corpus is not empty, the query matched nothing. */
    expect(container.querySelector(".corpus-zero")).toBeNull();
  });

  it("announces the SETTLED result, never a count per keystroke", async () => {
    const { container } = render(<LessonsCorpus materials={many} capability="available" />);
    const status = container.querySelector("#search-status")!;
    await userEvent.type(screen.getByLabelText("Поиск по материалам"), "риск");
    /* Filtered already — the register commits immediately and atomically. */
    expect(container.querySelectorAll(".material")).toHaveLength(1);
    /* Announced not yet: the live region waits for the typing to settle, so
       assistive technology hears one result state instead of four. */
    expect(status.textContent).toBe("");
    await waitFor(() => expect(status.textContent).toBe("Найден 1 материал."), { timeout: 2000 });
  });

  it("returns to browse as one coherent state when the query is cleared", async () => {
    const { container } = render(<LessonsCorpus materials={many} capability="available" />);
    const input = screen.getByLabelText("Поиск по материалам");
    await userEvent.type(input, "риск");
    await userEvent.clear(input);
    expect(container.querySelectorAll(".material")).toHaveLength(3);
    expect(container.querySelector(".material--hit")).toBeNull();
    expect(container.querySelector("#corpus-body")!.getAttribute("data-mode")).toBe("browse");
  });
});

/* ------------------------------------------------ the prototype stays behind */

describe("Lessons — nothing synthetic crossed over", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/lessons-fidelity/lessons-corpus.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const screenSrc = readFileSync(
    join(process.cwd(), "src/features/lessons-fidelity/lessons-fidelity-screen.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("has no scenario switch, no QA harness and no fixture corpus", () => {
    for (const s of [src, screenSrc]) {
      expect(s).not.toContain("qa-harness");
      expect(s).not.toContain("scenario");
      expect(s).not.toContain("V4_LEVELS");
      expect(s).not.toContain("V2_MODULES");
    }
  });

  it("does not re-create the prototype's shell", () => {
    expect(src).not.toContain("topbar");
    expect(screenSrc).not.toContain("topbar");
    expect(src).not.toContain("skip-link");
    expect(screenSrc).not.toContain("<main");
  });

  it("writes no plural form by hand", () => {
    /* The forms as terminal string literals — «материала"» / «материалов"» —
       never appear. «материалам» inside a label is a different word and is fine,
       which is why this looks at the closing quote rather than the substring. */
    for (const source of [src, screenSrc]) {
      expect(source).not.toMatch(/материал(а|ов)["'`]/);
    }
    expect(src + screenSrc).toContain("@/features/lessons-fidelity/ru-plural");
  });
});

/* ------------------------------------------------------------------- styles */

describe("Lessons — the stylesheet is scoped and local", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/lessons-fidelity/lessons-fidelity.css"),
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

  it("lets no selector escape the .lsn namespace", () => {
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
            if (s && !s.startsWith(".lsn") && !s.startsWith("html.lsn-root-scope")) escapees.push(s);
          }
        }
        i = k;
      }
    };
    walk(bare);
    expect(escapees).toEqual([]);
  });

  it("keeps the frozen container geometry after collapsing `main` onto the root", () => {
    expect(bare).not.toMatch(/\.lsn\s+main\s*\{/);
    expect(bare).toContain(".lsn {");
  });
});
