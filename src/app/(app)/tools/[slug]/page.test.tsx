/**
 * TOOLS-V2 — one tool's page: which address lands where, and which state shows.
 *
 * The state comes from the Backend's verdict on the curriculum read and from
 * nothing in the address. An old lesson link by canonical code still arrives,
 * a retired code lands on the tools page, and an unknown one is a 404. Every
 * state carries the way back to the other tools, in the same tab.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AcademyToolAccess } from "@/lib/curriculum/academy-view";

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
class NotFound extends Error {}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new NotFound("not found");
  },
}));
vi.mock("@/config/academy-config", () => ({ getAcademyConfig: () => ({ mode: "api" }) }));
const getCurriculumView = vi.fn();
vi.mock("@/lib/curriculum/provider", () => ({ getCurriculumView: () => getCurriculumView() }));
vi.mock("@/server/auth/server-session", () => ({
  getServerViewer: async () => ({ name: "Ученик" }),
  shellViewerName: async () => "Ученик",
}));
vi.mock("@/components/shell/unread-presence", () => ({ UnreadPresence: () => null }));
const shellProps = vi.fn();
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children, ...props }: { children: ReactNode }) => {
    shellProps(props);
    return <main>{children}</main>;
  },
}));
const readTradeCard = vi.fn();
vi.mock("@/server/tools/trade-card-read", () => ({ readTradeCardStateOnServer: () => readTradeCard() }));
const readJournal = vi.fn();
vi.mock("@/server/tools/journal-read", () => ({ readJournalOnServer: () => readJournal() }));
const readRisk = vi.fn();
vi.mock("@/server/tools/risk-read", () => ({ readRiskStateOnServer: () => readRisk() }));
const readChecklist = vi.fn();
vi.mock("@/server/tools/checklist-read", () => ({ readChecklistOnServer: () => readChecklist() }));
const readStats = vi.fn();
vi.mock("@/server/tools/stats-read", () => ({ readStatsOnServer: () => readStats() }));
const workspaceProps = vi.fn();
vi.mock("@/features/tool-windows/trade-card/trade-card-workspace", () => ({
  TradeCardWorkspace: (props: unknown) => {
    workspaceProps(props);
    return <p>trade-card-workspace</p>;
  },
}));
const journalProps = vi.fn();
vi.mock("@/features/tool-windows/journal/journal-workspace", () => ({
  JournalWorkspace: (props: unknown) => {
    journalProps(props);
    return <p>journal-workspace</p>;
  },
}));
const riskProps = vi.fn();
vi.mock("@/features/tool-windows/risk/risk-workspace", () => ({
  RiskWorkspace: (props: unknown) => {
    riskProps(props);
    return <p>risk-workspace</p>;
  },
}));
const checklistProps = vi.fn();
vi.mock("@/features/tool-windows/checklist/checklist-workspace", () => ({
  ChecklistWorkspace: (props: unknown) => {
    checklistProps(props);
    return <p>checklist-workspace</p>;
  },
}));
const statsProps = vi.fn();
vi.mock("@/features/tool-windows/stats/stats-workspace", () => ({
  StatsWorkspace: (props: unknown) => {
    statsProps(props);
    return <p>stats-workspace</p>;
  },
}));
const readNews = vi.fn();
vi.mock("@/server/tools/news-read", () => ({ readNewsCalendarOnServer: () => readNews() }));
const newsProps = vi.fn();
vi.mock("@/features/tool-windows/news/news-workspace", () => ({
  NewsWorkspace: (props: unknown) => {
    newsProps(props);
    return <p>news-workspace</p>;
  },
}));

import ToolRoute from "./page";
import { toolAccessOpening } from "@/features/tool-windows/model/access";

function enrolled(toolAccess: AcademyToolAccess | null, completedThrough: number) {
  const levels = Array.from({ length: 12 }, (_, index) => ({
    order: index + 1,
    title: index + 1 === 5 ? "Жизненный цикл сделки" : `Уровень ${index + 1}`,
    state: index + 1 <= completedThrough ? "completed" : index + 1 === completedThrough + 1 ? "current" : "locked",
  }));
  return { ok: true, view: { state: "enrolled", curriculum: {}, modules: [{ levels }], progress: {}, toolAccess } };
}

async function open(slug: string) {
  return ToolRoute({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
}

async function landing(slug: string): Promise<string | "404"> {
  try {
    await open(slug);
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    if (error instanceof NotFound) return "404";
    throw error;
  }
  throw new Error("expected a redirect or a 404");
}

beforeEach(() => {
  getCurriculumView.mockReset();
  shellProps.mockReset();
  workspaceProps.mockReset();
  readTradeCard.mockReset();
  readTradeCard.mockResolvedValue(null);
  readJournal.mockReset();
  readJournal.mockResolvedValue(null);
  readRisk.mockReset();
  readRisk.mockResolvedValue(null);
  readChecklist.mockReset();
  readChecklist.mockResolvedValue(null);
  readStats.mockReset();
  readStats.mockResolvedValue(null);
  statsProps.mockReset();
  journalProps.mockReset();
  riskProps.mockReset();
  checklistProps.mockReset();
});

describe("the address", () => {
  it("sends a lesson link by canonical code to the tool's own address", async () => {
    expect(await landing("tool.trade_card")).toBe("/tools/trade-card");
    expect(await landing("tool.news_calendar")).toBe("/tools/news");
  });

  it("sends a retired tool to the tools page", async () => {
    expect(await landing("tool.chart_markup")).toBe("/tools");
    expect(await landing("tool.pro_workspace")).toBe("/tools");
  });

  it("answers 404 for anything else", async () => {
    expect(await landing("nope")).toBe("404");
    expect(await landing("tool.secret")).toBe("404");
  });
});

describe("the page", () => {
  it("sits in the Academy shell, on the product's flat field, with Tools current", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card"]), 5));
    render(await open("trade-card"));
    expect(shellProps).toHaveBeenCalledWith(expect.objectContaining({ activeId: "tools", frozenSurface: true }));
  });

  it("always leads back to every other tool, in the same tab", async () => {
    getCurriculumView.mockResolvedValue(enrolled(null, 2));
    render(await open("trade-card"));
    const back = screen.getByRole("link", { name: "Все инструменты" });
    expect(back).toHaveAttribute("href", "/tools");
    expect(back).not.toHaveAttribute("target");
  });
});

describe("the state", () => {
  it("hands the server's first read of the card to the tool, so it arrives already drawn", async () => {
    const state = { card: null, reference: { assets: [], expiries: [] } };
    readTradeCard.mockResolvedValue(state);
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card"]), 5));
    render(await open("trade-card"));
    expect(workspaceProps).toHaveBeenCalledWith({ initialState: state, journalOpen: false });
    // Only the tool on screen is read.
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("tells the Trade Card when the journal is open, so a saved card says where it went", async () => {
    readTradeCard.mockResolvedValue(null);
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card", "tool.trading_journal"]), 10));
    render(await open("trade-card"));
    expect(workspaceProps).toHaveBeenCalledWith({ initialState: null, journalOpen: true });
  });

  it("opens the Trading Journal on an open verdict, with the server's first page", async () => {
    const page = { entries: [], nextCursor: null, summary: {}, filter: "all", reference: {} };
    readJournal.mockResolvedValue(page);
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card", "tool.trading_journal"]), 10));
    render(await open("journal"));
    expect(screen.getByRole("heading", { level: 1, name: "Trading Journal" })).toBeInTheDocument();
    expect(screen.getByText("journal-workspace")).toBeInTheDocument();
    expect(journalProps).toHaveBeenCalledWith({ initialPage: page, reviewCardId: null });
    expect(readTradeCard).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Все инструменты" })).toHaveAttribute("href", "/tools");
  });

  it("passes a saved card's id on to the journal, and ignores anything that is not an id", async () => {
    readJournal.mockResolvedValue(null);
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card", "tool.trading_journal"]), 10));
    const at = (card: unknown) =>
      ToolRoute({ params: Promise.resolve({ slug: "journal" }), searchParams: Promise.resolve({ card } as never) });
    render(await at("cm3k9x2p10000abcdefghij"));
    expect(journalProps).toHaveBeenLastCalledWith({ initialPage: null, reviewCardId: "cm3k9x2p10000abcdefghij" });
    for (const hostile of ["../x", "<script>", ["cm3k9x2p10000abcdefghij", "x"], "short"]) {
      render(await at(hostile));
      expect(journalProps).toHaveBeenLastCalledWith({ initialPage: null, reviewCardId: null });
    }
  });

  it("opens the Risk Calculator on an open verdict, with the server's plan, and reads nothing else", async () => {
    const state = { plan: null, history: [], reference: { riskShares: [1, 2, 3, 5], streakLength: 5 } };
    readRisk.mockResolvedValue(state);
    const earned = ["tool.trade_card", "tool.trading_journal", "tool.risk_calculator"];
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(earned), 12));
    render(await open("risk-calculator"));
    expect(screen.getByRole("heading", { level: 1, name: "Risk Calculator" })).toBeInTheDocument();
    expect(screen.getByText("risk-workspace")).toBeInTheDocument();
    expect(riskProps).toHaveBeenCalledWith({ initialState: state });
    expect(readTradeCard).not.toHaveBeenCalled();
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("opens the Entry Checklist on an open verdict, with the server's first read", async () => {
    const state = { recent: [], lastMinPayoutPercent: null, checklist: { groups: [], items: [] }, reference: { assets: [] } };
    readChecklist.mockResolvedValue(state);
    const earned = ["tool.trade_card", "tool.trading_journal", "tool.risk_calculator", "tool.entry_checklist"];
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(earned), 12));
    render(await open("entry-checklist"));
    expect(screen.getByRole("heading", { level: 1, name: "Entry Checklist" })).toBeInTheDocument();
    expect(checklistProps).toHaveBeenCalledWith({ initialState: state });
    expect(readRisk).not.toHaveBeenCalled();
  });

  it("opens Personal Stats on an open verdict, with the server's all-time read", async () => {
    const stats = { period: "all", trades: 0 };
    readStats.mockResolvedValue(stats);
    const earned = ["tool.trade_card", "tool.trading_journal", "tool.risk_calculator", "tool.entry_checklist", "tool.personal_stats"];
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(earned), 12));
    render(await open("stats"));
    expect(screen.getByRole("heading", { level: 1, name: "Personal Stats" })).toBeInTheDocument();
    expect(statsProps).toHaveBeenCalledWith({ initialStats: stats });
    expect(readChecklist).not.toHaveBeenCalled();
  });

  it("locks Personal Stats until level 25 is completed", async () => {
    const earned = ["tool.trade_card", "tool.trading_journal", "tool.risk_calculator", "tool.entry_checklist"];
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(earned), 12));
    render(await open("stats"));
    expect(screen.queryByText("stats-workspace")).toBeNull();
    expect(screen.getByRole("heading", { name: "Откроется после уровня 25" })).toBeInTheDocument();
  });

  it("locks the Entry Checklist until level 20 is completed", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card", "tool.trading_journal", "tool.risk_calculator"]), 12));
    render(await open("entry-checklist"));
    expect(screen.queryByText("checklist-workspace")).toBeNull();
    expect(screen.getByRole("heading", { name: "Откроется после уровня 20" })).toBeInTheDocument();
  });

  it("locks the Risk Calculator until level 15 is completed", async () => {
    readRisk.mockResolvedValue(null);
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card", "tool.trading_journal"]), 12));
    render(await open("risk-calculator"));
    expect(screen.queryByText("risk-workspace")).toBeNull();
    expect(screen.getByRole("heading", { name: "Откроется после уровня 15" })).toBeInTheDocument();
  });

  it("locks the journal until level 10 is completed, whatever the read of it says", async () => {
    readJournal.mockResolvedValue(null);
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card"]), 9));
    render(await open("journal"));
    expect(screen.queryByText("journal-workspace")).toBeNull();
    expect(screen.getByRole("heading", { name: "Откроется после уровня 10" })).toBeInTheDocument();
  });

  it("opens the Trade Card when the Backend says it is unlocked", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card"]), 5));
    render(await open("trade-card"));
    expect(screen.getByRole("heading", { level: 1, name: "Trade Card" })).toBeInTheDocument();
    expect(screen.getByText("Уровень 5")).toBeInTheDocument();
    expect(screen.getByText("trade-card-workspace")).toBeInTheDocument();
    expect(screen.getByText("Инструмент обучения, не торговый сигнал.")).toBeInTheDocument();
  });

  it("locks it on a closed verdict, says where the learner is and names the lesson, with no preview", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening([]), 2));
    render(await open("trade-card"));
    expect(screen.queryByText("trade-card-workspace")).toBeNull();
    expect(screen.getByText("Закрыто · вы на уровне 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Откроется после уровня 5" })).toBeInTheDocument();
    expect(screen.getByText("Инструмент появится после урока 5 «Жизненный цикл сделки».")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/как будет выглядеть/i)).toBeNull();
    // The one next step.
    expect(screen.getByRole("link", { name: "Продолжить путь" })).toHaveAttribute("href", "/path");
  });

  /* 2026-10-02 — the 30-level program releases the same tools after other
     levels, and none of them is a checkpoint. */
  it("names the level the VERDICT gives, and what that level is in the learner's own program", async () => {
    const access: AcademyToolAccess = {
      total: 6,
      unlockedCount: 1,
      tools: [
        { code: "tool.trade_card", unlocked: true, unlockLevel: 5 },
        { code: "tool.trading_journal", unlocked: false, unlockLevel: 9 },
        { code: "tool.risk_calculator", unlocked: false, unlockLevel: 13 },
        { code: "tool.entry_checklist", unlocked: false, unlockLevel: 13 },
        { code: "tool.personal_stats", unlocked: false, unlockLevel: 24 },
        { code: "tool.news_calendar", unlocked: false, unlockLevel: 28 },
      ],
    };
    const levels = Array.from({ length: 30 }, (_, index) => {
      const order = index + 1;
      return {
        order,
        title: order === 9 ? "Первые пять demo-сделок и разбор" : order === 24 ? "Своя статистика" : `Уровень ${order}`,
        state: order <= 5 ? "completed" : "locked",
        typeInfo: { type: order === 9 ? "report" : "lesson", isCheckpoint: false },
        kind: order === 9 ? "report" : order === 24 ? "assembly" : "lesson",
        inProduction: order >= 15,
      };
    });
    getCurriculumView.mockResolvedValue({
      ok: true,
      view: { state: "enrolled", curriculum: {}, modules: [{ levels }], progress: {}, toolAccess: access },
    });

    render(await open("journal"));
    // Level 9, not the catalogue's 10 — and a report, so not «контрольная точка».
    expect(screen.getByRole("heading", { name: "Откроется после уровня 9" })).toBeInTheDocument();
    expect(
      screen.getByText("Инструмент появится после уровня 9 «Первые пять demo-сделок и разбор»."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/контрольной точки/)).toBeNull();
  });

  it("says so when the level that releases a tool is itself not open yet", async () => {
    const access: AcademyToolAccess = {
      total: 1,
      unlockedCount: 0,
      tools: [{ code: "tool.personal_stats", unlocked: false, unlockLevel: 24 }],
    };
    const levels = [
      { order: 14, title: "Четырнадцатый", state: "completed", typeInfo: { type: "lesson", isCheckpoint: false }, kind: "assembly", inProduction: false },
      { order: 24, title: "Своя статистика", state: "locked", typeInfo: { type: "lesson", isCheckpoint: false }, kind: "assembly", inProduction: true },
    ];
    getCurriculumView.mockResolvedValue({
      ok: true,
      view: { state: "enrolled", curriculum: {}, modules: [{ levels }], progress: {}, toolAccess: access },
    });
    render(await open("stats"));
    expect(
      screen.getByText("Инструмент появится после уровня 24 «Своя статистика». Этот уровень ещё готовится."),
    ).toBeInTheDocument();
  });

  it("opens nothing when the read fails — and says it failed, not «Закрыто» (2026-10-04)", async () => {
    getCurriculumView.mockResolvedValue({ ok: false, error: { category: "BACKEND_UNAVAILABLE" } });
    render(await open("trade-card"));
    expect(screen.queryByText("trade-card-workspace")).toBeNull();
    expect(screen.queryByText("Закрыто")).toBeNull();
    expect(screen.getByText("Не удалось загрузить инструменты")).toBeInTheDocument();
  });

  it("still says «Закрыто» when the answer is about the learner (not enrolled)", async () => {
    getCurriculumView.mockResolvedValue({ ok: false, error: { category: "NOT_ENROLLED" } });
    render(await open("trade-card"));
    expect(screen.queryByText("trade-card-workspace")).toBeNull();
    expect(screen.getByText("Закрыто")).toBeInTheDocument();
  });

  it("does not fall back to the old plan's checkpoint when the view does not describe the level (2026-10-04)", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card"]), 8));
    render(await open("news"));
    expect(screen.getByText("Закрыто · вы на уровне 9")).toBeInTheDocument();
    expect(screen.getByText("Инструмент появится после уровня 30.")).toBeInTheDocument();
    expect(screen.queryByText(/контрольной точки/)).toBeNull();
  });

  it("opens the News Calendar on an open verdict, with the server's read and the learner's day", async () => {
    const news = { plan: { timeZone: "Asia/Tokyo" }, window: {}, events: [], reference: {} };
    readNews.mockResolvedValue({ state: news, day: "2026-09-22" });
    const earned = [
      "tool.trade_card",
      "tool.trading_journal",
      "tool.risk_calculator",
      "tool.entry_checklist",
      "tool.personal_stats",
      "tool.news_calendar",
    ];
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(earned), 12));
    render(await open("news"));
    expect(screen.getByRole("heading", { level: 1, name: "News Calendar" })).toBeInTheDocument();
    expect(newsProps).toHaveBeenCalledWith({ initialState: news, initialDay: "2026-09-22" });
    expect(readStats).not.toHaveBeenCalled();
  });

  it("locks the News Calendar until level 30 is completed", async () => {
    const earned = ["tool.trade_card", "tool.trading_journal", "tool.risk_calculator", "tool.entry_checklist", "tool.personal_stats"];
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(earned), 12));
    render(await open("news"));
    expect(screen.queryByText("news-workspace")).toBeNull();
    expect(screen.getByRole("heading", { name: "Откроется после уровня 30" })).toBeInTheDocument();
  });
});
