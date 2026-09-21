/**
 * News Calendar (L30) — the model: the shapes, the learner's day in their own
 * time zone, the windows their plan closes, and the words. No React, no requests.
 *
 * THE PRESENTATION'S WINDOW. A time zone («Все время ниже показано в выбранном
 * поясе»), a status line («Вход закрыт по вашему плану до 14:45 — Через 12 мин:
 * USD · Базовый индекс потребительских цен, м/м. Первое движение после
 * публикации — только наблюдение.»), the day's timeline with the closed windows
 * hatched and «сейчас» marked, and the day's releases: time · currency · name ·
 * прошло/скоро · importance · прогноз / факт.
 *
 * THE PLAN IS THE LEARNER'S (L29 «Решение о торговле новости принимается до её
 * выхода»). Until it is saved there is no window, only the calendar. A window is
 * [release − before, release + after] for every release the plan covers — its
 * currencies, at or above its importance — and windows that touch are one.
 *
 * TIME ZONES WITH NOTHING BUT Intl, mirroring the Backend's `zoned-time.ts`:
 * a day in a zone is [its midnight, the next midnight), which is 23 or 25 hours
 * on the days summer time begins or ends.
 */

/* ------------------------------------------------------------------ shapes */

export type NewsEvent = {
  readonly slug: string;
  readonly title: string;
  readonly country: string;
  readonly countryLabel: string;
  readonly currency: string;
  readonly importance: number;
  readonly releaseAt: string;
  readonly forecast: string | null;
  readonly previous: string | null;
  readonly actual: string | null;
};

export type NewsPlan = {
  readonly version: number;
  readonly timeZone: string;
  readonly minImportance: number;
  readonly minutesBefore: number;
  readonly minutesAfter: number;
  readonly currencies: readonly string[];
  readonly savedAt: string;
};

export type NewsReference = {
  readonly currencies: readonly string[];
  readonly countries: readonly { code: string; label: string; currency: string }[];
  readonly importance: readonly { value: number; label: string }[];
  readonly minutes: readonly number[];
  readonly planImportance: readonly number[];
};

export type NewsCalendarState = {
  readonly plan: NewsPlan | null;
  readonly window: { readonly from: string; readonly to: string };
  readonly events: readonly NewsEvent[];
  readonly reference: NewsReference;
};

/** What a save sends. */
export type NewsPlanInput = Omit<NewsPlan, "version" | "savedAt">;

/* -------------------------------------------------------------- time zones */

const ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > 64 || !ZONE_RE.test(zone)) return false;
  try {
    partsFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** The browser's own zone, or UTC when it cannot say. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/** A zone's wall clock at `instant`, read as if it were UTC (minute precision). */
function wallAsUtc(instant: number, zone: string): number {
  const parts = partsFormatter(zone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"));
}

/** The instant a clock in `zone` shows `date` `time`, or null when that wall time does not exist. */
export function zonedWallTimeToInstant(date: string, time: string, zone: string): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!day || !clock || !isValidTimeZone(zone)) return null;
  const wall = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clock[1]), Number(clock[2]));
  const offset = (instant: number) => wallAsUtc(instant, zone) - Math.floor(instant / 60_000) * 60_000;
  const instant = wall - offset(wall - offset(wall));
  return wallAsUtc(instant, zone) === wall ? instant : null;
}

/** «2026-09-21» on a clock in `zone`. */
export function dayIn(instant: number, zone: string): string {
  return new Date(wallAsUtc(instant, zone)).toISOString().slice(0, 10);
}

/** «14:30» on a clock in `zone`. */
export function timeIn(instant: number, zone: string): string {
  return new Date(wallAsUtc(instant, zone)).toISOString().slice(11, 16);
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Where the day begins in `zone`: midnight, or the first minute after it that exists. */
function dayStart(day: string, zone: string): number {
  for (const time of ["00:00", "00:30", "01:00", "02:00"]) {
    const instant = zonedWallTimeToInstant(day, time, zone);
    if (instant !== null) return instant;
  }
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** [the day's start, the next day's start) in `zone`, as instants. */
export function dayBounds(day: string, zone: string): { from: number; to: number } {
  return { from: dayStart(day, zone), to: dayStart(addDays(day, 1), zone) };
}

const HOUR_MS = 3_600_000;

/**
 * The stretch of the day the timeline draws: the releases and windows with an
 * hour's margin, on whole hours, at least eight hours long — the
 * presentation's «08:00–20:00+» rather than a whole day in which a 30-minute
 * window is a hairline. A day without releases is drawn whole.
 */
export function timelineRange(
  day: string,
  zone: string,
  marks: readonly number[],
): { from: number; to: number; hours: { hour: number; instant: number }[] } {
  const bounds = dayBounds(day, zone);
  const hours: { hour: number; instant: number }[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const instant = zonedWallTimeToInstant(day, `${String(hour).padStart(2, "0")}:00`, zone);
    if (instant !== null) hours.push({ hour, instant });
  }
  hours.push({ hour: 24, instant: bounds.to });
  const inside = marks.filter((mark) => mark >= bounds.from && mark < bounds.to);
  if (inside.length === 0) return { from: bounds.from, to: bounds.to, hours };

  let first = 0;
  let last = hours.length - 1;
  const low = Math.min(...inside) - HOUR_MS;
  const high = Math.max(...inside) + HOUR_MS;
  while (first + 1 < hours.length && hours[first + 1]!.instant <= low) first += 1;
  while (last - 1 >= 0 && hours[last - 1]!.instant >= high) last -= 1;
  // At least eight hours: widen towards whichever end still has room.
  while (last - first < 8 && (first > 0 || last < hours.length - 1)) {
    if (first > 0) first -= 1;
    if (last - first < 8 && last < hours.length - 1) last += 1;
  }
  const shown = hours.slice(first, last + 1);
  return { from: shown[0]!.instant, to: shown[shown.length - 1]!.instant, hours: shown };
}

/** «UTC+2», «UTC−3», «UTC+5:30», «UTC» at `instant`. */
export function offsetWords(zone: string, instant: number): string {
  const minutes = Math.round((wallAsUtc(instant, zone) - Math.floor(instant / 60_000) * 60_000) / 60_000);
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** The zones a learner is offered, the city first; the browser's own is added when missing. */
export const NEWS_TIME_ZONES: readonly { zone: string; city: string }[] = [
  { zone: "Europe/Warsaw", city: "Варшава" },
  { zone: "Europe/Kyiv", city: "Киев" },
  { zone: "Europe/Moscow", city: "Москва" },
  { zone: "Europe/Istanbul", city: "Стамбул" },
  { zone: "Europe/London", city: "Лондон" },
  { zone: "Europe/Berlin", city: "Берлин" },
  { zone: "Asia/Dubai", city: "Дубай" },
  { zone: "Asia/Tbilisi", city: "Тбилиси" },
  { zone: "Asia/Yerevan", city: "Ереван" },
  { zone: "Asia/Tashkent", city: "Ташкент" },
  { zone: "Asia/Almaty", city: "Алматы" },
  { zone: "Asia/Novosibirsk", city: "Новосибирск" },
  { zone: "UTC", city: "UTC" },
];

export function zoneCity(zone: string): string {
  return NEWS_TIME_ZONES.find((entry) => entry.zone === zone)?.city ?? (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** «Варшава · UTC+2». */
export function zoneWords(zone: string, instant: number): string {
  return zone === "UTC" ? "UTC" : `${zoneCity(zone)} · ${offsetWords(zone, instant)}`;
}

/** The offered zones, with the learner's own and the saved one included. */
export function zoneOptions(...zones: readonly (string | null)[]): { zone: string; city: string }[] {
  const options = [...NEWS_TIME_ZONES];
  for (const zone of zones) {
    if (zone && isValidTimeZone(zone) && !options.some((entry) => entry.zone === zone)) {
      options.unshift({ zone, city: zoneCity(zone) });
    }
  }
  return options;
}

/* ------------------------------------------------------------------- words */

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/** «21 сентября · понедельник». */
export function dayWords(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} · ${WEEKDAYS[date.getUTCDay()]}`;
}

export function importanceDots(importance: number): string {
  return "●".repeat(Math.max(1, Math.min(3, importance)));
}

export const IMPORTANCE_WORDS: Record<number, string> = {
  1: "низкая важность",
  2: "средняя важность",
  3: "высокая важность",
};

/** «через 12 мин», «через 1 ч 5 мин», «сейчас». */
export function inWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 0) return "сейчас";
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `через ${hours} ч${rest ? ` ${rest} мин` : ""}`;
}

/** «12 мин назад», «1 ч 5 мин назад». */
export function agoWords(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ч${rest ? ` ${rest} мин` : ""} назад`;
}

/* -------------------------------------------------------- the plan's windows */

export function planCovers(event: NewsEvent, plan: Pick<NewsPlan, "minImportance" | "currencies">): boolean {
  return event.importance >= plan.minImportance && plan.currencies.includes(event.currency);
}

export type ClosedWindow = {
  readonly start: number;
  readonly end: number;
  /** The releases that close it, earliest first. */
  readonly events: readonly NewsEvent[];
};

/** Every window the plan closes among `events`, merged where they touch, earliest first. */
export function closedWindows(events: readonly NewsEvent[], plan: NewsPlan | null): ClosedWindow[] {
  if (!plan) return [];
  const raw = events
    .filter((event) => planCovers(event, plan))
    .map((event) => {
      const at = Date.parse(event.releaseAt);
      return { start: at - plan.minutesBefore * 60_000, end: at + plan.minutesAfter * 60_000, events: [event] };
    })
    .sort((left, right) => left.start - right.start);
  const merged: { start: number; end: number; events: NewsEvent[] }[] = [];
  for (const window of raw) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) {
      last.end = Math.max(last.end, window.end);
      last.events.push(...window.events);
    } else merged.push({ ...window, events: [...window.events] });
  }
  return merged;
}

/** The window a release belongs to, if the plan covers it. */
export function windowOf(event: NewsEvent, windows: readonly ClosedWindow[]): ClosedWindow | null {
  return windows.find((window) => window.events.some((candidate) => candidate.slug === event.slug)) ?? null;
}

/* ------------------------------------------------------------ the status */

export type NewsNow =
  | { readonly kind: "no_plan" }
  /** Inside a window: closed until `until`; `next` is the release it waits for, or the latest one passed. */
  | { readonly kind: "closed"; readonly until: number; readonly event: NewsEvent; readonly upcoming: boolean }
  /** Open now; the plan closes entry at `closesAt` for `event`, later today. */
  | { readonly kind: "open_next"; readonly closesAt: number; readonly event: NewsEvent }
  /** Open, and nothing the plan covers is left today. */
  | { readonly kind: "open_clear" };

/** Where the learner stands at `now`, among today's windows. */
export function newsNow(windows: readonly ClosedWindow[], plan: NewsPlan | null, now: number, todayEnd: number): NewsNow {
  if (!plan) return { kind: "no_plan" };
  const inside = windows.find((window) => window.start <= now && now < window.end);
  if (inside) {
    const upcoming = inside.events.find((event) => Date.parse(event.releaseAt) >= now);
    const event = upcoming ?? inside.events[inside.events.length - 1]!;
    return { kind: "closed", until: inside.end, event, upcoming: upcoming !== undefined };
  }
  const next = windows.find((window) => window.start > now && window.start < todayEnd);
  return next ? { kind: "open_next", closesAt: next.start, event: next.events[0]! } : { kind: "open_clear" };
}

/* --------------------------------------------------------------- drafts */

export type NewsPlanDraft = {
  timeZone: string;
  minImportance: number | null;
  minutesBefore: number | null;
  minutesAfter: number | null;
  currencies: string[];
};

export type NewsPlanField = "timeZone" | "minImportance" | "minutesBefore" | "minutesAfter" | "currencies";
export type NewsPlanErrors = Partial<Record<NewsPlanField, string>>;

/** Nothing is chosen for the learner but their own clock's zone. */
export function emptyNewsPlanDraft(zone: string): NewsPlanDraft {
  return { timeZone: zone, minImportance: null, minutesBefore: null, minutesAfter: null, currencies: [] };
}

export function draftOfNewsPlan(plan: NewsPlan): NewsPlanDraft {
  return {
    timeZone: plan.timeZone,
    minImportance: plan.minImportance,
    minutesBefore: plan.minutesBefore,
    minutesAfter: plan.minutesAfter,
    currencies: [...plan.currencies],
  };
}

export function validateNewsPlanDraft(
  draft: NewsPlanDraft,
  reference: NewsReference,
): { ok: true; plan: NewsPlanInput } | { ok: false; errors: NewsPlanErrors } {
  const errors: NewsPlanErrors = {};
  if (!isValidTimeZone(draft.timeZone)) errors.timeZone = "Выберите часовой пояс.";
  if (draft.minImportance === null || !reference.planImportance.includes(draft.minImportance)) {
    errors.minImportance = "Выберите, какие новости закрывают вход.";
  }
  if (draft.minutesBefore === null || !reference.minutes.includes(draft.minutesBefore)) {
    errors.minutesBefore = "Выберите, за сколько минут до выхода вы не входите.";
  }
  if (draft.minutesAfter === null || !reference.minutes.includes(draft.minutesAfter)) {
    errors.minutesAfter = "Выберите, сколько минут после выхода вы только наблюдаете.";
  }
  if (draft.currencies.length === 0) errors.currencies = "Отметьте хотя бы одну валюту своих активов.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      timeZone: draft.timeZone,
      minImportance: draft.minImportance!,
      minutesBefore: draft.minutesBefore!,
      minutesAfter: draft.minutesAfter!,
      currencies: reference.currencies.filter((code) => draft.currencies.includes(code)),
    },
  };
}

export function draftMatchesPlan(draft: NewsPlanDraft, plan: NewsPlan): boolean {
  return (
    draft.timeZone === plan.timeZone &&
    draft.minImportance === plan.minImportance &&
    draft.minutesBefore === plan.minutesBefore &&
    draft.minutesAfter === plan.minutesAfter &&
    draft.currencies.length === plan.currencies.length &&
    plan.currencies.every((code) => draft.currencies.includes(code))
  );
}

/** «Высокая» / «Средняя и высокая», as the plan says it. */
export function planImportanceWords(minImportance: number): string {
  return minImportance >= 3 ? "Только высокая ●●●" : "Средняя и высокая ●● ●●●";
}

/** «USD, EUR · высокая важность · 15 мин до и 15 после». */
export function planSummary(plan: Pick<NewsPlan, "currencies" | "minImportance" | "minutesBefore" | "minutesAfter">): string {
  const importance = plan.minImportance >= 3 ? "высокая важность" : "средняя и высокая важность";
  return `${plan.currencies.join(", ")} · ${importance} · ${plan.minutesBefore} мин до и ${plan.minutesAfter} после`;
}
