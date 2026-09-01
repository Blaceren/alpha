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
 * MEASURED WITH THE LIVE TURNSTILE KEY. This matters more than anything else
 * in this file: a scratch server started without `TURNSTILE_SITE_KEY` renders
 * the widget 59px shorter and drops a status line, which flatters every number
 * by about 115px. Every figure below was taken against the real widget, after
 * `document.fonts.ready`, at real viewports. `bottom` of the register submit:
 *
 *   viewport    live 99ef7697   candidate 0116c208   this candidate
 *   1440x900    779  fits +121  864  fits  +36       864  fits  +36
 *   1024x768    779  FAILS -11  840  FAILS -72       840  FAILS -72
 *    390x844    835  fits   +9  929  FAILS -85       790  fits  +54
 *    360x800    873  FAILS -73  937  FAILS -137      790  fits  +10
 *
 * The phone pair now fits, and 360x800 fits for the first time - it was 73px
 * short before this phase began and 137px short after the frame landed. The
 * margin at 360 is 10px and that is not an accident of rounding: the register
 * form with a live 142px Turnstile spends 636px of an 800px viewport before
 * any chrome exists, so the compact step is spending the last of the air. Any
 * future addition to this form comes out of that 10px.
 *
 * 1024x768 IS STILL BELOW THE FOLD, by 72px, and this pass did not fix it.
 * It is recorded rather than rounded away. It is not a regression introduced
 * here: the live page misses it by 11px too. The frame widened the gap and the
 * compact step cannot reach it, because the step is bounded at 640px and a
 * short DESKTOP viewport is a different decision from a phone. It needs its own
 * authorisation.
 */

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, "src/features/auth/auth-stage.css"), "utf8");
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
    [".auth .login-submit,\n.auth .register-submit {", "min-height: 48px"],
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
      ["--auth-frame-radius", "14px"],
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

describe("nothing the correction was forbidden to touch has moved", () => {
  it("the copy is exactly what the phase shipped", () => {
    const login = readFileSync(join(ROOT, "src/app/login/page.tsx"), "utf8");
    const register = readFileSync(join(ROOT, "src/app/register/page.tsx"), "utf8");
    expect(login).toContain('eyebrow="ATA / ВХОД"');
    expect(login).toContain('title="Продолжить свой путь."');
    expect(register).toContain('eyebrow="ATA / НАЧАЛО"');
    expect(register).toContain('title="Начать путь."');
    expect(register).toContain("Аккаунт открывает вход в Академию. Доступ к обучению открывает куратор.");
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
