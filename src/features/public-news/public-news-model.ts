/**
 * NEWS — the public pages' model: what the Backend sends, checked, and the
 * words and addresses the pages are written with. No React and no requests.
 *
 * TIME ON A PUBLIC PAGE. A release happens at one instant everywhere, and the
 * page is read in every time zone, so the server writes it in UTC and says so;
 * the browser adds the reader's own clock after it arrives.
 */

export type PublicNewsEvent = {
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

export type PublicNewsListItem = PublicNewsEvent & { readonly summary: string };

export type PublicNewsListAnswer = {
  readonly upcoming: readonly PublicNewsListItem[];
  readonly past: readonly PublicNewsListItem[];
  readonly page: number;
  readonly pageCount: number;
};

export type PublicNewsItem = PublicNewsEvent & {
  readonly summary: string;
  readonly paragraphs: readonly string[];
  readonly source: { readonly name: string; readonly url: string } | null;
  readonly publishedAt: string;
  readonly updatedAt: string;
};

export type PublicNewsItemAnswer = {
  readonly item: PublicNewsItem;
  readonly others: readonly PublicNewsEvent[];
};

/** The answer as a page draws it: whether the release has come out, as of the read. */
export type PublicNewsItemView = PublicNewsItemAnswer & { readonly released: boolean };

/* ----------------------------------------------------------------- guards */

const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown) => value === null || typeof value === "string";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const NEWS_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isEvent(value: unknown): value is PublicNewsEvent {
  if (!isRecord(value)) return false;
  return (
    isString(value.slug) &&
    NEWS_SLUG_RE.test(value.slug) &&
    isString(value.title) &&
    isString(value.country) &&
    isString(value.countryLabel) &&
    isString(value.currency) &&
    typeof value.importance === "number" &&
    [1, 2, 3].includes(value.importance) &&
    isString(value.releaseAt) &&
    !Number.isNaN(Date.parse(value.releaseAt)) &&
    isNullableString(value.forecast) &&
    isNullableString(value.previous) &&
    isNullableString(value.actual)
  );
}

function isListItem(value: unknown): value is PublicNewsListItem {
  return isEvent(value) && isString((value as Record<string, unknown>).summary);
}

export function isPublicNewsListAnswer(value: unknown): value is PublicNewsListAnswer {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.upcoming) &&
    value.upcoming.every(isListItem) &&
    Array.isArray(value.past) &&
    value.past.every(isListItem) &&
    Number.isInteger(value.page) &&
    Number.isInteger(value.pageCount)
  );
}

export function isPublicNewsItemAnswer(value: unknown): value is PublicNewsItemAnswer {
  if (!isRecord(value) || !isRecord(value.item) || !Array.isArray(value.others)) return false;
  const item: Record<string, unknown> = value.item;
  const source = item.source;
  return (
    isEvent(value.item) &&
    isString(item.summary) &&
    Array.isArray(item.paragraphs) &&
    item.paragraphs.every(isString) &&
    (source === null || (isRecord(source) && isString(source.name) && isString(source.url) && source.url.startsWith("https://"))) &&
    isString(item.publishedAt) &&
    isString(item.updatedAt) &&
    value.others.every(isEvent)
  );
}

/* ----------------------------------------------------------- addresses */

export const NEWS_LIST_PATH = "/news";

export function newsPath(slug: string): string {
  return `${NEWS_LIST_PATH}/${slug}`;
}

/** `?page=N`: a whole number from 1 to 1000, or null for anything else. */
export function parseNewsPage(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1;
  if (Array.isArray(raw) || !/^[1-9]\d{0,3}$/.test(raw) || Number(raw) > 1000) return null;
  return Number(raw);
}

/* ------------------------------------------------------------ words */

const DAY = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const DAY_SHORT = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long" });
const WEEKDAY = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", weekday: "long" });
const TIME = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** «21 сентября 2026» — the UTC calendar day of the release. */
export function releaseDayWords(iso: string): string {
  return DAY.format(new Date(iso)).replace(/\s*г\.$/, "");
}

/** «12:30 UTC». */
export function releaseTimeUtc(iso: string): string {
  return `${TIME.format(new Date(iso))} UTC`;
}

export const IMPORTANCE_WORDS: Record<number, string> = {
  1: "Низкая важность",
  2: "Средняя важность",
  3: "Высокая важность",
};

export function importanceDots(importance: number): string {
  return "●".repeat(Math.max(1, Math.min(3, importance)));
}

/** The list grouped by UTC day, in the order given; each group says «21 сентября · понедельник». */
export function groupByDay<T extends PublicNewsEvent>(items: readonly T[]): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const key = item.releaseAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else {
      const date = new Date(item.releaseAt);
      groups.push({ key, label: `${DAY_SHORT.format(date)} · ${WEEKDAY.format(date)}`, items: [item] });
    }
  }
  return groups;
}

/* ----------------------------------------------------- structured data */

/**
 * schema.org NewsArticle for a published page. The publisher is the Academy;
 * no staff member is ever named.
 */
export function newsArticleJsonLd(item: PublicNewsItem, url: string, origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: `${item.countryLabel}: ${item.title}`.slice(0, 110),
    description: item.summary,
    datePublished: item.publishedAt,
    dateModified: item.updatedAt,
    mainEntityOfPage: url,
    url,
    inLanguage: "ru",
    author: { "@type": "Organization", name: "Alfa Trade Academy", url: origin },
    publisher: { "@type": "Organization", name: "Alfa Trade Academy", url: origin },
  };
}

/** JSON for an inline <script>: `<` is escaped, so no text can close the tag. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
