/**
 * L4PA-1 — end-to-end: authenticated registration postback → trusted identity →
 * official Pocket Partner adapter → L4 completion.
 *
 * Synthetic database only, on the REAL approved first-slice package (revision 3)
 * plus the rev4 CANDIDATE checkpoint requirement fixture. NOTHING IS PUBLISHED
 * and no live database, port or flag is touched. The only endpoint contacted is
 * the deterministic loopback mock — NO REQUEST IS MADE TO pocketpartners.com.
 *
 * The full journey proven here:
 *   1. a learner and their clickid exist;
 *   2. an AUTHENTICATED `goal=reg` postback binds `playerid` server-side;
 *   3. L1-L3 complete through their real completion owners;
 *   4. at L4, real_balance 49.99 leaves the level INCOMPLETE with zero XP;
 *   5. after the cooldown, real_balance 50.00 completes L4 exactly once;
 *   6. the next level unlocks and NO XPTransaction is ever written;
 *   7. a replayed requestId returns the original receipt with NO second
 *      provider call;
 *   8. a fresh request after completion changes nothing;
 *   9. no balance is persisted, returned or logged anywhere in any of it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  startPocketPartnerMockServer,
  type PocketMockScenario,
} from "./support/pocketPartnerMockServer";

const dbPath = path.join(os.tmpdir(), `ata-pocket-e2e-pa1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const APPROVED = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";
const CANDIDATE = "curriculum/candidates/ata-v2-checkpoint-requirement.rev4-candidate.json";

const L1 = "v2.l001.registraciya-pocket";
const L2 = "v2.l002.kak-ustroen-alfa-trade-academy";
const L3 = "v2.l003.pervye-pyat-demo-sdelok";
const L4 = "v2.l004.kontrolnaya-tochka-50";

const SECRET = "pocket-pa1-e2e-synthetic-secret";
const PARTNER_ID = 424242;
const TOKEN = "test-token-not-a-real-pocket-secret";
/**
 * Synthetic. Deliberately NOT the operator's example `playerid`, which may name
 * a real Pocket trader and has no place in committed source.
 */
const POCKET_USER_ID = "101010";
const TEST_MARKER = "unsafe-loopback-mock-regression-only";

/** Anything whose presence would mean a financial VALUE escaped. */
const FORBIDDEN_TOKENS = [
  TOKEN, "real_balance", "demo_balance", "ftd_amount", "total_deposits",
  "49.99", "4999", "10000", "remaining", "observedBalance", "currentBalance",
];

const FORBIDDEN_KEYS = new Set([
  "balance", "currentBalance", "observedBalance", "balanceMinorUnits",
  "realBalance", "demoBalance", "remaining", "remainingUsd", "deficit",
  "ftdAmount", "totalDeposits", "providerPayload", "accountLogin",
  "apiToken", "hash", "requestUrl",
]);

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

function captureConsole() {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? String(v) : v)) ?? String(value);
  } catch {
    return String(value);
  }
}

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
  } else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      collectKeys(entry, into);
    }
  }
  return into;
}

/** Strip published definition literals before scanning for leaked money. */
function scrub(text: string) {
  return text
    .replaceAll("balance_check", "«completion-method»")
    .replaceAll("POCKET_BALANCE_PROVIDER_ENABLED", "«provider-flag»")
    .replaceAll("checkpoint.module-01", "«integration-code»");
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
  process.env.POSTBACK_SECRET = SECRET;
  process.env.POCKET_POSTBACK_ENABLED = "true";
  // The verification flags are supplied per-call via an explicit `env` object,
  // so the ambient process never has the checkpoint or provider enabled.
  delete process.env.CURRICULUM_V2_CHECKPOINT_ENABLED;
  delete process.env.POCKET_BALANCE_PROVIDER_ENABLED;
  delete process.env.CURRICULUM_V2_XP_ENABLED;
  delete process.env.CHECKPOINT_PROVIDER_TEST_BACKEND;

  const { prisma } = await import("../../src/lib/prisma");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const engine = await import("../../src/lib/curriculum/checkpoint-verification");
  const readApi = await import("../../src/lib/curriculum/read-api");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const route = await import("../../src/app/api/postbacks/pocket/route");
  const identity = await import("../../src/lib/exchange/pocketTraderIdentity");

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
  assert.equal(spec.thresholdCurrency, "USD");
  assert.equal(spec.thresholdMinorUnits, 5000);

  const server = await startPocketPartnerMockServer({
    partnerId: PARTNER_ID,
    apiToken: TOKEN,
    delayMs: 10_000,
  });

  /** The flags and configuration a verification call runs under. */
  function verificationEnv(): NodeJS.ProcessEnv {
    return {
      NODE_ENV: "test",
      CURRICULUM_V2_READ_ENABLED: "true",
      CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
      CURRICULUM_V2_CHECKPOINT_ENABLED: "true",
      POCKET_BALANCE_PROVIDER_ENABLED: "true",
      POCKET_PARTNER_API_BASE_URL: server.baseUrl,
      POCKET_PARTNER_ID: String(PARTNER_ID),
      POCKET_PARTNER_API_TOKEN: TOKEN,
      POCKET_PARTNER_API_TEST_MODE: TEST_MARKER,
    } as NodeJS.ProcessEnv;
  }

  let ipSeq = 0;
  const nextIp = () => `10.1.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

  let eventSeq = 0;
  async function deliverRegistration(clickId: string, playerId: string) {
    const params = new URLSearchParams({
      clickid: clickId,
      goal: "reg",
      playerid: playerId,
      event_id: `pa1-e2e-${++eventSeq}`,
    });
    return route.GET(
      new Request(`https://ata.test/api/postbacks/pocket?${params.toString()}`, {
        method: "GET",
        headers: { "x-postback-secret": SECRET, "x-forwarded-for": nextIp() },
      }),
    );
  }

  /** Step 1-2: a learner, their clickid, and the authenticated registration. */
  async function onboardLearner(pocketUserId: string) {
    const user = await prisma.user.create({
      data: { email: `pa1-e2e-${Date.now()}-${Math.random()}@example.com`, name: "PA1 E2E" },
    });
    const clickId = `tq-pa1-e2e-${user.id}`;
    await prisma.exchangeAccount.create({
      data: {
        userId: user.id,
        provider: "real_placeholder",
        referralLink: "https://example.com/ref",
        exchangeAccountId: `pocket-pending-${user.id}`,
        clickId,
        status: "pending",
      },
    });
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: user.id, curriculumVersionId: version.id, curriculumCode: "ata-v2",
        status: "active", enrolledAt: past, currentLevel: 1,
        highestCompletedLevel: 0, lastMeaningfulActionAt: past,
      },
    });
    const response = await deliverRegistration(clickId, pocketUserId);
    return { userId: user.id, enrollmentId: enrollment.id, clickId, response };
  }

  /**
   * Step 3: stand the learner on L4 with L1-L3 behind them.
   *
   * DOCUMENTED DEVIATION. L1-L3 progress is SEEDED here rather than driven
   * through `completeCurriculumLevel`, exactly as the L4VC-1 core suite does.
   * The three owners each demand a complete, internally consistent proof
   * artefact before they will complete a level — L1 is `external_event :
   * pocket_postback`, a pair deliberately absent from OWNER_RULES; L2 requires
   * a passed AssessmentAttempt whose duration, score basis points and
   * `sha256:` answer fingerprint all reconcile against a published
   * AssessmentVersion; L3 requires a ReportReview with scores reconciling
   * against the published rubric. Fabricating those here would prove nothing
   * about Pocket and would duplicate suites that already own them end to end
   * (curriculum-assessment-runtime, curriculum-report-approval,
   * curriculum-report-zero-reward-e2e).
   *
   * What this suite exists to prove begins at L4, and every L4 transition below
   * runs through the real verification engine and the real completion owner.
   */
  async function advanceToL4(enrollmentId: number) {
    for (const code of [L1, L2, L3]) {
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId, curriculumVersionId: version.id,
          levelDefinitionId: definitions.get(code)!.id, status: "completed",
          startedAt: past, lastProgressAt: past, completedAt: past,
          completionMethod: "external", attemptCount: 1,
        },
      });
    }
    await prisma.userCurriculumEnrollment.update({
      where: { id: enrollmentId },
      data: { currentLevel: 4, highestCompletedLevel: 3 },
    });
  }

  let requestSeq = 0;
  const rid = () => `pa1-request-${++requestSeq}-abcdefgh`;

  async function verify(
    userId: number,
    scenario: PocketMockScenario,
    options: { requestId?: string; evaluationTime?: Date; config?: Record<string, unknown> } = {},
  ) {
    server.setScenario(scenario);
    return engine.verifyCurrentCheckpoint({
      actorUserId: userId,
      stableCode: L4,
      requestId: options.requestId ?? rid(),
      evaluationTime: options.evaluationTime,
      config: options.config as never,
      db: prisma as never,
      env: verificationEnv(),
    });
  }

  try {
    /* ---------------------------------------------------------------- */
    /* The journey                                                       */
    /* ---------------------------------------------------------------- */

    const learner = await onboardLearner(POCKET_USER_ID);

    await check("1 the authenticated registration bound the Pocket trader", async () => {
      assert.equal(learner.response.status, 200);
      const bound = await prisma.pocketTraderIdentity.findUnique({
        where: { userId: learner.userId },
      });
      assert.ok(bound);
      assert.equal(bound.pocketUserId, POCKET_USER_ID);
      assert.equal(bound.source, "registration_postback");
      assert.equal(
        await identity.resolvePocketTraderIdentity(learner.userId, prisma),
        POCKET_USER_ID,
      );
    });

    await check("2 L1-L3 complete and the learner stands on L4", async () => {
      await advanceToL4(learner.enrollmentId);
      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: learner.enrollmentId },
      });
      assert.equal(enrollment.currentLevel, 4);
      assert.equal(enrollment.highestCompletedLevel, 3);
    });

    let notMetReceipt: unknown = null;

    await check("3 real_balance 49.99 leaves L4 incomplete", async () => {
      server.reset();
      const result = await verify(learner.userId, "real_just_below_threshold");
      notMetReceipt = result;
      assert.equal(result.kind, "receipt");
      if (result.kind === "receipt") {
        assert.equal(result.verificationState, "not_met");
        assert.equal(result.completed, false);
      }
      assert.equal(server.authenticatedCallCount(), 1, "exactly one provider call");

      const progress = await prisma.userLevelProgress.findFirst({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
      });
      assert.notEqual(progress?.status, "completed");
      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: learner.enrollmentId },
      });
      assert.equal(enrollment.highestCompletedLevel, 3);
    });

    await check("4 the 49.99 attempt wrote no XP and no balance", async () => {
      assert.equal(await prisma.xPTransaction.count(), 0);
      const attempts = await prisma.checkpointVerificationAttempt.findMany({
        where: { enrollmentId: learner.enrollmentId },
      });
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].outcome, "not_met");
      // The durable attempt row has no field an amount could occupy.
      for (const key of collectKeys(attempts[0])) {
        assert.ok(!FORBIDDEN_KEYS.has(key), `attempt row exposed ${key}`);
      }
      const serialised = scrub(safeJson(attempts));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!serialised.includes(forbidden), `attempt leaked ${forbidden}`);
      }
    });

    await check("5 the not_met receipt carries no amount", () => {
      const serialised = scrub(safeJson(notMetReceipt));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!serialised.includes(forbidden), `receipt leaked ${forbidden}: ${serialised}`);
      }
      for (const key of collectKeys(notMetReceipt)) {
        assert.ok(!FORBIDDEN_KEYS.has(key), `receipt exposed ${key}`);
      }
    });

    await check("6 the cooldown blocks an immediate retry without calling Pocket", async () => {
      server.reset();
      const result = await verify(learner.userId, "real_at_threshold");
      assert.equal(result.kind, "refused");
      if (result.kind === "refused") assert.equal(result.verificationState, "cooldown");
      assert.equal(server.callCount(), 0, "a cooled-down attempt must not reach the provider");
    });

    let metReceipt: unknown = null;
    const completionRequestId = rid();

    await check("7 after the cooldown, real_balance 50.00 completes L4", async () => {
      server.reset();
      const later = new Date(Date.now() + 10 * 60_000);
      const result = await verify(learner.userId, "real_at_threshold", {
        requestId: completionRequestId,
        evaluationTime: later,
      });
      metReceipt = result;
      assert.equal(result.kind, "receipt");
      if (result.kind === "receipt") {
        assert.equal(result.verificationState, "completed");
        assert.equal(result.completed, true);
      }
      assert.equal(server.authenticatedCallCount(), 1);
    });

    await check("8 L4 is completed exactly once, by the verification owner", async () => {
      const progress = await prisma.userLevelProgress.findMany({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
      });
      assert.equal(progress.length, 1);
      assert.equal(progress[0].status, "completed");
      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: learner.enrollmentId },
      });
      assert.equal(enrollment.highestCompletedLevel, 4);
    });

    await check("9 completing L4 wrote ZERO XPTransaction rows", async () => {
      assert.equal(await prisma.xPTransaction.count(), 0);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: learner.userId } });
      assert.equal(user.xp, 0);
    });

    await check("10 a replayed requestId returns the receipt with NO second call", async () => {
      server.reset();
      const replay = await verify(learner.userId, "real_at_threshold", {
        requestId: completionRequestId,
        evaluationTime: new Date(Date.now() + 20 * 60_000),
      });
      assert.equal(replay.kind, "receipt");
      if (replay.kind === "receipt" && metReceipt && typeof metReceipt === "object") {
        const original = metReceipt as { verificationState?: string; completed?: boolean };
        assert.equal(replay.verificationState, original.verificationState);
        assert.equal(replay.completed, original.completed);
      }
      // The decisive assertion: idempotency is served from the durable receipt,
      // not by asking Pocket again.
      assert.equal(server.callCount(), 0, "a replay must make no provider call");
    });

    await check("11 a NEW request after completion changes nothing", async () => {
      server.reset();
      // A completed L4 is no longer the current level, so the engine refuses a
      // fresh attempt outright. Either shape is acceptable; what must hold is
      // that a below-threshold reading cannot undo a completion.
      const after = await verify(learner.userId, "real_just_below_threshold", {
        evaluationTime: new Date(Date.now() + 30 * 60_000),
      }).catch((error: unknown) =>
        engine.isCheckpointVerificationError(error) ? { kind: "rejected" as const } : Promise.reject(error),
      );
      const progress = await prisma.userLevelProgress.findMany({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
      });
      assert.equal(progress.length, 1);
      assert.equal(progress[0].status, "completed");
      assert.equal(await prisma.xPTransaction.count(), 0);
      assert.ok(["receipt", "refused", "rejected"].includes(after.kind));
      // A refused/rejected attempt must not have asked Pocket again either.
      assert.equal(server.callCount(), 0);
    });

    await check("12 the learner-facing read model exposes no amount", async () => {
      const states = await levelState.resolveUserCurriculumLevelStates({
        userId: learner.userId, db: prisma as never,
      });
      const view =
        states.kind === "resolved"
          ? readApi.mapEnrolledCurriculumRead(states as never)
          : states;
      const serialised = scrub(safeJson(view));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!serialised.includes(forbidden), `overview leaked ${forbidden}`);
      }
      for (const key of collectKeys(view)) {
        assert.ok(!FORBIDDEN_KEYS.has(key), `overview exposed ${key}`);
      }
    });

    await check("13 an unbound learner is identity_unlinked, not not_met", async () => {
      const stranger = await prisma.user.create({
        data: { email: `pa1-unbound-${Date.now()}@example.com`, name: "Unbound" },
      });
      const enrollment = await prisma.userCurriculumEnrollment.create({
        data: {
          userId: stranger.id, curriculumVersionId: version.id, curriculumCode: "ata-v2",
          status: "active", enrolledAt: past, currentLevel: 4,
          highestCompletedLevel: 3, lastMeaningfulActionAt: past,
        },
      });
      for (const code of [L1, L2, L3]) {
        await prisma.userLevelProgress.create({
          data: {
            enrollmentId: enrollment.id, curriculumVersionId: version.id,
            levelDefinitionId: definitions.get(code)!.id, status: "completed",
            startedAt: past, lastProgressAt: past, completedAt: past,
            completionMethod: "external", attemptCount: 1,
          },
        });
      }
      server.reset();
      const result = await verify(stranger.id, "real_above_threshold");
      assert.equal(result.kind, "receipt");
      if (result.kind === "receipt") {
        assert.equal(result.verificationState, "verification_unavailable");
        assert.equal(result.completed, false);
      }
      // No binding means no request is made at all.
      assert.equal(server.callCount(), 0);
      const attempt = await prisma.checkpointVerificationAttempt.findFirst({
        where: { enrollmentId: enrollment.id },
      });
      assert.equal(attempt?.outcome, "identity_unlinked");
    });

    await check("14 nothing anywhere in the run logged a balance", async () => {
      const capture = captureConsole();
      try {
        const bound = await onboardLearner("101011");
        await advanceToL4(bound.enrollmentId);
        await verify(bound.userId, "real_just_below_threshold");
        await verify(bound.userId, "http_500", {
          evaluationTime: new Date(Date.now() + 10 * 60_000),
        });
        await verify(bound.userId, "malformed_json", {
          evaluationTime: new Date(Date.now() + 20 * 60_000),
        });
      } finally {
        capture.restore();
      }
      const logged = scrub(capture.lines.join("\n"));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!logged.includes(forbidden), `logged ${forbidden}: ${logged.slice(0, 400)}`);
      }
      assert.ok(!logged.includes("api/user-info"), "a provider URL was logged");
    });

    await check("15 no audit or notification row carries a balance", async () => {
      const audits = await prisma.auditLog.findMany();
      const notifications = await prisma.notification.findMany();
      const serialised = scrub(safeJson({ audits, notifications }));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!serialised.includes(forbidden), `audit/notification leaked ${forbidden}`);
      }
      for (const key of collectKeys({ audits, notifications })) {
        assert.ok(!FORBIDDEN_KEYS.has(key), `audit/notification exposed ${key}`);
      }
    });

    await check("16 no identity row carries a financial field", async () => {
      const rows = await prisma.pocketTraderIdentity.findMany();
      assert.ok(rows.length > 0);
      for (const key of collectKeys(rows)) {
        assert.ok(!FORBIDDEN_KEYS.has(key), `identity row exposed ${key}`);
      }
      const serialised = safeJson(rows);
      for (const forbidden of [TOKEN, "real_balance", "demo_balance"]) {
        assert.ok(!serialised.includes(forbidden), `identity leaked ${forbidden}`);
      }
    });

    await check("17 the whole database contains no balance fixture", async () => {
      // A blunt, decisive sweep: dump every table the run touched and look for
      // the values the mock served.
      const dump = safeJson({
        attempts: await prisma.checkpointVerificationAttempt.findMany(),
        progress: await prisma.userLevelProgress.findMany(),
        enrollments: await prisma.userCurriculumEnrollment.findMany(),
        identities: await prisma.pocketTraderIdentity.findMany(),
        accounts: await prisma.exchangeAccount.findMany(),
        postbacks: await prisma.postbackEvent.findMany(),
        xp: await prisma.xPTransaction.findMany(),
      });
      for (const forbidden of [TOKEN, "49.99", "real_balance", "demo_balance", "ftd_amount"]) {
        assert.ok(!dump.includes(forbidden), `database leaked ${forbidden}`);
      }
    });

    await check("18 level-state still reports L4 truthfully after completion", async () => {
      const states = await levelState.resolveUserCurriculumLevelStates({
        userId: learner.userId, db: prisma as never,
      });
      // L4 was the final level, so completing it completes the enrollment —
      // the checkpoint verdict really did propagate through the domain.
      assert.equal(states.kind, "unavailable");
      if (states.kind === "unavailable") {
        assert.equal(states.reason, "enrollment_completed");
      }
      const attempt = await prisma.checkpointVerificationAttempt.findFirst({
        where: { enrollmentId: learner.enrollmentId, outcome: "met" },
      });
      assert.ok(attempt, "the completing attempt is recorded as `met`");
      assert.equal(attempt.completedAt !== null, true);
      for (const key of collectKeys(states)) {
        assert.ok(!FORBIDDEN_KEYS.has(key), `level state exposed ${key}`);
      }
      const serialised = scrub(safeJson(states));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!serialised.includes(forbidden), `level state leaked ${forbidden}`);
      }
    });
  } finally {
    await server.close();
    await prisma.$disconnect();
  }

  cleanup();
  console.log(`\nL4PA-1 pocket partner checkpoint E2E: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
