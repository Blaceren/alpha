import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NormalizedError } from "@/lib/api/errors";
import type { NewsCalendarState, NewsEvent, NewsPlan } from "./news-model";
import { zonedWallTimeToInstant } from "./news-model";

const fetchNewsCalendar = vi.fn();
const saveNewsPlan = vi.fn();
vi.mock("./news-client", () => ({
  fetchNewsCalendar: (window: unknown) => fetchNewsCalendar(window),
  saveNewsPlan: (plan: unknown) => saveNewsPlan(plan),
}));

import { NewsWorkspace } from "./news-workspace";

const warsaw = (day: string, time: string) => new Date(zonedWallTimeToInstant(day, time, "Europe/Warsaw")!).toISOString();

function event(day: string, time: string, currency: string, importance: number, title: string): NewsEvent {
  return {
    slug: `${currency.toLowerCase()}-${day}-${time.replace(":", "")}`,
    title,
    country: currency === "USD" ? "US" : currency === "EUR" ? "EA" : "GB",
    countryLabel: currency === "USD" ? "США" : currency === "EUR" ? "Еврозона" : "Великобритания",
    currency,
    importance,
    releaseAt: warsaw(day, time),
    forecast: "0.3%",
    previous: "0.2%",
    actual: null,
  };
}

/** The presentation's day. */
const EVENTS = [
  event("2026-09-21", "08:00", "GBP", 3, "ВВП, м/м"),
  event("2026-09-21", "11:00", "EUR", 2, "ИПЦ, г/г"),
  event("2026-09-21", "14:30", "USD", 3, "Базовый индекс потребительских цен, м/м"),
];

const PLAN: NewsPlan = {
  version: 1,
  timeZone: "Europe/Warsaw",
  minImportance: 3,
  minutesBefore: 15,
  minutesAfter: 15,
  currencies: ["USD", "EUR"],
  savedAt: "2026-09-20T10:00:00.000Z",
};

function state(overrides: Partial<NewsCalendarState> = {}): NewsCalendarState {
  return {
    plan: PLAN,
    window: { from: "2026-09-20T00:18:00.000Z", to: "2026-09-23T00:18:00.000Z" },
    events: EVENTS,
    reference: {
      currencies: ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY"],
      countries: [],
      importance: [],
      minutes: [5, 10, 15, 30, 60],
      planImportance: [3, 2],
    },
    ...overrides,
  };
}

function failure(code: string | null, category: NormalizedError["category"] = "VALIDATION_ERROR") {
  return { ok: false as const, error: { category, status: 400, code, messageKey: "x", requestId: null, retryable: false }, detail: null };
}

beforeEach(() => {
  fetchNewsCalendar.mockReset();
  saveNewsPlan.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  // 14:18 in Warsaw — the presentation's moment.
  vi.setSystemTime(new Date("2026-09-21T12:18:00.000Z"));
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw" }).resolvedOptions(),
    timeZone: "Europe/Warsaw",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("News Calendar — the presentation's window", () => {
  it("says the entry is closed by the plan until 14:45, twelve minutes before the release", async () => {
    render(<NewsWorkspace initialState={state()} initialDay="2026-09-21" />);
    expect(await screen.findByText("Вход закрыт по вашему плану до 14:45")).toBeInTheDocument();
    expect(screen.getByText(/Через 12 мин:/)).toHaveTextContent("Через 12 мин: USD · Базовый индекс потребительских цен, м/м.");
    expect(screen.getByText("Первое движение после публикации — только наблюдение.")).toBeInTheDocument();
    expect(fetchNewsCalendar).not.toHaveBeenCalled();
  });

  it("draws the day's windows and releases in the learner's zone", () => {
    render(<NewsWorkspace initialState={state()} initialDay="2026-09-21" />);
    expect(screen.getByRole("heading", { name: "Сегодня, 21 сентября · понедельник" })).toBeInTheDocument();
    expect(screen.getByText("Вход закрыт по плану: 14:15–14:45.")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("time")?.textContent)).toEqual(["08:00", "11:00", "14:30"]);
    expect(rows[0]).toHaveTextContent("Прошло");
    expect(rows[0]).toHaveTextContent("Вне вашего плана");
    expect(rows[2]).toHaveTextContent("Скоро");
    // «Скоро» is the next hour, not the rest of the day.
    expect(rows[2]!.querySelector(".nc-event__state")?.textContent).toBe("Скоро");
    expect(rows[2]).toHaveTextContent("Вход закрыт 14:15–14:45");
    expect(within(rows[2]!).getByRole("link", { name: "Базовый индекс потребительских цен, м/м" })).toHaveAttribute(
      "href",
      "/news/usd-2026-09-21-1430",
    );
    expect(screen.getByText("План в силе · версия 1")).toBeInTheDocument();
  });

  it("shows the page in the zone chosen on the form, and says the change is not saved", async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(<NewsWorkspace initialState={state()} initialDay="2026-09-21" />);
    await user.selectOptions(screen.getByLabelText("Часовой пояс"), "Europe/Moscow");
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("time")?.textContent)).toEqual(["09:00", "12:00", "15:30"]);
    expect(screen.getByText("Изменения не сохранены")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Вернуть план в силе" }));
    expect(screen.getByText("План в силе · версия 1")).toBeInTheDocument();
  });

  it("reads another day on its own, in the learner's zone", async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    fetchNewsCalendar.mockResolvedValue({
      ok: true,
      data: state({ events: [event("2026-09-28", "16:00", "USD", 3, "Решение по ставке ФРС")] }),
    });
    render(<NewsWorkspace initialState={state()} initialDay="2026-09-21" />);
    for (let step = 0; step < 7; step += 1) await user.click(screen.getByRole("button", { name: "Следующий день" }));
    expect(screen.getByRole("heading", { name: "28 сентября · понедельник" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Решение по ставке ФРС")).toBeInTheDocument());
    const lastCall = fetchNewsCalendar.mock.calls.at(-1)![0] as { from: number; to: number };
    expect(new Date(lastCall.from).toISOString()).toBe("2026-09-27T22:00:00.000Z");
    expect(new Date(lastCall.to).toISOString()).toBe("2026-09-28T22:00:00.000Z");
    await user.click(screen.getByRole("button", { name: "Сегодня" }));
    expect(screen.getByRole("heading", { name: "Сегодня, 21 сентября · понедельник" })).toBeInTheDocument();
  });
});

describe("News Calendar — the learner's plan", () => {
  it("starts without a plan and without windows, only the calendar", () => {
    render(<NewsWorkspace initialState={state({ plan: null })} />);
    expect(screen.getByText("Плана по новостям пока нет")).toBeInTheDocument();
    expect(screen.getByText("Окна закрытого входа появятся на шкале, когда вы сохраните план.")).toBeInTheDocument();
    expect(screen.queryByText(/Вход закрыт/)).toBeNull();
    expect(screen.getByLabelText("Часовой пояс")).toHaveValue("Europe/Warsaw");
    expect(screen.getByText("Не сохранён")).toBeInTheDocument();
  });

  it("asks for every choice before saving, and focuses the first one", async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(<NewsWorkspace initialState={state({ plan: null })} />);
    await user.click(screen.getByRole("button", { name: "Сохранить план" }));
    expect(saveNewsPlan).not.toHaveBeenCalled();
    expect(screen.getByText("Выберите, какие новости закрывают вход.")).toBeInTheDocument();
    expect(screen.getByText("Отметьте хотя бы одну валюту своих активов.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Какие новости закрывают вход" })).toBeInTheDocument());
  });

  it("saves the learner's own plan, and the windows follow it", async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    saveNewsPlan.mockResolvedValue({ ok: true, data: { plan: PLAN } });
    render(<NewsWorkspace initialState={state({ plan: null })} />);
    await user.click(screen.getByRole("radio", { name: "Только высокая" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "Не входить до выхода" })).getByRole("radio", { name: "15 мин" }));
    await user.click(
      within(screen.getByRole("radiogroup", { name: "Только наблюдать после выхода" })).getByRole("radio", { name: "15 мин" }),
    );
    await user.click(screen.getByRole("button", { name: "EUR" }));
    await user.click(screen.getByRole("button", { name: "USD" }));
    expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Сохранить план" }));
    expect(saveNewsPlan).toHaveBeenCalledWith({
      timeZone: "Europe/Warsaw",
      minImportance: 3,
      minutesBefore: 15,
      minutesAfter: 15,
      currencies: ["USD", "EUR"],
    });
    expect(await screen.findByText("План сохранён")).toBeInTheDocument();
    expect(screen.getByText("План в силе · версия 1")).toBeInTheDocument();
    expect(screen.getByText("Вход закрыт по плану: 14:15–14:45.")).toBeInTheDocument();
    expect(screen.getByText("Вход закрыт по вашему плану до 14:45")).toBeInTheDocument();
  });

  it("reads from the browser when the server could not, and says when the tool is closed", async () => {
    fetchNewsCalendar.mockResolvedValue(failure("TOOL_LOCKED", "FORBIDDEN"));
    render(<NewsWorkspace />);
    expect(await screen.findByText("News Calendar открывается после контрольной точки уровня 30.")).toBeInTheDocument();
    expect(fetchNewsCalendar).toHaveBeenCalledWith(null);
  });
});
