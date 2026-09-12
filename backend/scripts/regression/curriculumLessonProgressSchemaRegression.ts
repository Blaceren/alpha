import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-lesson-progress-schema-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const fingerprintA = `sha256:${"a".repeat(64)}`;
const fingerprintB = `sha256:${"b".repeat(64)}`;
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
    console.error(error instanceof Error ? error.message : error);
  }
}

async function expectConstraint(fn: () => Promise<unknown>, label: string) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${label}: expected database constraint failure`);
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

async function main() {
  cleanupDb();
  const runner = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (runner.status !== 0) throw new Error(`${runner.stdout}\n${runner.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260715010000_lesson_progress_autosave_idempotency",
    "migration.sql",
  );

  const userA = await prisma.user.create({ data: { email: "receipt-a@example.com", name: "Receipt A" } });
  const userB = await prisma.user.create({ data: { email: "receipt-b@example.com", name: "Receipt B" } });
  const versionA = await prisma.curriculumVersion.create({
    data: { code: "receipt-a", name: "Receipt A", versionNumber: 1, status: "published", publishedAt: new Date() },
  });
  const moduleA = await prisma.moduleDefinition.create({
    data: { curriculumVersionId: versionA.id, moduleNumber: 1, code: "receipt-module-a", title: "A", firstLevel: 1, lastLevel: 2 },
  });
  const levelA1 = await prisma.levelDefinition.create({
    data: { curriculumVersionId: versionA.id, moduleId: moduleA.id, levelNumber: 1, stableCode: "v2.l001.receipt-a", type: "lesson", title: "A1", completionMethod: "lesson" },
  });
  const levelA2 = await prisma.levelDefinition.create({
    data: { curriculumVersionId: versionA.id, moduleId: moduleA.id, levelNumber: 2, stableCode: "v2.l002.receipt-a", type: "lesson", title: "A2", completionMethod: "lesson" },
  });
  const contentA1 = await prisma.contentVersion.create({
    data: { levelDefinitionId: levelA1.id, curriculumVersionId: versionA.id, versionNumber: 1, status: "published", publishedAt: new Date() },
  });
  const contentA2 = await prisma.contentVersion.create({
    data: { levelDefinitionId: levelA2.id, curriculumVersionId: versionA.id, versionNumber: 1, status: "published", publishedAt: new Date() },
  });
  const enrollmentA = await prisma.userCurriculumEnrollment.create({
    data: { userId: userA.id, curriculumVersionId: versionA.id, curriculumCode: versionA.code },
  });
  const enrollmentB = await prisma.userCurriculumEnrollment.create({
    data: { userId: userB.id, curriculumVersionId: versionA.id, curriculumCode: versionA.code },
  });
  const progressA1 = await prisma.userLessonProgress.create({
    data: { userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelDefinitionId: levelA1.id, contentVersionId: contentA1.id },
  });
  const progressA2 = await prisma.userLessonProgress.create({
    data: { userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelDefinitionId: levelA2.id, contentVersionId: contentA2.id },
  });
  const progressB1 = await prisma.userLessonProgress.create({
    data: { userId: userB.id, enrollmentId: enrollmentB.id, curriculumVersionId: versionA.id, levelDefinitionId: levelA1.id, contentVersionId: contentA1.id },
  });

  const versionB = await prisma.curriculumVersion.create({
    data: { code: "receipt-b", name: "Receipt B", versionNumber: 1, status: "published", publishedAt: new Date() },
  });
  const moduleB = await prisma.moduleDefinition.create({
    data: { curriculumVersionId: versionB.id, moduleNumber: 1, code: "receipt-module-b", title: "B", firstLevel: 1, lastLevel: 1 },
  });
  const levelB = await prisma.levelDefinition.create({
    data: { curriculumVersionId: versionB.id, moduleId: moduleB.id, levelNumber: 1, stableCode: "v2.l001.receipt-b", type: "lesson", title: "B1", completionMethod: "lesson" },
  });
  const contentB = await prisma.contentVersion.create({
    data: { levelDefinitionId: levelB.id, curriculumVersionId: versionB.id, versionNumber: 1, status: "published", publishedAt: new Date() },
  });

  async function insertReceipt(input: {
    progressId?: number;
    userId?: number;
    enrollmentId?: number;
    curriculumVersionId?: number;
    levelDefinitionId?: number;
    contentVersionId?: number;
    requestId?: string;
    revision?: number;
    fingerprint?: string;
  } = {}) {
    return prisma.$executeRawUnsafe(
      `INSERT INTO "UserLessonProgressSaveReceipt" (
        "lessonProgressId", "userId", "enrollmentId", "curriculumVersionId",
        "levelDefinitionId", "contentVersionId", "requestId", "revision", "payloadFingerprint"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.progressId ?? progressA1.id,
      input.userId ?? userA.id,
      input.enrollmentId ?? enrollmentA.id,
      input.curriculumVersionId ?? versionA.id,
      input.levelDefinitionId ?? levelA1.id,
      input.contentVersionId ?? contentA1.id,
      input.requestId ?? "request-a-0001",
      input.revision ?? 1,
      input.fingerprint ?? fingerprintA,
    );
  }

  const v1Snapshot = {
    userA: await prisma.user.findUniqueOrThrow({ where: { id: userA.id } }),
    userB: await prisma.user.findUniqueOrThrow({ where: { id: userB.id } }),
    tasks: await prisma.task.count(),
    xpEvents: await prisma.xpEvent.count(),
  };

  try {
    await check("1. additive migration shape contains no rebuild, DML, trigger, drop or rename", () => {
      const sql = fs.readFileSync(migrationPath, "utf8");
      assert.equal((sql.match(/ALTER TABLE "UserLessonProgress"/g) ?? []).length, 1);
      assert.match(sql, /ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0/);
      assert.doesNotMatch(sql, /\b(DROP|RENAME|TRIGGER)\b/i);
      assert.doesNotMatch(sql, /(^|\n)\s*(INSERT|UPDATE|DELETE)\s/i);
    });
    await check("2. revision defaults to zero for every new progress row", async () => {
      assert.equal(progressA1.revision, 0);
      assert.equal(progressA2.revision, 0);
      assert.equal(progressB1.revision, 0);
    });
    await check("3. composite parent identity and receipt table exist", async () => {
      const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table'");
      assert(tables.some((item) => item.name === "UserLessonProgressSaveReceipt"));
      const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='index'");
      for (const name of [
        "UserLessonProgress_id_userId_enrollmentId_curriculumVersionId_levelDefinitionId_contentVersionId_key",
        "UserLessonProgressSaveReceipt_userId_requestId_key",
        "UserLessonProgressSaveReceipt_lessonProgressId_revision_key",
      ]) assert(indexes.some((item) => item.name === name), name);
    });
    await check("4. multiple sequential receipts are appendable", async () => {
      await insertReceipt();
      await insertReceipt({ requestId: "request-a-0002", revision: 2, fingerprint: fingerprintB });
      assert.equal(await prisma.userLessonProgressSaveReceipt.count({ where: { lessonProgressId: progressA1.id } }), 2);
    });
    await check("5. receipt revision must be positive", () => expectConstraint(
      () => insertReceipt({ requestId: "request-a-zero", revision: 0 }),
      "zero receipt revision",
    ));
    await check("6. fingerprint must use canonical lowercase sha256 format", async () => {
      const invalidFingerprints = ["sha256:abc", `sha256:${"A".repeat(64)}`, `${"a".repeat(64)}`, `sha1:${"a".repeat(64)}`];
      for (const [index, fingerprint] of invalidFingerprints.entries()) {
        await expectConstraint(() => insertReceipt({ requestId: `fingerprint-${index}`, revision: 10 + index, fingerprint }), "invalid fingerprint");
      }
    });
    await check("7. requestId rejects blank, short and oversized values", async () => {
      await expectConstraint(() => insertReceipt({ requestId: "        ", revision: 100 }), "blank request");
      await expectConstraint(() => insertReceipt({ requestId: "short", revision: 101 }), "short request");
      await expectConstraint(() => insertReceipt({ requestId: "x".repeat(129), revision: 102 }), "oversized request");
    });
    await check("8. one user cannot reuse requestId across progress rows", () => expectConstraint(
      () => insertReceipt({ progressId: progressA2.id, levelDefinitionId: levelA2.id, contentVersionId: contentA2.id, requestId: "request-a-0001", revision: 1 }),
      "user request identity",
    ));
    await check("9. different users may use the same requestId", async () => {
      await insertReceipt({ progressId: progressB1.id, userId: userB.id, enrollmentId: enrollmentB.id, requestId: "request-a-0001", revision: 1 });
      assert.equal(await prisma.userLessonProgressSaveReceipt.count({ where: { requestId: "request-a-0001" } }), 2);
    });
    await check("10. one progress row has one winner per revision", () => expectConstraint(
      () => insertReceipt({ requestId: "request-a-revision-one-again", revision: 1, fingerprint: fingerprintB }),
      "progress revision identity",
    ));
    await check("11. cross-user receipt identity is rejected", () => expectConstraint(
      () => insertReceipt({ userId: userB.id, requestId: "cross-user", revision: 20 }),
      "cross user",
    ));
    await check("12. cross-enrollment receipt identity is rejected", () => expectConstraint(
      () => insertReceipt({ enrollmentId: enrollmentB.id, requestId: "cross-enrollment", revision: 21 }),
      "cross enrollment",
    ));
    await check("13. cross-version receipt identity is rejected", () => expectConstraint(
      () => insertReceipt({ curriculumVersionId: versionB.id, requestId: "cross-version", revision: 22 }),
      "cross version",
    ));
    await check("14. cross-level receipt identity is rejected", () => expectConstraint(
      () => insertReceipt({ levelDefinitionId: levelB.id, requestId: "cross-level", revision: 23 }),
      "cross level",
    ));
    await check("15. cross-content receipt identity is rejected", () => expectConstraint(
      () => insertReceipt({ contentVersionId: contentB.id, requestId: "cross-content", revision: 24 }),
      "cross content",
    ));
    await check("16. nonexistent progress parent is rejected", () => expectConstraint(
      () => insertReceipt({ progressId: 2_000_000_000, requestId: "missing-parent", revision: 25 }),
      "missing parent",
    ));
    await check("17. receipt uses one composite RESTRICT ownership relation", async () => {
      const fks = await prisma.$queryRawUnsafe<Array<{ table: string; on_delete: string; on_update: string }>>(
        'PRAGMA foreign_key_list("UserLessonProgressSaveReceipt")',
      );
      assert.equal(new Set(fks.map((item) => item.table)).size, 1);
      assert.equal(fks.every((item) => item.table === "UserLessonProgress"), true);
      assert.equal(fks.every((item) => item.on_delete === "RESTRICT"), true);
      assert.equal(fks.every((item) => item.on_update === "CASCADE"), true);
      await expectConstraint(() => prisma.userLessonProgress.delete({ where: { id: progressA1.id } }), "parent delete");
    });
    await check("18. progress rows of one user retain isolated receipt histories", async () => {
      await insertReceipt({ progressId: progressA2.id, levelDefinitionId: levelA2.id, contentVersionId: contentA2.id, requestId: "request-a2-0001", revision: 1 });
      const grouped = await prisma.userLessonProgressSaveReceipt.groupBy({ by: ["lessonProgressId"], where: { userId: userA.id }, _count: true });
      const counts = new Map(grouped.map((item) => [item.lessonProgressId, item._count]));
      assert.equal(counts.get(progressA1.id), 2);
      assert.equal(counts.get(progressA2.id), 1);
    });
    await check("19. appliedAt is database generated and non-null", async () => {
      const row = await prisma.userLessonProgressSaveReceipt.findFirstOrThrow({ where: { userId: userA.id, requestId: "request-a-0001" } });
      assert(row.appliedAt instanceof Date);
      await expectConstraint(
        () => prisma.$executeRawUnsafe(
          `INSERT INTO "UserLessonProgressSaveReceipt" ("lessonProgressId", "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId", "contentVersionId", "requestId", "revision", "payloadFingerprint", "appliedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          progressA2.id, userA.id, enrollmentA.id, versionA.id, levelA2.id, contentA2.id, "null-applied-at", 2, fingerprintA,
        ),
        "null appliedAt",
      );
    });
    await check("20. database does not overclaim absolute receipt immutability", async () => {
      const row = await prisma.userLessonProgressSaveReceipt.findFirstOrThrow({ where: { userId: userA.id, requestId: "request-a-0002" } });
      await prisma.$executeRawUnsafe('UPDATE "UserLessonProgressSaveReceipt" SET "payloadFingerprint"=? WHERE "id"=?', fingerprintA, row.id);
      assert.equal((await prisma.userLessonProgressSaveReceipt.findUniqueOrThrow({ where: { id: row.id } })).payloadFingerprint, fingerprintA);
    });
    await check("21. V1 representative state remains unchanged", async () => {
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: userA.id } }), v1Snapshot.userA);
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: userB.id } }), v1Snapshot.userB);
      assert.equal(await prisma.task.count(), v1Snapshot.tasks);
      assert.equal(await prisma.xpEvent.count(), v1Snapshot.xpEvents);
    });
    await check("22. the custom runner is idempotent", async () => {
      const before = await prisma.userLessonProgressSaveReceipt.count();
      const rerun = spawnSync(
        process.execPath,
        [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
        { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
      );
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
      assert.match(rerun.stdout, /already applied/i);
      assert.equal(await prisma.userLessonProgressSaveReceipt.count(), before);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  await check("23. temporary SQLite files are removed", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
  });
  assert.equal(passed + failed, 23, "lesson progress schema scenario count drifted");
  if (failed > 0) throw new Error(`${failed} lesson progress schema scenario(s) failed`);
  console.log(`\ncurriculum lesson progress schema regression: ${passed} passed, ${failed} failed`);
}

main().catch((error) => {
  cleanupDb();
  console.error(`\ncurriculum lesson progress schema regression failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
