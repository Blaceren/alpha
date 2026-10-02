import { describe, expect, it } from "vitest";
import { formatTimecode } from "@/lib/time/timecode";

describe("formatTimecode", () => {
  it("prints the author's «m:ss»", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(5)).toBe("0:05");
    expect(formatTimecode(115)).toBe("1:55");
    expect(formatTimecode(380)).toBe("6:20");
    expect(formatTimecode(727)).toBe("12:07");
  });

  it("carries hours only when there are some", () => {
    expect(formatTimecode(3599)).toBe("59:59");
    expect(formatTimecode(3600)).toBe("1:00:00");
    expect(formatTimecode(3750)).toBe("1:02:30");
  });

  it("drops fractions and reads anything unusable as the start", () => {
    expect(formatTimecode(115.9)).toBe("1:55");
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatTimecode(bad)).toBe("0:00");
  });
});
