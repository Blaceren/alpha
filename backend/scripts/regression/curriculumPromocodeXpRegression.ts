import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient, type CurriculumVersionStatus } from "@prisma/client";

const dbPath = `/tmp/ata-curriculum-promocode-xp-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;
const migrationName = "20260714030000_promocode_redemption_idempotency";
const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");
const evaluationTime = new Date("2026-07-14T12:00:00.000Z");
const port = 3960 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "PromocodeRegression123!";

let passed = 0;
let failed = 0;
let sequence = 0;

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

function migrationNames() {
  return fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function splitSql(sql: string) {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

async function applyMigration(prisma: PrismaClient, name: string) {
  const sql = fs.readFileSync(path.join(migrationsRoot, name, "migration.sql"), "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  const id = crypto.randomUUID();
  const statements = splitSql(sql);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "applied_steps_count") VALUES (?, ?, ?, ?)',
      id,
      checksum,
      name,
      0,
    );
    for (const statement of statements) await tx.$executeRawUnsafe(statement);
    await tx.$executeRawUnsafe(
      'UPDATE "_prisma_migrations" SET "finished_at"=CURRENT_TIMESTAMP, "applied_steps_count"=? WHERE "id"=?',
      statements.length,
      id,
    );
  });
}

type Flags = { read: boolean; enrollment: boolean; xp: boolean };
function setFlags(flags: Flags) {
  process.env.CURRICULUM_V2_READ_ENABLED = String(flags.read);
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = String(flags.enrollment);
  process.env.CURRICULUM_V2_XP_ENABLED = String(flags.xp);
}

const allV2On: Flags = { read: true, enrollment: true, xp: true };
const allV2Off: Flags = { read: false, enrollment: false, xp: false };

type HttpResult = {
  status: number;
  json: unknown;
  text: string;
  headers: Headers;
};

class HttpClient {
  private cookies = new Map<string, string>();

  private cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private store(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  async request(
    method: string,
    route: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<HttpResult> {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    this.store(response);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, headers: response.headers };
  }

  get(route: string) {
    return this.request("GET", route);
  }

  login(email: string) {
    return this.request("POST", "/api/auth/login", {
      body: { email, password, captchaToken: "dev-captcha-ok" },
    });
  }

  async csrfToken() {
    const response = await this.get("/api/csrf");
    const token = (response.json as { csrfToken?: string })?.csrfToken;
    assert.equal(typeof token, "string");
    return token!;
  }
}

async function startServer(): Promise<ChildProcess> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: dbUrl,
    SESSION_SECRET: "promocode-regression-session-secret",
    POSTBACK_SECRET: "promocode-regression-postback-secret",
    APP_URL: baseUrl,
    STORAGE_DRIVER: "local",
    POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
    EMAIL_VERIFICATION_REQUIRED: "false",
    CAPTCHA_DEV_BYPASS: "true",
    CURRICULUM_V2_READ_ENABLED: "false",
    CURRICULUM_V2_ENROLLMENT_ENABLED: "false",
    CURRICULUM_V2_XP_ENABLED: "false",
  };
  Object.assign(env, { NODE_ENV: undefined });
  const options: SpawnOptions = {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  };
  const processHandle = spawn(
    "npx",
    ["next", "dev", "--turbopack", "-p", String(port)],
    options,
  );
  processHandle.stdout?.on("data", () => {});
  processHandle.stderr?.on("data", () => {});
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return processHandle;
    } catch {
      // Poll until ready.
    }
    if (Date.now() > deadline) throw new Error("promocode regression server did not start");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function stopServer(processHandle: ChildProcess | null) {
  if (!processHandle?.pid) return;
  try {
    process.kill(-processHandle.pid, "SIGTERM");
  } catch {
    // Already stopped.
  }
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      break;
    }
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try {
    process.kill(-processHandle.pid, "SIGKILL");
  } catch {
    // Already stopped.
  }
}

async function main() {
  cleanupDb();
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  let server: ChildProcess | null = null;
  let cleanupCompleted = false;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  const names = migrationNames();
  const migrationIndex = names.indexOf(migrationName);
  assert.notEqual(migrationIndex, -1);
  for (const name of names.slice(0, migrationIndex)) await applyMigration(prisma, name);

  const preservedUser = await prisma.user.create({
    data: { email: "preserved@example.com", name: "Preserved", xp: 40 },
  });
  const preservedPromo = await prisma.promocode.create({
    data: {
      code: "PRESERVED",
      type: "xp_bonus",
      value: { xp: 10 },
      maxUses: 5,
      perUserLimit: 2,
      usedCount: 1,
    },
  });
  const preservedRedemption = await prisma.promocodeRedemption.create({
    data: { userId: preservedUser.id, promocodeId: preservedPromo.id },
  });
  const preservedXpEvent = await prisma.xpEvent.create({
    data: {
      userId: preservedUser.id,
      amount: 10,
      source: "promocode",
      sourceId: String(preservedPromo.id),
    },
  });
  const preservedSnapshot = {
    user: await prisma.user.findUniqueOrThrow({ where: { id: preservedUser.id } }),
    promo: await prisma.promocode.findUniqueOrThrow({ where: { id: preservedPromo.id } }),
    redemption: await prisma.promocodeRedemption.findUniqueOrThrow({
      where: { id: preservedRedemption.id },
    }),
    xpEvent: await prisma.xpEvent.findUniqueOrThrow({ where: { id: preservedXpEvent.id } }),
  };

  await applyMigration(prisma, migrationName);

  // Migration (1-6)
  await check("additive idempotency migration applies", async () => {
    const table = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='PromocodeRedemptionRequest'",
    );
    assert.equal(table.length, 1);
  });
  await check("populated V1 schema and rows are preserved", async () => {
    assert.deepEqual(
      await prisma.user.findUniqueOrThrow({ where: { id: preservedUser.id } }),
      preservedSnapshot.user,
    );
    assert.deepEqual(
      await prisma.promocode.findUniqueOrThrow({ where: { id: preservedPromo.id } }),
      preservedSnapshot.promo,
    );
    assert.deepEqual(
      await prisma.promocodeRedemption.findUniqueOrThrow({ where: { id: preservedRedemption.id } }),
      preservedSnapshot.redemption,
    );
    assert.deepEqual(
      await prisma.xpEvent.findUniqueOrThrow({ where: { id: preservedXpEvent.id } }),
      preservedSnapshot.xpEvent,
    );
  });
  await check("new request table is empty after upgrade", async () => {
    assert.equal(await prisma.promocodeRedemptionRequest.count(), 0);
  });
  await check("real migration runner applies later additive migrations then is idempotent", async () => {
    const before = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT COUNT(*) AS count FROM "_prisma_migrations"',
    );
    const runner = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
      env: { ...process.env, DATABASE_URL: dbUrl },
      encoding: "utf8",
    });
    assert.equal(runner.status, 0, `${runner.stdout}\n${runner.stderr}`);
    const afterFirst = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT COUNT(*) AS count FROM "_prisma_migrations"',
    );
    assert.equal(Number(afterFirst[0].count) >= Number(before[0].count), true);
    const secondRunner = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
      env: { ...process.env, DATABASE_URL: dbUrl },
      encoding: "utf8",
    });
    assert.equal(secondRunner.status, 0, `${secondRunner.stdout}\n${secondRunner.stderr}`);
    const afterSecond = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT COUNT(*) AS count FROM "_prisma_migrations"',
    );
    assert.equal(Number(afterSecond[0].count), Number(afterFirst[0].count));
    const phase4Rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "AssessmentAttempt"',
    );
    assert.equal(Number(phase4Rows[0].count), 0);
  });
  await check("forbidden promocode-user unique index is absent", async () => {
    const indexes = await prisma.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='PromocodeRedemption'",
    );
    assert.equal(
      indexes.some((index) =>
        /UNIQUE[\s\S]*\("promocodeId",\s*"userId"\)/i.test(index.sql ?? ""),
      ),
      false,
    );
  });
  await check("perUserLimit greater than one remains representable", async () => {
    const second = await prisma.promocodeRedemption.create({
      data: { userId: preservedUser.id, promocodeId: preservedPromo.id },
    });
    assert.equal(
      await prisma.promocodeRedemption.count({
        where: { userId: preservedUser.id, promocodeId: preservedPromo.id },
      }),
      2,
    );
    await prisma.promocodeRedemption.delete({ where: { id: second.id } });
  });

  const redemption = await import("../../src/lib/promocodes/redemption");

  async function reset() {
    for (const trigger of ["fail_promocode_xp", "fail_promocode_xp_audit"]) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
    await prisma.promocodeRedemptionRequest.deleteMany();
    await prisma.xPTransaction.deleteMany();
    await prisma.promocodeRedemption.deleteMany();
    await prisma.promocode.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.userAchievement.deleteMany();
    await prisma.userReward.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.xpEvent.deleteMany();
    await prisma.user.deleteMany();
    setFlags(allV2Off);
  }

  async function createUser(label: string, input: { status?: "active" | "blocked"; xp?: number; password?: boolean } = {}) {
    sequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${sequence}@example.com`,
        name: label,
        status: input.status ?? "active",
        xp: input.xp ?? 0,
        passwordHash: input.password ? await bcrypt.hash(password, 10) : "",
      },
    });
  }

  async function createPromo(
    code: string,
    input: {
      xp?: number;
      maxUses?: number | null;
      perUserLimit?: number;
      isActive?: boolean;
      startsAt?: Date | null;
      expiresAt?: Date | null;
      usedCount?: number;
    } = {},
  ) {
    return prisma.promocode.create({
      data: {
        code,
        type: "xp_bonus",
        value: { xp: input.xp ?? 25 },
        maxUses: input.maxUses === undefined ? null : input.maxUses,
        perUserLimit: input.perUserLimit ?? 1,
        isActive: input.isActive ?? true,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        usedCount: input.usedCount ?? 0,
      },
    });
  }

  function requestId(label: string) {
    sequence += 1;
    return `${label}-${process.pid}-${sequence}`;
  }

  async function redeem(userId: number, code: string, id = requestId("request")) {
    return redemption.redeemPromocode({
      userId,
      code,
      requestId: id,
      evaluationTime,
      db: prisma,
    });
  }

  async function expectError(
    code: string,
    fn: () => Promise<unknown>,
  ) {
    await assert.rejects(fn, (error: unknown) => {
      assert.equal(redemption.isPromocodeRedemptionError(error), true);
      assert.equal((error as { code: string }).code, code);
      return true;
    });
  }

  async function createGraph(status: CurriculumVersionStatus = "published", code = "ata-v2") {
    sequence += 1;
    const version = await prisma.curriculumVersion.create({
      data: {
        code,
        name: `${code}-${sequence}`,
        versionNumber: sequence,
        status,
        publishedAt: status === "draft" ? null : evaluationTime,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m-${version.id}`,
        title: "Promocode module",
        firstLevel: 1,
        lastLevel: 1,
      },
    });
    const level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleId: moduleDefinition.id,
        levelNumber: 1,
        stableCode: `v2.l001.promo-${version.id}`,
        type: "lesson",
        title: "Promocode level",
        completionMethod: "lesson",
      },
    });
    return { version, moduleDefinition, level };
  }

  async function enroll(
    userId: number,
    versionId: number,
    status: "active" | "completed" = "active",
  ) {
    const version = await prisma.curriculumVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status,
        enrolledAt: evaluationTime,
        completedAt: status === "completed" ? evaluationTime : null,
      },
    });
  }

  async function setupLegacy(input: { maxUses?: number | null; perUserLimit?: number; xp?: number } = {}) {
    await reset();
    const user = await createUser("legacy");
    const promo = await createPromo("LEGACY", input);
    const id = requestId("legacy");
    const result = await redeem(user.id, promo.code, id);
    return { user, promo, id, result };
  }

  // Legacy success (7-13)
  const legacy = await setupLegacy({ xp: 30 });
  await check("valid V1-only redemption succeeds", () => {
    assert.equal(legacy.result.created, true);
    assert.equal(legacy.result.v2XpTransactionId, null);
  });
  await check("V1 User.xp increments by reward", async () => {
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: legacy.user.id } })).xp, 30);
  });
  await check("one V1 XpEvent is created", async () => {
    assert.equal(await prisma.xpEvent.count({ where: { userId: legacy.user.id } }), 1);
  });
  await check("one PromocodeRedemption is created", async () => {
    assert.equal(await prisma.promocodeRedemption.count(), 1);
  });
  await check("usedCount increments once", async () => {
    assert.equal((await prisma.promocode.findUniqueOrThrow({ where: { id: legacy.promo.id } })).usedCount, 1);
  });
  await check("durable request result is stored", async () => {
    const stored = await prisma.promocodeRedemptionRequest.findUniqueOrThrow({
      where: { userId_requestId: { userId: legacy.user.id, requestId: legacy.id } },
    });
    assert.equal(stored.redemptionId, legacy.result.redemptionId);
  });
  await check("response returns durable reward snapshot", () => {
    assert.equal(legacy.result.xpAwarded, 30);
  });

  // Validation (14-21)
  await check("invalid code is typed", async () => {
    await expectError("PROMOCODE_NOT_FOUND", () => redeem(legacy.user.id, "MISSING"));
  });
  await check("inactive promocode is typed", async () => {
    await reset();
    const user = await createUser("inactive");
    await createPromo("INACTIVE", { isActive: false });
    await expectError("PROMOCODE_INACTIVE", () => redeem(user.id, "INACTIVE"));
  });
  await check("expired promocode is typed", async () => {
    await reset();
    const user = await createUser("expired");
    await createPromo("EXPIRED", { expiresAt: new Date(evaluationTime.getTime() - 1) });
    await expectError("PROMOCODE_EXPIRED", () => redeem(user.id, "EXPIRED"));
  });
  await check("maxUses reached is typed", async () => {
    await reset();
    const user = await createUser("max");
    const promo = await createPromo("MAXED", { maxUses: 1 });
    await prisma.promocodeRedemption.create({ data: { userId: user.id, promocodeId: promo.id } });
    await prisma.promocode.update({ where: { id: promo.id }, data: { usedCount: 1 } });
    await expectError("PROMOCODE_MAX_USES_REACHED", () => redeem(user.id, "MAXED"));
  });
  await check("per-user limit reached is typed", async () => {
    const fixture = await setupLegacy();
    await expectError("PROMOCODE_USER_LIMIT_REACHED", () => redeem(fixture.user.id, fixture.promo.code));
  });
  await check("blocked user is rejected by domain defense", async () => {
    await reset();
    const user = await createUser("blocked", { status: "blocked" });
    await createPromo("BLOCKED");
    await expectError("PROMOCODE_INPUT_INVALID", () => redeem(user.id, "BLOCKED"));
  });
  await check("invalid request key is typed", async () => {
    await reset();
    const user = await createUser("bad-key");
    await createPromo("BADKEY");
    await expectError("PROMOCODE_INPUT_INVALID", () => redeem(user.id, "BADKEY", "bad key"));
  });
  await check("same key with a different promo conflicts", async () => {
    await reset();
    const user = await createUser("collision");
    await createPromo("COLLIDE1", { perUserLimit: 2 });
    await createPromo("COLLIDE2", { perUserLimit: 2 });
    const id = requestId("collision");
    await redeem(user.id, "COLLIDE1", id);
    await expectError("PROMOCODE_IDEMPOTENCY_CONFLICT", () => redeem(user.id, "COLLIDE2", id));
  });

  // Idempotency (22-29)
  const retryFixture = await setupLegacy({ xp: 19 });
  const retryBefore = {
    promo: await prisma.promocode.findUniqueOrThrow({ where: { id: retryFixture.promo.id } }),
    user: await prisma.user.findUniqueOrThrow({ where: { id: retryFixture.user.id } }),
    events: await prisma.xpEvent.findMany(),
    redemptions: await prisma.promocodeRedemption.findMany(),
    requests: await prisma.promocodeRedemptionRequest.findMany(),
    audits: await prisma.auditLog.count(),
    notifications: await prisma.notification.count(),
  };
  const retried = await redeem(retryFixture.user.id, retryFixture.promo.code, retryFixture.id);
  await check("exact retry returns created=false", () => assert.equal(retried.created, false));
  await check("exact retry does not change usedCount", async () => {
    assert.equal(
      (await prisma.promocode.findUniqueOrThrow({ where: { id: retryFixture.promo.id } })).usedCount,
      retryBefore.promo.usedCount,
    );
  });
  await check("exact retry does not change User.xp", async () => {
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: retryFixture.user.id } })).xp,
      retryBefore.user.xp,
    );
  });
  await check("exact retry does not duplicate XpEvent", async () => {
    assert.deepEqual(await prisma.xpEvent.findMany(), retryBefore.events);
  });
  await check("exact retry does not duplicate Redemption", async () => {
    assert.deepEqual(await prisma.promocodeRedemption.findMany(), retryBefore.redemptions);
  });
  await check("exact retry does not duplicate audit or notification", async () => {
    assert.equal(await prisma.auditLog.count(), retryBefore.audits);
    assert.equal(await prisma.notification.count(), retryBefore.notifications);
    assert.deepEqual(await prisma.promocodeRedemptionRequest.findMany(), retryBefore.requests);
  });
  await check("flags enabled after V1-only success do not backfill V2", async () => {
    setFlags(allV2On);
    await redeem(retryFixture.user.id, retryFixture.promo.code, retryFixture.id);
    assert.equal(await prisma.xPTransaction.count(), 0);
  });
  await check("parallel same-key requests converge on one durable result", async () => {
    await reset();
    const user = await createUser("same-key");
    await createPromo("SAMEKEY", { perUserLimit: 3 });
    const id = requestId("same-key");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => redeem(user.id, "SAMEKEY", id)),
    );
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(new Set(results.map((result) => result.redemptionId)).size, 1);
    assert.equal(await prisma.promocodeRedemption.count(), 1);
    assert.equal(await prisma.xpEvent.count(), 1);
  });

  // Concurrency (30-38)
  await check("perUserLimit=1 permits one parallel operation", async () => {
    await reset();
    const user = await createUser("limit-one");
    await createPromo("LIMITONE", { perUserLimit: 1 });
    const settled = await Promise.allSettled(
      Array.from({ length: 4 }, () => redeem(user.id, "LIMITONE")),
    );
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(await prisma.promocodeRedemption.count(), 1);
  });
  await check("perUserLimit=2 permits exactly two parallel operations", async () => {
    await reset();
    const user = await createUser("limit-two");
    await createPromo("LIMITTWO", { perUserLimit: 2 });
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => redeem(user.id, "LIMITTWO")),
    );
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 2);
    assert.equal(await prisma.promocodeRedemption.count(), 2);
  });
  await check("third distinct operation is rejected after limit two", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { name: "limit-two" } });
    await expectError("PROMOCODE_USER_LIMIT_REACHED", () => redeem(user.id, "LIMITTWO"));
  });
  await check("maxUses is atomic across different users", async () => {
    await reset();
    await createPromo("GLOBALMAX", { maxUses: 2, perUserLimit: 2 });
    const users = await Promise.all(
      Array.from({ length: 5 }, (_, index) => createUser(`global-${index}`)),
    );
    const settled = await Promise.allSettled(
      users.map((user) => redeem(user.id, "GLOBALMAX")),
    );
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 2);
  });
  await check("usedCount never exceeds maxUses", async () => {
    const promo = await prisma.promocode.findUniqueOrThrow({ where: { code: "GLOBALMAX" } });
    assert.equal(promo.usedCount, 2);
    assert.equal(promo.usedCount <= (promo.maxUses ?? Number.MAX_SAFE_INTEGER), true);
    assert.equal(await prisma.promocodeRedemption.count({ where: { promocodeId: promo.id } }), 2);
  });
  await check("transaction rollback restores counter and all V1 rows", async () => {
    await reset();
    const user = await createUser("rollback");
    const promo = await createPromo("ROLLBACK", { maxUses: 1 });
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_promocode_xp BEFORE INSERT ON "XpEvent" BEGIN SELECT RAISE(ABORT, 'forced xp failure'); END`,
    );
    await expectError("PROMOCODE_INTERNAL_ERROR", () => redeem(user.id, promo.code));
    await prisma.$executeRawUnsafe("DROP TRIGGER fail_promocode_xp");
    assert.equal((await prisma.promocode.findUniqueOrThrow({ where: { id: promo.id } })).usedCount, 0);
    assert.equal(await prisma.promocodeRedemption.count(), 0);
    assert.equal(await prisma.xpEvent.count(), 0);
    assert.equal(await prisma.promocodeRedemptionRequest.count(), 0);
  });
  await check("expected SQLITE_BUSY retries the whole transaction", async () => {
    await reset();
    const user = await createUser("busy-retry");
    await createPromo("BUSYRETRY");
    let attempts = 0;
    const retryDb = {
      async $transaction(
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: { maxWait?: number; timeout?: number },
      ) {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error("database is locked"), { code: "P2028" });
        return prisma.$transaction(callback, options);
      },
    } as unknown as PrismaClient;
    const result = await redemption.redeemPromocode({
      userId: user.id,
      code: "BUSYRETRY",
      requestId: requestId("busy"),
      evaluationTime,
      db: retryDb,
      retryPolicy: { sleep: async () => {} },
    });
    assert.equal(result.created, true);
    assert.equal(attempts, 3);
  });
  await check("SQLITE_BUSY retry exhaustion is typed and bounded", async () => {
    let attempts = 0;
    const lockedDb = {
      async $transaction() {
        attempts += 1;
        throw Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "P2028" });
      },
    } as unknown as PrismaClient;
    await expectError("PROMOCODE_CONCURRENCY_RETRY_EXHAUSTED", () =>
      redemption.redeemPromocode({
        userId: 1,
        code: "LOCKED",
        requestId: requestId("locked"),
        db: lockedDb,
        retryPolicy: { maxAttempts: 3, sleep: async () => {} },
      }),
    );
    assert.equal(attempts, 3);
  });
  await check("unknown database error is not retried or treated as success", async () => {
    let attempts = 0;
    const brokenDb = {
      async $transaction() {
        attempts += 1;
        throw Object.assign(new Error("unexpected query failure"), { code: "P2010" });
      },
    } as unknown as PrismaClient;
    await expectError("PROMOCODE_INTERNAL_ERROR", () =>
      redemption.redeemPromocode({
        userId: 1,
        code: "BROKEN",
        requestId: requestId("broken"),
        db: brokenDb,
        retryPolicy: { maxAttempts: 4, sleep: async () => {} },
      }),
    );
    assert.equal(attempts, 1);
  });

  async function setupV2(status: CurriculumVersionStatus = "published") {
    await reset();
    setFlags(allV2On);
    const user = await createUser("v2", { xp: 100 });
    const graph = await createGraph(status);
    const enrollment = await enroll(user.id, graph.version.id);
    const promo = await createPromo("V2PROMO", { xp: 35, perUserLimit: 2 });
    const id = requestId("v2");
    return { user, graph, enrollment, promo, id };
  }

  // V2 (39-56)
  const activeV2 = await setupV2("published");
  const activeV2Result = await redeem(activeV2.user.id, activeV2.promo.code, activeV2.id);
  await check("all V2 flags plus active published enrollment dual-write", () => {
    assert.equal(activeV2Result.v2XpTransactionId !== null, true);
  });
  await check("archived pin dual-writes into the pinned enrollment", async () => {
    const fixture = await setupV2("archived");
    const result = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    const row = await prisma.xPTransaction.findUniqueOrThrow({ where: { id: result.v2XpTransactionId! } });
    assert.equal(row.enrollmentId, fixture.enrollment.id);
  });
  await check("new published version does not repin an archived enrollment", async () => {
    const fixture = await setupV2("published");
    await prisma.curriculumVersion.update({
      where: { id: fixture.graph.version.id },
      data: { status: "archived" },
    });
    const newer = await createGraph("published", fixture.graph.version.code);
    const result = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    const row = await prisma.xPTransaction.findUniqueOrThrow({ where: { id: result.v2XpTransactionId! } });
    assert.equal(row.enrollmentId, fixture.enrollment.id);
    assert.notEqual(row.curriculumVersionId, newer.version.id);
  });
  await check("all V2 flags off remains V1-only", async () => {
    const fixture = await setupV2();
    setFlags(allV2Off);
    const result = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    assert.equal(result.v2XpTransactionId, null);
  });
  await check("partial V2 flag matrix remains V1-only", async () => {
    const fixture = await setupV2();
    setFlags({ read: true, enrollment: false, xp: true });
    const result = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    assert.equal(result.v2XpTransactionId, null);
  });
  await check("candidate without enrollment remains V1-only", async () => {
    await reset();
    setFlags(allV2On);
    const user = await createUser("candidate");
    await createGraph("published");
    await createPromo("CANDIDATE");
    const result = await redeem(user.id, "CANDIDATE");
    assert.equal(result.v2XpTransactionId, null);
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
  });
  await check("completed history remains V1-only", async () => {
    await reset();
    setFlags(allV2On);
    const user = await createUser("completed");
    const graph = await createGraph("published");
    await enroll(user.id, graph.version.id, "completed");
    await createPromo("COMPLETED");
    const result = await redeem(user.id, "COMPLETED");
    assert.equal(result.v2XpTransactionId, null);
  });
  await check("corrupt enabled V2 state rolls back full redemption", async () => {
    const fixture = await setupV2();
    await prisma.curriculumVersion.update({
      where: { id: fixture.graph.version.id },
      data: { status: "draft" },
    });
    await expectError("PROMOCODE_V2_STATE_CORRUPT", () =>
      redeem(fixture.user.id, fixture.promo.code, fixture.id),
    );
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: fixture.user.id } })).xp, 100);
    assert.equal((await prisma.promocode.findUniqueOrThrow({ where: { id: fixture.promo.id } })).usedCount, 0);
    assert.equal(await prisma.promocodeRedemption.count(), 0);
  });

  const v2Contract = await setupV2();
  const v2ContractResult = await redeem(v2Contract.user.id, v2Contract.promo.code, v2Contract.id);
  const v2Row = await prisma.xPTransaction.findUniqueOrThrow({
    where: { id: v2ContractResult.v2XpTransactionId! },
  });
  await check("V2 amount equals validated promo reward", () => assert.equal(v2Row.amount, 35));
  await check("V2 source is promocode", () => assert.equal(v2Row.sourceType, "promocode"));
  await check("V2 sourceId is durable redemption ID", () => {
    assert.equal(v2Row.sourceId, String(v2ContractResult.redemptionId));
  });
  await check("V2 promocode row has no level", () => assert.equal(v2Row.levelDefinitionId, null));
  await check("one V2 XP row is created", async () => assert.equal(await prisma.xPTransaction.count(), 1));
  await check("one transactional XP audit is created", async () => {
    assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_XP_AWARDED" } }), 1);
  });
  await check("V2 audit failure rolls back V1 and V2", async () => {
    const fixture = await setupV2();
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_promocode_xp_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action"='CURRICULUM_XP_AWARDED' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    );
    await expectError("PROMOCODE_INTERNAL_ERROR", () =>
      redeem(fixture.user.id, fixture.promo.code, fixture.id),
    );
    await prisma.$executeRawUnsafe("DROP TRIGGER fail_promocode_xp_audit");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: fixture.user.id } })).xp, 100);
    assert.equal(await prisma.xPTransaction.count(), 0);
    assert.equal(await prisma.promocodeRedemption.count(), 0);
    assert.equal(await prisma.promocodeRedemptionRequest.count(), 0);
  });
  await check("exact dual-write retry does not duplicate XP", async () => {
    const fixture = await setupV2();
    const first = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    const second = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    assert.equal(second.created, false);
    assert.equal(second.v2XpTransactionId, first.v2XpTransactionId);
    assert.equal(await prisma.xPTransaction.count(), 1);
  });
  await check("dual-write retry verifies original result after flags turn off", async () => {
    const fixture = await setupV2();
    const first = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    setFlags(allV2Off);
    const second = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    assert.equal(second.created, false);
    assert.equal(second.v2XpTransactionId, first.v2XpTransactionId);
  });
  await check("V1 User.xp and V2 ledger remain separate authorities", async () => {
    const fixture = await setupV2();
    const result = await redeem(fixture.user.id, fixture.promo.code, fixture.id);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.user.id } });
    const ledger = await prisma.xPTransaction.aggregate({ _sum: { amount: true } });
    assert.equal(user.xp, 135);
    assert.equal(ledger._sum.amount, result.xpAwarded);
  });

  // HTTP and security (57-66)
  await reset();
  const httpUser = await createUser("http-user", { password: true });
  const blockedUser = await createUser("http-blocked", { password: true });
  const rateUser = await createUser("http-rate", { password: true });
  const strictUser = await createUser("http-strict", { password: true });
  const legacyHttpUser = await createUser("http-legacy", { password: true });
  const corruptHttpUser = await createUser("http-corrupt", { password: true });
  await createPromo("HTTPPROMO", { perUserLimit: 2 });
  await createPromo("LEGACYHTTP");
  const corruptPromo = await createPromo("CORRUPTHTTP", { usedCount: 1 });
  server = await startServer();

  await check("anonymous redemption is 401 before CSRF", async () => {
    const result = await new HttpClient().request("POST", "/api/promocodes/redeem", {
      body: { code: "HTTPPROMO" },
    });
    assert.equal(result.status, 401);
  });
  await check("blocked user is 403 before request validation", async () => {
    const client = new HttpClient();
    assert.equal((await client.login(blockedUser.email)).status, 200);
    const csrf = await client.csrfToken();
    await prisma.user.update({ where: { id: blockedUser.id }, data: { status: "blocked" } });
    const result = await client.request("POST", "/api/promocodes/redeem", {
      body: { code: "HTTPPROMO", injected: true },
      headers: { "x-csrf-token": csrf, "Idempotency-Key": "blocked-http-request" },
    });
    assert.equal(result.status, 403);
  });
  await check("authenticated request without CSRF is 403", async () => {
    const client = new HttpClient();
    assert.equal((await client.login(httpUser.email)).status, 200);
    const result = await client.request("POST", "/api/promocodes/redeem", {
      body: { code: "HTTPPROMO" },
      headers: { "Idempotency-Key": "csrf-http-request" },
    });
    assert.equal(result.status, 403);
  });
  await check("rate limit runs before CSRF and returns 429", async () => {
    const client = new HttpClient();
    assert.equal((await client.login(rateUser.email)).status, 200);
    let result: HttpResult | null = null;
    for (let index = 0; index < 11; index += 1) {
      result = await client.request("POST", "/api/promocodes/redeem", {
        body: { code: "HTTPPROMO" },
        headers: { "Idempotency-Key": `rate-http-${String(index).padStart(2, "0")}` },
      });
    }
    assert.equal(result?.status, 429);
  });
  await check("strict body rejects extra fields", async () => {
    const client = new HttpClient();
    assert.equal((await client.login(strictUser.email)).status, 200);
    const csrf = await client.csrfToken();
    const result = await client.request("POST", "/api/promocodes/redeem", {
      body: { code: "HTTPPROMO", extra: true },
      headers: { "x-csrf-token": csrf, "Idempotency-Key": "strict-http-request" },
    });
    assert.equal(result.status, 400);
  });
  await check("body cannot inject user amount enrollment or version", async () => {
    const client = new HttpClient();
    assert.equal((await client.login(strictUser.email)).status, 200);
    const csrf = await client.csrfToken();
    const result = await client.request("POST", "/api/promocodes/redeem", {
      body: { code: "HTTPPROMO", userId: 999, amount: 999, enrollmentId: 999, versionId: 999 },
      headers: { "x-csrf-token": csrf, "Idempotency-Key": "inject-http-request" },
    });
    assert.equal(result.status, 400);
  });
  await check("first-party callers send stable Idempotency-Key", () => {
    for (const file of ["src/app/achievements/page.tsx", "src/app/profile/page.tsx"]) {
      const source = fs.readFileSync(file, "utf8");
      assert.match(source, /Idempotency-Key/);
      assert.match(source, /crypto\.randomUUID\(\)/);
      assert.match(source, /redeemAttempt/);
    }
  });
  await check("legacy missing-key request is compatible and returns generated key", async () => {
    const client = new HttpClient();
    assert.equal((await client.login(legacyHttpUser.email)).status, 200);
    const csrf = await client.csrfToken();
    const result = await client.request("POST", "/api/promocodes/redeem", {
      body: { code: "LEGACYHTTP" },
      headers: { "x-csrf-token": csrf },
    });
    assert.equal(result.status, 200, result.text);
    const body = result.json as { requestId?: string };
    assert.match(body.requestId ?? "", /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
    assert.equal(result.headers.get("Idempotency-Key"), body.requestId);
  });
  await check("successful mutation is no-store and exact HTTP retry has one side effect", async () => {
    const client = new HttpClient();
    assert.equal((await client.login(httpUser.email)).status, 200);
    const csrf = await client.csrfToken();
    const id = "first-party-http-request";
    const first = await client.request("POST", "/api/promocodes/redeem", {
      body: { code: "HTTPPROMO" },
      headers: { "x-csrf-token": csrf, "Idempotency-Key": id },
    });
    const second = await client.request("POST", "/api/promocodes/redeem", {
      body: { code: "HTTPPROMO" },
      headers: { "x-csrf-token": csrf, "Idempotency-Key": id },
    });
    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 200, second.text);
    assert.match(first.headers.get("Cache-Control") ?? "", /no-store/);
    assert.equal((second.json as { created?: boolean }).created, false);
    assert.equal(
      await prisma.auditLog.count({ where: { userId: httpUser.id, action: "PROMOCODE_REDEEMED" } }),
      1,
    );
    assert.equal(
      await prisma.notification.count({ where: { userId: httpUser.id, type: "promocode_redeemed" } }),
      1,
    );
  });
  await check("sanitized conflict response leaks no raw infrastructure details", async () => {
    const client = new HttpClient();
    assert.equal((await client.login(corruptHttpUser.email)).status, 200);
    const csrf = await client.csrfToken();
    const result = await client.request("POST", "/api/promocodes/redeem", {
      body: { code: corruptPromo.code },
      headers: { "x-csrf-token": csrf, "Idempotency-Key": "corrupt-http-request" },
    });
    assert.equal(result.status, 409);
    assert.equal(/Prisma|SQLite|SELECT|\/home\/|DATABASE_URL|stack/i.test(result.text), false);
  });

  await stopServer(server);
  server = null;
  await prisma.$disconnect();
  cleanupDb();
  cleanupCompleted = true;

  await check("temporary listener and SQLite files are cleaned", async () => {
    assert.equal(cleanupCompleted, true);
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
    }
    await assert.rejects(
      fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }),
    );
  });

  assert.equal(passed + failed, 67, "regression scenario count drifted");
  assert.equal(failed, 0, `${failed} promocode regression scenarios failed`);
}

main()
  .then(() => {
    console.log(`\ncurriculum promocode XP regression: ${passed} passed, ${failed} failed`);
  })
  .catch(async (error) => {
    console.error(error);
    console.log(`\ncurriculum promocode XP regression: ${passed} passed, ${failed + 1} failed`);
    cleanupDb();
    process.exitCode = 1;
  });
