/**
 * L4HG-1 — fail-closed financial checkpoint (honest gate).
 *
 * Synthetic database only; no live DEV port is contacted, no Pocket call is
 * made and no balance provider is imported. Proves, on the REAL approved
 * first-slice package (revision 3):
 *
 *   A. resolver — the checkpoint read model is fail-closed with the flag off,
 *                 with the flag on (no authoritative provider), and for an
 *                 unrecognised integration code.
 *   B. states   — after L3 completion L4 presents as `checkpoint_unverified`,
 *                 never `available`; L5 (absent here) never opens; L1-L3 are
 *                 unchanged.
 *   C. actions  — L4 cannot be started, self-completed, completed by an
 *                 assessment, completed by a report, or served lesson content.
 *   D. privacy  — no balance-shaped field reaches the read model, and no
 *                 durable row, XP transaction or completion is created.
 *
 * The defect this replaces: before L4HG-1 the same fixture resolved L4 as
 * `available` with zero blockers, allowed a progress row to be created, and
 * then rejected every completion owner — a level the learner could enter and
 * never leave.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-checkpoint-hg1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const APPROVED = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";

const L1 = "v2.l001.registraciya-pocket";
const L2 = "v2.l002.kak-ustroen-alfa-trade-academy";
const L3 = "v2.l003.pervye-pyat-demo-sdelok";
const L4 = "v2.l004.kontrolnaya-tochka-50";

/**
 * Tokens that would indicate a learner financial VALUE had escaped.
 *
 * `balance_check` is deliberately not one of them: it is the published
 * `completionMethod` of the level definition — a name, identical for every
 * learner, carrying no measurement. It is stripped before the scan so the
 * check tests for leaked money rather than for the word.
 */
const FORBIDDEN_TOKENS = [
  "balance",
  "Balance",
  "remaining",
  "deficit",
  "deposit",
  "Deposit",
  "amountUsd",
  "observed",
  "currentBalance",
  "thresholdUsd",
];

/** Field names no learner-facing payload may ever carry. */
const FORBIDDEN_KEYS = new Set([
  "balance", "currentBalance", "observedBalance", "balanceMinorUnits",
  "remaining", "remainingUsd", "deficit", "depositAmount", "totalDeposits",
  "demoBalance", "thresholdUsd", "providerPayload", "metadata",
]);

/** Strip the published definition literal before scanning for leaked money. */
function scrub(text: string) {
  return text.replaceAll("balance_check", "«completion-method»");
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

  const checkpoint = await import("../../src/lib/curriculum/checkpoint");
  const env = await import("../../src/lib/env");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const { prisma } = await import("../../src/lib/prisma");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const readApi = await import("../../src/lib/curriculum/read-api");
  const completion = await import("../../src/lib/curriculum/completion");
  const content = await import("../../src/lib/curriculum/content-read-progress");
  const reportRuntime = await import("../../src/lib/curriculum/report-submission");

  /* ======================= A. RESOLVER (no database) ======================= */

  await check("A1 flag absent is disabled (fail-closed default)", () => {
    delete process.env.CURRICULUM_V2_CHECKPOINT_ENABLED;
    assert.equal(env.isCurriculumV2CheckpointEnabled(), false);
    const model = checkpoint.resolveCheckpointVerification({ integrationCode: "checkpoint.module-01" });
    assert.equal(model.verificationState, "verification_unavailable");
    assert.equal(model.verificationReason, "checkpoint_disabled");
    assert.equal(model.canVerify, false);
    assert.equal(model.canStart, false);
    assert.equal(model.canComplete, false);
  });

  await check("A2 flag false is disabled", () => {
    process.env.CURRICULUM_V2_CHECKPOINT_ENABLED = "false";
    assert.equal(env.isCurriculumV2CheckpointEnabled(), false);
    assert.equal(
      checkpoint.resolveCheckpointVerification({ integrationCode: "checkpoint.module-01" }).verificationReason,
      "checkpoint_disabled",
    );
  });

  await check("A3 flag true still unavailable — no authoritative provider", () => {
    process.env.CURRICULUM_V2_CHECKPOINT_ENABLED = "true";
    delete process.env.POCKET_BALANCE_PROVIDER_ENABLED;
    assert.equal(env.isCurriculumV2CheckpointEnabled(), true);
    assert.equal(checkpoint.hasAuthoritativeCheckpointProvider(), false);
    const model = checkpoint.resolveCheckpointVerification({ integrationCode: "checkpoint.module-01" });
    // The decisive rule, unchanged: enabling a flag must NEVER produce a verdict
    // about the learner's money. Unavailable is not "not met".
    assert.equal(model.verificationState, "verification_unavailable");
    assert.equal(model.canVerify, false);
    // L4VC-1 refined the REASON. The checkpoint flag alone does not grant the
    // provider capability, so the honest answer is `provider_disabled` — the
    // platform is not permitted to ask — rather than `provider_unconfigured`,
    // which claims it tried to find an adapter and could not.
    assert.equal(model.verificationReason, "provider_disabled");

    // With the provider capability ALSO granted but no adapter wired (the
    // shipped build), the reason becomes `provider_unconfigured` and the state
    // is still unavailable.
    process.env.POCKET_BALANCE_PROVIDER_ENABLED = "true";
    const granted = checkpoint.resolveCheckpointVerification({ integrationCode: "checkpoint.module-01" });
    assert.equal(granted.verificationState, "verification_unavailable");
    assert.equal(granted.verificationReason, "provider_unconfigured");
    assert.equal(granted.canVerify, false);
    assert.equal(checkpoint.hasAuthoritativeCheckpointProvider(), false);
    delete process.env.POCKET_BALANCE_PROVIDER_ENABLED;
  });

  await check("A4 unknown / malformed integration code fails closed", () => {
    process.env.CURRICULUM_V2_CHECKPOINT_ENABLED = "true";
    for (const code of [null, "", "checkpoint.unknown-module", "Checkpoint.Module-01", "module-01", "checkpoint..x", "checkpoint.-x"]) {
      const model = checkpoint.resolveCheckpointVerification({ integrationCode: code });
      assert.equal(model.verificationState, "verification_unavailable", `code=${String(code)}`);
      assert.equal(model.verificationReason, "integration_unknown", `code=${String(code)}`);
      assert.equal(model.integrationCode, null, `code=${String(code)}`);
      assert.equal(model.canVerify, false);
    }
    assert.equal(checkpoint.isKnownCheckpointIntegrationCode("checkpoint.module-01"), true);
  });

  await check("A5 resolver exposes no financial field", () => {
    const model = checkpoint.resolveCheckpointVerification({ integrationCode: "checkpoint.module-01" });
    // L4VC-1 adds `retryAfterSeconds` — a WAIT in seconds, never an amount. The
    // field set is still a closed list with no slot a balance could occupy.
    assert.deepEqual(Object.keys(model).sort(), [
      "canComplete", "canStart", "canVerify", "integrationCode", "kind",
      "retryAfterSeconds", "verificationReason", "verificationState",
    ]);
    assert.equal(model.retryAfterSeconds, null);
    const text = JSON.stringify(model);
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), `resolver leaked "${token}"`);
    }
  });

  // The rest of the suite runs with the flag OFF — the shipped default.
  delete process.env.CURRICULUM_V2_CHECKPOINT_ENABLED;

  /* ==================== B. STATES ON THE APPROVED PACKAGE ================== */

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

  let seq = 0;
  /** Enrol a learner standing on `currentLevel` with everything before completed. */
  async function enrol(currentLevel: number) {
    const user = await prisma.user.create({
      data: { email: `hg1-${++seq}@example.com`, name: "HG1" },
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

  async function statesFor(userId: number) {
    const result = await levelState.resolveUserCurriculumLevelStates({
      userId, asOf: new Date(), db: prisma,
    });
    assert.equal(result.kind, "resolved");
    if (result.kind !== "resolved") throw new Error("unresolved");
    return result;
  }

  const atCheckpoint = await enrol(4);

  await check("B1 L3 completion leaves the enrollment on level 4", async () => {
    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: atCheckpoint.enrollmentId },
    });
    assert.equal(enrollment.currentLevel, 4);
    assert.equal(enrollment.highestCompletedLevel, 3);
  });

  await check("B2 L4 presents as checkpoint_unverified, never available", async () => {
    const states = await statesFor(atCheckpoint.userId);
    const item = states.levels.find((level) => level.levelDefinition.stableCode === L4)!;
    assert.equal(item.state, "checkpoint_unverified");
    assert.notEqual(item.state, "available");
    assert.deepEqual(item.blockers, ["checkpoint_verification_unavailable"]);
    assert.equal(item.progress, null);
  });

  await check("B3 the checkpoint read model is attached and fail-closed", async () => {
    const states = await statesFor(atCheckpoint.userId);
    const item = states.levels.find((level) => level.levelDefinition.stableCode === L4)!;
    assert.ok(item.checkpoint, "checkpoint read model missing");
    assert.equal(item.checkpoint!.kind, "financial_checkpoint");
    assert.equal(item.checkpoint!.integrationCode, "checkpoint.module-01");
    assert.equal(item.checkpoint!.verificationState, "verification_unavailable");
    assert.equal(item.checkpoint!.verificationReason, "checkpoint_disabled");
    assert.equal(item.checkpoint!.canVerify, false);
    assert.equal(item.checkpoint!.canStart, false);
    assert.equal(item.checkpoint!.canComplete, false);
  });

  await check("B4 L1-L3 states and non-checkpoint levels are unchanged", async () => {
    const states = await statesFor(atCheckpoint.userId);
    const byCode = new Map(states.levels.map((level) => [level.levelDefinition.stableCode, level]));
    for (const code of [L1, L2, L3]) {
      assert.equal(byCode.get(code)!.state, "completed", code);
      assert.deepEqual(byCode.get(code)!.blockers, [], code);
      assert.equal(byCode.get(code)!.checkpoint, null, code);
    }
  });

  await check("B5 an earlier learner still sees L4 locked, not unverified", async () => {
    const early = await enrol(2);
    const states = await statesFor(early.userId);
    const byCode = new Map(states.levels.map((level) => [level.levelDefinition.stableCode, level]));
    assert.equal(byCode.get(L2)!.state, "available");
    assert.equal(byCode.get(L3)!.state, "locked");
    // Sequence incomplete dominates: the learner has not reached the gate.
    assert.equal(byCode.get(L4)!.state, "locked");
    assert.ok(byCode.get(L4)!.blockers.includes("sequence_incomplete"));
    assert.ok(byCode.get(L4)!.blockers.includes("checkpoint_verification_unavailable"));
  });

  await check("B6 a pre-existing in_progress checkpoint row reads as unverified", async () => {
    // A learner who started L4 under the old behaviour must not keep seeing an
    // ordinary in-progress level. The durable row is left exactly as it was.
    const legacy = await enrol(4);
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: legacy.enrollmentId, curriculumVersionId: version.id,
        levelDefinitionId: definitions.get(L4)!.id, status: "in_progress",
        startedAt: past, lastProgressAt: past,
      },
    });
    const states = await statesFor(legacy.userId);
    const item = states.levels.find((level) => level.levelDefinition.stableCode === L4)!;
    assert.equal(item.state, "checkpoint_unverified");
    assert.deepEqual(item.blockers, ["checkpoint_verification_unavailable"]);
    const durable = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: legacy.enrollmentId, levelDefinitionId: definitions.get(L4)!.id },
    });
    assert.equal(durable.status, "in_progress", "durable row must not be rewritten");
    (globalThis as AnyRecord).__hg1legacy = legacy;
  });

  /* ========================= C. ACTION BOUNDARY ========================== */

  await check("C1 the checkpoint cannot be started", async () => {
    await assert.rejects(
      () => levelState.startCurrentCurriculumLevel({ actorUserId: atCheckpoint.userId, db: prisma }),
      (error: unknown) =>
        levelState.isLevelStartDomainError(error) &&
        error.code === "LEVEL_START_CHECKPOINT_UNVERIFIED",
    );
    const rows = await prisma.userLevelProgress.count({
      where: { enrollmentId: atCheckpoint.enrollmentId, levelDefinitionId: definitions.get(L4)!.id },
    });
    assert.equal(rows, 0, "a refused start must create no progress row");
  });

  await check("C2 no completion owner can complete the checkpoint", async () => {
    const legacy = (globalThis as AnyRecord).__hg1legacy as { userId: number; enrollmentId: number };
    // L4VC-1 gave `financial_checkpoint:balance_check` exactly ONE owner
    // (`checkpoint_verification`), so the four XP-bearing owners are now
    // refused as the wrong owner rather than as an unowned level type. Either
    // way the level is not completed and nothing durable changes.
    for (const sourceType of ["level_completion", "assessment_pass", "report_approval", "mentor_completion"] as const) {
      const result = await completion.completeCurriculumLevel({
        enrollmentId: legacy.enrollmentId,
        levelDefinitionId: definitions.get(L4)!.id,
        sourceType, sourceId: `hg1-${sourceType}`, actorId: legacy.userId, db: prisma,
      });
      assert.equal(result.kind, "rejected", sourceType);
      assert.equal((result as AnyRecord).code, "COMPLETION_OWNER_MISMATCH", sourceType);
    }
    // And the one real owner still cannot complete it without a durable,
    // settled `met` verification attempt to prove it.
    const forged = await completion.completeCurriculumLevel({
      enrollmentId: legacy.enrollmentId,
      levelDefinitionId: definitions.get(L4)!.id,
      sourceType: "checkpoint_verification",
      sourceId: "checkpoint-verification:1",
      actorId: legacy.userId, db: prisma,
    });
    assert.notEqual(forged.kind, "completed");
    assert.equal((forged as AnyRecord).code, "COMPLETION_STATE_CORRUPT");
    const durable = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: legacy.enrollmentId, levelDefinitionId: definitions.get(L4)!.id },
    });
    assert.equal(durable.status, "in_progress", "a refused completion changes nothing");
  });

  await check("C3 completion is refused even without a progress row", async () => {
    const result = await completion.completeCurriculumLevel({
      enrollmentId: atCheckpoint.enrollmentId,
      levelDefinitionId: definitions.get(L4)!.id,
      sourceType: "level_completion", sourceId: "hg1-no-progress",
      actorId: atCheckpoint.userId, db: prisma,
    });
    assert.equal(result.kind, "rejected");
    assert.equal((result as AnyRecord).code, "COMPLETION_PROGRESS_NOT_STARTED");
  });

  await check("C4 the checkpoint serves no learner lesson content", async () => {
    const result = await content.resolveUserLevelContent({
      actorUserId: atCheckpoint.userId, stableCode: L4, locale: "ru",
    });
    assert.notEqual(result.kind, "available");
    assert.equal(result.kind, "unavailable");
    assert.equal((result as AnyRecord).reason, "unsupported_level_type");
  });

  await check("C5 the checkpoint is not a report level", async () => {
    const result = await reportRuntime.resolveOwnReportContext({
      actorUserId: atCheckpoint.userId, locale: "ru", stableCode: L4,
    });
    assert.equal(result.kind, "unavailable");
    assert.equal((result as AnyRecord).reason, "wrong_level_type");
  });

  await check("C6 another learner cannot observe this learner's checkpoint", async () => {
    const other = await enrol(4);
    const states = await statesFor(other.userId);
    // Each resolution is scoped to its own enrollment; no cross-learner read.
    assert.equal(states.userId, other.userId);
    assert.notEqual(states.enrollment.id, atCheckpoint.enrollmentId);
  });

  /* ====================== D. READ MODEL AND PRIVACY ====================== */

  await check("D1 the enrolled read model exposes the bounded checkpoint block", async () => {
    const states = await statesFor(atCheckpoint.userId);
    const dto = readApi.mapEnrolledCurriculumRead(states) as AnyRecord;
    const levels = (dto.modules as AnyRecord[])[0].levels as AnyRecord[];
    const l4 = levels[3];
    assert.equal(l4.presentationState, "checkpoint_unverified");
    assert.deepEqual(l4.blockers, ["checkpoint_verification_unavailable"]);
    const block = l4.checkpoint as AnyRecord;
    // L4VC-1 adds `retryAfterSeconds` (a wait, never an amount) and nothing else.
    assert.deepEqual(Object.keys(block).sort(), [
      "canComplete", "canStart", "canVerify", "integrationCode", "kind",
      "retryAfterSeconds", "verificationReason", "verificationState",
    ]);
    assert.equal(block.retryAfterSeconds, null);
    assert.equal(block.verificationState, "verification_unavailable");
    // Non-checkpoint levels carry an explicit null rather than an absent key.
    assert.equal(levels[0].checkpoint, null);
    assert.equal(levels[1].checkpoint, null);
    assert.equal(levels[2].checkpoint, null);
  });

  await check("D2 no balance-shaped value appears anywhere in the read model", async () => {
    const states = await statesFor(atCheckpoint.userId);
    const dto = readApi.mapEnrolledCurriculumRead(states);
    const text = scrub(JSON.stringify(dto));
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), `read model leaked "${token}"`);
    }
    for (const key of collectKeys(dto)) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `read model exposes forbidden key "${key}"`);
    }
    // The one permitted money-shaped string is the canonical target, which
    // lives in the published curriculum title and is identical for everyone.
    assert.ok(text.includes("Контрольная точка $50"));
    assert.equal((text.match(/\$/g) ?? []).length, 1, "exactly one currency symbol, the target");
  });

  await check("D3 nothing was completed and no XP was created", async () => {
    assert.equal(await prisma.xPTransaction.count(), 0);
    const completed = await prisma.userLevelProgress.count({
      where: { enrollmentId: atCheckpoint.enrollmentId, status: "completed" },
    });
    assert.equal(completed, 3);
    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: atCheckpoint.enrollmentId },
    });
    assert.equal(enrollment.currentLevel, 4);
    assert.equal(enrollment.highestCompletedLevel, 3);
    assert.equal(enrollment.completedAt, null);
  });

  await check("D4 no checkpoint audit entry claims a verification happened", async () => {
    const audits = await prisma.auditLog.findMany();
    const text = scrub(JSON.stringify(audits));
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), `audit leaked "${token}"`);
    }
    assert.ok(!audits.some((entry) => String(entry.action).includes("checkpoint")));
  });

  await check("D5 no Pocket or balance-provider surface was touched", async () => {
    assert.equal(process.env.POCKET_POSTBACK_ENABLED ?? "false", "false");
    assert.equal(await prisma.postbackEvent.count(), 0);
    assert.equal(await prisma.exchangeAccount.count(), 0);
    assert.equal(await prisma.checkpoint.count(), 0);
    // The honest-gate module must not IMPORT the exchange balance provider or
    // any Pocket surface. Prose references in comments are fine and expected —
    // the check is on the import graph, not on the word.
    const source = fs.readFileSync("src/lib/curriculum/checkpoint.ts", "utf8");
    const specifiers = (source.match(/from\s+["']([^"']+)["']/g) ?? []).map((m) =>
      m.replace(/^from\s+["']|["']$/g, ""),
    );
    // L4VC-1 adds the provider SEAM as the resolver's second dependency. Both
    // are ours: environment flags and our own typed interface.
    //
    // L4PA-1 adds a third: the official Pocket adapter. L4DSP-1 adds a fourth
    // and fifth: the explicit provider-mode contract and the DEV-only simulator,
    // neither of which is network-capable (the simulator's own suite proves that
    // with a live network tripwire).
    //
    // G3 adds a sixth: the canonical product definition, and ONLY for the
    // checkpoint integration-code vocabulary. It is a pure data module — level
    // rows, module rows, approved thresholds and the `gateIntegrationCode`
    // string composer — with a single import of its own (`practical-mapping`,
    // equally pure). It performs no I/O, holds no credential and reaches no
    // network, so it does not weaken the property this assertion protects.
    //
    // It is imported precisely so the allowlist cannot drift from the published
    // curriculum again: before G3 the runtime recognised one integration code
    // while the product declared twenty, and nineteen gates answered
    // `integration_unknown` with nothing to catch it.
    //
    // The list stays asserted EXACTLY rather than loosened to a pattern, so a
    // seventh dependency — an exchange module, an HTTP client, a credential
    // source — still fails this check the moment it appears. The resolver
    // remains free of any network call, which is the property that matters: it
    // decides WHICH provider answers, and never talks to one.
    assert.deepEqual(specifiers.sort(), [
      "./checkpoint-provider",
      "./checkpoint-provider-dev-simulator",
      "./checkpoint-provider-mode",
      "./checkpoint-provider-pocket",
      "./product-ata-100",
      "@/lib/env",
    ]);
    for (const specifier of specifiers) {
      if (specifier === "./checkpoint-provider-pocket") continue;
      assert.ok(!/exchange|pocket/i.test(specifier), `forbidden import: ${specifier}`);
    }
    assert.ok(!/\bfetch\s*\(/.test(source), "the resolver must make no network call");
  });

  await check("D6 database integrity intact", async () => {
    assert.equal(((await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")) as unknown[]).length, 0);
    const integrity = (await prisma.$queryRawUnsafe("PRAGMA integrity_check")) as Array<Record<string, string>>;
    assert.equal(Object.values(integrity[0])[0], "ok");
  });

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
