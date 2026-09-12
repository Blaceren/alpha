import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RiskCalculatorWorkspace } from "@/features/tools/components/risk-calculator-workspace";

afterEach(cleanup);

function fill(values: Partial<Record<"capital" | "risk" | "entry" | "stop", string>>) {
  if (values.capital !== undefined)
    fireEvent.change(screen.getByLabelText("Расчётный капитал"), { target: { value: values.capital } });
  if (values.risk !== undefined)
    fireEvent.change(screen.getByLabelText("Риск на сделку, %"), { target: { value: values.risk } });
  if (values.entry !== undefined)
    fireEvent.change(screen.getByLabelText("Цена входа"), { target: { value: values.entry } });
  if (values.stop !== undefined)
    fireEvent.change(screen.getByLabelText("Стоп-цена"), { target: { value: values.stop } });
}

const validLong = { capital: "1000", risk: "2", entry: "100", stop: "96" };

describe("RiskCalculatorWorkspace — states", () => {
  it("empty state shows the four inputs, no result numbers, no strip", () => {
    render(<RiskCalculatorWorkspace />);
    expect(screen.getByLabelText("Расчётный капитал")).toBeInTheDocument();
    expect(screen.getByLabelText("Риск на сделку, %")).toBeInTheDocument();
    expect(screen.getByLabelText("Цена входа")).toBeInTheDocument();
    expect(screen.getByLabelText("Стоп-цена")).toBeInTheDocument();
    // No mobile result strip in the empty state.
    expect(document.querySelector(".rc-strip")).toBeNull();
    // Ledger rows are present but quiet (dash), never a fabricated number.
    expect(document.querySelectorAll(".rc-ledger-row.is-quiet").length).toBe(4);
  });

  it("partial input produces no valid result and no strip", () => {
    render(<RiskCalculatorWorkspace />);
    fill({ capital: "1000", risk: "2" });
    expect(document.querySelector(".rc-strip")).toBeNull();
    expect(document.querySelectorAll(".rc-ledger-row.is-on").length).toBe(0);
  });

  it("equal entry and stop shows the exact discipline error, no result", () => {
    render(<RiskCalculatorWorkspace />);
    fill({ ...validLong, stop: "100" });
    // The visible field error carries the exact copy (it also echoes in the
    // sr-only live region, hence scoping to the field error node).
    const fieldErr = document.querySelector(".rc-field-err");
    expect(fieldErr?.textContent).toBe("Цена входа и стоп-цена должны отличаться.");
    expect(document.querySelector(".rc-strip")).toBeNull();
  });

  it("valid long fills the ledger with the exact labelled figures + direction Лонг", () => {
    render(<RiskCalculatorWorkspace />);
    fill(validLong);
    // The four required output labels are present (in the ledger; some also in
    // the compact strip, hence scoping the label check to the ledger).
    const ledger = document.querySelector(".rc-ledger")!;
    const ledgerText = ledger.textContent ?? "";
    for (const label of ["Сумма риска", "Дистанция до стопа", "Размер позиции", "Расчётный номинал"]) {
      expect(ledgerText).toContain(label);
    }
    // Exact values from the canonical example.
    expect(ledgerText).toContain("20");
    expect(ledgerText).toContain("5");
    expect(ledgerText).toContain("500");
    expect(screen.getAllByText("Лонг").length).toBeGreaterThan(0);
  });

  it("valid short reports direction Шорт", () => {
    render(<RiskCalculatorWorkspace />);
    fill({ ...validLong, stop: "104" });
    expect(screen.getAllByText("Шорт").length).toBeGreaterThan(0);
    expect(screen.queryByText("Лонг")).toBeNull();
  });

  it("always shows the mandatory disclaimer", () => {
    render(<RiskCalculatorWorkspace />);
    expect(
      screen.getByText(
        /Ручной учебный расчёт\. Данные не синхронизируются со счётом или брокером и не являются инвестиционной рекомендацией\./,
      ),
    ).toBeInTheDocument();
  });

  it("shows the discipline note near the rail", () => {
    render(<RiskCalculatorWorkspace />);
    expect(screen.getByText("Стоп определяет риск на единицу позиции.")).toBeInTheDocument();
  });

  it("renders the compact result strip ONLY in the valid state", () => {
    render(<RiskCalculatorWorkspace />);
    expect(document.querySelector(".rc-strip")).toBeNull();
    fill(validLong);
    const strip = document.querySelector(".rc-strip");
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain("Лонг");
    expect(strip!.textContent).toContain("Размер позиции");
    expect(strip!.textContent).toContain("Расчётный номинал");
    // Making it invalid removes the strip again.
    fill({ stop: "100" });
    expect(document.querySelector(".rc-strip")).toBeNull();
  });
});

describe("RiskCalculatorWorkspace — no financial / execution language", () => {
  it("uses no balance/available/order copy and no currency symbol", () => {
    render(<RiskCalculatorWorkspace />);
    fill(validLong);
    const text = document.body.textContent ?? "";
    for (const banned of [
      "Баланс",
      "баланс",
      "Доступно",
      "Средства на счёте",
      "Ордер",
      "ордер",
      "Исполнено",
      "Куплено",
      "Продано",
      "Pocket",
      "₽",
      "$",
      "€",
      "USDT",
      "USD",
    ]) {
      expect(text.includes(banned), `must not contain "${banned}"`).toBe(false);
    }
  });

  it("has no submit / order / execution button", () => {
    render(<RiskCalculatorWorkspace />);
    fill(validLong);
    // The only interactive controls are the four inputs and the back link.
    expect(screen.queryByRole("button")).toBeNull();
    for (const label of [/Купить/, /Продать/, /Ордер/, /Исполнить/, /Отправить/, /Открыть сделку/]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });
});

describe("RiskCalculatorWorkspace — no persistence, no side effects", () => {
  it("never reads or writes storage and never fetches", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch must not be called");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    render(<RiskCalculatorWorkspace />);
    fill(validLong);

    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalledWith(expect.stringContaining("risk"));
    expect(removeItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    setItem.mockRestore();
    getItem.mockRestore();
    removeItem.mockRestore();
    globalThis.fetch = originalFetch;
  });

  it("resets all inputs and result after a remount (nothing persisted)", () => {
    const first = render(<RiskCalculatorWorkspace />);
    fill(validLong);
    expect(document.querySelector(".rc-strip")).not.toBeNull();
    first.unmount();

    render(<RiskCalculatorWorkspace />);
    expect((screen.getByLabelText("Расчётный капитал") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Цена входа") as HTMLInputElement).value).toBe("");
    expect(document.querySelector(".rc-strip")).toBeNull();
  });
});

describe("RiskCalculatorWorkspace — accessibility", () => {
  it("marks a malformed field aria-invalid and links its error via aria-describedby", () => {
    render(<RiskCalculatorWorkspace />);
    fill({ ...validLong, entry: "1,0.5" });
    const entry = screen.getByLabelText("Цена входа");
    expect(entry).toHaveAttribute("aria-invalid", "true");
    const described = entry.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    const errNode = document.getElementById(described!.split(" ").pop()!);
    expect(errNode?.textContent).toMatch(/Введите число/);
  });

  it("uses inputMode decimal on every numeric field, not type=number", () => {
    render(<RiskCalculatorWorkspace />);
    for (const label of ["Расчётный капитал", "Риск на сделку, %", "Цена входа", "Стоп-цена"]) {
      const el = screen.getByLabelText(label) as HTMLInputElement;
      expect(el.getAttribute("inputmode")).toBe("decimal");
      expect(el.getAttribute("type")).toBe("text");
    }
  });
});
