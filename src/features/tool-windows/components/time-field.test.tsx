import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeField } from "./time-field";

function Harness({ initial = "", onValue }: { initial?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <label htmlFor="t">Время входа</label>
      <TimeField
        id="t"
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
      />
      <button type="button">Дальше</button>
    </div>
  );
}

const field = () => screen.getByLabelText("Время входа") as HTMLInputElement;
const toggle = () => screen.getByRole("button", { name: "Выбрать время" });
const panel = () => screen.getByRole("dialog", { name: "Выбор времени" });
const hours = () => within(panel()).getByRole("group", { name: "Часы" });
const tens = () => within(panel()).getByRole("group", { name: "Десяток минут" });
const minutes = () => within(panel()).getByRole("group", { name: "Минуты" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 2, 14, 36));
});
afterEach(() => vi.useRealTimers());

describe("the time field — typed", () => {
  it("is the product's own field, not the browser's time input", () => {
    render(<Harness />);
    expect(field()).toHaveAttribute("type", "text");
    expect(field()).toHaveAttribute("inputmode", "numeric");
    expect(field()).toHaveAttribute("placeholder", "ЧЧ:ММ");
  });

  it("makes a time of four digits and keeps nothing but digits", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "1432");
    expect(field()).toHaveValue("14:32");
    await user.clear(field());
    await user.type(field(), "льдл9x05");
    expect(field()).toHaveValue("09:05");
    // A pasted time is read whole, whatever stands around it.
    await user.clear(field());
    await user.click(field());
    await user.paste(" 14:32:10 ");
    expect(field()).toHaveValue("14:32");
  });

  it("settles an hour alone when the learner leaves the field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "14");
    expect(field()).toHaveValue("14:");
    await user.tab();
    expect(field()).toHaveValue("14:00");
  });

  it("turns the minutes with the arrows, and the hours when the caret stands in them", async () => {
    const user = userEvent.setup();
    render(<Harness initial="14:59" />);
    field().focus();
    field().setSelectionRange(5, 5);
    await user.keyboard("{ArrowUp}");
    expect(field()).toHaveValue("14:00");
    // The part that was turned stays selected, so the next press turns it again.
    expect([field().selectionStart, field().selectionEnd]).toEqual([3, 5]);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(field()).toHaveValue("14:58");

    field().setSelectionRange(1, 1);
    await user.keyboard("{ArrowUp}");
    expect(field()).toHaveValue("15:58");
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 2]);
    await user.keyboard("{ArrowUp}");
    expect(field()).toHaveValue("16:58");
  });
});

describe("the time field — pointed at", () => {
  it("opens a panel under the field, the focus on the hour in hand", async () => {
    const user = userEvent.setup();
    render(<Harness initial="14:32" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(hours()).getByRole("button", { name: "14" })).toHaveFocus();
    expect(within(hours()).getByRole("button", { name: "14" })).toHaveAttribute("aria-pressed", "true");
    // The ten on show is the value's, and the minute is marked in it.
    expect(within(tens()).getByRole("button", { name: "30" })).toHaveAttribute("aria-pressed", "true");
    expect(within(minutes()).getAllByRole("button").map((cell) => cell.textContent)).toEqual([
      "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
    ]);
    expect(within(minutes()).getByRole("button", { name: "32" })).toHaveAttribute("aria-pressed", "true");
  });

  it("takes the hour, then the ten, then the minute — and the minute finishes it", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="14:32" onValue={onValue} />);
    await user.click(toggle());
    await user.click(within(hours()).getByRole("button", { name: "09" }));
    expect(field()).toHaveValue("09:32");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(within(tens()).getByRole("button", { name: "50" }));
    expect(field()).toHaveValue("09:50");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(within(minutes()).getByRole("button", { name: "57" }));
    expect(field()).toHaveValue("09:57");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(field()).toHaveFocus();
    expect(onValue).toHaveBeenLastCalledWith("09:57");
  });

  it("sets the learner's own clock on «Сейчас»", async () => {
    const user = userEvent.setup();
    render(<Harness initial="09:00" />);
    await user.click(toggle());
    await user.click(within(panel()).getByRole("button", { name: "Сейчас" }));
    expect(field()).toHaveValue("14:36");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sets a minute against the current hour when no hour has been chosen", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(toggle());
    await user.click(within(tens()).getByRole("button", { name: "20" }));
    await user.click(within(minutes()).getByRole("button", { name: "25" }));
    expect(field()).toHaveValue("14:25");
  });

  it("walks a grid with the arrows: one stop for Tab, not twenty-four", async () => {
    const user = userEvent.setup();
    render(<Harness initial="14:32" />);
    await user.click(toggle());
    const stops = within(hours()).getAllByRole("button").filter((cell) => cell.getAttribute("tabindex") === "0");
    expect(stops.map((cell) => cell.textContent)).toEqual(["14"]);
    await user.keyboard("{ArrowRight}");
    expect(within(hours()).getByRole("button", { name: "15" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(hours()).getByRole("button", { name: "21" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(within(hours()).getByRole("button", { name: "18" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(within(hours()).getByRole("button", { name: "23" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(field()).toHaveValue("23:32");
  });

  it("closes on Escape, on «Готово», and on a press anywhere else", async () => {
    const user = userEvent.setup();
    render(<Harness initial="14:32" />);
    await user.click(toggle());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle()).toHaveFocus();

    await user.click(toggle());
    await user.click(within(panel()).getByRole("button", { name: "Готово" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(field()).toHaveFocus();

    await user.click(toggle());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Дальше" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Nothing was changed by looking.
    expect(field()).toHaveValue("14:32");
  });

  it("stays out of the way of a disabled form", () => {
    render(
      <div>
        <label htmlFor="d">Время входа</label>
        <TimeField id="d" value="14:32" onChange={() => undefined} disabled invalid describedBy="why" />
      </div>,
    );
    expect(field()).toBeDisabled();
    expect(toggle()).toBeDisabled();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAttribute("aria-describedby", "why");
  });
});
