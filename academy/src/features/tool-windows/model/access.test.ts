import { describe, expect, it } from "vitest";
import type { AcademyCurriculumView, AcademyToolAccess } from "@/lib/curriculum/academy-view";
import {
  fixtureToolAccess,
  learnerCurrentLevel,
  levelTitleOf,
  releasingLevelOf,
  resolveToolWindow,
  resolveToolWindows,
  toolAccessOf,
  toolAccessOpening,
} from "./access";
import { TOOL_WINDOWS } from "./catalog";

const states = (access: AcademyToolAccess | null) =>
  Object.fromEntries(resolveToolWindows(access).map((view) => [view.tool.slug, view.state]));

describe("resolveToolWindows — the Backend's verdict, joined to the catalogue", () => {
  it("locks every tool when there is no verdict", () => {
    expect(Object.values(states(null))).toEqual(["locked", "locked", "locked", "locked", "locked", "locked"]);
  });

  it("opens every built tool the verdict unlocks", () => {
    expect(states(toolAccessOpening(TOOL_WINDOWS.map((tool) => tool.code)))).toEqual({
      "trade-card": "open",
      journal: "open",
      "risk-calculator": "open",
      "entry-checklist": "open",
      stats: "open",
      news: "open",
    });
  });

  it("says «soon» for a tool the verdict unlocks and this build does not have", () => {
    // All six are built; a catalogue with one not built yet keeps the state provable.
    const catalogue = TOOL_WINDOWS.map((tool) => (tool.slug === "news" ? { ...tool, built: false } : tool));
    const views = resolveToolWindows(toolAccessOpening(TOOL_WINDOWS.map((tool) => tool.code)), catalogue);
    expect(views.find((view) => view.tool.slug === "news")?.state).toBe("soon");
    expect(views.find((view) => view.tool.slug === "stats")?.state).toBe("open");
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

/**
 * 2026-10-02 — what the level that releases a tool IS, in the learner's own
 * program. Only ever said on a locked tool's page; never used to decide one.
 */
describe("releasingLevelOf", () => {
  const full = (order: number, extra: Record<string, unknown>): never =>
    ({ order, state: "locked", title: `Level ${order}`, inProduction: false, kind: null, ...extra }) as never;

  it("tells a checkpoint, a lesson and another kind of level apart", () => {
    const view = enrolledView([
      full(5, { typeInfo: { type: "lesson", isCheckpoint: false }, kind: "lesson", title: "Жизненный цикл сделки" }),
      full(9, { typeInfo: { type: "report", isCheckpoint: false }, kind: "report" }),
      full(10, { typeInfo: { type: "checkpoint", isCheckpoint: true } }),
      full(13, { typeInfo: { type: "lesson", isCheckpoint: false }, kind: "practice" }),
      full(18, { typeInfo: { type: "lesson", isCheckpoint: false } }),
    ]);
    expect(releasingLevelOf(view, 5)).toEqual({ title: "Жизненный цикл сделки", kind: "lesson", inProduction: false });
    expect(releasingLevelOf(view, 9)?.kind).toBe("level");
    expect(releasingLevelOf(view, 10)?.kind).toBe("checkpoint");
    // A practical level is a `lesson` to the Backend and not one to its author.
    expect(releasingLevelOf(view, 13)?.kind).toBe("level");
    // A program that names no kinds: the type decides.
    expect(releasingLevelOf(view, 18)?.kind).toBe("lesson");
  });

  it("says when that level is itself not open yet", () => {
    const view = enrolledView([full(24, { typeInfo: { type: "lesson", isCheckpoint: false }, kind: "assembly", inProduction: true })]);
    expect(releasingLevelOf(view, 24)).toEqual({ title: "Level 24", kind: "level", inProduction: true });
  });

  it("answers `unknown` for a view that does not say what the level is, and null for one that has no such level", () => {
    const view = enrolledView([level(5, "current", "Жизненный цикл сделки")]);
    expect(releasingLevelOf(view, 5)).toEqual({ title: "Жизненный цикл сделки", kind: "unknown", inProduction: false });
    expect(releasingLevelOf(view, 6)).toBeNull();
    expect(releasingLevelOf({ state: "unavailable", reason: "x" }, 5)).toBeNull();
  });
});
