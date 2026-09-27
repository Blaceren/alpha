import { describe, expect, it } from "vitest";
import { TOOL_UNLOCKS } from "@/data/curriculum/fixture";
import {
  getToolDefinition,
  TOOL_DEFINITIONS,
  TRADING_JOURNAL_CODE,
} from "@/features/tools/model/tool-catalog";

describe("tool catalog", () => {
  it("mirrors the canonical curriculum unlocks 1:1 (no invented tools)", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(TOOL_UNLOCKS.length);
    const codes = new Set(TOOL_DEFINITIONS.map((t) => t.code));
    for (const unlock of TOOL_UNLOCKS) expect(codes.has(unlock.code)).toBe(true);
  });

  it("reads unlock levels FROM the curriculum, never re-declares them", () => {
    for (const def of TOOL_DEFINITIONS) {
      const unlock = TOOL_UNLOCKS.find((u) => u.code === def.code)!;
      expect(def.unlockLevel).toBe(unlock.unlockLevel);
      expect(def.title).toBe(unlock.name);
    }
  });

  it("Trading Journal is available at level 10 with its own CTA copy", () => {
    const tj = getToolDefinition(TRADING_JOURNAL_CODE)!;
    expect(tj.implementationStatus).toBe("available");
    expect(tj.unlockLevel).toBe(10);
    expect(tj.ctaLabel).toBe("Открыть журнал");
  });

  it("Risk Calculator (L15) is available (D4-C) with its own CTA copy", () => {
    const risk = getToolDefinition("tool.risk_calculator")!;
    expect(risk.unlockLevel).toBe(15);
    expect(risk.implementationStatus).toBe("available");
    expect(risk.ctaLabel).toBe("Открыть калькулятор");
  });

  it("exactly the Trading Journal and Risk Calculator are available so far", () => {
    const available = TOOL_DEFINITIONS.filter((t) => t.implementationStatus === "available");
    expect(available.map((t) => t.code).sort()).toEqual(
      ["tool.risk_calculator", TRADING_JOURNAL_CODE].sort(),
    );
  });

  it("coming-soon tools fall back to the neutral CTA (no per-tool label hardcoded)", () => {
    const soon = TOOL_DEFINITIONS.filter((t) => t.implementationStatus === "coming-soon");
    for (const t of soon) expect(t.ctaLabel).toBe("Открыть инструмент");
    expect(soon.length).toBeGreaterThan(0);
  });

  it("getToolDefinition returns null for an unknown code", () => {
    expect(getToolDefinition("tool.nope")).toBeNull();
  });
});
