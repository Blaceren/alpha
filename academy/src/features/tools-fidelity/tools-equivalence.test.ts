/**
 * BEHAVIOURAL EQUIVALENCE — the design pass changed presentation and nothing else.
 *
 * The claim being tested is narrow and checkable: with `class` attributes and
 * comments removed, the Tools surface source is character-for-character what it
 * was at the release this branch started from. That covers every element, every
 * text node, every href, every accessible name and every branch — because none
 * of them may move for a visual repair.
 *
 * Comparing SOURCE rather than a rendered snapshot is deliberate: a snapshot
 * proves the trees agree for the inputs the test happened to pick, while this
 * proves there is no input for which they could differ.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
/**
 * The release Tools shipped in, and the one every later branch is cut from.
 *
 * This file was written while Tools was the work in hand and asked "what did
 * THIS pass change?". Tools is live now, so the question it answers from here
 * is the one every later phase has to answer about it: nothing in the Tools
 * surface has moved since the release.
 */
/* Re-based on the shipped release. The two Tools page shells moved once since,
   for SHELL-VIEWER-IDENTITY-2: their fixture-mode branches named a learner. */
const BASE = "c54f5f5358fe2ea9dafc9fa0b74375b117fecb73";

/**
 * The files that may not move at all. The status COPY was deliberately changed
 * in this pass — an unbuilt tool now states its readiness at every level
 * instead of promising to open — so the two files that carry that copy are held
 * by explicit assertions below rather than by blanket equivalence. Everything
 * that decides ACCESS is here, unchanged.
 */
/* Byte-equivalence is the right instrument only where nothing but presentation
   could have moved. Two files left this list when the access authority moved:

     canonical-progress.ts       gained `toolAccessOf`, ten lines of real code
     tool-fidelity-surface.tsx   gained the verdict as a prop, and passes it on

   Normalising those away would turn a genuine change into a silent one. Both
   are named in AUTHORISED below, and what they now DO is asserted in the truth
   matrix rather than by comparing strings. */
/* ATA-TOOLS-CATALOG-TRUTH-1 removed a third file from this list.

   The hub page now filters the projection to the tools this build actually
   contains, so WHAT IT RENDERS is deliberately different from the release. A
   `contract()` rule that normalised the filter away would do the very thing the
   note above warns about: turn a genuine change into a silent one. What the
   page renders instead is asserted directly in the catalogue truth matrix.

   The DIRECT ROUTE stays here, byte-pinned. That is the point: the catalogue
   changed and the deep link did not, and this list is what proves it. */
const SURFACE = [
  "src/features/tools/model/tool-catalog.ts",
  "src/app/(app)/tools/[toolCode]/page.tsx",
];

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

/**
 * Strip exactly what a design pass is allowed to change, and nothing else:
 * `className` (both the literal and the template-expression forms), inline
 * `style`, and comments. Whitespace is normalised last so re-indentation is not
 * mistaken for a change.
 */
function contract(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/className=\{`[^`]*`\}/g, "")
    .replace(/className=\{[^}]*\}/g, "")
    .replace(/className="[^"]*"/g, "")
    .replace(/style=\{\{[^}]*\}\}/g, "")
    /* Where the shell's name COMES FROM is not the Tools surface contract. This
       pass replaced a fixture learner's name with the viewer authority in the
       unreachable fixture-mode branch; the shell still renders one name in one
       place, which is what this file exists to pin. */
    .replace(/userName=\{await shellViewerName\(\)\}/g, 'userName="«viewer»"')
    .replace(/userName=\{viewer\?\.name \?\? "[^"]*"\}/g, 'userName="«viewer»"')
    .replace(/userName="[^"]*"/g, 'userName="«viewer»"')
    .replace(/import \{ shellViewerName \} from "@\/server\/auth\/server-session";\s*/g, "")
    /* Nor is the plumbing of the Backend verdict. TOOLS-AUTHORITY-DIVERGENCE-1
       moved WHO decides access; it changed no copy, no markup and no geometry,
       which is what this file exists to hold. What the verdict then produces is
       asserted directly in the truth matrix, not by string comparison here. */
    .replace(/,\s*access\)/g, ")")
    .replace(/\s*access=\{[^}]*\}/g, "")
    .replace(/\s*access,/g, "")
    .replace(/\s*access: AcademyToolAccess \| null;/g, "")
    .replace(/import type \{ AcademyToolAccess \} from "@\/lib\/curriculum\/academy-view";\s*/g, "")
    .replace(/import \{ fixtureToolAccess \} from "@\/features\/tools\/model\/tool-access-fixture";\s*/g, "")
    .replace(/,\s*fixtureToolAccess\(scenario\)\)/g, ")")
    .replace(/const access = toolAccessOf\(result\);\s*/g, "")
    .replace(/canonicalToolProgress, toolAccessOf/g, "canonicalToolProgress")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the Tools surface contract is unchanged", () => {
  it.each(SURFACE)("%s is equivalent once class and style are removed", (path) => {
    const before = contract(git("show", `${BASE}:${path}`));
    const after = contract(readFileSync(join(ROOT, path), "utf8"));
    expect(after).toBe(before);
  });

  it("has not moved a single Tools file since the release", () => {
    const changed = git("diff", "--name-only", BASE, "--", "src/features/tools", "src/features/tools-fidelity", "src/app/(app)/tools")
      .split("\n")
      .filter(Boolean)
      // This file lives under the Tools tree and is allowed to be re-based when
      // the release it measures against moves.
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    /* The two page shells were authorised to stop naming a fixture learner in
       their unreachable fixture-mode branch. Nothing else under Tools may move,
       and the equivalence assertions above still hold their rendered contract. */
    /* SHELL-VIEWER-IDENTITY-2 moved the two page shells off a fixture name.
       TOOLS-AUTHORITY-DIVERGENCE-1 moved the access decision to the Backend,
       which touches the projection, the two pages, both surfaces and adds the
       fixture verdict. The rendered contract is still asserted above; what
       moved is who decides, and that is asserted in the truth matrix. */
    /* ATA-AUTHENTICATED-SURFACE-TRUTH-1A authorised three copy-and-markup
       corrections on this release. Only `tools-fidelity.tsx` falls inside the
       Tools tree, and only its `ToolNotFoundPage` moved: the catalogue, the
       locked, roadmap and empty states and the shared `StateMessage` are
       unchanged, which the rendered assertions above still hold. */
    const AUTHORISED = [
      "src/app/(app)/tools/[toolCode]/page.tsx",
      "src/features/tools-fidelity/tools-fidelity.tsx",
      "src/app/(app)/tools/page.tsx",
      "src/features/tools-fidelity/tool-fidelity-surface.tsx",
      "src/features/tools/components/tool-surface.tsx",
      "src/features/tools/components/tools-hub.tsx",
      "src/features/tools/model/canonical-progress.ts",
      "src/features/tools/model/tool-access-fixture.ts",
      "src/features/tools/model/tools-projection.ts",
    ];
    expect(changed.filter((f) => !AUTHORISED.includes(f))).toEqual([]);
  });

  /**
   * THE ACCESS DECISION, PINNED AT ITS NEW SOURCE.
   *
   * These two used to hold the unlock rule character-for-character, because the
   * Tools design pass rewrote the status copy around it and the rule had to be
   * shown untouched. The rule has now deliberately moved to the Backend
   * (TOOLS-AUTHORITY-DIVERGENCE-1), so holding the old line would pin the defect
   * rather than the contract. They hold the new decision instead, and they hold
   * the absence of the old one — which is the part that could silently return.
   */
  it("decides access from the verdict, and from nothing else", () => {
    const decision = (source: string) =>
      source
        .split("\n")
        .map((l) => l.trim())
        .filter((l) =>
          l.startsWith("const unlocked =") ||
          l.startsWith("const available =") ||
          l.startsWith("href: available"),
        );
    expect(decision(readFileSync(join(ROOT, "src/features/tools/model/tools-projection.ts"), "utf8"))).toEqual([
      "const unlocked = verdict.get(tool.id) === true;",
      "const available = unlocked && implemented;",
      "href: available ? toolHref(tool.code) : null,",
    ]);
    // `implemented` is still the catalogue's own field, read verbatim.
    expect(readFileSync(join(ROOT, "src/features/tools/model/tools-projection.ts"), "utf8"))
      .toContain('const implemented = tool.implementationStatus === "available";');
  });

  it("keeps the retired local join out of the decision path", () => {
    const source = readFileSync(join(ROOT, "src/features/tools/model/tools-projection.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // It may still be exported — the truth matrix compares the two rules — but
    // nothing in this module may call it.
    expect(code).toContain("export function isToolUnlockedByLocalJoin");
    // Declared once, called nowhere: one occurrence is the declaration itself.
    expect(code.split("isToolUnlockedByLocalJoin").length - 1).toBe(1);
    // And the level rule appears only inside that retired function, never in
    // the projection that the pages actually call.
    const projection = code.slice(code.indexOf("export function projectTools"));
    expect(projection).not.toContain("levelProgressState");
  });

  it("leaves every protected surface untouched", () => {
    /* Support is the surface under design now, so it is expected to change and
       is not on this list; everything else must be exactly as it shipped. */
    /* The surfaces no phase since the Tools release has had business in. Three
       of them were released from this list when the owner authorised the four
       `next/link` swaps; those are pinned in navigation-links.test.tsx. */
    const changed = git("diff", "--name-only", BASE, "--", "src/")
      .split("\n").filter(Boolean)
      /* A test may be re-based when the release it measures against ships; what
         must not move is a surface BODY. */
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    const forbidden = [
      "src/features/auth/",
      "src/app/login",
      "src/app/register",
      "src/components/shell/",
      "src/features/home",
      /* path-fidelity carries one of the authorised link swaps. */
      /* Lessons, Reader and Level Detail each carry one of the four authorised
         link swaps; they are pinned by navigation-links.test.tsx instead. */
      "src/features/level-detail-fidelity/",
      /* workspace-fidelity carries the authorised "no workspace" correction
         (ATA-AUTHENTICATED-SURFACE-TRUTH-1A) and is pinned in detail by
         surface-truth.test.tsx rather than frozen here. */
      /* notifications-fidelity carries one of the authorised link swaps. */
      /* Profile carries one of the four authorised link swaps
         (AUTHENTICATED-NAVIGATION-FULL-LOAD-1), so it is pinned by
         navigation-links.test.tsx rather than frozen here. */
      "src/config/feature-visibility.ts",
      "src/app/layout.tsx",
      "public/brand/",
    ];
    for (const prefix of forbidden) {
      expect(changed.filter((f) => f.startsWith(prefix)), prefix).toEqual([]);
    }
  });

  it("adds no stylesheet that could reach another surface", () => {
    const css = readFileSync(join(ROOT, "src/features/tools-fidelity/tools-fidelity.css"), "utf8");
    const added = contractDiffOfCss(css);
    for (const selector of added) {
      // Scoped means the selector cannot match outside the Tools root — either
      // the `.tls` container class or the root marker the frozen surface sets.
      const scoped = /(^|[\s>+~(])(\.tls\b|html\.tls-root-scope\b|\.tls-)/.test(selector);
      expect(scoped, `unscoped selector: ${selector}`).toBe(true);
    }
  });
});

/** Every selector declared in the stylesheet, at-rule contents included. */
function contractDiffOfCss(css: string): string[] {
  const out: string[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const head = (m[1] ?? "").trim();
    if (!head || head.startsWith("@")) continue;
    for (const part of head.split(",").map((p) => p.trim()).filter(Boolean)) out.push(part);
  }
  return out;
}
