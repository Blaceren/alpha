/**
 * Dates on the learner's clock. Every instant here is built from local parts,
 * so the cases mean the same thing in whatever zone the suite runs.
 */
import { describe, expect, it } from "vitest";
import { localDate, tradeDateNear } from "./local-date";

const at = (day: number, hours: number, minutes: number) => new Date(2026, 8, day, hours, minutes);

describe("localDate", () => {
  it("is the learner's calendar day, zero-padded", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDate(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});

describe("tradeDateNear — the day a planned entry falls on", () => {
  it("is the plan's own day for the usual plan, written minutes before the trade", () => {
    expect(tradeDateNear("14:32", at(21, 14, 20))).toBe("2026-09-21");
    expect(tradeDateNear("14:32", at(21, 14, 40))).toBe("2026-09-21");
  });

  it("is the next day for a plan fixed just before midnight for just after it", () => {
    expect(tradeDateNear("00:02", at(21, 23, 58))).toBe("2026-09-22");
  });

  it("is the previous day for a trade just before midnight, recorded just after it", () => {
    expect(tradeDateNear("23:59", at(22, 0, 3))).toBe("2026-09-21");
  });

  it("falls back to the plan's day for a time it cannot read", () => {
    expect(tradeDateNear("25:00", at(21, 10, 0))).toBe("2026-09-21");
    expect(tradeDateNear("", at(21, 10, 0))).toBe("2026-09-21");
  });
});
