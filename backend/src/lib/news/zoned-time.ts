/**
 * NEWS — wall-clock time in an IANA time zone, and back, with nothing but Intl.
 *
 * A news item is released at one instant everywhere. The copywriter types the
 * release as a date and a time in a time zone they choose; the learner reads it
 * in their own. Both directions go through the time zone database the runtime
 * carries, so summer time is never computed by hand.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** "Europe/Warsaw", "America/Argentina/Buenos_Aires", "UTC", "Etc/GMT+3". */
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
      second: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** A time zone the runtime knows, spelled as an IANA name. */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64 || !ZONE_RE.test(zone)) return false;
  try {
    partsFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

export type WallParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

/** What a clock in `zone` shows at `instant` (epoch milliseconds). */
export function wallParts(instant: number, zone: string): WallParts {
  const parts = partsFormatter(zone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

function wallAsUtc(parts: WallParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

/** The zone's offset from UTC at `instant`, in milliseconds (Warsaw in summer: +2 h). */
function offsetAt(instant: number, zone: string): number {
  return wallAsUtc(wallParts(instant, zone)) - Math.floor(instant / 60_000) * 60_000;
}

/** "YYYY-MM-DD" as numbers, or null for anything that is not a real date. */
export function parseCalendarDate(raw: unknown): { year: number; month: number; day: number } | null {
  if (typeof raw !== "string") return null;
  const match = DATE_RE.exec(raw);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * The instant a clock in `zone` shows `date` `time` ("2026-09-21", "14:30").
 * Null when the input is not a real date, time or zone, or when that wall time
 * does not exist there (the hour skipped when summer time starts).
 */
export function zonedWallTimeToInstant(date: unknown, time: unknown, zone: unknown): number | null {
  const day = parseCalendarDate(date);
  const clock = typeof time === "string" ? TIME_RE.exec(time) : null;
  if (!day || !clock || !isValidTimeZone(zone)) return null;
  const wall = Date.UTC(day.year, day.month - 1, day.day, Number(clock[1]), Number(clock[2]));
  // Two passes: the offset at the first guess can differ from the offset at the answer near a change.
  const guess = wall - offsetAt(wall, zone);
  const instant = wall - offsetAt(guess, zone);
  return wallAsUtc(wallParts(instant, zone)) === wall ? instant : null;
}

/** The date and time a clock in `zone` shows at `instant`: "2026-09-21", "14:30". */
export function instantToZonedWallTime(instant: number, zone: string): { date: string; time: string } {
  const parts = wallParts(instant, zone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}
