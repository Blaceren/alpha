import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NormalizedError } from "@/lib/api/errors";
import type { RiskPlan, RiskState } from "./risk-model";

const fetchRiskState = vi.fn();
const saveRiskPlan = vi.fn();
vi.mock("./risk-client", () => ({
  fetchRiskState: () => fetchRiskState(),
  saveRiskPlan: (plan: unknown) => saveRiskPlan(plan),
}));

import { RiskWorkspace } from "./risk-workspace";

const REFERENCE = { riskShares: [1, 2, 3, 5], streakLength: 5 };
const SCENARIO = "Работаю только отскоки от уровней, отмеченных до начала сессии.";
const CANCEL = "Рядом с ценой нет отмеченного уровня или payout ниже 85%.";

function plan(overrides: Partial<RiskPlan> = {}): RiskPlan {
  return {
    id: "cmrisk00000000abcdefghij",
    version: 1,
    capital: "400.00",
    payoutPercent: 90,
    riskPercent: 2,
    dailyLimitPercent: 6,
    scenario: SCENARIO,
    cancelCondition: CANCEL,
    createdAt: new Date(2026, 8, 21, 18, 40).toISOString(),
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
    ...overrides,
  };
}

const EMPTY: RiskState = { plan: null, history: [], reference: REFERENCE };

function failure(code: string | null, category: NormalizedError["category"] = "VALIDATION_ERROR", detail: string | null = null) {
  return {
    ok: false as const,
    error: { category, status: 400, code, messageKey: "x", requestId: null, retryable: false },
    detail,
  };
}

async function fillNumbers(user: ReturnType<typeof userEvent.setup>, share = "2%") {
  await user.type(screen.getByLabelText("Торговый капитал"), "400");
  await user.type(screen.getByLabelText("Payout"), "90");
  await user.type(screen.getByLabelText("Дневной лимит потерь"), "6");
  await user.click(screen.getByRole("radio", { name: share }));
}

const results = () => screen.getByRole("heading", { name: "Расчёт" }).closest("section")!;
const streak = () => screen.getByRole("heading", { name: /Серия из 5 убытков/ }).closest("section")!;

beforeEach(() => {
  fetchRiskState.mockReset();
  saveRiskPlan.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 22, 10, 0));
});
afterEach(() => vi.useRealTimers());

describe("Risk Calculator — the arithmetic, live", () => {
  it("starts empty, the results waiting for the learner's own numbers", () => {
    render(<RiskWorkspace initialState={EMPTY} />);
    expect(fetchRiskState).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Торговый капитал")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "2%" })).toHaveAttribute("aria-checked", "false");
    expect(within(results()).getByText("Заполните параметры — расчёт появится здесь.")).toBeInTheDocument();
    expect(screen.getByText("Капитал для плана вы задаёте сами. ATA не видит ваш счёт в Pocket.")).toBeInTheDocument();
  });

  it("turns $400, 90%, 2% and 6% into the presentation's figures as they are typed", async () => {
    const user = userEvent.setup();
    render(<RiskWorkspace initialState={EMPTY} />);
    await fillNumbers(user);
    const box = results();
    expect(within(box).getByText("$8.00")).toBeInTheDocument();
    expect(within(box).getByText("2% от $400")).toBeInTheDocument();
    expect(within(box).getByText("+$7.20")).toBeInTheDocument();
    expect(within(box).getByText("−$8.00")).toBeInTheDocument();
    expect(within(box).getByText("$24.00 · 3 убыточные сделки → стоп")).toBeInTheDocument();
    expect(within(box).getByText("52.6%")).toBeInTheDocument();
    const series = streak();
    expect(within(series).getByText("−$40.00 · 10%")).toBeInTheDocument();
    expect(within(series).getByText("$8.00 × 5")).toBeInTheDocument();
    expect(within(series).getByText("−$248.00 · 62%")).toBeInTheDocument();
    expect(within(series).getByText("8 + 16 + 32 + 64 + 128")).toBeInTheDocument();
    expect(within(series).getByText("доля от $400")).toBeInTheDocument();
  });

  it("says so when doubling outruns the capital, and when one trade passes the daily limit", async () => {
    const user = userEvent.setup();
    render(<RiskWorkspace initialState={EMPTY} />);
    await user.type(screen.getByLabelText("Торговый капитал"), "400");
    await user.type(screen.getByLabelText("Payout"), "90");
    await user.type(screen.getByLabelText("Дневной лимит потерь"), "3");
    await user.click(screen.getByRole("radio", { name: "5%" }));
    expect(within(streak()).getByText("−$620.00 · больше капитала")).toBeInTheDocument();
    expect(within(streak()).getByText("20 + 40 + 80 + 160 + 320 — капитала хватит на 4 из 5")).toBeInTheDocument();
    expect(within(results()).getByText(/\$12\.00 · меньше одной сделки/)).toBeInTheDocument();
    expect(
      within(results()).getByText("Одна сделка больше дневного лимита: он закончится на первом же убытке."),
    ).toBeInTheDocument();
  });

  it("adds up nothing the learner traded: no balance, no totals", () => {
    const { container } = render(<RiskWorkspace initialState={{ ...EMPTY, plan: plan() }} />);
    expect(container.textContent).not.toMatch(/баланс|итого|прибыль за|P\/L/i);
  });
});

describe("Risk Calculator — saving the plan", () => {
  it("names what is missing, sends nothing, and takes the learner to the first gap", async () => {
    const user = userEvent.setup();
    render(<RiskWorkspace initialState={EMPTY} />);
    await fillNumbers(user);
    await user.click(screen.getByRole("button", { name: "Сохранить Risk Plan" }));
    expect(saveRiskPlan).not.toHaveBeenCalled();
    expect(screen.getByText("Запишите сценарий — от 3 до 1000 символов.")).toBeInTheDocument();
    expect(screen.getByText("Запишите условие отмены — от 3 до 1000 символов.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Сценарий/)).toHaveFocus();
  });

  it("sends exactly the plan, and then says which version is in force", async () => {
    const user = userEvent.setup();
    saveRiskPlan.mockResolvedValue({ ok: true, data: { plan: plan(), history: [] } });
    render(<RiskWorkspace initialState={EMPTY} />);
    await fillNumbers(user);
    await user.type(screen.getByLabelText(/Сценарий/), SCENARIO);
    await user.type(screen.getByLabelText(/Условие отмены/), CANCEL);
    await user.click(screen.getByRole("button", { name: "Сохранить Risk Plan" }));
    expect(saveRiskPlan).toHaveBeenCalledWith({
      capital: "400.00",
      payoutPercent: 90,
      riskPercent: 2,
      dailyLimitPercent: 6,
      scenario: SCENARIO,
      cancelCondition: CANCEL,
    });
    expect(await screen.findByText("Risk Plan сохранён · версия 1")).toBeInTheDocument();
    expect(screen.getByText("В силе · версия 1")).toBeInTheDocument();
    expect(screen.getByText("с 21 сентября, 18:40")).toBeInTheDocument();
    // Nothing changed since: nothing to save.
    expect(screen.getByRole("button", { name: "Сохранить Risk Plan" })).toBeDisabled();
  });

  it("offers a changed plan as the next version, or puts the plan in force back", async () => {
    const user = userEvent.setup();
    render(<RiskWorkspace initialState={{ ...EMPTY, plan: plan({ version: 3 }) }} />);
    expect(screen.getByLabelText("Торговый капитал")).toHaveValue("400");
    expect(screen.getByRole("radio", { name: "2%" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Это план в силе. Измените параметры или правила — и сохраните новую версию.")).toBeInTheDocument();
    expect(screen.getByText("В силе · версия 3")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "1%" }));
    expect(within(results()).getByText("$4.00")).toBeInTheDocument();
    // The numbers on screen are no longer the plan in force, and the status says so.
    expect(screen.queryByText("В силе · версия 3")).toBeNull();
    expect(screen.getByText("Версия 3 · изменения не сохранены")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить Risk Plan" })).toBeEnabled();
    expect(
      screen.getByText("Изменения не сохранены. Новая версия станет планом в силе, прежняя останется в истории."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Вернуть план в силе" }));
    expect(screen.getByRole("radio", { name: "2%" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Сохранить Risk Plan" })).toBeDisabled();
  });

  it("puts a field the Backend refuses under that field", async () => {
    const user = userEvent.setup();
    saveRiskPlan.mockResolvedValue(failure("TOOL_VALIDATION", "VALIDATION_ERROR", "invalid_capital"));
    render(<RiskWorkspace initialState={{ ...EMPTY, plan: plan() }} />);
    await user.click(screen.getByRole("radio", { name: "3%" }));
    await user.click(screen.getByRole("button", { name: "Сохранить Risk Plan" }));
    expect(await screen.findByText("Капитал — сумма от $1 до $1 000 000, до двух знаков после точки.")).toBeInTheDocument();
    expect(screen.getByLabelText("Торговый капитал")).toHaveFocus();
  });
});

describe("Risk Calculator — versions and states", () => {
  it("keeps earlier versions folded under the plan, newest first", async () => {
    const user = userEvent.setup();
    const history = [
      plan({ id: "cmrisk00000002abcdefghij", version: 2, riskPercent: 3, scenario: "Только тренд" }),
      plan({ id: "cmrisk00000001abcdefghij", version: 1, riskPercent: 5, scenario: "Любые сигналы" }),
    ];
    render(<RiskWorkspace initialState={{ ...EMPTY, plan: plan({ version: 3 }), history }} />);
    const toggle = screen.getByRole("button", { name: /Предыдущие версии · 2/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Только тренд")).not.toBeVisible();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const versions = screen.getAllByText(/^Версия \d$/).map((node) => node.textContent);
    expect(versions).toEqual(["Версия 2", "Версия 1"]);
    expect(screen.getByText("Только тренд")).toBeVisible();
  });

  it("reads from the browser when the server could not, and says when the tool is closed", async () => {
    fetchRiskState.mockResolvedValue(failure("TOOL_LOCKED", "FORBIDDEN"));
    render(<RiskWorkspace />);
    expect(await screen.findByRole("heading", { name: "Инструмент закрыт" })).toBeInTheDocument();
    expect(screen.getByText("Risk Calculator пока закрыт: он откроется по ходу пути, после уровня, указанного на странице «Инструменты».")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Продолжить путь" })).toHaveAttribute("href", "/path");
  });

  it("retries after a failed read", async () => {
    const user = userEvent.setup();
    fetchRiskState.mockResolvedValueOnce(failure(null, "NETWORK_ERROR")).mockResolvedValueOnce({ ok: true, data: EMPTY });
    render(<RiskWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByLabelText("Торговый капитал")).toBeInTheDocument();
  });
});
