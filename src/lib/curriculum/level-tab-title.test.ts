import { describe, it, expect } from "vitest";
import { levelTabTitle } from "@/lib/curriculum/level-tab-title";

describe("levelTabTitle", () => {
  it("names the level from its stable code", () => {
    expect(levelTabTitle("v2.l004.kak-chitat-grafik")).toBe("Уровень 4 — Alpha Trade Academy");
    expect(levelTabTitle("v2.l030.final")).toBe("Уровень 30 — Alpha Trade Academy");
  });

  it("keeps the old title for a code without a number", () => {
    expect(levelTabTitle("level.007")).toBe("Урок — Alpha Trade Academy");
    expect(levelTabTitle("v2.l000.x")).toBe("Урок — Alpha Trade Academy");
    expect(levelTabTitle("")).toBe("Урок — Alpha Trade Academy");
  });
});
