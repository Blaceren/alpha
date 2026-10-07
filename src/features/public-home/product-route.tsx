"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  PATH_STEP,
  PRODUCT_STEP,
  ROUTE_START,
  ROUTE_STEPS,
  TOOL_STEPS,
  stepIndex,
  type RouteStateId,
  type RouteStep,
} from "@/features/public-home/product-route-data";
import { RouteWindowState } from "@/features/public-home/product-window-states";

/**
 * THE ROUTE AND THE WINDOW — the middle of the public home.
 *
 * Direction chosen by the owner on 2026-09-22: «лучшее из B и C». From B, the
 * route: one luminous line of levels with unlock nodes, running down the left
 * of three segments — the learner's home, the path, the six tools. From C, the
 * window: a pinned frame of the product on the right that shows the state of
 * whichever node the visitor has reached. The route is the argument, the
 * window is the evidence, and scrolling moves both.
 *
 * WHAT DRIVES THE WINDOW. Each step with a window state is observed; the one
 * crossing a band of the viewport (below the pinned header, above the fold's
 * middle) becomes active. Nothing is tied to scroll position by the pixel —
 * the line draws to the active node in a bounded transition and the window
 * swaps in one — so fast scrolling settles on the right state and nothing ever
 * blocks the page. The step titles are buttons: keyboard users move the window
 * without scrolling, and a click also brings the step into view.
 *
 * WITHOUT JAVASCRIPT the route reads top to bottom with every step visible,
 * and the window shows the first state. Without IntersectionObserver the same.
 *
 * THE THREE SEGMENTS KEEP THEIR ADDRESSES. `#product` is the route itself,
 * `#path` and `#tools` are sections inside it, in the same document order as
 * before, so the menu and every published deep link still land where they did.
 * `#first-journey` still precedes the journey — now the three passed nodes the
 * route starts with.
 *
 * THE SIX TOOLS ON A NARROW SCREEN (2026-10-03, DD-342, the owner: the phone
 * page «такая не понятная получается»). Stacked, the six tool windows were
 * 4 000px of interface — almost five screens. Up to 920px they are one deck:
 * a card per tool, swiped sideways, the next one showing at the edge, under a
 * rail of the levels they open on — L5 … L30. The rail is not decoration: it
 * is when each tool opens, it shows which card is on screen, and a press on
 * it brings that card; rail and card share one screen. The vertical route
 * stops above the deck, and the scroll observer leaves the deck's cards alone.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const DECK = "(max-width: 920px)";

function stepId(id: RouteStateId): string {
  return `route-step-${id}`;
}

/** The product's window showing one step's state: the pinned window on a wide
    screen, and each step's own window on a narrow one. */
function WindowFrame({ id, windowId }: { id: RouteStateId; windowId?: string }) {
  const item = ROUTE_STEPS[stepIndex(id)] ?? ROUTE_STEPS[0]!;
  const bar = item.id === "home" ? "Главная" : item.id === "path" ? "Путь" : "Инструменты";
  return (
    <div className="pw" id={windowId} data-state={item.id} aria-label={`Окно продукта: ${item.label}`}>
      <div className="pw__bar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pw__mark" src="/brand/ata-logo.svg" alt="" width={362} height={200} />
        <ul className="pw__nav" aria-hidden="true">
          {["Главная", "Путь", "Уроки", "Инструменты"].map((label) => (
            <li key={label} className={label === bar ? "is-active" : undefined}>
              {label}
            </li>
          ))}
        </ul>
        <span className="pw__level pw-mono">Уровень {item.level}</span>
        <span className="demo-badge pw__badge">Демонстрационный пример</span>
      </div>
      <div className="pw__stage" key={item.id}>
        <RouteWindowState id={item.id} />
      </div>
    </div>
  );
}

export function ProductRoute() {
  const [active, setActive] = useState<RouteStateId>(ROUTE_STEPS[0]!.id);
  const activeIndex = stepIndex(active);
  const listRef = useRef<HTMLDivElement | null>(null);
  // The tool card on show in the deck (narrow screens only).
  const [tool, setTool] = useState(0);
  const deckRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    // The band sits around the upper third on a wide screen, beside the pinned
    // window; on a narrow one (each step with its own window) a little above
    // the middle. A step is active while it crosses the band. On a narrow
    // screen the six tools stand side by side in the deck — all of them cross
    // the band at once — so the deck keeps its own card and is not observed.
    const narrow = window.matchMedia(DECK).matches;
    const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-route-step]")).filter(
      (element) => !(narrow && element.closest("[data-tdeck]")),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.getAttribute("data-route-step") as RouteStateId | null;
          if (id) setActive(id);
        }
      },
      { rootMargin: narrow ? "-35% 0px -55% 0px" : "-38% 0px -52% 0px", threshold: 0 },
    );
    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  // The Signal part of the line runs from the first node to the active one.
  // Measured, not assumed: steps have different heights, so the distance is
  // read from the DOM whenever the active step or the layout changes.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const draw = () => {
      const first = root.querySelector<HTMLElement>(".rstart__node");
      const node = root.querySelector<HTMLElement>(`#${stepId(active)} .rstep__node`);
      if (!first || !node) return;
      const origin = root.getBoundingClientRect();
      const top = first.getBoundingClientRect().top - origin.top + first.offsetHeight / 2;
      const end = node.getBoundingClientRect().top - origin.top + node.offsetHeight / 2;
      root.style.setProperty("--route-top", `${Math.round(top)}px`);
      root.style.setProperty("--route-drawn", `${Math.max(0, Math.round(end - top))}px`);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [active]);

  // The deck: the card on show is the one whose start is nearest the deck's
  // own start (its padding) — read once the deck comes to rest, not on every
  // frame of a swipe or of a press's glide (2026-10-07, the owner: «во время
  // переключения название инструмента пропадает и появляется»). Read per frame,
  // the rail named every card the deck slid past, stepped back to the first
  // before a press's glide began, and lit each passing card up and down.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    let timer = 0;
    const settle = () => {
      timer = 0;
      const start = deck.getBoundingClientRect().left + (parseFloat(getComputedStyle(deck).paddingLeft) || 0);
      let best = 0;
      let distance = Number.POSITIVE_INFINITY;
      Array.from(deck.children).forEach((card, index) => {
        const gap = Math.abs(card.getBoundingClientRect().left - start);
        if (gap < distance) {
          distance = gap;
          best = index;
        }
      });
      setTool(best);
    };
    // A scroll that has gone quiet for a moment has ended — the fallback for a
    // browser without `scrollend`.
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 120);
    };
    const onScrollEnd = () => {
      window.clearTimeout(timer);
      settle();
    };
    deck.addEventListener("scroll", onScroll, { passive: true });
    deck.addEventListener("scrollend", onScrollEnd);
    return () => {
      deck.removeEventListener("scroll", onScroll);
      deck.removeEventListener("scrollend", onScrollEnd);
      window.clearTimeout(timer);
    };
  }, []);

  const showTool = useCallback((index: number) => {
    const deck = deckRef.current;
    const card = deck?.children[index] as HTMLElement | undefined;
    if (!deck || !card) return;
    setTool(index);
    const start = deck.getBoundingClientRect().left + (parseFloat(getComputedStyle(deck).paddingLeft) || 0);
    const reduced = window.matchMedia(REDUCED_MOTION).matches;
    deck.scrollTo({
      left: deck.scrollLeft + card.getBoundingClientRect().left - start,
      behavior: reduced ? "auto" : "smooth",
    });
  }, []);

  const show = useCallback(
    (id: RouteStateId) => {
      // In the deck a tool's title brings its card sideways; the page stays.
      const toolIndex = TOOL_STEPS.findIndex((item) => item.id === id);
      if (toolIndex >= 0 && window.matchMedia(DECK).matches) {
        showTool(toolIndex);
        return;
      }
      setActive(id);
      const element = document.getElementById(stepId(id));
      if (!element) return;
      const reduced = window.matchMedia(REDUCED_MOTION).matches;
      element.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    },
    [showTool],
  );

  // Steps carry no `data-reveal`: React rewrites their class list on every
  // state change, which would drop the `is-visible` the reveal observer adds
  // and leave the active step invisible. The route's own motion — the line,
  // the node, the window — is what marks arrival.
  const step = (item: RouteStep) => {
    const index = stepIndex(item.id);
    const reached = index <= activeIndex;
    // In the deck (narrow screens) the card on show; wide screens ignore it.
    const shown = TOOL_STEPS[tool]?.id === item.id;
    return (
      <li
        key={item.id}
        id={stepId(item.id)}
        className={`rstep${item.id === active ? " is-active" : ""}${reached ? " is-reached" : ""}${shown ? " is-shown" : ""}`}
        data-route-step={item.id}
      >
        <i className="rstep__node" aria-hidden="true">
          <b>{item.node}</b>
        </i>
        <p className="rstep__label">{item.label}</p>
        <h3 className="rstep__title">
          <button
            type="button"
            className="rstep__button"
            aria-pressed={item.id === active}
            aria-controls="route-window"
            onClick={() => show(item.id)}
          >
            {item.title}
          </button>
        </h3>
        <p className="rstep__copy">{item.copy}</p>
        {/* On a narrow screen each step shows its own state right under its
            words (2026-10-03, the owner: the pinned window covered the route
            on a phone). The shared window below serves wide screens only;
            CSS shows one or the other, never both. */}
        <div className="rstep__window">
          <WindowFrame id={item.id} />
        </div>
      </li>
    );
  };

  const current = ROUTE_STEPS[activeIndex] ?? ROUTE_STEPS[0]!;
  const shownTool = TOOL_STEPS[tool] ?? TOOL_STEPS[0]!;

  return (
    <section className="route surface surface--ink" id="product">
      <div className="shell route__grid">
        <div className="route__steps" ref={listRef}>
          {/* ------------------------------------------ segment: product */}
          <div className="route__segment" data-segment="product">
            <div className="route__intro" data-reveal>
              <p className="eyebrow">Реальный продукт · один следующий шаг</p>
              <h2 className="display route__title">Не витрина контента. Последовательная работа.</h2>
              <p className="lead">
                В каждый момент Academy показывает текущее действие. Следующий уровень
                открывается после выполнения условий предыдущего — не за XP и не случайным
                выбором.
              </p>
            </div>

            {/* Alias: `#first-journey` was its own section; it lands on the
                journey the route starts with. */}
            <span className="anchor-alias" id="first-journey" aria-hidden="true" />
            <ol className="journey-line route__start" aria-label="Первые шаги пользователя ATA" data-reveal>
              {ROUTE_START.map((item, index) => (
                <li key={item.node} className={`rstart${index === 0 ? " rstart--origin" : ""}`}>
                  <i className="rstart__node" aria-hidden="true">
                    {index === 0 ? null : <b>{item.node}</b>}
                  </i>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </li>
              ))}
            </ol>

            <ol className="route__list" aria-label="Что показывает Academy на уровне 3">
              {step(PRODUCT_STEP)}
            </ol>
          </div>

          {/* --------------------------------------------- segment: path */}
          <section className="route__segment" id="path">
            <div className="route__intro" data-reveal>
              <p className="eyebrow">Путь и прогресс</p>
              <h2 className="display route__title">100 уровней. Но только один следующий шаг.</h2>
              <p className="lead">
                20 модулей превращают масштаб в карту: завершённое остаётся позади, текущий
                уровень получает фокус, будущее открывается последовательно.
              </p>
              <dl className="path-facts route__facts">
                <div>
                  <dt>Структура</dt>
                  <dd>20 модулей / 100 уровней</dd>
                </div>
                <div>
                  <dt>Переход</dt>
                  <dd>После подтверждённого завершения текущего уровня</dd>
                </div>
                <div>
                  <dt>Пропуск</dt>
                  <dd>Последовательность обязательна</dd>
                </div>
                <div>
                  <dt>XP</dt>
                  <dd>Системный показатель. Не открывает уровень и не подтверждает освоение</dd>
                </div>
              </dl>
            </div>
            <ol className="route__list" aria-label="Путь модуля 01">
              {step(PATH_STEP)}
            </ol>
          </section>

          {/* -------------------------------------------- segment: tools */}
          <section className="route__segment route__segment--tools" id="tools">
            <div className="route__intro" data-reveal>
              <p className="eyebrow">Инструменты · открываются по пути</p>
              <h2 className="display route__title">Инструмент появляется в контексте задачи.</h2>
              <p className="lead">
                Шесть инструментов, и каждый открывается на своём уровне — когда путь уже
                подвёл к задаче, для которой он нужен.
              </p>
            </div>
            {/* The deck's rail — narrow screens only (CSS): the levels the six
                tools open on, lit up to the card on show. It says what it is
                for (2026-10-07, the owner: «было понятно что тут рассказываем
                про инструменты, показываем что они открываются на определенном
                уровне и можно выбрать уровень и посмотреть превью»), and its
                levels look like what they are — buttons. */}
            <div className="tdeck__rail">
              <p className="trail__hint">Нажмите на уровень, чтобы посмотреть превью инструмента</p>
              <ol
                className="trail"
                aria-label="Инструменты по уровням открытия"
                style={{ "--tr-at": tool } as CSSProperties}
              >
                {TOOL_STEPS.map((item, index) => (
                  <li
                    key={item.id}
                    className={`trail__step${index === tool ? " is-active" : ""}${index <= tool ? " is-reached" : ""}`}
                  >
                    <button
                      type="button"
                      className="trail__button"
                      aria-pressed={index === tool}
                      aria-controls={stepId(item.id)}
                      aria-label={`${item.name}, открывается на уровне ${item.level}`}
                      onClick={() => showTool(index)}
                    >
                      <span className="trail__num pw-mono" aria-hidden="true">
                        {item.node}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <p className="trail__note">
                <span>
                  <strong>{shownTool.name}</strong> — открывается на уровне{" "}
                  <b className="trail__lvl">{shownTool.level}</b>
                </span>
                <span className="trail__count pw-mono">
                  {tool + 1} / {TOOL_STEPS.length}
                </span>
              </p>
            </div>
            <ol
              ref={deckRef}
              className="route__list route__list--tools"
              aria-label="Шесть инструментов ATA и уровни их открытия"
              data-tdeck
            >
              {TOOL_STEPS.map(step)}
            </ol>
          </section>
        </div>

        {/* --------------------------------------------------- the window */}
        <div className="route__window">
          <WindowFrame id={current.id} windowId="route-window" />
        </div>
      </div>
    </section>
  );
}
