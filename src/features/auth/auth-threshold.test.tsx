import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

/* The same two boundaries auth-stage.test.tsx mocks: the app-router context no
   harness provides, and the runtime config the pages read on the server. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", turnstileSiteKey: null, backendOrigin: "https://b.invalid", requestTimeoutMs: 1000 }),
}));

/**
 * ATA-AUTH-THRESHOLD-CONTINUITY-1 — the door reads like the house.
 *
 * `/login` and `/register` are the step between the public promise and the
 * private work. This phase changed how that step LOOKS and what it SAYS, and
 * changed nothing about what it DOES. The two halves are pinned differently on
 * purpose: composition is asserted on the rendered page, and everything that
 * authenticates is asserted as byte-identity against the release, because a
 * field name, an autocomplete value or a submit handler that "still looks
 * right" is not the same claim as one that has not moved.
 */

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const BASE = "99ef76971447774274462f708cd52c951ae6b944";
const git = (...a: string[]) =>
  execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

/** Everything that performs authentication. None of it may move. */
const UNTOUCHED = [
  "src/features/auth/login-form.tsx",
  /* `register-form.tsx` is no longer frozen here: ATA-PROFILE-FOUNDATION-1 was
     authorised to make the name required and to drop the password-composition
     copy, and register-form.test.tsx governs that file in detail — the DTO it
     sends, the endpoint, the Turnstile wiring, and every validation outcome.
     Freezing it in two places would mean the looser of the two fails first, for
     the least informative reason. What it must NOT do is still asserted below,
     against the file as it stands. */
  "src/features/auth/turnstile-widget.tsx",
  "src/features/auth/session-machine.ts",
  "src/features/auth/session-provider.tsx",
  "src/features/auth/auth.css",
  /* `src/middleware.ts` is no longer frozen here. TOOLS-V2 NEWS (2026-09-21) was
     authorised to let anonymous visitors reach the public news pages and the
     crawler files, and to send the noindex header; `middleware.test.ts` governs
     the guard in detail, and what this phase left alone is asserted below
     against the phase's own range. */
];

describe("the authenticating half is byte-identical to the release", () => {
  // 4 · 5 · 6 · 7 · 8 · 9 · 10 · 11 · 12 · 19 · 20
  it.each(UNTOUCHED)("%s has not moved", (path) => {
    expect(src(path)).toBe(git("show", `${BASE}:${path}`));
  });

  it("so every field, name, autocomplete and handler is provably unchanged", () => {
    const login = src("src/features/auth/login-form.tsx");
    const register = src("src/features/auth/register-form.tsx");
    // Named here so a reader sees WHAT the byte-identity above is protecting.
    expect(login).toContain('name="email"');
    expect(login).toContain('autoComplete="username"');
    expect(login).toContain('type="password"');
    expect(login).toContain('autoComplete="current-password"');
    expect(login).toContain("onSubmit={onSubmit}");
    expect(login).toContain('sanitizeReturnTo(searchParams.get("next"))');
    expect(login).toContain("disabled={submitting || !canSubmit}");
    expect(login).toContain('className="login-error" role="alert"');
    for (const field of ["email", "name", "password", "confirmPassword"]) {
      expect(register, field).toContain(`name="${field}"`);
    }
    expect(register).toContain('autoComplete="new-password"');
    expect(register).toContain("disabled={submitting || !canSubmit}");
    expect(src("src/features/auth/turnstile-widget.tsx")).toContain('"error-callback"');
  });
});

describe("the threshold composition", () => {
  const pages = [
    ["login", LoginPage, "Продолжить свой путь.", "ATA / ВХОД", "/register"],
    ["register", RegisterPage, "Начать путь.", "ATA / НАЧАЛО", "/login"],
  ] as const;

  // 1 · 2
  it.each(pages)("%s has exactly one h1, and it is the threshold line", (_n, Page, heading) => {
    const { container } = render(<Page />);
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe(heading);
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  // 3
  it("sets both headings in Public Home's display face, via the global token", () => {
    const css = src("src/features/auth/auth-stage.css");
    const title = css.slice(css.indexOf(".auth__title {"), css.indexOf("}", css.indexOf(".auth__title {")));
    expect(title).toContain("font-family: var(--font-public-display)");
    // The token is global, and its faces already ship: no font is added here.
    expect(src("src/styles/tokens.css")).toContain("--font-public-display");
    expect(src("src/styles/fonts.css")).toContain('font-family:"ATA Source Serif 4"');
    expect(css).not.toContain("@font-face");
    expect(css).not.toContain("@import");
    // And the face stays out of the authenticated product, which is what
    // FONT_ROLES.publicDisplay actually forbids.
    expect(src("src/design-system/typography/typography.ts")).toContain("Public Home ONLY");
  });

  // 13
  it.each(pages)("%s keeps its cross-link, worded as the action", (_n, Page, _h, _e, target) => {
    const { container } = render(<Page />);
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain(target);
    const text = container.textContent ?? "";
    expect(text).toMatch(target === "/register" ? /Нет аккаунта\?/ : /Уже есть аккаунт\?/);
  });

  // 14
  it.each(pages)("%s offers exactly one primary action", (_n, Page) => {
    const { container } = render(<Page />);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  // 15 · 16
  it.each(pages)("%s frames the real form, never an empty panel", (_n, Page) => {
    const { container } = render(<Page />);
    const frame = container.querySelector(".auth__frame");
    expect(frame, "the frame is missing").not.toBeNull();
    expect(container.querySelectorAll(".auth__frame")).toHaveLength(1);
    // The heading, the supporting line and the form are all inside it.
    expect(frame!.querySelector("h1")).not.toBeNull();
    expect(frame!.querySelector(".auth__lead")).not.toBeNull();
    expect(frame!.querySelector("form")).not.toBeNull();
    expect(frame!.querySelector('button[type="submit"]')).not.toBeNull();
    // Nothing decorative stands beside it: the only other child of the stage is
    // the brand axis, which carries the mark and a rule — no empty slot.
    const stage = container.querySelector(".auth__stage")!;
    expect(stage.children).toHaveLength(2);
    const axis = container.querySelector(".auth__axis")!;
    expect(axis.querySelector("img")).not.toBeNull();
  });

  it("draws the frame from global tokens, never Public Home's own", () => {
    const css = src("src/features/auth/auth-stage.css");
    const frame = css.slice(css.indexOf(".auth__frame {"));
    for (const phOnly of ["--line-dark", "--signal-400", "--radius-lg"]) {
      expect(frame, phOnly).not.toContain(phOnly);
    }
    expect(frame).toContain("var(--signal-active)");
    expect(css).not.toContain(".ph ");
  });

  /*
   * FOCUS AND TARGET SIZE, IN THE STYLESHEET.
   *
   * Two mutations walked straight past the first version of this file: hiding
   * the focus ring, and shrinking the submit control below a finger. Neither
   * shows up in the DOM or in a byte comparison — both live in CSS — so the
   * stylesheet is asserted directly.
   */
  it("never hides a focus ring, and every focus rule draws one", () => {
    const css = src("src/features/auth/auth-stage.css");
    expect(css).not.toMatch(/outline:\s*none/);
    expect(css).not.toMatch(/outline:\s*0/);
    const rules = [...css.matchAll(/:focus-visible[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const body of rules) {
      expect(body, body.trim().slice(0, 60)).toMatch(/outline:\s*\d+px\s+solid/);
    }
  });

  it("keeps every interactive control a finger-sized target", () => {
    const css = src("src/features/auth/auth-stage.css");
    /* The submit is not the only thing a finger lands on: the fields and the
       mark are targets too, and the first version of this pin read only the
       button — so a mutation that shrank an input walked past it. Every rule
       in this stylesheet that sizes a control is checked. */
    const blocks = [
      [".auth .login-submit,", "the submit control"],
      [".auth .login-field input,", "the text fields"],
      [".auth__mark {", "the brand mark"],
    ] as const;
    for (const [selector, what] of blocks) {
      const at = css.indexOf(selector);
      expect(at, `${what}: rule not found`).toBeGreaterThan(-1);
      const decl = css.slice(at, css.indexOf("}", at));
      const min = /min-height:\s*(\d+)px/.exec(decl);
      expect(min, `${what} declares no min-height`).not.toBeNull();
      expect(Number(min![1]), what).toBeGreaterThanOrEqual(44);
    }
    // And no rule anywhere in the file may shrink a control back below it.
    for (const m of css.matchAll(/\.auth[^{]*(?:submit|input|__mark)[^{]*\{([^}]*)\}/g)) {
      const h = /(?:min-)?height:\s*(\d+)px/.exec(m[1]!);
      if (h) expect(Number(h[1]), m[0].slice(0, 48)).toBeGreaterThanOrEqual(44);
    }
  });

  // 17
  it("adds no external host and no remote asset", () => {
    for (const f of [
      "src/features/auth/auth-stage.tsx",
      "src/features/auth/auth-stage.css",
      "src/app/login/page.tsx",
      "src/app/register/page.tsx",
    ]) {
      const s = src(f);
      const urls = [...s.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]);
      expect(urls, f).toEqual([]);
    }
  });

  // 18
  it("leaves the authenticated redirect and the middleware alone", () => {
    // Frozen to the phase's own range: this phase did not move the middleware.
    expect(git("show", `6630b83f4b17c6bd67ed6ed10279665a5a58bb81:src/middleware.ts`)).toBe(
      git("show", `${BASE}:src/middleware.ts`),
    );
    // And the authenticated redirect it guarded is still the same sentence.
    expect(src("src/middleware.ts")).toContain('const loginUrl = new URL("/login", request.url);');
    expect(src("src/middleware.ts")).toContain('loginUrl.searchParams.set("next", `${pathname}${search}`);');
    /* Frozen to the phase's own range, for the same reason as the scope block
       below: this asserts what ATA-AUTH-THRESHOLD-CONTINUITY-1 left alone, and
       a later phase adding an authorised API route is not that phase failing. */
    const changed = git(
      "diff", "--name-only", BASE, "6630b83f4b17c6bd67ed6ed10279665a5a58bb81",
      "--", "src/app/api", "src/server/auth",
    ).split("\n").filter(Boolean);
    expect(changed).toEqual([]);
  });

  // 19 · 20 — asserted on the rendered page as well as by byte-identity above.
  it.each(pages)("%s keeps its error and pending affordances", (_n, Page) => {
    const { container } = render(<Page />);
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    // Turnstile has not solved in a test environment, so the control is held —
    // which is the pending/disabled contract this phase must not weaken.
    expect(submit.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
    expect((container.querySelector('input[name="password"]') as HTMLInputElement).type).toBe("password");
  });

  it("keeps every visible label bound to its input", () => {
    for (const [, Page] of pages) {
      const { container } = render(<Page />);
      for (const input of container.querySelectorAll("input:not([type=hidden])")) {
        const id = input.getAttribute("id");
        expect(id, "an input has no id to bind a label to").toBeTruthy();
        expect(container.querySelector(`label[for="${id}"]`), id!).not.toBeNull();
      }
    }
  });
});

describe("this phase stayed inside its scope", () => {
  /* FROZEN TO ITS OWN RANGE. This claim is about what
     ATA-AUTH-THRESHOLD-CONTINUITY-1 moved, and that phase ended at 6630b83f.
     Comparing BASE to the working tree instead made the claim grow a new
     meaning with every later phase, so it failed on the first unrelated change
     and said only that something, somewhere, had moved. */
  const PHASE_END = "6630b83f4b17c6bd67ed6ed10279665a5a58bb81";
  const changed = git("diff", "--name-only", BASE, PHASE_END, "--", "src/", "public/")
    .split("\n").filter(Boolean)
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

  it("moved four product files and no more", () => {
    expect(changed.sort()).toEqual([
      "src/app/login/page.tsx",
      "src/app/register/page.tsx",
      "src/features/auth/auth-stage.css",
      "src/features/auth/auth-stage.tsx",
    ].sort());
  });

  it("touched no other surface", () => {
    for (const prefix of [
      "src/features/public-home/", "src/features/tools/", "src/features/tools-fidelity/",
      "src/features/report/", "src/features/workspace-fidelity/", "src/features/profile-fidelity/",
      "src/features/academy-experience/", "src/features/path/", "src/features/lesson/",
      "src/components/shell/", "src/lib/curriculum/", "src/styles/", "public/",
    ]) {
      expect(changed.filter((f) => f.startsWith(prefix)), prefix).toEqual([]);
    }
  });
});
