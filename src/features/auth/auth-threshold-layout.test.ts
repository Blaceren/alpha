import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ATA-AUTH-THRESHOLD-CONTINUITY-1 — THE FOLD GATE.
 *
 * WHAT WENT WRONG. The Frame this phase introduced costs vertical space, and
 * on a phone it spent more than it had: at 390x844 the register submit landed
 * at 869 and at 360x800 it landed at 877. The primary action of the page was
 * below the fold on the two viewports most likely to meet it. A visitor who
 * cannot see the button does not know the form ends.
 *
 * WHAT THIS GATE IS, AND WHAT IT IS NOT. It is not a layout run. This
 * deployment has no system Chrome or Chromium and no Playwright browser cache,
 * and nothing is downloaded to get one, so no test here can measure a rendered
 * box. Instead this pins the CSS CONTRACT that produces the geometry, plus
 * every prohibition the correction was given. The measurements themselves were
 * taken in a real browser at real viewports and are recorded below as the
 * record of what these declarations produced — they are evidence, not an
 * assertion this file can re-derive.
 *
 * FOUR CAPTCHA STATES, FOUR HEIGHTS, AND WHICH ONE EACH NUMBER BELONGS TO.
 *
 * `.auth-captcha` renders at four different heights, and no single one of them
 * is what this widget "is". Reading one as the general case is how this file was
 * wrong once already: it recorded the height of an ERROR as the live height.
 * Each number below therefore travels with the name of the state it was
 * measured in, and the tests at the bottom of this file refuse to let those
 * names come apart again.
 *
 * THE NUMBERS CHANGED ON 2026-10-02, AND WHY. Until then Cloudflare's box stood
 * in the form on every visit — 71px while it worked, 142px with its error box.
 * The owner's review that day («окно капчи слишком выделяется и не
 * соответствует нам») made the box appear only when it has something to ask
 * (`appearance: "interaction-only"`), with one line of the form in its place.
 * Every state is therefore shorter than it was, and the tallest is no longer an
 * error but the box itself, on the rare visit that needs it. Measured on the
 * stand in a real browser with Cloudflare's published test site keys — always
 * passes, forces an interaction, always blocks — and with no key at all.
 *
 *   WORKING STATE — `.auth-captcha` at 20px.
 *     The check ran unseen and passed: the line «Браузер проверен.» and nothing
 *     else. This is the page a visitor actually meets.
 *
 *   INTERACTIVE / WORST-CASE STATE — `.auth-captcha` at 93px.
 *     Cloudflare asks for a press: the line, and under it the 65px box. After
 *     the press the box stays for that check, Cloudflare's own «Успешно» in it,
 *     so the block keeps this height until the form is sent. Where
 *     the line takes two rows — a 360px screen — the block is 111px. It is the
 *     TALLEST of the four, and that is exactly why the layout gate is held to
 *     it rather than to the working state: a composition that clears the fold
 *     carrying the box clears it by a further ~70px without it. Holding the
 *     gate to the friendlier number would prove less.
 *
 *   FAILED STATE — `.auth-captcha` at 81px.
 *     The challenge errored or timed out — on localhost with a real key, where
 *     the hostname does not match and Turnstile raises 110200, as much as with
 *     the always-blocking test key: the boxed sentence and «Повторить проверку»
 *     under it (100px where the sentence takes two rows, on a 360px screen).
 *     Cloudflare's own error box is not drawn.
 *
 *   NO-KEY FALLBACK STATE — `.auth-captcha` at 83px.
 *     `TURNSTILE_SITE_KEY` absent, so `resolveCaptchaContract` renders a
 *     placeholder. No deployed environment is in this state, and a measurement
 *     taken here is evidence for nothing.
 *
 * LAYOUT GATE — held to the worst-case envelope, the interactive state.
 * Register submit `bottom`, against the ceiling that leaves 24px of clearance.
 * The first four columns are this gate's history at the 142px envelope of the
 * box that was always drawn; THIS is today's, with the box drawn only on demand:
 *
 *   viewport    live 99ef7697   0116c208    6a9c1cd0    always-drawn    THIS   ceiling
 *   1440x900    779             864         864          864              815       876
 *   1024x768    779             840         840          733              684       744
 *    390x844    835             929         790          770              683       820
 *    360x800    873             937         790          770              725       776
 *
 * WORKING-STATE EVIDENCE — the same submit measured at 20px on the stand with
 * the always-passing key, in a fresh anonymous context, after
 * `document.fonts.ready` and after the check settled. (At the 71px of the box
 * that was always drawn, the real domain measured 793, 662, 699 and 699.)
 *
 *   viewport    bottom   innerHeight   reserve
 *   1440x900    743      900           157
 *   1024x768    622      768           146
 *    390x844    610      844           234
 *    360x800    634      800           166
 *
 * Neither table is prose. Both are read back by the tests below and checked
 * against the ceilings and the 24px rule, so an evidence table that drifts from
 * the contract fails rather than misleads.
  */

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, "src/features/auth/auth-stage.css"), "utf8");
/** This file reads itself: the evidence table above is prose until something
    checks that it says what the constants say. */
const CSS_TEST_SOURCE = readFileSync(join(ROOT, "src/features/auth/auth-threshold-layout.test.ts"), "utf8");
/** The same file with its prose removed. A comment that EXPLAINS why a variable
    is unreachable must not be read as a use of it. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** Brace matching, not pattern guessing: an at-rule's body is the text between
    its opening brace and the brace that closes it at the same depth. */
function block(header: string): { body: string; at: number } {
  const at = CSS.indexOf(header);
  if (at < 0) throw new Error(`no such at-rule: ${header}`);
  const open = CSS.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return { body: CSS.slice(open + 1, i), at };
  }
  throw new Error(`unterminated at-rule: ${header}`);
}

/** Every `property: value` inside a block, with its owning selector. */
function declarations(body: string): { selector: string; prop: string; value: string }[] {
  const out: { selector: string; prop: string; value: string }[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(body))) {
    const selector = m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out.push({ selector, prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() });
    }
  }
  return out;
}

const COMPACT = "@media (max-width: 640px) and (max-height: 950px)";
const SHORT = "@media (max-height: 820px)";
const WIDE = "@media (min-width: 900px) {";

/**
 * One constant per STATE. There is deliberately no constant standing for "the"
 * height of the widget, because there is no such height. The name this file
 * used before — the one that implied a single canonical height — was itself the
 * mistake, and a test below bans both that identifier and the adjective it was
 * built from. Neither is spelled out anywhere here: this file reads itself, so
 * naming the banned word would be using it.
 */
const CAPTCHA_WORKING = 20;
const CAPTCHA_INTERACTIVE = 93;
const CAPTCHA_FAILED = 81;
const CAPTCHA_NO_KEY_FALLBACK = 83;

/** The gate is held to the tallest state on purpose: a worst-case envelope. */
const LAYOUT_GATE_TESTED_HEIGHT = CAPTCHA_INTERACTIVE;

/** The state each height belongs to, as the prose above must label it. */
const STATE_LABELS: [number, string][] = [
  [CAPTCHA_WORKING, "WORKING STATE"],
  [CAPTCHA_INTERACTIVE, "INTERACTIVE / WORST-CASE STATE"],
  [CAPTCHA_FAILED, "FAILED STATE"],
  [CAPTCHA_NO_KEY_FALLBACK, "NO-KEY FALLBACK STATE"],
];

/** Worst-case envelope. viewport -> [innerHeight, submit bottom in the interactive state, ceiling] */
const EVIDENCE: Record<string, [number, number, number]> = {
  "1440x900": [900, 815, 876],
  "1024x768": [768, 684, 744],
  "390x844": [844, 683, 820],
  "360x800": [800, 725, 776],
};

/** The working state. viewport -> [innerHeight, submit bottom at 20px, reserve] */
const WORKING_STATE_EVIDENCE: Record<string, [number, number, number]> = {
  "1440x900": [900, 743, 157],
  "1024x768": [768, 622, 146],
  "390x844": [844, 610, 234],
  "360x800": [800, 634, 166],
};

/** The tier-4 numbers that produced 770 at 360x800. Nothing may loosen. */
const TIER4_CEILINGS: Record<string, number> = {
  "padding-top": 3,
  "gap": 8,
};

describe("the phone compact step", () => {
  // M-C1
  it("is bounded on BOTH axes, so a tall phone never pays for a fold it does not have", () => {
    const { body } = block(COMPACT);
    expect(body.length).toBeGreaterThan(0);
    // A width-only step would apply at 390x1200, where the submit is already
    // 331px clear of the fold and the generosity is affordable. Measured: with
    // both bounds present, the step does NOT engage at 390x1200.
    const widthOnly = block("@media (max-width: 640px) {").body;
    for (const compactOnly of ["padding-top: 4px", "gap: 6px", "gap: 9px", "gap: 5px"]) {
      expect(widthOnly, `the width-only step must not carry ${compactOnly}`).not.toContain(compactOnly);
    }
  });

  // M-C2
  it("is placed last, so it wins over the two steps it refines", () => {
    const compact = block(COMPACT).at;
    for (const earlier of ["@media (max-width: 430px)", "@media (max-height: 820px)", "@media (max-height: 700px)"]) {
      expect(block(earlier).at, `${earlier} must come before the compact step`).toBeLessThan(compact);
    }
  });

  // M-C3 · M-C4
  it("changes spacing and nothing else", () => {
    const allowed = new Set([
      "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
      "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
      "gap", "row-gap", "column-gap",
    ]);
    const decls = declarations(block(COMPACT).body);
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) {
      // A font-size, a height, a `display: none` or a transform here would be
      // the composition changing under cover of a spacing fix.
      expect(allowed.has(d.prop), `${d.selector} sets ${d.prop} — only spacing may change here`).toBe(true);
      // Nothing is pulled out of place or clipped to buy room.
      expect(d.value, `${d.selector} ${d.prop} is negative`).not.toMatch(/(^|\s)-\d/);
    }
  });

  it("never overrides a touch target or a type size", () => {
    const body = block(COMPACT).body;
    for (const forbidden of ["min-height", "height", "font-size", "line-height", "display", "position", "transform", "overflow"]) {
      expect(body, `compact step must not set ${forbidden}`).not.toContain(`${forbidden}:`);
    }
  });
});

describe("the floors the compact step is not allowed to lower", () => {
  // M-C4
  const floors: [string, string][] = [
    [".auth__mark {", "min-height: 44px"],                                   // the brand link
    [".auth .login-field input,\n.auth .register-field input {", "min-height: 48px"],
    // 52px since the product hi-fi made it Public Home's pill (DD-338).
    [".auth .login-submit,\n.auth .register-submit {", "min-height: 52px"],
    [".auth .register-alt__link,\n.auth .login-alt__link {", "min-height: 44px"],
  ];
  it.each(floors)("%s keeps %s", (selector, floor) => {
    const i = CSS.indexOf(selector);
    expect(i, `selector missing: ${selector}`).toBeGreaterThan(-1);
    const end = CSS.indexOf("}", i);
    expect(CSS.slice(i, end)).toContain(floor);
  });

  it("the mark's artwork is never shrunk in the compact step, because it would cost a target and save nothing", () => {
    // The link's own min-height sets the row height; a smaller image narrows
    // the tap area without moving the fold. Measured: 34px artwork produced a
    // 34x44 target and zero vertical saving.
    expect(block(COMPACT).body).not.toContain(".auth__mark");
  });
});

describe("the frame's material has one place of authority", () => {
  // M-C5
  it("carries no raw colour literal", () => {
    expect(CODE).not.toMatch(/rgba?\(\s*237\s*,\s*240\s*,\s*234/);
    expect(CSS).toContain("color-mix(in srgb, var(--text-primary) 3%, transparent)");
  });

  // M-C6
  it("declares every frame variable on .auth itself, so no rule inherits from an ancestor that is not there", () => {
    const auth = CSS.slice(CSS.indexOf(".auth {"), CSS.indexOf("}", CSS.indexOf(".auth {")));
    for (const [name, source] of [
      ["--auth-frame-line", "var(--divider)"],
      ["--auth-frame-ground", "var(--surface-subtle)"],
      ["--auth-frame-bracket", "var(--signal-active)"],
      /* The product hi-fi (DD-338) gave every surface one radius. */
      ["--auth-frame-radius", "var(--hf-radius-surface)"],
    ] as const) {
      expect(auth, `${name} must be declared on .auth`).toContain(`${name}: ${source}`);
    }
    expect(auth).toContain("--auth-frame-grid: color-mix(");
  });

  it("uses those names in the frame rules rather than reaching past them", () => {
    const frame = CSS.slice(CSS.indexOf(".auth__frame {"));
    expect(frame).toContain("border: 1px solid var(--auth-frame-line)");
    expect(frame).toContain("border-radius: var(--auth-frame-radius)");
    expect(frame).toContain("var(--auth-frame-ground)");
    expect((CSS.match(/var\(--auth-frame-bracket\)/g) ?? []).length).toBe(4);
  });

  // M-C6
  it("never names a variable that only exists inside .ph", () => {
    // `--line-dark`, `--signal-400` and `--radius-lg` are declared on `.ph` in
    // public-home.css. Measured on both served pages, all three resolve to the
    // empty string at `.auth` — a rule using one would paint nothing and fail
    // silently rather than loudly.
    for (const phLocal of ["--line-dark", "--signal-400", "--radius-lg"]) {
      expect(CODE, `${phLocal} is not visible to this surface`).not.toContain(phLocal);
    }
  });

  it("keeps the focus ring on every control the threshold owns", () => {
    for (const sel of [".auth__mark:focus-visible", ".auth .login-field input:focus-visible", ".auth .login-submit:focus-visible", ".auth .register-alt__link:focus-visible"]) {
      const i = CSS.indexOf(sel);
      expect(i, `no focus ring for ${sel}`).toBeGreaterThan(-1);
    }
    // Four rings, one colour, and it resolves: measured `rgb(199, 247, 109)` on
    // both /login and /register.
    expect((CSS.match(/outline: 2px solid var\(--signal-active\)/g) ?? []).length).toBe(4);
  });
});

describe("the short-viewport tier", () => {
  // N1
  it("exists", () => {
    expect(block(SHORT).body.length).toBeGreaterThan(0);
  });

  // N2 · N6
  it("is bounded by height ALONE, so it reaches a 1024x768 laptop", () => {
    // The scarce thing is vertical room. A width bound here would put the
    // laptop back where it was: submit at 840 against a 768px viewport.
    const header = CSS.slice(CSS.indexOf(SHORT), CSS.indexOf("{", CSS.indexOf(SHORT)));
    expect(header).not.toContain("max-width");
    expect(header).not.toContain("min-width");
    // ...and the tier that IS width-bound stays bounded on height too, so a
    // 390x1200 phone matches neither this tier nor that one.
    expect(CSS).toContain(COMPACT);
    expect(header.trim()).toBe("@media (max-height: 820px)");
  });

  // N3
  it("carries the whole set of declarations the geometry depends on", () => {
    const body = block(SHORT).body;
    for (const required of [
      ".auth { padding-top:",
      ".auth__axis { padding-top:",
      ".auth__frame { padding:",
      ".auth__eyebrow { margin-bottom:",
      ".auth__title { margin-bottom:",
      ".auth__lead { margin-bottom:",
      "gap:",
    ]) {
      expect(body, `short tier must declare ${required}`).toContain(required);
    }
  });

  it("changes spacing and nothing else, and nothing is negative", () => {
    const allowed = new Set([
      "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
      "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
      "gap", "row-gap", "column-gap",
    ]);
    for (const d of declarations(block(SHORT).body)) {
      expect(allowed.has(d.prop), `${d.selector} sets ${d.prop}`).toBe(true);
      expect(d.value, `${d.selector} ${d.prop} is negative`).not.toMatch(/(^|\s)-\d/);
    }
  });
});

describe("the desktop stage is a horizontal decision and stays out of this", () => {
  // N7
  it("keeps its columns and its measure", () => {
    const wide = block(WIDE).body;
    expect(wide).toContain("grid-template-columns: 220px minmax(0, var(--auth-measure))");
    expect(wide).toContain("max-width: 940px");
  });

  it("is not re-laid-out by any vertical tier", () => {
    const horizontal = new Set(["grid-template-columns", "grid-template", "max-width", "min-width", "width", "--auth-measure"]);
    for (const tier of [SHORT, COMPACT, "@media (max-width: 640px) {", "@media (max-width: 430px)"]) {
      for (const d of declarations(block(tier).body)) {
        // Two things size themselves and always did: the bracket pseudo-elements
        // (decorative squares) and the mark's artwork (an image inside a link
        // whose 44px target is pinned separately). The stage the form stands in
        // is what this pin protects.
        if (/::before|::after|\bimg\b/.test(d.selector)) continue;
        // `border-width` is not `width`; compare the property, not a substring.
        expect(horizontal.has(d.prop), `${tier} sets ${d.prop} on ${d.selector}`).toBe(false);
      }
    }
  });
});

describe("the recorded evidence is checked, not quoted", () => {
  // N3 · N4
  it.each(Object.entries(EVIDENCE))("%s clears its ceiling with 24px to spare", (vp, [h, bottom, ceiling]) => {
    expect(bottom, `${vp} submit bottom is past its ceiling`).toBeLessThanOrEqual(ceiling);
    expect(h - bottom, `${vp} has less than 24px of clearance`).toBeGreaterThanOrEqual(24);
    expect(ceiling).toBe(h - 24);
  });

  it("agrees with the table written above it", () => {
    for (const [vp, [, bottom, ceiling]] of Object.entries(EVIDENCE)) {
      // The table row, not the prose above it: the row is the line that carries
      // the viewport, its measurement AND its ceiling together.
      // Only the prose table counts — the constant that declares the numbers
      // cannot be the thing that corroborates them.
      const rows = CSS_TEST_SOURCE.split("\n").filter(
        (l) => l.trimStart().startsWith("*") && l.includes(vp) && l.includes(String(bottom)) && l.includes(String(ceiling)),
      );
      expect(rows.length, `no evidence row for ${vp} carrying ${bottom} and ${ceiling}`).toBe(1);
    }
  });

  it("checks the working-state evidence too, at the working height", () => {
    for (const [vp, [h, bottom, reserve]] of Object.entries(WORKING_STATE_EVIDENCE)) {
      expect(h - bottom, `${vp} reserve does not match`).toBe(reserve);
      expect(reserve, `${vp} has less than 24px in the working state`).toBeGreaterThanOrEqual(24);
      // The working state is shorter than the interactive one, so every working
      // figure must sit ABOVE its own worst-case twin. If one ever did not, the
      // two tables would be describing different pages.
      const worst = EVIDENCE[vp];
      expect(worst, `${vp} missing from the worst-case table`).toBeTruthy();
      expect(bottom, `${vp} working bottom is not inside the envelope`).toBeLessThanOrEqual(worst![1]);
      expect(bottom).toBeLessThanOrEqual(worst![2]);
    }
  });

  it("agrees with the working-state table written above it", () => {
    for (const [vp, [h, bottom, reserve]] of Object.entries(WORKING_STATE_EVIDENCE)) {
      const rows = CSS_TEST_SOURCE.split("\n").filter(
        (l) =>
          l.trimStart().startsWith("*") &&
          l.includes(vp) &&
          l.includes(String(bottom)) &&
          l.includes(String(h)) &&
          l.includes(String(reserve)),
      );
      expect(rows.length, `no working-state evidence row for ${vp}`).toBe(1);
    }
  });

  // N4
  it("pins the tier-4 numbers that bought the last 20px", () => {
    const decls = declarations(block(COMPACT).body);
    const pad = decls.find((d) => d.selector === ".auth" && d.prop === "padding-top");
    expect(pad, "tier 4 must set the page padding").toBeTruthy();
    expect(parseFloat(pad!.value)).toBeLessThanOrEqual(TIER4_CEILINGS["padding-top"]!);
    for (const d of decls.filter((x) => x.prop === "gap")) {
      expect(parseFloat(d.value), `${d.selector} gap loosened`).toBeLessThanOrEqual(TIER4_CEILINGS["gap"]!);
    }
  });
});

describe("the four captcha states never collapse into one", () => {
  it("keeps four distinct heights, one per state", () => {
    expect(CAPTCHA_WORKING).toBe(20);
    expect(CAPTCHA_INTERACTIVE).toBe(93);
    expect(CAPTCHA_FAILED).toBe(81);
    expect(CAPTCHA_NO_KEY_FALLBACK).toBe(83);
    expect(new Set([CAPTCHA_WORKING, CAPTCHA_INTERACTIVE, CAPTCHA_FAILED, CAPTCHA_NO_KEY_FALLBACK]).size).toBe(4);
    expect(CSS_TEST_SOURCE).toContain("TURNSTILE_SITE_KEY");
  });

  it.each(STATE_LABELS)("%dpx is written down beside the state it was measured in", (height, label) => {
    const at = CSS_TEST_SOURCE.indexOf(label);
    expect(at, `the prose must carry the label ${label}`).toBeGreaterThan(-1);
    // The height has to live in that labelled paragraph, not merely somewhere
    // in the file: a number without its state is what caused the error.
    const paragraph = CSS_TEST_SOURCE.slice(at, at + 900);
    expect(paragraph, `${label} must state ${height}px`).toContain(`${height}px`);
  });

  it("declares no universal height for the widget", () => {
    // The banned adjective and the banned identifier are the two forms the
    // mistake took. Both are assembled from fragments so that this assertion
    // does not itself put them in the file it is checking.
    const BANNED_ADJECTIVE = "repre" + "sentative";
    const BANNED_IDENTIFIER = "CAPTCHA_" + BANNED_ADJECTIVE.toUpperCase();
    expect(CSS_TEST_SOURCE.toLowerCase(), "no state's height may be called the general one")
      .not.toContain(BANNED_ADJECTIVE);
    expect(CSS_TEST_SOURCE, "the old constant name may not come back")
      .not.toContain(BANNED_IDENTIFIER);
    // Each height is named beside its own state, and only there.
    expect(CSS_TEST_SOURCE).toContain("WORKING STATE — `.auth-captcha` at 20px");
    expect(CSS_TEST_SOURCE).toContain("INTERACTIVE / WORST-CASE STATE — `.auth-captcha` at 93px");
    expect(CSS_TEST_SOURCE).toContain("FAILED STATE — `.auth-captcha` at 81px");
  });

  it("holds the layout thresholds to the worst case, not to the live one", () => {
    expect(LAYOUT_GATE_TESTED_HEIGHT).toBe(CAPTCHA_INTERACTIVE);
    expect(LAYOUT_GATE_TESTED_HEIGHT).toBe(93);
    // Testing the envelope proves more than testing the friendly state. If this
    // ever flipped to 20, every ceiling below would become easier to clear and
    // the gate would quietly stop guarding the case it was written for.
    expect(LAYOUT_GATE_TESTED_HEIGHT).toBeGreaterThan(CAPTCHA_WORKING);
    expect(LAYOUT_GATE_TESTED_HEIGHT).toBeGreaterThanOrEqual(CAPTCHA_FAILED);
    expect(LAYOUT_GATE_TESTED_HEIGHT).toBeGreaterThanOrEqual(CAPTCHA_NO_KEY_FALLBACK);
    for (const [vp, [h, bottom, ceiling]] of Object.entries(EVIDENCE)) {
      expect(ceiling, `${vp} ceiling`).toBe(h - 24);
      expect(bottom, `${vp} worst-case bottom`).toBeLessThanOrEqual(ceiling);
    }
  });
});

describe("motion", () => {
  it("respects a reduced-motion preference, and no tier adds motion of its own", () => {
    // The live `prefers-reduced-motion` state could not be observed here: this
    // browser reports no preference and the pane exposes no emulation for it.
    // What IS checkable is that the rule ships and that the compression tiers
    // introduce no transition or animation to reduce.
    const reduced = block("@media (prefers-reduced-motion: reduce)").body;
    for (const sel of ["login-field input", "register-field input", "login-submit", "register-submit"]) {
      expect(reduced, `reduced-motion must cover ${sel}`).toContain(sel);
    }
    for (const tier of [SHORT, COMPACT]) {
      const body = block(tier).body;
      expect(body).not.toContain("transition");
      expect(body).not.toContain("animation");
      expect(body).not.toContain("transform");
    }
  });
});

describe("nothing the correction was forbidden to touch has moved", () => {
  it("the copy is exactly what the phase shipped", () => {
    const login = readFileSync(join(ROOT, "src/app/login/page.tsx"), "utf8");
    const register = readFileSync(join(ROOT, "src/app/register/page.tsx"), "utf8");
    expect(login).toContain('eyebrow="ATA / ВХОД"');
    expect(login).toContain('title="Продолжить свой путь."');
    expect(register).toContain('eyebrow="ATA / НАЧАЛО"');
    expect(register).toContain('title="Начать путь."');
    // The cautious line stays for a Backend that cannot say; where registration starts the
    // program (2026-10-04, launch audit), the page says so.
    expect(register).toContain("Аккаунт открывает вход в Академию. Доступ к обучению открывает куратор.");
    expect(register).toContain("Регистрация бесплатная. Сразу после неё откроется первый уровень пути.");
  });

  it("nothing in this file hides the eyebrow, the heading or the lead", () => {
    for (const cls of ["auth__eyebrow", "auth__title", "auth__lead"]) {
      const rule = new RegExp(`\\.${cls}[^{]*\\{[^}]*display:\\s*none`);
      expect(CODE, `${cls} must never be display:none`).not.toMatch(rule);
      const vis = new RegExp(`\\.${cls}[^{]*\\{[^}]*visibility:\\s*hidden`);
      expect(CODE).not.toMatch(vis);
    }
  });
});
