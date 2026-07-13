import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ProductPortalConcept from "@/app/concepts/product-portal/page";
import MarketAtlasConcept from "@/app/concepts/market-atlas/page";
import EditorialAcademyConcept from "@/app/concepts/editorial-academy/page";

const CONCEPTS = [
  { name: "Product Portal", Cmp: ProductPortalConcept },
  { name: "Market Atlas", Cmp: MarketAtlasConcept },
  { name: "Editorial Academy", Cmp: EditorialAcademyConcept },
] as const;

describe.each(CONCEPTS)("concept page: $name", ({ Cmp }) => {
  it("renders the same product content", () => {
    const { container } = render(<Cmp />);
    // Rank, level, primary action, checkpoint target.
    expect(screen.getAllByText("Наблюдатель III").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Поддержка и сопротивление/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Продолжить урок/).length).toBeGreaterThan(0);
    expect(container.textContent).toContain("требуется баланс Pocket от");
    expect(container.textContent).toContain("$200");
    // Nearest reward + available tools.
    expect(screen.getAllByText("Chart Markup Tool").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Trading Journal").length).toBeGreaterThan(0);
  });

  it("shows the shared navigation labels", () => {
    render(<Cmp />);
    for (const label of ["Сообщество", "Ментор", "Поддержка", "Инструменты"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // Mobile bottom-nav "Ещё" is present.
    expect(screen.getAllByText("Ещё").length).toBeGreaterThan(0);
  });

  it("shows NO user balance and NO Pocket CTA", () => {
    const { container } = render(<Cmp />);
    // No "remaining $X" / balance / deposit language.
    expect(container.textContent).not.toMatch(/осталось|ваш баланс|депозит|вывод средств/i);
    // No actionable control (button/link) that opens Pocket.
    const controls = [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")];
    for (const el of controls) {
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").toLowerCase();
      expect(name).not.toContain("pocket");
    }
  });

  it("does not leak raw internal codes to the user", () => {
    const { container } = render(<Cmp />);
    expect(container.textContent ?? "").not.toMatch(
      /level\.\d{3}|tool\.[a-z_]+|rank\.[a-z_]+|channel\.[a-z_]+/,
    );
  });

  it("has a single primary-action button (one obvious next step)", () => {
    render(<Cmp />);
    const primaryButtons = screen
      .getAllByRole("button")
      .filter((b) => /Продолжить урок/.test(b.textContent ?? ""));
    expect(primaryButtons).toHaveLength(1);
  });
});

describe("navigation landmark", () => {
  it("exposes semantic nav regions", () => {
    render(<ProductPortalConcept />);
    const primary = screen.getByRole("navigation", { name: "Основная навигация" });
    expect(within(primary).getByText("Путь")).toBeInTheDocument();
  });
});
