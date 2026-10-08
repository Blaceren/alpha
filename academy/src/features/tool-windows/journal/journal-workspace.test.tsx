import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NormalizedError } from "@/lib/api/errors";
import type { JournalEntry, JournalPage, JournalReference } from "./journal-model";

const fetchJournalPage = vi.fn();
const createJournalEntry = vi.fn();
const changeJournalEntry = vi.fn();
const deleteJournalEntry = vi.fn();
vi.mock("./journal-client", () => ({
  fetchJournalPage: (filter: string, before?: string | null) => fetchJournalPage(filter, before ?? null),
  createJournalEntry: (entry: unknown) => createJournalEntry(entry),
  changeJournalEntry: (id: string, change: unknown) => changeJournalEntry(id, change),
  deleteJournalEntry: (id: string) => deleteJournalEntry(id),
}));

import { JournalWorkspace } from "./journal-workspace";

const REFERENCE: JournalReference = {
  assets: [
    { code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" },
    { code: "BTCUSD_OTC", label: "BTC/USD OTC", group: "crypto_otc" },
    { code: "GBPUSD_OTC", label: "GBP/USD OTC", group: "currency_otc" },
  ],
  expiries: [
    { code: "M1", label: "1 мин", seconds: 60 },
    { code: "M3", label: "3 мин", seconds: 180 },
  ],
  violations: [
    { code: "no_reason", label: "Вход без записанного основания" },
    { code: "revenge", label: "Хотел отыграться после убытка" },
    { code: "amount_above_plan", label: "Сумма больше плана" },
  ],
};

const FROM_CARD: JournalEntry = {
  id: "cm4j0urnal0001abcdefghij",
  source: "trade_card",
  tradeCardId: "cm3k9x2p10000abcdefghij",
  tradeDate: "2026-09-21",
  entryTime: "14:32",
  asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
  direction: "up",
  amount: "8.00",
  payoutPercent: 90,
  expiry: { code: "M3", label: "3 мин", seconds: 180 },
  result: "profit",
  resultAmount: "7.20",
  plan: "Отскок от уровня, отмеченного до сессии",
  execution: null,
  conclusion: null,
  planFollowed: null,
  violations: [],
  createdAt: "2026-09-21T11:40:00.000Z",
  updatedAt: "2026-09-21T11:40:00.000Z",
};
const BROKEN: JournalEntry = {
  ...FROM_CARD,
  id: "cm4j0urnal0002abcdefghij",
  source: "manual",
  tradeCardId: null,
  entryTime: "14:02",
  asset: { code: "BTCUSD_OTC", label: "BTC/USD OTC" },
  direction: "down",
  amount: "16.00",
  result: "loss",
  resultAmount: "16.00",
  plan: null,
  execution: "Вход через минуту после убытка, сумма удвоена.",
  conclusion: "Хотел отыграться. После убытка пауза 10 минут.",
  planFollowed: false,
  violations: ["revenge", "amount_above_plan"],
};
const YESTERDAY: JournalEntry = {
  ...FROM_CARD,
  id: "cm4j0urnal0003abcdefghij",
  tradeDate: "2026-09-20",
  entryTime: "10:15",
  asset: { code: "GBPUSD_OTC", label: "GBP/USD OTC" },
  planFollowed: true,
  conclusion: null,
};

function page(overrides: Partial<JournalPage> = {}): JournalPage {
  return {
    entries: [FROM_CARD, BROKEN, YESTERDAY],
    nextCursor: null,
    summary: { total: 3, onPlan: 1, violated: 1, unmarked: 1, withoutConclusion: 2 },
    filter: "all",
    reference: REFERENCE,
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

const row = (asset: RegExp) => screen.getByRole("button", { name: asset });
/** «Дата»: a field that is pressed, with the day in words as its value. */
const dateField = () => screen.getByRole("combobox", { name: "Дата" });

beforeEach(() => {
  fetchJournalPage.mockReset();
  createJournalEntry.mockReset();
  changeJournalEntry.mockReset();
  deleteJournalEntry.mockReset();
  // The learner's clock: only Date is faked, so user-event's timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 21, 15, 0));
});
afterEach(() => vi.useRealTimers());

describe("Trading Journal — the list", () => {
  it("arrives already drawn from the server's read: counts, days, and each trade on a line", () => {
    render(<JournalWorkspace initialPage={page()} />);
    expect(fetchJournalPage).not.toHaveBeenCalled();
    expect(screen.queryByText("Загружаю журнал…")).toBeNull();

    const counts = screen.getByText("Записей").closest("dl")!;
    expect(counts).toHaveTextContent("Записей3");
    expect(counts).toHaveTextContent("По плану1 из 3");
    expect(counts).toHaveTextContent("Без вывода2");

    const days = screen.getAllByRole("heading", { level: 2 });
    expect(days.map((day) => day.textContent)).toEqual(["21 сентябряпонедельник", "20 сентябрявоскресенье"]);

    const card = row(/EUR\/USD OTC/);
    expect(card).toHaveTextContent("14:32");
    expect(card).toHaveTextContent("Выше");
    expect(card).toHaveTextContent("$8.00");
    expect(card).toHaveTextContent("+$7.20");
    expect(card).toHaveTextContent("Не отмечено");
    expect(row(/BTC\/USD OTC/)).toHaveTextContent("−$16.00");
    expect(row(/BTC\/USD OTC/)).toHaveTextContent("Нарушен");
    expect(row(/GBP\/USD OTC/)).toHaveTextContent("По плану");
  });

  it("adds no money up: one trade's stake and result, and counts of entries only", () => {
    const { container } = render(<JournalWorkspace initialPage={page()} />);
    expect(container.textContent).not.toMatch(/итого|баланс|P\/L|прибыль за|win rate/i);
  });

  it("opens an entry in place: ОСНОВАНИЕ · ИСПОЛНЕНИЕ · ВЫВОД, the broken rules and the facts", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    const line = row(/BTC\/USD OTC/);
    expect(line).toHaveAttribute("aria-expanded", "false");
    await user.click(line);
    expect(line).toHaveAttribute("aria-expanded", "true");
    const detail = document.getElementById(line.getAttribute("aria-controls")!)!;
    expect(detail).toBeVisible();
    expect(within(detail).getByText("Основание не записано")).toBeInTheDocument();
    expect(within(detail).getByText("Вход через минуту после убытка, сумма удвоена.")).toBeInTheDocument();
    expect(within(detail).getByText("Хотел отыграться после убытка")).toBeInTheDocument();
    expect(within(detail).getByText("Сумма больше плана")).toBeInTheDocument();
    expect(within(detail).getByText("Payout 90% · Экспирация 3 мин · Записано вручную")).toBeInTheDocument();
    // Reviewed already: its review, the entry itself, and its delete are all offered.
    expect(within(detail).getByRole("button", { name: "Изменить разбор" })).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Изменить запись" })).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Удалить" })).toBeInTheDocument();
    await user.click(line);
    expect(line).toHaveAttribute("aria-expanded", "false");
  });

  it("offers every entry the same three actions, whichever source it came from", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/EUR\/USD OTC/));
    const detail = document.getElementById(row(/EUR\/USD OTC/).getAttribute("aria-controls")!)!;
    expect(within(detail).getByText("Payout 90% · Экспирация 3 мин · Из Trade Card")).toBeInTheDocument();
    const actions = within(detail).getAllByRole("button");
    // In this order: the review first, the delete last and apart.
    expect(actions.map((button) => button.textContent)).toEqual(["Разобрать сделку", "Изменить запись", "Удалить"]);
    // Real buttons, each of its own kind: none of them is bare text.
    expect(actions.map((button) => button.getAttribute("data-variant"))).toEqual(["primary", "outline", "danger"]);
  });

  it("says so on the entry once it no longer agrees with its card", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page({ entries: [{ ...FROM_CARD, editedAfterCard: true }, BROKEN, YESTERDAY] })} />);
    await user.click(row(/EUR\/USD OTC/));
    expect(screen.getByText("Payout 90% · Экспирация 3 мин · Из Trade Card · изменена в журнале")).toBeInTheDocument();
  });

  it("reads from the browser when the server could not, and retries after a failure", async () => {
    const user = userEvent.setup();
    fetchJournalPage.mockResolvedValueOnce(failure(null, "NETWORK_ERROR")).mockResolvedValueOnce({ ok: true, data: page() });
    render(<JournalWorkspace />);
    expect(await screen.findByText("Нет связи с Академией. Проверьте интернет и попробуйте ещё раз.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("button", { name: /EUR\/USD OTC/ })).toBeInTheDocument();
    expect(fetchJournalPage).toHaveBeenCalledWith("all", null);
  });

  it("says the tool is closed when the Backend says so, and where to go", async () => {
    fetchJournalPage.mockResolvedValue(failure("TOOL_LOCKED", "FORBIDDEN"));
    render(<JournalWorkspace />);
    expect(await screen.findByRole("heading", { name: "Инструмент закрыт" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Продолжить путь" })).toHaveAttribute("href", "/path");
  });

  it("explains an empty journal and offers both ways in", () => {
    const empty = page({ entries: [], summary: { total: 0, onPlan: 0, violated: 0, unmarked: 0, withoutConclusion: 0 } });
    render(<JournalWorkspace initialPage={empty} />);
    expect(screen.getByRole("heading", { name: "Журнал пока пуст" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Записать сделку" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть Trade Card" })).toHaveAttribute("href", "/tools/trade-card");
    expect(screen.queryByText("Записей")).toBeNull();
  });
});

describe("Trading Journal — filter and pages", () => {
  it("asks the Backend for a filter's own first page", async () => {
    const user = userEvent.setup();
    fetchJournalPage.mockResolvedValue({ ok: true, data: page({ entries: [BROKEN], filter: "violated" }) });
    render(<JournalWorkspace initialPage={page()} />);
    const violated = screen.getByRole("button", { name: /План нарушен/ });
    expect(screen.getByRole("button", { name: /^Все/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(violated);
    expect(fetchJournalPage).toHaveBeenCalledWith("violated", null);
    await waitFor(() => expect(screen.queryByRole("button", { name: /EUR\/USD OTC/ })).toBeNull());
    expect(violated).toHaveAttribute("aria-pressed", "true");
    expect(row(/BTC\/USD OTC/)).toBeInTheDocument();
  });

  it("keeps the lines on screen, quieted, while a filter's page is on its way", async () => {
    const user = userEvent.setup();
    let arrive: (value: unknown) => void = () => {};
    fetchJournalPage.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    const { container } = render(<JournalWorkspace initialPage={page()} />);
    await user.click(screen.getByRole("button", { name: /План нарушен/ }));
    const list = container.querySelector(".jr-list")!;
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(list).toHaveAttribute("data-stale");
    expect(row(/EUR\/USD OTC/)).toBeInTheDocument();
    // Said to assistive technology; the eye sees the quieted lines.
    expect(screen.getByText("Загружаю записи…")).toHaveClass("tw-sr-only");
    arrive({ ok: true, data: page({ entries: [BROKEN], filter: "violated" }) });
    await waitFor(() => expect(screen.queryByRole("button", { name: /EUR\/USD OTC/ })).toBeNull());
    expect(list).not.toHaveAttribute("data-stale");
  });

  it("says so plainly when a filter has nothing, and leads back to everything", async () => {
    const user = userEvent.setup();
    fetchJournalPage
      .mockResolvedValueOnce({ ok: true, data: page({ entries: [], filter: "no_conclusion" }) })
      .mockResolvedValueOnce({ ok: true, data: page() });
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(screen.getByRole("button", { name: /Нет вывода/ }));
    expect(await screen.findByText("Вывод записан у каждой сделки.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Показать все записи" }));
    expect(fetchJournalPage).toHaveBeenLastCalledWith("all", null);
    expect(await screen.findByRole("button", { name: /EUR\/USD OTC/ })).toBeInTheDocument();
  });

  it("brings the next page after the last line on screen", async () => {
    const user = userEvent.setup();
    const older: JournalEntry = { ...YESTERDAY, id: "cm4j0urnal0009abcdefghij", tradeDate: "2026-09-02", asset: { code: "M1", label: "Old trade" } };
    fetchJournalPage.mockResolvedValue({ ok: true, data: page({ entries: [older], nextCursor: null }) });
    render(<JournalWorkspace initialPage={page({ nextCursor: YESTERDAY.id })} />);
    await user.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(fetchJournalPage).toHaveBeenCalledWith("all", YESTERDAY.id);
    expect(await screen.findByRole("button", { name: /Old trade/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Показать ещё" })).toBeNull();
    expect(screen.getByRole("heading", { name: /2 сентября/ })).toBeInTheDocument();
  });
});

describe("Trading Journal — arriving from a saved card", () => {
  it("opens that card's entry straight into its review, and clears the address", () => {
    window.history.pushState({}, "", "/tools/journal?card=cm3k9x2p10000abcdefghij");
    render(<JournalWorkspace initialPage={page()} reviewCardId="cm3k9x2p10000abcdefghij" />);
    const line = row(/EUR\/USD OTC/);
    expect(line).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("radio", { name: "По плану" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Сохранить разбор" })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/tools/journal");
  });

  it("finds it after the browser's own first read, too", async () => {
    fetchJournalPage.mockResolvedValue({ ok: true, data: page() });
    render(<JournalWorkspace reviewCardId="cm3k9x2p10000abcdefghij" />);
    expect(await screen.findByRole("button", { name: "Сохранить разбор" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "По плану" })).toHaveFocus();
  });

  it("opens nothing for a card that is not on the page", () => {
    render(<JournalWorkspace initialPage={page()} reviewCardId="cm9other000000abcdefghij" />);
    expect(screen.queryByRole("button", { name: "Сохранить разбор" })).toBeNull();
  });
});

describe("Trading Journal — the review", () => {
  it("records the mark, the broken rules, and the conclusion, and updates the line and counts", async () => {
    const user = userEvent.setup();
    const reviewed = { ...FROM_CARD, planFollowed: false, violations: ["revenge"], conclusion: "Пауза после убытка" };
    changeJournalEntry.mockResolvedValue({ ok: true, data: reviewed });
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/EUR\/USD OTC/));
    await user.click(screen.getByRole("button", { name: "Разобрать сделку" }));

    // Focus moves into the review, and the plan stays in view above it.
    expect(screen.getByRole("radio", { name: "По плану" })).toHaveFocus();
    const detail = document.getElementById(row(/EUR\/USD OTC/).getAttribute("aria-controls")!)!;
    expect(within(detail).getByText("Отскок от уровня, отмеченного до сессии")).toBeVisible();
    // The rules appear only for a broken plan.
    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Нарушен" }));
    await user.click(screen.getByRole("checkbox", { name: "Хотел отыграться после убытка" }));
    await user.type(screen.getByLabelText("Вывод"), "  Пауза после убытка ");
    await user.click(screen.getByRole("button", { name: "Сохранить разбор" }));

    expect(changeJournalEntry).toHaveBeenCalledWith(FROM_CARD.id, {
      kind: "review",
      planFollowed: false,
      violations: ["revenge"],
      execution: null,
      conclusion: "Пауза после убытка",
    });
    expect(await screen.findByText("Разбор сохранён")).toBeInTheDocument();
    expect(row(/EUR\/USD OTC/)).toHaveTextContent("Нарушен");
    expect(row(/EUR\/USD OTC/)).toHaveFocus();
    const counts = screen.getByText("Записей").closest("dl")!;
    expect(counts).toHaveTextContent("Без вывода1");
    expect(counts).toHaveTextContent("По плану1 из 3");
    expect(screen.getByRole("button", { name: /План нарушен/ })).toHaveTextContent("План нарушен 2");
  });

  it("drops the rules when the plan is marked followed after all", async () => {
    const user = userEvent.setup();
    changeJournalEntry.mockResolvedValue({ ok: true, data: { ...FROM_CARD, planFollowed: true } });
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/EUR\/USD OTC/));
    await user.click(screen.getByRole("button", { name: "Разобрать сделку" }));
    await user.click(screen.getByRole("radio", { name: "Нарушен" }));
    await user.click(screen.getByRole("checkbox", { name: "Вход без записанного основания" }));
    await user.click(screen.getByRole("radio", { name: "По плану" }));
    await user.click(screen.getByRole("button", { name: "Сохранить разбор" }));
    expect(changeJournalEntry).toHaveBeenCalledWith(FROM_CARD.id, expect.objectContaining({ planFollowed: true, violations: [] }));
  });

  it("keeps the review in place and says why when the Backend refuses a field", async () => {
    const user = userEvent.setup();
    changeJournalEntry.mockResolvedValue(failure("TOOL_VALIDATION", "VALIDATION_ERROR", "invalid_conclusion"));
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/EUR\/USD OTC/));
    await user.click(screen.getByRole("button", { name: "Разобрать сделку" }));
    await user.type(screen.getByLabelText("Вывод"), "Итог");
    await user.click(screen.getByRole("button", { name: "Сохранить разбор" }));
    expect(await screen.findByText("Вывод — не длиннее 2000 символов.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить разбор" })).toBeInTheDocument();
  });

  it("shows the journal as it is now when the entry changed elsewhere", async () => {
    const user = userEvent.setup();
    changeJournalEntry.mockResolvedValue(failure("JOURNAL_ENTRY_NOT_FOUND", "UNKNOWN_ERROR"));
    fetchJournalPage.mockResolvedValue({ ok: true, data: page() });
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/EUR\/USD OTC/));
    await user.click(screen.getByRole("button", { name: "Разобрать сделку" }));
    await user.click(screen.getByRole("button", { name: "Сохранить разбор" }));
    expect(await screen.findByText("Этой записи уже нет — показываю актуальный журнал.")).toBeInTheDocument();
    expect(fetchJournalPage).toHaveBeenCalledWith("all", null);
  });
});

describe("Trading Journal — a trade recorded by hand", () => {
  async function fillTrade(user: ReturnType<typeof userEvent.setup>) {
    // The day before the learner's today is one press; the time is four digits.
    await user.click(dateField());
    await user.click(screen.getByRole("button", { name: "Вчера" }));
    await user.clear(screen.getByLabelText("Время входа"));
    await user.type(screen.getByLabelText("Время входа"), "1005");
    await user.selectOptions(screen.getByLabelText("Актив"), "GBPUSD_OTC");
    await user.click(screen.getByRole("radio", { name: /Ниже/ }));
    await user.type(screen.getByLabelText("Сумма"), "5");
    await user.type(screen.getByLabelText("Payout"), "88");
    await user.selectOptions(screen.getByLabelText("Экспирация"), "M1");
    await user.click(screen.getByRole("radio", { name: "Убыток" }));
  }

  it("opens a form of its own, on the learner's today, focused on its heading", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(screen.getByRole("button", { name: "Новая запись" }));
    expect(screen.getByRole("heading", { name: "Новая запись" })).toHaveFocus();
    // The learner's own today, in words, and their own clock — not the browser's date field.
    expect(dateField()).toHaveTextContent("Сегодня");
    expect(dateField()).toHaveTextContent("21 сентября");
    expect(screen.getByLabelText("Время входа")).toHaveValue("15:00");
    expect(document.querySelector('input[type="date"], input[type="time"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /EUR\/USD OTC/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByRole("button", { name: "Новая запись" })).toHaveFocus();
  });

  it("names every missing field, sends nothing, and takes the learner to the first one", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(screen.getByRole("button", { name: "Новая запись" }));
    await user.click(screen.getByRole("button", { name: "Сохранить запись" }));
    expect(screen.getByText("Выберите актив из списка.")).toBeInTheDocument();
    expect(screen.getByText("Отметьте результат: прибыль или убыток.")).toBeInTheDocument();
    expect(createJournalEntry).not.toHaveBeenCalled();
    // The date and time are filled in already, so the asset is the first one missing.
    expect(screen.getByLabelText("Актив")).toHaveFocus();
    await user.selectOptions(screen.getByLabelText("Актив"), "GBPUSD_OTC");
    await user.click(screen.getByRole("button", { name: "Сохранить запись" }));
    expect(screen.getByRole("radio", { name: /Выше/ })).toHaveFocus();
  });

  it("records the trade and its review, then shows it open in its place", async () => {
    const user = userEvent.setup();
    const saved: JournalEntry = {
      ...FROM_CARD,
      id: "cm4j0urnal0004abcdefghij",
      source: "manual",
      tradeCardId: null,
      tradeDate: "2026-09-20",
      entryTime: "10:05",
      asset: { code: "GBPUSD_OTC", label: "GBP/USD OTC new" },
      direction: "down",
      amount: "5.00",
      payoutPercent: 88,
      expiry: { code: "M1", label: "1 мин", seconds: 60 },
      result: "loss",
      resultAmount: "5.00",
      plan: null,
      planFollowed: false,
      violations: ["no_reason"],
      conclusion: null,
      createdAt: "2026-09-21T13:00:00.000Z",
    };
    createJournalEntry.mockResolvedValue({ ok: true, data: saved });
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(screen.getByRole("button", { name: "Новая запись" }));
    await fillTrade(user);
    expect(screen.getByText("Итог сделки").parentElement).toHaveTextContent("−$5.00");
    await user.click(screen.getByRole("radio", { name: "Нарушен" }));
    await user.click(screen.getByRole("checkbox", { name: "Вход без записанного основания" }));
    await user.click(screen.getByRole("button", { name: "Сохранить запись" }));

    expect(createJournalEntry).toHaveBeenCalledWith({
      tradeDate: "2026-09-20",
      entryTime: "10:05",
      asset: "GBPUSD_OTC",
      direction: "down",
      amount: "5.00",
      payoutPercent: 88,
      expiry: "M1",
      result: "loss",
      plan: null,
      planFollowed: false,
      violations: ["no_reason"],
      execution: null,
      conclusion: null,
    });
    expect(await screen.findByText("Запись добавлена")).toBeInTheDocument();
    const added = row(/GBP\/USD OTC new/);
    expect(added).toHaveAttribute("aria-expanded", "true");
    expect(added).toHaveFocus();
    expect(screen.getByText("Записей").closest("dl")).toHaveTextContent("Записей4");
  });

  it("puts a refused date under the date field", async () => {
    const user = userEvent.setup();
    createJournalEntry.mockResolvedValue(failure("TOOL_VALIDATION", "VALIDATION_ERROR", "invalid_tradeDate"));
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(screen.getByRole("button", { name: "Новая запись" }));
    await fillTrade(user);
    await user.click(screen.getByRole("button", { name: "Сохранить запись" }));
    expect(await screen.findByText("Дата сделки — не раньше 2020 года и не позже сегодняшнего дня.")).toBeInTheDocument();
    expect(dateField()).toHaveAttribute("aria-invalid", "true");
    expect(dateField()).toHaveFocus();
  });

  it("changes a hand-recorded entry as a whole", async () => {
    const user = userEvent.setup();
    changeJournalEntry.mockResolvedValue({ ok: true, data: { ...BROKEN, amount: "12.00", resultAmount: "12.00" } });
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/BTC\/USD OTC/));
    await user.click(screen.getByRole("button", { name: "Изменить запись" }));
    expect(screen.getByRole("heading", { name: "Изменить запись" })).toHaveFocus();
    expect(screen.getByLabelText("Сумма")).toHaveValue("16.00");
    await user.clear(screen.getByLabelText("Сумма"));
    await user.type(screen.getByLabelText("Сумма"), "12");
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    expect(changeJournalEntry).toHaveBeenCalledWith(
      BROKEN.id,
      expect.objectContaining({
        kind: "entry",
        amount: "12.00",
        planFollowed: false,
        violations: ["revenge", "amount_above_plan"],
        conclusion: "Хотел отыграться. После убытка пауза 10 минут.",
      }),
    );
    expect(await screen.findByText("Запись изменена")).toBeInTheDocument();
    expect(row(/BTC\/USD OTC/)).toHaveTextContent("−$12.00");
  });
});

describe("Trading Journal — an entry from a card, changed whole", () => {
  it("opens in the same form with every field of the card's trade, and says the card stays as it is", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/EUR\/USD OTC/));
    await user.click(screen.getByRole("button", { name: "Изменить запись" }));

    expect(screen.getByRole("heading", { name: "Изменить запись" })).toHaveFocus();
    expect(
      screen.getByText(
        "Запись из Trade Card. Исправьте то, что записано неточно: изменения останутся в журнале, сама карточка не изменится.",
      ),
    ).toBeInTheDocument();
    expect(dateField()).toHaveTextContent("Сегодня");
    expect(screen.getByLabelText("Время входа")).toHaveValue("14:32");
    expect(screen.getByLabelText("Актив")).toHaveValue("EURUSD_OTC");
    expect(screen.getByRole("radio", { name: /Выше/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Сумма")).toHaveValue("8.00");
    expect(screen.getByLabelText("Payout")).toHaveValue("90");
    expect(screen.getByLabelText("Экспирация")).toHaveValue("M3");
    expect(screen.getByRole("radio", { name: "Прибыль" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Основание входа в сделку")).toHaveValue("Отскок от уровня, отмеченного до сессии");
  });

  it("saves the correction as the whole entry, and the line and its mark follow the Backend's answer", async () => {
    const user = userEvent.setup();
    const corrected: JournalEntry = {
      ...FROM_CARD,
      amount: "6.50",
      result: "loss",
      resultAmount: "6.50",
      editedAfterCard: true,
    };
    changeJournalEntry.mockResolvedValue({ ok: true, data: corrected });
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/EUR\/USD OTC/));
    await user.click(screen.getByRole("button", { name: "Изменить запись" }));
    await user.clear(screen.getByLabelText("Сумма"));
    await user.type(screen.getByLabelText("Сумма"), "6.5");
    await user.click(screen.getByRole("radio", { name: "Убыток" }));
    expect(screen.getByText("Итог сделки").parentElement).toHaveTextContent("−$6.50");
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));

    expect(changeJournalEntry).toHaveBeenCalledWith(FROM_CARD.id, {
      kind: "entry",
      tradeDate: "2026-09-21",
      entryTime: "14:32",
      asset: "EURUSD_OTC",
      direction: "up",
      amount: "6.50",
      payoutPercent: 90,
      expiry: "M3",
      result: "loss",
      plan: "Отскок от уровня, отмеченного до сессии",
      planFollowed: null,
      violations: [],
      execution: null,
      conclusion: null,
    });
    expect(await screen.findByText("Запись изменена")).toBeInTheDocument();
    const line = row(/EUR\/USD OTC/);
    expect(line).toHaveTextContent("−$6.50");
    expect(line).toHaveFocus();
    expect(line).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Payout 90% · Экспирация 3 мин · Из Trade Card · изменена в журнале")).toBeInTheDocument();
  });

  it("leaves the entry as it was on «Отмена», and returns to its line", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/EUR\/USD OTC/));
    await user.click(screen.getByRole("button", { name: "Изменить запись" }));
    await user.clear(screen.getByLabelText("Сумма"));
    await user.type(screen.getByLabelText("Сумма"), "99");
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(changeJournalEntry).not.toHaveBeenCalled();
    expect(row(/EUR\/USD OTC/)).toHaveTextContent("$8.00");
    expect(row(/EUR\/USD OTC/)).toHaveFocus();
  });
});

describe("Trading Journal — deleting an entry", () => {
  const AFTER = { total: 2, onPlan: 1, violated: 0, unmarked: 1, withoutConclusion: 2 };

  async function ask(user: ReturnType<typeof userEvent.setup>, asset: RegExp) {
    await user.click(row(asset));
    const detail = document.getElementById(row(asset).getAttribute("aria-controls")!)!;
    await user.click(within(detail).getByRole("button", { name: "Удалить" }));
    return detail;
  }

  it("asks first, in the entry itself, and puts the focus on the way out", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    const detail = await ask(user, /BTC\/USD OTC/);

    const question = within(detail).getByRole("group", { name: "Удалить эту запись?" });
    expect(question).toHaveAccessibleDescription("Она исчезнет из журнала и из Personal\u00a0Stats. Вернуть её будет нельзя.");
    expect(within(question).getByRole("button", { name: "Отмена" })).toHaveFocus();
    // The question replaces the entry's actions: nothing else can be started over it.
    expect(within(detail).queryByRole("button", { name: "Изменить разбор" })).toBeNull();
    expect(within(detail).queryByRole("button", { name: "Удалить" })).toBeNull();
    // The entry itself stays in view while it is asked about.
    expect(within(detail).getByText("Вход через минуту после убытка, сумма удвоена.")).toBeVisible();
    expect(deleteJournalEntry).not.toHaveBeenCalled();
  });

  it("says what stays when the entry came from a card", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    const detail = await ask(user, /EUR\/USD OTC/);
    expect(within(detail).getByRole("group", { name: "Удалить эту запись?" })).toHaveAccessibleDescription(
      "Она исчезнет из журнала и из Personal\u00a0Stats. Вернуть её будет нельзя. Карточка в Trade\u00a0Card останется.",
    );
  });

  it("leaves everything as it was on «Отмена» and on Escape, the focus back on «Удалить»", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    const detail = await ask(user, /BTC\/USD OTC/);
    await user.click(within(detail).getByRole("button", { name: "Отмена" }));
    expect(within(detail).queryByRole("group", { name: "Удалить эту запись?" })).toBeNull();
    expect(within(detail).getByRole("button", { name: "Удалить" })).toHaveFocus();

    await user.click(within(detail).getByRole("button", { name: "Удалить" }));
    await user.keyboard("{Escape}");
    expect(within(detail).queryByRole("group", { name: "Удалить эту запись?" })).toBeNull();
    expect(within(detail).getByRole("button", { name: "Удалить" })).toHaveFocus();
    expect(deleteJournalEntry).not.toHaveBeenCalled();
    expect(row(/BTC\/USD OTC/)).toBeInTheDocument();
  });

  it("does not delete on a second press of the key that asked", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    await user.click(row(/BTC\/USD OTC/));
    screen.getByRole("button", { name: "Удалить" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    // The second Enter landed on «Отмена».
    expect(deleteJournalEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Удалить эту запись?" })).toBeNull();
    expect(row(/BTC\/USD OTC/)).toBeInTheDocument();
  });

  it("deletes on «Удалить запись»: the line goes, the counts are the Backend's, the focus takes the next line", async () => {
    const user = userEvent.setup();
    deleteJournalEntry.mockResolvedValue({ ok: true, data: AFTER });
    render(<JournalWorkspace initialPage={page()} />);
    const detail = await ask(user, /BTC\/USD OTC/);
    await user.click(within(detail).getByRole("button", { name: "Удалить запись" }));

    expect(deleteJournalEntry).toHaveBeenCalledTimes(1);
    expect(deleteJournalEntry).toHaveBeenCalledWith(BROKEN.id);
    expect(await screen.findByText("Запись удалена")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /BTC\/USD OTC/ })).toBeNull();
    const counts = screen.getByText("Записей").closest("dl")!;
    expect(counts).toHaveTextContent("Записей2");
    expect(counts).toHaveTextContent("По плану1 из 2");
    expect(screen.getByRole("button", { name: /План нарушен/ })).toHaveTextContent("План нарушен 0");
    // The entry after it in the list — yesterday's — takes its place under the focus.
    expect(row(/GBP\/USD OTC/)).toHaveFocus();
    // The other lines are untouched.
    expect(row(/EUR\/USD OTC/)).toBeInTheDocument();
  });

  it("sends one delete however many times «Удалить запись» is pressed while it is on its way", async () => {
    const user = userEvent.setup();
    let arrive: (value: unknown) => void = () => {};
    deleteJournalEntry.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    render(<JournalWorkspace initialPage={page()} />);
    const detail = await ask(user, /BTC\/USD OTC/);
    const confirm = within(detail).getByRole("button", { name: "Удалить запись" });
    await user.click(confirm);
    expect(within(detail).getByRole("button", { name: "Удаляю…" })).toBeDisabled();
    expect(within(detail).getByRole("button", { name: "Отмена" })).toBeDisabled();
    fireEvent.click(within(detail).getByRole("button", { name: "Удаляю…" }));
    expect(deleteJournalEntry).toHaveBeenCalledTimes(1);
    arrive({ ok: true, data: AFTER });
    expect(await screen.findByText("Запись удалена")).toBeInTheDocument();
  });

  it("shows the empty journal once the last entry is deleted, the focus on the way to a new one", async () => {
    const user = userEvent.setup();
    deleteJournalEntry.mockResolvedValue({ ok: true, data: { total: 0, onPlan: 0, violated: 0, unmarked: 0, withoutConclusion: 0 } });
    const one = page({ entries: [BROKEN], summary: { total: 1, onPlan: 0, violated: 1, unmarked: 0, withoutConclusion: 0 } });
    render(<JournalWorkspace initialPage={one} />);
    const detail = await ask(user, /BTC\/USD OTC/);
    await user.click(within(detail).getByRole("button", { name: "Удалить запись" }));
    expect(await screen.findByRole("heading", { name: "Журнал пока пуст" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Записать сделку" })).toHaveFocus();
    expect(fetchJournalPage).not.toHaveBeenCalled();
  });

  it("keeps the question and the entry, and says why, when the delete did not go through", async () => {
    const user = userEvent.setup();
    deleteJournalEntry.mockResolvedValue(failure(null, "NETWORK_ERROR"));
    render(<JournalWorkspace initialPage={page()} />);
    const detail = await ask(user, /BTC\/USD OTC/);
    await user.click(within(detail).getByRole("button", { name: "Удалить запись" }));
    expect(await within(detail).findByRole("alert")).toHaveTextContent("Нет связи с Академией. Проверьте интернет и попробуйте ещё раз.");
    expect(within(detail).getByRole("group", { name: "Удалить эту запись?" })).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Отмена" })).toHaveFocus();
    expect(row(/BTC\/USD OTC/)).toBeInTheDocument();
    expect(screen.getByText("Записей").closest("dl")).toHaveTextContent("Записей3");
    // The reason does not outlive the question.
    await user.click(within(detail).getByRole("button", { name: "Отмена" }));
    expect(within(detail).queryByRole("alert")).toBeNull();
  });

  it("shows the journal as it is now when the entry was already deleted somewhere else", async () => {
    const user = userEvent.setup();
    deleteJournalEntry.mockResolvedValue(failure("JOURNAL_ENTRY_NOT_FOUND", "UNKNOWN_ERROR"));
    fetchJournalPage.mockResolvedValue({
      ok: true,
      data: page({ entries: [FROM_CARD, YESTERDAY], summary: AFTER }),
    });
    render(<JournalWorkspace initialPage={page()} />);
    const detail = await ask(user, /BTC\/USD OTC/);
    await user.click(within(detail).getByRole("button", { name: "Удалить запись" }));
    expect(await screen.findByText("Этой записи уже нет — показываю актуальный журнал.")).toBeInTheDocument();
    expect(fetchJournalPage).toHaveBeenCalledWith("all", null);
    await waitFor(() => expect(screen.queryByRole("button", { name: /BTC\/USD OTC/ })).toBeNull());
    expect(screen.getByText("Записей").closest("dl")).toHaveTextContent("Записей2");
  });

  it("drops a question left open when its entry is closed, or when another action starts", async () => {
    const user = userEvent.setup();
    render(<JournalWorkspace initialPage={page()} />);
    const detail = await ask(user, /BTC\/USD OTC/);
    await user.click(row(/BTC\/USD OTC/));
    await user.click(row(/BTC\/USD OTC/));
    expect(within(detail).queryByRole("group", { name: "Удалить эту запись?" })).toBeNull();
    expect(within(detail).getByRole("button", { name: "Удалить" })).toBeInTheDocument();

    // One question at a time: asking about another entry closes the first.
    await user.click(within(detail).getByRole("button", { name: "Удалить" }));
    await ask(user, /EUR\/USD OTC/);
    expect(screen.getAllByRole("group", { name: "Удалить эту запись?" })).toHaveLength(1);
    expect(within(detail).queryByRole("group", { name: "Удалить эту запись?" })).toBeNull();
  });

  it("continues «Показать ещё» from the last line on screen when the deleted entry was the cursor", async () => {
    const user = userEvent.setup();
    deleteJournalEntry.mockResolvedValue({ ok: true, data: { total: 9, onPlan: 1, violated: 1, unmarked: 7, withoutConclusion: 2 } });
    fetchJournalPage.mockResolvedValue({ ok: true, data: page({ entries: [], nextCursor: null }) });
    render(<JournalWorkspace initialPage={page({ nextCursor: YESTERDAY.id })} />);
    const detail = await ask(user, /GBP\/USD OTC/);
    await user.click(within(detail).getByRole("button", { name: "Удалить запись" }));
    expect(await screen.findByText("Запись удалена")).toBeInTheDocument();
    // Nothing follows the deleted line, so the one before it takes the focus.
    expect(row(/BTC\/USD OTC/)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Показать ещё" }));
    // Not the deleted entry's id, which the Backend would refuse.
    expect(fetchJournalPage).toHaveBeenCalledWith("all", BROKEN.id);
  });

  it("reads the list again when the only line on screen is deleted and more remain", async () => {
    const user = userEvent.setup();
    deleteJournalEntry.mockResolvedValue({ ok: true, data: AFTER });
    fetchJournalPage.mockResolvedValue({ ok: true, data: page({ entries: [FROM_CARD, YESTERDAY], summary: AFTER }) });
    render(<JournalWorkspace initialPage={page({ entries: [BROKEN], nextCursor: BROKEN.id })} />);
    const detail = await ask(user, /BTC\/USD OTC/);
    await user.click(within(detail).getByRole("button", { name: "Удалить запись" }));
    expect(fetchJournalPage).toHaveBeenCalledWith("all", null);
    expect(await screen.findByRole("button", { name: /EUR\/USD OTC/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /BTC\/USD OTC/ })).toBeNull();
  });

  it("starts the list over when the line «Показать ещё» continues from was deleted somewhere else", async () => {
    const user = userEvent.setup();
    fetchJournalPage
      .mockResolvedValueOnce(failure("TOOL_VALIDATION", "VALIDATION_ERROR", "invalid_before"))
      .mockResolvedValueOnce({ ok: true, data: page({ entries: [FROM_CARD, BROKEN], summary: AFTER }) });
    render(<JournalWorkspace initialPage={page({ nextCursor: YESTERDAY.id })} />);
    await user.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByText("Журнал изменился — показываю актуальный.")).toBeInTheDocument();
    expect(fetchJournalPage).toHaveBeenLastCalledWith("all", null);
    await waitFor(() => expect(screen.queryByRole("button", { name: /GBP\/USD OTC/ })).toBeNull());
    expect(screen.queryByRole("button", { name: "Показать ещё" })).toBeNull();
  });
});
