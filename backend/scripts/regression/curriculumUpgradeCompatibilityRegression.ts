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
// then apply the additive Phase 2 enrollment/progress, Phase 3 XP and Phase 4
// content/assessment migrations. Proves all prior data is preserved before
// exercising runtime compatibility.
// Uses only a throwaway SQLite DB in /tmp, removed in finally.

const dbPath = `/tmp/ata-curriculum-upgrade-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
// Must be set before @/lib/prisma is imported, so the shared client (also used
// by the authoring domain service) connects to this throwaway DB.
process.env.DATABASE_URL = dbUrl;
const PHASE_1_MIGRATION = "20260714000000_curriculum_versioning_foundation";
const PHASE_2_MIGRATION = "20260714010000_curriculum_enrollment_progress_foundation";
const PHASE_3_XP_MIGRATION = "20260714020000_xp_transaction_foundation";
const PHASE_3_PROMOCODE_MIGRATION = "20260714030000_promocode_redemption_idempotency";
const PHASE_4_CONTENT_MIGRATION = "20260715000000_content_assessment_foundation";
const PHASE_4_LESSON_PROGRESS_MIGRATION = "20260715010000_lesson_progress_autosave_idempotency";
const PHASE_5_REPORT_MIGRATION = "20260716000000_report_workflow_foundation";
const PHASE_5_ATTACHMENT_MIGRATION = "20260716010000_report_attachment_purge_receipt";
const PHASE_5_REVIEW_PIN_MIGRATION = "20260717000000_report_review_history_pin";
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
delete serverEnv.CURRICULUM_V2_READ_ENABLED;
delete serverEnv.CURRICULUM_V2_ENROLLMENT_ENABLED;
delete serverEnv.CURRICULUM_V2_XP_ENABLED;
delete serverEnv.CURRICULUM_V2_CONTENT_ENABLED;
delete serverEnv.CURRICULUM_V2_ASSESSMENT_ENABLED;
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

async function startServer(
  flags: { admin?: boolean; read?: boolean; enrollment?: boolean; xp?: boolean; content?: boolean; assessment?: boolean } = {},
): Promise<ChildProcess> {
  const env = { ...serverEnv };
  if (flags.admin) env.CURRICULUM_V2_ADMIN_ENABLED = "true";
  if (flags.read) env.CURRICULUM_V2_READ_ENABLED = "true";
  if (flags.enrollment) env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  if (flags.xp) env.CURRICULUM_V2_XP_ENABLED = "true";
  if (flags.content) env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  if (flags.assessment) env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";
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
  async csrfToken() {
    const response = await this.get("/api/csrf");
    const token = (response.json as { csrfToken?: string })?.csrfToken;
    assert.equal(typeof token, "string");
    return token!;
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
    const phase3XpIndex = all.indexOf(PHASE_3_XP_MIGRATION);
    const phase3PromocodeIndex = all.indexOf(PHASE_3_PROMOCODE_MIGRATION);
    const phase4ContentIndex = all.indexOf(PHASE_4_CONTENT_MIGRATION);
    const phase4LessonProgressIndex = all.indexOf(PHASE_4_LESSON_PROGRESS_MIGRATION);
    const phase5ReportIndex = all.indexOf(PHASE_5_REPORT_MIGRATION);
    assert.notEqual(phase1Index, -1, "Phase 1 curriculum migration missing");
    assert.notEqual(phase2Index, -1, "Phase 2 enrollment migration missing");
    assert.notEqual(phase3XpIndex, -1, "Phase 3 XP migration missing");
    assert.notEqual(phase3PromocodeIndex, -1, "Phase 3 promocode migration missing");
    assert.notEqual(phase4ContentIndex, -1, "Phase 4 content migration missing");
    assert.notEqual(phase4LessonProgressIndex, -1, "Phase 4 lesson progress migration missing");
    assert.notEqual(phase5ReportIndex, -1, "Phase 5 report migration missing");
    assert.equal(phase2Index > phase1Index, true, "Phase 2 migration must follow Phase 1");
    assert.equal(phase3XpIndex > phase2Index, true, "Phase 3 XP migration must follow Phase 2");
    assert.equal(
      phase3PromocodeIndex > phase3XpIndex,
      true,
      "Phase 3 promocode migration must follow the XP migration",
    );
    assert.equal(phase4ContentIndex > phase3PromocodeIndex, true, "Phase 4 migration must follow Phase 3");
    assert.equal(
      phase4LessonProgressIndex > phase4ContentIndex,
      true,
      "Phase 4 lesson progress migration must follow the content migration",
    );
    assert.equal(phase5ReportIndex > phase4LessonProgressIndex, true, "Phase 5 migration must follow Phase 4");
    const phase5AttachmentIndex = all.indexOf(PHASE_5_ATTACHMENT_MIGRATION);
    assert.notEqual(phase5AttachmentIndex, -1, "Phase 5B.5b attachment migration missing");
    assert.equal(
      phase5AttachmentIndex > phase5ReportIndex,
      true,
      "Phase 5B.5b attachment migration must follow the report migration",
    );
    const phase5ReviewPinIndex = all.indexOf(PHASE_5_REVIEW_PIN_MIGRATION);
    assert.notEqual(phase5ReviewPinIndex, -1, "Phase 5B.6 review history pin migration missing");
    assert.equal(
      phase5ReviewPinIndex > phase5AttachmentIndex,
      true,
      "Phase 5B.6 review history pin migration must follow the attachment migration",
    );
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
    const promocode = await prisma.promocode.create({
      data: {
        code: "UPGRADEXP",
        type: "xp_bonus",
        value: { xp: 20 },
        maxUses: 5,
        perUserLimit: 2,
        usedCount: 1,
      },
    });
    const promocodeRedemption = await prisma.promocodeRedemption.create({
      data: { userId: user.id, promocodeId: promocode.id },
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
      promocodes: await prisma.promocode.count(),
      promocodeRedemptions: await prisma.promocodeRedemption.count(),
      userRow: await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      xpRow: await prisma.xpEvent.findUniqueOrThrow({ where: { id: xpEvent.id } }),
      exchangeRow: await prisma.exchangeAccount.findUniqueOrThrow({ where: { id: exchangeAccount.id } }),
      postbackRow: await prisma.postbackEvent.findUniqueOrThrow({ where: { id: postback.id } }),
      progressRow: await prisma.userTaskProgress.findUniqueOrThrow({ where: { id: progress.id } }),
      reportRow: await prisma.taskReport.findUniqueOrThrow({ where: { id: report.id } }),
      promocodeRow: await prisma.promocode.findUniqueOrThrow({ where: { id: promocode.id } }),
      promocodeRedemptionRow: await prisma.promocodeRedemption.findUniqueOrThrow({
        where: { id: promocodeRedemption.id },
      }),
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
      assert.equal(await prisma.promocode.count(), snapshot.promocodes);
      assert.equal(
        await prisma.promocodeRedemption.count(),
        snapshot.promocodeRedemptions,
      );
    });

    await check("3. V1 and Phase 1 rows, values and relations are unchanged", async () => {
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), snapshot.userRow);
      assert.deepEqual(await prisma.xpEvent.findUniqueOrThrow({ where: { id: xpEvent.id } }), snapshot.xpRow);
      assert.deepEqual(await prisma.exchangeAccount.findUniqueOrThrow({ where: { id: exchangeAccount.id } }), snapshot.exchangeRow);
      assert.deepEqual(await prisma.postbackEvent.findUniqueOrThrow({ where: { id: postback.id } }), snapshot.postbackRow);
      assert.deepEqual(await prisma.userTaskProgress.findUniqueOrThrow({ where: { id: progress.id } }), snapshot.progressRow);
      assert.deepEqual(await prisma.taskReport.findUniqueOrThrow({ where: { id: report.id } }), snapshot.reportRow);
      assert.deepEqual(
        await prisma.promocode.findUniqueOrThrow({ where: { id: promocode.id } }),
        snapshot.promocodeRow,
      );
      assert.deepEqual(
        await prisma.promocodeRedemption.findUniqueOrThrow({
          where: { id: promocodeRedemption.id },
        }),
        snapshot.promocodeRedemptionRow,
      );
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

    const phase2Enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: user.id,
        curriculumVersionId: phase1Version.id,
        curriculumCode: phase1Version.code,
      },
    });
    const phase2Progress = await prisma.userLevelProgress.create({
      data: {
        enrollmentId: phase2Enrollment.id,
        curriculumVersionId: phase1Version.id,
        levelDefinitionId: phase1Level.id,
      },
    });
    const phase2Snapshot = {
      enrollment: await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: phase2Enrollment.id },
      }),
      progress: await prisma.userLevelProgress.findUniqueOrThrow({
        where: { id: phase2Progress.id },
      }),
      user: await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      xpEvent: await prisma.xpEvent.findUniqueOrThrow({ where: { id: xpEvent.id } }),
      promocode: await prisma.promocode.findUniqueOrThrow({ where: { id: promocode.id } }),
      promocodeRedemption: await prisma.promocodeRedemption.findUniqueOrThrow({
        where: { id: promocodeRedemption.id },
      }),
      curriculumVersion: await prisma.curriculumVersion.findUniqueOrThrow({
        where: { id: phase1Version.id },
      }),
      levelDefinition: await prisma.levelDefinition.findUniqueOrThrow({
        where: { id: phase1Level.id },
      }),
    };

    // ---- Apply only the additive Phase 3B.1 XP migration ----
    await applyMigration(prisma, PHASE_3_XP_MIGRATION);

    await check("7. Phase 3B.1 preserves populated V1, Phase 1 and Phase 2 rows", async () => {
      assert.deepEqual(
        await prisma.userCurriculumEnrollment.findUniqueOrThrow({
          where: { id: phase2Enrollment.id },
        }),
        phase2Snapshot.enrollment,
      );
      assert.deepEqual(
        await prisma.userLevelProgress.findUniqueOrThrow({
          where: { id: phase2Progress.id },
        }),
        phase2Snapshot.progress,
      );
      assert.deepEqual(
        await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        phase2Snapshot.user,
      );
      assert.deepEqual(
        await prisma.xpEvent.findUniqueOrThrow({ where: { id: xpEvent.id } }),
        phase2Snapshot.xpEvent,
      );
      assert.deepEqual(
        await prisma.promocode.findUniqueOrThrow({ where: { id: promocode.id } }),
        phase2Snapshot.promocode,
      );
      assert.deepEqual(
        await prisma.promocodeRedemption.findUniqueOrThrow({
          where: { id: promocodeRedemption.id },
        }),
        phase2Snapshot.promocodeRedemption,
      );
      assert.deepEqual(
        await prisma.curriculumVersion.findUniqueOrThrow({
          where: { id: phase1Version.id },
        }),
        phase2Snapshot.curriculumVersion,
      );
      assert.deepEqual(
        await prisma.levelDefinition.findUniqueOrThrow({
          where: { id: phase1Level.id },
        }),
        phase2Snapshot.levelDefinition,
      );
    });

    await check("8. XPTransaction is empty after populated upgrade", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        'SELECT COUNT(*) AS count FROM "XPTransaction"',
      );
      assert.equal(Number(rows[0].count), 0);
    });

    await check("9. one valid enrollment-owned XP row can be created", async () => {
      process.env.CURRICULUM_V2_XP_ENABLED = "true";
      const { recordCurriculumXp } = await import("../../src/lib/curriculum/xp");
      const result = await recordCurriculumXp({
        enrollmentId: phase2Enrollment.id,
        sourceType: "level_completion",
        sourceId: `progress:${phase2Progress.id}`,
        levelDefinitionId: phase1Level.id,
        amount: 10,
      });
      assert.equal(result.created, true);
      assert.equal(await prisma.xPTransaction.count(), 1);
      delete process.env.CURRICULUM_V2_XP_ENABLED;
    });

    // ---- Apply only the additive Phase 3B.5 promocode migration ----
    await applyMigration(prisma, PHASE_3_PROMOCODE_MIGRATION);

    // ---- Apply only the additive Phase 4B.1 content/assessment migration ----
    await applyMigration(prisma, PHASE_4_CONTENT_MIGRATION);

    await check("10. Phase 4B.1 preserves Phase 1-3 rows and creates nine empty tables", async () => {
      assert.deepEqual(
        await prisma.promocode.findUniqueOrThrow({ where: { id: promocode.id } }),
        snapshot.promocodeRow,
      );
      assert.deepEqual(
        await prisma.promocodeRedemption.findUniqueOrThrow({
          where: { id: promocodeRedemption.id },
        }),
        snapshot.promocodeRedemptionRow,
      );
      assert.equal(await prisma.xPTransaction.count(), 1);
      assert.equal(await prisma.promocodeRedemptionRequest.count(), 0);
      for (const table of [
        "ContentVersion", "ContentLocalization", "ContentAsset", "LevelResourceBinding",
        "AssessmentVersion", "QuestionDefinition", "QuestionLocalization",
        "AssessmentAttempt", "UserLessonProgress",
      ]) {
        const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM "${table}"`,
        );
        assert.equal(Number(rows[0].count), 0, `${table} must be empty after populated upgrade`);
      }
    });

    let lessonProgressId = 0;
    await check("11. V1 CRUD works and a representative Phase 4 graph can be created", async () => {
      const updated = await prisma.user.update({ where: { id: user.id }, data: { xp: { increment: 10 } } });
      assert.equal(updated.xp, snapshot.userRow.xp + 10);
      await prisma.user.update({ where: { id: user.id }, data: { xp: snapshot.userRow.xp } }); // restore
      const tasks = await prisma.task.findMany({ orderBy: { stepNumber: "asc" } });
      assert.equal(tasks.length, snapshot.tasks);

      const contentId = Number((await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO "ContentVersion" (
          "levelDefinitionId", "curriculumVersionId", "versionNumber", "status",
          "updatedAt", "publishedAt"
        ) VALUES (?, ?, 1, 'published', ?, ?) RETURNING "id"`,
        phase1Level.id, phase1Version.id, new Date(), new Date(),
      ))[0].id);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ContentLocalization" (
          "contentVersionId", "locale", "title", "body", "updatedAt"
        ) VALUES (?, 'ru', 'Upgrade lesson', ?, ?)`,
        contentId, JSON.stringify({ sections: [{ code: "intro", title: "Intro", body: "Body" }] }), new Date(),
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ContentAsset" (
          "contentVersionId", "kind", "assetCode", "url", "mimeType", "sortOrder"
        ) VALUES (?, 'video', 'main-video', 'https://example.com/video.mp4', 'video/mp4', 0)`,
        contentId,
      );
      const assessmentId = Number((await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO "AssessmentVersion" (
          "levelDefinitionId", "curriculumVersionId", "versionNumber", "status",
          "passPercent", "showExplanation", "updatedAt", "publishedAt"
        ) VALUES (?, ?, 1, 'published', 80, 0, ?, ?) RETURNING "id"`,
        phase1Level.id, phase1Version.id, new Date(), new Date(),
      ))[0].id);
      const questionId = Number((await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO "QuestionDefinition" (
          "assessmentVersionId", "questionNumber", "stableKey", "type",
          "options", "correctAnswer", "updatedAt"
        ) VALUES (?, 1, 'upgrade-q1', 'single_choice', ?, ?, ?) RETURNING "id"`,
        assessmentId, JSON.stringify([{ code: "a" }, { code: "b" }]), JSON.stringify({ code: "a" }), new Date(),
      ))[0].id);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "QuestionLocalization" (
          "questionId", "locale", "prompt", "optionLabels", "updatedAt"
        ) VALUES (?, 'ru', 'Upgrade question?', ?, ?)`,
        questionId, JSON.stringify({ a: "A", b: "B" }), new Date(),
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LevelResourceBinding" (
          "levelDefinitionId", "curriculumVersionId", "contentVersionId",
          "assessmentVersionId", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?)`,
        phase1Level.id, phase1Version.id, contentId, assessmentId, new Date(),
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AssessmentAttempt" (
          "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId",
          "assessmentVersionId", "attemptNumber", "startRequestId", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, 1, 'upgrade-start-request', ?)`,
        user.id, phase2Enrollment.id, phase1Version.id, phase1Level.id, assessmentId, new Date(),
      );
      lessonProgressId = Number((await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO "UserLessonProgress" (
          "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId",
          "contentVersionId", "completedSections", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING "id"`,
        user.id, phase2Enrollment.id, phase1Version.id, phase1Level.id, contentId, JSON.stringify(["intro"]), new Date(),
      ))[0].id);
      for (const table of [
        "ContentVersion", "ContentLocalization", "ContentAsset", "LevelResourceBinding",
        "AssessmentVersion", "QuestionDefinition", "QuestionLocalization",
        "AssessmentAttempt", "UserLessonProgress",
      ]) {
        const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM "${table}"`,
        );
        assert.equal(Number(rows[0].count), 1, `${table} representative row missing`);
      }
    });

    const preAutosaveHardening = {
      user: await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      enrollment: await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: phase2Enrollment.id } }),
      levelProgress: await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: phase2Progress.id } }),
    };
    await applyMigration(prisma, PHASE_4_LESSON_PROGRESS_MIGRATION);

    await check("12. autosave hardening preserves the populated progress row with revision zero", async () => {
      const progressRows = await prisma.$queryRawUnsafe<Array<{
        id: number;
        revision: number;
        completedSections: unknown;
      }>>(
        'SELECT "id", "revision", "completedSections" FROM "UserLessonProgress" WHERE "id" = ?',
        lessonProgressId,
      );
      assert.equal(progressRows.length, 1);
      assert.equal(progressRows[0].revision, 0);
      assert.deepEqual(progressRows[0].completedSections, ["intro"]);
      assert.equal(await prisma.userLessonProgressSaveReceipt.count(), 0);
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), preAutosaveHardening.user);
      assert.deepEqual(
        await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: phase2Enrollment.id } }),
        preAutosaveHardening.enrollment,
      );
      assert.deepEqual(
        await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: phase2Progress.id } }),
        preAutosaveHardening.levelProgress,
      );
    });

    await check("13. autosave receipt schema has the complete constrained ownership identity", async () => {
      const table = (await prisma.$queryRawUnsafe<Array<{ sql: string }>>(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='UserLessonProgressSaveReceipt'`,
      ))[0];
      assert.match(table.sql, /CHECK \("revision" > 0\)/);
      assert.match(table.sql, /sha256:/);
      assert.match(table.sql, /length\(trim\("requestId"\)\) BETWEEN 8 AND 128/);
      const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type='index'`,
      );
      for (const name of [
        "UserLessonProgress_id_userId_enrollmentId_curriculumVersionId_levelDefinitionId_contentVersionId_key",
        "UserLessonProgressSaveReceipt_userId_requestId_key",
        "UserLessonProgressSaveReceipt_lessonProgressId_revision_key",
      ]) {
        assert.equal(indexes.some((item) => item.name === name), true, `${name} missing`);
      }
      const fks = await prisma.$queryRawUnsafe<Array<{ table: string; on_delete: string; on_update: string }>>(
        'PRAGMA foreign_key_list("UserLessonProgressSaveReceipt")',
      );
      assert.equal(fks.length, 6);
      assert.equal(fks.every((item) => item.table === "UserLessonProgress"), true);
      assert.equal(fks.every((item) => item.on_delete === "RESTRICT"), true);
      assert.equal(fks.every((item) => item.on_update === "CASCADE"), true);
    });

    const reportTables = [
      "ReportAssignmentVersion", "ReportAssignmentLocalization", "ReportFieldDefinition",
      "ReportFieldLocalization", "LevelReportBinding", "ReportRubricVersion",
      "ReportRubricCriterion", "ReportRubricCriterionLocalization", "ReportRubricScaleOption",
      "ReportRubricScaleOptionLocalization", "ReportRejectionReason",
      "ReportRejectionReasonLocalization", "ReportSubmission", "ReportRevision",
      "ReportReview", "ReportReviewScore", "ReportAttachment", "ReportCommandReceipt",
    ];
    const phase4BeforeReportMigration = await Promise.all([
      "ContentVersion", "ContentLocalization", "ContentAsset", "LevelResourceBinding",
      "AssessmentVersion", "QuestionDefinition", "QuestionLocalization", "AssessmentAttempt",
      "UserLessonProgress", "UserLessonProgressSaveReceipt",
    ].map(async (table) => Number((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "${table}"`,
    ))[0].count)));
    const parentColumnsBeforeReportMigration = new Map<string, string[]>();
    for (const table of ["User", "CurriculumVersion", "LevelDefinition", "UserCurriculumEnrollment", "UserLevelProgress"]) {
      parentColumnsBeforeReportMigration.set(table, (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("${table}")`,
      )).map((column) => column.name));
    }
    const taskReportBeforeReportMigration = await prisma.taskReport.findUniqueOrThrow({ where: { id: report.id } });
    const progressBeforeReportMigration = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: phase2Progress.id } });
    await applyMigration(prisma, PHASE_5_REPORT_MIGRATION);

    await check("14. Phase 5 report migration preserves V1 and Phase 1-4 data and creates empty tables", async () => {
      assert.deepEqual(await prisma.taskReport.findUniqueOrThrow({ where: { id: report.id } }), taskReportBeforeReportMigration);
      assert.deepEqual(await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: phase2Progress.id } }), progressBeforeReportMigration);
      const phase4After = await Promise.all([
        "ContentVersion", "ContentLocalization", "ContentAsset", "LevelResourceBinding",
        "AssessmentVersion", "QuestionDefinition", "QuestionLocalization", "AssessmentAttempt",
        "UserLessonProgress", "UserLessonProgressSaveReceipt",
      ].map(async (table) => Number((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count FROM "${table}"`,
      ))[0].count)));
      assert.deepEqual(phase4After, phase4BeforeReportMigration);
      for (const table of reportTables) {
        const count = Number((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM "${table}"`,
        ))[0].count);
        assert.equal(count, 0, `${table} must be empty after populated upgrade`);
      }
      for (const [table, before] of parentColumnsBeforeReportMigration) {
        const after = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`)).map((column) => column.name);
        assert.deepEqual(after, before, `${table} SQL columns changed`);
      }
    });

    let reportSubmissionId = 0;
    await check("15. representative V2 assignment and submission coexist with V1 TaskReport CRUD", async () => {
      const assignmentId = Number((await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO "ReportAssignmentVersion" (
          "levelDefinitionId", "curriculumVersionId", "versionNumber", "createdById", "updatedAt"
        ) VALUES (?, ?, 1, ?, ?) RETURNING "id"`,
        phase1Level.id, phase1Version.id, adminUser.id, new Date(),
      ))[0].id);
      const rubricId = Number((await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO "ReportRubricVersion" (
          "reportAssignmentVersionId", "versionNumber", "createdById", "updatedAt"
        ) VALUES (?, 1, ?, ?) RETURNING "id"`,
        assignmentId, adminUser.id, new Date(),
      ))[0].id);
      reportSubmissionId = Number((await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO "ReportSubmission" (
          "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId",
          "userLevelProgressId", "reportAssignmentVersionId", "reportRubricVersionId", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING "id"`,
        user.id, phase2Enrollment.id, phase1Version.id, phase1Level.id, phase2Progress.id,
        assignmentId, rubricId, new Date(),
      ))[0].id);
      assert.equal(reportSubmissionId > 0, true);
      const updatedReport = await prisma.taskReport.update({ where: { id: report.id }, data: { reportText: "done after phase 5" } });
      assert.equal(updatedReport.reportText, "done after phase 5");
      await prisma.taskReport.update({ where: { id: report.id }, data: { reportText: snapshot.reportRow.reportText } });
    });

    let draftId = 0;
    await check("16. Phase 1 curriculum authoring still works on the upgraded DB", async () => {
      const authoring = await import("../../src/lib/curriculum/authoring");
      const draft = await authoring.createCurriculumDraft({
        actorId: adminUser.id, code: "upgrade-check", name: "Upgrade Check", versionNumber: 1,
      });
      draftId = draft.id;
      assert.equal(draft.status, "draft");
    });

    const attachmentColumnsBefore = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("ReportAttachment")',
    )).map((column) => column.name);
    const reportCountsBeforeAttachmentMigration = await Promise.all(reportTables.map(async (table) => Number((
      await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "${table}"`)
    )[0].count)));
    await applyMigration(prisma, PHASE_5_ATTACHMENT_MIGRATION);

    await check("16b. attachment purge-receipt migration adds only storagePurgedAt and preserves data", async () => {
      const after = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("ReportAttachment")',
      )).map((column) => column.name);
      assert.deepEqual(after, [...attachmentColumnsBefore, "storagePurgedAt"]);
      const counts = await Promise.all(reportTables.map(async (table) => Number((
        await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "${table}"`)
      )[0].count)));
      assert.deepEqual(counts, reportCountsBeforeAttachmentMigration);
      const submissionRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        'SELECT "id" FROM "ReportSubmission" WHERE "id" = ?', reportSubmissionId,
      );
      assert.equal(submissionRows.length, 1);
      const indexes = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ReportAttachment'",
      )).map((row) => row.name);
      assert.equal(indexes.includes("ReportAttachment_status_createdAt_idx"), true);
      assert.equal(indexes.includes("ReportAttachment_purge_pending_idx"), true);
    });

    const reviewColumnsBefore = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("ReportReview")',
    )).map((column) => column.name);
    const reportCountsBeforeReviewPinMigration = await Promise.all(reportTables.map(async (table) => Number((
      await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "${table}"`)
    )[0].count)));
    await applyMigration(prisma, PHASE_5_REVIEW_PIN_MIGRATION);

    await check("16c. review history pin migration removes only the rebinding cascade and preserves data", async () => {
      const after = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("ReportReview")',
      )).map((column) => column.name);
      assert.deepEqual(after, reviewColumnsBefore);
      const counts = await Promise.all(reportTables.map(async (table) => Number((
        await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "${table}"`)
      )[0].count)));
      assert.deepEqual(counts, reportCountsBeforeReviewPinMigration);
      const ddl = (await prisma.$queryRawUnsafe<Array<{ sql: string }>>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='ReportReview'",
      ))[0].sql;
      assert.equal(ddl.includes("ReportReview_submittedRevision_fkey"), false, "rebinding cascade must be gone");
      assert.equal(ddl.includes("ReportReview_revision_fkey"), true, "revision pin FK must remain");
      assert.equal(ddl.includes("ReportReview_decision_check"), true, "decision CHECK must remain");
      const indexes = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ReportReview'",
      )).map((row) => row.name);
      for (const name of [
        "ReportReview_revisionId_key", "ReportReview_reviewerId_requestId_key",
        "ReportReview_id_submissionId_key", "ReportReview_id_reportRubricVersionId_key",
        "ReportReview_submissionId_reviewedAt_idx",
      ]) assert.equal(indexes.includes(name), true, `missing index ${name}`);
      const stash = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE name LIKE '%history_pin_stash%'",
      );
      assert.equal(stash.length, 0, "temporary stash table must not persist");
    });

    // Apply any migrations added after Phase 5B.6 (e.g. the CRM staff identity
    // migration) so the idempotency re-run below sees the fully-applied chain.
    for (const name of all.slice(phase5ReviewPinIndex + 1)) {
      await applyMigration(prisma, name);
    }

    await check("17. re-running the real migration runner does not duplicate schema or data", async () => {
      const before = {
        migrations: (await prisma.$queryRawUnsafe<Array<{ c: number }>>(
          'SELECT COUNT(*) as c FROM "_prisma_migrations"',
        ))[0].c,
        users: await prisma.user.count(),
        drafts: await prisma.curriculumVersion.count(),
        xpTransactions: Number(
          (
            await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
              'SELECT COUNT(*) as c FROM "XPTransaction"',
            )
          )[0].c,
        ),
        promocodeRequests: await prisma.promocodeRedemptionRequest.count(),
        enrollment: await prisma.userCurriculumEnrollment.findUniqueOrThrow({
          where: { id: phase2Enrollment.id },
        }),
        progress: await prisma.userLevelProgress.findUniqueOrThrow({
          where: { id: phase2Progress.id },
        }),
        phase4Counts: await Promise.all([
          "ContentVersion", "ContentLocalization", "ContentAsset", "LevelResourceBinding",
          "AssessmentVersion", "QuestionDefinition", "QuestionLocalization",
          "AssessmentAttempt", "UserLessonProgress", "UserLessonProgressSaveReceipt",
        ].map(async (table) => Number((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM "${table}"`,
        ))[0].count))),
        phase5Counts: await Promise.all(reportTables.map(async (table) => Number((
          await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "${table}"`)
        )[0].count))),
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
        xpTransactions: Number(
          (
            await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
              'SELECT COUNT(*) as c FROM "XPTransaction"',
            )
          )[0].c,
        ),
        promocodeRequests: await prisma.promocodeRedemptionRequest.count(),
        enrollment: await prisma.userCurriculumEnrollment.findUniqueOrThrow({
          where: { id: phase2Enrollment.id },
        }),
        progress: await prisma.userLevelProgress.findUniqueOrThrow({
          where: { id: phase2Progress.id },
        }),
        phase4Counts: await Promise.all([
          "ContentVersion", "ContentLocalization", "ContentAsset", "LevelResourceBinding",
          "AssessmentVersion", "QuestionDefinition", "QuestionLocalization",
          "AssessmentAttempt", "UserLessonProgress", "UserLessonProgressSaveReceipt",
        ].map(async (table) => Number((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM "${table}"`,
        ))[0].count))),
        phase5Counts: await Promise.all(reportTables.map(async (table) => Number((
          await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "${table}"`)
        )[0].count))),
      };
      assert.deepEqual(after, before, "re-run changed migration/data state");
    });

    // ---- Runtime compatibility on the upgraded DB ----
    await prisma.$disconnect();

    server = await startServer();
    await check("18. flag OFF: /api/health OK and V1 authenticated read works", async () => {
      assert.equal((await fetch(`${BASE_URL}/api/health`)).ok, true);
      const client = new HttpClient();
      const login = await client.login(user.email);
      assert.equal(login.status, 200, login.text);
      const me = await client.get("/api/auth/me");
      assert.equal(me.status, 200, me.text);
    });

    await check("19. all V2 flags off: V1 promocode route remains operational", async () => {
      const client = new HttpClient();
      await client.login(user.email);
      const csrf = await client.csrfToken();
      const response = await client.request("POST", "/api/promocodes/redeem", {
        body: { code: promocode.code },
        headers: {
          "x-csrf-token": csrf,
          "Idempotency-Key": "upgrade-v1-promo-runtime",
        },
      });
      assert.equal(response.status, 200, response.text);
    });

    await check("20. READ off hides current and XP history routes", async () => {
      const client = new HttpClient();
      await client.login(user.email);
      assert.equal((await client.get("/api/curriculum/v2/current")).status, 404);
      assert.equal((await client.get("/api/curriculum/v2/xp/history")).status, 404);
    });

    await check("21. flag OFF: curriculum admin routes return 404", async () => {
      const client = new HttpClient();
      await client.login(adminUser.email);
      const list = await client.get("/api/admin/curriculum/versions");
      assert.equal(list.status, 404);
      const detail = await client.get(`/api/admin/curriculum/versions/${draftId}`);
      assert.equal(detail.status, 404);
      assert.equal((await client.get(`/api/admin/curriculum/versions/${phase1Version.id}/levels/${phase1Level.id}/content-versions`)).status, 404);
      assert.equal((await client.get(`/api/admin/curriculum/versions/${phase1Version.id}/levels/${phase1Level.id}/assessment-versions`)).status, 404);
    });
    await stopServer(server);
    server = null;

    server = await startServer({ read: true });
    await check("22. READ on and XP off returns current with disabled XP", async () => {
      const client = new HttpClient();
      await client.login(user.email);
      const response = await client.get("/api/curriculum/v2/current");
      assert.equal(response.status, 200, response.text);
      assert.deepEqual((response.json as { data?: { xp?: unknown } }).data?.xp, {
        kind: "disabled",
      });
      assert.equal((await client.get("/api/curriculum/v2/xp/history")).status, 404);
    });
    await stopServer(server);
    server = null;

    server = await startServer({ read: true, xp: true });
    await check("23. READ and XP on return enrollment history", async () => {
      const client = new HttpClient();
      await client.login(user.email);
      const response = await client.get("/api/curriculum/v2/xp/history");
      assert.equal(response.status, 200, response.text);
      const data = (response.json as { data?: { kind?: string; summary?: { currentXp?: number } } }).data;
      assert.equal(data?.kind, "available");
      assert.equal(data?.summary?.currentXp, 10);
    });
    await stopServer(server);
    server = null;

    await check("24. curriculum feature flags default false", async () => {
      const env = await import("../../src/lib/env");
      const defaults = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
      assert.equal(env.isCurriculumV2ReadEnabled(defaults), false);
      assert.equal(env.isCurriculumV2EnrollmentEnabled(defaults), false);
      assert.equal(env.isCurriculumV2XpEnabled(defaults), false);
      assert.equal(env.isCurriculumV2ContentEnabled(defaults), false);
      assert.equal(env.isCurriculumV2AssessmentEnabled(defaults), false);
    });

    server = await startServer({ admin: true });
    await check("25. admin flag ON preserves authenticated curriculum admin read", async () => {
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

    server = await startServer({ admin: true, read: true, enrollment: true, content: true, assessment: true });
    await check("26. Phase 4 admin profile flags expose safe list routes", async () => {
      const client = new HttpClient(); await client.login(adminUser.email);
      const content = await client.get(`/api/admin/curriculum/versions/${phase1Version.id}/levels/${phase1Level.id}/content-versions`);
      const assessment = await client.get(`/api/admin/curriculum/versions/${phase1Version.id}/levels/${phase1Level.id}/assessment-versions`);
      assert.equal(content.status, 200, content.text); assert.equal(assessment.status, 200, assessment.text);
    });
    await check("27. Phase 4 assessment history works on populated upgraded V1 runtime", async () => {
      const client = new HttpClient(); await client.login(user.email);
      const response = await client.get("/api/curriculum/v2/assessment/attempts?limit=20");
      assert.equal(response.status, 200, response.text);
    });
    await stopServer(server); server = null;
  } finally {
    await stopServer(server);
    try { await prisma.$disconnect(); } catch { /* already closed */ }
    cleanupDb();
  }

  await check("28. temporary DB, journals and listener removed after test", async () => {
    assert.equal(fs.existsSync(dbPath), false);
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
    }
    // AFD-5B2A-FINAL — this sampled the port exactly once, immediately after
    // SIGKILL. The kernel does not release a LISTEN socket the instant its
    // owning process dies, so a suite that had cleaned up perfectly could still
    // be reported as leaking a listener; that is what failed inside the phase 3
    // gate. The guarantee is unchanged — this port must end up free — but it is
    // now given a bounded chance to become free instead of being judged on a
    // single sample. A genuinely leaked listener still fails, 20 seconds later.
    const probe = () =>
      (spawnSync("bash", ["-lc", `ss -tln 2>/dev/null | grep -E '[:.]${PORT} ' || true`], {
        encoding: "utf8",
      }).stdout ?? "").trim();
    const deadline = Date.now() + 20_000;
    let listener = probe();
    while (listener !== "" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      listener = probe();
    }
    assert.equal(listener, "", `port ${PORT} still bound 20s after teardown: ${listener}`);
  });

  assert.equal(passed + failed, 30, "upgrade regression scenario count drifted");
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
