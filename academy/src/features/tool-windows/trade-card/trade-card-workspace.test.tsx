import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NormalizedError } from "@/lib/api/errors";
import type { TradeCard, TradeCardReference } from "./trade-card-model";
import { tradeDateNear } from "../model/local-date";

const fetchTradeCardState = vi.fn();
const fixTradePlan = vi.fn();
const changeTradeCard = vi.fn();
vi.mock("./trade-card-client", () => ({
  fetchTradeCardState: () => fetchTradeCardState(),
  fixTradePlan: (plan: unknown) => fixTradePlan(plan),
  changeTradeCard: (id: string, change: unknown) => changeTradeCard(id, change),
}));

import { TradeCardWorkspace } from "./trade-card-workspace";

const REFERENCE: TradeCardReference = {
  assets: [
    { code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" },
    { code: "BTCUSD_OTC", label: "BTC/USD OTC", group: "crypto_otc" },
  ],
  expiries: [
    { code: "M1", label: "1 мин", seconds: 60 },
    { code: "M3", label: "3 мин", seconds: 180 },
  ],
};

function card(overrides: Partial<TradeCard> = {}): TradeCard {
  return {
    id: "cm3k9x2p10000abcdefghij",
    status: "fixed",
    plan: {
      asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
      direction: "up",
      amount: "8.00",
      payoutPercent: 90,
      expiry: { code: "M3", label: "3 мин", seconds: 180 },
      entryTime: "14:32",
      reason: "Отскок от уровня, отмеченного до сессии",
    },
    outcomes: { ifRight: "7.20", ifWrong: "8.00" },
    fixedAt: "2026-09-21T11:32:00.000Z",
    planRevisionCount: 0,
    result: null,
    observation: null,
    savedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-21T11:31:00.000Z",
    ...overrides,
  };
}

function failure(code: string | null, category: NormalizedError["category"] = "VALIDATION_ERROR", detail: string | null = null) {
  return {
    ok: false as const,
    error: { category, status: 400, code, messageKey: "x", requestId: null, retryable: false },
    detail,
  };
}

beforeEach(() => {
  fetchTradeCardState.mockReset();
  fixTradePlan.mockReset();
  changeTradeCard.mockReset();
});
afterEach(() => vi.useRealTimers());

async function fillPlan(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Актив"), "EURUSD_OTC");
  await user.click(screen.getByRole("radio", { name: /Выше/ }));
  await user.type(screen.getByLabelText("Сумма"), "8");
  await user.type(screen.getByLabelText("Payout"), "90");
  await user.selectOptions(screen.getByLabelText("Экспирация"), "M3");
  await user.type(screen.getByLabelText("Причина входа до сделки"), "Отскок от уровня, отмеченного до сессии");
}

describe("Trade Card — a new plan", () => {
  it("shows the empty plan with the first step current and the Pocket caption", async () => {
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: null, reference: REFERENCE } });
    render(<TradeCardWorkspace />);
    expect(await screen.findByRole("button", { name: "Зафиксировать план" })).toBeInTheDocument();
    expect(screen.getByText("Подготовка").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Сделку вы открываете сами в Pocket — ATA сделки не открывает.")).toBeInTheDocument();
    // No direction is chosen for the learner.
    for (const radio of screen.getAllByRole("radio")) expect(radio).toHaveAttribute("aria-checked", "false");
  });

  it("refuses to fix an empty plan and says what is missing, without calling the Backend", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: null, reference: REFERENCE } });
    render(<TradeCardWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Зафиксировать план" }));
    expect(screen.getByText("Выберите актив из списка.")).toBeInTheDocument();
    expect(screen.getByText("Выберите направление: выше или ниже.")).toBeInTheDocument();
    expect(screen.getByLabelText("Сумма")).toHaveAttribute("aria-invalid", "true");
    expect(fixTradePlan).not.toHaveBeenCalled();
  });

  it("shows both outcomes as the learner types", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: null, reference: REFERENCE } });
    render(<TradeCardWorkspace />);
    await user.type(await screen.findByLabelText("Сумма"), "8");
    await user.type(screen.getByLabelText("Payout"), "90");
    expect(screen.getByText("+$7.20")).toBeInTheDocument();
    expect(screen.getByText("−$8.00")).toBeInTheDocument();
  });

  it("fixes the plan and moves on to the result", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: null, reference: REFERENCE } });
    fixTradePlan.mockResolvedValue({ ok: true, data: card() });
    render(<TradeCardWorkspace />);
    await screen.findByRole("button", { name: "Зафиксировать план" });
    await fillPlan(user);
    await user.click(screen.getByRole("button", { name: "Зафиксировать план" }));

    expect(fixTradePlan).toHaveBeenCalledWith(
      expect.objectContaining({ asset: "EURUSD_OTC", direction: "up", amount: "8.00", payoutPercent: 90, expiry: "M3" }),
    );
    expect(await screen.findByText("Результат после экспирации")).toBeInTheDocument();
    expect(screen.getByText(/Зафиксировано/)).toBeInTheDocument();
    expect(screen.getByText("План зафиксирован")).toBeInTheDocument();
    expect(screen.getByLabelText("Сумма")).toBeDisabled();
  });

  it("puts a field the Backend refused under that field", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: null, reference: REFERENCE } });
    fixTradePlan.mockResolvedValue(failure("TOOL_VALIDATION", "VALIDATION_ERROR", "invalid_payoutPercent"));
    render(<TradeCardWorkspace />);
    await screen.findByRole("button", { name: "Зафиксировать план" });
    await fillPlan(user);
    await user.click(screen.getByRole("button", { name: "Зафиксировать план" }));
    expect(await screen.findByText("Payout — целое число от 1 до 100.")).toBeInTheDocument();
    expect(screen.getByLabelText("Payout")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Trade Card — the fixed plan", () => {
  it("resumes the open card from the Backend", async () => {
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: card(), reference: REFERENCE } });
    render(<TradeCardWorkspace />);
    expect(await screen.findByText("Результат после экспирации")).toBeInTheDocument();
    expect(screen.getByLabelText("Причина входа до сделки")).toHaveValue("Отскок от уровня, отмеченного до сессии");
  });

  it("saves only once a result is picked, with a trimmed observation", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: card(), reference: REFERENCE } });
    changeTradeCard.mockResolvedValue({ ok: true, data: card({ status: "saved", result: "profit", savedAt: "2026-09-21T11:40:00.000Z" }) });
    render(<TradeCardWorkspace />);
    const save = await screen.findByRole("button", { name: "Сохранить карточку" });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Прибыль" }));
    await user.type(screen.getByLabelText("Наблюдение после сделки"), "  вошёл по плану  ");
    await user.click(save);

    expect(changeTradeCard).toHaveBeenCalledWith("cm3k9x2p10000abcdefghij", {
      action: "save",
      result: "profit",
      observation: "вошёл по плану",
      // The trade's day on the learner's clock, for the journal.
      tradeDate: tradeDateNear("14:32", new Date("2026-09-21T11:32:00.000Z")),
    });
    const done = await screen.findByText("Карточка сохранена", { selector: ".tc-done__title" });
    expect(done.parentElement).toHaveTextContent("Прибыль · без наблюдения. С уровня 10 карточки попадают в Trading Journal.");
    // The way back to every other tool, in the same tab.
    expect(screen.getByRole("link", { name: "Все инструменты" })).toHaveAttribute("href", "/tools");
    await user.click(screen.getByRole("button", { name: "Новая карточка" }));
    expect(screen.getByRole("button", { name: "Зафиксировать план" })).toBeInTheDocument();
    expect(screen.getByLabelText("Сумма")).toHaveValue("");
  });

  it("from level 10 says the card went into the journal, and offers to review it there", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: card(), reference: REFERENCE } });
    changeTradeCard.mockResolvedValue({ ok: true, data: card({ status: "saved", result: "loss", savedAt: "2026-09-21T11:40:00.000Z" }) });
    render(<TradeCardWorkspace journalOpen />);
    await user.click(await screen.findByRole("radio", { name: "Убыток" }));
    await user.click(screen.getByRole("button", { name: "Сохранить карточку" }));
    const done = await screen.findByText("Карточка сохранена", { selector: ".tc-done__title" });
    expect(done.parentElement).toHaveTextContent("Убыток · без наблюдения. Сделка записана в Trading Journal — там её можно разобрать.");
    expect(screen.getByRole("link", { name: "Разобрать в журнале" })).toHaveAttribute("href", "/tools/journal?card=cm3k9x2p10000abcdefghij");
    expect(screen.getByRole("button", { name: "Новая карточка" })).toBeInTheDocument();
  });

  it("never loses a card over its date: a date the Backend refuses is dropped and the save repeated", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: card(), reference: REFERENCE } });
    changeTradeCard
      .mockResolvedValueOnce(failure("TOOL_VALIDATION", "VALIDATION_ERROR", "invalid_tradeDate"))
      .mockResolvedValueOnce({ ok: true, data: card({ status: "saved", result: "profit", savedAt: "2026-09-21T11:40:00.000Z" }) });
    render(<TradeCardWorkspace journalOpen />);
    await user.click(await screen.findByRole("radio", { name: "Прибыль" }));
    await user.click(screen.getByRole("button", { name: "Сохранить карточку" }));
    await screen.findByText("Карточка сохранена", { selector: ".tc-done__title" });
    expect(changeTradeCard).toHaveBeenCalledTimes(2);
    expect(changeTradeCard).toHaveBeenLastCalledWith("cm3k9x2p10000abcdefghij", {
      action: "save",
      result: "profit",
      observation: null,
    });
  });

  it("re-fixes a changed plan through «Изменить план»", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: card(), reference: REFERENCE } });
    changeTradeCard.mockResolvedValue({ ok: true, data: card({ planRevisionCount: 1 }) });
    render(<TradeCardWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Изменить план" }));
    const amount = screen.getByLabelText("Сумма");
    expect(amount).toBeEnabled();
    await user.clear(amount);
    await user.type(amount, "10");
    await user.click(screen.getByRole("button", { name: "Зафиксировать новый план" }));
    expect(changeTradeCard).toHaveBeenCalledWith(
      "cm3k9x2p10000abcdefghij",
      expect.objectContaining({ action: "refix", plan: expect.objectContaining({ amount: "10.00" }) }),
    );
    expect(await screen.findByText("План изменён")).toBeInTheDocument();
  });

  it("asks before closing a card without a trade", async () => {
    const user = userEvent.setup();
    fetchTradeCardState.mockResolvedValue({ ok: true, data: { card: card(), reference: REFERENCE } });
    changeTradeCard.mockResolvedValue({ ok: true, data: card({ status: "cancelled", cancelledAt: "2026-09-21T11:40:00.000Z" }) });
    render(<TradeCardWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Сделку не открывал" }));
    expect(changeTradeCard).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: "Закрыть карточку без сделки" });
    await user.click(within(confirm).getByRole("button", { name: "Да, сделку не открывал" }));
    expect(changeTradeCard).toHaveBeenCalledWith("cm3k9x2p10000abcdefghij", { action: "cancel" });
    expect(await screen.findByRole("button", { name: "Зафиксировать план" })).toBeInTheDocument();
  });

  it("re-reads the card when another tab moved it on", async () => {
    const user = userEvent.setup();
    fetchTradeCardState
      .mockResolvedValueOnce({ ok: true, data: { card: card(), reference: REFERENCE } })
      .mockResolvedValueOnce({ ok: true, data: { card: null, reference: REFERENCE } });
    changeTradeCard.mockResolvedValue(failure("TRADE_CARD_STATE_CONFLICT", "CONFLICT"));
    render(<TradeCardWorkspace />);
    await user.click(await screen.findByRole("radio", { name: "Убыток" }));
    await user.click(screen.getByRole("button", { name: "Сохранить карточку" }));
    await waitFor(() => expect(fetchTradeCardState).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Зафиксировать план" })).toBeInTheDocument();
  });
});

describe("Trade Card — the server's first read", () => {
  it("arrives already drawn and does not read again", () => {
    render(<TradeCardWorkspace initialState={{ card: card(), reference: REFERENCE }} />);
    // No waiting: the fixed card is there on the first render.
    expect(screen.getByText("Результат после экспирации")).toBeInTheDocument();
    expect(screen.queryByText("Загружаю карточку…")).toBeNull();
    expect(fetchTradeCardState).not.toHaveBeenCalled();
  });

  it("starts an empty plan at the learner's current minute", () => {
    render(<TradeCardWorkspace initialState={{ card: null, reference: REFERENCE }} />);
    expect(screen.getByLabelText("Время входа")).toHaveValue(
      `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
    );
    expect(fetchTradeCardState).not.toHaveBeenCalled();
  });
});

describe("Trade Card — when the read fails", () => {
  it("says the tool is closed when the Backend says so", async () => {
    fetchTradeCardState.mockResolvedValue(failure("TOOL_LOCKED", "FORBIDDEN"));
    render(<TradeCardWorkspace />);
    expect(await screen.findByText("Инструмент закрыт")).toBeInTheDocument();
  });

  it("offers a retry on a network failure", async () => {
    const user = userEvent.setup();
    fetchTradeCardState
      .mockResolvedValueOnce(failure(null, "NETWORK_ERROR"))
      .mockResolvedValueOnce({ ok: true, data: { card: null, reference: REFERENCE } });
    render(<TradeCardWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("button", { name: "Зафиксировать план" })).toBeInTheDocument();
  });
});
