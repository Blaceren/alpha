import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE STAGE'S TWO CORNER MARKS.
 *
 * What was wrong, measured on the released page on 2026-10-01:
 *
 *   - at 640px and narrower both marks had FOUR sides. The narrow tier set
 *     `border-width: 5px`; the global reset gives every border a solid style at
 *     zero width, so the shorthand closed each corner into a square;
 *   - in the two compression tiers the marks stayed where the resting padding
 *     had put them, so their bars lay inside the content: through the last 1px
 *     (short viewport) and 4px (phone) of a closing button, and down beside the
 *     first letter of the heading.
 *
 * Real-browser evidence after the fix, every tier, bars against the ink of the
 * eyebrow, the heading and the last element (scratch `marks.cjs`, nine
 * viewports from 1440x900 to 320x640, on /login, /register, /verify-email and
 * /forgot-password): two sides each, and at least 3px clear everywhere.
 *
 * The stylesheet half of that is checked here, from the numbers it declares.
 */

const CSS = readFileSync(join(process.cwd(), "src/features/auth/auth-stage.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

type Decl = Record<string, string>;

/** The body of the first at-rule with this header, by brace matching. */
function media(header: string): string {
  const at = CSS.indexOf(header);
  if (at < 0) throw new Error(`no such at-rule: ${header}`);
  const open = CSS.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(open + 1, i);
  }
  throw new Error(`unterminated at-rule: ${header}`);
}

/** The stylesheet outside every at-rule. */
function base(): string {
  let out = "";
  let i = 0;
  while (i < CSS.length) {
    const at = CSS.indexOf("@media", i);
    if (at < 0) return out + CSS.slice(i);
    out += CSS.slice(i, at);
    let depth = 0;
    let j = CSS.indexOf("{", at);
    for (; j < CSS.length; j++) {
      if (CSS[j] === "{") depth++;
      else if (CSS[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

/** Every declaration a block makes for one exact selector, selector lists included; later ones win. */
function declared(body: string, selector: string): Decl {
  const out: Decl = {};
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(body))) {
    if (!m[1]!.split(",").map((s) => s.trim()).includes(selector)) continue;
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

const px = (value: string | undefined) => {
  const n = parseFloat(value ?? "");
  if (Number.isNaN(n)) throw new Error(`not a length: ${value}`);
  return n;
};

/** `padding: t s b` or `t r b l`, as the frame declares it. */
function padding(value: string) {
  const [t, r, b, l] = value.split(/\s+/).map(px);
  return { top: t!, right: r!, bottom: b ?? t!, left: l ?? r! };
}

/** `border-top: 6px solid …` gives a width; so does `border-top-width: 5px`. */
function bar(decl: Decl, side: "top" | "right" | "bottom" | "left"): number {
  if (decl[`border-${side}-width`]) return px(decl[`border-${side}-width`]);
  if (decl[`border-${side}`]) return px(decl[`border-${side}`]);
  return 0;
}

const NARROW = "@media (max-width: 640px) {";
const SHORT = "@media (max-height: 820px)";
const COMPACT = "@media (max-width: 640px) and (max-height: 950px)";
/* The marks' own blocks: the same two conditions, spelled differently so that
   they cannot be confused with the tiers, and adding no width value of their
   own (the breakpoint authority gate would refuse one, rightly). */
const SHORT_MARKS = "@media all and (max-height: 820px)";
const COMPACT_MARKS = "@media (max-height: 950px) and (max-width: 640px)";

/** What applies in each tier, in cascade order. */
const TIERS: Record<string, string[]> = {
  "at rest": [base()],
  "tall phone": [base(), media(NARROW)],
  "short, not narrow": [base(), media(SHORT), media(SHORT_MARKS)],
  "phone compact": [base(), media(NARROW), media(SHORT), media(COMPACT), media(SHORT_MARKS), media(COMPACT_MARKS)],
};

function cascade(bodies: string[], selector: string): Decl {
  return Object.assign({}, ...bodies.map((body) => declared(body, selector)));
}

function geometry(tier: string) {
  const bodies = TIERS[tier]!;
  const frame = cascade(bodies, ".auth__frame");
  const before = cascade(bodies, ".auth__frame::before");
  const after = cascade(bodies, ".auth__frame::after");
  const eyebrow = cascade(bodies, ".auth__eyebrow");
  return { pad: padding(frame.padding!), before, after, eyebrow };
}

describe("a corner has two sides", () => {
  it("no rule gives a mark a width on all four sides", () => {
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    let seen = 0;
    while ((m = rule.exec(CSS))) {
      if (!/\.auth__frame::(before|after)/.test(m[1]!)) continue;
      seen += 1;
      // The shorthand is how the squares happened: it switches on the two
      // sides the global reset left solid at zero width.
      expect(m[2], `${m[1]!.trim()} uses a four-sided border shorthand`).not.toMatch(/(^|[;\s])border(-width)?\s*:/);
    }
    expect(seen).toBeGreaterThanOrEqual(8);
  });

  it.each(Object.keys(TIERS))("%s: the top-left mark is top and left, the bottom-right one right and bottom", (tier) => {
    const { before, after } = geometry(tier);
    expect([bar(before, "top") > 0, bar(before, "left") > 0, bar(before, "right"), bar(before, "bottom")]).toEqual([true, true, 0, 0]);
    expect([bar(after, "right") > 0, bar(after, "bottom") > 0, bar(after, "top"), bar(after, "left")]).toEqual([true, true, 0, 0]);
  });
});

describe("a mark stands in the frame's padding, not in its content", () => {
  it.each(Object.keys(TIERS))("%s: both bars of both marks end where the content begins, or before", (tier) => {
    const { pad, before, after } = geometry(tier);
    expect(px(before.top) + bar(before, "top"), "top bar").toBeLessThanOrEqual(pad.top);
    expect(px(before.left) + bar(before, "left"), "left bar").toBeLessThanOrEqual(pad.left);
    expect(px(after.right) + bar(after, "right"), "right bar").toBeLessThanOrEqual(pad.right);
    expect(px(after.bottom) + bar(after, "bottom"), "bottom bar").toBeLessThanOrEqual(pad.bottom);
  });

  it.each(Object.keys(TIERS))("%s: the top-left mark ends before the heading can begin", (tier) => {
    const { pad, before, eyebrow } = geometry(tier);
    // The heading starts under the eyebrow: the padding, a line of eyebrow that
    // is at least its own type size tall, and the eyebrow's margin.
    const headingFrom = pad.top + px(eyebrow["font-size"]) + px(eyebrow["margin-bottom"] ?? eyebrow.margin?.split(/\s+/)[2]);
    expect(px(before.top) + px(before.height)).toBeLessThanOrEqual(headingFrom);
  });

  it("the phone's block comes after the short viewport's, so it wins where both hold", () => {
    expect(CSS.indexOf(COMPACT_MARKS)).toBeGreaterThan(CSS.indexOf(SHORT_MARKS));
    // …and it restates every property the earlier block set, so nothing of the
    // larger mark survives on a phone.
    const names = (header: string, selector: string) => Object.keys(declared(media(header), selector)).sort();
    for (const selector of [".auth__frame::before", ".auth__frame::after"]) {
      expect(names(COMPACT_MARKS, selector)).toEqual(names(SHORT_MARKS, selector));
    }
  });

  it("the compression tiers themselves still change spacing and nothing else", () => {
    // The marks' geometry lives in blocks of its own (see the stylesheet); the
    // two tiers stay what `auth-threshold-layout.test.ts` pins them to be.
    for (const tier of [SHORT, COMPACT]) expect(media(tier)).not.toMatch(/::before|::after/);
  });
});
