import { describe, expect, it } from "vitest";
import { TOOL_UNLOCKS } from "@/data/curriculum/fixture";
import {
  RETIRED_TOOL_CODES,
  TOOL_WINDOWS,
  toolWindowByCode,
  toolWindowBySlug,
  toolWindowHref,
} from "./catalog";

describe("TOOLS-V2 catalogue", () => {
  it("is the owner's first block of six, in unlock order", () => {
    expect(TOOL_WINDOWS.map((tool) => [tool.unlockLevel, tool.code, tool.slug, tool.title])).toEqual([
      [5, "tool.trade_card", "trade-card", "Trade Card"],
      [10, "tool.trading_journal", "journal", "Trading Journal"],
      [15, "tool.risk_calculator", "risk-calculator", "Risk Calculator"],
      [20, "tool.entry_checklist", "entry-checklist", "Entry Checklist"],
      [25, "tool.personal_stats", "stats", "Personal Stats"],
      [30, "tool.news_calendar", "news", "News Calendar"],
    ]);
  });

  it("releases the Trade Card by a lesson and the rest by a checkpoint", () => {
    expect(TOOL_WINDOWS.filter((tool) => tool.releasedBy === "lesson").map((tool) => tool.code)).toEqual([
      "tool.trade_card",
    ]);
  });

  it("agrees with the curriculum fixture on every checkpoint tool, name and level", () => {
    const fromCheckpoints = TOOL_UNLOCKS.map((unlock) => [unlock.code, unlock.name, unlock.unlockLevel]);
    const fromCatalogue = TOOL_WINDOWS.filter((tool) => tool.releasedBy === "checkpoint").map((tool) => [
      tool.code,
      tool.title,
      tool.unlockLevel,
    ]);
    expect(fromCatalogue).toEqual(fromCheckpoints);
  });

  it("builds the first three tools so far, one tool at a time", () => {
    expect(TOOL_WINDOWS.filter((tool) => tool.built).map((tool) => tool.slug)).toEqual([
      "trade-card",
      "journal",
      "risk-calculator",
    ]);
  });

  it("has unique codes and slugs, and slugs that are safe path segments", () => {
    expect(new Set(TOOL_WINDOWS.map((tool) => tool.code)).size).toBe(6);
    expect(new Set(TOOL_WINDOWS.map((tool) => tool.slug)).size).toBe(6);
    for (const tool of TOOL_WINDOWS) {
      expect(tool.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(toolWindowHref(tool.slug)).toBe(`/tools/${tool.slug}`);
      expect(tool.description.trim().length).toBeGreaterThan(20);
    }
  });

  it("looks tools up by slug and by code, and nothing else", () => {
    expect(toolWindowBySlug("trade-card")?.code).toBe("tool.trade_card");
    expect(toolWindowByCode("tool.news_calendar")?.slug).toBe("news");
    expect(toolWindowBySlug("tool.trade_card")).toBeNull();
    expect(toolWindowByCode("trade-card")).toBeNull();
    expect(toolWindowBySlug("nope")).toBeNull();
  });

  it("keeps the retired codes out of the catalogue", () => {
    const current = new Set(TOOL_WINDOWS.map((tool) => tool.code));
    expect(RETIRED_TOOL_CODES).toHaveLength(16);
    for (const code of RETIRED_TOOL_CODES) expect(current.has(code), code).toBe(false);
  });
});
