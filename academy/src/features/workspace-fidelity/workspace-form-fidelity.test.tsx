/**
 * WORKSPACE FORM — the seam, and what it is not allowed to be.
 *
 * The form's behaviour is covered by its own suites and they were not touched:
 * the submit/resubmit machine, the duplicate-submit guard, the validation
 * semantics, the auth-loss recovery and the live-region adapter all still have
 * exactly the tests they had. This file protects the SEAM — the property that
 * the restoration is presentation and nothing else.
 *
 * It does that three ways:
 *   1. the components' diff against the pre-seam commit touches only class
 *      attributes;
 *   2. every class the seam adds is ADDITIVE — no original class was renamed or
 *      dropped, including the ones tests and logic select on;
 *   3. the adaptation stylesheet cannot hide a control, move a live region or
 *      change what is focusable.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PRE_SEAM = "b75f1537de5bf2abe9bf99e171f4779785a547de";
/* `report-status-panel.tsx` LEFT THIS LIST in ATA-REPORT-EVIDENCE-CONTRACT-1.

   Byte-equivalence is the right instrument only where nothing but presentation
   could have moved. The panel gained real behaviour — it now draws the review
   of each revision, which the contract did not carry before — so normalising
   that away would turn a genuine change into a silent one. What it renders is
   asserted directly in `features/report/evidence-arc.test.tsx`, including that
   it invents no stage. The seam's own concern, that the workspace form did not
   change, is untouched: the other three files are still held here. */
const COMPONENTS = [
  "src/features/report/level-report.tsx",
  "src/features/report/components/report-field.tsx",
  "src/features/report/components/validation-summary.tsx",
];

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });

/**
 * Remove class attributes entirely — including the ones the seam added to
 * elements that previously carried none. Adding a presentation class to an
 * unclassed element is explicitly permitted; what is not permitted is any other
 * difference, and that is what survives this.
 */
function withoutClasses(source: string): string {
  return source
    .replace(/\s*className=\{`[^`]*`\}/g, "")
    .replace(/\s*className="[^"]*"/g, "")
    /* One element grew from a single line to several when its class became a
       template literal. Line breaks are not a change to anything this test is
       about, so whitespace is collapsed; every attribute, every child and every
       string still has to match exactly. */
    .replace(/\s+/g, " ")
    /* ...and the closing bracket of a multi-line tag sits on its own line, so
       `}>` becomes `} >`. Still formatting, still not a change. */
    .replace(/\s+(\/?>)/g, "$1")
    /* AUTHENTICATED-NAVIGATION-FULL-LOAD-1 turned this file's internal anchor
       into a `next/link`. `Link` renders the same `<a>` with the same href,
       class, children and position — the rendered contract this test protects
       is untouched — so the tag NAME is normalised here and every attribute,
       child and string still has to match exactly. */
    .replace(/<(\/?)Link\b/g, "<$1a")
    /* ...and the import that swap needs. Both halves of the same authorised
       change; everything else in the file still has to match exactly. */
    .replace(/import Link from "next\/link";\s*/g, "")
    .trim();
}

describe("Workspace form — the seam is presentation only", () => {
  it("changes nothing in the components except class attributes", () => {
    for (const file of COMPONENTS) {
      const before = git("show", `${PRE_SEAM}:${file}`);
      const after = readFileSync(join(ROOT, file), "utf8");
      expect(withoutClasses(after), file).toBe(withoutClasses(before));
    }
  });

  it("only ever ADDS classes — never renames one, never drops one", () => {
    /* Counted as a multiset per file: a class that existed before must still
       appear at least as many times after. A rename would drop the old name;
       a removal would drop it too. Neither can pass this. */
    const tally = (s: string) => {
      const counts = new Map<string, number>();
      for (const m of s.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const cls of (m[1] ?? m[2] ?? "").split(/\s+|\$\{[^}]*\}/).filter(Boolean)) {
          counts.set(cls, (counts.get(cls) ?? 0) + 1);
        }
      }
      return counts;
    };
    for (const file of COMPONENTS) {
      const before = tally(git("show", `${PRE_SEAM}:${file}`));
      const after = tally(readFileSync(join(ROOT, file), "utf8"));
      for (const [cls, n] of before) {
        expect(after.get(cls) ?? 0, `${file}: "${cls}" appeared ${n}x before`).toBeGreaterThanOrEqual(n);
      }
    }
  });

  it("keeps every selector the logic and the existing tests stand on", () => {
    const source = COMPONENTS.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
    for (const anchor of [
      "rpt__form",          // level-report.test: the editable form
      "rpt-readonly",       // level-report.test: the read-only echo
      "rpt-group",          // level-report.test: querySelectorAll('.rpt-group[data-group]')
      "data-group",
      "data-field",
      "rpt__status",        // the live region
      'role="status"',
      'aria-live="polite"',
    ]) {
      expect(source, anchor).toContain(anchor);
    }
  });

  it("leaves the product's own report stylesheet byte-identical inside its layer", () => {
    /* UNCHANGED CLAIM, ONE BLOCK EXCISED FIRST.
       This still compares every declaration the seam measured, exactly as it
       did — the seam wrapped the sheet in a layer without touching a single
       declaration, and that is what is being held. What changed is that a later
       phase appended the evidence arc's own rules, so the comparison is made
       against the sheet with that block removed. If the arc block were ever to
       edit an existing rule instead of adding its own, the excision would not
       reproduce the earlier declaration list and this would fail. */
    const before = git("show", `${PRE_SEAM}:src/features/report/report.css`);
    const whole = readFileSync(join(ROOT, "src/features/report/report.css"), "utf8");
    const opensAt = whole.indexOf("/* --- the evidence arc --- */");
    const closesAt = whole.indexOf("/* --- done / completed --- */");
    expect(opensAt, "the arc block is missing").toBeGreaterThan(-1);
    expect(closesAt).toBeGreaterThan(opensAt);
    const arc = whole.slice(opensAt, closesAt);
    const after = whole.slice(0, opensAt) + whole.slice(closesAt);
    const declarations = (css: string) => {
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
      return [...bare.matchAll(/\{([^{}]*)\}/g)]
        .flatMap((m) => m[1]!.split(";"))
        .map((d) => d.split(/\s+/).join(" ").trim())
        .filter(Boolean);
    };
    expect(declarations(after)).toEqual(declarations(before));
    // And the excised block only ever declares the arc's own selectors.
    for (const selector of arc.match(/^\.[\w-]+[^{]*\{/gm) ?? []) {
      expect(selector.trim(), selector).toMatch(/^\.rpt-(arc|verdict)/);
    }
    expect(whole).toContain("@layer ata-report-base {");
  });
});

describe("Workspace form — the adaptation sheet cannot change behaviour", () => {
  const css = readFileSync(
    join(ROOT, "src/features/workspace-fidelity/workspace-form-fidelity.css"),
    "utf8",
  );
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("is scoped to the Workspace host and nowhere else", () => {
    const selectors = [...bare.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) {
      expect(sel, sel).toMatch(/^\.wsp /);
    }
  });

  it("hides only the one duplicated marker it declares, and nothing interactive", () => {
    const hides = [...bare.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)].map((m) => m[1]!.trim());
    expect(hides).toEqual([".wsp .ws-host .rf > .rf__req:last-child"]);
    for (const forbidden of ["button", "input", "textarea", "select", "a{", "[role=", "aria-"]) {
      expect(hides.join(" "), forbidden).not.toContain(forbidden);
    }
  });

  it("never touches visibility, opacity, pointer-events or content", () => {
    for (const property of ["visibility:", "opacity:", "pointer-events:", "content:\"" ]) {
      const hits = bare.split(property).length - 1;
      /* `content: ""` is allowed only where the frozen source itself uses a
         pseudo-element, and this sheet no longer does. */
      expect(hits, property).toBe(0);
    }
  });

  it("makes no remote request", () => {
    expect(bare).not.toMatch(/https?:\/\//);
    expect(bare).not.toContain("@import");
  });
});
