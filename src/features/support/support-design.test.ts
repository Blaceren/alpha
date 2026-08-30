/**
 * SUPPORT — the desk, as a thing you can use.
 *
 * The surface worked and read as an admin console: a 56rem column pinned to the
 * left of a 1440px screen, two identical filled panels, and a rule that painted
 * every button the route-current green before taking it back three times.
 *
 * There is no frozen Support design source — the only surface in this product
 * without one — so these cases hold the repair against the system that IS
 * accepted: the Tools register's measure and centring, the auth pages' error
 * treatment, and the Ink/Signal rules both obey.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, "src/features/support/support.css"), "utf8");
const TOKENS = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");

/**
 * The declarations of one rule, by exact selector head.
 *
 * Anchored to a line start: `.support-hub__subject {` also occurs INSIDE
 * `…button:hover .support-hub__subject {`, and a plain indexOf returned the
 * hover rule's body instead of the element's own.
 */
function rule(selector: string): string {
  // A head STARTS where the previous rule or comment ended — otherwise
  // `.support-hub textarea {` matches the second line of the shared
  // `input, textarea` head and returns that rule's body instead.
  let from = 0;
  for (;;) {
    const at = CSS.indexOf("\n" + selector, from);
    expect(at, `missing rule head: ${selector}`).toBeGreaterThan(-1);
    const before = CSS.slice(0, at).trimEnd();
    if (before === "" || before.endsWith("}") || before.endsWith("*/")) {
      const open = CSS.indexOf("{", at);
      return CSS.slice(open + 1, CSS.indexOf("}", open));
    }
    from = at + 1;
  }
}

describe("the desk uses the screen it is given", () => {
  it("is centred on the same measure as the Tools register", () => {
    const root = rule(".support-hub {");
    expect(root).toContain("margin-inline: auto");
    expect(root).toContain("max-width: var(--support-measure)");
    // The Tools register's own width, so the two surfaces share an x position.
    expect(CSS).toContain("--support-measure: 1080px");
  });

  it("splits into a form and a register on desktop, and stacks below it", () => {
    const desktop = CSS.slice(CSS.indexOf("@media (min-width: 900px)"));
    expect(desktop).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    expect(desktop).toMatch(/\.support-hub__new\s*\{\s*grid-column:\s*1/);
    expect(desktop).toMatch(/\.support-hub__list\s*\{[\s\S]*?grid-column:\s*2/);
    // The header and an open thread own the full width.
    expect(desktop).toMatch(/\.support-hub__thread\s*\{\s*grid-column:\s*1 \/ -1/);
  });

  it("leaves the fixed bottom navigation clear on mobile", () => {
    const mobile = CSS.slice(CSS.indexOf("@media (max-width: 899px)"));
    expect(mobile).toMatch(/padding-bottom:\s*calc\(var\(--mobile-bottom-nav-height/);
    expect(mobile).toContain("env(safe-area-inset-bottom)");
    // At least the 20px of visual clearance the contract asks for.
    const margin = /\+\s*(\d+)px\)/.exec(mobile.slice(mobile.indexOf("padding-bottom")));
    expect(Number(margin?.[1] ?? 0)).toBeGreaterThanOrEqual(20);
  });
});

describe("hairlines and type, not panels", () => {
  it("no longer draws the form and the register as two filled cards", () => {
    const shared = rule(".support-hub__new,\n.support-hub__list,\n.support-hub__thread {");
    expect(shared).not.toContain("background:");
    expect(shared).not.toContain("border-radius:");
    expect(shared).not.toMatch(/padding:\s*20px/);
  });

  it("separates the two halves with a single rule", () => {
    const desktop = CSS.slice(CSS.indexOf("@media (min-width: 900px)"));
    expect(desktop).toMatch(/border-left:\s*var\(--support-rule\)/);
    expect(CSS).toContain("--support-rule: 1px solid var(--divider)");
  });

  it("builds the register from row rules rather than boxed cards", () => {
    const row = rule(".support-hub__list li button {");
    expect(row).toContain("border: none");
    expect(row).toContain("border-bottom: var(--support-rule)");
    expect(row).toContain("background: transparent");
    expect(row).toMatch(/border-radius:\s*0/);
  });
});

describe("Signal marks one thing", () => {
  it("paints only the primary submit control, not every button", () => {
    // The old base rule was `.support-hub button { background: var(--route-current) }`.
    const submit = rule('.support-hub form > button[type="submit"] {');
    expect(submit).toContain("background: var(--route-current)");
    const green = [...CSS.matchAll(/background:\s*var\(--route-current\)/g)];
    expect(green, "Signal fill appears exactly once").toHaveLength(1);
  });

  it("never uses Signal as an error background", () => {
    const err = rule(".support-hub__error {");
    expect(err).toContain("var(--surface-subtle)");
    expect(err).not.toContain("--route-current");
    expect(err).not.toMatch(/signal/i);
  });

  it("keeps a disabled action legible instead of dissolving it", () => {
    const off = rule('.support-hub form > button[type="submit"]:disabled {');
    expect(off).toContain("var(--text-secondary)");
    expect(off).toMatch(/opacity:\s*1/);
  });

  it("gives an error the same mark the auth pages use, and a neutral surface", () => {
    const mark = rule(".support-hub__error::before {");
    expect(mark).toContain('content: "!"');
    expect(mark).toContain("border-radius: 50%");
    expect(mark).toContain("left: 12px");
    expect(rule(".support-hub__error {")).toMatch(/padding:\s*11px 12px 11px 32px/);
  });
});

describe("nothing a learner types can break the page", () => {
  it("wraps an unbroken token everywhere one can appear", () => {
    for (const sel of [
      ".support-hub__subject {",
      ".support-hub__meta {",
      ".support-hub__original {",
      ".support-hub__message p {",
    ]) {
      expect(rule(sel), sel).toContain("overflow-wrap: anywhere");
    }
  });

  it("lets a textarea grow downwards only", () => {
    const ta = rule(".support-hub textarea {");
    expect(ta).toContain("resize: vertical");
    expect(rule(".support-hub input,")).toContain("max-width: 100%");
  });
});

describe("targets and motion", () => {
  it.each([
    ['.support-hub form > button[type="submit"] {', "submit"],
    [".support-hub__list li button {", "case row"],
    [".support-hub__back {", "back link"],
    [".support-hub__error button {", "retry"],
    [".support-hub input {", "text input"],
    [".support-hub textarea {", "textarea"],
  ])("gives the %s a 44px box", (selector) => {
    expect(rule(selector)).toMatch(/min-height:\s*(44px|120px)/);
  });

  it("honours reduced motion", () => {
    const reduced = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/transition-duration:\s*0\.001s/);
  });
});

describe("the stylesheet stays inside Support", () => {
  it("scopes every selector under .support-hub", () => {
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const heads = [...body.matchAll(/([^{}]+)\{/g)]
      .map((m) => (m[1] ?? "").trim())
      .filter((h) => h && !h.startsWith("@"));
    for (const head of heads) {
      for (const part of head.split(",").map((p) => p.trim()).filter(Boolean)) {
        expect(part.startsWith(".support-hub"), `unscoped: ${part}`).toBe(true);
      }
    }
  });

  it("declares no colour of its own beyond the one documented local", () => {
    const hexes = [...CSS.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0]);
    expect(hexes).toEqual(["#d7a3a8"]);
  });

  it("uses only tokens the global sheet defines", () => {
    const used = new Set([...CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] as string));
    const local = new Set(["--result-negative", "--support-measure", "--support-rule", "--support-gap"]);
    for (const token of used) {
      if (local.has(token)) continue;
      expect(TOKENS.includes(`${token}:`), `undefined token ${token}`).toBe(true);
    }
  });
});

/**
 * SUPPORT-CANVAS-1 — the page sits on the same Ink ground as everything else.
 *
 * The shell paints two decorative radial washes behind an ordinary route. Over
 * the field ground those read as a greener canvas than the accepted surfaces
 * beside it: Support measured `rgb(17, 20, 15)` where Tools and Lessons measure
 * `rgb(11, 13, 10)`. The flag that flattens the wash to the flat Ink ground
 * already exists and is already carried by Tools, Profile and Notifications —
 * Support was simply left out of it.
 *
 * The flag also zeroes the shell's own padding, which above 900px was already
 * zero and below it supplied `20px 16px`. That inset is restated in this
 * stylesheet so the content keeps the x position it was accepted with.
 */
describe("the Support canvas", () => {
  const ROUTE_SRC = readFileSync(join(ROOT, "src/app/(app)/support/page.tsx"), "utf8");
  /* Comments explain the flag by name, so the prop has to be read from the CODE
     — asserting on the file text passed while the prop was removed. */
  const ROUTE = ROUTE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const HOME = readFileSync(join(ROOT, "src/features/home/home.css"), "utf8");

  it("asks the shell for the flat Ink ground", () => {
    expect(ROUTE).toMatch(/<AppShell[^>]*\sfrozenSurface[\s/>]/);
    // And it is the existing mechanism, not a new one: no wrapper, no new prop.
    expect(ROUTE).not.toMatch(/background/i);
    expect(ROUTE).not.toMatch(/box-shadow/i);
  });

  it("uses the ground the other accepted surfaces use", () => {
    // `.home--frozen` is what the flag turns on, and it paints --background-base.
    expect(HOME).toMatch(/\.home--frozen\s*\{\s*background:\s*var\(--background-base\)/);
    const tokens = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");
    expect(tokens).toMatch(/--background-base:\s*var\(--ata-ink-900\)/);
    expect(tokens).toMatch(/--ata-ink-900:\s*#0b0d0a/i);
  });

  it("paints nothing of its own to fake the canvas", () => {
    // No full-bleed hack, no giant shadow, no fixed backdrop in the stylesheet.
    expect(CSS).not.toMatch(/100vw/);
    expect(CSS).not.toMatch(/box-shadow/);
    expect(CSS).not.toMatch(/position:\s*fixed/);
    const root = rule(".support-hub {");
    expect(root).not.toContain("background");
  });

  it("gives back the inset the shell stops providing below 900px", () => {
    const mobile = CSS.slice(CSS.indexOf("@media (max-width: 899px)"));
    expect(mobile).toMatch(/padding-top:\s*20px/);
    expect(mobile).toMatch(/padding-inline:\s*16px/);
    // And the bottom-nav clearance is still the same formula.
    expect(mobile).toMatch(/padding-bottom:\s*calc\(var\(--mobile-bottom-nav-height/);
  });

  it("leaves the desktop measure and centring exactly as accepted", () => {
    const root = rule(".support-hub {");
    expect(root).toContain("max-width: var(--support-measure)");
    expect(root).toContain("margin-inline: auto");
    expect(CSS).toContain("--support-measure: 1080px");
  });
});
