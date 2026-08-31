/**
 * H-STALE-1 — a fallback nobody can reach is still text somebody will read.
 *
 * `academy-video-player.css` carried the retired navy/teal palette as
 * `var(--token, #fallback)`. Every one of those tokens is defined, so the
 * fallback never applied and no pixel ever rendered in the old palette. That is
 * exactly what made it worth fixing and safe to fix: there was nothing to see,
 * and the next reader would have believed the hex.
 *
 * Two things are pinned here, and they are different claims.
 *
 * FIRST, that the change was invisible: every token used as a `var()` primary
 * in that file is defined in the design tokens, so the fallback position is
 * unreachable and its contents cannot affect a rendered colour. That is the
 * proof of zero visual difference — not a screenshot, which could only show
 * that one state of one component happened to match.
 *
 * SECOND, that the retired palette does not come back. The old values are
 * listed by hand: a colour is retired the moment nothing renders it, and the
 * only way to keep it retired is to name it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PLAYER = "src/components/media/academy-video-player.css";

/** The navy/teal values this product stopped rendering at the Ink/Signal pass. */
const RETIRED = [
  "#5cf0c6", "#39d3a6", "#070b12", "#0e1524",
  "#eef2f8", "#cdd6e3", "#aab4c7", "#6f9ad8", "#7fd8bd",
];

function designTokenSource(): string {
  // Every stylesheet under src, so a token defined anywhere in the app counts.
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p);
      else if (p.endsWith(".css")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join(ROOT, "src"));
  return out.join("\n");
}

describe("the video player's palette", () => {
  const css = readFileSync(join(ROOT, PLAYER), "utf8");

  it("names no retired colour, in a value or a comment", () => {
    const found = RETIRED.filter((hex) => css.toLowerCase().includes(hex.toLowerCase()));
    expect(found, "the navy/teal palette was retired; these are its values").toEqual([]);
    expect(css.toLowerCase()).not.toMatch(/\bteal\b|\bnavy\b/);
  });

  it("falls back only to tokens that are actually defined, so no fallback can render", () => {
    /* `--avp-*` are the player's OWN per-instance properties: the component
       sets aspect ratio, object-fit and progress inline on the element, and
       their fallbacks are the default for an instance that sets none. Those
       fallbacks are meant to be reachable. Design tokens are the opposite —
       theirs must never be. */
    const tokens = [...css.matchAll(/var\(--([a-z0-9-]+)[,)]/g)]
      .map((m) => m[1] ?? "")
      .filter((t) => t !== "" && !t.startsWith("avp-"));
    expect(tokens.length).toBeGreaterThan(10);
    const defined = designTokenSource();
    const missing = [...new Set(tokens)].filter((t) => !defined.includes(`--${t}:`));
    expect(
      missing,
      "an undefined token makes its fallback reachable, and a fallback that can render is a second palette",
    ).toEqual([]);
  });

  it("uses tokens rather than literals for every fallback that names a brand colour", () => {
    // Text greys are literal on purpose: they ARE the current values. What must
    // never reappear is a literal standing in for an accent or a surface.
    for (const line of css.split("\n")) {
      const m = /var\(--(route-current|signal-active|background-base|surface-context|route-upcoming|focus-ring), *([^)]+)\)/.exec(line);
      if (m) expect((m[2] ?? "").trim(), line.trim()).toMatch(/^var\(--/);
    }
  });
});
