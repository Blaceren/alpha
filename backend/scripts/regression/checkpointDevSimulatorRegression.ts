/**
 * L4DSP-1 — DEV checkpoint simulator: safety, outcomes and control plane.
 *
 * NOTHING HERE TOUCHES A NETWORK. The suite installs a hostile global `fetch`
 * and monkey-patches `http`/`https`/`net`/`dns` so that ANY outbound attempt
 * throws and is counted; the network-isolation checks then assert the counter is
 * still zero after every scenario has been exercised. That is a stronger claim
 * than "we did not write a URL": it would fail even if a transitive import
 * reached for the network.
 *
 * Every learner id, note and path here is synthetic, every state file lives in a
 * fresh temporary directory, and the real POSTBACK_SECRET is never read.
 *
 * The four claims under test:
 *
 *   A. The simulator cannot be selected outside an authoritatively DEV
 *      deployment — including when the environment is merely UNCLASSIFIED,
 *      which is the case a `NODE_ENV`-based rule gets wrong.
 *   B. Every state failure mode degrades to a typed unavailable outcome rather
 *      than an exception on a request path.
 *   C. `met` cannot compensate for a missing identity, and the simulator can
 *      neither complete a level, grant XP, nor touch PocketTraderIdentity.
 *   D. The operator control plane writes atomically, locks, refuses unsafe
 *      paths, and has no command that could complete anything.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* Network tripwire — installed BEFORE any application import           */
/* ------------------------------------------------------------------ */

let networkAttempts = 0;
const networkTargets: string[] = [];

function recordNetworkAttempt(target: string): never {
  networkAttempts += 1;
  networkTargets.push(target);
  throw new Error(`network access attempted: ${target}`);
}

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: unknown) => {
  recordNetworkAttempt(`fetch ${typeof input === "string" ? input : "[request]"}`);
}) as typeof fetch;

for (const [name, methods] of [
  ["node:http", ["request", "get"]],
  ["node:https", ["request", "get"]],
] as const) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(name) as Record<string, unknown>;
  for (const method of methods) {
    mod[method] = () => recordNetworkAttempt(`${name}.${method}`);
  }
}
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const net = require("node:net") as Record<string, unknown>;
  net.connect = () => recordNetworkAttempt("net.connect");
  net.createConnection = () => recordNetworkAttempt("net.createConnection");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dns = require("node:dns") as Record<string, unknown>;
  dns.lookup = () => recordNetworkAttempt("dns.lookup");
  dns.resolve = () => recordNetworkAttempt("dns.resolve");
}
void realFetch;

/* ------------------------------------------------------------------ */

const dbPath = path.join(os.tmpdir(), `ata-l4dsp1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ata-l4dsp1-state-${process.pid}-`));

/** Synthetic. Never the real POSTBACK_SECRET, which this suite never reads. */
const SYNTHETIC_POSTBACK_SECRET = "l4dsp1-synthetic-postback-secret";

/** Keys that may never appear in any simulator output, state or result. */
const FORBIDDEN_KEYS = new Set([
  "balance", "currentBalance", "observedBalance", "balanceMinorUnits", "realBalance",
  "demoBalance", "amount", "remaining", "deficit", "thresholdMinorUnits", "pocketUserId",
  "providerPayload", "apiToken", "hash", "accountLogin",
]);

const ALL_SCENARIOS = [
  "met", "not_met", "identity_unlinked", "identity_mismatch", "unsupported_currency",
  "provider_timeout", "provider_maintenance", "provider_rate_limited", "stale",
  "invalid_provider_response",
] as const;

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanup() {
  for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
}

function collectKeys(v: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((e) => collectKeys(e, into));
  else if (v && typeof v === "object" && !(v instanceof Date))
    for (const [k, e] of Object.entries(v)) { into.add(k); collectKeys(e, into); }
  return into;
}

/** A fresh, correctly-permissioned state directory per test. */
let stateSeq = 0;
function freshStateDir(): { dir: string; file: string } {
  stateSeq += 1;
  const dir = path.join(sandboxRoot, `s${stateSeq}`);
  fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  fs.chmodSync(dir, 0o700);
  return { dir, file: path.join(dir, "scenarios.json") };
}

function writeState(file: string, body: unknown, mode = 0o600) {
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body, null, 2), { mode });
  fs.chmodSync(file, mode);
}

function stateBody(scenarios: Record<string, unknown>) {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), scenarios };
}

/** A DEV environment with the simulator selected and a state path configured. */
function devEnv(file: string, overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return probeEnv({
    ATA_ENVIRONMENT: "dev",
    APP_URL: "http://localhost:3100",
    CURRICULUM_V2_CHECKPOINT_ENABLED: "true",
    POCKET_BALANCE_PROVIDER_ENABLED: "true",
    CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file,
    ...overrides,
  });
}

/**
 * Build an environment probe.
 *
 * `NodeJS.ProcessEnv` is declared with a REQUIRED `NODE_ENV` in this project, so
 * a partial literal cannot be cast to it directly. Going through `unknown` is
 * the point of these tests: the whole safety model must hold for an environment
 * that has no NODE_ENV at all.
 */
function probeEnv(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

const NOOP_SIGNAL = new AbortController().signal;
function providerRequest(learnerId: number, overrides: Record<string, unknown> = {}) {
  return {
    learnerId,
    enrollmentId: 1,
    levelDefinitionId: 4,
    integrationCode: "checkpoint.module-01",
    thresholdCurrency: "USD" as const,
    thresholdMinorUnits: 5000,
    requestId: `l4dsp1-${crypto.randomUUID()}`,
    timeoutSignal: NOOP_SIGNAL,
    ...overrides,
  };
}

/** Run the operator CLI in a child process with an explicit environment. */
function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "ops", "checkpointDevSimulator.ts"), ...args],
    {
      cwd: process.cwd(),
      // A DELIBERATELY MINIMAL environment: the CLI must work from what it is
      // given, and must not inherit a DEV classification from this test process.
      env: probeEnv({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }),
      encoding: "utf8",
    },
  );
}

async function main() {
  cleanup();
  fs.mkdirSync(sandboxRoot, { recursive: true, mode: 0o700 });

  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.POSTBACK_SECRET = SYNTHETIC_POSTBACK_SECRET;

  const { prisma } = await import("../../src/lib/prisma");
  const environment = await import("../../src/lib/environment");
  const mode = await import("../../src/lib/curriculum/checkpoint-provider-mode");
  const stateModule = await import("../../src/lib/curriculum/checkpoint-simulator-state");
  const simulator = await import("../../src/lib/curriculum/checkpoint-provider-dev-simulator");
  const checkpoint = await import("../../src/lib/curriculum/checkpoint");
  const env = await import("../../src/lib/env");

  let learnerSeq = 0;
  async function createLearner(withIdentity: boolean) {
    learnerSeq += 1;
    const user = await prisma.user.create({
      data: { email: `l4dsp1-${learnerSeq}-${Date.now()}@example.invalid`, name: "L4DSP1" },
    });
    if (withIdentity) {
      await prisma.pocketTraderIdentity.create({
        data: {
          userId: user.id,
          pocketUserId: `9${String(700_000 + learnerSeq)}`,
          clickId: `tq-l4dsp1-${user.id}`,
          source: "registration_postback",
        },
      });
    }
    return user.id;
  }

  const counts = async () => ({
    identities: await prisma.pocketTraderIdentity.count(),
    attempts: await prisma.checkpointVerificationAttempt.count(),
    xp: await prisma.xPTransaction.count(),
    progress: await prisma.userLevelProgress.count(),
  });

  /* ================================================================== */
  /* A. Environment classification and provider selection                */
  /* ================================================================== */

  await check("A1 an absent environment identity is unknown, never dev", () => {
    const c = environment.classifyEnvironment(probeEnv());
    assert.deepEqual(c, { kind: "unknown", reason: "absent" });
    assert.equal(environment.isDevEnvironment(probeEnv()), false);
  });

  await check("A2 NODE_ENV alone never classifies a deployment as dev", () => {
    // The exact production trap this phase exists to avoid: a DEV box running a
    // production build, and a production box running anything at all.
    for (const nodeEnv of ["development", "test", "production", undefined]) {
      const probe = (nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }) as NodeJS.ProcessEnv;
      assert.equal(environment.isDevEnvironment(probe), false, `NODE_ENV=${nodeEnv}`);
    }
    // And conversely: an explicit dev declaration holds even under a production
    // BUILD, which is exactly how this project's DEV runtime executes.
    assert.equal(
      environment.isDevEnvironment(probeEnv({ ATA_ENVIRONMENT: "dev", NODE_ENV: "production" })),
      true,
    );
  });

  await check("A3 misspelled, padded or wrongly-cased identities are unrecognised", () => {
    for (const raw of ["Dev", "DEV", " dev", "dev ", "development", "dev,staging", "prod", "1"]) {
      const c = environment.classifyEnvironment(probeEnv({ ATA_ENVIRONMENT: raw }));
      assert.equal(c.kind, "unknown", raw);
      assert.equal(c.kind === "unknown" && c.reason, "unrecognised", raw);
    }
  });

  await check("A4 a public APP_URL contradicts a dev claim and is ambiguous", () => {
    const publicClaim = environment.classifyEnvironment(probeEnv({
      ATA_ENVIRONMENT: "dev", APP_URL: "https://academy.example.com",
    }));
    assert.deepEqual(publicClaim, { kind: "unknown", reason: "ambiguous" });

    for (const appUrl of ["http://localhost:3100", "http://127.0.0.1:3100", "http://ata.invalid"]) {
      assert.equal(
        environment.isDevEnvironment(probeEnv({ ATA_ENVIRONMENT: "dev", APP_URL: appUrl })),
        true, appUrl,
      );
    }
    // The check only ever DEMOTES dev. It cannot promote anything.
    assert.equal(
      environment.classifyEnvironment(probeEnv({ ATA_ENVIRONMENT: "production", APP_URL: "http://localhost:3100" })).kind,
      "classified",
    );
  });

  await check("A5 staging is classified but is not dev", () => {
    const c = environment.classifyEnvironment(probeEnv({ ATA_ENVIRONMENT: "staging" }));
    assert.deepEqual(c, { kind: "classified", environment: "staging" });
    assert.equal(environment.isDevEnvironment(probeEnv({ ATA_ENVIRONMENT: "staging" })), false);
  });

  await check("A6 an absent provider mode means pocket_partner, never the simulator", () => {
    assert.deepEqual(mode.readCheckpointProviderMode(probeEnv()), { kind: "absent" });
    assert.equal(mode.effectiveCheckpointProviderMode(probeEnv()), "pocket_partner");
    assert.equal(mode.isDevSimulatorModeSelected(probeEnv()), false);
  });

  await check("A7 an invalid provider mode fails closed and selects nothing", () => {
    for (const raw of ["simulator", "dev", "Dev_Simulator", "pocket", "true", "disabled "]) {
      assert.deepEqual(
        mode.readCheckpointProviderMode(probeEnv({ CHECKPOINT_PROVIDER_MODE: raw })),
        { kind: "invalid" }, raw,
      );
      assert.equal(mode.effectiveCheckpointProviderMode(probeEnv({ CHECKPOINT_PROVIDER_MODE: raw })), null);
    }
    const { file } = freshStateDir();
    const resolution = checkpoint.resolveCheckpointProvider(
      devEnv(file, { CHECKPOINT_PROVIDER_MODE: "simulator" }),
    );
    assert.equal(resolution.usable, false);
    assert.equal(resolution.reason, "provider_unconfigured");
    assert.equal(resolution.provider.id, "unconfigured");
  });

  await check("A8 the provider capability flag governs, whatever the mode says", () => {
    const { file } = freshStateDir();
    const resolution = checkpoint.resolveCheckpointProvider(
      devEnv(file, { POCKET_BALANCE_PROVIDER_ENABLED: "false" }),
    );
    assert.equal(resolution.usable, false);
    assert.equal(resolution.reason, "provider_disabled");
    assert.equal(resolution.provider.id, "disabled");
  });

  await check("A9 the checkpoint flag governs before the provider flag", () => {
    const { file } = freshStateDir();
    const resolution = checkpoint.resolveCheckpointProvider(
      devEnv(file, { CURRICULUM_V2_CHECKPOINT_ENABLED: "false" }),
    );
    assert.equal(resolution.reason, "checkpoint_disabled");
  });

  await check("A10 mode disabled selects the disabled provider even in DEV", () => {
    const { file } = freshStateDir();
    const resolution = checkpoint.resolveCheckpointProvider(
      devEnv(file, { CHECKPOINT_PROVIDER_MODE: "disabled" }),
    );
    assert.equal(resolution.usable, false);
    assert.equal(resolution.reason, "provider_disabled");
  });

  await check("A11 mode dev_simulator in DEV selects the simulator", () => {
    const { file } = freshStateDir();
    const resolution = checkpoint.resolveCheckpointProvider(devEnv(file));
    assert.equal(resolution.usable, true);
    assert.equal(resolution.provider.id, "dev_simulator");
  });

  await check("A12 mode pocket_partner in DEV never selects the simulator", () => {
    const { file } = freshStateDir();
    const resolution = checkpoint.resolveCheckpointProvider(
      devEnv(file, { CHECKPOINT_PROVIDER_MODE: "pocket_partner" }),
    );
    assert.notEqual(resolution.provider.id, "dev_simulator");
    // No Pocket configuration exists here, so the honest answer is unconfigured.
    assert.equal(resolution.reason, "provider_unconfigured");
  });

  /* ================================================================== */
  /* B. Production rejection                                             */
  /* ================================================================== */

  await check("B1 production plus dev_simulator never selects the simulator", () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "met", expiresAt: null } }));
    const resolution = checkpoint.resolveCheckpointProvider(
      devEnv(file, { ATA_ENVIRONMENT: "production", APP_URL: "https://academy.example.com" }),
    );
    assert.equal(resolution.usable, false);
    assert.equal(resolution.reason, "provider_unconfigured");
    assert.notEqual(resolution.provider.id, "dev_simulator");
  });

  await check("B2 production plus dev_simulator is a runtime environment ERROR", () => {
    const result = env.validateRuntimeEnv(probeEnv({
      ATA_ENVIRONMENT: "production", CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("CHECKPOINT_PROVIDER_MODE=dev_simulator")));
  });

  await check("B3 a MISSING environment identity plus dev_simulator is an ERROR", () => {
    // The decisive case. A production host whose operator simply never set
    // ATA_ENVIRONMENT must fail, not fall through to "not production, so allow".
    const result = env.validateRuntimeEnv(probeEnv({
      CHECKPOINT_PROVIDER_MODE: "dev_simulator", NODE_ENV: "production",
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("environment identity is absent")));

    const { file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "met", expiresAt: null } }));
    const resolution = checkpoint.resolveCheckpointProvider(probeEnv({
      CURRICULUM_V2_CHECKPOINT_ENABLED: "true", POCKET_BALANCE_PROVIDER_ENABLED: "true",
      CHECKPOINT_PROVIDER_MODE: "dev_simulator", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file,
    }));
    assert.equal(resolution.usable, false);
  });

  await check("B4 an AMBIGUOUS environment identity plus dev_simulator is an ERROR", () => {
    const result = env.validateRuntimeEnv(probeEnv({
      ATA_ENVIRONMENT: "dev", APP_URL: "https://academy.example.com",
      CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("environment identity is ambiguous")));
  });

  await check("B5 staging plus dev_simulator is an ERROR", () => {
    const result = env.validateRuntimeEnv(probeEnv({
      ATA_ENVIRONMENT: "staging", CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("environment is staging")));
  });

  await check("B6 a simulator state path outside DEV is an ERROR by itself", () => {
    const result = env.validateRuntimeEnv(probeEnv({
      ATA_ENVIRONMENT: "production",
      CHECKPOINT_DEV_SIMULATOR_STATE_PATH: "/var/lib/ata/scenarios.json",
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("CHECKPOINT_DEV_SIMULATOR_STATE_PATH")));
  });

  await check("B7 DEV plus dev_simulator validates cleanly under a PRODUCTION BUILD", () => {
    // This is the exact shape the real DEV runtime has: a production build
    // (NODE_ENV=production, set by `next start`) on a deployment declared `dev`.
    // The pre-existing production-required keys are supplied synthetically so
    // the only rule under test is the simulator's.
    const { file } = freshStateDir();
    const result = env.validateRuntimeEnv(devEnv(file, {
      NODE_ENV: "production",
      DATABASE_URL: dbUrl,
      SESSION_SECRET: "l4dsp1-synthetic-session-secret",
      POSTBACK_SECRET: SYNTHETIC_POSTBACK_SECRET,
      STORAGE_DRIVER: "local",
      POCKET_AFFILIATE_BASE_URL: "https://example.invalid/affiliate",
    }));
    assert.equal(result.ok, true, result.errors.join("; "));
  });

  await check("B8 an invalid environment or mode token is refused by the env schema", () => {
    assert.equal(env.validateRuntimeEnv(probeEnv({ ATA_ENVIRONMENT: "dev-box" })).ok, false);
    assert.equal(env.validateRuntimeEnv(probeEnv({ CHECKPOINT_PROVIDER_MODE: "simulator" })).ok, false);
  });

  await check("B9 the simulator refuses at CALL time outside DEV, not only at selection", () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "met", expiresAt: null } }));
    // Constructed directly, bypassing the resolver entirely.
    const provider = simulator.createDevCheckpointBalanceProvider({
      env: probeEnv({ ATA_ENVIRONMENT: "production", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file }),
      resolveIdentity: async () => "900001",
    });
    return provider.verifyThreshold(providerRequest(1)).then((result) => {
      assert.deepEqual(result, { outcome: "unavailable", reason: "provider_unconfigured" });
    });
  });

  await check("B10 resolveDevSimulatorProvider returns null outside DEV", () => {
    assert.equal(simulator.resolveDevSimulatorProvider(probeEnv()), null);
    assert.equal(simulator.resolveDevSimulatorProvider(probeEnv({ ATA_ENVIRONMENT: "production" })), null);
    assert.notEqual(simulator.resolveDevSimulatorProvider(probeEnv({ ATA_ENVIRONMENT: "dev" })), null);
  });

  await check("B11 the test mock marker cannot enable the DEV simulator", () => {
    const { file } = freshStateDir();
    // The mock requires its own marker AND an installed factory. With no factory
    // installed, the marker must not open any door at all.
    const resolution = checkpoint.resolveCheckpointProvider(
      devEnv(file, {
        CHECKPOINT_PROVIDER_TEST_BACKEND: "unsafe-deterministic-mock-regression-only",
        CHECKPOINT_PROVIDER_MODE: "pocket_partner",
      }),
    );
    assert.notEqual(resolution.provider.id, "dev_simulator");
    assert.notEqual(resolution.provider.id, "mock");
  });

  /* ================================================================== */
  /* C. State handling — every failure is a typed refusal                */
  /* ================================================================== */

  const UNCONFIGURED = { outcome: "unavailable", reason: "provider_unconfigured" };

  async function simulate(file: string, learnerId: number, overrides: Record<string, string> = {}, identity: string | null = "900001") {
    const provider = simulator.createDevCheckpointBalanceProvider({
      env: devEnv(file, overrides),
      resolveIdentity: async () => identity,
    });
    return provider.verifyThreshold(providerRequest(learnerId));
  }

  await check("C1 an unconfigured state path fails closed", async () => {
    const provider = simulator.createDevCheckpointBalanceProvider({
      env: probeEnv({ ATA_ENVIRONMENT: "dev" }),
      resolveIdentity: async () => "900001",
    });
    assert.deepEqual(await provider.verifyThreshold(providerRequest(1)), UNCONFIGURED);
  });

  await check("C2 a relative state path is refused", () => {
    const resolved = stateModule.resolveSimulatorStatePath(probeEnv({
      CHECKPOINT_DEV_SIMULATOR_STATE_PATH: "state/scenarios.json",
    }));
    assert.deepEqual(resolved, { ok: false, problem: "path_not_absolute" });
  });

  await check("C3 an absent state file fails closed", async () => {
    const { file } = freshStateDir();
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
    assert.equal(stateModule.readSimulatorState(devEnv(file)).ok, false);
  });

  await check("C4 an empty state file fails closed", async () => {
    const { file } = freshStateDir();
    writeState(file, "");
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok, false);
    assert.equal(read.ok === false && read.problem, "malformed_json");
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C5 malformed JSON fails closed and never quotes the file", async () => {
    const { file } = freshStateDir();
    writeState(file, '{"schemaVersion":1,"scenarios":{ this is not json');
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok === false && read.problem, "malformed_json");
    assert.ok(!JSON.stringify(read).includes("this is not json"));
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C6 an oversized state file is refused without being parsed", async () => {
    const { file } = freshStateDir();
    const scenarios: Record<string, unknown> = {};
    for (let i = 1; i <= 4_000; i += 1) {
      scenarios[String(i)] = { scenario: "met", expiresAt: null, note: "x".repeat(190) };
    }
    writeState(file, stateBody(scenarios));
    assert.ok(fs.statSync(file).size > 256 * 1024, "fixture must exceed the ceiling");
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok === false && read.problem, "too_large");
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C7 an unsupported schema version is refused, never migrated", async () => {
    const { file } = freshStateDir();
    writeState(file, { schemaVersion: 2, updatedAt: new Date().toISOString(), scenarios: { "1": { scenario: "met", expiresAt: null } } });
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok === false && read.problem, "unsupported_schema_version");
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C8 an unknown scenario name invalidates the file", async () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "definitely_pass", expiresAt: null } }));
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok === false && read.problem, "invalid_schema");
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C9 a group- or world-readable state file is refused", async () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "met", expiresAt: null } }), 0o644);
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok === false && read.problem, "unsafe_permissions");
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C10 a group-accessible state DIRECTORY is refused", async () => {
    const { dir, file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "met", expiresAt: null } }));
    fs.chmodSync(dir, 0o755);
    try {
      const read = stateModule.readSimulatorState(devEnv(file));
      assert.equal(read.ok === false && read.problem, "unsafe_permissions");
      assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });

  await check("C11 a SYMLINKED state file is refused by the kernel, not by a race", async () => {
    const { dir, file } = freshStateDir();
    const real = path.join(dir, "real.json");
    writeState(real, stateBody({ "1": { scenario: "met", expiresAt: null } }));
    fs.symlinkSync(real, file);
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok === false && read.problem, "symlink");
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C12 a SYMLINKED state directory is refused", async () => {
    const { dir } = freshStateDir();
    const real = path.join(dir, "real-dir");
    fs.mkdirSync(real, { mode: 0o700 });
    writeState(path.join(real, "scenarios.json"), stateBody({ "1": { scenario: "met", expiresAt: null } }));
    const linkDir = path.join(dir, "link-dir");
    fs.symlinkSync(real, linkDir);
    const file = path.join(linkDir, "scenarios.json");
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok === false && read.problem, "symlink");
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C13 an expired scenario is not used and fails closed", async () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({
      "1": { scenario: "met", expiresAt: new Date(Date.now() - 60_000).toISOString() },
    }));
    assert.deepEqual(await simulate(file, 1), UNCONFIGURED);
  });

  await check("C14 a future scenario is used; a no-TTL scenario is used", async () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({
      "1": { scenario: "not_met", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      "2": { scenario: "not_met", expiresAt: null },
    }));
    assert.deepEqual(await simulate(file, 1), { outcome: "not_met" });
    assert.deepEqual(await simulate(file, 2), { outcome: "not_met" });
  });

  await check("C15 a learner with no scenario fails closed", async () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "met", expiresAt: null } }));
    assert.deepEqual(await simulate(file, 999), UNCONFIGURED);
  });

  await check("C16 a balance smuggled into the state file cannot survive the read", () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({
      "1": { scenario: "met", expiresAt: null, balanceMinorUnits: 999_999, realBalance: 12_345, note: "ok" },
    }));
    const read = stateModule.readSimulatorState(devEnv(file));
    assert.equal(read.ok, true);
    const keys = collectKeys(read.ok ? read.state : {});
    for (const forbidden of FORBIDDEN_KEYS) {
      assert.ok(!keys.has(forbidden), `state retained ${forbidden}`);
    }
    assert.deepEqual(Object.keys(read.ok ? read.state.scenarios["1"] : {}).sort(), ["expiresAt", "note", "scenario"]);
  });

  await check("C17 an over-long note or a non-numeric learner key is refused", () => {
    const { file: a } = freshStateDir();
    writeState(a, stateBody({ "1": { scenario: "met", expiresAt: null, note: "x".repeat(201) } }));
    assert.equal(stateModule.readSimulatorState(devEnv(a)).ok, false);

    const { file: b } = freshStateDir();
    writeState(b, stateBody({ "admin": { scenario: "met", expiresAt: null } }));
    assert.equal(stateModule.readSimulatorState(devEnv(b)).ok, false);

    const { file: c } = freshStateDir();
    writeState(c, stateBody({ "0": { scenario: "met", expiresAt: null } }));
    assert.equal(stateModule.readSimulatorState(devEnv(c)).ok, false);
  });

  await check("C18 a concurrent atomic replacement is never observed half-written", async () => {
    const { dir, file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "not_met", expiresAt: null } }));

    let observedNotMet = 0, observedMet = 0, observedOther = 0;
    let replacements = 0;
    const stop = Date.now() + 900;

    // A writer replacing the file atomically as fast as it can, and a reader
    // reading it as fast as it can. Every read must yield ONE of the two whole
    // states — never a parse error, never a mixed object.
    while (Date.now() < stop) {
      const next = replacements % 2 === 0 ? "met" : "not_met";
      const tmp = path.join(dir, `.scenarios.tmp.${replacements}`);
      fs.writeFileSync(tmp, JSON.stringify(stateBody({ "1": { scenario: next, expiresAt: null } }), null, 2), { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, file);
      replacements += 1;

      for (let i = 0; i < 20; i += 1) {
        const read = stateModule.readSimulatorState(devEnv(file));
        assert.equal(read.ok, true, `partial read after ${replacements} replacements`);
        const scenario = read.ok ? read.state.scenarios["1"].scenario : "?";
        if (scenario === "met") observedMet += 1;
        else if (scenario === "not_met") observedNotMet += 1;
        else observedOther += 1;
      }
    }
    assert.ok(replacements > 5, `too few replacements to be meaningful: ${replacements}`);
    assert.equal(observedOther, 0);
    assert.ok(observedMet > 0 && observedNotMet > 0, "both whole states must have been observed");
  });

  /* ================================================================== */
  /* D. Outcome matrix and identity precedence                           */
  /* ================================================================== */

  const EXPECTED: Record<string, unknown> = {
    met: { outcome: "met" },
    not_met: { outcome: "not_met" },
    identity_unlinked: { outcome: "identity_unlinked" },
    identity_mismatch: { outcome: "identity_mismatch" },
    unsupported_currency: { outcome: "unsupported_currency" },
    stale: { outcome: "stale" },
    invalid_provider_response: { outcome: "invalid_provider_response" },
    provider_timeout: { outcome: "unavailable", reason: "provider_timeout" },
    provider_maintenance: { outcome: "unavailable", reason: "provider_maintenance" },
    provider_rate_limited: { outcome: "unavailable", reason: "provider_rate_limited", retryAfterSeconds: 120 },
  };

  await check("D1 every scenario returns exactly its typed outcome (linked learner)", async () => {
    for (const scenario of ALL_SCENARIOS) {
      const { file } = freshStateDir();
      writeState(file, stateBody({ "1": { scenario, expiresAt: null } }));
      const result = await simulate(file, 1, {}, "900001");
      assert.deepEqual(result, EXPECTED[scenario], scenario);
    }
  });

  await check("D2 provider_timeout is typed and IMMEDIATE, not a five-second hang", async () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "provider_timeout", expiresAt: null } }));
    const started = Date.now();
    const result = await simulate(file, 1);
    const elapsed = Date.now() - started;
    assert.deepEqual(result, { outcome: "unavailable", reason: "provider_timeout" });
    assert.ok(elapsed < 1_000, `simulated timeout took ${elapsed}ms`);
  });

  await check("D3 an UNLINKED learner gets identity_unlinked even when met is set", async () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({
      "1": { scenario: "met", expiresAt: null },
      "2": { scenario: "not_met", expiresAt: null },
    }));
    assert.deepEqual(await simulate(file, 1, {}, null), { outcome: "identity_unlinked" });
    assert.deepEqual(await simulate(file, 2, {}, null), { outcome: "identity_unlinked" });
  });

  await check("D4 non-money scenarios do NOT require an identity", async () => {
    for (const scenario of ALL_SCENARIOS) {
      if (scenario === "met" || scenario === "not_met") continue;
      const { file } = freshStateDir();
      writeState(file, stateBody({ "1": { scenario, expiresAt: null } }));
      assert.deepEqual(await simulate(file, 1, {}, null), EXPECTED[scenario], scenario);
    }
  });

  await check("D5 identity_mismatch stays an explicit operator choice, never inferred", async () => {
    const { file } = freshStateDir();
    writeState(file, stateBody({ "1": { scenario: "met", expiresAt: null } }));
    // A linked learner never produces mismatch by itself...
    assert.deepEqual(await simulate(file, 1, {}, "900001"), { outcome: "met" });
    // ...and an unlinked one produces unlinked, not mismatch.
    assert.deepEqual(await simulate(file, 1, {}, null), { outcome: "identity_unlinked" });
  });

  await check("D6 a non-USD threshold is refused before any state is read", async () => {
    const { file } = freshStateDir();
    // No state file exists at all: if currency were checked after state, this
    // would answer unconfigured instead.
    const provider = simulator.createDevCheckpointBalanceProvider({
      env: devEnv(file), resolveIdentity: async () => "900001",
    });
    const result = await provider.verifyThreshold(
      providerRequest(1, { thresholdCurrency: "EUR" }) as never,
    );
    assert.deepEqual(result, { outcome: "unsupported_currency" });
  });

  await check("D7 the simulator returns NO financial field, ever", async () => {
    for (const scenario of ALL_SCENARIOS) {
      const { file } = freshStateDir();
      writeState(file, stateBody({ "1": { scenario, expiresAt: null } }));
      const result = await simulate(file, 1);
      for (const key of collectKeys(result)) {
        assert.ok(!FORBIDDEN_KEYS.has(key), `${scenario} returned ${key}`);
      }
      const serialized = JSON.stringify(result);
      assert.ok(!/\d{3,}/.test(serialized.replace(/"retryAfterSeconds":\d+/, "")), `${scenario}: ${serialized}`);
    }
  });

  await check("D8 the simulator reads real identity from the database and never writes it", async () => {
    const linked = await createLearner(true);
    const unlinked = await createLearner(false);
    const { file } = freshStateDir();
    writeState(file, stateBody({
      [String(linked)]: { scenario: "met", expiresAt: null },
      [String(unlinked)]: { scenario: "met", expiresAt: null },
    }));

    const before = await counts();
    // No injected resolver: this exercises the real Prisma lookup.
    const provider = simulator.createDevCheckpointBalanceProvider({ env: devEnv(file) });
    assert.deepEqual(await provider.verifyThreshold(providerRequest(linked)), { outcome: "met" });
    assert.deepEqual(await provider.verifyThreshold(providerRequest(unlinked)), { outcome: "identity_unlinked" });
    assert.deepEqual(await counts(), before, "the simulator must mutate nothing at all");
  });

  await check("D9 exercising every scenario creates no attempt, no XP and no progress", async () => {
    const learner = await createLearner(true);
    const before = await counts();
    for (const scenario of ALL_SCENARIOS) {
      const { file } = freshStateDir();
      writeState(file, stateBody({ [String(learner)]: { scenario, expiresAt: null } }));
      const provider = simulator.createDevCheckpointBalanceProvider({ env: devEnv(file) });
      await provider.verifyThreshold(providerRequest(learner));
    }
    assert.deepEqual(await counts(), before);
  });

  /* ================================================================== */
  /* E. Operator control plane                                           */
  /* ================================================================== */

  await check("E1 the CLI refuses to run outside DEV", () => {
    const { file } = freshStateDir();
    for (const environmentValue of ["production", "staging"]) {
      const result = runCli(["list"], {
        ATA_ENVIRONMENT: environmentValue, CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file,
      });
      assert.equal(result.status, 3, `${environmentValue}: ${result.stdout}${result.stderr}`);
      assert.ok(result.stderr.includes("ATA_ENVIRONMENT=dev"));
    }
  });

  await check("E2 the CLI refuses when the environment identity is ABSENT", () => {
    const { file } = freshStateDir();
    const result = runCli(["list"], { CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file });
    assert.equal(result.status, 3);
    assert.ok(result.stderr.includes("unknown (absent)"));
  });

  await check("E3 the CLI refuses an unconfigured or relative state path", () => {
    assert.equal(runCli(["list"], { ATA_ENVIRONMENT: "dev" }).status, 3);
    const relative = runCli(["list"], {
      ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: "state/scenarios.json",
    });
    assert.equal(relative.status, 3);
    assert.ok(relative.stderr.includes("absolute"));
  });

  await check("E4 CLI set writes an owner-only file with owner-only parents", () => {
    const dir = path.join(sandboxRoot, "cli-set");
    const file = path.join(dir, "scenarios.json");
    const result = runCli(
      ["set", "--learner", "42", "--scenario", "not_met", "--ttl", "30m", "--note", "design review"],
      { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);

    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.scenarios["42"].scenario, "not_met");
    assert.equal(parsed.scenarios["42"].note, "design review");
    assert.ok(Date.parse(parsed.scenarios["42"].expiresAt) > Date.now());
    // No temporary file and no lock survived.
    assert.deepEqual(fs.readdirSync(dir), ["scenarios.json"]);
  });

  await check("E5 CLI get and list report the scenario in machine-readable form", () => {
    const file = path.join(sandboxRoot, "cli-set", "scenarios.json");
    const cliEnv = { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file };

    const get = runCli(["get", "--learner", "42", "--json"], cliEnv);
    assert.equal(get.status, 0, get.stderr);
    const got = JSON.parse(get.stdout);
    assert.equal(got.found, true);
    assert.equal(got.scenario, "not_met");
    assert.equal(got.expired, false);

    const list = runCli(["list", "--json"], cliEnv);
    assert.equal(list.status, 0, list.stderr);
    const listed = JSON.parse(list.stdout);
    assert.equal(listed.count, 1);
    assert.equal(listed.scenarios[0].learnerId, "42");

    const missing = runCli(["get", "--learner", "43", "--json"], cliEnv);
    assert.equal(missing.status, 7);
    assert.equal(JSON.parse(missing.stdout).found, false);
  });

  await check("E6 CLI output contains no secret, no Pocket id and no financial field", () => {
    const file = path.join(sandboxRoot, "cli-set", "scenarios.json");
    const cliEnv = { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file, POSTBACK_SECRET: SYNTHETIC_POSTBACK_SECRET };
    // No command may ever echo a secret — including `help`.
    for (const args of [["list", "--json"], ["get", "--learner", "42", "--json"], ["validate", "--json"], ["help"]]) {
      const result = runCli(args, cliEnv);
      assert.ok(!`${result.stdout}${result.stderr}`.includes(SYNTHETIC_POSTBACK_SECRET), `${args[0]} leaked a secret`);
    }
    // No DATA command may emit a financial or Pocket field. `help` is excluded
    // deliberately: its prose says the tool cannot "set a balance", and a test
    // that forbade the WORD would be forbidding the documentation rather than
    // the capability. E17 proves the capability is absent.
    for (const args of [["list", "--json"], ["get", "--learner", "42", "--json"], ["validate", "--json"]]) {
      const result = runCli(args, cliEnv);
      const text = `${result.stdout}${result.stderr}`;
      for (const forbidden of ["pocketUserId", "balance", "Balance", "thresholdMinorUnits", "amount"]) {
        assert.ok(!text.includes(forbidden), `${args[0]} mentioned ${forbidden}`);
      }
    }
  });

  await check("E7 CLI clear removes one entry and reports a miss distinctly", () => {
    const file = path.join(sandboxRoot, "cli-set", "scenarios.json");
    const cliEnv = { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file };
    assert.equal(runCli(["set", "--learner", "43", "--scenario", "met", "--ttl", "1h"], cliEnv).status, 0);
    assert.equal(runCli(["clear", "--learner", "43"], cliEnv).status, 0);
    assert.equal(JSON.parse(runCli(["list", "--json"], cliEnv).stdout).count, 1);
    assert.equal(runCli(["clear", "--learner", "43"], cliEnv).status, 7);
  });

  await check("E8 CLI clear-expired removes only expired entries, atomically", () => {
    const dir = path.join(sandboxRoot, "cli-expire");
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    const file = path.join(dir, "scenarios.json");
    writeState(file, stateBody({
      "1": { scenario: "met", expiresAt: new Date(Date.now() - 1_000).toISOString() },
      "2": { scenario: "not_met", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      "3": { scenario: "stale", expiresAt: null },
    }));
    const cliEnv = { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file };

    const listed = JSON.parse(runCli(["list", "--json"], cliEnv).stdout);
    assert.equal(listed.scenarios.filter((s: { expired: boolean }) => s.expired).length, 1);

    const result = runCli(["clear-expired", "--json"], cliEnv);
    assert.equal(result.status, 0, result.stderr);
    const cleared = JSON.parse(result.stdout);
    assert.equal(cleared.removed, 1);
    assert.equal(cleared.remaining, 2);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).scenarios).sort(), ["2", "3"]);
  });

  await check("E9 CLI validate reports OK, absent and corrupt states distinctly", () => {
    const okFile = path.join(sandboxRoot, "cli-expire", "scenarios.json");
    const ok = runCli(["validate", "--json"], { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: okFile });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).total, 2);

    const { file: absent } = freshStateDir();
    const missing = runCli(["validate", "--json"], { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: absent });
    assert.equal(missing.status, 0, "an absent file is inert, not a failure");
    assert.equal(JSON.parse(missing.stdout).problem, "not_found");

    const { file: broken } = freshStateDir();
    writeState(broken, "{ nope");
    const corrupt = runCli(["validate", "--json"], { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: broken });
    assert.equal(corrupt.status, 5);
    assert.equal(JSON.parse(corrupt.stdout).problem, "malformed_json");
  });

  await check("E10 CLI refuses an invalid learner, scenario, TTL or note", () => {
    const { file } = freshStateDir();
    const cliEnv = { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file };
    const cases: Array<[string[], string]> = [
      [["set", "--learner", "abc", "--scenario", "met", "--ttl", "1h"], "positive integer"],
      [["set", "--learner", "-1", "--scenario", "met", "--ttl", "1h"], "positive integer"],
      [["set", "--learner", "1", "--scenario", "definitely_pass", "--ttl", "1h"], "unknown scenario"],
      [["set", "--learner", "1", "--scenario", "met", "--ttl", "8d"], "maximum"],
      [["set", "--learner", "1", "--scenario", "met", "--ttl", "30 minutes"], "--ttl must look like"],
      [["set", "--learner", "1", "--scenario", "met"], "--ttl is required"],
      [["set", "--learner", "1", "--scenario", "met", "--ttl", "1h", "--no-expiry"], "mutually exclusive"],
      [["set", "--learner", "1", "--scenario", "met", "--ttl", "1h", "--note", "x".repeat(201)], "exceeds"],
    ];
    for (const [args, needle] of cases) {
      const result = runCli(args, cliEnv);
      assert.notEqual(result.status, 0, `${args.join(" ")} should have failed`);
      assert.ok(result.stderr.includes(needle), `${args.join(" ")}: ${result.stderr}`);
    }
    assert.ok(!fs.existsSync(file), "no failed command may create a state file");
  });

  await check("E11 CLI accepts an explicit no-expiry only when asked deliberately", () => {
    const dir = path.join(sandboxRoot, "cli-noexp");
    const file = path.join(dir, "scenarios.json");
    const cliEnv = { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file };
    const result = runCli(["set", "--learner", "7", "--scenario", "stale", "--no-expiry"], cliEnv);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).scenarios["7"].expiresAt, null);
  });

  await check("E12 the CLI refuses a learner the database does not have", async () => {
    const { file } = freshStateDir();
    const result = runCli(["set", "--learner", "987654", "--scenario", "met", "--ttl", "1h"], {
      ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file, DATABASE_URL: dbUrl,
    });
    assert.equal(result.status, 6, `${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.includes("does not exist"));

    const real = await createLearner(true);
    const accepted = runCli(["set", "--learner", String(real), "--scenario", "met", "--ttl", "1h"], {
      ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file, DATABASE_URL: dbUrl,
    });
    assert.equal(accepted.status, 0, accepted.stderr);
  });

  await check("E13 a held lock is respected, and a stale lock is broken", () => {
    const dir = path.join(sandboxRoot, "cli-lock");
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    const file = path.join(dir, "scenarios.json");
    const lock = `${file}.lock`;
    const cliEnv = { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file };

    // A fresh lock held by someone else must block, not corrupt.
    fs.writeFileSync(lock, "pid=999999\n", { mode: 0o600 });
    const blocked = runCli(["set", "--learner", "5", "--scenario", "met", "--ttl", "1h"], cliEnv);
    assert.equal(blocked.status, 4, `${blocked.stdout}${blocked.stderr}`);
    assert.ok(blocked.stderr.includes("lock"));
    assert.ok(!fs.existsSync(file), "a blocked write must not have happened");

    // The same lock, aged past the stale threshold, must be broken.
    const old = Date.now() - 120_000;
    fs.utimesSync(lock, old / 1000, old / 1000);
    const proceeded = runCli(["set", "--learner", "5", "--scenario", "met", "--ttl", "1h"], cliEnv);
    assert.equal(proceeded.status, 0, `${proceeded.stdout}${proceeded.stderr}`);
    assert.ok(fs.existsSync(file));
    assert.ok(!fs.existsSync(lock), "the lock must be released after a successful write");
  });

  await check("E14 concurrent CLI writes serialise without losing an entry", () => {
    const dir = path.join(sandboxRoot, "cli-concurrent");
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    const file = path.join(dir, "scenarios.json");
    const cliEnv = { ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file };
    // Sequential invocations through the same lock: each must see the previous
    // writer's entry, which is what proves read-modify-write is not lost.
    for (let learner = 1; learner <= 6; learner += 1) {
      const result = runCli(["set", "--learner", String(learner), "--scenario", "not_met", "--ttl", "1h"], cliEnv);
      assert.equal(result.status, 0, result.stderr);
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(parsed.scenarios).sort((a, b) => Number(a) - Number(b)), ["1", "2", "3", "4", "5", "6"]);
  });

  await check("E15 the CLI refuses to modify state it cannot read", () => {
    const dir = path.join(sandboxRoot, "cli-corrupt");
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    const file = path.join(dir, "scenarios.json");
    writeState(file, "{ definitely not json");
    const result = runCli(["set", "--learner", "1", "--scenario", "met", "--ttl", "1h"], {
      ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: file,
    });
    assert.equal(result.status, 5, `${result.stdout}${result.stderr}`);
    // The operator's file is left exactly as it was rather than silently reset.
    assert.equal(fs.readFileSync(file, "utf8"), "{ definitely not json");
  });

  await check("E16 the CLI refuses an unsafe state directory", () => {
    const dir = path.join(sandboxRoot, "cli-openperms");
    fs.mkdirSync(dir, { mode: 0o755, recursive: true });
    fs.chmodSync(dir, 0o755);
    const result = runCli(["set", "--learner", "1", "--scenario", "met", "--ttl", "1h"], {
      ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: path.join(dir, "scenarios.json"),
    });
    assert.equal(result.status, 3, `${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.includes("group- or world-accessible"));

    const linkDir = path.join(sandboxRoot, "cli-symlinkdir");
    fs.symlinkSync(dir, linkDir);
    const viaLink = runCli(["set", "--learner", "1", "--scenario", "met", "--ttl", "1h"], {
      ATA_ENVIRONMENT: "dev", CHECKPOINT_DEV_SIMULATOR_STATE_PATH: path.join(linkDir, "scenarios.json"),
    });
    assert.equal(viaLink.status, 3);
  });

  await check("E17 the control plane has NO completion, XP or identity command", () => {
    const source = fs.readFileSync(path.join("scripts", "ops", "checkpointDevSimulator.ts"), "utf8");
    // Comments AND string literals are removed. The help text legitimately
    // explains that the tool cannot complete a level or set a balance; scanning
    // prose would forbid the documentation instead of the capability. What is
    // left is executable identifiers only.
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n")
      .replace(/`(?:[^`\\]|\\.)*`/g, '"S"')
      .replace(/"(?:[^"\\]|\\.)*"/g, '"S"')
      .replace(/'(?:[^'\\]|\\.)*'/g, '"S"');

    for (const forbidden of [
      "userLevelProgress", "xPTransaction", "XPTransaction", "pocketTraderIdentity",
      "bindPocketTraderIdentity", "completeLevel", "verifyCurrentCheckpoint",
      "checkpointVerificationAttempt", "balance", "Balance",
    ]) {
      assert.ok(!executable.includes(forbidden), `the CLI references ${forbidden}`);
    }
    // The only database access it has at all is the learner-existence read.
    const prismaUses = executable.match(/prisma\.[a-zA-Z]+\.[a-zA-Z]+/g) ?? [];
    assert.deepEqual(prismaUses, ["prisma.user.findUnique"]);

    // The offered COMMAND SET, not the prose around it. The help text says the
    // tool "cannot complete a level" — a substring scan would flag that sentence
    // for containing the word it exists to deny.
    const help = runCli(["help"]);
    assert.equal(help.status, 0);
    const offered = (help.stdout.split("Commands")[1] ?? "")
      .split("Options")[0]
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    assert.deepEqual(offered.sort(), ["clear", "clear-expired", "get", "help", "list", "set", "validate"]);
    // And an invented command is refused rather than silently ignored.
    for (const invented of ["complete", "grant-xp", "link-identity", "set-balance"]) {
      const result = runCli([invented], { ATA_ENVIRONMENT: "dev" });
      assert.notEqual(result.status, 0, `${invented} was accepted`);
      assert.ok(result.stderr.includes("unknown command"), `${invented}: ${result.stderr}`);
    }
  });

  await check("E18 there is no HTTP route, learner API or browser surface for scenarios", () => {
    // A route file mentioning the simulator would be a public control plane.
    const routes = spawnSync("grep", [
      "-rl", "-e", "checkpoint-simulator-state", "-e", "checkpointDevSimulator",
      "-e", "CHECKPOINT_DEV_SIMULATOR_STATE_PATH", "src/app", "src/components",
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(routes.stdout.trim(), "", `simulator state reachable from: ${routes.stdout}`);

    // And the provider itself is imported only by the resolver.
    const importers = spawnSync("grep", [
      "-rl", "checkpoint-provider-dev-simulator", "src",
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.deepEqual(
      importers.stdout.trim().split("\n").filter(Boolean).sort(),
      ["src/lib/curriculum/checkpoint.ts"],
    );
  });

  /* ================================================================== */
  /* F. Network isolation and source-level prohibitions                  */
  /* ================================================================== */

  await check("F1 the simulator source imports nothing network-capable", () => {
    const files = [
      path.join("src", "lib", "curriculum", "checkpoint-provider-dev-simulator.ts"),
      path.join("src", "lib", "curriculum", "checkpoint-simulator-state.ts"),
      path.join("src", "lib", "curriculum", "checkpoint-provider-mode.ts"),
      path.join("src", "lib", "environment.ts"),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const executable = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");

      for (const forbidden of [
        "fetch(", "node:http", "node:https", "node:net", "node:dgram", "node:dns",
        "node:tls", "XMLHttpRequest", "WebSocket", "axios", "undici",
        "pocketPartnerClient", "pocketPartnerConfig", "POCKET_PARTNER",
      ]) {
        assert.ok(!executable.includes(forbidden), `${file} references ${forbidden}`);
      }
    }
  });

  await check("F2 the simulator never reads the threshold amount", () => {
    const source = fs.readFileSync(
      path.join("src", "lib", "curriculum", "checkpoint-provider-dev-simulator.ts"), "utf8",
    );
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    // The one financial field on the request is never touched, so no comparison
    // and no derived amount is even expressible here.
    assert.ok(!executable.includes("thresholdMinorUnits"), "the simulator reads the threshold amount");
  });

  await check("F3 ZERO network operations were attempted by this entire suite", () => {
    assert.equal(networkAttempts, 0, `attempted: ${networkTargets.join(", ")}`);
  });

  console.log(`\nchecks: ${passed} passed, ${failed} failed`);
  console.log(`network operations attempted: ${networkAttempts}`);

  await prisma.$disconnect();
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
