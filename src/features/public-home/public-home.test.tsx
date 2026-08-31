import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicHomeScreen } from "@/features/public-home/public-home-screen";

/**
 * Public Home — brand-evolution gates.
 *
 * The page's authority is no longer the frozen HomeATA document: that identity
 * was deliberately broken for this route, and only this route, on the owner's
 * explicit authorisation. What replaces "is it byte-identical to the freeze" is
 * this file — a set of properties that must hold for the page to be truthful.
 *
 * Every assertion here is a thing that would otherwise regress silently: a
 * production note shipped to the public, a claim widened past what the product
 * does, a deep link quietly broken by a renamed section, a synthetic example
 * losing the label that says it is synthetic.
 */

/** The ten sections of `<main>`; with the header that is eleven responsibilities. */
const SECTION_IDS = [
  "top",
  "decide",
  "mechanism",
  "review",
  "product",
  "path",
  "tools",
  "fit",
  "boundaries",
  "faq",
] as const;

/** Addresses the page published before this phase. They must keep resolving. */
const LEGACY_ANCHORS = ["recognition", "first-journey", "start"] as const;

/** Strings that must never reach a visitor. */
const PRODUCTION_NOTES = [
  "ожидает утверждённый скриншот",
  "Контент-слот",
  "до публикации заменить",
  "зарезервированное место",
];

const css = readFileSync(
  join(process.cwd(), "src/features/public-home/public-home.css"),
  "utf8",
);
const screenSource = readFileSync(
  join(process.cwd(), "src/features/public-home/public-home-screen.tsx"),
  "utf8",
);

function sections(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("main > section[id]")).map((s) => s.id);
}

function text(container: HTMLElement): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

describe("Public Home — architecture", () => {
  it("renders eleven responsibilities: a header and ten sections, in order", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll("header").length).toBe(1);
    expect(sections(container)).toEqual([...SECTION_IDS]);
  });

  it("opens on the opportunity, not on a negated category", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const h1 = container.querySelector("h1") as HTMLElement;
    expect(text(h1)).toBe("Возможности не приходят с готовыми ответами.");
    // The page used to open by defining itself against a competitor category.
    // An argument against others leaves no room for the learner's own agency.
    expect(text(container)).not.toContain("Не ещё один источник информации");
  });

  it("keeps every legacy anchor addressable", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    for (const id of LEGACY_ANCHORS) {
      expect(container.querySelector(`#${id}`), `#${id} no longer resolves`).not.toBeNull();
    }
  });

  it("lands #first-journey on the journey line that replaced its section", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const alias = container.querySelector("#first-journey");
    expect(alias).not.toBeNull();
    // The alias must sit inside #product and immediately before the journey.
    expect(alias?.closest("section")?.id).toBe("product");
    expect(alias?.nextElementSibling?.classList.contains("journey-line")).toBe(true);
  });

  it("lands #start on the final call to action", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const alias = container.querySelector("#start");
    expect(alias?.nextElementSibling?.classList.contains("final-step")).toBe(true);
  });

  it("declares exactly one h1 and one main landmark", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll("h1").length).toBe(1);
    expect(container.querySelectorAll("main").length).toBe(1);
  });

  it("orders the navigation the way the document is ordered", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const nav = container.querySelector("nav#primary-nav");
    const navIds = Array.from(nav?.querySelectorAll('a[href^="#"]') ?? []).map((a) =>
      (a.getAttribute("href") ?? "").slice(1),
    );
    const documentOrder = sections(container);
    const expected = documentOrder.filter((id) => navIds.includes(id));
    expect(navIds).toEqual(expected);
  });
});

describe("Public Home — the claim never outruns the product", () => {
  it("states DECIDE as a step of the cycle", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const mechanism = container.querySelector("#mechanism") as HTMLElement;
    const steps = Array.from(mechanism.querySelectorAll("li h3")).map((h) => h.textContent);
    expect(steps).toEqual([
      "Понять",
      "Решить",
      "Действовать",
      "Проверить",
      "Исправить",
      "Продвинуться",
    ]);
    expect(text(mechanism)).toContain("Сформулировать собственное решение и назвать его основание");
  });

  it("carries the qualifier as visible copy, not as a footnote", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const mechanism = text(container.querySelector("#mechanism") as HTMLElement);
    const review = text(container.querySelector("#review") as HTMLElement);
    expect(mechanism).toContain("На предусмотренных уровнях");
    expect(review).toContain("На предусмотренных уровнях");
  });

  it("never claims review happens on every level", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const body = text(container);
    for (const overreach of ["на каждом уровне", "каждый уровень проверя", "все 100 уровней"]) {
      expect(body).not.toContain(overreach);
    }
  });

  it("promises no financial outcome anywhere", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const body = text(container);
    expect(body).toContain("не обещаем гарантированный финансовый результат");
    for (const forbidden of ["прибыл", "доходност", "заработ", "профит"]) {
      // The single legitimate use is the boundary list: «обещание прибыли».
      const hits = body.split(forbidden).length - 1;
      const allowed = forbidden === "прибыл" ? 1 : 0;
      expect(hits, `"${forbidden}" appears ${hits} times`).toBeLessThanOrEqual(allowed);
    }
  });

  it("shows only the two tools that exist, and no roadmap", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const tools = container.querySelector("#tools") as HTMLElement;
    expect(tools.querySelectorAll(".tool-card").length).toBe(2);
    const names = Array.from(tools.querySelectorAll(".tool-card h3")).map((h) => h.textContent);
    expect(names).toEqual(["Trading Journal", "Risk Calculator"]);
    const copy = text(tools);
    for (const roadmap of ["скоро", "в разработке", "появится", "планируется", "roadmap"]) {
      expect(copy.toLowerCase()).not.toContain(roadmap);
    }
  });
});

describe("Public Home — nothing empty, nothing unlabelled", () => {
  it("ships no production note", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const body = text(container).toLowerCase();
    for (const note of PRODUCTION_NOTES) {
      expect(body, `production note leaked: ${note}`).not.toContain(note.toLowerCase());
    }
    // The classes that carried them are gone from the markup and the sheet.
    for (const dead of ["video-reserve", "asset-slot", "asset-note", "review-sequence"]) {
      expect(screenSource).not.toContain(dead);
      expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain(dead);
    }
  });

  it("gives the hero frame a legible unfinished object, not empty geometry", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const frame = container.querySelector("#top .dframe") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(text(frame)).toContain("Причина входа до сделки");
    expect(text(frame)).toContain("Ещё не сформулировано");
  });

  it("resolves that same object in #decide", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const decided = container.querySelector("#decide .dframe") as HTMLElement;
    expect(text(decided)).toContain("Причина входа до сделки");
    expect(text(decided)).toContain("До сделки зафиксировал условие");
  });

  it("marks every synthetic panel as a demonstration", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    // Hero frame, decide frame, evidence track, product panel, two tool panels.
    expect(container.querySelectorAll(".demo-badge").length).toBe(6);
    for (const selector of ["#top .dframe", "#decide .dframe", "#product .product-panel"]) {
      const host = container.querySelector(selector) as HTMLElement;
      expect(within(host).getAllByText(/Демонстрационный пример/).length).toBeGreaterThan(0);
    }
    const tools = container.querySelector("#tools") as HTMLElement;
    expect(within(tools).getAllByText(/Демонстрационный пример/).length).toBe(2);
  });

  it("carries no learner data — the demonstration is authored, not captured", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const body = text(container);
    expect(body).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(body).not.toMatch(/\+7\s?\(?\d{3}/);
    expect(body).not.toMatch(/\b\d+\s?(₽|\$|USD|EUR)\b/);
  });
});

describe("Public Home — signature evidence", () => {
  it("moves one object through four states", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const track = container.querySelector(".evidence-track") as HTMLElement;
    const stages = Array.from(track.querySelectorAll("li")).map((li) =>
      li.getAttribute("data-frame-stage"),
    );
    expect(stages).toEqual(["v1", "feedback", "v2", "accepted"]);
  });

  it("names one rubric criterion, one return reason and one corrective action", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const track = text(container.querySelector(".evidence-track") as HTMLElement);
    expect(track).toContain("Критерий · Причина до сделки");
    expect(track).toContain("Требуется доработка");
    expect(track).toContain("Опишите условие, которое вы определили заранее");
  });

  it("corrects the same field it flagged", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const track = container.querySelector(".evidence-track") as HTMLElement;
    const v1 = track.querySelector('[data-frame-stage="v1"]') as HTMLElement;
    const v2 = track.querySelector('[data-frame-stage="v2"]') as HTMLElement;
    const field = "Причина входа до сделки";
    expect(text(v1)).toContain(field);
    expect(text(v2)).toContain(field);
    expect(text(v1)).not.toEqual(text(v2));
  });

  it("names the sequence so no stage reads as already accepted", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const track = container.querySelector(".evidence-track") as HTMLElement;
    const titles = Array.from(track.querySelectorAll("h3")).map((h) => h.textContent);
    // «Работа проверена» could be read as work already accepted; the stage is the
    // receipt of a review, not its outcome.
    expect(titles).toEqual([
      "Работа отправлена",
      "Получен разбор",
      "Замечание исправлено",
      "Работа принята",
    ]);
    expect(text(container)).not.toContain("Работа проверена");
  });

  it("closes the objection it raised — V2 states the condition, not that one existed", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const track = container.querySelector(".evidence-track") as HTMLElement;
    const feedback = text(track.querySelector('[data-frame-stage="feedback"]') as HTMLElement);
    const v2 = text(track.querySelector('[data-frame-stage="v2"]') as HTMLElement);

    // The reviewer asks for the condition to be described.
    expect(feedback).toContain("Опишите условие, которое вы определили заранее");
    // So the corrected version must NAME it. Claiming a condition was waited for
    // without saying what it was leaves the objection formally open.
    expect(v2).toContain("зафиксировал условие");
    expect(v2).toContain("вход только после подтверждения заранее отмеченного уровня");
    expect(v2).not.toMatch(/^\s*Дождался заранее заданного условия входа/);

    // And it must stay a process statement: no instrument, price or direction.
    for (const forbidden of ["EUR", "USD", "покупк", "продаж", "лонг", "шорт", "вверх", "вниз"]) {
      expect(v2.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("carries one identical decision string through #decide and #review", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const decide = container.querySelector("#decide .dframe .dframe__value") as HTMLElement;
    const v2 = container.querySelector(
      '[data-frame-stage="v2"] .dframe__value',
    ) as HTMLElement;
    expect(decide, "#decide has no resolved value").not.toBeNull();
    expect(v2, "V2 has no value").not.toBeNull();
    // One object means one wording. Divergence here is how the two states quietly
    // stop being the same object.
    expect(text(v2)).toBe(text(decide));
  });

  it("does not dress acceptance as a financial win", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const accepted = text(
      container.querySelector('[data-frame-stage="accepted"]') as HTMLElement,
    );
    expect(accepted).toContain("Условия уровня выполнены");
    expect(accepted).toContain("не результат сделок");
  });

  it("stops the Decision Frame after the evidence", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    for (const id of ["path", "tools", "fit", "boundaries", "faq"]) {
      const section = container.querySelector(`#${id}`) as HTMLElement;
      expect(section.querySelector(".dframe"), `frame leaked into #${id}`).toBeNull();
      expect(section.querySelector("[data-frame-stage]")).toBeNull();
    }
  });
});

describe("Public Home — session-aware calls to action", () => {
  it("signed out: hero offers the mechanism and registration, never /home", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const hero = container.querySelector("#top") as HTMLElement;
    const hrefs = Array.from(hero.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("#mechanism");
    expect(hrefs).toContain("/register");
    expect(hrefs).not.toContain("/home");
    expect(within(hero).getByText("Посмотреть, как работает ATA")).toBeTruthy();
  });

  it("signed in: the account action becomes /home and registration disappears", () => {
    const { container } = render(<PublicHomeScreen authenticated />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/home");
    expect(hrefs).not.toContain("/register");
    expect(screen.queryByText(/Уже клиент/)).toBeNull();
    // The mechanism anchor is state-independent.
    expect(hrefs).toContain("#mechanism");
  });

  it("signed out: keeps the login affordances", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => h === "/login").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Уже клиент/)).toBeTruthy();
  });

  it("does not change the composition between the two states", () => {
    const anon = render(<PublicHomeScreen authenticated={false} />);
    const anonSections = sections(anon.container);
    anon.unmount();
    const auth = render(<PublicHomeScreen authenticated />);
    expect(sections(auth.container)).toEqual(anonSections);
  });
});

describe("Public Home — legal labels are not fake links", () => {
  it("states the final call to action positively", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const final = container.querySelector(".final-step") as HTMLElement;
    const heading = final.querySelector("h2") as HTMLElement;
    expect(text(heading)).toBe(
      "Если вы хотите учиться принимать собственные решения — начните с первого уровня.",
    );
    // It used to open by naming what the visitor should not want.
    expect(text(container)).not.toContain("не повторять чужие ответы");
  });

  it("keeps them as text, outside any navigation landmark", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const footer = container.querySelector("footer") as HTMLElement;
    expect(footer.querySelector("nav")).toBeNull();
    const legal = footer.querySelector(".site-footer__legal") as HTMLElement;
    expect(text(legal)).toContain("Конфиденциальность");
    expect(legal.querySelector("a")).toBeNull();
  });
});

describe("Public Home — skip link", () => {
  it("is the first focusable element and points at main", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const first = container.querySelector("a, button") as HTMLElement;
    expect(first.classList.contains("skip-link")).toBe(true);
    expect(first.getAttribute("href")).toBe("#main");
    expect(container.querySelector("#main")).not.toBeNull();
  });

  it("stays off-screen without focus, and is not hidden from the keyboard", () => {
    const rule = /\.ph \.skip-link \{([^}]*position: fixed[^}]*)\}/.exec(css);
    expect(rule, "skip-link rule is missing").not.toBeNull();
    const body = rule?.[1] ?? "";
    // Off-screen by transform, never display:none / visibility:hidden — either of
    // those would take it out of the tab order and leave the page without one.
    expect(body).toMatch(/transform:\s*translateY\(-\d+%\)/);
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).not.toMatch(/visibility:\s*hidden/);

    const focused = /\.ph \.skip-link:focus-visible \{([^}]*)\}/.exec(css);
    expect(focused, "skip-link has no focus-visible rule").not.toBeNull();
    expect(focused?.[1]).toMatch(/transform:\s*translateY\(0\)/);
  });
});

describe("Public Home — mobile menu", () => {
  it("starts closed and opens on activation", async () => {
    const user = userEvent.setup();
    render(<PublicHomeScreen authenticated={false} />);
    const toggle = screen.getByRole("button", { name: /Меню/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape and returns focus to the toggle", async () => {
    const user = userEvent.setup();
    render(<PublicHomeScreen authenticated={false} />);
    const toggle = screen.getByRole("button", { name: /Меню/ });
    await user.click(toggle);
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(toggle);
  });
});

describe("Public Home — stylesheet holds its contract", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("makes no remote request", () => {
    expect(rules).not.toMatch(/@import/);
    expect(rules).not.toMatch(/https?:\/\//);
    expect(rules).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it("adds no external host to the markup either", () => {
    expect(screenSource).not.toMatch(/https?:\/\/(?!\S*schema)/);
    expect(screenSource).not.toMatch(/<img[^>]+src="https?:/);
  });

  it("lets no selector escape the .ph namespace", () => {
    const stripped = rules.replace(/@(media|supports)[^{]*\{/g, "");
    const escaped: string[] = [];
    const rule = /(^|\})\s*([^{}@]+)\{/g;
    let m: RegExpExecArray | null;
    while ((m = rule.exec(stripped)) !== null) {
      const selectorList = m[2] ?? "";
      for (const part of selectorList.split(",")) {
        const s = part.trim();
        if (!s) continue;
        if (!s.startsWith(".ph") && !s.startsWith("html.ph-smooth-scroll")) escaped.push(s);
      }
    }
    expect(escaped, `global selectors would regress other surfaces: ${escaped.slice(0, 5).join(" | ")}`)
      .toEqual([]);
  });

  it("keeps the frozen palette and geometry tokens", () => {
    for (const value of ["#0b0d0a", "#c7f76d", "#f8f9f5", "#30421e", "1280px"]) {
      expect(css.toLowerCase()).toContain(value);
    }
  });

  it("gives the trust note AA contrast at a readable size", () => {
    const rule = /\.ph \.hero__boundary \{([^}]*)\}/.exec(css);
    expect(rule, ".hero__boundary rule is missing").not.toBeNull();
    const body = rule?.[1] ?? "";
    const size = /font-size:\s*(\d+)px/.exec(body);
    expect(Number(size?.[1]), "trust note must be at least 12px").toBeGreaterThanOrEqual(12);

    const alpha = /color:\s*rgba\(243,\s*244,\s*239,\s*([\d.]+)\)/.exec(body);
    expect(alpha, "trust note colour must stay a known rgba").not.toBeNull();
    const a = Number(alpha?.[1]);
    const over = (fg: number, bg: number) => fg * a + bg * (1 - a);
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = (r: number, g: number, b: number) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const fgLum = lum(over(243, 11), over(244, 13), over(239, 10));
    const bgLum = lum(11, 13, 10);
    const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
    expect(ratio, `trust note contrast is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);

    // And the small-screen override must not undo either property.
    const mobile = /\.ph \.hero__boundary \{\s*font-size:\s*(\d+)px/g;
    let m: RegExpExecArray | null;
    while ((m = mobile.exec(css)) !== null) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    }
  });

  it("reserves no fixed hero height that would push the CTAs below the fold", () => {
    const rule = /\.ph \.hero \{([^}]*)\}/.exec(css);
    expect(rule, ".ph .hero rule is missing").not.toBeNull();
    const body = rule?.[1] ?? "";
    // The frozen sheet reserved 960px for a 16:9 video slot that no longer
    // exists. With it, the primary call to action started at 918px on a 900px
    // viewport — the measured defect this composition had to fix.
    const minHeight = /min-height:\s*(\d+)px/.exec(body);
    expect(Number(minHeight?.[1] ?? 0), "hero must not reserve a fixed height")
      .toBeLessThanOrEqual(0);
    const padTop = /padding:\s*(\d+)px/.exec(body);
    expect(Number(padTop?.[1] ?? 0), "hero top padding pushes the CTAs down")
      .toBeLessThanOrEqual(140);
  });

  it("raises every touch target to 44px, in every rule that sizes one", () => {
    // Checking only the base rule is not enough: the frozen sheet re-declared
    // `.mobile-login` inside a media query at 32px, and a gate that reads the
    // first match would call that green. Every declaration is checked.
    for (const selector of [".wordmark", ".mobile-login", ".menu-toggle", ".client-entry"]) {
      const rules = Array.from(
        css.matchAll(new RegExp(`\\.ph \\${selector}\\s*\\{([^}]*)\\}`, "g")),
      ).map((m) => m[1] ?? "");
      expect(rules.length, `${selector} has no rule`).toBeGreaterThan(0);
      expect(
        rules.some((body) => /min-height:\s*44px/.test(body)),
        `${selector} never reaches 44px`,
      ).toBe(true);
      for (const body of rules) {
        const declared = Array.from(body.matchAll(/min-height:\s*(\d+)px/g)).map((m) =>
          Number(m[1]),
        );
        for (const value of declared) {
          expect(value, `${selector} declares ${value}px somewhere`).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });

  it("keeps motion to one bounded sequence and honours reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
    expect(reduced?.[1]).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(reduced?.[1]).toMatch(/transition-delay:\s*0s\s*!important/);

    // The evidence sequence: 240ms each, last starting at 600ms — 840ms total.
    const delays = Array.from(css.matchAll(/transition-delay:\s*(\d+)ms/g)).map((m) =>
      Number(m[1]),
    );
    const longest = delays.length > 0 ? Math.max(...delays) : 0;
    expect(longest + 240, "the sequence must finish inside 900ms").toBeLessThanOrEqual(900);

    // Nothing ambient: no infinite animation anywhere on the page.
    expect(rules).not.toMatch(/animation-iteration-count:\s*infinite/);
    expect(rules).not.toMatch(/animation:[^;]*infinite/);
  });

  it("keeps the reveal switched off below 920px, so mobile is static", () => {
    const mobileBlock = /@media \(max-width: 920px\) \{([\s\S]*?)\n\}/.exec(css);
    expect(mobileBlock?.[1]).toMatch(/\[data-reveal\][\s\S]*?transition:\s*none/);
  });
});
