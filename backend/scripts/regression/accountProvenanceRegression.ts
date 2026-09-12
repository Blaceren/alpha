/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§6/§16A) — the fixture/provenance
 * classification, pinned.
 *
 * WHAT THE PARENT DID, AND WHY THESE TESTS FAIL ON IT. The parent's
 * `isSyntheticFixtureEmail` matched one suffix, so:
 *
 *   • every account on `@example.invalid`, `@ata.invalid`, `@dev.invalid`,
 *     `@learner.test`, `@ata.test` and `@ata-editorial.invalid` was reported
 *     as real — including accounts the regression harness itself created;
 *   • the residue was labelled "real", which is a claim about a person that no
 *     evidence supported.
 *
 * The cases below encode both halves of the correction: the wider set IS
 * recognised, AND non-routability alone is still not treated as proof.
 *
 *   npx tsx scripts/regression/accountProvenanceRegression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACCEPTANCE_FIXTURE_AUDIT_ACTION,
  FIXTURE_OWNED_DOMAIN_SQL_PREDICATE,
  FIXTURE_OWNED_EMAIL_DOMAINS,
  RESERVED_NON_ROUTABLE_SQL_PREDICATE,
  RESERVED_NON_ROUTABLE_TLDS,
  classifyAccountProvenance,
  isFixtureOwnedDomain,
  isInternalClientAddress,
  isReservedNonRoutableAddress,
  type AccountProvenanceInput,
} from "../../src/lib/growth/account-provenance";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/** Nothing declared, nothing registered, no staff profile — the bare case. */
const bare = (email: string): AccountProvenanceInput => ({
  email,
  hasSyntheticProvisioningAudit: false,
  hasAcceptanceFixtureDeclaration: false,
  hasStaffProfile: false,
  selfServiceRegistration: null,
});

console.log("ACCOUNT PROVENANCE REGRESSION");

check("reserved TLDs are recognised on the public suffix, all four of them", () => {
  for (const tld of RESERVED_NON_ROUTABLE_TLDS) {
    assert.equal(isReservedNonRoutableAddress(`someone@ata-preprod${tld}`), true, tld);
  }
  assert.equal(isReservedNonRoutableAddress("someone@alfatrade.media"), false);
  assert.equal(isReservedNonRoutableAddress("someone@gmail.com"), false);
});

check("a look-alike routable domain is NOT reserved (the spoof case)", () => {
  // The parent's own regression protected this shape; it must stay protected
  // now that the check is a suffix set rather than a single literal.
  assert.equal(isReservedNonRoutableAddress("spoof@ata-preprod.invalid.example.com"), false);
  assert.equal(isReservedNonRoutableAddress("spoof@example.test.attacker.io"), false);
  assert.equal(isReservedNonRoutableAddress("invalid@notreserved.com"), false);
});

check("malformed input never throws and never matches", () => {
  for (const value of [null, undefined, "", "   ", "no-at-sign", "trailing@", "@leading"]) {
    assert.equal(isReservedNonRoutableAddress(value as string | null | undefined), false, String(value));
  }
});

check("PARENT DEFECT — every live PREPROD reserved convention is now recognised", () => {
  // These are the eight conventions measured on the live database. The parent
  // recognised exactly one of them.
  const live = [
    "acceptance@ata-preprod.invalid",
    "harness@example.invalid",
    "operator@ata.invalid",
    "seed@dev.invalid",
    "seed@learner.test",
    "staff@ata.test",
    "editor@ata-editorial.invalid",
  ];
  for (const email of live) {
    assert.equal(isReservedNonRoutableAddress(email), true, `not recognised: ${email}`);
  }
});

check("NON-ROUTABLE IS NOT SYNTHETIC — the distinction the correction exists for", () => {
  // `@learner.test` and `@dev.invalid` are non-routable and have NO owner in
  // this repository. Calling them synthetic would be a guess.
  for (const email of ["seed@learner.test", "seed@dev.invalid", "staff@ata.test"]) {
    assert.equal(isReservedNonRoutableAddress(email), true, email);
    assert.equal(isFixtureOwnedDomain(email), false, `wrongly claimed as fixture-owned: ${email}`);
    assert.equal(
      classifyAccountProvenance(bare(email)).class,
      "LEGACY_UNKNOWN_PROVENANCE",
      `non-routability alone must not prove synthetic: ${email}`,
    );
  }
});

check("a domain this repository owns for fixtures IS proven synthetic", () => {
  for (const entry of FIXTURE_OWNED_EMAIL_DOMAINS) {
    const result = classifyAccountProvenance(bare(`x${entry.domain}`));
    assert.equal(result.class, "PROVEN_SYNTHETIC_FIXTURE", entry.domain);
  }
});

check("an explicit synthetic provisioning audit outranks everything", () => {
  const result = classifyAccountProvenance({
    ...bare("operator@alfatrade.media"),
    hasSyntheticProvisioningAudit: true,
    hasStaffProfile: true,
  });
  assert.equal(result.class, "PROVEN_SYNTHETIC_FIXTURE");
  assert.match(result.decidedBy, /metadata\.synthetic/);
  // Staff is orthogonal: a synthetic operator is both, and both are reported.
  assert.equal(result.staffOperational, true);
  assert.equal(result.reservedNonRoutableAddress, false);
});

check("an acceptance-fixture declaration proves synthetic on a routable-looking address", () => {
  const result = classifyAccountProvenance({
    ...bare("testrega@ata.test"),
    hasAcceptanceFixtureDeclaration: true,
  });
  assert.equal(result.class, "PROVEN_SYNTHETIC_FIXTURE");
  assert.match(result.decidedBy, new RegExp(ACCEPTANCE_FIXTURE_AUDIT_ACTION));
});

check("registration from inside the host is harness activity, not a person", () => {
  for (const ip of ["127.0.0.1", "::1", "10.81.0.18", "192.168.4.4", "172.16.0.9", "172.31.255.1"]) {
    assert.equal(isInternalClientAddress(ip), true, ip);
    const result = classifyAccountProvenance({
      ...bare("harness@dev.invalid"),
      selfServiceRegistration: { clientIp: ip },
    });
    assert.equal(result.class, "PROVEN_SYNTHETIC_FIXTURE", ip);
  }
  // 172.32 is outside RFC 1918 and must not be treated as internal.
  for (const ip of ["89.67.25.171", "95.65.94.110", "172.32.0.1", "8.8.8.8", null]) {
    assert.equal(isInternalClientAddress(ip), false, String(ip));
  }
});

check("a public client with no other authority is UNPROVEN, never 'real'", () => {
  const result = classifyAccountProvenance({
    ...bare("someone@gmail.com"),
    selfServiceRegistration: { clientIp: "95.65.94.110" },
  });
  assert.equal(result.class, "SELF_SERVICE_UNPROVEN_PROVENANCE");
  assert.equal(result.reservedNonRoutableAddress, false);
});

check("PROVEN_ORGANIC is unreachable without positive person-evidence", () => {
  // Nothing in the input vocabulary can produce it today. That is deliberate:
  // the class exists so the contract can express the fact, and the report
  // prints it at zero rather than promoting the residue into it.
  const everyShape: AccountProvenanceInput[] = [
    bare("someone@gmail.com"),
    { ...bare("someone@gmail.com"), selfServiceRegistration: { clientIp: "95.65.94.110" } },
    { ...bare("someone@gmail.com"), hasStaffProfile: true },
    { ...bare("x@example.invalid"), hasSyntheticProvisioningAudit: true },
  ];
  for (const shape of everyShape) {
    assert.notEqual(classifyAccountProvenance(shape).class, "PROVEN_ORGANIC");
  }
});

check("precedence order is pinned, strongest authority first", () => {
  // A single account carrying every signal at once resolves to the strongest.
  const all: AccountProvenanceInput = {
    email: "x@example.invalid",
    hasSyntheticProvisioningAudit: true,
    hasAcceptanceFixtureDeclaration: true,
    hasStaffProfile: true,
    selfServiceRegistration: { clientIp: "127.0.0.1" },
  };
  assert.match(classifyAccountProvenance(all).decidedBy, /metadata\.synthetic/);
  assert.match(
    classifyAccountProvenance({ ...all, hasSyntheticProvisioningAudit: false }).decidedBy,
    new RegExp(ACCEPTANCE_FIXTURE_AUDIT_ACTION),
  );
  assert.match(
    classifyAccountProvenance({ ...all, hasSyntheticProvisioningAudit: false, hasAcceptanceFixtureDeclaration: false }).decidedBy,
    /loopback\/private/,
  );
  assert.match(
    classifyAccountProvenance({ ...bare("x@example.invalid") }).decidedBy,
    /owns for fixtures/,
  );
});

check("SQL twins are derived from the same constants and cannot drift", () => {
  for (const tld of RESERVED_NON_ROUTABLE_TLDS) {
    assert.ok(RESERVED_NON_ROUTABLE_SQL_PREDICATE.includes(tld), tld);
  }
  for (const entry of FIXTURE_OWNED_EMAIL_DOMAINS) {
    assert.ok(FIXTURE_OWNED_DOMAIN_SQL_PREDICATE.includes(entry.domain), entry.domain);
  }
  assert.ok(RESERVED_NON_ROUTABLE_SQL_PREDICATE.toUpperCase().includes("LOWER("));
  assert.ok(FIXTURE_OWNED_DOMAIN_SQL_PREDICATE.toUpperCase().includes("LOWER("));
});

check("every fixture-owned domain names the source that owns it", () => {
  for (const entry of FIXTURE_OWNED_EMAIL_DOMAINS) {
    assert.ok(entry.domain.startsWith("@"), entry.domain);
    assert.ok(entry.ownedBy.length > 20, `owner not stated for ${entry.domain}`);
  }
});

check("§18 still holds — analytics never imports the classification", () => {
  const sources = readFileSync(resolve(__dirname, "../../src/lib/growth/analytics/sources.ts"), "utf8");
  const queries = readFileSync(resolve(__dirname, "../../src/lib/growth/analytics/queries.ts"), "utf8");
  for (const file of [sources, queries]) {
    assert.ok(!file.includes("account-provenance"), "analytics must not import the classifier");
    assert.ok(!file.includes("classifyAccountProvenance"));
    assert.ok(!file.includes("isReservedNonRoutableAddress"));
  }
});

check("the reporting tool contains no write call", () => {
  const tool = readFileSync(resolve(__dirname, "../ops/reportAccountProvenance.ts"), "utf8");
  const forbidden = [".create(", ".createMany(", ".update(", ".updateMany(", ".delete(", ".deleteMany(", ".upsert(", "$executeRaw"];
  for (const call of forbidden) assert.ok(!tool.includes(call), `report must not ${call}`);
});

console.log(`\n${passed}/${passed} assertions passed`);
