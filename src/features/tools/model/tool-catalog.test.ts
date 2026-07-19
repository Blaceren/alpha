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

  it("Trading Journal is the only available tool; unlock level 10", () => {
    const tj = getToolDefinition(TRADING_JOURNAL_CODE)!;
    expect(tj.implementationStatus).toBe("available");
    expect(tj.unlockLevel).toBe(10);
    const available = TOOL_DEFINITIONS.filter((t) => t.implementationStatus === "available");
    expect(available.map((t) => t.code)).toEqual([TRADING_JOURNAL_CODE]);
  });

  it("Risk Calculator (L15) is present but coming-soon", () => {
    const risk = getToolDefinition("tool.risk_calculator")!;
    expect(risk.unlockLevel).toBe(15);
    expect(risk.implementationStatus).toBe("coming-soon");
  });

  it("getToolDefinition returns null for an unknown code", () => {
    expect(getToolDefinition("tool.nope")).toBeNull();
  });
});
