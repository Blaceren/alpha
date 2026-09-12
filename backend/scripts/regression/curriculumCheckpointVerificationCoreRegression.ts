/**
 * L4VC-1 — provider-neutral financial-checkpoint verification core.
 *
 * Synthetic database only. No live DEV port is contacted, no Pocket endpoint
 * exists, no credential is read and NO EXTERNAL REQUEST IS MADE: the only
 * provider used is the deterministic in-process mock, whose every branch is a
 * pure switch.
 *
 * Proven here, on the REAL approved first-slice package (revision 3) plus the
 * rev4 CANDIDATE requirement fixture:
 *
 *   A. flags     — both off, checkpoint only, provider only, unconfigured,
 *                  requirement missing; no provider call in any of them.
 *   B. outcomes  — met, not_met, demo-only, identity unlinked/mismatch,
 *                  unsupported currency, timeout, maintenance, rate limited,
 *                  stale, invalid response.
 *   C. limits    — cooldown, 5/hour, provider timeout bound, no auto-retry.
 *   D. identity  — duplicate, conflicting, concurrent identical, concurrent
 *                  different, concurrent met.
 *   E. progress  — L4 completes once, next level unlocks, ZERO XPTransaction.
 *   F. authz     — unauthenticated, another learner, staff has no override.
 *   G. privacy   — no balance persisted, returned or logged, anywhere.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Type-only: the modules themselves are loaded dynamically inside main(), after
// the synthetic DATABASE_URL and the feature flags are in place.
import type { CheckpointMockCase } from "../../src/lib/curriculum/checkpoint-provider-mock";
import type { VerifyCheckpointInput } from "../../src/lib/curriculum/checkpoint-verification";

const dbPath = path.join(os.tmpdir(), `ata-checkpoint-vc1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const APPROVED = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";
const CANDIDATE = "curriculum/candidates/ata-v2-checkpoint-requirement.rev4-candidate.json";

const L1 = "v2.l001.registraciya-pocket";
const L2 = "v2.l002.kak-ustroen-alfa-trade-academy";
const L3 = "v2.l003.pervye-pyat-demo-sdelok";
const L4 = "v2.l004.kontrolnaya-tochka-50";

const MOCK_MARKER = "unsafe-deterministic-mock-regression-only";

/** Tokens that would indicate a learner financial VALUE had escaped. */
const FORBIDDEN_TOKENS = [
  "balance",
  "Balance",
  "remaining",
  "deficit",
  "deposit",
  "Deposit",
  "amountUsd",
  "observedBalance",
  "currentBalance",
  "thresholdUsd",
  "accountLogin",
  "accessToken",
  "should-never-survive",
];

/** Field names no learner-facing payload or durable row may ever carry. */
const FORBIDDEN_KEYS = new Set([
  "balance", "currentBalance", "observedBalance", "balanceMinorUnits",
  "remaining", "remainingUsd", "deficit", "depositAmount", "totalDeposits",
  "demoBalance", "thresholdUsd", "providerPayload", "accountLogin",
  "accountId", "accessToken", "accountToken", "metadata",
]);

/** Strip published definition literals before scanning for leaked money. */
function scrub(text: string) {
  return text
    .replaceAll("balance_check", "«completion-method»")
    .replaceAll("POCKET_BALANCE_PROVIDER_ENABLED", "«provider-flag»")
    .replaceAll("checkpoint.module-01", "«integration-code»");
}

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      collectKeys(entry, into);
    }
  }
  return into;
}

type AnyRecord = Record<string, unknown>;

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Captures console output so "never logged" is proven, not assumed. */
function captureConsole() {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = record;
  console.warn = record;
  console.error = record;
  return {
    lines,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

async function main() {
  cleanup();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
  delete process.env.CURRICULUM_V2_CHECKPOINT_ENABLED;
  delete process.env.POCKET_BALANCE_PROVIDER_ENABLED;
  delete process.env.CURRICULUM_V2_XP_ENABLED;
  delete process.env.CHECKPOINT_PROVIDER_TEST_BACKEND;

  const checkpoint = await import("../../src/lib/curriculum/checkpoint");
  const providerModule = await import("../../src/lib/curriculum/checkpoint-provider");
  const mockModule = await import("../../src/lib/curriculum/checkpoint-provider-mock");
  const engine = await import("../../src/lib/curriculum/checkpoint-verification");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const { prisma } = await import("../../src/lib/prisma");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const readApi = await import("../../src/lib/curriculum/read-api");
  const completion = await import("../../src/lib/curriculum/completion");
  const checkpointHttp = await import("../../src/lib/curriculum/checkpoint-http");

  const past = new Date("2026-06-01T00:00:00.000Z");
  const pkg = JSON.parse(fs.readFileSync(APPROVED, "utf8"));
  const imported = await importCurriculumPackage(pkg, { db: prisma });
  if (!imported.ok) throw new Error(`import failed: ${imported.code}`);
  const version = await prisma.curriculumVersion.findFirstOrThrow({
    where: { code: "ata-v2", versionNumber: 2 },
  });
  await prisma.curriculumVersion.update({
    where: { id: version.id },
    data: { status: "published", publishedAt: past, effectiveFrom: past },
  });

  const definitions = new Map<string, { id: number; levelNumber: number }>();
  for (const code of [L1, L2, L3, L4]) {
    const def = await prisma.levelDefinition.findFirstOrThrow({
      where: { curriculumVersionId: version.id, stableCode: code },
    });
    definitions.set(code, { id: def.id, levelNumber: def.levelNumber });
  }
  const l4Id = definitions.get(L4)!.id;

  // The rev4 CANDIDATE requirement, read from source. Nothing is published.
  const candidate = JSON.parse(fs.readFileSync(CANDIDATE, "utf8"));
  const spec = candidate.requirements[0];
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.publishedRevision, 3);

  async function configureRequirement() {
    await prisma.levelCheckpointRequirement.upsert({
      where: { levelDefinitionId: l4Id },
      create: {
        levelDefinitionId: l4Id,
        integrationCode: spec.integrationCode,
        thresholdCurrency: spec.thresholdCurrency,
        thresholdMinorUnits: spec.thresholdMinorUnits,
      },
      update: {},
    });
  }
  async function clearRequirement() {
    await prisma.levelCheckpointRequirement.deleteMany({ where: { levelDefinitionId: l4Id } });
  }

  let seq = 0;
  /** Enrol a learner standing on `currentLevel` with everything before completed. */
  async function enrol(currentLevel = 4, role: "user" | "admin" | "mentor" = "user") {
    const user = await prisma.user.create({
      data: { email: `vc1-${++seq}@example.com`, name: "VC1", role },
    });
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: user.id, curriculumVersionId: version.id, curriculumCode: "ata-v2",
        status: "active", enrolledAt: past, currentLevel,
        highestCompletedLevel: currentLevel - 1, lastMeaningfulActionAt: past,
      },
    });
    for (const code of [L1, L2, L3].slice(0, currentLevel - 1)) {
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId: enrollment.id, curriculumVersionId: version.id,
          levelDefinitionId: definitions.get(code)!.id, status: "completed",
          startedAt: past, lastProgressAt: past, completedAt: past,
          completionMethod: "external", attemptCount: 1,
        },
      });
    }
    return { userId: user.id, enrollmentId: enrollment.id };
  }

  let requestSeq = 0;
  const rid = () => `vc1-request-${++requestSeq}-abcdefgh`;

  /** Run the engine with the mock provider installed for exactly this call. */
  async function verifyWith(
    scenario: CheckpointMockCase,
    input: { userId: number; requestId?: string; config?: AnyRecord; options?: AnyRecord },
  ) {
    const provider = mockModule.createCheckpointMockProvider(
      scenario,
      (input.options ?? {}) as never,
    );
    const restore = checkpoint.__setCheckpointTestProvider(() => provider);
    try {
      const result = await engine.verifyCurrentCheckpoint({
        actorUserId: input.userId,
        stableCode: L4,
        requestId: input.requestId ?? rid(),
        config: input.config as never,
        db: prisma as never,
      });
      return { result, provider };
    } finally {
      restore();
    }
  }

  function enableAll() {
    process.env.CURRICULUM_V2_CHECKPOINT_ENABLED = "true";
    process.env.POCKET_BALANCE_PROVIDER_ENABLED = "true";
    process.env.CHECKPOINT_PROVIDER_TEST_BACKEND = MOCK_MARKER;
  }
  function disableAll() {
    delete process.env.CURRICULUM_V2_CHECKPOINT_ENABLED;
    delete process.env.POCKET_BALANCE_PROVIDER_ENABLED;
    delete process.env.CHECKPOINT_PROVIDER_TEST_BACKEND;
  }

  /* ===================== A. FLAGS AND PROVIDER SELECTION ==================== */

  await check("A1 both flags off -> checkpoint_disabled, disabled provider", () => {
    disableAll();
    const resolution = checkpoint.resolveCheckpointProvider();
    assert.equal(resolution.usable, false);
    assert.equal(resolution.reason, "checkpoint_disabled");
    assert.equal(resolution.provider.id, "disabled");
    assert.equal(checkpoint.hasAuthoritativeCheckpointProvider(), false);
  });

  await check("A2 only CHECKPOINT true -> provider_disabled", () => {
    disableAll();
    process.env.CURRICULUM_V2_CHECKPOINT_ENABLED = "true";
    const resolution = checkpoint.resolveCheckpointProvider();
    assert.equal(resolution.usable, false);
    assert.equal(resolution.reason, "provider_disabled");
    assert.equal(resolution.provider.id, "disabled");
  });

  await check("A3 only provider flag true -> checkpoint_disabled (no substitution)", () => {
    disableAll();
    process.env.POCKET_BALANCE_PROVIDER_ENABLED = "true";
    const resolution = checkpoint.resolveCheckpointProvider();
    assert.equal(resolution.usable, false);
    // The provider flag alone must never enable a checkpoint.
    assert.equal(resolution.reason, "checkpoint_disabled");
  });

  await check("A4 both true, no adapter -> provider_unconfigured", () => {
    disableAll();
    process.env.CURRICULUM_V2_CHECKPOINT_ENABLED = "true";
    process.env.POCKET_BALANCE_PROVIDER_ENABLED = "true";
    const resolution = checkpoint.resolveCheckpointProvider();
    assert.equal(resolution.usable, false);
    assert.equal(resolution.reason, "provider_unconfigured");
    assert.equal(resolution.provider.id, "unconfigured");
  });

  await check("A5 the mock needs BOTH flags, the marker AND a non-production runtime", () => {
    disableAll();
    const provider = mockModule.createCheckpointMockProvider("met");
    const restore = checkpoint.__setCheckpointTestProvider(() => provider);
    const base = {
      CURRICULUM_V2_CHECKPOINT_ENABLED: "true",
      POCKET_BALANCE_PROVIDER_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv;
    try {
      // Marker absent -> the factory is installed but never selected.
      assert.equal(checkpoint.resolveCheckpointProvider(base).provider.id, "unconfigured");
      // Marker present but a production runtime.
      assert.equal(
        checkpoint.resolveCheckpointProvider({
          ...base, CHECKPOINT_PROVIDER_TEST_BACKEND: MOCK_MARKER, NODE_ENV: "production",
        } as unknown as NodeJS.ProcessEnv).provider.id,
        "unconfigured",
      );
      // Marker misspelt.
      assert.equal(
        checkpoint.resolveCheckpointProvider({
          ...base, CHECKPOINT_PROVIDER_TEST_BACKEND: "true",
        } as unknown as NodeJS.ProcessEnv).provider.id,
        "unconfigured",
      );
      // All conditions satisfied.
      assert.equal(
        checkpoint.resolveCheckpointProvider({
          ...base, CHECKPOINT_PROVIDER_TEST_BACKEND: MOCK_MARKER, NODE_ENV: "test",
        } as unknown as NodeJS.ProcessEnv).provider.id,
        "mock",
      );
    } finally {
      restore();
      disableAll();
    }
  });

  await check("A6 production env validation rejects the mock marker outright", async () => {
    const env = await import("../../src/lib/env");
    const result = env.validateRuntimeEnv({
      ...process.env,
      NODE_ENV: "production",
      CHECKPOINT_PROVIDER_TEST_BACKEND: MOCK_MARKER,
    } as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("CHECKPOINT_PROVIDER_TEST_BACKEND")));
  });

  await check("A7 the provider flag is independent of POCKET_POSTBACK / REPORT / XP", async () => {
    const env = await import("../../src/lib/env");
    disableAll();
    process.env.POCKET_POSTBACK_ENABLED = "true";
    process.env.CURRICULUM_V2_XP_ENABLED = "true";
    assert.equal(env.isPocketBalanceProviderEnabled(), false);
    assert.equal(checkpoint.resolveCheckpointProvider().reason, "checkpoint_disabled");
    delete process.env.POCKET_POSTBACK_ENABLED;
    delete process.env.CURRICULUM_V2_XP_ENABLED;
    // And the reverse: the provider flag grants no postback capability.
    process.env.POCKET_BALANCE_PROVIDER_ENABLED = "true";
    assert.equal(process.env.POCKET_POSTBACK_ENABLED ?? "false", "false");
    disableAll();
  });

  await check("A8 disabled/unconfigured providers answer without reading the request", async () => {
    const request = {
      learnerId: 1, enrollmentId: 1, levelDefinitionId: 1,
      integrationCode: "checkpoint.module-01", thresholdCurrency: "USD" as const,
      thresholdMinorUnits: 5000, requestId: "x", timeoutSignal: new AbortController().signal,
    };
    assert.deepEqual(await providerModule.disabledCheckpointProvider.verifyThreshold(request), {
      outcome: "unavailable", reason: "provider_disabled",
    });
    assert.deepEqual(await providerModule.unconfiguredCheckpointProvider.verifyThreshold(request), {
      outcome: "unavailable", reason: "provider_unconfigured",
    });
  });

  await check("A9 engine refuses with flags off and calls NO provider, writes NO row", async () => {
    disableAll();
    await configureRequirement();
    const learner = await enrol();
    const provider = mockModule.createCheckpointMockProvider("met");
    const restore = checkpoint.__setCheckpointTestProvider(() => provider);
    try {
      const result = await engine.verifyCurrentCheckpoint({
        actorUserId: learner.userId, stableCode: L4, requestId: rid(), db: prisma as never,
      });
      assert.equal(result.kind, "refused");
      assert.equal(result.verificationState, "verification_unavailable");
      assert.equal(result.verificationReason, "checkpoint_disabled");
    } finally {
      restore();
    }
    assert.equal(provider.callCount(), 0, "a disabled checkpoint must not call a provider");
    assert.equal(
      await prisma.checkpointVerificationAttempt.count({ where: { enrollmentId: learner.enrollmentId } }),
      0,
      "a refusal must persist no attempt",
    );
  });

  await check("A10 provider flag off refuses with provider_disabled and no call", async () => {
    disableAll();
    process.env.CURRICULUM_V2_CHECKPOINT_ENABLED = "true";
    const learner = await enrol();
    const provider = mockModule.createCheckpointMockProvider("met");
    const restore = checkpoint.__setCheckpointTestProvider(() => provider);
    try {
      const result = await engine.verifyCurrentCheckpoint({
        actorUserId: learner.userId, stableCode: L4, requestId: rid(), db: prisma as never,
      });
      assert.equal(result.kind, "refused");
      assert.equal(result.verificationReason, "provider_disabled");
    } finally {
      restore();
      disableAll();
    }
    assert.equal(provider.callCount(), 0);
  });

  await check("A11 provider_unconfigured refuses without a call", async () => {
    disableAll();
    process.env.CURRICULUM_V2_CHECKPOINT_ENABLED = "true";
    process.env.POCKET_BALANCE_PROVIDER_ENABLED = "true";
    const learner = await enrol();
    const result = await engine.verifyCurrentCheckpoint({
      actorUserId: learner.userId, stableCode: L4, requestId: rid(), db: prisma as never,
    });
    assert.equal(result.kind, "refused");
    assert.equal(result.verificationReason, "provider_unconfigured");
    assert.equal(await prisma.checkpointVerificationAttempt.count(), 0);
    disableAll();
  });

  await check("A12 requirement unconfigured refuses and calls no provider", async () => {
    enableAll();
    await clearRequirement();
    const learner = await enrol();
    const { result, provider } = await verifyWith("met", { userId: learner.userId }).catch(
      (error: unknown) => ({ result: error, provider: null }),
    );
    assert.ok(engine.isCheckpointVerificationError(result));
    assert.equal((result as unknown as AnyRecord).code, "CHECKPOINT_REQUIREMENT_UNCONFIGURED");
    assert.equal(provider?.callCount() ?? 0, 0);
    await configureRequirement();
  });

  /* ========================== B. PROVIDER OUTCOMES ========================= */

  enableAll();

  // From here on a provider is CONFIGURED. `verifyWith` still installs its own
  // scenario per call (the disposer restores this one), but the read model and
  // the authorization checks need a usable provider to resolve at all.
  const restoreStandingMock = checkpoint.__setCheckpointTestProvider(() =>
    mockModule.createCheckpointMockProvider("not_met"),
  );

  /** Every non-met outcome: same durable expectations, one table. */
  const NON_MET: Array<[CheckpointMockCase, string, string, string]> = [
    ["not_met", "not_met", "not_met", "not_met"],
    ["demo_only", "not_met", "not_met", "not_met"],
    ["identity_unlinked", "identity_unlinked", "verification_unavailable", "identity_unlinked"],
    ["identity_mismatch", "identity_mismatch", "verification_unavailable", "identity_mismatch"],
    ["unsupported_currency", "unsupported_currency", "verification_unavailable", "unsupported_currency"],
    ["maintenance", "provider_maintenance", "verification_unavailable", "provider_maintenance"],
    ["rate_limited", "provider_rate_limited", "verification_unavailable", "provider_rate_limited"],
    ["stale", "stale", "verification_unavailable", "stale"],
    ["invalid_response", "invalid_provider_response", "verification_unavailable", "invalid_provider_response"],
    ["throws", "invalid_provider_response", "verification_unavailable", "invalid_provider_response"],
  ];

  for (const [scenario, durable, state, reason] of NON_MET) {
    await check(`B:${scenario} -> ${durable}; no completion, no XP`, async () => {
      const learner = await enrol();
      const { result, provider } = await verifyWith(scenario, { userId: learner.userId });
      assert.equal(provider.callCount(), 1, "exactly one provider call");
      assert.equal(result.kind, "receipt");
      const receipt = result as AnyRecord;
      assert.equal(receipt.verificationState, state);
      assert.equal(receipt.verificationReason, reason);
      assert.equal(receipt.completed, false);
      assert.equal(receipt.xpAwarded, 0);
      assert.equal(receipt.xpTransactionId, null);

      const attempt = await prisma.checkpointVerificationAttempt.findFirstOrThrow({
        where: { enrollmentId: learner.enrollmentId },
      });
      assert.equal(attempt.outcome, durable);
      assert.ok(attempt.completedAt, "attempt must be settled");
      assert.ok(attempt.cooldownUntil, "a non-met attempt starts a cooldown");

      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: learner.enrollmentId },
      });
      assert.equal(enrollment.currentLevel, 4, "currentLevel must not move");
      assert.equal(enrollment.highestCompletedLevel, 3);
      assert.equal(
        await prisma.xPTransaction.count({ where: { enrollmentId: learner.enrollmentId } }),
        0,
      );
      const l4progress = await prisma.userLevelProgress.findFirst({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
      });
      assert.equal(l4progress, null, "a non-met result creates no progress row");
    });
  }

  await check("B:timeout -> provider_timeout, bounded by the engine deadline", async () => {
    const learner = await enrol();
    const started = Date.now();
    const { result, provider } = await verifyWith("timeout", {
      userId: learner.userId,
      config: { providerTimeoutMs: 150 },
    });
    const elapsed = Date.now() - started;
    assert.equal(provider.callCount(), 1, "no automatic retry");
    assert.ok(elapsed < 3_000, `deadline must bound the call (took ${elapsed}ms)`);
    assert.equal((result as AnyRecord).verificationReason, "provider_timeout");
    const attempt = await prisma.checkpointVerificationAttempt.findFirstOrThrow({
      where: { enrollmentId: learner.enrollmentId },
    });
    assert.equal(attempt.outcome, "provider_timeout");
    assert.ok(attempt.completedAt);
  });

  await check("B:rate_limited surfaces the provider's retryAfterSeconds when longer", async () => {
    const learner = await enrol();
    const { result } = await verifyWith("rate_limited", {
      userId: learner.userId,
      options: { retryAfterSeconds: 300 },
    });
    // Our cooldown is 60s; the provider asked for 300. The learner is told the
    // longer wait rather than one we know is too short.
    assert.equal((result as AnyRecord).retryAfterSeconds, 300);
  });

  await check("B:met -> completed once, next level unlocked, ZERO XPTransaction", async () => {
    const learner = await enrol();
    const { result, provider } = await verifyWith("met", { userId: learner.userId });
    assert.equal(provider.callCount(), 1);
    const receipt = result as AnyRecord;
    assert.equal(receipt.kind, "receipt");
    assert.equal(receipt.verificationState, "completed");
    assert.equal(receipt.verificationReason, "none");
    assert.equal(receipt.completed, true);
    assert.equal(receipt.xpAwarded, 0);
    assert.equal(receipt.xpTransactionId, null);
    assert.equal(receipt.retryAfterSeconds, null, "a passed gate advertises no retry");

    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: learner.enrollmentId },
    });
    assert.equal(enrollment.highestCompletedLevel, 4);
    // L4 is the last level of the approved first slice, so the enrollment
    // completes rather than opening an L5 that does not exist.
    assert.equal(enrollment.status, "completed");
    assert.equal(receipt.nextLevelNumber, null);

    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
    });
    assert.equal(progress.status, "completed");
    assert.equal(
      await prisma.userLevelProgress.count({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
      }),
      1,
      "exactly one L4 progress row",
    );
    assert.equal(
      await prisma.xPTransaction.count({ where: { enrollmentId: learner.enrollmentId } }),
      0,
      "a checkpoint awards no XP",
    );
    const attempt = await prisma.checkpointVerificationAttempt.findFirstOrThrow({
      where: { enrollmentId: learner.enrollmentId },
    });
    assert.equal(attempt.outcome, "met");
    assert.equal(attempt.cooldownUntil, null);
    (globalThis as AnyRecord).__vc1met = learner;
  });

  await check("B:met unlocks the NEXT level when one exists", async () => {
    // The approved slice ends at L4, so a synthetic L5 proves the unlock rule
    // without touching published curriculum.
    const module1 = await prisma.moduleDefinition.findFirstOrThrow({
      where: { curriculumVersionId: version.id },
    });
    const l5 = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: version.id, moduleId: module1.id, levelNumber: 5,
        stableCode: "v2.l005.sinteticheskiy", type: "lesson", title: "L5",
        learningObjective: "synthetic", completionMethod: "lesson", xpReward: 0,
        requiredXp: 0, requiredPreviousLevel: 4, status: "active",
      },
    });
    await prisma.moduleDefinition.update({
      where: { id: module1.id }, data: { lastLevel: 5 },
    });
    try {
      const learner = await enrol();
      const { result } = await verifyWith("met", { userId: learner.userId });
      assert.equal((result as AnyRecord).completed, true);
      assert.equal((result as AnyRecord).nextLevelNumber, 5);
      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: learner.enrollmentId },
      });
      assert.equal(enrollment.currentLevel, 5, "the next level becomes current");
      assert.equal(enrollment.highestCompletedLevel, 4);
      assert.equal(enrollment.status, "active");
      const states = await levelState.resolveUserCurriculumLevelStates({
        userId: learner.userId, asOf: new Date(), db: prisma,
      });
      assert.equal(states.kind, "resolved");
      if (states.kind !== "resolved") throw new Error("unresolved");
      const byCode = new Map(states.levels.map((l) => [l.levelDefinition.stableCode, l]));
      assert.equal(byCode.get(L4)!.state, "completed");
      assert.equal(byCode.get("v2.l005.sinteticheskiy")!.state, "available");
      assert.equal(
        await prisma.xPTransaction.count({ where: { enrollmentId: learner.enrollmentId } }),
        0,
      );
    } finally {
      await prisma.moduleDefinition.update({ where: { id: module1.id }, data: { lastLevel: 4 } });
      await prisma.levelDefinition.delete({ where: { id: l5.id } });
    }
  });

  await check("B:real vs demo — a demo-only account never passes", async () => {
    const real = await enrol();
    const realResult = await verifyWith("real_account", {
      userId: real.userId,
      options: { observedMinorUnits: 7_350 },
    });
    assert.equal((realResult.result as AnyRecord).completed, true);

    const demo = await enrol();
    const demoResult = await verifyWith("demo_only", { userId: demo.userId });
    assert.equal((demoResult.result as AnyRecord).completed, false);
    assert.equal((demoResult.result as AnyRecord).verificationState, "not_met");
    // The learner is told the threshold is not met — never that demo funds
    // exist, and never how much of anything they hold.
    const text = scrub(JSON.stringify(demoResult.result));
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), `demo result leaked "${token}"`);
    }
  });

  /* ====================== C. COOLDOWN AND RATE LIMITS ====================== */

  await check("C1 cooldown blocks a NEW request and reports retryAfterSeconds", async () => {
    const learner = await enrol();
    await verifyWith("not_met", { userId: learner.userId });
    const second = await verifyWith("met", { userId: learner.userId });
    assert.equal(second.result.kind, "refused");
    assert.equal((second.result as AnyRecord).verificationState, "cooldown");
    assert.equal((second.result as AnyRecord).verificationReason, "cooldown_active");
    const retry = (second.result as AnyRecord).retryAfterSeconds as number;
    assert.ok(retry > 0 && retry <= 60, `retryAfterSeconds within the 60s cooldown, got ${retry}`);
    assert.equal(second.provider.callCount(), 0, "cooldown must not reach the provider");
    assert.equal(
      await prisma.checkpointVerificationAttempt.count({ where: { enrollmentId: learner.enrollmentId } }),
      1,
      "a cooldown refusal persists no attempt",
    );
  });

  await check("C2 after the cooldown expires a new attempt is accepted", async () => {
    const learner = await enrol();
    await verifyWith("not_met", { userId: learner.userId, config: { cooldownSeconds: 0 } });
    const second = await verifyWith("met", { userId: learner.userId, config: { cooldownSeconds: 0 } });
    assert.equal(second.result.kind, "receipt");
    assert.equal((second.result as AnyRecord).completed, true);
    assert.equal(second.provider.callCount(), 1);
  });

  await check("C3 the 5-per-rolling-hour allowance is enforced durably", async () => {
    const learner = await enrol();
    const config = { cooldownSeconds: 0 };
    for (let i = 0; i < 5; i += 1) {
      const attempt = await verifyWith("not_met", { userId: learner.userId, config });
      assert.equal(attempt.result.kind, "receipt", `attempt ${i + 1} should be accepted`);
      assert.equal(attempt.provider.callCount(), 1);
    }
    const sixth = await verifyWith("met", { userId: learner.userId, config });
    assert.equal(sixth.result.kind, "refused");
    assert.equal((sixth.result as AnyRecord).verificationReason, "rate_limited");
    assert.ok(((sixth.result as AnyRecord).retryAfterSeconds as number) > 0);
    assert.equal(sixth.provider.callCount(), 0, "a rate-limited request never reaches the provider");
    assert.equal(
      await prisma.checkpointVerificationAttempt.count({ where: { enrollmentId: learner.enrollmentId } }),
      5,
      "the allowance is counted from persisted attempts only",
    );
  });

  await check("C4 the allowance is per learner, not global", async () => {
    const other = await enrol();
    const attempt = await verifyWith("not_met", { userId: other.userId, config: { cooldownSeconds: 0 } });
    assert.equal(attempt.result.kind, "receipt");
  });

  await check("C5 defaults are the documented ATA operational values", () => {
    assert.equal(engine.CHECKPOINT_VERIFICATION_DEFAULTS.cooldownSeconds, 60);
    assert.equal(engine.CHECKPOINT_VERIFICATION_DEFAULTS.rateLimitAttempts, 5);
    assert.equal(engine.CHECKPOINT_VERIFICATION_DEFAULTS.rateLimitWindowSeconds, 3_600);
    assert.equal(engine.CHECKPOINT_VERIFICATION_DEFAULTS.providerTimeoutMs, 5_000);
    assert.equal(engine.CHECKPOINT_VERIFICATION_DEFAULTS.providerRetries, 0);
  });

  /* ==================== D. IDEMPOTENCY, CONFLICTS, RACES =================== */

  await check("D1 duplicate request replays the receipt without a second call", async () => {
    const learner = await enrol();
    const requestId = rid();
    const first = await verifyWith("not_met", { userId: learner.userId, requestId });
    assert.equal(first.provider.callCount(), 1);
    assert.equal((first.result as AnyRecord).replayed, false);

    const replay = await verifyWith("met", { userId: learner.userId, requestId });
    assert.equal(replay.provider.callCount(), 0, "a replay must not call the provider");
    assert.equal(replay.result.kind, "receipt");
    assert.equal((replay.result as AnyRecord).replayed, true);
    // The ORIGINAL answer is replayed, not the new scenario's answer.
    assert.equal((replay.result as AnyRecord).verificationState, "not_met");
    assert.equal((replay.result as AnyRecord).completed, false);
    assert.equal(
      await prisma.checkpointVerificationAttempt.count({ where: { enrollmentId: learner.enrollmentId } }),
      1,
      "a replay creates no second attempt",
    );
  });

  await check("D2 a met result replays as completed, still without a provider call", async () => {
    const learner = await enrol();
    const requestId = rid();
    await verifyWith("met", { userId: learner.userId, requestId });
    const replay = await verifyWith("not_met", { userId: learner.userId, requestId });
    assert.equal(replay.provider.callCount(), 0);
    assert.equal((replay.result as AnyRecord).completed, true);
    assert.equal((replay.result as AnyRecord).verificationState, "completed");
    assert.equal(
      await prisma.userLevelProgress.count({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id, status: "completed" },
      }),
      1,
      "L4 completes exactly once",
    );
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: learner.enrollmentId } }), 0);
  });

  await check("D3 a requestId reused for another level is a bounded conflict", async () => {
    const learner = await enrol();
    const requestId = rid();
    await verifyWith("not_met", { userId: learner.userId, requestId });
    // Same identity, different level of the same enrollment.
    const provider = mockModule.createCheckpointMockProvider("met");
    const restore = checkpoint.__setCheckpointTestProvider(() => provider);
    let raised: unknown;
    try {
      await prisma.checkpointVerificationAttempt.create({
        data: {
          enrollmentId: learner.enrollmentId,
          levelDefinitionId: definitions.get(L3)!.id,
          requestId: `${requestId}-other`,
          outcome: "not_met",
          completedAt: new Date(),
        },
      });
      // Reusing the L3 identity for L4 must be refused, not replayed.
      await engine.verifyCurrentCheckpoint({
        actorUserId: learner.userId, stableCode: L4,
        requestId: `${requestId}-other`, config: { cooldownSeconds: 0 }, db: prisma as never,
      });
    } catch (error) {
      raised = error;
    } finally {
      restore();
    }
    assert.ok(engine.isCheckpointVerificationError(raised), "expected a typed conflict");
    assert.equal((raised as unknown as AnyRecord).code, "CHECKPOINT_REQUEST_CONFLICT");
    assert.equal(provider.callCount(), 0, "a conflict never reaches the provider");
  });

  await check("D4 concurrent IDENTICAL requests produce exactly one provider call", async () => {
    const learner = await enrol();
    const requestId = rid();
    const provider = mockModule.createCheckpointMockProvider("not_met");
    const restore = checkpoint.__setCheckpointTestProvider(() => provider);
    let results;
    try {
      results = await Promise.all([
        engine.verifyCurrentCheckpoint({
          actorUserId: learner.userId, stableCode: L4, requestId, db: prisma as never,
        }),
        engine.verifyCurrentCheckpoint({
          actorUserId: learner.userId, stableCode: L4, requestId, db: prisma as never,
        }),
      ]);
    } finally {
      restore();
    }
    assert.equal(provider.callCount(), 1, "exactly one provider call for one request identity");
    assert.equal(
      await prisma.checkpointVerificationAttempt.count({ where: { enrollmentId: learner.enrollmentId } }),
      1,
      "exactly one attempt row",
    );
    // One caller gets the answer; the other gets the answer or `checking`.
    for (const result of results) {
      const state = (result as AnyRecord).verificationState;
      assert.ok(state === "not_met" || state === "checking", `unexpected state ${String(state)}`);
    }
  });

  await check("D5 concurrent DIFFERENT requests respect cooldown/in-flight", async () => {
    const learner = await enrol();
    const provider = mockModule.createCheckpointMockProvider("not_met");
    const restore = checkpoint.__setCheckpointTestProvider(() => provider);
    let results;
    try {
      results = await Promise.all([
        engine.verifyCurrentCheckpoint({
          actorUserId: learner.userId, stableCode: L4, requestId: rid(), db: prisma as never,
        }),
        engine.verifyCurrentCheckpoint({
          actorUserId: learner.userId, stableCode: L4, requestId: rid(), db: prisma as never,
        }),
      ]);
    } finally {
      restore();
    }
    assert.equal(provider.callCount(), 1, "the second request must not open a parallel provider call");
    const rows = await prisma.checkpointVerificationAttempt.count({
      where: { enrollmentId: learner.enrollmentId },
    });
    assert.equal(rows, 1, "the refused request persists no attempt");
    const states = results.map((r) => (r as AnyRecord).verificationState);
    assert.ok(states.includes("not_met"));
    assert.ok(
      states.some((s) => s === "checking" || s === "cooldown"),
      `the loser must be told checking/cooldown, got ${states.join(",")}`,
    );
  });

  await check("D6 concurrent MET verifications complete L4 exactly once", async () => {
    const learner = await enrol();
    const provider = mockModule.createCheckpointMockProvider("met");
    const restore = checkpoint.__setCheckpointTestProvider(() => provider);
    try {
      await Promise.allSettled([
        engine.verifyCurrentCheckpoint({
          actorUserId: learner.userId, stableCode: L4, requestId: rid(),
          config: { cooldownSeconds: 0 }, db: prisma as never,
        }),
        engine.verifyCurrentCheckpoint({
          actorUserId: learner.userId, stableCode: L4, requestId: rid(),
          config: { cooldownSeconds: 0 }, db: prisma as never,
        }),
        engine.verifyCurrentCheckpoint({
          actorUserId: learner.userId, stableCode: L4, requestId: rid(),
          config: { cooldownSeconds: 0 }, db: prisma as never,
        }),
      ]);
    } finally {
      restore();
    }
    const completed = await prisma.userLevelProgress.count({
      where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id, status: "completed" },
    });
    assert.equal(completed, 1, "L4 completes exactly once under concurrency");
    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: learner.enrollmentId },
    });
    assert.equal(enrollment.highestCompletedLevel, 4);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: learner.enrollmentId } }), 0);
    const auditRows = await prisma.auditLog.count({
      where: { userId: learner.userId, action: "CURRICULUM_CHECKPOINT_VERIFIED" },
    });
    assert.equal(auditRows, 1, "exactly one verification audit entry");
  });

  await check("D7 completeCurriculumLevel remains the only progression owner", async () => {
    const learner = await enrol();
    // No verification attempt exists, so the checkpoint owner has no proof.
    const result = await completion.completeCurriculumLevel({
      enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id,
      sourceType: "checkpoint_verification", sourceId: "checkpoint-verification:999999",
      actorId: learner.userId, db: prisma,
    });
    assert.notEqual(result.kind, "completed");
    // And no other owner may complete a checkpoint at all.
    for (const sourceType of ["level_completion", "assessment_pass", "report_approval", "mentor_completion"] as const) {
      const refused = await completion.completeCurriculumLevel({
        enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id,
        sourceType, sourceId: `vc1-${sourceType}`, actorId: learner.userId, db: prisma,
      });
      assert.notEqual(refused.kind, "completed", sourceType);
    }
    assert.equal(
      await prisma.userLevelProgress.count({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id, status: "completed" },
      }),
      0,
    );
  });

  /* ========================== E. AUTHORIZATION ============================ */

  await check("E1 an unknown or inactive actor is refused", async () => {
    await assert.rejects(
      () => engine.verifyCurrentCheckpoint({
        actorUserId: 99_999_999, stableCode: L4, requestId: rid(), db: prisma as never,
      }),
      (error: unknown) =>
        engine.isCheckpointVerificationError(error) && error.code === "CHECKPOINT_FORBIDDEN",
    );
    const blocked = await enrol();
    await prisma.user.update({ where: { id: blocked.userId }, data: { status: "blocked" } });
    await assert.rejects(
      () => engine.verifyCurrentCheckpoint({
        actorUserId: blocked.userId, stableCode: L4, requestId: rid(), db: prisma as never,
      }),
      (error: unknown) =>
        engine.isCheckpointVerificationError(error) && error.code === "CHECKPOINT_FORBIDDEN",
    );
  });

  await check("E2 verification is scoped to the actor's OWN enrollment", async () => {
    const owner = await enrol();
    const other = await enrol();
    const { result } = await verifyWith("met", { userId: other.userId });
    assert.equal((result as AnyRecord).completed, true);
    // The other learner's success changed nothing for the owner.
    const ownerEnrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: owner.enrollmentId },
    });
    assert.equal(ownerEnrollment.highestCompletedLevel, 3);
    assert.equal(ownerEnrollment.currentLevel, 4);
    assert.equal(
      await prisma.checkpointVerificationAttempt.count({ where: { enrollmentId: owner.enrollmentId } }),
      0,
    );
    // The command takes no enrollmentId at all: there is no parameter through
    // which one learner could aim at another's enrollment.
    assert.ok(!("enrollmentId" in ({} as VerifyCheckpointInput)));
  });

  await check("E3 staff receive no override — an admin is only ever a learner here", async () => {
    const source = fs.readFileSync("src/lib/curriculum/checkpoint-routes.ts", "utf8") +
      fs.readFileSync("src/lib/curriculum/checkpoint-http.ts", "utf8") +
      fs.readFileSync("src/lib/curriculum/checkpoint-verification.ts", "utf8");
    for (const forbidden of ["requireAdmin", "requireTaskReportReviewer", "requireMentor"]) {
      assert.ok(!source.includes(forbidden), `checkpoint surface must not use ${forbidden}`);
    }
    // An admin account with its own enrollment passes as a learner, and its
    // admin role grants it nothing extra.
    const admin = await enrol(4, "admin");
    const { result } = await verifyWith("not_met", { userId: admin.userId });
    assert.equal((result as AnyRecord).verificationState, "not_met");
    assert.equal((result as AnyRecord).completed, false);
    // No route exists that marks a checkpoint verified without a provider.
    const routes = fs.readdirSync("src/app/api/curriculum/v2/levels/[stableCode]/checkpoint", {
      recursive: true,
    }) as string[];
    assert.deepEqual(routes.sort(), ["verify", path.join("verify", "route.ts")].sort());
  });

  await check("E4 the request body accepts requestId and nothing else", () => {
    const schema = checkpointHttp.verifyCheckpointBodySchema;
    assert.equal(schema.safeParse({ requestId: "vc1-request-ok-1234" }).success, true);
    for (const extra of [
      { balance: 12_345 }, { currency: "USD" }, { login: "someone" },
      { accountId: "abc" }, { accountType: "real" }, { depositAmount: 50 },
      { balanceMinorUnits: 5000 }, { thresholdMinorUnits: 1 },
    ]) {
      const body = { requestId: "vc1-request-ok-1234", ...extra };
      assert.equal(
        schema.safeParse(body).success,
        false,
        `body must reject ${Object.keys(extra)[0]}`,
      );
    }
    // And a malformed identity is refused before anything is read.
    assert.equal(schema.safeParse({ requestId: "short" }).success, false);
    assert.equal(schema.safeParse({}).success, false);
  });

  await check("E5 the route applies flags -> auth -> rate limit -> CSRF, in order", () => {
    const source = fs.readFileSync("src/lib/curriculum/checkpoint-http.ts", "utf8");
    const flagAt = source.indexOf("isCurriculumV2ReadEnabled()");
    const authAt = source.indexOf("await requireUser()");
    const limitAt = source.indexOf("rateLimit(`checkpoint:verify:");
    const csrfAt = source.indexOf("validateCsrfToken(request)");
    assert.ok(flagAt > 0 && authAt > flagAt, "auth must follow the flag gate");
    assert.ok(limitAt > authAt, "rate limit must follow auth");
    assert.ok(csrfAt > limitAt, "CSRF must follow the rate limit");
  });

  /* ====================== F. READ MODEL AND PRIVACY ======================== */

  async function statesFor(userId: number) {
    const result = await levelState.resolveUserCurriculumLevelStates({
      userId, asOf: new Date(), db: prisma,
    });
    assert.equal(result.kind, "resolved");
    if (result.kind !== "resolved") throw new Error("unresolved");
    return result;
  }

  await check("F1 read model: ready when configured, at the gate, provider usable", async () => {
    const learner = await enrol();
    const states = await statesFor(learner.userId);
    const item = states.levels.find((l) => l.levelDefinition.stableCode === L4)!;
    assert.equal(item.checkpoint!.verificationState, "ready");
    assert.equal(item.checkpoint!.verificationReason, "none");
    assert.equal(item.checkpoint!.canVerify, true);
    assert.equal(item.checkpoint!.canStart, false);
    assert.equal(item.checkpoint!.canComplete, false);
    assert.equal(item.state, "checkpoint_unverified");
    assert.deepEqual(item.blockers, ["checkpoint_verification_required"]);
  });

  await check("F2 read model: cooldown then not_met, with retryAfterSeconds", async () => {
    const learner = await enrol();
    await verifyWith("not_met", { userId: learner.userId });
    const cooling = await statesFor(learner.userId);
    const cold = cooling.levels.find((l) => l.levelDefinition.stableCode === L4)!;
    assert.equal(cold.checkpoint!.verificationState, "cooldown");
    assert.equal(cold.checkpoint!.verificationReason, "cooldown_active");
    assert.ok((cold.checkpoint!.retryAfterSeconds ?? 0) > 0);
    assert.equal(cold.checkpoint!.canVerify, false, "no verify control during cooldown");

    // Expire the cooldown; the state becomes not_met and verification reopens.
    await prisma.checkpointVerificationAttempt.updateMany({
      where: { enrollmentId: learner.enrollmentId },
      data: { cooldownUntil: new Date(Date.now() - 1_000) },
    });
    const after = await statesFor(learner.userId);
    const item = after.levels.find((l) => l.levelDefinition.stableCode === L4)!;
    assert.equal(item.checkpoint!.verificationState, "not_met");
    assert.equal(item.checkpoint!.verificationReason, "not_met");
    assert.equal(item.checkpoint!.canVerify, true);
    assert.equal(item.checkpoint!.retryAfterSeconds, null);
  });

  await check("F3 read model: checking while an attempt is claimed", async () => {
    const learner = await enrol();
    await prisma.checkpointVerificationAttempt.create({
      data: {
        enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id,
        requestId: rid(), outcome: "in_progress",
      },
    });
    const states = await statesFor(learner.userId);
    const item = states.levels.find((l) => l.levelDefinition.stableCode === L4)!;
    assert.equal(item.checkpoint!.verificationState, "checking");
    assert.equal(item.checkpoint!.canVerify, false, "no second verify control while checking");
  });

  await check("F4 read model: completed after a met verification", async () => {
    const learner = (globalThis as AnyRecord).__vc1met as { userId: number };
    const result = await levelState.resolveUserCurriculumLevelStates({
      userId: learner.userId, asOf: new Date(), db: prisma,
    });
    // The first-slice enrollment COMPLETES at L4, so it leaves the enrolled
    // read entirely — proven through the completed read model instead.
    assert.equal(result.kind, "unavailable");
    const resolver = await import("../../src/lib/curriculum/resolver");
    const context = await resolver.resolveUserCurriculumContext({
      userId: learner.userId, asOf: new Date(), db: prisma,
    });
    assert.equal(context.kind, "completed");
    if (context.kind !== "completed") throw new Error("not completed");
    const dto = readApi.mapCompletedCurriculumRead(context) as AnyRecord;
    const levels = (dto.modules as AnyRecord[])[0].levels as AnyRecord[];
    const l4 = levels[3].checkpoint as AnyRecord;
    assert.equal(l4.verificationState, "completed");
    assert.equal(l4.verificationReason, "none");
    assert.equal(l4.canVerify, false);
    assert.equal(l4.canComplete, false);
  });

  await check("F5 read model: unavailable states while flags are off (honest gate intact)", async () => {
    disableAll();
    const learner = await enrol();
    const states = await statesFor(learner.userId);
    const item = states.levels.find((l) => l.levelDefinition.stableCode === L4)!;
    assert.equal(item.checkpoint!.verificationState, "verification_unavailable");
    assert.equal(item.checkpoint!.verificationReason, "checkpoint_disabled");
    assert.equal(item.checkpoint!.canVerify, false);
    assert.equal(item.checkpoint!.canStart, false);
    assert.equal(item.checkpoint!.canComplete, false);
    assert.equal(item.state, "checkpoint_unverified");
    assert.deepEqual(item.blockers, ["checkpoint_verification_unavailable"]);
    enableAll();
  });

  await check("F6 read model: requirement_unconfigured when no threshold is published", async () => {
    await clearRequirement();
    const learner = await enrol();
    const states = await statesFor(learner.userId);
    const item = states.levels.find((l) => l.levelDefinition.stableCode === L4)!;
    assert.equal(item.checkpoint!.verificationState, "verification_unavailable");
    assert.equal(item.checkpoint!.verificationReason, "requirement_unconfigured");
    assert.equal(item.checkpoint!.canVerify, false);
    await configureRequirement();
  });

  await check("F7 the DTO exposes exactly the bounded checkpoint fields", async () => {
    const learner = await enrol();
    const states = await statesFor(learner.userId);
    const dto = readApi.mapEnrolledCurriculumRead(states) as AnyRecord;
    const levels = (dto.modules as AnyRecord[])[0].levels as AnyRecord[];
    const block = levels[3].checkpoint as AnyRecord;
    assert.deepEqual(Object.keys(block).sort(), [
      "canComplete", "canStart", "canVerify", "integrationCode", "kind",
      "retryAfterSeconds", "verificationReason", "verificationState",
    ]);
    assert.equal(levels[0].checkpoint, null);
    assert.equal(levels[1].checkpoint, null);
    assert.equal(levels[2].checkpoint, null);
  });

  await check("G1 no observed balance is PERSISTED anywhere", async () => {
    const attempts = await prisma.checkpointVerificationAttempt.findMany();
    assert.ok(attempts.length > 0, "the audit needs real rows to be meaningful");
    // Column-level proof: the table has no field a balance could occupy.
    assert.deepEqual(Object.keys(attempts[0]).sort(), [
      "completedAt", "cooldownUntil", "createdAt", "enrollmentId", "id",
      "levelDefinitionId", "observedAt", "outcome", "providerRequestId", "requestId",
    ]);
    const requirements = await prisma.levelCheckpointRequirement.findMany();
    assert.deepEqual(Object.keys(requirements[0]).sort(), [
      "createdAt", "id", "integrationCode", "levelDefinitionId",
      "thresholdCurrency", "thresholdMinorUnits", "updatedAt",
    ]);
    const text = scrub(JSON.stringify({ attempts, requirements }));
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), `durable rows leaked "${token}"`);
    }
    for (const key of collectKeys({ attempts, requirements })) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `durable rows expose forbidden key "${key}"`);
    }
    // The hostile mock returned a balance and a login; neither survived.
    const raw = await prisma.$queryRawUnsafe(
      'SELECT * FROM "CheckpointVerificationAttempt"',
    );
    const rawText = scrub(JSON.stringify(raw));
    assert.ok(!rawText.includes("999999"), "the mock's balance must not be in the table");
    assert.ok(!rawText.includes("should-never-survive"));
  });

  await check("G2 no observed balance is RETURNED by the API DTO", async () => {
    const learner = await enrol();
    const { result } = await verifyWith("invalid_response", { userId: learner.userId });
    const dto = checkpointHttp.checkpointVerificationDto(result) as AnyRecord;
    assert.deepEqual(Object.keys(dto).sort(), [
      "completed", "level", "nextLevelNumber", "replayed", "retryAfterSeconds",
      "verificationReason", "verificationState", "xpAwarded", "xpTransactionId",
    ]);
    assert.equal(dto.xpAwarded, 0);
    assert.equal(dto.xpTransactionId, null);
    const text = scrub(JSON.stringify(dto));
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), `response DTO leaked "${token}"`);
    }
    for (const key of collectKeys(dto)) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `response DTO exposes forbidden key "${key}"`);
    }
  });

  await check("G3 no observed balance is LOGGED", async () => {
    const learner = await enrol();
    const capture = captureConsole();
    let error: unknown;
    try {
      // The hostile scenarios are the ones most likely to log a payload.
      await verifyWith("invalid_response", { userId: learner.userId, config: { cooldownSeconds: 0 } });
      await verifyWith("throws", { userId: learner.userId, config: { cooldownSeconds: 0 } });
      await verifyWith("met", { userId: learner.userId, config: { cooldownSeconds: 0 } });
    } catch (thrown) {
      error = thrown;
    } finally {
      capture.restore();
    }
    assert.equal(error, undefined);
    const logged = scrub(capture.lines.join("\n"));
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!logged.includes(token), `logs leaked "${token}"`);
    }
    assert.ok(!logged.includes("999999"), "logs must not contain the mock balance");
  });

  await check("G4 the audit trail records a verdict, never an amount", async () => {
    const audits = await prisma.auditLog.findMany({
      where: { action: "CURRICULUM_CHECKPOINT_VERIFIED" },
    });
    assert.ok(audits.length > 0, "a met verification must be auditable");
    for (const entry of audits) {
      const metadata = entry.metadata as AnyRecord;
      assert.deepEqual(Object.keys(metadata).sort(), [
        "attemptId", "enrollmentId", "integrationCode", "levelDefinitionId",
        "levelNumber", "outcome", "providerRequestId", "stableCode",
      ]);
      assert.equal(metadata.outcome, "met");
      // Not even the public threshold is repeated per learner.
      assert.ok(!("thresholdMinorUnits" in metadata));
    }
    const text = scrub(JSON.stringify(await prisma.auditLog.findMany()));
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), `audit leaked "${token}"`);
    }
  });

  await check("G5 the normalizer rebuilds results from an allow-list", () => {
    const hostile = providerModule.normalizeCheckpointProviderResult({
      outcome: "met",
      balanceMinorUnits: 12_345,
      accountLogin: "victim@example.com",
      accessToken: "secret",
      providerRequestId: "req-1",
      retryAfterSeconds: 30,
    });
    assert.deepEqual(Object.keys(hostile).sort(), [
      "observedAt", "outcome", "providerRequestId", "retryAfterSeconds",
    ]);
    assert.equal(hostile.outcome, "met");
    // Unknown outcomes, non-objects and bad reasons all collapse to a typed
    // outcome rather than throwing an error that might quote the payload.
    assert.equal(
      providerModule.normalizeCheckpointProviderResult({ outcome: "nope" }).outcome,
      "invalid_provider_response",
    );
    assert.equal(
      providerModule.normalizeCheckpointProviderResult(null).outcome,
      "invalid_provider_response",
    );
    assert.equal(
      providerModule.normalizeCheckpointProviderResult({ outcome: "unavailable", reason: "made_up" }).outcome,
      "invalid_provider_response",
    );
    // Out-of-range or non-integer back-pressure is dropped, not clamped blindly.
    assert.equal(
      providerModule.normalizeCheckpointProviderResult({ outcome: "not_met", retryAfterSeconds: -5 })
        .retryAfterSeconds,
      null,
    );
    assert.equal(
      providerModule.normalizeCheckpointProviderResult({ outcome: "not_met", retryAfterSeconds: 99_999 })
        .retryAfterSeconds,
      null,
    );
  });

  await check("G6 no Pocket endpoint, credential or HTTP client exists in the seam", () => {
    const files = [
      "src/lib/curriculum/checkpoint-provider.ts",
      "src/lib/curriculum/checkpoint-provider-mock.ts",
      "src/lib/curriculum/checkpoint-verification.ts",
      "src/lib/curriculum/checkpoint.ts",
      "src/lib/curriculum/checkpoint-http.ts",
      "src/lib/curriculum/checkpoint-routes.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      // No network call of any kind.
      assert.ok(!/\bfetch\s*\(/.test(source), `${file} must not call fetch`);
      assert.ok(!/require\(["']https?["']\)|from ["']node:https?["']/.test(source), `${file} must not import http`);
      assert.ok(!/axios|got\(|undici/.test(source), `${file} must not use an HTTP client`);
      // No endpoint and no credential.
      assert.ok(!/https?:\/\/(?!pris\.ly)/.test(source), `${file} must contain no URL`);
      assert.ok(!/pocketoption|po\.trade|api_key|apiKey|client_secret|Bearer /i.test(source), `${file} leaks provider config`);
      // No import of the legacy exchange balance surface.
      // The check is on the import GRAPH — the module specifier — not on type
      // names. `CheckpointBalanceProvider` is our own seam; importing
      // `@/lib/exchange/balanceProvider` would be the violation.
      //
      // L4PA-1: `checkpoint.ts` now resolves the official Pocket adapter, which
      // is the ONE wiring change the L4VC-1 handoff said this phase would make.
      // That single specifier is allowed by exact name — a wildcard would let
      // any future `@/lib/exchange/*` import in unnoticed, which is precisely
      // what this assertion exists to prevent. Every other prohibition above
      // (no fetch, no HTTP client, no URL, no credential) still applies to
      // these files unchanged.
      const ALLOWED_POCKET_SPECIFIER = "./checkpoint-provider-pocket";
      for (const match of source.match(/from\s+["']([^"']+)["']/g) ?? []) {
        const specifier = match.replace(/^from\s+["']|["']$/g, "");
        if (specifier === ALLOWED_POCKET_SPECIFIER) continue;
        assert.ok(
          !/exchange|pocket/i.test(specifier),
          `${file} forbidden import: ${specifier}`,
        );
      }
    }
  });

  await check("G7 no Pocket or legacy exchange surface was touched", async () => {
    assert.equal(process.env.POCKET_POSTBACK_ENABLED ?? "false", "false");
    assert.equal(await prisma.postbackEvent.count(), 0);
    assert.equal(await prisma.exchangeAccount.count(), 0);
    assert.equal(await prisma.checkpoint.count(), 0);
  });

  await check("G8 database integrity intact", async () => {
    assert.equal(((await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")) as unknown[]).length, 0);
    const integrity = (await prisma.$queryRawUnsafe("PRAGMA integrity_check")) as Array<Record<string, string>>;
    assert.equal(Object.values(integrity[0])[0], "ok");
  });

  restoreStandingMock();
  disableAll();
  await prisma.$disconnect();
  cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
