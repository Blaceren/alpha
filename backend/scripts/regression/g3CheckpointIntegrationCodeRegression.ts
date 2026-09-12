/**
 * G3 — the checkpoint integration-code allowlist regression.
 *
 * WHAT THIS EXISTS TO PREVENT
 * The runtime allowlist was a hand-written literal containing one code while the
 * published curriculum declared twenty. Nineteen gates answered
 * `integration_unknown` and no test noticed, because the allowlist and the
 * curriculum shared no source and nothing compared them.
 *
 * The load-bearing assertion here is therefore NOT "twenty codes are recognised".
 * It is CURRICULUM-DERIVED: it reads the checkpoint codes the canonical product
 * actually declares and requires the runtime to recognise every one of them. A
 * future curriculum that adds a twenty-first checkpoint makes this test fail
 * unless the runtime recognises it too — which is exactly the failure the shipped
 * defect never produced.
 *
 * Run: npx tsx scripts/regression/g3CheckpointIntegrationCodeRegression.ts
 */
import assert from "node:assert/strict";
import {
  isKnownCheckpointIntegrationCode,
  resolveCheckpointVerification,
} from "../../src/lib/curriculum/checkpoint";
import {
  ATA_CHECKPOINT_INTEGRATION_CODES,
  ATA_LEVELS,
  ataCheckpoint,
  gateIntegrationCode,
} from "../../src/lib/curriculum/product-ata-100";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A fully configured production-shaped environment. No secret is a real one. */
function configuredEnv(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    ATA_ENVIRONMENT: "production",
    CURRICULUM_V2_CHECKPOINT_ENABLED: "true",
    POCKET_BALANCE_PROVIDER_ENABLED: "true",
    POCKET_PARTNER_API_BASE_URL: "https://pocketpartners.com",
    POCKET_PARTNER_ID: "1234",
    POCKET_PARTNER_API_TOKEN: "g3-regression-partner-token-placeholder-value",
    ...over,
  } as NodeJS.ProcessEnv;
}

console.log("G3 checkpoint integration-code regression");

/* ---------------------------------------------------------------- canonical */

const canonicalCheckpointLevels = ATA_LEVELS.filter((level) => level.kind === "checkpoint");

test("the canonical product declares 20 checkpoint levels", () => {
  assert.equal(canonicalCheckpointLevels.length, 20);
});

test("the derived code set matches gateIntegrationCode level by level", () => {
  const expected = canonicalCheckpointLevels.map((level) => gateIntegrationCode(level));
  assert.deepEqual([...ATA_CHECKPOINT_INTEGRATION_CODES], expected);
});

test("the derived code set has no duplicates", () => {
  assert.equal(new Set(ATA_CHECKPOINT_INTEGRATION_CODES).size, ATA_CHECKPOINT_INTEGRATION_CODES.length);
});

test("EVERY canonical checkpoint code is recognised by the runtime", () => {
  const unrecognised = ATA_CHECKPOINT_INTEGRATION_CODES.filter(
    (code) => !isKnownCheckpointIntegrationCode(code),
  );
  assert.deepEqual(unrecognised, [], `unrecognised: ${unrecognised.join(", ")}`);
});

test("the recognised set is exactly the canonical set — 20 of 20", () => {
  assert.equal(ATA_CHECKPOINT_INTEGRATION_CODES.length, 20);
  assert.equal(
    ATA_CHECKPOINT_INTEGRATION_CODES.filter(isKnownCheckpointIntegrationCode).length,
    20,
  );
});

test("every canonical checkpoint level has an approved threshold", () => {
  for (const level of canonicalCheckpointLevels) {
    const checkpoint = ataCheckpoint(level.levelNumber);
    assert.ok(checkpoint, `level ${level.levelNumber} has no approved checkpoint`);
    assert.ok(checkpoint.thresholdMinorUnits > 0, `level ${level.levelNumber} threshold not positive`);
    assert.equal(checkpoint.thresholdCurrency, "USD");
  }
});

/* ------------------------------------------------------------------ refusal */

test("checkpoint.module-21 is REFUSED", () => {
  assert.equal(isKnownCheckpointIntegrationCode("checkpoint.module-21"), false);
});

test("checkpoint.module-00 is REFUSED", () => {
  assert.equal(isKnownCheckpointIntegrationCode("checkpoint.module-00"), false);
});

test("unpadded and mis-shaped variants are REFUSED", () => {
  for (const code of [
    "checkpoint.module-1",
    "checkpoint.module-001",
    "checkpoint.module.01",
    "checkpoint.module_01",
    "checkpoint.MODULE-01",
    "checkpoint.module-01 ",
    " checkpoint.module-01",
    "checkpoint.",
    "checkpoint",
    "module-01",
    "pocket.registration",
    "checkpoint.module-01;drop",
    "checkpoint.module-01/../module-02",
    "",
  ]) {
    assert.equal(
      isKnownCheckpointIntegrationCode(code),
      false,
      `expected refusal for ${JSON.stringify(code)}`,
    );
  }
});

test("non-string inputs are REFUSED", () => {
  assert.equal(isKnownCheckpointIntegrationCode(null), false);
  assert.equal(isKnownCheckpointIntegrationCode(undefined), false);
});

/* -------------------------------------------------------------- read model */

const SAMPLED_LEVELS = [4, 10, 20, 50, 100];

test(`sampled levels ${SAMPLED_LEVELS.join(", ")} resolve to a usable gate`, () => {
  for (const levelNumber of SAMPLED_LEVELS) {
    const level = canonicalCheckpointLevels.find((l) => l.levelNumber === levelNumber);
    assert.ok(level, `level ${levelNumber} is not a canonical checkpoint`);
    const code = gateIntegrationCode(level)!;
    const checkpoint = ataCheckpoint(levelNumber)!;
    const model = resolveCheckpointVerification({
      integrationCode: code,
      requirement: {
        integrationCode: code,
        thresholdCurrency: "USD",
        thresholdMinorUnits: checkpoint.thresholdMinorUnits,
      },
      reachable: true,
      env: configuredEnv(),
    });
    assert.equal(model.verificationState, "ready", `L${levelNumber} state`);
    assert.equal(model.verificationReason, "none", `L${levelNumber} reason`);
    assert.equal(model.canVerify, true, `L${levelNumber} canVerify`);
    assert.equal(model.integrationCode, code, `L${levelNumber} code echoed`);
  }
});

test("ALL 20 canonical checkpoints resolve to a usable gate", () => {
  for (const level of canonicalCheckpointLevels) {
    const code = gateIntegrationCode(level)!;
    const checkpoint = ataCheckpoint(level.levelNumber)!;
    const model = resolveCheckpointVerification({
      integrationCode: code,
      requirement: {
        integrationCode: code,
        thresholdCurrency: "USD",
        thresholdMinorUnits: checkpoint.thresholdMinorUnits,
      },
      reachable: true,
      env: configuredEnv(),
    });
    assert.equal(model.verificationState, "ready", `L${level.levelNumber} (${code}) state`);
    assert.equal(model.canVerify, true, `L${level.levelNumber} (${code}) canVerify`);
  }
});

test("an unrecognised code still fails closed with integration_unknown", () => {
  const model = resolveCheckpointVerification({
    integrationCode: "checkpoint.module-21",
    requirement: {
      integrationCode: "checkpoint.module-21",
      thresholdCurrency: "USD",
      thresholdMinorUnits: 5000,
    },
    reachable: true,
    env: configuredEnv(),
  });
  assert.equal(model.verificationState, "verification_unavailable");
  assert.equal(model.verificationReason, "integration_unknown");
  assert.equal(model.canVerify, false);
  assert.equal(model.integrationCode, null, "an unrecognised code is never echoed back");
});

/* ------------------------------------------- ownership is NOT weakened */

test("recognising a code does not bypass the checkpoint flag", () => {
  for (const code of ATA_CHECKPOINT_INTEGRATION_CODES) {
    const model = resolveCheckpointVerification({
      integrationCode: code,
      requirement: { integrationCode: code, thresholdCurrency: "USD", thresholdMinorUnits: 5000 },
      reachable: true,
      env: configuredEnv({ CURRICULUM_V2_CHECKPOINT_ENABLED: "false" }),
    });
    assert.equal(model.verificationReason, "checkpoint_disabled", code);
    assert.equal(model.canVerify, false, code);
  }
});

test("recognising a code does not bypass the provider capability flag", () => {
  const code = ATA_CHECKPOINT_INTEGRATION_CODES[9];
  const model = resolveCheckpointVerification({
    integrationCode: code,
    requirement: { integrationCode: code, thresholdCurrency: "USD", thresholdMinorUnits: 150000 },
    reachable: true,
    env: configuredEnv({ POCKET_BALANCE_PROVIDER_ENABLED: "false" }),
  });
  assert.equal(model.verificationReason, "provider_disabled");
  assert.equal(model.canVerify, false);
});

test("provider-disabled remains an honest negative state, never not_met", () => {
  const code = ATA_CHECKPOINT_INTEGRATION_CODES[19];
  const model = resolveCheckpointVerification({
    integrationCode: code,
    requirement: { integrationCode: code, thresholdCurrency: "USD", thresholdMinorUnits: 1000000 },
    reachable: true,
    env: configuredEnv({ POCKET_BALANCE_PROVIDER_ENABLED: "false" }),
  });
  assert.notEqual(model.verificationState, "not_met");
  assert.equal(model.verificationState, "verification_unavailable");
});

test("recognising a code does not invent a threshold", () => {
  for (const code of ATA_CHECKPOINT_INTEGRATION_CODES) {
    const missing = resolveCheckpointVerification({
      integrationCode: code,
      requirement: null,
      reachable: true,
      env: configuredEnv(),
    });
    assert.equal(missing.verificationReason, "requirement_unconfigured", `${code} with no requirement`);
    assert.equal(missing.canVerify, false, code);

    const mismatched = resolveCheckpointVerification({
      integrationCode: code,
      requirement: {
        integrationCode: "checkpoint.module-01",
        thresholdCurrency: "USD",
        thresholdMinorUnits: 5000,
      },
      reachable: true,
      env: configuredEnv(),
    });
    if (code !== "checkpoint.module-01") {
      assert.equal(
        mismatched.verificationReason,
        "requirement_unconfigured",
        `${code} with a requirement belonging to another gate`,
      );
    }
  }
});

test("a non-positive or non-USD threshold is refused for every code", () => {
  for (const code of ATA_CHECKPOINT_INTEGRATION_CODES) {
    for (const requirement of [
      { integrationCode: code, thresholdCurrency: "USD", thresholdMinorUnits: 0 },
      { integrationCode: code, thresholdCurrency: "USD", thresholdMinorUnits: -1 },
      { integrationCode: code, thresholdCurrency: "EUR", thresholdMinorUnits: 5000 },
    ]) {
      const model = resolveCheckpointVerification({
        integrationCode: code,
        requirement,
        reachable: true,
        env: configuredEnv(),
      });
      assert.equal(model.verificationReason, "requirement_unconfigured", `${code} ${JSON.stringify(requirement)}`);
    }
  }
});

test("a learner who has not arrived cannot verify, however valid the gate", () => {
  const code = ATA_CHECKPOINT_INTEGRATION_CODES[4];
  const model = resolveCheckpointVerification({
    integrationCode: code,
    requirement: { integrationCode: code, thresholdCurrency: "USD", thresholdMinorUnits: 30000 },
    reachable: false,
    env: configuredEnv(),
  });
  assert.equal(model.canVerify, false);
});

test("the read model never exposes an amount for any code", () => {
  for (const code of ATA_CHECKPOINT_INTEGRATION_CODES) {
    const model = resolveCheckpointVerification({
      integrationCode: code,
      requirement: { integrationCode: code, thresholdCurrency: "USD", thresholdMinorUnits: 5000 },
      reachable: true,
      env: configuredEnv(),
    });
    const serialised = JSON.stringify(model);
    assert.equal(model.canStart, false);
    assert.equal(model.canComplete, false);
    assert.ok(!/balance/i.test(serialised), `${code} leaked a balance-shaped field`);
    assert.ok(!/5000|threshold/i.test(serialised), `${code} leaked a threshold`);
  }
});

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures} failing test(s)`);
process.exit(failures === 0 ? 0 : 1);
