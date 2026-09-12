import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

// Phase 2B.5 regression: real Next HTTP server, real login/session cookies,
// real curriculum resolvers, and an isolated SQLite database under /tmp.

const dbPath = `/tmp/ata-curriculum-read-api-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const PORT = 3860 + (process.pid % 80);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "CurriculumRead123!";
const CURRENT_PATH = "/api/curriculum/v2/current";
const PUBLISHED_AT = new Date("2026-07-13T10:00:00.000Z");
const ENROLLED_AT = new Date("2026-07-13T11:00:00.000Z");

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

const inheritedEnv: Record<string, string | undefined> = { ...process.env };
delete inheritedEnv.CURRICULUM_V2_ADMIN_ENABLED;
delete inheritedEnv.CURRICULUM_V2_READ_ENABLED;
delete inheritedEnv.CURRICULUM_V2_ENROLLMENT_ENABLED;
delete inheritedEnv.NODE_ENV;

const serverEnv: Record<string, string | undefined> = {
  ...inheritedEnv,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "curriculum-read-api-session-secret",
  POSTBACK_SECRET: "curriculum-read-api-postback-secret",
  APP_URL: BASE_URL,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};

type ApiResponse = { status: number; headers: Headers; json: unknown; text: string };

class HttpClient {
  private cookies = new Map<string, string>();

  private cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private store(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  async request(
    method: string,
    requestPath: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse> {
    const response = await fetch(`${BASE_URL}${requestPath}`, {
      method,
      redirect: "manual",
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    this.store(response);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, json, text };
  }

  get(requestPath: string, headers?: Record<string, string>) {
    return this.request("GET", requestPath, { headers });
  }

  login(email: string) {
    return this.request("POST", "/api/auth/login", {
      body: { email, password: PASSWORD, captchaToken: "dev-captcha-ok" },
    });
  }
}

function body(response: ApiResponse): Record<string, unknown> {
  return (response.json ?? {}) as Record<string, unknown>;
}

function data(response: ApiResponse): Record<string, unknown> {
  return (body(response).data ?? {}) as Record<string, unknown>;
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

async function startServer(readEnabled: boolean): Promise<ChildProcess> {
  const env = { ...serverEnv };
  if (readEnabled) {
    env.CURRICULUM_V2_READ_ENABLED = "true";
  } else {
    // These flags deliberately cannot expose the route while READ is off.
    env.CURRICULUM_V2_ADMIN_ENABLED = "true";
    env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  }

  const spawnOptions: SpawnOptions = {
    cwd: process.cwd(),
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  };
  const proc = spawn("npx", ["next", "dev", "--turbopack", "-p", String(PORT)], spawnOptions);
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});

  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return proc;
    } catch {
      // keep polling
    }
    if (Date.now() > deadline) throw new Error("dev server did not become healthy in time");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function stopServer(proc: ChildProcess | null) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    // already dead
  }
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      break;
    }
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    // gone
  }
}

function listenerOnTestPort() {
  const result = spawnSync(
    "bash",
    ["-lc", `ss -tln 2>/dev/null | grep -E '[:.]${PORT} ' || true`],
    { encoding: "utf8" },
  );
  return (result.stdout ?? "").trim();
}

async function main() {
  cleanupDb();
  let server: ChildProcess | null = null;
  let prisma: Awaited<typeof import("../../src/lib/prisma")>["prisma"] | null = null;

  try {
    const migration = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
      env: serverEnv as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    if (migration.status !== 0) {
      console.error(migration.stdout, migration.stderr);
      throw new Error(`migration runner exited with ${migration.status}`);
    }

    process.env.DATABASE_URL = dbUrl;
    ({ prisma } = await import("../../src/lib/prisma"));
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    async function user(email: string, role: "user" | "admin" = "user") {
      return prisma!.user.create({
        data: { email, name: email.split("@")[0], role, passwordHash },
      });
    }

    const candidate = await user("read-candidate@example.com", "admin");
    const available = await user("read-available@example.com");
    const archived = await user("read-archived@example.com");
    const persisted = await user("read-persisted@example.com");
    const inProgress = await user("read-in-progress@example.com");
    const completed = await user("read-completed@example.com");
    const corrupt = await user("read-corrupt@example.com");
    const blockable = await user("read-blocked@example.com");

    async function curriculumVersion(versionNumber: number, status: "published" | "archived") {
      const version = await prisma!.curriculumVersion.create({
        data: {
          code: "ata-v2",
          name: `ATA V2 version ${versionNumber}`,
          versionNumber,
          status,
          publishedAt: PUBLISHED_AT,
        },
      });
      // Create modules and levels out of numeric order; resolver/API must sort them.
      const moduleTwo = await prisma!.moduleDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleNumber: 2,
          code: "m02",
          title: "Module 2",
          description: "second",
          firstLevel: 3,
          lastLevel: 3,
          learningObjective: "advanced",
        },
      });
      const moduleOne = await prisma!.moduleDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleNumber: 1,
          code: "m01",
          title: "Module 1",
          description: "first",
          firstLevel: 1,
          lastLevel: 2,
          learningObjective: "foundation",
        },
      });
      const levelThree = await prisma!.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleTwo.id,
          levelNumber: 3,
          stableCode: "v2.l003.gated",
          type: "financial_checkpoint",
          title: "Gated level",
          learningObjective: "future engines",
          completionMethod: "checkpoint",
          xpReward: 30,
          requiredXp: 100,
          requiredPreviousLevel: 2,
          requiredCheckpointLevel: 2,
          visibilityRule: { futureRule: true },
        },
      });
      const levelOne = await prisma!.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleOne.id,
          levelNumber: 1,
          stableCode: "v2.l001.start",
          type: "lesson",
          title: "Start",
          learningObjective: "start",
          completionMethod: "manual",
          xpReward: 10,
        },
      });
      const levelTwo = await prisma!.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleOne.id,
          levelNumber: 2,
          stableCode: "v2.l002.practice",
          type: "practice",
          title: "Practice",
          learningObjective: "practice",
          completionMethod: "manual",
          xpReward: 20,
          requiredPreviousLevel: 1,
        },
      });
      return { version, levelOne, levelTwo, levelThree };
    }

    const old = await curriculumVersion(1, "archived");
    const current = await curriculumVersion(2, "published");

    async function enrollment(
      userId: number,
      versionId: number,
      data: { status?: "active" | "completed"; currentLevel?: number; highest?: number; completedAt?: Date },
    ) {
      return prisma!.userCurriculumEnrollment.create({
        data: {
          userId,
          curriculumVersionId: versionId,
          curriculumCode: "ata-v2",
          status: data.status ?? "active",
          enrolledAt: ENROLLED_AT,
          currentLevel: data.currentLevel ?? 1,
          highestCompletedLevel: data.highest ?? 0,
          completedAt: data.completedAt,
        },
      });
    }

    await enrollment(available.id, current.version.id, {});
    await enrollment(archived.id, old.version.id, {});
    const persistedEnrollment = await enrollment(persisted.id, current.version.id, {
      currentLevel: 2,
      highest: 1,
    });
    const inProgressEnrollment = await enrollment(inProgress.id, current.version.id, {});
    const completedEnrollment = await enrollment(completed.id, current.version.id, {
      status: "completed",
      currentLevel: 4,
      highest: 3,
      completedAt: new Date("2026-07-13T16:00:00.000Z"),
    });
    const corruptEnrollment = await enrollment(corrupt.id, current.version.id, {
      currentLevel: 2,
      highest: 0,
    });

    async function progress(
      enrollmentId: number,
      levelDefinitionId: number,
      status: "in_progress" | "pending_review" | "completed",
      hour: number,
    ) {
      const startedAt = new Date(`2026-07-13T${String(hour).padStart(2, "0")}:00:00.000Z`);
      const isCompleted = status === "completed";
      return prisma!.userLevelProgress.create({
        data: {
          enrollmentId,
          curriculumVersionId: current.version.id,
          levelDefinitionId,
          status,
          startedAt,
          lastProgressAt: startedAt,
          completedAt: isCompleted ? startedAt : null,
          completionMethod: isCompleted ? "manual" : null,
          attemptCount: isCompleted ? 1 : 0,
        },
      });
    }

    await progress(persistedEnrollment.id, current.levelOne.id, "completed", 12);
    await progress(persistedEnrollment.id, current.levelTwo.id, "pending_review", 13);
    await progress(inProgressEnrollment.id, current.levelOne.id, "in_progress", 12);
    for (const [index, level] of [current.levelOne, current.levelTwo, current.levelThree].entries()) {
      await progress(completedEnrollment.id, level.id, "completed", 12 + index);
    }
    // Context is structurally readable, but effective-state summary is contradictory.
    await progress(corruptEnrollment.id, current.levelOne.id, "completed", 12);

    const anonymous = new HttpClient();
    const auditBeforeFlagOff = await prisma.auditLog.count();
    server = await startServer(false);

    await check("read flag off hides route before authentication", async () => {
      const response = await anonymous.get(CURRENT_PATH);
      assert.equal(response.status, 404);
      assert.deepEqual(response.json, { error: "NOT_FOUND" });
    });
    await check("read flag off wins over injected query and enabled mutation/admin flags", async () => {
      const response = await anonymous.get(`${CURRENT_PATH}?userId=${candidate.id}`);
      assert.equal(response.status, 404);
      assert.deepEqual(response.json, { error: "NOT_FOUND" });
    });
    await check("flag-off response is no-store", async () => {
      const response = await anonymous.get(CURRENT_PATH);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    });
    await check("flag-off requests do not audit or write", async () => {
      assert.equal(await prisma!.auditLog.count(), auditBeforeFlagOff);
      assert.equal(await prisma!.userCurriculumEnrollment.count(), 6);
    });

    await stopServer(server);
    server = null;
    server = await startServer(true);

    await check("read flag on plus anonymous returns 401", async () => {
      const response = await anonymous.get(CURRENT_PATH);
      assert.equal(response.status, 401);
    });

    const clients = new Map<string, HttpClient>();
    for (const account of [candidate, available, archived, persisted, inProgress, completed, corrupt, blockable]) {
      const client = new HttpClient();
      const login = await client.login(account.email);
      assert.equal(login.status, 200, `login failed for ${account.email}: ${login.text}`);
      clients.set(account.email, client);
    }
    await prisma.user.update({ where: { id: blockable.id }, data: { status: "blocked" } });

    const client = (email: string) => clients.get(email)!;
    const candidateClient = client(candidate.email);
    const availableClient = client(available.email);
    const archivedClient = client(archived.email);
    const persistedClient = client(persisted.email);
    const inProgressClient = client(inProgress.email);
    const completedClient = client(completed.email);
    const corruptClient = client(corrupt.email);
    const blockedClient = client(blockable.email);

    const enrollmentCount = await prisma.userCurriculumEnrollment.count();
    const progressCount = await prisma.userLevelProgress.count();
    const auditCount = await prisma.auditLog.count();
    const notificationCount = await prisma.notification.count();
    const timestampSnapshot = JSON.stringify({
      enrollments: await prisma.userCurriculumEnrollment.findMany({
        orderBy: { id: "asc" },
        select: { id: true, updatedAt: true, lastMeaningfulActionAt: true },
      }),
      progress: await prisma.userLevelProgress.findMany({
        orderBy: { id: "asc" },
        select: { id: true, updatedAt: true, lastProgressAt: true },
      }),
    });

    await check("blocked session returns 403 without endpoint audit", async () => {
      const response = await blockedClient.get(CURRENT_PATH);
      assert.equal(response.status, 403);
      assert.equal(await prisma!.auditLog.count(), auditCount);
    });
    await check("unexpected query parameter returns 400", async () => {
      const response = await candidateClient.get(`${CURRENT_PATH}?unexpected=1`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.json, { error: "INVALID_QUERY" });
    });
    for (const injected of ["userId", "actorId", "asOf", "version", "level"]) {
      await check(`${injected} query injection is rejected`, async () => {
        const response = await candidateClient.get(`${CURRENT_PATH}?${injected}=1`);
        assert.equal(response.status, 400);
      });
    }

    let candidateResponse!: ApiResponse;
    await check("active authenticated admin is allowed while admin/enrollment flags are off", async () => {
      candidateResponse = await candidateClient.get(CURRENT_PATH);
      assert.equal(candidateResponse.status, 200);
      assert.equal(data(candidateResponse).kind, "candidate");
    });
    await check("candidate exposes safe published summary and no enrollment", () => {
      const value = data(candidateResponse);
      assert.equal(value.enrollment, null);
      assert.deepEqual(value.curriculum, {
        code: "ata-v2",
        name: "ATA V2 version 2",
        versionNumber: 2,
        status: "published",
        effectiveFrom: null,
        publishedAt: PUBLISHED_AT.toISOString(),
        moduleCount: 2,
        levelCount: 3,
      });
      assert.equal("modules" in value, false);
    });
    await check("candidate GET does not auto-enroll", async () => {
      assert.equal(await prisma!.userCurriculumEnrollment.count({ where: { userId: candidate.id } }), 0);
    });

    let availableResponse!: ApiResponse;
    await check("enrolled published pin returns effective level states", async () => {
      availableResponse = await availableClient.get(CURRENT_PATH);
      assert.equal(availableResponse.status, 200);
      assert.equal(data(availableResponse).kind, "enrolled");
      assert.equal((data(availableResponse).curriculum as Record<string, unknown>).versionNumber, 2);
    });
    await check("modules and levels are deterministically ordered", () => {
      const modules = data(availableResponse).modules as Array<Record<string, unknown>>;
      assert.deepEqual(modules.map((module) => module.moduleNumber), [1, 2]);
      assert.deepEqual(
        modules.flatMap((module) => (module.levels as Array<Record<string, unknown>>).map((level) => level.levelNumber)),
        [1, 2, 3],
      );
    });
    await check("at most one level is available", () => {
      const modules = data(availableResponse).modules as Array<Record<string, unknown>>;
      const levels = modules.flatMap((module) => module.levels as Array<Record<string, unknown>>);
      assert.equal(levels.filter((level) => level.presentationState === "available").length, 1);
      assert.equal(levels[0].presentationState, "available");
      assert.equal(levels[0].durableStatus, null);
    });
    await check("unsupported XP checkpoint and visibility dependencies fail closed", () => {
      const modules = data(availableResponse).modules as Array<Record<string, unknown>>;
      const gated = (modules[1].levels as Array<Record<string, unknown>>)[0];
      const blockers = gated.blockers as string[];
      assert.ok(blockers.includes("xp_engine_unavailable"));
      assert.ok(blockers.includes("checkpoint_engine_unavailable"));
      assert.ok(blockers.includes("visibility_rule_unsupported"));
      assert.equal(gated.presentationState, "locked");
    });

    let persistedResponse!: ApiResponse;
    await check("persisted completed and pending-review states remain exact", async () => {
      persistedResponse = await persistedClient.get(CURRENT_PATH);
      assert.equal(persistedResponse.status, 200);
      const modules = data(persistedResponse).modules as Array<Record<string, unknown>>;
      const levels = modules.flatMap((module) => module.levels as Array<Record<string, unknown>>);
      assert.equal(levels[0].durableStatus, "completed");
      assert.equal(levels[0].presentationState, "completed");
      assert.equal(levels[1].durableStatus, "pending_review");
      assert.equal(levels[1].presentationState, "pending_review");
    });
    await check("persisted progress exposes only approved timestamps and status", () => {
      const modules = data(persistedResponse).modules as Array<Record<string, unknown>>;
      const progressValue = ((modules[0].levels as Array<Record<string, unknown>>)[0].progress ?? {}) as Record<string, unknown>;
      assert.equal(progressValue.status, "completed");
      assert.equal(typeof progressValue.startedAt, "string");
      assert.equal(typeof progressValue.lastProgressAt, "string");
      assert.equal(typeof progressValue.completedAt, "string");
    });
    await check("persisted in-progress state remains exact", async () => {
      const response = await inProgressClient.get(CURRENT_PATH);
      const modules = data(response).modules as Array<Record<string, unknown>>;
      const level = (modules[0].levels as Array<Record<string, unknown>>)[0];
      assert.equal(level.durableStatus, "in_progress");
      assert.equal(level.presentationState, "in_progress");
    });

    let archivedResponse!: ApiResponse;
    await check("archived enrollment renders its pinned historical version", async () => {
      archivedResponse = await archivedClient.get(CURRENT_PATH);
      assert.equal(archivedResponse.status, 200);
      const curriculum = data(archivedResponse).curriculum as Record<string, unknown>;
      assert.equal(curriculum.versionNumber, 1);
      assert.equal(curriculum.status, "archived");
    });
    await check("new published version does not replace archived pin", () => {
      const curriculum = data(archivedResponse).curriculum as Record<string, unknown>;
      assert.notEqual(curriculum.versionNumber, current.version.versionNumber);
      assert.equal((data(archivedResponse).enrollment as Record<string, unknown>).status, "active");
    });

    let completedResponse!: ApiResponse;
    await check("completed enrollment returns terminal completed history", async () => {
      completedResponse = await completedClient.get(CURRENT_PATH);
      assert.equal(completedResponse.status, 200);
      assert.equal(data(completedResponse).kind, "completed");
      const summary = data(completedResponse).enrollment as Record<string, unknown>;
      assert.equal(summary.status, "completed");
      assert.equal(summary.currentLevel, 4);
      assert.equal(summary.highestCompletedLevel, 3);
    });
    await check("completed user is not turned into candidate or re-enrolled", async () => {
      assert.equal(await prisma!.userCurriculumEnrollment.count({ where: { userId: completed.id } }), 1);
      assert.notEqual(data(completedResponse).kind, "candidate");
    });

    let corruptResponse!: ApiResponse;
    await check("corrupt effective state returns sanitized 409", async () => {
      corruptResponse = await corruptClient.get(CURRENT_PATH);
      assert.equal(corruptResponse.status, 409);
      assert.equal(body(corruptResponse).error, "CURRICULUM_STATE_CORRUPT");
      assert.equal(body(corruptResponse).reason, "invalid_summary_progress");
      assert.deepEqual(body(corruptResponse).issues, [{ code: "invalid_summary_progress" }]);
    });
    await check("corrupt response contains no raw database or runtime details", () => {
      assert.doesNotMatch(corruptResponse.text, /Prisma|SQLite|SELECT|INSERT|stack|\.ts:|\/home\/|password|email/i);
    });

    await check("every endpoint response is no-store", async () => {
      for (const response of [candidateResponse, availableResponse, persistedResponse, archivedResponse, completedResponse, corruptResponse]) {
        assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      }
    });
    await check("GET requires no CSRF token", async () => {
      const response = await availableClient.get(CURRENT_PATH, { "x-csrf-token": "" });
      assert.equal(response.status, 200);
    });
    await check("response mapper excludes sensitive and internal fields", () => {
      const keys = collectKeys(availableResponse.json);
      for (const forbidden of [
        "id",
        "userId",
        "email",
        "role",
        "passwordHash",
        "createdBy",
        "createdById",
        "migrationSource",
        "completionEvidence",
        "visibilityRule",
        "currentXp",
        "createdAt",
        "updatedAt",
      ]) {
        assert.equal(keys.has(forbidden), false, `unexpected response field ${forbidden}`);
      }
    });
    await check("definition XP is not presented as computed current XP", () => {
      const keys = collectKeys(availableResponse.json);
      assert.ok(keys.has("requiredXp"));
      assert.equal(keys.has("currentXp"), false);
    });

    const first = await availableClient.get(CURRENT_PATH);
    const second = await availableClient.get(CURRENT_PATH);
    await check("repeated GET is byte-equivalent", () => {
      assert.equal(first.status, second.status);
      assert.equal(first.text, second.text);
    });
    await check("GET creates no enrollment progress audit or notification rows", async () => {
      assert.equal(await prisma!.userCurriculumEnrollment.count(), enrollmentCount);
      assert.equal(await prisma!.userLevelProgress.count(), progressCount);
      assert.equal(await prisma!.auditLog.count(), auditCount);
      assert.equal(await prisma!.notification.count(), notificationCount);
    });
    await check("GET does not touch enrollment or progress timestamps", async () => {
      const currentSnapshot = JSON.stringify({
        enrollments: await prisma!.userCurriculumEnrollment.findMany({
          orderBy: { id: "asc" },
          select: { id: true, updatedAt: true, lastMeaningfulActionAt: true },
        }),
        progress: await prisma!.userLevelProgress.findMany({
          orderBy: { id: "asc" },
          select: { id: true, updatedAt: true, lastProgressAt: true },
        }),
      });
      assert.equal(currentSnapshot, timestampSnapshot);
    });

    await check("V1 authenticated levels read remains operational", async () => {
      const response = await availableClient.get("/api/levels");
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(body(response).levels));
    });
    await check("health remains 200", async () => {
      const response = await anonymous.get("/api/health");
      assert.equal(response.status, 200);
    });

    await prisma.curriculumVersion.update({
      where: { id: current.version.id },
      data: { status: "archived" },
    });
    await check("no published curriculum is a valid unavailable 200 state", async () => {
      const response = await candidateClient.get(CURRENT_PATH);
      assert.equal(response.status, 200);
      assert.deepEqual(data(response), { kind: "unavailable", reason: "no_published_version" });
    });

    await stopServer(server);
    server = null;
    await prisma.$disconnect();
    prisma = null;
    cleanupDb();

    await check("test server listener is removed", () => {
      assert.equal(listenerOnTestPort(), "");
    });
    await check("temporary SQLite files are removed", () => {
      for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
      }
    });
  } finally {
    await stopServer(server);
    await prisma?.$disconnect();
    cleanupDb();
  }

  console.log(`\nCurriculum read API regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  cleanupDb();
  process.exitCode = 1;
});
