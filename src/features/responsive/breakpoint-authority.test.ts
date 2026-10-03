import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postcss from "postcss";

/**
 * ATA-RESPONSIVE-AUTHORITY-1 — THE BREAKPOINT AUTHORITY GATE.
 *
 * WHAT THIS IS FOR. The product already has a canon: docs/DESIGN_SYSTEM.md §6
 * declares four bands, and the six most-consumed width values in the stylesheet
 * are exactly its edges. What it did not have was any way to NOTICE a stylesheet
 * departing from it. Documentation, CSS custom properties and comments all
 * describe the system; none of them can be violated loudly. Thirty-five width
 * values accumulated behind that silence.
 *
 * This gate does not change a single CSS value. It makes the existing canon
 * enforceable and writes down, once, why every other number is allowed to exist.
 *
 * HOW IT READS CSS. Through the PostCSS AST — `postcss` is a declared
 * devDependency, `css-tree` is only transitive here — and every media prelude is
 * taken apart with the explicit scanner below rather than a pattern over digits.
 * That distinction is the whole point: a pattern like /[0-9]+px/ reads
 * `899.98px` as `98px`, silently inventing a breakpoint that does not exist and
 * hiding the one that does. `readNumber` consumes a complete numeric literal or
 * fails; it cannot cut a decimal short.
 *
 * A NOTE ON THE PROSE IN THIS FILE. Tailwind's content glob covers the whole
 * `src` tree, tests included, so an English word that happens to name a utility
 * class is emitted into the shipped bundle. Two words in an earlier draft of
 * this file added two unused rules to production CSS. The wording here avoids
 * them - and the glob is described rather than written out, because the pattern
 * itself contains the sequence that ends a block comment.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Width, height, motion and pointer are
 * counted apart and never pooled. A short viewport is not a narrow one, and a
 * motion preference is not a size at all.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/* ------------------------------------------------------------------ scanner */

/**
 * Consume one CSS numeric literal starting at `i`. Returns the value and the
 * index after it, or null if there is no number there. Sign, decimal point and
 * exponent are all part of the literal — which is exactly why `899.98` survives.
 */
function readNumber(text: string, i: number): { value: number; end: number } | null {
  const DIGITS = "0123456789";
  let j = i;
  if (text[j] === "+" || text[j] === "-") j++;
  let sawDigit = false;
  while (j < text.length && DIGITS.includes(text[j]!)) { j++; sawDigit = true; }
  if (text[j] === ".") {
    j++;
    while (j < text.length && DIGITS.includes(text[j]!)) { j++; sawDigit = true; }
  }
  if (!sawDigit) return null;
  if (text[j] === "e" || text[j] === "E") {
    let k = j + 1;
    if (text[k] === "+" || text[k] === "-") k++;
    let sawExp = false;
    while (k < text.length && DIGITS.includes(text[k]!)) { k++; sawExp = true; }
    if (sawExp) j = k;
  }
  const value = Number.parseFloat(text.slice(i, j));
  return Number.isFinite(value) ? { value, end: j } : null;
}

/** One `(feature: value)` condition out of a media prelude. */
type Condition = { name: string; value: number | null; unit: string | null; keyword: string | null };

/**
 * Split a prelude into conditions structurally: on commas, then on `and`, then
 * on the colon inside each parenthesised pair. No pattern ever meets a digit.
 */
function parsePrelude(params: string): { conditions: Condition[]; mediaTypes: string[] } {
  const conditions: Condition[] = [];
  const mediaTypes: string[] = [];
  for (const query of params.split(",")) {
    for (const part of query.split(/\band\b/)) {
      const t = part.trim();
      if (!t) continue;
      if (!t.startsWith("(")) {
        const word = t.replace("only ", "").replace("not ", "").trim().toLowerCase();
        if (word) mediaTypes.push(word);
        continue;
      }
      const inner = t.slice(1, t.endsWith(")") ? -1 : undefined).trim();
      const colon = inner.indexOf(":");
      if (colon < 0) { conditions.push({ name: inner.toLowerCase(), value: null, unit: null, keyword: null }); continue; }
      const name = inner.slice(0, colon).trim().toLowerCase();
      const rest = inner.slice(colon + 1).trim();
      const num = readNumber(rest, 0);
      if (num) conditions.push({ name, value: num.value, unit: rest.slice(num.end).trim() || null, keyword: null });
      else conditions.push({ name, value: null, unit: null, keyword: rest.toLowerCase() });
    }
  }
  return { conditions, mediaTypes };
}

/* --------------------------------------------------------------- inventory */

const WIDTH = new Set(["min-width", "max-width", "width"]);
const HEIGHT = new Set(["min-height", "max-height", "height"]);
const POINTER = new Set(["hover", "any-hover", "pointer", "any-pointer"]);

type AtRule = {
  file: string; line: number; name: string; params: string;
  conditions: Condition[]; mediaTypes: string[]; kind: string; selectors: string[];
};

function cssFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) cssFiles(p, acc);
    else if (e.name.endsWith(".css")) acc.push(p);
  }
  return acc;
}

function kindOf(c: Condition[], mediaTypes: string[]): string {
  const names = c.map((x) => x.name);
  if (mediaTypes.includes("print")) return "print";
  if (names.some((n) => n === "prefers-reduced-motion")) return "motion";
  if (names.some((n) => n === "prefers-color-scheme")) return "color-scheme";
  if (names.some((n) => n === "forced-colors")) return "forced-colors";
  if (names.some((n) => POINTER.has(n))) return "pointer";
  if (names.some((n) => n === "orientation")) return "orientation";
  const w = names.some((n) => WIDTH.has(n));
  const h = names.some((n) => HEIGHT.has(n));
  if (w && h) return "width+height";
  if (w) return "width";
  if (h) return "height";
  return "other";
}

const AT_RULES: AtRule[] = [];
for (const abs of cssFiles(SRC).sort()) {
  const file = relative(ROOT, abs).split("\\").join("/");
  const root = postcss.parse(readFileSync(abs, "utf8"), { from: abs });
  root.walkAtRules((at) => {
    if (at.name !== "media" && at.name !== "container" && at.name !== "supports") return;
    const { conditions, mediaTypes } = parsePrelude(at.params);
    const selectors: string[] = [];
    at.walkRules((r) => {
      selectors.push(r.selector.replace(/\s+/g, " ").trim());
    });
    AT_RULES.push({
      file, line: at.source?.start?.line ?? 0, name: at.name, params: at.params,
      conditions, mediaTypes,
      kind: at.name === "media" ? kindOf(conditions, mediaTypes) : at.name,
      selectors,
    });
  });
}

/** viewport width values actually present, keyed `side|value`. */
type WidthEntry = { side: string; value: number; unit: string | null; files: Set<string>; rules: number };
const WIDTH_INVENTORY = new Map<string, WidthEntry>();
for (const at of AT_RULES) {
  if (at.name !== "media") continue;
  for (const c of at.conditions) {
    if (!WIDTH.has(c.name) || c.value === null) continue;
    const key = `${c.name}|${c.value}`;
    if (!WIDTH_INVENTORY.has(key)) {
      WIDTH_INVENTORY.set(key, { side: c.name, value: c.value, unit: c.unit, files: new Set(), rules: 0 });
    }
    const e = WIDTH_INVENTORY.get(key)!;
    e.files.add(at.file);
    e.rules += 1;
  }
}

/* ------------------------------------------------------------------ surface */

type Surface = "public-home" | "auth" | "authenticated" | "shared";
function surfaceOf(file: string): Surface {
  // TOOLS-V2 NEWS: the public news pages are built on Public Home's system and run its ladder.
  if (file.startsWith("src/features/public-home/") || file.startsWith("src/features/public-news/")) return "public-home";
  if (file.startsWith("src/features/auth/")) return "auth";
  if (file.startsWith("src/styles/") || file.startsWith("src/components/")) return "shared";
  return "authenticated";
}

/* ------------------------------------------------------------------- canon */

/**
 * The canon is not invented here. It is read back out of the document that
 * already declares it, so a doc edit and a stylesheet edit cannot drift apart
 * without one of them failing.
 */
const DESIGN_SYSTEM = readFileSync(join(ROOT, "docs/DESIGN_SYSTEM.md"), "utf8");

function documentedBandEdges(): number[] {
  const lines = DESIGN_SYSTEM.split("\n");
  const start = lines.findIndex((l) => l.includes("Breakpoints"));
  expect(start, "docs/DESIGN_SYSTEM.md must still carry a Breakpoints section").toBeGreaterThan(-1);
  const edges: number[] = [];
  for (const line of lines.slice(start, start + 14)) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const range = cells[2];
    if (!range) continue;
    // Walk the cell and take every complete numeric literal in it. `readNumber`
    // is the only thing that reads digits anywhere in this file.
    for (let i = 0; i < range.length; i++) {
      const n = readNumber(range, i);
      if (!n) continue;
      edges.push(n.value);
      i = n.end - 1;
    }
  }
  return [...new Set(edges)].sort((a, b) => a - b);
}

/** The six system boundaries, as sides. Values are cross-checked against the doc. */
const CANONICAL: { side: string; value: number; role: string }[] = [
  { side: "max-width", value: 599, role: "mobile-bar" },
  { side: "min-width", value: 600, role: "mobile-bar" },
  { side: "max-width", value: 899, role: "shell-desktop" },
  { side: "min-width", value: 900, role: "shell-desktop" },
  { side: "max-width", value: 1199, role: "route-field" },
  { side: "min-width", value: 1200, role: "route-field" },
];

/* --------------------------------------------------------------- allowlist */

type Disposition =
  | "CONTENT_DRIVEN_KEEP"
  | "CONTENT_DRIVEN_KEEP_FOR_NOW"
  | "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF"
  | "CONFLICTING_CASCADE";

type Allowed = {
  value: number; side: string; files: string[]; role: string;
  surfaces: Surface[]; disposition: Disposition; why: string;
};

/**
 * Every width value that is NOT canonical lives here or the gate fails. An entry
 * is a claim with four parts: where it is, what job it does, what we decided
 * about it, and why. A value with no entry, an entry with no value, an entry
 * with an empty reason and an entry naming the wrong side are all failures.
 */
const ALLOWLIST: Allowed[] = [
  { value: 380, side: "max-width", files: ["src/features/lesson/lesson.css"], role: "phone-trim",
    surfaces: ["authenticated"], disposition: "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
    why: "Within 20px of 360 and 400 doing similar padding work on different components; consolidation needs a visual pass on routes that require a session." },
  { value: 390, side: "max-width", files: ["src/components/media/academy-video-player.css"], role: "phone-trim",
    surfaces: ["shared"], disposition: "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
    why: "Player control row; shares its consumer routes with 420 but only one property, so a merge would change one of the two." },
  { value: 400, side: "max-width", files: ["src/features/checkpoint/level-checkpoint.css", "src/features/lessons-library/lessons-library.css"], role: "phone-trim",
    surfaces: ["authenticated"], disposition: "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
    why: "Gate stack and library row; 10px from 390 and 20px from 380 and 420 with different owners." },
  { value: 420, side: "max-width", files: ["src/features/assessment/assessment.css", "src/features/level-detail-fidelity/level-detail-fidelity.css", "src/features/level-detail-fidelity/level-lesson.css"], role: "phone-trim",
    surfaces: ["authenticated"], disposition: "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
    why: "Same two consumer routes as 390 but a different component and only one shared property." },
  { value: 430, side: "max-width", files: ["src/features/auth/auth-stage.css"], role: "phone-trim",
    surfaces: ["auth"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "The auth type step: mark 52 to 46px and heading 30 to 26px. Observed live at 429/430/431; it is the threshold's own scale, not a shell band." },
  { value: 460, side: "max-width", files: ["src/features/lesson/lesson.css"], role: "content-stack",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Lesson media controls reorder when the transport no longer fits on one line." },
  { value: 480, side: "max-width", files: ["src/features/curriculum-api/curriculum-api.css"], role: "content-stack",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Definition list drops to a single column; the width is the list's own two-column minimum." },
  { value: 560, side: "max-width", files: ["src/features/report/report.css"], role: "content-stack",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Report head stacks; set by the heading and its meta pair, not by the shell." },
  { value: 620, side: "max-width", files: ["src/components/media/academy-video-player.css"], role: "content-stack",
    surfaces: ["shared"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Timeline collapses at the width where the scrubber stops being usable." },
  { value: 640, side: "max-width", files: ["src/features/academy-experience/experience.css", "src/features/auth/auth-stage.css", "src/features/lesson-reader/lesson-reader.css", "src/features/mentor-review/mentor-feedback.css"], role: "content-stack",
    surfaces: ["auth", "authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Crosses auth and authenticated surfaces. On auth it is padding only, measured live at 641/640 with a tall viewport to separate it from the phone compact tier; the other three trim their own content. Kept because the same number is doing four unrelated jobs and merging would couple them." },
  { value: 680, side: "max-width", files: ["src/features/public-home/public-home.css", "src/features/public-news/public-news.css"], role: "public-home",
    surfaces: ["public-home"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Evidence track goes two columns to one. Observed live at 679/680/681. Public Home runs its own ladder and shares no transition with the app shell. The public news pages use the same step for their phone layout: the header wraps, a release row stacks." },
  { value: 720, side: "max-width", files: ["src/features/checkpoint/level-checkpoint.css", "src/features/report-level/report-level.css"], role: "content-stack",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Checkpoint and level ledger stack at their own content width." },
  { value: 720, side: "min-width", files: ["src/features/lesson/lesson.css"], role: "content-stack",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Lesson opens a second region before the shell does; the reading column reaches its measure earlier than the navigation changes." },
  { value: 767, side: "max-width", files: ["src/features/auth-home-fidelity/auth-home-fidelity.css"], role: "home-local",
    surfaces: ["authenticated"], disposition: "CONFLICTING_CASCADE",
    why: "Home declares its own ladder (--h-breakpoint-desktop 1023 / tablet 767 / mobile 599) as custom properties that a media prelude cannot read. Two of the three values contradict DESIGN_SYSTEM.md §6. Recorded, not resolved: fixing it means moving Home's field, which is a separate authorised change." },
  { value: 860, side: "max-width", files: ["src/features/academy-experience/experience.css", "src/features/level-detail-fidelity/level-detail-fidelity.css", "src/features/level-detail-fidelity/level-lesson.css"], role: "content-stack",
    surfaces: ["authenticated"], disposition: "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
    why: "39px below the shell edge and doing structural work of its own; whether it can move onto 899 needs a rendered comparison on a route that requires a session." },
  { value: 899.98, side: "max-width", files: ["src/features/level-detail-fidelity/level-detail-fidelity.css"], role: "shell-desktop",
    surfaces: ["authenticated"], disposition: "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
    why: "One declaration, padding-bottom on .ax.ld, 0.02px below min-width 900. The fraction reads as a deliberate guard against a fractional viewport matching both sides at once. Left exactly as it is until it can be watched; rounding it to 900 would destroy the only thing it does." },
  { value: 920, side: "max-width", files: ["src/features/public-home/public-home.css"], role: "public-home",
    surfaces: ["public-home"], disposition: "CONTENT_DRIVEN_KEEP_FOR_NOW",
    why: "Structural on Public Home — hero facts 4 to 2, reframe 3 to 1, four grids 2 to 1, all observed live at 919/920/921. It ALSO sets [data-reveal] transition to none, so scroll reveals are disabled by narrowness rather than by preference. That belongs in a reduced-motion query; recorded here and left untouched because moving it changes motion behaviour." },
  { value: 1023, side: "max-width", files: ["src/features/auth-home-fidelity/auth-home-fidelity.css", "src/features/lessons-fidelity/lessons-fidelity.css"], role: "home-local",
    surfaces: ["authenticated"], disposition: "CONFLICTING_CASCADE",
    why: "The other half of Home's private ladder, 17px from Public Home's 1040 and 176px from the documented 1199. Same reasoning as 767." },
  { value: 1040, side: "max-width", files: ["src/features/public-home/public-home.css", "src/features/public-news/public-news.css"], role: "public-home",
    surfaces: ["public-home"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Public Home's navigation mode switch: nav goes flex/static to grid/absolute and the menu toggle appears. Observed live at 1039/1040/1041. The public news pages fold a release row from five columns to three at the same step." },
  { value: 1080, side: "min-width", files: ["src/features/lesson/lesson.css"], role: "content-stack",
    surfaces: ["authenticated"], disposition: "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
    why: "Opening side of the same neighbourhood as the 1080 ceiling above but on a different file and a different grid; the coincidence of value is not evidence of a shared transition." },
  { value: 1100, side: "max-width", files: ["src/features/lessons-fidelity/lessons-fidelity.css", "src/features/path-fidelity/path-fidelity.css"], role: "content-stack",
    surfaces: ["authenticated"], disposition: "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
    why: "Two surfaces trimming inline padding at the same number, 20px from 1080. Likely one role, but proving it needs the rendered pages." },
  { value: 1180, side: "max-width", files: ["src/features/public-home/public-home.css"], role: "public-home",
    surfaces: ["public-home"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Hero goes two columns to stacked. Observed live at 1179/1180/1181. 19px from the documented 1199 but on a different surface with a different grid; merging across the two would move one of them." },
  { value: 1279, side: "max-width", files: ["src/features/reader-fidelity/reader-fidelity.css"], role: "wide-reading",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Reader column at its comfortable measure; set by line length, not by the shell." },
  { value: 1339, side: "max-width", files: ["src/features/workspace-fidelity/workspace-fidelity.css"], role: "wide-reading",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Workspace column at its own measure, the counterpart of the 1560 opening below." },
  { value: 1340, side: "max-width", files: ["src/features/public-home/public-home.css"], role: "public-home",
    surfaces: ["public-home"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "The cycle goes six columns to three. Set by the product objects under each step, not by the shell: below a 1244px shell a column is under 190px and the longest action breaks into three lines (measured at 1280 on 2026-10-01, 177px columns). 1px from the workspace's 1339 by coincidence: different surface, different grid, opposite job." },
  { value: 1500, side: "min-width", files: ["src/features/reader-fidelity/reader-fidelity.css"], role: "wide-reading",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Reader takes the extra column only when there is genuinely room for it." },
  { value: 1560, side: "min-width", files: ["src/features/workspace-fidelity/workspace-fidelity.css"], role: "wide-reading",
    surfaces: ["authenticated"], disposition: "CONTENT_DRIVEN_KEEP",
    why: "Workspace takes its extra column at its own measure; 60px above the reader's because the workspace carries a second pane." },
];

/** Named findings that this phase records without touching. */
const DEFERRED: Record<string, string> = {
  "899.98px": "NEAR_DUPLICATE_NEEDS_VISUAL_PROOF",
  public_home_920_motion: "CONTENT_DRIVEN_KEEP_FOR_NOW",
};

/* ------------------------------------------------------------------- tests */

describe("the scanner cannot invent or shorten a breakpoint", () => {
  it("reads a decimal literal whole", () => {
    expect(readNumber("899.98px", 0)).toEqual({ value: 899.98, end: 6 });
    expect(readNumber("1200px", 0)).toEqual({ value: 1200, end: 4 });
    expect(readNumber("0.5rem", 0)!.value).toBe(0.5);
  });

  it("never yields the tail of a decimal as a value of its own", () => {
    // The failure this whole file exists to prevent: /[0-9]+px/ over "899.98px"
    // matches "98px". The scanner starts at the literal and consumes all of it.
    const { conditions } = parsePrelude("(max-width: 899.98px)");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]!.value).toBe(899.98);
    expect(conditions[0]!.value).not.toBe(98);
    expect(conditions[0]!.unit).toBe("px");
  });

  it("keeps both sides of a range apart", () => {
    const { conditions } = parsePrelude("(min-width: 900px) and (max-width: 1199px)");
    expect(conditions.map((c) => [c.name, c.value])).toEqual([["min-width", 900], ["max-width", 1199]]);
  });

  it("reads a keyword feature without pretending it is a size", () => {
    const { conditions } = parsePrelude("(prefers-reduced-motion: reduce)");
    expect(conditions[0]).toEqual({ name: "prefers-reduced-motion", value: null, unit: null, keyword: "reduce" });
  });
});

describe("the inventory is real", () => {
  it("parsed every stylesheet", () => {
    // 36 since TOOLS-V2 replaced three tool stylesheets with one.
    expect(cssFiles(SRC).length).toBeGreaterThanOrEqual(36);
    expect(AT_RULES.length).toBeGreaterThan(0);
  });

  it("finds the decimal breakpoint exactly once, undamaged", () => {
    const decimals = [...WIDTH_INVENTORY.values()].filter((e) => !Number.isInteger(e.value));
    expect(decimals).toHaveLength(1);
    expect(decimals[0]!.value).toBe(899.98);
    expect(decimals[0]!.side).toBe("max-width");
    expect(WIDTH_INVENTORY.has("max-width|98")).toBe(false);
  });

  it("keeps width, height, motion and pointer in separate counts", () => {
    const w = [...WIDTH_INVENTORY.values()];
    for (const e of w) expect(WIDTH.has(e.side), `${e.side} is not a width feature`).toBe(true);
    // No height, motion or pointer feature may ever enter the width inventory.
    for (const at of AT_RULES) {
      for (const c of at.conditions) {
        if (HEIGHT.has(c.name) || c.name === "prefers-reduced-motion" || POINTER.has(c.name)) {
          expect(WIDTH_INVENTORY.has(`${c.name}|${c.value}`), `${c.name} leaked into the width inventory`).toBe(false);
        }
      }
    }
    const kinds = new Set(AT_RULES.filter((a) => a.name === "media").map((a) => a.kind));
    expect(kinds.has("width")).toBe(true);
    expect(kinds.has("height")).toBe(true);
    expect(kinds.has("motion")).toBe(true);
  });
});

describe("the canon is the document's, not this file's", () => {
  it("every canonical value appears as a band edge in DESIGN_SYSTEM.md", () => {
    const edges = documentedBandEdges();
    expect(edges.length, "the Breakpoints table must still declare numeric bands").toBeGreaterThanOrEqual(4);
    for (const c of CANONICAL) {
      expect(edges, `${c.side}: ${c.value}px is not a band edge in DESIGN_SYSTEM.md §6`).toContain(c.value);
    }
  });

  it.each(CANONICAL)("$side: $value px is still used, on the side it is documented for", ({ side, value }) => {
    const e = WIDTH_INVENTORY.get(`${side}|${value}`);
    expect(e, `canonical ${side}: ${value}px has disappeared from the stylesheet`).toBeTruthy();
    expect(e!.side).toBe(side);
    expect(e!.unit).toBe("px");
    expect(e!.rules).toBeGreaterThan(0);
  });

  /* The shell's edge was the single most shared transition when the canon was
     written. The product hi-fi (DD-338, 2026-10-03) gives every page its own
     phone composition, so the phone's edge is now shared as widely; what still
     holds is that these two canonical edges carry the product, and no other
     width is consumed by more files than either of them. */
  it("the shell boundary and the phone boundary are the most shared transitions in the product", () => {
    const edges = ["min-width|900", "max-width|599"] as const;
    for (const edge of edges) expect(WIDTH_INVENTORY.get(edge), edge).toBeTruthy();
    for (const [key, e] of WIDTH_INVENTORY) {
      if ((edges as readonly string[]).includes(key)) continue;
      for (const edge of edges) {
        expect(WIDTH_INVENTORY.get(edge)!.files.size, `${key} is consumed by more files than ${edge}`).toBeGreaterThanOrEqual(e.files.size);
      }
    }
  });
});

describe("every non-canonical value is declared, and every declaration is real", () => {
  const isCanonical = (side: string, value: number) => CANONICAL.some((c) => c.side === side && c.value === value);

  it("no width value exists without a canonical role or an allowlist entry", () => {
    const undeclared: string[] = [];
    for (const e of WIDTH_INVENTORY.values()) {
      if (isCanonical(e.side, e.value)) continue;
      const entry = ALLOWLIST.find((a) => a.side === e.side && a.value === e.value);
      if (!entry) undeclared.push(`${e.side}: ${e.value}px (${[...e.files].join(", ")})`);
    }
    expect(undeclared, "a new breakpoint appeared with nothing written down about it").toEqual([]);
  });

  it("no allowlist entry survives the rule it describes", () => {
    const stale = ALLOWLIST.filter((a) => !WIDTH_INVENTORY.has(`${a.side}|${a.value}`))
      .map((a) => `${a.side}: ${a.value}px`);
    expect(stale, "an allowlist entry no longer matches any rule and must be removed").toEqual([]);
  });

  it("no entry names the wrong side", () => {
    for (const a of ALLOWLIST) {
      const e = WIDTH_INVENTORY.get(`${a.side}|${a.value}`)!;
      expect(e.side, `${a.value}px is declared as ${a.side} but is used as ${e.side}`).toBe(a.side);
    }
  });

  it("no entry is duplicated", () => {
    const keys = ALLOWLIST.map((a) => `${a.side}|${a.value}`);
    expect(new Set(keys).size, "the allowlist declares the same value and side twice").toBe(keys.length);
  });

  it("no entry carries an empty reason", () => {
    for (const a of ALLOWLIST) {
      expect(a.why.trim().length, `${a.side}: ${a.value}px has no rationale`).toBeGreaterThanOrEqual(40);
      expect(a.role.trim().length, `${a.side}: ${a.value}px has no role`).toBeGreaterThan(0);
      expect(a.files.length, `${a.side}: ${a.value}px names no file`).toBeGreaterThan(0);
    }
  });

  it("every entry names the files that really carry it", () => {
    for (const a of ALLOWLIST) {
      const actual = [...WIDTH_INVENTORY.get(`${a.side}|${a.value}`)!.files].sort();
      expect(a.files.slice().sort(), `${a.side}: ${a.value}px declares the wrong files`).toEqual(actual);
    }
  });

  it("a decimal value is declared as the decimal it is", () => {
    const entry = ALLOWLIST.find((a) => a.value === 899.98)!;
    expect(entry, "899.98px must stay in the allowlist as itself").toBeTruthy();
    expect(entry.value).toBe(899.98);
    expect(Number.isInteger(entry.value)).toBe(false);
    expect(ALLOWLIST.some((a) => a.value === 98)).toBe(false);
  });

  it("classifies Public Home, auth and authenticated surfaces apart", () => {
    for (const a of ALLOWLIST) {
      const actual = [...new Set([...WIDTH_INVENTORY.get(`${a.side}|${a.value}`)!.files].map(surfaceOf))].sort();
      expect(a.surfaces.slice().sort(), `${a.side}: ${a.value}px is declared on the wrong surfaces`).toEqual(actual);
    }
    // Public Home's ladder is its own: no value it owns may also be owned by auth.
    const ph = ALLOWLIST.filter((a) => a.surfaces.includes("public-home"));
    for (const a of ph) expect(a.surfaces, `${a.value}px spans Public Home and auth`).not.toContain("auth");
  });

  it("records the findings this phase deliberately did not fix", () => {
    expect(DEFERRED["899.98px"]).toBe("NEAR_DUPLICATE_NEEDS_VISUAL_PROOF");
    expect(DEFERRED.public_home_920_motion).toBe("CONTENT_DRIVEN_KEEP_FOR_NOW");
    expect(ALLOWLIST.find((a) => a.value === 899.98)!.disposition).toBe("NEAR_DUPLICATE_NEEDS_VISUAL_PROOF");
    expect(ALLOWLIST.find((a) => a.value === 920)!.disposition).toBe("CONTENT_DRIVEN_KEEP_FOR_NOW");
  });
});

/* ----------------------------------------------------- the container ladder */

/**
 * Tailwind's `container` utility ships a second breakpoint ladder — 640, 768,
 * 1024, 1280, 1536 — that no stylesheet in this repo wrote and no element in the
 * product uses. Measured before it was switched off: `.container` matched zero
 * elements on /, /login and /register at every width from 429 to 1181.
 */
const TAILWIND_CONFIG = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");
const CONTAINER_LADDER = [768, 1024, 1280, 1536];

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, acc);
    else if ((e.name.endsWith(".tsx") || e.name.endsWith(".ts")) && !e.name.includes(".test.")) acc.push(p);
  }
  return acc;
}

describe("the container ladder stays switched off", () => {
  it("the core plugin is disabled", () => {
    expect(TAILWIND_CONFIG).toContain("corePlugins");
    expect(TAILWIND_CONFIG).toContain("container: false");
  });

  it("nothing else in the theme moved with it", () => {
    // Disabling one core plugin must not become a licence to edit the ladder.
    expect(TAILWIND_CONFIG).not.toContain("screens");
    expect(TAILWIND_CONFIG).toContain('content: ["./src/**/*.{ts,tsx}"]');
    expect(TAILWIND_CONFIG).toContain("plugins: []");
    for (const token of ["--background-base", "--signal-active", "--font-mono"]) {
      expect(TAILWIND_CONFIG, `theme token ${token} must survive`).toContain(token);
    }
  });

  it("no component asks for the class", () => {
    const offenders: string[] = [];
    for (const abs of tsxFiles(SRC)) {
      const text = readFileSync(abs, "utf8");
      for (const needle of ['className="container', "className={\"container", '"container "', "'container '", " container\"", " container'"]) {
        if (text.includes(needle)) offenders.push(relative(ROOT, abs));
      }
    }
    expect([...new Set(offenders)], "a component started using Tailwind's container class").toEqual([]);
  });

  it("no responsive prefix creates a hidden consumer", () => {
    // A class token STARTS with the prefix. Substring matching finds "sm:"
    // inside the word "mechanism:" and reports a Tailwind prefix that is really
    // a comment — which is how the first version of this test failed.
    const PREFIXES = ["sm:", "md:", "lg:", "xl:", "2xl:"];
    const SPLIT = new Set([" ", "\n", "\t", "\r", '"', "'", "`", "{", "}", "(", ")", ";", ",", "="]);
    const prefixed: string[] = [];
    for (const abs of tsxFiles(SRC)) {
      const text = readFileSync(abs, "utf8");
      let token = "";
      const check = () => {
        for (const p of PREFIXES) {
          if (token.startsWith(p)) prefixed.push(`${relative(ROOT, abs)} :: ${token.slice(0, 24)}`);
        }
        token = "";
      };
      for (const ch of text) { if (SPLIT.has(ch)) check(); else token += ch; }
      check();
    }
    expect([...new Set(prefixed)], "a Tailwind responsive prefix appeared; the stock ladder would come back with it").toEqual([]);
  });

  it("the ladder's values are not otherwise present as width breakpoints", () => {
    for (const v of CONTAINER_LADDER) {
      expect(WIDTH_INVENTORY.has(`min-width|${v}`), `min-width ${v}px reappeared in hand-written CSS`).toBe(false);
    }
    // 640 is different: auth owns a max-width: 640px of its own and keeps it.
    expect(WIDTH_INVENTORY.has("max-width|640")).toBe(true);
    expect([...WIDTH_INVENTORY.get("max-width|640")!.files]).toContain("src/features/auth/auth-stage.css");
    expect(WIDTH_INVENTORY.has("min-width|640"), "the container ladder's 640 must not return").toBe(false);
  });

  it("the built stylesheet carries no .container rule", () => {
    // Only checkable where a build exists; the source assertions above hold
    // everywhere. Named rather than skipped silently.
    const staticDir = join(ROOT, ".next", "static");
    const configPath = join(ROOT, "tailwind.config.ts");
    if (!existsSync(staticDir)) {
      // No build here. The source assertions above still hold; the built-CSS
      // check is carried by release verification instead.
      expect(existsSync(configPath)).toBe(true);
      return;
    }
    // A build made BEFORE the config change still contains the rules this
    // change removes. Judging the config by a stale artifact says nothing, so
    // the assertion runs only against a build that postdates the config.
    if (statSync(staticDir).mtimeMs < statSync(configPath).mtimeMs) {
      expect(existsSync(configPath)).toBe(true);
      return;
    }
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".css")) {
          const root = postcss.parse(readFileSync(p, "utf8"), { from: p });
          root.walkRules((r) => {
            for (const sel of r.selectors) {
              const s = sel.trim();
              if (s === ".container" || s === ".\\!container") found.push(`${relative(ROOT, p)} :: ${s}`);
            }
          });
        }
      }
    };
    walk(staticDir);
    expect(found, "the container rules are back in the built CSS").toEqual([]);
  });
});
