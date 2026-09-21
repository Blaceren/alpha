/**
 * TOOLS-V2 — the learner's calendar dates.
 *
 * A trade happens on the learner's own day, in their own time zone, and the
 * server does not know that zone. So a date travels as the learner's calendar
 * date, "YYYY-MM-DD", checked here for being a real date and a plausible one.
 */

export const MIN_TRADE_DATE = "2020-01-01";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date "YYYY-MM-DD", or null. */
export function parseTradeDate(raw: string): string | null {
  const match = DATE_RE.exec(raw);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return raw;
}

/** The UTC calendar date of an instant, "YYYY-MM-DD". */
export function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * A plausible trade date: a real date, not before the floor, and not after
 * tomorrow in UTC — tomorrow covers every time zone ahead of UTC, and a trade
 * is never recorded before it happens.
 */
export function isAcceptableTradeDate(date: string, now: Date): boolean {
  if (parseTradeDate(date) === null) return false;
  if (date < MIN_TRADE_DATE) return false;
  return date <= utcDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
}
