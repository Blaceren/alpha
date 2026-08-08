#!/usr/bin/env node
/**
 * OPS-3 Curriculum V2 flag-policy evaluator (read-only, no dependencies).
 * Extended by L4ID-1 to police EVERY Pocket capability flag, not just one.
 *
 * Usage: <flag lines on stdin> | node flag-policy-eval.js <policy.json>
 * Stdin: KEY=VALUE lines (env-style). Later assignments override earlier ones
 * (effective value), matching how the process env resolves base + override.
 *
 * Boolean semantics mirror Backend src/lib/env.ts: a flag is enabled only when
 * its value is exactly "true"; the env schema accepts only "true" | "false" |
 * absent, so any other value is malformed and fails (never normalized to an
 * authorized state). Exit 0 = policy satisfied, 1 = violation. Prints only flag
 * names and boolean policy state — never raw environment values or secrets.
 *
 * L4DSP-1 — WHY THE CHECKPOINT PROVIDER MODE IS NOW POLICED
 * The explicit CHECKPOINT_PROVIDER_MODE contract makes provider selection a
 * declaration rather than an accident of which variables are set. That is only
 * an operational control if the gates can see it, so schema/3 adds a
 * `checkpoint_provider` section covering four things the environment file could
 * otherwise carry silently:
 *
 *   1. an unknown mode (a typo that fails closed in Backend but should never
 *      have reached a deployment at all);
 *   2. a mode that is valid but not authorized for THIS deployment — naming the
 *      DEV simulator or the official Pocket adapter in an inactive runtime;
 *   3. dev_simulator without ATA_ENVIRONMENT=dev, or a simulator state path on a
 *      runtime that is not classified dev;
 *   4. pocket_partner selected with the capability flag on but no Partner API
 *      configuration — a provider chosen that cannot answer.
 *
 * The section is OPTIONAL. A schema/2 policy omitting it evaluates exactly as
 * before, so the policy file and this evaluator can be rolled back or forward
 * independently — the same property L4ID-1 preserved for the Pocket section.
 *
 * PRODUCT-RC-1 — SCHEMA/5: DECLARED POCKET SETTINGS WITH DECLARED VALUES
 * AFD-4 introduces two POCKET_-prefixed keys that schema/4 cannot express:
 *
 *   POCKET_FIRST_DEPOSIT_ENABLED — a capability (it admits goal=dep ingestion);
 *   POCKET_DEPOSIT_CURRENCY      — a setting whose VALUE decides what money is
 *                                  recorded as.
 *
 * Under schema/4 both were undeclared, so writing either — even the honest
 * `POCKET_FIRST_DEPOSIT_ENABLED=false` — failed `unknown-pocket-flag`. An
 * operator could therefore not state, in the environment file, that first
 * deposit is off. Silence was the only legal way to say it, which is precisely
 * the state an audit cannot distinguish from having forgotten.
 *
 * Schema/5 adds three things, all optional, so a schema/4 policy still evaluates
 * exactly as before and the policy file and this evaluator remain independently
 * rollable — the property L4ID-1 and L4DSP-1 each preserved in turn:
 *
 *   1. `pocket_required_disabled_keys` — per-key "must be absent or exactly
 *      false", so a profile can enable some capabilities and forbid others.
 *      `pocket_required_disabled: true` (all of them) still works.
 *
 *   2. `pocket_disabled_must_be_explicit` — keys for which absence is NOT
 *      sufficient: the file must literally say `false`. This is how a profile
 *      demands that a dangerous capability be denied on the record rather than
 *      merely not mentioned.
 *
 *   3. `pocket_enumerated_settings` — a non-capability setting may declare the
 *      exact values it accepts, and may declare that it is meaningless unless a
 *      named capability flag is enabled. A currency is not a grant of power, but
 *      a currency sitting beside a disabled first-deposit flag is dead
 *      configuration an operator will read as "deposits are configured", and an
 *      unrecognised currency must never reach money-recording code at all.
 *
 * PHASE-G0 — SCHEMA/6 ADDS ONE OPTIONAL FIELD: `optional_explicit_boolean`.
 *
 * WHY IT WAS NEEDED. Before it, a CURRICULUM_V2_ key had exactly two possible
 * declarations: `required_true` or `required_false_or_absent`. There was no way
 * to say "this environment MAY turn this on, deliberately, and must say so
 * explicitly either way" — which is precisely the state
 * CURRICULUM_V2_ADMIN_ENABLED needs for the staff Authoring Studio. Leaving it
 * in `required_false_or_absent` meant activating the studio required editing the
 * policy at the same moment as the environment, so the policy could never be the
 * thing that authorised the change.
 *
 * WHAT IT DOES AND DOES NOT RELAX. A key listed here is KNOWN (so the
 * fail-closed `unknown-flag` rule is fully preserved for every other
 * CURRICULUM_V2_ key) and must still be exactly `true` or `false` when present
 * (so a typo is still a violation). What it drops is only the POLARITY
 * requirement. Absence remains legal and remains the default posture: a
 * deployment that says nothing has the studio off, because
 * `isCurriculumV2AdminEnabled()` requires the literal string "true".
 *
 * IT GRANTS NOTHING BY ITSELF. Listing a key here does not set it. Live preprod
 * remains absent, and the authoring API stays 404 until an operator explicitly
 * writes `true` in a later, separate activation phase.
 *
 * Backward compatible in both directions, like every schema addition before it:
 * absent from a schema/5 policy it defaults to the empty list, and this
 * evaluator scores a schema/4 or schema/5 policy byte-identically to before.
 *
 * L4ID-1 — WHY THE POCKET SIDE IS NOW PREFIX-POLICED
 * Before this change exactly one Pocket key (POCKET_POSTBACK_ENABLED) was
 * known, and CURRICULUM_V2_ was the only prefix whose unknown members failed.
 * POCKET_BALANCE_PROVIDER_ENABLED therefore sat outside the policy entirely: it
 * could have been set to "true" in a runtime env without failing any gate.
 * Now every POCKET_-prefixed key must be declared — either as a capability flag
 * (must be absent or exactly false) or as a non-capability setting (a URL, not a
 * grant of power). Anything else is a violation, so production provider
 * configuration cannot appear in DEV unnoticed.
 */
"use strict";
const fs = require("fs");

const policyPath = process.argv[2];
if (!policyPath) { console.error("FAIL — no policy path"); process.exit(1); }
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const ENABLED = policy.enabled_value;                 // "true"
const VALID = new Set(policy.valid_boolean_values);   // {"false","true"}
const REQ_TRUE = policy.required_true;
const REQ_FALSE = policy.required_false_or_absent;
// PHASE-G0 — schema/6, optional and defaulting to the schema/5 behaviour.
// Known, boolean-checked, but with NO polarity requirement.
const OPTIONAL_EXPLICIT = policy.optional_explicit_boolean || [];
const KNOWN = new Set([...REQ_TRUE, ...REQ_FALSE, ...OPTIONAL_EXPLICIT]);
const PREFIX = policy.forbid_unknown_prefix;          // "CURRICULUM_V2_"

// Backward compatible: a schema/1 policy declaring only `pocket_flag` still
// evaluates exactly as before, so this evaluator can be rolled back or rolled
// forward independently of the policy file.
const POCKET_FLAGS = Array.isArray(policy.pocket_flags) && policy.pocket_flags.length
  ? policy.pocket_flags
  : (policy.pocket_flag ? [policy.pocket_flag] : []);
const POCKET_SET = new Set(POCKET_FLAGS);
const POCKET_PREFIX = policy.forbid_unknown_pocket_prefix || null;  // "POCKET_"
const POCKET_NON_CAPABILITY = new Set(policy.pocket_known_non_capability || []);

// PRODUCT-RC-1 — schema/5. All three are optional and default to the schema/4
// behaviour, so an older policy file evaluates identically under this binary.
const POCKET_REQUIRED_DISABLED_KEYS = policy.pocket_required_disabled_keys || [];
const POCKET_DISABLED_MUST_BE_EXPLICIT = new Set(policy.pocket_disabled_must_be_explicit || []);
const POCKET_ENUMERATED = policy.pocket_enumerated_settings || {};

// L4DSP-1 — optional checkpoint provider-selection section (schema/3).
const CP = policy.checkpoint_provider || null;
const CP_PREFIX = CP && CP.forbid_unknown_checkpoint_prefix ? CP.forbid_unknown_checkpoint_prefix : null;

/** True when this key is in scope for the policy at all. */
function inScope(key) {
  if (key.startsWith(PREFIX)) return true;
  if (POCKET_SET.has(key)) return true;
  if (POCKET_PREFIX && key.startsWith(POCKET_PREFIX)) return true;
  if (CP) {
    if (key === CP.mode_key || key === CP.environment_key) return true;
    if (key === CP.dev_simulator_state_path_key) return true;
    if (CP_PREFIX && key.startsWith(CP_PREFIX)) return true;
  }
  return false;
}

// PHASE-G0 — a key may not carry two contradictory declarations. Without this,
// listing a key in both `required_false_or_absent` and `optional_explicit_boolean`
// would silently keep the stricter rule, and an operator reading the policy
// would believe the key was theirs to set.
for (const key of OPTIONAL_EXPLICIT) {
  if (REQ_TRUE.includes(key) || REQ_FALSE.includes(key)) {
    console.error(`FAIL — configuration: ${key} is declared both as optional_explicit_boolean and with a required polarity`);
    process.exit(1);
  }
}

const input = fs.readFileSync(0, "utf8");
const effective = new Map();
for (const raw of input.split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  const key = line.slice(0, eq);
  if (inScope(key)) effective.set(key, line.slice(eq + 1)); // later wins
}

const fail = [];
// 1) every present CURRICULUM_V2_ key: known + valid boolean + correct polarity
for (const [key, value] of effective) {
  if (POCKET_SET.has(key)) continue;
  if (!key.startsWith(PREFIX)) continue;
  if (!KNOWN.has(key)) { fail.push(`unknown-flag ${key}: not in the verified source inventory`); continue; }
  if (!VALID.has(value)) { fail.push(`malformed-boolean ${key}: value is not exactly true|false`); continue; }
  if (REQ_TRUE.includes(key) && value !== ENABLED) fail.push(`required-read-not-enabled ${key}: expected true`);
  if (REQ_FALSE.includes(key) && value === ENABLED) fail.push(`write-flag-enabled ${key}: must be false or absent`);
}
// 2) every required-true flag must be present and enabled
for (const key of REQ_TRUE) {
  if (!effective.has(key)) fail.push(`required-read-missing ${key}: expected true, absent`);
}
// 3b) DEVACT-1 — flags this profile requires ENABLED (the active DEV state).
const POCKET_REQUIRED_ENABLED = policy.pocket_required_enabled || [];
for (const key of POCKET_REQUIRED_ENABLED) {
  if (!effective.has(key)) { fail.push(`pocket-required-missing ${key}: expected ${ENABLED}`); continue; }
  const v = effective.get(key);
  if (!VALID.has(v)) fail.push(`malformed-boolean ${key}: value is not exactly true|false`);
  else if (v !== ENABLED) fail.push(`pocket-required-disabled ${key}: expected ${ENABLED}`);
}
// 3) every Pocket CAPABILITY flag must be disabled (absent or exactly false)
if (policy.pocket_required_disabled) {
  for (const key of POCKET_FLAGS) {
    if (!effective.has(key)) continue;                 // absent is authorized
    const pv = effective.get(key);
    if (!VALID.has(pv)) fail.push(`malformed-boolean ${key}: value is not exactly true|false`);
    else if (pv === ENABLED) fail.push(`pocket-enabled ${key}: must be disabled`);
  }
}
// 3c) PRODUCT-RC-1 — per-key "must be disabled", so a profile can enable some
//     Pocket capabilities and forbid others. `pocket_required_disabled: true`
//     above still forbids ALL of them; this list is additive and independent.
for (const key of POCKET_REQUIRED_DISABLED_KEYS) {
  if (!effective.has(key)) {
    // Absence is authorized UNLESS this profile insists the denial be on the
    // record. A capability nobody wrote down is indistinguishable from one
    // nobody remembered.
    if (POCKET_DISABLED_MUST_BE_EXPLICIT.has(key)) {
      fail.push(`pocket-disabled-not-declared ${key}: this profile requires an explicit false`);
    }
    continue;
  }
  const value = effective.get(key);
  if (!VALID.has(value)) fail.push(`malformed-boolean ${key}: value is not exactly true|false`);
  else if (value === ENABLED) fail.push(`pocket-enabled ${key}: must be disabled`);
}

// 4) no undeclared POCKET_ key may exist. A capability we have not reviewed, or
//    a production credential/endpoint, must never arrive silently.
if (POCKET_PREFIX) {
  for (const key of effective.keys()) {
    if (!key.startsWith(POCKET_PREFIX)) continue;
    if (POCKET_SET.has(key) || POCKET_NON_CAPABILITY.has(key)) continue;
    fail.push(`unknown-pocket-flag ${key}: not a declared Pocket capability or setting`);
  }
}

// 4b) PRODUCT-RC-1 — declared settings must carry a declared VALUE, and must
//     not sit beside a capability that is off.
//
//     Allowlisting a key without constraining its value is how
//     POCKET_DEPOSIT_CURRENCY could have arrived as "ETH", or as "usd", and
//     reached the code that stamps a currency onto recorded money. And a
//     currency next to a disabled first-deposit flag is dead configuration that
//     reads, to an operator scanning the file, as "deposits are configured".
for (const [key, rule] of Object.entries(POCKET_ENUMERATED)) {
  if (!effective.has(key)) {
    if (rule.required_present) {
      fail.push(`pocket-setting-missing ${key}: required by this deployment`);
    }
    continue;
  }

  const value = effective.get(key);
  if (Array.isArray(rule.valid_values) && !rule.valid_values.includes(value)) {
    // The VALUE is not printed: an unrecognised setting may be a typo, but it
    // may equally be a production endpoint or an identifier, and this evaluator
    // never echoes environment values.
    fail.push(`pocket-setting-invalid ${key}: value is not one of ${rule.valid_values.join("|")}`);
  }

  if (rule.requires_enabled_flag) {
    const gate = rule.requires_enabled_flag;
    if (effective.get(gate) !== ENABLED) {
      fail.push(`pocket-setting-without-capability ${key}: meaningless unless ${gate}=${ENABLED}`);
    }
  }
}

// 5) L4DSP-1 — the checkpoint provider-selection contract.
let cpMode = "absent";
let cpEnvironment = "absent";
if (CP) {
  cpMode = effective.has(CP.mode_key) ? effective.get(CP.mode_key) : "absent";
  cpEnvironment = effective.has(CP.environment_key) ? effective.get(CP.environment_key) : "absent";
  const providerEnabled = effective.get(CP.provider_capability_flag) === ENABLED;

  // 5a) the environment identity itself must be a legal token, and must match
  //     what this deployment is supposed to be when one is expected.
  if (cpEnvironment !== "absent" && !CP.valid_environments.includes(cpEnvironment)) {
    fail.push(`invalid-environment ${CP.environment_key}: not one of ${CP.valid_environments.join("|")}`);
  } else if (cpEnvironment === "absent" && CP.environment_required) {
    fail.push(`missing-environment ${CP.environment_key}: expected ${CP.expected_environment}`);
  } else if (cpEnvironment !== "absent" && CP.expected_environment && cpEnvironment !== CP.expected_environment) {
    fail.push(`unexpected-environment ${CP.environment_key}: expected ${CP.expected_environment}`);
  }

  // 5b) the mode must be a legal token, and one authorized for this deployment.
  if (cpMode !== "absent") {
    if (!CP.valid_modes.includes(cpMode)) {
      fail.push(`invalid-provider-mode ${CP.mode_key}: not one of ${CP.valid_modes.join("|")}`);
    } else if (!CP.allowed_modes_here.includes(cpMode)) {
      fail.push(`unauthorized-provider-mode ${CP.mode_key}: ${cpMode} is not authorized for this deployment`);
    }
  } else if (CP.mode_may_be_absent === false) {
    fail.push(`missing-provider-mode ${CP.mode_key}: a mode must be declared`);
  }

  // 5c) the DEV simulator is legal only on a deployment classified dev.
  //     Whether the provider flag may be ON depends on the profile: an INACTIVE
  //     deployment forbids it, an ACTIVE one requires it.
  if (cpMode === CP.dev_simulator_mode) {
    if (cpEnvironment !== CP.dev_simulator_requires_environment) {
      fail.push(`dev-simulator-outside-dev ${CP.mode_key}: requires ${CP.environment_key}=${CP.dev_simulator_requires_environment}`);
    }
    if (CP.provider_flag_required_true_with_dev_simulator) {
      if (!providerEnabled) fail.push(`dev-simulator-provider-off ${CP.provider_capability_flag}: dev_simulator requires the provider capability enabled`);
    } else if (providerEnabled) {
      fail.push(`dev-simulator-active ${CP.mode_key}: the provider capability flag is enabled`);
    }
  }

  // 5c2) CHECKPOINT may only be on when a provider can actually answer.
  if (CP.checkpoint_requires_provider && CP.checkpoint_flag_key) {
    const checkpointOn = effective.get(CP.checkpoint_flag_key) === ENABLED;
    if (checkpointOn && !providerEnabled) {
      fail.push(`checkpoint-without-provider ${CP.checkpoint_flag_key}: requires ${CP.provider_capability_flag}=${ENABLED}`);
    }
    if (checkpointOn && cpMode === "absent") {
      fail.push(`checkpoint-without-mode ${CP.checkpoint_flag_key}: requires an explicit ${CP.mode_key}`);
    }
  }

  // 5d) a simulator state path is DEV-only, and absent in an inactive runtime.
  if (!effective.has(CP.dev_simulator_state_path_key) && CP.dev_simulator_state_path_required_present) {
    fail.push(`simulator-state-path-missing ${CP.dev_simulator_state_path_key}: required by this deployment`);
  }
  if (effective.has(CP.dev_simulator_state_path_key)) {
    if (CP.dev_simulator_state_path_required_absent) {
      fail.push(`simulator-state-path-present ${CP.dev_simulator_state_path_key}: must be absent in this deployment`);
    }
    if (cpEnvironment !== CP.dev_simulator_requires_environment) {
      fail.push(`simulator-state-path-outside-dev ${CP.dev_simulator_state_path_key}: requires ${CP.environment_key}=${CP.dev_simulator_requires_environment}`);
    }
  }

  // 5e) choosing the official adapter while the capability is on, without its
  //     configuration, is a provider that cannot answer.
  if (cpMode === CP.pocket_partner_mode && providerEnabled) {
    const missing = CP.pocket_partner_required_config.filter((k) => !effective.has(k));
    if (missing.length) {
      fail.push(`pocket-partner-unconfigured ${CP.mode_key}: missing ${missing.sort().join(",")}`);
    }
  }

  // 5f) no undeclared or forbidden CHECKPOINT_ key may exist.
  if (CP_PREFIX) {
    const known = new Set(CP.checkpoint_known_keys || []);
    const forbidden = new Set(CP.checkpoint_forbidden_keys || []);
    for (const key of effective.keys()) {
      if (!key.startsWith(CP_PREFIX)) continue;
      if (forbidden.has(key)) { fail.push(`forbidden-checkpoint-key ${key}: must never be set in this deployment`); continue; }
      if (!known.has(key)) fail.push(`unknown-checkpoint-key ${key}: not a declared checkpoint setting`);
    }
  }
}

const reqTrueOk = REQ_TRUE.filter((k) => effective.get(k) === ENABLED).length;
const writeAbsentOrFalse = REQ_FALSE.filter((k) => !effective.has(k) || effective.get(k) === "false").length;
const unknown = [...effective.keys()].filter((k) => k.startsWith(PREFIX) && !KNOWN.has(k)).length;
const pocketDisabled = POCKET_FLAGS.filter((k) => !effective.has(k) || effective.get(k) === "false").length;
const unknownPocket = POCKET_PREFIX
  ? [...effective.keys()].filter((k) => k.startsWith(POCKET_PREFIX) && !POCKET_SET.has(k) && !POCKET_NON_CAPABILITY.has(k)).length
  : 0;

// PRODUCT-RC-1 — report the schema/5 surface too, so an operator reading a
// PASS can see that the new keys were actually examined rather than skipped.
const forbiddenOk = POCKET_REQUIRED_DISABLED_KEYS.filter(
  (k) => !effective.has(k) || effective.get(k) === "false",
).length;
const enumeratedOk = Object.keys(POCKET_ENUMERATED).filter((k) => {
  const rule = POCKET_ENUMERATED[k];
  if (!effective.has(k)) return !rule.required_present;
  const valueOk = !Array.isArray(rule.valid_values) || rule.valid_values.includes(effective.get(k));
  const gateOk = !rule.requires_enabled_flag || effective.get(rule.requires_enabled_flag) === ENABLED;
  return valueOk && gateOk;
}).length;

if (fail.length === 0) {
  const cpSummary = CP
    ? `, checkpoint provider mode ${cpMode} (environment ${cpEnvironment}, simulator state path absent)`
    : "";
  const s5Summary =
    POCKET_REQUIRED_DISABLED_KEYS.length || Object.keys(POCKET_ENUMERATED).length
      ? `, Pocket ${forbiddenOk}/${POCKET_REQUIRED_DISABLED_KEYS.length} forbidden capabilities denied, ` +
        `${enumeratedOk}/${Object.keys(POCKET_ENUMERATED).length} declared settings valid`
      : "";
  console.log(
    `Curriculum V2 flags match read-only policy: ${reqTrueOk}/${REQ_TRUE.length} required read flags enabled, ` +
    `${writeAbsentOrFalse}/${REQ_FALSE.length} write flags disabled/absent, ${unknown} unknown flags, ` +
    `Pocket ${pocketDisabled}/${POCKET_FLAGS.length} capability flags disabled, ${unknownPocket} unknown Pocket keys` +
    s5Summary +
    cpSummary,
  );
  process.exit(0);
}
console.log(`Curriculum V2 flag policy violation (${fail.length}): ${fail.sort().join("; ")}`);
process.exit(1);
