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
