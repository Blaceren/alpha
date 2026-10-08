import { describe, expect, it } from "vitest";
import { formatTime, parseTime, settleTime, stepTime, typeTime } from "./time-input";

/** Type `keys` one at a time into an empty field, as a keyboard does. */
function typed(keys: string): string {
  let text = "";
  for (const key of keys) text = typeTime(text + key, text);
  return text;
}

/** Press Backspace `times` at the end of `text`. */
function erased(text: string, times: number): string[] {
  const seen: string[] = [];
  let current = text;
  for (let i = 0; i < times; i += 1) {
    current = typeTime(current.slice(0, -1), current);
    seen.push(current);
  }
  return seen;
}

describe("a time as it is typed", () => {
  it("turns four digits into ЧЧ:ММ, the colon its own", () => {
    expect(typed("1432")).toBe("14:32");
    expect(typed("0005")).toBe("00:05");
    expect(typed("2359")).toBe("23:59");
  });

  it("shows each step of the way", () => {
    expect(typed("1")).toBe("1");
    expect(typed("14")).toBe("14:");
    expect(typed("143")).toBe("14:3");
  });

  it("completes an hour that can only be one digit", () => {
    for (const digit of "3456789") expect(typed(digit), digit).toBe(`0${digit}:`);
    expect(typed("905")).toBe("09:05");
    // 0, 1 and 2 may still be the first of two.
    for (const digit of "012") expect(typed(digit), digit).toBe(digit);
  });

  it("never makes an hour past 23 or a minute past 59", () => {
    expect(typed("24")).toBe("02:4");
    expect(typed("29")).toBe("02:09");
    expect(typed("2530")).toBe("02:53");
    expect(typed("147")).toBe("14:07");
    expect(typed("1460")).toBe("14:06");
    for (const keys of ["0000", "2359", "1432", "0959", "9999", "2460", "3", "77"]) {
      const text = typed(keys);
      const [hours, minutes] = text.split(":");
      expect(Number(hours), keys).toBeLessThanOrEqual(23);
      if (minutes) expect(Number(minutes), keys).toBeLessThanOrEqual(59);
    }
  });

  it("keeps nothing but digits, and ignores what comes after a whole time", () => {
    expect(typed("льдл")).toBe("");
    expect(typed("1a4b3c2")).toBe("14:32");
    expect(typed("14325")).toBe("14:32");
    expect(typed("14:32:10")).toBe("14:32");
    expect(typed(":")).toBe("");
  });

  it("takes a typed or pasted mark as the end of the hour", () => {
    expect(typed("9:5")).toBe("09:5");
    expect(typed("1:05")).toBe("01:05");
    expect(typeTime("14.32")).toBe("14:32");
    expect(typeTime("14 32")).toBe("14:32");
    expect(typeTime("9:05")).toBe("09:05");
    expect(typeTime("1432")).toBe("14:32");
  });

  it("lets one part be retyped in place, the other standing", () => {
    // «14» selected in «14:32», then «0», then «9».
    expect(typeTime("0:32", "14:32")).toBe("0:32");
    expect(typeTime("09:32", "0:32")).toBe("09:32");
    // …and «2», then «3».
    expect(typeTime("2:32", "14:32")).toBe("2:32");
    expect(typeTime("23:32", "2:32")).toBe("23:32");
    // An hour that can only be one digit is complete at once.
    expect(typeTime("9:32", "14:32")).toBe("09:32");
    // The minutes, retyped: «32» selected, then «0», then «5».
    expect(typeTime("14:0", "14:32")).toBe("14:0");
    expect(typeTime("14:05", "14:0")).toBe("14:05");
    // A pasted «1:05» waits for the field to be left.
    expect(typeTime("1:05")).toBe("1:05");
  });

  it("lets go of the colon when the learner deletes, instead of putting it back under the cursor", () => {
    expect(erased("14:32", 5)).toEqual(["14:3", "14:", "14", "1", ""]);
    expect(erased("09:", 3)).toEqual(["09", "0", ""]);
  });
});

describe("a time the learner has left", () => {
  it("settles an hour alone on that hour sharp", () => {
    expect(settleTime("14")).toBe("14:00");
    expect(settleTime("14:")).toBe("14:00");
    expect(settleTime("1")).toBe("01:00");
    expect(settleTime("0")).toBe("00:00");
  });

  it("finishes an hour that was being retyped in place", () => {
    expect(settleTime("0:32")).toBe("00:32");
    expect(settleTime("1:05")).toBe("01:05");
  });

  it("does not guess at half-typed minutes, or touch a whole time", () => {
    expect(settleTime("14:3")).toBe("14:3");
    expect(settleTime("1:5")).toBe("1:5");
    expect(settleTime("14:32")).toBe("14:32");
    expect(settleTime("")).toBe("");
  });
});

describe("a time as a value", () => {
  it("is read only when whole", () => {
    expect(parseTime("14:32")).toEqual({ hours: 14, minutes: 32 });
    expect(parseTime("00:00")).toEqual({ hours: 0, minutes: 0 });
    for (const text of ["", "14", "14:", "14:3", "24:00", "14:60", "1432", "9:05"]) expect(parseTime(text), text).toBeNull();
    expect(formatTime(9, 5)).toBe("09:05");
  });

  it("steps each part on its own wheel", () => {
    expect(stepTime("14:32", "minutes", 1)).toBe("14:33");
    expect(stepTime("14:59", "minutes", 1)).toBe("14:00");
    expect(stepTime("14:00", "minutes", -1)).toBe("14:59");
    expect(stepTime("23:10", "hours", 1)).toBe("00:10");
    expect(stepTime("00:10", "hours", -1)).toBe("23:10");
    // From an unfinished text the count starts at midnight.
    expect(stepTime("", "minutes", 1)).toBe("00:01");
    expect(stepTime("14:", "hours", -1)).toBe("23:00");
  });
});
