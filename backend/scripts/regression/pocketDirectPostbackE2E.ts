/**
 * PDP-1 — end-to-end: direct Pocket registration postback → PocketTraderIdentity
 * → Partner API adapter → L4 completion.
 *
 * Synthetic database only, on the REAL approved first-slice package (revision 3)
 * plus the rev4 CANDIDATE requirement fixture. Nothing is published. The only
 * endpoint contacted is the deterministic loopback Partner API mock:
 * **no request is made to pocketpartners.com or thedinator.com**, and no live
 * database, port or flag is touched.
 *
 * The whole chain in one place:
 *   1. a learner exists with an ATA-format clickid;
 *   2. Pocket sends `goal=reg` DIRECTLY with its official `ow` query secret;
 *   3. exactly one PocketTraderIdentity is created;
 *   4. an identical replay changes nothing;
 *   5. at L4 the adapter resolves the Partner API `user_id` from that identity
 *      — proven by what the mock actually received in the request path;
 *   6. real_balance 50 completes L4 exactly once with zero XP;
 *   7. a learner whose registration presented an INVALID ow has no identity and
 *      cannot complete L4.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startPocketPartnerMockServer } from "./support/pocketPartnerMockServer";

const dbPath = path.join(os.tmpdir(), `ata-pdp1-e2e-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const APPROVED = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";
const CANDIDATE = "curriculum/candidates/ata-v2-checkpoint-requirement.rev4-candidate.json";

const L1 = "v2.l001.registraciya-pocket";
const L2 = "v2.l002.kak-ustroen-alfa-trade-academy";
const L3 = "v2.l003.pervye-pyat-demo-sdelok";
const L4 = "v2.l004.kontrolnaya-tochka-50";

const SECRET = "pdp1-e2e&postback%secret-01";
const WRONG_SECRET = "pdp1-e2e&postback%secret-02";
const PARTNER_ID = 424242;
const TOKEN = "test-token-not-a-real-pocket-secret";
const TEST_MARKER = "unsafe-loopback-mock-regression-only";
const POCKET_USER_ID = "101010";

const FORBIDDEN_TOKENS = [
  SECRET, TOKEN, "real_balance", "demo_balance", "ftd_amount", "total_deposits",
  "49.99", "10000", "observedBalance", "currentBalance", "ow=",
];
const FORBIDDEN_KEYS = new Set([
  "balance", "currentBalance", "observedBalance", "balanceMinorUnits",
  "realBalance", "demoBalance", "remaining", "deficit", "apiToken", "hash", "requestUrl",
]);

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e instanceof Error ? (e.stack ?? e.message) : e); }
}
function cleanup() {
  for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
}
function safeJson(v: unknown) { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } }
function collectKeys(v: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((e) => collectKeys(e, into));
  else if (v && typeof v === "object" && !(v instanceof Date))
    for (const [k, e] of Object.entries(v)) { into.add(k); collectKeys(e, into); }
  return into;
}
function scrub(t: string) {
  return t.replaceAll("balance_check", "«m»")
          .replaceAll("POCKET_BALANCE_PROVIDER_ENABLED", "«f»")
          .replaceAll("checkpoint.module-01", "«i»");
}
function captureConsole() {
  const lines: string[] = [];
  const o = { log: console.log, warn: console.warn, error: console.error };
  const rec = (...a: unknown[]) => lines.push(a.map((x) => (typeof x === "string" ? x : safeJson(x))).join(" "));
  console.log = rec; console.warn = rec; console.error = rec;
  return { lines, restore() { console.log = o.log; console.warn = o.warn; console.error = o.error; } };
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
  process.env.POSTBACK_SECRET = SECRET;
  process.env.POCKET_POSTBACK_ENABLED = "true";
  // POCKET-REG-SECURITY-CLOSURE-1 (§14): this suite OWNS its fixture flags.
  // It set only the master gate, so after G4 made ingest granular it was green
  // solely because an operator exported the family switches — and red for
  // anyone who ran it plainly. Families this suite does not exercise are
  // DELETED rather than left inherited, so an exported flag cannot turn one of
  // its refusal assertions into an acceptance.
  process.env.POCKET_REG_INGEST_ENABLED = "true";
  delete process.env.POCKET_DEP_INGEST_ENABLED;
  delete process.env.POCKET_RDEP_INGEST_ENABLED;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
  // The checkpoint and provider capabilities are supplied per call via an
  // explicit env object, so the ambient process never has them enabled.
  delete process.env.CURRICULUM_V2_CHECKPOINT_ENABLED;
  delete process.env.POCKET_BALANCE_PROVIDER_ENABLED;
  delete process.env.CURRICULUM_V2_XP_ENABLED;

  const { prisma } = await import("../../src/lib/prisma");
  const route = await import("../../src/app/api/postbacks/pocket/route");
  const engine = await import("../../src/lib/curriculum/checkpoint-verification");
  const identity = await import("../../src/lib/exchange/pocketTraderIdentity");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");

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

  const defs = new Map<string, number>();
  for (const c of [L1, L2, L3, L4]) {
    const d = await prisma.levelDefinition.findFirstOrThrow({
      where: { curriculumVersionId: version.id, stableCode: c },
    });
    defs.set(c, d.id);
  }
  const l4Id = defs.get(L4)!;

  const candidate = JSON.parse(fs.readFileSync(CANDIDATE, "utf8"));
  const spec = candidate.requirements[0];
  assert.equal(candidate.status, "candidate");
  assert.equal(spec.thresholdCurrency, "USD");
  assert.equal(spec.thresholdMinorUnits, 5000);
  await prisma.levelCheckpointRequirement.create({
    data: {
      levelDefinitionId: l4Id, integrationCode: spec.integrationCode,
      thresholdCurrency: spec.thresholdCurrency, thresholdMinorUnits: spec.thresholdMinorUnits,
    },
  });

  const server = await startPocketPartnerMockServer({
    partnerId: PARTNER_ID, apiToken: TOKEN, delayMs: 10_000,
  });

  const verificationEnv = (): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    CURRICULUM_V2_READ_ENABLED: "true", CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
    CURRICULUM_V2_CHECKPOINT_ENABLED: "true", POCKET_BALANCE_PROVIDER_ENABLED: "true",
    POCKET_PARTNER_API_BASE_URL: server.baseUrl, POCKET_PARTNER_ID: String(PARTNER_ID),
    POCKET_PARTNER_API_TOKEN: TOKEN, POCKET_PARTNER_API_TEST_MODE: TEST_MARKER,
  } as NodeJS.ProcessEnv);

  let ipSeq = 0;
  const nextIp = () => `10.5.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  let seq = 0;

  /** A learner standing on L4 with an ATA-format clickid, ready to be bound. */
  async function onboard() {
    seq += 1;
    const user = await prisma.user.create({
      data: { email: `pdp1-e2e-${seq}-${Date.now()}@example.invalid`, name: "PDP1 E2E" },
    });
    // The exact format `POST /api/exchange/referral-link` generates.
    const clickId = `tq-${crypto.randomUUID()}`;
    await prisma.exchangeAccount.create({
      data: {
        userId: user.id, provider: "real_placeholder",
        referralLink: "https://example.invalid/ref",
        exchangeAccountId: `pocket-pending-${user.id}`, clickId, status: "pending",
      },
    });
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: user.id, curriculumVersionId: version.id, curriculumCode: "ata-v2",
        status: "active", enrolledAt: past, currentLevel: 4,
        highestCompletedLevel: 3, lastMeaningfulActionAt: past,
      },
    });
    for (const c of [L1, L2, L3]) {
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId: enrollment.id, curriculumVersionId: version.id,
          levelDefinitionId: defs.get(c)!, status: "completed",
          startedAt: past, lastProgressAt: past, completedAt: past,
          completionMethod: "external", attemptCount: 1,
        },
      });
    }
    return { userId: user.id, enrollmentId: enrollment.id, clickId };
  }

  /** The official DIRECT Pocket registration postback. */
  function sendRegistration(clickId: string, playerId: string, secret = SECRET) {
    const p = new URLSearchParams({
      clickid: clickId, goal: "reg", ow: secret, playerid: playerId,
    });
    return route.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
      method: "GET", headers: { "x-forwarded-for": nextIp() },
    }));
  }

  let rq = 0;
  const NO_COOLDOWN = { cooldownSeconds: 0, rateLimitAttempts: 1000 };
  const verify = (userId: number, scenario: Parameters<typeof server.setScenario>[0], requestId?: string) => {
    server.setScenario(scenario);
    return engine.verifyCurrentCheckpoint({
      actorUserId: userId, stableCode: L4,
      requestId: requestId ?? `pdp1-request-${++rq}-abcdefgh`,
      config: NO_COOLDOWN as never, db: prisma as never, env: verificationEnv(),
    });
  };

  try {
    const learner = await onboard();

    await check("1 the direct Pocket registration binds exactly one identity", async () => {
      const r = await sendRegistration(learner.clickId, POCKET_USER_ID);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true });
      const rows = await prisma.pocketTraderIdentity.findMany({ where: { userId: learner.userId } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].pocketUserId, POCKET_USER_ID);
      assert.equal(rows[0].source, "registration_postback");
    });

    await check("2 an identical replay is idempotent and changes nothing", async () => {
      const before = await prisma.pocketTraderIdentity.findUniqueOrThrow({ where: { userId: learner.userId } });
      const r = await sendRegistration(learner.clickId, POCKET_USER_ID);
      assert.equal(r.status, 200);
      const after = await prisma.pocketTraderIdentity.findUniqueOrThrow({ where: { userId: learner.userId } });
      assert.equal(after.id, before.id);
      assert.equal(after.boundAt.getTime(), before.boundAt.getTime());
      assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
    });

    await check("3 the adapter resolves the Partner API user_id from that identity", async () => {
      assert.equal(
        await identity.resolvePocketTraderIdentity(learner.userId, prisma),
        POCKET_USER_ID,
      );
      server.reset();
      await verify(learner.userId, "real_just_below_threshold");
      const observed = server.lastObservation();
      assert.ok(observed);
      // Decisive: the id in the request path is the BOUND one, and the mock
      // independently recomputed the same MD5 over it.
      assert.equal(observed.userIdSegment, POCKET_USER_ID);
      assert.equal(observed.partnerIdSegment, String(PARTNER_ID));
      assert.equal(observed.hashMatched, true);
      assert.equal(server.authenticatedCallCount(), 1);
    });

    await check("4 real_balance 49.99 leaves L4 incomplete with zero XP", async () => {
      const progress = await prisma.userLevelProgress.findFirst({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
      });
      assert.notEqual(progress?.status, "completed");
      assert.equal(await prisma.xPTransaction.count(), 0);
    });

    const completionRid = "pdp1-completion-request-abcdefgh";

    await check("5 real_balance 50.00 completes L4 exactly once", async () => {
      server.reset();
      const r = await verify(learner.userId, "real_at_threshold", completionRid);
      assert.equal(r.kind, "receipt");
      if (r.kind === "receipt") {
        assert.equal(r.verificationState, "completed");
        assert.equal(r.completed, true);
      }
      assert.equal(server.authenticatedCallCount(), 1);
      const progress = await prisma.userLevelProgress.findMany({
        where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
      });
      assert.equal(progress.length, 1);
      assert.equal(progress[0].status, "completed");
      const enr = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: learner.enrollmentId } });
      assert.equal(enr.highestCompletedLevel, 4);
    });

    await check("6 completion wrote ZERO XPTransaction", async () => {
      assert.equal(await prisma.xPTransaction.count(), 0);
      const u = await prisma.user.findUniqueOrThrow({ where: { id: learner.userId } });
      assert.equal(u.xp, 0);
    });

    await check("7 a replayed verification makes no second provider call", async () => {
      server.reset();
      const r = await verify(learner.userId, "real_at_threshold", completionRid);
      assert.equal(r.kind, "receipt");
      assert.equal(server.callCount(), 0);
      assert.equal(
        (await prisma.userLevelProgress.findMany({
          where: { enrollmentId: learner.enrollmentId, levelDefinitionId: l4Id },
        })).length, 1,
      );
    });

    await check("8 an INVALID ow creates no identity and cannot complete L4", async () => {
      const stranger = await onboard();
      const r = await sendRegistration(stranger.clickId, "202020", WRONG_SECRET);
      assert.equal(r.status, 403);
      assert.equal(await prisma.pocketTraderIdentity.findUnique({ where: { userId: stranger.userId } }), null);

      server.reset();
      const result = await verify(stranger.userId, "real_above_threshold");
      assert.equal(result.kind, "receipt");
      if (result.kind === "receipt") {
        assert.equal(result.verificationState, "verification_unavailable");
        assert.equal(result.completed, false);
      }
      // No binding means the adapter never asks Pocket anything.
      assert.equal(server.callCount(), 0);
      const attempt = await prisma.checkpointVerificationAttempt.findFirst({
        where: { enrollmentId: stranger.enrollmentId },
      });
      assert.equal(attempt?.outcome, "identity_unlinked");
      const progress = await prisma.userLevelProgress.findMany({
        where: { enrollmentId: stranger.enrollmentId, levelDefinitionId: l4Id },
      });
      assert.equal(progress.filter((p) => p.status === "completed").length, 0);
    });

    await check("9 no balance is persisted anywhere in the database", async () => {
      const dump = scrub(safeJson({
        attempts: await prisma.checkpointVerificationAttempt.findMany(),
        identities: await prisma.pocketTraderIdentity.findMany(),
        requirements: await prisma.levelCheckpointRequirement.findMany(),
        progress: await prisma.userLevelProgress.findMany(),
        accounts: await prisma.exchangeAccount.findMany(),
        postbacks: await prisma.postbackEvent.findMany(),
        audits: await prisma.auditLog.findMany(),
        xp: await prisma.xPTransaction.findMany(),
      }));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!dump.includes(forbidden), `database leaked ${forbidden}`);
      }
    });

    await check("10 the learner-facing read model exposes no balance", async () => {
      const states = await levelState.resolveUserCurriculumLevelStates({
        userId: learner.userId, db: prisma as never,
      });
      const serialised = scrub(safeJson(states));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!serialised.includes(forbidden), `read model leaked ${forbidden}`);
      }
      for (const key of collectKeys(states)) {
        assert.ok(!FORBIDDEN_KEYS.has(key), `read model exposed ${key}`);
      }
    });

    await check("11 nothing logged a balance, secret or postback URL", async () => {
      const capture = captureConsole();
      try {
        const other = await onboard();
        await sendRegistration(other.clickId, "303030");
        await verify(other.userId, "real_just_below_threshold");
        await verify(other.userId, "http_500");
        await verify(other.userId, "malformed_json");
      } finally { capture.restore(); }
      const logged = scrub(capture.lines.join("\n"));
      for (const forbidden of FORBIDDEN_TOKENS) {
        assert.ok(!logged.includes(forbidden), `logged ${forbidden}`);
      }
      assert.ok(!logged.includes("api/user-info"), "a provider URL was logged");
      assert.ok(!logged.includes("api/postbacks/pocket?"), "a postback query string was logged");
    });

    await check("12 the postback secret is never persisted", async () => {
      const dump = safeJson({
        audits: await prisma.auditLog.findMany(),
        postbacks: await prisma.postbackEvent.findMany(),
        identities: await prisma.pocketTraderIdentity.findMany(),
      });
      assert.ok(!dump.includes(SECRET), "the postback secret was persisted");
      assert.ok(!dump.includes(WRONG_SECRET), "a supplied wrong secret was persisted");
    });
  } finally {
    await server.close();
    await prisma.$disconnect();
  }

  cleanup();
  console.log(`\nPDP-1 direct postback E2E: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); cleanup(); process.exitCode = 1; });
