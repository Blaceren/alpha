import { describe, expect, it } from "vitest";
import {
  addDays,
  closedWindows,
  dayBounds,
  dayIn,
  dayWords,
  draftMatchesPlan,
  draftOfNewsPlan,
  emptyNewsPlanDraft,
  inWords,
  agoWords,
  newsNow,
  offsetWords,
  planSummary,
  timeIn,
  timelineRange,
  validateNewsPlanDraft,
  zoneOptions,
  zoneWords,
  zonedWallTimeToInstant,
  type NewsEvent,
  type NewsPlan,
  type NewsReference,
} from "./news-model";

const REFERENCE: NewsReference = {
  currencies: ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY"],
  countries: [],
  importance: [],
  minutes: [5, 10, 15, 30, 60],
  planImportance: [3, 2],
};

/** The presentation's plan: USD and EUR, high importance, ±15 min, Warsaw. */
const PLAN: NewsPlan = {
  version: 1,
  timeZone: "Europe/Warsaw",
  minImportance: 3,
  minutesBefore: 15,
  minutesAfter: 15,
  currencies: ["USD", "EUR"],
  savedAt: "2026-09-20T10:00:00.000Z",
};

function event(time: string, currency: string, importance: number, slug = `${currency}-${time}`): NewsEvent {
  return {
    slug: slug.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: `${currency} ${time}`,
    country: "US",
    countryLabel: "США",
    currency,
    importance,
    releaseAt: new Date(zonedWallTimeToInstant("2026-09-21", time, "Europe/Warsaw")!).toISOString(),
    forecast: null,
    previous: null,
    actual: null,
  };
}

/** The presentation's day: GBP 08:00, EUR 11:00, USD 14:30 (Warsaw). */
const DAY = [event("08:00", "GBP", 3), event("11:00", "EUR", 2), event("14:30", "USD", 3)];
const at = (time: string) => zonedWallTimeToInstant("2026-09-21", time, "Europe/Warsaw")!;

describe("the learner's day in their zone", () => {
  it("reads the day on the zone's clock", () => {
    const instant = Date.parse("2026-09-21T23:30:00Z");
    expect(dayIn(instant, "Europe/Warsaw")).toBe("2026-09-22");
    expect(dayIn(instant, "America/New_York")).toBe("2026-09-21");
    expect(timeIn(instant, "Asia/Tokyo")).toBe("08:30");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("runs midnight to midnight, 23 or 25 hours on the summer-time days", () => {
    const plain = dayBounds("2026-09-21", "Europe/Warsaw");
    expect(new Date(plain.from).toISOString()).toBe("2026-09-20T22:00:00.000Z");
    expect(plain.to - plain.from).toBe(24 * 3_600_000);
    const spring = dayBounds("2026-03-29", "Europe/Warsaw");
    expect(spring.to - spring.from).toBe(23 * 3_600_000);
    const autumn = dayBounds("2026-10-25", "Europe/Warsaw");
    expect(autumn.to - autumn.from).toBe(25 * 3_600_000);
  });

  it("names zones with their offset at that moment", () => {
    expect(offsetWords("Europe/Warsaw", at("12:00"))).toBe("UTC+2");
    expect(offsetWords("America/New_York", at("12:00"))).toBe("UTC−4");
    expect(offsetWords("Asia/Kolkata", at("12:00"))).toBe("UTC+5:30");
    expect(zoneWords("Europe/Warsaw", at("12:00"))).toBe("Варшава · UTC+2");
    expect(zoneWords("UTC", at("12:00"))).toBe("UTC");
    expect(zoneOptions("America/Chicago")[0]).toEqual({ zone: "America/Chicago", city: "Chicago" });
    expect(zoneOptions("Europe/Warsaw").filter((option) => option.zone === "Europe/Warsaw")).toHaveLength(1);
  });

  it("writes the day, and the time to and since a release", () => {
    expect(dayWords("2026-09-21")).toBe("21 сентября · понедельник");
    expect(inWords(12 * 60_000)).toBe("через 12 мин");
    expect(inWords(65 * 60_000)).toBe("через 1 ч 5 мин");
    expect(agoWords(3 * 60_000)).toBe("3 мин назад");
  });
});

describe("the windows the plan closes", () => {
  it("covers only the plan's currencies at or above its importance", () => {
    const windows = closedWindows(DAY, PLAN);
    expect(windows).toHaveLength(1);
    expect(timeIn(windows[0]!.start, "Europe/Warsaw")).toBe("14:15");
    expect(timeIn(windows[0]!.end, "Europe/Warsaw")).toBe("14:45");
    expect(closedWindows(DAY, { ...PLAN, minImportance: 2 })).toHaveLength(2);
    expect(closedWindows(DAY, null)).toEqual([]);
  });

  it("merges windows that touch into one", () => {
    const busy = [event("14:30", "USD", 3), event("14:50", "USD", 3, "usd-b"), event("16:00", "USD", 3, "usd-c")];
    const windows = closedWindows(busy, PLAN);
    expect(windows).toHaveLength(2);
    expect(timeIn(windows[0]!.start, "Europe/Warsaw")).toBe("14:15");
    expect(timeIn(windows[0]!.end, "Europe/Warsaw")).toBe("15:05");
    expect(windows[0]!.events).toHaveLength(2);
  });
});

describe("where the learner stands now — the presentation's line", () => {
  const windows = closedWindows(DAY, PLAN);
  const end = dayBounds("2026-09-21", "Europe/Warsaw").to;

  it("says the entry is closed until 14:45, twelve minutes before the release", () => {
    const now = newsNow(windows, PLAN, at("14:18"), end);
    expect(now).toMatchObject({ kind: "closed", upcoming: true });
    if (now.kind !== "closed") throw new Error("closed");
    expect(timeIn(now.until, "Europe/Warsaw")).toBe("14:45");
    expect(now.event.currency).toBe("USD");
    expect(inWords(Date.parse(now.event.releaseAt) - at("14:18"))).toBe("через 12 мин");
  });

  it("keeps it closed after the release until the window ends", () => {
    expect(newsNow(windows, PLAN, at("14:40"), end)).toMatchObject({ kind: "closed", upcoming: false });
  });

  it("says when the plan will close entry next", () => {
    const now = newsNow(windows, PLAN, at("12:00"), end);
    if (now.kind !== "open_next") throw new Error("open_next");
    expect(timeIn(now.closesAt, "Europe/Warsaw")).toBe("14:15");
  });

  it("says the day is clear, and that there is no plan yet", () => {
    expect(newsNow(windows, PLAN, at("15:00"), end).kind).toBe("open_clear");
    expect(newsNow([], null, at("15:00"), end).kind).toBe("no_plan");
  });
});

describe("the plan form", () => {
  it("starts with nothing chosen but the learner's zone", () => {
    const draft = emptyNewsPlanDraft("Europe/Kyiv");
    expect(draft).toEqual({ timeZone: "Europe/Kyiv", minImportance: null, minutesBefore: null, minutesAfter: null, currencies: [] });
    const checked = validateNewsPlanDraft(draft, REFERENCE);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(Object.keys(checked.errors)).toEqual(["minImportance", "minutesBefore", "minutesAfter", "currencies"]);
  });

  it("sends the currencies in the list's order", () => {
    const checked = validateNewsPlanDraft(
      { timeZone: "Europe/Warsaw", minImportance: 3, minutesBefore: 15, minutesAfter: 30, currencies: ["EUR", "USD"] },
      REFERENCE,
    );
    expect(checked).toEqual({
      ok: true,
      plan: { timeZone: "Europe/Warsaw", minImportance: 3, minutesBefore: 15, minutesAfter: 30, currencies: ["USD", "EUR"] },
    });
  });

  it("knows the form still says the plan in force", () => {
    const draft = draftOfNewsPlan(PLAN);
    expect(draftMatchesPlan(draft, PLAN)).toBe(true);
    expect(draftMatchesPlan({ ...draft, currencies: ["EUR", "USD"] }, PLAN)).toBe(true);
    expect(draftMatchesPlan({ ...draft, minutesAfter: 30 }, PLAN)).toBe(false);
    expect(draftMatchesPlan({ ...draft, timeZone: "Europe/Moscow" }, PLAN)).toBe(false);
    expect(planSummary(PLAN)).toBe("USD, EUR · высокая важность · 15 мин до и 15 после");
  });
});

describe("the timeline's stretch of the day", () => {
  const zone = "Europe/Warsaw";
  const clock = (time: string) => zonedWallTimeToInstant("2026-09-21", time, zone)!;

  it("draws the releases with an hour's margin on whole hours — the presentation's 08:00–20:00+", () => {
    const range = timelineRange("2026-09-21", zone, [clock("08:00"), clock("14:30"), clock("20:00")]);
    expect(timeIn(range.from, zone)).toBe("07:00");
    expect(timeIn(range.to, zone)).toBe("21:00");
    expect(range.hours.map((tick) => tick.hour)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it("is at least eight hours long, and the whole day when there is nothing to draw", () => {
    const one = timelineRange("2026-09-21", zone, [clock("14:30")]);
    expect((one.to - one.from) / 3_600_000).toBeGreaterThanOrEqual(8);
    expect(one.from).toBeLessThanOrEqual(clock("13:30"));
    const late = timelineRange("2026-09-21", zone, [clock("23:30")]);
    expect(timeIn(late.to, zone)).toBe("00:00");
    expect((late.to - late.from) / 3_600_000).toBe(8);
    const empty = timelineRange("2026-09-21", zone, []);
    expect(empty).toMatchObject(dayBounds("2026-09-21", zone));
  });
});
