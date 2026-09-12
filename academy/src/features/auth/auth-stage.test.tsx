/**
 * THE AUTH STAGE, AND THE CONTRACT IT MAY NOT DISTURB.
 *
 * The redesign is presentation. Everything that authenticates — the field
 * names, their types, their autocomplete, their order, the labels bound to
 * them, the endpoints, the Turnstile token and the session — belongs to the
 * form components and had to come through untouched. These tests hold both
 * halves: the new composition, and the contract underneath it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", turnstileSiteKey: null, backendOrigin: "https://b.invalid", requestTimeoutMs: 1000 }),
}));

const ROOT = process.cwd();
const ACCEPTED_LOGO_SHA = "29e945f57aeafb3d";

function renderPage(node: React.ReactElement) {
  return render(node);
}

describe("the auth stage composition", () => {
  for (const [name, Page, heading] of [
    ["login", LoginPage, "Вход"],
    ["register", RegisterPage, "Создать аккаунт"],
  ] as const) {
    it(`${name} has exactly one main and one h1`, () => {
      const { container } = renderPage(<Page />);
      expect(container.querySelectorAll("main")).toHaveLength(1);
      const h1s = container.querySelectorAll("h1");
      expect(h1s).toHaveLength(1);
      expect(h1s[0]?.textContent).toBe(heading);
    });

    it(`${name} shows the mark as the asset of record, inside one link to /`, () => {
      const { container } = renderPage(<Page />);
      const marks = container.querySelectorAll("a.auth__mark");
      expect(marks).toHaveLength(1);
      const link = marks[0] as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/");
      expect(link.getAttribute("aria-label")).toBe("Alfa Trade Academy — на главную");
      const img = link.querySelector("img");
      expect(img?.getAttribute("src")).toBe("/brand/ata-logo.svg");
      // decorative: the link carries the name, the image must not repeat it
      expect(img?.getAttribute("alt")).toBe("");
    });

    it(`${name} no longer imitates the mark with text`, () => {
      const { container } = renderPage(<Page />);
      // the old `<p class="login-brand">Alfa Trade Academy</p>`
      expect(container.querySelector(".login-brand")).toBeNull();
      const stray = [...container.querySelectorAll("p, span")].filter(
        (e) => e.textContent?.trim() === "Alfa Trade Academy",
      );
      expect(stray, "no element may render the wordmark as text").toHaveLength(0);
    });

    it(`${name} loads no remote asset`, () => {
      const { container } = renderPage(<Page />);
      const remote = [...container.querySelectorAll("[src],[href]")]
        .map((e) => e.getAttribute("src") ?? e.getAttribute("href"))
        .filter((u) => u && /^https?:\/\//.test(u));
      expect(remote).toEqual([]);
    });
  }

  it("the logo is the accepted asset, byte for byte", () => {
    const bytes = readFileSync(join(ROOT, "public", "brand", "ata-logo.svg"));
    expect(createHash("sha256").update(bytes).digest("hex").slice(0, 16)).toBe(ACCEPTED_LOGO_SHA);
  });
});

describe("the form contract is untouched", () => {
  const fields = (container: HTMLElement) =>
    [...container.querySelectorAll("input")].map((i) => ({
      name: i.getAttribute("name"),
      type: i.getAttribute("type"),
      autocomplete: i.getAttribute("autocomplete"),
      labelled: !!i.labels?.length,
    }));

  it("login keeps email and password, in order, with their autocomplete", () => {
    const { container } = renderPage(<LoginPage />);
    expect(fields(container)).toEqual([
      { name: "email", type: "email", autocomplete: "username", labelled: true },
      { name: "password", type: "password", autocomplete: "current-password", labelled: true },
    ]);
  });

  it("registration keeps its four fields, in order, with their autocomplete", () => {
    const { container } = renderPage(<RegisterPage />);
    expect(fields(container)).toEqual([
      { name: "email", type: "email", autocomplete: "email", labelled: true },
      { name: "name", type: "text", autocomplete: "nickname", labelled: true },
      { name: "password", type: "password", autocomplete: "new-password", labelled: true },
      { name: "confirmPassword", type: "password", autocomplete: "new-password", labelled: true },
    ]);
  });

  it("every field is bound to a real label, not a placeholder", () => {
    for (const Page of [LoginPage, RegisterPage]) {
      const { container, unmount } = renderPage(<Page />);
      for (const input of container.querySelectorAll("input")) {
        expect(input.labels?.length, input.getAttribute("name") ?? "").toBeGreaterThan(0);
        expect(input.labels?.[0]?.textContent?.trim()).toBeTruthy();
      }
      unmount();
    }
  });

  it("adds no password-reveal control, because none existed", () => {
    for (const Page of [LoginPage, RegisterPage]) {
      const { container, unmount } = renderPage(<Page />);
      const reveal = [...container.querySelectorAll("button")].filter((b) =>
        /показать|скрыть|reveal|show/i.test(b.textContent ?? "" + (b.getAttribute("aria-label") ?? "")),
      );
      expect(reveal).toHaveLength(0);
      unmount();
    }
  });
});

describe("the way between the two pages", () => {
  it("login offers registration", () => {
    const { container } = renderPage(<LoginPage />);
    const alt = container.querySelector(".login-alt");
    expect(alt).not.toBeNull();
    const link = within(alt as HTMLElement).getByRole("link", { name: "Создать аккаунт" });
    expect(link.getAttribute("href")).toBe("/register");
  });

  it("registration still offers login", () => {
    const { container } = renderPage(<RegisterPage />);
    const alt = container.querySelector(".register-alt");
    expect(alt).not.toBeNull();
    const link = within(alt as HTMLElement).getByRole("link", { name: "Войти" });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("offers no password recovery, because no such route exists", () => {
    for (const Page of [LoginPage, RegisterPage]) {
      const { container, unmount } = renderPage(<Page />);
      expect(container.textContent).not.toMatch(/Забыли пароль|Восстановить пароль/i);
      expect(container.querySelector('a[href*="forgot"], a[href*="reset"]')).toBeNull();
      unmount();
    }
  });
});

describe("the stylesheet's own contract", () => {
  const css = readFileSync(join(ROOT, "src", "features", "auth", "auth-stage.css"), "utf8");

  it("answers Chrome autofill, so a remembered field is not repainted blue", () => {
    expect(css).toContain(":-webkit-autofill");
    expect(css).toContain("-webkit-text-fill-color");
    expect(css).toMatch(/box-shadow:\s*0 0 0 1000px var\(--background-field\) inset/);
    expect(css, "Firefox marks its own").toContain(":autofill");
  });

  it("is scoped — no rule can reach another surface", () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((b) => b.split("{")[0]?.trim())
      .filter((s): s is string => !!s && !s.startsWith("@") && s.length > 0);
    for (const sel of selectors) {
      for (const part of sel.split(",").map((p) => p.trim()).filter(Boolean)) {
        expect(part.startsWith(".auth"), `unscoped selector: ${part}`).toBe(true);
      }
    }
  });

  it("never paints an error in Signal", () => {
    /* auth.css tinted the summary regions with the same green as the submit
       control. Signal means "this is available to press" and "this has focus";
       an error is neither. Driving the real states is what showed it. */
    for (const sel of [
      ".auth .login-error",
      ".auth .register-error",
      ".auth .auth-captcha--failed",
      // A failed challenge is an error like any other here, and gets the same
      // quiet surface. Painting it Signal would say "press this" about the one
      // control the failure has just taken away.
      ".auth .auth-captcha__failure",
    ]) {
      const at = css.indexOf(sel);
      expect(at, `${sel} must be restated`).toBeGreaterThan(-1);
    }
    const block = css.slice(css.indexOf(".auth .login-error,\n.auth .register-error,\n.auth .auth-captcha--failed"));
    const rule = block.slice(0, block.indexOf("}"));
    expect(rule).toContain("var(--surface-subtle)");
    expect(rule).not.toContain("signal");
    expect(rule).toContain(".auth .auth-captcha__failure");
  });

  it("keeps the third-party widget from pushing the page sideways", () => {
    /* The Turnstile frame is a fixed-width iframe inside a form that must fit a
       320px viewport. Nothing here styles its contents — what is declared is
       that the space around it contains its own overflow instead of handing it
       to the document. Removing this is how /login started scrolling sideways
       once the widget was added. */
    const block = css.slice(css.indexOf(".auth .auth-captcha__frame"));
    const rule = block.slice(0, block.indexOf("}"));
    expect(rule).toMatch(/overflow-x:\s*auto/);
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it("keeps every control at a real target size", () => {
    expect(css).toMatch(/min-height:\s*48px/);
    expect(css).toMatch(/min-height:\s*44px/);
  });

  it("all but removes motion under a stated preference", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/transition-duration:\s*0\.001s/);
  });

  it("declares no remote asset and no font of its own", () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toContain("@import");
    expect(css).not.toContain("@font-face");
  });
});

/**
 * AEM-1 — the error mark has ONE authority for where it sits.
 *
 * The mark was positioned twice at the same specificity — `left: 12px` in one
 * rule and `left: 0` in the next — so the later rule silently won and every
 * error mark rendered flush against its own region's hairline. The text column
 * was decided twice as well, and a later `padding-left: 18px` took the gutter
 * away from the unavailable-captcha region while its mark was still being
 * positioned into one.
 *
 * These cases read the stylesheet the way a browser does — last declaration
 * wins — so re-introducing a competing rule ANYWHERE below fails here rather
 * than on a screenshot.
 */
describe("the error mark stays in its column", () => {
  const css = readFileSync(join(ROOT, "src", "features", "auth", "auth-stage.css"), "utf8");

  /** Every style rule in source order, at-rule contents included. */
  function rules(source: string): Array<{ selector: string; body: string }> {
    const out: Array<{ selector: string; body: string }> = [];
    const walk = (text: string, offset = 0) => {
      let head = "";
      let j = offset;
      while (j < text.length) {
        const ch = text[j];
        if (ch === "{") {
          let depth = 1;
          let k = j + 1;
          while (k < text.length && depth > 0) {
            if (text[k] === "{") depth += 1;
            else if (text[k] === "}") depth -= 1;
            k += 1;
          }
          const body = text.slice(j + 1, k - 1);
          const selector = head.trim();
          // An at-rule holds more rules; a style rule holds declarations.
          if (selector.startsWith("@")) walk(body, 0);
          else out.push({ selector, body });
          head = "";
          j = k;
          continue;
        }
        if (ch === "}") { head = ""; j += 1; continue; }
        head += ch;
        j += 1;
      }
    };
    walk(source.replace(/\/\*[\s\S]*?\*\//g, ""));
    return out;
  }

  const ALL = rules(css);

  function matches(selectorList: string, target: string) {
    return selectorList.split(",").map((s) => s.replace(/\s+/g, " ").trim()).includes(target);
  }

  /** The value a browser would use: the LAST declaration that applies. */
  function resolve(target: string, prop: string): string | null {
    let found: string | null = null;
    for (const rule of ALL) {
      if (!matches(rule.selector, target)) continue;
      for (const decl of rule.body.split(";")) {
        const at = decl.indexOf(":");
        if (at < 0) continue;
        const name = decl.slice(0, at).trim();
        const value = decl.slice(at + 1).trim();
        if (name === prop) found = value;
        // `padding: a b c d` decides padding-left too, and that is exactly how
        // the gutter was lost the first time.
        if (prop === "padding-left" && name === "padding") {
          const parts = value.split(/\s+/);
          const left = parts.length >= 4 ? parts[3] : parts.length >= 2 ? parts[1] : parts[0];
          found = left ?? null;
        }
      }
    }
    return found;
  }

  const BOXED = [".auth .login-error", ".auth .register-error", ".auth .auth-captcha--failed", ".auth .auth-captcha__failure"];

  it.each(BOXED)("%s keeps its mark 12px clear of the hairline", (region) => {
    // The exact regression: a later `left: 0` winning the cascade.
    expect(resolve(`${region}::before`, "left")).toBe("12px");
    expect(resolve(`${region}::before`, "position")).toBe("absolute");
  });

  it.each(BOXED)("%s reserves a text column the mark cannot reach into", (region) => {
    const pad = parseFloat(resolve(region, "padding-left") ?? "0");
    const left = parseFloat(resolve(`${region}::before`, "left") ?? "0");
    const size = parseFloat(resolve(`${region}::before`, "width") ?? "0");
    expect(size).toBe(13);
    // The mark ends before the words begin, with air in between. If the column
    // is ever narrowed, this is the arithmetic that fails.
    expect(left + size).toBeLessThanOrEqual(pad);
    expect(pad - (left + size)).toBeGreaterThanOrEqual(4);
  });

  it.each(BOXED)("%s centres its mark without a transform or a negative pull", (region) => {
    expect(resolve(`${region}::before`, "top")).toBe("0");
    expect(resolve(`${region}::before`, "bottom")).toBe("0");
    expect(resolve(`${region}::before`, "margin-top")).toBe("auto");
    expect(resolve(`${region}::before`, "margin-bottom")).toBe("auto");
    expect(resolve(`${region}::before`, "transform")).toBeNull();
  });

  it.each(BOXED)("%s renders a mark at all", (region) => {
    // The unavailable-captcha region reserved a 32px column while the legacy
    // sheet gave it an inline "⚠ " — a gutter with nothing in it.
    expect(resolve(`${region}::before`, "content")).toBe('"!"');
  });

  it("leaves the field note's own contract alone", () => {
    // No box and no hairline, so the mark leads the line instead of sitting in
    // a gutter. Sweeping it into the boxed rule would push it onto the words.
    const target = ".auth .register-field__error";
    expect(resolve(`${target}::before`, "left")).toBe("0");
    expect(resolve(`${target}::before`, "margin-top")).toBe("3px");
    const pad = parseFloat(resolve(target, "padding-left") ?? "0");
    const size = parseFloat(resolve(`${target}::before`, "width") ?? "0");
    expect(pad - size).toBeGreaterThanOrEqual(4);
  });

  it("reads the cascade the way a browser does", () => {
    // The resolver itself must be able to see a later rule win, or every
    // assertion above is decorative.
    const probe = ".auth .login-error::before";
    expect(resolve(probe, "left")).toBe("12px");
    const shadowed = rules(css + `\n${probe} { left: 0; }`);
    ALL.push(...shadowed.slice(ALL.length));
    expect(resolve(probe, "left")).toBe("0");
    ALL.length = shadowed.length - 1;
    expect(resolve(probe, "left")).toBe("12px");
  });
});
