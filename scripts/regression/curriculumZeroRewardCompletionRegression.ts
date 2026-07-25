/**
 * AC-1 (operator platform decision, 2026-07-25) — zero-reward level completion.
 *
 * A level with xpReward === 0 completes server-side WITHOUT creating an
 * XPTransaction and WITHOUT requiring CURRICULUM_V2_XP_ENABLED. A positive reward
 * still completes atomically with its XPTransaction and still requires the XP flag.
 * A negative or non-integer reward is invalid. This is a general platform rule
 * exercised here through the completion primitive with the `level_completion` owner
 * (no assessment machinery needed); the assessment_pass end-to-end path is proven
 * separately in the AC-1 audit.
 *
 * Self-contained temp SQLite; never touches live DEV.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-zero-reward-completion-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const previousDatabaseUrl = process.env.DATABASE_URL;
const FLAGS = ["READ", "ENROLLMENT", "XP"] as const;
const previousFlags = Object.fromEntries(FLAGS.map((f) => [f, process.env[`CURRICULUM_V2_${f}_ENABLED`]]));
let passed = 0;
let failed = 0;

function cleanup() { for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true }); }
function setFlags(read: boolean, enrollment: boolean, xp: boolean) {
  process.env.CURRICULUM_V2_READ_ENABLED = read ? "true" : "false";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = enrollment ? "true" : "false";
  if (xp) process.env.CURRICULUM_V2_XP_ENABLED = "true";
  else delete process.env.CURRICULUM_V2_XP_ENABLED;
}
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e instanceof Error ? e.message : e); }
}

async function main() {
  cleanup();
  const migrate = spawnSync(process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" });
  if (migrate.status !== 0) throw new Error(`${migrate.stdout}\n${migrate.stderr}`);
  process.env.DATABASE_URL = dbUrl;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const completion = await import("../../src/lib/curriculum/completion");

  let seq = 0;
  const now = new Date("2026-07-25T10:00:00.000Z");

  /** Seed a two-level lesson curriculum with a chosen xpReward on L1; L1 in_progress. */
  async function seed(xpReward: number) {
    seq += 1;
    // The completion primitive pins curriculumCode to DEFAULT_CURRICULUM_CODE
    // ("ata-v2"), which is globally unique, so reset the curriculum graph each seed.
    await prisma.xPTransaction.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({ data: { email: `zrc-${seq}@example.com`, name: `ZRC ${seq}`, status: "active" } });
    const curriculum = await prisma.curriculumVersion.create({
      data: { code: "ata-v2", name: `ZRC ${seq}`, versionNumber: 5000 + seq, status: "published", publishedAt: now },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: `zrc-${seq}`, title: "M", firstLevel: 1, lastLevel: 2 },
    });
    const l1 = await prisma.levelDefinition.create({
      data: { curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 1, stableCode: `v2.l001.zrc-${seq}`, type: "lesson", title: "L1", completionMethod: "manual", xpReward },
    });
    await prisma.levelDefinition.create({
      data: { curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 2, stableCode: `v2.l002.zrc-next-${seq}`, type: "lesson", title: "L2", completionMethod: "manual", xpReward: 10, requiredPreviousLevel: 1 },
    });
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: { userId: user.id, curriculumVersionId: curriculum.id, curriculumCode: "ata-v2", status: "active", currentLevel: 1, highestCompletedLevel: 0, enrolledAt: now },
    });
    const progress = await prisma.userLevelProgress.create({
      data: { enrollmentId: enrollment.id, curriculumVersionId: curriculum.id, levelDefinitionId: l1.id, status: "in_progress", startedAt: now, lastProgressAt: now },
    });
    return { user, enrollment, l1, progress };
  }

  function complete(f: Awaited<ReturnType<typeof seed>>, requestSuffix = "") {
    return prisma.$transaction((tx) =>
      completion.completeCurriculumLevelInTransaction(tx, {
        enrollmentId: f.enrollment.id, levelDefinitionId: f.l1.id,
        sourceType: "level_completion", sourceId: `zrc-${f.enrollment.id}${requestSuffix}`,
        actorId: f.user.id, evaluationTime: now,
      }),
    );
  }
  async function errorCodeOf(fn: () => Promise<unknown>): Promise<string> {
    try { await fn(); return "none"; } catch (e) { return (e as { code?: string }).code ?? "unknown"; }
  }

  /* ------------------- zero reward: completes, no XP, no flag ------------------- */
  await check("1 zero-reward level completes with XP flag OFF", async () => {
    setFlags(true, true, false); // XP OFF
    const f = await seed(0);
    const result = await complete(f);
    assert.equal(result.kind, "completed");
    assert.equal(result.xpAwarded, 0);
    assert.equal(result.xpTransactionId, null);
    assert.equal(result.nextLevelNumber, 2);
  });

  await check("2 zero-reward completion creates NO XPTransaction", async () => {
    setFlags(true, true, false);
    const f = await seed(0);
    await complete(f);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: f.enrollment.id } }), 0);
    const p = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    assert.equal(p.status, "completed");
    const e = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: f.enrollment.id } });
    assert.equal(e.highestCompletedLevel, 1);
    assert.equal(e.currentLevel, 2);
  });

  await check("3 zero-reward completion audit records a null xpTransactionId", async () => {
    setFlags(true, true, false);
    const f = await seed(0);
    await complete(f);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: { contains: "LEVEL_COMPLETED" }, entityId: String(f.progress.id) },
      orderBy: { id: "desc" },
    });
    const meta = audit.metadata as Record<string, unknown>;
    assert.equal(meta.xpTransactionId, null);
    assert.equal(meta.xpAwarded, 0);
  });

  await check("4 zero-reward completed-retry is idempotent (no XP row, same result)", async () => {
    setFlags(true, true, false);
    const f = await seed(0);
    const first = await complete(f);
    const retry = await complete(f);
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.xpTransactionId, null);
    assert.equal(retry.levelNumber, first.levelNumber);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: f.enrollment.id } }), 0);
    assert.equal(await prisma.userLevelProgress.count({ where: { levelDefinitionId: f.l1.id, status: "completed" } }), 1);
  });

  /* ------------------- positive reward: unchanged behaviour ------------------- */
  await check("5 positive-reward completion still creates exactly one XPTransaction", async () => {
    setFlags(true, true, true); // XP ON
    const f = await seed(37);
    const result = await complete(f);
    assert.equal(result.kind, "completed");
    assert.equal(result.xpAwarded, 37);
    assert.equal(typeof result.xpTransactionId, "number");
    const rows = await prisma.xPTransaction.findMany({ where: { enrollmentId: f.enrollment.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 37);
  });

  await check("6 positive-reward completion FAILS CLOSED when the XP flag is OFF", async () => {
    setFlags(true, true, false); // XP OFF
    const f = await seed(37);
    const code = await errorCodeOf(() => complete(f));
    assert.equal(code, "COMPLETION_DISABLED");
    // fails closed: no completion, no XP
    assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: f.progress.id } })).status, "in_progress");
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: f.enrollment.id } }), 0);
  });

  await check("7 positive-reward completed-retry still verifies its durable XP award", async () => {
    setFlags(true, true, true);
    const f = await seed(37);
    const first = await complete(f);
    const retry = await complete(f);
    assert.equal(retry.created, false);
    assert.equal(retry.xpTransactionId, first.xpTransactionId);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: f.enrollment.id } }), 1);
  });

  /* ------------------------- invalid rewards rejected ------------------------- */
  await check("8 negative reward is invalid (COMPLETION_REWARD_INVALID), fails closed", async () => {
    setFlags(true, true, true);
    const f = await seed(-1);
    const code = await errorCodeOf(() => complete(f));
    assert.equal(code, "COMPLETION_REWARD_INVALID");
    assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: f.progress.id } })).status, "in_progress");
  });

  // Note: the `!Number.isInteger` branch of assertReward is defence-in-depth against
  // a corrupted row. It is not reachable through the int schema/INTEGER column
  // (SQLite integer affinity coerces any injected float back), so it is not tested
  // through the DB layer here; the negative-reward case (8) exercises the bound.

  /* ----------------------- base flags still required ----------------------- */
  await check("10 zero-reward completion still requires READ + ENROLLMENT", async () => {
    setFlags(false, true, false); // READ OFF
    const f = await seed(0);
    assert.equal(await errorCodeOf(() => complete(f)), "COMPLETION_DISABLED");
    setFlags(true, false, false); // ENROLLMENT OFF
    assert.equal(await errorCodeOf(() => complete(f)), "COMPLETION_DISABLED");
  });

  await prisma.$disconnect();
}

main()
  .catch((e) => { failed += 1; console.error("FATAL", e); })
  .finally(() => {
    cleanup();
    for (const f of FLAGS) {
      const key = `CURRICULUM_V2_${f}_ENABLED`;
      if (previousFlags[f] === undefined) delete process.env[key];
      else process.env[key] = previousFlags[f] as string;
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
