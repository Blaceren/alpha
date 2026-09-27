/**
 * THE REGISTER, AS A THING YOU CAN READ.
 *
 * The reported defect was not a missing feature: every fact was already on the
 * page. It was that seventeen of nineteen rows were set below the contrast
 * floor, the state of a tool had no fixed place to be found, and a capability
 * that will never open looked exactly like one that opens now.
 *
 * These cases hold the repair to what it claims — measured contrast, a state
 * locus that exists for every row, three states told apart by more than colour,
 * and the registry's own names and codes carried through untouched.
 */
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolsRegister } from "@/features/tools-fidelity/tools-fidelity";
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import { projectTools } from "@/features/tools/model/tools-projection";
import type { PathProgress } from "@/features/path/model/path-state";
import { toolAccessUnlockedThrough } from "@/features/tools/model/tool-access-fixture";

const CSS = readFileSync(
  join(process.cwd(), "src", "features", "tools-fidelity", "tools-fidelity.css"),
  "utf8",
);

function progressAt(currentLevel: number): PathProgress {
  return { scenario: "active", currentLevel, allCompleted: false, rankLabel: "", xpLabel: "", streak: 0 } as PathProgress;
}

/** Relative luminance and contrast, per WCAG 2.1. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const parts = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = parts.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
/** Resolve a custom property declared on `.tls`, following one level of alias. */
function token(name: string): string {
  const direct = new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`).exec(CSS);
  if (direct?.[1]) return direct[1];
  const alias = new RegExp(`${name}\\s*:\\s*var\\((--[a-z0-9-]+)\\)`).exec(CSS);
  if (!alias?.[1]) throw new Error(`no value for ${name}`);
  return token(alias[1]);
}

describe("the register is legible", () => {
  const CANVAS = "#0B0D0A";

  it.each([
    ["--text-primary", 4.5],
    ["--text-secondary", 4.5],
    // Purpose and condition are 13px and 12.5px — body text, so the body floor
    // applies to them, not the 3:1 large-text one.
    ["--text-tertiary", 4.5],
    ["--text-quiet", 4.5],
  ])("%s clears WCAG AA on the register canvas", (name, floor) => {
    const ratio = contrast(token(name), CANVAS);
    expect(ratio, `${name} = ${token(name)} at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
  });

  it("keeps the ramp ordered, so hierarchy still reads", () => {
    const ramp = ["--text-primary", "--text-secondary", "--text-tertiary", "--text-quiet"].map((n) =>
      contrast(token(n), CANVAS),
    );
    for (let i = 1; i < ramp.length; i += 1) {
      expect(ramp[i - 1]).toBeGreaterThan(ramp[i] as number);
    }
  });

  it("gives the locked name a readable step rather than fading it out", () => {
    const rule = CSS.slice(CSS.indexOf(".tls .t-entry--locked .t-entry-name"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("var(--text-secondary)");
  });
});

describe("every row states which of the three things it is", () => {
  /* L18: Trading Journal (L10) and Risk Calculator (L15) open, the rest waiting. */
  const rows = projectTools(progressAt(18), accessThrough(18));

  it("renders all nineteen registry entries, in unlock order", () => {
    const { container } = render(<ToolsRegister tools={rows} />);
    const entries = container.querySelectorAll(".t-entry");
    expect(entries).toHaveLength(19);
    expect(TOOL_DEFINITIONS).toHaveLength(19);
    const names = [...entries].map((e) => e.querySelector(".t-entry-name")?.textContent);
    expect(names).toEqual(TOOL_DEFINITIONS.map((t) => t.title));
  });

  it("marks open, roadmap and locked rows distinctly", () => {
    const { container } = render(<ToolsRegister tools={rows} />);
    const state = (code: string) => {
      const idx = rows.findIndex((r) => r.code === code);
      const el = container.querySelectorAll(".t-entry")[idx] as HTMLElement;
      return [...el.classList].find((c) => c.startsWith("t-entry--"));
    };
    // Two are open and working; every other unlocked one is roadmap; the rest locked.
    expect(state("tool.trading_journal")).toBe("t-entry--open");
    expect(state("tool.risk_calculator")).toBe("t-entry--open");
    expect(state("tool.chart_markup")).toBe("t-entry--locked");
  });

  it("shows a roadmap capability as open-but-not-enterable, never as working", () => {
    /* A learner past L20 has Chart Markup Tool unlocked, and it still must not
       offer an action: the capability does not exist in this build. */
    const far = projectTools(progressAt(101), accessThrough(101));
    const chart = far.find((t) => t.code === "tool.chart_markup");
    expect(chart?.unlocked).toBe(true);
    expect(chart?.available).toBe(false);
    expect(chart?.href).toBeNull();

    const { container } = render(<ToolsRegister tools={far} />);
    const idx = far.findIndex((t) => t.code === "tool.chart_markup");
    const row = container.querySelectorAll(".t-entry")[idx] as HTMLElement;
    expect(row.className).toContain("t-entry--roadmap");
    expect(row.querySelector("a")).toBeNull();
  });

  it("never distinguishes a state by colour alone", () => {
    /* Each state's mark differs in SHAPE — filled, outlined, dashed — and each
       row carries its state in words as well. Remove the colour declarations
       and the three are still three. */
    const marks = [".tls .t-entry--open .t-entry-condition::before", ".tls .t-entry--roadmap .t-entry-condition::before", ".tls .t-entry--locked .t-entry-condition::before"];
    for (const sel of marks) expect(CSS).toContain(sel);
    const locked = CSS.slice(CSS.indexOf(".tls .t-entry--locked .t-entry-condition::before"));
    expect(locked.slice(0, locked.indexOf("}"))).toContain("border-style:dashed");
    const open = CSS.slice(CSS.indexOf(".tls .t-entry--open .t-entry-condition::before"));
    expect(open.slice(0, open.indexOf("}"))).toContain("background:");

    // And the words: every row's condition line is non-empty text.
    const { container } = render(<ToolsRegister tools={rows} />);
    for (const el of container.querySelectorAll(".t-entry-condition")) {
      expect((el.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });
});

describe("only a real capability is reachable", () => {
  const rows = projectTools(progressAt(101), accessThrough(101));

  it("gives exactly two rows an action, and names the tool in it", () => {
    const { container } = render(<ToolsRegister tools={rows} />);
    const links = [...container.querySelectorAll("a.t-entry-action")];
    expect(links).toHaveLength(2);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/tools/tool.trading_journal",
      "/tools/tool.risk_calculator",
    ]);
    for (const a of links) {
      // "Открыть" nineteen times names nothing; the accessible name must carry
      // which tool is being opened.
      expect(a.getAttribute("aria-label")).toMatch(/Trading Journal|Risk Calculator/);
    }
  });

  it("puts nothing focusable in a locked or roadmap row", () => {
    const { container } = render(<ToolsRegister tools={rows} />);
    const entries = [...container.querySelectorAll(".t-entry")];
    for (const entry of entries) {
      const open = entry.className.includes("t-entry--open");
      const focusable = entry.querySelectorAll("a, button, input, [tabindex]");
      expect(focusable.length, entry.querySelector(".t-entry-name")?.textContent ?? "").toBe(open ? 1 : 0);
    }
  });

  it("routes by canonical tool code, never by an English slug", () => {
    const { container } = render(<ToolsRegister tools={rows} />);
    for (const a of container.querySelectorAll("a.t-entry-action")) {
      const href = a.getAttribute("href") ?? "";
      expect(href).toMatch(/^\/tools\/tool\.[a-z_]+$/);
      expect(href).not.toMatch(/-/);
    }
  });

  it("keeps every English proper name exactly as the registry declares it", () => {
    const { container } = render(<ToolsRegister tools={rows} />);
    const rendered = [...container.querySelectorAll(".t-entry-name")].map((e) => e.textContent);
    expect(rendered).toEqual([
      "Trading Journal", "Risk Calculator", "Chart Markup Tool", "Indicator Checklist",
      "News Calendar", "Pause Mode", "Weekly Review", "Strategy Builder", "Capital Plan",
      "Market Regime Board", "Session Planner", "Strategy Statistics", "Watchlist",
      "Psychology Check-in", "Habit Calendar", "Mentor Case Room", "Performance Dashboard",
      "Personal Playbook", "Pro Workspace",
    ]);
  });

  it("gives a tapped action a 44px target on mobile without changing the layout", () => {
    // Anchored on the appended mobile section, not on the first 899px block in
    // the file — there are several, and the earlier ones are not this rule.
    const anchor = CSS.indexOf("MOBILE — the row becomes a block");
    expect(anchor).toBeGreaterThan(-1);
    const mobile = CSS.slice(anchor);
    expect(mobile).toContain("min-height:44px");
    // The overlay grows the hit area, not the row.
    expect(mobile).toMatch(/\.t-entry-action::after[\s\S]*?inset:/);
  });
});

describe("the register uses the desktop it is given", () => {
  it("is centred rather than parked against the left edge", () => {
    const rule = CSS.slice(CSS.indexOf(".tls .t-surface {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("margin-inline:auto");
  });

  it("gives the state its own column without moving a single element", () => {
    const block = CSS.slice(CSS.indexOf("@media (min-width:900px){", CSS.indexOf("four loci")));
    const desktop = block.slice(0, block.indexOf("\n}\n"));
    // The wrappers dissolve as boxes; the tree is untouched.
    expect(desktop).toContain("display:contents");
    expect(desktop).toMatch(/\.t-entry-condition\s*\{[^}]*grid-column:3/);
    expect(desktop).toMatch(/\.t-entry-action\s*\{[^}]*grid-column:4/);
  });

  it("does not clip a long English name", () => {
    const { container } = render(<ToolsRegister tools={projectTools(progressAt(101), accessThrough(101))} />);
    const longest = [...container.querySelectorAll(".t-entry-name")]
      .map((e) => e.textContent ?? "")
      .sort((a, b) => b.length - a.length)[0];
    expect(longest).toBe("Performance Dashboard");
    // Nothing truncates the name: the clamp is on the purpose line only.
    const nameRule = CSS.slice(CSS.indexOf(".tls .t-entry-name {"));
    expect(nameRule.slice(0, nameRule.indexOf("}"))).not.toContain("line-clamp");
  });
});

describe("a state page's links are targets too", () => {
  it("gives the return link and the state action a 44px box without moving them", () => {
    /* Measured at 19.5px and 20.25px of effective target at every width before
       this rule. They stay set as text — a state page is not a call to action —
       so the box grows around the type rather than under it. */
    const block = CSS.slice(CSS.indexOf("THE TWO LINKS ON A STATE PAGE"));
    expect(block).toContain(".tls .t-return,");
    expect(block).toContain(".tls .t-action,");
    expect(block).toMatch(/\.tls \.back \{[\s\S]*?min-height:44px/);
    expect(block).toMatch(/\.tls \.back::after \{[^}]*inset:0 -10px/);
    // The workspace's own return link reaches this surface as well.
    expect(block).toMatch(/\.tls \.rc-back,\s*\n\.tls \.je-back \{[\s\S]*?min-height:44px/);
  });
});

describe("the empty register", () => {
  it("says nothing is open yet, and offers no action", () => {
    const { container } = render(<ToolsRegister tools={[]} />);
    const state = container.querySelector(".t-state");
    expect(state).not.toBeNull();
    expect(within(state as HTMLElement).getByText(/Инструменты пока не открыты/)).toBeInTheDocument();
    expect(container.querySelectorAll(".t-entry")).toHaveLength(0);
    expect(container.querySelectorAll("a.t-entry-action")).toHaveLength(0);
  });
});

/* TOOLS-AUTHORITY-DIVERGENCE-1. Access is the Backend's verdict now, so each
   case states one alongside the progress marker it already had. The level in
   both is the same level: these cases describe one learner, and previously the
   progress marker decided access on its own. */
const accessThrough = toolAccessUnlockedThrough;
