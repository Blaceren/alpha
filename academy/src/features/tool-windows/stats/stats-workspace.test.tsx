import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NormalizedError } from "@/lib/api/errors";
import type { JournalStats } from "./stats-model";

const fetchStats = vi.fn();
vi.mock("./stats-client", () => ({
  fetchStats: (period: string, today: string | null) => fetchStats(period, today),
}));

import { StatsWorkspace } from "./stats-workspace";

/** The presentation's example. */
function stats(overrides: Partial<JournalStats> = {}): JournalStats {
  return {
    period: "all",
    window: null,
    trades: 38,
    wins: 21,
    winRateBasisPoints: 5526,
    averagePayoutTenths: 880,
    breakEvenBasisPoints: 5319,
    onPlan: 31,
    onPlanBasisPoints: 8158,
    unmarked: 0,
    split: {
      followed: { trades: 31, wins: 19, winRateBasisPoints: 6129 },
      broken: { trades: 7, wins: 2, winRateBasisPoints: 2857 },
    },
    violations: {
      total: 7,
      items: [
        { code: "no_reason", label: "Вход без записанного основания", count: 3 },
        { code: "news_nearby", label: "Рядом важная новость", count: 2 },
        { code: "after_daily_limit", label: "Сделка после дневного лимита", count: 2 },
      ],
    },
    preliminary: true,
    minSample: 50,
    ...overrides,
  };
}

function failure(code: string | null, category: NormalizedError["category"] = "VALIDATION_ERROR") {
  return {
    ok: false as const,
    error: { category, status: 400, code, messageKey: "x", requestId: null, retryable: false },
    detail: null,
  };
}

const figure = (label: string) => screen.getByText(label, { selector: "dt" }).closest("div")!;
const row = (name: string) => screen.getByText(name).closest<HTMLElement>(".st-row")!;

beforeEach(() => {
  fetchStats.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 21, 15, 0));
});
afterEach(() => vi.useRealTimers());

describe("Personal Stats — the presentation's figures", () => {
  it("arrives drawn from the server's read of all time", () => {
    render(<StatsWorkspace initialStats={stats()} />);
    expect(fetchStats).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Всё время" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Все записи журнала")).toBeInTheDocument();
    expect(figure("Сделок")).toHaveTextContent("38в журнале");
    expect(figure("Win rate")).toHaveTextContent("55%21 из 38");
    expect(figure("Безубыточность")).toHaveTextContent("53.2%при среднем payout 88%");
    expect(figure("По плану")).toHaveTextContent("82%31 из 38");
    expect(screen.getByText("Выборка — 38 сделок, выводы предварительные.")).toBeInTheDocument();
  });

  it("reads each side of the plan against break-even", () => {
    render(<StatsWorkspace initialStats={stats()} />);
    expect(screen.getByText("отметка — безубыточность 53.2%")).toBeInTheDocument();
    expect(row("План соблюдён")).toHaveTextContent("61% · 19 из 31");
    expect(row("План соблюдён")).toHaveAttribute("data-standing", "above");
    expect(row("План нарушен")).toHaveTextContent("29% · 2 из 7");
    expect(row("План нарушен")).toHaveAttribute("data-standing", "below");
  });

  it("lists the rules broken, most frequent first, with their total", () => {
    render(<StatsWorkspace initialStats={stats()} />);
    const rules = screen.getByRole("heading", { name: "Нарушения" }).closest("section")!;
    expect(within(rules).getByText("7")).toBeInTheDocument();
    const labels = within(rules)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(labels).toEqual(["Вход без записанного основания3", "Рядом важная новость2", "Сделка после дневного лимита2"]);
  });

  it("gives no verdict for a side with fewer than five trades", () => {
    render(
      <StatsWorkspace
        initialStats={stats({
          split: {
            followed: { trades: 6, wins: 6, winRateBasisPoints: 10_000 },
            broken: { trades: 1, wins: 1, winRateBasisPoints: 10_000 },
          },
        })}
      />,
    );
    expect(row("План нарушен")).toHaveAttribute("data-standing", "few");
    expect(row("План нарушен")).toHaveTextContent("Меньше 5 сделок — рано делать вывод.");
    expect(row("План соблюдён")).toHaveAttribute("data-standing", "above");
  });

  it("says how many trades are unmarked and leaves them out of the split", () => {
    render(<StatsWorkspace initialStats={stats({ unmarked: 3 })} />);
    expect(figure("По плану")).toHaveTextContent("31 из 38 · 3 без отметки");
    expect(screen.getByText("3 сделки без отметки плана в разделение не входят — отметьте их в журнале.")).toBeInTheDocument();
  });

  it("drops the sample warning from fifty trades, and adds up no money", () => {
    const { container } = render(<StatsWorkspace initialStats={stats({ preliminary: false })} />);
    expect(screen.queryByText(/выводы предварительные/)).toBeNull();
    expect(container.textContent).not.toMatch(/\$|баланс|итого|прибыль за/i);
  });
});

describe("Personal Stats — periods and states", () => {
  it("reads 7 days with the learner's own today, keeping the figures on screen while it travels", async () => {
    const user = userEvent.setup();
    let arrive: (value: unknown) => void = () => {};
    fetchStats.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    const { container } = render(<StatsWorkspace initialStats={stats()} />);
    await user.click(screen.getByRole("button", { name: "7 дней" }));
    expect(fetchStats).toHaveBeenCalledWith("7d", "2026-09-21");
    expect(container.querySelector(".st-body")).toHaveAttribute("data-stale");
    arrive({
      ok: true,
      data: stats({ period: "7d", window: { from: "2026-09-15", to: "2026-09-21" }, trades: 5, wins: 3, winRateBasisPoints: 6000 }),
    });
    await waitFor(() => expect(screen.getByText("15–21 сентября")).toBeInTheDocument());
    expect(figure("Сделок")).toHaveTextContent("5");
    expect(container.querySelector(".st-body")).not.toHaveAttribute("data-stale");
  });

  it("explains an empty window and leads to the journal", () => {
    const empty = stats({
      trades: 0,
      wins: 0,
      winRateBasisPoints: null,
      averagePayoutTenths: null,
      breakEvenBasisPoints: null,
      onPlan: 0,
      onPlanBasisPoints: null,
      split: {
        followed: { trades: 0, wins: 0, winRateBasisPoints: null },
        broken: { trades: 0, wins: 0, winRateBasisPoints: null },
      },
      violations: { total: 0, items: [] },
    });
    render(<StatsWorkspace initialStats={empty} />);
    expect(screen.getByRole("heading", { name: "В журнале пока нет сделок" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть журнал" })).toHaveAttribute("href", "/tools/journal");
    expect(screen.queryByText("Сделок")).toBeNull();
  });

  it("keeps the figures and says so when another period cannot be read", async () => {
    const user = userEvent.setup();
    fetchStats.mockResolvedValue(failure(null, "NETWORK_ERROR"));
    render(<StatsWorkspace initialStats={stats()} />);
    await user.click(screen.getByRole("button", { name: "30 дней" }));
    expect(await screen.findByText("Нет связи с Академией. Проверьте интернет и попробуйте ещё раз.")).toBeInTheDocument();
    expect(figure("Сделок")).toHaveTextContent("38");
  });

  it("reads from the browser when the server could not, and says when the tool is closed", async () => {
    fetchStats.mockResolvedValue(failure("TOOL_LOCKED", "FORBIDDEN"));
    render(<StatsWorkspace />);
    expect(await screen.findByText("Personal Stats пока закрыт: он откроется по ходу пути, после уровня, указанного на странице «Инструменты».")).toBeInTheDocument();
    expect(fetchStats).toHaveBeenCalledWith("all", null);
  });
});
