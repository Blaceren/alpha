import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToolsHub } from "./tools-hub";
import { resolveToolWindows, toolAccessOpening } from "@/features/tool-windows/model/access";

function rows() {
  return screen.getAllByRole("listitem");
}

describe("«Инструменты» — the six tools", () => {
  it("lists the six in unlock order, with one h1 and the open count", () => {
    render(<ToolsHub tools={resolveToolWindows(toolAccessOpening(["tool.trade_card"]))} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(rows().map((row) => row.querySelector(".twh-row__title")?.textContent)).toEqual([
      "Trade Card",
      "Trading Journal",
      "Risk Calculator",
      "Entry Checklist",
      "Personal Stats",
      "News Calendar",
    ]);
    expect(screen.getByText("Открыто 1 из 6")).toBeInTheDocument();
    expect(screen.getByText("План сделки до входа: актив, направление, сумма, payout, экспирация и причина.")).toBeInTheDocument();
  });

  it("opens an unlocked tool in the SAME tab, as one full-row link", () => {
    render(<ToolsHub tools={resolveToolWindows(toolAccessOpening(["tool.trade_card"]))} />);
    const open = screen.getByRole("link", { name: /Trade Card/ });
    expect(open).toHaveAttribute("href", "/tools/trade-card");
    expect(open).not.toHaveAttribute("target");
    expect(within(open).getByText("Открыть")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("names the level of a locked tool and offers no way into it, and no preview", () => {
    render(<ToolsHub tools={resolveToolWindows(null)} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(within(rows()[0]!).getByText("Откроется на уровне 5")).toBeInTheDocument();
    expect(screen.getByText("Откроется на уровне 20")).toBeInTheDocument();
    expect(screen.queryByText(/Как будет выглядеть/)).toBeNull();
  });

  it("says «Скоро» for an earned tool this build does not have", () => {
    render(<ToolsHub tools={resolveToolWindows(toolAccessOpening(["tool.trade_card", "tool.trading_journal"]))} />);
    const journal = rows()[1]!;
    expect(within(journal).getByText("Скоро")).toBeInTheDocument();
    expect(within(journal).queryByRole("link")).toBeNull();
  });

  it("promises no signal and no money", () => {
    const { container } = render(<ToolsHub tools={resolveToolWindows(null)} />);
    expect(container.textContent).toContain("Инструменты обучения, не торговые сигналы.");
    for (const word of ["баланс", "депозит", "доходност", "заработ"]) {
      expect(container.textContent?.toLowerCase()).not.toContain(word);
    }
  });
});
