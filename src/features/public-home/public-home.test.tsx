import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicHomeScreen } from "@/features/public-home/public-home-screen";

/**
 * Public Home fidelity tests.
 *
 * The page's authority is the frozen HomeATA document
 * (e82bba3a4cb282ba1d0e7814d04db950f0905cb8). These tests exist because the
 * previous implementation of this surface kept the section NAMES and quietly
 * lost most of the content — a reconstruction that looked complete in a diff and
 * was not. Every assertion here is a thing that regression would have caught.
 */

const SECTION_IDS = [
  "top",
  "recognition",
  "mechanism",
  "product",
  "review",
  "first-journey",
  "path",
  "tools",
  "fit",
  "boundaries",
  "faq",
  "start",
] as const;

function sections(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("section[id]")).map((s) => s.id);
}

describe("Public Home — structure", () => {
  it("renders all twelve frozen sections in the frozen order", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(sections(container)).toEqual([...SECTION_IDS]);
  });

  it("declares exactly one main landmark and exactly one h1", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("main")?.id).toBe("main");
  });

  it("keeps the skip link as the first focusable element, pointing at main", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const focusable = container.querySelector("a, button, input, [tabindex]");
    expect(focusable).toHaveClass("skip-link");
    expect(focusable).toHaveAttribute("href", "#main");
  });

  it("keeps the six-step learning loop whole", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const steps = container.querySelectorAll(".learning-loop > li");
    expect(steps).toHaveLength(6);
    for (const label of [
      "Понять",
      "Проверить себя",
      "Применить",
      "Получить разбор",
      "Исправить",
      "Двигаться дальше",
    ]) {
      expect(within(container).getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("keeps the four-stage review cycle whole", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll(".review-sequence > li")).toHaveLength(4);
    for (const label of ["V1", "01", "V2", "✓"]) {
      expect(container.querySelector(".review-sequence")?.textContent).toContain(label);
    }
  });

  it("keeps the five-step first journey whole", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll(".journey-line > li")).toHaveLength(5);
  });

  it("keeps all seven FAQ entries as native details/summary", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const details = container.querySelectorAll(".faq-list details");
    expect(details).toHaveLength(7);
    for (const d of Array.from(details)) {
      expect(d.querySelector("summary")).not.toBeNull();
    }
  });

  it("keeps the path map — 20 module ticks and the five-level current segment", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll(".path-map__modules i")).toHaveLength(20);
    expect(container.querySelectorAll(".path-map__modules i.is-active")).toHaveLength(1);
    expect(container.querySelectorAll(".path-map__current span")).toHaveLength(5);
    expect(container.querySelectorAll(".path-map__current .is-current")).toHaveLength(1);
  });

  it("keeps both tool cards and the four hero facts", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll(".tool-card")).toHaveLength(2);
    expect(container.querySelectorAll(".hero__facts > div")).toHaveLength(4);
  });

  it("keeps the empty video reserve and the product asset slot", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const reserve = container.querySelector(".video-reserve");
    expect(reserve).not.toBeNull();
    // It is a reserved space for a future asset: it must stay empty, and it must
    // keep its accessible label rather than becoming a decorative div.
    expect(reserve?.textContent).toBe("");
    expect(reserve).toHaveAttribute("aria-label");
    expect(container.querySelectorAll(".asset-slot").length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the Decision Frame mark and the reveal hooks", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll(".frame-mark")).toHaveLength(1);
    expect(container.querySelectorAll(".frame-mark i")).toHaveLength(2);
    // 41 in the frozen document. A drop here means content was lost.
    expect(container.querySelectorAll("[data-reveal]").length).toBeGreaterThanOrEqual(40);
  });

  it("uses the vendored ATA wordmark, twice, and never a substitute", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const logos = Array.from(container.querySelectorAll("img"));
    expect(logos).toHaveLength(2);
    for (const img of logos) {
      expect(img.getAttribute("src")).toBe("/brand/ata-logo.svg");
      expect(img.getAttribute("width")).toBe("362");
      expect(img.getAttribute("height")).toBe("200");
    }
  });
});

describe("Public Home — copy is unabridged", () => {
  const MUST_APPEAR = [
    "Не ещё один источник информации о трейдинге.",
    "Система, где знание превращается в действие, проверку, обратную связь и следующий шаг.",
    "ATA не является сигнальным сервисом и не обещает гарантированный финансовый результат.",
    "Информации много. Системы — мало.",
    "Путь, в котором каждый шаг должен что-то изменить.",
    "Не витрина контента. Последовательная работа.",
    "Посмотрел — не значит освоил.",
    "Первые уровни быстро приводят к практике.",
    "100 уровней. Но только один следующий шаг.",
    "Инструмент появляется в контексте задачи.",
    "Право сказать «не сейчас» тоже создаёт доверие.",
    "Образовательная система для развития самостоятельности.",
    "До начала пути не должно оставаться скрытых условий.",
    "Обучение и прохождение ATA не гарантируют финансовый результат.",
    "XP",
    "Мотивирует, но не открывает следующий уровень",
    "сигнальный сервис;",
    "копирование сделок;",
    "Практическая среда",
  ];

  it("carries every load-bearing string from the frozen page", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const text = container.textContent ?? "";
    for (const phrase of MUST_APPEAR) {
      expect(text, `missing frozen copy: ${phrase}`).toContain(phrase);
    }
  });

  it("makes no claim the frozen page does not make", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const text = (container.textContent ?? "").toLowerCase();
    // No invented social proof, trading data, guarantees or legal URLs.
    for (const phrase of ["гарантированный доход", "доходность", "прибыль в месяц", "тысяч учеников"]) {
      expect(text, `invented claim present: ${phrase}`).not.toContain(phrase);
    }
  });
});

describe("Public Home — session-aware CTA (AUTH_STATE_ONLY)", () => {
  it("signed out: offers registration and login exactly as the frozen page does", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/register");
    expect(hrefs).toContain("/login");
    expect(hrefs).not.toContain("/home");
    expect(container.textContent).toContain("Начать путь");
    expect(container.textContent).toContain("Уже клиент?");
  });

  it("signed in: primary CTA becomes «Перейти в Академию» → /home", () => {
    const { container } = render(<PublicHomeScreen authenticated />);
    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/home");
    expect(container.textContent).toContain("Перейти в Академию");
  });

  it("signed in: never invites a second registration and hides the service login", () => {
    const { container } = render(<PublicHomeScreen authenticated />);
    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).not.toContain("/register");
    expect(hrefs).not.toContain("/login");
    expect(container.textContent).not.toContain("Уже клиент?");
  });

  it("does not change the composition between the two states", () => {
    const anon = render(<PublicHomeScreen authenticated={false} />);
    const authed = render(<PublicHomeScreen authenticated />);
    // Same sections, same order, same section count: the only permitted
    // difference is which calls to action are offered.
    expect(sections(authed.container)).toEqual(sections(anon.container));
    expect(authed.container.querySelectorAll("[data-reveal]").length).toBe(
      anon.container.querySelectorAll("[data-reveal]").length,
    );
  });
});

describe("Public Home — mobile menu", () => {
  it("starts closed and opens on activation", async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const toggle = screen.getByRole("button", { name: /Меню/ });
    const nav = container.querySelector("#primary-nav");

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(nav).not.toHaveClass("is-open");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(nav).toHaveClass("is-open");
  });

  it("closes when a link inside it is chosen", async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const toggle = screen.getByRole("button", { name: /Меню/ });
    await user.click(toggle);
    await user.click(screen.getByRole("link", { name: "Как это работает" }));
    expect(container.querySelector("#primary-nav")).not.toHaveClass("is-open");
  });

  it("closes on Escape and returns focus to the toggle", async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const toggle = screen.getByRole("button", { name: /Меню/ });
    await user.click(toggle);
    await user.keyboard("{Escape}");
    expect(container.querySelector("#primary-nav")).not.toHaveClass("is-open");
    expect(document.activeElement).toBe(toggle);
  });

  it("closes on a click outside the header", async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const toggle = screen.getByRole("button", { name: /Меню/ });
    await user.click(toggle);
    await user.click(container.querySelector("main") as HTMLElement);
    expect(container.querySelector("#primary-nav")).not.toHaveClass("is-open");
  });

  it("wires the toggle to the nav it controls", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const toggle = screen.getByRole("button", { name: /Меню/ });
    expect(toggle).toHaveAttribute("aria-controls", "primary-nav");
    expect(container.querySelector("#primary-nav")).not.toBeNull();
  });
});

describe("Public Home — stylesheet is scoped and local", () => {
  const css = readFileSync(
    new URL("./public-home.css", import.meta.url).pathname,
    "utf8",
  );

  it("makes no remote request — the Google Fonts import is gone", () => {
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/https?:\/\//);
  });

  it("binds the three families to the product's local faces", () => {
    expect(css).toContain('"ATA Manrope"');
    expect(css).toContain('"ATA Source Serif 4"');
    expect(css).toContain('"ATA IBM Plex Mono"');
    expect(css).not.toMatch(/--font-ui:\s*"Manrope"/);
  });

  it("lets no selector escape the .ph namespace", () => {
    const stripped = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@(media|supports)[^{]*\{/g, "");
    const escaped: string[] = [];
    const rule = /(^|\})\s*([^{}@]+)\{/g;
    let m: RegExpExecArray | null;
    while ((m = rule.exec(stripped)) !== null) {
      // tsconfig runs with noUncheckedIndexedAccess, so the capture group is
      // typed as possibly undefined even though the pattern guarantees it.
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

  it("keeps the frozen surface palette values", () => {
    // A sample of HomeATA's own values. If the stylesheet were "improved",
    // these would drift.
    for (const value of ["#0b0d0a", "#c7f76d", "#f8f9f5", "#30421e", "1280px"]) {
      expect(css.toLowerCase()).toContain(value);
    }
  });
});
