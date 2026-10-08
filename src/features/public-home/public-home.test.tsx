import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicHomeScreen } from "@/features/public-home/public-home-screen";
import { PUBLIC_HOME_FAQ } from "@/features/public-home/public-home-faq";
import { TOOL_WINDOWS } from "@/features/tool-windows/model/catalog";
import { PROGRAM_TOOL_LEVEL } from "@/features/public-home/product-route-data";

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

/** The eleven sections of `<main>`; with the header that is twelve responsibilities.
    The first step has been its own sheet since DD-360 (2026-10-07). */
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
  "first-step",
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
  // `#path` and `#tools` are sections inside `#product` since the route
  // (2026-09-22); document order is what the menu and the deep links follow.
  return Array.from(container.querySelectorAll("main section[id]")).map((s) => s.id);
}

function text(container: HTMLElement): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

/** The words of every text node, each its own word: «20:00» in one cell and
    «USD» in the next read as two words, not as «20:00USD». */
function words(container: HTMLElement): string {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ");
}

describe("Public Home — architecture", () => {
  it("renders twelve responsibilities: a header and eleven sections, in order", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(container.querySelectorAll("header").length).toBe(1);
    expect(sections(container)).toEqual([...SECTION_IDS]);
  });

  it("carries #path and #tools as segments of the route, inside #product", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const route = container.querySelector("#product") as HTMLElement;
    expect(route.classList.contains("route")).toBe(true);
    for (const id of ["path", "tools"]) {
      const segment = container.querySelector(`#${id}`) as HTMLElement;
      expect(segment.closest("#product"), `#${id} must sit inside the route`).toBe(route);
      expect(segment.classList.contains("route__segment")).toBe(true);
    }
    // One window for the whole route, pinned beside the three segments on a
    // wide screen...
    expect(route.querySelectorAll("#route-window").length).toBe(1);
    // ...and on a narrow one each step carries its own window, right under its
    // words, showing that step's state (2026-10-03: the pinned window covered
    // the route on a phone). CSS shows one or the other.
    const steps = Array.from(route.querySelectorAll<HTMLElement>("[data-route-step]"));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      const own = step.querySelector(".rstep__window .pw");
      expect(own, `${step.id} has no window of its own`).not.toBeNull();
      expect(own?.getAttribute("data-state")).toBe(step.getAttribute("data-route-step"));
      expect(own?.hasAttribute("id"), "a step's window must not repeat the pinned window's id").toBe(false);
    }
  });

  it("opens on what ATA is, not on a negated category", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const h1 = container.querySelector("h1") as HTMLElement;
    // DD-364 (owner, 2026-10-08): the headline names the platform.
    expect(text(h1)).toBe("ATA — инновационная платформа обучения трейдингу.");
    // The line under it no longer points back at a headline that is gone
    // («Рынок — одна из таких сред» followed «Возможности не приходят…»).
    const definition = container.querySelector(".hero__definition") as HTMLElement;
    expect(text(definition)).toMatch(/^Здесь вы последовательно учитесь понимать ситуацию на рынке,/);
    expect(text(container)).not.toContain("одна из таких сред");
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

  it("puts a product object under each of the six steps, each its own shape", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const mechanism = container.querySelector("#mechanism") as HTMLElement;
    const objects = Array.from(mechanism.querySelectorAll(".learning-loop > li .cyc"));
    expect(objects.map((el) => el.getAttribute("data-step"))).toEqual(["1", "2", "3", "4", "5", "6"]);
    // Six different objects, not one card six times.
    expect(new Set(objects.map((el) => el.className)).size).toBe(6);
    const copy = text(mechanism);
    for (const real of ["Выполните практический шаг", "Наставник запросил доработку", "Уровень завершён", "Для завершения — 100 %"]) {
      expect(copy).toContain(real);
    }
  });

  it("carries the qualifier as visible copy, not as a footnote", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const mechanism = text(container.querySelector("#mechanism") as HTMLElement);
    const review = text(container.querySelector("#review") as HTMLElement);
    expect(mechanism).toContain("На предусмотренных уровнях");
    // In #review the qualifier is the section's label since DD-369 (the lead is the owner's sentence).
    expect(review.toLowerCase()).toContain("на предусмотренных уровнях");
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

  it("renders the FAQ from the one list the structured data also reads, and names the cost", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const items = container.querySelectorAll(".faq-list details");
    expect(items).toHaveLength(PUBLIC_HOME_FAQ.length);
    const body = text(container);
    // Owner, 2026-09-22: tuition is free, and the page says so in the FAQ.
    expect(body).toContain("Сколько стоит обучение?");
    expect(body).toContain("Обучение в ATA бесплатно");
    // And still nothing about the broker, deposits or checkpoints (2026-10-04: the
    // FAQ's «Что такое контрольная точка?» left with the launch audit).
    for (const forbidden of ["Pocket", "депозит", "баланс", "$", "контрольн"]) {
      expect(body, `"${forbidden}" must not appear on the public page`).not.toContain(forbidden);
    }
  });

  it("shows the six built tools from the catalogue, at the levels the program opens them, and no roadmap", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const tools = container.querySelector("#tools") as HTMLElement;
    // The program learners have (owner's document of 2026-10-02; 2026-10-04 launch audit) —
    // not the catalogue's 100-level plan (5/10/15/20/25/30).
    expect(PROGRAM_TOOL_LEVEL).toEqual({ "trade-card": 5, journal: 9, "risk-calculator": 13, "entry-checklist": 13, stats: 24, news: 28 });
    const built = TOOL_WINDOWS.filter((tool) => tool.built)
      .slice()
      .sort((a, b) => PROGRAM_TOOL_LEVEL[a.slug] - PROGRAM_TOOL_LEVEL[b.slug]);
    expect(built.length).toBe(6);
    const labels = Array.from(tools.querySelectorAll(".rstep__label")).map((el) => el.textContent ?? "");
    expect(labels).toEqual(built.map((tool) => `${tool.title} · открывается на L${PROGRAM_TOOL_LEVEL[tool.slug]}`));
    const nodes = Array.from(tools.querySelectorAll(".rstep__node")).map((el) => el.textContent);
    expect(nodes).toEqual(["L5", "L9", "L13", "L13", "L24", "L28"]);
    // The route's own words promise nothing ahead. (A window shows the
    // product's states — the News Calendar marks a release due today «скоро» —
    // so the windows are read apart from the copy.)
    const copyOnly = tools.cloneNode(true) as HTMLElement;
    copyOnly.querySelectorAll(".pw").forEach((window) => window.remove());
    const copy = text(copyOnly);
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

  it("holds the film in the hero frame — its cover says «Скоро» and offers nothing that does nothing (2026-10-04)", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const frame = container.querySelector("#top .dframe--film") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("data-film")).toBe("soon");
    expect(text(frame)).toContain("Фильм о платформе");
    expect(text(frame)).toContain("Скоро");
    expect(text(frame)).toContain("Как устроена Alpha Trade Academy");
    expect(frame.querySelector("button")).toBeNull();
    expect(frame.querySelector("video")).toBeNull();
  });

  it("puts the player in the frame when the film is on the host — on a click, never by itself", async () => {
    const film = { src: "/film/hero.mp4?v=abc", poster: null, captions: null };
    const { container } = render(<PublicHomeScreen authenticated={false} film={film} />);
    const frame = container.querySelector("#top .dframe--film") as HTMLElement;
    expect(frame.getAttribute("data-film")).toBe("ready");
    expect(text(frame)).not.toContain("Скоро");
    expect(frame.querySelector("video")).toBeNull();
    await userEvent.click(within(frame).getByRole("button", { name: /Смотреть фильм/ }));
    const video = frame.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe("/film/hero.mp4?v=abc");
  });

  it("while the film plays, the stage is as tall as the player — picture and bar — so no control is cut off (2026-10-07)", async () => {
    const film = { src: "/film/hero.webm?v=abc", poster: null, captions: null };
    const { container } = render(<PublicHomeScreen authenticated={false} film={film} />);
    const stage = container.querySelector("#top .hfilm__stage") as HTMLElement;
    expect(stage.getAttribute("data-watching")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Смотреть фильм/ }));
    expect(stage.getAttribute("data-watching")).toBe("true");
    // The player's bar — pause, sound, full screen — is in the stage, not below its edge.
    expect(stage.querySelector(".avp__bar")).not.toBeNull();
    expect(within(stage).getByRole("button", { name: "На весь экран" })).toBeTruthy();
    const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.ph \.hfilm__stage\[data-watching="true"\] \{\s*aspect-ratio: auto;\s*\}/);
    expect(css).toMatch(/\.ph \.hfilm__stage\[data-watching="true"\] \.hfilm__player \{\s*height: auto;\s*\}/);
    // At its end the film is a film, not a lesson.
    fireEvent.ended(stage.querySelector("video") as HTMLVideoElement);
    expect(within(stage).getByRole("status")).toHaveTextContent("Фильм просмотрен");
    expect(within(stage).queryByText("Урок просмотрен")).toBeNull();
    // The bar's icons read the dark surface's text, not the page's Ink (Ink on Ink was invisible).
    expect(css).toMatch(/\.ph \.hfilm__stage \.hfilm__player \{[^}]*--text-primary: var\(--text-on-dark\);\s*--text-secondary: var\(--text-on-dark-muted\);/);
  });

  it("resolves that same object in #decide", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    // Since 2026-09-22 the object sits in the product's own frame: the Trade
    // Card, where the reason is written before the trade.
    const decided = container.querySelector("#decide .decision") as HTMLElement;
    expect(decided).not.toBeNull();
    expect(text(decided)).toContain("Trade Card");
    expect(text(decided)).toContain("Основание входа в сделку");
    expect(text(decided)).toContain("До сделки зафиксировал условие");
    expect(text(decided)).toContain("Зафиксировано");
  });

  it("marks every synthetic panel as a demonstration", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    // Hero frame, decide frame, the two product windows — one badge in each
    // bar covers every state the window shows — and each route step's own
    // window for a narrow screen (2026-10-03).
    const stepWindows = container.querySelectorAll(".rstep__window .pw").length;
    expect(stepWindows).toBeGreaterThan(0);
    // The hero frame holds the film since 2026-10-04 — not a demonstration.
    expect(container.querySelectorAll(".demo-badge").length).toBe(3 + stepWindows);
    for (const bar of Array.from(container.querySelectorAll(".rstep__window .pw__bar"))) {
      expect(within(bar as HTMLElement).getAllByText(/Демонстрационный пример/).length).toBe(1);
    }
    for (const selector of ["#decide .pw__bar", "#review .pw__bar", "#product .pw__bar"]) {
      const host = container.querySelector(selector) as HTMLElement;
      expect(within(host).getAllByText(/Демонстрационный пример/).length).toBeGreaterThan(0);
    }
  });

  it("carries no learner data — the demonstration is authored, not captured", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const body = words(container);
    expect(body).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(body).not.toMatch(/\+7\s?\(?\d{3}/);
    // A sum of money, not a clock: the windows show «14:32 EUR/USD» and
    // «20:00 USD» (a trade's time and its pair, a release's time and its
    // currency), and those are not amounts.
    expect(body).not.toMatch(/(?<!:)\b\d+\s?(₽|\$|USD|EUR)\b/);
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
    expect(track).toContain("Критерий · Основание до сделки");
    expect(track).toContain("Требуется доработка");
    expect(track).toContain("Опишите условие, которое вы определили заранее");
  });

  it("corrects the same field it flagged", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const track = container.querySelector(".evidence-track") as HTMLElement;
    const v1 = track.querySelector('[data-frame-stage="v1"]') as HTMLElement;
    const v2 = track.querySelector('[data-frame-stage="v2"]') as HTMLElement;
    const field = "Основание входа в сделку";
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
    const decide = container.querySelector("#decide .decision .dframe__value") as HTMLElement;
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

  it("shows the evidence in the product's own frame, and the strip drives it", async () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const review = container.querySelector("#review") as HTMLElement;
    const window = review.querySelector("#review-window") as HTMLElement;
    expect(window.getAttribute("data-stage")).toBe("v1");
    // The real assignment: the report of L3, its third entry, the real field.
    expect(text(window)).toContain("Первые пять demo-сделок");
    expect(text(window)).toContain("Запись 3");
    expect(text(window)).toContain("Отчёт отправлен и ожидает проверки наставника");
    const buttons = Array.from(review.querySelectorAll(".evidence-track .evidence__button"));
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    await userEvent.click(buttons[1] as HTMLElement);
    expect(window.getAttribute("data-stage")).toBe("feedback");
    expect(text(window)).toContain("Наставник запросил доработку");
    expect(text(window)).toContain("Опишите условие, которое вы определили заранее");
    await userEvent.click(buttons[3] as HTMLElement);
    expect(window.getAttribute("data-stage")).toBe("accepted");
    expect(text(window)).toContain("Работа принята");
    expect(text(window)).toContain("уровень завершён");
    expect(buttons[3]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the window from anywhere on a card, its object included", async () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const review = container.querySelector("#review") as HTMLElement;
    const window = review.querySelector("#review-window") as HTMLElement;
    const cards = Array.from(review.querySelectorAll(".evidence-track > li")) as HTMLElement[];
    expect(cards).toHaveLength(4);
    // The note, the heading around the button and the card's own surface all switch.
    await userEvent.click(cards[2]!.querySelector(".evidence__note") as HTMLElement);
    expect(window.getAttribute("data-stage")).toBe("v2");
    await userEvent.click(cards[1]!.querySelector("h3") as HTMLElement);
    expect(window.getAttribute("data-stage")).toBe("feedback");
    await userEvent.click(cards[3]!);
    expect(window.getAttribute("data-stage")).toBe("accepted");
    // The object inside a card is the largest thing on it: a press there is a
    // press on the card (until 2026-10-02 it did nothing — a dead middle in a
    // card that lights up under the pointer).
    await userEvent.click(cards[0]!.querySelector(".evidence__object") as HTMLElement);
    expect(window.getAttribute("data-stage")).toBe("v1");
    await userEvent.click(cards[2]!.querySelector(".evidence__object .dframe__value") as HTMLElement);
    expect(window.getAttribute("data-stage")).toBe("v2");
    await userEvent.click(cards[1]!.querySelector(".evidence__verdict") as HTMLElement);
    expect(window.getAttribute("data-stage")).toBe("feedback");
    // The button still carries the state for the keyboard and assistive tech.
    const pressed = Array.from(review.querySelectorAll(".evidence__button")).map((b) => b.getAttribute("aria-pressed"));
    expect(pressed).toEqual(["false", "true", "false", "false"]);
  });

  it("does not take a drag that selected the card's text for a press", async () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const review = container.querySelector("#review") as HTMLElement;
    const stage = () => (review.querySelector("#review-window") as HTMLElement).getAttribute("data-stage");
    const cards = Array.from(review.querySelectorAll(".evidence-track > li")) as HTMLElement[];
    const text = cards[2]!.querySelector(".evidence__object .dframe__value") as HTMLElement;
    const selection = globalThis.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(text);
    expect(stage()).toBe("v1");
    selection.removeAllRanges();
    fireEvent.click(text);
    expect(stage()).toBe("v2");
  });

  it("stops the Decision Frame after the evidence", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    for (const id of ["path", "tools", "fit", "boundaries", "faq", "first-step"]) {
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
    expect(screen.queryByText(/Уже учитесь/)).toBeNull();
    // The mechanism anchor is state-independent.
    expect(hrefs).toContain("#mechanism");
  });

  it("signed out: keeps the login affordances", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => h === "/login").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Уже учитесь/)).toBeTruthy();
  });

  it("does not change the composition between the two states", () => {
    const anon = render(<PublicHomeScreen authenticated={false} />);
    const anonSections = sections(anon.container);
    anon.unmount();
    const auth = render(<PublicHomeScreen authenticated />);
    expect(sections(auth.container)).toEqual(anonSections);
  });

  /* 2026-10-07, the owner: «на мобильной версии в шапке сделай кнопку как на десктопе в случае
     того что залогинен кнопка перейти в академию а не вход». */
  it("signed in, the phone header offers the way into the Academy where «Войти» stands for a visitor", () => {
    const auth = render(<PublicHomeScreen authenticated />);
    const actions = auth.container.querySelector(".header-mobile-actions") as HTMLElement;
    expect(actions.querySelector(".mobile-login")).toBeNull();
    const academy = actions.querySelector("a.mobile-academy") as HTMLAnchorElement;
    expect(academy.getAttribute("href")).toBe("/home");
    expect(academy.getAttribute("aria-label")).toBe("Перейти в Академию");
    // The desktop's own button, not a look-alike.
    expect(academy.className).toContain("button--signal");
    // The menu toggle still follows it.
    expect(academy.nextElementSibling?.classList.contains("menu-toggle")).toBe(true);
    auth.unmount();

    const anon = render(<PublicHomeScreen authenticated={false} />);
    const anonActions = anon.container.querySelector(".header-mobile-actions") as HTMLElement;
    expect(anonActions.querySelector(".mobile-academy")).toBeNull();
    expect(anonActions.querySelector("a.mobile-login")?.getAttribute("href")).toBe("/login");
  });

  it("the phone header's academy button shortens only on the narrowest phones, and the menu's single action fills its row", () => {
    const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).toMatch(/\n\.ph \.mobile-academy__short \{\s*display: none;\s*\}/);
    expect(css).toMatch(
      /@media \(max-width: 359px\) \{\s*\.ph \.mobile-academy__full \{\s*display: none;\s*\}\s*\.ph \.mobile-academy__short \{\s*display: inline;\s*\}\s*\}/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1040px\) \{\s*\.ph \.primary-nav \.nav-actions > \.button:only-child \{\s*grid-column: 1 \/ -1;\s*\}\s*\}/,
    );
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
    // `@keyframes` blocks hold keyframe selectors (`from`, `to`, percentages),
    // not element selectors: they cannot escape the namespace, so they are
    // removed whole before the rule scan.
    const stripped = rules
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      .replace(/@(media|supports)[^{]*\{/g, "");
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

  it("hides nothing without a script: the reveal is gated on the JS marker", () => {
    expect(css).toMatch(/\.ph\.has-js \[data-reveal\] \{[^}]*opacity:\s*0/);
    expect(css).not.toMatch(/\n\.ph \[data-reveal\] \{/);
  });

  it("keeps the reveal light below 920px: a short lift, no delays", () => {
    // Owner, 2026-09-22: motion on phones too — but lighter than the desktop's
    // 24px/620ms, and never a stagger that holds a card back while scrolling.
    const mobileBlock = /@media \(max-width: 920px\) \{([\s\S]*?)\n\}/.exec(css);
    const block = mobileBlock?.[1] ?? "";
    const rule = /\.ph\.has-js \[data-reveal\] \{([^}]*)\}/.exec(block);
    expect(rule, "the phone reveal rule is missing").not.toBeNull();
    expect(rule?.[1]).toMatch(/translateY\(12px\)/);
    const durations = Array.from((rule?.[1] ?? "").matchAll(/(\d+)ms/g)).map((m) => Number(m[1]));
    expect(durations.length).toBeGreaterThan(0);
    expect(Math.max(...durations)).toBeLessThanOrEqual(400);
    expect(block).toMatch(/\.evidence-track > li \{[^}]*transition-delay:\s*0s/);
  });

  it("plays each motion sequence once and settles inside a second", () => {
    // The three sequences ride `is-visible`, run with `both`, and nothing loops.
    for (const trigger of [
      ".ph .section-intro.is-visible .ladder > li",
      ".ph .learning-loop.is-visible::before",
      '.ph .evidence-track > li.is-visible[data-frame-stage="v2"] .evidence__object--corrected',
    ]) {
      expect(css, `${trigger} must be a sequence`).toContain(trigger);
    }
    // Shorthand: the first time is the duration, the second (if any) the delay.
    const durations: number[] = [];
    const delays: number[] = [];
    for (const m of css.matchAll(/animation:\s*([^;]*);/g)) {
      const times = Array.from(m[1]!.matchAll(/(\d+)ms/g)).map((t) => Number(t[1]));
      if (times[0] !== undefined) durations.push(times[0]);
      if (times[1] !== undefined) delays.push(times[1]);
    }
    for (const m of css.matchAll(/animation-delay:\s*(\d+)ms/g)) delays.push(Number(m[1]));
    expect(Math.max(...durations)).toBeLessThanOrEqual(900);
    expect(Math.max(...delays)).toBeLessThanOrEqual(800);
    expect(css).not.toMatch(/animation-iteration-count:\s*infinite/);
    expect(css).not.toMatch(/animation:[^;]*infinite/);
  });
});

describe("Public Home — the owner's review of 2026-10-01", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  /** The body of the first rule with exactly this selector, outside or inside a media block. */
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(rules)?.[1] ?? null;
  };

  describe("the review strip carries no badges", () => {
    it("opens each card with its title: no «V1», «Разбор», «V2» or tick above it", () => {
      const { container } = render(<PublicHomeScreen authenticated={false} />);
      const track = container.querySelector(".evidence-track") as HTMLElement;
      expect(track.querySelector(".evidence__index")).toBeNull();
      for (const card of Array.from(track.querySelectorAll(":scope > li"))) {
        expect(card.firstElementChild?.tagName, "a card starts with its heading").toBe("H3");
      }
      const copy = text(track);
      expect(copy).not.toMatch(/\bV[12]\b/);
      expect(copy).not.toContain("✓");
      expect(rules).not.toContain("evidence__index");
    });

    it("says the order with the strip's own rail: lit as far as the state on show", async () => {
      const { container } = render(<PublicHomeScreen authenticated={false} />);
      const cards = Array.from(container.querySelectorAll(".evidence-track > li")) as HTMLElement[];
      const reached = () => cards.map((card) => card.classList.contains("is-reached"));
      expect(reached()).toEqual([true, false, false, false]);
      await userEvent.click(cards[2]!.querySelector(".evidence__button") as HTMLElement);
      expect(reached()).toEqual([true, true, true, false]);
      expect(cards.map((card) => card.classList.contains("is-active"))).toEqual([false, false, true, false]);
      expect(rule(".ph .review .evidence-track > li.is-reached::before")).toMatch(/background:/);
      expect(rule(".ph .review .evidence-track > li.is-active::before")).toMatch(/var\(--signal-400\)/);
    });
  });

  describe("the route's line never crosses a level's label", () => {
    it("draws both parts of the line in the container's FIRST child, so every node is painted over it", () => {
      // The drawn part used to be `::after` — the last child — and ran through
      // «L1», «L2» and every node the route had passed.
      expect(rules).not.toMatch(/\.route__steps::after/);
      const line = rule(".ph .route__steps::before");
      expect(line, "the route's line rule is missing").not.toBeNull();
      expect(line).toMatch(/var\(--route-drawn/);
      expect(line).toMatch(/var\(--signal-400\)/);
      expect(line).toMatch(/var\(--line-dark\)/);
    });

    it("keeps the nodes opaque, and their labels large enough to be labels", () => {
      const shared = rule(".ph .rstart__node,\n.ph .rstep__node");
      expect(shared).toMatch(/background:\s*var\(--ink-950\)/);
      const sizes = Array.from(rules.matchAll(/\.ph \.(?:rstart|rstep)__node \{([^}]*)\}/g))
        .flatMap((m) => Array.from((m[1] ?? "").matchAll(/font-size:\s*([\d.]+)px/g)).map((f) => Number(f[1])));
      expect(sizes.length).toBeGreaterThanOrEqual(4);
      // 8px in a 26px ring was not a label.
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9.5);
    });
  });

  describe("the cycle stands centred under one line", () => {
    it("centres each step and its object, and fences no column", () => {
      const step = rule(".ph .learning-loop > li");
      expect(step).toMatch(/align-items:\s*center/);
      expect(step).toMatch(/text-align:\s*center/);
      // The vertical rules ran through the nodes and along the objects' edges.
      expect(step).not.toMatch(/border-(right|left)/);
      const object = rule(".ph .cyc");
      expect(object).toMatch(/justify-items:\s*center/);
      expect(object).toMatch(/text-align:\s*center/);
    });

    it("sets the numbers large, on nodes that hide the line behind them", () => {
      const node = rule(".ph .learning-loop > li > span");
      expect(Number(/font-size:\s*([\d.]+)px/.exec(node ?? "")?.[1])).toBeGreaterThanOrEqual(13);
      expect(node).toMatch(/z-index:\s*1/);
      expect(node).toMatch(/background:\s*var\(--ink-950\)/);
      // Node centre to node centre, not edge to edge.
      expect(rules).toMatch(/\.ph \.learning-loop::before \{[^}]*left:\s*calc\(\(100% - 5 \* var\(--loop-gap\)\) \/ 12\)/);
    });

    it("draws the whole line — faint and Signal — in ONE first-child element, so no number is ever crossed", () => {
      // Owner, 2026-10-02: «полоска всё равно перегораживает цифры». Every step
      // carries `data-reveal`, whose resting state keeps a transform on it…
      expect(rule(".ph.has-js [data-reveal].is-visible")).toMatch(/transform:\s*translateY\(0\)/);
      // …so every step is a stacking context, its node's z-index counts only
      // inside it, and anything that FOLLOWS the steps in the tree is painted
      // over them. The line may therefore never be the list's last child:
      expect(rules).not.toMatch(/\.learning-loop(\.is-visible)?::after/);
      // both parts are the first child, the drawn one a background layer over the faint one,
      const line = rule(".ph .learning-loop::before");
      expect(line).toMatch(/linear-gradient\(var\(--signal-400\), var\(--signal-400\)\)[^,;]*0% 100%[^,;]*,\s*var\(--line-dark\)/);
      // and it is drawn by growing that layer — never by a transform, which
      // would make the line a layer of its own.
      expect(line).not.toMatch(/transform/);
      expect(rules).toMatch(/@keyframes ph-line-grow \{\s*from \{\s*background-size:\s*0% 100%;\s*\}\s*to \{\s*background-size:\s*100% 100%;/);
      expect(rule(".ph .learning-loop.is-visible::before")).toMatch(/animation:\s*ph-line-grow 760ms var\(--ease\) 80ms both/);
      // The route's line was fixed the same way on 2026-10-01.
      expect(rules).not.toMatch(/\.route__steps::after/);
    });

    it("goes to three columns at its own step, and to one column without a line through the words", () => {
      const three = /@media \(max-width: 1340px\) \{([\s\S]*?)\n\}/.exec(rules)?.[1] ?? "";
      expect(three).toMatch(/\.ph \.learning-loop \{[^}]*repeat\(3,/);
      expect(three).toMatch(/\.ph \.learning-loop::before \{[^}]*display:\s*none/);
      // On a phone the line used to run down the left edge at 11px, through
      // the first letters of every paragraph.
      expect(rules).not.toMatch(/\.learning-loop::after \{[^}]*left:\s*11px/);
      expect(rules).toMatch(/\.ph \.learning-loop > li:nth-child\(n\)::before \{[^}]*left:\s*50%/);
    });
  });
});

describe("Public Home — the FAQ heading holds its place", () => {
  it("never sticks the heading: it is as tall as the closed list and would jump as answers open", () => {
    // Sticky at 120px had no room until answers opened, then jumped down with
    // every click. The heading scrolls with the page; the surface clips with
    // `clip` so no section is ever a scrollport for a sticky child.
    expect(css).not.toMatch(/\.ph \.faq__heading\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.ph \.faq__heading\s*\{[^}]*position:\s*static/);
    expect(css).toMatch(/\.ph \.faq\.surface\s*\{[^}]*overflow:\s*clip/);
  });
});

describe("Public Home — no way to the news", () => {
  it("links no news page: the news are product content for signed-in learners (DD-326)", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((href) => href === "/news" || href.startsWith("/news/") || href.startsWith("/news?"))).toEqual([]);
  });
});

describe("Public Home — the owner's review of 2026-10-02", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(rules)?.[1] ?? null;
  };

  describe("a line is behind what it connects — everywhere on the page", () => {
    /*
     * The same defect was found three times: in the route (2026-10-01), in the
     * cycle (2026-10-02, by the owner) and in the product window's path
     * (2026-10-02, by a hit-test sweep of the whole page). Each time the drawn
     * part of a line was its holder's LAST child, and each node of the holder
     * keeps a transform at rest — a stacking context — so the last child was
     * painted over every node. The rule is therefore held for every holder of
     * nodes on the page, not for the one last complained about.
     */
    it("draws no line as the last child of anything that holds nodes", () => {
      for (const holder of ["route__steps", "learning-loop", "pw-path__nodes", "cyc__path", "trail"]) {
        expect(rules, holder).toMatch(new RegExp(`\\.${holder}::before \\{`));
        expect(rules, holder).not.toMatch(new RegExp(`\\.${holder}(\\.[\\w-]+)*::after`));
      }
    });

    it("draws the walked part of the window's path as a layer of its first child", () => {
      const line = rule(".ph .pw-path__nodes::before");
      // Faint from the first node to the fifth; Signal over three quarters of it — to the fourth, the current one
      // (level 4 of the program, 2026-10-04).
      expect(line).toMatch(
        /linear-gradient\(var\(--pw-signal-700\), var\(--pw-signal-700\)\) left center \/ 75% 100% no-repeat,\s*var\(--pw-line-2\)/,
      );
      expect(line).toMatch(/animation:\s*pw-line-draw 600ms var\(--ease\) 200ms both/);
      // Grown by its size — a transform would make the line a layer of its own.
      expect(line).not.toMatch(/transform/);
      expect(rules).toMatch(/@keyframes pw-line-draw \{\s*from \{\s*background-size:\s*0% 100%;\s*\}\s*\}/);
      // Why the order matters: a node keeps the last frame of its entrance, and that frame has a transform.
      expect(rule(".ph .pw-node")).toMatch(/animation:\s*pw-in 320ms var\(--ease\) both/);
      expect(rules).toMatch(/@keyframes pw-in \{[\s\S]*?to \{[^}]*transform:\s*translateY\(0\)/);
    });
  });

  describe("the strip's cards say they can be pressed", () => {
    it("lights a card from its rail down, under its words and never over them", () => {
      const card = rule(".ph .review .evidence-track > li");
      expect(card).toMatch(/isolation:\s*isolate/);
      expect(card).toMatch(/cursor:\s*pointer/);
      const light = rule(".ph .review .evidence-track > li::after");
      expect(light).toMatch(/z-index:\s*-1/);
      expect(light).toMatch(/linear-gradient\(\s*180deg,\s*rgba\(199, 247, 109, 0\.17\) 0,[\s\S]*rgba\(199, 247, 109, 0\) 140px\s*\)/);
      // A hairline of the same light, so the lit card has an edge, not only a glow.
      expect(light).toMatch(/box-shadow:\s*inset 0 0 0 1px rgba\(199, 247, 109, 0\.2\)/);
      expect(light).toMatch(/opacity:\s*0;/);
      // The light never takes a press meant for the card.
      expect(light).toMatch(/pointer-events:\s*none/);
    });

    it("keeps the card on show lit, and lights the others under the pointer, the focus and a press", () => {
      expect(rule(".ph .review .evidence-track > li.is-active::after")).toMatch(/opacity:\s*1/);
      expect(rule(".ph .review .evidence-track > li:focus-within::after")).toMatch(/opacity:\s*0\.8/);
      // Hover only where there is a pointer to hover with: on a touch screen it
      // would stick to the last card that was tapped.
      const hover = /@media \(hover: hover\) \{([\s\S]*?)\n\}/.exec(rules)?.[1] ?? "";
      expect(hover).toMatch(/\.ph \.review \.evidence-track > li:hover::after \{[^}]*opacity:\s*0\.8/);
      expect(hover).toMatch(/\.ph \.review \.evidence-track > li:hover:not\(\.is-active\)::before \{[^}]*rgba\(199, 247, 109, 0\.78\)/);
      expect(rules.replace(hover, "")).not.toMatch(/evidence-track > li:hover::after/);
      expect(rules).toMatch(/\.ph \.review \.evidence-track > li:active::after \{[^}]*opacity:\s*1/);
      // The rail of the card on show glows; the others' rails only brighten.
      expect(rule(".ph .review .evidence-track > li.is-active::before")).toMatch(/box-shadow:\s*0 0 14px rgba\(199, 247, 109, 0\.55\)/);
    });

    it("has no dead middle: the object inside a card is pressed like the rest of it", () => {
      // It used to carry the reading pointer and to swallow the press.
      expect(rules).not.toMatch(/\.ph \.review \.evidence__object \{[^}]*cursor:\s*auto/);
      expect(rules).not.toMatch(/:has\(\.evidence__object:hover\)/);
    });

    it("hints once, on the three cards not on show, inside the page's motion limits", () => {
      expect(rule(".ph .review .evidence-track[data-hint] > li:not(.is-active)::after")).toMatch(
        /animation:\s*ph-card-hint 420ms var\(--ease\) both/,
      );
      // The rail flashes with the light, in the same order.
      expect(rule(".ph .review .evidence-track[data-hint] > li:not(.is-active)::before")).toMatch(
        /animation:\s*ph-rail-hint 420ms var\(--ease\) both/,
      );
      for (const pseudo of ["after", "before"]) {
        const delays = Array.from(
          rules.matchAll(new RegExp(`evidence-track\\[data-hint\\] > li:nth-child\\(\\d\\)::${pseudo} \\{ animation-delay: (\\d+)ms; \\}`, "g")),
        ).map((m) => Number(m[1]));
        expect(delays, pseudo).toEqual([120, 240, 360]);
      }
      // It begins and ends dark: nothing stays lit that is not on show.
      const frames = /@keyframes ph-card-hint \{([\s\S]*?)\n\}/.exec(rules)?.[1] ?? "";
      expect(frames).toMatch(/0% \{\s*opacity:\s*0;/);
      expect(frames).toMatch(/100% \{\s*opacity:\s*0;/);
    });
  });
});

describe("Public Home — the phone composition (DD-342)", () => {
  /*
   * Owner, 2026-10-03: «мобильная версия внешней главной мне не нравится…
   * такая не понятная получается». Measured: 21.5 screens at 390px, the six
   * tool windows alone almost five. Up to 920px the tools are one deck under
   * the rail of the levels they open on; up to 680px the cycle is a spine
   * without its objects and the headings are two or three lines.
   */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  /** Every block of a media query with exactly this prelude, joined. */
  const media = (prelude: string) =>
    Array.from(rules.matchAll(new RegExp(`@media \\(${prelude}\\) \\{([\\s\\S]*?)\\n\\}`, "g")))
      .map((m) => m[1] ?? "")
      .join("\n");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountDeck() {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("920"), media: query }));
    const scrollTo = vi.fn();
    // jsdom lays nothing out; the deck is asked to scroll, and that is what is checked.
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true, writable: true });
    const view = render(<PublicHomeScreen authenticated={false} />);
    const rail = view.container.querySelector(".tdeck__rail") as HTMLElement;
    const buttons = Array.from(rail.querySelectorAll(".trail__button")) as HTMLButtonElement[];
    const deck = view.container.querySelector("[data-tdeck]") as HTMLElement;
    return { ...view, rail, buttons, deck, scrollTo };
  }

  it("names the six tools on the rail in the order they open, from the catalogue", () => {
    const { buttons, rail } = mountDeck();
    const built = TOOL_WINDOWS.filter((tool) => tool.built).sort((a, b) => PROGRAM_TOOL_LEVEL[a.slug] - PROGRAM_TOOL_LEVEL[b.slug]);
    expect(buttons.map((b) => b.textContent)).toEqual(built.map((tool) => `L${PROGRAM_TOOL_LEVEL[tool.slug]}`));
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(
      built.map((tool) => `${tool.title}, открывается на уровне ${PROGRAM_TOOL_LEVEL[tool.slug]}`),
    );
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false", "false"]);
    expect(rail.querySelector(".trail__note")?.textContent?.replace(/\s+/g, " ")).toContain(
      `${built[0]!.title} — открывается на уровне ${PROGRAM_TOOL_LEVEL[built[0]!.slug]}`,
    );
  });

  it("controls the deck's cards: every rail button points at a card of the deck", () => {
    const { buttons, deck } = mountDeck();
    const cards = Array.from(deck.children).map((card) => card.id);
    expect(buttons.map((b) => b.getAttribute("aria-controls"))).toEqual(cards);
    expect(deck.querySelector(":scope > .is-shown")?.id).toBe(cards[0]);
  });

  it("a press on the rail brings that card, lights the rail up to it and names it", () => {
    const { buttons, rail, deck, scrollTo } = mountDeck();
    fireEvent.click(buttons[2]!);
    expect(scrollTo).toHaveBeenCalled();
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false", "false", "false"]);
    const steps = Array.from(rail.querySelectorAll(".trail__step"));
    expect(steps.map((li) => li.classList.contains("is-reached"))).toEqual([true, true, true, false, false, false]);
    expect((rail.querySelector(".trail") as HTMLElement).style.getPropertyValue("--tr-at")).toBe("2");
    expect(rail.querySelector(".trail__note")?.textContent).toContain("3 / 6");
    expect(deck.querySelector(":scope > .is-shown")?.id).toBe(buttons[2]!.getAttribute("aria-controls"));
  });

  /* 2026-10-07, the owner: «Баг во время переключения название инструмента
     пропадает и появляется … кружки с номером уровня нужно подсветить … было
     понятно … что можно выбрать уровень и посмотреть превью». */
  it("says what the rail is for, above it", () => {
    const { rail } = mountDeck();
    const hint = rail.querySelector(".trail__hint");
    expect(hint?.textContent).toBe("Нажмите на уровень, чтобы посмотреть превью инструмента");
    expect(rail.firstElementChild).toBe(hint);
  });

  it("names a tool once — at the press, and when the deck comes to rest — never every card it slides past", () => {
    vi.useFakeTimers();
    try {
      const { buttons, rail, deck } = mountDeck();
      const cards = Array.from(deck.children) as HTMLElement[];
      // Lay the deck out with the card `at` at its start.
      const layOut = (at: number) =>
        cards.forEach((card, index) => {
          card.getBoundingClientRect = () => ({ left: (index - at) * 300, top: 0, right: (index - at) * 300 + 280, bottom: 500, width: 280, height: 500, x: (index - at) * 300, y: 0, toJSON() {} }) as DOMRect;
        });
      const note = () => rail.querySelector(".trail__note strong")?.textContent;
      // The tool each rail button names, in rail order.
      const TOOL_STEPS_NAMES = () => buttons.map((b) => (b.getAttribute("aria-label") ?? "").split(",")[0]);

      layOut(0);
      fireEvent.click(buttons[4]!);
      expect(note()).toBe(TOOL_STEPS_NAMES()[4]);
      // The glide passes the cards between: the rail keeps the pressed tool.
      for (const at of [1, 2, 3]) {
        layOut(at);
        fireEvent.scroll(deck);
        vi.advanceTimersByTime(16);
        expect(note()).toBe(TOOL_STEPS_NAMES()[4]);
      }
      layOut(4);
      fireEvent.scroll(deck);
      vi.advanceTimersByTime(200);
      expect(note()).toBe(TOOL_STEPS_NAMES()[4]);

      // A swipe back to the second card: named when the deck comes to rest.
      layOut(2);
      fireEvent.scroll(deck);
      vi.advanceTimersByTime(60);
      expect(note()).toBe(TOOL_STEPS_NAMES()[4]);
      layOut(1);
      fireEvent(deck, new Event("scrollend"));
      expect(note()).toBe(TOOL_STEPS_NAMES()[1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws every level as a button: a lit ring, a glow, and a press that pushes it in", () => {
    const narrow = media("max-width: 920px");
    expect(narrow).toMatch(/\.ph \.trail__num \{[^}]*border: 1\.5px solid rgba\(199, 247, 109, 0\.5\)[^}]*box-shadow: 0 0 14px/);
    expect(narrow).toMatch(/\.ph \.trail__button:active \.trail__num \{\s*transform: scale\(0\.93\);/);
    expect(narrow).toMatch(/\.ph \.trail__hint \{[^}]*display: flex/);
  });

  it("a tool's title in the deck brings its card sideways and leaves the page where it is", () => {
    const { deck, buttons, scrollTo } = mountDeck();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scrollIntoView, configurable: true, writable: true });
    fireEvent.click(deck.querySelectorAll(".rstep__button")[4]!);
    expect(scrollTo).toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(buttons[4]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("is the deck only up to 920px: wide screens keep the route and the pinned window", () => {
    expect(rules).toMatch(/\n\.ph \.tdeck__rail \{\s*display:\s*none;\s*\}/);
    const narrow = media("max-width: 920px");
    expect(narrow).toMatch(/\.ph \.tdeck__rail \{[^}]*display:\s*block/);
    expect(narrow).toMatch(/\.ph \.route__list--tools \{[^}]*display:\s*flex[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x mandatory/);
    expect(narrow).toMatch(/\.ph \.route__list--tools > \.rstep \{[^}]*scroll-snap-align:\s*start/);
    // The route's line ends above the deck: the tools lie over it.
    expect(narrow).toMatch(/\.ph \.route__segment--tools \{[^}]*z-index:\s*1[^}]*background:\s*var\(--ink-950\)/);
    // Its nodes are 44px targets.
    expect(narrow).toMatch(/\.ph \.trail__button \{[^}]*min-height:\s*44px/);
  });

  it("says the card's one word on every width, to the eye only (DD-367)", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const captions = Array.from(container.querySelectorAll(".reframe__caption"));
    expect(captions.map((c) => text(c as HTMLElement).trim())).toEqual(["Ваше основание — в инструменте ATA"]);
    for (const caption of captions) expect(caption).toHaveAttribute("aria-hidden", "true");
    expect(rules).toMatch(/\n\.ph \.reframe__caption \{\s*display:\s*block;/);
    // The six replies that stood before the card are gone (owner, 2026-10-08: «это давай уберем»).
    expect(container.querySelector("#decide .source-cloud")).toBeNull();
    expect(container.querySelector("#decide .reframe__axis")).toBeNull();
    expect(text(container)).not.toContain("Чужие ответы");
    expect(rules).not.toContain("source-cloud");
  });

  it("makes the cycle a spine on a phone: the objects go, the line runs behind the nodes", () => {
    const phone = media("max-width: 680px");
    expect(phone).toMatch(/\.ph \.learning-loop \.cyc \{\s*display:\s*none;\s*\}/);
    expect(phone).toMatch(/\.ph \.learning-loop > li > span \{[^}]*left:\s*0/);
    // Wide screens keep the six objects: outside the phone blocks nothing hides them.
    const outside = Array.from(rules.matchAll(/@media \(max-width: 680px\) \{[\s\S]*?\n\}/g)).reduce(
      (rest, block) => rest.replace(block[0], ""),
      rules,
    );
    expect(outside).not.toMatch(/\.learning-loop \.cyc \{\s*display:\s*none/);
  });

  it("keeps a phone heading to a few lines: section headings at most 36px", () => {
    const phone = media("max-width: 680px");
    const heading = /\.ph \.display--section,\s*\.ph \.route__title \{([^}]*)\}/.exec(phone)?.[1] ?? "";
    expect(heading).toMatch(/font-size:\s*clamp\(24px, 7\.8vw, 36px\)/);
    expect(phone).toMatch(/\.ph \.final-step__title \{[^}]*font-size:\s*clamp\(25px, 7\.4vw, 32px\)/);
  });
});


/* 2026-10-07, the owner, after a blur behind the header was tried and taken back:
   «на компьютерной версии вообще откати до того как было, а на мобильной убери
   размытие и оставь так как было просто без перехода из белого в черный пусть
   она просто висит». */
describe("the header while the page scrolls", () => {
  const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("on a computer tightens past the first scroll exactly as it did before the blur", () => {
    expect(css).toMatch(
      /\n\.ph \.site-header\.is-compact \.site-header__inner \{\s*min-height: 56px;\s*padding-top: 5px;\s*padding-bottom: 5px;\s*background: rgba\(11, 13, 10, 0\.96\);\s*box-shadow: var\(--shadow-low\);\s*\}/,
    );
    expect(css).toMatch(/\n\.ph \.site-header\.is-compact \.wordmark \{\s*width: 62px;\s*\}/);
  });

  it("on a phone and a tablet keeps the size and the material it has at the top", () => {
    // The pill at the top of the page: 66px, 9px above and below, 0.91 and the high shadow, a 72px
    // wordmark; on a phone 56px, 7px and a 56px wordmark. The compact state restates exactly these.
    expect(css).toMatch(
      /\n\.ph \.site-header__inner \{[^}]*min-height: 66px;[^}]*padding: 9px 14px 9px 22px;[^}]*background: rgba\(11, 13, 10, 0\.91\);\s*box-shadow: var\(--shadow-high\);/,
    );
    expect(css).toMatch(/\n\.ph \.wordmark \{[^}]*width: 72px;/);
    expect(css).toMatch(
      /@media \(max-width: 680px\) \{[^@]*\.ph \.site-header__inner \{[^}]*min-height: 56px;\s*padding: 7px 9px 7px 14px;[^}]*\}\s*\.ph \.wordmark \{\s*width: 56px;\s*\}/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1040px\) \{\s*\.ph \.site-header\.is-compact \.site-header__inner \{\s*min-height: 66px;\s*padding-top: 9px;\s*padding-bottom: 9px;\s*background: rgba\(11, 13, 10, 0\.91\);\s*box-shadow: var\(--shadow-high\);\s*\}\s*\.ph \.site-header\.is-compact \.wordmark \{\s*width: 72px;\s*\}\s*\}/,
    );
    expect(css).toMatch(
      /@media \(max-width: 680px\) \{\s*\.ph \.site-header\.is-compact \.site-header__inner \{\s*min-height: 56px;\s*padding-top: 7px;\s*padding-bottom: 7px;\s*\}\s*\.ph \.site-header\.is-compact \.wordmark \{\s*width: 56px;\s*\}\s*\}/,
    );
  });

  it("never moves the header itself, puts a band of the light ground around it or blurs what is behind it", () => {
    expect(css).not.toMatch(/\.site-header\.is-compact \{/);
    expect(css).not.toMatch(/\.site-header::before/);
    expect(css).not.toMatch(/--ph-shade/);
  });
});

/* DD-360 (2026-10-07), the owner: «на внешней главной нужно избавиться от эффекта блоков на
   белом фоне, возможно заменить на наш салатовый, вообщем нужен финальный хай фай в этой
   области». The page is one sheet laid over another: no light ground, no gaps. */
describe("Public Home — one sheet over another (DD-360)", () => {
  const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("has no light ground: the root and the document behind it are Ink", () => {
    expect(css).toMatch(/\n\.ph\[data-ph-root\] \{[^}]*background: var\(--ink-950\);/);
    expect(css).toMatch(/\nhtml\.ph-smooth-scroll \{\s*background: #0b0d0a;\s*\}/);
    // The old ground is not painted by the smooth-scroll rule any more.
    expect(css).not.toMatch(/html\.ph-smooth-scroll \{[^}]*mist-200/);
  });

  it("lays every sheet over the one before it, edge to edge, with a rounded lip the width of the page", () => {
    expect(css).toMatch(/\n\.ph\[data-ph-root\] \.surface \{\s*margin: 0;\s*border-bottom: var\(--sheet-lip\) solid transparent;\s*border-radius: 0;\s*\}/);
    expect(css).toMatch(
      /\n\.ph\[data-ph-root\] \.surface \+ \.surface,\s*\.ph\[data-ph-root\] \.site-footer \{\s*margin-top: calc\(-1 \* var\(--sheet-lip\)\);\s*border-radius: var\(--sheet-lip\) var\(--sheet-lip\) 0 0;\s*\}/,
    );
    // The lip is the page's largest radius; on a phone the surfaces' 22px.
    expect(css).toMatch(/\n\.ph\[data-ph-root\] \{\s*--sheet-lip: var\(--radius-xl\);/);
    expect(css).toMatch(/@media \(max-width: 680px\) \{\s*\.ph\[data-ph-root\] \{\s*--sheet-lip: 22px;\s*\}\s*\}/);
    // The footer is a sheet too: no margin of its own around it.
    expect(css).toMatch(/\n\.ph\[data-ph-root\] \.site-footer \{\s*position: relative;\s*margin-right: 0;\s*margin-bottom: 0;\s*margin-left: 0;\s*\}/);
  });

  it("leaves the news pages, which are paper on purpose, exactly as they are", () => {
    // Every sheet rule is scoped to the Public Home root; the shared `.ph .surface` keeps its margin.
    expect(css).toMatch(/\n\.ph \.surface \{\s*position: relative;\s*margin: 10px;/);
    expect(css).toMatch(/\n\.ph \.surface--paper \{\s*background: var\(--paper-100\);/);
    const sheetRules = css.match(/^[^@{}\n]*--sheet-lip[^{}]*\{|^[^{}\n]*\.surface \+ \.surface[^{]*\{/gm) ?? [];
    for (const rule of sheetRules) expect(rule, rule).toContain("[data-ph-root]");
  });

  it("puts the fine print on Ink and the first step on Signal, the page's last word before the footer", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const faq = container.querySelector("#faq") as HTMLElement;
    expect(faq.classList.contains("surface--ink")).toBe(true);
    expect(faq.classList.contains("surface--paper")).toBe(false);
    expect(container.querySelector(".surface--paper")).toBeNull();
    const first = container.querySelector("#first-step") as HTMLElement;
    expect(first.classList.contains("surface--signal")).toBe(true);
    expect(first.previousElementSibling).toBe(faq);
    expect(first.nextElementSibling).toBeNull();
    // The legacy #start alias lives in the new sheet, right before the step.
    expect(container.querySelector("#start")?.closest("section")?.id).toBe("first-step");
    expect(first.querySelector(".final-step .button--dark")).toBeTruthy();
    // The FAQ's text is the dark surface's: no light-surface eyebrow left in it.
    expect(faq.querySelector(".eyebrow--dark")).toBeNull();
  });

  it("colours the FAQ list and the first step for the surfaces they stand on", () => {
    expect(css).toMatch(/\n\.ph \.faq-list \{\s*border-top: 1px solid var\(--line-dark\);/);
    expect(css).toMatch(/\n\.ph \.faq-list details \{\s*border-bottom: 1px solid var\(--line-dark\);/);
    expect(css).toMatch(/\.ph \.faq-list summary::after \{[^}]*background: var\(--text-on-dark\);/);
    expect(css).not.toMatch(/\.ph \.faq-list details p \{[^}]*color: var\(--text-primary\)/);
    expect(css).toMatch(/\n\.ph \.first-step \{\s*padding: var\(--section-pad\) 0;\s*\}/);
    expect(css).not.toMatch(/\.ph \.final-step \{[^}]*border-top/);
    expect(css).toMatch(/\.ph \.surface--signal \.client-entry \{[^}]*color: rgba\(11, 13, 10, 0\.66\);/);
    expect(css).toMatch(/\n\.ph \.final-step__support \{[^}]*color: rgba\(11, 13, 10, 0\.66\);/);
  });
});

/* The owner, 2026-10-07 (a screenshot of the journal's example): «в этом блоке и в целом в примерах
   активы должны быть обычные а не OTC». The examples name the ordinary assets. */
describe("Public Home — the examples name ordinary assets, not OTC", () => {
  it("shows no OTC asset in any window of the page", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    expect(text(container)).not.toMatch(/\bOTC\b/);
    expect(text(container)).toContain("EUR/USD");
    expect(text(container)).toContain("GBP/USD");
  });

  it("keeps no OTC asset in the windows' data either", () => {
    for (const file of ["review-window.tsx", "product-window-states.tsx", "decision-window.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src/features/public-home", file), "utf8");
      expect(source, file).not.toMatch(/\bOTC\b/);
    }
  });
});

/* The owner, 2026-10-07: «в инструменте Entry Checklist нужно не 9 а 7 условий … и так же не
   забудь поменять его на внешней главной примере». */
describe("Public Home — the Entry Checklist example is the tool's own seven conditions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the seven, in three groups, with no stop factor, and counts 7 / 7", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: vi.fn(), configurable: true, writable: true });
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const rail = container.querySelector("#tools") as HTMLElement;
    expect(text(rail)).toContain("Семь условий до входа.");
    expect(text(rail)).not.toContain("Девять");
    expect(text(rail)).not.toMatch(/стоп-фактор/i);
    // The checklist window is the state the rail shows for L13.
    await userEvent.click(within(rail).getByRole("button", { name: /^Entry Checklist, открывается на уровне/ }));
    const window = rail.querySelector(".pw-check") as HTMLElement;
    expect(window).not.toBeNull();
    const items = Array.from(window.querySelectorAll(".pw-check__item span")).map((el) => el.textContent);
    expect(items).toEqual([
      "Актив из моего списка",
      "Время — подходящий период",
      "Payout посмотрел, планку посчитал — 85 %",
      "Состояние определено: тренд, боковик или неясно",
      "Область названа",
      "Размер по плану",
      "Основание сформулировано словами",
    ]);
    expect(Array.from(window.querySelectorAll(".pw-check__group > .pw-mono")).map((el) => el.textContent)).toEqual(["Среда", "График", "Сделка"]);
    expect(text(window)).toContain("7 / 7");
    expect(text(window)).toContain("среда, график и сделка");
    expect(window.querySelector(".pw-check__item em")).toBeNull();
  });
});

/* DD-364 (2026-10-08), the owner: «тут меняем на АТА - инновационная платформа обучения
   трейдингу». The headline's longest word is long, and beside the film its column is narrow. */
describe("Public Home — the headline names the platform and fits every width (DD-364)", () => {
  const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("is set smaller only beside the film, so it reads in three lines there", () => {
    // Base (wider than 1180, beside the film): at most 63px, «ATA — инновационная» on one line.
    expect(css).toMatch(/\n\.ph \.display--hero \{\s*max-width: 760px;\s*font-size: clamp\(52px, 4\.4vw, 63px\);\s*\}/);
    // Up to 1180 the headline has the whole row and keeps its old size.
    const wholeRow = css.search(/@media \(max-width: 1180px\) \{[^@]*?\.ph \.display--hero \{\s*font-size: clamp\(56px, 5\.4vw, 82px\);\s*\}/);
    const phone = css.search(/\.ph \.display--hero \{\s*font-size: clamp\(44px, 14vw, 64px\);/);
    const narrowPhone = css.search(/@media \(max-width: 359px\) \{\s*\.ph \.display--hero \{\s*font-size: 13\.2vw;\s*\}\s*\}/);
    expect(wholeRow, "the 1180 rule restoring the old size").toBeGreaterThan(-1);
    expect(phone, "the phone rule").toBeGreaterThan(-1);
    expect(narrowPhone, "the 359 rule keeping «инновационная» inside a 320px phone's gutter").toBeGreaterThan(-1);
    // Same specificity everywhere, so the narrower rule must come later in the file.
    expect(wholeRow).toBeLessThan(phone);
    expect(phone).toBeLessThan(narrowPhone);
  });

  it("does not leave the line under it ending on a lone word", () => {
    expect(css).toMatch(/\n\.ph \.hero__definition \{[^}]*text-wrap: pretty;/);
  });
});

/* DD-365 (2026-10-08), the owner, on the facts rail under the first screen: «L4 и L9 визуально
   меняем и говорим вместо L4 - первая проверка знаний ждет вас уже на 4 уровне, вместо L9 -
   Практика начинается уже с 9 урока». Set as sentences in their own type (15px, primary, the
   level lit inline) they «stood out and did not stack with the other cells of the block» — so
   every cell is the rail's own two tiers: a lit figure and a muted caption that continues it. */
describe("Public Home — the facts rail: four cells of one kind (DD-365, words DD-368)", () => {
  const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("gives every cell a lit figure and a caption, the levels as plain numbers", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const rail = container.querySelector(".hero__facts") as HTMLElement;
    const cells = Array.from(rail.children) as HTMLElement[];
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.className).toBe("");
      expect(Array.from(cell.children).map((child) => child.tagName)).toEqual(["STRONG", "SPAN"]);
    }
    // DD-368 (owner, 2026-10-08): the last two are «1 финальный экзамен» and
    // «20 домашних заданий с индивидуальным фидбеком».
    expect(cells.map((cell) => text(cell.querySelector("strong") as HTMLElement))).toEqual(["20", "100", "1", "20"]);
    expect(cells.map((cell) => text(cell.querySelector("span") as HTMLElement))).toEqual([
      "модулей",
      "последовательных уровней",
      "финальный экзамен",
      "домашних заданий с индивидуальным фидбеком",
    ]);
    expect(text(rail)).not.toMatch(/\bL4\b|\bL9\b/);
  });

  it("styles no cell apart from the others", () => {
    expect(css).not.toContain("fact-line");
    expect(css).toMatch(/\n\.ph \.hero__facts span \{[^}]*text-wrap: pretty;/);
  });
});

/* DD-366 (2026-10-08), the owner, on #decide: «этому блоку нужен очень сильный хай фай, нужно
   связать между собой логически так, чтобы человеку было понятно, что чтобы зарабатывать, ему
   нужно самому разбираться, как правильно торговать, и что инструментом, который показан, мы
   помогаем делать это и даём ему этот инструмент». */
describe("Public Home — #decide says its chain in words and ends in the tool (DD-366)", () => {
  const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("opens on the stake and climbs three rungs to the tool", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const section = container.querySelector("#decide") as HTMLElement;
    expect(text(section.querySelector("h2") as HTMLElement).trim()).toBe(
      "Чтобы зарабатывать, нужно самому понимать, как торговать.",
    );
    const rungs = Array.from(section.querySelectorAll(".ladder > li")) as HTMLElement[];
    expect(rungs.map((rung) => text(rung.querySelector("h3") as HTMLElement).trim())).toEqual([
      "Чужой ответ — не ваше понимание.",
      "Правильно торговать — значит входить по основанию.",
      "Для этого ATA даёт инструмент.",
    ]);
    expect(text(rungs[2] as HTMLElement)).toContain("Trade Card открывается на уровне 5");
    // The ladder stands where the lead stood; the section has no lead now.
    expect(section.querySelector(".section-intro .lead")).toBeNull();
    // Nothing promises a result: the words are about understanding and responsibility.
    expect(text(section)).not.toMatch(/гарант|доход|прибыл|\$|%\s*в месяц/i);
  });

  it("says under the card that the tool is the learner's, and offers the one action", () => {
    const guest = render(<PublicHomeScreen authenticated={false} />).container;
    const statement = guest.querySelector("#decide .decision__statement") as HTMLElement;
    expect(text(statement)).toContain("Этот инструмент вы получаете в ATA");
    const action = guest.querySelector("#decide .decision__action") as HTMLAnchorElement;
    expect(action).not.toBeNull();
    expect(action.getAttribute("href")).toBe("/register");
    expect(text(action).trim()).toBe("Начать путь");
  });

  it("sends a member to the Academy from the same line", () => {
    const { container } = render(<PublicHomeScreen authenticated={true} />);
    const action = container.querySelector("#decide .decision__action") as HTMLAnchorElement;
    expect(action).not.toBeNull();
    expect(action.getAttribute("href")).toBe("/home");
    expect(text(action).trim()).toBe("Перейти в Академию");
  });

  it("stands the rungs on the page's spine: numbered Ink discs on one line, the tool's chip on the last (DD-367)", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const ladder = container.querySelector("#decide .ladder") as HTMLElement;
    expect(ladder.tagName).toBe("OL");
    // The node is the cycle's: an Ink disc, the number in Signal mono, drawn by CSS from the order.
    expect(css).toMatch(/\n\.ph \.ladder > li::before \{[^}]*border: 1\.5px solid var\(--signal-400\);[^}]*background: var\(--ink-950\);\s*color: var\(--signal-400\);\s*font-family: var\(--font-data\);[^}]*content: "0" counter\(rung\);/);
    expect(css).toMatch(/\n\.ph \.ladder > li::after \{[^}]*width: 1px;\s*background: rgba\(11, 13, 10, 0\.32\);/);
    expect(css).toMatch(/\n\.ph \.section-intro\.is-visible \.ladder > li \{\s*animation: ph-reply-in-down 420ms var\(--ease\) both;/);
    // The last rung carries the tool's chip, which leads to the deck where Trade Card is L5.
    const chips = Array.from(ladder.querySelectorAll(".ladder__chip")) as HTMLAnchorElement[];
    expect(chips).toHaveLength(1);
    expect(chips[0]!.closest("li")).toBe(ladder.lastElementChild);
    expect(text(chips[0]!).trim()).toBe("Trade Card · уровень 5");
    expect(chips[0]!.getAttribute("href")).toBe("#tools");
    expect(css).toMatch(/\n\.ph \.ladder__chip \{[^}]*background: var\(--ink-950\);\s*color: var\(--signal-400\);\s*font-family: var\(--font-data\);/);
  });

  it("keeps the window's demonstration badge legible on the lime section", () => {
    // The Signal-surface badge colours are Ink; in a product window the bar is dark.
    expect(css).toMatch(/\n\.ph \.surface--signal \.pw \.demo-badge,\s*\.ph \.surface--signal-deep \.pw \.demo-badge \{\s*border-color: var\(--line-dark\);\s*color: var\(--text-on-dark-muted\);/);
  });

  it("offers the action as the page's own dark pill, not a bare line", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const action = container.querySelector("#decide .decision__action") as HTMLAnchorElement;
    expect(action.classList.contains("button")).toBe(true);
    expect(action.classList.contains("button--dark")).toBe(true);
    expect(action.querySelector("svg")).not.toBeNull();
    // Its own rule places it and moves the arrow; the pill's text and shape come from `.button`.
    expect(css).not.toMatch(/\n\.ph \.decision__action \{[^}]*(color|font-size|text-decoration):/);
  });
});

/* DD-369 (2026-10-08), the owner, on #review: the lead is their sentence; «нужно, чтобы интуитивно
   было понятно, что кнопки снизу нужно нажимать … добавить подсветку, которая будет аккуратно идти
   слева направо»; «в конце сделать хай-фай продакшн всего блока». */
describe("Public Home — #review says its strip is a control (DD-369)", () => {
  const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("opens with the owner's sentence and keeps the qualifier in the label", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const review = container.querySelector("#review") as HTMLElement;
    expect(text(review.querySelector(".lead") as HTMLElement).trim()).toBe(
      "Каждый ученик ATA проходит полный цикл обучения с персональным фидбеком на каждом этапе.",
    );
    expect(text(review.querySelector(".eyebrow") as HTMLElement)).toContain("на предусмотренных уровнях");
    expect(text(review)).not.toContain("разбор человеком");
  });

  it("tells the visitor to press a stage, right above the strip, and only where the strip is", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const hint = container.querySelector("#review .evidence__hint") as HTMLElement;
    expect(text(hint).trim()).toBe("Нажмите на этап, чтобы увидеть его в окне");
    expect(hint.nextElementSibling?.classList.contains("evidence-track")).toBe(true);
    // The deck's hint language: a Signal dot before the line.
    expect(css).toMatch(/\n\.ph \.evidence__hint::before \{[^}]*background: var\(--signal-400\);/);
    // A narrow screen has the stepper instead: the hint goes with the strip.
    expect(css).toMatch(/@media \(max-width: 1040px\) \{[^@]*\.ph \.review \.evidence-track,\s*\.ph \.evidence__hint \{\s*display: none;/);
  });

  it("numbers the four cards in the stepper's mono, lit as far as the state on show, without touching their words", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const titles = Array.from(container.querySelectorAll("#review .evidence-track h3")).map((h) => text(h as HTMLElement));
    expect(titles).toEqual(["Работа отправлена", "Получен разбор", "Замечание исправлено", "Работа принята"]);
    expect(css).toMatch(/\n\.ph \.review \.evidence-track \{[^}]*counter-reset: stage;/);
    expect(css).toMatch(/\n\.ph \.review \.evidence-track > li \{[^}]*counter-increment: stage;/);
    expect(css).toMatch(/\n\.ph \.review \.evidence-track h3::before \{[^}]*font-family: var\(--font-data\);[^}]*content: "0" counter\(stage\);/);
    expect(css).toMatch(/\n\.ph \.review \.evidence-track > li\.is-active h3::before \{\s*color: var\(--signal-400\);/);
  });

  it("passes a band of light over the strip from left to right, once, inside the page's motion budget", () => {
    expect(css).toMatch(/\n\.ph \.review \.evidence-track \{[^}]*position: relative;/);
    const band = /\n\.ph \.review \.evidence-track::after \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(band).toMatch(/pointer-events: none;/);
    expect(band).toMatch(/opacity: 0;/);
    expect(band).toMatch(/linear-gradient\(90deg/);
    expect(css).toMatch(/\n\.ph \.review \.evidence-track\.is-visible::after \{\s*animation: ph-sweep 900ms var\(--ease\) 150ms both;/);
    const frames = /@keyframes ph-sweep \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(frames).toMatch(/0% \{\s*transform: translateX\(-110%\);\s*opacity: 0;/);
    expect(frames).toMatch(/100% \{\s*transform: translateX\(330%\);\s*opacity: 0;/);
  });
});

/* DD-370 (2026-10-08), the owner, on #product: «Не витрина контента. Последовательная работа.» →
   «ATA обучает последовательной работе»; «в первых 5 кружках меняем L1, L2, L3, L4 на точки, как в
   самом первом пункте, только точки должны немного увеличиваться от 1 до 5 пункта». */
describe("Public Home — the route opens on five growing dots (DD-370)", () => {
  const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("says what ATA teaches in the route's heading", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const title = container.querySelector("#product .route__title") as HTMLElement;
    expect(text(title).trim()).toBe("ATA обучает последовательной работе.");
    expect(text(container)).not.toContain("Не витрина контента");
  });

  it("writes no code in the first four nodes or the level-4 node, and keeps the tools' codes", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const first = Array.from(container.querySelectorAll("#product .route__start .rstart__node")) as HTMLElement[];
    expect(first).toHaveLength(4);
    for (const node of first) expect(text(node).trim()).toBe("");
    const home = container.querySelector("#product #route-step-home .rstep__node, #product [data-route-step=\"home\"] .rstep__node") as HTMLElement;
    expect(home).not.toBeNull();
    expect(home.classList.contains("rstep__node--dot")).toBe(true);
    expect(text(home).trim()).toBe("");
    const tools = Array.from(container.querySelectorAll("#product .route__list--tools .rstep__node")).map((n) => text(n as HTMLElement).trim());
    expect(tools).toEqual(["L5", "L9", "L13", "L13", "L24", "L28"]);
  });

  it("grows the dots from the first step to the fifth, on wide screens and on phones", () => {
    const sizes = (block: string) =>
      [1, 2, 3, 4].map((n) => Number(new RegExp(`\\.ph \\.route__start > li:nth-child\\(${n}\\) \\{ --dot: (\\d+)px; \\}`).exec(block)?.[1]));
    const wide = sizes(css);
    expect(wide).toEqual([10, 13, 16, 19]);
    expect(css).toMatch(/\n\.ph \.rstart__node::after \{\s*width: var\(--dot, 10px\);\s*height: var\(--dot, 10px\);[^}]*background: var\(--signal-400\);/);
    expect(css).toMatch(/\n\.ph \.rstep__node--dot::after \{\s*width: 24px;\s*height: 24px;/);
    // The fifth is the level node: a Signal dot in a tinted ring, not a filled disc with a code.
    expect(css).toMatch(/\n\.ph \.rstep\.is-active \.rstep__node\.rstep__node--dot \{\s*background: #222916;\s*color: var\(--signal-400\);/);
    const phone = /@media \(max-width: 920px\) \{([\s\S]*?)\n\}/.exec(css.slice(css.indexOf(".ph .route__steps {\n    padding-bottom: 40px;") - 2000))?.[1] ?? "";
    expect(sizes(phone)).toEqual([9, 12, 15, 18]);
    expect(phone).toMatch(/\.ph \.rstep__node--dot::after \{\s*width: 21px;\s*height: 21px;/);
  });
});

/* DD-371 (2026-10-08), the owner, on #fit: the heading «Право сказать «не сейчас» тоже создаёт
   доверие.» → «Почему АТА может быть не для меня ?»; the lead → «АТА создана для тех кто может понимать
   основания собственного решения и готов проверять качество своей работы»; the two groups swapped;
   four reasons «not now» in the owner's words, the money one removed. */
describe("Public Home — #fit asks the owner's question and opens on «not now» (DD-371)", () => {
  it("has the question, the owner's lead, and the groups in the owner's order", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const fit = container.querySelector("#fit") as HTMLElement;
    expect(text(fit.querySelector("h2") as HTMLElement).trim()).toBe("Почему ATA может быть не для меня?");
    expect(text(fit.querySelector(".lead") as HTMLElement).trim()).toBe(
      "ATA создана для тех, кто может понимать основания собственного решения и готов проверять качество своей работы.",
    );
    const groups = Array.from(fit.querySelectorAll(".fit__columns > article")) as HTMLElement[];
    expect(groups.map((g) => text(g.querySelector(".micro-label") as HTMLElement).trim())).toEqual([
      "Лучше не начинать сейчас, если вы",
      "ATA может подойти, если вы",
    ]);
    const notNow = Array.from(groups[0]!.querySelectorAll("li")).map((li) => text(li).trim());
    expect(notNow).toEqual([
      "хотите получать только сигналы или копировать сделки;",
      "не готовы обучаться, воспринимать экспертное мнение и совершенствоваться в том, на что тратите время;",
      "не готовы брать на себя ответственность за свои решения;",
      "пытаетесь компенсировать прошлые потери.",
    ]);
    expect(text(fit)).not.toContain("обязательных расходов");
    expect(text(fit)).not.toContain("Право сказать");
    const may = Array.from(groups[1]!.querySelectorAll("li")).map((li) => text(li).trim());
    expect(may).toHaveLength(5);
    expect(may[0]).toBe("не являетесь профессиональным трейдером;");
  });
});

/* DD-372 (2026-10-08), the owner, on the «ATA — это не» card: «тут сделать сильно интереснее,
   анимации, акценты и текста улучшить, довести до продакшен хай фай». */
describe("Public Home — the boundary card says what ATA is instead (DD-372)", () => {
  const css = readFileSync(join(process.cwd(), "src/features/public-home/public-home.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("pairs every denial with what ATA is instead, and keeps the page's one «прибыл»", () => {
    const { container } = render(<PublicHomeScreen authenticated={false} />);
    const card = container.querySelector("#boundaries .not-list") as HTMLElement;
    expect(text(card.querySelector(".micro-label") as HTMLElement).trim()).toBe("ATA — это не");
    const rows = Array.from(card.querySelectorAll(".contrast > li")) as HTMLElement[];
    expect(rows.map((r) => text(r.querySelector(".contrast__not") as HTMLElement).trim())).toEqual([
      "сигнальный сервис",
      "копирование сделок",
      "торговый терминал",
      "управление капиталом",
      "обещание прибыли",
    ]);
    const answers = rows.map((r) => text(r.querySelector(".contrast__but") as HTMLElement).trim());
    // DD-373: the owner's wording for the first, second and last answers.
    expect(answers).toEqual([
      "а платформа, специализированная на обучении правильному принятию решений",
      "а возможность самостоятельно находить и понимать, когда время открывать сделку",
      "а среда, где решение готовится до входа",
      "а дисциплина ваших решений",
      "а проверяемая работа и эффективная обратная связь",
    ]);
    // Every answer is a positive claim about the learner's own work, never an outcome.
    for (const answer of answers) expect(answer).not.toMatch(/прибыл|доход|заработ|гарант/);
    // The hero frame's corners, on the card.
    expect(card.querySelector(":scope > .frame-mark")).not.toBeNull();
  });

  it("sets the denial muted behind its cross and the answer lit behind a Signal dot, and moves once inside the budget", () => {
    expect(css).toMatch(/\n\.ph \.not-list \{[^}]*align-self: start;/);
    // DD-373: the corners at the card's own opposite corners — the mark spans the card.
    expect(css).toMatch(/\n\.ph \.not-list \.frame-mark \{\s*inset: 12px;\s*width: auto;\s*height: auto;\s*\}/);
    expect(css).toMatch(/\n\.ph \.contrast__not::before \{[^}]*font-family: var\(--font-data\);[^}]*content: "×";/);
    expect(css).toMatch(/\n\.ph \.contrast__but::before \{[^}]*background: var\(--signal-400\);/);
    expect(css).toMatch(/\n\.ph \.not-list\.is-visible \.contrast li \{\s*animation: ph-reply-in-down 360ms var\(--ease\) both;/);
    expect(css).toMatch(/\n\.ph \.not-list\.is-visible \.contrast__but::before \{\s*animation: ph-dot-pop 260ms var\(--ease\) both;/);
    const delays = Array.from(css.matchAll(/\.not-list\.is-visible \.contrast li:nth-child\((\d)\) \.contrast__but::before \{ animation-delay: (\d+)ms; \}/g)).map((m) => Number(m[2]));
    expect(delays).toEqual([200, 310, 420, 530, 640]);
    // In the column the two halves stack.
    expect(css).toMatch(/@media \(max-width: 680px\) \{[^@]*\.ph \.contrast li \{\s*grid-template-columns: 1fr;/);
  });
});
