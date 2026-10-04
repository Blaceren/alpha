import { TOOL_WINDOWS, type ToolSlug } from "@/features/tool-windows/model/catalog";

/**
 * THE ROUTE — what the public home shows of the product, and in what order.
 *
 * Owner, 2026-09-22: the inserts are a presentation of the product, not
 * screenshots — «чтобы люди сразу понимали, что это полезно и нужно им». The
 * chosen direction merges two of the three proposed: the middle of the page is
 * one route of levels with unlock nodes (B), and a pinned product window shows
 * the state of whichever level the visitor has reached (C).
 *
 * One list drives both halves. Each step is a node on the route and a state of
 * the window; the order is the order of the curriculum, and the six tool steps
 * come from the tools catalogue itself, so this page can never announce a tool
 * the product does not have, or at a level it does not unlock at.
 *
 * WHAT NO STEP MAY SAY. Nothing about the broker, deposits, balances or
 * checkpoint amounts — the public page names the practice environment as
 * «внешняя торговая среда» and no further (owner, 2026-09-22). No person: the
 * product is not tied to a personality. No financial outcome. The tests hold
 * every one of these lines.
 */

export type RouteStateId =
  | "home"
  | "path"
  | "trade-card"
  | "journal"
  | "risk-calculator"
  | "entry-checklist"
  | "stats"
  | "news";

export type RouteStep = {
  /** The window state this step shows; also the step's DOM id suffix. */
  readonly id: RouteStateId;
  /** The node's mark on the route: a level code or the segment's own word. */
  readonly node: string;
  /** What the step is called on its own: the screen or the tool's name. */
  readonly name: string;
  /** Mono label above the title: what the visitor is looking at. */
  readonly label: string;
  /** The benefit, in the visitor's words. */
  readonly title: string;
  /** Two sentences: what the product does here and what that gives. */
  readonly copy: string;
  /** The level shown in the window's bar. */
  readonly level: number;
};

/** The three segments of the route, each with its own heading. */
export type RouteSegmentId = "product" | "path" | "tools";

/** Benefit copy for the six tools, keyed by the catalogue's slug. */
const TOOL_STEP_COPY: Readonly<Record<ToolSlug, { title: string; copy: string }>> = {
  "trade-card": {
    title: "План сделки до входа.",
    copy:
      "Актив, направление, экспирация и причина записываются до сделки — и после открытия не меняются. Разбор после: по плану или нет.",
  },
  journal: {
    title: "Каждая сделка: план, исполнение, вывод.",
    copy:
      "Журнал показывает не результат, а дисциплину: сколько сделок прошло по плану, где план нарушен и какие остались без вывода.",
  },
  "risk-calculator": {
    title: "Размер сделки — из плана, а не из настроения.",
    copy:
      "Доля риска, дневной лимит и цена серии убытков считаются заранее. План хранится в ATA и открывается на любом устройстве.",
  },
  "entry-checklist": {
    title: "Девять условий до входа.",
    copy:
      "Среда, setup, собственное состояние. Стоп-фактор закрывает вход. Отказ от сделки тоже записывается — и остаётся в истории.",
  },
  stats: {
    title: "Дисциплина в цифрах.",
    copy:
      "Win rate, соблюдение плана и нарушения по записям журнала за 7 дней, 30 дней или всё время. Видно, что именно ломает план.",
  },
  news: {
    title: "Знать заранее, когда не входить.",
    copy:
      "События дня в вашем часовом поясе и окна, когда вход закрыт по вашему плану. Решение принимается до выхода новости.",
  },
};

/**
 * The level after which each tool opens IN THE PROGRAM LEARNERS HAVE — `ata-v2`,
 * the owner's 30-level document of 2026-10-02 (`LevelToolUnlock`): the Trade
 * Card after level 5, the journal after the level-9 report, the calculator and
 * the checklist after the level-13 practice, statistics after 24, the calendar
 * after 28. The catalogue's own `unlockLevel` (5/10/15/20/25/30) is the earlier
 * 100-level plan and stays there for the curriculum fixture; the public page
 * said it until 2026-10-04 (launch audit), so a visitor read «Trading Journal ·
 * L10» and found it open after level 9. Inside the product the Backend decides.
 */
export const PROGRAM_TOOL_LEVEL: Readonly<Record<ToolSlug, number>> = {
  "trade-card": 5,
  journal: 9,
  "risk-calculator": 13,
  "entry-checklist": 13,
  stats: 24,
  news: 28,
};

const TOOL_STATE: Readonly<Record<ToolSlug, RouteStateId>> = {
  "trade-card": "trade-card",
  journal: "journal",
  "risk-calculator": "risk-calculator",
  "entry-checklist": "entry-checklist",
  stats: "stats",
  news: "news",
};

/** The six tools, from the catalogue: built ones only, in the order the program opens them. */
export const TOOL_STEPS: ReadonlyArray<RouteStep> = TOOL_WINDOWS.filter((tool) => tool.built)
  .slice()
  .sort((a, b) => PROGRAM_TOOL_LEVEL[a.slug] - PROGRAM_TOOL_LEVEL[b.slug])
  .map((tool) => ({
    id: TOOL_STATE[tool.slug],
    node: `L${PROGRAM_TOOL_LEVEL[tool.slug]}`,
    name: tool.title,
    label: `${tool.title} · открывается на L${PROGRAM_TOOL_LEVEL[tool.slug]}`,
    title: TOOL_STEP_COPY[tool.slug].title,
    copy: TOOL_STEP_COPY[tool.slug].copy,
    level: PROGRAM_TOOL_LEVEL[tool.slug],
  }));

export const PRODUCT_STEP: RouteStep = {
  id: "home",
  node: "L4",
  name: "Главная",
  label: "Главная · уровень 4",
  title: "Один следующий шаг.",
  copy:
    "Не нужно решать, что делать дальше: в каждый момент Academy показывает одно действие и говорит, когда откроется следующее.",
  level: 4,
};

export const PATH_STEP: RouteStep = {
  id: "path",
  node: "01",
  name: "Путь",
  label: "Путь · модуль 01 из 20",
  title: "Виден только текущий сегмент.",
  copy:
    "Пройденное остаётся позади, текущий уровень в фокусе, будущее открывается по порядку — масштаб не давит.",
  level: 4,
};

/** Every step in route order — the window's states, in the order they unlock. */
export const ROUTE_STEPS: ReadonlyArray<RouteStep> = [PRODUCT_STEP, PATH_STEP, ...TOOL_STEPS];

/** The nodes passed before the window has anything to show — the program's first
    three levels (2026-10-04, launch audit; it used to be the 100-level plan's:
    L1 the trading environment, L2 the first test). The environment is named as
    such and no further (owner, 2026-09-22). */
export const ROUTE_START = [
  { node: "Старт", title: "Создать аккаунт", copy: "Регистрация бесплатная, первый уровень открывается сразу." },
  { node: "L1", title: "Понять, от чего зависит исход", copy: "Вводный урок: условия сделки определяются до входа." },
  { node: "L2", title: "Понять устройство ATA", copy: "Уровни, прогресс, инструменты и проверки знаний." },
  { node: "L3", title: "Подготовить среду", copy: "Создать внешнюю торговую среду для практической части." },
] as const;

export function stepIndex(id: RouteStateId): number {
  return ROUTE_STEPS.findIndex((step) => step.id === id);
}
