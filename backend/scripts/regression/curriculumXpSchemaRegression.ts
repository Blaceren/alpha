import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

// Phase 3B.1 regression: apply the complete migration chain to an isolated
// SQLite DB and prove the enrollment-owned XP ledger schema, positive-only
// amount/source CHECKs, composite ownership FKs and V1/Phase 2 compatibility.

const dbPath = `/tmp/ata-curriculum-xp-schema-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const migrationName = "20260714020000_xp_transaction_foundation";
const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  migrationName,
  "migration.sql",
);
const allowedSources = [
  "level_completion",
  "assessment_pass",
  "report_approval",
  "mentor_completion",
  "promocode",
  "migration_adjustment",
  "admin_correction",
] as const;

let passed = 0;
let failed = 0;
let prisma: PrismaClient | null = null;

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

function isConstraintError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P2002", "P2003", "P2010"].includes(error.code);
  }
  return error instanceof Error && /constraint|foreign key|not null|unique|check/i.test(error.message);
}

async function expectConstraint(fn: () => Promise<unknown>, label: string) {
  try {
    await fn();
  } catch (error) {
    assert.equal(
      isConstraintError(error),
      true,
      `${label}: expected constraint error, got: ${error}`,
    );
    return;
  }
  assert.fail(`${label}: expected a constraint violation, but the operation succeeded`);
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function runMigrationRunner() {
  return spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
}

type XpInsert = {
  userId: number;
  enrollmentId: number;
  curriculumVersionId: number;
  levelDefinitionId?: number | null;
  sourceType?: string;
  sourceId?: string | null;
  idempotencyKey: string;
  payloadFingerprint?: string;
  amount?: number;
  metadata?: string | null;
  createdById?: number | null;
};

async function insertXp(input: XpInsert) {
  assert.ok(prisma);
  return prisma.$executeRawUnsafe(
    `INSERT INTO "XPTransaction" (
      "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId",
      "sourceType", "sourceId", "idempotencyKey", "payloadFingerprint",
      "amount", "metadata", "createdById"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.userId,
    input.enrollmentId,
    input.curriculumVersionId,
    input.levelDefinitionId ?? null,
    input.sourceType ?? "level_completion",
    input.sourceId ?? null,
    input.idempotencyKey,
    input.payloadFingerprint ?? `fp:${input.idempotencyKey}`,
    input.amount ?? 10,
    input.metadata ?? null,
    input.createdById ?? null,
  );
}

async function createFixtureEnrollment(input: {
  userId: number;
  curriculumVersionId: number;
  curriculumCode: string;
}) {
  assert.ok(prisma);
  const version = await prisma.curriculumVersion.findUniqueOrThrow({
    where: { id: input.curriculumVersionId },
    select: { status: true },
  });
  assert.equal(
    version.status === "published" || version.status === "archived",
    true,
    "fixture enrollment target must be published or archived",
  );
  return prisma.userCurriculumEnrollment.create({ data: input });
}

async function main() {
  cleanupDb();
  const firstRunner = runMigrationRunner();
  if (firstRunner.status !== 0) {
    console.error(firstRunner.stdout);
    console.error(firstRunner.stderr);
    throw new Error(`migration runner exited with ${firstRunner.status}`);
  }

  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    await check("1. complete migration chain applies from scratch", () => {
      assert.match(firstRunner.stdout, new RegExp(`Migration ${migrationName} applied`));
    });

    const tables = (
      await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
    ).map((row) => row.name);

    await check("2. XPTransaction table exists", () => {
      assert.equal(tables.includes("XPTransaction"), true);
    });

    const xpColumns = await prisma.$queryRawUnsafe<
      Array<{ name: string; notnull: number; type: string }>
    >('PRAGMA table_info("XPTransaction")');
    const xpColumnNames = xpColumns.map((column) => column.name);
    const expectedXpColumns = [
      "id",
      "userId",
      "enrollmentId",
      "curriculumVersionId",
      "levelDefinitionId",
      "sourceType",
      "sourceId",
      "idempotencyKey",
      "payloadFingerprint",
      "amount",
      "metadata",
      "createdAt",
      "createdById",
    ];

    await check("3. all approved XPTransaction columns exist", () => {
      assert.deepEqual(xpColumnNames, expectedXpColumns);
    });

    await check("4. required and nullable XP columns match the contract", () => {
      const byName = new Map(xpColumns.map((column) => [column.name, column]));
      for (const required of [
        "userId",
        "enrollmentId",
        "curriculumVersionId",
        "sourceType",
        "idempotencyKey",
        "payloadFingerprint",
        "amount",
      ]) {
        assert.equal(Number(byName.get(required)?.notnull), 1, `${required} must be required`);
      }
      for (const nullable of ["levelDefinitionId", "sourceId", "metadata", "createdById"]) {
        assert.equal(Number(byName.get(nullable)?.notnull), 0, `${nullable} must be nullable`);
      }
    });

    await check("5. XP ledger starts empty after the full migration chain", async () => {
      const rows = await prisma!.$queryRawUnsafe<Array<{ count: bigint }>>(
        'SELECT COUNT(*) AS count FROM "XPTransaction"',
      );
      assert.equal(Number(rows[0].count), 0);
    });

    const userA = await prisma.user.create({
      data: { email: "xp-owner-a@example.com", name: "XP Owner A" },
    });
    const userB = await prisma.user.create({
      data: { email: "xp-owner-b@example.com", name: "XP Owner B" },
    });
    const archivedUser = await prisma.user.create({
      data: { email: "xp-archived@example.com", name: "XP Archived Owner" },
    });
    const actor = await prisma.user.create({
      data: { email: "xp-actor@example.com", name: "XP Actor", role: "admin" },
    });
    const deleteTarget = await prisma.user.create({
      data: { email: "xp-delete-target@example.com", name: "XP Delete Target" },
    });

    const versionA = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: "XP published",
        versionNumber: 1,
        status: "published",
        publishedAt: new Date(),
      },
    });
    const versionB = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: "XP archived",
        versionNumber: 2,
        status: "archived",
      },
    });
    const versionDelete = await prisma.curriculumVersion.create({
      data: {
        code: "ata-xp-delete",
        name: "XP delete version",
        versionNumber: 1,
        status: "published",
        publishedAt: new Date(),
      },
    });
    const draftVersion = await prisma.curriculumVersion.create({
      data: {
        code: "ata-xp-draft",
        name: "XP draft",
        versionNumber: 1,
        status: "draft",
      },
    });

    const moduleA = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: versionA.id,
        moduleNumber: 1,
        code: "m01-xp",
        title: "XP module A",
        firstLevel: 1,
        lastLevel: 1,
      },
    });
    const moduleB = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: versionB.id,
        moduleNumber: 1,
        code: "m01-xp",
        title: "XP module B",
        firstLevel: 1,
        lastLevel: 1,
      },
    });
    const moduleDelete = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: versionDelete.id,
        moduleNumber: 1,
        code: "m01-delete",
        title: "XP module delete",
        firstLevel: 1,
        lastLevel: 1,
      },
    });

    const levelA = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionA.id,
        moduleId: moduleA.id,
        levelNumber: 1,
        stableCode: "v2.l001.xp-a",
        type: "lesson",
        title: "XP level A",
        completionMethod: "lesson",
      },
    });
    const levelB = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionB.id,
        moduleId: moduleB.id,
        levelNumber: 1,
        stableCode: "v2.l001.xp-b",
        type: "lesson",
        title: "XP level B",
        completionMethod: "lesson",
      },
    });
    const levelDelete = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionDelete.id,
        moduleId: moduleDelete.id,
        levelNumber: 1,
        stableCode: "v2.l001.xp-delete",
        type: "lesson",
        title: "XP level delete",
        completionMethod: "lesson",
      },
    });

    const enrollmentA = await createFixtureEnrollment({
      userId: userA.id,
      curriculumVersionId: versionA.id,
      curriculumCode: versionA.code,
    });
    const enrollmentB = await createFixtureEnrollment({
      userId: userB.id,
      curriculumVersionId: versionA.id,
      curriculumCode: versionA.code,
    });
    const archivedEnrollment = await createFixtureEnrollment({
      userId: archivedUser.id,
      curriculumVersionId: versionB.id,
      curriculumCode: versionB.code,
    });
    const deleteEnrollment = await createFixtureEnrollment({
      userId: deleteTarget.id,
      curriculumVersionId: versionDelete.id,
      curriculumCode: versionDelete.code,
    });

    const progressA = await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        levelDefinitionId: levelA.id,
      },
    });
    const enrollmentSnapshot = await prisma.userCurriculumEnrollment.findMany({
      orderBy: { id: "asc" },
    });
    const progressSnapshot = await prisma.userLevelProgress.findMany({
      orderBy: { id: "asc" },
    });

    await check("6. valid enrollment-owned XP row is created", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:valid:enrollment",
      });
      const row = await prisma!.$queryRawUnsafe<Array<{ userId: number; enrollmentId: number }>>(
        'SELECT "userId", "enrollmentId" FROM "XPTransaction" WHERE "idempotencyKey" = ?',
        "xp:valid:enrollment",
      );
      assert.deepEqual(row[0], { userId: userA.id, enrollmentId: enrollmentA.id });
    });

    await check("7. valid same-version level-linked XP row is created", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        levelDefinitionId: levelA.id,
        sourceId: "progress-level-a",
        idempotencyKey: "xp:valid:level",
      });
    });

    await check("8. nullable levelDefinitionId is accepted", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        sourceType: "promocode",
        idempotencyKey: "xp:null:level",
      });
    });

    await check("9. nullable metadata is accepted", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:null:metadata",
        metadata: null,
      });
    });

    await check("10. valid JSON metadata is stored", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:json:metadata",
        metadata: JSON.stringify({ schemaVersion: 1, reasonCode: "test" }),
      });
      const rows = await prisma!.$queryRawUnsafe<Array<{ valid: number }>>(
        'SELECT json_valid("metadata") AS valid FROM "XPTransaction" WHERE "idempotencyKey" = ?',
        "xp:json:metadata",
      );
      assert.equal(Number(rows[0].valid), 1);
    });

    await check("11. nullable actor is accepted", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:null:actor",
        createdById: null,
      });
    });

    await check("12. actor delete sets createdById to null", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:actor:set-null",
        createdById: actor.id,
      });
      await prisma!.user.delete({ where: { id: actor.id } });
      const rows = await prisma!.$queryRawUnsafe<Array<{ createdById: number | null }>>(
        'SELECT "createdById" FROM "XPTransaction" WHERE "idempotencyKey" = ?',
        "xp:actor:set-null",
      );
      assert.equal(rows[0].createdById, null);
    });

    await check("13. every approved source value is accepted", async () => {
      for (const [index, sourceType] of allowedSources.entries()) {
        await insertXp({
          userId: userA.id,
          enrollmentId: enrollmentA.id,
          curriculumVersionId: versionA.id,
          sourceType,
          sourceId: `source-${index}`,
          idempotencyKey: `xp:source:${sourceType}`,
        });
      }
    });

    await check("14. unapproved source value is rejected by DB CHECK", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            sourceType: "daily_login",
            idempotencyKey: "xp:invalid:source",
          }),
        "invalid source",
      ),
    );

    await check("15. amount greater than zero is accepted", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:amount:positive",
        amount: 1,
      });
    });

    await check("16. amount zero is rejected by DB CHECK", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            idempotencyKey: "xp:amount:zero",
            amount: 0,
          }),
        "zero amount",
      ),
    );

    await check("17. negative amount is rejected by DB CHECK", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            idempotencyKey: "xp:amount:negative",
            amount: -1,
          }),
        "negative amount",
      ),
    );

    await check("18. duplicate idempotencyKey is rejected", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            idempotencyKey: "xp:valid:enrollment",
          }),
        "duplicate idempotency key",
      ),
    );

    await check("19. different idempotencyKey values are allowed", async () => {
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:key:a",
      });
      await insertXp({
        userId: userA.id,
        enrollmentId: enrollmentA.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:key:b",
      });
    });

    await check("20. payloadFingerprint is required", () =>
      expectConstraint(
        () =>
          prisma!.$executeRawUnsafe(
            `INSERT INTO "XPTransaction" (
              "userId", "enrollmentId", "curriculumVersionId",
              "sourceType", "idempotencyKey", "amount"
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            userA.id,
            enrollmentA.id,
            versionA.id,
            "level_completion",
            "xp:missing:fingerprint",
            10,
          ),
        "missing payload fingerprint",
      ),
    );

    await check("21. enrollment belonging to another user is rejected", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userB.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            idempotencyKey: "xp:cross:user",
          }),
        "cross-user XP",
      ),
    );

    await check("22. enrollment from another version is rejected", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionB.id,
            idempotencyKey: "xp:cross:enrollment-version",
          }),
        "cross-version enrollment XP",
      ),
    );

    await check("23. level from another version is rejected", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            levelDefinitionId: levelB.id,
            idempotencyKey: "xp:cross:level-version",
          }),
        "cross-version level XP",
      ),
    );

    await check("24. nonexistent enrollment is rejected", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: 999_991,
            curriculumVersionId: versionA.id,
            idempotencyKey: "xp:missing:enrollment",
          }),
        "missing enrollment",
      ),
    );

    await check("25. nonexistent user discriminator is rejected", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: 999_992,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            idempotencyKey: "xp:missing:user",
          }),
        "missing user",
      ),
    );

    await check("26. nonexistent version discriminator is rejected", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: 999_993,
            idempotencyKey: "xp:missing:version",
          }),
        "missing version",
      ),
    );

    await check("27. nonexistent level is rejected", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            levelDefinitionId: 999_994,
            idempotencyKey: "xp:missing:level",
          }),
        "missing level",
      ),
    );

    await insertXp({
      userId: deleteTarget.id,
      enrollmentId: deleteEnrollment.id,
      curriculumVersionId: versionDelete.id,
      levelDefinitionId: levelDelete.id,
      sourceId: "delete-owner",
      idempotencyKey: "xp:restrict:owners",
    });

    await check("28. deleting XP owner enrollment is restricted", () =>
      expectConstraint(
        () => prisma!.userCurriculumEnrollment.delete({ where: { id: deleteEnrollment.id } }),
        "delete XP enrollment",
      ),
    );

    await check("29. deleting XP owner curriculum version is restricted", () =>
      expectConstraint(
        () => prisma!.curriculumVersion.delete({ where: { id: versionDelete.id } }),
        "delete XP version",
      ),
    );

    await check("30. deleting referenced level is restricted", () =>
      expectConstraint(
        () => prisma!.levelDefinition.delete({ where: { id: levelDelete.id } }),
        "delete XP level",
      ),
    );

    await check("31. deleting target user with XP is restricted", () =>
      expectConstraint(
        () => prisma!.user.delete({ where: { id: deleteTarget.id } }),
        "delete XP target user",
      ),
    );

    await check("32. multiple XP rows for one enrollment are allowed", async () => {
      const rows = await prisma!.$queryRawUnsafe<Array<{ count: bigint }>>(
        'SELECT COUNT(*) AS count FROM "XPTransaction" WHERE "enrollmentId" = ?',
        enrollmentA.id,
      );
      assert.equal(Number(rows[0].count) > 2, true);
    });

    await check("33. archived-version enrollment supports XP history", async () => {
      await insertXp({
        userId: archivedUser.id,
        enrollmentId: archivedEnrollment.id,
        curriculumVersionId: versionB.id,
        levelDefinitionId: levelB.id,
        sourceId: "archived-level",
        idempotencyKey: "xp:archived:valid",
      });
    });

    await check("34. ordinary fixture path rejects a draft pin", async () => {
      const before = await prisma!.userCurriculumEnrollment.count();
      await assert.rejects(() =>
        createFixtureEnrollment({
          userId: userB.id,
          curriculumVersionId: draftVersion.id,
          curriculumCode: draftVersion.code,
        }),
      );
      assert.equal(await prisma!.userCurriculumEnrollment.count(), before);
    });

    await check("35. non-null source owner identity is unique per enrollment/source", () =>
      expectConstraint(
        () =>
          insertXp({
            userId: userA.id,
            enrollmentId: enrollmentA.id,
            curriculumVersionId: versionA.id,
            sourceType: "level_completion",
            sourceId: "progress-level-a",
            idempotencyKey: "xp:duplicate:owner-source",
          }),
        "duplicate owner source",
      ),
    );

    await check("36. same source identity is allowed in another enrollment", async () => {
      await insertXp({
        userId: userB.id,
        enrollmentId: enrollmentB.id,
        curriculumVersionId: versionA.id,
        sourceType: "level_completion",
        sourceId: "progress-level-a",
        idempotencyKey: "xp:other-enrollment:owner-source",
      });
    });

    await check("37. multiple null sourceId rows are allowed", async () => {
      await insertXp({
        userId: userB.id,
        enrollmentId: enrollmentB.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:null-source:a",
      });
      await insertXp({
        userId: userB.id,
        enrollmentId: enrollmentB.id,
        curriculumVersionId: versionA.id,
        idempotencyKey: "xp:null-source:b",
      });
    });

    await check("38. XP foreign keys have approved delete policies", async () => {
      const fks = await prisma!.$queryRawUnsafe<
        Array<{ table: string; from: string; on_delete: string; on_update: string }>
      >('PRAGMA foreign_key_list("XPTransaction")');
      assert.deepEqual(
        new Set(fks.map((fk) => fk.table)),
        new Set(["User", "UserCurriculumEnrollment", "LevelDefinition"]),
      );
      const actorFk = fks.find(
        (fk) => fk.table === "User" && fk.from === "createdById",
      );
      assert.equal(actorFk?.on_delete.toUpperCase(), "SET NULL");
      for (const fk of fks.filter((item) => item !== actorFk)) {
        assert.equal(fk.on_delete.toUpperCase(), "RESTRICT");
      }
      assert.equal(fks.every((fk) => fk.on_update.toUpperCase() === "CASCADE"), true);
    });

    await check("39. required XP indexes and parent key exist", async () => {
      const indexes = await prisma!.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>(
        "SELECT name, sql FROM sqlite_master WHERE type='index'",
      );
      const byName = new Map(indexes.map((row) => [row.name, row.sql]));
      for (const name of [
        "UserCurriculumEnrollment_id_userId_curriculumVersionId_key",
        "XPTransaction_idempotencyKey_key",
        "XPTransaction_enrollmentId_sourceType_sourceId_key",
        "XPTransaction_enrollmentId_createdAt_id_idx",
        "XPTransaction_userId_createdAt_id_idx",
        "XPTransaction_curriculumVersionId_sourceType_idx",
        "XPTransaction_levelDefinitionId_idx",
        "XPTransaction_sourceType_sourceId_idx",
      ]) {
        assert.equal(byName.has(name), true, `missing index ${name}`);
      }
      assert.match(
        byName.get("XPTransaction_enrollmentId_sourceType_sourceId_key") ?? "",
        /where\s+"sourceId"\s+is\s+not\s+null/i,
      );
    });

    const v1User = await prisma.user.create({
      data: { email: "xp-v1@example.com", name: "XP V1", xp: 125 },
    });
    const v1Task = await prisma.task.create({
      data: {
        code: "xp-v1-task",
        stepNumber: 9991,
        title: "XP V1 task",
        description: "compatibility",
        rewardType: "xp",
        actionLabel: "Complete",
        xpReward: 15,
      },
    });
    const v1Progress = await prisma.userTaskProgress.create({
      data: { userId: v1User.id, taskId: v1Task.id, status: "active" },
    });
    const v1Xp = await prisma.xpEvent.create({
      data: { userId: v1User.id, amount: 15, source: "task", sourceId: v1Task.code },
    });
    const v1Snapshot = {
      user: await prisma.user.findUniqueOrThrow({ where: { id: v1User.id } }),
      task: await prisma.task.findUniqueOrThrow({ where: { id: v1Task.id } }),
      progress: await prisma.userTaskProgress.findUniqueOrThrow({ where: { id: v1Progress.id } }),
      xp: await prisma.xpEvent.findUniqueOrThrow({ where: { id: v1Xp.id } }),
    };

    await check("40. representative V1 rows and relations remain operational", async () => {
      const relation = await prisma!.userTaskProgress.findUniqueOrThrow({
        where: { id: v1Progress.id },
        include: { user: true, task: true },
      });
      assert.equal(relation.user.id, v1User.id);
      assert.equal(relation.task.id, v1Task.id);
      assert.deepEqual(await prisma!.xpEvent.findUniqueOrThrow({ where: { id: v1Xp.id } }), v1Snapshot.xp);
    });

    await check("41. User SQL columns are unchanged by virtual XP relations", async () => {
      const columns = (
        await prisma!.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("User")')
      ).map((column) => column.name);
      assert.deepEqual(columns, [
        "id",
        "email",
        "name",
        "level",
        "xp",
        "currentTask",
        "createdAt",
        "updatedAt",
        "passwordHash",
        "role",
        "status",
        "emailVerifiedAt",
        "leaderboardExcluded",
        "selectedAchievementId",
        "referralCode",
        "pendingEmail",
        "pendingEmailRequestedAt",
      ]);
    });

    await check("42. no currentXp or XP levelNumber column was added", async () => {
      const enrollmentColumns = (
        await prisma!.$queryRawUnsafe<Array<{ name: string }>>(
          'PRAGMA table_info("UserCurriculumEnrollment")',
        )
      ).map((column) => column.name);
      assert.equal(enrollmentColumns.includes("currentXp"), false);
      assert.equal(xpColumnNames.includes("levelNumber"), false);
    });

    await check("43. enrollment and progress rows are unchanged by XP inserts", async () => {
      assert.deepEqual(
        await prisma!.userCurriculumEnrollment.findMany({ orderBy: { id: "asc" } }),
        enrollmentSnapshot,
      );
      assert.deepEqual(
        await prisma!.userLevelProgress.findMany({ orderBy: { id: "asc" } }),
        progressSnapshot,
      );
      assert.equal(progressA.status, "in_progress");
    });

    await check("44. migration has no V1 ALTER DROP RENAME or data mutation", () => {
      const sql = fs.readFileSync(migrationPath, "utf8");
      const executable = sql.replace(/^\s*--.*$/gm, "");
      assert.doesNotMatch(
        executable,
        /^\s*(?:ALTER|DROP|RENAME|UPDATE|DELETE|INSERT)\b/im,
      );
    });

    const beforeRerun = {
      xpCount: Number(
        (
          await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            'SELECT COUNT(*) AS count FROM "XPTransaction"',
          )
        )[0].count,
      ),
      v1: v1Snapshot,
      enrollment: await prisma.userCurriculumEnrollment.findMany({ orderBy: { id: "asc" } }),
      progress: await prisma.userLevelProgress.findMany({ orderBy: { id: "asc" } }),
    };

    await prisma.$disconnect();
    prisma = null;
    const secondRunner = runMigrationRunner();
    assert.equal(secondRunner.status, 0, secondRunner.stderr);
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

    await check("45. repeated custom migration runner is idempotent", async () => {
      assert.match(secondRunner.stdout, new RegExp(`Migration ${migrationName} already applied`));
      const rows = await prisma!.$queryRawUnsafe<Array<{ count: bigint }>>(
        'SELECT COUNT(*) AS count FROM "XPTransaction"',
      );
      assert.equal(Number(rows[0].count), beforeRerun.xpCount);
    });

    await check("46. rerun preserves V1 and Phase 2 data byte-for-byte", async () => {
      assert.deepEqual(
        await prisma!.user.findUniqueOrThrow({ where: { id: v1User.id } }),
        beforeRerun.v1.user,
      );
      assert.deepEqual(
        await prisma!.task.findUniqueOrThrow({ where: { id: v1Task.id } }),
        beforeRerun.v1.task,
      );
      assert.deepEqual(
        await prisma!.userTaskProgress.findUniqueOrThrow({ where: { id: v1Progress.id } }),
        beforeRerun.v1.progress,
      );
      assert.deepEqual(
        await prisma!.xpEvent.findUniqueOrThrow({ where: { id: v1Xp.id } }),
        beforeRerun.v1.xp,
      );
      assert.deepEqual(
        await prisma!.userCurriculumEnrollment.findMany({ orderBy: { id: "asc" } }),
        beforeRerun.enrollment,
      );
      assert.deepEqual(
        await prisma!.userLevelProgress.findMany({ orderBy: { id: "asc" } }),
        beforeRerun.progress,
      );
    });
  } finally {
    await prisma?.$disconnect();
    prisma = null;
    cleanupDb();
  }

  await check("47. temporary DB and journals are removed", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false, `leftover ${dbPath}${suffix}`);
    }
  });
}

main()
  .then(() => {
    console.log(`\ncurriculum XP schema regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum XP schema regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
