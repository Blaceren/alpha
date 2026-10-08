import type { ProgramModule, ProgramPoint, ProgramPosition } from "@/lib/curriculum/program-points";
import type { ToolWindowView } from "@/features/tool-windows/model/access";
import type { NotificationRow } from "@/features/notifications-fidelity/notifications-state";

/**
 * HOME, FILLED — what the page around the current priority says, as data.
 *
 * The owner, 2026-10-03: «Теперь наполни внутреннюю главную, после сделай ее
 * хай фай». Home used to be one field and nothing else; it now greets the
 * learner, shows where they are in the program, the module they are in, the
 * tools they have and what changed in their work — around the same one
 * priority, which is still the only thing on the page that asks for anything.
 *
 * Every line is read from what the Backend already sent: the curriculum read
 * (points, XP), its tool verdict, and the learner's notification rows. No
 * balance, no deposit, no amount, no Pocket — Home is not a financial surface
 * (DD-020…DD-024), and the tests hold that.
 */

/** The first word of the learner's name, for the greeting; null without one. */
export function greetingName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? first : null;
}

/**
 * «Здравствуйте, Вера». Formal, like every sentence the product says, and with
 * no time of day: the page is rendered on a server that does not know the
 * learner's clock, and «Добрый вечер» at breakfast is worse than no greeting.
 */
export function greetingLine(name: string | null): string {
  return name ? `Здравствуйте, ${name}` : "Здравствуйте";
}

/**
 * «Глава 1 · Основы и первые реальные сделки · модуль 1 из 6», or the module
 * alone. With every open level done the module in focus is the one the program
 * opens next, and the line says so: «Дальше: глава 2 · …».
 */
export function whereLine(position: ProgramPosition): string | null {
  const focus = position.focusModule;
  if (!focus) return null;
  const count = `модуль ${focus.order} из ${position.modules.length}`;
  const where = focus.chapter ? `глава ${focus.chapter.number} · ${focus.chapter.title} · ${count}` : count;
  const ahead = position.current === null && isPreparing(focus);
  return ahead ? `Дальше: ${where}` : where.charAt(0).toUpperCase() + where.slice(1);
}

/** Every level of the module is defined and not open yet. */
export function isPreparing(module: ProgramModule): boolean {
  return module.points.length > 0 && module.points.every((point) => point.state === "preparing");
}

export type HomeFact = { readonly key: string; readonly label: string; readonly value: string };

/** The three facts beside the greeting. Counts only — never an amount. */
export function homeFacts(position: ProgramPosition, tools: readonly ToolWindowView[] | null): HomeFact[] {
  const facts: HomeFact[] = [];
  if (position.xp !== null) facts.push({ key: "xp", label: "опыт", value: `${position.xp} XP` });
  facts.push({ key: "levels", label: "пройдено", value: `${position.completed} из ${position.total}` });
  if (tools && tools.length > 0) {
    const open = tools.filter((tool) => tool.state !== "locked").length;
    facts.push({ key: "tools", label: "инструменты", value: `${open} из ${tools.length}` });
  }
  return facts;
}

/** «Модуль 1» → «уровни 1–5». */
export function levelRange(module: ProgramModule): string | null {
  const first = module.points[0];
  const last = module.points[module.points.length - 1];
  if (!first || !last) return null;
  return first.order === last.order ? `уровень ${first.order}` : `уровни ${first.order}–${last.order}`;
}

/** The module after the one in focus, for «Дальше: …». */
export function nextModule(position: ProgramPosition): ProgramModule | null {
  const focus = position.focusModule;
  if (!focus) return null;
  const index = position.modules.findIndex((module) => module.moduleCode === focus.moduleCode);
  return index >= 0 ? position.modules[index + 1] ?? null : null;
}

/**
 * THE LIST'S FIVE ROWS (DD-348, owner 2026-10-06: «показываем 3 уровня которые
 * пройдены ранее, 1 актуальный и 1 следующий»).
 *
 * Three walked levels behind the level the learner stands on, that level, and
 * the next — across module edges, as the path runs. The level the learner
 * stands on is the current one, or, with every open level done, the first one
 * not done (the level Path calls «Дальше»). At the ends of the program the five
 * shift inward. Each row carries its module, so the list can mark an edge and
 * name a module other than the one the block is about.
 */
export type HomeListRole = "walked" | "here" | "next" | "ahead";
export type HomeListRow = {
  readonly point: ProgramPoint;
  readonly module: ProgramModule;
  readonly role: HomeListRole;
  /** The row starts another module than the row above it. */
  readonly edge: boolean;
  /** The row's module is not the block's, and the row above is not of it: name it here. */
  readonly foreign: boolean;
};

export const HOME_LIST_SIZE = 5;
export const HOME_LIST_BEHIND = 3;

export function homeListRows(position: ProgramPosition): HomeListRow[] {
  const all = position.modules.flatMap((module) => module.points.map((point) => ({ point, module })));
  if (all.length === 0) return [];
  const anchor =
    position.current?.point ??
    all.find((entry) => entry.point.state !== "done")?.point ??
    all[all.length - 1]!.point;
  const at = all.findIndex((entry) => entry.point.levelCode === anchor.levelCode);
  const end = Math.min(all.length, Math.max(0, at - HOME_LIST_BEHIND) + HOME_LIST_SIZE);
  const window = all.slice(Math.max(0, end - HOME_LIST_SIZE), end);
  const focus = position.focusModule?.moduleCode ?? null;
  return window.map(({ point, module }, index) => {
    const above = index > 0 ? window[index - 1]!.module : null;
    const role: HomeListRole =
      point.levelCode === anchor.levelCode && point.state !== "done"
        ? "here"
        : point.state === "done"
          ? "walked"
          : point.order === anchor.order + 1
            ? "next"
            : "ahead";
    return {
      point,
      module,
      role,
      edge: above !== null && above.moduleCode !== module.moduleCode,
      foreign: module.moduleCode !== focus && (above === null || above.moduleCode !== module.moduleCode),
    };
  });
}

/** What a closed row says in place of a button. */
export function closedRowWord(row: Pick<HomeListRow, "point" | "role">): string {
  if (row.point.state === "preparing") return POINT_WORD.preparing;
  return row.role === "next" ? "откроется следующим" : POINT_WORD.ahead;
}

/** The words for a level's place on the module list. */
export const POINT_WORD = {
  done: "пройден",
  current: "сейчас",
  ahead: "впереди",
  preparing: "готовится",
} as const;

/** Tools: the ones the learner has, and the next one the program will open. */
export function toolRack(tools: readonly ToolWindowView[] | null): {
  open: ToolWindowView[];
  next: ToolWindowView | null;
  total: number;
} {
  const all = tools ?? [];
  const open = all.filter((tool) => tool.state !== "locked");
  const next =
    all
      .filter((tool) => tool.state === "locked")
      .sort((a, b) => a.unlockLevel - b.unlockLevel)[0] ?? null;
  return { open, next, total: all.length };
}

/**
 * The rows «Что нового» may draw from: the newest few, narrowed to the fields
 * the register's mapping reads. The mapping itself (`toRecord` — visibility,
 * suppression, wording) runs in the browser component, because it lives in a
 * client module, and so does the time, which belongs to the learner's clock.
 * Null when the rows could not be read.
 */
export function homeNewsRows(rows: readonly unknown[] | null, keep = 12): NotificationRow[] | null {
  if (rows === null) return null;
  const narrowed: NotificationRow[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" && typeof r.id !== "number") continue;
    const text = (key: string) => (typeof r[key] === "string" ? (r[key] as string) : null);
    narrowed.push({
      id: r.id,
      type: text("type"),
      title: text("title"),
      message: text("message"),
      body: text("body"),
      readAt: text("readAt"),
      createdAt: text("createdAt"),
      link: text("link"),
      url: text("url"),
      metadata: r.metadata ?? null,
    });
  }
  narrowed.sort((a, b) => ((a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : (a.createdAt ?? "") > (b.createdAt ?? "") ? -1 : 0));
  return narrowed.slice(0, keep);
}

/**
 * What the step in front of the learner gives and opens — printed beside the
 * priority, never as a second thing to do: the level's own reward, the level
 * after it, and a tool the program opens with it. With every open level done,
 * «rest»: nothing is required, and the page says where to go meanwhile.
 */
export type StepAside =
  | {
      readonly kind: "step";
      readonly reward: number | null;
      readonly next: { readonly order: number; readonly title: string; readonly preparing: boolean } | null;
      readonly opens: readonly string[];
    }
  | { readonly kind: "rest" };

export function stepAside(position: ProgramPosition, tools: readonly ToolWindowView[] | null): StepAside | null {
  const all = position.modules.flatMap((module) => module.points);
  if (position.current) {
    const point = position.current.point;
    const index = all.findIndex((candidate) => candidate.levelCode === point.levelCode);
    const following = index >= 0 ? all[index + 1] ?? null : null;
    const opens = (tools ?? [])
      .filter((tool) => tool.state === "locked" && tool.unlockLevel === point.order)
      .map((tool) => tool.tool.title);
    return {
      kind: "step",
      reward: point.xpReward > 0 ? point.xpReward : null,
      next: following
        ? { order: following.order, title: following.title, preparing: following.state === "preparing" }
        : null,
      opens,
    };
  }
  const resting =
    all.length > 0 &&
    all.some((point) => point.state === "preparing") &&
    all.every((point) => point.state === "done" || point.state === "preparing");
  return resting ? { kind: "rest" } : null;
}

/** Where along the line the current point sits, 0…1 — for the light it casts on the frame. */
export function currentShare(position: ProgramPosition): number | null {
  if (!position.current) return null;
  const all = position.modules.flatMap((module) => module.points);
  const index = all.findIndex((point) => point.levelCode === position.current!.point.levelCode);
  return index >= 0 && all.length > 0 ? (index + 0.5) / all.length : null;
}
