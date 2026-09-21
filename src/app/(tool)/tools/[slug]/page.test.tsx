/**
 * TOOLS-V2 — the tool tab: which address lands where, and which state shows.
 *
 * The state comes from the Backend's verdict on the curriculum read and from
 * nothing in the address. An old lesson link by canonical code still arrives,
 * a retired code lands on the tools page, and an unknown one is a 404.
 */
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
vi.mock("@/features/tool-windows/trade-card/trade-card-workspace", () => ({
  TradeCardWorkspace: () => <p>trade-card-workspace</p>,
}));

import ToolWindowPage from "./page";
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
  return ToolWindowPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
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

beforeEach(() => getCurriculumView.mockReset());

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

describe("the state", () => {
  it("opens the Trade Card when the Backend says it is unlocked", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card"]), 5));
    render(await open("trade-card"));
    expect(screen.getByRole("heading", { level: 1, name: "Trade Card" })).toBeInTheDocument();
    expect(screen.getByText("L05")).toBeInTheDocument();
    expect(screen.getByText("trade-card-workspace")).toBeInTheDocument();
    expect(screen.getByText("Инструмент обучения, не торговый сигнал")).toBeInTheDocument();
  });

  it("locks it on a closed verdict, says where the learner is, and names the lesson", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening([]), 2));
    render(await open("trade-card"));
    expect(screen.queryByText("trade-card-workspace")).toBeNull();
    expect(screen.getByText("Закрыто · сейчас L3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Откроется на уровне 5" })).toBeInTheDocument();
    expect(screen.getByText("Инструмент появится после урока L5 «Жизненный цикл сделки».")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать, как будет выглядеть" })).toBeInTheDocument();
  });

  it("locks everything when the read fails, rather than guessing", async () => {
    getCurriculumView.mockResolvedValue({ ok: false, error: {} });
    render(await open("trade-card"));
    expect(screen.queryByText("trade-card-workspace")).toBeNull();
    expect(screen.getByText("Закрыто")).toBeInTheDocument();
  });

  it("explains a checkpoint tool in the presentation's words, with no example yet", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card"]), 8));
    render(await open("news"));
    expect(screen.getByText("Закрыто · сейчас L9")).toBeInTheDocument();
    expect(
      screen.getByText("Инструмент появится после контрольной точки L30, когда будут пройдены уроки, на которые он опирается."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Показать, как будет выглядеть" })).toBeNull();
  });

  it("says plainly when an earned tool is not built yet", async () => {
    getCurriculumView.mockResolvedValue(enrolled(toolAccessOpening(["tool.trade_card", "tool.trading_journal"]), 11));
    render(await open("journal"));
    expect(screen.getByRole("heading", { name: "Trading Journal готовится" })).toBeInTheDocument();
  });
});
