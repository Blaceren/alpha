"use client";

/**
 * «Payout» — one field for every tool that asks for it (Trade Card, Trading
 * Journal, Risk Calculator, Entry Checklist).
 *
 * ONLY DIGITS, AND 20 TO 99 (owner, 2026-10-02). The field keeps nothing but
 * digits of what is typed or pasted — two of them — and says its range while
 * it is empty. A number outside the range is named AT ONCE when no further key
 * can mend it («15», or a first «1»), and otherwise when the learner leaves
 * the field — not only on save. «2» on the way to «25» is not a mistake, and
 * nothing is said about it while they type.
 */
import { useState } from "react";
import { PAYOUT_MESSAGE, PAYOUT_PLACEHOLDER, digitsOnly, isPayoutDeadEnd, parsePayoutPercent } from "../model/numeric-input";

export type PayoutFieldProps = {
  id: string;
  errorId: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** The form's own message for this field (from a save, or from the Backend); it wins. */
  error?: string;
  /** What is said about a number outside the range. */
  rangeMessage?: string;
};

export function PayoutField({
  id,
  errorId,
  label = "Payout",
  value,
  onChange,
  disabled = false,
  error,
  rangeMessage = PAYOUT_MESSAGE,
}: PayoutFieldProps) {
  /** The learner has left the field as it stands now; typing again withdraws it. */
  const [left, setLeft] = useState(false);
  const outOfRange = value !== "" && parsePayoutPercent(value) === null;
  const message = error ?? (outOfRange && (left || isPayoutDeadEnd(value)) ? rangeMessage : undefined);

  return (
    <div className="tc-field">
      <label className="tc-label" htmlFor={id}>
        {label}
      </label>
      <span className="tc-affix" data-side="end">
        <input
          id={id}
          className="tc-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          // No `maxLength`: the browser would cut a pasted «payout 92 %» to its
          // first two characters before the digits could be picked out of it.
          placeholder={PAYOUT_PLACEHOLDER}
          value={value}
          onChange={(event) => {
            setLeft(false);
            onChange(digitsOnly(event.target.value, 2));
          }}
          onBlur={() => setLeft(true)}
          disabled={disabled}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errorId : undefined}
        />
        <span className="tc-affix__mark" aria-hidden="true">
          %
        </span>
      </span>
      {message ? (
        <span className="tc-error" id={errorId}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
