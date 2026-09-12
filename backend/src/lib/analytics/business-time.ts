/**
 * AFD-5B1 — the single owner of business-calendar time for affiliate analytics.
 *
 * WHY THIS EXISTS AT ALL. Every number this phase reports is "how many events
 * happened on a DAY", and a day is a local calendar fact, not a UTC one. A
 * deposit at 01:30 Moscow on the 1st is 22:30 UTC on the previous day; reporting
 * it under the wrong date is not a rounding error, it is the wrong answer to the
 * only question an affiliate manager asks. So the calendar is resolved here,
 * once, in ONE named timezone, and every endpoint converts to UTC before it
 * touches the database.
 *
 * WHAT IS STORED VS WHAT IS REPORTED. Database timestamps stay UTC and are never
 * rewritten. This module only decides which UTC half-open interval a named local
 * period corresponds to, and which local label a bucket carries.
 *
 * NO SERVER-LOCAL TIME. Nothing here reads the host timezone. `Date.getDay`,
 * `getHours`, `toLocaleString` without an explicit zone and similar host-local
 * accessors are deliberately absent: a report must not change because an
 * operator restarted the process in a different `TZ`.
 *
 * NO CLIENT-CHOSEN TIMEZONE. The zone comes from configuration only. A request
 * parameter that could reframe every boundary would make two operators reading
 * "yesterday" see different numbers and would let a caller shop for a window.
 */

export const BUSINESS_TIMEZONE_KEY = "ATA_BUSINESS_TIMEZONE";

/** The product's business calendar. Moscow has had no DST since 2014. */
export const DEFAULT_BUSINESS_TIMEZONE = "Europe/Moscow";

/** Stated in every response so a reader never has to guess the edge rule. */
export const INTERVAL_CONVENTION = "start_inclusive_end_exclusive";

/** Weeks begin on Monday. Not configurable — it is a product contract. */
export const WEEK_START = "monday";

/**
 * Configuration is invalid, so the request fails CLOSED.
 *
 * Deliberately not a silent fallback to UTC: a deployment that mistyped its zone
 * would then publish plausible numbers on the wrong day boundaries, which is the
 * one failure mode nobody would notice.
 */
export class AnalyticsTimeConfigError extends Error {
  readonly code = "analytics_timezone_invalid";
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsTimeConfigError";
  }
}

/**
 * Resolve the configured zone to its canonical IANA spelling, or refuse.
 *
 * Validated against `Intl.supportedValuesOf`, so only a zone this runtime can
 * actually compute with is accepted. A raw UTC offset such as `+03:00` is
 * refused on purpose: an offset cannot express a DST rule, and accepting one
 * would quietly produce a calendar that is right today and wrong in October.
 */
export function resolveBusinessTimezone(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[BUSINESS_TIMEZONE_KEY];
  if (raw === undefined) return DEFAULT_BUSINESS_TIMEZONE;

  const wanted = raw.trim();
  if (wanted.length === 0) {
    throw new AnalyticsTimeConfigError(`${BUSINESS_TIMEZONE_KEY} is set but empty`);
  }
  if (wanted.toUpperCase() === "UTC") return "UTC";

  const supported = Intl.supportedValuesOf("timeZone");
  const match = supported.find((zone) => zone.toLowerCase() === wanted.toLowerCase());
  if (match === undefined) {
    // The rejected value is NOT echoed: configuration text is operator input and
    // this message reaches logs.
    throw new AnalyticsTimeConfigError(`${BUSINESS_TIMEZONE_KEY} is not a supported IANA timezone`);
  }
  return match;
}

/* ------------------------------------------------------------ local parts */

/** A wall-clock reading in some zone. Month is 1-12, matching how humans write. */
export type LocalParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // h23 rather than hour12:false, so midnight reads as 00 and never as 24.
    hourCycle: "h23",
  });
  formatters.set(timeZone, created);
  return created;
}

/** The wall-clock reading in `timeZone` at a given instant. */
export function toLocalParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new AnalyticsTimeConfigError(`timezone ${timeZone} produced no ${type}`);
    return Number(found.value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** The zone's UTC offset, in milliseconds, at a given instant. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const local = toLocalParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  // The formatter has second resolution, so compare against a floored instant.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which a given local wall-clock reading occurs.
 *
 * TWO PASSES, NOT ONE. The offset depends on the instant, and the instant is
 * what we are solving for. The first pass guesses using the offset that applies
 * at the same numbers read as UTC; the second re-reads the offset at the guess.
 * For a zone without DST the second pass changes nothing, and for one with DST
 * it is what stops a boundary near a transition landing an hour out.
 */
export function localWallClockToUtc(parts: LocalParts, timeZone: string): Date {
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const firstPass = target - offsetMsAt(new Date(target), timeZone);
  const secondPass = target - offsetMsAt(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/* -------------------------------------------------- calendar field maths */

/** Midnight of a local calendar date, as local parts. */
export function atLocalMidnight(parts: LocalParts): LocalParts {
  return { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 };
}

/**
 * Add whole calendar days.
 *
 * Performed on the DATE FIELDS through `Date.UTC`, which normalises overflow
 * (32 January becomes 1 February) without any timezone being involved. Adding
 * `n * 86_400_000` to an instant instead would be wrong across a DST boundary.
 */
export function addLocalDays(parts: LocalParts, days: number): LocalParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Add whole calendar months, clamping to the shorter month's last day. */
export function addLocalMonths(parts: LocalParts, months: number): LocalParts {
  const target = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    day: Math.min(parts.day, lastDay),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Monday = 0 … Sunday = 6, from the calendar date alone. */
export function mondayIndex(parts: LocalParts): number {
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return (weekday + 6) % 7;
}

/** Midnight on the Monday that opens this local week. */
export function startOfLocalWeek(parts: LocalParts): LocalParts {
  return atLocalMidnight(addLocalDays(parts, -mondayIndex(parts)));
}

/** Midnight on the first day of this local month. */
export function startOfLocalMonth(parts: LocalParts): LocalParts {
  return { year: parts.year, month: parts.month, day: 1, hour: 0, minute: 0, second: 0 };
}

/* ----------------------------------------------------------------- labels */

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** `YYYY-MM-DD` for a local calendar date. */
export function localDateLabel(parts: LocalParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** `YYYY-MM` for a local calendar month. */
export function localMonthLabel(parts: LocalParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}`;
}

/**
 * `YYYY-MM-DDTHH:MM:SS` — a local wall-clock reading with NO offset suffix.
 *
 * The absence of a `Z` or `+03:00` is deliberate: this string is the local
 * calendar face of a boundary, and the response carries the UTC instant and the
 * timezone name separately. Writing an offset here would invite a reader to
 * parse it as an instant and get two sources of truth.
 */
export function localWallClockLabel(parts: LocalParts): string {
  return `${localDateLabel(parts)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/* --------------------------------------------------------- strict parsing */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a strict `YYYY-MM-DD` calendar date, or return null.
 *
 * REJECTS IMPOSSIBLE DATES by round-tripping through `Date.UTC`: `2026-02-30`
 * parses as three integers but does not survive normalisation, so it is refused
 * rather than silently becoming 2 March. Also refuses anything carrying a time,
 * an offset or a `Z` — the custom-range contract is date-only, and accepting a
 * timestamp would mean two callers disagree about which day the edge belongs to.
 */
export function parseLocalDateOnly(raw: string): LocalParts | null {
  const match = DATE_ONLY.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const normalised = new Date(Date.UTC(year, month - 1, day));
  if (
    normalised.getUTCFullYear() !== year ||
    normalised.getUTCMonth() + 1 !== month ||
    normalised.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}
