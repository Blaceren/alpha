/**
 * NUMBERS AS THEY ARE TYPED into the tools' fields.
 *
 * The tools' number fields are text inputs (`inputMode` picks the keypad): a
 * `type="number"` field takes «e», a sign and a locale's own decimal mark, and
 * spins on a scroll. A text input, though, takes anything — a learner could
 * type «льдл» into Payout and only hear about it on save. So each field keeps
 * of what was typed or pasted only what its number can contain, and the Backend
 * still re-checks the value itself.
 *
 * PAYOUT IS A WHOLE PERCENT FROM 20 TO 99 (owner, 2026-10-02: «можно писать
 * только цифры и от 20 до 99»). The same bounds stand in the Backend
 * (`backend/src/lib/tools/reference.ts`), for every tool that asks for a payout:
 * Trade Card, Trading Journal, Risk Calculator, Entry Checklist.
 */

export const PAYOUT_LIMITS = { min: 20, max: 99 } as const;

export const PAYOUT_MESSAGE = `Payout — целое число от ${PAYOUT_LIMITS.min} до ${PAYOUT_LIMITS.max}.`;

/** The range as a field shows it while it is empty: «20–99». */
export const PAYOUT_PLACEHOLDER = `${PAYOUT_LIMITS.min}–${PAYOUT_LIMITS.max}`;

/** What a whole-number field keeps: the digits, at most `maxLength` of them. */
export function digitsOnly(raw: string, maxLength: number): string {
  let out = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") out += ch;
    if (out.length >= maxLength) break;
  }
  return out;
}

/** The payout as a number, or null: digits only, inside the limits. */
export function parsePayoutPercent(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= PAYOUT_LIMITS.min && value <= PAYOUT_LIMITS.max ? value : null;
}

/**
 * True when what is typed can no longer become a payout by typing on: two
 * digits outside the range, or a first digit no payout begins with. A field
 * says so at once. «2» on the way to «25» is not a mistake, and is left alone
 * until the learner leaves the field.
 */
export function isPayoutDeadEnd(raw: string): boolean {
  if (raw === "" || parsePayoutPercent(raw) !== null) return false;
  if (raw.length >= String(PAYOUT_LIMITS.max).length) return true;
  for (let digit = 0; digit <= 9; digit += 1) {
    if (parsePayoutPercent(`${raw}${digit}`) !== null) return false;
  }
  return true;
}

/**
 * What a money field keeps: digits and ONE decimal mark — a dot or a comma, as
 * the learner typed it — with at most seven digits before it and two after.
 * A mark with nothing before it is dropped: «.5» is not an amount the tools
 * accept, and keeping it would only postpone the refusal.
 */
export function moneyOnly(raw: string): string {
  let whole = "";
  let mark = "";
  let cents = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (mark) {
        if (cents.length < 2) cents += ch;
      } else if (whole.length < 7) {
        whole += ch;
      }
    } else if ((ch === "." || ch === ",") && !mark && whole.length > 0) {
      mark = ch;
    }
  }
  return whole + mark + cents;
}
