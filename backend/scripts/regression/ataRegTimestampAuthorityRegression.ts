/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§10/§16C) — runtime and backfill
 * `ata_reg` must mean the same instant.
 *
 * WHAT WENT WRONG. `POST /api/auth/register` emitted
 * `occurredAt: now` — a `new Date()` read taken before the transaction opened —
 * while the backfill projection derives `occurredAt` from the persisted
 * `User.createdAt`. On the first runtime registration the family ever saw, the
 * two were 3 ms apart and the ledger verifier reported a divergence.
 *
 * WHICH ONE IS CANONICAL IS SETTLED IN SOURCE, not by this test:
 * `GROWTH_SOURCE_ENTITY_TYPES` declares `ata_reg -> "User"`, and
 * `verifyGrowthLedgerProjection.ts` reads `User.createdAt` for exactly the
 * users an `AUTH_REGISTER` audit row qualifies. The audit row is the membership
 * predicate; the `User` row owns the instant.
 *
 * THE FIX IS NOT A TOLERANCE. Widening the verifier to "within a few
 * milliseconds" would hide this class of defect permanently and would make the
 * ledger's own definition of an instant unfalsifiable. The assertion below is
 * exact equality.
 *
 *   npx tsx scripts/regression/ataRegTimestampAuthorityRegression.ts
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

const registerRoute = readFileSync(
  resolve(__dirname, "../../src/app/api/auth/register/route.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(__dirname, "../ops/verifyGrowthLedgerProjection.ts"),
  "utf8",
);

console.log("ATA_REG TIMESTAMP AUTHORITY REGRESSION");

check("the declared owner of ata_reg is the User row", () => {
  assert.equal(GROWTH_SOURCE_ENTITY_TYPES.ata_reg, "User");
  assert.equal(GROWTH_SOURCE_OWNER_BY_TYPE.ata_reg, "auth_register");
});

check("the backfill projection reads User.createdAt, qualified by AUTH_REGISTER", () => {
  const family = /eventType:\s*"ata_reg"[\s\S]*?ownerSql:\s*`([\s\S]*?)`/.exec(verifier);
  assert.ok(family, "ata_reg family spec not found in the verifier");
  const ownerSql = family![1];
  assert.match(ownerSql, /u\."createdAt"/, "backfill must derive occurredAt from User.createdAt");
  assert.match(ownerSql, /AUTH_REGISTER/, "membership must be the AUTH_REGISTER audit row");
});

check("PARENT DEFECT — the runtime emitter no longer uses the request clock", () => {
  const emit = /emitGrowthEvent\(tx,\s*\{\s*\n\s*eventType:\s*"ata_reg",\s*\n\s*occurredAt:\s*([^,]+),/.exec(
    registerRoute,
  );
  assert.ok(emit, "ata_reg emit site not found in the register route");
  const occurredAt = emit![1].trim();

  // This is the exact assertion that fails on the parent build, where the
  // captured group is `now`.
  assert.notEqual(occurredAt, "now", "runtime ata_reg must not use the pre-transaction clock");
  assert.equal(
    occurredAt,
    "created.createdAt",
    "runtime ata_reg must read the persisted owner column",
  );
});

check("the emitted value is the row the transaction persisted, not a re-read", () => {
  // `created` is the result of the `tx.user.create` in the same transaction, so
  // `created.createdAt` is the value the database actually stored. A separate
  // `findUnique` would be a second read that could observe a different row.
  assert.match(registerRoute, /\bcreated = await tx\.user\.create\(/);
  const createIndex = registerRoute.search(/\bcreated = await tx\.user\.create\(/);
  const emitIndex = registerRoute.indexOf('eventType: "ata_reg"');
  assert.ok(createIndex > 0 && emitIndex > createIndex, "the emit must follow the create");
});

check("the verifier compares exactly, with no millisecond tolerance", () => {
  // A tolerance would make this whole regression decorative.
  assert.ok(!/tolerance/i.test(verifier), "the verifier must not carry a tolerance");
  assert.ok(!/Math\.abs\([^)]*occurredAt/.test(verifier), "no absolute-difference comparison");
});

check("the Pocket family still owns its own instant, unchanged", () => {
  const registration = readFileSync(
    resolve(__dirname, "../../src/lib/growth/pocket/registration.ts"),
    "utf8",
  );
  assert.match(
    registration,
    /occurredAt:\s*identity\.boundAt/,
    "pocket_reg must keep deriving occurredAt from identity.boundAt",
  );
  assert.ok(
    !/occurredAt:\s*now\b/.test(registration),
    "pocket_reg must never use a request clock",
  );
});

console.log(`\n${passed}/${passed} assertions passed`);
