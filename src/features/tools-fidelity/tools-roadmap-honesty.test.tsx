/**
 * AN UNBUILT TOOL SAYS SO BEFORE THE GATE, NOT AFTER IT.
 *
 * A learner at level 2 used to read «Откроется на уровне 20» against seventeen
 * tools that will not open at level 20, or at any level in this release. The
 * row answered only "how far away is this?", which is the wrong question when
 * the answer is "it does not exist yet".
 *
 * Readiness and progress are independent, so the row states them independently.
 * These cases hold that separation at every level, in both directions.
 */
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { ToolsRegister, ToolLockedPage } from "@/features/tools-fidelity/tools-fidelity";
import { ToolFidelitySurface } from "@/features/tools-fidelity/tool-fidelity-surface";
import { projectTools, projectTool } from "@/features/tools/model/tools-projection";
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import type { PathProgress } from "@/features/path/model/path-state";

const at = (currentLevel: number): PathProgress =>
  ({ scenario: "active", currentLevel, allCompleted: false, rankLabel: "", xpLabel: "", streak: 0 }) as PathProgress;

const ROADMAP = TOOL_DEFINITIONS.filter((t) => t.implementationStatus !== "available");
const BUILT = TOOL_DEFINITIONS.filter((t) => t.implementationStatus === "available");
/* Early, mid, past every gate — the promise must not reappear at any of them. */
const LEVELS = [1, 2, 11, 16, 21, 46, 76, 101];

describe("the seventeen unbuilt tools", () => {
  it("is seventeen, and the two built ones are the two we say they are", () => {
    expect(ROADMAP).toHaveLength(17);
    expect(BUILT.map((t) => t.code)).toEqual(["tool.trading_journal", "tool.risk_calculator"]);
  });

  it.each(LEVELS)("says «В разработке» at level %i, whatever the progression", (level) => {
    const rows = projectTools(at(level));
    for (const tool of ROADMAP) {
      const row = rows.find((r) => r.code === tool.code);
      expect(row?.statusLabel, tool.code).toBe("В разработке");
    }
  });

  it.each(LEVELS)("never promises to open, at level %i", (level) => {
    const { container } = render(<ToolsRegister tools={projectTools(at(level))} />);
    const rows = [...container.querySelectorAll(".t-entry")];
    for (const [i, tool] of TOOL_DEFINITIONS.entries()) {
      if (tool.implementationStatus === "available") continue;
      const text = rows[i]?.textContent ?? "";
      // The three forms that promise a capability this build does not have.
      expect(text, tool.code).not.toMatch(/Откроется/);
      expect(text, tool.code).not.toMatch(/(^|\s)Доступен(\s|$)/);
      expect(text, tool.code).not.toMatch(/Открыть инструмент/);
      expect(text, tool.code).toContain("В разработке");
    }
  });

  it("reports the gate as a separate, secondary fact on both sides of it", () => {
    const before = projectTool("tool.chart_markup", at(2));
    const after = projectTool("tool.chart_markup", at(101));
    expect(before?.requirementLabel).toBe("Требование доступа: уровень 20");
    expect(after?.requirementLabel).toBe("Требование доступа выполнено");
    // The readiness line is the SAME on both sides: passing a gate does not
    // build a tool, and must not look as though it did.
    expect(before?.statusLabel).toBe("В разработке");
    expect(after?.statusLabel).toBe("В разработке");
  });

  it("changes only the requirement line when the checkpoint is reached", () => {
    const row = (level: number) => {
      const rows = projectTools(at(level));
      const i = TOOL_DEFINITIONS.findIndex((t) => t.code === "tool.chart_markup");
      const { container } = render(<ToolsRegister tools={rows} />);
      const el = container.querySelectorAll(".t-entry")[i] as HTMLElement;
      return {
        name: el.querySelector(".t-entry-name")?.textContent,
        purpose: el.querySelector(".t-entry-purpose")?.textContent,
        status: el.querySelector(".t-entry-condition")?.textContent,
        requirement: el.querySelector(".t-entry-requirement")?.textContent,
        links: el.querySelectorAll("a").length,
      };
    };
    const before = row(2), after = row(101);
    expect(after.name).toBe(before.name);
    expect(after.purpose).toBe(before.purpose);
    expect(after.status).toBe(before.status);
    expect(after.links).toBe(before.links);
    expect(after.requirement).not.toBe(before.requirement);
  });

  it.each(LEVELS)("offers nothing to open or focus at level %i", (level) => {
    const rows = projectTools(at(level));
    const { container } = render(<ToolsRegister tools={rows} />);
    const entries = [...container.querySelectorAll(".t-entry")];
    for (const [i, tool] of TOOL_DEFINITIONS.entries()) {
      if (tool.implementationStatus === "available") continue;
      expect(rows[i]?.href, tool.code).toBeNull();
      expect(entries[i]?.querySelectorAll("a, button, input, [tabindex]").length, tool.code).toBe(0);
    }
  });

  it("does not make the promise on a deep-linked page either", () => {
    for (const level of [2, 101]) {
      const { container } = render(
        <ToolFidelitySurface toolCode="tool.chart_markup" progress={at(level)} />,
      );
      const text = container.textContent ?? "";
      expect(text, `level ${level}`).not.toMatch(/станет доступен на уровне/);
      expect(text, `level ${level}`).toContain("В разработке");
      expect(container.querySelector("form")).toBeNull();
      expect(container.querySelector("input")).toBeNull();
    }
  });
});

describe("the two built tools keep their own access contract", () => {
  it("stays locked by progression, and says so in the old words", () => {
    const rows = projectTools(at(2));
    for (const tool of BUILT) {
      const row = rows.find((r) => r.code === tool.code);
      expect(row?.statusLabel, tool.code).toBe(`Откроется на уровне ${tool.unlockLevel}`);
      expect(row?.requirementLabel, tool.code).toBeNull();
      expect(row?.href, tool.code).toBeNull();
    }
  });

  it("opens with a real CTA once its checkpoint is passed", () => {
    const rows = projectTools(at(18));
    for (const tool of BUILT) {
      const row = rows.find((r) => r.code === tool.code);
      expect(row?.statusLabel, tool.code).toBe("Открыт · рабочий инструмент");
      expect(row?.available, tool.code).toBe(true);
      expect(row?.href, tool.code).toBe(`/tools/${tool.code}`);
    }
    const { container } = render(<ToolsRegister tools={rows} />);
    expect(container.querySelectorAll("a.t-entry-action")).toHaveLength(2);
  });

  it("shows a built-but-locked tool the condition page, not the roadmap one", () => {
    const tool = projectTool("tool.risk_calculator", at(2))!;
    const { container } = render(<ToolLockedPage tool={tool} />);
    expect(container.querySelector(".t-state-truth")?.textContent).toBe("Этот инструмент ещё не открыт.");
    expect(container.textContent).toContain("станет доступен на уровне 15");
  });
});

describe("the two dimensions never collapse into one", () => {
  it("keeps readiness and progress in separate elements", () => {
    const { container } = render(<ToolsRegister tools={projectTools(at(2))} />);
    const roadmapRow = [...container.querySelectorAll(".t-entry--locked")].find((el) =>
      (el.textContent ?? "").includes("Chart Markup Tool"),
    ) as HTMLElement;
    const status = roadmapRow.querySelector(".t-entry-condition");
    const requirement = roadmapRow.querySelector(".t-entry-requirement");
    expect(status).not.toBeNull();
    expect(requirement).not.toBeNull();
    expect(status).not.toBe(requirement);
    expect(within(roadmapRow).getByText("В разработке")).toBeInTheDocument();
    expect(within(roadmapRow).getByText("Требование доступа: уровень 20")).toBeInTheDocument();
  });

  it("gives a built tool one line, because it has one thing to say", () => {
    const { container } = render(<ToolsRegister tools={projectTools(at(18))} />);
    const built = container.querySelectorAll(".t-entry--open");
    expect(built).toHaveLength(2);
    for (const row of built) expect(row.querySelector(".t-entry-requirement")).toBeNull();
  });
});
