/**
 * TOOLS-V2 NEWS — the CRM editor's model: routes, time zones, labels and the
 * form. No React and no requests.
 *
 * THE RELEASE IS ONE INSTANT. The copywriter types a date and a time in a zone
 * they choose; the backend stores the instant and every reader shows it in
 * their own zone. The conversion here mirrors the backend's `zoned-time.ts`
 * and is used only to show the copywriter what they are about to save; the
 * backend repeats it and is the one that decides.
 */
import type { NewsItem, NewsStatus } from "@/data/contracts/api/news";
import type { NewsForm } from "@/application/api/news-client";

export const NEWS_PATH = "/news";
export const NEWS_NEW_PATH = "/news/new";
export function newsItemPath(id: string): string {
  return `${NEWS_PATH}/${encodeURIComponent(id)}`;
}

export const NEWS_STATUS_LABEL: Record<NewsStatus, string> = {
  draft: "Черновик",
  published: "Опубликована",
};

/* -------------------------------------------------------------- time zones */

/** The zones a copywriter usually types releases in; the browser's own is added when missing. */
export const EDITOR_TIME_ZONES: readonly { zone: string; city: string }[] = [
  { zone: "Europe/Warsaw", city: "Варшава" },
  { zone: "Europe/Moscow", city: "Москва" },
  { zone: "Europe/Kyiv", city: "Киев" },
  { zone: "Europe/London", city: "Лондон" },
  { zone: "UTC", city: "UTC" },
  { zone: "America/New_York", city: "Нью-Йорк" },
  { zone: "Asia/Tokyo", city: "Токио" },
];

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

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

function wallAsUtc(instant: number, zone: string): number {
  const parts = partsFormatter(zone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"));
}

/** The instant a clock in `zone` shows `date` `time`, or null when that wall time does not exist there. */
export function zonedWallTimeToInstant(date: string, time: string, zone: string): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!day || !clock || !isValidTimeZone(zone)) return null;
  const wall = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clock[1]), Number(clock[2]));
  const check = new Date(wall);
  if (check.getUTCDate() !== Number(day[3]) || check.getUTCMonth() !== Number(day[2]) - 1) return null;
  const offset = (instant: number) => wallAsUtc(instant, zone) - Math.floor(instant / 60_000) * 60_000;
  const instant = wall - offset(wall - offset(wall));
  return wallAsUtc(instant, zone) === wall ? instant : null;
}

/** What a clock in `zone` shows at `instant`: "2026-09-21", "14:30". */
export function instantToZonedWallTime(instant: number, zone: string): { date: string; time: string } {
  const wall = new Date(wallAsUtc(instant, zone)).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

/** «Варшава · UTC+2» at the given instant (summer and winter differ). */
export function zoneLabel(zone: string, instant: number = Date.now()): string {
  const city = EDITOR_TIME_ZONES.find((entry) => entry.zone === zone)?.city ?? zone.split("/").pop()!.replace(/_/g, " ");
  if (zone === "UTC") return "UTC";
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")?.value;
    return `${city} · ${(offset ?? "GMT").replace("GMT", "UTC")}`.replace(/UTC$/, "UTC+0");
  } catch {
    return city;
  }
}

/** «21 сент., 14:30» in `zone`. */
export function releaseWords(iso: string, zone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    date,
  );
  return `${day}, ${time}`;
}

/* ----------------------------------------------------------- importance */

export function importanceDots(importance: number): string {
  return "●".repeat(Math.max(1, Math.min(3, importance)));
}

export const IMPORTANCE_WORDS: Record<number, string> = {
  1: "низкая важность",
  2: "средняя важность",
  3: "высокая важность",
};

/* ------------------------------------------------------------------ form */

export const NEWS_FORM_LIMITS = {
  title: { min: 3, max: 140 },
  summary: { min: 20, max: 300 },
  body: 20_000,
  value: 24,
  sourceName: 120,
  sourceUrl: 500,
} as const;

export function emptyNewsForm(zone: string, today: string): NewsForm {
  return {
    title: "",
    summary: "",
    body: "",
    country: "US",
    importance: 3,
    releaseDate: today,
    releaseTime: "",
    timeZone: zone,
    forecast: "",
    previous: "",
    actual: "",
    sourceName: "",
    sourceUrl: "",
  };
}

/** The saved item as the form shows it, with the release on the chosen zone's clock. */
export function formFromItem(item: NewsItem, zone: string): NewsForm {
  const release = instantToZonedWallTime(Date.parse(item.releaseAt), zone);
  return {
    title: item.title,
    summary: item.summary,
    body: item.body,
    country: item.country,
    importance: item.importance,
    releaseDate: release.date,
    releaseTime: release.time,
    timeZone: zone,
    forecast: item.forecast ?? "",
    previous: item.previous ?? "",
    actual: item.actual ?? "",
    sourceName: item.sourceName ?? "",
    sourceUrl: item.sourceUrl ?? "",
  };
}

/** Whether the form says something the saved item does not. The zone alone changes nothing. */
export function isFormChanged(form: NewsForm, item: NewsItem): boolean {
  const saved = formFromItem(item, form.timeZone);
  return (Object.keys(saved) as (keyof NewsForm)[]).some((key) => {
    if (key === "timeZone") return false;
    const now = form[key];
    const was = saved[key];
    return typeof now === "string" && typeof was === "string" ? now.trim() !== was.trim() : now !== was;
  });
}

export type NewsField =
  | "title"
  | "summary"
  | "body"
  | "country"
  | "importance"
  | "release"
  | "timeZone"
  | "forecast"
  | "previous"
  | "actual"
  | "sourceName"
  | "sourceUrl";

/** What the copywriter must fix before saving, in the order of the form. */
export function checkNewsForm(form: NewsForm): Partial<Record<NewsField, string>> {
  const errors: Partial<Record<NewsField, string>> = {};
  const length = (value: string) => value.trim().replace(/\s+/g, " ").length;
  if (!isValidTimeZone(form.timeZone)) errors.timeZone = "Выберите часовой пояс.";
  if (!form.releaseDate || !form.releaseTime) errors.release = "Укажите дату и время выхода.";
  else if (zonedWallTimeToInstant(form.releaseDate, form.releaseTime, form.timeZone) === null) {
    errors.release = "Такого времени в этом поясе нет — в эту ночь переводят часы.";
  }
  if (length(form.title) < NEWS_FORM_LIMITS.title.min) errors.title = "Напишите название события.";
  else if (length(form.title) > NEWS_FORM_LIMITS.title.max) errors.title = `Не длиннее ${NEWS_FORM_LIMITS.title.max} символов.`;
  if (length(form.summary) < NEWS_FORM_LIMITS.summary.min) {
    errors.summary = `Хотя бы ${NEWS_FORM_LIMITS.summary.min} символов: лид — первые строки страницы и её описание для поисковиков.`;
  } else if (length(form.summary) > NEWS_FORM_LIMITS.summary.max) {
    errors.summary = `Не длиннее ${NEWS_FORM_LIMITS.summary.max} символов.`;
  }
  if (form.body.length > NEWS_FORM_LIMITS.body) errors.body = `Не длиннее ${NEWS_FORM_LIMITS.body} символов.`;
  for (const key of ["forecast", "previous", "actual"] as const) {
    if (length(form[key]) > NEWS_FORM_LIMITS.value) errors[key] = `Коротко, до ${NEWS_FORM_LIMITS.value} символов: «0.3%», «215K».`;
  }
  const hasName = form.sourceName.trim() !== "";
  const hasUrl = form.sourceUrl.trim() !== "";
  if (hasName && !hasUrl) errors.sourceUrl = "Добавьте адрес источника или уберите название.";
  if (hasUrl && !hasName) errors.sourceName = "Добавьте название источника или уберите адрес.";
  if (hasUrl && !/^https:\/\/[^\s/]+\S*$/.test(form.sourceUrl.trim())) {
    errors.sourceUrl = "Адрес источника начинается с https://";
  }
  return errors;
}

/** The backend's `invalid_<field>` refusal, pointed at the field it names. */
export function fieldForRefusal(detail: string | null): { field: NewsField | null; message: string } {
  const map: Record<string, [NewsField, string]> = {
    invalid_title: ["title", "Название не подходит: 3–140 символов, без служебных знаков."],
    invalid_summary: ["summary", "Лид не подходит: 20–300 символов."],
    invalid_body: ["body", "Текст не подходит: до 20 000 символов, без служебных знаков."],
    invalid_country: ["country", "Выберите страну из списка."],
    invalid_importance: ["importance", "Выберите важность."],
    invalid_time_zone: ["timeZone", "Выберите часовой пояс из списка."],
    invalid_release: ["release", "Дата выхода не подходит: не раньше 2020 года и не дальше чем через 400 дней."],
    invalid_forecast: ["forecast", "Прогноз — коротко, до 24 символов."],
    invalid_previous: ["previous", "Предыдущее значение — коротко, до 24 символов."],
    invalid_actual: ["actual", "Факт — коротко, до 24 символов."],
    invalid_source_name: ["sourceName", "Название источника: 2–120 символов."],
    invalid_source_url: ["sourceUrl", "Адрес источника начинается с https:// и не содержит логина и пароля."],
  };
  const known = detail ? map[detail] : undefined;
  if (known) return { field: known[0], message: known[1] };
  if (detail === "body_too_large") return { field: "body", message: "Текст слишком большой для одной новости." };
  return { field: null, message: "Новость не сохранилась: проверьте поля и попробуйте ещё раз." };
}
