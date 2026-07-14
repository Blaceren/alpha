import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

// Phase 1B.4 regression: feature-gated V2 curriculum admin API.
// Real HTTP test: an isolated `next dev` server on a non-live port, a
// throwaway SQLite DB in /tmp, real session cookies and CSRF tokens.
// Phase A runs with the feature flag disabled, phase B with it enabled.

const dbPath = `/tmp/ata-curriculum-admin-api-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const PORT = 3800 + (process.pid % 150);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "ApiRegression123!";

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
delete inheritedEnv.NODE_ENV;

const serverEnv: Record<string, string | undefined> = {
  ...inheritedEnv,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "api-regression-session-secret",
  POSTBACK_SECRET: "api-regression-postback-secret",
  APP_URL: BASE_URL,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};

type ApiResponse = {
  status: number;
  headers: Headers;
  json: unknown;
  text: string;
};

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
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
  }

  async request(
    method: string,
    requestPath: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse> {
    const response = await fetch(`${BASE_URL}${requestPath}`, {
      method,
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

  get(requestPath: string) {
    return this.request("GET", requestPath);
  }

  async csrfToken(): Promise<string> {
    const response = await this.get("/api/csrf");
    const body = response.json as { csrfToken?: string };
    if (!body?.csrfToken) throw new Error("failed to obtain csrf token");
    return body.csrfToken;
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

function dataOf(response: ApiResponse): Record<string, unknown> {
  return (body(response).data ?? {}) as Record<string, unknown>;
}

async function startServer(flagEnabled: boolean): Promise<ChildProcess> {
  const env = { ...serverEnv };
  if (flagEnabled) env.CURRICULUM_V2_ADMIN_ENABLED = "true";

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
      if (response.ok) break;
    } catch {
      // keep polling
    }
    if (Date.now() > deadline) {
      throw new Error("dev server did not become healthy in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return proc;
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

async function main() {
  cleanupDb();

  const runner = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    env: serverEnv as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  if (runner.status !== 0) {
    console.error(runner.stdout, runner.stderr);
    throw new Error(`migration runner exited with ${runner.status}`);
  }

  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");
  const authoring = await import("../../src/lib/curriculum/authoring");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const admin = await prisma.user.create({
    data: { email: "api-admin@example.com", name: "API Admin", role: "admin", passwordHash },
  });
  const regular = await prisma.user.create({
    data: { email: "api-user@example.com", name: "API User", passwordHash },
  });
  const blockable = await prisma.user.create({
    data: { email: "api-blocked@example.com", name: "API Blocked", role: "admin", passwordHash },
  });

  function levelInput(versionId: number, moduleId: number, levelNumber: number, type: string) {
    return {
      actorId: admin.id,
      curriculumVersionId: versionId,
      moduleId,
      levelNumber,
      stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.step-${levelNumber}`,
      type,
      title: `Level ${levelNumber}`,
      learningObjective: `objective ${levelNumber}`,
      completionMethod: type === "financial_checkpoint" ? "balance_check" : "manual",
      xpReward: 10,
      requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
    };
  }

  async function makePublishable(code: string, versionNumber: number) {
    const version = await authoring.createCurriculumDraft({
      actorId: admin.id,
      code,
      name: `${code} v${versionNumber}`,
      versionNumber,
    });
    const moduleDef = await authoring.createModuleDefinition({
      actorId: admin.id,
      curriculumVersionId: version.id,
      moduleNumber: 1,
      code: "m01",
      title: "Module 1",
      learningObjective: "objective",
      firstLevel: 1,
      lastLevel: 2,
      checkpointLevel: 2,
    });
    await authoring.createLevelDefinition(levelInput(version.id, moduleDef.id, 1, "lesson"));
    await authoring.createLevelDefinition(
      levelInput(version.id, moduleDef.id, 2, "financial_checkpoint"),
    );
    return version;
  }

  // Fixtures are prepared with domain authoring commands (allowed for this
  // phase because the Module/Level API does not exist yet) before any server
  // is started, so the two processes never write to SQLite concurrently.
  const fixValid1 = await makePublishable("api-pub", 1);
  const fixValid2 = await makePublishable("api-pub", 2);

  const fixInvalid = await authoring.createCurriculumDraft({
    actorId: admin.id,
    code: "api-bad",
    name: "Invalid draft",
    versionNumber: 1,
  });
  const fixInvalidModule = await authoring.createModuleDefinition({
    actorId: admin.id,
    curriculumVersionId: fixInvalid.id,
    moduleNumber: 1,
    code: "m01",
    title: "Incomplete",
    learningObjective: "objective",
    firstLevel: 1,
    lastLevel: 2,
  });
  await authoring.createLevelDefinition(levelInput(fixInvalid.id, fixInvalidModule.id, 1, "lesson"));

  const fixDetail = await authoring.createCurriculumDraft({
    actorId: admin.id,
    code: "api-detail",
    name: "Detail fixture",
    versionNumber: 1,
  });
  const detailModuleTwo = await authoring.createModuleDefinition({
    actorId: admin.id,
    curriculumVersionId: fixDetail.id,
    moduleNumber: 2,
    code: "m02",
    title: "Second",
    learningObjective: "objective",
    firstLevel: 2,
    lastLevel: 2,
  });
  const detailModuleOne = await authoring.createModuleDefinition({
    actorId: admin.id,
    curriculumVersionId: fixDetail.id,
    moduleNumber: 1,
    code: "m01",
    title: "First",
    learningObjective: "objective",
    firstLevel: 1,
    lastLevel: 1,
  });
  await authoring.createLevelDefinition(levelInput(fixDetail.id, detailModuleTwo.id, 2, "lesson"));
  await authoring.createLevelDefinition(levelInput(fixDetail.id, detailModuleOne.id, 1, "lesson"));

  const fixDeleteFull = await authoring.createCurriculumDraft({
    actorId: admin.id,
    code: "api-del-full",
    name: "Delete blocked",
    versionNumber: 1,
  });
  await authoring.createModuleDefinition({
    actorId: admin.id,
    curriculumVersionId: fixDeleteFull.id,
    moduleNumber: 1,
    code: "m01",
    title: "Keeps draft non-empty",
    learningObjective: "objective",
    firstLevel: 1,
    lastLevel: 1,
  });

  const auditBaseline = await prisma.auditLog.count({
    where: { action: "CURRICULUM_VERSION_PUBLISHED" },
  });

  let server: ChildProcess | null = null;

  try {
    // ---------- Phase A: feature flag disabled ----------
    server = await startServer(false);

    await check("1. flag disabled: API is not available", async () => {
      const anon = new HttpClient();
      const listResponse = await anon.get("/api/admin/curriculum/versions");
      assert.equal(listResponse.status, 404);
      assert.equal(body(listResponse).error, "NOT_FOUND");
      const postResponse = await anon.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "x", name: "x", versionNumber: 1 },
      });
      assert.equal(postResponse.status, 404);
    });

    await stopServer(server);
    server = null;

    // ---------- Phase B: feature flag enabled ----------
    server = await startServer(true);

    const anon = new HttpClient();
    await check("2. unauthenticated GET -> 401 with flag on", async () => {
      const response = await anon.get("/api/admin/curriculum/versions");
      assert.equal(response.status, 401);
    });

    const userClient = new HttpClient();
    await check("3. regular user -> 403", async () => {
      const login = await userClient.login(regular.email);
      assert.equal(login.status, 200, login.text);
      const response = await userClient.get("/api/admin/curriculum/versions");
      assert.equal(response.status, 403);
    });

    const blockedClient = new HttpClient();
    await check("4. inactive admin -> 403", async () => {
      const login = await blockedClient.login(blockable.email);
      assert.equal(login.status, 200, login.text);
      await prisma.user.update({ where: { id: blockable.id }, data: { status: "blocked" } });
      const response = await blockedClient.get("/api/admin/curriculum/versions");
      assert.equal(response.status, 403);
    });

    const adminClient = new HttpClient();
    let listResponse: ApiResponse | null = null;

    await check("5. active admin can GET list", async () => {
      const login = await adminClient.login(admin.email);
      assert.equal(login.status, 200, login.text);
      listResponse = await adminClient.get("/api/admin/curriculum/versions");
      assert.equal(listResponse.status, 200, listResponse.text);
    });

    await check("6. GET does not require CSRF", () => {
      assert.equal(listResponse?.status, 200);
    });

    await check("7. GET responds with Cache-Control: no-store", () => {
      assert.equal(listResponse?.headers.get("cache-control"), "no-store");
    });

    await check("8. pagination defaults", () => {
      const data = dataOf(listResponse!);
      const pagination = data.pagination as { page: number; limit: number; total: number };
      assert.equal(pagination.page, 1);
      assert.equal(pagination.limit, 20);
      assert.equal(pagination.total >= 5, true);
    });

    await check("9. invalid pagination -> 400", async () => {
      const pageZero = await adminClient.get("/api/admin/curriculum/versions?page=0");
      assert.equal(pageZero.status, 400);
      const badLimit = await adminClient.get("/api/admin/curriculum/versions?limit=abc");
      assert.equal(badLimit.status, 400);
    });

    await check("10. limit > 100 -> 400", async () => {
      const response = await adminClient.get("/api/admin/curriculum/versions?limit=101");
      assert.equal(response.status, 400);
    });

    await check("11. status filter works", async () => {
      const response = await adminClient.get("/api/admin/curriculum/versions?status=draft&limit=100");
      assert.equal(response.status, 200);
      const data = dataOf(response);
      const items = data.items as Array<{ status: string }>;
      assert.equal(items.length >= 5, true);
      assert.equal(items.every((item) => item.status === "draft"), true);
    });

    await check("12. POST without CSRF -> 403", async () => {
      const response = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "api-created", name: "Created", versionNumber: 1 },
      });
      assert.equal(response.status, 403);
    });

    await check("13. POST with wrong CSRF -> 403", async () => {
      await adminClient.csrfToken();
      const response = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "api-created", name: "Created", versionNumber: 1 },
        headers: { "x-csrf-token": "definitely-wrong" },
      });
      assert.equal(response.status, 403);
    });

    const csrf = await adminClient.csrfToken();
    let createdId = 0;

    await check("14. POST with valid CSRF creates draft -> 201", async () => {
      const response = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "api-created", name: "Created", versionNumber: 1 },
        headers: { "x-csrf-token": csrf },
      });
      assert.equal(response.status, 201, response.text);
      const data = dataOf(response) as { id: number; status: string; publishedAt: unknown; createdById: number };
      createdId = data.id;
      assert.equal(data.status, "draft");
      assert.equal(data.publishedAt, null);
      assert.equal(data.createdById, admin.id);
    });

    await check("15. actorId/createdBy/status cannot be spoofed", async () => {
      const response = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: {
          code: "api-spoof",
          name: "Spoof",
          versionNumber: 1,
          actorId: regular.id,
          createdBy: regular.id,
          status: "published",
        },
        headers: { "x-csrf-token": csrf },
      });
      assert.equal(response.status, 400);
      const detail = await adminClient.get(`/api/admin/curriculum/versions/${createdId}`);
      assert.equal((dataOf(detail) as { createdById: number }).createdById, admin.id);
    });

    await check("16. unknown body keys rejected", async () => {
      const response = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "api-unknown", name: "X", versionNumber: 1, totallyUnknown: true },
        headers: { "x-csrf-token": csrf },
      });
      assert.equal(response.status, 400);
    });

    await check("17. duplicate code/version -> 409", async () => {
      const response = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "api-created", name: "Duplicate", versionNumber: 1 },
        headers: { "x-csrf-token": csrf },
      });
      assert.equal(response.status, 409);
      assert.equal(body(response).error, "CURRICULUM_CONFLICT");
    });

    await check("18. GET detail returns deterministic modules/levels", async () => {
      const response = await adminClient.get(`/api/admin/curriculum/versions/${fixDetail.id}`);
      assert.equal(response.status, 200);
      const data = dataOf(response) as {
        modules: Array<{ moduleNumber: number }>;
        levels: Array<{ levelNumber: number }>;
        createdBy: Record<string, unknown> | null;
      };
      assert.deepEqual(data.modules.map((m) => m.moduleNumber), [1, 2]);
      assert.deepEqual(data.levels.map((l) => l.levelNumber), [1, 2]);
      if (data.createdBy) {
        assert.deepEqual(Object.keys(data.createdBy).sort(), ["email", "id", "name"]);
      }
    });

    await check("19. invalid path ID -> 400", async () => {
      const response = await adminClient.get("/api/admin/curriculum/versions/abc");
      assert.equal(response.status, 400);
    });

    await check("20. missing ID -> 404", async () => {
      const response = await adminClient.get("/api/admin/curriculum/versions/999999");
      assert.equal(response.status, 404);
    });

    await check("21. PATCH updates allowed fields", async () => {
      const response = await adminClient.request(
        "PATCH",
        `/api/admin/curriculum/versions/${createdId}`,
        { body: { name: "Created (renamed)", changeNotes: "note" }, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 200, response.text);
      assert.equal((dataOf(response) as { name: string }).name, "Created (renamed)");
    });

    await check("22. empty PATCH -> 400", async () => {
      const response = await adminClient.request(
        "PATCH",
        `/api/admin/curriculum/versions/${createdId}`,
        { body: {}, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 400);
    });

    await check("23. no-change PATCH -> 409 CURRICULUM_NO_CHANGES", async () => {
      const response = await adminClient.request(
        "PATCH",
        `/api/admin/curriculum/versions/${createdId}`,
        { body: { name: "Created (renamed)" }, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 409);
      assert.equal(body(response).error, "CURRICULUM_NO_CHANGES");
    });

    await check("24. PATCH identity fields rejected", async () => {
      const response = await adminClient.request(
        "PATCH",
        `/api/admin/curriculum/versions/${createdId}`,
        { body: { code: "hacked", versionNumber: 5 }, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 400);
    });

    await check("28. publish invalid draft -> 422 with issues", async () => {
      const response = await adminClient.request(
        "POST",
        `/api/admin/curriculum/versions/${fixInvalid.id}/publish`,
        { body: {}, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 422, response.text);
      assert.equal(body(response).error, "CURRICULUM_INVALID");
      const issues = body(response).issues as Array<{ code: string }>;
      assert.equal(issues.length >= 1, true);
      assert.equal(issues.some((issue) => issue.code === "LEVEL_RANGE_INCOMPLETE"), true);
    });

    await check("29. publish valid draft succeeds", async () => {
      const response = await adminClient.request(
        "POST",
        `/api/admin/curriculum/versions/${fixValid1.id}/publish`,
        { body: {}, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 200, response.text);
      const data = dataOf(response) as { published: { status: string; publishedAt: string | null } };
      assert.equal(data.published.status, "published");
      assert.notEqual(data.published.publishedAt, null);
    });

    await check("25. published version cannot be modified -> 409", async () => {
      const response = await adminClient.request(
        "PATCH",
        `/api/admin/curriculum/versions/${fixValid1.id}`,
        { body: { name: "hack" }, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 409);
      assert.equal(body(response).error, "CURRICULUM_PUBLISHED_IMMUTABLE");
    });

    await check("30. replacement without expectedPublishedVersionId -> 409", async () => {
      const response = await adminClient.request(
        "POST",
        `/api/admin/curriculum/versions/${fixValid2.id}/publish`,
        { body: {}, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 409);
      assert.equal(body(response).error, "CURRICULUM_REPLACEMENT_REQUIRED");
    });

    await check("31. replacement with wrong ID -> 409", async () => {
      const response = await adminClient.request(
        "POST",
        `/api/admin/curriculum/versions/${fixValid2.id}/publish`,
        { body: { expectedPublishedVersionId: 999999 }, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 409);
      assert.equal(body(response).error, "CURRICULUM_REPLACEMENT_MISMATCH");
    });

    await check("32. replacement with correct ID succeeds", async () => {
      const response = await adminClient.request(
        "POST",
        `/api/admin/curriculum/versions/${fixValid2.id}/publish`,
        { body: { expectedPublishedVersionId: fixValid1.id }, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 200, response.text);
      const oldDetail = await adminClient.get(`/api/admin/curriculum/versions/${fixValid1.id}`);
      assert.equal((dataOf(oldDetail) as { status: string }).status, "archived");
    });

    await check("33. archive published version succeeds", async () => {
      const response = await adminClient.request(
        "POST",
        `/api/admin/curriculum/versions/${fixValid2.id}/archive`,
        { body: {}, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 200, response.text);
      assert.equal((dataOf(response) as { status: string }).status, "archived");
    });

    await check("34. lifecycle success audit carries session actorId", async () => {
      const publishedAudits = await prisma.auditLog.findMany({
        where: { action: "CURRICULUM_VERSION_PUBLISHED" },
        orderBy: { id: "asc" },
      });
      assert.equal(publishedAudits.length, auditBaseline + 2);
      for (const entry of publishedAudits) {
        assert.equal(entry.userId, admin.id);
        assert.equal((entry.metadata as { actorId?: number }).actorId, admin.id);
      }
    });

    await check("35. request body actorId never has any effect", async () => {
      const response = await adminClient.request(
        "POST",
        `/api/admin/curriculum/versions/${fixInvalid.id}/publish`,
        { body: { actorId: regular.id }, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 400);
      const archiveSpoof = await adminClient.request(
        "POST",
        `/api/admin/curriculum/versions/${fixValid2.id}/archive`,
        { body: { actorId: regular.id }, headers: { "x-csrf-token": csrf } },
      );
      assert.equal(archiveSpoof.status, 400);
    });

    await check("26. DELETE of empty draft succeeds", async () => {
      const create = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "api-tmp-del", name: "Temp", versionNumber: 1 },
        headers: { "x-csrf-token": csrf },
      });
      assert.equal(create.status, 201);
      const id = (dataOf(create) as { id: number }).id;
      const response = await adminClient.request(
        "DELETE",
        `/api/admin/curriculum/versions/${id}`,
        { headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 200, response.text);
      const detail = await adminClient.get(`/api/admin/curriculum/versions/${id}`);
      assert.equal(detail.status, 404);
    });

    await check("27. DELETE of draft with definitions -> 409", async () => {
      const response = await adminClient.request(
        "DELETE",
        `/api/admin/curriculum/versions/${fixDeleteFull.id}`,
        { headers: { "x-csrf-token": csrf } },
      );
      assert.equal(response.status, 409);
      assert.equal(body(response).error, "CURRICULUM_NOT_EMPTY");
    });

    await check("37. errors do not leak Prisma/SQL/stack", async () => {
      const conflict = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "api-created", name: "Dup", versionNumber: 1 },
        headers: { "x-csrf-token": csrf },
      });
      assert.equal(conflict.status, 409);
      const badId = await adminClient.get("/api/admin/curriculum/versions/abc");
      for (const text of [conflict.text, badId.text]) {
        assert.equal(/prisma|sqlite|P20\d\d|stack|\/home\/|node_modules/i.test(text), false, text);
      }
    });

    // Ordered last among writes: the shared per-admin rate-limit bucket (now
    // covering every curriculum admin mutation) is exhausted here, so no
    // curriculum write must follow this hammer.
    await check("36. rate limit really returns 429", async () => {
      let got429 = false;
      for (let i = 0; i < 60; i += 1) {
        const response = await adminClient.request(
          "DELETE",
          "/api/admin/curriculum/versions/999999",
          { headers: { "x-csrf-token": csrf } },
        );
        if (response.status === 429) {
          got429 = true;
          assert.equal(body(response).error, "RATE_LIMITED");
          break;
        }
        assert.equal(response.status, 404);
      }
      assert.equal(got429, true, "expected a 429 within 60 delete attempts");
    });

    await check("38. V1 API and tables untouched", async () => {
      const health = await fetch(`${BASE_URL}/api/health`);
      assert.equal(health.ok, true);
      assert.equal(await prisma.task.count(), 0);
      assert.equal(await prisma.level.count(), 0);
      const tables = (
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
      ).map((row) => row.name);
      for (const table of ["Task", "Level", "UserTaskProgress"]) {
        assert.equal(tables.includes(table), true);
      }
    });
  } finally {
    await stopServer(server);
    await (await import("../../src/lib/prisma")).prisma.$disconnect();
    cleanupDb();
  }

  await check("39. server stopped and temporary DB removed", async () => {
    assert.equal(fs.existsSync(dbPath), false);
    let alive = true;
    try {
      await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "dev server is still responding");
  });
}

main()
  .then(() => {
    console.log(`\ncurriculum admin api regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum admin api regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
