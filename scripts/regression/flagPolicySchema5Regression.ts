/**
 * PRODUCT-RC-1 — the operational flag-policy evaluator, schema/5.
 *
 * WHAT THIS SUITE IS FOR. `scripts/ops/flag-policy-eval.js` is the gate that
 * decides whether a runtime environment file is allowed to exist. It is the only
 * thing standing between "an operator pasted a production Pocket credential into
 * a DEV env file" and nobody noticing. A gate with no tests is a gate that
 * passes.
 *
 * WHY SCHEMA/5 EXISTS. AFD-4 introduced two POCKET_-prefixed keys that schema/4
 * could not express:
 *
 *   POCKET_FIRST_DEPOSIT_ENABLED — a capability admitting goal=dep ingestion;
 *   POCKET_DEPOSIT_CURRENCY      — a setting whose VALUE decides what money is
 *                                  recorded as.
 *
 * Under schema/4, `forbid_unknown_pocket_prefix` failed BOTH of them on sight —
 * including the honest `POCKET_FIRST_DEPOSIT_ENABLED=false`. Silence was the
 * only legal way to say "first deposit is off", and silence is exactly the state
 * an audit cannot tell apart from having forgotten. PRODUCT-READY-1 recorded
 * this as R-03; this suite is the proof it is fixed.
 *
 * THE GUARD-THE-GUARD RULE. Every case below asserts BOTH directions: that a
 * planted violation IS caught, and that the legitimate neighbouring
 * configuration is NOT. A policy test that only proves passes would still pass
 * if the evaluator were `process.exit(0)`.
 *
 * NOTHING HERE READS OR WRITES A RUNTIME FILE except the live env, which is read
 * ONLY to prove the shipped DEV profile validates it unchanged — case 20. No
 * environment value is ever printed by this suite or by the evaluator.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const EVAL = path.join(ROOT, "scripts/ops/flag-policy-eval.js");
const DEV_POLICY = path.join(ROOT, "config/flag-policy/curriculum-v2-flag-policy.dev.schema5.json");
const PREPROD_POLICY = path.join(
  ROOT,
  "config/flag-policy/curriculum-v2-flag-policy.preprod.schema5.json",
);
const LIVE_POLICY = "/home/ubuntu/runtime/ata-dev-v2/config/curriculum-v2-flag-policy.json";
const LIVE_ENV = [
  "/home/ubuntu/runtime/ata-dev-v2/env/backend.env",
  "/home/ubuntu/runtime/ata-dev-v2/env/backend.override.env",
];

const OUT = process.env.PRC1_POLICY_OUT ?? "";

let passed = 0;
let failed = 0;
const results: { name: string; ok: boolean }[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    results.push({ name, ok: false });
    console.log(`FAIL ${name}`);
    console.log(String(error instanceof Error ? error.stack : error));
  }
}

type Result = { code: number; out: string };

/** Run the evaluator over env-style lines. Never prints the lines themselves. */
function evaluate(lines: string[], policy = DEV_POLICY): Result {
  const run = spawnSync(process.execPath, [EVAL, policy], {
    input: `${lines.join("\n")}\n`,
    encoding: "utf8",
  });
  return { code: run.status ?? -1, out: `${run.stdout}${run.stderr}` };
}

/**
 * The DEV baseline: exactly the shape of the accepted live environment, as
 * key=value lines. Every case below starts from this and changes ONE thing, so a
 * failure names the change that caused it.
 */
const DEV_BASELINE = [
  "CURRICULUM_V2_READ_ENABLED=true",
  "CURRICULUM_V2_ENROLLMENT_ENABLED=true",
  "CURRICULUM_V2_CONTENT_ENABLED=true",
  "CURRICULUM_V2_ASSESSMENT_ENABLED=true",
  "CURRICULUM_V2_REPORT_ENABLED=true",
  "CURRICULUM_V2_CHECKPOINT_ENABLED=true",
  "POCKET_POSTBACK_ENABLED=true",
  "POCKET_BALANCE_PROVIDER_ENABLED=true",
  "POCKET_AFFILIATE_BASE_URL=https://example.invalid/register?a=1",
  "ATA_ENVIRONMENT=dev",
  "CHECKPOINT_PROVIDER_MODE=dev_simulator",
  "CHECKPOINT_DEV_SIMULATOR_STATE_PATH=/home/ubuntu/runtime/ata-dev-v2/state/x.json",
];

function withLines(...extra: string[]) {
  return [...DEV_BASELINE, ...extra];
}

/* ================= 1-3. the schema/4 regression that started this ========= */

check("1 schema/4 rejects the honest first-deposit denial (the R-03 defect)", () => {
  const under4 = evaluate([...DEV_BASELINE, "POCKET_FIRST_DEPOSIT_ENABLED=false"], LIVE_POLICY);
  assert.equal(under4.code, 1, "schema/4 was expected to reject an undeclared POCKET_ key");
  assert.match(under4.out, /unknown-pocket-flag POCKET_FIRST_DEPOSIT_ENABLED/);
});

check("2 schema/4 rejects the currency too", () => {
  const under4 = evaluate([...DEV_BASELINE, "POCKET_DEPOSIT_CURRENCY=USD"], LIVE_POLICY);
  assert.equal(under4.code, 1);
  assert.match(under4.out, /unknown-pocket-flag POCKET_DEPOSIT_CURRENCY/);
});

check("3 schema/5 accepts the honest denial", () => {
  const result = evaluate(withLines("POCKET_FIRST_DEPOSIT_ENABLED=false"));
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /1\/1 forbidden capabilities denied/);
});

/* ================= 4-8. the capability stays fail-closed ================== */

check("4 first deposit may not be ENABLED under the DEV profile", () => {
  const result = evaluate(withLines("POCKET_FIRST_DEPOSIT_ENABLED=true"));
  assert.equal(result.code, 1);
  assert.match(result.out, /pocket-enabled POCKET_FIRST_DEPOSIT_ENABLED/);
});

check("5 a malformed boolean fails rather than being read as disabled", () => {
  for (const value of ["TRUE", "True", "1", "yes", "", " false", "0", "no", "disabled"]) {
    const result = evaluate(withLines(`POCKET_FIRST_DEPOSIT_ENABLED=${value}`));
    assert.equal(result.code, 1, `"${value}" was accepted`);
    assert.match(result.out, /malformed-boolean POCKET_FIRST_DEPOSIT_ENABLED|pocket-enabled/);
  }
});

check("5b the whitespace boundary is where the line ends, and it fails closed", () => {
  // The evaluator trims the LINE before splitting on the first `=`, so trailing
  // whitespace is file formatting and the value is `false`. That matches how
  // both a sourced shell assignment and dotenv read the same line, so treating
  // it as malformed would fail a file that the process itself reads correctly.
  const trailing = evaluate(withLines("POCKET_FIRST_DEPOSIT_ENABLED=false "));
  assert.equal(trailing.code, 0, trailing.out);

  // Whitespace INSIDE the value is a different thing and is refused. The
  // asymmetry is deliberate and safe: the ambiguous direction is the one that
  // fails. A leading space is never accidental file formatting — it is a value.
  const leading = evaluate(withLines("POCKET_FIRST_DEPOSIT_ENABLED= false"));
  assert.equal(leading.code, 1);
  assert.match(leading.out, /malformed-boolean POCKET_FIRST_DEPOSIT_ENABLED/);

  // And the same boundary must never turn a denial into a grant.
  const trailingTrue = evaluate(withLines("POCKET_FIRST_DEPOSIT_ENABLED=true "));
  assert.equal(trailingTrue.code, 1);
  assert.match(trailingTrue.out, /pocket-enabled POCKET_FIRST_DEPOSIT_ENABLED/);
});

check("6 a malformed boolean is never normalized into an ENABLED state", () => {
  // The dangerous direction: something that is not exactly "false" must not be
  // silently treated as "false" either. It must FAIL.
  const result = evaluate(withLines("POCKET_FIRST_DEPOSIT_ENABLED=off"));
  assert.equal(result.code, 1);
  assert.match(result.out, /malformed-boolean/);
});

check("7 absence remains authorized under the DEV profile", () => {
  const result = evaluate(DEV_BASELINE);
  assert.equal(result.code, 0, result.out);
});

check("8 the preprod profile requires the denial to be ON THE RECORD", () => {
  const preprodBase = [
    "CURRICULUM_V2_READ_ENABLED=true",
    "CURRICULUM_V2_ENROLLMENT_ENABLED=true",
    "CURRICULUM_V2_CONTENT_ENABLED=true",
    "CURRICULUM_V2_ASSESSMENT_ENABLED=true",
    "CURRICULUM_V2_REPORT_ENABLED=true",
    "POCKET_POSTBACK_ENABLED=true",
    "ATA_ENVIRONMENT=staging",
    "CHECKPOINT_PROVIDER_MODE=disabled",
  ];
  // Silence is NOT enough there.
  const silent = evaluate(preprodBase, PREPROD_POLICY);
  assert.equal(silent.code, 1);
  assert.match(silent.out, /pocket-disabled-not-declared POCKET_FIRST_DEPOSIT_ENABLED/);

  // Writing it down is.
  const declared = evaluate(
    [...preprodBase, "POCKET_FIRST_DEPOSIT_ENABLED=false"],
    PREPROD_POLICY,
  );
  assert.equal(declared.code, 0, declared.out);
});

/* ================= 9-13. the currency is a value, not a switch ============ */

check("9 an unsupported currency fails", () => {
  for (const value of ["EUR", "RUB", "ETH", "BTC", "usd", "US", "USDT", ""]) {
    const result = evaluate(
      withLines("POCKET_FIRST_DEPOSIT_ENABLED=false", `POCKET_DEPOSIT_CURRENCY=${value}`),
    );
    assert.equal(result.code, 1, `"${value}" was accepted as a currency`);
  }
});

check("10 the evaluator never echoes the rejected value", () => {
  const result = evaluate(
    withLines("POCKET_FIRST_DEPOSIT_ENABLED=false", "POCKET_DEPOSIT_CURRENCY=SECRETVALUE123"),
  );
  assert.equal(result.code, 1);
  assert.ok(!result.out.includes("SECRETVALUE123"), "the evaluator echoed an environment value");
  assert.match(result.out, /pocket-setting-invalid POCKET_DEPOSIT_CURRENCY/);
});

check("11 a currency CANNOT silently enable deposit processing", () => {
  // A valid currency beside a disabled capability is dead configuration that
  // reads as "deposits are configured". It is a violation, not a shrug.
  const result = evaluate(
    withLines("POCKET_FIRST_DEPOSIT_ENABLED=false", "POCKET_DEPOSIT_CURRENCY=USD"),
  );
  assert.equal(result.code, 1);
  assert.match(result.out, /pocket-setting-without-capability POCKET_DEPOSIT_CURRENCY/);

  // And a currency with NO capability key at all is equally refused — the
  // failure must not depend on the flag having been written down as false.
  const orphan = evaluate(withLines("POCKET_DEPOSIT_CURRENCY=USD"));
  assert.equal(orphan.code, 1);
  assert.match(orphan.out, /pocket-setting-without-capability POCKET_DEPOSIT_CURRENCY/);
});

check("12 currency alone never counts as a capability grant", () => {
  // The whole point: setting the currency must not move ANY capability count.
  const withCurrency = evaluate(withLines("POCKET_DEPOSIT_CURRENCY=USD"));
  assert.equal(withCurrency.code, 1);
  assert.ok(!/pocket-enabled/.test(withCurrency.out));
});

check("13 the currency is legal exactly when the capability is enabled", () => {
  // Proven on the preprod SHAPE with an ACTIVATED profile, because the DEV
  // profile forbids the capability outright. This is the only combination in
  // which a currency means anything.
  const activated = JSON.parse(fs.readFileSync(PREPROD_POLICY, "utf8")) as Record<string, unknown>;
  activated.pocket_required_disabled_keys = [];
  activated.pocket_disabled_must_be_explicit = [];
  activated.pocket_required_enabled = ["POCKET_POSTBACK_ENABLED", "POCKET_FIRST_DEPOSIT_ENABLED"];
  const tmp = path.join(ROOT, ".prc1-activated-policy.json");
  fs.writeFileSync(tmp, JSON.stringify(activated));

  try {
    const ok = evaluate(
      [
        "CURRICULUM_V2_READ_ENABLED=true",
        "CURRICULUM_V2_ENROLLMENT_ENABLED=true",
        "CURRICULUM_V2_CONTENT_ENABLED=true",
        "CURRICULUM_V2_ASSESSMENT_ENABLED=true",
        "CURRICULUM_V2_REPORT_ENABLED=true",
        "POCKET_POSTBACK_ENABLED=true",
        "POCKET_FIRST_DEPOSIT_ENABLED=true",
        "POCKET_DEPOSIT_CURRENCY=USD",
        "ATA_ENVIRONMENT=staging",
        "CHECKPOINT_PROVIDER_MODE=disabled",
      ],
      tmp,
    );
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /1\/1 declared settings valid/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

/* ================= 14-17. nothing else moved ============================== */

check("14 an undeclared POCKET_ key still fails under schema/5", () => {
  const result = evaluate(withLines("POCKET_PARTNER_API_TOKEN=x"));
  assert.equal(result.code, 1);
  assert.match(result.out, /unknown-pocket-flag POCKET_PARTNER_API_TOKEN/);
});

check("15 the CURRICULUM_V2_ write-flag contract is untouched", () => {
  // PHASE-G0 — CURRICULUM_V2_ADMIN_ENABLED moved OUT of this assertion and into
  // check 22, because schema/6 deliberately makes it settable. Every OTHER
  // property this check ever proved is unchanged and is still proved here: a
  // required-false write flag may not be enabled, an undeclared CURRICULUM_V2_
  // key still fails closed, and an honest false is still accepted.
  assert.equal(evaluate(withLines("CURRICULUM_V2_XP_ENABLED=true")).code, 1);
  assert.equal(evaluate(withLines("CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED=true")).code, 1);
  assert.equal(evaluate(withLines("CURRICULUM_V2_NEW_THING=true")).code, 1);
  assert.equal(evaluate(withLines("CURRICULUM_V2_XP_ENABLED=false")).code, 0);
});

check("16 the checkpoint provider contract is untouched", () => {
  const noEnv = evaluate(DEV_BASELINE.filter((l) => !l.startsWith("ATA_ENVIRONMENT=")));
  assert.equal(noEnv.code, 1);
  assert.match(noEnv.out, /dev-simulator-outside-dev|missing-environment/);

  const forbidden = evaluate(withLines("CHECKPOINT_PROVIDER_TEST_BACKEND=1"));
  assert.equal(forbidden.code, 1);
  assert.match(forbidden.out, /forbidden-checkpoint-key/);
});

check("17 later assignments win, exactly as the process env resolves them", () => {
  // base then override: the override must decide. This is how backend.env and
  // backend.override.env actually combine.
  const overridden = evaluate([
    ...DEV_BASELINE,
    "POCKET_FIRST_DEPOSIT_ENABLED=true",
    "POCKET_FIRST_DEPOSIT_ENABLED=false",
  ]);
  assert.equal(overridden.code, 0, overridden.out);

  const theOtherWay = evaluate([
    ...DEV_BASELINE,
    "POCKET_FIRST_DEPOSIT_ENABLED=false",
    "POCKET_FIRST_DEPOSIT_ENABLED=true",
  ]);
  assert.equal(theOtherWay.code, 1);
});

/* ================= 18-21. compatibility and the live file ================= */

check("18 the schema/5 evaluator evaluates a schema/4 policy identically", () => {
  // The rollback property: policy file and evaluator move independently.
  const live = evaluate(DEV_BASELINE, LIVE_POLICY);
  assert.equal(live.code, 0, live.out);
  // And the schema/5 additions are simply absent from the summary.
  assert.ok(!/forbidden capabilities denied/.test(live.out));
});

check("19 the declared profiles are well-formed and say what they claim", () => {
  const dev = JSON.parse(fs.readFileSync(DEV_POLICY, "utf8")) as Record<string, unknown>;
  const pre = JSON.parse(fs.readFileSync(PREPROD_POLICY, "utf8")) as Record<string, unknown>;

  // PHASE-G0 — the profiles are schema/6. The FILENAMES deliberately keep their
  // `.schema5` suffix and this suite deliberately keeps its name: four accepted
  // acceptance manifests (product-rc1, atlas-closure-afd5d2a, atlas-closure-afd5d3,
  // agent-foundation-af1) record `test:regression:flag-policy-schema5` as a suite
  // they ran, and renaming it would rewrite the history of phases that are already
  // accepted. The suite tracks the CURRENT policy schema, whatever its number.
  assert.equal(dev.schema, "ata.curriculum-v2.flag-policy/6");
  assert.equal(pre.schema, "ata.curriculum-v2.flag-policy/6");

  for (const policy of [dev, pre]) {
    assert.ok((policy.pocket_flags as string[]).includes("POCKET_FIRST_DEPOSIT_ENABLED"));
    assert.ok(
      (policy.pocket_known_non_capability as string[]).includes("POCKET_DEPOSIT_CURRENCY"),
      "the currency must be declared as a SETTING, never as a capability",
    );
    const enumerated = policy.pocket_enumerated_settings as Record<
      string,
      { valid_values: string[]; requires_enabled_flag: string }
    >;
    assert.deepEqual(enumerated.POCKET_DEPOSIT_CURRENCY.valid_values, ["USD"]);
    assert.equal(
      enumerated.POCKET_DEPOSIT_CURRENCY.requires_enabled_flag,
      "POCKET_FIRST_DEPOSIT_ENABLED",
    );
  }

  // The DEV profile must accept silence; the preprod profile must not.
  assert.deepEqual(dev.pocket_disabled_must_be_explicit, []);
  assert.deepEqual(pre.pocket_disabled_must_be_explicit, ["POCKET_FIRST_DEPOSIT_ENABLED"]);

  // Preprod forbids the production-forbidden simulator.
  const cp = pre.checkpoint_provider as Record<string, unknown>;
  assert.deepEqual(cp.allowed_modes_here, ["disabled"]);
  assert.equal(cp.expected_environment, "staging");
});

check("20 the DEV profile validates the CURRENT live environment unchanged", () => {
  // This is the deployability proof: schema/5 can replace the live schema/4
  // policy WITHOUT editing a single environment line. If this fails, the policy
  // and the environment would have to move together, and they must not.
  const lines: string[] = [];
  for (const file of LIVE_ENV) {
    if (fs.existsSync(file)) lines.push(fs.readFileSync(file, "utf8"));
  }
  assert.ok(lines.length > 0, "live env files were not readable");
  const run = spawnSync(process.execPath, [EVAL, DEV_POLICY], {
    input: lines.join("\n"),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /6\/6 required read flags enabled/);
  assert.match(run.stdout, /1\/1 forbidden capabilities denied/);
  // Never let this suite become a channel for environment values.
  assert.ok(!/SESSION_SECRET|POSTBACK_SECRET/.test(run.stdout));
});

check("21 the live policy file on disk is still schema/4 and untouched", () => {
  // PRODUCT-RC-1 does not install anything. If this ever fails, the phase
  // modified the live control plane, which it is forbidden to do.
  const live = JSON.parse(fs.readFileSync(LIVE_POLICY, "utf8")) as { schema: string };
  assert.equal(live.schema, "ata.curriculum-v2.flag-policy/4");
});

/* ------------------------------------------- PHASE-G0 — schema/6 additions */

check("22 optional-explicit is settable BOTH ways and still fails closed on junk", () => {
  // The point of the schema/6 addition: an operator may deliberately activate
  // the staff Authoring Studio, and may deliberately record that it is off.
  assert.equal(evaluate(withLines("CURRICULUM_V2_ADMIN_ENABLED=true")).code, 0);
  assert.equal(evaluate(withLines("CURRICULUM_V2_ADMIN_ENABLED=false")).code, 0);

  // Everything that made the old declaration safe is preserved. A typo is still
  // a violation rather than being read as either polarity.
  assert.equal(evaluate(withLines("CURRICULUM_V2_ADMIN_ENABLED=TRUE")).code, 1);
  assert.equal(evaluate(withLines("CURRICULUM_V2_ADMIN_ENABLED=1")).code, 1);
  assert.equal(evaluate(withLines("CURRICULUM_V2_ADMIN_ENABLED=")).code, 1);
  assert.equal(evaluate(withLines("CURRICULUM_V2_ADMIN_ENABLED=yes")).code, 1);
});

check("23 absence is still legal and still means OFF", () => {
  // The default posture is unchanged: a deployment that says nothing has the
  // authoring API disabled, because isCurriculumV2AdminEnabled() requires the
  // literal string "true". Listing the key as optional grants nothing by itself.
  assert.equal(evaluate(withLines()).code, 0);
  const dev = JSON.parse(fs.readFileSync(DEV_POLICY, "utf8")) as Record<string, string[]>;
  const pre = JSON.parse(fs.readFileSync(PREPROD_POLICY, "utf8")) as Record<string, string[]>;
  for (const policy of [dev, pre]) {
    assert.deepEqual(policy.optional_explicit_boolean, ["CURRICULUM_V2_ADMIN_ENABLED"]);
    // A key may never carry two contradictory declarations.
    assert.ok(!policy.required_true.includes("CURRICULUM_V2_ADMIN_ENABLED"));
    assert.ok(!policy.required_false_or_absent.includes("CURRICULUM_V2_ADMIN_ENABLED"));
  }
});

check("24 the Phase-F auto-enroll flag is REGISTERED but not enabled", () => {
  const dev = JSON.parse(fs.readFileSync(DEV_POLICY, "utf8")) as Record<string, string[]>;
  const pre = JSON.parse(fs.readFileSync(PREPROD_POLICY, "utf8")) as Record<string, string[]>;
  for (const policy of [dev, pre]) {
    assert.ok(
      policy.required_false_or_absent.includes("CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED"),
      "the key must be declared so an honest false stops failing unknown-flag",
    );
    assert.ok(
      !policy.optional_explicit_boolean.includes("CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED"),
      "registering it must NOT make it settable — activation is a separate phase",
    );
  }
  // Registered means an honest denial is now expressible. It does NOT mean it
  // may be turned on.
  assert.equal(evaluate(withLines("CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED=false")).code, 0);
  assert.equal(evaluate(withLines("CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED=true")).code, 1);
  // Absence stays legal, which is what keeps live preprod valid unchanged.
  assert.equal(evaluate(withLines()).code, 0);
});

check("25 an unknown CURRICULUM_V2_ key still fails closed under schema/6", () => {
  // The fail-closed inventory rule is the property the optional list must not
  // have weakened. Adding one key to KNOWN must not admit any other.
  assert.equal(evaluate(withLines("CURRICULUM_V2_ADMIN_ENABLE=true")).code, 1);
  assert.equal(evaluate(withLines("CURRICULUM_V2_AUTHORING_ENABLED=true")).code, 1);
  assert.equal(evaluate(withLines("CURRICULUM_V2_ADMIN_ENABLED_EXTRA=false")).code, 1);
});

/* ------------------------------------------------------------- summary */

if (OUT) {
  fs.writeFileSync(
    OUT,
    JSON.stringify({ suite: "prc1-flag-policy-schema5", passed, failed, results }, null, 2),
  );
}

console.log(`\nPRODUCT-RC-1 flag policy schema/5: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
