import { describe, it, expect } from "vitest";
import { SYNTHETIC_DASHBOARD } from "@/data/mock/synthetic-state";

describe("synthetic dashboard state", () => {
  const s = SYNTHETIC_DASHBOARD;

  it("uses the canonical level 18 lesson name", () => {
    expect(s.level.index).toBe(18);
    expect(s.level.lessonName).toBe("Поддержка и сопротивление");
    expect(s.module.name).toBe("Чтение графика");
  });

  it("carries the L15-earned rank Наблюдатель III", () => {
    expect(s.rank.label).toBe("Наблюдатель III");
  });

  it("exposes a checkpoint target but no user balance", () => {
    expect(s.nextCheckpoint.levelIndex).toBe(20);
    expect(s.nextCheckpoint.targetUsd).toBe(200);
    // The contract/state must not contain any balance-like field.
    expect(Object.keys(s)).not.toContain("balance");
    expect(JSON.stringify(s)).not.toMatch(/осталось|депозит|deposit|withdraw|баланс пользоват/i);
  });

  it("marks Trading Journal and Risk Calculator as available", () => {
    const available = s.tools.filter((t) => t.state === "available").map((t) => t.name);
    expect(available).toContain("Trading Journal");
    expect(available).toContain("Risk Calculator");
  });

  it("marks Chart Markup Tool as the nearest reward", () => {
    expect(s.nearestReward.name).toBe("Chart Markup Tool");
    expect(s.nearestReward.unlockLevel).toBe(20);
  });

  it("primary action is continuing the lesson (checkpoint is not the CTA)", () => {
    expect(s.primaryAction.kind).toBe("continue-lesson");
    expect(s.primaryAction.label).toBe("Продолжить урок");
  });

  it("alex message makes no profit promise", () => {
    expect(s.alex.text).not.toMatch(/прибыл|гаранти|доход|заработа/i);
  });
});
