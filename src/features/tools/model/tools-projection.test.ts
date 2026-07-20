import { describe, expect, it } from "vitest";
import { getPathProgress } from "@/features/path/model/path-state";
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import {
  isToolUnlocked,
  projectTool,
  projectTools,
} from "@/features/tools/model/tools-projection";

const artem = getPathProgress("active"); // canonical Артём, L18
const early = getPathProgress("early"); // L2

function view(code: string, progress = artem) {
  const found = projectTools(progress).find((v) => v.code === code);
  if (!found) throw new Error(`no view for ${code}`);
  return found;
}

describe("tools projection — resolver-owned unlock", () => {
  it("projects every curriculum tool, in unlock order", () => {
    const views = projectTools(artem);
    expect(views).toHaveLength(TOOL_DEFINITIONS.length);
    const levels = views.map((v) => v.unlockLevel);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it("canonical Артём (L18): Trading Journal is unlocked AND available (not current)", () => {
    const tj = view("tool.trading_journal");
    expect(tj.unlocked).toBe(true);
    expect(tj.available).toBe(true);
    // Risk Calculator (L15) is the higher available tool, so it takes the head.
    expect(tj.current).toBe(false);
    expect(tj.href).toBe("/tools/tool.trading_journal");
    expect(tj.ctaLabel).toBe("Открыть журнал");
  });

  it("canonical Артём: Risk Calculator (L15) is available and the current head (D4-C)", () => {
    const risk = view("tool.risk_calculator");
    expect(risk.unlocked).toBe(true);
    expect(risk.available).toBe(true);
    expect(risk.current).toBe(true);
    expect(risk.href).toBe("/tools/tool.risk_calculator");
    expect(risk.statusLabel).toBe("Открыт · рабочий инструмент");
    expect(risk.ctaLabel).toBe("Открыть калькулятор");
  });

  it("the current head is the highest-level available tool (Risk L15 > Journal L10)", () => {
    const current = projectTools(artem).find((v) => v.current);
    expect(current?.code).toBe("tool.risk_calculator");
  });

  it("Risk Calculator honours the resolver boundary: L15 passed available, L14/L15-standing locked", () => {
    // Standing on L14 → L15 not reached → locked.
    expect(view("tool.risk_calculator", { ...artem, currentLevel: 14 }).available).toBe(false);
    expect(view("tool.risk_calculator", { ...artem, currentLevel: 14 }).unlocked).toBe(false);
    // Standing ON L15 (the gate) → not passed yet → still locked (no form).
    expect(view("tool.risk_calculator", { ...artem, currentLevel: 15 }).unlocked).toBe(false);
    // One past L15 → passed → available with its route.
    const passed = view("tool.risk_calculator", { ...artem, currentLevel: 16 });
    expect(passed.unlocked).toBe(true);
    expect(passed.available).toBe(true);
    expect(passed.href).toBe("/tools/tool.risk_calculator");
  });

  it("canonical Артём: Chart Markup (L20) and Indicator Checklist (L25) are locked", () => {
    for (const code of ["tool.chart_markup", "tool.indicator_checklist"]) {
      const v = view(code);
      expect(v.unlocked).toBe(false);
      expect(v.available).toBe(false);
      expect(v.href).toBeNull();
    }
    expect(view("tool.chart_markup").statusLabel).toBe("Откроется на уровне 20");
    expect(view("tool.indicator_checklist").statusLabel).toBe("Откроется на уровне 25");
  });

  it("earlier progression (L2) locks Trading Journal too", () => {
    const tj = view("tool.trading_journal", early);
    expect(tj.unlocked).toBe(false);
    expect(tj.available).toBe(false);
    expect(tj.href).toBeNull();
    // No tool is current when nothing is available yet — a legitimate hub state.
    expect(projectTools(early).some((v) => v.current)).toBe(false);
  });

  it("standing ON the checkpoint level does not unlock the reward yet", () => {
    // A synthetic marker standing exactly on L10 (the Trading Journal gate).
    const onGate = { ...artem, currentLevel: 10 };
    const def = TOOL_DEFINITIONS.find((t) => t.code === "tool.trading_journal")!;
    expect(isToolUnlocked(def, onGate)).toBe(false);
    // One past it → unlocked.
    expect(isToolUnlocked(def, { ...artem, currentLevel: 11 })).toBe(true);
  });

  it("exactly one tool is current for Артём", () => {
    expect(projectTools(artem).filter((v) => v.current)).toHaveLength(1);
  });

  it("projectTool resolves a known code and null for an unknown one", () => {
    expect(projectTool("tool.trading_journal", artem)?.available).toBe(true);
    expect(projectTool("tool.nope", artem)).toBeNull();
  });

  it("all-completed progress unlocks everything", () => {
    const done = getPathProgress("completed");
    expect(projectTools(done).every((v) => v.unlocked)).toBe(true);
  });
});
