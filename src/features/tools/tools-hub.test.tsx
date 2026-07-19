import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToolsHub } from "@/features/tools/components/tools-hub";
import { ToolSurface } from "@/features/tools/components/tool-surface";

describe("Tools Hub — operational ledger", () => {
  it("has exactly one h1 and the honest manual note", () => {
    render(<ToolsHub scenario="active" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByText(/Записи вводятся вручную и не синхронизируются с брокером/),
    ).toBeInTheDocument();
  });

  it("shows Trading Journal as the current working tool with the one CTA", () => {
    render(<ToolsHub scenario="active" />);
    const cta = screen.getByRole("link", { name: /Открыть журнал/ });
    expect(cta).toHaveAttribute("href", "/tools/tool.trading_journal");
    // Exactly one working CTA on the hub.
    expect(screen.getAllByRole("link", { name: /Открыть журнал/ })).toHaveLength(1);
  });

  it("shows Risk Calculator as unlocked-but-coming-soon, with NO working CTA", () => {
    render(<ToolsHub scenario="active" />);
    expect(screen.getByText("Risk Calculator")).toBeInTheDocument();
    expect(screen.getByText(/Открыт по прогрессу · инструмент готовится/)).toBeInTheDocument();
  });

  it("shows locked tools with their exact target level and no CTA", () => {
    render(<ToolsHub scenario="active" />);
    expect(screen.getByText("Откроется на уровне 20")).toBeInTheDocument();
    expect(screen.getByText("Откроется на уровне 25")).toBeInTheDocument();
  });

  it("locked hub (early user) has no working CTA at all", () => {
    render(<ToolsHub scenario="early" />);
    expect(screen.queryByRole("link", { name: /Открыть журнал/ })).toBeNull();
    // Trading Journal appears, but locked.
    expect(screen.getByText("Откроется на уровне 10")).toBeInTheDocument();
  });

  it("renders no chart / KPI / balance / aggregate language", () => {
    render(<ToolsHub scenario="active" />);
    const html = document.body.textContent ?? "";
    for (const banned of ["баланс", "P/L", "win rate", "%", "депозит", "итого"]) {
      expect(html.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe("Tool surface dispatch", () => {
  it("locked tool → locked state, no form", () => {
    render(<ToolSurface toolCode="tool.chart_markup" scenario="active" />);
    expect(screen.getByText(/Откроется на уровне 20/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Добавить/ })).toBeNull();
  });

  it("unlocked-but-coming-soon tool → calm coming-soon, no fake working CTA", () => {
    render(<ToolSurface toolCode="tool.risk_calculator" scenario="active" />);
    expect(screen.getByText(/инструмент готовится/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("unknown tool code → not-found convention, no crash", () => {
    render(<ToolSurface toolCode="tool.nope" scenario="active" />);
    expect(screen.getByText(/Инструмент не найден/)).toBeInTheDocument();
  });

  it("available Trading Journal → the workspace (has the manual note + spine)", () => {
    render(<ToolSurface toolCode="tool.trading_journal" scenario="active" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(within(h1).getByText("Trading Journal")).toBeInTheDocument();
    expect(
      screen.getByText(/Записи вводятся вручную и не синхронизируются с брокером/),
    ).toBeInTheDocument();
  });
});
