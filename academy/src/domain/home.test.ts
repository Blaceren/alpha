import { describe, it, expect } from "vitest";
import { resolveScenario } from "@/domain/home";
import { getHomeState } from "@/data/mock/home-scenarios";

describe("resolveScenario", () => {
  it("maps the explicit checkpoint value", () => {
    expect(resolveScenario("checkpoint")).toBe("checkpoint");
  });

  it("maps the explicit active value", () => {
    expect(resolveScenario("active")).toBe("active");
  });

  it.each([undefined, null, "", "unknown", "ACTIVE", "Checkpoint", 42, [], {}])(
    "falls back to active for unknown input %o",
    (raw) => {
      expect(resolveScenario(raw)).toBe("active");
    },
  );
});

describe("home scenarios — deterministic mock state", () => {
  it("active current level is 18 in Module 4, upcoming is 19", () => {
    const s = getHomeState("active");
    expect(s.lesson.levelIndex).toBe(18);
    expect(s.lesson.module.ordinal).toBe(4);
    expect(s.upcomingLevelIndex).toBe(19);
  });

  it("both scenarios point at the same checkpoint (level 20, target $200)", () => {
    for (const sc of ["active", "checkpoint"] as const) {
      const cp = getHomeState(sc).checkpoint;
      expect(cp.levelIndex).toBe(20);
      expect(cp.requirementUsd).toBe(200);
    }
  });

  it("checkpoint route marks L20 as the checkpoint and pre-L20 as completed", () => {
    const route = getHomeState("checkpoint").route;
    expect(route.find((n) => n.index === 20)?.state).toBe("checkpoint");
    expect(route.find((n) => n.index === 18)?.state).toBe("completed");
  });
});
