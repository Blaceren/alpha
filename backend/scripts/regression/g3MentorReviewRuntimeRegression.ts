/**
 * G3 — the mentor-review runtime: authorization (§13) and completion/XP (§14).
 *
 * The two-actor lifecycle was shipped and correct; what G3 added is the learner
 * transport and the reviewer's discovery queue that finally make it reachable.
 * These assertions are therefore load-bearing for the first time.
 *
 * Every scenario owns a temporary SQLite fixture. No HTTP route, no live
 * database, no external owner and no network is used.
 *
 * Run: npx tsx scripts/regression/g3MentorReviewRuntimeRegression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  PrismaClient,
  type LevelDefinition,
  type LevelDefinitionType,
  type UserRole,
} from "@prisma/client";

const dbPath = `/tmp/ata-g3-mentor-review-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const EVALUATION_TIME = new Date("2026-08-12T12:00:00.000Z");
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
    console.error(error instanceof Error ? error.message : error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

async function refuses(code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual ?? String(error)}`);
    return;
  }
  assert.fail(`expected ${code} but the call SUCCEEDED`);
}

async function main() {
  cleanupDb();
  const migration = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const mentor = await import("../../src/lib/curriculum/mentor-review");
  const queue = await import("../../src/lib/curriculum/mentor-review-queue");

  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_XP_ENABLED = "true";

  let sequence = 0;

  async function reset() {
    await prisma.xPTransaction.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(label: string, role: UserRole = "user") {
    sequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${sequence}@example.com`,
        name: label,
        status: "active",
        role,
      },
    });
  }

  type Spec = { type?: LevelDefinitionType; completionMethod?: string; xpReward?: number };

  async function createGraph(specs: Spec[]) {
    sequence += 1;
    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: `g3-mentor-${sequence}`,
        versionNumber: sequence,
        status: "published",
        publishedAt: EVALUATION_TIME,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m-${version.id}`,
        title: "G3 mentor module",
        firstLevel: 1,
        lastLevel: specs.length,
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
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.g3m-${version.id}`,
            type: spec.type ?? "mentor_review",
            title: `Level ${levelNumber}`,
            completionMethod: spec.completionMethod ?? "mentor_review",
            xpReward: spec.xpReward ?? 250,
            requiredXp: 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            status: "active",
          },
        }),
      );
    }
    return { version, levels };
  }

  async function enroll(userId: number, versionId: number, currentLevel: number) {
    const version = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: versionId } });
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status: "active",
        enrolledAt: EVALUATION_TIME,
        currentLevel,
        highestCompletedLevel: currentLevel - 1,
      },
    });
  }

  async function startLevel(
    enrollment: { id: number; curriculumVersionId: number },
    level: LevelDefinition,
  ) {
    return prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: enrollment.curriculumVersionId,
        levelDefinitionId: level.id,
        status: "in_progress",
        startedAt: EVALUATION_TIME,
        lastProgressAt: EVALUATION_TIME,
        attemptCount: 0,
      },
    });
  }

  /** The canonical shape: one mentor-review level followed by a lesson. */
  const SHAPE: Spec[] = [
    { type: "mentor_review", completionMethod: "mentor_review", xpReward: 250 },
    { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 },
  ];

  async function stage() {
    await reset();
    const learner = await createUser("learner");
    const reviewer = await createUser("reviewer", "mentor");
    const { version, levels } = await createGraph(SHAPE);
    const enrollment = await enroll(learner.id, version.id, 1);
    const progress = await startLevel(enrollment, levels[0]);
    return { learner, reviewer, version, levels, enrollment, progress };
  }

  /* ------------------------------------------------- §14 happy path + XP */

  await check("submission alone does NOT complete and awards NO XP", async () => {
    const { learner, levels, progress } = await stage();

    const receipt = await mentor.requestMentorReview({
      actorUserId: learner.id,
      stableCode: levels[0].stableCode,
      evaluationTime: EVALUATION_TIME,
    });
    assert.equal(receipt.created, true);
    assert.equal(receipt.state, "pending_review");

    const after = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } });
    assert.equal(after.status, "pending_review");
    assert.equal(after.completedAt, null, "submission must not complete");
    assert.equal(await prisma.xPTransaction.count(), 0, "submission must award no XP");
  });

  await check("approval completes exactly once and awards the canonical XP once", async () => {
    const { learner, reviewer, levels, enrollment, progress } = await stage();
    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });

    const approval = await mentor.approveMentorReview({
      reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
    });
    assert.equal(approval.created, true);
    assert.equal(approval.state, "completed");
    assert.equal(approval.xpAwarded, 250, "the canonical mentor XP");
    assert.equal(approval.learnerUserId, learner.id);
    assert.equal(approval.reviewerUserId, reviewer.id);
    assert.equal(approval.reviewerRole, "mentor");
    assert.equal(approval.nextLevelNumber, 2);

    assert.equal(await prisma.xPTransaction.count(), 1);
    const sum = await prisma.xPTransaction.aggregate({ _sum: { amount: true } });
    assert.equal(sum._sum.amount, 250);
    const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    assert.equal(after.currentLevel, 2, "the next level unlocks ONLY after accepted completion");
    assert.equal(after.highestCompletedLevel, 1);
  });

  await check("the SAME reviewer approving again replays — no second XP, no second unlock", async () => {
    const { learner, reviewer, levels, progress } = await stage();
    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    const first = await mentor.approveMentorReview({
      reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
    });
    const second = await mentor.approveMentorReview({
      reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.completedAt, first.completedAt);
    assert.equal(await prisma.xPTransaction.count(), 1, "still exactly one XP row");
  });

  await check("a DIFFERENT reviewer approving an XP-bearing level already approved conflicts", async () => {
    const { learner, reviewer, levels, progress, version } = await stage();
    const other = await createUser("other-reviewer", "admin");
    await enroll(other.id, version.id, 1).catch(() => undefined);

    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    await mentor.approveMentorReview({
      reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
    });
    await refuses("MENTOR_REVIEW_CONFLICT", () =>
      mentor.approveMentorReview({
        reviewerUserId: other.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 1, "no second XP row");
  });

  /* ------------------------------------------------------- §13 authorization */

  await check("A1 a LEARNER cannot approve their own mentor review", async () => {
    const { learner, levels, progress } = await stage();
    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    // The learner has no reviewer role at all.
    await refuses("MENTOR_REVIEW_FORBIDDEN", () =>
      mentor.approveMentorReview({
        reviewerUserId: learner.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 0);
    const after = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } });
    assert.equal(after.status, "pending_review", "nothing changed");
  });

  await check("A2 an ADMIN/MENTOR who owns the enrollment still cannot approve their own level", async () => {
    await reset();
    // The reviewer IS the learner: an active mentor enrolled on the curriculum.
    const selfReviewer = await createUser("self-reviewer", "mentor");
    const { version, levels } = await createGraph(SHAPE);
    const enrollment = await enroll(selfReviewer.id, version.id, 1);
    const progress = await startLevel(enrollment, levels[0]);
    await mentor.requestMentorReview({
      actorUserId: selfReviewer.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });

    await refuses("MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN", () =>
      mentor.approveMentorReview({
        reviewerUserId: selfReviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("A3 an ordinary user cannot approve someone else's review", async () => {
    const { learner, levels, progress } = await stage();
    const stranger = await createUser("stranger");
    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    await refuses("MENTOR_REVIEW_FORBIDDEN", () =>
      mentor.approveMentorReview({
        reviewerUserId: stranger.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("A4 a reviewer cannot approve a level the learner has NOT submitted", async () => {
    const { reviewer, progress } = await stage();
    // Deliberately no requestMentorReview: the level is still in_progress.
    await refuses("MENTOR_REVIEW_NOT_PENDING", () =>
      mentor.approveMentorReview({
        reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("A5 a learner cannot act for another learner — the actor comes from the session", async () => {
    const { learner, levels, version } = await stage();
    const attacker = await createUser("attacker");
    // The attacker is not enrolled; there is no parameter naming another learner.
    await refuses("MENTOR_REVIEW_NOT_ENROLLED", () =>
      mentor.requestMentorReview({
        actorUserId: attacker.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
      }),
    );
    // And the learner's own row is untouched.
    const rows = await prisma.userLevelProgress.findMany({ where: { status: "pending_review" } });
    assert.equal(rows.length, 0);
    assert.ok(learner.id !== attacker.id);
    assert.ok(version.id > 0);
  });

  await check("A6 the wrong completion method is refused on both halves", async () => {
    await reset();
    const learner = await createUser("learner");
    const reviewer = await createUser("reviewer", "mentor");
    const { version, levels } = await createGraph([
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const enrollment = await enroll(learner.id, version.id, 1);
    const progress = await startLevel(enrollment, levels[0]);

    await refuses("MENTOR_REVIEW_LEVEL_WRONG_OWNER", () =>
      mentor.requestMentorReview({
        actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
      }),
    );
    await refuses("MENTOR_REVIEW_LEVEL_WRONG_OWNER", () =>
      mentor.approveMentorReview({
        reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("A7 a learner cannot resubmit or reopen an approved level", async () => {
    const { learner, reviewer, levels, progress } = await stage();
    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    await mentor.approveMentorReview({
      reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
    });
    // `CONFLICT`, not `LEVEL_NOT_CURRENT`: the status check runs first and says
    // the precise thing — "level is not awaiting the learner". A completed level
    // has nothing to submit and there is deliberately no path back, so a learner
    // cannot reopen a level a reviewer already approved.
    await refuses("MENTOR_REVIEW_CONFLICT", () =>
      mentor.requestMentorReview({
        actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 1);
    const after = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } });
    assert.equal(after.status, "completed", "the approved level stays completed");
  });

  await check("A8 submission is idempotent — a double tap produces one audit event", async () => {
    const { learner, levels } = await stage();
    const first = await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    const second = await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    const audits = await prisma.auditLog.count({ where: { action: { contains: "MENTOR_REVIEW" } } });
    assert.equal(audits, 1, "exactly one submission audit event");
  });

  /* ------------------------------------------------------------ the queue */

  await check("Q1 the queue lists a submitted level and nothing else", async () => {
    const { learner, reviewer, levels } = await stage();
    const before = await queue.listMentorReviewQueue({ reviewerUserId: reviewer.id, db: prisma });
    assert.equal(before.items.length, 0, "nothing is waiting before submission");

    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    const after = await queue.listMentorReviewQueue({ reviewerUserId: reviewer.id, db: prisma });
    assert.equal(after.items.length, 1);
    assert.equal(after.items[0].levelNumber, 1);
    assert.equal(after.items[0].learnerUserId, learner.id);
    assert.equal(after.items[0].xpReward, 250);
    assert.equal(after.nextCursor, null);
  });

  await check("Q2 the queue carries NO email and no financial field", async () => {
    const { learner, reviewer, levels } = await stage();
    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    const page = await queue.listMentorReviewQueue({ reviewerUserId: reviewer.id, db: prisma });
    const serialised = JSON.stringify(page);
    assert.ok(!serialised.includes("@example.com"), "no email");
    assert.ok(!/balance|deposit|pocket|passwordHash/i.test(serialised), "no financial or credential field");
    assert.deepEqual(
      Object.keys(page.items[0]).sort(),
      [
        "curriculumCode", "curriculumVersionNumber", "learnerName", "learnerUserId",
        "levelNumber", "levelTitle", "progressId", "requestedAt", "stableCode", "xpReward",
      ].sort(),
    );
  });

  await check("Q3 the queue excludes the reviewer's OWN waiting work", async () => {
    await reset();
    const selfReviewer = await createUser("self-reviewer", "mentor");
    const other = await createUser("other-learner");
    const { version, levels } = await createGraph(SHAPE);

    const selfEnrollment = await enroll(selfReviewer.id, version.id, 1);
    await startLevel(selfEnrollment, levels[0]);
    await mentor.requestMentorReview({
      actorUserId: selfReviewer.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });

    const otherEnrollment = await enroll(other.id, version.id, 1);
    await startLevel(otherEnrollment, levels[0]);
    await mentor.requestMentorReview({
      actorUserId: other.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });

    const page = await queue.listMentorReviewQueue({ reviewerUserId: selfReviewer.id, db: prisma });
    assert.equal(page.items.length, 1, "only the other learner's work");
    assert.equal(page.items[0].learnerUserId, other.id);
  });

  await check("Q4 an approved level leaves the queue", async () => {
    const { learner, reviewer, levels, progress } = await stage();
    await mentor.requestMentorReview({
      actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
    });
    await mentor.approveMentorReview({
      reviewerUserId: reviewer.id, progressId: progress.id, evaluationTime: EVALUATION_TIME,
    });
    const page = await queue.listMentorReviewQueue({ reviewerUserId: reviewer.id, db: prisma });
    assert.equal(page.items.length, 0);
  });

  await check("Q5 the queue never lists a non-mentor-review level", async () => {
    await reset();
    const learner = await createUser("learner");
    const reviewer = await createUser("reviewer", "mentor");
    const { version, levels } = await createGraph([
      { type: "report", completionMethod: "report_approval", xpReward: 500 },
    ]);
    const enrollment = await enroll(learner.id, version.id, 1);
    // Force the report level into pending_review directly — the state a report
    // legitimately reaches. It must NOT appear in the mentor queue.
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: enrollment.curriculumVersionId,
        levelDefinitionId: levels[0].id,
        status: "pending_review",
        startedAt: EVALUATION_TIME,
        lastProgressAt: EVALUATION_TIME,
        attemptCount: 0,
      },
    });
    const page = await queue.listMentorReviewQueue({ reviewerUserId: reviewer.id, db: prisma });
    assert.equal(page.items.length, 0, "a report awaiting review is not a mentor review");
  });

  await check("Q6 the queue paginates deterministically and bounds its page size", async () => {
    await reset();
    const reviewer = await createUser("reviewer", "mentor");
    const { version, levels } = await createGraph(SHAPE);
    for (let index = 0; index < 5; index += 1) {
      const learner = await createUser(`learner-${index}`);
      const enrollment = await enroll(learner.id, version.id, 1);
      await startLevel(enrollment, levels[0]);
      await mentor.requestMentorReview({
        actorUserId: learner.id, stableCode: levels[0].stableCode, evaluationTime: EVALUATION_TIME,
      });
    }

    const first = await queue.listMentorReviewQueue({ reviewerUserId: reviewer.id, limit: 2, db: prisma });
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor !== null);

    const second = await queue.listMentorReviewQueue({
      reviewerUserId: reviewer.id, limit: 2, cursor: first.nextCursor!, db: prisma,
    });
    assert.equal(second.items.length, 2);
    assert.ok(
      second.items.every((item) => item.progressId > first.items[1].progressId),
      "the cursor is exclusive and ascending",
    );

    const overLimit = await queue.listMentorReviewQueue({
      reviewerUserId: reviewer.id, limit: 9999, db: prisma,
    });
    assert.ok(overLimit.items.length <= queue.MENTOR_REVIEW_QUEUE_MAX_LIMIT);
  });

  await check("database integrity intact after every scenario", async () => {
    const fk = (await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")) as unknown[];
    assert.equal(fk.length, 0);
    const integrity = (await prisma.$queryRawUnsafe("PRAGMA integrity_check")) as Array<Record<string, string>>;
    assert.equal(Object.values(integrity[0])[0], "ok");
  });

  await prisma.$disconnect();
  cleanupDb();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exit(1);
});
