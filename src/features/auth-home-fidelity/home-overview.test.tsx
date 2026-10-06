/**
 * HOME, FILLED AND HI-FI (owner, 2026-10-03: «наполни внутреннюю главную,
 * после сделай ее хай фай»; DD-337).
 *
 * The page around the priority says where the learner is, what they have and
 * what changed — every line read from what the Backend sent, nothing decided
 * here, no amount anywhere. And the priority stays the page's one h1 and its
 * one call to act.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { programPosition } from "@/lib/curriculum/program-points";
import { resolveToolWindows } from "@/features/tool-windows/model/access";
import {
  greetingLine,
  greetingName,
  homeFacts,
  homeNewsRows,
  stepAside,
  toolRack,
  whereLine,
  currentShare,
} from "@/features/auth-home-fidelity/home-overview-model";
import { HomeOverview } from "@/features/auth-home-fidelity/home-overview";
import { HomeProgramLine, litStop } from "@/features/auth-home-fidelity/home-program-line";
import { HomeNews, HOME_NEWS_COPY } from "@/features/auth-home-fidelity/home-news";
import { AuthHomeField } from "@/features/auth-home-fidelity/auth-home-field";
import { fieldForAction } from "@/features/auth-home-fidelity/auth-home-state";
import { deriveNextAction } from "@/lib/curriculum/next-action";
import { levelFourProgram, program } from "@/test/program-fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const TOOLS = {
  total: 6,
  unlockedCount: 1,
  tools: [
    { code: "tool.trade_card", unlocked: true, unlockLevel: 5 },
    { code: "tool.trading_journal", unlocked: false, unlockLevel: 9 },
    { code: "tool.risk_calculator", unlocked: false, unlockLevel: 13 },
  ],
};

const SRC = (f: string) => readFileSync(join(process.cwd(), "src/features/auth-home-fidelity", f), "utf8");
const NEW_FILES = ["home-overview.tsx", "home-overview-model.ts", "home-program-line.tsx", "home-news.tsx"];

describe("the program as points", () => {
  it("reads each level's place from the curriculum: done, current, ahead, preparing", () => {
    const position = programPosition(levelFourProgram());
    const states = position.modules.flatMap((m) => m.points.map((p) => p.state));
    expect(states.slice(0, 5)).toEqual(["done", "done", "done", "current", "ahead"]);
    expect(states.filter((s) => s === "preparing")).toHaveLength(16);
    expect(position.current!.point.order).toBe(4);
    expect(position.focusModule!.order).toBe(1);
    expect([position.completed, position.total, position.open, position.xp]).toEqual([3, 30, 14, 300]);
  });

  it("opens only the levels the learner may open", () => {
    const points = programPosition(levelFourProgram()).modules.flatMap((m) => m.points);
    expect(points.filter((p) => p.href !== null).map((p) => p.order)).toEqual([1, 2, 3, 4]);
  });

  it("with every open level done, has no current point and looks at what opens next", () => {
    const view = program([{ levels: "ddd" }, { levels: "ppp" }, { levels: "ppp" }]);
    const position = programPosition(view);
    expect(position.current).toBeNull();
    expect(position.focusModule!.order).toBe(2);
    expect(whereLine(position)).toBe("Дальше: модуль 2 из 3");
  });
});

describe("what the page says around the priority", () => {
  it("greets by the first name, formally, with no time of day", () => {
    expect(greetingName("Вера Четвёртая")).toBe("Вера");
    expect(greetingName("  ")).toBeNull();
    expect(greetingLine("Вера")).toBe("Здравствуйте, Вера");
    expect(greetingLine(null)).toBe("Здравствуйте");
  });

  it("says where the learner is: the chapter, its title and the module", () => {
    const position = programPosition(levelFourProgram());
    expect(whereLine(position)).toBe("Глава 1 · Основы и первые реальные сделки · модуль 1 из 6");
  });

  it("counts, and never an amount", () => {
    const position = programPosition(levelFourProgram());
    const facts = homeFacts(position, resolveToolWindows(TOOLS));
    expect(facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["опыт: 300 XP", "пройдено: 3 из 30", "инструменты: 1 из 6"]);
    expect(homeFacts(programPosition(levelFourProgram({ xp: null })), null).map((f) => f.key)).toEqual(["levels"]);
  });

  it("names what this step gives and opens beside the priority", () => {
    const view = program([{ levels: "ddddc" }, { levels: "aaaa" }]);
    const aside = stepAside(programPosition(view), resolveToolWindows({ ...TOOLS, tools: [{ code: "tool.trade_card", unlocked: false, unlockLevel: 5 }] }));
    expect(aside).toEqual({ kind: "step", reward: 100, next: { order: 6, title: "Тема 6", preparing: false }, opens: ["Trade Card"] });
  });

  it("rests when everything open is done, and says nothing when the read has no position", () => {
    const resting = stepAside(programPosition(program([{ levels: "dd" }, { levels: "pp" }])), null);
    expect(resting).toEqual({ kind: "rest" });
    expect(stepAside(programPosition(program([{ levels: "dd" }])), null)).toBeNull();
  });

  it("lists the tools the learner has and the next one by its level", () => {
    const rack = toolRack(resolveToolWindows(TOOLS));
    expect(rack.open.map((t) => t.tool.title)).toEqual(["Trade Card"]);
    expect(rack.next!.tool.title).toBe("Trading Journal");
    expect(rack.next!.unlockLevel).toBe(9);
    expect(rack.total).toBe(6);
  });
});

describe("the program line", () => {
  it("is a picture with one sentence for a screen reader", () => {
    const { container } = render(<HomeProgramLine position={programPosition(levelFourProgram())} />);
    const figure = screen.getByRole("img");
    expect(figure.getAttribute("aria-label")).toBe(
      "Программа: 30 уровней в 6 модулях, пройдено 3, сейчас уровень 4, ещё 16 готовятся.",
    );
    expect(container.querySelectorAll(".hm-pt")).toHaveLength(30);
    expect(container.querySelectorAll(".hm-pt--current")).toHaveLength(1);
    expect(container.querySelectorAll("a, button")).toHaveLength(0);
  });

  it("names each chapter once, where it starts, and marks a chapter still being prepared", () => {
    const { container } = render(<HomeProgramLine position={programPosition(levelFourProgram())} />);
    const chapters = [...container.querySelectorAll(".hm-mod__chapter")].map((c) => c.textContent);
    expect(chapters).toEqual(["Глава 1 · Основы и первые реальные сделки", "Глава 2 · Чтение графика · готовится"]);
    expect(container.querySelectorAll('.hm-mod[data-preparing="1"]')).toHaveLength(3);
    expect(container.querySelectorAll('.hm-mod[data-chapter-start="1"]')).toHaveLength(1);
  });

  it("lights each module's stretch to its last done or current point", () => {
    const [first, second, , fourth] = programPosition(levelFourProgram()).modules;
    expect(litStop(first!)).toBe("calc(var(--hm-pt-half) + (100% - 2 * var(--hm-pt-half)) * 0.7500)");
    expect(litStop(second!)).toBe("0%");
    expect(litStop(fourth!)).toBe("0%");
    expect(litStop(programPosition(program([{ levels: "ddd" }, { levels: "ca" }])).modules[0]!)).toBe("100%");
  });

  it("places the frame's light where the current point is", () => {
    expect(currentShare(programPosition(levelFourProgram()))).toBeCloseTo(3.5 / 30, 5);
  });
});

describe("the page", () => {
  const view = levelFourProgram({ tools: TOOLS });
  const page = () =>
    render(
      <HomeOverview
        name="Вера"
        position={programPosition(view)}
        tools={resolveToolWindows(view.toolAccess)}
        news={[]}
        priority={<AuthHomeField field={fieldForAction(deriveNextAction(view))} />}
      />,
    );

  it("keeps the priority as its one h1 and its one call to act", () => {
    const { container } = page();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")!.className).toBe("home-consequence");
    expect(container.querySelectorAll(".home-handoff")).toHaveLength(1);
    expect(screen.getByText("Здравствуйте, Вера").tagName).toBe("P");
  });

  it("hangs the priority from the current point", () => {
    const { container } = page();
    expect(container.querySelector(".hm-now")!.getAttribute("data-attached")).toBe("1");
    expect((container.querySelector(".hm-now") as HTMLElement).style.getPropertyValue("--hm-x")).toBe("11.67%");
  });

  it("lists the module's levels, links only the open ones, and marks the current step", () => {
    const { container } = page();
    const block = container.querySelector(".hm-module")!;
    expect(within(block as HTMLElement).getByRole("heading", { level: 2 }).textContent).toBe("Модуль 1");
    const rows = [...block.querySelectorAll(".hm-level")];
    expect(rows.map((r) => r.querySelector("a") !== null)).toEqual([true, true, true, true, false]);
    expect(block.querySelector('[aria-current="step"]')!.textContent).toContain("Тема 4");
    expect(block.querySelector(".hm-module__next")!.textContent).toBe("Дальше: модуль 2 «Модуль 2» · уровни 6–9");
  });

  it("draws nothing around the priority without a curriculum", () => {
    const { container } = render(
      <HomeOverview name={null} position={null} tools={null} news={null} priority={<p>priority</p>} />,
    );
    expect(container.querySelector(".hm-line")).toBeNull();
    expect(container.querySelector(".hm-lower")).toBeNull();
    expect(container.querySelector(".hm-facts")).toBeNull();
    expect(screen.getByText("Здравствуйте")).toBeTruthy();
  });
});

describe("«Что нового»", () => {
  const row = (id: number, type: string, createdAt: string, readAt: string | null = null) => ({
    id,
    type,
    title: `Событие ${id}`,
    message: null,
    readAt,
    createdAt,
  });

  it("keeps the newest rows, narrowed, and passes an unreadable register through as unknown", () => {
    const rows = homeNewsRows([
      row(1, "system", "2026-10-01T10:00:00Z"),
      row(2, "level_up", "2026-10-03T10:00:00Z"),
      { nonsense: true },
      row(3, "support_reply", "2026-10-02T10:00:00Z"),
    ]);
    expect(rows!.map((r) => r.id)).toEqual([2, 3, 1]);
    expect(homeNewsRows(null)).toBeNull();
  });

  it("shows three, through the register's own rules — a withheld section's events stay out", () => {
    const rows = homeNewsRows([
      row(1, "community_reply", "2026-10-03T12:00:00Z"),
      row(2, "level_up", "2026-10-03T11:00:00Z"),
      row(3, "support_reply", "2026-10-03T10:00:00Z", "2026-10-03T10:30:00Z"),
      row(4, "system", "2026-10-03T09:00:00Z"),
      row(5, "system", "2026-10-03T08:00:00Z"),
    ]);
    const { container } = render(<HomeNews rows={rows} />);
    const items = [...container.querySelectorAll(".hm-news__item")];
    expect(items.map((li) => li.querySelector(".hm-news__change")!.textContent)).toEqual([
      "не прочитано: Событие 2",
      "Событие 3",
      "не прочитано: Событие 4",
    ]);
    expect(container.textContent).not.toContain("Сообщество");
    expect(screen.getByRole("link", { name: HOME_NEWS_COPY.all })).toHaveAttribute("href", "/notifications");
  });

  it("says so when there is nothing, and when the register could not be read", () => {
    const empty = render(<HomeNews rows={[]} />);
    expect(empty.container.textContent).toContain(HOME_NEWS_COPY.empty);
    empty.unmount();
    const unknown = render(<HomeNews rows={null} />);
    expect(unknown.container.textContent).toContain(HOME_NEWS_COPY.unavailable);
  });
});

describe("what the filled Home never says", () => {
  const code = NEW_FILES.map((f) => SRC(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n");

  it("no balance, no deposit, no amount, nothing of Pocket", () => {
    for (const word of ["balance", "баланс", "deposit", "депозит", "Pocket", "вывод средств"]) {
      expect(code, word).not.toContain(word);
    }
    expect(code).not.toMatch(/\$\s?\d/);
  });

  it("no time-of-day greeting — the server does not know the learner's clock", () => {
    for (const word of ["Доброе утро", "Добрый день", "Добрый вечер", "getHours"]) {
      expect(code, word).not.toContain(word);
    }
  });
});

describe("the stylesheet is scoped and canonical", () => {
  const css = SRC("home-hifi.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("lets no selector escape `.hm`", () => {
    const heads = [...css.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? "").trim()).filter((h) => h && !h.startsWith("@"));
    for (const head of heads) {
      for (const part of head.split(",").map((p) => p.trim()).filter(Boolean)) {
        expect(part.startsWith(".hm"), part).toBe(true);
      }
    }
  });

  it("uses the canonical breakpoints only", () => {
    const widths = [...css.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)].map((m) => `${m[1]}-${m[2]}`);
    for (const w of widths) expect(["max-599", "max-899", "min-900", "max-1199"], w).toContain(w);
  });

  it("keeps Signal off completion: done points and done rows are grey", () => {
    const rule = (sel: string) => css.slice(css.indexOf(sel + " {"), css.indexOf("}", css.indexOf(sel + " {")));
    expect(rule(".hm .hm-pt--done::before")).not.toContain("signal");
    expect(rule(".hm .hm-level--done .hm-level__mark")).not.toContain("signal");
  });
});

/* ====================================================================== *
 * THE FIVE ROWS (DD-348, owner 2026-10-06): «показываем 3 уровня которые
 * пройдены ранее, 1 актуальный и 1 следующий, вместо готовиться кнопки
 * открытия урока и подсветка по мере завершения»; the next level dimmed,
 * without a button (the owner's answer).
 * ====================================================================== */
describe("the Home list: three walked, the learner's level, the next", () => {
  const rowsOf = (container: HTMLElement) =>
    [...container.querySelectorAll(".hm-module .hm-level")].map((li) => ({
      code: li.querySelector(".hm-level__code")!.textContent,
      link: li.querySelector("a")?.getAttribute("href") ?? null,
      go: li.querySelector(".hm-level__go")?.textContent ?? null,
      word: li.querySelector(".hm-level__state")?.textContent ?? null,
      module: li.querySelector(".hm-level__module")?.textContent ?? null,
      edge: li.classList.contains("hm-level--edge"),
      here: li.getAttribute("aria-current") === "step",
    }));
  const show = (view: ReturnType<typeof program>) =>
    render(<HomeOverview name="Вера" position={programPosition(view)} tools={null} news={null} priority={<p>p</p>} />).container;

  it("with every open level done, stands on the first one being prepared — «Начать» there, as on Path", async () => {
    const { homeListRows } = await import("@/features/auth-home-fidelity/home-overview-model");
    const view = program([{ levels: "ddd" }, { levels: "ddd" }, { levels: "ppp" }]);
    expect(homeListRows(programPosition(view)).map((r) => `${r.point.order}:${r.role}`)).toEqual([
      "4:walked", "5:walked", "6:walked", "7:here", "8:next",
    ]);
    const rows = rowsOf(show(view));
    expect(rows.map((r) => r.code)).toEqual(["L04", "L05", "L06", "L07", "L08"]);
    expect(rows.slice(0, 3).map((r) => r.go)).toEqual(["Открыть урок", "Открыть урок", "Открыть урок"]);
    expect(rows[3]).toMatchObject({ go: "Начать", here: true, edge: true, link: "/lessons/v5.l007" });
    expect(rows[4]).toMatchObject({ go: null, link: null, word: "готовится" });
    // The walked levels of another module say which, once, on the first row of the run.
    expect(rows.map((r) => r.module)).toEqual([" · модуль 2", null, null, null, null]);
  });

  it("in the middle of an open module: walked, current, and the next level closed and dim", () => {
    const rows = rowsOf(show(levelFourProgram()));
    expect(rows.map((r) => [r.code, r.go ?? r.word])).toEqual([
      ["L01", "Открыть урок"], ["L02", "Открыть урок"], ["L03", "Открыть урок"], ["L04", "Начать"], ["L05", "откроется следующим"],
    ]);
    expect(rows.map((r) => r.link !== null)).toEqual([true, true, true, true, false]);
  });

  it("at the start of the program the five shift ahead, and what is further says «впереди»", () => {
    const rows = rowsOf(show(program([{ levels: "caaaa" }, { levels: "aaa" }])));
    expect(rows.map((r) => [r.code, r.go ?? r.word])).toEqual([
      ["L01", "Начать"], ["L02", "откроется следующим"], ["L03", "впереди"], ["L04", "впереди"], ["L05", "впереди"],
    ]);
  });

  it("runs into the next module where the next level is there", () => {
    const rows = rowsOf(show(program([{ levels: "ddddc" }, { levels: "ppp" }])));
    expect(rows.map((r) => r.code)).toEqual(["L02", "L03", "L04", "L05", "L06"]);
    expect(rows[4]).toMatchObject({ edge: true, module: " · модуль 2", word: "готовится", link: null });
  });

  it("keeps the spine's light on walked rows and Signal on the learner's row only", () => {
    const css = SRC("home-hifi.css");
    const rule = (sel: string) => css.slice(css.indexOf(sel + " {"), css.indexOf("}", css.indexOf(sel + " {")));
    expect(rule(".hm .hm-level--done:not(:last-child)::before")).toContain("var(--hm-axis-done)");
    expect(rule(".hm .hm-level__go--start")).toContain("var(--signal-active)");
    expect(rule(".hm .hm-level__go")).not.toContain("signal");
  });
});

describe("Home's head is one block: the greeting leads, the figures follow smaller (DD-351)", () => {
  const css = SRC("home-hifi.css");
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("one raised plate holds both; the figures carry no surface of their own", () => {
    expect(rule(".hm .hm-head")).toContain("background: var(--hf-light), var(--hf-surface-raised)");
    expect(rule(".hm .hm-head")).toContain("border-radius: var(--hf-radius-window)");
    expect(rule(".hm .hm-head__who")).not.toContain("background");
    expect(rule(".hm .hm-facts")).not.toContain("background");
    expect(rule(".hm .hm-facts")).not.toContain("border:");
  });

  it("the figures are smaller than the greeting's statement", () => {
    expect(rule(".hm .hm-fact dd")).toContain("17px");
    expect(rule(".hm .hm-greeting")).toContain("var(--hf-title-xl)");
  });

  it("the XP is still the one lit figure", () => {
    expect(rule('.hm .hm-fact[data-fact="xp"] dd')).toContain("var(--signal-active)");
    expect(rule('.hm .hm-fact[data-fact="xp"]')).toContain("border-radius: 8px");
    const { container } = render(
      <HomeOverview name="Вера" position={programPosition(levelFourProgram({ xp: 300 }))} tools={null} news={null} priority={<p>p</p>} />,
    );
    const head = container.querySelector(".hm-head")!;
    expect(head.querySelector(".hm-head__who .hm-greeting")).not.toBeNull();
    expect(head.querySelector('.hm-facts .hm-fact[data-fact="xp"] dd')!.textContent).toBe("300 XP");
  });
});
