import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PathWorkspace } from "@/features/path/components/path-workspace";
import { resolvePathScenario } from "@/features/path/model/path-state";

/**
 * Component guarantees for the Path (§23 D2A). Rendering uses the typed
 * curriculum fixture through the scenario adapter — deterministic, no backend.
 */

function nodeButton(level: number) {
  const el = document.querySelector<HTMLButtonElement>(`.pnode[data-level="${level}"]`);
  expect(el, `node button for level ${level}`).not.toBeNull();
  return el as HTMLButtonElement;
}

describe("PathWorkspace — active scenario (current L18, module 4)", () => {
  it("renders exactly one h1 «Путь» with the current context", () => {
    render(<PathWorkspace scenario="active" />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Путь");
    expect(screen.getAllByText(/Уровень 18/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Чтение графика/).length).toBeGreaterThan(0);
  });

  it("shows module 4 of 20 as the default window", () => {
    render(<PathWorkspace scenario="active" />);
    expect(screen.getAllByText(/Модуль 4 из 20/).length).toBeGreaterThan(0);
  });

  it("marks the current node with aria-current=step", () => {
    render(<PathWorkspace scenario="active" />);
    const node = nodeButton(18);
    expect(node).toHaveAttribute("aria-current", "step");
    expect(node.getAttribute("aria-label")).toMatch(/Поддержка и сопротивление/);
    expect(node.getAttribute("aria-label")).toMatch(/текущий/);
  });

  it("shows the nearest checkpoint L20 with the target only (no user balance)", () => {
    render(<PathWorkspace scenario="active" />);
    // D2A-R1: the readable gate summary lives outside the pannable canvas, so
    // the threshold and reward can never be edge-clipped by it.
    const summary = document.querySelector(".cp-summary");
    expect(summary?.textContent).toMatch(/Уровень 20/);
    expect(summary?.textContent).toMatch(/от \$200/);
    expect(summary?.textContent).toMatch(/Наблюдатель IV/);
    expect(summary?.textContent).toMatch(/Chart Markup Tool/);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/от \$200/);
    // financial privacy: no user balance, no remaining, no Pocket CTA
    expect(text).not.toMatch(/твой баланс|ваш баланс|осталось|депозит|пополн|вывод/i);
    expect(text).not.toMatch(/перейти в pocket|открыть pocket|deposit|withdraw/i);
  });

  it("module navigator lists all 20 modules", () => {
    render(<PathWorkspace scenario="active" />);
    const nav = screen.getByRole("navigation", { name: "Модули пути" });
    const buttons = within(nav).getAllByRole("button");
    // 20 module segments (the meta line is not a button)
    expect(buttons).toHaveLength(20);
  });

  it("navigator states the scale and marks current vs viewed on separate attributes", () => {
    render(<PathWorkspace scenario="active" />);
    // scale marker: the full phrase stays available to assistive tech
    expect(screen.getAllByText(/Модуль 4 из 20/).length).toBeGreaterThan(0);
    // current and viewed are distinct data hooks, not one colour class
    const current = document.querySelectorAll(".modseg[data-current]");
    const viewed = document.querySelectorAll(".modseg[data-viewed]");
    expect(current).toHaveLength(1);
    expect(viewed).toHaveLength(1);
    expect(current[0]?.getAttribute("aria-label")).toMatch(/Модуль 4/);
    expect(current[0]?.getAttribute("aria-label")).toMatch(/здесь ты сейчас/);
  });

  it("the current module stays identifiable while a different module is viewed", async () => {
    const user = userEvent.setup();
    render(<PathWorkspace scenario="active" />);
    const nav = screen.getByRole("navigation", { name: "Модули пути" });
    await user.click(within(nav).getByRole("button", { name: /Модуль 12 «Исполнение»/ }));

    const current = document.querySelector(".modseg[data-current]");
    const viewed = document.querySelector(".modseg[data-viewed]");
    expect(current?.getAttribute("aria-label")).toMatch(/Модуль 4/);
    expect(viewed?.getAttribute("aria-label")).toMatch(/Модуль 12/);
    expect(current).not.toBe(viewed);
    // and the way back is offered
    expect(screen.getByRole("button", { name: "К текущему уровню" })).toBeInTheDocument();
  });

  it("can open a completed module and a future module, then return to current", async () => {
    const user = userEvent.setup();
    render(<PathWorkspace scenario="active" />);
    const nav = screen.getByRole("navigation", { name: "Модули пути" });

    // completed module 1
    await user.click(within(nav).getByRole("button", { name: /Модуль 1 «Первое знакомство»/ }));
    expect(screen.getAllByText(/Модуль 1 из 20/).length).toBeGreaterThan(0);
    expect(nodeButton(1).getAttribute("aria-label")).toMatch(/пройден/);

    // future module 7
    await user.click(within(nav).getByRole("button", { name: /Модуль 7 «Психология новичка»/ }));
    expect(screen.getAllByText(/Модуль 7 из 20/).length).toBeGreaterThan(0);
    expect(nodeButton(31).getAttribute("aria-label")).toMatch(/закрыт/);

    // return to current
    await user.click(screen.getByRole("button", { name: "К текущему уровню" }));
    expect(screen.getAllByText(/Модуль 4 из 20/).length).toBeGreaterThan(0);
    expect(nodeButton(18)).toHaveAttribute("aria-current", "step");
  });

  it("selecting a level opens the contextual detail layer", async () => {
    const user = userEvent.setup();
    render(<PathWorkspace scenario="active" />);
    await user.click(nodeButton(18));
    const detail = screen.getByRole("complementary", { name: /Уровень 18 — детали/ });
    expect(within(detail).getByText("Поддержка и сопротивление")).toBeInTheDocument();
    expect(within(detail).getByText(/Видео-урок и тест/)).toBeInTheDocument();
    // Since D2B the detail CTA is a real link to the canonical lesson route.
    expect(within(detail).getByRole("link", { name: "Продолжить урок" })).toHaveAttribute(
      "href",
      "/lessons/level.018",
    );
    // close
    await user.click(within(detail).getByRole("button", { name: "Закрыть детали уровня" }));
    expect(screen.queryByRole("complementary", { name: /детали/ })).toBeNull();
  });

  it("a locked level explains why it is locked (no content beyond the brief)", async () => {
    const user = userEvent.setup();
    render(<PathWorkspace scenario="active" />);
    // L21 (module 5) is locked in the active scenario
    const nav = screen.getByRole("navigation", { name: "Модули пути" });
    await user.click(within(nav).getByRole("button", { name: /Модуль 5 «Индикаторы»/ }));
    await user.click(nodeButton(21));
    const detail = screen.getByRole("complementary", { name: /Уровень 21 — детали/ });
    expect(within(detail).getByText(/Состояние: закрыт/)).toBeInTheDocument();
    expect(within(detail).getByText(/после контрольной точки · Уровень 20/)).toBeInTheDocument();
    expect(within(detail).getByText(/строго по порядку/)).toBeInTheDocument();
  });

  it("states are carried by text, not colour alone", () => {
    render(<PathWorkspace scenario="active" />);
    const canvasText = document.querySelector(".path-canvas")?.textContent ?? "";
    expect(canvasText).toMatch(/пройден/);
    expect(canvasText).toMatch(/текущий/);
    expect(canvasText).toMatch(/следующий/);
  });

  it("keyboard: arrows move the selection, Enter opens detail, Escape closes, Home returns", async () => {
    const user = userEvent.setup();
    render(<PathWorkspace scenario="active" />);
    const node = nodeButton(18);
    node.focus();
    await user.keyboard("{ArrowRight}");
    expect(nodeButton(19)).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("complementary", { name: /Уровень 19 — детали/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeNull();
    // Home returns to the current level
    nodeButton(19).focus();
    await user.keyboard("{Home}");
    expect(nodeButton(18)).toHaveFocus();
  });

  it("keyboard: ArrowLeft from a module start crosses the module boundary", async () => {
    const user = userEvent.setup();
    render(<PathWorkspace scenario="active" />);
    const node = nodeButton(18);
    node.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    // 18 → 17 → 16 → 15 (module 3's checkpoint — window switched)
    expect(nodeButton(15)).toHaveFocus();
    expect(screen.getAllByText(/Модуль 3 из 20/).length).toBeGreaterThan(0);
  });

  it("exposes the semantic ordered progression structure", () => {
    render(<PathWorkspace scenario="active" />);
    const outline = screen.getByRole("navigation", { name: /Структура пути/ });
    const lists = within(outline).getAllByRole("list");
    expect(lists.length).toBeGreaterThanOrEqual(2); // modules + selected module levels
    expect(within(outline).getByText(/Модуль 20 «Самостоятельная система»/)).toBeInTheDocument();
    const currentItem = within(outline)
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("aria-current") === "step");
    expect(currentItem?.textContent).toMatch(/Уровень 18/);
  });
});

describe("PathWorkspace — checkpoint scenario (L20 gate current)", () => {
  it("the gate is the current step and shows condition + unlocks in detail", async () => {
    const user = userEvent.setup();
    render(<PathWorkspace scenario="checkpoint" />);
    const gate = nodeButton(20);
    expect(gate).toHaveAttribute("aria-current", "step");
    await user.click(gate);
    const detail = screen.getByRole("complementary", { name: /Уровень 20 — детали/ });
    expect(within(detail).getByText(/Баланс Pocket от/)).toBeInTheDocument();
    expect(within(detail).getByText(/Demo не учитывается/)).toBeInTheDocument();
    expect(within(detail).getByText("Наблюдатель IV")).toBeInTheDocument();
    expect(within(detail).getByText("Chart Markup Tool")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Проверить выполнение" })).toBeInTheDocument();
    // privacy inside the detail layer
    const text = detail.textContent ?? "";
    expect(text).not.toMatch(/осталось|депозит|пополн|вывод|deposit|withdraw/i);
  });
});

describe("PathWorkspace — advanced scenario (L85)", () => {
  it("centres module 17 with the L85 gate current", () => {
    render(<PathWorkspace scenario="advanced" />);
    expect(screen.getAllByText(/Модуль 17 из 20/).length).toBeGreaterThan(0);
    expect(nodeButton(85)).toHaveAttribute("aria-current", "step");
    expect((document.body.textContent ?? "")).toMatch(/от \$7 ?000/);
  });
});

describe("scenario resolution", () => {
  it("unknown scenario falls back to active", () => {
    expect(resolvePathScenario("nope")).toBe("active");
    expect(resolvePathScenario(undefined)).toBe("active");
    expect(resolvePathScenario("advanced")).toBe("advanced");
  });

  it("completed scenario renders without a current step", () => {
    render(<PathWorkspace scenario="completed" />);
    expect(screen.getAllByText(/Все 100 уровней пройдены/).length).toBeGreaterThan(0);
    const current = document.querySelector('.pnode[aria-current="step"]');
    expect(current).toBeNull();
  });
});
