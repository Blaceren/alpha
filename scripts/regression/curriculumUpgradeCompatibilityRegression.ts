import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";

// Cumulative upgrade regression: upgrade an existing populated V1 database
// through the Phase 1 curriculum migration, add representative Phase 1 data,
// then apply the additive Phase 2B.1 enrollment/progress migration. Proves V1
// and Phase 1 data preservation before exercising runtime compatibility.
// Uses only a throwaway SQLite DB in /tmp, removed in finally.

const dbPath = `/tmp/ata-curriculum-upgrade-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
// Must be set before @/lib/prisma is imported, so the shared client (also used
// by the authoring domain service) connects to this throwaway DB.
process.env.DATABASE_URL = dbUrl;
const PHASE_1_MIGRATION = "20260714000000_curriculum_versioning_foundation";
const PHASE_2_MIGRATION = "20260714010000_curriculum_enrollment_progress_foundation";
const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");
const PORT = 3930 + (process.pid % 20);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "UpgradeCompat123!";

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

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function migrationNames(): string[] {
  return fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Mirror the project's custom runner (prisma/migrate.ts): split by ';',
// record into _prisma_migrations by name so the real runner later skips them.
function splitSql(sql: string) {
  return sql.split(";").map((s) => s.trim()).filter(Boolean);
}

async function applyMigration(prisma: PrismaClient, name: string) {
  const sql = fs.readFileSync(path.join(migrationsRoot, name, "migration.sql"), "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  const id = crypto.randomUUID();
  const statements = splitSql(sql);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "applied_steps_count") VALUES (?, ?, ?, ?)',
      id, checksum, name, 0,
    );
    for (const statement of statements) {
      await tx.$executeRawUnsafe(statement);
    }
    await tx.$executeRawUnsafe(
      'UPDATE "_prisma_migrations" SET "finished_at" = CURRENT_TIMESTAMP, "applied_steps_count" = ? WHERE "id" = ?',
      statements.length, id,
    );
  });
}

const serverEnv: Record<string, string | undefined> = { ...process.env };
delete serverEnv.CURRICULUM_V2_ADMIN_ENABLED;
delete serverEnv.NODE_ENV;
Object.assign(serverEnv, {
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "upgrade-compat-session-secret",
  POSTBACK_SECRET: "upgrade-compat-postback-secret",
  APP_URL: BASE_URL,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
});

async function startServer(flagEnabled: boolean): Promise<ChildProcess> {
  const env = { ...serverEnv };
  if (flagEnabled) env.CURRICULUM_V2_ADMIN_ENABLED = "true";
  const options: SpawnOptions = {
    cwd: process.cwd(),
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  };
  const proc = spawn("npx", ["next", "dev", "--turbopack", "-p", String(PORT)], options);
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) break;
    } catch {
      // keep polling
    }
    if (Date.now() > deadline) throw new Error("dev server did not become healthy in time");
    await new Promise((r) => setTimeout(r, 2000));
  }
  return proc;
}

async function stopServer(proc: ChildProcess | null) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    // gone
  }
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      break;
    }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    // gone
  }
}

class HttpClient {
  private cookies = new Map<string, string>();
  private cookieHeader() {
    return Array.from(this.cookies.entries()).map(([n, v]) => `${n}=${v}`).join("; ");
  }
  private store(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  async request(method: string, p: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
    const res = await fetch(`${BASE_URL}${p}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    this.store(res);
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text };
  }
  get(p: string) { return this.request("GET", p); }
  login(email: string) {
    return this.request("POST", "/api/auth/login", {
      body: { email, password: PASSWORD, captchaToken: "dev-captcha-ok" },
    });
  }
}

async function main() {
  cleanupDb();
  // Single shared client (from @/lib/prisma) — the same instance the authoring
  // domain service uses — so there is only one connection to the SQLite file.
  const { prisma } = (await import("../../src/lib/prisma")) as { prisma: PrismaClient };
  let server: ChildProcess | null = null;

  try {
    // ---- Apply migration chain UP TO (not including) Phase 1 curriculum ----
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "checksum" TEXT NOT NULL,
        "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL,
        "logs" TEXT,
        "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      );
    `);

    const all = migrationNames();
    const phase1Index = all.indexOf(PHASE_1_MIGRATION);
    const phase2Index = all.indexOf(PHASE_2_MIGRATION);
    assert.notEqual(phase1Index, -1, "Phase 1 curriculum migration missing");
    assert.notEqual(phase2Index, -1, "Phase 2 enrollment migration missing");
    assert.equal(phase2Index > phase1Index, true, "Phase 2 migration must follow Phase 1");
    for (const name of all.slice(0, phase1Index)) {
      await applyMigration(prisma, name);
    }

    await check("1. V1 migration chain applies before curriculum migrations", async () => {
      const tables = (
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type='table'",
        )
      ).map((r) => r.name);
      assert.equal(tables.includes("User"), true);
      assert.equal(tables.includes("Task"), true);
      assert.equal(tables.includes("CurriculumVersion"), false, "V2 table exists too early");
    });

    // ---- Populate representative V1 data ----
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const user = await prisma.user.create({
      data: { email: "v1-user@example.com", name: "V1 User", passwordHash, level: 3, xp: 125, role: "user" },
    });
    const adminUser = await prisma.user.create({
      data: { email: "v1-admin@example.com", name: "V1 Admin", passwordHash, role: "admin" },
    });
    await prisma.level.create({
      data: { number: 1, title: "Level 1", requiredXp: 0, status: "current" },
    });
    const task = await prisma.task.create({
      data: {
        code: "lvl_01_pocket_registration", stepNumber: 1, title: "Register", description: "d",
        rewardType: "xp", actionLabel: "Go", xpReward: 15, kind: "pocket_registration",
        completionMethod: "pocket_postback",
      },
    });
    const progress = await prisma.userTaskProgress.create({
      data: { userId: user.id, taskId: task.id, status: "active" },
    });
    const xpEvent = await prisma.xpEvent.create({
      data: { userId: user.id, amount: 15, source: "task", sourceId: task.code },
    });
    const exchangeAccount = await prisma.exchangeAccount.create({
      data: {
        userId: user.id, provider: "sandbox", referralLink: "https://ref", exchangeAccountId: "acct-1",
        traderId: "trader-1", clickId: "click-1", balance: 125, status: "connected",
      },
    });
    const postback = await prisma.postbackEvent.create({
      data: {
        exchangeAccountId: exchangeAccount.id, externalEventId: "evt-1", type: "First Deposit",
        eventType: "deposit", normalizedEventType: "first_deposit", amount: 50, status: "processed",
        rawPayload: "{}",
      },
    });
    const report = await prisma.taskReport.create({
      data: { userId: user.id, taskId: task.id, status: "pending", reportText: "done" },
    });

    // ---- Apply Phase 1 and populate representative curriculum data ----
    await applyMigration(prisma, PHASE_1_MIGRATION);
    const phase1Version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: "ATA V2 populated upgrade",
        versionNumber: 1,
        status: "published",
        publishedAt: new Date("2026-07-14T00:00:00.000Z"),
        createdById: adminUser.id,
      },
    });
    const phase1Module = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: phase1Version.id,
        moduleNumber: 1,
        code: "m01-upgrade",
        title: "Upgrade module",
        firstLevel: 1,
        lastLevel: 1,
      },
    });
    const phase1Level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: phase1Version.id,
        moduleId: phase1Module.id,
        levelNumber: 1,
        stableCode: "v2.l001.upgrade",
        type: "lesson",
        title: "Upgrade level",
        completionMethod: "lesson",
      },
    });

    const snapshot = {
      users: await prisma.user.count(),
      levels: await prisma.level.count(),
      tasks: await prisma.task.count(),
      progress: await prisma.userTaskProgress.count(),
      xpEvents: await prisma.xpEvent.count(),
      exchangeAccounts: await prisma.exchangeAccount.count(),
      postbacks: await prisma.postbackEvent.count(),
      reports: await prisma.taskReport.count(),
      userRow: await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      xpRow: await prisma.xpEvent.findUniqueOrThrow({ where: { id: xpEvent.id } }),
      exchangeRow: await prisma.exchangeAccount.findUniqueOrThrow({ where: { id: exchangeAccount.id } }),
      postbackRow: await prisma.postbackEvent.findUniqueOrThrow({ where: { id: postback.id } }),
      progressRow: await prisma.userTaskProgress.findUniqueOrThrow({ where: { id: progress.id } }),
      reportRow: await prisma.taskReport.findUniqueOrThrow({ where: { id: report.id } }),
      curriculumVersionRow: await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: phase1Version.id } }),
      moduleDefinitionRow: await prisma.moduleDefinition.findUniqueOrThrow({ where: { id: phase1Module.id } }),
      levelDefinitionRow: await prisma.levelDefinition.findUniqueOrThrow({ where: { id: phase1Level.id } }),
    };

    // ---- Apply only the additive Phase 2B.1 migration ----
    await applyMigration(prisma, PHASE_2_MIGRATION);

    await check("2. all V1 rows survive Phase 2B.1 (counts unchanged)", async () => {
      assert.equal(await prisma.user.count(), snapshot.users);
      assert.equal(await prisma.level.count(), snapshot.levels);
      assert.equal(await prisma.task.count(), snapshot.tasks);
      assert.equal(await prisma.userTaskProgress.count(), snapshot.progress);
      assert.equal(await prisma.xpEvent.count(), snapshot.xpEvents);
      assert.equal(await prisma.exchangeAccount.count(), snapshot.exchangeAccounts);
      assert.equal(await prisma.postbackEvent.count(), snapshot.postbacks);
      assert.equal(await prisma.taskReport.count(), snapshot.reports);
    });

    await check("3. V1 and Phase 1 rows, values and relations are unchanged", async () => {
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), snapshot.userRow);
      assert.deepEqual(await prisma.xpEvent.findUniqueOrThrow({ where: { id: xpEvent.id } }), snapshot.xpRow);
      assert.deepEqual(await prisma.exchangeAccount.findUniqueOrThrow({ where: { id: exchangeAccount.id } }), snapshot.exchangeRow);
      assert.deepEqual(await prisma.postbackEvent.findUniqueOrThrow({ where: { id: postback.id } }), snapshot.postbackRow);
      assert.deepEqual(await prisma.userTaskProgress.findUniqueOrThrow({ where: { id: progress.id } }), snapshot.progressRow);
      assert.deepEqual(await prisma.taskReport.findUniqueOrThrow({ where: { id: report.id } }), snapshot.reportRow);
      assert.deepEqual(
        await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: phase1Version.id } }),
        snapshot.curriculumVersionRow,
      );
      assert.deepEqual(
        await prisma.moduleDefinition.findUniqueOrThrow({ where: { id: phase1Module.id } }),
        snapshot.moduleDefinitionRow,
      );
      assert.deepEqual(
        await prisma.levelDefinition.findUniqueOrThrow({ where: { id: phase1Level.id } }),
        snapshot.levelDefinitionRow,
      );
      // relations still resolve
      const rel = await prisma.userTaskProgress.findUniqueOrThrow({
        where: { id: progress.id }, include: { user: true, task: true },
      });
      assert.equal(rel.user.id, user.id);
      assert.equal(rel.task.id, task.id);
      const pbRel = await prisma.postbackEvent.findUniqueOrThrow({
        where: { id: postback.id }, include: { exchangeAccount: true },
      });
      assert.equal(pbRel.exchangeAccount?.id, exchangeAccount.id);
    });

    await check("4. Phase 2B.1 tables exist empty while Phase 1 data remains", async () => {
      const tables = (
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type='table'",
        )
      ).map((r) => r.name);
      for (const t of [
        "CurriculumVersion", "ModuleDefinition", "LevelDefinition",
        "UserCurriculumEnrollment", "UserLevelProgress",
      ]) {
        assert.equal(tables.includes(t), true, `missing ${t}`);
      }
      assert.equal(await prisma.curriculumVersion.count(), 1);
      assert.equal(await prisma.moduleDefinition.count(), 1);
      assert.equal(await prisma.levelDefinition.count(), 1);
      assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
      assert.equal(await prisma.userLevelProgress.count(), 0);
    });

    await check("5. Phase 1 and Phase 2 partial/compound indexes exist", async () => {
      const indexes = await prisma.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>(
        "SELECT name, sql FROM sqlite_master WHERE type='index'",
      );
      const byName = new Map(indexes.map((row) => [row.name, row.sql]));
      assert.equal(
        /where\s+"?status"?\s*=\s*'published'/i.test(byName.get("CurriculumVersion_code_published_key") ?? ""),
        true,
      );
      assert.equal(
        /where\s+"?status"?\s*=\s*'active'/i.test(
          byName.get("UserCurriculumEnrollment_userId_curriculumCode_active_key") ?? "",
        ),
        true,
      );
      for (const index of [
        "CurriculumVersion_id_code_key",
        "LevelDefinition_id_curriculumVersionId_key",
        "UserCurriculumEnrollment_id_curriculumVersionId_key",
      ]) {
        assert.equal(byName.has(index), true, `missing ${index}`);
      }
    });

    await check("6. Phase 2 composite foreign keys exist with Restrict/Cascade", async () => {
      const enrollmentFks = await prisma.$queryRawUnsafe<Array<{ table: string; on_delete: string; on_update: string }>>(
        'PRAGMA foreign_key_list("UserCurriculumEnrollment")',
      );
      const progressFks = await prisma.$queryRawUnsafe<Array<{ table: string; on_delete: string; on_update: string }>>(
        'PRAGMA foreign_key_list("UserLevelProgress")',
      );
      assert.deepEqual(new Set(enrollmentFks.map((fk) => fk.table)), new Set(["User", "CurriculumVersion"]));
      assert.deepEqual(
        new Set(progressFks.map((fk) => fk.table)),
        new Set(["UserCurriculumEnrollment", "LevelDefinition"]),
      );
      assert.equal([...enrollmentFks, ...progressFks].every((fk) => fk.on_delete === "RESTRICT"), true);
      assert.equal([...enrollmentFks, ...progressFks].every((fk) => fk.on_update === "CASCADE"), true);
    });

    await check("7. V1 CRUD still works after upgrade", async () => {
      const updated = await prisma.user.update({ where: { id: user.id }, data: { xp: { increment: 10 } } });
      assert.equal(updated.xp, snapshot.userRow.xp + 10);
      await prisma.user.update({ where: { id: user.id }, data: { xp: snapshot.userRow.xp } }); // restore
      const tasks = await prisma.task.findMany({ orderBy: { stepNumber: "asc" } });
      assert.equal(tasks.length, snapshot.tasks);
    });

    let draftId = 0;
    await check("8. Phase 1 curriculum authoring still works on the upgraded DB", async () => {
      const authoring = await import("../../src/lib/curriculum/authoring");
      const draft = await authoring.createCurriculumDraft({
        actorId: adminUser.id, code: "upgrade-check", name: "Upgrade Check", versionNumber: 1,
      });
      draftId = draft.id;
      assert.equal(draft.status, "draft");
    });

    await check("9. re-running the real migration runner does not duplicate schema or data", async () => {
      const before = {
        migrations: (await prisma.$queryRawUnsafe<Array<{ c: number }>>(
          'SELECT COUNT(*) as c FROM "_prisma_migrations"',
        ))[0].c,
        users: await prisma.user.count(),
        drafts: await prisma.curriculumVersion.count(),
      };
      const runner = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
        env: serverEnv as NodeJS.ProcessEnv, encoding: "utf8",
      });
      assert.equal(runner.status, 0, `${runner.stdout}\n${runner.stderr}`);
      assert.equal(/already applied/i.test(runner.stdout), true, "runner did not report already-applied migrations");
      const after = {
        migrations: (await prisma.$queryRawUnsafe<Array<{ c: number }>>(
          'SELECT COUNT(*) as c FROM "_prisma_migrations"',
        ))[0].c,
        users: await prisma.user.count(),
        drafts: await prisma.curriculumVersion.count(),
      };
      assert.deepEqual(after, before, "re-run changed migration/data state");
    });

    // ---- Runtime compatibility on the upgraded DB ----
    await prisma.$disconnect();

    server = await startServer(false);
    await check("10. flag OFF: /api/health OK and V1 authenticated read works", async () => {
      assert.equal((await fetch(`${BASE_URL}/api/health`)).ok, true);
      const client = new HttpClient();
      const login = await client.login(user.email);
      assert.equal(login.status, 200, login.text);
      const me = await client.get("/api/auth/me");
      assert.equal(me.status, 200, me.text);
    });

    await check("11. flag OFF: curriculum admin routes return 404", async () => {
      const client = new HttpClient();
      await client.login(adminUser.email);
      const list = await client.get("/api/admin/curriculum/versions");
      assert.equal(list.status, 404);
      const detail = await client.get(`/api/admin/curriculum/versions/${draftId}`);
      assert.equal(detail.status, 404);
    });
    await stopServer(server);
    server = null;

    server = await startServer(true);
    await check("12. flag ON: admin authenticated read of curriculum versions works", async () => {
      const client = new HttpClient();
      const login = await client.login(adminUser.email);
      assert.equal(login.status, 200, login.text);
      const list = await client.get("/api/admin/curriculum/versions");
      assert.equal(list.status, 200, list.text);
      const data = (list.json as { data?: { items?: unknown[] } }).data;
      assert.equal(Array.isArray(data?.items), true);
    });
    await stopServer(server);
    server = null;
  } finally {
    await stopServer(server);
    try { await prisma.$disconnect(); } catch { /* already closed */ }
    cleanupDb();
  }

  await check("13. temporary DB and journals removed after test", () => {
    assert.equal(fs.existsSync(dbPath), false);
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
    }
  });
}

main()
  .then(() => {
    console.log(`\ncurriculum upgrade compatibility regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum upgrade compatibility regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
