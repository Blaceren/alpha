/**
 * POCKET-REG-SECURITY-CLOSURE-1 (§17/§18) — the synthetic-fixture convention is
 * enforceable, not merely documented.
 *
 * A "test data" convention nobody tests is a convention that quietly stops
 * being true. These assertions pin the three properties the policy rests on:
 * the domain is reserved and cannot be a real address, the predicate agrees
 * with its SQL twin, and identification never turns into silent subtraction.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SYNTHETIC_FIXTURE_EMAIL_DOMAIN,
  SYNTHETIC_FIXTURE_SQL_PREDICATE,
  isSyntheticFixtureEmail,
} from "../../src/lib/growth/synthetic-fixtures";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e instanceof Error ? e.message : e); }
}

check("A1 the fixture domain is an RFC 2606 reserved .invalid domain", () => {
  assert.ok(SYNTHETIC_FIXTURE_EMAIL_DOMAIN.endsWith(".invalid"),
    "a fixture domain that can resolve could collide with a real learner");
  assert.ok(SYNTHETIC_FIXTURE_EMAIL_DOMAIN.startsWith("@"));
});

check("A2 the predicate identifies fixtures and never a real address", () => {
  assert.equal(isSyntheticFixtureEmail(`acceptance-1${SYNTHETIC_FIXTURE_EMAIL_DOMAIN}`), true);
  assert.equal(isSyntheticFixtureEmail(`ACCEPTANCE-1${SYNTHETIC_FIXTURE_EMAIL_DOMAIN.toUpperCase()}`), true,
    "casing must not defeat identification");
  for (const real of [
    "learner@example.com", "someone@alfatrade.media", "a@b.co",
    "spoof@ata-preprod.invalid.example.com", "", null, undefined,
  ]) {
    assert.equal(isSyntheticFixtureEmail(real as string), false, `misidentified: ${String(real)}`);
  }
});

check("A3 the SQL predicate and the TS predicate describe the same rule", () => {
  assert.ok(SYNTHETIC_FIXTURE_SQL_PREDICATE.includes(SYNTHETIC_FIXTURE_EMAIL_DOMAIN),
    "the SQL twin must be derived from the same constant, or the two will drift");
  assert.ok(SYNTHETIC_FIXTURE_SQL_PREDICATE.toUpperCase().includes("LOWER("),
    "the SQL twin must be case-insensitive like the TS predicate");
});

check("A4 identification is NOT wired into any analytics subtraction (§18)", () => {
  // §18: "Do not silently subtract data client-side." The analytics vocabulary
  // must not import the fixture predicate — a metric that quietly drops rows is
  // how a real number goes missing.
  const sources = fs.readFileSync("src/lib/growth/analytics/sources.ts", "utf8");
  assert.ok(!sources.includes("synthetic-fixtures"),
    "analytics/sources.ts must not silently filter fixture rows");
  assert.ok(!sources.includes("isSyntheticFixtureEmail"));
});

check("A5 the reporting tool exists and only reads", () => {
  const report = fs.readFileSync("scripts/ops/reportSyntheticFixtures.ts", "utf8");
  for (const forbidden of ["prisma.$executeRaw", ".delete(", ".deleteMany(", ".update(", ".updateMany(", ".create("]) {
    assert.ok(!report.includes(forbidden), `the report tool must not ${forbidden}`);
  }
});

console.log(`\nSynthetic fixture policy: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
