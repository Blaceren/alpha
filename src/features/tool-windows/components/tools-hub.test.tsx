import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToolsHub } from "./tools-hub";
import { resolveToolWindows, toolAccessOpening } from "@/features/tool-windows/model/access";

function rows() {
  return screen.getAllByRole("listitem");
}

describe("«Инструменты» — the six tools", () => {
  it("lists the six in unlock order, with one h1", () => {
    render(<ToolsHub tools={resolveToolWindows(null)} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(rows().map((row) => within(row).getByRole("heading", { level: 2 }).textContent)).toEqual([
      "Trade Card",
      "Trading Journal",
      "Risk Calculator",
      "Entry Checklist",
      "Personal Stats",
      "News Calendar",
    ]);
    expect(screen.getByText("План сделки до входа: актив, направление, сумма, payout, экспирация и причина.")).toBeInTheDocument();
  });

  it("opens an unlocked tool in a new tab, safely", () => {
    render(<ToolsHub tools={resolveToolWindows(toolAccessOpening(["tool.trade_card"]))} />);
    const open = screen.getByRole("link", { name: "Открыть Trade Card в новой вкладке" });
    expect(open).toHaveAttribute("href", "/tools/trade-card");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open.getAttribute("rel")).toContain("noopener");
    expect(screen.getAllByRole("link", { name: /^Открыть / })).toHaveLength(1);
  });

  it("names the level of a locked tool and offers no way into an unbuilt one", () => {
    render(<ToolsHub tools={resolveToolWindows(null)} />);
    expect(screen.getByText("Откроется на уровне 20")).toBeInTheDocument();
    const journal = rows()[1]!;
    expect(within(journal).queryByRole("link")).toBeNull();
  });

  it("lets a learner see what a locked built tool will look like", () => {
    render(<ToolsHub tools={resolveToolWindows(null)} />);
    const peek = screen.getByRole("link", { name: /Как будет выглядеть Trade Card/ });
    expect(peek).toHaveAttribute("href", "/tools/trade-card");
    expect(peek).toHaveAttribute("target", "_blank");
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
