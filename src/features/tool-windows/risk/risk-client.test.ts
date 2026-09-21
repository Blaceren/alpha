import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRiskState, isRiskPlan, isRiskState, saveRiskPlan } from "./risk-client";

const PLAN = {
  id: "cmrisk00000000abcdefghij",
  version: 1,
  capital: "400.00",
  payoutPercent: 90,
  riskPercent: 2,
  dailyLimitPercent: 6,
  scenario: "Только отскоки от уровней",
  cancelCondition: "Payout ниже 85%",
  createdAt: "2026-09-21T16:40:00.000Z",
  numbers: {
    tradeAmount: "8.00",
    ifRight: "7.20",
    ifWrong: "8.00",
    dailyLimit: "24.00",
    lossesToStop: 3,
    breakEvenBasisPoints: 5263,
    streak: {
      length: 5,
      fixedLoss: "40.00",
      fixedShareBasisPoints: 1000,
      doublingSteps: ["8.00", "16.00", "32.00", "64.00", "128.00"],
      doublingLoss: "248.00",
      doublingShareBasisPoints: 6200,
      doublingTradesCovered: 5,
    },
  },
};
const STATE = { plan: PLAN, history: [], reference: { riskShares: [1, 2, 3, 5], streakLength: 5 } };
const INPUT = {
  capital: "400.00",
  payoutPercent: 90,
  riskPercent: 2,
  dailyLimitPercent: 6,
  scenario: "Только отскоки от уровней",
  cancelCondition: "Payout ниже 85%",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Risk Calculator client", () => {
  it("reads the plan through the same-origin proxy, with no token and no query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: STATE }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchRiskState()).resolves.toEqual({ ok: true, data: STATE });
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/backend/tools/risk-plan");
    expect(init.method).toBe("GET");
    expect(init.headers["x-csrf-token"]).toBeUndefined();
  });

  it("saves with POST, the plan as the body, and hands back the plan in force", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: "tok-1" }))
      .mockResolvedValueOnce(json({ data: { plan: PLAN, history: [] } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveRiskPlan(INPUT);
    expect(result).toEqual({ ok: true, data: { plan: PLAN, history: [] } });
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe("/api/backend/tools/risk-plan");
    expect(init.method).toBe("POST");
    expect(init.headers["x-csrf-token"]).toBe("tok-1");
    expect(JSON.parse(init.body)).toEqual({ plan: INPUT });
  });

  it("hands back the refused field", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ csrfToken: "tok" }))
        .mockResolvedValueOnce(json({ error: "TOOL_VALIDATION", detail: "invalid_riskPercent" }, 400)),
    );
    const result = await saveRiskPlan({ ...INPUT, riskPercent: 4 });
    expect(!result.ok && result.detail).toBe("invalid_riskPercent");
  });

  it("accepts exactly the shapes the Backend sends", () => {
    expect(isRiskPlan(PLAN)).toBe(true);
    expect(isRiskPlan({ ...PLAN, capital: "400" })).toBe(false);
    expect(isRiskPlan({ ...PLAN, version: -1 })).toBe(false);
    expect(isRiskPlan({ ...PLAN, numbers: { ...PLAN.numbers, streak: { ...PLAN.numbers.streak, doublingSteps: [8] } } })).toBe(
      false,
    );
    expect(isRiskState(STATE)).toBe(true);
    expect(isRiskState({ ...STATE, plan: null, history: [PLAN] })).toBe(true);
    expect(isRiskState({ ...STATE, reference: { riskShares: [], streakLength: 5 } })).toBe(false);
    expect(isRiskState({ ...STATE, history: [{ id: 1 }] })).toBe(false);
  });
});
