import assert from "node:assert/strict";
import {
  buildPostbackAccountUpdate,
  buildSimulatedPostbackAccountUpdate,
} from "../../src/lib/exchange/postbackProcessor";
import {
  normalizePocketEvent,
  pocketEventToExchangeEvent,
} from "../../src/lib/exchange/pocket";

// Pre-Phase 0B regression: Pocket withdrawal event semantics.
//
// Approved semantics:
// - "New Withdrawal"       -> request only, financial no-op;
// - "Canceled Withdrawal"  -> request cancellation, financial no-op;
// - "Withdrawal"           -> unconfirmed status event, financial no-op;
// - "Successful Withdrawal"-> the only withdrawal event allowed to apply
//                             the confirmed financial change.
//
// Pure unit test: no DB, no server, no side effects. It exercises the exact
// pure functions the postback route uses to derive the ExchangeAccount update.

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

const FINANCIAL_KEYS = [
  "balance",
  "depositAmount",
  "totalDeposits",
  "totalWithdrawals",
  "totalCommission",
] as const;

function resolveUpdate(pocketType: string, amount: number) {
  const normalized = normalizePocketEvent(pocketType, undefined);
  const eventType = pocketEventToExchangeEvent(normalized);
  const update = buildPostbackAccountUpdate(normalized, eventType, amount);
  return { normalized, eventType, update };
}

// 1-3. Request/cancel/status withdrawal events must be a financial no-op.
for (const pocketType of ["New Withdrawal", "Canceled Withdrawal", "Withdrawal"]) {
  check(`${pocketType}: financial no-op account update`, () => {
    const { update } = resolveUpdate(pocketType, 11.73);
    assert.deepEqual(update, {}, `${pocketType} must not produce any account update`);
  });

  check(`${pocketType}: does not touch balance or financial aggregates`, () => {
    const { update } = resolveUpdate(pocketType, 250);
    for (const key of FINANCIAL_KEYS) {
      assert.equal(key in update, false, `${pocketType} must not set ${key}`);
    }
  });

  check(`${pocketType}: cannot trigger progression/XP/checkpoint side effects`, () => {
    // The postback processor only completes progression tasks when
    // normalized === "registration" or normalized === "first_deposit"
    // or eventType === "deposit" with amount > 0. XP and checkpoint state
    // change only through those completions or balance mutations.
    const { normalized, eventType, update } = resolveUpdate(pocketType, 100);
    assert.notEqual(normalized, "registration");
    assert.notEqual(normalized, "first_deposit");
    assert.notEqual(eventType, "deposit");
    assert.equal("balance" in update, false);
  });
}

// 4. Normalization mapping itself stays intact.
check("goal type normalization is unchanged", () => {
  assert.equal(normalizePocketEvent("New Withdrawal", undefined), "new_withdrawal");
  assert.equal(normalizePocketEvent("Canceled Withdrawal", undefined), "canceled_withdrawal");
  assert.equal(normalizePocketEvent("Withdrawal", undefined), "withdrawal");
  assert.equal(normalizePocketEvent("Successful Withdrawal", undefined), "successful_withdrawal");
});

// 5. Successful Withdrawal keeps the confirmed financial branch, and only it.
check("Successful Withdrawal: confirmed branch applies withdrawal", () => {
  const { update } = resolveUpdate("Successful Withdrawal", 50);
  // No `balance` key. DEVACT-1 removed every balance write from the postback
  // processor: Pocket publishes no authoritative balance, so a running total
  // maintained from affiliate events was a number the platform could not stand
  // behind. The cumulative withdrawal aggregate is what remains.
  assert.deepEqual(update, { totalWithdrawals: { increment: 50 } });
  assert.equal("balance" in update, false);
});

check("Successful Withdrawal: does not change cumulative deposits", () => {
  const { update } = resolveUpdate("Successful Withdrawal", 50);
  assert.equal("totalDeposits" in update, false);
  assert.equal("depositAmount" in update, false);
});

// 6. Deposit events are not broken.
check("First Deposit: confirmed deposit behaviour, without a balance write", () => {
  const { update } = resolveUpdate("First Deposit", 100);
  assert.deepEqual(update, {
    status: "connected",
    firstDepositConfirmed: true,
    depositAmount: { increment: 100 },
    totalDeposits: { increment: 100 },
  });
  assert.equal("balance" in update, false);
});

check("Re-deposit: redeposit behaviour, without a balance write", () => {
  const { update } = resolveUpdate("Re-deposit", 70);
  assert.deepEqual(update, {
    depositAmount: { increment: 70 },
    totalDeposits: { increment: 70 },
  });
  assert.equal("firstDepositConfirmed" in update, false);
  assert.equal("balance" in update, false);
});

// 7. Commission compatibility behaviour is locked (out of scope to change).
check("Commission: still only increments totalCommission", () => {
  const { update } = resolveUpdate("Commission", 5);
  assert.deepEqual(update, { totalCommission: { increment: 5 } });
});

// 8. Unknown events keep flowing into the rejected branch, not into finance.
check("Unknown Pocket type: rejected branch, no financial change", () => {
  const normalized = normalizePocketEvent("Bonus Drop", undefined);
  assert.equal(normalized, "unknown");
  const eventType = pocketEventToExchangeEvent(normalized);
  assert.equal(eventType, "account_rejected");
  const update = buildPostbackAccountUpdate(normalized, eventType, 999, "test");
  assert.equal("balance" in update, false);
  assert.equal(update.status, "rejected");
});

// 9. The explicit balance-sync event writes nothing at all. It used to set the
// stored balance directly; DEVACT-1 closed that path because no Pocket event
// carries an authoritative balance, and this phase forbids persisting one.
check("explicit eventType=balance sets nothing", () => {
  const update = buildPostbackAccountUpdate("balance", "balance", 250);
  assert.deepEqual(update, {});
  assert.equal("balance" in update, false);
});

// 10. Admin simulate endpoint helper: plain Withdrawal must be a financial
// no-op there as well (Pre-Phase 0B.1 fix for the independent side effect).
check("simulate Withdrawal: financial no-op account update", () => {
  const update = buildSimulatedPostbackAccountUpdate("Withdrawal", 200);
  assert.deepEqual(update, {}, "simulated Withdrawal must not change money state");
  for (const key of FINANCIAL_KEYS) {
    assert.equal(key in update, false, `simulated Withdrawal must not set ${key}`);
  }
});

check("simulate First Deposit: no balance write either", () => {
  const update = buildSimulatedPostbackAccountUpdate("First Deposit", 500);
  assert.deepEqual(update, {
    firstDepositConfirmed: true,
    depositAmount: { increment: 500 },
    totalDeposits: { increment: 500 },
  });
  assert.equal("balance" in update, false);
});

check("simulate Re-deposit: no balance write either", () => {
  const update = buildSimulatedPostbackAccountUpdate("Re-deposit", 300);
  assert.deepEqual(update, {
    depositAmount: { increment: 300 },
    totalDeposits: { increment: 300 },
  });
  assert.equal("balance" in update, false);
});

check("simulate Registration/Email Confirmation: status flags only", () => {
  assert.deepEqual(buildSimulatedPostbackAccountUpdate("Registration", 0), {
    registrationStatus: true,
  });
  assert.deepEqual(buildSimulatedPostbackAccountUpdate("Email Confirmation", 0), {
    emailConfirmed: true,
  });
});

console.log(`\nwithdrawal semantics regression: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
