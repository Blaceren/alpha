/**
 * §14 — THE EXACT MONEY HARD GATE.
 *
 * Every provider-reported amount that reaches a canonical financial row passes
 * through `parsePocketDepositAmount`. This suite is that function's contract,
 * stated exhaustively, because the amount is what somebody is eventually paid a
 * commission on.
 *
 * WHY A STRING AND NEVER A NUMBER. `282.70` has no exact IEEE-754
 * representation. Parsing it into a float and formatting it back is not
 * guaranteed to reproduce it, and a cent that appears or vanishes between two
 * deliveries of the SAME deposit would make them compare unequal — which is
 * precisely how a duplicate financial event gets created. The canonical form is
 * a decimal STRING throughout, and this suite proves no path converts it.
 *
 * NORMALISATION IS PADDING, NEVER ROUNDING. `282` -> `282.00` and `282.7` ->
 * `282.70` change the written form and not the value. Anything that would
 * require rounding to fit two fraction digits is REFUSED rather than rounded,
 * because silently turning 1.005 into 1.00 or 1.01 invents money.
 *
 * The prior suites referenced this parser but never enumerated what it must
 * refuse; that gap is what this file closes.
 *
 *   npx tsx scripts/regression/pocketMoneyExactnessRegression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePocketDepositAmount } from "../../src/lib/exchange/pocketDepositAmount";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const accepted = (raw: string, expected: string) => {
  const r = parsePocketDepositAmount(raw);
  assert.equal(r.ok, true, `${JSON.stringify(raw)} should be accepted`);
  assert.equal((r as { ok: true; normalized: string }).normalized, expected);
};

const refused = (raw: string | undefined | null, reason?: string) => {
  const r = parsePocketDepositAmount(raw);
  assert.equal(r.ok, false, `${JSON.stringify(raw)} must be refused`);
  if (reason) assert.equal((r as { ok: false; reason: string }).reason, reason);
};

console.log("POCKET MONEY EXACTNESS HARD GATE (§14)");

check("canonical decimal strings are accepted and preserved exactly", () => {
  accepted("282.70", "282.70");
  accepted("0.01", "0.01");
  accepted("1000000.00", "1000000.00");
  accepted("999999999.99", "999999999.99");
});

check("normalisation pads, and never rounds", () => {
  accepted("282", "282.00");
  accepted("282.7", "282.70");
  accepted("5", "5.00");
  // The classic float trap: 282.70 is not exactly representable in IEEE-754.
  // The canonical form must come back byte-identical.
  const r = parsePocketDepositAmount("282.70");
  assert.equal((r as { ok: true; normalized: string }).normalized, "282.70");
  assert.notEqual((r as { ok: true; normalized: string }).normalized, String(282.7));
});

check("an amount needing rounding is REFUSED, not rounded", () => {
  // Three fraction digits cannot fit two without inventing or destroying money.
  refused("1.005", "malformed");
  refused("282.701", "malformed");
  refused("0.001", "malformed");
});

check("zero in every spelling is refused — a deposit of nothing is not a deposit", () => {
  // WHAT MATTERS IS THE REFUSAL, NOT WHICH GUARD CATCHES IT. The canonical
  // spellings reach the positivity test; the non-canonical ones are stopped
  // earlier by the pattern, which forbids leading zeros and a third fraction
  // digit. An earlier draft of this suite pinned every case to `not_positive`
  // and failed on `000.00` — the assertion was over-specified, not the parser.
  refused("0", "not_positive");
  refused("0.00", "not_positive");
  refused("0.0", "not_positive");
  refused("000.00", "malformed");
  refused("00.00", "malformed");
  refused("0.000", "malformed");
});

check("no zero spelling can ever become a stored amount", () => {
  // The property that actually protects the ledger, stated independently of
  // which guard fires: nothing that means zero survives parsing.
  for (const raw of ["0", "0.00", "0.0", "000.00", "00.00", "0.000", "0.0000", "-0.00"]) {
    assert.equal(parsePocketDepositAmount(raw).ok, false, `${raw} must never be stored`);
  }
});

check("negative amounts are refused", () => {
  refused("-1.00", "malformed");
  refused("-0.01", "malformed");
  refused("-282.70", "malformed");
});

check("exponent notation is refused", () => {
  refused("1e2", "malformed");
  refused("1E2", "malformed");
  refused("2.827e2", "malformed");
  refused("1e-2", "malformed");
});

check("locale forms are refused — no comma decimal, no thousands separator", () => {
  refused("282,70", "malformed");
  refused("1,000.00", "malformed");
  refused("1 000.00", "malformed");
  refused("1'000.00", "malformed");
});

check("the float sentinels are refused as the ordinary strings they are", () => {
  refused("NaN", "malformed");
  refused("Infinity", "malformed");
  refused("-Infinity", "malformed");
  refused("1/0", "malformed");
});

check("absent, empty and whitespace inputs are refused", () => {
  refused(undefined, "empty");
  refused(null, "empty");
  refused("", "empty");
  refused(" ", "malformed");
  refused("282.70 ", "malformed");
  refused(" 282.70", "malformed");
});

check("currency symbols and units never reach a canonical amount", () => {
  refused("$282.70", "malformed");
  refused("282.70USD", "malformed");
  refused("USD282.70", "malformed");
});

check("a pathological input is refused on LENGTH before any pattern runs", () => {
  // Ordering matters: the length guard exists so a pathological string cannot
  // be handed to a regex at all.
  refused("9".repeat(500), "too_long");
  const source = readFileSync(resolve(__dirname, "../../src/lib/exchange/pocketDepositAmount.ts"), "utf8");
  const lengthAt = source.indexOf("too_long");
  const patternAt = source.indexOf("POCKET_AMOUNT.test");
  assert.ok(lengthAt > 0 && patternAt > 0);
  assert.ok(lengthAt < patternAt, "the length guard must precede the pattern test");
});

/**
 * Source with comments removed.
 *
 * WHY THIS EXISTS. These files DOCUMENT the float trap they avoid — the amount
 * parser's header explains "WHY NOT `Number()`" and quotes the legacy
 * `Number(value.replace(",", "."))` it replaced. A search over raw file text
 * therefore finds `Number(` in prose and reports the opposite of the truth. The
 * assertion is about what the CODE does, so the prose is stripped first.
 */
function code(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

check("positivity is decided on DIGITS, never on a numeric conversion", () => {
  const source = code("../../src/lib/exchange/pocketDepositAmount.ts");
  assert.match(source, /\/\[1-9\]\/\.test\(normalized\)/, "positivity is a digit test");
  for (const forbidden of ["parseFloat", "parseInt", "Number(", "toFixed", "Math.round"]) {
    assert.ok(
      !source.includes(forbidden),
      `the amount parser must not use ${forbidden} — it would introduce a float`,
    );
  }
});

check("no float conversion exists anywhere on the deposit money path", () => {
  for (const file of [
    "../../src/lib/exchange/pocketFirstDeposit.ts",
    "../../src/lib/growth/pocket/redeposit.ts",
  ]) {
    const source = code(file);
    for (const forbidden of ["parseFloat(", "toFixed(", "Math.round("]) {
      assert.ok(!source.includes(forbidden), `${file} must not use ${forbidden} on money`);
    }
  }
});

console.log(`\n${passed}/${passed} assertions passed`);
