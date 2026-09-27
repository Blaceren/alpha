import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolsRegister } from "@/features/tools-fidelity/tools-fidelity";
import {
  learnerCatalog,
  projectTool,
  projectTools,
} from "@/features/tools/model/tools-projection";
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import { toolAccessOpening } from "@/features/tools/model/tool-access-fixture";
import { readBackendToolAccess } from "@/lib/curriculum/backend-dto";
import type { PathProgress } from "@/features/path/model/path-state";

/**
 * ATA-TOOLS-CATALOG-TRUTH-1 — the register lists tools, not announcements.
 *
 * Nineteen catalogue entries exist and two of them have a working surface. The
 * register showed all nineteen, so a learner read seventeen rows that named a
 * level at which something would appear. Those seventeen stay in the data —
 * Backend, curriculum and catalogue are untouched — and leave the learner's
 * screen.
 *
 * The two dimensions must not be confused, so every case below states them
 * separately: IMPLEMENTED is the catalogue's `implementationStatus`, the one
 * declared answer to "does this surface exist in this build"; UNLOCKED is the
 * Backend's verdict and nothing else. Visibility follows the first. Access
 * follows the second. Neither is ever derived from the other, from a level
 * number, from wording, or from a row's position.
 */

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const JOURNAL = "tool.trading_journal";
const CALCULATOR = "tool.risk_calculator";
const CHART = "tool.chart_markup";

const at = (currentLevel: number): PathProgress =>
  ({ scenario: "active", currentLevel, allCompleted: false, rankLabel: "", xpLabel: "", streak: 0 }) as PathProgress;

const BUILT = TOOL_DEFINITIONS.filter((t) => t.implementationStatus === "available");
const ROADMAP = TOOL_DEFINITIONS.filter((t) => t.implementationStatus !== "available");

const shown = (progress: PathProgress, access: ReturnType<typeof toolAccessOpening> | null) =>
  learnerCatalog(projectTools(progress, access));

/** The release this phase was cut from; its footprint is measured against it. */
const BASE = "d32f54fb15b6f9bdd80193d761437e2a026bd5f2";
/**
 * …and the commit it shipped as. The footprint is a CLOSED question, so it is
 * measured over its own range rather than against the working tree: a diff that
 * ends at HEAD grows with every later phase and starts failing for work this
 * file was never about. Each later phase is bounded by its own scope test.
 */
const MINE = "209345dc72ac9a045db62256aa2b83c76e62393a";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

describe("this phase stayed inside its scope", () => {
  const changed = git("diff", "--name-only", BASE, MINE, "--", "src/", "public/")
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

  it("moved three product files and no more", () => {
    expect(changed.sort()).toEqual(
      [
        "src/app/(app)/tools/page.tsx",
        "src/features/tools-fidelity/tools-fidelity.tsx",
        "src/features/tools/model/tools-projection.ts",
      ].sort(),
    );
  });

  it("changed no stylesheet", () => {
    expect(changed.filter((f) => f.endsWith(".css"))).toEqual([]);
  });

  it("left the data, the Backend contract and the catalogue itself alone", () => {
    for (const f of [
      "src/features/tools/model/tool-catalog.ts",
      "src/data/curriculum/fixture.ts",
      "src/lib/curriculum/backend-dto.ts",
      "src/lib/curriculum/academy-view.ts",
      "src/lib/curriculum/view-model.ts",
      "src/features/tools/model/canonical-progress.ts",
      "src/features/tools/model/tool-access-fixture.ts",
      "src/app/(app)/tools/[toolCode]/page.tsx",
    ]) {
      expect(changed, f).not.toContain(f);
    }
  });

  it("touched none of the surfaces this phase was told to leave alone", () => {
    for (const prefix of [
      "src/features/public-home/",
      "src/components/shell/",
      "src/components/navigation/",
      "src/features/auth/",
      "src/server/auth/",
      "src/features/profile-fidelity/",
      "src/features/support/",
      "src/features/notifications/",
      "src/features/path/",
      "src/features/lesson/",
      "src/features/workspace-fidelity/",
      "src/features/report/",
      "src/features/mentor-review/",
      "src/features/academy-experience/",
      "src/features/curriculum-api/",
      "src/lib/curriculum/completion-method.ts",
      "src/middleware.ts",
      "public/",
    ]) {
      expect(changed.filter((f) => f.startsWith(prefix)), prefix).toEqual([]);
    }
  });
});

describe("the catalogue as the learner sees it", () => {
  it("holds the shape this phase is about: nineteen entries, two built", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(19);
    expect(BUILT.map((t) => t.code)).toEqual([JOURNAL, CALCULATOR]);
    expect(ROADMAP).toHaveLength(17);
  });

  // 1
  it("shows a built, unlocked tool as a real link", () => {
    const views = shown(at(18), toolAccessOpening([JOURNAL, CALCULATOR]));
    const journal = views.find((v) => v.code === JOURNAL);
    expect(journal).toBeDefined();
    expect(journal!.available).toBe(true);
    expect(journal!.href).toBe(`/tools/${JOURNAL}`);

    const { container } = render(<ToolsRegister tools={views} />);
    const row = [...container.querySelectorAll(".t-entry")].find((r) =>
      r.textContent?.includes("Trading Journal"),
    )!;
    const link = row.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(`/tools/${JOURNAL}`);
  });

  // 2
  it("shows a built but locked tool, without making it clickable", () => {
    const views = shown(at(2), toolAccessOpening([]));
    expect(views.map((v) => v.code)).toEqual([JOURNAL, CALCULATOR]);
    for (const v of views) {
      expect(v.unlocked).toBe(false);
      expect(v.available).toBe(false);
      expect(v.href).toBeNull();
    }
    const { container } = render(<ToolsRegister tools={views} />);
    expect(container.querySelectorAll(".t-entry")).toHaveLength(2);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  // 3
  it("hides a roadmap tool even when the Backend says it is unlocked", () => {
    // The strongest case: the verdict opens everything. Visibility must not move.
    const everything = toolAccessOpening(TOOL_DEFINITIONS.map((t) => t.id));
    const views = shown(at(100), everything);
    expect(views.map((v) => v.code)).toEqual([JOURNAL, CALCULATOR]);
    expect(views.some((v) => v.code === CHART)).toBe(false);
    // …and the unlock itself was respected for the tools that remain.
    expect(views.every((v) => v.unlocked && v.available)).toBe(true);
  });

  // 4
  it("hides a roadmap tool when it is locked too", () => {
    const views = shown(at(2), toolAccessOpening([]));
    for (const tool of ROADMAP) {
      expect(views.some((v) => v.code === tool.code), tool.code).toBe(false);
    }
  });

  // 5
  it("never opens an unknown code, and never lists one", () => {
    expect(projectTool("tool.nope", at(100), toolAccessOpening([]))).toBeNull();
    // A verdict that names a tool the catalogue does not have adds no row.
    const invented = {
      total: 1,
      unlockedCount: 1,
      tools: [{ code: "tool.nope", unlocked: true, unlockLevel: 1 }],
    };
    const views = shown(at(100), invented);
    expect(views.map((v) => v.code)).toEqual([JOURNAL, CALCULATOR]);
    expect(views.every((v) => !v.available)).toBe(true);
  });

  // 6
  it("fails closed when the verdict is absent", () => {
    expect(readBackendToolAccess(undefined)).toBeNull();
    const views = shown(at(100), null);
    expect(views.map((v) => v.code)).toEqual([JOURNAL, CALCULATOR]);
    expect(views.every((v) => !v.unlocked && !v.available && v.href === null)).toBe(true);
  });

  // 7
  it("fails closed on a malformed `unlocked`", () => {
    const base = { total: 1, unlockedCount: 1 };
    for (const bad of ["true", 1, null, {}, []]) {
      expect(
        readBackendToolAccess({ ...base, tools: [{ code: JOURNAL, unlocked: bad, unlockLevel: 10 }] }),
        String(bad),
      ).toBeNull();
    }
  });

  // 8
  it("fails closed on a duplicated verdict rather than picking a winner", () => {
    const payload = {
      total: 2,
      unlockedCount: 1,
      tools: [
        { code: JOURNAL, unlocked: false, unlockLevel: 10 },
        { code: JOURNAL, unlocked: true, unlockLevel: 10 },
      ],
    };
    expect(readBackendToolAccess(payload)).toBeNull();
  });

  // 9
  it("never tells the learner there are nineteen of anything", () => {
    const access = toolAccessOpening([JOURNAL, CALCULATOR]);
    expect(access.total).toBe(19);
    const views = shown(at(18), access);
    expect(views).toHaveLength(2);
    const { container } = render(<ToolsRegister tools={views} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b19\b/);
    expect(text).not.toMatch(/\b17\b/);
    // No count of any kind is claimed for the register.
    expect(text).not.toMatch(/из \d+/);
  });

  // 10
  it("does not mutate the projection or the Backend payload it filtered", () => {
    const access = toolAccessOpening([JOURNAL]);
    const before = JSON.stringify(access);
    const all = projectTools(at(18), access);
    const allBefore = JSON.stringify(all);
    const visible = learnerCatalog(all);
    expect(visible).toHaveLength(2);
    expect(all).toHaveLength(19);
    expect(JSON.stringify(all)).toBe(allBefore);
    expect(JSON.stringify(access)).toBe(before);
    expect(visible).not.toBe(all);
  });
});

describe("the hub page is wired to the one filter", () => {
  const page = () => src("src/app/(app)/tools/page.tsx");

  it("passes the projection through learnerCatalog before rendering it", () => {
    // The matrix above exercises `learnerCatalog` directly, which proves the
    // rule and not its installation. This is the installation: without it the
    // register goes back to nineteen rows and every case above still passes.
    expect(page()).toContain("learnerCatalog(projectTools(progress, access))");
    expect(page()).toMatch(
      /<ToolsRegister tools=\{progress \? learnerCatalog\(projectTools\(progress, access\)\) : \[\]\} \/>/,
    );
  });

  it("names no tool code of its own", () => {
    // A second list of codes anywhere is a second answer to "what is built".
    expect(page()).not.toMatch(/"tool\./);
    expect(page()).not.toContain("implementationStatus");
    expect(page()).not.toContain("implemented");
  });

  it("keeps the filter's definition in exactly one module", () => {
    const proj = src("src/features/tools/model/tools-projection.ts");
    expect((proj.match(/export function learnerCatalog/g) ?? []).length).toBe(1);
    for (const f of [
      "src/app/(app)/tools/page.tsx",
      "src/app/(app)/tools/[toolCode]/page.tsx",
      "src/features/tools-fidelity/tools-fidelity.tsx",
    ]) {
      expect(src(f), f).not.toContain("view.implemented");
    }
  });
});

describe("one authority, two surfaces", () => {
  // 11
  it("resolves the deep link through the same call as the hub", () => {
    const s = src("src/features/tools/model/tools-projection.ts");
    expect(s).toContain("return projectTools(progress, access).find((view) => view.code === code)");
    // Both routes read the verdict through the one helper.
    for (const page of ["src/app/(app)/tools/page.tsx", "src/app/(app)/tools/[toolCode]/page.tsx"]) {
      expect(src(page), page).toContain("toolAccessOf(result)");
    }
    // The filter is the hub's alone: a deep link still reaches every entry.
    expect(src("src/app/(app)/tools/[toolCode]/page.tsx")).not.toContain("learnerCatalog");
    const access = toolAccessOpening([CHART]);
    expect(projectTool(CHART, at(100), access)?.unlocked).toBe(true);
  });

  // 12
  it("keeps the fixture verdict a declaration, not a second derivation", () => {
    const s = src("src/features/tools/model/tool-access-fixture.ts");
    expect(s).toContain("const FIXTURE_UNLOCKED: Record<PathScenario, readonly string[]>");
    expect(s).toContain(`"${JOURNAL}"`);
    // It must not rebuild the local progression rule the phase before removed.
    expect(s).not.toContain("levelProgressState");
    expect(s).not.toContain("isToolUnlockedByLocalJoin");
  });

  it("leaves the removed local join unused by anything that decides access", () => {
    const s = src("src/features/tools/model/tools-projection.ts");
    const body = s.slice(s.indexOf("export function projectTools"));
    expect(body).not.toContain("isToolUnlockedByLocalJoin");
    expect(body).not.toContain("levelProgressState");
  });
});

describe("what the rendered register contains", () => {
  const views = () => shown(at(18), toolAccessOpening([JOURNAL]));

  // 13
  it("carries no trace of a hidden tool in text, hrefs or the a11y tree", () => {
    const { container } = render(<ToolsRegister tools={views()} />);
    const text = container.textContent ?? "";
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    const labels = [...container.querySelectorAll("[aria-label]")].map(
      (e) => e.getAttribute("aria-label") ?? "",
    );
    const haystack = [text, ...hrefs, ...labels, container.innerHTML].join(" ");
    for (const tool of ROADMAP) {
      expect(haystack, tool.code).not.toContain(tool.title);
      expect(haystack, tool.code).not.toContain(tool.code);
    }
    // And no readiness wording survives, since nothing unbuilt is listed —
    // in the visible text OR in an accessible name, which a screen reader
    // would read out just as loudly.
    for (const where of [text, ...labels, ...hrefs]) {
      expect(where).not.toContain("В разработке");
      expect(where).not.toContain("Требование доступа");
    }
  });

  // 14
  it("gives a locked row no focusable element at all", () => {
    const { container } = render(<ToolsRegister tools={shown(at(2), toolAccessOpening([]))} />);
    for (const row of container.querySelectorAll(".t-entry")) {
      expect(row.querySelectorAll("a, button, [tabindex], input, select, textarea")).toHaveLength(0);
    }
  });

  // 15
  it("gives an unlocked tool one real anchor, so Enter and modified clicks work", () => {
    const { container } = render(<ToolsRegister tools={views()} />);
    const open = [...container.querySelectorAll(".t-entry")].filter((r) => r.querySelector("a"));
    expect(open).toHaveLength(1);
    const link = open[0]!.querySelector("a")!;
    // A real href on a real anchor is what makes Enter, ⌘-click and "open in new
    // tab" behave natively; a div with a handler would satisfy none of them.
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(`/tools/${JOURNAL}`);
    expect(link.getAttribute("role")).toBeNull();
    expect(link.hasAttribute("onclick")).toBe(false);
    // Exactly one tab stop for that tool — and it must really BE one. A
    // `tabIndex={-1}` anchor keeps role="link" and still answers to
    // getAllByRole, so the attribute itself has to be checked.
    expect(within(open[0] as HTMLElement).getAllByRole("link")).toHaveLength(1);
    const tabindex = link.getAttribute("tabindex");
    expect(tabindex === null || Number(tabindex) >= 0, `tabindex=${tabindex}`).toBe(true);
    expect(link.tabIndex).toBeGreaterThanOrEqual(0);
  });

  // 16
  it("shows no Community anywhere", () => {
    const { container } = render(<ToolsRegister tools={views()} />);
    expect(container.textContent ?? "").not.toMatch(/Сообществ/);
    expect(
      [...container.querySelectorAll("a")].filter((a) =>
        (a.getAttribute("href") ?? "").startsWith("/community"),
      ),
    ).toHaveLength(0);
  });

  it("says nothing about future tools in the lead or the empty state", () => {
    const { container } = render(<ToolsRegister tools={[]} />);
    const text = container.textContent ?? "";
    for (const promise of ["будущ", "разработк", "скоро", "появится", "планируется"]) {
      expect(text.toLowerCase(), promise).not.toContain(promise);
    }
  });
});

describe("the roadmap data is preserved, only unlisted", () => {
  it("keeps all seventeen entries in the catalogue and the projection", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(19);
    expect(projectTools(at(18), toolAccessOpening([]))).toHaveLength(19);
    for (const tool of ROADMAP) {
      expect(TOOL_DEFINITIONS.some((t) => t.code === tool.code), tool.code).toBe(true);
    }
  });

  it("filters on the declared status and on nothing else", () => {
    const s = src("src/features/tools/model/tools-projection.ts");
    const fn = s.slice(s.indexOf("export function learnerCatalog"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("view.implemented");
    const forbidden = ["unlockLevel", "currentLevel", "title", "statusLabel", "indexOf"] as const;
    for (const term of forbidden) expect(body, term).not.toContain(term);
    // `implemented` legitimately contains no access word; `unlocked` must not appear.
    expect(body).not.toMatch(/\bunlocked\b/);
  });
});
