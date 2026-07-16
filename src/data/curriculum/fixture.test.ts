import { describe, it, expect } from "vitest";
import {
  CURRICULUM,
  TOOL_UNLOCKS,
  COMMUNITY_UNLOCKS,
  MENTOR_REVIEW_REQUIREMENTS,
  REPORT_REQUIREMENTS,
  getModuleForLevel,
  getNextCheckpoint,
} from "@/data/curriculum/fixture";
import { formatThresholdUsd } from "@/domain/curriculum";

/**
 * Curriculum consistency (§22 D2A). The fixture is the typed translation of the
 * canonical les-prog.txt / CURRICULUM_AND_UNLOCKS.md — these tests pin it to the
 * canon so a refactor can never silently drift thresholds, unlocks or counts.
 */

const CANONICAL_THRESHOLDS: Record<number, number> = {
  4: 50, 10: 100, 15: 150, 20: 200, 25: 300, 30: 400, 35: 500, 40: 750,
  45: 1000, 50: 1500, 55: 2000, 60: 2500, 65: 3000, 70: 4000, 75: 5000,
  80: 6000, 85: 7000, 90: 8000, 95: 9000, 100: 10000,
};

describe("curriculum structure", () => {
  it("has exactly 20 modules", () => {
    expect(CURRICULUM.modules).toHaveLength(20);
  });

  it("has exactly 100 levels, unique, numbered 1..100 in order", () => {
    expect(CURRICULUM.levels).toHaveLength(100);
    const numbers = CURRICULUM.levels.map((l) => l.number);
    expect(new Set(numbers).size).toBe(100);
    expect(numbers).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    const codes = CURRICULUM.levels.map((l) => l.code);
    expect(new Set(codes).size).toBe(100);
    expect(codes[0]).toBe("level.001");
    expect(codes[99]).toBe("level.100");
  });

  it("every level belongs to exactly one module; ranges do not overlap and cover 1..100", () => {
    let cursor = 1;
    for (const mod of CURRICULUM.modules) {
      expect(mod.startLevel).toBe(cursor);
      expect(mod.endLevel).toBeGreaterThanOrEqual(mod.startLevel);
      for (const level of mod.levels) {
        expect(level.moduleCode).toBe(mod.code);
        expect(level.number).toBeGreaterThanOrEqual(mod.startLevel);
        expect(level.number).toBeLessThanOrEqual(mod.endLevel);
      }
      expect(mod.levels).toHaveLength(mod.endLevel - mod.startLevel + 1);
      cursor = mod.endLevel + 1;
    }
    expect(cursor).toBe(101);
  });

  it("module lookup agrees with ranges", () => {
    expect(getModuleForLevel(18).index).toBe(4);
    expect(getModuleForLevel(1).index).toBe(1);
    expect(getModuleForLevel(100).index).toBe(20);
  });
});

describe("checkpoints", () => {
  it("has exactly 20 checkpoints, one closing each module", () => {
    const checkpoints = CURRICULUM.levels.filter((l) => l.kind === "checkpoint");
    expect(checkpoints).toHaveLength(20);
    for (const mod of CURRICULUM.modules) {
      expect(mod.checkpoint.level).toBe(mod.endLevel);
      expect(mod.levels.at(-1)?.checkpoint).toBe(mod.checkpoint);
    }
  });

  it("thresholds match the canon exactly", () => {
    for (const mod of CURRICULUM.modules) {
      const expected = CANONICAL_THRESHOLDS[mod.checkpoint.level];
      expect(expected, `canon has threshold for L${mod.checkpoint.level}`).toBeDefined();
      expect(mod.checkpoint.thresholdUsd).toBe(expected);
    }
  });

  it("nearest checkpoint for L18 is L20 ($200 → Наблюдатель IV, Chart Markup Tool)", () => {
    const cp = getNextCheckpoint(18);
    expect(cp.level).toBe(20);
    expect(cp.thresholdUsd).toBe(200);
    expect(cp.rank.label).toBe("Наблюдатель IV");
    expect(cp.toolUnlock?.name).toBe("Chart Markup Tool");
  });

  it("rank ladder: 5 families × 4 tiers in canonical order", () => {
    const labels = CURRICULUM.modules.map((m) => m.checkpoint.rank.label);
    expect(labels[0]).toBe("Наблюдатель I");
    expect(labels[3]).toBe("Наблюдатель IV");
    expect(labels[4]).toBe("Аналитик I");
    expect(labels[8]).toBe("Тактик I");
    expect(labels[12]).toBe("Стратег I");
    expect(labels[16]).toBe("Архитектор рынка I");
    expect(labels[19]).toBe("Архитектор рынка IV");
    expect(new Set(labels).size).toBe(20);
  });
});

describe("unlock mapping", () => {
  it("has exactly 19 curriculum tools (L4 has none) and no secret tool", () => {
    expect(TOOL_UNLOCKS).toHaveLength(19);
    const codes = TOOL_UNLOCKS.map((t) => t.code);
    expect(new Set(codes).size).toBe(19);
    expect(codes).not.toContain("tool.secret");
    // L4 checkpoint has no tool
    expect(CURRICULUM.modules[0]?.checkpoint.toolUnlock).toBeUndefined();
  });

  it("tool unlock levels match the canon", () => {
    const byLevel = Object.fromEntries(TOOL_UNLOCKS.map((t) => [t.unlockLevel, t.name]));
    expect(byLevel[10]).toBe("Trading Journal");
    expect(byLevel[15]).toBe("Risk Calculator");
    expect(byLevel[20]).toBe("Chart Markup Tool");
    expect(byLevel[60]).toBe("Session Planner");
    expect(byLevel[65]).toBe("Strategy Statistics");
    expect(byLevel[100]).toBe("Pro Workspace");
  });

  it("community unlocks are exactly L4/L20/L35/L45/L85", () => {
    expect(COMMUNITY_UNLOCKS.map((c) => c.unlockLevel)).toEqual([4, 20, 35, 45, 85]);
  });

  it("mandatory mentor reviews are exactly L14/L29/L44/L59/L74/L84/L94", () => {
    expect(MENTOR_REVIEW_REQUIREMENTS.map((m) => m.levelNumber)).toEqual([
      14, 29, 44, 59, 74, 84, 94,
    ]);
  });

  it("report/practical artifacts include the canonical set", () => {
    const levels = REPORT_REQUIREMENTS.map((r) => r.levelNumber);
    for (const required of [1, 3, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59, 64, 69, 74, 79, 83, 84, 89, 94, 99]) {
      expect(levels, `artifact at L${required}`).toContain(required);
    }
  });
});

describe("naming rules", () => {
  it("no user-facing string contains TradeQuest or Alpha Trade", () => {
    const strings: string[] = [];
    for (const mod of CURRICULUM.modules) {
      strings.push(mod.title, mod.description);
      for (const l of mod.levels) {
        strings.push(l.title, l.artifact ?? "");
        if (l.checkpoint) {
          strings.push(l.checkpoint.rank.label);
          strings.push(l.checkpoint.toolUnlock?.name ?? "");
          strings.push(l.checkpoint.communityUnlock?.name ?? "");
        }
      }
    }
    for (const s of strings) {
      expect(s).not.toMatch(/tradequest/i);
      expect(s).not.toMatch(/alpha\s*trade/i);
    }
  });

  it("the product name appears only as Alfa Trade Academy", () => {
    const l2 = CURRICULUM.levels[1];
    expect(l2?.title).toBe("Как устроен Alfa Trade Academy");
  });

  it("threshold formatting is deterministic", () => {
    expect(formatThresholdUsd(200)).toBe("$200");
    expect(formatThresholdUsd(1500)).toMatch(/^\$1.500$/); // thousands separator, no comma
    expect(formatThresholdUsd(10000)).toMatch(/^\$10.000$/);
  });
});
