import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NormalizedError } from "@/lib/api/errors";
import type { ChecklistState, EntryCheck } from "./checklist-model";

const fetchChecklistState = vi.fn();
const saveEntryCheck = vi.fn();
vi.mock("./checklist-client", () => ({
  fetchChecklistState: () => fetchChecklistState(),
  saveEntryCheck: (check: unknown) => saveEntryCheck(check),
}));

import { ChecklistWorkspace } from "./checklist-workspace";

const ITEMS = [
  { code: "no_news", group: "environment", stop: true, label: "Рядом нет важной новости (±15 мин)" },
  { code: "stable_connection", group: "environment", stop: true, label: "Связь стабильна" },
  { code: "payout_minimum", group: "environment", stop: false, label: "Payout не ниже моего минимума" },
  { code: "market_state", group: "setup", stop: false, label: "Состояние рынка определено: тренд или боковик" },
  { code: "price_at_zone", group: "setup", stop: false, label: "Цена у зоны, отмеченной до сессии" },
  { code: "setup_conditions", group: "setup", stop: false, label: "Все условия моего setup выполнены" },
  { code: "daily_limit", group: "state", stop: true, label: "Дневной лимит не достигнут" },
  { code: "no_revenge", group: "state", stop: true, label: "Нет желания отыграться" },
  { code: "attention", group: "state", stop: false, label: "Внимание на графике, не устал" },
];
const STATE: ChecklistState = {
  recent: [],
  lastMinPayoutPercent: 85,
  checklist: {
    groups: [
      { code: "environment", label: "Среда" },
      { code: "setup", label: "Setup" },
      { code: "state", label: "Моё состояние" },
    ],
    items: ITEMS,
  },
  reference: {
    assets: [
      { code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" },
      { code: "BTCUSD_OTC", label: "BTC/USD OTC", group: "crypto_otc" },
    ],
  },
};
const ALL = Object.fromEntries(ITEMS.map((item) => [item.code, true]));

function check(overrides: Partial<EntryCheck> = {}): EntryCheck {
  return {
    id: "cmcheck0000000abcdefghij",
    asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
    minPayoutPercent: 85,
    answers: ALL,
    verdict: "enter",
    missingItem: null,
    createdAt: new Date(2026, 8, 21, 14, 30).toISOString(),
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

const item = (name: RegExp | string) => screen.getByRole("checkbox", { name });
const verdict = () =>
  screen.getByText(/^(Вход по плану допустим|Не входить: .*|Отметьте, что выполнено)$/).closest<HTMLElement>(".ck-verdict")!;

async function tickAll(user: ReturnType<typeof userEvent.setup>, except: string[] = []) {
  for (const entry of ITEMS) {
    if (except.includes(entry.code)) continue;
    await user.click(item(new RegExp(entry.label.slice(0, 12).replace(/[()±]/g, "."))));
  }
}

beforeEach(() => {
  fetchChecklistState.mockReset();
  saveEntryCheck.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 22, 10, 0));
});
afterEach(() => vi.useRealTimers());

describe("Entry Checklist — the check", () => {
  it("opens with every item open, the learner's minimum, and asks for the first tick", () => {
    render(<ChecklistWorkspace initialState={STATE} />);
    expect(fetchChecklistState).not.toHaveBeenCalled();
    expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByLabelText("Мой минимум payout")).toHaveValue("85");
    expect(item(/Payout не ниже моего минимума — 85%/)).toBeInTheDocument();
    expect(screen.getByText("Актив не выбран · перед входом")).toBeInTheDocument();
    expect(screen.getByText("0 / 9")).toBeInTheDocument();
    // Nothing answered yet: no «не входить» before the learner has started.
    expect(within(verdict()).getByText("Отметьте, что выполнено")).toBeInTheDocument();
    expect(within(verdict()).getByText(/входить нельзя/)).toBeInTheDocument();
  });

  it("marks the four stop factors, and names them in their groups", () => {
    render(<ChecklistWorkspace initialState={STATE} />);
    expect(screen.getAllByText("Стоп-фактор")).toHaveLength(4);
    expect(item(/Связь стабильна/)).toHaveAccessibleName("Связь стабильна Стоп-фактор");
    expect(screen.getByRole("group", { name: "Моё состояние" })).toBeInTheDocument();
  });

  it("follows every tick: a stop factor wins, then the first open condition, then the entry", async () => {
    const user = userEvent.setup();
    render(<ChecklistWorkspace initialState={STATE} />);
    await user.selectOptions(screen.getByLabelText("Актив"), "EURUSD_OTC");
    expect(screen.getByText("EUR/USD OTC · перед входом")).toBeInTheDocument();
    await tickAll(user, ["no_revenge", "price_at_zone"]);
    expect(screen.getByText("7 / 9")).toBeInTheDocument();
    expect(within(verdict()).getByText("Не входить: стоп-фактор")).toBeInTheDocument();
    expect(within(verdict()).getByText("Не отмечено: «Нет желания отыграться». Отказ от сделки — полноценное решение.")).toBeInTheDocument();
    await user.click(item(/Нет желания отыграться/));
    expect(within(verdict()).getByText("Не входить: условие не выполнено")).toBeInTheDocument();
    expect(within(verdict()).getByText(/Цена у зоны, отмеченной до сессии/)).toBeInTheDocument();
    await user.click(item(/Цена у зоны/));
    expect(screen.getByText("9 / 9")).toBeInTheDocument();
    expect(within(verdict()).getByText("Вход по плану допустим")).toBeInTheDocument();
    expect(within(verdict()).getByText("Все условия выполнены. Решение и сумму вы подтверждаете сами.")).toBeInTheDocument();
  });

  it("clears the ticks on request", async () => {
    const user = userEvent.setup();
    render(<ChecklistWorkspace initialState={STATE} />);
    expect(screen.queryByRole("button", { name: "Снять отметки" })).toBeNull();
    await user.click(item(/Связь стабильна/));
    await user.click(screen.getByRole("button", { name: "Снять отметки" }));
    expect(screen.getByText("0 / 9")).toBeInTheDocument();
  });
});

describe("Entry Checklist — keeping a check", () => {
  it("asks for the asset first, and sends nothing without it", async () => {
    const user = userEvent.setup();
    render(<ChecklistWorkspace initialState={STATE} />);
    await user.click(screen.getByRole("button", { name: "Записать проверку" }));
    expect(saveEntryCheck).not.toHaveBeenCalled();
    expect(screen.getByText("Выберите актив, для которого проверка.")).toBeInTheDocument();
    expect(screen.getByLabelText("Актив")).toHaveFocus();
  });

  it("keeps a declined trade too, with the exact answers, then opens every item again", async () => {
    const user = userEvent.setup();
    const kept = check({ verdict: "skip_stop", missingItem: "no_news", answers: { ...ALL, no_news: false } });
    saveEntryCheck.mockResolvedValue({ ok: true, data: { check: kept, recent: [kept], lastMinPayoutPercent: 85 } });
    render(<ChecklistWorkspace initialState={STATE} />);
    await user.selectOptions(screen.getByLabelText("Актив"), "EURUSD_OTC");
    await tickAll(user, ["no_news"]);
    await user.click(screen.getByRole("button", { name: "Записать проверку" }));
    expect(saveEntryCheck).toHaveBeenCalledWith({
      asset: "EURUSD_OTC",
      minPayoutPercent: 85,
      answers: { ...ALL, no_news: false },
    });
    expect(await screen.findByText("Проверка записана · не входить")).toBeInTheDocument();
    expect(screen.getByText("0 / 9")).toBeInTheDocument();
    expect(within(verdict()).getByText("Отметьте, что выполнено")).toBeInTheDocument();
    // The asset and the minimum stay for the next check.
    expect(screen.getByLabelText("Актив")).toHaveValue("EURUSD_OTC");
    const list = screen.getByRole("heading", { name: "Последние проверки" }).closest("section")!;
    expect(within(list).getByText("21 сентября, 14:30 · EUR/USD OTC · payout от 85%")).toBeInTheDocument();
    expect(within(list).getByText("Не входить · стоп-фактор: Рядом нет важной новости (±15 мин)")).toBeInTheDocument();
  });

  it("sends no minimum when the field is empty, and refuses one outside 20–99", async () => {
    const user = userEvent.setup();
    saveEntryCheck.mockResolvedValue({ ok: true, data: { check: check(), recent: [check()], lastMinPayoutPercent: null } });
    render(<ChecklistWorkspace initialState={{ ...STATE, lastMinPayoutPercent: null }} />);
    await user.selectOptions(screen.getByLabelText("Актив"), "BTCUSD_OTC");
    // Letters never reach the field, and neither does a third digit.
    await user.type(screen.getByLabelText("Мой минимум payout"), "льдл150");
    expect(screen.getByLabelText("Мой минимум payout")).toHaveValue("15");
    await user.click(screen.getByRole("button", { name: "Записать проверку" }));
    expect(screen.getByText("Минимум payout — целое число от 20 до 99, или оставьте поле пустым.")).toBeInTheDocument();
    expect(saveEntryCheck).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Мой минимум payout")).toHaveFocus();
    await user.clear(screen.getByLabelText("Мой минимум payout"));
    await user.click(screen.getByRole("button", { name: "Записать проверку" }));
    expect(saveEntryCheck).toHaveBeenCalledWith(expect.objectContaining({ asset: "BTCUSD_OTC", minPayoutPercent: null }));
  });

  it("shows the checks already kept, and says so when there are none", () => {
    const { unmount } = render(<ChecklistWorkspace initialState={STATE} />);
    expect(screen.getByText("Проверок пока нет. Запишите первую перед следующим входом.")).toBeInTheDocument();
    unmount();
    render(<ChecklistWorkspace initialState={{ ...STATE, recent: [check()] }} />);
    expect(screen.getByText("Вход допустим")).toBeInTheDocument();
  });

  it("says the tool is closed when the Backend says so", async () => {
    fetchChecklistState.mockResolvedValue(failure("TOOL_LOCKED", "FORBIDDEN"));
    render(<ChecklistWorkspace />);
    expect(await screen.findByText("Entry Checklist открывается после контрольной точки уровня 20.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Продолжить путь" })).toHaveAttribute("href", "/path");
  });
});
