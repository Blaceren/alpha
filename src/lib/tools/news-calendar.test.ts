import { describe, expect, it } from "vitest";
import { ToolError } from "./errors";
import {
  NEWS_CALENDAR_LIMITS,
  decodeCurrencies,
  encodeCurrencies,
  isSameNewsPlan,
  newsCalendarReference,
  parseCalendarWindow,
  parseNewsPlan,
  toNewsPlanDto,
} from "./news-calendar";

const NOW = new Date("2026-09-21T12:18:00.000Z");

/** The presentation's plan: USD and EUR, high importance, ±15 min, Warsaw. */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    timeZone: "Europe/Warsaw",
    minImportance: 3,
    minutesBefore: 15,
    minutesAfter: 15,
    currencies: ["EUR", "USD"],
    ...overrides,
  };
}

function refusal(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof ToolError) return error.detail;
    throw error;
  }
}

describe("the learner's news plan", () => {
  it("reads the presentation's plan, currencies in the list's order", () => {
    expect(parseNewsPlan(plan())).toEqual({
      timeZone: "Europe/Warsaw",
      minImportance: 3,
      minutesBefore: 15,
      minutesAfter: 15,
      currencies: ["USD", "EUR"],
    });
  });

  it("names the field it refuses", () => {
    expect(refusal(() => parseNewsPlan(plan({ timeZone: "Warsaw" })))).toBe("invalid_time_zone");
    expect(refusal(() => parseNewsPlan(plan({ minImportance: 1 })))).toBe("invalid_min_importance");
    expect(refusal(() => parseNewsPlan(plan({ minutesBefore: 20 })))).toBe("invalid_minutes_before");
    expect(refusal(() => parseNewsPlan(plan({ minutesAfter: "15" })))).toBe("invalid_minutes_after");
    expect(refusal(() => parseNewsPlan(plan({ currencies: [] })))).toBe("invalid_currencies");
    expect(refusal(() => parseNewsPlan(plan({ currencies: ["USD", "USD"] })))).toBe("invalid_currencies");
    expect(refusal(() => parseNewsPlan(plan({ currencies: ["RUB"] })))).toBe("invalid_currencies");
    expect(refusal(() => parseNewsPlan(plan({ currencies: "USD" })))).toBe("invalid_currencies");
    expect(refusal(() => parseNewsPlan(null))).toBe("invalid_plan");
  });

  it("stores currencies as codes and reads them back", () => {
    expect(encodeCurrencies(["USD", "EUR"])).toBe("USD,EUR");
    expect(decodeCurrencies("USD,EUR")).toEqual(["USD", "EUR"]);
  });

  it("knows an identical save", () => {
    const row = { ...parseNewsPlan(plan()), currencies: "USD,EUR", createdAt: NOW };
    expect(isSameNewsPlan(row, parseNewsPlan(plan()))).toBe(true);
    expect(isSameNewsPlan(row, parseNewsPlan(plan({ minutesAfter: 30 })))).toBe(false);
    expect(isSameNewsPlan(row, parseNewsPlan(plan({ currencies: ["USD"] })))).toBe(false);
    expect(isSameNewsPlan(row, parseNewsPlan(plan({ timeZone: "Europe/Moscow" })))).toBe(false);
    expect(toNewsPlanDto(row, 2)).toEqual({
      version: 2,
      timeZone: "Europe/Warsaw",
      minImportance: 3,
      minutesBefore: 15,
      minutesAfter: 15,
      currencies: ["USD", "EUR"],
      savedAt: NOW.toISOString(),
    });
  });
});

describe("the calendar window", () => {
  it("covers every time zone's today on the first read", () => {
    const window = parseCalendarWindow(new URLSearchParams(), NOW);
    expect(window.from.toISOString()).toBe("2026-09-20T00:18:00.000Z");
    expect(window.to.toISOString()).toBe("2026-09-23T00:18:00.000Z");
  });

  it("reads a day the browser worked out", () => {
    const window = parseCalendarWindow(
      new URLSearchParams({ from: "2026-09-20T22:00:00.000Z", to: "2026-09-21T22:00:00.000Z" }),
      NOW,
    );
    expect(window.to.getTime() - window.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("refuses a window that is not a day, or not plausible", () => {
    const read = (query: Record<string, string>) => refusal(() => parseCalendarWindow(new URLSearchParams(query), NOW));
    expect(read({ from: "2026-09-21T00:00:00.000Z" })).toBe("invalid_to");
    expect(read({ from: "2026-09-22T00:00:00Z", to: "2026-09-21T00:00:00Z" })).toBe("invalid_window");
    expect(read({ from: "2026-09-01T00:00:00Z", to: "2026-09-21T00:00:00Z" })).toBe("invalid_window");
    expect(read({ from: "2019-01-01T00:00:00Z", to: "2019-01-02T00:00:00Z" })).toBe("invalid_window");
    expect(read({ from: "2028-01-01T00:00:00Z", to: "2028-01-02T00:00:00Z" })).toBe("invalid_window");
    expect(read({ from: "yesterday", to: "today" })).toBe("invalid_from");
    expect(read({ from: "2026-09-21", to: "2026-09-22" })).toBe("invalid_from");
    expect(read({ day: "2026-09-21" })).toBe("unexpected_query_parameter");
    expect(
      refusal(() =>
        parseCalendarWindow(new URLSearchParams("from=2026-09-21T00:00:00Z&from=2026-09-21T01:00:00Z&to=x"), NOW),
      ),
    ).toBe("invalid_from");
  });

  it("allows the long day summer time ends on", () => {
    expect(NEWS_CALENDAR_LIMITS.maxSpanMs).toBeGreaterThanOrEqual(25 * 60 * 60 * 1000);
  });

  it("offers the plan form's choices", () => {
    const reference = newsCalendarReference();
    expect(reference.minutes).toEqual([5, 10, 15, 30, 60]);
    expect(reference.planImportance).toEqual([3, 2]);
    expect(reference.currencies).toContain("USD");
  });
});
