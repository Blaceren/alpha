import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PayoutField } from "./payout-field";

function Harness({ error, rangeMessage, label }: { error?: string; rangeMessage?: string; label?: string }) {
  const [value, setValue] = useState("");
  return (
    <div>
      <PayoutField id="p" errorId="p-error" value={value} onChange={setValue} error={error} rangeMessage={rangeMessage} label={label} />
      <button type="button">Дальше</button>
    </div>
  );
}

const field = () => screen.getByLabelText("Payout");
const RANGE = "Payout — целое число от 20 до 99.";

describe("the payout field", () => {
  it("takes digits only — two of them — whatever is typed or pasted", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "льдл");
    expect(field()).toHaveValue("");
    await user.type(field(), "8%5.7");
    expect(field()).toHaveValue("85");
    await user.clear(field());
    await user.click(field());
    await user.paste("payout 92 %");
    expect(field()).toHaveValue("92");
  });

  it("says its range while it is empty, and asks for the number keypad", () => {
    render(<Harness />);
    expect(field()).toHaveAttribute("placeholder", "20–99");
    expect(field()).toHaveAttribute("inputmode", "numeric");
    // The length is kept by the field itself: a `maxlength` would cut a paste before its digits are read.
    expect(field()).not.toHaveAttribute("maxlength");
  });

  it("says nothing about a number that typing on can still make a payout, until the learner leaves the field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "5");
    // «5» may be on its way to «55»: the learner is still in the field.
    expect(screen.queryByText(RANGE)).toBeNull();
    await user.tab();
    expect(screen.getByText(RANGE)).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(RANGE);
    // Typing again withdraws it until the field is left again.
    await user.clear(field());
    await user.type(field(), "2");
    expect(screen.queryByText(RANGE)).toBeNull();
    await user.type(field(), "0");
    await user.tab();
    expect(screen.queryByText(RANGE)).toBeNull();
    expect(field()).not.toHaveAttribute("aria-invalid");
  });

  it("names at once a number no further key can mend", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // No payout begins with «1»: whatever follows, the number stays outside 20…99.
    await user.type(field(), "1");
    expect(screen.getByText(RANGE)).toBeInTheDocument();
    await user.type(field(), "5");
    expect(field()).toHaveValue("15");
    expect(screen.getByText(RANGE)).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    // Mended in place: the message leaves with the mistake.
    await user.clear(field());
    await user.type(field(), "85");
    expect(screen.queryByText(RANGE)).toBeNull();
    expect(field()).not.toHaveAttribute("aria-invalid");
  });

  it("says nothing about an empty field that was only passed through", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());
    await user.tab();
    expect(screen.queryByText(RANGE)).toBeNull();
  });

  it("lets the form's own message win", async () => {
    const user = userEvent.setup();
    render(<Harness error="Сервер не принял payout." />);
    expect(screen.getByText("Сервер не принял payout.")).toBeInTheDocument();
    await user.type(field(), "15");
    await user.tab();
    expect(screen.queryByText(RANGE)).toBeNull();
    expect(screen.getByText("Сервер не принял payout.")).toBeInTheDocument();
  });

  it("carries another label and another wording where a tool needs them", async () => {
    const user = userEvent.setup();
    render(<Harness label="Мой минимум payout" rangeMessage="Минимум payout — целое число от 20 до 99, или оставьте поле пустым." />);
    await user.type(screen.getByLabelText("Мой минимум payout"), "10");
    await user.tab();
    expect(screen.getByText("Минимум payout — целое число от 20 до 99, или оставьте поле пустым.")).toBeInTheDocument();
  });
});
