/**
 * The News Calendar client: its path and the shapes it guards. The transport is
 * the tools' shared one (`tools-client-core.ts`).
 */
import { PROXY_BASE, isNullableString, isRecord, toolGet, toolSend, type ToolResult } from "../tools-client-core";
import type { NewsCalendarState, NewsEvent, NewsPlan, NewsPlanInput, NewsReference } from "./news-model";

const NEWS_PATH = `${PROXY_BASE}/tools/news-calendar`;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isInstant = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

export function isNewsEvent(value: unknown): value is NewsEvent {
  return (
    isRecord(value) &&
    typeof value.slug === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) &&
    typeof value.title === "string" &&
    typeof value.country === "string" &&
    typeof value.countryLabel === "string" &&
    typeof value.currency === "string" &&
    isCount(value.importance) &&
    value.importance >= 1 &&
    value.importance <= 3 &&
    isInstant(value.releaseAt) &&
    isNullableString(value.forecast) &&
    isNullableString(value.previous) &&
    isNullableString(value.actual)
  );
}

export function isNewsPlan(value: unknown): value is NewsPlan {
  return (
    isRecord(value) &&
    isCount(value.version) &&
    typeof value.timeZone === "string" &&
    isCount(value.minImportance) &&
    isCount(value.minutesBefore) &&
    isCount(value.minutesAfter) &&
    isStringList(value.currencies) &&
    isInstant(value.savedAt)
  );
}

function isReference(value: unknown): value is NewsReference {
  return (
    isRecord(value) &&
    isStringList(value.currencies) &&
    value.currencies.length > 0 &&
    Array.isArray(value.countries) &&
    value.countries.every(
      (country) =>
        isRecord(country) &&
        typeof country.code === "string" &&
        typeof country.label === "string" &&
        typeof country.currency === "string",
    ) &&
    Array.isArray(value.importance) &&
    value.importance.every((level) => isRecord(level) && isCount(level.value) && typeof level.label === "string") &&
    Array.isArray(value.minutes) &&
    value.minutes.length > 0 &&
    value.minutes.every(isCount) &&
    Array.isArray(value.planImportance) &&
    value.planImportance.length > 0 &&
    value.planImportance.every(isCount)
  );
}

export function isNewsCalendarState(value: unknown): value is NewsCalendarState {
  return (
    isRecord(value) &&
    (value.plan === null || isNewsPlan(value.plan)) &&
    isRecord(value.window) &&
    isInstant(value.window.from) &&
    isInstant(value.window.to) &&
    Array.isArray(value.events) &&
    value.events.every(isNewsEvent) &&
    isReference(value.reference)
  );
}

/** What a save answers: the plan in force. */
function isSavedPlan(value: unknown): value is { plan: NewsPlan | null } {
  return isRecord(value) && (value.plan === null || isNewsPlan(value.plan));
}

/** The first read (now ± 36 h), or one day of the learner's calendar. */
export function newsCalendarPath(window: { from: number; to: number } | null): string {
  if (!window) return NEWS_PATH;
  const params = new URLSearchParams({ from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString() });
  return `${NEWS_PATH}?${params.toString()}`;
}

export function fetchNewsCalendar(window: { from: number; to: number } | null): Promise<ToolResult<NewsCalendarState>> {
  return toolGet(newsCalendarPath(window), isNewsCalendarState);
}

/** «Сохранить план»: a new version, unless the plan in force already says this. */
export function saveNewsPlan(plan: NewsPlanInput): Promise<ToolResult<{ plan: NewsPlan | null }>> {
  return toolSend("POST", NEWS_PATH, { plan }, isSavedPlan);
}
