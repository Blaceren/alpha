import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  Prisma,
  PrismaClient,
  type CurriculumVersion,
  type LevelDefinition,
  type UserCurriculumEnrollment,
} from "@prisma/client";

// Phase 3B.3 regression: XP-aware effective level state. Temporary SQLite DB in
// /tmp, cleaned up in finally. XP totals are seeded through the real ledger
// service. Temporal assertions use the durable transaction.createdAt returned
// by that service; callers never gain control of createdAt. Corruption is
// injected only with targeted test-fixture UPDATEs.

const dbPath = `/tmp/ata-curriculum-xp-level-state-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = dbUrl;

const AS_OF = new Date("2026-05-01T00:00:00.000Z");
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

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

type Flags = { read?: boolean; enrollment?: boolean; admin?: boolean; xp?: boolean };

function setFlags(flags: Flags) {
  const map: Record<string, boolean | undefined> = {
    CURRICULUM_V2_READ_ENABLED: flags.read,
    CURRICULUM_V2_ENROLLMENT_ENABLED: flags.enrollment,
    CURRICULUM_V2_ADMIN_ENABLED: flags.admin,
    CURRICULUM_V2_XP_ENABLED: flags.xp,
  };
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
}

async function main() {
  cleanupDb();
  const runner = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (runner.status !== 0) {
    console.error(runner.stdout, runner.stderr);
    throw new Error(`migration runner exited with ${runner.status}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const levelState = await import("../../src/lib/curriculum/level-state");
  const xp = await import("../../src/lib/curriculum/xp");

  type Resolved = Extract<
    Awaited<ReturnType<typeof levelState.resolveUserCurriculumLevelStates>>,
    { kind: "resolved" }
  >;

  let seq = 0;

  async function createUser(label: string, extra: Prisma.UserCreateInput | object = {}) {
    seq += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${seq}@example.com`,
        name: label,
        ...(extra as object),
      },
    });
  }

  async function createGraph(input: {
    status?: "draft" | "published" | "archived";
    versionNumber?: number;
    levelCount?: number;
    requiredXp?: Record<number, number>;
    checkpoints?: number[];
    visibility?: number[];
    levelStatus?: Record<number, "active" | "disabled">;
    code?: string;
  } = {}) {
    const status = input.status ?? "published";
    const levelCount = input.levelCount ?? 3;
    const code = input.code ?? "ata-v2";
    const version = await prisma.curriculumVersion.create({
      data: {
        code,
        name: `${code} v${input.versionNumber ?? 1}`,
        versionNumber: input.versionNumber ?? 1,
        status,
        publishedAt: status === "published" ? AS_OF : null,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m01-${version.id}`,
        title: "Module 1",
        firstLevel: 1,
        lastLevel: levelCount,
      },
    });
    const levels: LevelDefinition[] = [];
    for (let levelNumber = 1; levelNumber <= levelCount; levelNumber += 1) {
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber,
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.xps-${version.id}`,
            type: "lesson",
            title: `Level ${levelNumber}`,
            completionMethod: "lesson",
            requiredXp: input.requiredXp?.[levelNumber] ?? 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            requiredCheckpointLevel: input.checkpoints?.includes(levelNumber)
              ? Math.max(1, levelNumber - 1)
              : null,
            visibilityRule: input.visibility?.includes(levelNumber)
              ? { unsupported: true }
              : undefined,
            status: input.levelStatus?.[levelNumber] ?? "active",
          },
        }),
      );
    }
    return { version, module: moduleDefinition, levels };
  }

  async function enroll(input: {
    userId: number;
    version: CurriculumVersion;
    status?: "active" | "completed" | "superseded";
    currentLevel?: number;
    highestCompletedLevel?: number;
  }) {
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId: input.userId,
        curriculumVersionId: input.version.id,
        curriculumCode: input.version.code,
        status: input.status ?? "active",
        enrolledAt: AS_OF,
        currentLevel: input.currentLevel ?? 1,
        highestCompletedLevel: input.highestCompletedLevel ?? 0,
        completedAt: (input.status ?? "active") === "completed" ? AS_OF : null,
      },
    });
  }

  async function completeLevel(enrollment: UserCurriculumEnrollment, level: LevelDefinition) {
    return prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: enrollment.curriculumVersionId,
        levelDefinitionId: level.id,
        status: "completed",
        startedAt: AS_OF,
        lastProgressAt: AS_OF,
        completedAt: AS_OF,
      },
    });
  }

  async function progressLevel(
    enrollment: UserCurriculumEnrollment,
    level: LevelDefinition,
    status: "in_progress" | "pending_review",
  ) {
    return prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: enrollment.curriculumVersionId,
        levelDefinitionId: level.id,
        status,
        startedAt: AS_OF,
        lastProgressAt: AS_OF,
      },
    });
  }

  let xpSeq = 0;
  async function seedXp(enrollmentId: number, amount: number, sourceId?: string) {
    xpSeq += 1;
    const previous = process.env.CURRICULUM_V2_XP_ENABLED;
    process.env.CURRICULUM_V2_XP_ENABLED = "true";
    try {
      const result = await xp.recordCurriculumXp({
        db: prisma,
        enrollmentId,
        sourceType: "promocode",
        sourceId: sourceId ?? `promo-${process.pid}-${xpSeq}`,
        amount,
      });
      return result.transaction;
    } finally {
      if (previous === undefined) delete process.env.CURRICULUM_V2_XP_ENABLED;
      else process.env.CURRICULUM_V2_XP_ENABLED = previous;
    }
  }

  async function resolve(
    userId: number,
    db?: Prisma.TransactionClient,
    asOf?: Date,
  ) {
    return levelState.resolveUserCurriculumLevelStates({ userId, db, asOf });
  }

  function findLevel(result: Resolved, levelNumber: number) {
    const item = result.levels.find((l) => l.levelDefinition.levelNumber === levelNumber);
    assert.ok(item, `missing level ${levelNumber}`);
    return item;
  }

  function asResolved(result: Awaited<ReturnType<typeof resolve>>): Resolved {
    assert.equal(result.kind, "resolved", `expected resolved, got ${result.kind}`);
    return result as Resolved;
  }

  async function expectStartError(code: string, fn: () => Promise<unknown>) {
    await assert.rejects(fn, (error: unknown) => {
      assert.equal(levelState.isLevelStartDomainError(error), true);
      assert.equal((error as { code: string }).code, code);
      return true;
    });
  }

  // At most one published version per curriculum code may exist (partial unique
  // index) and the resolver always resolves the default code, so each scenario
  // starts from a clean database.
  async function reset() {
    // POCKET-REG-INGRESS-1 добавил Growth-реестр, который ссылается на
    // enrollment/level/user через Restrict. Эта регрессия стартует уровни
    // каноническим владельцем, а тот пишет `level_started` — поэтому первый же
    // успешный старт делал следующий reset() нарушением FK и ронял все
    // последующие сценарии. Тот же порядок уже применён в
    // `curriculumLevelCompletionRegression`; здесь его просто не было.
    await prisma.growthEventOutbox.deleteMany();
    await prisma.growthEvent.deleteMany();
    await prisma.xPTransaction.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.xpEvent.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
  }

  const baseCheck = check;
  async function run(name: string, fn: () => unknown | Promise<unknown>) {
    await baseCheck(name, async () => {
      await reset();
      await fn();
    });
  }

  try {
    // ---------- Flags & authority (1-7) ----------
    await run("1. XP flag absent: requiredXp>0 current level blocks with xp_engine_unavailable", async () => {
      setFlags({ read: true });
      const user = await createUser("f1");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      await enroll({ userId: user.id, version });
      const result = asResolved(await resolve(user.id));
      const current = findLevel(result, 1);
      assert.equal(current.state, "locked");
      assert.deepEqual(current.blockers, ["xp_engine_unavailable"]);
      assert.equal(result.levels.some((l) => l.state === "xp_eligible"), false);
    });

    await run("2. XP flag=false: same fail-closed behaviour", async () => {
      setFlags({ read: true, xp: false });
      const user = await createUser("f2");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      await enroll({ userId: user.id, version });
      const current = findLevel(asResolved(await resolve(user.id)), 1);
      assert.deepEqual(current.blockers, ["xp_engine_unavailable"]);
    });

    await run("3. XP flag=true: ledger authority is used", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("f3");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      const result = asResolved(await resolve(user.id));
      assert.equal(result.xp.kind, "available");
      assert.equal(findLevel(result, 1).state, "available");
    });

    await run("4. XP flag is read dynamically", async () => {
      const user = await createUser("f4");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      setFlags({ read: true, xp: false });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "locked");
      setFlags({ read: true, xp: true });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "available");
    });

    await run("5. V1 User.xp is ignored", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("f5", { xp: 9999, level: 40 });
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      await enroll({ userId: user.id, version });
      const current = findLevel(asResolved(await resolve(user.id)), 1);
      assert.equal(current.state, "locked");
      assert.deepEqual(current.blockers, ["xp_insufficient"]);
    });

    await run("6. V1 XpEvent is ignored", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("f6");
      await prisma.xpEvent.create({ data: { userId: user.id, amount: 500, source: "task", sourceId: "t1" } });
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      await enroll({ userId: user.id, version });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "locked");
    });

    await run("7. READ/ENROLLMENT/ADMIN flags do not substitute the XP flag", async () => {
      setFlags({ read: true, enrollment: true, admin: true, xp: false });
      const user = await createUser("f7");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 50);
      const current = findLevel(asResolved(await resolve(user.id)), 1);
      assert.deepEqual(current.blockers, ["xp_engine_unavailable"]);
    });

    // ---------- XP thresholds (8-17) ----------
    await run("8. requiredXp=0 with flag off passes the XP gate", async () => {
      setFlags({ read: true, xp: false });
      const user = await createUser("t8");
      const { version } = await createGraph({ requiredXp: { 1: 0 } });
      await enroll({ userId: user.id, version });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "available");
    });

    await run("9. requiredXp>0 with flag off blocks", async () => {
      setFlags({ read: true, xp: false });
      const user = await createUser("t9");
      const { version } = await createGraph({ requiredXp: { 1: 5 } });
      await enroll({ userId: user.id, version });
      assert.deepEqual(findLevel(asResolved(await resolve(user.id)), 1).blockers, ["xp_engine_unavailable"]);
    });

    await run("10. zero ledger total below threshold blocks", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("t10");
      const { version } = await createGraph({ requiredXp: { 1: 5 } });
      await enroll({ userId: user.id, version });
      const current = findLevel(asResolved(await resolve(user.id)), 1);
      assert.deepEqual(current.blockers, ["xp_insufficient"]);
    });

    await run("11. below threshold blocks", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("t11");
      const { version } = await createGraph({ requiredXp: { 1: 30 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 29);
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "locked");
    });

    await run("12. exact threshold is available", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("t12");
      const { version } = await createGraph({ requiredXp: { 1: 30 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 30);
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "available");
    });

    await run("13. surplus XP is available", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("t13");
      const { version } = await createGraph({ requiredXp: { 1: 30 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 90);
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "available");
    });

    await run("14. multiple ledger rows are summed", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("t14");
      const { version } = await createGraph({ requiredXp: { 1: 30 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 12, "part-a");
      await seedXp(e.id, 18, "part-b");
      const result = asResolved(await resolve(user.id));
      assert.equal(result.xp.kind === "available" && result.xp.totalXp, 30);
      assert.equal(findLevel(result, 1).state, "available");
    });

    await run("15. XP of another enrollment is not counted", async () => {
      setFlags({ read: true, xp: true });
      const userA = await createUser("t15a");
      const userB = await createUser("t15b");
      const { version: vA } = await createGraph({ requiredXp: { 1: 30 }, code: "ata-v2" });
      const { version: vB } = await createGraph({ requiredXp: { 1: 30 }, code: "other-v2" });
      const eA = await enroll({ userId: userA.id, version: vA });
      const eB = await enroll({ userId: userB.id, version: vB });
      await seedXp(eB.id, 100);
      const current = findLevel(asResolved(await resolve(userA.id)), 1);
      assert.equal(current.state, "locked");
      assert.deepEqual(current.blockers, ["xp_insufficient"]);
      void eA;
    });

    await run("16. archived pin is supported", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("t16");
      const { version } = await createGraph({ status: "archived", requiredXp: { 1: 20 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 20);
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "available");
    });

    await run("17. newer published version does not change the pin", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("t17");
      const { version: v1 } = await createGraph({ requiredXp: { 1: 20 }, versionNumber: 1 });
      const e = await enroll({ userId: user.id, version: v1 });
      await seedXp(e.id, 20);
      // Archive v1, publish v2 of the same code; the enrollment stays pinned to v1.
      await prisma.curriculumVersion.update({ where: { id: v1.id }, data: { status: "archived" } });
      await createGraph({ requiredXp: { 1: 999 }, versionNumber: 2, status: "published" });
      const result = asResolved(await resolve(user.id));
      assert.equal(result.curriculumVersion.id, v1.id);
      assert.equal(findLevel(result, 1).state, "available");
    });

    // ---------- States (18-32) ----------
    async function threeLevelEnrollment(label: string, opts: {
      currentLevel: number;
      xp: number;
      status?: "published" | "archived";
      requiredXp?: Record<number, number>;
      checkpoints?: number[];
      visibility?: number[];
      levelStatus?: Record<number, "active" | "disabled">;
    }) {
      const user = await createUser(label);
      const graph = await createGraph({
        levelCount: 3,
        status: opts.status,
        requiredXp: opts.requiredXp,
        checkpoints: opts.checkpoints,
        visibility: opts.visibility,
        levelStatus: opts.levelStatus,
      });
      const e = await enroll({
        userId: user.id,
        version: graph.version,
        currentLevel: opts.currentLevel,
        highestCompletedLevel: opts.currentLevel - 1,
      });
      for (let n = 1; n < opts.currentLevel; n += 1) await completeLevel(e, graph.levels[n - 1]);
      if (opts.xp > 0) await seedXp(e.id, opts.xp);
      return { user, graph, enrollment: e };
    }

    await run("18. current level at exact threshold is available", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s18", { currentLevel: 1, xp: 15, requiredXp: { 1: 15 } });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "available");
    });

    await run("19. current level with insufficient XP is locked", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s19", { currentLevel: 1, xp: 5, requiredXp: { 1: 15 } });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "locked");
    });

    await run("20. future level with sufficient XP is xp_eligible", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s20", { currentLevel: 1, xp: 50, requiredXp: { 3: 20 } });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 3).state, "xp_eligible");
    });

    await run("21. future level with insufficient XP is locked", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s21", { currentLevel: 1, xp: 5, requiredXp: { 3: 20 } });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 3).state, "locked");
    });

    await run("22. future requiredXp=0 with XP enabled is xp_eligible", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s22", { currentLevel: 1, xp: 0, requiredXp: {} });
      assert.equal(findLevel(asResolved(await resolve(user.id)), 2).state, "xp_eligible");
    });

    await run("23. at most one level is available", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s23", { currentLevel: 1, xp: 100, requiredXp: { 1: 10, 2: 10, 3: 10 } });
      const result = asResolved(await resolve(user.id));
      assert.equal(result.levels.filter((l) => l.state === "available").length, 1);
    });

    await run("24. XP does not bypass sequence (future stays xp_eligible)", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s24", { currentLevel: 1, xp: 100, requiredXp: { 2: 10, 3: 10 } });
      const result = asResolved(await resolve(user.id));
      assert.equal(findLevel(result, 2).state, "xp_eligible");
      assert.equal(findLevel(result, 3).state, "xp_eligible");
      assert.ok(findLevel(result, 2).blockers.includes("not_current_level"));
    });

    await run("25. XP does not bypass checkpoint (current stays locked)", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s25", { currentLevel: 2, xp: 100, requiredXp: { 2: 10 }, checkpoints: [2] });
      const current = findLevel(asResolved(await resolve(user.id)), 2);
      assert.equal(current.state, "locked");
      assert.ok(current.blockers.includes("checkpoint_engine_unavailable"));
    });

    await run("26. inactive definition is never xp_eligible", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s26", {
        currentLevel: 1, xp: 100, status: "archived", requiredXp: { 3: 10 }, levelStatus: { 3: "disabled" },
      });
      const level3 = findLevel(asResolved(await resolve(user.id)), 3);
      assert.equal(level3.state, "locked");
      assert.ok(level3.blockers.includes("definition_inactive"));
    });

    await run("27. unsupported visibility fails closed (locked)", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s27", {
        currentLevel: 1, xp: 100, requiredXp: { 3: 10 }, visibility: [3],
      });
      const level3 = findLevel(asResolved(await resolve(user.id)), 3);
      assert.equal(level3.state, "locked");
      assert.ok(level3.blockers.includes("visibility_rule_unsupported"));
    });

    await run("28. blocker ordering is deterministic", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("s28", {
        currentLevel: 1, xp: 0, status: "archived", requiredXp: { 3: 10 }, checkpoints: [3], visibility: [3], levelStatus: { 3: "disabled" },
      });
      const level3 = findLevel(asResolved(await resolve(user.id)), 3);
      assert.deepEqual(level3.blockers, [
        "not_current_level",
        "definition_inactive",
        "sequence_incomplete",
        "xp_insufficient",
        "checkpoint_engine_unavailable",
        "visibility_rule_unsupported",
      ]);
    });

    await run("29. completed durable status stays completed", async () => {
      setFlags({ read: true, xp: true });
      const { user, graph } = await threeLevelEnrollment("s29", { currentLevel: 2, xp: 0, requiredXp: { 1: 999 } });
      const level1 = findLevel(asResolved(await resolve(user.id)), 1);
      assert.equal(level1.state, "completed");
      void graph;
    });

    await run("30. in_progress durable status stays in_progress", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("s30");
      const graph = await createGraph({ requiredXp: { 1: 999 } });
      const e = await enroll({ userId: user.id, version: graph.version });
      await progressLevel(e, graph.levels[0], "in_progress");
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "in_progress");
    });

    await run("31. pending_review durable status stays pending_review", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("s31");
      const graph = await createGraph({ requiredXp: { 1: 999 } });
      const e = await enroll({ userId: user.id, version: graph.version });
      await progressLevel(e, graph.levels[0], "pending_review");
      assert.equal(findLevel(asResolved(await resolve(user.id)), 1).state, "pending_review");
    });

    await run("32. computed states are never persisted", async () => {
      setFlags({ read: true, xp: true });
      const { user, enrollment } = await threeLevelEnrollment("s32", { currentLevel: 1, xp: 100, requiredXp: { 2: 10 } });
      asResolved(await resolve(user.id));
      const rows = await prisma.userLevelProgress.findMany({ where: { enrollmentId: enrollment.id } });
      assert.equal(rows.every((r) => r.status === "completed" || r.status === "in_progress" || r.status === "pending_review"), true);
      assert.equal(rows.some((r) => (r.status as string) === "available" || (r.status as string) === "xp_eligible" || (r.status as string) === "locked"), false);
    });

    // ---------- Corruption (33-40) ----------
    function isCorrupt(result: Awaited<ReturnType<typeof resolve>>) {
      assert.equal(result.kind, "corrupt");
      assert.equal("levels" in result, false);
      return result as Extract<typeof result, { kind: "corrupt" }>;
    }

    await run("33. draft pin yields whole-result corrupt", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("c33");
      const { version } = await createGraph({ status: "draft" });
      await enroll({ userId: user.id, version });
      isCorrupt(await resolve(user.id));
    });

    // Ownership/version/level XP consistency is DB-enforced by composite foreign
    // keys and cannot be injected with valid data; the XP ledger regression
    // covers those defensive checks. Here the injectable ledger corruptions
    // (fingerprint, idempotency key, source type, amount) prove the level state
    // fails to a whole-result corrupt rather than a partial map.
    await run("34. XP fingerprint corruption yields whole-result corrupt", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("c34");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      await prisma.$executeRawUnsafe(
        `UPDATE "XPTransaction" SET "payloadFingerprint" = 'sha256:${"0".repeat(64)}' WHERE "enrollmentId" = ${e.id}`,
      );
      const corrupt = isCorrupt(await resolve(user.id));
      assert.equal(corrupt.reason, "xp_resolution_corrupt");
    });

    await run("35. XP idempotency-key corruption yields whole-result corrupt", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("c35");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      await prisma.$executeRawUnsafe(
        `UPDATE "XPTransaction" SET "idempotencyKey" = 'xp:v2:tampered:${e.id}' WHERE "enrollmentId" = ${e.id}`,
      );
      assert.equal(isCorrupt(await resolve(user.id)).reason, "xp_resolution_corrupt");
    });

    await run("36. XP metadata corruption yields whole-result corrupt", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("c36");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      // Valid JSON (passes any JSON check) but a forbidden application key.
      await prisma.$executeRawUnsafe(
        `UPDATE "XPTransaction" SET "metadata" = '{"secret":"x"}' WHERE "enrollmentId" = ${e.id}`,
      );
      assert.equal(isCorrupt(await resolve(user.id)).reason, "xp_resolution_corrupt");
    });

    await run("37. XP amount out-of-range yields whole-result corrupt", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("c37");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      // 2000000 exceeds the per-award ceiling (1000000) yet stays within Int32.
      await prisma.$executeRawUnsafe(`UPDATE "XPTransaction" SET "amount" = 2000000 WHERE "enrollmentId" = ${e.id}`);
      assert.equal(isCorrupt(await resolve(user.id)).reason, "xp_resolution_corrupt");
    });

    await run("38. summary/progress contradiction yields whole-result corrupt", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("c38");
      const graph = await createGraph({ levelCount: 3 });
      const e = await enroll({ userId: user.id, version: graph.version, currentLevel: 2, highestCompletedLevel: 1 });
      await completeLevel(e, graph.levels[0]);
      // contradiction: a completed progress at the current level
      await completeLevel(e, graph.levels[1]);
      isCorrupt(await resolve(user.id));
    });

    await run("39. corrupt result carries no partial level map", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("c39");
      const { version } = await createGraph({ status: "draft" });
      await enroll({ userId: user.id, version });
      const result = await resolve(user.id);
      assert.equal(result.kind, "corrupt");
      assert.equal("levels" in result, false);
    });

    await run("40. corrupt diagnostics do not leak raw values", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("c40");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      await prisma.$executeRawUnsafe(`UPDATE "XPTransaction" SET "amount" = 2000000 WHERE "enrollmentId" = ${e.id}`);
      const corrupt = isCorrupt(await resolve(user.id));
      const serialized = JSON.stringify(corrupt);
      assert.equal(serialized.includes("2000000"), false);
      assert.equal(/SELECT|UPDATE|\/tmp|sqlite/i.test(serialized), false);
    });

    // ---------- Start (41-54) ----------
    await run("41. requiredXp=0 start creates progress", async () => {
      setFlags({ read: true, enrollment: true, xp: false });
      const user = await createUser("st41");
      const { version } = await createGraph({ requiredXp: { 1: 0 } });
      await enroll({ userId: user.id, version });
      const result = await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      assert.equal(result.created, true);
    });

    await run("42. flag off + positive requiredXp blocks start", async () => {
      setFlags({ read: true, enrollment: true, xp: false });
      const user = await createUser("st42");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      await enroll({ userId: user.id, version });
      await expectStartError("LEVEL_START_NOT_AVAILABLE", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma }),
      );
    });

    await run("43. insufficient XP blocks start", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st43");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 3);
      await expectStartError("LEVEL_START_NOT_AVAILABLE", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma }),
      );
    });

    await run("44. exact XP allows start", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st44");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      const result = await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      assert.equal(result.created, true);
    });

    await run("45. surplus XP allows start", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st45");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 40);
      const result = await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      assert.equal(result.created, true);
    });

    await run("46. checkpoint cannot be bypassed on start", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st46");
      const graph = await createGraph({ levelCount: 2, requiredXp: { 2: 10 }, checkpoints: [2] });
      const e = await enroll({ userId: user.id, version: graph.version, currentLevel: 2, highestCompletedLevel: 1 });
      await completeLevel(e, graph.levels[0]);
      await seedXp(e.id, 100);
      await expectStartError("LEVEL_START_NOT_AVAILABLE", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma }),
      );
    });

    await run("47. xp_eligible future level is not started", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const { user, graph } = await threeLevelEnrollment("st47", { currentLevel: 1, xp: 100, requiredXp: { 1: 0, 3: 10 } });
      const result = await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      assert.equal(result.levelDefinition.levelNumber, 1);
      const states = asResolved(await resolve(user.id));
      assert.equal(findLevel(states, 3).state, "xp_eligible");
      void graph;
    });

    await run("48. start does not create XP transactions", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st48");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      const before = await prisma.xPTransaction.count({ where: { enrollmentId: e.id } });
      await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: e.id } }), before);
    });

    await run("49. start does not change the XP total", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st49");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 25);
      const before = await xp.resolveEnrollmentXp({ enrollmentId: e.id, db: prisma });
      await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      const after = await xp.resolveEnrollmentXp({ enrollmentId: e.id, db: prisma });
      assert.equal(before.kind === "available" && after.kind === "available" && before.totalXp === after.totalXp, true);
    });

    await run("50. start does not change enrollment progression summary", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st50");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: e.id } });
      assert.equal(after.currentLevel, e.currentLevel);
      assert.equal(after.highestCompletedLevel, e.highestCompletedLevel);
    });

    await run("51. repeated start of in_progress returns created=false", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st51");
      const graph = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version: graph.version });
      await progressLevel(e, graph.levels[0], "in_progress");
      const result = await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      assert.equal(result.created, false);
    });

    await run("52. repeated start of pending_review returns created=false", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st52");
      const graph = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version: graph.version });
      await progressLevel(e, graph.levels[0], "pending_review");
      const result = await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      assert.equal(result.created, false);
    });

    await run("53. idempotent repeat after XP flag turned off returns created=false", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st53");
      const graph = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version: graph.version });
      await progressLevel(e, graph.levels[0], "in_progress");
      setFlags({ read: true, enrollment: true, xp: false });
      const result = await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, db: prisma });
      assert.equal(result.created, false);
    });

    await run("54. repeat start does not change audit or timestamps", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("st54");
      const graph = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version: graph.version });
      const progress = await progressLevel(e, graph.levels[0], "in_progress");
      const auditBefore = await prisma.auditLog.count();
      await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, asOf: new Date(AS_OF.getTime() + 60000), db: prisma });
      assert.equal(await prisma.auditLog.count(), auditBefore);
      const after = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } });
      assert.equal(after.startedAt.getTime(), progress.startedAt.getTime());
    });

    // ---------- Consistency (55-61) ----------
    await run("55. exactly one XP resolution per enrollment (2 bounded raw queries)", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("cn55");
      const { version } = await createGraph({ levelCount: 3, requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      await prisma.$transaction(async (tx) => {
        let queryRaw = 0;
        const proxy = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === "$queryRaw") { queryRaw += 1; return (target as { $queryRaw: unknown }).$queryRaw; }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as unknown as Prisma.TransactionClient;
        asResolved(await resolve(user.id, proxy));
        assert.equal(queryRaw, 2);
      });
    });

    await run("56. XP query count is bounded regardless of level count", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("cn56");
      const { version } = await createGraph({ levelCount: 6, requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      await prisma.$transaction(async (tx) => {
        let queryRaw = 0;
        const proxy = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === "$queryRaw") { queryRaw += 1; return (target as { $queryRaw: unknown }).$queryRaw; }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as unknown as Prisma.TransactionClient;
        asResolved(await resolve(user.id, proxy));
        assert.equal(queryRaw, 2);
      });
    });

    await run("57. supplied transaction client is used without a nested transaction", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("cn57");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      await prisma.$transaction(async (tx) => {
        const proxy = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === "$transaction") return () => { throw new Error("nested transaction opened"); };
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as unknown as Prisma.TransactionClient;
        asResolved(await resolve(user.id, proxy));
      });
    });

    await run("58. read resolver performs no writes", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("cn58");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      const counts = async () => ({
        xp: await prisma.xPTransaction.count(),
        progress: await prisma.userLevelProgress.count(),
        audit: await prisma.auditLog.count(),
      });
      const before = await counts();
      asResolved(await resolve(user.id));
      assert.deepEqual(await counts(), before);
    });

    await run("59. read does not change audit or enrollment timestamps", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("cn59");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const e = await enroll({ userId: user.id, version });
      await seedXp(e.id, 10);
      const auditBefore = await prisma.auditLog.count();
      asResolved(await resolve(user.id));
      assert.equal(await prisma.auditLog.count(), auditBefore);
      const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: e.id } });
      assert.equal(after.lastMeaningfulActionAt, e.lastMeaningfulActionAt);
    });

    await run("60. repeated resolution is deterministic", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("cn60", { currentLevel: 1, xp: 40, requiredXp: { 1: 10, 3: 10 } });
      const first = asResolved(await resolve(user.id));
      const second = asResolved(await resolve(user.id));
      const shape = (r: Resolved) =>
        r.levels.map((l) => ({ n: l.levelDefinition.levelNumber, state: l.state, blockers: l.blockers }));
      assert.deepEqual(shape(first), shape(second));
    });

    await run("61. XP summary is available and not duplicated per level", async () => {
      setFlags({ read: true, xp: true });
      const { user } = await threeLevelEnrollment("cn61", { currentLevel: 1, xp: 55, requiredXp: { 1: 10 } });
      const result = asResolved(await resolve(user.id));
      assert.equal(result.xp.kind, "available");
      assert.equal(result.xp.kind === "available" && result.xp.totalXp, 55);
      for (const level of result.levels) {
        assert.equal("currentXp" in (level as object), false);
        assert.equal("totalXp" in (level as object), false);
      }
    });

    // ---------- Temporal cutoff hardening (62-81) ----------
    await run("62. XP created before asOf is counted", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm62");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const evaluationTime = new Date(transaction.createdAt.getTime() + 1);
      const result = asResolved(await resolve(user.id, undefined, evaluationTime));
      assert.equal(result.xp.kind === "available" && result.xp.totalXp, 10);
      assert.equal(findLevel(result, 1).state, "available");
    });

    await run("63. XP created exactly at asOf is counted", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm63");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const result = asResolved(
        await resolve(user.id, undefined, transaction.createdAt),
      );
      assert.equal(result.xp.kind === "available" && result.xp.totalXp, 10);
      assert.equal(findLevel(result, 1).state, "available");
    });

    await run("64. XP created after asOf is excluded", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm64");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const evaluationTime = new Date(transaction.createdAt.getTime() - 1);
      const result = asResolved(await resolve(user.id, undefined, evaluationTime));
      assert.equal(result.xp.kind === "available" && result.xp.totalXp, 0);
      assert.equal(findLevel(result, 1).state, "locked");
    });

    await run("65. rows on both sides of cutoff are summed correctly", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm65");
      const { version } = await createGraph({ requiredXp: { 1: 7 } });
      const enrollment = await enroll({ userId: user.id, version });
      await seedXp(enrollment.id, 3, "temporal-before-one");
      const atBoundary = await seedXp(enrollment.id, 4, "temporal-at-boundary");
      await new Promise((done) => setTimeout(done, 1_200));
      const afterBoundary = await seedXp(enrollment.id, 8, "temporal-after");
      assert.equal(afterBoundary.createdAt > atBoundary.createdAt, true);
      const result = asResolved(
        await resolve(user.id, undefined, atBoundary.createdAt),
      );
      assert.equal(result.xp.kind === "available" && result.xp.totalXp, 7);
      assert.equal(
        result.xp.kind === "available" && result.xp.transactionCount,
        2,
      );
    });

    await run("66. future XP does not make current level available", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm66");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const result = asResolved(
        await resolve(
          user.id,
          undefined,
          new Date(transaction.createdAt.getTime() - 1),
        ),
      );
      assert.equal(findLevel(result, 1).state, "locked");
      assert.deepEqual(findLevel(result, 1).blockers, ["xp_insufficient"]);
    });

    await run("67. future XP does not create xp_eligible", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm67");
      const graph = await createGraph({
        levelCount: 3,
        requiredXp: { 2: 1, 3: 10 },
      });
      const enrollment = await enroll({ userId: user.id, version: graph.version });
      const transaction = await seedXp(enrollment.id, 10);
      const result = asResolved(
        await resolve(
          user.id,
          undefined,
          new Date(transaction.createdAt.getTime() - 1),
        ),
      );
      assert.equal(findLevel(result, 3).state, "locked");
      assert.equal(result.levels.some((level) => level.state === "xp_eligible"), false);
    });

    await run("68. future XP cannot authorize start", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("tm68");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      await expectStartError("LEVEL_START_NOT_AVAILABLE", () =>
        levelState.startCurrentCurriculumLevel({
          actorUserId: user.id,
          asOf: new Date(transaction.createdAt.getTime() - 1),
          db: prisma,
        }),
      );
      assert.equal(
        await prisma.userLevelProgress.count({ where: { enrollmentId: enrollment.id } }),
        0,
      );
    });

    await run("69. start immediately before XP timestamp is blocked", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("tm69");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const auditBefore = await prisma.auditLog.count();
      await expectStartError("LEVEL_START_NOT_AVAILABLE", () =>
        levelState.startCurrentCurriculumLevel({
          actorUserId: user.id,
          asOf: new Date(transaction.createdAt.getTime() - 1),
          db: prisma,
        }),
      );
      assert.equal(await prisma.auditLog.count(), auditBefore);
      assert.equal(
        await prisma.userLevelProgress.count({ where: { enrollmentId: enrollment.id } }),
        0,
      );
    });

    await run("70. start exactly at XP timestamp is allowed", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("tm70");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const started = await levelState.startCurrentCurriculumLevel({
        actorUserId: user.id,
        asOf: transaction.createdAt,
        db: prisma,
      });
      assert.equal(started.created, true);
      assert.equal(started.progress.startedAt.getTime(), transaction.createdAt.getTime());
      assert.ok(started.progress.lastProgressAt);
      assert.equal(
        started.progress.lastProgressAt.getTime(),
        transaction.createdAt.getTime(),
      );
      assert.equal(
        started.enrollment.lastMeaningfulActionAt?.getTime(),
        transaction.createdAt.getTime(),
      );
    });

    await run("71. start after XP timestamp is allowed", async () => {
      setFlags({ read: true, enrollment: true, xp: true });
      const user = await createUser("tm71");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const evaluationTime = new Date(transaction.createdAt.getTime() + 1);
      const started = await levelState.startCurrentCurriculumLevel({
        actorUserId: user.id,
        asOf: evaluationTime,
        db: prisma,
      });
      assert.equal(started.created, true);
      assert.equal(started.progress.startedAt.getTime(), evaluationTime.getTime());
    });

    await run("72. default current-time resolution includes durable XP", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm72");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      await seedXp(enrollment.id, 10);
      const result = asResolved(await resolve(user.id));
      assert.equal(result.xp.kind === "available" && result.xp.totalXp, 10);
      assert.equal(findLevel(result, 1).state, "available");
    });

    await run("73. one evaluationTime reaches curriculum, XP, start and no API input", () => {
      const source = fs.readFileSync(
        path.join("src", "lib", "curriculum", "level-state.ts"),
        "utf8",
      );
      const within = source.slice(
        source.indexOf("async function resolveLevelStatesWithin"),
        source.indexOf("export async function resolveUserCurriculumLevelStates"),
      );
      assert.equal((within.match(/asOf: evaluationTime/g) ?? []).length, 2);

      const resolver = source.slice(
        source.indexOf("export async function resolveUserCurriculumLevelStates"),
        source.indexOf("export type LevelStartDomainErrorCode"),
      );
      assert.equal((resolver.match(/new Date\(\)/g) ?? []).length, 1);
      assert.match(resolver, /const evaluationTime = asOf \?\? new Date\(\);/);

      // ANCHOR ON THE DESTRUCTURED SIGNATURE, not the bare name. PHASE-1 ADMIN
      // added `startCurrentCurriculumLevelInTransaction`, and the old anchor was
      // a PREFIX of that name — so the slice silently swallowed both functions
      // and counted two clocks where the test meant to count one. The brace
      // disambiguates: only the public command destructures its input.
      const start = source.slice(
        source.indexOf("export async function startCurrentCurriculumLevel({"),
      );
      assert.equal((start.match(/new Date\(\)/g) ?? []).length, 1);

      // The in-transaction twin is pinned separately rather than folded into the
      // count above: it defaults its own clock exactly once, for the same reason
      // and in the same shape, and a second clock appearing inside it would be
      // the same defect this scenario exists to catch.
      const startInTx = source.slice(
        source.indexOf("export async function startCurrentCurriculumLevelInTransaction"),
        source.indexOf("export async function startCurrentCurriculumLevel({"),
      );
      assert.equal((startInTx.match(/new Date\(\)/g) ?? []).length, 1);
      assert.match(startInTx, /input\.asOf \?\? new Date\(\)/);
      // The intent is that ONE evaluationTime is threaded through — no second
      // clock and no API-supplied time. L2START-PLAYER-1 added a fourth
      // argument (`expectedStableCode`, a refusal guard), so the assertion pins
      // the clock argument's position rather than the whole argument list, which
      // would otherwise have to be rewritten for every unrelated parameter.
      assert.match(start, /runStartTransaction\(tx, actorUserId, evaluationTime[,)]/);
      assert.match(start, /recoverConcurrentStart\([\s\S]*evaluationTime/);

      const route = fs.readFileSync(
        path.join("src", "app", "api", "curriculum", "v2", "current", "route.ts"),
        "utf8",
      );
      // A6 replaced the "reject every query parameter" rule with a strict
      // allow-list, so the guarantee this check exists for — no API-supplied
      // clock, and nothing unrecognised silently accepted — is now asserted
      // against the allow-list instead. `shape` is the ONLY legal parameter,
      // and an unrecognised name still rejects.
      assert.match(route, /if \(key !== "shape"\) return null;/);
      assert.match(route, /const RESPONSE_SHAPES = \["full", "summary"\] as const;/);
      // Stronger than before: `asOf` may not appear in the route's CODE at all.
      // (Comments strip out first — the doc comment names `asOf` as an example
      // of a query the route rejects, which is the opposite of using it.)
      const routeCode = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.equal(routeCode.includes("asOf"), false);

      const xpSource = fs.readFileSync(
        path.join("src", "lib", "curriculum", "xp.ts"),
        "utf8",
      );
      const awardInput = xpSource.slice(
        xpSource.indexOf("export type RecordCurriculumXpInput"),
        xpSource.indexOf("export type RecordCurriculumXpInTransactionInput"),
      );
      assert.equal(awardInput.includes("createdAt:"), false);
    });

    await run("74. archived pin honors temporal XP cutoff", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm74");
      const { version } = await createGraph({
        status: "archived",
        requiredXp: { 1: 10 },
      });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const before = asResolved(
        await resolve(
          user.id,
          undefined,
          new Date(transaction.createdAt.getTime() - 1),
        ),
      );
      const at = asResolved(await resolve(user.id, undefined, transaction.createdAt));
      assert.equal(before.xp.kind === "available" && before.xp.totalXp, 0);
      assert.equal(at.xp.kind === "available" && at.xp.totalXp, 10);
    });

    await run("75. temporal resolution is deterministic", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm75");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const first = await resolve(user.id, undefined, transaction.createdAt);
      const second = await resolve(user.id, undefined, transaction.createdAt);
      assert.deepEqual(second, first);
    });

    await run("76. temporal resolution remains one XP read with bounded queries", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm76");
      const { version } = await createGraph({
        levelCount: 6,
        requiredXp: { 1: 10 },
      });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      await prisma.$transaction(async (tx) => {
        let queryRaw = 0;
        const proxy = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === "$queryRaw") {
              queryRaw += 1;
              return (target as { $queryRaw: unknown }).$queryRaw;
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as unknown as Prisma.TransactionClient;
        asResolved(await resolve(user.id, proxy, transaction.createdAt));
        assert.equal(queryRaw, 2);
      });
    });

    await run("77. top-level resolver owns exactly one snapshot transaction", () => {
      const source = fs.readFileSync(
        path.join("src", "lib", "curriculum", "level-state.ts"),
        "utf8",
      );
      const resolver = source.slice(
        source.indexOf("export async function resolveUserCurriculumLevelStates"),
        source.indexOf("export type LevelStartDomainErrorCode"),
      );
      assert.equal((resolver.match(/prisma\.\$transaction\(/g) ?? []).length, 1);
      assert.match(
        resolver,
        /resolveLevelStatesWithin\(tx, userId, evaluationTime\)/,
      );
    });

    await run("78. temporal read performs no writes", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm78");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      const snapshot = async () => ({
        xp: await prisma.xPTransaction.count(),
        progress: await prisma.userLevelProgress.count(),
        audit: await prisma.auditLog.count(),
        enrollment: await prisma.userCurriculumEnrollment.findUniqueOrThrow({
          where: { id: enrollment.id },
        }),
      });
      const before = await snapshot();
      asResolved(await resolve(user.id, undefined, transaction.createdAt));
      assert.deepEqual(await snapshot(), before);
    });

    await run("79. V1 XP is ignored at a temporal cutoff", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm79", { xp: 999_999 });
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      await enroll({ userId: user.id, version });
      await prisma.xpEvent.create({
        data: {
          userId: user.id,
          amount: 999_999,
          source: "legacy",
          sourceId: "temporal-legacy",
        },
      });
      const result = asResolved(await resolve(user.id, undefined, new Date()));
      assert.equal(result.xp.kind === "available" && result.xp.totalXp, 0);
      assert.equal(findLevel(result, 1).state, "locked");
    });

    await run("80. corrupt diagnostics do not leak temporal values", async () => {
      setFlags({ read: true, xp: true });
      const user = await createUser("tm80");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const transaction = await seedXp(enrollment.id, 10);
      await prisma.$executeRawUnsafe(
        `UPDATE "XPTransaction" SET "payloadFingerprint" = 'sha256:${"0".repeat(64)}' WHERE "id" = ${transaction.id}`,
      );
      const result = await resolve(user.id, undefined, transaction.createdAt);
      assert.equal(result.kind, "corrupt");
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(transaction.createdAt.toISOString()), false);
      assert.equal(serialized.includes("createdAt"), false);
      assert.equal(serialized.includes("asOf"), false);
      assert.equal(serialized.includes("payloadFingerprint"), false);
    });

    await run("81. Phase 2 flag-off behaviour is unchanged at a cutoff", async () => {
      setFlags({ read: true, enrollment: true, xp: false });
      const user = await createUser("tm81");
      const { version } = await createGraph({ requiredXp: { 1: 10 } });
      const enrollment = await enroll({ userId: user.id, version });
      const evaluationTime = new Date(AS_OF.getTime() + 60_000);
      const result = asResolved(await resolve(user.id, undefined, evaluationTime));
      assert.deepEqual(findLevel(result, 1).blockers, ["xp_engine_unavailable"]);
      const before = {
        progress: await prisma.userLevelProgress.count(),
        audit: await prisma.auditLog.count(),
      };
      await expectStartError("LEVEL_START_NOT_AVAILABLE", () =>
        levelState.startCurrentCurriculumLevel({
          actorUserId: user.id,
          asOf: evaluationTime,
          db: prisma,
        }),
      );
      assert.deepEqual(
        {
          progress: await prisma.userLevelProgress.count(),
          audit: await prisma.auditLog.count(),
        },
        before,
      );
      assert.equal(
        await prisma.userLevelProgress.count({ where: { enrollmentId: enrollment.id } }),
        0,
      );
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    setFlags({});
  }
}

main()
  .then(() => {
    console.log(`\ncurriculum xp level state regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum xp level state regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
