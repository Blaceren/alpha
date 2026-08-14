/**
 * POCKET-DEP-RDEP-1 (DEP-TIME-1) — a first deposit occurs when the provider
 * reported it, on every path.
 *
 * WHAT WENT WRONG. `convergePendingEvent` — the path a deposit takes when it
 * arrives BEFORE the learner's Pocket registration and is reconciled later —
 * emitted the canonical `dep` GrowthEvent and the `AffiliateConversionEvent`
 * with `occurredAt: now`, the reconciliation instant. It did not even SELECT
 * `firstReceivedAt`, so the deposit's own reported instant was unavailable to
 * the emit.
 *
 * The ordinary path (`applyDelivery`) passes `input.now`, which is the same
 * value it writes to `firstReceivedAt`. So one event family carried two
 * different meanings depending purely on delivery ORDER: "when the deposit was
 * reported" if registration came first, "when we noticed" if it did not.
 *
 * WHY IT IS MONEY AND NOT BOOKKEEPING. `AffiliateConversionEvent.occurredAt` is
 * what a commission period is computed from, and `dep.occurredAt` is what every
 * Growth period filter reads. A deposit that waited across a period boundary
 * was counted in the wrong period.
 *
 * THE OWNER DECIDES, AND IT IS DECLARED IN SOURCE.
 * `GROWTH_SOURCE_ENTITY_TYPES` declares `dep -> "PocketProviderEvent"`. The row
 * owns the fact; `firstReceivedAt` is the row's own instant. This is the same
 * rule `pocket_reg` has always followed (`identity.boundAt`) and that `ata_reg`
 * received as LEDGER-1 (`created.createdAt`).
 *
 * NOT FIXED BY A TOLERANCE. The gap here is unbounded — a deposit can wait days
 * — so no tolerance would have hidden it, and none is introduced.
 *
 *   npx tsx scripts/regression/depTimestampAuthorityRegression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GROWTH_SOURCE_ENTITY_TYPES, GROWTH_SOURCE_OWNER_BY_TYPE } from "../../src/lib/growth/event-keys";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const source = readFileSync(resolve(__dirname, "../../src/lib/exchange/pocketFirstDeposit.ts"), "utf8");

/** The body of one named function, up to the next top-level declaration. */
function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n(?:export )?(?:async )?function /);
  return end === -1 ? rest : rest.slice(0, end);
}

console.log("DEP TIMESTAMP AUTHORITY REGRESSION");

check("the declared owner of dep is the PocketProviderEvent row", () => {
  assert.equal(GROWTH_SOURCE_ENTITY_TYPES.dep, "PocketProviderEvent");
  assert.equal(GROWTH_SOURCE_OWNER_BY_TYPE.dep, "pocket_first_deposit");
});

check("PARENT DEFECT — the reconciliation path no longer stamps the reconciliation clock", () => {
  const body = functionBody("convergePendingEvent");
  const emit = /emitFirstDepositConversion\(tx, \{[\s\S]*?occurredAt:\s*([^,\n]+),/.exec(body);
  assert.ok(emit, "the emit call was not found in convergePendingEvent");
  const occurredAt = emit![1].trim();

  // On the parent this captured group is `now` and the assertion fails.
  assert.notEqual(occurredAt, "now", "a reconciled deposit must not occur at the reconciliation instant");
  assert.equal(
    occurredAt,
    "event.firstReceivedAt",
    "a reconciled deposit occurs when the provider first reported it",
  );
});

check("the reconciliation path actually reads firstReceivedAt", () => {
  const body = functionBody("convergePendingEvent");
  const select = /findUnique\(\{[\s\S]*?select:\s*\{([\s\S]*?)\},\s*\}\)/.exec(body);
  assert.ok(select, "the provider-event select was not found");
  assert.match(
    select![1],
    /firstReceivedAt:\s*true/,
    "firstReceivedAt must be selected — it was absent, which is how the defect arose",
  );
});

check("the ordinary path still stamps the delivery instant, and it IS firstReceivedAt", () => {
  const body = functionBody("applyDelivery");
  assert.match(body, /firstReceivedAt:\s*input\.now/, "the row records the delivery instant");
  const emit = /emitFirstDepositConversion\(tx, \{[\s\S]*?occurredAt:\s*([^,\n]+),/.exec(body);
  assert.ok(emit, "the emit call was not found in applyDelivery");
  assert.equal(emit![1].trim(), "input.now", "the ordinary path emits the same instant it stored");
});

check("both paths agree: occurredAt is always the row's firstReceivedAt", () => {
  // applyDelivery writes firstReceivedAt = input.now and emits input.now.
  // convergePendingEvent emits event.firstReceivedAt.
  // Neither emits a clock read taken at emit time.
  const emits = [...source.matchAll(/emitFirstDepositConversion\(tx, \{[\s\S]*?occurredAt:\s*([^,\n]+),/g)]
    .map((m) => m[1].trim());
  assert.deepEqual(emits, ["input.now", "event.firstReceivedAt"]);
  for (const value of emits) {
    assert.notEqual(value, "now", "no emit may use a bare reconciliation clock");
    assert.notEqual(value, "new Date()", "no emit may read the clock inline");
  }
});

check("matchedAt keeps its own meaning and is not repurposed as the occurrence", () => {
  // When the deposit became attributable is a different fact from when it
  // happened, and it keeps its own column on both paths.
  assert.match(source, /matchedAt:\s*input\.now/);
  assert.match(source, /data:\s*\{\s*status:\s*"matched",\s*matchedUserId:\s*account\.userId,\s*matchedAt:\s*now\s*\}/);
});

check("no tolerance was introduced anywhere in the deposit path", () => {
  assert.ok(!/tolerance/i.test(source), "the deposit path must not carry a timestamp tolerance");
  assert.ok(!/Math\.abs\([^)]*(occurredAt|ReceivedAt)/.test(source), "no absolute-difference comparison");
});

check("the amount and currency remain a projection, not a second decision", () => {
  const body = functionBody("convergePendingEvent");
  assert.match(body, /normalizedAmount:\s*event\.normalizedAmount/);
  assert.match(body, /event\.currencyStatus === "configured"/);
  assert.ok(
    !/resolvePocketFirstDepositConfig\(\)/.test(body),
    "the reconciliation path must not re-read currency configuration",
  );
});

console.log(`\n${passed}/${passed} assertions passed`);
