/**
 * RDEP-AVAIL-1 — the availability surface must not deny a capability ATA has.
 *
 * THE DEFECT. `availability.ts` reported, unconditionally:
 *
 *     redeposits: unavailable("provider_event_identity_contract_absent")
 *
 * on the reasoning that "what is missing is a PROVIDER contract, not ATA code".
 * That premise is superseded. A valid authenticated `goal=redep` callback is
 * authoritative evidence that a redeposit occurred, and ATA derives its own
 * deterministic identity from the authenticated attributes. Pocket issues no
 * event id and does not need to.
 *
 * WHY IT MATTERED. Shipping that sentence into RDEP activation would have told
 * operators the platform could not count redeposits at the exact moment it
 * started counting them, citing a missing provider contract that is not
 * missing. An availability block exists to be believed — it is the mechanism
 * that stops an absent metric being read as a zero — so a stale reason inside it
 * is worse than saying nothing at all.
 *
 * WHAT IS LOCKED HERE. The old reason is unreachable, the new answer is derived
 * from the accepted capability authority rather than hard-coded in either
 * direction, and "unavailable" still means something true when RDEP is off.
 *
 *   npx tsx scripts/regression/redepositAvailabilityRegression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildGrowthAvailability } from "../../src/lib/growth/analytics/availability";
import { resolveRedepositCapability } from "../../src/lib/growth/ingress-config";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const SUPERSEDED = "provider_event_identity_contract_absent";
const AMOUNTS = { amountAggregationAvailable: true, amountUnavailableReason: null } as const;
const env = (o: Record<string, string> = {}) => ({ NODE_ENV: "test", ...o }) as NodeJS.ProcessEnv;
const MASTER = { POCKET_POSTBACK_ENABLED: "true", POSTBACK_SECRET: "x".repeat(32) };

console.log("REDEPOSIT AVAILABILITY REGRESSION (RDEP-AVAIL-1)");

check("PARENT DEFECT — the superseded reason is not hard-coded in the source", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/lib/growth/analytics/availability.ts"),
    "utf8",
  );
  // Strip comments: the file legitimately DOCUMENTS the reason it no longer
  // emits, and matching prose as code would report the opposite of the truth.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(
    !code.includes(SUPERSEDED),
    "availability must not name the superseded provider-contract reason in code",
  );
  assert.match(code, /input\.redepositCapability/, "redeposits must be derived from the capability");
});

check("the capability resolver can never return the superseded reason", () => {
  for (const e of [env(), env(MASTER), env({ ...MASTER, POCKET_RDEP_INGEST_ENABLED: "true" })]) {
    const r = resolveRedepositCapability(e);
    if (r.kind === "unavailable") assert.notEqual(r.reason as string, SUPERSEDED);
  }
});

check("RDEP off — unavailable, and the reason is the real one", () => {
  const a = buildGrowthAvailability({
    ...AMOUNTS,
    redepositCapability: resolveRedepositCapability(env(MASTER)),
  });
  assert.deepEqual(a.redeposits, { available: false, reason: "redeposit_ingest_disabled" });
});

check("master gate closed — unavailable, and it says so", () => {
  const a = buildGrowthAvailability({
    ...AMOUNTS,
    redepositCapability: resolveRedepositCapability(env()),
  });
  assert.deepEqual(a.redeposits, { available: false, reason: "master_gate_disabled" });
});

check("RDEP on — available, without hard-coding availability", () => {
  const a = buildGrowthAvailability({
    ...AMOUNTS,
    redepositCapability: resolveRedepositCapability(
      env({ ...MASTER, POCKET_RDEP_INGEST_ENABLED: "true" }),
    ),
  });
  assert.deepEqual(a.redeposits, { available: true });
});

check("an unresolved caller says exactly that, and never the superseded reason", () => {
  const a = buildGrowthAvailability(AMOUNTS);
  assert.equal(a.redeposits.available, false);
  assert.equal(
    (a.redeposits as { available: false; reason: string }).reason,
    "redeposit_capability_not_resolved",
  );
});

check("the four Growth surfaces all resolve the capability", () => {
  for (const route of [
    "../../src/app/api/crm/v1/growth/funnel/route.ts",
    "../../src/app/api/crm/v1/growth/overview/route.ts",
    "../../src/app/api/crm/v1/growth/pocket-conversions/route.ts",
    "../../src/app/api/crm/v1/growth/acquisition/route.ts",
  ]) {
    const source = readFileSync(resolve(__dirname, route), "utf8");
    assert.match(
      source,
      /redepositCapability: resolveRedepositCapability\(\)/,
      `${route} must pass the resolved capability`,
    );
  }
});

check("the superseded mechanism is gone from the whole ingress path", () => {
  for (const file of [
    "../../src/lib/growth/ingress-config.ts",
    "../../src/lib/growth/pocket/redeposit.ts",
    "../../src/app/api/crm/v1/growth/ingress-health/route.ts",
  ]) {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const dead of [
      "resolveRedepositIdentityPolicy",
      "readProviderEventIdentity",
      "POCKET_RDEP_EVENT_ID_PARAM",
    ]) {
      assert.ok(!code.includes(dead), `${file} still carries ${dead} in code`);
    }
  }
});

check("RDEP still requires DATE_TIME — the fix widened nothing else", () => {
  // The capability answers "may we count redeposits", NOT "is any delivery
  // countable". A delivery with no usable event time still yields no key and so
  // no canonical event; that contract belongs to the identity module and is
  // proved in full by redepositDeterministicIdentityRegression.
  const source = readFileSync(
    resolve(__dirname, "../../src/lib/growth/pocket/redeposit-identity.ts"),
    "utf8",
  );
  assert.match(source, /event_time_\$\{eventTime\.reason\}/, "no event time means no key");
});

check("RDEP-AVAIL-2 — no operator text may deny a capability the payload reports", () => {
  // The seventh home of the superseded premise, and the only one that became
  // SELF-CONTRADICTING: totalDepositAmountNote asserted "confirmed redeposits
  // are structurally zero until a provider event-identity contract exists" in a
  // response body that reported confirmedRedeposits: 4.
  // COMMENTS STRIPPED FIRST. The file legitimately QUOTES the sentence it
  // removed, inside the comment explaining the removal — a naive scan over the
  // raw text finds that quotation and reports the opposite of the truth. This
  // is the same false positive that bit the leak scanner and two earlier
  // assertions in this phase, so it is designed out rather than rediscovered.
  const route = readFileSync(
    resolve(__dirname, "../../src/app/api/crm/v1/growth/pocket-conversions/route.ts"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const strings = [...route.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) => m[1]).join(" ");
  for (const banned of [
    "structurally zero",
    "provider event-identity contract",
    "unique event identifier",
    SUPERSEDED,
  ]) {
    assert.ok(
      !strings.includes(banned),
      `operator-facing text must not contain "${banned}"`,
    );
  }
  // The clause that was TRUE must survive the rewrite.
  assert.ok(
    strings.includes("Quarantined and identity-unresolved"),
    "the true clause about excluded deliveries must be retained",
  );
});

check("INGRESS-TIME-1 — the coarse ingress label is documented, not silently wrong", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/lib/growth/pocket/ingress-payload.ts"),
    "utf8",
  );
  assert.match(src, /INGRESS-TIME-1/, "the semantics must be documented at the call site");
  assert.match(src, /no ABSOLUTE INSTANT could be derived/);
  // And the canonical layer must keep its correct three-state model.
  const canon = readFileSync(
    resolve(__dirname, "../../src/lib/growth/pocket/redeposit-identity.ts"),
    "utf8",
  );
  assert.match(canon, /local_only/);
  assert.match(canon, /absolute_from_sender/);
});

console.log(`\n${passed}/${passed} assertions passed`);
