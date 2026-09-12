import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import {
  CurriculumXpError,
  isCurriculumXpError,
  recordCurriculumXp,
  recordCurriculumXpInTransaction,
  resolveEnrollmentXp,
} from "../../src/lib/curriculum/xp";

const dbPath = `/tmp/ata-curriculum-xp-ledger-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousXpFlag = process.env.CURRICULUM_V2_XP_ENABLED;
process.env.DATABASE_URL = dbUrl;

let prisma: PrismaClient | null = null;
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
    console.error(error);
  }
}

function setFlag(value: string | undefined) {
  if (value === undefined) delete process.env.CURRICULUM_V2_XP_ENABLED;
  else process.env.CURRICULUM_V2_XP_ENABLED = value;
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

async function expectXpError(
  code: CurriculumXpError["code"],
  operation: () => Promise<unknown>,
) {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal(isCurriculumXpError(error), true);
    assert.equal((error as CurriculumXpError).code, code);
    assert.equal((error as Error).message.includes("SQL"), false);
    assert.equal((error as Error).message.includes("/tmp"), false);
    return true;
  });
}

async function createVersion(
  versionNumber: number,
  status: "published" | "archived" | "draft",
  code = "ata-v2",
) {
  const version = await prisma!.curriculumVersion.create({
    data: {
      code,
      name: `XP ${status} ${versionNumber}`,
      versionNumber,
      status,
      publishedAt: status === "published" ? new Date() : null,
    },
  });
  const moduleDefinition = await prisma!.moduleDefinition.create({
    data: {
      curriculumVersionId: version.id,
      moduleNumber: 1,
      code: `m01-xp-${version.id}`,
      title: `XP module ${version.id}`,
      firstLevel: 1,
      lastLevel: 2,
    },
  });
  const level1 = await prisma!.levelDefinition.create({
    data: {
      curriculumVersionId: version.id,
      moduleId: moduleDefinition.id,
      levelNumber: 1,
      stableCode: `v2.l001.xp-${version.id}`,
      type: "lesson",
      title: `XP level 1 ${version.id}`,
      completionMethod: "lesson",
    },
  });
  const level2 = await prisma!.levelDefinition.create({
    data: {
      curriculumVersionId: version.id,
      moduleId: moduleDefinition.id,
      levelNumber: 2,
      stableCode: `v2.l002.xp-${version.id}`,
      type: "lesson",
      title: `XP level 2 ${version.id}`,
      completionMethod: "lesson",
    },
  });
  return { version, level1, level2 };
}

async function createEnrollment(
  email: string,
  curriculumVersionId: number,
  curriculumCode = "ata-v2",
) {
  const user = await prisma!.user.create({ data: { email, name: email } });
  const enrollment = await prisma!.userCurriculumEnrollment.create({
    data: { userId: user.id, curriculumVersionId, curriculumCode },
  });
  return { user, enrollment };
}

function baseAward(
  enrollmentId: number,
  levelDefinitionId: number,
  sourceId: string,
  amount = 25,
) {
  return {
    enrollmentId,
    sourceType: "level_completion" as const,
    sourceId,
    levelDefinitionId,
    amount,
    metadata: { reasonCode: "lesson", schemaVersion: 1 },
  };
}

async function rawResolverFixture(enrollmentId: number) {
  const headers = await prisma!.$queryRawUnsafe<unknown[]>(`
    SELECT
      e."id" AS "enrollmentId", e."userId" AS "userId",
      e."curriculumVersionId" AS "curriculumVersionId",
      e."curriculumCode" AS "curriculumCode", e."status" AS "enrollmentStatus",
      u."id" AS "userExists", v."id" AS "pinnedVersionId",
      v."code" AS "pinnedVersionCode", v."versionNumber" AS "pinnedVersionNumber",
      v."status" AS "pinnedVersionStatus"
    FROM "UserCurriculumEnrollment" e
    LEFT JOIN "User" u ON u."id" = e."userId"
    LEFT JOIN "CurriculumVersion" v ON v."id" = e."curriculumVersionId"
    WHERE e."id" = ${enrollmentId}
  `);
  const rows = await prisma!.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT x.*, actor."id" AS "actorExists",
      level."curriculumVersionId" AS "levelVersionId"
    FROM "XPTransaction" x
    LEFT JOIN "User" actor ON actor."id" = x."createdById"
    LEFT JOIN "LevelDefinition" level ON level."id" = x."levelDefinitionId"
    WHERE x."enrollmentId" = ${enrollmentId}
    ORDER BY x."createdAt", x."id"
  `);
  return { headers, rows };
}

function fakeResolverDb(headers: unknown[], rows: unknown[]) {
  let call = 0;
  return {
    $queryRaw: async () => {
      call += 1;
      return call === 1 ? headers : rows;
    },
  } as never;
}

function proxyTx<T extends object>(target: T, overrides: Record<string, unknown>) {
  return new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === "string" && property in overrides) return overrides[property];
      return Reflect.get(object, property, receiver);
    },
  });
}

async function main() {
  cleanupDb();
  const migrated = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  assert.equal(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  await prisma.$connect();

  const published = await createVersion(1, "published");
  const archived = await createVersion(2, "archived");
  const draft = await createVersion(1, "draft", "ata-v2-draft");
  const owner = await createEnrollment(
    "xp-ledger-owner@example.com",
    published.version.id,
  );
  const archivedOwner = await createEnrollment(
    "xp-ledger-archived@example.com",
    archived.version.id,
  );
  const draftOwner = await createEnrollment(
    "xp-ledger-draft@example.com",
    draft.version.id,
    draft.version.code,
  );
  const actor = await prisma.user.create({
    data: { email: "xp-ledger-actor@example.com", name: "XP Actor", role: "admin" },
  });
  const actor2 = await prisma.user.create({
    data: { email: "xp-ledger-actor-2@example.com", name: "XP Actor 2" },
  });

  await check("flag absent disables resolver", async () => {
    setFlag(undefined);
    assert.deepEqual(await resolveEnrollmentXp({ enrollmentId: owner.enrollment.id }), {
      kind: "disabled",
    });
  });
  await check("flag=false disables resolver", async () => {
    setFlag("false");
    assert.equal((await resolveEnrollmentXp({ enrollmentId: owner.enrollment.id })).kind, "disabled");
  });
  await check("flag off disables ledger command", async () => {
    await expectXpError("XP_DISABLED", () =>
      recordCurriculumXp(baseAward(owner.enrollment.id, published.level1.id, "flag-off")),
    );
  });
  await check("disabled paths perform no DB reads or writes", async () => {
    let reads = 0;
    const db = {
      $queryRaw: async () => {
        reads += 1;
        throw new Error("unexpected read");
      },
      $transaction: async () => {
        reads += 1;
        throw new Error("unexpected transaction");
      },
    } as never;
    assert.equal((await resolveEnrollmentXp({ enrollmentId: 1, db })).kind, "disabled");
    await expectXpError("XP_DISABLED", () =>
      recordCurriculumXp({ ...baseAward(1, 1, "disabled-db"), db }),
    );
    assert.equal(reads, 0);
  });
  await check("READ ENROLLMENT and ADMIN flags do not replace XP flag", async () => {
    process.env.CURRICULUM_V2_READ_ENABLED = "true";
    process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
    process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
    assert.equal((await resolveEnrollmentXp({ enrollmentId: owner.enrollment.id })).kind, "disabled");
  });
  await check("XP flag is read dynamically", async () => {
    setFlag("true");
    assert.equal((await resolveEnrollmentXp({ enrollmentId: owner.enrollment.id })).kind, "available");
    setFlag("false");
    assert.equal((await resolveEnrollmentXp({ enrollmentId: owner.enrollment.id })).kind, "disabled");
    setFlag("true");
  });

  await check("zero transactions resolve to totalXp=0", async () => {
    const result = await resolveEnrollmentXp({ enrollmentId: owner.enrollment.id });
    assert.equal(result.kind, "available");
    if (result.kind === "available") {
      assert.equal(result.totalXp, 0);
      assert.equal(result.transactionCount, 0);
      assert.equal(result.lastTransactionAt, null);
      assert.equal(result.curriculumVersion.id, published.version.id);
    }
  });
  await check("missing enrollment resolves not_found", async () => {
    assert.deepEqual(await resolveEnrollmentXp({ enrollmentId: 999_999 }), { kind: "not_found" });
  });
  await check("invalid resolver input is typed corrupt", async () => {
    const result = await resolveEnrollmentXp({ enrollmentId: 0 });
    assert.deepEqual(result, {
      kind: "corrupt",
      code: "XP_TOTAL_CORRUPT",
      reason: "xp_input_invalid",
    });
  });
  await check("draft pin resolves corrupt", async () => {
    const result = await resolveEnrollmentXp({ enrollmentId: draftOwner.enrollment.id });
    assert.equal(result.kind, "corrupt");
    if (result.kind === "corrupt") assert.equal(result.reason, "enrollment_pin_status_invalid");
  });
  await check("archived pin resolves normally", async () => {
    const result = await resolveEnrollmentXp({ enrollmentId: archivedOwner.enrollment.id });
    assert.equal(result.kind, "available");
  });

  const baseline = {
    enrollment: await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: owner.enrollment.id },
    }),
    progress: await prisma.userLevelProgress.count({
      where: { enrollmentId: owner.enrollment.id },
    }),
    notifications: await prisma.notification.count(),
    cohorts: await prisma.crmUserCohort.count(),
    xpEvents: await prisma.xpEvent.count(),
    v1Xp: (await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).xp,
  };

  let firstAwardId = 0;
  await check("valid level-linked award is recorded", async () => {
    const result = await recordCurriculumXp({
      ...baseAward(owner.enrollment.id, published.level1.id, "level-1"),
      actorId: actor.id,
    });
    assert.equal(result.created, true);
    assert.equal(result.transaction.userId, owner.user.id);
    assert.equal(result.transaction.curriculumVersionId, published.version.id);
    assert.equal(result.transaction.levelDefinitionId, published.level1.id);
    firstAwardId = result.transaction.id;
  });
  await check("successful award creates exactly one safe audit", async () => {
    const audits = await prisma!.auditLog.findMany({
      where: { action: "CURRICULUM_XP_AWARDED", entityId: String(firstAwardId) },
    });
    assert.equal(audits.length, 1);
    const serialized = JSON.stringify(audits[0].metadata);
    assert.equal(serialized.includes("reasonCode"), false);
    assert.equal(serialized.includes("payloadFingerprint"), false);
    assert.equal(serialized.includes("sourceIdHash"), true);
  });
  await check("user and version are derived from enrollment", async () => {
    const row = await prisma!.xPTransaction.findUniqueOrThrow({ where: { id: firstAwardId } });
    assert.equal(row.userId, owner.enrollment.userId);
    assert.equal(row.curriculumVersionId, owner.enrollment.curriculumVersionId);
  });
  await check("public input exposes no target user version fingerprint or timestamp", () => {
    const source = fs.readFileSync(path.join("src", "lib", "curriculum", "xp.ts"), "utf8");
    const inputBlock = source.slice(
      source.indexOf("export type RecordCurriculumXpInput"),
      source.indexOf("export type RecordCurriculumXpInTransactionInput"),
    );
    for (const forbidden of ["userId:", "curriculumVersionId:", "payloadFingerprint:", "createdAt:", "levelNumber:", "idempotencyKey:"]) {
      assert.equal(inputBlock.includes(forbidden), false, forbidden);
    }
  });
  await check("valid non-level award is recorded", async () => {
    const result = await recordCurriculumXp({
      enrollmentId: owner.enrollment.id,
      sourceType: "promocode",
      sourceId: "promo-redemption-1",
      amount: 7,
      metadata: { reasonCode: "promo", schemaVersion: 1 },
    });
    assert.equal(result.created, true);
    assert.equal(result.transaction.levelDefinitionId, null);
  });
  await check("all seven source contracts record valid awards", async () => {
    const cases = [
      ["level_completion", published.level1.id],
      ["assessment_pass", published.level1.id],
      ["report_approval", published.level1.id],
      ["mentor_completion", published.level1.id],
      ["promocode", null],
      ["migration_adjustment", null],
      // PHASE-1 ADMIN considered moving `admin_correction` to the level-linked
      // side and moved it back. The currently-deployed Backend does not carry it
      // there, and this contract is symmetric, so a level-linked administrative
      // award is read by that release as a CORRUPT ENROLLMENT — not a bad row, a
      // dead learner. It stays here, and the level it credits is carried by the
      // award's `sourceId`. See `LEVEL_LINKED_SOURCES` in `xp.ts`.
      ["admin_correction", null],
    ] as const;
    for (const [sourceType, levelDefinitionId] of cases) {
      const result = await recordCurriculumXp({
        enrollmentId: owner.enrollment.id,
        sourceType,
        sourceId:
          sourceType === "migration_adjustment"
            ? "all-migration-adjustment:1"
            : `all-${sourceType}`,
        levelDefinitionId,
        amount: 1,
      });
      assert.equal(result.created, true);
    }
  });
  await check("level-linked source requires a level", async () => {
    await expectXpError("XP_SOURCE_INVALID", () =>
      recordCurriculumXp({
        enrollmentId: owner.enrollment.id,
        sourceType: "assessment_pass",
        sourceId: "missing-level",
        amount: 1,
      }),
    );
  });
  await check("non-level source rejects a level", async () => {
    await expectXpError("XP_SOURCE_INVALID", () =>
      recordCurriculumXp({
        enrollmentId: owner.enrollment.id,
        sourceType: "promocode",
        sourceId: "unexpected-level",
        levelDefinitionId: published.level1.id,
        amount: 1,
      }),
    );
  });
  await check("cross-version level is rejected", async () => {
    await expectXpError("XP_LEVEL_VERSION_MISMATCH", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, archived.level1.id, "wrong-version-level"),
      }),
    );
  });
  await check("nonexistent level is rejected", async () => {
    await expectXpError("XP_LEVEL_VERSION_MISMATCH", () =>
      recordCurriculumXp(baseAward(owner.enrollment.id, 999_999, "missing-level")),
    );
  });
  await check("draft enrollment pin is not awardable", async () => {
    await expectXpError("XP_ENROLLMENT_CORRUPT", () =>
      recordCurriculumXp(baseAward(draftOwner.enrollment.id, draft.level1.id, "draft-pin")),
    );
  });
  await check("archived version pin remains awardable", async () => {
    const result = await recordCurriculumXp(
      baseAward(archivedOwner.enrollment.id, archived.level1.id, "archived-pin"),
    );
    assert.equal(result.created, true);
  });
  await check("missing enrollment is rejected", async () => {
    await expectXpError("XP_ENROLLMENT_NOT_FOUND", () =>
      recordCurriculumXp(baseAward(999_999, published.level1.id, "missing-enrollment")),
    );
  });
  await check("zero amount is rejected before DB", async () => {
    await expectXpError("XP_INPUT_INVALID", () =>
      recordCurriculumXp(baseAward(owner.enrollment.id, published.level1.id, "zero", 0)),
    );
  });
  await check("negative amount is rejected before DB", async () => {
    await expectXpError("XP_INPUT_INVALID", () =>
      recordCurriculumXp(baseAward(owner.enrollment.id, published.level1.id, "negative", -1)),
    );
  });
  await check("amount over runtime limit is rejected", async () => {
    await expectXpError("XP_INPUT_INVALID", () =>
      recordCurriculumXp(baseAward(owner.enrollment.id, published.level1.id, "too-large", 1_000_001)),
    );
  });
  await check("empty source identity is rejected", async () => {
    await expectXpError("XP_SOURCE_INVALID", () =>
      recordCurriculumXp(baseAward(owner.enrollment.id, published.level1.id, "   ")),
    );
  });
  await check("invalid source is rejected", async () => {
    await expectXpError("XP_SOURCE_INVALID", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "invalid-source"),
        sourceType: "task" as never,
      }),
    );
  });
  await check("missing or inactive actor is rejected", async () => {
    await expectXpError("XP_ACTOR_INVALID", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "missing-actor"),
        actorId: 999_999,
      }),
    );
    const blocked = await prisma!.user.create({
      data: { email: "xp-blocked-actor@example.com", name: "blocked", status: "blocked" },
    });
    await expectXpError("XP_ACTOR_INVALID", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "blocked-actor"),
        actorId: blocked.id,
      }),
    );
  });

  let canonicalFingerprint = "";
  let canonicalCreatedAt = new Date(0);
  await check("server generates namespaced key and SHA-256 fingerprint", async () => {
    const result = await recordCurriculumXp({
      ...baseAward(owner.enrollment.id, published.level1.id, "canonical-order"),
      actorId: actor.id,
      metadata: { zebra: 2, alpha: { two: 2, one: 1 } },
    });
    const row = await prisma!.xPTransaction.findUniqueOrThrow({ where: { id: result.transaction.id } });
    assert.match(row.idempotencyKey, /^xp:v2:level-completion:\d+:canonical-order$/);
    assert.match(row.payloadFingerprint, /^sha256:[a-f0-9]{64}$/);
    canonicalFingerprint = row.payloadFingerprint;
    canonicalCreatedAt = row.createdAt;
  });
  await check("metadata key order is canonical and retry is idempotent", async () => {
    const auditCount = await prisma!.auditLog.count({ where: { action: "CURRICULUM_XP_AWARDED" } });
    const retry = await recordCurriculumXp({
      ...baseAward(owner.enrollment.id, published.level1.id, "canonical-order"),
      actorId: actor.id,
      metadata: { alpha: { one: 1, two: 2 }, zebra: 2 },
    });
    assert.equal(retry.created, false);
    assert.equal(retry.transaction.createdAt.getTime(), canonicalCreatedAt.getTime());
    const row = await prisma!.xPTransaction.findUniqueOrThrow({ where: { id: retry.transaction.id } });
    assert.equal(row.payloadFingerprint, canonicalFingerprint);
    assert.equal(await prisma!.auditLog.count({ where: { action: "CURRICULUM_XP_AWARDED" } }), auditCount);
  });
  await check("changed amount creates idempotency conflict", async () => {
    await expectXpError("XP_IDEMPOTENCY_CONFLICT", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "canonical-order", 26),
        actorId: actor.id,
        metadata: { alpha: { one: 1, two: 2 }, zebra: 2 },
      }),
    );
  });
  await check("changed level changes semantic fingerprint and conflicts", async () => {
    await expectXpError("XP_IDEMPOTENCY_CONFLICT", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level2.id, "canonical-order"),
        actorId: actor.id,
        metadata: { alpha: { one: 1, two: 2 }, zebra: 2 },
      }),
    );
  });
  await check("changed actor changes semantic fingerprint and conflicts", async () => {
    await expectXpError("XP_IDEMPOTENCY_CONFLICT", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "canonical-order"),
        actorId: actor2.id,
        metadata: { alpha: { one: 1, two: 2 }, zebra: 2 },
      }),
    );
  });
  await check("changed metadata changes semantic fingerprint and conflicts", async () => {
    await expectXpError("XP_IDEMPOTENCY_CONFLICT", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "canonical-order"),
        actorId: actor.id,
        metadata: { alpha: { one: 999, two: 2 }, zebra: 2 },
      }),
    );
  });
  await check("different source produces a distinct fingerprint", async () => {
    const result = await recordCurriculumXp({
      ...baseAward(owner.enrollment.id, published.level1.id, "canonical-other-source"),
      actorId: actor.id,
      metadata: { alpha: { one: 1, two: 2 }, zebra: 2 },
    });
    const row = await prisma!.xPTransaction.findUniqueOrThrow({ where: { id: result.transaction.id } });
    assert.notEqual(row.payloadFingerprint, canonicalFingerprint);
  });

  const invalidMetadataCases: Array<[string, unknown]> = [
    ["array-root", [1, 2]],
    ["secret-key", { password: "hidden" }],
    ["raw-payload", { rawPayload: "hidden" }],
    ["undefined", { safe: undefined }],
    ["function", { safe: () => 1 }],
    ["bigint", { safe: BigInt(1) }],
    ["non-finite", { safe: Number.POSITIVE_INFINITY }],
    ["date", { safe: new Date() }],
  ];
  await check("unsafe and non-JSON metadata values are rejected", async () => {
    for (const [name, metadata] of invalidMetadataCases) {
      await expectXpError("XP_INPUT_INVALID", () =>
        recordCurriculumXp({
          ...baseAward(owner.enrollment.id, published.level1.id, `metadata-${name}`),
          metadata,
        }),
      );
    }
  });
  await check("prototype-dangerous metadata key is rejected", async () => {
    const metadata = Object.create(null) as Record<string, unknown>;
    metadata.__proto__ = "danger";
    await expectXpError("XP_INPUT_INVALID", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "metadata-prototype"),
        metadata,
      }),
    );
  });
  await check("excessive metadata depth is rejected", async () => {
    await expectXpError("XP_INPUT_INVALID", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "metadata-depth"),
        metadata: { a: { b: { c: { d: { e: 1 } } } } },
      }),
    );
  });
  await check("excessive metadata size is rejected", async () => {
    await expectXpError("XP_INPUT_INVALID", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "metadata-size"),
        metadata: { note: "x".repeat(5_000) },
      }),
    );
  });

  await check("same source tuple with a foreign key is a source conflict", async () => {
    const sourceId = "forced-source-collision";
    await prisma!.$executeRawUnsafe(
      `INSERT INTO "XPTransaction" (
        "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId",
        "sourceType", "sourceId", "idempotencyKey", "payloadFingerprint", "amount"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      owner.user.id,
      owner.enrollment.id,
      published.version.id,
      published.level1.id,
      "level_completion",
      sourceId,
      "xp:v2:foreign-key:forced",
      `sha256:${"0".repeat(64)}`,
      25,
    );
    await expectXpError("XP_SOURCE_CONFLICT", () =>
      recordCurriculumXp(baseAward(owner.enrollment.id, published.level1.id, sourceId)),
    );
  });

  await check("one transaction and total are resolved deterministically", async () => {
    const isolated = await createEnrollment(
      "xp-resolver-one@example.com",
      published.version.id,
    );
    await recordCurriculumXp(baseAward(isolated.enrollment.id, published.level1.id, "one", 11));
    const first = await resolveEnrollmentXp({ enrollmentId: isolated.enrollment.id });
    const second = await resolveEnrollmentXp({ enrollmentId: isolated.enrollment.id });
    assert.deepEqual(second, first);
    assert.equal(first.kind, "available");
    if (first.kind === "available") {
      assert.equal(first.totalXp, 11);
      assert.equal(first.transactionCount, 1);
      assert.equal(first.lastTransactionAt instanceof Date, true);
    }
  });
  await check("resolver sums multiple rows and reports last transaction", async () => {
    const isolated = await createEnrollment(
      "xp-resolver-many@example.com",
      published.version.id,
    );
    const one = await recordCurriculumXp(baseAward(isolated.enrollment.id, published.level1.id, "sum-one", 10));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const two = await recordCurriculumXp(baseAward(isolated.enrollment.id, published.level1.id, "sum-two", 15));
    const result = await resolveEnrollmentXp({ enrollmentId: isolated.enrollment.id });
    assert.equal(result.kind, "available");
    if (result.kind === "available") {
      assert.equal(result.totalXp, 25);
      assert.equal(result.transactionCount, 2);
      assert.equal(result.lastTransactionAt?.getTime(), two.transaction.createdAt.getTime());
      assert.equal(one.transaction.createdAt <= two.transaction.createdAt, true);
    }
  });
  await check("asOf excludes later rows", async () => {
    const isolated = await createEnrollment(
      "xp-resolver-asof@example.com",
      published.version.id,
    );
    const one = await recordCurriculumXp(baseAward(isolated.enrollment.id, published.level1.id, "asof-one", 3));
    await new Promise((resolve) => setTimeout(resolve, 15));
    await recordCurriculumXp(baseAward(isolated.enrollment.id, published.level1.id, "asof-two", 4));
    const result = await resolveEnrollmentXp({
      enrollmentId: isolated.enrollment.id,
      asOf: one.transaction.createdAt,
    });
    assert.equal(result.kind, "available");
    if (result.kind === "available") {
      assert.equal(result.totalXp, 3);
      assert.equal(result.transactionCount, 1);
      assert.equal(result.asOf?.getTime(), one.transaction.createdAt.getTime());
    }
  });
  await check("V1 User.xp and XpEvent never affect V2 total", async () => {
    const isolated = await createEnrollment(
      "xp-v1-isolation@example.com",
      published.version.id,
    );
    await recordCurriculumXp(
      baseAward(isolated.enrollment.id, published.level1.id, "v1-isolation", 13),
    );
    await prisma!.user.update({ where: { id: isolated.user.id }, data: { xp: 987_654 } });
    await prisma!.xpEvent.create({
      data: { userId: isolated.user.id, amount: 777, source: "legacy", sourceId: "legacy" },
    });
    const expected = await prisma!.xPTransaction.aggregate({
      where: { enrollmentId: isolated.enrollment.id },
      _sum: { amount: true },
    });
    const result = await resolveEnrollmentXp({ enrollmentId: isolated.enrollment.id });
    assert.equal(result.kind, "available");
    if (result.kind === "available") assert.equal(result.totalXp, expected._sum.amount ?? 0);
  });
  await check("resolver performs no writes or timestamp/audit changes", async () => {
    const before = {
      enrollment: await prisma!.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: owner.enrollment.id } }),
      audit: await prisma!.auditLog.count(),
      rows: await prisma!.xPTransaction.count(),
    };
    await resolveEnrollmentXp({ enrollmentId: owner.enrollment.id });
    await resolveEnrollmentXp({ enrollmentId: owner.enrollment.id, asOf: new Date() });
    const after = {
      enrollment: await prisma!.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: owner.enrollment.id } }),
      audit: await prisma!.auditLog.count(),
      rows: await prisma!.xPTransaction.count(),
    };
    assert.deepEqual(after, before);
  });

  const rangeOwner = await createEnrollment(
    "xp-range@example.com",
    published.version.id,
  );
  await recordCurriculumXp(baseAward(rangeOwner.enrollment.id, published.level1.id, "range-million", 1_000_000));
  await recordCurriculumXp(baseAward(rangeOwner.enrollment.id, published.level1.id, "range-tail", 483_647));
  const rangeFixture = await rawResolverFixture(rangeOwner.enrollment.id);
  const million = rangeFixture.rows.find((row) => row.sourceId === "range-million")!;
  const tail = rangeFixture.rows.find((row) => row.sourceId === "range-tail")!;
  const maxRows = [...Array.from({ length: 2_147 }, () => ({ ...million })), { ...tail }];
  await check("available resolver uses exactly two bounded read queries", async () => {
    let queryCount = 0;
    const db = {
      $queryRaw: async () => {
        queryCount += 1;
        return queryCount === 1 ? rangeFixture.headers : rangeFixture.rows;
      },
    } as never;
    const result = await resolveEnrollmentXp({ enrollmentId: rangeOwner.enrollment.id, db });
    assert.equal(result.kind, "available");
    assert.equal(queryCount, 2);
  });
  await check("safe integer total boundary is accepted", async () => {
    const result = await resolveEnrollmentXp({
      enrollmentId: rangeOwner.enrollment.id,
      db: fakeResolverDb(rangeFixture.headers, maxRows),
    });
    assert.equal(result.kind, "available");
    if (result.kind === "available") assert.equal(result.totalXp, 2_147_483_647);
  });
  await check("aggregate overflow is typed corrupt", async () => {
    const result = await resolveEnrollmentXp({
      enrollmentId: rangeOwner.enrollment.id,
      db: fakeResolverDb(rangeFixture.headers, [...maxRows, { ...million }]),
    });
    assert.equal(result.kind, "corrupt");
    if (result.kind === "corrupt") assert.equal(result.reason, "xp_total_out_of_range");
  });
  await check("per-row runtime amount overflow is typed corrupt", async () => {
    const result = await resolveEnrollmentXp({
      enrollmentId: rangeOwner.enrollment.id,
      db: fakeResolverDb(rangeFixture.headers, [{ ...million, amount: BigInt(1_000_001) }]),
    });
    assert.equal(result.kind, "corrupt");
    if (result.kind === "corrupt") assert.equal(result.reason, "xp_amount_out_of_range");
  });
  await check("owner discriminator corruption is detected", async () => {
    const result = await resolveEnrollmentXp({
      enrollmentId: rangeOwner.enrollment.id,
      db: fakeResolverDb(rangeFixture.headers, [{ ...million, userId: BigInt(999_999) }]),
    });
    assert.equal(result.kind, "corrupt");
    if (result.kind === "corrupt") assert.equal(result.reason, "xp_owner_mismatch");
  });
  await check("version discriminator corruption is detected", async () => {
    const result = await resolveEnrollmentXp({
      enrollmentId: rangeOwner.enrollment.id,
      db: fakeResolverDb(rangeFixture.headers, [{ ...million, curriculumVersionId: BigInt(999_999) }]),
    });
    assert.equal(result.kind, "corrupt");
    if (result.kind === "corrupt") assert.equal(result.reason, "xp_version_mismatch");
  });
  await check("privileged invalid level/version fixture is corrupt", async () => {
    const result = await resolveEnrollmentXp({
      enrollmentId: rangeOwner.enrollment.id,
      db: fakeResolverDb(rangeFixture.headers, [{ ...million, levelVersionId: BigInt(999_999) }]),
    });
    assert.equal(result.kind, "corrupt");
    if (result.kind === "corrupt") assert.equal(result.reason, "xp_level_version_mismatch");
  });
  await check("invalid stored metadata is corrupt and content is not returned", async () => {
    const result = await resolveEnrollmentXp({
      enrollmentId: rangeOwner.enrollment.id,
      db: fakeResolverDb(rangeFixture.headers, [{ ...million, metadata: { password: "hidden" } }]),
    });
    assert.deepEqual(result, {
      kind: "corrupt",
      code: "XP_TOTAL_CORRUPT",
      reason: "xp_metadata_invalid",
    });
    assert.equal(JSON.stringify(result).includes("hidden"), false);
  });

  await check("controlled expected P2002 race returns verified existing row", async () => {
    const raceOwner = await createEnrollment("xp-race@example.com", published.version.id);
    const input = baseAward(raceOwner.enrollment.id, published.level1.id, "race");
    const result = await prisma!.$transaction(async (tx) => {
      let firstKeyRead = true;
      let firstSourceRead = true;
      const delegate = proxyTx(tx.xPTransaction, {
        findUnique: async (args: unknown) => {
          if (firstKeyRead) {
            firstKeyRead = false;
            return null;
          }
          return tx.xPTransaction.findUnique(args as never);
        },
        findFirst: async (args: unknown) => {
          if (firstSourceRead) {
            firstSourceRead = false;
            return null;
          }
          return tx.xPTransaction.findFirst(args as never);
        },
        create: async (args: unknown) => {
          await tx.xPTransaction.create(args as never);
          throw { code: "P2002", meta: { target: ["idempotencyKey"] } };
        },
      });
      const wrapped = proxyTx(tx, { xPTransaction: delegate });
      return recordCurriculumXpInTransaction(wrapped as never, input);
    });
    assert.equal(result.created, false);
    assert.equal(await prisma!.xPTransaction.count({ where: { enrollmentId: raceOwner.enrollment.id } }), 1);
  });
  await check("unknown P2002 target is not treated as duplicate", async () => {
    const raceOwner = await createEnrollment("xp-race-unknown@example.com", published.version.id);
    const fakeRoot = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        prisma!.$transaction(async (tx) => {
          const delegate = proxyTx(tx.xPTransaction, {
            findUnique: async () => null,
            findFirst: async () => null,
            create: async () => {
              throw { code: "P2002", meta: { target: ["unrelatedUnique"] } };
            },
          });
          return callback(proxyTx(tx, { xPTransaction: delegate }));
        }),
    };
    await expectXpError("XP_INTERNAL_ERROR", () =>
      recordCurriculumXp({
        ...baseAward(raceOwner.enrollment.id, published.level1.id, "unknown-race"),
        db: fakeRoot as never,
      }),
    );
  });
  await check("audit failure rolls back XP row", async () => {
    const rollbackOwner = await createEnrollment("xp-audit-rollback@example.com", published.version.id);
    const fakeRoot = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        prisma!.$transaction((tx) =>
          callback(
            proxyTx(tx, {
              auditLog: proxyTx(tx.auditLog, {
                create: async () => {
                  throw new Error("injected audit failure");
                },
              }),
            }),
          ),
        ),
    };
    await expectXpError("XP_INTERNAL_ERROR", () =>
      recordCurriculumXp({
        ...baseAward(rollbackOwner.enrollment.id, published.level1.id, "audit-failure"),
        db: fakeRoot as never,
      }),
    );
    assert.equal(await prisma!.xPTransaction.count({ where: { enrollmentId: rollbackOwner.enrollment.id } }), 0);
  });
  await check("outer transaction failure rolls back helper award and audit", async () => {
    const rollbackOwner = await createEnrollment("xp-outer-rollback@example.com", published.version.id);
    const beforeRows = await prisma!.xPTransaction.count({
      where: { enrollmentId: rollbackOwner.enrollment.id },
    });
    const beforeAudits = await prisma!.auditLog.count({
      where: { action: "CURRICULUM_XP_AWARDED" },
    });
    await assert.rejects(() =>
      prisma!.$transaction(async (tx) => {
        await recordCurriculumXpInTransaction(
          tx,
          baseAward(rollbackOwner.enrollment.id, published.level1.id, "outer-failure"),
        );
        throw new Error("outer failure");
      }),
    );
    assert.equal(
      await prisma!.xPTransaction.count({ where: { enrollmentId: rollbackOwner.enrollment.id } }),
      beforeRows,
    );
    assert.equal(
      await prisma!.auditLog.count({ where: { action: "CURRICULUM_XP_AWARDED" } }),
      beforeAudits,
    );
  });
  await check("transaction client path does not open a nested transaction", async () => {
    const txOwner = await createEnrollment("xp-tx-helper@example.com", published.version.id);
    const result = await prisma!.$transaction((tx) =>
      recordCurriculumXp({
        ...baseAward(txOwner.enrollment.id, published.level1.id, "tx-helper"),
        db: tx,
      }),
    );
    assert.equal(result.created, true);
  });
  await check("unknown infrastructure error is sanitized", async () => {
    const fakeRoot = {
      $transaction: async () => {
        throw new Error("SQL SELECT secret FROM /tmp/private.db");
      },
    };
    await expectXpError("XP_INTERNAL_ERROR", () =>
      recordCurriculumXp({
        ...baseAward(owner.enrollment.id, published.level1.id, "raw-error"),
        db: fakeRoot as never,
      }),
    );
  });

  await check("awards do not mutate enrollment progress summaries or timestamps", async () => {
    const after = await prisma!.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: owner.enrollment.id },
    });
    assert.deepEqual(after, baseline.enrollment);
    assert.equal(
      await prisma!.userLevelProgress.count({ where: { enrollmentId: owner.enrollment.id } }),
      baseline.progress,
    );
  });
  await check("awards create no notification CRM or unrelated V1 XP side effects", async () => {
    assert.equal(await prisma!.notification.count(), baseline.notifications);
    assert.equal(await prisma!.crmUserCohort.count(), baseline.cohorts);
    assert.equal(await prisma!.xpEvent.count(), baseline.xpEvents + 1);
    assert.equal(
      (await prisma!.user.findUniqueOrThrow({ where: { id: owner.user.id } })).xp,
      baseline.v1Xp,
    );
  });
  await check("ledger module exports no update or delete service", () => {
    const source = fs.readFileSync(path.join("src", "lib", "curriculum", "xp.ts"), "utf8");
    assert.equal(/xPTransaction\.(?:update|updateMany|delete|deleteMany)\s*\(/.test(source), false);
    assert.equal(/export\s+(?:async\s+)?function\s+.*(?:update|delete).*Xp/i.test(source), false);
  });
  await check("schema and migration remain untouched by runtime regression", () => {
    const schema = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf8");
    const migration = fs.readFileSync(
      path.join(
        "prisma",
        "migrations",
        "20260714020000_xp_transaction_foundation",
        "migration.sql",
      ),
      "utf8",
    );
    assert.equal(schema.includes("model XPTransaction"), true);
    assert.equal(migration.includes('CHECK ("amount" > 0)'), true);
  });
}

async function run() {
  try {
    await main();
  } finally {
    if (prisma) await prisma.$disconnect();
    cleanupDb();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousXpFlag === undefined) delete process.env.CURRICULUM_V2_XP_ENABLED;
    else process.env.CURRICULUM_V2_XP_ENABLED = previousXpFlag;
  }

  await check("temporary DB and journals are removed", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
    }
  });

  console.log(`\ncurriculum XP ledger regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
