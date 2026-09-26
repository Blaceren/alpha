/**
 * NEWS — what a news item is, how the CRM's form is read, and what each
 * audience is sent.
 *
 * WHO WRITES. Staff with the copywriter role (`news_editor`) and admins, in the
 * CRM (owner, 2026-09-21). Nothing is imported from a calendar API: every item
 * is typed by a person.
 *
 * WHO READS.
 *   - anyone, on the public page of a PUBLISHED item and in the public list —
 *     the pages search engines index in production;
 *   - learners with the News Calendar open (L30), as calendar rows;
 *   - the CRM, everything, drafts included.
 * The public and the learner never see a draft, a staff id or a staff name.
 *
 * PLAIN TEXT ONLY. The body is paragraphs separated by an empty line; no HTML
 * and no markup is stored or interpreted, so a page can never carry script.
 */
import { newsCountryByCode, NEWS_IMPORTANCE } from "./reference";
import { isValidTimeZone, zonedWallTimeToInstant } from "./zoned-time";

/* ------------------------------------------------------------------ errors */

export const NEWS_ERROR_STATUS = {
  NEWS_VALIDATION: 400,
  NEWS_NOT_FOUND: 404,
  /** The item changed since the form was opened; nothing was written. */
  NEWS_STALE: 409,
  NEWS_RATE_LIMITED: 429,
  NEWS_INTERNAL: 500,
} as const;

export type NewsErrorCode = keyof typeof NEWS_ERROR_STATUS;

export class NewsError extends Error {
  readonly code: NewsErrorCode;
  readonly status: number;
  readonly detail: string | null;

  constructor(code: NewsErrorCode, detail?: string) {
    super(code);
    this.name = "NewsError";
    this.code = code;
    this.status = NEWS_ERROR_STATUS[code];
    this.detail = detail ?? null;
  }
}

export function isNewsError(error: unknown): error is NewsError {
  return error instanceof NewsError;
}

/* ------------------------------------------------------------------ limits */

export const NEWS_LIMITS = {
  title: { min: 3, max: 140 },
  summary: { min: 20, max: 300 },
  body: { max: 20_000 },
  value: { max: 24 },
  sourceName: { min: 2, max: 120 },
  sourceUrl: { max: 500 },
  /** A release may be written ahead of time, but not further ahead than this. */
  daysAhead: 400,
  earliestRelease: Date.UTC(2020, 0, 1),
} as const;

export const NEWS_STATUSES = ["draft", "published"] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

/* ----------------------------------------------------------- the CRM form */

/** A news item as the form sends it, checked. The release is one UTC instant. */
export type NewsInput = {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly country: string;
  readonly currency: string;
  readonly importance: number;
  readonly releaseAt: Date;
  readonly forecast: string | null;
  readonly previous: string | null;
  readonly actual: string | null;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
};

// Control characters are never part of a news text; a newline is allowed only in the body.
const CONTROL_EXCEPT_NEWLINE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;

function fail(field: string): never {
  throw new NewsError("NEWS_VALIDATION", `invalid_${field}`);
}

/** One line of text: inner whitespace collapsed, trimmed, bounded. */
function line(raw: unknown, field: string, min: number, max: number): string {
  if (typeof raw !== "string") fail(field);
  // A pasted line break or tab is only whitespace here.
  const flat = raw.replace(/[\t\r\n]/g, " ");
  if (CONTROL_EXCEPT_NEWLINE.test(flat)) fail(field);
  const text = flat.replace(/\s+/g, " ").trim();
  if (text.length < min || text.length > max) fail(field);
  return text;
}

/** An optional short value («0.3%», «215K»); empty means none. */
function optionalValue(raw: unknown, field: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") fail(field);
  if (raw.trim() === "") return null;
  return line(raw, field, 1, NEWS_LIMITS.value.max);
}

/** Paragraphs separated by one empty line; nothing else is kept. */
export function normaliseBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((row) => row.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function body(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") fail("body");
  // Windows line ends and tabs from a pasted document are whitespace, not control characters.
  const text = normaliseBody(raw.replace(/\r\n?/g, "\n").replace(/\t/g, " "));
  if (CONTROL_EXCEPT_NEWLINE.test(text)) fail("body");
  if (text.length > NEWS_LIMITS.body.max) fail("body");
  return text;
}

function source(rawName: unknown, rawUrl: unknown): { sourceName: string | null; sourceUrl: string | null } {
  const noName = rawName === null || rawName === undefined || (typeof rawName === "string" && rawName.trim() === "");
  const noUrl = rawUrl === null || rawUrl === undefined || (typeof rawUrl === "string" && rawUrl.trim() === "");
  if (noName && noUrl) return { sourceName: null, sourceUrl: null };
  if (noName) fail("source_name");
  if (noUrl) fail("source_url");
  const sourceName = line(rawName, "source_name", NEWS_LIMITS.sourceName.min, NEWS_LIMITS.sourceName.max);
  if (typeof rawUrl !== "string") fail("source_url");
  const text = rawUrl.trim();
  if (text.length > NEWS_LIMITS.sourceUrl.max || CONTROL_EXCEPT_NEWLINE.test(text) || /\s/.test(text)) fail("source_url");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    fail("source_url");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "") fail("source_url");
  return { sourceName, sourceUrl: url.toString() };
}

/**
 * The CRM form, read: `{ title, summary, body, country, importance,
 * releaseDate: "YYYY-MM-DD", releaseTime: "HH:MM", timeZone, forecast,
 * previous, actual, sourceName, sourceUrl }`. The release is typed in the time
 * zone the copywriter chose and stored as one instant.
 */
export function parseNewsInput(raw: unknown, now: Date = new Date()): NewsInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("item");
  const input = raw as Record<string, unknown>;

  const title = line(input.title, "title", NEWS_LIMITS.title.min, NEWS_LIMITS.title.max);
  const summary = line(input.summary, "summary", NEWS_LIMITS.summary.min, NEWS_LIMITS.summary.max);

  const country = typeof input.country === "string" ? newsCountryByCode(input.country) : null;
  if (!country) fail("country");

  const importance = input.importance;
  if (typeof importance !== "number" || !NEWS_IMPORTANCE.some((level) => level.value === importance)) fail("importance");

  if (!isValidTimeZone(input.timeZone)) fail("time_zone");
  const instant = zonedWallTimeToInstant(input.releaseDate, input.releaseTime, input.timeZone);
  if (instant === null) fail("release");
  const latest = now.getTime() + NEWS_LIMITS.daysAhead * 24 * 60 * 60 * 1000;
  if (instant < NEWS_LIMITS.earliestRelease || instant > latest) fail("release");

  return {
    title,
    summary,
    body: body(input.body),
    country: country.code,
    currency: country.currency,
    importance,
    releaseAt: new Date(instant),
    forecast: optionalValue(input.forecast, "forecast"),
    previous: optionalValue(input.previous, "previous"),
    actual: optionalValue(input.actual, "actual"),
    ...source(input.sourceName, input.sourceUrl),
  };
}

/* -------------------------------------------------------------- the rows */

/** The columns every audience's shape is built from (a `NewsItem` row). */
export type NewsRow = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly country: string;
  readonly currency: string;
  readonly importance: number;
  readonly releaseAt: Date;
  readonly forecast: string | null;
  readonly previous: string | null;
  readonly actual: string | null;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly status: string;
  readonly publishedAt: Date | null;
  readonly firstPublishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

function countryLabel(code: string): string {
  return newsCountryByCode(code)?.label ?? code;
}

/** A calendar row: what the learner's day and the public list show. */
export function toNewsEventDto(row: NewsRow) {
  return {
    slug: row.slug,
    title: row.title,
    country: row.country,
    countryLabel: countryLabel(row.country),
    currency: row.currency,
    importance: row.importance,
    releaseAt: row.releaseAt.toISOString(),
    forecast: row.forecast,
    previous: row.previous,
    actual: row.actual,
  };
}

export type NewsEventDto = ReturnType<typeof toNewsEventDto>;

/** The public page of a published item. No staff, no draft, no id. */
export function toPublicNewsDto(row: NewsRow) {
  return {
    ...toNewsEventDto(row),
    summary: row.summary,
    paragraphs: row.body === "" ? [] : row.body.split("\n\n"),
    source: row.sourceName && row.sourceUrl ? { name: row.sourceName, url: row.sourceUrl } : null,
    publishedAt: (row.firstPublishedAt ?? row.publishedAt ?? row.updatedAt).toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type PublicNewsDto = ReturnType<typeof toPublicNewsDto>;

/**
 * Everything the CRM's editor needs. The release travels as one instant; the
 * editor shows it in whatever zone the copywriter picks. `publicUrl` is the
 * page's address on the public origin while the item is published, else null.
 */
export function toCrmNewsDto(row: NewsRow, publicOrigin: string | null) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    country: row.country,
    countryLabel: countryLabel(row.country),
    currency: row.currency,
    importance: row.importance,
    releaseAt: row.releaseAt.toISOString(),
    forecast: row.forecast,
    previous: row.previous,
    actual: row.actual,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    status: row.status as NewsStatus,
    /** The address is fixed once the item has been published. */
    slugLocked: row.firstPublishedAt !== null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publicUrl: row.status === "published" && publicOrigin ? `${publicOrigin}/news/${row.slug}` : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CrmNewsDto = ReturnType<typeof toCrmNewsDto>;
