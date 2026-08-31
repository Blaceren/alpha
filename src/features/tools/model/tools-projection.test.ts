import { describe, expect, it } from "vitest";
import { getPathProgress } from "@/features/path/model/path-state";
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import {
  isToolUnlockedByLocalJoin,
  projectTool,
  projectTools,
} from "@/features/tools/model/tools-projection";
import {
  fixtureToolAccess,
  toolAccessUnlockedThrough,
} from "@/features/tools/model/tool-access-fixture";

const artem = getPathProgress("active"); // canonical Артём, L18
const early = getPathProgress("early"); // L2

/* The verdict is the Backend's now, so these cases state one. `artem` still
   supplies rank, XP and the featured-tool ordering — it no longer decides
   access (TOOLS-AUTHORITY-DIVERGENCE-1). */
const artemAccess = toolAccessUnlockedThrough(18);
const earlyAccess = toolAccessUnlockedThrough(2);

function view(code: string, progress = artem, access = artemAccess) {
  const found = projectTools(progress, access).find((v) => v.code === code);
  if (!found) throw new Error(`no view for ${code}`);
  return found;
}

describe("tools projection — resolver-owned unlock", () => {
  it("projects every curriculum tool, in unlock order", () => {
    const views = projectTools(artem, artemAccess);
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
    const current = projectTools(artem, artemAccess).find((v) => v.current);
    expect(current?.code).toBe("tool.risk_calculator");
  });

  it("Risk Calculator opens on the verdict, not on where the learner stands", () => {
    /* This case used to move `currentLevel` and watch the tool open. It cannot
       any more, and that IS the change: the level no longer decides. What moves
       now is the verdict. */
    const notReached = view("tool.risk_calculator", artem, toolAccessUnlockedThrough(14));
    expect(notReached.available).toBe(false);
    expect(notReached.unlocked).toBe(false);
    // The Backend resolves "standing on the gate" as not completed.
    expect(view("tool.risk_calculator", artem, toolAccessUnlockedThrough(15)).unlocked).toBe(false);
    const passed = view("tool.risk_calculator", artem, toolAccessUnlockedThrough(16));
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
    /* Neither is built, so neither promises to open. Readiness leads and the
       gate is reported separately — the two facts move independently. */
    expect(view("tool.chart_markup").statusLabel).toBe("В разработке");
    expect(view("tool.indicator_checklist").statusLabel).toBe("В разработке");
    expect(view("tool.chart_markup").requirementLabel).toBe("Требование доступа: уровень 20");
    expect(view("tool.indicator_checklist").requirementLabel).toBe("Требование доступа: уровень 25");
  });

  it("an early verdict locks Trading Journal too", () => {
    const tj = view("tool.trading_journal", early, earlyAccess);
    expect(tj.unlocked).toBe(false);
    expect(tj.available).toBe(false);
    expect(tj.href).toBeNull();
    // No tool is current when nothing is available yet — a legitimate hub state.
    expect(projectTools(early, earlyAccess).some((v) => v.current)).toBe(false);
  });

  it("the retired local join still reads the gate the way it always did", () => {
    /* This is no longer how a tool opens — the Backend decides that. The rule is
       kept, and pinned here, because the truth matrix compares the two, and a
       rule you have deleted is one you can no longer prove you stopped using. */
    const onGate = { ...artem, currentLevel: 10 };
    const def = TOOL_DEFINITIONS.find((t) => t.code === "tool.trading_journal")!;
    expect(isToolUnlockedByLocalJoin(def, onGate)).toBe(false);
    expect(isToolUnlockedByLocalJoin(def, { ...artem, currentLevel: 11 })).toBe(true);
  });

  it("and the projection ignores it: the verdict alone decides", () => {
    // Standing on L10 by the local rule, but the Backend says the tool is open.
    const onGate = { ...artem, currentLevel: 10 };
    const opened = projectTools(onGate, toolAccessUnlockedThrough(18));
    expect(opened.find((v) => v.code === "tool.trading_journal")?.unlocked).toBe(true);
  });

  it("exactly one tool is current for Артём", () => {
    expect(projectTools(artem, artemAccess).filter((v) => v.current)).toHaveLength(1);
  });

  it("projectTool resolves a known code and null for an unknown one", () => {
    expect(projectTool("tool.trading_journal", artem, artemAccess)?.available).toBe(true);
    expect(projectTool("tool.nope", artem, artemAccess)).toBeNull();
  });

  it("all-completed progress unlocks everything", () => {
    const done = getPathProgress("completed");
    expect(
      projectTools(done, fixtureToolAccess("completed")).every((v) => v.unlocked),
    ).toBe(true);
  });
});
