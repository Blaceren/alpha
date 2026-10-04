import type { ProgramPosition } from "@/lib/curriculum/program-points";
import type { ToolWindowView } from "@/features/tool-windows/model/access";

/**
 * PROFILE — the learner's record, as data (owner, 2026-10-03: «наполни как
 * нормальный профиль на платформе»).
 *
 * A normal learning profile says who the person is and how far they have come.
 * Everything here is a count the Backend already gave: the level in front of
 * the learner, the levels done, XP, the tools open. No balance, no deposit, no
 * amount and nothing of Pocket — the profile is not a financial surface and
 * never shows another product's data (DD-020…DD-024; the tests hold it).
 */
export type ProfileFact = { readonly key: string; readonly label: string; readonly value: string };

export function profileFacts(position: ProgramPosition | null, tools: readonly ToolWindowView[] | null): ProfileFact[] {
  if (!position) return [];
  const facts: ProfileFact[] = [];
  facts.push(
    position.current
      ? { key: "level", label: "Сейчас", value: `уровень ${position.current.point.order} из ${position.total}` }
      : { key: "level", label: "Сейчас", value: position.open < position.total ? "открытые уровни пройдены" : "программа пройдена" },
  );
  facts.push({ key: "done", label: "Пройдено", value: `${position.completed} из ${position.total}` });
  if (position.xp !== null) facts.push({ key: "xp", label: "Опыт", value: `${position.xp} XP` });
  if (tools && tools.length > 0) {
    const open = tools.filter((tool) => tool.state !== "locked").length;
    facts.push({ key: "tools", label: "Инструменты", value: `${open} из ${tools.length}` });
  }
  return facts;
}

/** «Вера Четвёртая» → «ВЧ», the shell avatar's own rule. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * THE RING — the program line closed around the learner's initials. The same
 * object Home draws straight, bent into a circle: a stretch of track per
 * module (dashed where the module is still being prepared), lit as far as the
 * learner has come, and the current level as one Signal point on it. It starts
 * at the top and runs clockwise. Pure geometry, so the picture can be tested
 * without a browser.
 */
export type RingModule = {
  readonly track: string;
  /** The lit part of this module's stretch, or null where nothing is done. */
  readonly lit: string | null;
  readonly preparing: boolean;
};

export type RingModel = {
  readonly modules: readonly RingModule[];
  /** Where the current level sits on the ring, or null when none is in front of the learner. */
  readonly current: { readonly x: number; readonly y: number } | null;
};

export function ringModel(position: ProgramPosition, radius = 54, centre = 60): RingModel {
  const groups = position.modules.filter((group) => group.points.length > 0);
  const count = groups.reduce((sum, group) => sum + group.points.length, 0);
  if (count === 0) return { modules: [], current: null };
  const gap = groups.length > 1 ? Math.min(10, 60 / groups.length) : 0;
  const perLevel = (360 - gap * groups.length) / count;
  const modules: RingModule[] = [];
  let current: RingModel["current"] = null;
  let angle = gap / 2;
  for (const group of groups) {
    const start = angle;
    const end = Math.min(angle + perLevel * group.points.length, start + 359.9);
    let lastLit = -1;
    group.points.forEach((point, index) => {
      if (point.state === "done" || point.state === "current") lastLit = index;
      if (point.state === "current") current = pointAt(centre, radius, start + perLevel * (index + 0.5));
    });
    const litEnd =
      lastLit < 0
        ? null
        : lastLit === group.points.length - 1 && group.points[lastLit]!.state === "done"
          ? end
          : start + perLevel * (lastLit + 0.5);
    modules.push({
      track: arcPath(centre, radius, start, end),
      lit: litEnd === null ? null : arcPath(centre, radius, start, litEnd),
      preparing: group.points.every((point) => point.state === "preparing"),
    });
    angle = end + gap;
  }
  return { modules, current };
}

function pointAt(c: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: Number((c + r * Math.cos(rad)).toFixed(2)), y: Number((c + r * Math.sin(rad)).toFixed(2)) };
}

function arcPath(c: number, r: number, from: number, to: number): string {
  const a = pointAt(c, r, from);
  const b = pointAt(c, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}
