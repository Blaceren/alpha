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
  levelCodeLabel,
  moduleKicker,
  PATH_WAITING_EXTERNAL,
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
    ).toBe("waiting");
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
    expect(
      waitingLine(level({ order: 1, state: "available", completionMethod: "external-event" })),
    ).toBe(PATH_WAITING_EXTERNAL);
  });

  it("addresses the learner formally, as the product's copy contract requires", () => {
    for (const row of [PATH_WAITING_EXTERNAL, PATH_WAITING_REVIEW]) {
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
  });

  it("keeps the frozen code and kicker formats", () => {
    expect(levelCodeLabel(7)).toBe("L07");
    expect(levelCodeLabel(11)).toBe("L11");
    expect(moduleKicker(3, 20)).toBe("Модуль 03 / 20");
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
    expect(container.querySelector(".mod-nav__scale")?.textContent).toContain(
      "Модуль 2 из 3 — текущий",
    );
    expect(container.querySelector(".mod-nav__scale")?.textContent).toContain(
      "Завершено модулей: 1 · Впереди: 1",
    );
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

  it("keeps the Decision Frame whole — leader, both corners, and the focused heading", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    const focus = container.querySelector(".focus");
    expect(focus).not.toBeNull();
    expect(focus!.querySelector("[data-leader]")).not.toBeNull();
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
      "[data-leader]",
      "[data-detail-title]",
      "[data-return]",
      ".rail",
      ".level-node__mark",
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
    expect(container.querySelector(".workspace__kicker")?.textContent).toBe("Модуль 02 / 3");
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
    expect(container.querySelector(".level-node--current .level-node__state")?.textContent).toBe(
      "текущий · на проверке",
    );
  });

  it("an external-event level says the provider is the one being waited on", () => {
    const view = standardView({
      state: "available",
      stateLabel: "Ждёт внешнего подтверждения",
      completionMethod: "external-event",
      routeAccessible: true,
      shortDescription: null,
    });
    const { container } = render(<PathFidelityView view={view} userName="Тест" />);
    expect(container.querySelector(".focus__body")?.textContent).toContain(PATH_WAITING_EXTERNAL);
    expect(container.querySelector(".focus__state")?.className).toContain("focus__state--waiting");
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

  it("explains why the next level has not opened, using that level's own reason", () => {
    const { container } = render(<PathFidelityView view={standardView()} userName="Тест" />);
    const reason = container.querySelector(".level-node--next .level-node__reason")?.textContent;
    expect(reason).toBe("Сначала нужно завершить предыдущие уровни.");
    expect(container.querySelector(".focus__next")?.textContent).toBe(reason);
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
      "Как устроен Alfa Trade Academy",
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
