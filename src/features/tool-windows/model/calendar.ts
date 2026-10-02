/**
 * A CALENDAR IN THE LEARNER'S OWN WORDS, for the tools' date field.
 *
 * Dates are calendar days — "YYYY-MM-DD", no time, no zone — exactly as the
 * tools store a trade's date (`local-date.ts`). All the arithmetic below runs
 * on UTC midnights for that reason only: so that a day is always 24 hours and
 * no daylight-saving change can drop or repeat one. «Today» is never worked
 * out here; the caller hands in the learner's own.
 *
 * The week starts on Monday and the words are Russian, whatever the browser's
 * locale: the browser's own date field writes «10/02/2026» in a Russian
 * interface.
 */

export type MonthOfYear = { readonly year: number; readonly month: number };

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MONTH_TITLES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] as const;

/** Monday first. */
export const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;
const WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"] as const;

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The parts of a real calendar date; null for anything else — «2026-02-30» included. */
export function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  const match = ISO_RE.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = utc(year, month, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** `iso` moved by whole days; an unreadable date is returned as it came. */
export function addDays(iso: string, delta: number): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  const moved = new Date(utc(parts.year, parts.month, parts.day).getTime() + delta * DAY_MS);
  return isoDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

export function addMonths(at: MonthOfYear, delta: number): MonthOfYear {
  const index = at.year * 12 + (at.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return utc(year, month + 1, 0).getUTCDate();
}

/**
 * The same day of the month, `delta` months away; a day the other month does
 * not have becomes its last one (31 March − 1 month = 28 or 29 February).
 */
export function addMonthsToDate(iso: string, delta: number): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  const target = addMonths(parts, delta);
  return isoDate(target.year, target.month, Math.min(parts.day, daysInMonth(target.year, target.month)));
}

/** 0 for Monday … 6 for Sunday. */
export function weekdayIndex(iso: string): number {
  const parts = parseIsoDate(iso);
  if (!parts) return 0;
  return (utc(parts.year, parts.month, parts.day).getUTCDay() + 6) % 7;
}

export function monthOf(iso: string): MonthOfYear | null {
  const parts = parseIsoDate(iso);
  return parts ? { year: parts.year, month: parts.month } : null;
}

/** −1, 0 or 1: is month `a` before, the same as, or after month `b`. */
export function compareMonths(a: MonthOfYear, b: MonthOfYear): number {
  return Math.sign(a.year * 12 + a.month - (b.year * 12 + b.month));
}

/** One cell of a month on show: a day, and whether it is a neighbouring month's. */
export type GridDay = { readonly iso: string; readonly outside: boolean };

/**
 * The month as rows of seven, Monday first — whole weeks. The first and the
 * last week are completed with the neighbouring months' days, marked `outside`.
 *
 * WHY THE NEIGHBOURS ARE SHOWN. A journal is written for the last few days, and
 * in the first week of a month those days are the month before's: on 2 October
 * the month would offer two days and a wall of ones that have not come yet.
 * With its week completed, 28…30 September stand in the same row, one press
 * away instead of a page away. No week is added for them: a row is drawn only
 * if this month has a day in it.
 */
export function monthGrid(year: number, month: number): GridDay[][] {
  const first = isoDate(year, month, 1);
  const lead = weekdayIndex(first);
  const days = daysInMonth(year, month);
  const total = Math.ceil((lead + days) / 7) * 7;
  const start = addDays(first, -lead);
  const rows: GridDay[][] = [];
  for (let at = 0; at < total; at += 7) {
    rows.push(
      Array.from({ length: 7 }, (_, column) => {
        const index = at + column;
        return { iso: addDays(start, index), outside: index < lead || index >= lead + days };
      }),
    );
  }
  return rows;
}

/** `iso` kept inside [min, max]; ISO dates compare as text. */
export function clampDate(iso: string, min: string, max: string): string {
  if (iso < min) return min;
  if (iso > max) return max;
  return iso;
}

/** «Октябрь 2026». */
export function monthTitle(at: MonthOfYear): string {
  return `${MONTH_TITLES[at.month - 1] ?? ""} ${at.year}`;
}

/** «2 октября 2026, пятница» — a day in full, for assistive technology. */
export function fullDateLabel(iso: string): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  return `${parts.day} ${MONTHS_GENITIVE[parts.month - 1]} ${parts.year}, ${WEEKDAYS_FULL[weekdayIndex(iso)]}`;
}

/**
 * A date as the field shows it, against the learner's `today`:
 *
 *   today            «Сегодня»      · «2 октября»
 *   the day before   «Вчера»        · «1 октября»
 *   this year        «29 сентября»  · «вторник»
 *   another year     «30 дек 2025»  · «вторник»
 *
 * `main` is what a narrow field keeps; `note` is said beside it where there is
 * room. Null when `iso` is not a date.
 */
export function describeDate(iso: string, today: string): { main: string; note: string } | null {
  const parts = parseIsoDate(iso);
  if (!parts) return null;
  const dayAndMonth = `${parts.day} ${MONTHS_GENITIVE[parts.month - 1]}`;
  if (iso === today) return { main: "Сегодня", note: dayAndMonth };
  if (iso === addDays(today, -1)) return { main: "Вчера", note: dayAndMonth };
  const weekday = WEEKDAYS_FULL[weekdayIndex(iso)] ?? "";
  const thisYear = parseIsoDate(today)?.year;
  if (parts.year === thisYear) return { main: dayAndMonth, note: weekday };
  return { main: `${parts.day} ${MONTHS_SHORT[parts.month - 1]} ${parts.year}`, note: weekday };
}
