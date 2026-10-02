import { describe, expect, it } from "vitest";
import {
  WEEKDAYS_SHORT,
  addDays,
  addMonths,
  addMonthsToDate,
  clampDate,
  compareMonths,
  daysInMonth,
  describeDate,
  fullDateLabel,
  isoDate,
  monthGrid,
  monthOf,
  monthTitle,
  parseIsoDate,
  weekdayIndex,
} from "./calendar";

describe("calendar days", () => {
  it("reads a real date and nothing else", () => {
    expect(parseIsoDate("2026-10-02")).toEqual({ year: 2026, month: 10, day: 2 });
    expect(parseIsoDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    for (const iso of ["", "2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-10-00", "02.10.2026", "2026-10-2"]) {
      expect(parseIsoDate(iso), iso).toBeNull();
    }
    expect(isoDate(2026, 1, 5)).toBe("2026-01-05");
  });

  it("moves by days across months, years and the clocks' change", () => {
    expect(addDays("2026-10-02", -1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    // The last Sunday of March and of October: a day is still a day.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("not a date", 1)).toBe("not a date");
  });

  it("moves by months, keeping the day where the month has it", () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonthsToDate("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsToDate("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonthsToDate("2026-10-02", 1)).toBe("2026-11-02");
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(compareMonths({ year: 2026, month: 10 }, { year: 2026, month: 9 })).toBe(1);
    expect(compareMonths({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBe(-1);
    expect(compareMonths({ year: 2026, month: 10 }, { year: 2026, month: 10 })).toBe(0);
    expect(monthOf("2026-10-02")).toEqual({ year: 2026, month: 10 });
  });

  it("starts the week on Monday", () => {
    expect(WEEKDAYS_SHORT).toEqual(["пн", "вт", "ср", "чт", "пт", "сб", "вс"]);
    expect(weekdayIndex("2026-10-02")).toBe(4); // a Friday
    expect(weekdayIndex("2026-09-21")).toBe(0); // a Monday
    expect(weekdayIndex("2026-09-20")).toBe(6); // a Sunday
  });

  it("lays a month out in whole weeks, its first and last completed with the neighbours' days", () => {
    const october = monthGrid(2026, 10);
    const days = (row: { iso: string }[] | undefined) => row?.map((day) => day.iso);
    const outside = (row: { outside: boolean }[] | undefined) => row?.map((day) => day.outside);
    // 1 October 2026 is a Thursday: the week begins with 28…30 September.
    expect(days(october[0])).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(outside(october[0])).toEqual([true, true, true, false, false, false, false]);
    expect(october.every((row) => row.length === 7)).toBe(true);
    expect(october.flat().filter((day) => !day.outside)).toHaveLength(31);
    // 31 October is a Saturday: the week ends with 1 November.
    expect(days(october.at(-1))).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(outside(october.at(-1))).toEqual([false, false, false, false, false, false, true]);
    // Every day stands once, in order, across the year's end as well.
    const january = monthGrid(2027, 1).flat();
    expect(january[0]).toEqual({ iso: "2026-12-28", outside: true });
    expect(january.at(-1)).toEqual({ iso: "2027-01-31", outside: false });
    expect(new Set(january.map((day) => day.iso)).size).toBe(january.length);
  });

  it("draws a week only if the month has a day in it", () => {
    // A February that fits four weeks exactly: no neighbour is shown at all.
    const february = monthGrid(2027, 2);
    expect(february).toHaveLength(4);
    expect(february.flat().some((day) => day.outside)).toBe(false);
    // A month that needs six.
    expect(monthGrid(2026, 8)).toHaveLength(6);
    for (const [year, month] of [[2026, 10], [2026, 8], [2027, 2], [2024, 2], [2026, 12]] as const) {
      for (const row of monthGrid(year, month)) expect(row.some((day) => !day.outside), `${year}-${month}`).toBe(true);
    }
  });

  it("keeps a date inside its limits", () => {
    expect(clampDate("2019-05-05", "2020-01-01", "2026-10-02")).toBe("2020-01-01");
    expect(clampDate("2027-01-01", "2020-01-01", "2026-10-02")).toBe("2026-10-02");
    expect(clampDate("2026-09-30", "2020-01-01", "2026-10-02")).toBe("2026-09-30");
  });
});

describe("a date in words", () => {
  const today = "2026-10-02";

  it("says today and yesterday by name, the date beside it", () => {
    expect(describeDate("2026-10-02", today)).toEqual({ main: "Сегодня", note: "2 октября" });
    expect(describeDate("2026-10-01", today)).toEqual({ main: "Вчера", note: "1 октября" });
  });

  it("says an earlier day by its date, the weekday beside it", () => {
    expect(describeDate("2026-09-29", today)).toEqual({ main: "29 сентября", note: "вторник" });
    expect(describeDate("2026-05-03", today)).toEqual({ main: "3 мая", note: "воскресенье" });
  });

  it("adds the year only when it is not today's", () => {
    expect(describeDate("2025-12-30", today)).toEqual({ main: "30 дек 2025", note: "вторник" });
  });

  it("crosses a year and a month for «вчера»", () => {
    expect(describeDate("2025-12-31", "2026-01-01")).toEqual({ main: "Вчера", note: "31 декабря" });
  });

  it("has no words for what is not a date", () => {
    expect(describeDate("", today)).toBeNull();
    expect(describeDate("2026-02-30", today)).toBeNull();
  });

  it("names a month and a day in full", () => {
    expect(monthTitle({ year: 2026, month: 10 })).toBe("Октябрь 2026");
    expect(fullDateLabel("2026-10-02")).toBe("2 октября 2026, пятница");
  });
});
