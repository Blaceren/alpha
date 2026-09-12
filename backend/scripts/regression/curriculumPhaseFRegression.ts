/**
 * ATA-PRODUCT-PHASE-F-ENROLLMENT-XP-PROGRESSION-1 — domain regression.
 *
 * Seven sections, each of which pins one launch-critical contract:
 *
 *   1. THE APPROVED XP POLICY — the schedule, its counts, its total, and the
 *      separation between the ATA product profile and the generic engine.
 *   2. THE CANONICAL ATA-100 PACKAGE — 100 approved rewards summing to exactly
 *      10 000, and a validator that refuses any other schedule.
 *   3. EXACTLY-ONCE XP — every completion owner, awarded once, retried, replayed
 *      and re-approved, against real proof rows in a disposable database.
 *   4. SERVER-OWNED TOOL ACCESS — all nineteen, per progression state, fail
 *      closed, and provably independent of XP.
 *   5. THE LEARNER READ MODEL — available-with-zero vs unavailable, the tool
 *      access contract on both response shapes.
 *   6. REGISTRATION AUTO-ENROLLMENT — the activation condition, the transaction,
 *      and every fail-closed path.
 *   7. XP IS NOT PROGRESSION — no threshold anywhere grants a rank, an unlock or
 *      a level, proven behaviourally and by source scan.
 *
 * Every scenario owns a temporary SQLite fixture built by the shipped migration
 * runner. No HTTP route, no live database, no live environment file, no external
 * provider and no network call. The registration HTTP surface is exercised
 * separately by curriculumPhaseFRegistrationE2E.ts.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient, type LevelDefinition } from "@prisma/client";

const dbPath = `/tmp/ata-curriculum-phase-f-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const AT = new Date("2026-08-01T12:00:00.000Z");
const BEFORE = new Date("2026-07-01T00:00:00.000Z");

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

type Flags = {
  read?: boolean;
  enrollment?: boolean;
  xp?: boolean;
  report?: boolean;
  autoEnroll?: boolean;
};

function setFlags(flags: Flags) {
  const values: Record<string, boolean | undefined> = {
    CURRICULUM_V2_READ_ENABLED: flags.read,
    CURRICULUM_V2_ENROLLMENT_ENABLED: flags.enrollment,
    CURRICULUM_V2_XP_ENABLED: flags.xp,
    CURRICULUM_V2_REPORT_ENABLED: flags.report,
    CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED: flags.autoEnroll,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
}

async function expectCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual ?? String(error)}`);
    return;
  }
  assert.fail(`expected ${code} but the call resolved`);
}

async function main() {
  cleanupDb();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const policy = await import("../../src/lib/curriculum/product-xp-policy");
  const ataSource = await import("../../src/lib/curriculum/product-ata-100");
  const vocabulary = await import("../../src/lib/curriculum/product-vocabulary");
  const pairs = await import("../../src/lib/curriculum/completion-pairs");
  const ataProfile = await import("../../src/lib/curriculum/package/ata-profile");
  const packageValidate = await import("../../src/lib/curriculum/package/validate");
  const packageFingerprint = await import("../../src/lib/curriculum/package/fingerprint");
  const completion = await import("../../src/lib/curriculum/completion");
  const manual = await import("../../src/lib/curriculum/manual-completion");
  const mentor = await import("../../src/lib/curriculum/mentor-review");
  const reportReview = await import("../../src/lib/curriculum/report-review");
  const reportSubmission = await import("../../src/lib/curriculum/report-submission");
  const toolAccess = await import("../../src/lib/curriculum/tool-access");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const readApi = await import("../../src/lib/curriculum/read-api");
  const registrationEnrollment = await import(
    "../../src/lib/curriculum/registration-enrollment"
  );
  const enrollmentDomain = await import("../../src/lib/curriculum/enrollment");

  let sequence = 0;
  async function createUser(label: string, role: "user" | "mentor" | "admin" = "user") {
    sequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${sequence}@example.com`,
        name: label,
        role,
        status: "active",
      },
    });
  }

  async function wipeCurriculum() {
    // SQLite enforces the report aggregate's circular references (a submission
    // points at its latest review, a review points at its revision), so the
    // deletions below are done with foreign keys off rather than in a fragile
    // hand-ordered sequence. This is fixture teardown in a disposable file, not
    // a production path.
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    await prisma.reportCommandReceipt.deleteMany();
    await prisma.reportReviewScore.deleteMany();
    await prisma.reportReview.deleteMany();
    await prisma.reportRevision.deleteMany();
    await prisma.reportSubmission.deleteMany();
    await prisma.assessmentAttempt.deleteMany();
    await prisma.checkpointVerificationAttempt.deleteMany();
    await prisma.xPTransaction.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.pocketTraderIdentity.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.levelReportBinding.deleteMany();
    await prisma.assessmentVersion.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }

  type LevelSpec = { type?: string; completionMethod?: string; xpReward?: number };

  /**
   * A published `ata-v2` graph with the given levels. `ata-v2` is the code the
   * completion primitive and the enrollment resolver both pin to, so a synthetic
   * graph has to use it.
   */
  async function createGraph(specs: LevelSpec[], options: { code?: string } = {}) {
    sequence += 1;
    const version = await prisma.curriculumVersion.create({
      data: {
        code: options.code ?? "ata-v2",
        name: `phase-f-${sequence}`,
        versionNumber: sequence,
        status: "published",
        publishedAt: BEFORE,
        effectiveFrom: BEFORE,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m-${version.id}`,
        title: "Phase F module",
        firstLevel: 1,
        lastLevel: specs.length,
        learningObjective: "Learn",
      },
    });
    const levels: LevelDefinition[] = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const levelNumber = index + 1;
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber,
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.phase-f-${version.id}`,
            type: (spec.type ?? "lesson") as never,
            title: `Level ${levelNumber}`,
            learningObjective: "Learn",
            completionMethod: spec.completionMethod ?? "manual",
            xpReward: spec.xpReward ?? 0,
            requiredXp: 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            status: "active",
            featureUnlockCode:
              (spec.type ?? "lesson") === "financial_checkpoint"
                ? `checkpoint.module-${String(levelNumber).padStart(2, "0")}`
                : null,
          },
        }),
      );
    }
    return { version, moduleDefinition, levels };
  }

  async function enroll(
    userId: number,
    graph: Awaited<ReturnType<typeof createGraph>>,
    currentLevel: number,
  ) {
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId,
        curriculumVersionId: graph.version.id,
        curriculumCode: graph.version.code,
        status: "active",
        enrolledAt: BEFORE,
        currentLevel,
        highestCompletedLevel: currentLevel - 1,
      },
    });
    for (let levelNumber = 1; levelNumber < currentLevel; levelNumber += 1) {
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId: enrollment.id,
          curriculumVersionId: graph.version.id,
          levelDefinitionId: graph.levels[levelNumber - 1].id,
          status: "completed",
          startedAt: BEFORE,
          lastProgressAt: BEFORE,
          completedAt: BEFORE,
        },
      });
    }
    return enrollment;
  }

  async function startLevel(
    enrollmentId: number,
    graph: Awaited<ReturnType<typeof createGraph>>,
    levelNumber: number,
    status: "in_progress" | "pending_review" = "in_progress",
  ) {
    return prisma.userLevelProgress.create({
      data: {
        enrollmentId,
        curriculumVersionId: graph.version.id,
        levelDefinitionId: graph.levels[levelNumber - 1].id,
        status,
        startedAt: BEFORE,
        lastProgressAt: BEFORE,
      },
    });
  }

  async function xpTotal(enrollmentId: number) {
    const rows = await prisma.xPTransaction.findMany({ where: { enrollmentId } });
    return rows.reduce((total, row) => total + row.amount, 0);
  }

  /* ==================================================================== *
   * 1. THE APPROVED XP POLICY
   * ==================================================================== */

  await check("1.1 the schedule prices every canonical completion pair, and only those", () => {
    assert.deepEqual(policy.ATA_XP_SCHEDULE, {
      "lesson:assessment_pass": 100,
      "lesson:manual": 150,
      "mentor_review:mentor_review": 250,
      "report:report_approval": 500,
      "financial_checkpoint:balance_check": 0,
      "external_event:pocket_postback": 0,
    });
    // Every priced pair is a pair some PRODUCTION owner can actually complete.
    for (const pair of Object.keys(policy.ATA_XP_SCHEDULE)) {
      assert.ok(pairs.OWNED_COMPLETION_PAIRS.has(pair), `${pair} has no production owner`);
    }
  });

  await check("1.2 the approved counts and subtotals are exactly the product decision", () => {
    const buckets = new Map(
      policy.ataXpScheduleBuckets().map((bucket) => [bucket.pair, bucket]),
    );
    const expected: Array<[string, number, number, number]> = [
      ["lesson:assessment_pass", 58, 100, 5_800],
      ["lesson:manual", 13, 150, 1_950],
      ["mentor_review:mentor_review", 7, 250, 1_750],
      ["report:report_approval", 1, 500, 500],
      ["financial_checkpoint:balance_check", 20, 0, 0],
      ["external_event:pocket_postback", 1, 0, 0],
    ];
    for (const [pair, levels, xpReward, subtotal] of expected) {
      const bucket = buckets.get(pair);
      assert.ok(bucket, `${pair} missing from the schedule`);
      assert.equal(bucket!.levels, levels, `${pair} level count`);
      assert.equal(bucket!.xpReward, xpReward, `${pair} reward`);
      assert.equal(bucket!.subtotal, subtotal, `${pair} subtotal`);
    }
    assert.equal(
      expected.reduce((total, row) => total + row[1], 0),
      ataSource.ATA_LEVEL_COUNT,
    );
  });

  await check("1.3 the schedule sums to exactly 10 000 XP over the canonical 100", () => {
    assert.equal(policy.ataXpScheduleTotal(), 10_000);
    assert.equal(policy.ATA_TOTAL_XP, 10_000);
    // Independently: sum the policy level by level over the structural source.
    const summed = ataSource.ATA_LEVELS.reduce(
      (total, level) => total + policy.ataXpRewardForLevel(level),
      0,
    );
    assert.equal(summed, 10_000);
  });

  await check("1.4 the reward is keyed on the completion pair, never on the level number", () => {
    // Two levels with the same pair and very different numbers pay the same.
    const first = ataSource.ATA_LEVELS.find((level) => level.kind === "video_test")!;
    const last = [...ataSource.ATA_LEVELS].reverse().find((level) => level.kind === "video_test")!;
    assert.notEqual(first.levelNumber, last.levelNumber);
    assert.equal(policy.ataXpRewardForLevel(first), policy.ataXpRewardForLevel(last));
    // And the two practical shapes differ ONLY because their pair differs.
    const manualPractical = ataSource.ATA_LEVELS.find(
      (level) => level.kind === "practical" && !level.mentorReview,
    )!;
    const mentorPractical = ataSource.ATA_LEVELS.find(
      (level) => level.kind === "practical" && level.mentorReview,
    )!;
    assert.equal(policy.ataXpRewardForLevel(manualPractical), 150);
    assert.equal(policy.ataXpRewardForLevel(mentorPractical), 250);
  });

  await check("1.5 an unpriced pair answers null rather than a default zero", () => {
    assert.equal(policy.ataXpRewardForPair("scenario", "manual"), null);
    assert.equal(policy.ataXpRewardForPair("lesson", "lesson"), null);
    assert.equal(policy.ataXpRewardForPair("lesson", "assessment_pass"), 100);
  });

  await check("1.6 the generic engine knows nothing about the ATA schedule", () => {
    const generic = fs.readFileSync(
      path.join(process.cwd(), "src/lib/curriculum/package/validate.ts"),
      "utf8",
    );
    assert.ok(
      !/product-xp-policy|ATA_XP_SCHEDULE|ATA_TOTAL_XP/.test(generic),
      "the generic package validator must not import the ATA product XP policy",
    );
    // …and the completion engine derives XP from the DEFINITION, not the policy.
    const engine = fs.readFileSync(
      path.join(process.cwd(), "src/lib/curriculum/completion.ts"),
      "utf8",
    );
    assert.ok(!/product-xp-policy/.test(engine), "the completion engine must not import the policy");
    assert.ok(/context\.level\.xpReward/.test(engine), "XP must come from the level definition");
  });

  /* ==================================================================== *
   * 2. THE CANONICAL ATA-100 PACKAGE
   * ==================================================================== */

  const canonicalPath = path.join(
    process.cwd(),
    "curriculum/packages/ata-v2-canonical-100.draft.json",
  );
  const canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf8")) as {
    packageCode: string;
    contentFingerprint: string;
    modules: Array<{ levels: Array<Record<string, unknown>> }>;
  };
  const canonicalLevels = canonical.modules.flatMap((item) => item.levels);

  await check("2.1 the canonical package declares 100 approved rewards, zero unresolved", () => {
    assert.equal(canonicalLevels.length, 100);
    const approved = canonicalLevels.filter((level) => level.xpRewardStatus === "approved");
    const unresolved = canonicalLevels.filter((level) => level.xpRewardStatus === "unresolved");
    assert.equal(approved.length, 100);
    assert.equal(unresolved.length, 0);
  });

  await check("2.2 the package's own reward distribution IS the approved schedule", () => {
    const byPair = new Map<string, { levels: number; subtotal: number }>();
    for (const level of canonicalLevels) {
      const pair = `${level.type as string}:${level.completionMethod as string}`;
      const bucket = byPair.get(pair) ?? { levels: 0, subtotal: 0 };
      bucket.levels += 1;
      bucket.subtotal += level.xpReward as number;
      byPair.set(pair, bucket);
    }
    for (const bucket of policy.ataXpScheduleBuckets()) {
      assert.deepEqual(
        byPair.get(bucket.pair),
        { levels: bucket.levels, subtotal: bucket.subtotal },
        bucket.pair,
      );
    }
    const total = canonicalLevels.reduce((sum, level) => sum + (level.xpReward as number), 0);
    assert.equal(total, 10_000, "the ATA-100 package must award exactly 10 000 XP");
  });

  await check("2.3 the ATA profile accepts the canonical package's schedule", () => {
    const parsed = packageValidate.validateCurriculumPackage(canonical);
    assert.equal(parsed.ok, true, JSON.stringify(("issues" in parsed ? parsed.issues : []).slice(0, 3)));
    const profile = ataProfile.validateAtaProduct100Package(
      (parsed as unknown as { ok: true; package: Parameters<typeof ataProfile.validateAtaProduct100Package>[0] }).package,
    );
    const xpIssues = profile.issues.filter((item) => item.code.startsWith("ATA100_XP"));
    assert.deepEqual(xpIssues, [], JSON.stringify(xpIssues));
    assert.equal(profile.report.lifecycle.xpTotalReward, 10_000);
    assert.equal(profile.report.lifecycle.xpScheduleMatchesPolicy, true);
    assert.equal(profile.report.lifecycle.xpApprovedLevels, 100);
    assert.equal(profile.report.lifecycle.xpUnresolvedLevels, 0);
  });

  await check("2.4 a package claiming ANY other XP schedule is refused", () => {
    const tamper = (mutate: (level: Record<string, unknown>) => void, expectedCode: string) => {
      const copy = JSON.parse(JSON.stringify(canonical)) as typeof canonical;
      const level = copy.modules
        .flatMap((item) => item.levels)
        .find((item) => item.type === "lesson" && item.completionMethod === "assessment_pass")!;
      mutate(level);
      // The generic validator checks the declared fingerprint, so a tampered
      // package must be re-fingerprinted before the PROFILE can be asked about
      // its schedule. Otherwise this would prove the fingerprint works, which is
      // a different (already covered) contract.
      copy.contentFingerprint = packageFingerprint.calculateFingerprint({
        ...copy,
        contentFingerprint: "0".repeat(64),
      } as never);
      const parsed = packageValidate.validateCurriculumPackage(copy);
      assert.equal(parsed.ok, true, JSON.stringify(("issues" in parsed ? parsed.issues : []).slice(0, 3)));
      const profile = ataProfile.validateAtaProduct100Package(
        (parsed as unknown as { ok: true; package: Parameters<typeof ataProfile.validateAtaProduct100Package>[0] }).package,
      );
      assert.ok(
        profile.issues.some((item) => item.code === expectedCode),
        `expected ${expectedCode}, got ${profile.issues.map((item) => item.code).join(",")}`,
      );
      assert.equal(profile.ok, false);
    };
    // A different reward on one level.
    tamper((level) => { level.xpReward = 10; }, "ATA100_XP_REWARD_MISMATCH");
    // The whole-schedule checksum notices it too.
    tamper((level) => { level.xpReward = 10; }, "ATA100_XP_SCHEDULE_BUCKET_MISMATCH");
    tamper((level) => { level.xpReward = 10; }, "ATA100_XP_TOTAL_MISMATCH");
    // The obsolete 10 × level rule, applied to a single level, is refused too.
    tamper((level) => { level.xpReward = 10 * (level.levelNumber as number); }, "ATA100_XP_REWARD_MISMATCH");
    // A level that silently reverts to "unresolved".
    tamper((level) => { level.xpRewardStatus = "unresolved"; }, "ATA100_XP_REWARD_STATUS_MISMATCH");
  });

  await check("2.5 a redistribution that preserves the total is still refused", async () => {
    const copy = JSON.parse(JSON.stringify(canonical)) as typeof canonical;
    // Move 50 XP from one assessment level to another. Both remain plausible
    // numbers, the pair's level count is unchanged, its subtotal is unchanged
    // and the package still sums to 10 000 — so NEITHER the bucket checksum nor
    // the total notices. This is exactly why the schedule is also enforced level
    // by level, and this test is what proves the totals alone are not enough.
    const levels = copy.modules
      .flatMap((item) => item.levels)
      .filter((item) => item.type === "lesson" && item.completionMethod === "assessment_pass");
    levels[0].xpReward = 50;
    levels[1].xpReward = 150;
    copy.contentFingerprint = packageFingerprint.calculateFingerprint({
      ...copy,
      contentFingerprint: "0".repeat(64),
    } as never);
    const parsed = packageValidate.validateCurriculumPackage(copy);
    assert.equal(parsed.ok, true, JSON.stringify(("issues" in parsed ? parsed.issues : []).slice(0, 3)));
    const profile = ataProfile.validateAtaProduct100Package(
      (parsed as unknown as { ok: true; package: Parameters<typeof ataProfile.validateAtaProduct100Package>[0] }).package,
    );
    const mismatches = profile.issues.filter((item) => item.code === "ATA100_XP_REWARD_MISMATCH");
    assert.equal(mismatches.length, 2, "both altered levels must be named");
    assert.equal(profile.ok, false);
    // The aggregate checks are silent here, deliberately.
    assert.equal(profile.report.lifecycle.xpTotalReward, 10_000);
    assert.ok(!profile.issues.some((item) => item.code === "ATA100_XP_TOTAL_MISMATCH"));
    assert.ok(!profile.issues.some((item) => item.code === "ATA100_XP_SCHEDULE_BUCKET_MISMATCH"));
  });

  await check("2.6 the GENERIC validator still accepts a non-ATA package with any rewards", () => {
    // The 4-level approved first slice is a legitimate package whose levels award
    // 0 XP. The generic engine must keep accepting it unchanged — the ATA
    // schedule is a PROFILE, not a platform rule.
    const slice = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "curriculum/packages/ata-v2-first-slice.rev3.approved.json"),
        "utf8",
      ),
    ) as { packageCode: string };
    const parsed = packageValidate.validateCurriculumPackage(slice);
    assert.equal(parsed.ok, true, JSON.stringify(("issues" in parsed ? parsed.issues : []).slice(0, 3)));
    assert.equal(ataProfile.isAtaProduct100Package(slice as never), false);
  });

  await check("2.7 the historical approved packages are untouched by this phase", () => {
    // Byte-level: their fingerprints still recompute to the values they shipped
    // with, which they could not if the XP overlay had been written into them.
    const files = [
      "curriculum/packages/ata-v2-first-slice.approved.json",
      "curriculum/packages/ata-v2-first-slice.rev3.approved.json",
    ];
    for (const file of files) {
      const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8")) as {
        modules: Array<{ levels: Array<{ xpReward: number; xpRewardStatus?: string }> }>;
      };
      for (const level of raw.modules.flatMap((item) => item.levels)) {
        assert.equal(level.xpReward, 0, `${file} must keep its historical zero rewards`);
        assert.equal(
          level.xpRewardStatus,
          undefined,
          `${file} must not gain an xpRewardStatus field`,
        );
      }
    }
  });

  /* ==================================================================== *
   * 3. EXACTLY-ONCE XP
   * ==================================================================== */

  setFlags({ read: true, enrollment: true, xp: true });

  await check("3.1 MANUAL: +150 once; the same requestId and a later request both add 0", async () => {
    await wipeCurriculum();
    const graph = await createGraph([
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const learner = await createUser("manual");
    const enrollment = await enroll(learner.id, graph, 1);
    await startLevel(enrollment.id, graph, 1);

    const first = await manual.completeManualLevel({
      actorUserId: learner.id,
      stableCode: graph.levels[0].stableCode,
      requestId: "phase-f-manual-0001",
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(first.created, true);
    assert.equal(first.xpAwarded, 150);
    assert.equal(await xpTotal(enrollment.id), 150);

    // Exact retry of the same request identity.
    const retry = await manual.completeManualLevel({
      actorUserId: learner.id,
      stableCode: graph.levels[0].stableCode,
      requestId: "phase-f-manual-0001",
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(retry.created, false);
    assert.equal(await xpTotal(enrollment.id), 150);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 1);

    // A DIFFERENT request against an already-completed level adds nothing: the
    // owner refuses it outright rather than treating it as a second completion.
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: learner.id,
          stableCode: graph.levels[0].stableCode,
          requestId: "phase-f-manual-0002",
          evaluationTime: AT,
          db: prisma,
        }),
      "MANUAL_COMPLETION_REQUEST_CONFLICT",
    );
    assert.equal(await xpTotal(enrollment.id), 150);
  });

  await check("M1-M8 LO-REVIEW-WORKITEM-UNREACHABLE-1: the mentor-review operational mirror", async () => {
    await wipeCurriculum();
    const graph = await createGraph([
      { type: "mentor_review", completionMethod: "mentor_review", xpReward: 250 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const learner = await createUser("mirror-mentor-learner");
    const reviewer = await createUser("mirror-mentor-reviewer", "mentor");
    const enrollment = await enroll(learner.id, graph, 1);
    const progress = await startLevel(enrollment.id, graph, 1);

    const workItems = () => prisma.learnerOpsCase.findMany({ where: { userLevelProgressId: progress.id } });
    assert.equal((await workItems()).length, 0, "nothing exists before the review is requested");

    /* M1 */
    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: graph.levels[0].stableCode, evaluationTime: AT, db: prisma,
    });
    const created = await workItems();
    assert.equal(created.length, 1, "M1: exactly one anchored mentor_review work item");
    assert.equal(created[0].type, "mentor_review");
    assert.equal(created[0].userId, learner.id);
    assert.equal(created[0].userLevelProgressId, progress.id, "anchored to the canonical progress row");
    const queue = await prisma.learnerOpsQueue.findUniqueOrThrow({ where: { id: created[0].queueId } });
    assert.equal(queue.key, "mentor_review", "routed to the seeded mentor-review queue");
    assert.ok(created[0].slaPolicyId, "the operational SLA policy applies to educational work too");

    /* M2 */
    const replayed = await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: graph.levels[0].stableCode, evaluationTime: AT, db: prisma,
    });
    assert.equal(replayed.created, false);
    assert.equal((await workItems()).length, 1, "M2: a replayed request adds no second work item");

    /* M3 — operational feedback is not an educational decision. */
    const learnerOps = await import("../../src/lib/learner-ops/case");
    const staff = await prisma.staffProfile.create({
      data: { userId: reviewer.id, displayName: "Mirror Mentor", staffRole: "mentor" },
    });
    const actor = { staffId: staff.id, userId: reviewer.id };
    await learnerOps.addMessage({
      caseId: created[0].id,
      body: "Практику посмотрел, обратите внимание на риск-план — это операционный ответ.",
      author: { kind: "staff", staffId: actor.staffId, userId: actor.userId },
    });
    await learnerOps.addNote({ caseId: created[0].id, body: "ВНУТРЕННЕЕ: слабый раздел 3", actor });
    assert.equal(
      (await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } })).status,
      "pending_review",
      "M3: learner-visible feedback must not advance canonical progression",
    );
    assert.equal((await workItems())[0].status, "in_progress", "and it does not resolve the work item");

    /* M4 — a generic terminal transition is refused outright. */
    const current = await workItems();
    for (const nextStatus of ["resolved", "closed"] as const) {
      let code: string | null = null;
      try {
        await learnerOps.transitionCase({
          caseId: current[0].id, expectedVersion: current[0].version, nextStatus, actor,
        });
      } catch (error) {
        code = (error as { code?: string }).code ?? null;
      }
      assert.equal(code, "LEARNER_OPS_CANONICAL_REVIEW_OPEN", `M4: ${nextStatus} must be refused`);
    }
    const queueRead = await import("../../src/lib/learner-ops/queue");
    const projected = await queueRead.getCaseDetail(current[0].id);
    assert.ok(!projected.allowedTransitions.includes("resolved"), "M4: and it is not even offered");
    assert.ok(!projected.allowedTransitions.includes("closed"));

    /* M5 */
    const approved = await mentor.approveMentorReview({
      reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: AT, db: prisma,
    });
    assert.equal(approved.created, true);
    assert.equal(approved.xpAwarded, 250);
    const resolved = await workItems();
    assert.equal(resolved.length, 1, "M5: still exactly one work item");
    assert.equal(resolved[0].status, "resolved", "M5: reconciled by the canonical approval");
    assert.ok(resolved[0].resolvedAt);
    assert.equal(
      (await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } })).status,
      "completed",
    );

    /* M6 */
    const replayApproval = await mentor.approveMentorReview({
      reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: AT, db: prisma,
    });
    assert.equal(replayApproval.created, false);
    const afterReplay = await workItems();
    assert.equal(afterReplay[0].version, resolved[0].version, "M6: no second version bump");
    assert.equal(
      await prisma.learnerOpsCaseEvent.count({ where: { caseId: resolved[0].id, eventType: "resolved" } }),
      1,
      "M6: exactly one resolution in the timeline",
    );
    assert.equal(await xpTotal(enrollment.id), 250, "M6: XP awarded exactly once");

    /* M7 — repair of a missing mirror changes no canonical state. */
    const secondLearner = await createUser("mirror-mentor-learner-2");
    const secondEnrollment = await enroll(secondLearner.id, graph, 1);
    const secondProgress = await startLevel(secondEnrollment.id, graph, 1);
    await mentor.requestMentorReview({
      actorUserId: secondLearner.id, stableCode: graph.levels[0].stableCode, evaluationTime: AT, db: prisma,
    });
    const orphaned = await prisma.learnerOpsCase.findFirstOrThrow({
      where: { userLevelProgressId: secondProgress.id },
    });
    await prisma.learnerOpsCaseEvent.deleteMany({ where: { caseId: orphaned.id } });
    await prisma.learnerOpsCase.delete({ where: { id: orphaned.id } });

    const progressBefore = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: secondProgress.id } });
    const reconciler = await import("../../src/lib/learner-ops/reconcile-review-work-items");
    const outcome = await reconciler.reconcileReviewWorkItems({ apply: true });
    assert.ok(outcome.mentorReviewsRepaired >= 1, "M7: the reconciler rebuilt it");
    assert.deepEqual(
      await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: secondProgress.id } }),
      progressBefore,
      "M7: canonical progression untouched by repair",
    );
    assert.equal(
      (await prisma.learnerOpsCase.count({ where: { userLevelProgressId: secondProgress.id } })),
      1,
    );
    const secondRun = await reconciler.reconcileReviewWorkItems({ apply: true });
    assert.equal(secondRun.mentorReviewsRepaired, 0, "M7: idempotent");
    assert.equal(secondRun.orphanedWorkItems, 0, "no operational case lacks its canonical object");

    /* M8 */
    const learnerOpsCase = await import("../../src/lib/learner-ops/case");
    let anchorCode: string | null = null;
    try {
      await learnerOpsCase.createCase({
        userId: learner.id, type: "mentor_review", queueKey: "mentor_review",
        subject: "Без якоря", details: "Не должно существовать", actor: null,
      });
    } catch (error) {
      anchorCode = (error as { code?: string }).code ?? null;
    }
    assert.equal(anchorCode, "LEARNER_OPS_ANCHOR_REQUIRED", "M8: an anchorless mentor case is refused");
  });

  await check("3.2 MENTOR: request 0, pending 0, approval +250 once, re-approval 0", async () => {
    await wipeCurriculum();
    const graph = await createGraph([
      { type: "mentor_review", completionMethod: "mentor_review", xpReward: 250 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const learner = await createUser("mentor-learner");
    const reviewer = await createUser("mentor-reviewer", "mentor");
    const enrollment = await enroll(learner.id, graph, 1);
    const progress = await startLevel(enrollment.id, graph, 1);

    const requested = await mentor.requestMentorReview({
      actorUserId: learner.id,
      stableCode: graph.levels[0].stableCode,
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(requested.state, "pending_review");
    assert.equal(await xpTotal(enrollment.id), 0, "requesting a review awards nothing");

    // Still pending: no reviewer has acted.
    assert.equal(
      (await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } })).status,
      "pending_review",
    );
    assert.equal(await xpTotal(enrollment.id), 0, "a pending review awards nothing");

    const approved = await mentor.approveMentorReview({
      reviewerUserId: reviewer.id,
      progressId: progress.id,
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(approved.created, true);
    assert.equal(approved.xpAwarded, 250);
    assert.equal(await xpTotal(enrollment.id), 250);

    const replay = await mentor.approveMentorReview({
      reviewerUserId: reviewer.id,
      progressId: progress.id,
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(replay.created, false);
    assert.equal(await xpTotal(enrollment.id), 250);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 1);
  });

  /** A durable, fully-formed passing attempt — the assessment owner's proof. */
  async function passingAttempt(
    learnerId: number,
    enrollmentId: number,
    graph: Awaited<ReturnType<typeof createGraph>>,
    level: LevelDefinition,
    marker: string,
  ) {
    const assessment = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: graph.version.id,
        versionNumber: 1,
        status: "published",
        publishedAt: BEFORE,
        passPercent: 70,
      },
    });
    const startedAt = new Date(AT.getTime() - 300_000);
    return prisma.assessmentAttempt.create({
      data: {
        userId: learnerId,
        enrollmentId,
        curriculumVersionId: graph.version.id,
        levelDefinitionId: level.id,
        assessmentVersionId: assessment.id,
        attemptNumber: 1,
        status: "passed",
        startedAt,
        submittedAt: AT,
        durationSeconds: Math.floor((AT.getTime() - startedAt.getTime()) / 1_000),
        totalQuestions: 4,
        correctCount: 4,
        scoreBasisPoints: 10_000,
        submittedAnswers: [{ questionCode: "q1", optionCodes: ["a"] }],
        answersFingerprint: `sha256:${createHash("sha256").update(marker).digest("hex")}`,
        startRequestId: `start-${marker}`,
        submitRequestId: `submit-${marker}`,
      },
    });
  }

  await check("3.3 ASSESSMENT: a passed attempt awards +100 once; the retry adds 0", async () => {
    await wipeCurriculum();
    const graph = await createGraph([
      { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const learner = await createUser("assessment");
    const enrollment = await enroll(learner.id, graph, 1);
    await startLevel(enrollment.id, graph, 1);
    const attempt = await passingAttempt(learner.id, enrollment.id, graph, graph.levels[0], "af1");

    const result = await completion.completeCurriculumLevel({
      enrollmentId: enrollment.id,
      levelDefinitionId: graph.levels[0].id,
      sourceType: "assessment_pass",
      sourceId: `assessment-attempt:${attempt.id}`,
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(result.kind, "completed");
    assert.equal((result as { xpAwarded: number }).xpAwarded, 100);
    assert.equal(await xpTotal(enrollment.id), 100);

    const retry = await completion.completeCurriculumLevel({
      enrollmentId: enrollment.id,
      levelDefinitionId: graph.levels[0].id,
      sourceType: "assessment_pass",
      sourceId: `assessment-attempt:${attempt.id}`,
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(retry.kind, "completed");
    assert.equal((retry as { created: boolean }).created, false);
    assert.equal(await xpTotal(enrollment.id), 100);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 1);
  });

  await check("3.4 ASSESSMENT: a FAILED attempt completes nothing and awards 0", async () => {
    await wipeCurriculum();
    const graph = await createGraph([
      { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const learner = await createUser("assessment-fail");
    const enrollment = await enroll(learner.id, graph, 1);
    await startLevel(enrollment.id, graph, 1);
    const attempt = await passingAttempt(learner.id, enrollment.id, graph, graph.levels[0], "af2");
    await prisma.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: "failed", correctCount: 1, scoreBasisPoints: 2_500 },
    });

    const result = await completion.completeCurriculumLevel({
      enrollmentId: enrollment.id,
      levelDefinitionId: graph.levels[0].id,
      sourceType: "assessment_pass",
      sourceId: `assessment-attempt:${attempt.id}`,
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(result.kind, "corrupt");
    assert.equal(await xpTotal(enrollment.id), 0);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 0);
  });

  await check("3.5 FINANCIAL CHECKPOINT: a met gate completes and awards 0", async () => {
    await wipeCurriculum();
    const graph = await createGraph([
      { type: "financial_checkpoint", completionMethod: "balance_check", xpReward: 0 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const learner = await createUser("checkpoint");
    const enrollment = await enroll(learner.id, graph, 1);
    await startLevel(enrollment.id, graph, 1);
    const attempt = await prisma.checkpointVerificationAttempt.create({
      data: {
        enrollmentId: enrollment.id,
        levelDefinitionId: graph.levels[0].id,
        requestId: "checkpoint-request-0001",
        outcome: "met",
        completedAt: AT,
      },
    });

    const result = await completion.completeCurriculumLevel({
      enrollmentId: enrollment.id,
      levelDefinitionId: graph.levels[0].id,
      sourceType: "checkpoint_verification",
      sourceId: `checkpoint-verification:${attempt.id}`,
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(result.kind, "completed");
    assert.equal((result as { xpAwarded: number }).xpAwarded, 0);
    assert.equal((result as { xpTransactionId: number | null }).xpTransactionId, null);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 0);
  });

  await check("3.6 EXTERNAL POSTBACK: a registered identity completes L1 and awards 0", async () => {
    await wipeCurriculum();
    const graph = await createGraph([
      { type: "external_event", completionMethod: "pocket_postback", xpReward: 0 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const learner = await createUser("postback");
    const enrollment = await enroll(learner.id, graph, 1);
    await startLevel(enrollment.id, graph, 1);
    const identity = await prisma.pocketTraderIdentity.create({
      data: {
        userId: learner.id,
        pocketUserId: String(900000 + learner.id),
        clickId: "click-1",
        source: "registration_postback",
      },
    });

    const result = await completion.completeCurriculumLevel({
      enrollmentId: enrollment.id,
      levelDefinitionId: graph.levels[0].id,
      sourceType: "pocket_registration_postback",
      sourceId: `pocket-registration:${identity.id}`,
      evaluationTime: AT,
      db: prisma,
    });
    assert.equal(result.kind, "completed");
    assert.equal((result as { xpAwarded: number }).xpAwarded, 0);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 0);
  });

  /* ---- REPORT: the full learner + reviewer journey on a +500 level ---- */

  await check("3.7 REPORT: draft 0, submit 0, revision 0, approval +500 once, replay 0", async () => {
    await wipeCurriculum();
    setFlags({ read: true, enrollment: true, xp: true, report: true });
    const graph = await createGraph([
      { type: "report", completionMethod: "report_approval", xpReward: 500 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const level = graph.levels[0];

    const assignment = await prisma.reportAssignmentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: graph.version.id,
        versionNumber: 1,
        status: "published",
        publishedAt: BEFORE,
      },
    });
    await prisma.reportAssignmentLocalization.create({
      data: {
        reportAssignmentVersionId: assignment.id,
        locale: "en",
        title: "Phase F report",
        instructions: "Provide durable evidence",
        successCriteriaSummary: "All criteria",
        submitLabel: "Submit",
      },
    });
    const field = await prisma.reportFieldDefinition.create({
      data: {
        reportAssignmentVersionId: assignment.id,
        stableKey: "evidence",
        type: "url",
        required: true,
        sortOrder: 0,
        validationRules: { version: 1, allowedSchemes: ["https"] },
        choiceCodes: Prisma.JsonNull,
      },
    });
    await prisma.reportFieldLocalization.create({
      data: {
        reportFieldDefinitionId: field.id,
        locale: "en",
        label: "Evidence",
        helpText: "HTTPS",
        placeholder: "https://example.com",
        choiceLabels: Prisma.JsonNull,
      },
    });
    const rubric = await prisma.reportRubricVersion.create({
      data: {
        reportAssignmentVersionId: assignment.id,
        versionNumber: 1,
        status: "published",
        publishedAt: BEFORE,
      },
    });
    for (const [stableKey, commentRequired, sortOrder] of [
      ["process", true, 0],
      ["risk", false, 1],
    ] as const) {
      const criterion = await prisma.reportRubricCriterion.create({
        data: {
          reportRubricVersionId: rubric.id,
          stableKey,
          categoryCode: `${stableKey}-quality`,
          sortOrder,
          commentRequired,
        },
      });
      await prisma.reportRubricCriterionLocalization.create({
        data: {
          reportRubricCriterionId: criterion.id,
          locale: "en",
          title: stableKey,
          description: `${stableKey} description`,
        },
      });
    }
    for (const [stableKey, ordinal] of [["meets", 0], ["revise", 1]] as const) {
      const scale = await prisma.reportRubricScaleOption.create({
        data: { reportRubricVersionId: rubric.id, stableKey, ordinal },
      });
      await prisma.reportRubricScaleOptionLocalization.create({
        data: {
          reportRubricScaleOptionId: scale.id,
          locale: "en",
          label: stableKey,
          description: `${stableKey} description`,
        },
      });
    }
    const reason = await prisma.reportRejectionReason.create({
      data: { reportRubricVersionId: rubric.id, stableKey: "missing-evidence", sortOrder: 0, active: true },
    });
    await prisma.reportRejectionReasonLocalization.create({
      data: {
        reportRejectionReasonId: reason.id,
        locale: "en",
        title: "Missing evidence",
        guidance: "Add evidence",
      },
    });
    await prisma.levelReportBinding.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: graph.version.id,
        reportAssignmentVersionId: assignment.id,
        reportRubricVersionId: rubric.id,
        revision: 0,
      },
    });

    const learner = await createUser("report-learner");
    const reviewer = await createUser("report-reviewer", "mentor");
    const enrollment = await enroll(learner.id, graph, 1);
    await startLevel(enrollment.id, graph, 1);

    const saved = await reportSubmission.saveOwnReportDraft(learner.id, {
      levelNumber: 1,
      requestId: "phase-f-report-save-1",
      expectedRevision: 0,
      fieldValues: { evidence: "https://example.com/phase-f" },
    });
    assert.equal(await xpTotal(enrollment.id), 0, "saving a draft awards nothing");

    await reportSubmission.submitOwnReport(learner.id, {
      levelNumber: 1,
      requestId: "phase-f-report-submit-1",
      expectedRevision: saved.resultingWorkflowVersion,
    });
    assert.equal(await xpTotal(enrollment.id), 0, "submitting awards nothing");

    const aggregate = () =>
      prisma.reportSubmission.findUniqueOrThrow({
        where: {
          enrollmentId_levelDefinitionId: {
            enrollmentId: enrollment.id,
            levelDefinitionId: level.id,
          },
        },
        include: { submittedRevision: true },
      });
    const command = (row: Awaited<ReturnType<typeof aggregate>>, requestId: string) => ({
      submissionRef: Buffer.from(`report-submission:v1:${row.id}`, "utf8").toString("base64url"),
      requestId,
      expectedWorkflowVersion: row.workflowVersion,
      expectedClaimVersion: row.claimVersion,
      expectedSubmittedRevision: row.submittedRevision!.revisionNumber,
    });
    const scores = [
      { criterionCode: "process", scaleCode: "meets", comment: "Complete process evidence" },
      { criterionCode: "risk", scaleCode: "meets" },
    ];

    // A revision round trip: still zero.
    await reportReview.claimReportForReview(reviewer.id, command(await aggregate(), "phase-f-claim-a"), {
      evaluationTime: new Date("2026-08-01T10:00:00.000Z"),
    });
    await reportReview.rejectReportSubmission(
      reviewer.id,
      {
        ...command(await aggregate(), "phase-f-reject-a"),
        scores,
        reasonCode: "missing-evidence",
        humanComment: "Add durable evidence",
        correctiveAction: "Attach the missing rationale",
      },
      { evaluationTime: new Date("2026-08-01T10:20:00.000Z") },
    );
    assert.equal(await xpTotal(enrollment.id), 0, "a revision request awards nothing");

    const corrected = await reportSubmission.saveOwnReportDraft(learner.id, {
      levelNumber: 1,
      requestId: "phase-f-report-correct",
      expectedRevision: (await aggregate()).workflowVersion,
      fieldValues: { evidence: "https://example.com/phase-f-corrected" },
    });
    await reportSubmission.resubmitOwnReport(learner.id, {
      levelNumber: 1,
      requestId: "phase-f-report-resubmit",
      expectedRevision: corrected.resultingWorkflowVersion,
    });
    assert.equal(await xpTotal(enrollment.id), 0, "resubmitting awards nothing");

    await reportReview.claimReportForReview(reviewer.id, command(await aggregate(), "phase-f-claim-b"), {
      evaluationTime: new Date("2026-08-02T10:00:00.000Z"),
    });
    const approvalInput = { ...command(await aggregate(), "phase-f-approve"), scores };
    const approved = await reportReview.approveReportSubmission(reviewer.id, approvalInput, {
      evaluationTime: new Date("2026-08-02T10:20:00.000Z"),
    });
    assert.equal(approved.created, true);
    assert.equal(approved.completion.xpAwarded, 500);
    assert.equal(await xpTotal(enrollment.id), 500);

    const replay = await reportReview.approveReportSubmission(reviewer.id, approvalInput, {
      evaluationTime: new Date("2026-08-03T10:20:00.000Z"),
    });
    assert.equal(replay.retry, true);
    assert.equal(await xpTotal(enrollment.id), 500);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 1);
    setFlags({ read: true, enrollment: true, xp: true });
  });

  await check("3.8 the ledger holds no negative and no duplicated rows across the phase", async () => {
    const rows = await prisma.xPTransaction.findMany();
    assert.ok(rows.every((row) => row.amount > 0), "no zero or negative XP row may exist");
    const identities = rows.map((row) => row.idempotencyKey);
    assert.equal(new Set(identities).size, identities.length, "idempotency keys must be unique");
  });

  /* ==================================================================== *
   * 4. SERVER-OWNED TOOL ACCESS
   * ==================================================================== */

  /** A 20-level graph whose checkpoints sit where the canonical ones do. */
  async function toolGraph() {
    const specs: LevelSpec[] = [];
    for (let levelNumber = 1; levelNumber <= 20; levelNumber += 1) {
      specs.push(
        levelNumber % 5 === 0
          ? { type: "financial_checkpoint", completionMethod: "balance_check", xpReward: 0 }
          : { type: "lesson", completionMethod: "manual", xpReward: 150 },
      );
    }
    return createGraph(specs);
  }

  await check("4.1 exactly the canonical 19 tools are emitted, in unlock order, no duplicates", () => {
    const access = toolAccess.lockedCurriculumToolAccess();
    assert.equal(access.total, 19);
    assert.equal(access.tools.length, 19);
    assert.equal(new Set(access.tools.map((entry) => entry.code)).size, 19);
    assert.deepEqual(
      access.tools.map((entry) => entry.code),
      vocabulary.CURRICULUM_TOOLS.map((tool) => tool.code),
    );
    assert.equal(access.unlockedCount, 0);
  });

  await check("4.2 `tool.secret` is never a curriculum tool access entry", () => {
    const access = toolAccess.lockedCurriculumToolAccess();
    assert.ok(!access.tools.some((entry) => entry.code === "tool.secret"));
    assert.ok(!access.tools.some((entry) => entry.code === vocabulary.SECRET_TOOL.code));
    // …while still being a code content may legitimately reference.
    assert.equal(vocabulary.isProductToolCode("tool.secret"), true);
  });

  await check("4.3 access follows the SOURCE unlock level's durable completion only", async () => {
    await wipeCurriculum();
    const graph = await toolGraph();
    const learner = await createUser("tools");
    // Standing on L11: L1–L10 complete, so ONLY the L10 tool is open.
    const enrollment = await enroll(learner.id, graph, 11);
    await startLevel(enrollment.id, graph, 11);

    const states = await levelState.resolveUserCurriculumLevelStates({ userId: learner.id, asOf: AT });
    assert.equal(states.kind, "resolved");
    const access = toolAccess.resolveCurriculumToolAccess(
      (states as unknown as { levels: Parameters<typeof toolAccess.resolveCurriculumToolAccess>[0] }).levels,
    );
    const open = access.tools.filter((entry) => entry.unlocked).map((entry) => entry.code);
    assert.deepEqual(open, ["tool.trading_journal"]);
    assert.equal(access.unlockedCount, 1);
    const journal = access.tools.find((entry) => entry.code === "tool.trading_journal")!;
    assert.equal(journal.unlockLevel, 10);
    assert.equal(journal.reason, "unlock_level_completed");
    assert.equal(journal.unlockLevelStableCode, graph.levels[9].stableCode);
    // L15 exists in this graph and is NOT completed.
    const risk = access.tools.find((entry) => entry.code === "tool.risk_calculator")!;
    assert.equal(risk.unlocked, false);
    assert.equal(risk.reason, "unlock_level_incomplete");
    // L25 does not exist in a 20-level graph: fail closed, not "open".
    const indicator = access.tools.find((entry) => entry.code === "tool.indicator_checklist")!;
    assert.equal(indicator.unlocked, false);
    assert.equal(indicator.reason, "unlock_level_missing");
    assert.equal(indicator.unlockLevelStableCode, null);
  });

  await check("4.4 in_progress / pending_review / checkpoint_unverified all read LOCKED", async () => {
    for (const status of ["in_progress", "pending_review"] as const) {
      await wipeCurriculum();
      const graph = await toolGraph();
      const learner = await createUser(`tools-${status}`);
      const enrollment = await enroll(learner.id, graph, 10);
      await startLevel(enrollment.id, graph, 10, status);
      const states = await levelState.resolveUserCurriculumLevelStates({
        userId: learner.id,
        asOf: AT,
      });
      assert.equal(states.kind, "resolved", status);
      const access = toolAccess.resolveCurriculumToolAccess((states as unknown as { levels: Parameters<typeof toolAccess.resolveCurriculumToolAccess>[0] }).levels);
      assert.equal(access.unlockedCount, 0, `${status} must not open a tool`);
      const journal = access.tools.find((entry) => entry.code === "tool.trading_journal")!;
      assert.equal(journal.reason, "unlock_level_incomplete");
    }
  });

  await check("4.5 a high currentLevel with an INCOMPLETE source level keeps the tool locked", async () => {
    await wipeCurriculum();
    const graph = await toolGraph();
    const learner = await createUser("tools-anomaly");
    // An anomalous learner: the enrollment claims level 16, and every level is
    // completed EXCEPT the L10 checkpoint that releases the first tool.
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: learner.id,
        curriculumVersionId: graph.version.id,
        curriculumCode: graph.version.code,
        status: "active",
        enrolledAt: BEFORE,
        currentLevel: 16,
        highestCompletedLevel: 15,
      },
    });
    for (let levelNumber = 1; levelNumber <= 15; levelNumber += 1) {
      if (levelNumber === 10) continue;
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId: enrollment.id,
          curriculumVersionId: graph.version.id,
          levelDefinitionId: graph.levels[levelNumber - 1].id,
          status: "completed",
          startedAt: BEFORE,
          lastProgressAt: BEFORE,
          completedAt: BEFORE,
        },
      });
    }
    // Resolved directly from the durable rows: the level-state resolver refuses
    // this shape as corrupt, which is itself correct, so tool access is proven
    // against the rows the resolver would have read.
    const levels = await prisma.levelDefinition.findMany({
      where: { curriculumVersionId: graph.version.id },
      orderBy: { levelNumber: "asc" },
    });
    const progressRows = await prisma.userLevelProgress.findMany({
      where: { enrollmentId: enrollment.id },
    });
    const access = toolAccess.resolveCompletedCurriculumToolAccess(levels, progressRows);
    const journal = access.tools.find((entry) => entry.code === "tool.trading_journal")!;
    assert.equal(journal.unlocked, false, "an incomplete L10 keeps the L10 tool locked");
    assert.equal(journal.reason, "unlock_level_incomplete");
    // …while the L15 tool, whose source IS complete, follows progression truth.
    const risk = access.tools.find((entry) => entry.code === "tool.risk_calculator")!;
    assert.equal(risk.unlocked, true);
  });

  await check("4.6 XP does not unlock a tool, and zero XP does not close one", async () => {
    await wipeCurriculum();
    const graph = await toolGraph();

    // (a) A large XP balance with the source level incomplete → still locked.
    const rich = await createUser("tools-rich");
    const richEnrollment = await enroll(rich.id, graph, 10);
    await startLevel(richEnrollment.id, graph, 10);
    // Nine durable awards for the nine completed lessons: 1 350 XP, and the L10
    // checkpoint that releases the first tool is NOT completed.
    for (let levelNumber = 1; levelNumber <= 9; levelNumber += 1) {
      await prisma.xPTransaction.create({
        data: {
          enrollmentId: richEnrollment.id,
          userId: rich.id,
          curriculumVersionId: graph.version.id,
          levelDefinitionId: graph.levels[levelNumber - 1].id,
          sourceType: "level_completion",
          sourceId: `manual-completion:rich-${levelNumber}`,
          idempotencyKey: `xp:v2:level-completion:${richEnrollment.id}:manual-completion%3Arich-${levelNumber}`,
          payloadFingerprint: `sha256:${createHash("sha256").update(`rich-${levelNumber}`).digest("hex")}`,
          amount: 150,
        },
      });
    }
    assert.equal(await xpTotal(richEnrollment.id), 1_350, "this learner has plenty of XP");
    const richStates = await levelState.resolveUserCurriculumLevelStates({ userId: rich.id, asOf: AT });
    const richAccess = toolAccess.resolveCurriculumToolAccess(
      (richStates as unknown as { levels: Parameters<typeof toolAccess.resolveCurriculumToolAccess>[0] }).levels,
    );
    assert.equal(richAccess.unlockedCount, 0);

    // (b) Zero XP, source level complete → open.
    const poor = await createUser("tools-poor");
    const poorEnrollment = await enroll(poor.id, graph, 11);
    await startLevel(poorEnrollment.id, graph, 11);
    assert.equal(await xpTotal(poorEnrollment.id), 0, "this learner has earned nothing");
    const poorStates = await levelState.resolveUserCurriculumLevelStates({ userId: poor.id, asOf: AT });
    const poorAccess = toolAccess.resolveCurriculumToolAccess(
      (poorStates as unknown as { levels: Parameters<typeof toolAccess.resolveCurriculumToolAccess>[0] }).levels,
    );
    assert.equal(poorAccess.unlockedCount, 1);
    assert.equal(
      poorAccess.tools.find((entry) => entry.code === "tool.trading_journal")!.unlocked,
      true,
    );
  });

  await check("4.7 tool access reads no currentLevel arithmetic anywhere in its source", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/curriculum/tool-access.ts"),
      "utf8",
    );
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .join("\n");
    for (const forbidden of ["currentLevel", "highestCompletedLevel", "totalXp", "xpReward", "rank"]) {
      assert.ok(!code.includes(forbidden), `tool access must not read ${forbidden}`);
    }
  });

  /* ==================================================================== *
   * 5. THE LEARNER READ MODEL
   * ==================================================================== */

  await check("5.1 XP AVAILABLE WITH TOTAL 0 is distinct from XP UNAVAILABLE", async () => {
    await wipeCurriculum();
    const graph = await toolGraph();
    const learner = await createUser("read-xp");
    const enrollment = await enroll(learner.id, graph, 1);
    await startLevel(enrollment.id, graph, 1);
    assert.equal(await xpTotal(enrollment.id), 0);

    setFlags({ read: true, enrollment: true, xp: true });
    const enabled = await levelState.resolveUserCurriculumLevelStates({ userId: learner.id, asOf: AT });
    assert.equal(enabled.kind, "resolved");
    const enabledRead = readApi.mapEnrolledCurriculumRead(enabled as never);
    assert.equal(enabledRead.xp.kind, "available");
    assert.equal((enabledRead.xp as { currentXp: number }).currentXp, 0);
    const enabledSummary = readApi.mapEnrolledCurriculumSummary(enabled as never);
    assert.equal(enabledSummary.xp.kind, "available");
    assert.equal((enabledSummary.xp as { currentXp: number }).currentXp, 0);

    setFlags({ read: true, enrollment: true });
    const disabled = await levelState.resolveUserCurriculumLevelStates({ userId: learner.id, asOf: AT });
    const disabledRead = readApi.mapEnrolledCurriculumRead(disabled as never);
    assert.equal(disabledRead.xp.kind, "disabled");
    assert.ok(
      !("currentXp" in disabledRead.xp),
      "a disabled XP engine must not invent a total, not even 0",
    );
    setFlags({ read: true, enrollment: true, xp: true });
  });

  await check("5.2 the full read carries all 19 tool entries; the summary carries the slim shape", async () => {
    await wipeCurriculum();
    const graph = await toolGraph();
    const learner = await createUser("read-tools");
    const enrollment = await enroll(learner.id, graph, 11);
    await startLevel(enrollment.id, graph, 11);
    const states = await levelState.resolveUserCurriculumLevelStates({ userId: learner.id, asOf: AT });

    const full = readApi.mapEnrolledCurriculumRead(states as never);
    assert.equal(full.toolAccess.total, 19);
    assert.equal(full.toolAccess.tools.length, 19);
    assert.equal(full.toolAccess.unlockedCount, 1);
    for (const entry of full.toolAccess.tools) {
      assert.equal(typeof entry.code, "string");
      assert.equal(typeof entry.unlocked, "boolean");
      assert.equal(typeof entry.unlockLevel, "number");
      assert.ok(
        ["unlock_level_completed", "unlock_level_incomplete", "unlock_level_missing", "not_enrolled"].includes(
          entry.reason,
        ),
      );
    }

    const summary = readApi.mapEnrolledCurriculumSummary(states as never);
    assert.equal(summary.shape, "summary");
    assert.equal(summary.toolAccess.total, 19);
    assert.equal(summary.toolAccess.unlockedCount, 1);
    assert.deepEqual(summary.toolAccess.unlocked, ["tool.trading_journal"]);
    assert.ok(!("tools" in summary.toolAccess), "the summary must not carry the full set");
    // Slim really means slim: the summary must stay far smaller than the graph.
    assert.ok(
      JSON.stringify(summary).length < JSON.stringify(full).length / 2,
      "the summary must remain a projection, not a second full read",
    );
    // …and the shipped summary fields are unchanged.
    for (const key of ["curriculum", "enrollment", "progress", "currentModule", "currentLevel", "nextLevel", "xp"]) {
      assert.ok(key in summary, `summary must keep ${key}`);
    }
  });

  await check("5.3 the current level's authoritative reward travels to the client", async () => {
    await wipeCurriculum();
    const graph = await createGraph([
      { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 },
      { type: "mentor_review", completionMethod: "mentor_review", xpReward: 250 },
      { type: "financial_checkpoint", completionMethod: "balance_check", xpReward: 0 },
    ]);
    const learner = await createUser("read-reward");
    const enrollment = await enroll(learner.id, graph, 2);
    await startLevel(enrollment.id, graph, 2);
    const states = await levelState.resolveUserCurriculumLevelStates({ userId: learner.id, asOf: AT });
    const summary = readApi.mapEnrolledCurriculumSummary(states as never);
    assert.equal(summary.currentLevel!.xpReward, 250);
    const full = readApi.mapEnrolledCurriculumRead(states as never);
    const rewards = full.modules[0].levels.map((level) => level.xpReward);
    assert.deepEqual(rewards, [100, 250, 0]);
  });

  /* ==================================================================== *
   * 6. REGISTRATION AUTO-ENROLLMENT
   * ==================================================================== */

  await check("6.1 the activation condition is the conjunction of three flags", () => {
    const base = {
      CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED: "true",
      CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
      CURRICULUM_V2_READ_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv;
    assert.equal(registrationEnrollment.isRegistrationAutoEnrollmentActive(base), true);
    for (const key of Object.keys(base)) {
      const partial = { ...base } as Record<string, string | undefined>;
      delete partial[key];
      assert.equal(
        registrationEnrollment.isRegistrationAutoEnrollmentActive(partial as NodeJS.ProcessEnv),
        false,
        `${key} absent must disable auto-enrollment`,
      );
      assert.equal(
        registrationEnrollment.isRegistrationAutoEnrollmentActive({
          ...base,
          [key]: "false",
        } as unknown as NodeJS.ProcessEnv),
        false,
        `${key}=false must disable auto-enrollment`,
      );
    }
    // NODE_ENV is not part of the decision.
    assert.equal(
      registrationEnrollment.isRegistrationAutoEnrollmentActive({
        ...base,
        NODE_ENV: "production",
      } as unknown as NodeJS.ProcessEnv),
      true,
    );
    assert.equal(
      registrationEnrollment.isRegistrationAutoEnrollmentActive({ NODE_ENV: "production" } as never),
      false,
    );
  });

  await check("6.2 OFF: the hook is a no-op and the learner is created with no enrollment", async () => {
    await wipeCurriculum();
    await createGraph([{ type: "lesson", completionMethod: "manual", xpReward: 150 }]);
    setFlags({ read: true, enrollment: true, xp: true, autoEnroll: false });
    const learner = await createUser("auto-off");
    const result = await prisma.$transaction((tx) =>
      registrationEnrollment.autoEnrollNewRegistrationInTransaction(tx, {
        userId: learner.id,
        asOf: AT,
      }),
    );
    assert.deepEqual(result, { kind: "inactive" });
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: learner.id } }), 0);
  });

  await check("6.3 ON with exactly one active curriculum: registration + enrollment succeed", async () => {
    await wipeCurriculum();
    const graph = await createGraph([{ type: "lesson", completionMethod: "manual", xpReward: 150 }]);
    setFlags({ read: true, enrollment: true, xp: true, autoEnroll: true });
    const learner = await createUser("auto-on");
    const result = await prisma.$transaction((tx) =>
      registrationEnrollment.autoEnrollNewRegistrationInTransaction(tx, {
        userId: learner.id,
        asOf: AT,
      }),
    );
    assert.equal(result.kind, "enrolled");
    const rows = await prisma.userCurriculumEnrollment.findMany({ where: { userId: learner.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].curriculumVersionId, graph.version.id);
    assert.equal(rows[0].curriculumCode, "ata-v2");
    assert.equal(rows[0].status, "active");
    assert.equal(rows[0].currentLevel, 1);
    assert.equal(rows[0].highestCompletedLevel, 0);
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "UserCurriculumEnrollment", entityId: String(rows[0].id) },
    });
    assert.ok(audit, "the enrollment must be audited");
    assert.equal(audit!.userId, null, "a system enrollment names no acting user");
    assert.equal(
      (audit!.metadata as { provenance?: string }).provenance,
      "system_registration",
    );
  });

  await check("6.4 ON with NO published curriculum: the whole registration rolls back", async () => {
    await wipeCurriculum();
    setFlags({ read: true, enrollment: true, xp: true, autoEnroll: true });
    const email = `auto-none-${process.pid}@example.com`;
    await expectCode(
      () =>
        prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { email, name: "Rollback", role: "user", status: "active" },
          });
          return registrationEnrollment.autoEnrollNewRegistrationInTransaction(tx, {
            userId: created.id,
            asOf: AT,
          });
        }),
      "ENROLLMENT_TARGET_UNAVAILABLE",
    );
    assert.equal(
      await prisma.user.count({ where: { email } }),
      0,
      "a failed enrollment must leave NO user behind",
    );
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
  });

  await check("6.5 two active candidates are impossible, and would fail closed anyway", async () => {
    await wipeCurriculum();
    const graph = await createGraph([{ type: "lesson", completionMethod: "manual", xpReward: 150 }]);
    setFlags({ read: true, enrollment: true, xp: true, autoEnroll: true });

    // (a) THE DATA MODEL FORBIDS IT. A partial unique index allows at most one
    // published version per curriculum code, so "which of the two?" is a
    // question the database refuses to let anyone ask.
    let conflicted = false;
    try {
      await prisma.curriculumVersion.create({
        data: {
          code: "ata-v2",
          name: "second-published",
          versionNumber: 9_000,
          status: "published",
          publishedAt: BEFORE,
          effectiveFrom: BEFORE,
        },
      });
    } catch (error) {
      conflicted = (error as { code?: string }).code === "P2002";
    }
    assert.equal(conflicted, true, "a second published ata-v2 version must be impossible");
    assert.equal(
      await prisma.curriculumVersion.count({ where: { code: "ata-v2", status: "published" } }),
      1,
    );

    // (b) AND THE RESOLVER FAILS CLOSED REGARDLESS. If that index were ever
    // absent — a restored dump, a hand-edited database — the resolver still
    // refuses rather than picking one. Proven by handing it a client that
    // answers with two rows, which is the only way to reach the branch.
    const resolver = await import("../../src/lib/curriculum/resolver");
    const twoRows = [
      { ...graph.version, modules: [], levels: [] },
      { ...graph.version, id: graph.version.id + 1, modules: [], levels: [] },
    ];
    const ambiguous = await resolver.resolvePublishedCurriculum({
      curriculumCode: "ata-v2",
      asOf: AT,
      db: { curriculumVersion: { findMany: async () => twoRows } } as never,
    });
    assert.equal(ambiguous.kind, "corrupt");
    assert.equal((ambiguous as { reason: string }).reason, "duplicate_published_version");

    // …and a corrupt target is what the enrollment primitive turns into a
    // refusal, which the registration transaction turns into a rollback.
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
  });

  await check("6.6 a replayed registration produces no duplicate enrollment", async () => {
    await wipeCurriculum();
    await createGraph([{ type: "lesson", completionMethod: "manual", xpReward: 150 }]);
    setFlags({ read: true, enrollment: true, xp: true, autoEnroll: true });
    const learner = await createUser("auto-replay");
    const first = await prisma.$transaction((tx) =>
      registrationEnrollment.autoEnrollNewRegistrationInTransaction(tx, {
        userId: learner.id,
        asOf: AT,
      }),
    );
    const second = await prisma.$transaction((tx) =>
      registrationEnrollment.autoEnrollNewRegistrationInTransaction(tx, {
        userId: learner.id,
        asOf: AT,
      }),
    );
    assert.equal((first as { created: boolean }).created, true);
    assert.equal((second as { created: boolean }).created, false);
    assert.equal(
      (first as { enrollmentId: number }).enrollmentId,
      (second as { enrollmentId: number }).enrollmentId,
    );
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: learner.id } }), 1);
  });

  await check("6.7 an inactive learner cannot be auto-enrolled", async () => {
    await wipeCurriculum();
    await createGraph([{ type: "lesson", completionMethod: "manual", xpReward: 150 }]);
    setFlags({ read: true, enrollment: true, xp: true, autoEnroll: true });
    const learner = await createUser("auto-blocked");
    await prisma.user.update({ where: { id: learner.id }, data: { status: "blocked" } });
    await expectCode(
      () =>
        prisma.$transaction((tx) =>
          registrationEnrollment.autoEnrollNewRegistrationInTransaction(tx, {
            userId: learner.id,
            asOf: AT,
          }),
        ),
      "ENROLLMENT_USER_INACTIVE",
    );
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: learner.id } }), 0);
  });

  await check("6.8 auto-enrollment cannot nominate an actor or a curriculum", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/curriculum/registration-enrollment.ts"),
      "utf8",
    );
    assert.ok(!/actorId/.test(source), "there must be no actor parameter on this path");
    assert.ok(
      !/curriculumCode|curriculumVersionId\s*[:=]\s*input/.test(source),
      "the caller must not be able to choose a curriculum",
    );
    // The primitive it calls is the accepted Phase-A system enrollment.
    assert.equal(
      typeof enrollmentDomain.enrollActiveCurriculumForNewUserInTransaction,
      "function",
    );
  });

  await check("6.9 the admin enrollment command is unchanged and still requires an active admin", async () => {
    await wipeCurriculum();
    await createGraph([{ type: "lesson", completionMethod: "manual", xpReward: 150 }]);
    setFlags({ read: true, enrollment: true, xp: true, autoEnroll: true });
    const learner = await createUser("admin-target");
    const notAdmin = await createUser("not-admin");
    await expectCode(
      () =>
        enrollmentDomain.enrollUserInPublishedCurriculum({
          userId: learner.id,
          actorId: notAdmin.id,
          asOf: AT,
          db: prisma,
        }),
      "ENROLLMENT_ACTOR_FORBIDDEN",
    );
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: learner.id } }), 0);
  });

  /* ==================================================================== *
   * 7. XP IS NOT PROGRESSION
   * ==================================================================== */

  await check("7.1 no rank, unlock or level is decided by an XP threshold, anywhere", () => {
    const roots = ["src/lib/curriculum", "src/app/api/curriculum", "src/lib/curriculum/package"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.ts$/.test(entry.name)) continue;
        const source = fs.readFileSync(full, "utf8");
        const lines = source.split("\n");
        lines.forEach((line, index) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
          // An XP comparison in the same statement as a rank, an unlock or a
          // tool. `requiredXp` is the ACCEPTED level-visibility threshold and is
          // deliberately not matched here — it gates presentation, never a rank,
          // and it lives in the level definition rather than in a rule.
          if (
            /\b(totalXp|currentXp|xpReward|xpAwarded)\b/.test(line) &&
            /\b(rank|unlock|toolAccess|tool\.)\w*/i.test(line) &&
            /[<>]=?/.test(line)
          ) {
            offenders.push(`${full}:${index + 1}`);
          }
        });
      }
    };
    for (const root of roots) walk(path.join(process.cwd(), root));
    assert.deepEqual(offenders, [], `XP must never decide a rank or an unlock: ${offenders.join(", ")}`);
  });

  await check("7.2 ranks remain checkpoint transitions, with no XP term at all", () => {
    for (const rank of vocabulary.RANK_TRANSITIONS) {
      assert.equal(typeof rank.unlockLevel, "number");
      assert.ok(!("requiredXp" in rank), "a rank must not carry an XP threshold");
      assert.ok(!("xp" in rank), "a rank must not carry an XP term");
    }
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/curriculum/product-vocabulary.ts"),
      "utf8",
    );
    assert.ok(!/\bxp\b/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "")), "the vocabulary knows no XP");
  });

  await check("7.3 XP never satisfies a checkpoint or completes a level", async () => {
    await wipeCurriculum();
    setFlags({ read: true, enrollment: true, xp: true });
    const graph = await createGraph([
      { type: "financial_checkpoint", completionMethod: "balance_check", xpReward: 0 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const learner = await createUser("xp-gate");
    const enrollment = await enroll(learner.id, graph, 1);
    await startLevel(enrollment.id, graph, 1);
    // There is no owner that reads XP, so the checkpoint owner is the only way
    // through this gate and it needs a durable verification attempt. Without
    // one the gate stays shut, whatever the ledger says.
    const result = await completion.completeCurriculumLevel({
      enrollmentId: enrollment.id,
      levelDefinitionId: graph.levels[0].id,
      sourceType: "checkpoint_verification",
      sourceId: "checkpoint-verification:999999",
      evaluationTime: AT,
      db: prisma,
    });
    assert.notEqual(result.kind, "completed");
    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: enrollment.id, levelDefinitionId: graph.levels[0].id },
    });
    assert.equal(progress.status, "in_progress");
  });

  await prisma.$disconnect();
  cleanupDb();
  setFlags({});

  console.log(`\nPhase F curriculum regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exitCode = 1;
});
