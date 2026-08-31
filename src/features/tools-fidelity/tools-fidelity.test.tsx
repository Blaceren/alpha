/**
 * TOOLS — the register, the capability pages, and the locks they must never
 * re-decide.
 *
 * The composition checks are ordinary. The ones that matter are structural:
 * locked and not-enterable are different PAGES rather than one page with a
 * different sentence, an unknown code cannot borrow a real tool's frame, and no
 * row offers an action into something that is not built.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import {
  ToolsRegister,
  ToolLockedPage,
  ToolNotEnterablePage,
  ToolNotFoundPage,
  ToolWorkFrame,
  TOOLS_COPY,
} from "@/features/tools-fidelity/tools-fidelity";
import { ToolFidelitySurface } from "@/features/tools-fidelity/tool-fidelity-surface";
import { projectTools } from "@/features/tools/model/tools-projection";
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import type { PathProgress } from "@/features/path/model/path-state";
import type { ToolView } from "@/features/tools/model/tools-projection";
import { toolAccessUnlockedThrough } from "@/features/tools/model/tool-access-fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const progressAt = (currentLevel: number): PathProgress =>
  ({
    scenario: "active",
    currentLevel,
    allCompleted: false,
    rankLabel: "",
    xpLabel: "",
    streak: 0,
  }) as PathProgress;

/* TOOLS-AUTHORITY-DIVERGENCE-1. Access is the Backend's verdict now, so each
   case states one alongside the progress marker it already had. The level in
   both is the same level: these cases describe one learner, and previously the
   progress marker decided access on its own. */
const accessThrough = toolAccessUnlockedThrough;

const view = (over: Partial<ToolView> = {}): ToolView => ({
  id: "tool.trading_journal",
  code: "tool.trading_journal",
  title: "Trading Journal",
  description: "Записи решений.",
  unlockLevel: 10,
  unlocked: true,
  available: true,
  current: true,
  href: "/tools/tool.trading_journal",
  implemented: true,
  statusLabel: "Открыт · рабочий инструмент",
  requirementLabel: null,
  ctaLabel: "Открыть журнал",
  ...over,
});

const SRC = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/* ------------------------------------------------------------------ register */

describe("Tools — the register", () => {
  it("lists every canonical tool, in catalogue order, with no ranking of its own", () => {
    const tools = projectTools(progressAt(19), accessThrough(19));
    const { container } = render(<ToolsRegister tools={tools} />);
    const rows = container.querySelectorAll(".t-entry");
    expect(rows).toHaveLength(TOOL_DEFINITIONS.length);
    expect(TOOL_DEFINITIONS.length).toBe(19);
    expect(Array.from(container.querySelectorAll(".t-entry-name")).map((n) => n.textContent)).toEqual(
      TOOL_DEFINITIONS.map((t) => t.title),
    );
  });

  it("keeps the frozen row anatomy, with the condition line always last", () => {
    const { container } = render(<ToolsRegister tools={[view()]} />);
    const row = container.querySelector(".t-entry")!;
    expect(row.querySelector(".t-entry-provenance")!.textContent).toBe("L10");
    expect(row.querySelector(".t-entry-provenance")!.getAttribute("aria-label")).toBe("Уровень 10");
    expect(row.querySelector(".t-entry-name")!.textContent).toBe("Trading Journal");
    expect(row.querySelector(".t-entry-purpose")!.textContent).toBe("Записи решений.");
    const body = row.querySelector(".t-entry-body")!;
    expect(body.lastElementChild!.className).toBe("t-entry-condition");
    expect(body.lastElementChild!.textContent).toBe("Открыт · рабочий инструмент");
  });

  it("offers an action only where something is actually open", () => {
    const { container } = render(
      <ToolsRegister
        tools={[
          view(),
          view({ code: "a", unlocked: false, available: false, implemented: false, href: null, statusLabel: "В разработке", requirementLabel: "Требование доступа: уровень 30", unlockLevel: 30 }),
          view({ code: "b", unlocked: true, available: false, implemented: false, href: null, statusLabel: "В разработке", requirementLabel: "Требование доступа выполнено" }),
        ]}
      />,
    );
    const actions = container.querySelectorAll(".t-entry-action");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.tagName).toBe("A");
    expect(actions[0]!.getAttribute("href")).toBe("/tools/tool.trading_journal");
    /* The name identifies the tool: "Открыть" nineteen times names nothing. */
    expect(actions[0]!.getAttribute("aria-label")).toBe("Открыть журнал: Trading Journal");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("marks a locked row structurally, and unlocked-but-unbuilt is not locked", () => {
    const { container } = render(
      <ToolsRegister
        tools={[
          view({ code: "a", unlocked: false, available: false, href: null }),
          view({ code: "b", unlocked: true, available: false, href: null }),
        ]}
      />,
    );
    const rows = container.querySelectorAll(".t-entry");
    expect(rows[0]!.className).toContain("t-entry--locked");
    expect(rows[1]!.className).not.toContain("t-entry--locked");
  });

  it("has no search, filters, favourites, recents, categories or ranking", () => {
    const { container } = render(<ToolsRegister tools={projectTools(progressAt(19), accessThrough(19))} />);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("says the register is empty rather than inventing unlocks", () => {
    const { container } = render(<ToolsRegister tools={[]} />);
    expect(container.querySelector(".t-state-truth")!.textContent).toBe(TOOLS_COPY.emptyLead);
    expect(container.querySelectorAll(".t-entry")).toHaveLength(0);
  });

  it("does not carry the prototype's owned-work trace, which it has no source for", () => {
    const { container } = render(<ToolsRegister tools={projectTools(progressAt(19), accessThrough(19))} />);
    expect(container.querySelector(".t-trace")).toBeNull();
  });
});

/* ----------------------------------------------------------- capability pages */

describe("Tools — locked and not-enterable are different pages", () => {
  it("locked states a CONDITION and names it", () => {
    const { container } = render(
      <ToolLockedPage tool={view({ unlocked: false, available: false, href: null, unlockLevel: 90 })} />,
    );
    expect(container.querySelector(".t-state-truth")!.textContent).toBe(TOOLS_COPY.lockedLead);
    expect(container.querySelector(".t-state-meaning")!.textContent).toBe(
      "Он станет доступен на уровне 90 и останется доступным дальше.",
    );
    expect(container.querySelector(".p4-state-fact-key")!.textContent).toBe("Условие доступа");
    expect(container.querySelector(".p4-state-fact-value")!.textContent).toBe("Уровень 90");
    expect(container.querySelector(".p4-state-forward")).toBeNull();
    /* No working surface of any kind reaches a locked page. */
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("not-enterable says what is true and promises nothing further", () => {
    const { container } = render(
      <ToolNotEnterablePage tool={view({ available: false, implemented: false, href: null, requirementLabel: "Требование доступа выполнено" })} />,
    );
    /* Readiness leads here too: the gate is passed and the tool is still
       unbuilt, so what decides what the learner can do is that it is unbuilt. */
    expect(container.querySelector(".t-state-truth")!.textContent).toBe("В разработке");
    expect(container.querySelector(".t-state-meaning")!.textContent).toBe("Инструмент ещё не выпущен.");
    expect(container.querySelector(".p4-state-fact-value")!.textContent).toBe("Требование доступа выполнено");
    /* No date, no notification, no guarantee that work resumes here — and no
       «поверхность», which is our word for it rather than the learner's. */
    expect(container.querySelector(".p4-state-forward")).toBeNull();
    expect(container.textContent).not.toMatch(/поверхност/i);
    expect(container.querySelector("input")).toBeNull();
  });

  it("keeps the capability header on both, so the learner knows which tool this is", () => {
    for (const page of [
      <ToolLockedPage key="l" tool={view({ unlocked: false, available: false, href: null })} />,
      <ToolNotEnterablePage key="n" tool={view({ available: false, href: null })} />,
    ]) {
      const { container, unmount } = render(page);
      expect(container.querySelector(".t-identity h1")!.textContent).toBe("Trading Journal");
      expect(container.querySelector(".t-purpose")!.textContent).toBe("Записи решений.");
      expect(container.querySelector(".t-return")!.getAttribute("href")).toBe("/tools");
      unmount();
    }
  });

  it("gives an unknown code no title, no level, no purpose and no capability header", () => {
    const { container } = render(<ToolNotFoundPage />);
    expect(container.querySelector(".t-identity")).toBeNull();
    expect(container.querySelector(".t-entry-provenance")).toBeNull();
    expect(container.querySelector(".t-state-truth")!.textContent).toBe(TOOLS_COPY.notFoundLead);
    expect(screen.getByText(TOOLS_COPY.notFoundAction).getAttribute("href")).toBe("/tools");
  });

  it("frames a built tool without introducing it a second time", () => {
    /* A built workspace opens with its own return link, level marker and h1.
       The frame adding a second set is what made the page look nested inside
       itself and pushed the first input off a 390px screen. */
    const { container } = render(
      <ToolWorkFrame tool={view()}>
        <p data-testid="workspace">рабочее тело</p>
      </ToolWorkFrame>,
    );
    expect(container.querySelector(".t-identity")).toBeNull();
    expect(container.querySelector(".t-return")).toBeNull();
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(screen.getByTestId("workspace")).toBeTruthy();
  });
});

/* ---------------------------------------------------------------- dispatch */

describe("Tools — the surface dispatches on the resolved view", () => {
  it("never renders a working surface for a tool the progression has not unlocked", () => {
    const { container } = render(
      <ToolFidelitySurface toolCode="tool.trading_journal" progress={progressAt(2)} access={accessThrough(2)} />,
    );
    expect(container.querySelector(".t-state-truth")!.textContent).toBe(TOOLS_COPY.lockedLead);
    expect(container.querySelector("input")).toBeNull();
  });

  it("renders the not-enterable page for an unlocked tool with no surface", () => {
    const unbuilt = TOOL_DEFINITIONS.find((t) => t.implementationStatus === "coming-soon")!;
    const { container } = render(
      <ToolFidelitySurface toolCode={unbuilt.code} progress={progressAt(101)} access={accessThrough(101)} />,
    );
    expect(container.querySelector(".t-state-truth")!.textContent).toBe(TOOLS_COPY.roadmapLead);
  });

  it("refuses an unknown code outright", () => {
    const { container } = render(
      <ToolFidelitySurface toolCode="tool.not_a_real_tool" progress={progressAt(19)} access={accessThrough(19)} />,
    );
    expect(container.querySelector(".t-state-truth")!.textContent).toBe(TOOLS_COPY.notFoundLead);
    expect(container.querySelector(".t-identity")).toBeNull();
  });

  it("with no progression at all, a real tool is locked and a fake one is still not found", () => {
    const real = render(<ToolFidelitySurface toolCode="tool.trading_journal" progress={null} access={null} />);
    expect(real.container.querySelector(".t-state-truth")!.textContent).toBe(TOOLS_COPY.lockedLead);
    expect(real.container.querySelector(".t-identity h1")!.textContent).toBe("Trading Journal");
    real.unmount();

    const fake = render(<ToolFidelitySurface toolCode="tool.invented" progress={null} access={null} />);
    expect(fake.container.querySelector(".t-state-truth")!.textContent).toBe(TOOLS_COPY.notFoundLead);
  });
});

/* ------------------------------------------------------- routes and authority */

describe("Tools — both routes read canonical progress", () => {
  const hub = SRC("src/app/(app)/tools/page.tsx");
  const surface = SRC("src/app/(app)/tools/[toolCode]/page.tsx");

  it("the tool page no longer resolves a real learner's locks from a fixture", () => {
    const apiBranch = surface.slice(surface.indexOf('mode === "api"'));
    expect(apiBranch).toContain("canonicalToolProgress");
    expect(apiBranch).toContain("getServerViewer");
    /* The fixture name is gone from the api path. */
    expect(apiBranch.slice(0, apiBranch.indexOf("const sp = await searchParams"))).not.toContain(
      "Артём",
    );
  });

  it("both routes take the viewer from the session", () => {
    for (const src of [hub, surface]) {
      const apiBranch = src.slice(src.indexOf('mode === "api"'));
      expect(apiBranch).toContain('viewer?.name ?? "Ученик"');
    }
  });

  it("neither the register nor the surface re-decides a lock", () => {
    const feature =
      SRC("src/features/tools-fidelity/tools-fidelity.tsx") +
      SRC("src/features/tools-fidelity/tool-fidelity-surface.tsx");
    const code = feature.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("currentLevel >");
    expect(code).not.toContain("unlockLevel <=");
    expect(code).not.toMatch(/levelProgressState/);
  });
});

/* ------------------------------------------------------------------- styles */

describe("Tools — the stylesheet is scoped, local, and the one exception is separate", () => {
  const css = SRC("src/features/tools-fidelity/tools-fidelity.css");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const safety = SRC("src/features/tools-fidelity/tools-fidelity-safety.css");

  it("makes no remote request", () => {
    expect(bare).not.toContain("@import");
    expect(bare).not.toMatch(/https?:\/\//);
  });

  it("binds every font token to the product's local faces", () => {
    expect(bare).not.toMatch(/"Manrope"/);
    expect(bare).not.toMatch(/"IBM Plex Mono"/);
    expect((bare.match(/"ATA Manrope"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("lets no selector escape the .tls namespace", () => {
    const escapees: string[] = [];
    const walk = (block: string) => {
      let i = 0;
      while (i < block.length) {
        const open = block.indexOf("{", i);
        if (open === -1) break;
        const prelude = block.slice(i, open).trim();
        let depth = 1;
        let k = open + 1;
        while (k < block.length && depth > 0) {
          if (block[k] === "{") depth++;
          else if (block[k] === "}") depth--;
          k++;
        }
        const inner = block.slice(open + 1, k - 1);
        if (prelude.startsWith("@")) {
          if (/^@(media|supports)/.test(prelude)) walk(inner);
        } else {
          for (const part of prelude.split(",")) {
            const s = part.trim();
            if (s && !s.startsWith(".tls") && !s.startsWith("html.tls-root-scope")) escapees.push(s);
          }
        }
        i = k;
      }
    };
    walk(bare);
    expect(escapees).toEqual([]);
  });

  it("keeps the prototype's own topbar out entirely", () => {
    expect(bare).not.toContain(".topbar");
  });

  it("keeps the one non-frozen rule in its own file, and it paints nothing", () => {
    expect(bare).not.toContain("tls-target");
    expect(safety).toContain("min-height: 44px");
    const declarations = safety.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const painting of ["color:", "background", "border", "font-"]) {
      expect(declarations, painting).not.toContain(painting);
    }
  });
});
