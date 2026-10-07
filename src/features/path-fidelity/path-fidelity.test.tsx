/**
 * PATH — fidelity, state coverage and scoping.
 *
 * Three things are being protected here, and they are different in kind:
 *
 *   1. THE COMPOSITION IS THE FROZEN ONE. The ribbon, the rail, the Decision
 *      Frame and the hooks the geometry controller depends on are asserted
 *      structurally, so a refactor cannot quietly drop the leader, the frame
 *      corners or the return utility and still pass.
 *
 *   2. EVERY STATE IS REACHED FROM A REAL-SHAPED VIEW. The fixtures below are
 *      built to the product's own `AcademyCurriculumView` contract, never to the
 *      prototype's synthetic scenarios — and one test proves the prototype's
 *      fixture copy is nowhere in the surface.
 *
 *   3. THE STYLESHEET IS SCOPED AND LOCAL. Nothing escapes `.pth`, nothing is
 *      fetched from a remote host, and the frozen container geometry survived
 *      the collapse of `main` onto the root.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { PathFidelityView } from "@/features/path-fidelity/path-fidelity-view";
import {
  focusKind,
  waitingLine,
  nodeState,
  nodeStateText,
  moduleSegState,
  moduleFill,
  levelsWord,
  levelCodeLabel,
  nearnessAt,
  NEAR_REACH,
  PATH_WAITING_REVIEW,
} from "@/features/path-fidelity/path-state";
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";
import type { AcademyCompletionMethod } from "@/lib/curriculum/completion-method";
import { deriveNextAction } from "@/lib/curriculum/next-action";

/**
 * The shell's unread indicator is a SERVER component: it reads the session
 * cookie and asks the Backend whether any unread notification exists. A client
 * render cannot run that, and the surface under test is not what it is about,
 * so it is stubbed. Its own behaviour is covered in the Notifications suite.
 */
vi.mock("@/components/shell/notification-button", () => ({
  NotificationButton: () => null,
}));

/* ------------------------------------------------------------------ fixtures
   Built to the product's contract. Titles are neutral placeholders precisely so
   that a test can assert the prototype's own level names never appear. */

function level(over: Partial<AcademyLevelSummary> & { order: number }): AcademyLevelSummary {
  const method: AcademyCompletionMethod = over.completionMethod ?? "assessment";
  const code = over.levelCode ?? `v2.l${String(over.order).padStart(3, "0")}`;
  return {
    levelCode: code,
    order: over.order,
    title: over.title ?? `Тема ${over.order}`,
    shortDescription: over.shortDescription ?? null,
    learningObjective: "цель",
    typeInfo: {
      type: method === "checkpoint" ? "checkpoint" : "lesson",
      label: over.typeInfo?.label ?? (method === "checkpoint" ? "контрольная точка" : "урок + тест"),
      isCheckpoint: method === "checkpoint",
      isExternal: method === "external-event",
      supported: true,
      ...(over.typeInfo ?? {}),
    },
    kind: over.kind ?? null,
    kindLabel:
      over.kindLabel ??
      over.typeInfo?.label ??
      (method === "checkpoint" ? "контрольная точка" : "урок + тест"),
    inProduction: over.inProduction ?? false,
    state: over.state ?? "locked",
    lockReason: over.lockReason ?? (over.state && over.state !== "locked" ? null : "sequence"),
    stateLabel: over.stateLabel ?? "Закрыт",
    completionSource: "learner",
    completionSourceLabel: "Проверка знаний",
    requirements: { previousLevel: null, requiredXp: 0, checkpointLevel: null },
    routeAccessible: over.routeAccessible ?? false,
    actions: ["view"],
    href: over.href ?? `/lessons/${code}`,
    xpReward: 100,
    progressVersion: null,
    checkpoint: over.checkpoint ?? null,
    completionMethod: method,
  } as AcademyLevelSummary;
}

function moduleOf(
  order: number,
  levels: AcademyLevelSummary[],
  title = `Модуль ${order}`,
): AcademyModuleSummary {
  return {
    moduleCode: `m${String(order).padStart(2, "0")}`,
    order,
    title,
    description: null,
    learningObjective: "цель модуля",
    status: "active",
    chapter: null,
    levels,
    progress: { total: levels.length, completed: levels.filter((l) => l.state === "completed").length },
  };
}

type Enrolled = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

function viewOf(modules: AcademyModuleSummary[], currentLevelCode: string | null): Enrolled {
  const all = modules.flatMap((m) => m.levels);
  const currentModule = modules.find((m) => m.levels.some((l) => l.levelCode === currentLevelCode));
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
      currentLevelCode,
      currentModuleCode: currentModule?.moduleCode ?? null,
      nextAvailableLevelCode: null,
      completedLevels: all.filter((l) => l.state === "completed").length,
      totalLevels: all.length,
      openLevels: all.filter((l) => !l.inProduction).length,
      xp: { available: false },
      updatedAt: null,
    },
  };
}

/** Three modules, twelve levels, the learner in the middle of module 02. */
function standardView(overrides: Partial<AcademyLevelSummary> = {}): Enrolled {
  const m1 = moduleOf(
    1,
    [
      level({ order: 1, state: "completed", stateLabel: "Пройден", routeAccessible: true }),
      level({ order: 2, state: "completed", stateLabel: "Пройден", routeAccessible: true }),
      level({
        order: 3,
        state: "completed",
        stateLabel: "Пройден",
        routeAccessible: true,
        completionMethod: "checkpoint",
      }),
    ],
    "Первый модуль",
  );
  const m2 = moduleOf(
    2,
    [
      level({ order: 4, state: "completed", stateLabel: "Пройден", routeAccessible: true }),
      level({
        order: 5,
        state: "in_progress",
        stateLabel: "Сейчас · в работе",
        routeAccessible: true,
        shortDescription: "Описание уровня из программы.",
        ...overrides,
      }),
      level({ order: 6, state: "locked", stateLabel: "Закрыт", lockReason: "sequence" }),
      level({ order: 7, state: "locked", stateLabel: "Закрыт", lockReason: "sequence" }),
      level({
        order: 8,
        state: "locked",
        stateLabel: "Закрыт",
        lockReason: "checkpoint",
        completionMethod: "checkpoint",
      }),
    ],
    "Второй модуль",
  );
  const m3 = moduleOf(
    3,
    [
      level({ order: 9, state: "locked", stateLabel: "Закрыт" }),
      level({ order: 10, state: "locked", stateLabel: "Закрыт" }),
    ],
    "Третий модуль",
  );
  return viewOf([m1, m2, m3], "v2.l005");
}

const SRC = (f: string) => readFileSync(join(process.cwd(), "src/features/path-fidelity", f), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------- state mapping */

describe("Path — state mapping is derived from canonical progression", () => {
  it("puts a checkpoint that is not yet verified in the checkpoint kind", () => {
    expect(focusKind(level({ order: 1, state: "checkpoint_unverified" }))).toBe("checkpoint");
  });

  it("treats review and external confirmation as WAITING, never as blocked", () => {
    expect(focusKind(level({ order: 1, state: "pending_review" }))).toBe("waiting");
    expect(
      focusKind(level({ order: 1, state: "available", completionMethod: "external-event" })),
    ).toBe("current");
  });

  it("stops waiting once the external level is actually complete", () => {
    const done = level({ order: 1, state: "completed", completionMethod: "external-event" });
    expect(focusKind(done)).toBe("current");
    expect(waitingLine(done)).toBeNull();
  });

  it("says nothing is required ONLY when nothing is required", () => {
    expect(waitingLine(level({ order: 1, state: "in_progress" }))).toBeNull();
    expect(waitingLine(level({ order: 1, state: "available" }))).toBeNull();
    expect(waitingLine(level({ order: 1, state: "pending_review" }))).toBe(PATH_WAITING_REVIEW);
    // The registration level asks the learner to act (2026-10-04): no «nothing is required».
    expect(
      waitingLine(level({ order: 1, state: "available", completionMethod: "external-event" })),
    ).toBeNull();
  });

  it("addresses the learner formally, as the product's copy contract requires", () => {
    for (const row of [PATH_WAITING_REVIEW]) {
      expect(row).toContain("от вас");
      expect(row).not.toContain("от тебя");
    }
  });

  it("classifies rail nodes as done / current / next / locked", () => {
    expect(nodeState(level({ order: 4, state: "completed" }), 5)).toBe("done");
    expect(nodeState(level({ order: 5, state: "in_progress" }), 5)).toBe("current");
    expect(nodeState(level({ order: 6, state: "locked" }), 5)).toBe("next");
    expect(nodeState(level({ order: 7, state: "locked" }), 5)).toBe("locked");
  });

  it("treats a completed level as done wherever it sits", () => {
    expect(nodeState(level({ order: 9, state: "completed" }), 5)).toBe("done");
  });

  it("labels module segments from the module's own position", () => {
    const m = moduleOf(1, [level({ order: 1 })]);
    expect(moduleSegState({ ...m, order: 1 }, 2)).toBe("done");
    expect(moduleSegState({ ...m, order: 2 }, 2)).toBe("current");
    expect(moduleSegState({ ...m, order: 3 }, 2)).toBe("future");
  });

  it("lets the current node carry the workflow word so it cannot contradict the detail", () => {
    expect(nodeStateText("current", "waiting", "На проверке")).toBe("текущий · на проверке");
    expect(nodeStateText("current", "current", "Сейчас · в работе")).toBe("текущий");
    expect(nodeStateText("done", "waiting", "Пройден")).toBe("пройден");
    // A level that is not produced yet is «готовится» wherever it stands — also right after the current one.
    expect(nodeStateText("next", "current", "Готовится", true)).toBe("готовится");
    expect(nodeStateText("locked", "current", "Готовится", true)).toBe("готовится");
  });

  it("keeps the frozen code format", () => {
    expect(levelCodeLabel(7)).toBe("L07");
    expect(levelCodeLabel(11)).toBe("L11");
  });

  it("fills a module's segment from the module's own counters (DD-352)", () => {
    const m = moduleOf(1, [level({ order: 1 })]);
    expect(moduleFill({ ...m, progress: { total: 5, completed: 0 } })).toBe(0);
    expect(moduleFill({ ...m, progress: { total: 5, completed: 3 } })).toBe(60);
    expect(moduleFill({ ...m, progress: { total: 6, completed: 1 } })).toBe(17);
    expect(moduleFill({ ...m, progress: { total: 4, completed: 4 } })).toBe(100);
    // Never past full, and an empty module is not divided by.
    expect(moduleFill({ ...m, progress: { total: 4, completed: 9 } })).toBe(100);
    expect(moduleFill({ ...m, progress: { total: 0, completed: 0 } })).toBe(0);
    expect([1, 4, 5, 11, 21].map(levelsWord)).toEqual(["уровня", "уровней", "уровней", "уровней", "уровня"]);
  });
});

/* --------------------------------------------------------------- composition */

describe("Path — the frozen composition", () => {
  it("adds no second landmark and no second skip link", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll(".skip-link")).toHaveLength(0);
    expect(container.querySelectorAll('a[href="#main"]')).toHaveLength(1);
  });

  it("mounts through the shell as a restored surface, so it is not inset twice", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    expect(container.querySelector(".home--frozen")).not.toBeNull();
    expect(container.querySelector(".home-main--frozen")).not.toBeNull();
  });

  it("renders the module ribbon with one segment per module and a chapter every fifth", () => {
    const modules = Array.from({ length: 12 }, (_, i) =>
      moduleOf(i + 1, [level({ order: i + 1, state: i === 0 ? "in_progress" : "locked" })]),
    );
    const { container } = render(
      <PathFidelityView view={viewOf(modules, "v2.l001")} userName="Тест" />,
    );
    expect(container.querySelectorAll(".mod-seg")).toHaveLength(12);
    expect(container.querySelectorAll(".mod-seg--chapter")).toHaveLength(2);
    expect(container.querySelectorAll(".mod-seg--current")).toHaveLength(1);
  });

  it("states progress from the canonical counters, not from array lengths", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    expect(container.querySelector(".path-header__done")?.textContent).toBe(
      "Пройдено 4 из 10 уровней",
    );
    expect(container.querySelector(".mod-nav__scale")?.textContent).toBe("Модуль 2 из 3");
    const segments = [...container.querySelectorAll(".mod-seg")].map((seg) => seg.textContent);
    expect(segments).toEqual([
      "Модуль 1 — пройден",
      "Модуль 2 — текущий, пройдено 1 из 5 уровней",
      "Модуль 3 — впереди",
    ]);
  });

  it("keeps the scale of modules small, in the module's own head, filled by its walked levels (DD-352)", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    // One scale, and it is the module's: nothing runs the page's width above it any more.
    expect(container.querySelectorAll(".mod-nav")).toHaveLength(1);
    const nav = container.querySelector(".workspace__head > .mod-nav") as HTMLElement;
    expect(nav.getAttribute("aria-label")).toBe("Модули программы");
    // Module 02 has walked one level of five: its segment is a fifth full; no other carries a fill.
    const current = nav.querySelector(".mod-seg--current") as HTMLElement;
    expect(current.style.getPropertyValue("--seg-fill")).toBe("20%");
    expect(nav.querySelectorAll('[style*="--seg-fill"]')).toHaveLength(1);
  });

  it("puts the learner's own module on the rail, with the frozen node vocabulary", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    const nodes = container.querySelectorAll(".level-node");
    expect(nodes).toHaveLength(5);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="step"]')?.className).toContain(
      "level-node--current",
    );
    expect(container.querySelectorAll(".level-node--done")).toHaveLength(1);
    expect(container.querySelectorAll(".level-node--next")).toHaveLength(1);
    expect(container.querySelector(".level-node__code")?.textContent).toBe("L04");
  });

  it("marks a checkpoint node and dims what is far beyond reach", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    expect(container.querySelectorAll(".level-node--cp")).toHaveLength(1);
    /* The current level is 5. The frozen threshold is three steps out, so
       order 8 is dimmed and order 7 — two steps out — is still described. */
    const far = container.querySelectorAll(".level-node--far");
    expect(far).toHaveLength(1);
    expect(far[0]!.querySelector(".level-node__code")?.textContent).toBe("L08");
    expect(far[0]!.querySelector(".level-node__type")).toBeNull();
    const near = container.querySelector('[data-level="v2.l007"]');
    expect(near?.className).not.toContain("level-node--far");
    expect(near?.querySelector(".level-node__type")?.textContent).toBe("урок + тест");
  });

  it("keeps the detail whole — both corners and the focused heading — and nothing reaches into it from the strip", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    const focus = container.querySelector(".focus");
    expect(focus).not.toBeNull();
    // DD-353 (owner 2026-10-07: «она не должна входить в следующую область»): no line joins the panel.
    expect(container.querySelector("[data-leader], .focus__leader, [data-flow], .focus__flow")).toBeNull();
    expect(focus!.querySelectorAll(".frame-corner")).toHaveLength(2);
    const title = focus!.querySelector("[data-detail-title]") as HTMLElement;
    expect(title.tagName).toBe("H2");
    expect(title.getAttribute("tabindex")).toBe("-1");
    expect(title.textContent).toBe("Уровень 5 · Тема 5");
    expect(focus!.querySelector(".fstate-glyph")).not.toBeNull();
  });

  it("supplies every hook the rail controller binds to", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    for (const hook of [
      "[data-pth-root]",
      "[data-scroller]",
      "[data-focus]",
      "[data-detail-title]",
      "[data-return]",
      ".rail",
      ".workspace",
      ".level-node__mark",
      ".level-node__block",
    ]) {
      expect(container.querySelector(hook), hook).not.toBeNull();
    }
    expect((container.querySelector("[data-return]") as HTMLButtonElement).hidden).toBe(true);
  });

  it("draws the module edges from real module adjacency", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    expect(container.querySelector(".workspace__edge--entry")?.textContent).toBe(
      "Модуль 01 «Первый модуль» завершён",
    );
    expect(container.querySelector(".workspace__edge--exit")?.textContent).toBe(
      "Дальше: модуль 03 «Третий модуль» · уровни 9–10",
    );
    expect(container.querySelector(".workspace__range")?.textContent).toBe("уровни 4–8");
    // The module's number is the scale's to say (DD-352); the kicker keeps its chapter and levels.
    expect(container.querySelector(".workspace__kicker")?.textContent).toBe("уровни 4–8");
  });

  it("does not claim the previous module is finished when it is not", () => {
    const view = standardView();
    view.modules[0]!.progress = { total: 3, completed: 2 };
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector(".workspace__edge--entry")).toBeNull();
  });
});

/* -------------------------------------------------------------- state screens */

describe("Path — each workflow state reads as itself", () => {
  it("a level under review waits, formally, and is not offered a false action", () => {
    const view = standardView({
      state: "pending_review",
      stateLabel: "На проверке",
      routeAccessible: true,
      shortDescription: "Отчёт отправлен.",
    });
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector(".focus__state")?.className).toContain("focus__state--waiting");
    expect(container.querySelector(".focus__body")?.textContent).toContain(PATH_WAITING_REVIEW);
    expect(container.querySelector('[aria-current="step"]')?.className).toContain(
      "level-node--wf-waiting",
    );
    /* What the level is to the learner is the node's status for a screen
       reader; the eye gets the way in under the pointer (DD-346). */
    expect(container.querySelector(".level-node--current .level-node__status")?.textContent).toBe(
      "текущий · на проверке",
    );
    expect(container.querySelector(".level-node--current .level-node__go")?.textContent).toBe(
      "Начать уровень 5",
    );
  });

  it("an external-event level is the learner's to act on — the level page has the link (2026-10-04)", () => {
    const view = standardView({
      state: "available",
      stateLabel: "Ждёт внешнего подтверждения",
      completionMethod: "external-event",
      routeAccessible: true,
      shortDescription: null,
    });
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector(".focus__body")?.textContent).not.toContain("ничего не требуется");
    expect(container.querySelector(".focus__state")?.className).not.toContain("focus__state--waiting");
  });

  it("an unverified checkpoint is a checkpoint, not a failure", () => {
    const view = standardView({
      state: "checkpoint_unverified",
      stateLabel: "Условие не подтверждено",
      completionMethod: "checkpoint",
      routeAccessible: true,
      checkpoint: { reason: "not_met" } as AcademyLevelSummary["checkpoint"],
    });
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector(".focus__state")?.className).toContain(
      "focus__state--checkpoint",
    );
    expect(container.querySelector(".focus__state")?.textContent).toContain(
      "Условие не подтверждено",
    );
  });

  it("names a mentor review on the node and in the detail, and only where it applies", () => {
    const view = standardView({
      state: "pending_review",
      stateLabel: "На проверке",
      completionMethod: "mentor-review",
      routeAccessible: true,
    });
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector(".focus__meta")?.textContent).toContain("mentor review");
    expect(
      container.querySelector(".level-node--current .level-node__type")?.textContent,
    ).toContain("mentor review");
    expect(container.querySelector(".level-node--done .level-node__type")?.textContent).not.toContain(
      "mentor review",
    );
  });

  it("explains why the next level has not opened: its own reason on its node, and by number under the focus", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    // On the next level's OWN node the level's sentence needs no subject.
    const reason = container.querySelector(".level-node--next .level-node__reason")?.textContent;
    expect(reason).toBe("Сначала нужно завершить предыдущие уровни.");
    // Under the level in focus the same sentence read as being about THAT
    // level — «сначала завершите предыдущие» beside the one you are on. There
    // it names the level it is about.
    expect(container.querySelector(".focus__next")?.textContent).toBe(
      "Уровень 6 откроется, когда этот уровень будет завершён.",
    );
  });

  it("a following level locked for another reason keeps its own sentence, with its number", () => {
    const view = standardView();
    const following = view.modules[1]!.levels[2]!;
    following.lockReason = "xp";
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector(".focus__next")?.textContent).toBe(
      "Уровень 6: Для этого уровня нужно больше опыта с предыдущих шагов.",
    );
  });

  it("offers the action deriveNextAction chose, as a real navigation", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    const primary = container.querySelector(".button--primary") as HTMLAnchorElement | null;
    expect(primary).not.toBeNull();
    expect(primary!.tagName).toBe("A");
    expect(primary!.getAttribute("href")).toBeTruthy();
    expect(primary!.getAttribute("href")).not.toBe("#");
  });

  it("survives a programme with a single module and no next level", () => {
    const only = moduleOf(1, [
      level({ order: 1, state: "in_progress", stateLabel: "В работе", routeAccessible: true }),
    ]);
    const { container } = render(
      <PathFidelityView view={viewOf([only], "v2.l001")} userName="Тест" />,
    );
    expect(container.querySelector(".workspace__edge--exit")).toBeNull();
    expect(container.querySelector(".focus__next")).toBeNull();
    expect(container.querySelector(".level-node--current")).not.toBeNull();
  });

  it("says the programme is empty rather than rendering an empty rail", () => {
    render(<PathFidelityView view={viewOf([], null)} userName="Тест" />);
    expect(screen.getByText("Программа пуста")).toBeTruthy();
  });
});

/* ------------------------------------------------- the prototype stays behind */

describe("Path — nothing synthetic crossed over", () => {
  const view = SRC("path-fidelity-view.tsx");
  const rail = SRC("path-rail.tsx");
  const state = SRC("path-state.ts");

  it("carries none of the prototype's fixture copy", () => {
    const rendered = render(<PathFidelityView view={standardView()} userName="Тест" />)
      .container.innerHTML;
    for (const fixture of [
      "Регистрация Pocket",
      "Как устроен Alpha Trade Academy",
      "Первые пять demo-сделок",
      "Контрольная точка $50",
      "Жизненный цикл сделки",
      "Личный Risk Plan",
      "Trading Journal",
    ]) {
      expect(rendered, fixture).not.toContain(fixture);
      expect(codeOnly(view), fixture).not.toContain(fixture);
    }
  });

  it("has no design-QA harness, no scenario switch and no fixture mode", () => {
    for (const src of [view, rail, state]) {
      expect(codeOnly(src)).not.toContain("qa-harness");
      expect(codeOnly(src)).not.toContain("scenario");
      expect(codeOnly(src)).not.toContain("searchParams");
    }
  });

  it("does not reproduce the prototype's transition engine", () => {
    for (const cls of ["is-swapping", "is-transiting", "is-turning", "focus--incoming", "focus--outgoing"]) {
      expect(codeOnly(rail), cls).not.toContain(cls);
      expect(codeOnly(view), cls).not.toContain(cls);
    }
  });

  it("does not re-create the prototype's own shell", () => {
    expect(codeOnly(view)).not.toContain("topbar");
    expect(codeOnly(view)).not.toContain("skip-link");
    expect(codeOnly(view)).not.toContain("<main");
  });

  it("never writes financial amounts or invents progression", () => {
    expect(codeOnly(view)).not.toMatch(/\$\d/);
    expect(codeOnly(state)).not.toMatch(/\$\d/);
    expect(codeOnly(view)).not.toContain("currentXp");
  });
});

/* ------------------------------------------------------------------ stylesheet */

describe("Path — the stylesheet is scoped and local", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/path-fidelity/path-fidelity.css"),
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

  it("lets no selector escape the .pth namespace", () => {
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
            if (s && !s.startsWith(".pth") && !s.startsWith("html.pth-root-scope")) escapees.push(s);
          }
        }
        i = k;
      }
    };
    walk(bare);
    expect(escapees).toEqual([]);
  });

  it("keeps the frozen container geometry after collapsing `main` onto the root", () => {
    expect(bare).toContain("width: min(100%, 1008px)");
    expect(bare).toContain("padding: 34px 28px 64px");
    expect(bare).not.toMatch(/\.pth\s+main\s*\{/);
  });

  it("keeps the frozen surface palette", () => {
    for (const value of ["#0b0d0a", "#11140f", "#1a1f18"]) {
      expect(bare).toContain(value);
    }
  });

  it("gates the root-scroller rule on a class nothing ever adds", () => {
    expect(bare).toContain("html.pth-root-scope");
    for (const src of [SRC("path-fidelity-view.tsx"), SRC("path-rail.tsx")]) {
      expect(src).not.toContain("pth-root-scope");
    }
  });
});

/* ── THE PRIMARY CTA SEAM ──────────────────────────────────────────────────
   This was the last conditional href in the surface, written as
   `href={nextAction.href ?? "#"}`. The fallback read as if the CTA sometimes
   pointed at a fragment, which is why it was held back from the link
   conversion — a fragment is not a route and must stay a bare anchor.

   It never pointed at a fragment. `showPrimary` already required a non-null
   href before the anchor rendered, so the "#" was unreachable: what actually
   shipped was an internal route on a bare <a>, on every path a learner takes.

   The two branches are proved from opposite sides below. What licenses reading
   them as a pair at all is the pairing invariant, checked exhaustively over
   the source of `deriveNextAction` in the internal-links gate. */
describe("the primary CTA resolves both branches of nextAction", () => {
  function reactHandlers(el: Element): { onClick: string } {
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    const props = (key ? (el as unknown as Record<string, unknown>)[key] : {}) as {
      onClick?: unknown;
    };
    return { onClick: typeof props.onClick };
  }

  it("routes to the level when nextAction carries an href", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    const primary = container.querySelector(".button--primary") as HTMLAnchorElement | null;

    expect(primary).not.toBeNull();
    // Still the same element, class and position a bare anchor produced.
    expect(primary!.tagName).toBe("A");
    expect(primary!.className).toBe("button button--primary");
    expect(primary!.parentElement!.className).toBe("focus__actions");
    // The href is a route, and never the fragment the old fallback implied.
    expect(primary!.getAttribute("href")).toMatch(/^\//);
    expect(primary!.getAttribute("href")).not.toBe("#");
    // And it is now a router link, which is the whole point.
    expect(reactHandlers(primary!).onClick).toBe("function");

    /* The words and the destination both still come from the derivation. Asserting
       the label against a literal here would let the CTA drift away from the state
       it describes and still pass, which is the failure this pass is about. */
    const chosen = deriveNextAction(standardView());
    expect(primary!.textContent).toBe(chosen.ctaLabel);
    expect(primary!.getAttribute("href")).toBe(chosen.href);
  });

  it("renders no CTA at all when nextAction has neither label nor href", () => {
    /* `deriveNextAction` switches on completionMethod and returns both fields
       null in its default arm — the level type this build does not understand.
       That arm exists because the method arrives from the Backend, so a value
       this build has never heard of is a real state, not a hypothetical. The
       cast is how a test reaches it without weakening the union. */
    const unsupported = moduleOf(1, [
      level({
        order: 1,
        state: "in_progress",
        stateLabel: "В работе",
        routeAccessible: true,
        completionMethod: "a-method-this-build-predates" as AcademyCompletionMethod,
        typeInfo: {
          type: "unsupported",
          label: "неизвестный тип",
          isCheckpoint: false,
          isExternal: false,
          supported: false,
        },
      }),
    ]);
    const { container } = render(
      <PathFidelityView view={viewOf([unsupported], "v2.l001")} userName="Тест" />,
    );

    expect(container.querySelector(".button--primary")).toBeNull();
    // The absence is the whole behaviour: no placeholder anchor takes its seat.
    expect(container.querySelector('a[href="#"]')).toBeNull();
    const actions = container.querySelector(".focus__actions");
    if (actions) {
      for (const a of actions.querySelectorAll("a")) {
        expect(a.getAttribute("href")).not.toBe("#");
      }
    }
  });

  it("keeps the CTA a single tab stop, as the bare anchor was", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    const actions = container.querySelector(".focus__actions")!;
    const stops = actions.querySelectorAll("a, button, input, [tabindex]");
    for (const s of stops) expect(s.tagName).toBe("A");
    expect(actions.querySelectorAll(".button--primary")).toHaveLength(1);
  });
});

/* ====================================================================== *
 * PROGRAM STRUCTURE (2026-10-02) — chapters, kinds, and the end of what is
 * open, on the frozen composition.
 * ====================================================================== */

/** Two chapters: modules 1–2 open, module 3 defined and not open yet. */
function funnelView(currentCode: string, done: number): Enrolled {
  const lv = (order: number, extra: Partial<AcademyLevelSummary> = {}) =>
    level({
      order,
      state: order <= done ? "completed" : "locked",
      stateLabel: order <= done ? "Пройден" : "Закрыт",
      routeAccessible: order <= done,
      ...extra,
    });
  const closed = (order: number, extra: Partial<AcademyLevelSummary> = {}) =>
    lv(order, {
      state: "locked",
      lockReason: "inactive",
      stateLabel: "Готовится",
      routeAccessible: false,
      inProduction: true,
      shortDescription: `Описание уровня ${order}.`,
      ...extra,
    });
  const m1 = { ...moduleOf(1, [lv(1), lv(2, { kind: "task", kindLabel: "Задание", completionMethod: "external-event" })], "Основы"), chapter: { number: 1, title: "Первая глава" } };
  const m2 = {
    ...moduleOf(
      2,
      [
        lv(3, done >= 3 ? {} : { state: "in_progress", stateLabel: "В процессе", routeAccessible: true, kind: "report", kindLabel: "Отчёт", completionMethod: "formal-report" }),
        lv(4, { kind: "assembly", kindLabel: "Точка сборки" }),
      ],
      "Практика",
    ),
    chapter: { number: 1, title: "Первая глава" },
  };
  const m3 = { ...moduleOf(3, [closed(5), closed(6), closed(7)], "Свеча в контексте"), chapter: { number: 2, title: "Вторая глава" } };
  return viewOf([m1, m2, m3], currentCode);
}

describe("Path — the 30-level program", () => {
  it("puts the tall tick where a chapter ends, from the program's own chapters", () => {
    const { container } = render(<PathFidelityView view={funnelView("v2.l003", 2)} userName="Тест" />);
    const ticks = [...container.querySelectorAll(".mod-seg")].map((seg) => seg.classList.contains("mod-seg--chapter"));
    // Chapter 1 is modules 1–2; chapter 2 is the last module and ends nothing.
    expect(ticks).toEqual([false, true, false]);
  });

  it("a program without chapters keeps the frozen every-fifth rhythm", () => {
    const modules = Array.from({ length: 6 }, (_, i) =>
      moduleOf(i + 1, [level({ order: i + 1, state: i === 0 ? "in_progress" : "locked", routeAccessible: i === 0 })]),
    );
    const { container } = render(<PathFidelityView view={viewOf(modules, "v2.l001")} userName="Тест" />);
    const ticks = [...container.querySelectorAll(".mod-seg")].map((seg) => seg.classList.contains("mod-seg--chapter"));
    expect(ticks).toEqual([false, false, false, false, true, false]);
  });

  it("names the chapter above the module, and says nothing about one the program does not have", () => {
    const withChapters = render(<PathFidelityView view={funnelView("v2.l003", 2)} userName="Тест" />);
    expect(withChapters.container.querySelector(".workspace__kicker")?.textContent).toBe(
      "Глава 1 · Первая глава · уровни 3–4",
    );
    withChapters.unmount();
    const without = render(<PathFidelityView view={standardView()} userName="Тест" />);
    expect(without.container.querySelector(".workspace__kicker")?.textContent).toBe("уровни 4–8");
  });

  it("calls a level what its author calls it", () => {
    const { container } = render(<PathFidelityView view={funnelView("v2.l003", 2)} userName="Тест" />);
    const type = (code: string) =>
      container.querySelector(`[data-level="${code}"] .level-node__type`)?.textContent;
    expect(type("v2.l003")).toBe("Отчёт");
    expect(type("v2.l004")).toBe("Точка сборки");
    expect(container.querySelector(".focus__meta")?.textContent).toContain("Отчёт");
    // A level of the module before is on that module's strip (DD-352), under its own word.
    const view = funnelView("v2.l002", 1);
    Object.assign(view.modules[0]!.levels[1]!, { state: "in_progress", stateLabel: "В процессе", routeAccessible: true });
    Object.assign(view.modules[1]!.levels[0]!, { state: "locked", stateLabel: "Закрыт", routeAccessible: false });
    const earlier = render(<PathFidelityView view={view} userName="Тест" />);
    expect(codes(earlier.container)).toEqual(["v2.l001", "v2.l002"]);
    expect(earlier.container.querySelector('[data-level="v2.l002"] .level-node__type')?.textContent).toBe("Задание");
  });

  it("says how many levels are open while part of the program is in production", () => {
    const { container } = render(<PathFidelityView view={funnelView("v2.l003", 2)} userName="Тест" />);
    expect(container.querySelector(".path-header__done")?.textContent).toBe("Пройдено 2 из 7 уровней · открыто 4");
    const whole = render(<PathFidelityView view={standardView()} userName="Тест" />);
    expect(whole.container.querySelector(".path-header__done")?.textContent).toBe("Пройдено 4 из 10 уровней");
  });

  it("the last open level says the next one is still being prepared", () => {
    const view = funnelView("v2.l004", 3);
    const last = view.modules[1]!.levels[1]!;
    Object.assign(last, { state: "in_progress", stateLabel: "В процессе", routeAccessible: true });
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector(".focus__next")?.textContent).toBe("Уровень 5 ещё готовится и откроется позже.");
  });

  describe("when every open level is finished", () => {
    const rendered = () => render(<PathFidelityView view={funnelView("v2.l005", 4)} userName="Тест" />);

    it("focuses the first level in production as what comes next — not as «сейчас»", () => {
      const { container } = rendered();
      const now = container.querySelector(".path-header__now")?.textContent ?? "";
      expect(now.startsWith("Дальше: Уровень 5")).toBe(true);
      expect(now).toContain("готовится");
      expect(now).not.toContain("Сейчас");
    });

    it("draws that level as waiting, and its node says «готовится», never «текущий»", () => {
      const { container } = rendered();
      const node = container.querySelector('[aria-current="step"]')!;
      expect(node.classList.contains("level-node--wf-waiting")).toBe(true);
      expect(node.querySelector(".level-node__status")?.textContent).toBe("готовится");
      /* «Начать» on every current level, this one included — the owner's
         decision of 2026-10-06; the level's page says it is being prepared. */
      const go = node.querySelector("a.level-node__go");
      expect(go?.getAttribute("href")).toBe("/lessons/v2.l005");
      expect(container.querySelector(".focus__state")?.classList.contains("focus__state--waiting")).toBe(true);
      expect(container.querySelector(".focus__state")?.textContent).toBe("Готовится");
    });

    it("tells the learner nothing is required, with the reason, and offers no control", () => {
      const { container } = rendered();
      const body = container.querySelector(".focus__body")?.textContent ?? "";
      expect(body).toContain("Описание уровня 5.");
      expect(body).toContain("Сейчас от вас ничего не требуется — уровень откроется, когда урок будет готов.");
      // «Открыть путь» is the shared decision's control; on Path it would lead here.
      expect(container.querySelector(".focus__actions a")).toBeNull();
      expect(container.querySelector(".focus__next")).toBeNull();
    });
  });
});

/* ====================================================================== *
 * THE STRIP IS THE MODULE (DD-352, owner 2026-10-06: «каждое заполнение один
 * модуль расписанный в этих блоках»): every level of the module in focus and
 * nothing beyond it. From DD-346: «Завершён» and «Начать» under the pointer;
 * the branch follows the pointer over opened levels only. From DD-352: the
 * panel the branch flows into is lit while the pointer holds it.
 * ====================================================================== */

/** Ten levels in three modules (1–3, 4–8, 9–10), every level before `current` walked. */
function walkedTo(current: number): Enrolled {
  const lv = (order: number) =>
    level({
      order,
      ...(order < current
        ? { state: "completed" as const, stateLabel: "Пройден", routeAccessible: true }
        : order === current
          ? { state: "in_progress" as const, stateLabel: "В процессе", routeAccessible: true }
          : { state: "locked" as const, stateLabel: "Закрыт", lockReason: "sequence" as const }),
    });
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => lv(a + i));
  const view = viewOf(
    [moduleOf(1, range(1, 3), "Первый модуль"), moduleOf(2, range(4, 8), "Второй модуль"), moduleOf(3, range(9, 10), "Третий модуль")],
    `v2.l${String(current).padStart(3, "0")}`,
  );
  return view;
}

const codes = (container: HTMLElement) =>
  [...container.querySelectorAll(".level-node")].map((node) => node.getAttribute("data-level"));

describe("Path — the strip is the module (DD-352)", () => {
  it("holds every level of the module in focus, wherever in it the learner stands", () => {
    for (const at of [4, 5, 7, 8]) {
      const { container, unmount } = render(<PathFidelityView view={walkedTo(at)} userName="Тест" />);
      expect(codes(container), `at ${at}`).toEqual(["v2.l004", "v2.l005", "v2.l006", "v2.l007", "v2.l008"]);
      unmount();
    }
  });

  it("holds nothing of the module before or after — at the program's ends too", () => {
    const first = render(<PathFidelityView view={walkedTo(1)} userName="Тест" />);
    expect(codes(first.container)).toEqual(["v2.l001", "v2.l002", "v2.l003"]);
    first.unmount();
    const last = render(<PathFidelityView view={walkedTo(10)} userName="Тест" />);
    expect(codes(last.container)).toEqual(["v2.l009", "v2.l010"]);
  });

  it("draws no module edge on its line and names no other module (owner: «нужно убрать серую палку»)", () => {
    const { container } = render(<PathFidelityView view={walkedTo(4)} userName="Тест" />);
    expect(container.querySelectorAll(".level-node--edge")).toHaveLength(0);
    expect(container.querySelectorAll(".level-node__module")).toHaveLength(0);
    expect([...container.querySelectorAll(".level-node__code")].map((c) => c.textContent)).toEqual([
      "L04",
      "L05",
      "L06",
      "L07",
      "L08",
    ]);
  });

  it("fills its line through the walked levels to the one in focus — a module is one filling", () => {
    const states = (at: number) => {
      const { container, unmount } = render(<PathFidelityView view={walkedTo(at)} userName="Тест" />);
      const out = [...container.querySelectorAll(".level-node")].map((n) =>
        ["done", "current", "next", "locked"].find((s) => n.classList.contains(`level-node--${s}`)),
      );
      unmount();
      return out;
    };
    expect(states(4)).toEqual(["current", "next", "locked", "locked", "locked"]);
    expect(states(7)).toEqual(["done", "done", "done", "current", "next"]);
    // The next module starts a strip of its own, empty again.
    expect(states(9)).toEqual(["current", "next"]);
  });

  it("gives every level that is not open the same mark (owner: «эти фигурки должны быть одинаковыми»)", () => {
    const { container } = render(<PathFidelityView view={walkedTo(5)} userName="Тест" />);
    // L06 is next, L07–L08 locked: all three are closed, and the stylesheet draws one closed mark.
    expect([...container.querySelectorAll(".level-node--closed")].map((n) => n.getAttribute("data-level"))).toEqual([
      "v2.l006",
      "v2.l007",
      "v2.l008",
    ]);
    const css = readFileSync(join(process.cwd(), "src/features/path-fidelity/path-hifi.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).toMatch(/\.pth\.pth--hifi \.level-node--closed \.level-node__mark \{[^}]*border: 2px dashed/);
    expect(css).not.toMatch(/level-node--(next|locked) \.level-node__mark/);
    expect(css).not.toContain("level-node--edge");
  });

  it("a walked level says «Завершён»; the current one offers «Начать» into its lesson", () => {
    const { container } = render(<PathFidelityView view={walkedTo(5)} userName="Тест" />);
    expect(container.querySelector('[data-level="v2.l004"] .level-node__state--done')?.textContent).toBe("Завершён");
    const go = container.querySelector('[data-level="v2.l005"] a.level-node__go') as HTMLAnchorElement;
    expect(go.getAttribute("href")).toBe("/lessons/v2.l005");
    expect(go.textContent).toBe("Начать уровень 5");
    // The words «пройден» / «текущий» are no longer drawn as pills.
    expect(container.querySelector(".level-node--done .level-node__state")?.textContent).not.toBe("пройден");
  });

  it("every opened level has its own branch and block; the rest are drawn closed and have neither", () => {
    const { container } = render(<PathFidelityView view={walkedTo(5)} userName="Тест" />);
    const open = [...container.querySelectorAll("[data-open]")].map((n) => n.getAttribute("data-level"));
    expect(open).toEqual(["v2.l004", "v2.l005"]);
    for (const node of container.querySelectorAll("[data-open]")) {
      expect(node.querySelector(".level-node__stem")?.getAttribute("aria-hidden")).toBe("true");
      expect(node.querySelector(".level-node__block")?.getAttribute("aria-hidden")).toBe("true");
    }
    const closed = [...container.querySelectorAll(".level-node--closed")].map((n) => n.getAttribute("data-level"));
    expect(closed).toEqual(["v2.l006", "v2.l007", "v2.l008"]);
    for (const node of container.querySelectorAll(".level-node--closed")) {
      expect(node.querySelector(".level-node__stem, .level-node__block")).toBeNull();
    }
    // The level in focus is the one lit at rest — where the learner is.
    const rest = container.querySelector("[data-rest]")!;
    expect(rest.getAttribute("aria-current")).toBe("step");
    expect(rest.classList.contains("level-node--rest")).toBe(true);
    expect(container.querySelectorAll(".level-node--rest")).toHaveLength(1);
  });

  it("with every level walked, the level in focus is the one lit at rest", () => {
    const view = walkedTo(10);
    const last = view.modules[2]!.levels[1]!;
    Object.assign(last, { state: "completed", stateLabel: "Пройден" });
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(container.querySelector("[data-rest]")?.getAttribute("data-level")).toBe("v2.l010");
  });

  /* DD-353, owner 2026-10-07: «она не должна входить в следующую область … она
     должна в момент того как водишь и приближаешься к блоку становиться ярче и
     начинать свечение обводки постепенно, блоки пройденные». The controller
     measures how near the pointer is to each opened level's block (`--near`,
     0–1); the stylesheet brightens the branch and runs the outline's light. */
  describe("the rail controller wakes a block as the pointer nears it", () => {
    const pointer = (type: string, at: { x: number; y: number } = { x: 0, y: 0 }, pointerType = "mouse") => {
      const event = new MouseEvent(type, { bubbles: type === "pointermove", clientX: at.x, clientY: at.y });
      Object.defineProperty(event, "pointerType", { value: pointerType });
      return event;
    };
    /* jsdom lays nothing out: each block is given a box. L04's block spans
       x 0–150, L05's 160–310, both y 100–300. */
    function laidOut() {
      const rendered = render(<PathFidelityView view={walkedTo(5)} userName="Тест" />);
      const boxes: Record<string, [number, number, number, number]> = {
        "v2.l004": [0, 100, 150, 300],
        "v2.l005": [160, 100, 310, 300],
      };
      for (const [code, [left, top, right, bottom]] of Object.entries(boxes)) {
        const block = rendered.container.querySelector(`[data-level="${code}"] .level-node__block`) as HTMLElement;
        block.getBoundingClientRect = () =>
          ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} }) as DOMRect;
      }
      return rendered;
    }
    const near = (container: HTMLElement, code: string) =>
      Number((container.querySelector(`[data-level="${code}"]`) as HTMLElement).style.getPropertyValue("--near") || 0);
    const field = (container: HTMLElement) => container.querySelector(".workspace") as HTMLElement;

    it("1 inside a block, less and less further away, 0 beyond its reach", () => {
      const { container } = laidOut();
      field(container).dispatchEvent(pointer("pointermove", { x: 75, y: 200 }));
      expect(near(container, "v2.l004")).toBe(1);
      expect(near(container, "v2.l005")).toBeGreaterThan(0);
      expect(near(container, "v2.l005")).toBeLessThan(0.5);
      expect(field(container).hasAttribute("data-pointer")).toBe(true);
      // 55px above L04's block: on the way, half awake or so.
      field(container).dispatchEvent(pointer("pointermove", { x: 75, y: 45 }));
      expect(near(container, "v2.l004")).toBeGreaterThan(0.3);
      expect(near(container, "v2.l004")).toBeLessThan(0.7);
      // Far below both: asleep.
      field(container).dispatchEvent(pointer("pointermove", { x: 75, y: 600 }));
      expect(near(container, "v2.l004")).toBe(0);
      expect(near(container, "v2.l005")).toBe(0);
    });

    it("lets every block go when the pointer leaves the module's field", () => {
      const { container } = laidOut();
      field(container).dispatchEvent(pointer("pointermove", { x: 200, y: 200 }));
      expect(near(container, "v2.l005")).toBe(1);
      field(container).dispatchEvent(pointer("pointerleave"));
      expect(near(container, "v2.l005")).toBe(0);
      expect(field(container).hasAttribute("data-pointer")).toBe(false);
    });

    it("wakes nothing under a finger", () => {
      const { container } = laidOut();
      field(container).dispatchEvent(pointer("pointermove", { x: 75, y: 200 }, "touch"));
      expect(near(container, "v2.l004")).toBe(0);
      expect(field(container).hasAttribute("data-pointer")).toBe(false);
    });

    it("holds the level whose way in has the keyboard, and lets it go after", () => {
      const { container } = laidOut();
      const go = container.querySelector("a.level-node__go") as HTMLAnchorElement;
      go.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(near(container, "v2.l005")).toBe(1);
      go.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
      expect(near(container, "v2.l005")).toBe(0);
    });

    it("eases from nothing to everything over the reach", () => {
      expect(nearnessAt(0)).toBe(1);
      expect(nearnessAt(NEAR_REACH)).toBe(0);
      expect(nearnessAt(NEAR_REACH * 3)).toBe(0);
      expect(nearnessAt(NEAR_REACH / 2)).toBeCloseTo(0.5, 5);
      expect(nearnessAt(NEAR_REACH * 0.25)).toBeGreaterThan(nearnessAt(NEAR_REACH * 0.75));
    });

    it("the stylesheet lights the branch and the outline from where it enters, and lets them go slowly", () => {
      const css = readFileSync(join(process.cwd(), "src/features/path-fidelity/path-hifi.css"), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      const fade = Number(/--flow-fade:\s*(\d+)ms/.exec(css)?.[1]);
      expect(fade).toBeGreaterThanOrEqual(600);
      // The nearness fades out slowly; while the pointer moves over the field it follows at once.
      expect(css).toMatch(/\.level-node--open \{[^}]*transition: --near var\(--flow-fade\)/);
      expect(css).toMatch(/\.workspace\[data-pointer\] \.level-node--open \{\s*transition: --near 140ms/);
      // The outline is lit from the branch's entry (22px in, on the top edge) and grows with nearness.
      expect(css).toMatch(/\.level-node__block::after \{[^}]*radial-gradient\(\s*calc\(var\(--near\) \* 140%\) calc\(var\(--near\) \* 110%\) at 22px 0/);
      // The branch ends at the block's top edge: 23px (the mark's foot) + 17px = 40px, where the block starts.
      expect(css).toMatch(/\.level-node__stem \{[^}]*top: 23px;[^}]*height: 17px;/);
      expect(css).toMatch(/\.level-node__block \{[^}]*inset: 40px 8px 0 0;/);
      // Nothing of the old line into the panel is left.
      expect(css).not.toMatch(/focus__leader|focus__flow|data-lit|data-glide/);
    });
  });
});
