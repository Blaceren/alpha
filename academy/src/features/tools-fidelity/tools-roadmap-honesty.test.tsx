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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolsRegister, ToolLockedPage } from "@/features/tools-fidelity/tools-fidelity";
import { ToolFidelitySurface } from "@/features/tools-fidelity/tool-fidelity-surface";
import { projectTools, projectTool } from "@/features/tools/model/tools-projection";
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import type { PathProgress } from "@/features/path/model/path-state";

const at = (currentLevel: number): PathProgress =>
  ({ scenario: "active", currentLevel, allCompleted: false, rankLabel: "", xpLabel: "", streak: 0 }) as PathProgress;

/* TOOLS-AUTHORITY-DIVERGENCE-1. Access is the Backend's verdict now, so each
   case states one alongside the progress marker it already had. The level in
   both is the same level: these cases describe one learner, and previously the
   progress marker decided access on its own. */
const accessThrough = toolAccessUnlockedThrough;

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
    const rows = projectTools(at(level), accessThrough(level));
    for (const tool of ROADMAP) {
      const row = rows.find((r) => r.code === tool.code);
      expect(row?.statusLabel, tool.code).toBe("В разработке");
    }
  });

  it.each(LEVELS)("never promises to open, at level %i", (level) => {
    const { container } = render(<ToolsRegister tools={projectTools(at(level), accessThrough(level))} />);
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
    const before = projectTool("tool.chart_markup", at(2), accessThrough(2));
    const after = projectTool("tool.chart_markup", at(101), accessThrough(101));
    expect(before?.requirementLabel).toBe("Требование доступа: уровень 20");
    expect(after?.requirementLabel).toBe("Требование доступа выполнено");
    // The readiness line is the SAME on both sides: passing a gate does not
    // build a tool, and must not look as though it did.
    expect(before?.statusLabel).toBe("В разработке");
    expect(after?.statusLabel).toBe("В разработке");
  });

  it("changes only the requirement line when the checkpoint is reached", () => {
    const row = (level: number) => {
      const rows = projectTools(at(level), accessThrough(level));
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
    const rows = projectTools(at(level), accessThrough(level));
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
        <ToolFidelitySurface toolCode="tool.chart_markup" progress={at(level)} access={accessThrough(level)} />,
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
    const rows = projectTools(at(2), accessThrough(2));
    for (const tool of BUILT) {
      const row = rows.find((r) => r.code === tool.code);
      expect(row?.statusLabel, tool.code).toBe(`Откроется на уровне ${tool.unlockLevel}`);
      expect(row?.requirementLabel, tool.code).toBeNull();
      expect(row?.href, tool.code).toBeNull();
    }
  });

  it("opens with a real CTA once its checkpoint is passed", () => {
    const rows = projectTools(at(18), accessThrough(18));
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
    const tool = projectTool("tool.risk_calculator", at(2), accessThrough(2))!;
    const { container } = render(<ToolLockedPage tool={tool} />);
    expect(container.querySelector(".t-state-truth")?.textContent).toBe("Этот инструмент ещё не открыт.");
    expect(container.textContent).toContain("станет доступен на уровне 15");
  });
});

describe("the two dimensions never collapse into one", () => {
  it("keeps readiness and progress in separate elements", () => {
    const { container } = render(<ToolsRegister tools={projectTools(at(2), accessThrough(2))} />);
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
    const { container } = render(<ToolsRegister tools={projectTools(at(18), accessThrough(18))} />);
    const built = container.querySelectorAll(".t-entry--open");
    expect(built).toHaveLength(2);
    for (const row of built) expect(row.querySelector(".t-entry-requirement")).toBeNull();
  });
});

/**
 * THE CATALOGUE DESCRIBES ITSELF, AND A WORKSPACE INTRODUCES ITSELF ONCE.
 *
 * Three things the frames showed and the assertions above did not cover: a lead
 * that described nineteen working tools opened by a level number, a roadmap
 * page that promised the work would continue here, and a workspace that said
 * everything about itself twice before the first input.
 */
import { ToolWorkFrame, ToolNotEnterablePage, TOOLS_COPY } from "@/features/tools-fidelity/tools-fidelity";
import { RiskCalculatorWorkspace } from "@/features/tools/components/risk-calculator-workspace";
import { TradingJournalWorkspace } from "@/features/tools/components/trading-journal-workspace";
import { toolAccessUnlockedThrough } from "@/features/tools/model/tool-access-fixture";

describe("the catalogue lead", () => {
  it("describes working tools, and what governs reaching them", () => {
    // ATA-TOOLS-CATALOG-TRUTH-1: the register no longer lists future tools, so
    // the lead no longer has to describe two halves of a catalogue.
    expect(TOOLS_COPY.registerLead).toBe(
      "Рабочие инструменты ATA. Доступ открывается по мере продвижения по пути.",
    );
    // The heading itself is untouched.
    expect(TOOLS_COPY.registerTitle).toBe("Инструменты");
  });

  it("promises no future tools and no level number", () => {
    const { container } = render(<ToolsRegister tools={projectTools(at(2), accessThrough(2))} />);
    const lead = container.querySelector(".t-lead")?.textContent ?? "";
    expect(lead).not.toMatch(/остаются доступными после уровня/);
    expect(lead).not.toMatch(/будущ/i);
    expect(lead).not.toMatch(/разработк/i);
    expect(lead).not.toMatch(/\d/);
  });
});

describe("a roadmap page promises nothing", () => {
  const FORBIDDEN = [/поверхност/i, /Работа продолжится/i, /Доступ сохраняется/i, /Когда .* появится/i];

  it.each([2, 101])("says only what is true, at level %i", (level) => {
    const { container } = render(
      <ToolFidelitySurface toolCode="tool.chart_markup" progress={at(level)} access={accessThrough(level)} />,
    );
    const text = container.textContent ?? "";
    for (const pattern of FORBIDDEN) expect(text, String(pattern)).not.toMatch(pattern);
    expect(container.querySelector(".t-state-truth")?.textContent).toBe("В разработке");
    expect(container.querySelector(".t-state-meaning")?.textContent).toBe("Инструмент ещё не выпущен.");
    expect(container.querySelector(".p4-state-fact-value")?.textContent).toBe(
      level === 101 ? "Требование доступа выполнено" : "Требование доступа: уровень 20",
    );
  });

  it("states the requirement on one line, not broken across a phantom column", () => {
    /* The fact block is a key/value grid; a roadmap page puts one sentence in
       it, and the reserved key column was splitting that sentence in two. */
    const css = readFileSync(
      join(process.cwd(), "src", "features", "tools-fidelity", "tools-fidelity.css"),
      "utf8",
    );
    const rule = css.slice(css.indexOf(".tls .p4-state-fact-value:only-child"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("grid-column:1 / -1");
  });

  it("carries no full stop on the short status heading", () => {
    expect(TOOLS_COPY.roadmapLead).toBe("В разработке");
    expect(TOOLS_COPY.roadmapLead.endsWith(".")).toBe(false);
  });

  it("keeps the same wording as the register, so the two cannot drift", () => {
    const row = projectTool("tool.chart_markup", at(2), accessThrough(2));
    const { container } = render(<ToolFidelitySurface toolCode="tool.chart_markup" progress={at(2)} access={accessThrough(2)} />);
    expect(container.querySelector(".p4-state-fact-value")?.textContent).toBe(row?.requirementLabel);
    expect(container.querySelector(".t-state-truth")?.textContent).toBe(row?.statusLabel);
  });
});

describe("a built workspace introduces itself exactly once", () => {
  for (const [name, Workspace, title, level] of [
    ["Risk Calculator", RiskCalculatorWorkspace, "Risk Calculator", "15"],
    ["Trading Journal", TradingJournalWorkspace, "Trading Journal", "10"],
  ] as const) {
    it(`${name}: one return link, one name, one level marker, one h1`, () => {
      const tool = projectTool(name === "Risk Calculator" ? "tool.risk_calculator" : "tool.trading_journal", at(18), accessThrough(18))!;
      const { container } = render(
        <ToolWorkFrame tool={tool}>
          <Workspace />
        </ToolWorkFrame>,
      );
      const text = container.textContent ?? "";
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      expect(container.querySelector("h1")?.textContent).toBe(title);
      // The tool's name appears once in the visible text, not twice.
      expect(text.split(title).length - 1, "visible name count").toBe(1);
      // One way back, and it is the workspace's own.
      const back = [...container.querySelectorAll("a")].filter((a) => a.getAttribute("href") === "/tools");
      expect(back).toHaveLength(1);
      expect(text.split("Инструменты").length - 1, "back-link count").toBe(1);
      // One level marker.
      expect(text.split(level).length - 1).toBeGreaterThanOrEqual(1);
      expect(container.querySelectorAll(".rc-num, .je-num")).toHaveLength(1);
    });
  }

  it("leaves the calculator's own form contract untouched", () => {
    const tool = projectTool("tool.risk_calculator", at(18), accessThrough(18))!;
    const { container } = render(
      <ToolWorkFrame tool={tool}>
        <RiskCalculatorWorkspace />
      </ToolWorkFrame>,
    );
    /* Field identity and order are the domain, not the design: the frame change
       may not have touched a single one of them. */
    const names = [...container.querySelectorAll("input")].map((i) => i.id || i.getAttribute("name"));
    expect(names.length).toBeGreaterThan(0);
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.querySelector(".rc-disclaimer")).not.toBeNull();
  });

  it("still frames a state page with its outer header", () => {
    // Only the workspace branch lost the outer header; the state pages keep it.
    const { container } = render(
      <ToolNotEnterablePage tool={projectTool("tool.chart_markup", at(101), accessThrough(101))!} />,
    );
    expect(container.querySelector(".t-return")).not.toBeNull();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
