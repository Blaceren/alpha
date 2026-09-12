import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

// Phase 1B.5 regression: feature-gated V2 curriculum Module/Level admin API.
// Real HTTP test: isolated `next dev` on a non-live port, throwaway SQLite in
// /tmp, real session cookies and CSRF. Phase A: flag disabled. Phase B: enabled.
// Fixtures are built with domain authoring commands before the server starts.

const dbPath = `/tmp/ata-curriculum-definitions-api-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const PORT = 3960 + (process.pid % 30);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "DefinitionsApi123!";

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

function sc(levelNumber: number, slug: string) {
  return `v2.l${String(levelNumber).padStart(3, "0")}.${slug}`;
}

const inheritedEnv: Record<string, string | undefined> = { ...process.env };
delete inheritedEnv.CURRICULUM_V2_ADMIN_ENABLED;
delete inheritedEnv.NODE_ENV;

const serverEnv: Record<string, string | undefined> = {
  ...inheritedEnv,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "definitions-api-session-secret",
  POSTBACK_SECRET: "definitions-api-postback-secret",
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
    const value = (response.json as { csrfToken?: string })?.csrfToken;
    if (!value) throw new Error("failed to obtain csrf token");
    return value;
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
    if (Date.now() > deadline) throw new Error("dev server did not become healthy in time");
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
  const { publishCurriculumVersion, archiveCurriculumVersion } = await import(
    "../../src/lib/curriculum/service"
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const admin = await prisma.user.create({
    data: { email: "def-admin@example.com", name: "Def Admin", role: "admin", passwordHash },
  });
  const regular = await prisma.user.create({
    data: { email: "def-user@example.com", name: "Def User", passwordHash },
  });
  const blockable = await prisma.user.create({
    data: { email: "def-blocked@example.com", name: "Def Blocked", role: "admin", passwordHash },
  });
  const rateAdmin = await prisma.user.create({
    data: { email: "def-rate@example.com", name: "Def Rate", role: "admin", passwordHash },
  });

  const A = admin.id;

  async function draft(code: string) {
    return authoring.createCurriculumDraft({ actorId: A, code, name: `${code} v1`, versionNumber: 1 });
  }
  async function moduleIn(versionId: number, over: Record<string, unknown>) {
    return authoring.createModuleDefinition({
      actorId: A,
      curriculumVersionId: versionId,
      description: "",
      learningObjective: "objective",
      status: "active",
      ...over,
    });
  }
  async function levelIn(versionId: number, moduleId: number, over: Record<string, unknown>) {
    return authoring.createLevelDefinition({
      actorId: A,
      curriculumVersionId: versionId,
      moduleId,
      learningObjective: "objective",
      completionMethod: "manual",
      xpReward: 10,
      requiredXp: 0,
      status: "active",
      ...over,
    });
  }

  // draftModules: module CRUD assertions.
  const draftModules = await draft("b5-mod");
  const dm1 = await moduleIn(draftModules.id, {
    moduleNumber: 1, code: "m01", title: "Module 1", firstLevel: 1, lastLevel: 5,
  });
  const dm2 = await moduleIn(draftModules.id, {
    moduleNumber: 2, code: "m02", title: "Module 2", firstLevel: 6, lastLevel: 7,
  });
  await levelIn(draftModules.id, dm2.id, {
    levelNumber: 6, stableCode: sc(6, "in-dm2"), type: "lesson", title: "L6",
    requiredPreviousLevel: 5,
  });

  // draftOther: for cross-version ownership on modules.
  const draftOther = await draft("b5-other");
  await moduleIn(draftOther.id, {
    moduleNumber: 1, code: "m01", title: "Other Module", firstLevel: 1, lastLevel: 3,
  });

  // draftLevels: level CRUD assertions.
  const draftLevels = await draft("b5-lvl");
  const lmA = await moduleIn(draftLevels.id, {
    moduleNumber: 1, code: "m01", title: "LM A", firstLevel: 1, lastLevel: 10,
  });
  const lmB = await moduleIn(draftLevels.id, {
    moduleNumber: 2, code: "m02", title: "LM B", firstLevel: 1, lastLevel: 10,
  });
  const lx = await levelIn(draftLevels.id, lmA.id, {
    levelNumber: 1, stableCode: sc(1, "existing"), type: "lesson", title: "LX", requiredPreviousLevel: null,
  });

  // draftLevelOther: cross-version ownership on levels/modules.
  const draftLevelOther = await draft("b5-lvlo");
  const loModule = await moduleIn(draftLevelOther.id, {
    moduleNumber: 1, code: "m01", title: "LO Module", firstLevel: 1, lastLevel: 5,
  });
  const loLevel = await levelIn(draftLevelOther.id, loModule.id, {
    levelNumber: 1, stableCode: sc(1, "other"), type: "lesson", title: "LO", requiredPreviousLevel: null,
  });

  async function buildPublishable(code: string) {
    const version = await draft(code);
    const moduleDef = await moduleIn(version.id, {
      moduleNumber: 1, code: "m01", title: "M1", firstLevel: 1, lastLevel: 2, checkpointLevel: 2,
    });
    await levelIn(version.id, moduleDef.id, {
      levelNumber: 1, stableCode: sc(1, "start"), type: "external_event",
      completionMethod: "pocket_postback", title: "Start", requiredPreviousLevel: null,
    });
    await levelIn(version.id, moduleDef.id, {
      levelNumber: 2, stableCode: sc(2, "checkpoint"), type: "financial_checkpoint",
      completionMethod: "balance_check", title: "Checkpoint", requiredPreviousLevel: 1,
    });
    return { version, moduleDef };
  }

  const publishedFix = await buildPublishable("b5-pub");
  await publishCurriculumVersion({ curriculumVersionId: publishedFix.version.id, actorId: A });

  const archivedFix = await buildPublishable("b5-arch");
  await publishCurriculumVersion({ curriculumVersionId: archivedFix.version.id, actorId: A });
  await archiveCurriculumVersion({ curriculumVersionId: archivedFix.version.id, actorId: A });

  const modulePath = (versionId: number) => `/api/admin/curriculum/versions/${versionId}/modules`;
  const moduleIdPath = (versionId: number, moduleId: number) => `${modulePath(versionId)}/${moduleId}`;
  const levelPath = (versionId: number) => `/api/admin/curriculum/versions/${versionId}/levels`;
  const levelIdPath = (versionId: number, levelId: number) => `${levelPath(versionId)}/${levelId}`;

  let server: ChildProcess | null = null;

  try {
    // ---------- Phase A: feature flag disabled ----------
    server = await startServer(false);

    await check("1. flag off: new module/level routes 404", async () => {
      const anon = new HttpClient();
      const m = await anon.request("POST", modulePath(draftModules.id), {
        body: { moduleNumber: 9, code: "x", title: "x", firstLevel: 1, lastLevel: 1, learningObjective: "o" },
      });
      assert.equal(m.status, 404);
      assert.equal(body(m).error, "NOT_FOUND");
      const l = await anon.request("POST", levelPath(draftLevels.id), { body: {} });
      assert.equal(l.status, 404);
    });

    await stopServer(server);
    server = null;

    // ---------- Phase B: feature flag enabled ----------
    server = await startServer(true);

    const anon = new HttpClient();
    await check("2. anonymous -> 401", async () => {
      const r = await anon.request("POST", modulePath(draftModules.id), { body: {} });
      assert.equal(r.status, 401);
    });

    const userClient = new HttpClient();
    await check("3. non-admin -> 403", async () => {
      assert.equal((await userClient.login(regular.email)).status, 200);
      const r = await userClient.request("POST", modulePath(draftModules.id), { body: {} });
      assert.equal(r.status, 403);
    });

    const blockedClient = new HttpClient();
    await check("4. inactive admin -> 403", async () => {
      assert.equal((await blockedClient.login(blockable.email)).status, 200);
      await prisma.user.update({ where: { id: blockable.id }, data: { status: "blocked" } });
      const r = await blockedClient.request("POST", modulePath(draftModules.id), { body: {} });
      assert.equal(r.status, 403);
    });

    const adminClient = new HttpClient();
    assert.equal((await adminClient.login(admin.email)).status, 200);
    const csrf = await adminClient.csrfToken();
    const withCsrf = { "x-csrf-token": csrf };

    const validModuleBody = {
      moduleNumber: 3, code: "m03", title: "Module 3", firstLevel: 8, lastLevel: 9, learningObjective: "o",
    };

    await check("5. POST module without CSRF -> 403", async () => {
      const r = await adminClient.request("POST", modulePath(draftModules.id), { body: validModuleBody });
      assert.equal(r.status, 403);
    });

    await check("6. unknown module body field -> 400", async () => {
      const r = await adminClient.request("POST", modulePath(draftModules.id), {
        body: { ...validModuleBody, surprise: true }, headers: withCsrf,
      });
      assert.equal(r.status, 400);
    });

    await check("7. spoof actorId/curriculumVersionId -> 400", async () => {
      const r = await adminClient.request("POST", modulePath(draftModules.id), {
        body: { ...validModuleBody, actorId: regular.id, curriculumVersionId: draftOther.id }, headers: withCsrf,
      });
      assert.equal(r.status, 400);
    });

    let createdModuleId = 0;
    await check("8. active admin creates module -> 201", async () => {
      const r = await adminClient.request("POST", modulePath(draftModules.id), {
        body: validModuleBody, headers: withCsrf,
      });
      assert.equal(r.status, 201, r.text);
      const data = dataOf(r) as { id: number; curriculumVersionId: number; status: string };
      createdModuleId = data.id;
      assert.equal(data.curriculumVersionId, draftModules.id);
      assert.equal(data.status, "active");
    });

    await check("9. session actor lands in audit", async () => {
      const auditRow = await prisma.auditLog.findFirst({
        where: { action: "MODULE_DEFINITION_CREATED" },
        orderBy: { id: "desc" },
      });
      assert.equal(auditRow?.userId, admin.id);
      assert.equal((auditRow?.metadata as { actorId?: number }).actorId, admin.id);
      assert.equal((auditRow?.metadata as { moduleDefinitionId?: number }).moduleDefinitionId, createdModuleId);
    });

    await check("10. duplicate module -> 409", async () => {
      const r = await adminClient.request("POST", modulePath(draftModules.id), {
        body: { moduleNumber: 1, code: "m01-dup", title: "Dup", firstLevel: 8, lastLevel: 9, learningObjective: "o" },
        headers: withCsrf,
      });
      assert.equal(r.status, 409);
      assert.equal(body(r).error, "MODULE_CONFLICT");
    });

    await check("11. invalid module input -> 400", async () => {
      const r = await adminClient.request("POST", modulePath(draftModules.id), {
        body: { moduleNumber: 4, code: "m04", title: "Bad", firstLevel: 9, lastLevel: 3, learningObjective: "o" },
        headers: withCsrf,
      });
      assert.equal(r.status, 400);
      assert.equal(body(r).error, "CURRICULUM_INPUT_INVALID");
    });

    await check("12. PATCH module works", async () => {
      const r = await adminClient.request("PATCH", moduleIdPath(draftModules.id, dm1.id), {
        body: { title: "Module 1 (renamed)" }, headers: withCsrf,
      });
      assert.equal(r.status, 200, r.text);
      assert.equal((dataOf(r) as { title: string }).title, "Module 1 (renamed)");
    });

    await check("13. empty module PATCH -> 400", async () => {
      const r = await adminClient.request("PATCH", moduleIdPath(draftModules.id, dm1.id), {
        body: {}, headers: withCsrf,
      });
      assert.equal(r.status, 400);
    });

    await check("14. no-change module PATCH -> 409 MODULE_NO_CHANGES (no audit)", async () => {
      const before = await prisma.auditLog.count({ where: { action: "MODULE_DEFINITION_UPDATED" } });
      const r = await adminClient.request("PATCH", moduleIdPath(draftModules.id, dm1.id), {
        body: { title: "Module 1 (renamed)" }, headers: withCsrf,
      });
      assert.equal(r.status, 409);
      assert.equal(body(r).error, "MODULE_NO_CHANGES");
      const after = await prisma.auditLog.count({ where: { action: "MODULE_DEFINITION_UPDATED" } });
      assert.equal(after, before);
    });

    await check("15. module of another version via path -> 404", async () => {
      const r = await adminClient.request("PATCH", moduleIdPath(draftOther.id, dm1.id), {
        body: { title: "hijack" }, headers: withCsrf,
      });
      assert.equal(r.status, 404);
      assert.equal(body(r).error, "MODULE_NOT_FOUND");
      const fresh = await prisma.moduleDefinition.findUniqueOrThrow({ where: { id: dm1.id } });
      assert.notEqual(fresh.title, "hijack");
    });

    await check("16. empty module can be deleted", async () => {
      const create = await adminClient.request("POST", modulePath(draftModules.id), {
        body: { moduleNumber: 5, code: "m05", title: "Empty", firstLevel: 10, lastLevel: 11, learningObjective: "o" },
        headers: withCsrf,
      });
      assert.equal(create.status, 201);
      const id = (dataOf(create) as { id: number }).id;
      const del = await adminClient.request("DELETE", moduleIdPath(draftModules.id, id), { headers: withCsrf });
      assert.equal(del.status, 200, del.text);
      assert.equal(await prisma.moduleDefinition.findUnique({ where: { id } }), null);
    });

    await check("17. module with levels cannot be deleted -> 409", async () => {
      const r = await adminClient.request("DELETE", moduleIdPath(draftModules.id, dm2.id), { headers: withCsrf });
      assert.equal(r.status, 409);
      assert.equal(body(r).error, "MODULE_NOT_EMPTY");
    });

    const validLevelBody = {
      moduleId: lmA.id, levelNumber: 2, stableCode: sc(2, "created"), type: "lesson",
      title: "Created level", learningObjective: "o", completionMethod: "manual",
      xpReward: 10, requiredXp: 0, requiredPreviousLevel: 1,
    };

    await check("18. POST level without CSRF -> 403", async () => {
      const r = await adminClient.request("POST", levelPath(draftLevels.id), { body: validLevelBody });
      assert.equal(r.status, 403);
    });

    await check("19. unknown level body field -> 400", async () => {
      const r = await adminClient.request("POST", levelPath(draftLevels.id), {
        body: { ...validLevelBody, surprise: 1 }, headers: withCsrf,
      });
      assert.equal(r.status, 400);
    });

    await check("20. visibilityRule/contentVersionId/assessmentVersionId rejected", async () => {
      for (const bad of [{ visibilityRule: { kind: "x" } }, { contentVersionId: 1 }, { assessmentVersionId: 1 }]) {
        const r = await adminClient.request("POST", levelPath(draftLevels.id), {
          body: { ...validLevelBody, levelNumber: 3, stableCode: sc(3, "vis"), ...bad }, headers: withCsrf,
        });
        assert.equal(r.status, 400, JSON.stringify(bad));
      }
    });

    let createdLevelId = 0;
    await check("21. active admin creates level -> 201", async () => {
      const r = await adminClient.request("POST", levelPath(draftLevels.id), { body: validLevelBody, headers: withCsrf });
      assert.equal(r.status, 201, r.text);
      const data = dataOf(r) as { id: number; curriculumVersionId: number; visibilityRule: unknown };
      createdLevelId = data.id;
      assert.equal(data.curriculumVersionId, draftLevels.id);
      assert.equal(data.visibilityRule, null);
    });

    await check("22. invalid stableCode -> 400", async () => {
      const r = await adminClient.request("POST", levelPath(draftLevels.id), {
        body: { ...validLevelBody, levelNumber: 4, stableCode: "V2.L004.Bad" }, headers: withCsrf,
      });
      assert.equal(r.status, 400);
    });

    await check("23. stableCode number mismatch -> 400", async () => {
      const r = await adminClient.request("POST", levelPath(draftLevels.id), {
        body: { ...validLevelBody, levelNumber: 4, stableCode: sc(9, "mismatch") }, headers: withCsrf,
      });
      assert.equal(r.status, 400);
      assert.equal(body(r).error, "CURRICULUM_INPUT_INVALID");
    });

    await check("24. duplicate level -> 409", async () => {
      // levelNumber 1 duplicates lx; requiredPreviousLevel null keeps the input
      // valid so the unique(levelNumber) conflict is the failure, not a 400.
      const r = await adminClient.request("POST", levelPath(draftLevels.id), {
        body: { ...validLevelBody, levelNumber: 1, stableCode: sc(1, "dup"), requiredPreviousLevel: null },
        headers: withCsrf,
      });
      assert.equal(r.status, 409);
      assert.equal(body(r).error, "LEVEL_CONFLICT");
    });

    await check("25. module of another version at create level -> 404", async () => {
      const r = await adminClient.request("POST", levelPath(draftLevels.id), {
        body: { ...validLevelBody, moduleId: loModule.id, levelNumber: 5, stableCode: sc(5, "xver") }, headers: withCsrf,
      });
      assert.equal(r.status, 404);
      assert.equal(body(r).error, "MODULE_NOT_FOUND");
    });

    await check("26. PATCH level works", async () => {
      const r = await adminClient.request("PATCH", levelIdPath(draftLevels.id, lx.id), {
        body: { title: "LX (renamed)" }, headers: withCsrf,
      });
      assert.equal(r.status, 200, r.text);
      assert.equal((dataOf(r) as { title: string }).title, "LX (renamed)");
    });

    await check("27. empty level PATCH -> 400", async () => {
      const r = await adminClient.request("PATCH", levelIdPath(draftLevels.id, lx.id), { body: {}, headers: withCsrf });
      assert.equal(r.status, 400);
    });

    await check("28. no-change level PATCH -> 409 LEVEL_NO_CHANGES (no audit)", async () => {
      const before = await prisma.auditLog.count({ where: { action: "LEVEL_DEFINITION_UPDATED" } });
      const r = await adminClient.request("PATCH", levelIdPath(draftLevels.id, lx.id), {
        body: { title: "LX (renamed)" }, headers: withCsrf,
      });
      assert.equal(r.status, 409);
      assert.equal(body(r).error, "LEVEL_NO_CHANGES");
      const after = await prisma.auditLog.count({ where: { action: "LEVEL_DEFINITION_UPDATED" } });
      assert.equal(after, before);
    });

    await check("29. level of another version via path -> 404", async () => {
      const r = await adminClient.request("PATCH", levelIdPath(draftLevels.id, loLevel.id), {
        body: { title: "hijack" }, headers: withCsrf,
      });
      assert.equal(r.status, 404);
      assert.equal(body(r).error, "LEVEL_NOT_FOUND");
    });

    await check("30. level can move between modules of the same version", async () => {
      const r = await adminClient.request("PATCH", levelIdPath(draftLevels.id, lx.id), {
        body: { moduleId: lmB.id }, headers: withCsrf,
      });
      assert.equal(r.status, 200, r.text);
      assert.equal((dataOf(r) as { moduleId: number }).moduleId, lmB.id);
    });

    await check("31. level cannot move to a module of another version -> 404", async () => {
      const r = await adminClient.request("PATCH", levelIdPath(draftLevels.id, lx.id), {
        body: { moduleId: loModule.id }, headers: withCsrf,
      });
      assert.equal(r.status, 404);
      assert.equal(body(r).error, "MODULE_NOT_FOUND");
    });

    await check("32. level can be deleted", async () => {
      const del = await adminClient.request("DELETE", levelIdPath(draftLevels.id, createdLevelId), { headers: withCsrf });
      assert.equal(del.status, 200, del.text);
      assert.equal(await prisma.levelDefinition.findUnique({ where: { id: createdLevelId } }), null);
    });

    await check("33. published version blocks module mutation -> 409", async () => {
      const r = await adminClient.request("PATCH", moduleIdPath(publishedFix.version.id, publishedFix.moduleDef.id), {
        body: { title: "hack" }, headers: withCsrf,
      });
      assert.equal(r.status, 409);
      assert.equal(body(r).error, "CURRICULUM_PUBLISHED_IMMUTABLE");
    });

    await check("34. published version blocks level mutation -> 409", async () => {
      const r = await adminClient.request("POST", levelPath(publishedFix.version.id), {
        body: { moduleId: publishedFix.moduleDef.id, levelNumber: 3, stableCode: sc(3, "extra"), type: "lesson",
          title: "Extra", learningObjective: "o", completionMethod: "manual", xpReward: 5, requiredXp: 0 },
        headers: withCsrf,
      });
      assert.equal(r.status, 409);
      assert.equal(body(r).error, "CURRICULUM_PUBLISHED_IMMUTABLE");
    });

    await check("35. archived version blocks mutations -> 409", async () => {
      const r = await adminClient.request("PATCH", moduleIdPath(archivedFix.version.id, archivedFix.moduleDef.id), {
        body: { title: "hack" }, headers: withCsrf,
      });
      assert.equal(r.status, 409);
      assert.equal(body(r).error, "CURRICULUM_ARCHIVED_IMMUTABLE");
    });

    await check("38. GET version detail reflects created/modified definitions", async () => {
      const r = await adminClient.get(`/api/admin/curriculum/versions/${draftModules.id}`);
      assert.equal(r.status, 200);
      const data = dataOf(r) as { modules: Array<{ id: number; title: string }> };
      const renamed = data.modules.find((m) => m.id === dm1.id);
      assert.equal(renamed?.title, "Module 1 (renamed)");
      assert.equal(data.modules.some((m) => m.id === createdModuleId), true);
    });

    let flowVersionId = 0;
    await check("39. full HTTP flow: draft -> module -> levels -> publish", async () => {
      const draftResp = await adminClient.request("POST", "/api/admin/curriculum/versions", {
        body: { code: "b5-flow", name: "Flow", versionNumber: 1 }, headers: withCsrf,
      });
      assert.equal(draftResp.status, 201, draftResp.text);
      flowVersionId = (dataOf(draftResp) as { id: number }).id;

      const moduleResp = await adminClient.request("POST", modulePath(flowVersionId), {
        body: { moduleNumber: 1, code: "m01", title: "Flow M1", firstLevel: 1, lastLevel: 2,
          checkpointLevel: 2, learningObjective: "o" },
        headers: withCsrf,
      });
      assert.equal(moduleResp.status, 201, moduleResp.text);
      const flowModuleId = (dataOf(moduleResp) as { id: number }).id;

      const l1 = await adminClient.request("POST", levelPath(flowVersionId), {
        body: { moduleId: flowModuleId, levelNumber: 1, stableCode: sc(1, "flow-start"), type: "external_event",
          title: "Start", learningObjective: "o", completionMethod: "pocket_postback", xpReward: 15, requiredXp: 0 },
        headers: withCsrf,
      });
      assert.equal(l1.status, 201, l1.text);
      const l2 = await adminClient.request("POST", levelPath(flowVersionId), {
        body: { moduleId: flowModuleId, levelNumber: 2, stableCode: sc(2, "flow-check"), type: "financial_checkpoint",
          title: "Checkpoint", learningObjective: "o", completionMethod: "balance_check", xpReward: 10, requiredXp: 0,
          requiredPreviousLevel: 1 },
        headers: withCsrf,
      });
      assert.equal(l2.status, 201, l2.text);

      const publishResp = await adminClient.request("POST",
        `/api/admin/curriculum/versions/${flowVersionId}/publish`, { body: {}, headers: withCsrf });
      assert.equal(publishResp.status, 200, publishResp.text);
      assert.equal((dataOf(publishResp) as { published: { status: string } }).published.status, "published");
    });

    await check("40. audit carries session actorId for all successful definition mutations", async () => {
      for (const action of [
        "MODULE_DEFINITION_CREATED", "MODULE_DEFINITION_UPDATED", "MODULE_DEFINITION_DELETED",
        "LEVEL_DEFINITION_CREATED", "LEVEL_DEFINITION_UPDATED", "LEVEL_DEFINITION_DELETED",
      ]) {
        const rows = await prisma.auditLog.findMany({ where: { action } });
        assert.equal(rows.length >= 1, true, `no audit rows for ${action}`);
        for (const row of rows) {
          assert.equal(row.userId, admin.id);
          assert.equal((row.metadata as { actorId?: number }).actorId, admin.id);
        }
      }
    });

    await check("41. failed / no-change operations create no success audit", async () => {
      const successBefore = await prisma.auditLog.count({
        where: { action: { in: ["MODULE_DEFINITION_UPDATED", "LEVEL_DEFINITION_UPDATED"] } },
      });
      const noChange = await adminClient.request("PATCH", moduleIdPath(draftModules.id, dm1.id), {
        body: { title: "Module 1 (renamed)" }, headers: withCsrf,
      });
      assert.equal(noChange.status, 409);
      const failed = await adminClient.request("PATCH", levelIdPath(draftLevels.id, lx.id), {
        body: { stableCode: "broken" }, headers: withCsrf,
      });
      assert.equal(failed.status, 400);
      const successAfter = await prisma.auditLog.count({
        where: { action: { in: ["MODULE_DEFINITION_UPDATED", "LEVEL_DEFINITION_UPDATED"] } },
      });
      assert.equal(successAfter, successBefore);
    });

    await check("37. errors do not leak Prisma/SQL/stack/env", async () => {
      const conflict = await adminClient.request("POST", modulePath(draftModules.id), {
        body: { moduleNumber: 1, code: "m01-x", title: "Dup", firstLevel: 8, lastLevel: 9, learningObjective: "o" },
        headers: withCsrf,
      });
      const badId = await adminClient.request("PATCH", `${modulePath(draftModules.id)}/abc`, {
        body: { title: "x" }, headers: withCsrf,
      });
      for (const t of [conflict.text, badId.text]) {
        assert.equal(/prisma|sqlite|P20\d\d|stack|\/home\/|node_modules|SESSION_SECRET/i.test(t), false, t);
      }
    });

    await check("36. shared rate limit returns 429 across endpoints", async () => {
      const rateClient = new HttpClient();
      assert.equal((await rateClient.login(rateAdmin.email)).status, 200);
      const rcsrf = await rateClient.csrfToken();
      let got429 = false;
      for (let i = 0; i < 60; i += 1) {
        // Alternate module and level endpoints to prove one shared bucket.
        const target = i % 2 === 0
          ? moduleIdPath(draftModules.id, 999999)
          : levelIdPath(draftLevels.id, 999999);
        const r = await rateClient.request("DELETE", target, { headers: { "x-csrf-token": rcsrf } });
        if (r.status === 429) {
          got429 = true;
          assert.equal(body(r).error, "RATE_LIMITED");
          break;
        }
        assert.equal(r.status, 404, `unexpected ${r.status} at attempt ${i}: ${r.text}`);
      }
      assert.equal(got429, true, "expected a 429 within 60 mixed-endpoint attempts");
    });

    await check("42. V1 API and tables untouched", async () => {
      assert.equal((await fetch(`${BASE_URL}/api/health`)).ok, true);
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

  await check("43. server stopped and temporary DB removed", async () => {
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
    console.log(`\ncurriculum definitions admin api regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum definitions admin api regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
