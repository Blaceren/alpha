import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateField } from "./date-field";

const TODAY = "2026-10-02"; // a Friday

function Harness({
  initial = TODAY,
  min = "2020-01-01",
  max = TODAY,
  onValue,
  invalid = false,
}: {
  initial?: string;
  min?: string;
  max?: string;
  onValue?: (value: string) => void;
  invalid?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <span id="d-label">Дата</span>
      <DateField
        id="d"
        labelId="d-label"
        value={value}
        min={min}
        max={max}
        invalid={invalid}
        describedBy={invalid ? "why" : undefined}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
      />
      <button type="button">Дальше</button>
    </div>
  );
}

const field = () => screen.getByRole("combobox", { name: "Дата" });
const panel = () => screen.getByRole("dialog", { name: "Выбор даты" });
const day = (label: string) => within(panel()).getByRole("button", { name: label });

describe("the date field — what it says", () => {
  it("says the day in the learner's words", () => {
    const { rerender } = render(<Harness />);
    expect(field()).toHaveTextContent("Сегодня");
    expect(field()).toHaveTextContent("2 октября");
    rerender(<Harness key="y" initial="2026-10-01" />);
    expect(field()).toHaveTextContent("Вчера");
    rerender(<Harness key="e" initial="2026-09-29" />);
    expect(field()).toHaveTextContent("29 сентября");
    expect(field()).toHaveTextContent("вторник");
    rerender(<Harness key="o" initial="2025-12-30" />);
    expect(field()).toHaveTextContent("30 дек 2025");
    rerender(<Harness key="n" initial="" />);
    expect(field()).toHaveTextContent("Выберите дату");
  });

  it("is a field named by its label, never the browser's date input", () => {
    render(<Harness invalid />);
    expect(field().tagName).toBe("BUTTON");
    expect(field()).toHaveAttribute("aria-haspopup", "dialog");
    expect(field()).toHaveAttribute("aria-expanded", "false");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAttribute("aria-describedby", "why");
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });
});

describe("the date field — the month", () => {
  it("opens on the chosen day's month, Monday first, the focus on that day", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-09-29" />);
    await user.click(field());
    expect(field()).toHaveAttribute("aria-expanded", "true");
    expect(within(panel()).getByText("Сентябрь 2026")).toBeInTheDocument();
    expect(within(panel()).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "пн", "вт", "ср", "чт", "пт", "сб", "вс",
    ]);
    const chosen = day("29 сентября 2026, вторник");
    expect(chosen).toHaveFocus();
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    // Whole weeks: thirty days of September, a day of August before them and four of October after.
    const cells = within(screen.getByRole("grid")).getAllByRole("button");
    expect(cells).toHaveLength(35);
    expect(cells.filter((cell) => !cell.hasAttribute("data-outside"))).toHaveLength(30);
    expect(cells[0]).toHaveAccessibleName("31 августа 2026, понедельник");
  });

  it("chooses a day with one press and closes, the focus back on the field", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="2026-09-29" onValue={onValue} />);
    await user.click(field());
    await user.click(day("17 сентября 2026, четверг"));
    expect(onValue).toHaveBeenCalledWith("2026-09-17");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(field()).toHaveFocus();
    expect(field()).toHaveTextContent("17 сентября");
  });

  it("offers the two days a journal is written for, and the one before", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="2026-09-29" onValue={onValue} />);
    await user.click(field());
    const chips = ["Сегодня", "Вчера", "Позавчера"].map((name) => within(panel()).getByRole("button", { name }));
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
    await user.click(chips[1]!);
    expect(onValue).toHaveBeenCalledWith("2026-10-01");
    expect(field()).toHaveTextContent("Вчера");
    // Opened again, the chip of the chosen day is marked.
    await user.click(field());
    expect(within(panel()).getByRole("button", { name: "Вчера" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not let a day outside its limits be pressed", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(field());
    expect(day("3 октября 2026, суббота")).toBeDisabled();
    expect(day("1 октября 2026, четверг")).toBeEnabled();
    // Today is marked for assistive technology as well as for the eye.
    expect(day("2 октября 2026, пятница")).toHaveAttribute("aria-current", "date");
    await user.click(day("3 октября 2026, суббота"));
    expect(onValue).not.toHaveBeenCalled();
    // The month after the last day cannot be opened; the one before can.
    expect(within(panel()).getByRole("button", { name: "Следующий месяц" })).toBeDisabled();
    await user.click(within(panel()).getByRole("button", { name: "Предыдущий месяц" }));
    expect(within(panel()).getByText("Сентябрь 2026")).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Следующий месяц" })).toBeEnabled();
  });

  it("completes the month's first week with the days before it, and they are pressed like any other", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(field());
    // October 2026 begins on a Thursday: 28…30 September stand in its first row.
    expect(within(panel()).getByText("Октябрь 2026")).toBeInTheDocument();
    const firstWeek = within(screen.getByRole("grid")).getAllByRole("row")[1]!;
    expect(within(firstWeek).getAllByRole("button").map((cell) => cell.textContent)).toEqual(["28", "29", "30", "1", "2", "3", "4"]);
    const september29 = day("29 сентября 2026, вторник");
    expect(september29).toBeEnabled();
    expect(september29).toHaveAttribute("data-outside");
    expect(day("1 октября 2026, четверг")).not.toHaveAttribute("data-outside");
    // They are not in the tab order: the arrows stand on a day of the month on show.
    expect(september29).toHaveAttribute("tabindex", "-1");
    await user.click(september29);
    expect(onValue).toHaveBeenCalledWith("2026-09-29");
    expect(field()).toHaveTextContent("29 сентября");
    // Opened again, the panel shows the chosen day's own month.
    await user.click(field());
    expect(within(panel()).getByText("Сентябрь 2026")).toBeInTheDocument();
    expect(day("29 сентября 2026, вторник")).toHaveAttribute("aria-pressed", "true");
    expect(day("29 сентября 2026, вторник")).not.toHaveAttribute("data-outside");
    // September's last week is completed with October's first days: the past ones can be pressed, the rest cannot.
    expect(day("1 октября 2026, четверг")).toHaveAttribute("data-outside");
    expect(day("2 октября 2026, пятница")).toBeEnabled();
    expect(day("3 октября 2026, суббота")).toBeDisabled();
  });

  it("does not offer a neighbour's day that is outside the limits", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness min="2026-10-01" onValue={onValue} />);
    await user.click(field());
    expect(day("30 сентября 2026, среда")).toBeDisabled();
    await user.click(day("30 сентября 2026, среда"));
    expect(onValue).not.toHaveBeenCalled();
  });

  it("stops at the first month that can be chosen, and leaves out chips before it", async () => {
    const user = userEvent.setup();
    render(<Harness min="2026-10-01" />);
    await user.click(field());
    expect(within(panel()).getByRole("button", { name: "Предыдущий месяц" })).toBeDisabled();
    expect(within(panel()).queryByRole("button", { name: "Позавчера" })).toBeNull();
    expect(within(panel()).getByRole("button", { name: "Вчера" })).toBeInTheDocument();
  });
});

describe("the date field — by keyboard", () => {
  it("moves by a day, a week and a month, and never past the limits", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="2026-09-29" onValue={onValue} />);
    field().focus();
    await user.keyboard("{ArrowDown}");
    expect(day("29 сентября 2026, вторник")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(day("28 сентября 2026, понедельник")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(day("21 сентября 2026, понедельник")).toHaveFocus();
    await user.keyboard("{End}");
    expect(day("27 сентября 2026, воскресенье")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(day("21 сентября 2026, понедельник")).toHaveFocus();
    await user.keyboard("{PageUp}");
    expect(within(panel()).getByText("Август 2026")).toBeInTheDocument();
    expect(day("21 августа 2026, пятница")).toHaveFocus();
    // Two months forward would be past today: the move stops on today.
    await user.keyboard("{PageDown}{PageDown}");
    expect(within(panel()).getByText("Октябрь 2026")).toBeInTheDocument();
    expect(day("2 октября 2026, пятница")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(day("2 октября 2026, пятница")).toHaveFocus();
    // Only the day under the arrows is in the tab order.
    const stops = within(screen.getByRole("grid")).getAllByRole("button").filter((cell) => cell.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    await user.keyboard("{ArrowLeft}{Enter}");
    expect(onValue).toHaveBeenCalledWith("2026-10-01");
    expect(field()).toHaveFocus();
  });

  it("closes on Escape with the focus on the field, and on a press anywhere else", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(field());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(field()).toHaveFocus();
    await user.click(field());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Дальше" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onValue).not.toHaveBeenCalled();
  });
});
