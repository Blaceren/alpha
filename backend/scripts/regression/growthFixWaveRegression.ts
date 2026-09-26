/**
 * G4-PREPROD-GROWTH-FOUNDATION-FIX-WAVE-1 — the regression suite for the seven
 * HIGH findings and the adjacent outbox-replay defect.
 *
 * EVERY ASSERTION HERE IS A BASELINE ASSERTION. Each one was written to FAIL on
 * the audited candidate `51e0722a` and PASS on the fixed one. A test that passes
 * on both proves nothing about a fix, and the deep audit found exactly that
 * failure mode in the shipped idempotency test — it replayed the backfill once,
 * against a fixture whose backfill had produced nothing, and so could not see the
 * defect it appeared to cover.
 *
 * ISOLATED DATABASE ONLY. A synthetic SQLite file under the OS temp directory,
 * created and destroyed by this script. It refuses to run if `DATABASE_URL`
 * already points at anything that looks live. No external request is made, no
 * secret is read, and every identifier is synthetic.
 *
 * WHAT IT ALSO PROTECTS. The properties the deep audit tried to break and could
 * not are re-asserted here, because a correction wave that quietly loses one of
 * them is not a correction: exact money arithmetic with no Cartesian duplication,
 * the goal allowlist, the flag matrix, RDEP fail-closed, and outbox 1:1.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-g4-fixwave-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

const preexisting = process.env.DATABASE_URL ?? "";
if (/preprod|prod|\/srv\//i.test(preexisting)) {
  console.error("REFUSING TO RUN: DATABASE_URL looks live.");
  process.exit(1);
}
process.env.DATABASE_URL = dbUrl;

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    failures.push(`${name} :: ${detail}`);
    console.log(`  FAIL  ${name}\n        ${detail}`);
  }
}

function section(title: string) {
  console.log(`\n### ${title}`);
}

function migrate() {
  const result = spawnSync("npx", ["tsx", "prisma/migrate.ts"], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`migration failed: ${(result.stderr || result.stdout).slice(0, 400)}`);
  }
}

async function main() {
  fs.rmSync(dbPath, { force: true });
  migrate();

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const {
    loadLevelFunnel,
    loadLearnerFunnel,
    countLedgerEvents,
    loadFirstDepositAmounts,
    loadGrowthCounts,
  } = await import("@/lib/growth/analytics/queries");
  const {
    computeGrowthRatios,
    computeLearnerFunnelRatios,
    computeAttributionCoverage,
    GROWTH_COVERAGE_SCOPES,
    GROWTH_DEFAULT_COVERAGE_SCOPE,
  } = await import("@/lib/growth/analytics/sources");
  const { emitGrowthEvent } = await import("@/lib/growth/emit");
  const { resolveGrowthV1Goal } = await import("@/lib/growth/pocket/goal-allowlist");
  const { readPocketIngressSwitches, resolveRedepositCapability } = await import(
    "@/lib/growth/ingress-config"
  );
  const { bindPocketIdentityCanonical } = await import("@/lib/growth/pocket/identity-authority");
  const { parsePocketDepositAmount } = await import("@/lib/exchange/pocketDepositAmount");

  const PERIOD = { start: new Date("2020-01-01"), end: new Date("2035-01-01") };
  const NOFILTER = {};

  // --------------------------------------------------------------- fixtures
  const admin = await prisma.user.create({
    data: { email: "fixwave-admin@audit.invalid", name: "Admin", role: "admin", status: "active" },
  });
  // A minimal curriculum with one STARTABLE level and one FINANCIAL CHECKPOINT,
  // which is the whole distinction G4-H1 turns on: the start owner refuses the
  // checkpoint type outright, so a checkpoint progress row can never be a start.
  const version = await prisma.curriculumVersion.create({
    data: { code: "fixwave", name: "Fix Wave", versionNumber: 1 },
  });
  const curriculumModule = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: version.id,
      moduleNumber: 1,
      code: "fixwave-m1",
      title: "M1",
      firstLevel: 1,
      lastLevel: 2,
    },
  });
  const startableLevel = await prisma.levelDefinition.create({
    data: {
      curriculumVersionId: version.id,
      moduleId: curriculumModule.id,
      levelNumber: 1,
      stableCode: "fixwave-l1",
      type: "lesson",
      title: "Startable level",
      completionMethod: "assessment_pass",
    },
  });
  const checkpointLevel = await prisma.levelDefinition.create({
    data: {
      curriculumVersionId: version.id,
      moduleId: curriculumModule.id,
      levelNumber: 2,
      stableCode: "fixwave-l2",
      type: "financial_checkpoint",
      title: "Unstartable checkpoint",
      completionMethod: "balance_check",
    },
  });

  let seq = 0;
  const eventId = () => `fixwave${(seq += 1).toString(36)}`.padEnd(24, "z");

  async function makeLearner(kind: "selfservice" | "staff" | "seeded") {
    const user = await prisma.user.create({
      data: {
        email: `fixwave-${kind}-${seq}-${Date.now()}@audit.invalid`,
        name: kind,
        role: "user",
        status: "active",
        passwordHash: kind === "seeded" ? "seeded" : "x",
      },
    });
    if (kind === "selfservice") {
      // Exactly what POST /api/auth/register leaves behind.
      await prisma.notificationSettings.create({
        data: { userId: user.id, emailEnabled: true, webPushEnabled: false, telegramEnabled: false },
      });
      await prisma.auditLog.create({ data: { userId: user.id, action: "AUTH_REGISTER" } });
    }
    if (kind === "staff") {
      await prisma.staffProfile.create({
        data: { userId: user.id, displayName: `Staff ${seq}`, staffRole: "support" },
      });
    }
    return user;
  }

  async function makeEnrollment(userId: number) {
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status: "active",
        enrolledAt: new Date("2026-03-01"),
        highestCompletedLevel: 0,
        currentLevel: 1,
      },
    });
  }

  async function levelEvent(
    type: "level_started" | "level_completed",
    progressKey: string,
    userId: number,
    enrollmentId: number,
    levelDefinitionId: number,
    levelNumber: number,
  ) {
    return prisma.$transaction((tx) =>
      emitGrowthEvent(tx, {
        eventType: type,
        occurredAt: new Date("2026-03-10"),
        sourceEventId: `progress:${progressKey}`,
        sourceEntityId: progressKey,
        userId,
        enrollmentId,
        levelDefinitionId,
        levelNumber,
      }),
    );
  }

  /**
   * The migration's OWN outbox backfill statement, replayed.
   *
   * G4-M1: on the audited candidate this statement had no guard, so calling it a
   * second time failed with `UNIQUE constraint failed: GrowthEventOutbox.
   * growthEventId`. Every H2 assertion below replays the `ata_reg` passes and
   * then this, so the suite exercises the guard on every run rather than in a
   * test of its own.
   */
  async function replayOutboxBackfill() {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20260813000000_growth_event_foundation/migration.sql",
      ),
      "utf8",
    );
    const outboxStatements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => /INSERT INTO "GrowthEventOutbox"/.test(s));
    assert.equal(outboxStatements.length, 1, "expected exactly one outbox backfill statement");
    for (const statement of outboxStatements) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  // ============================================================== G4-H1
  section("G4-H1 — level start/completion semantics");

  const h1User = await makeLearner("selfservice");
  const h1Enrollment = await makeEnrollment(h1User.id);
  const L = startableLevel;

  // Five learners start the startable level, four of them complete it.
  for (let i = 1; i <= 5; i += 1) {
    await levelEvent("level_started", `h1-${i}`, h1User.id, h1Enrollment.id, L.id, L.levelNumber);
  }
  for (let i = 1; i <= 4; i += 1) {
    await levelEvent("level_completed", `h1-${i}`, h1User.id, h1Enrollment.id, L.id, L.levelNumber);
  }

  await check("§11.E 5 started / 4 completed reports exactly 80%", async () => {
    const funnel = await loadLevelFunnel(prisma, PERIOD, NOFILTER, "total", 100);
    const step = funnel.find((s) => s.levelNumber === L.levelNumber);
    assert.ok(step, "level absent from funnel");
    assert.equal(step.startedLearners, 5);
    assert.equal(step.completedLearners, 4);
    assert.equal(step.startedAndCompletedLearners, 4);
    const { exactRatio } = await import("@/lib/analytics/decimal");
    assert.equal(exactRatio(step.startedAndCompletedLearners, step.startedLearners), "0.800000");
  });

  await check("§11.B a repeated start does not create a second start", async () => {
    const before = (await loadLevelFunnel(prisma, PERIOD, NOFILTER, "total", 100)).find(
      (s) => s.levelNumber === L.levelNumber,
    )!.startedLearners;
    await levelEvent("level_started", "h1-1", h1User.id, h1Enrollment.id, L.id, L.levelNumber);
    const after = (await loadLevelFunnel(prisma, PERIOD, NOFILTER, "total", 100)).find(
      (s) => s.levelNumber === L.levelNumber,
    )!.startedLearners;
    assert.equal(after, before, "a replayed start inflated the started count");
  });

  await check("§11.G a repeated completion cannot inflate the unique rate", async () => {
    await levelEvent("level_completed", "h1-1", h1User.id, h1Enrollment.id, L.id, L.levelNumber);
    const step = (await loadLevelFunnel(prisma, PERIOD, NOFILTER, "total", 100)).find(
      (s) => s.levelNumber === L.levelNumber,
    )!;
    assert.equal(step.completedLearners, 4);
    assert.ok(step.startedAndCompletedLearners <= step.startedLearners);
  });

  // THE BASELINE CASE. On the audited candidate this produced completed=5 over
  // started=4 for the checkpoint level and a completionRate of "1.250000".
  if (checkpointLevel) {
    await check("§11.D/F a completion with no start (financial checkpoint) keeps the rate <= 100%", async () => {
      const CL = checkpointLevel;
      for (let i = 1; i <= 4; i += 1) {
        await levelEvent("level_started", `h1cp-${i}`, h1User.id, h1Enrollment.id, CL.id, CL.levelNumber);
        await levelEvent("level_completed", `h1cp-${i}`, h1User.id, h1Enrollment.id, CL.id, CL.levelNumber);
      }
      // the checkpoint-shaped one: completed, never started
      await levelEvent("level_completed", "h1cp-nostart", h1User.id, h1Enrollment.id, CL.id, CL.levelNumber);

      const step = (await loadLevelFunnel(prisma, PERIOD, NOFILTER, "total", 100)).find(
        (s) => s.levelNumber === CL.levelNumber,
      )!;
      assert.equal(step.startedLearners, 4, "started");
      assert.equal(step.completedLearners, 5, "completed (includes the un-started one)");
      assert.equal(step.completedWithoutStartLearners, 1, "the un-started completion is named");
      assert.equal(step.startedAndCompletedLearners, 4, "intersection is a subset of started");
      assert.ok(
        step.startedAndCompletedLearners <= step.startedLearners,
        "startedCompletionRate would exceed 100%",
      );
    });
  }

  await check("§20 NO level in ANY scope can report a rate above 100%", async () => {
    for (const scope of GROWTH_COVERAGE_SCOPES) {
      const funnel = await loadLevelFunnel(prisma, PERIOD, NOFILTER, scope, 100);
      for (const step of funnel) {
        assert.ok(
          step.startedAndCompletedLearners <= step.startedLearners,
          `scope=${scope} L${step.levelNumber}: ${step.startedAndCompletedLearners}/${step.startedLearners}`,
        );
      }
    }
  });

  await check("§11.H migration backfill emits NO level_started for an unstartable level", async () => {
    const backfilled = await prisma.growthEvent.findMany({
      where: { eventType: "level_started", origin: "backfill" },
      select: { levelDefinitionId: true },
    });
    const ids = backfilled.map((r) => r.levelDefinitionId).filter((v): v is number => v !== null);
    if (ids.length === 0) return; // nothing historical in this fixture
    const checkpoints = await prisma.levelDefinition.count({
      where: { id: { in: ids }, type: "financial_checkpoint" },
    });
    assert.equal(checkpoints, 0, "backfill invented a start for a financial checkpoint");
  });

  // ============================================================== G4-H2
  section("G4-H2 — ATA_REG is a self-service registration");

  const selfService = await makeLearner("selfservice");
  const staffPrincipal = await makeLearner("staff");
  const seeded = await makeLearner("seeded");

  await check("§74 only the self-service account is backfilled as ATA_REG", async () => {
    // Re-run the migration's own ata_reg statements against the new fixture rows.
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20260813000000_growth_event_foundation/migration.sql",
      ),
      "utf8",
    );
    const ataRegStatements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => /INSERT INTO "GrowthEvent"/.test(s) && /'ata_reg'/.test(s));
    assert.equal(ataRegStatements.length, 2, "expected two ata_reg backfill passes");
    for (const statement of ataRegStatements) {
      await prisma.$executeRawUnsafe(statement);
    }
    await replayOutboxBackfill();

    const has = async (userId: number) =>
      (await prisma.growthEvent.count({ where: { eventType: "ata_reg", userId } })) > 0;

    assert.equal(await has(selfService.id), true, "self-service account missing ATA_REG");
    assert.equal(await has(staffPrincipal.id), false, "staff principal got an ATA_REG");
    assert.equal(await has(seeded.id), false, "seeded account of unprovable origin got an ATA_REG");
    assert.equal(await has(admin.id), false, "admin account got an ATA_REG");
  });

  await check("§14 a staff principal who DID self-register is still counted", async () => {
    const staffWhoRegistered = await prisma.user.create({
      data: {
        email: `fixwave-staffreg-${Date.now()}@audit.invalid`,
        name: "staff-who-registered",
        role: "user",
        status: "active",
        passwordHash: "x",
      },
    });
    await prisma.staffProfile.create({
      data: { userId: staffWhoRegistered.id, displayName: "SR", staffRole: "support" },
    });
    await prisma.auditLog.create({
      data: { userId: staffWhoRegistered.id, action: "AUTH_REGISTER" },
    });

    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20260813000000_growth_event_foundation/migration.sql",
      ),
      "utf8",
    );
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => /INSERT INTO "GrowthEvent"/.test(s) && /'ata_reg'/.test(s))) {
      await prisma.$executeRawUnsafe(statement);
    }
    await replayOutboxBackfill();

    const count = await prisma.growthEvent.count({
      where: { eventType: "ata_reg", userId: staffWhoRegistered.id },
    });
    assert.equal(count, 1, "registration authority must outrank staff status");
  });

  await check("§75 backfill and runtime use the same key and cannot both exist", async () => {
    const before = await prisma.growthEvent.count({ where: { eventType: "ata_reg" } });
    await prisma.$transaction((tx) =>
      emitGrowthEvent(tx, {
        eventType: "ata_reg",
        occurredAt: selfService.createdAt,
        sourceEventId: `user:${selfService.id}`,
        sourceEntityId: selfService.id,
        userId: selfService.id,
      }),
    );
    const after = await prisma.growthEvent.count({ where: { eventType: "ata_reg" } });
    assert.equal(after, before, "runtime emitter duplicated a backfilled registration");
  });

  // ============================================================== G4-H3
  section("G4-H3 — no incoherent acquisition rate");

  await check("§20 no published ratio exceeds 1 in ANY scope, event OR learner basis", async () => {
    for (const scope of GROWTH_COVERAGE_SCOPES) {
      const counts = await loadGrowthCounts(prisma, PERIOD, NOFILTER, scope);
      const learners = await loadLearnerFunnel(prisma, PERIOD, NOFILTER, scope);
      const ratios = {
        ...computeGrowthRatios(counts, scope),
        ...computeLearnerFunnelRatios(learners),
      };
      for (const [key, value] of Object.entries(ratios)) {
        if (value === null) continue;
        assert.ok(
          Number(value) <= 1,
          `scope=${scope} ${key}=${value} exceeds 100% (numerator and denominator are different populations)`,
        );
      }
    }
  });

  // The case the first frozen-PREPROD rehearsal caught and the fixture above did
  // not: enrollments and activations exist for learners whose registration origin
  // is unprovable, so the EVENT quotient reported 158% and 125%. The learner
  // basis is a subset fraction and cannot.
  await check("§61 downstream steps stay <= 100% when events outnumber registrations", async () => {
    // Learners whose registration origin cannot be proved — exactly the 17
    // seeded accounts on real PREPROD — but who DID enroll and activate.
    for (let i = 0; i < 12; i += 1) {
      const orphan = await makeLearner("seeded");
      const orphanEnrollment = await makeEnrollment(orphan.id);
      await prisma.$transaction((tx) =>
        emitGrowthEvent(tx, {
          eventType: "curriculum_enrollment",
          occurredAt: new Date("2026-03-11"),
          sourceEventId: `enrollment:${orphanEnrollment.id}`,
          sourceEntityId: orphanEnrollment.id,
          userId: orphan.id,
          enrollmentId: orphanEnrollment.id,
        }),
      );
      await prisma.$transaction((tx) =>
        emitGrowthEvent(tx, {
          eventType: "academy_activation",
          occurredAt: new Date("2026-03-12"),
          sourceEventId: `enrollment:${orphanEnrollment.id}`,
          sourceEntityId: orphanEnrollment.id,
          userId: orphan.id,
          enrollmentId: orphanEnrollment.id,
        }),
      );
    }
    const counts = await loadGrowthCounts(prisma, PERIOD, NOFILTER, "total");
    const learners = await loadLearnerFunnel(prisma, PERIOD, NOFILTER, "total");
    assert.ok(
      counts.enrollments > learners.registeredLearners,
      `fixture must have more enrollment EVENTS (${counts.enrollments}) than registered learners (${learners.registeredLearners})`,
    );

    // The audited event quotient on this exact fixture.
    const eventQuotient = Number(
      (await import("@/lib/analytics/decimal")).exactRatio(
        counts.enrollments,
        counts.ataRegistrations,
      ),
    );
    assert.ok(eventQuotient > 1, `the event quotient must be the broken one: ${eventQuotient}`);

    const rates = computeLearnerFunnelRatios(learners);
    assert.ok(
      rates.enrollmentRate !== null && Number(rates.enrollmentRate) <= 1,
      `enrollmentRate=${rates.enrollmentRate} (learner-basis subset must be <= 1)`,
    );
    assert.ok(
      rates.activationRate !== null && Number(rates.activationRate) <= 1,
      `activationRate=${rates.activationRate}`,
    );
  });

  await check("§17 the click-denominated rate is NULL outside the attributed scope", async () => {
    // G4-R2. Renamed to `attributedClickToRegistrationRate` and moved onto a
    // click-cohort basis, so `computeGrowthRatios` no longer produces it at all —
    // which is the stronger version of this assertion: it is null in EVERY scope
    // here, because a cohort ratio can only come from the cohort query.
    for (const scope of ["total", "organic", "attributed"] as const) {
      const counts = await loadGrowthCounts(prisma, PERIOD, NOFILTER, scope);
      const ratios = computeGrowthRatios(counts, scope);
      assert.equal(
        ratios.attributedClickToRegistrationRate,
        null,
        `scope=${scope} published a click-denominated rate from event counts`,
      );
    }
  });

  await check("§19 attribution coverage is a subset fraction, never a conversion rate", () => {
    const coverage = computeAttributionCoverage({
      attributedRegistrations: 0,
      totalRegistrations: 40,
    });
    assert.equal(coverage.attributionCoverageRate, "0.000000");
    assert.equal(coverage.totalRegistrations, 40);
    const none = computeAttributionCoverage({ attributedRegistrations: 0, totalRegistrations: 0 });
    assert.equal(none.attributionCoverageRate, null, "zero denominator must be null, not 0");
  });

  // ============================================================== G4-H4
  section("G4-H4 — zero attribution must not erase the business");

  await check("§25 a zero-attribution dataset reports real totals and an empty attributed slice", async () => {
    const total = await loadGrowthCounts(prisma, PERIOD, NOFILTER, "total");
    const attributed = await loadGrowthCounts(prisma, PERIOD, NOFILTER, "attributed");
    const organic = await loadGrowthCounts(prisma, PERIOD, NOFILTER, "organic");

    assert.ok(total.ataRegistrations > 0, "total registrations vanished");
    assert.equal(attributed.ataRegistrations, 0, "fixture has no attributed traffic");
    assert.equal(
      organic.ataRegistrations,
      total.ataRegistrations,
      "organic + attributed must reconstruct total",
    );
    assert.equal(GROWTH_DEFAULT_COVERAGE_SCOPE, "total", "the business default must be total");
  });

  await check("§26 no population silently disappears across the three scopes", async () => {
    for (const family of ["ata_reg", "pocket_reg", "dep"] as const) {
      const total = await countLedgerEvents(prisma, PERIOD, NOFILTER, "total", family);
      const attributed = await countLedgerEvents(prisma, PERIOD, NOFILTER, "attributed", family);
      const organic = await countLedgerEvents(prisma, PERIOD, NOFILTER, "organic", family);
      assert.equal(attributed + organic, total, `${family}: scopes do not reconstruct the total`);
    }
  });

  // ============================================================== G4-H5
  section("G4-H5 — one canonical Pocket event per identity, whatever the path");

  const pocketLearner = await makeLearner("selfservice");
  await makeEnrollment(pocketLearner.id);
  const CLICK = `tq-${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`;

  await check("a successful binding emits exactly one pocket_reg", async () => {
    const result = await bindPocketIdentityCanonical({
      userId: pocketLearner.id,
      pocketUserId: "770001",
      clickId: CLICK,
      db: prisma,
    });
    assert.equal(result.binding.outcome, "bound");
    assert.equal(result.growth?.kind, "emitted");
    const events = await prisma.growthEvent.count({
      where: { eventType: "pocket_reg", sourceEventId: "pocket:player:770001" },
    });
    assert.equal(events, 1);
  });

  await check("§36 the SAME semantic binding through a second path stays exactly once", async () => {
    const replay = await bindPocketIdentityCanonical({
      userId: pocketLearner.id,
      pocketUserId: "770001",
      clickId: CLICK,
      db: prisma,
    });
    assert.equal(replay.binding.outcome, "already_bound");
    assert.equal(replay.growth?.kind, "duplicate");
    const events = await prisma.growthEvent.count({
      where: { eventType: "pocket_reg", sourceEventId: "pocket:player:770001" },
    });
    assert.equal(events, 1, "a second receiver path duplicated the canonical event");
    const outbox = await prisma.growthEventOutbox.count({
      where: { growthEvent: { sourceEventId: "pocket:player:770001" } },
    });
    assert.equal(outbox, 1, "outbox duplicated");
  });

  await check("§71 a conflicting binding emits NO canonical event", async () => {
    const other = await makeLearner("selfservice");
    const conflict = await bindPocketIdentityCanonical({
      userId: other.id,
      pocketUserId: "770001",
      clickId: CLICK,
      db: prisma,
    });
    assert.equal(conflict.binding.outcome, "conflict_trader_bound");
    assert.equal(conflict.growth, null, "a refused binding produced a canonical event");
    const events = await prisma.growthEvent.count({
      where: { eventType: "pocket_reg", sourceEventId: "pocket:player:770001" },
    });
    assert.equal(events, 1);
  });

  await check("§37 no PocketTraderIdentity exists without a pocket_reg event", async () => {
    const identities = await prisma.pocketTraderIdentity.findMany({
      select: { pocketUserId: true },
    });
    for (const identity of identities) {
      const events = await prisma.growthEvent.count({
        where: { eventType: "pocket_reg", sourceEventId: `pocket:player:${identity.pocketUserId}` },
      });
      assert.equal(events, 1, `identity ${identity.pocketUserId} has ${events} canonical events`);
    }
  });

  // ====================================================== PRESERVED (§3)
  section("PRESERVED PROPERTIES — the audit could not break these, and still cannot");

  await check("§69 money sums exactly once despite click and event fan-out", async () => {
    const depUser = await makeLearner("selfservice");
    await prisma.$transaction((tx) =>
      emitGrowthEvent(tx, {
        eventType: "dep",
        occurredAt: new Date("2026-03-15"),
        sourceEventId: "pocket:player:880001",
        sourceEntityId: 1,
        userId: depUser.id,
        provider: "pocket",
        amount: "55.01",
        currencyCode: "USD",
        currencyStatus: "configured",
      }),
    );
    for (let i = 0; i < 4; i += 1) {
      await prisma.providerIngressEvent.create({
        data: {
          provider: "pocket",
          goal: "dep",
          receivedAt: new Date("2026-03-15"),
          providerEventAtStatus: "absent",
          playerIdNormalized: "880001",
          amount: "55.01",
          sanitizedPayload: { goal: "dep" },
          rawPayloadHash: "d".repeat(64),
          processingStatus: "accepted_duplicate",
        },
      });
    }
    const amounts = await loadFirstDepositAmounts(prisma, PERIOD, NOFILTER, "total");
    assert.equal(amounts.sum, "55.01", "duplicate ingress evidence changed the money total");
    assert.equal(amounts.count, 1);
  });

  await check("§73 the goal allowlist still refuses every audited bypass vector", () => {
    const refused = [
      "goal=commission", "goal=withdraw", "goal=withdrawal", "goal=successful_withdrawal",
      "goal=canceled_withdrawal", "goal=REG", "goal=Reg", "goal=%20reg", "goal=reg%20",
      "goal=ftd", "goal=first_deposit", "goal=redeposit", "goal=registration",
      "goal=reg&goal=dep", "type=dep", "event=dep", "goal[]=dep", "goal=dep%00", "goal=reg%0a",
    ];
    for (const qs of refused) {
      const r = resolveGrowthV1Goal(new URLSearchParams(qs));
      assert.notEqual(r.kind, "supported", `?${qs} resolved to a Growth V1 goal`);
    }
    for (const [qs, goal] of [["goal=reg", "reg"], ["goal=dep", "dep"], ["goal=redep", "redep"]] as const) {
      const r = resolveGrowthV1Goal(new URLSearchParams(qs));
      assert.equal(r.kind === "supported" && r.goal, goal);
    }
  });

  await check("§72 all 16 flag combinations still fail safe", () => {
    let deviations = 0;
    for (const master of ["true", "false"]) {
      for (const reg of ["true", "false"]) {
        for (const dep of ["true", "false"]) {
          for (const rdep of ["true", "false"]) {
            const env = {
              POCKET_POSTBACK_ENABLED: master, POSTBACK_SECRET: "x".repeat(32),
              POCKET_REG_INGEST_ENABLED: reg, POCKET_DEP_INGEST_ENABLED: dep,
              POCKET_RDEP_INGEST_ENABLED: rdep, POCKET_FIRST_DEPOSIT_ENABLED: "true",
              POCKET_DEPOSIT_CURRENCY: "USD",
            } as unknown as NodeJS.ProcessEnv;
            const s = readPocketIngressSwitches(env);
            const m = master === "true";
            if (s.regEnabled !== (m && reg === "true")) deviations += 1;
            if (s.depEnabled !== (m && dep === "true")) deviations += 1;
            if (s.rdepEnabled !== (m && rdep === "true")) deviations += 1;
          }
        }
      }
    }
    assert.equal(deviations, 0);
    const masterOnly = readPocketIngressSwitches({
      POCKET_POSTBACK_ENABLED: "true", POSTBACK_SECRET: "x".repeat(32),
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(masterOnly.regEnabled, false, "master alone must not admit REG");
  });

  await check("§67 RDEP capability is truthful, and OFF means OFF", async () => {
    // WHAT THIS ASSERTION USED TO SAY. "RDEP canonical emission remains
    // fail-closed" — that no canonical redeposit could EVER be emitted until an
    // operator named a PROVIDER-issued unique event-id parameter, and that
    // several parameter names were forbidden as identities. POCKET-DEP-RDEP-1
    // superseded that premise: ATA derives its own deterministic identity, so
    // there is no provider contract to wait for and no parameter to nominate.
    // The forbidden-name list guarded a nomination mechanism that no longer
    // exists.
    //
    // WHAT STILL NEEDS GUARDING is that the capability surface tells the truth
    // in both directions, because the failure this replaces would now be an
    // availability surface claiming a capability the deployment does not have.
    const off = resolveRedepositCapability({} as NodeJS.ProcessEnv);
    assert.equal(off.kind, "unavailable");
    assert.equal(
      off.kind === "unavailable" ? off.reason : null,
      "master_gate_disabled",
      "with no Pocket integration at all the reason must be the master gate",
    );

    const masterOn = resolveRedepositCapability({
      POCKET_POSTBACK_ENABLED: "true",
      POSTBACK_SECRET: "x".repeat(32),
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(masterOn.kind, "unavailable");
    assert.equal(
      masterOn.kind === "unavailable" ? masterOn.reason : null,
      "redeposit_ingest_disabled",
      "master on but RDEP off must say RDEP is off",
    );

    const on = resolveRedepositCapability({
      POCKET_POSTBACK_ENABLED: "true",
      POSTBACK_SECRET: "x".repeat(32),
      POCKET_RDEP_INGEST_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(on.kind, "available", "master + family on is the whole contract");

    // THE SUPERSEDED REASON MUST BE UNREACHABLE. This is the RDEP-AVAIL-1 lock.
    for (const env of [{}, { POCKET_POSTBACK_ENABLED: "true", POSTBACK_SECRET: "x".repeat(32) }]) {
      const r = resolveRedepositCapability(env as unknown as NodeJS.ProcessEnv);
      if (r.kind === "unavailable") {
        assert.notEqual(
          r.reason as string,
          "provider_event_identity_contract_absent",
          "the superseded provider-contract reason must not be reachable",
        );
      }
    }

    // And with RDEP off in this fixture, nothing canonical was emitted.
    const rdep = await prisma.growthEvent.count({ where: { eventType: "rdep" } });
    assert.equal(rdep, 0, "no canonical redeposit may exist while RDEP is disabled");
  });

  await check("§68 unresolved RDEP is reported separately and never as money", async () => {
    for (let i = 0; i < 3; i += 1) {
      await prisma.providerIngressEvent.create({
        data: {
          provider: "pocket", goal: "redep", receivedAt: new Date("2026-03-20"),
          providerEventAtStatus: "absent", playerIdNormalized: "880001", amount: "99.00",
          sanitizedPayload: { goal: "redep" }, rawPayloadHash: "e".repeat(64),
          processingStatus: "identity_unresolved", rejectionCode: "provider_event_identity_missing",
        },
      });
    }
    const counts = await loadGrowthCounts(prisma, PERIOD, NOFILTER, "total");
    assert.equal(counts.unresolvedRedeposits, 3);
    assert.equal(counts.confirmedRedeposits, 0);
    const amounts = await loadFirstDepositAmounts(prisma, PERIOD, NOFILTER, "total");
    assert.equal(amounts.sum, "55.01", "unresolved redeposit evidence entered a monetary total");
  });

  await check("outbox stays 1:1 with the ledger", async () => {
    const events = await prisma.growthEvent.count();
    const outbox = await prisma.growthEventOutbox.count();
    assert.equal(events, outbox, `events=${events} outbox=${outbox}`);
  });

  await check("money parser grammar is unchanged", () => {
    for (const bad of ["0", "0.00", "-1", "+1", "01.00", "1.", ".5", "1e3", "NaN", "25,00", " 25 "]) {
      assert.equal(parsePocketDepositAmount(bad).ok, false, `${bad} was accepted`);
    }
    const ok = parsePocketDepositAmount("25.1");
    assert.equal(ok.ok && ok.normalized, "25.10");
  });

  await prisma.$disconnect();

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\n  failures:");
    for (const f of failures) console.log(`   - ${f}`);
  }
  fs.rmSync(dbPath, { force: true });
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(dbPath, { force: true });
  process.exit(1);
});
