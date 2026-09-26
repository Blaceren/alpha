/**
 * CONV-TIME-1 — an academy_registration conversion occurs when the account came
 * into existence, not when the transaction happened to read a clock.
 *
 * WHAT IS WRONG ON THE PARENT. `register/route.ts` passes `occurredAt: now` to
 * `recordRegistrationConversion`, where `now` is a `new Date()` taken at the top
 * of the handler, before the transaction opened. The `AffiliateConversionEvent`
 * row it writes declares:
 *
 *     sourceOwner   = auth_register   (REGISTRATION_SOURCE_OWNER)
 *     sourceEventId = user:<id>       (registrationSourceEventId)
 *
 * i.e. it names the User row as its source entity. So by the rule this codebase
 * already adopted, its instant must come from `User.createdAt` — the value the
 * database actually persisted — and not from an independent clock read.
 *
 * THIS IS THE SAME DEFECT LEDGER-1 ALREADY FIXED, FORTY LINES LOWER. The
 * `ata_reg` growth emit in the very same transaction was changed from
 * `occurredAt: now` to `occurredAt: created.createdAt`, and the comment there
 * spells out why: "THE OWNER OWNS THE INSTANT, NOT THE REQUEST CLOCK", because
 * `GROWTH_SOURCE_ENTITY_TYPES` declares the owner and the backfill projection
 * reads the same column. The conversion row was left behind.
 *
 * MEASURED ON THE FIRST REAL ATTRIBUTED REGISTRATION (user 64, PREPROD):
 *     AffiliateConversionEvent.occurredAt  1786732045073
 *     GrowthEvent(ata_reg).occurredAt      1786732045084   (= User.createdAt)
 * Two rows describing one registration, 11 ms apart.
 *
 * WHY IT IS LOW AND NOT IGNORABLE. The gap is bounded by one transaction, so it
 * cannot misattribute a partner or alter an amount — but AffiliateConversionEvent
 * is the table a commission period is computed from, which is exactly where
 * DEP-TIME-1 mattered. A registration landing within milliseconds of a period
 * boundary is counted in the wrong period.
 *
 * NOT FIXED BY A TOLERANCE. The correct value is available in the same scope;
 * a tolerance would hide the divergence instead of removing it, and would have
 * to be widened the moment a transaction ran slower.
 *
 *   npx tsx scripts/regression/registrationConversionTimestampRegression.ts
 *
 * PARENT = FAIL (assertion 2). CORRECTED CANDIDATE = PASS.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GROWTH_SOURCE_ENTITY_TYPES, GROWTH_SOURCE_OWNER_BY_TYPE } from "../../src/lib/growth/event-keys";
import { REGISTRATION_SOURCE_OWNER, registrationSourceEventId } from "../../src/lib/affiliate/registration-attribution";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const routePath = resolve(__dirname, "../../src/app/api/auth/register/route.ts");
const route = readFileSync(routePath, "utf8");
const attribution = readFileSync(
  resolve(__dirname, "../../src/lib/affiliate/registration-attribution.ts"),
  "utf8",
);

/** The argument object of a named call, up to its closing `});`. */
function callArgs(source: string, callee: string): string {
  const start = source.indexOf(`${callee}(`);
  assert.ok(start > 0, `${callee} call not found`);
  const rest = source.slice(start);
  const end = rest.indexOf("});");
  assert.ok(end > 0, `${callee} call is not shaped as expected`);
  return rest.slice(0, end);
}

console.log("REGISTRATION CONVERSION TIMESTAMP REGRESSION (CONV-TIME-1)");

check("the conversion declares the User row as its source entity", () => {
  // These two are what make User.createdAt the canonical instant. If the
  // declaration ever changes, this regression must be revisited rather than
  // silently continuing to assert the old owner.
  assert.equal(REGISTRATION_SOURCE_OWNER, "auth_register");
  assert.equal(registrationSourceEventId(64), "user:64");
  assert.match(attribution, /sourceOwner:\s*REGISTRATION_SOURCE_OWNER/);
  assert.match(attribution, /sourceEventId:\s*registrationSourceEventId\(input\.userId\)/);
});

check("PARENT DEFECT — the conversion takes the owner's instant, not a clock read", () => {
  const args = callArgs(route, "recordRegistrationConversion");
  const match = /occurredAt:\s*([^,\n]+)/.exec(args);
  assert.ok(match, "recordRegistrationConversion has no occurredAt argument");
  const occurredAt = match[1].trim();

  // On the parent this captured group is `now` and the assertion below fails.
  assert.notEqual(
    occurredAt,
    "now",
    "an academy_registration conversion must not occur at an independent transaction clock read",
  );
  assert.equal(
    occurredAt,
    "created.createdAt",
    "the conversion occurs when the account came into existence — the persisted User.createdAt",
  );
});

check("LEDGER-1 stays closed — ata_reg still reads the same column", () => {
  const args = callArgs(route, "emitGrowthEvent");
  assert.match(args, /eventType:\s*"ata_reg"/, "the first emitGrowthEvent call should be ata_reg");
  assert.match(
    args,
    /occurredAt:\s*created\.createdAt/,
    "ata_reg must keep taking User.createdAt — this is the already-accepted LEDGER-1 fix",
  );
  assert.equal(GROWTH_SOURCE_ENTITY_TYPES.ata_reg, "User");
  assert.equal(GROWTH_SOURCE_OWNER_BY_TYPE.ata_reg, "auth_register");
});

check("both rows for one registration read the SAME column", () => {
  // The point of the fix: the conversion and the growth event describe one fact,
  // so they must not be able to disagree about when it happened.
  const conversionAt = /occurredAt:\s*([^,\n]+)/
    .exec(callArgs(route, "recordRegistrationConversion"))![1]
    .trim();
  const growthAt = /occurredAt:\s*([^,\n]+)/.exec(callArgs(route, "emitGrowthEvent"))![1].trim();
  assert.equal(
    conversionAt,
    growthAt,
    "the conversion and the ata_reg event must be stamped from one source of truth",
  );
});

check("no tolerance was introduced in the registration or conversion path", () => {
  for (const [name, source] of [["register route", route], ["registration-attribution", attribution]] as const) {
    assert.ok(!/tolerance/i.test(source), `${name} must not carry a timestamp tolerance`);
    assert.ok(
      !/Math\.abs\([^)]*(occurredAt|createdAt)/.test(source),
      `${name} must not compare timestamps by absolute difference`,
    );
  }
});

check("the freeze keeps its own instant, which is a different fact", () => {
  // When attribution was SELECTED is not when the account was CREATED. The
  // freeze legitimately uses the transaction instant and keeps its own columns;
  // this regression must not push it onto User.createdAt.
  const args = callArgs(route, "freezeAttribution");
  assert.match(args, /freezeAttribution\(tx,\s*created\.id,\s*attributionCandidate,\s*now\)/);
});

console.log(`\n${passed}/${passed} assertions passed`);
