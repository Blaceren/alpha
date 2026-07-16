import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeScreen } from "@/features/home/home-screen";
import { getHomeState } from "@/data/mock/home-scenarios";

/**
 * Component-level guarantees for the Route Field Home (Phase D1B).
 * Financial privacy is the highest-priority invariant and is asserted structurally,
 * not just by eyeballing the screenshots.
 */

describe("HomeScreen — active lesson", () => {
  it("renders the current lesson context and the continue-lesson CTA", () => {
    render(<HomeScreen scenario="active" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Поддержка и сопротивление" }),
    ).toBeInTheDocument();
    // CTA carries the exact spec label and, since D2B, points at the canonical
    // lesson route for the current level (it was a no-op button in D1B).
    expect(screen.getByRole("link", { name: /Продолжить урок/ })).toHaveAttribute(
      "href",
      "/lessons/level.018",
    );
    // Module progress is stated as text (route meaning is not icon-only).
    expect(screen.getByText(/Модуль 4 «Чтение графика» · пройдено 2 из 5/)).toBeInTheDocument();
    // Instrumentation is present as text (provisional rank + XP + streak).
    expect(screen.getByText("Наблюдатель III")).toBeInTheDocument();
  });

  it("exposes a screen-reader route alternative to the decorative SVG", () => {
    render(<HomeScreen scenario="active" />);
    const routeNav = screen.getByRole("navigation", { name: "Твой путь обучения" });
    expect(routeNav).toBeInTheDocument();
    // The current level is announced in text.
    expect(routeNav).toHaveTextContent(/Текущий уровень: 18/);
  });
});

describe("HomeScreen — current checkpoint", () => {
  it("renders the checkpoint condition and the verify CTA", () => {
    render(<HomeScreen scenario="checkpoint" />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Подтверди условие/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Проверить выполнение/ })).toBeInTheDocument();
  });

  it("states the requirement as a target only, with the demo-excluded note", () => {
    render(<HomeScreen scenario="checkpoint" />);
    expect(screen.getByText(/баланс Pocket от \$200/)).toBeInTheDocument();
    expect(
      screen.getByText(/Учитывается только подтверждённый реальный баланс\. Demo не учитывается\./),
    ).toBeInTheDocument();
  });

  it("shows what opens beyond the gate (next rank + tool), not user money", () => {
    render(<HomeScreen scenario="checkpoint" />);
    expect(screen.getByText("Наблюдатель IV")).toBeInTheDocument();
    expect(screen.getByText("Chart Markup Tool")).toBeInTheDocument();
  });
});

describe("financial privacy (hard invariant, both scenarios)", () => {
  const FORBIDDEN = [
    /осталось/i,
    /депозит/i,
    /внес/i,
    /вывод/i,
    /пополн/i,
    /deposit/i,
    /withdraw/i,
    /твой баланс/i,
    /ваш баланс/i,
    /баланс:\s*\$/i,
    /перейти в pocket/i,
    /открыть pocket/i,
  ];

  it("active home never shows any money figure or Pocket CTA", () => {
    const { container } = render(<HomeScreen scenario="active" />);
    const text = container.textContent ?? "";
    for (const rx of FORBIDDEN) expect(text).not.toMatch(rx);
    // No dollar amount at all on the active home.
    expect(text).not.toContain("$");
  });

  it("checkpoint home shows only the requirement target ($200) and nothing else money-like", () => {
    const { container } = render(<HomeScreen scenario="checkpoint" />);
    const text = container.textContent ?? "";
    for (const rx of FORBIDDEN) expect(text).not.toMatch(rx);
    // Exactly one dollar sign in the whole subtree: the requirement target.
    const dollars = (text.match(/\$/g) ?? []).length;
    expect(dollars).toBe(1);
    expect(text).toContain("баланс Pocket от $200");
  });

  it("the requirement amount is not the page heading (never the largest text)", () => {
    render(<HomeScreen scenario="checkpoint" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).not.toContain("$200");
    expect(h1.textContent).toMatch(/Подтверди условие/);
  });
});

describe("accessibility — single document heading per scenario", () => {
  it("active renders exactly one <h1>", () => {
    render(<HomeScreen scenario="active" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
  it("checkpoint renders exactly one <h1>", () => {
    render(<HomeScreen scenario="checkpoint" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("scenario data wiring", () => {
  it("active and checkpoint resolve to distinct primary actions", () => {
    expect(getHomeState("active").primaryAction.kind).toBe("continue-lesson");
    expect(getHomeState("checkpoint").primaryAction.kind).toBe("verify-checkpoint");
  });
});
