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
/** The active PREPROD release this branch was cut from. */
const BASE = "91549bc40dd37c343de31a41223736eb1b41a452";

/**
 * The files that may not move at all. The status COPY was deliberately changed
 * in this pass — an unbuilt tool now states its readiness at every level
 * instead of promising to open — so the two files that carry that copy are held
 * by explicit assertions below rather than by blanket equivalence. Everything
 * that decides ACCESS is here, unchanged.
 */
const SURFACE = [
  "src/features/tools-fidelity/tool-fidelity-surface.tsx",
  "src/features/tools/model/tool-catalog.ts",
  "src/features/tools/model/canonical-progress.ts",
  "src/app/(app)/tools/page.tsx",
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
    .replace(/\s+/g, " ")
    .trim();
}

describe("the Tools surface contract is unchanged", () => {
  it.each(SURFACE)("%s is equivalent once class and style are removed", (path) => {
    const before = contract(git("show", `${BASE}:${path}`));
    const after = contract(readFileSync(join(ROOT, path), "utf8"));
    expect(after).toBe(before);
  });

  it("changed only the Tools presentation files", () => {
    const changed = git("diff", "--name-only", BASE, "--", "src/", "e2e/")
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    expect(changed.sort()).toEqual([
      "src/features/tools-fidelity/tools-fidelity.css",
      "src/features/tools-fidelity/tools-fidelity.tsx",
      "src/features/tools/components/tools-hub.tsx",
      "src/features/tools/model/tools-projection.ts",
      "src/features/tools/tools.css",
    ]);
  });

  /**
   * THE ACCESS DECISION IS NOT PART OF WHAT CHANGED.
   *
   * `tools-projection.ts` carries both the unlock rule and the status copy. The
   * copy was rewritten on purpose; the rule was not, and these hold that line
   * character-for-character rather than trusting the diff to be read carefully.
   */
  it("leaves the unlock rule exactly as it was", () => {
    const fn = (source: string) => {
      const at = source.indexOf("export function isToolUnlocked");
      expect(at).toBeGreaterThan(-1);
      return contract(source.slice(at, source.indexOf("\n}", at) + 2));
    };
    expect(fn(readFileSync(join(ROOT, "src/features/tools/model/tools-projection.ts"), "utf8")))
      .toBe(fn(git("show", `${BASE}:src/features/tools/model/tools-projection.ts`)));
  });

  it("leaves what a row is allowed to open exactly as it was", () => {
    const decision = (source: string) =>
      source
        .split("\n")
        .map((l) => l.trim())
        .filter((l) =>
          l.startsWith("const unlocked = isToolUnlocked") ||
          l.startsWith("const available =") ||
          l.startsWith("href: available"),
        );
    const now = decision(readFileSync(join(ROOT, "src/features/tools/model/tools-projection.ts"), "utf8"));
    expect(now).toEqual([
      "const unlocked = isToolUnlocked(tool, progress);",
      "const available = unlocked && implemented;",
      "href: available ? toolHref(tool.code) : null,",
    ]);
    // `implemented` is the catalogue's own field, read verbatim.
    expect(readFileSync(join(ROOT, "src/features/tools/model/tools-projection.ts"), "utf8"))
      .toContain('const implemented = tool.implementationStatus === "available";');
  });

  it("leaves every protected surface untouched", () => {
    /* Support is the next phase and must not move in this one; the rest are the
       surfaces this pass has no business in. */
    const changed = git("diff", "--name-only", BASE, "--", "src/").split("\n").filter(Boolean);
    const forbidden = [
      "src/features/auth/",
      "src/features/support",
      "src/app/(app)/support",
      "src/app/login",
      "src/app/register",
      "src/components/shell/",
      "src/features/home",
      "src/features/path",
      "src/features/lessons",
      "src/features/level-detail-fidelity/",
      "src/features/workspace",
      "src/features/notifications",
      "src/features/profile",
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
