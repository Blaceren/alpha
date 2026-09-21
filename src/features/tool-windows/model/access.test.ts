import { describe, expect, it } from "vitest";
import type { AcademyCurriculumView, AcademyToolAccess } from "@/lib/curriculum/academy-view";
import {
  fixtureToolAccess,
  learnerCurrentLevel,
  levelTitleOf,
  resolveToolWindow,
  resolveToolWindows,
  toolAccessOf,
  toolAccessOpening,
} from "./access";

const states = (access: AcademyToolAccess | null) =>
  Object.fromEntries(resolveToolWindows(access).map((view) => [view.tool.slug, view.state]));

describe("resolveToolWindows — the Backend's verdict, joined to the catalogue", () => {
  it("locks every tool when there is no verdict", () => {
    expect(Object.values(states(null))).toEqual(["locked", "locked", "locked", "locked", "locked", "locked"]);
  });

  it("opens a built tool the verdict unlocks, and says «soon» for an unbuilt one", () => {
    const earned = [
      "tool.trade_card",
      "tool.trading_journal",
      "tool.risk_calculator",
      "tool.entry_checklist",
      "tool.personal_stats",
    ];
    expect(states(toolAccessOpening(earned))).toEqual({
      "trade-card": "open",
      journal: "open",
      "risk-calculator": "open",
      "entry-checklist": "open",
      stats: "soon",
      news: "locked",
    });
  });

  it("treats a tool the verdict does not mention as locked, and ignores codes it does not know", () => {
    const access: AcademyToolAccess = {
      total: 2,
      unlockedCount: 2,
      tools: [
        { code: "tool.chart_markup", unlocked: true, unlockLevel: 20 },
        { code: "tool.secret", unlocked: true, unlockLevel: 0 },
      ],
    };
    expect(Object.values(states(access)).every((state) => state === "locked")).toBe(true);
  });

  it("never opens a tool on anything but `unlocked: true`", () => {
    const access = {
      total: 1,
      unlockedCount: 1,
      tools: [{ code: "tool.trade_card", unlocked: "yes" as unknown as boolean, unlockLevel: 5 }],
    };
    expect(resolveToolWindow("trade-card", access)?.state).toBe("locked");
  });

  it("shows the Backend's level when it sends one", () => {
    const access: AcademyToolAccess = {
      total: 1,
      unlockedCount: 0,
      tools: [{ code: "tool.trade_card", unlocked: false, unlockLevel: 6 }],
    };
    expect(resolveToolWindow("trade-card", access)?.unlockLevel).toBe(6);
    expect(resolveToolWindow("journal", access)?.unlockLevel).toBe(10);
  });

  it("gives every tool its new-tab address", () => {
    expect(resolveToolWindows(null).map((view) => view.href)).toEqual([
      "/tools/trade-card",
      "/tools/journal",
      "/tools/risk-calculator",
      "/tools/entry-checklist",
      "/tools/stats",
      "/tools/news",
    ]);
  });
});

describe("fixture scenarios state their unlocks literally", () => {
  it("opens nothing early, the first three at L18, and the whole block late", () => {
    expect(fixtureToolAccess("early").unlockedCount).toBe(0);
    expect(fixtureToolAccess("report").unlockedCount).toBe(0);
    expect(fixtureToolAccess("active").tools.filter((tool) => tool.unlocked).map((tool) => tool.code)).toEqual([
      "tool.trade_card",
      "tool.trading_journal",
      "tool.risk_calculator",
    ]);
    expect(fixtureToolAccess("advanced").unlockedCount).toBe(6);
    expect(fixtureToolAccess("completed").unlockedCount).toBe(6);
  });
});

/* ------------------------------------------------------------ views */

/** Only the three fields these helpers read; the rest of a level is irrelevant here. */
function level(order: number, state: string, title = `Level ${order}`): never {
  return { order, state, title } as never;
}

function enrolledView(levels: never[], toolAccess: AcademyToolAccess | null = null): AcademyCurriculumView {
  return {
    state: "enrolled",
    curriculum: {} as never,
    modules: [{ levels } as never],
    progress: {} as never,
    toolAccess,
  };
}

describe("learnerCurrentLevel", () => {
  it("is one past the contiguous completed prefix", () => {
    const view = enrolledView([level(1, "completed"), level(2, "completed"), level(3, "current"), level(4, "locked")]);
    expect(learnerCurrentLevel(view)).toBe(3);
  });

  it("does not jump a gap", () => {
    const view = enrolledView([level(1, "completed"), level(2, "current"), level(3, "completed")]);
    expect(learnerCurrentLevel(view)).toBe(2);
  });

  it("is null without an enrolled progression", () => {
    expect(learnerCurrentLevel({ state: "unavailable", reason: "x" })).toBeNull();
  });
});

describe("levelTitleOf and toolAccessOf", () => {
  it("names the level that releases a tool", () => {
    const view = enrolledView([level(5, "current", "Жизненный цикл сделки")]);
    expect(levelTitleOf(view, 5)).toBe("Жизненный цикл сделки");
    expect(levelTitleOf(view, 6)).toBeNull();
  });

  it("reads the verdict only off an enrolled or completed view", () => {
    const access = toolAccessOpening(["tool.trade_card"]);
    expect(toolAccessOf({ ok: true, view: enrolledView([], access) })).toBe(access);
    expect(toolAccessOf({ ok: false, error: {} as never })).toBeNull();
    expect(toolAccessOf({ ok: true, view: { state: "unavailable", reason: "x" } })).toBeNull();
  });
});
