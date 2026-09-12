/**
 * ATA-PRODUCT-PHASE-A-CURRICULUM-RUNTIME-1 — HTTP regression.
 *
 * Exercises the real routes over real HTTP against a throwaway Next server and
 * a temporary SQLite fixture: A1 (manual completion), A4 (mentor review), A6
 * (`/current?shape=summary`) and A8 (the staging attestation admin route).
 *
 * THREE SERVERS, BECAUSE THE FLAGS ARE THE CONTRACT
 *   1. every flag off      -- every route must be a uniform 404, before auth
 *   2. curriculum flags on -- A1/A4/A6 in full; A8 still 404 (not staging)
 *   3. + ATA_ENVIRONMENT=staging and STAGING_ATTESTATION_ENABLED=true -- A8
 *
 * SESSIONS ARE MINTED, NOT LOGGED IN. Server 3 is classified `staging`, which
 * makes a working CAPTCHA provider mandatory — so the login route would call
 * Cloudflare. The session cookie is an HMAC over `userId.role.expiry` with
 * SESSION_SECRET (src/lib/session.ts) and CSRF is a double-submit cookie
 * (src/lib/csrf.ts), so both are reproduced here directly. This tests the
 * routes, not the login page, and it keeps every server on the same code path.
 *
 * No live database, no live environment file, no deployed release and no
 * external service is touched.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, type UserRole } from "@prisma/client";

const dbPath = `/tmp/ata-curriculum-phase-a-http-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3930 + (process.pid % 30);
const baseUrl = `http://127.0.0.1:${port}`;
const SESSION_SECRET = "phase-a-http-session-secret-value-32ch";
const SESSION_COOKIE = "trading_platform_session";
const CSRF_COOKIE = "trading_platform_csrf";
const CSRF_VALUE = "a".repeat(64);

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
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

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET,
  POSTBACK_SECRET: "phase-a-http-postback-secret",
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://u3.shortink.io/register?a=phase-a",
  EMAIL_VERIFICATION_REQUIRED: "false",
};
for (const key of [
  "NODE_ENV",
  "ATA_ENVIRONMENT",
  "STAGING_ATTESTATION_ENABLED",
  "CURRICULUM_V2_ADMIN_ENABLED",
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_XP_ENABLED",
  "CURRICULUM_V2_CONTENT_ENABLED",
  "CURRICULUM_V2_ASSESSMENT_ENABLED",
  "CURRICULUM_V2_REPORT_ENABLED",
  "POCKET_POSTBACK_ENABLED",
  "POCKET_BALANCE_PROVIDER_ENABLED",
  "CHECKPOINT_PROVIDER_MODE",
  "CAPTCHA_PROVIDER",
  "TURNSTILE_SECRET_KEY",
  "CAPTCHA_LOGIN_ENFORCED",
]) {
  delete baseEnv[key];
}

const CURRICULUM_ON = {
  CURRICULUM_V2_READ_ENABLED: "true",
  CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
  CURRICULUM_V2_XP_ENABLED: "true",
  CURRICULUM_V2_CONTENT_ENABLED: "true",
};

/**
 * The staging deployment. `ATA_ENVIRONMENT=staging` makes a working CAPTCHA
 * provider mandatory, so one is configured — a plain (non-test-shaped) secret,
 * which is enough for `validateRuntimeEnv` and is never actually presented to
 * Cloudflare because these tests do not log in.
 */
const STAGING_ON = {
  ATA_ENVIRONMENT: "staging",
  STAGING_ATTESTATION_ENABLED: "true",
  CAPTCHA_PROVIDER: "turnstile",
  TURNSTILE_SECRET_KEY: "0xPHASEAHTTPNOTAREALSECRETVALUE0000",
  CAPTCHA_LOGIN_ENFORCED: "true",
};

let logs = "";

async function start(extra: Record<string, string> = {}) {
  logs = "";
  const child = spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...baseEnv, ...extra },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value) => { logs += String(value); });
  child.stderr?.on("data", (value) => { logs += String(value); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-4000)}`);
}

async function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); }
    catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
}

/** The exact token shape src/lib/session.ts produces. */
function sessionToken(userId: number, role: UserRole) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${userId}.${role}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

type Reply = { status: number; headers: Headers; body: Record<string, unknown>; text: string };

async function request(
  method: string,
  url: string,
  options: {
    actor?: { id: number; role: UserRole };
    body?: unknown;
    csrf?: boolean;
    headers?: Record<string, string>;
  } = {},
): Promise<Reply> {
  const cookies: string[] = [];
  if (options.actor) {
    cookies.push(`${SESSION_COOKIE}=${sessionToken(options.actor.id, options.actor.role)}`);
  }
  if (options.csrf !== false) cookies.push(`${CSRF_COOKIE}=${CSRF_VALUE}`);
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
      ...(options.csrf !== false ? { "x-csrf-token": CSRF_VALUE } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let value: unknown = {};
  try { value = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, headers: response.headers, body: value as Record<string, unknown>, text };
}

function noStore(reply: Reply) {
  assert.equal(reply.headers.get("cache-control"), "no-store", reply.text);
}
function data(reply: Reply) {
  return reply.body.data as Record<string, unknown>;
}

async function main() {
  cleanup();
  let server: ChildProcess | null = null;
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    const migration = spawnSync(
      process.execPath,
      [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
      { env: baseEnv, encoding: "utf8" },
    );
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

    /* ---------------------------- fixture ---------------------------- */
    const now = new Date();
    const learner = await prisma.user.create({
      data: { email: "phase-a-learner@example.com", name: "Learner", status: "active" },
    });
    const stranger = await prisma.user.create({
      data: { email: "phase-a-stranger@example.com", name: "Stranger", status: "active" },
    });
    const mentorUser = await prisma.user.create({
      data: { email: "phase-a-mentor@example.com", name: "Mentor", role: "mentor", status: "active" },
    });
    const adminUser = await prisma.user.create({
      data: { email: "phase-a-admin@example.com", name: "Admin", role: "admin", status: "active" },
    });
    const attestLearner = await prisma.user.create({
      data: { email: "phase-a-attest@example.com", name: "Attest", status: "active" },
    });

    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: "Phase A HTTP",
        versionNumber: 1,
        status: "published",
        publishedAt: now,
        effectiveFrom: new Date(now.getTime() - 60_000),
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: "module-1",
        title: "Module",
        firstLevel: 1,
        lastLevel: 5,
        learningObjective: "Learn",
      },
    });
    // Level 1 is the Pocket registration gate under its canonical stable code —
    // the registration owner completes THAT level and nothing else, ever, so a
    // faithful fixture has to put it where production puts it.
    const levelSpecs = [
      { type: "external_event" as const, completionMethod: "pocket_postback", xpReward: 0, code: "v2.l001.registraciya-pocket" },
      { type: "lesson" as const, completionMethod: "manual", xpReward: 20, code: "v2.l002.phase-a-http" },
      { type: "mentor_review" as const, completionMethod: "mentor_review", xpReward: 30, code: "v2.l003.phase-a-http" },
      { type: "lesson" as const, completionMethod: "manual", xpReward: 40, code: "v2.l004.phase-a-http" },
      { type: "lesson" as const, completionMethod: "assessment_pass", xpReward: 50, code: "v2.l005.phase-a-http" },
    ];
    const levels = [];
    for (const [index, spec] of levelSpecs.entries()) {
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber: index + 1,
            stableCode: spec.code,
            type: spec.type,
            title: `Level ${index + 1}`,
            learningObjective: "Learn",
            completionMethod: spec.completionMethod,
            xpReward: spec.xpReward,
            requiredXp: 0,
            requiredPreviousLevel: index === 0 ? null : index,
            status: "active",
          },
        }),
      );
    }

    // The A1/A4/A6 learner: past the registration gate, standing on the manual
    // level at 2.
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: learner.id,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status: "active",
        currentLevel: 2,
        highestCompletedLevel: 1,
      },
    });
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: version.id,
        levelDefinitionId: levels[0].id,
        status: "completed",
        startedAt: now,
        lastProgressAt: now,
        completedAt: now,
      },
    });
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: version.id,
        levelDefinitionId: levels[1].id,
        status: "in_progress",
        startedAt: now,
        lastProgressAt: now,
      },
    });

    const manualLevel = levels[1];
    const mentorLevel = levels[2];
    const lockedLevel = levels[3];
    const wrongOwnerLevel = levels[4];
    const registrationLevel = levels[0];

    const manualPath = `/api/curriculum/v2/levels/${manualLevel.stableCode}/complete`;
    const reviewPath = `/api/curriculum/v2/levels/${mentorLevel.stableCode}/mentor-review/request`;
    const attestPath = "/api/admin/curriculum/staging-attestations";

    /* ================= server 1: every flag off ====================== */
    server = await start();

    await check("H1 manual completion is a uniform 404 before authentication", async () => {
      const reply = await request("POST", manualPath, { body: { requestId: "http-a1-000001" } });
      assert.equal(reply.status, 404);
      assert.equal(reply.body.error, "NOT_FOUND");
    });
    await check("H2 mentor review request is a uniform 404 before authentication", async () => {
      const reply = await request("POST", reviewPath, { body: {} });
      assert.equal(reply.status, 404);
      assert.equal(reply.body.error, "NOT_FOUND");
    });
    await check("H3 mentor review approve is a uniform 404 before authentication", async () => {
      const reply = await request("POST", "/api/curriculum/v2/mentor-reviews/1/approve", { body: {} });
      assert.equal(reply.status, 404);
    });
    await check("H4 the staging attestation route is a uniform 404 before authentication", async () => {
      const reply = await request("POST", attestPath, {
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000001",
        },
      });
      assert.equal(reply.status, 404);
      assert.equal(reply.body.error, "NOT_FOUND");
    });
    await check("H5 an authenticated admin still gets 404 while the flags are off", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: adminUser.id, role: "admin" },
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000002",
        },
      });
      assert.equal(reply.status, 404);
    });

    /* ============ server 2: curriculum on, not staging ================ */
    await stop(server);
    server = await start(CURRICULUM_ON);

    await check("H6 anonymous manual completion is unauthorized", async () => {
      const reply = await request("POST", manualPath, { body: { requestId: "http-a1-000003" } });
      assert.equal(reply.status, 401);
    });
    await check("H7 manual completion requires CSRF", async () => {
      const reply = await request("POST", manualPath, {
        actor: { id: learner.id, role: "user" },
        body: { requestId: "http-a1-000004" },
        csrf: false,
      });
      assert.equal(reply.status, 403);
      assert.equal(reply.body.error, "CSRF_INVALID");
    });
    await check("H8 the body is strict: an extra key is a 400", async () => {
      const reply = await request("POST", manualPath, {
        actor: { id: learner.id, role: "user" },
        body: { requestId: "http-a1-000005", userId: 1, xpReward: 999 },
      });
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "INPUT_INVALID");
      noStore(reply);
    });
    await check("H9 a query parameter is rejected", async () => {
      const reply = await request("POST", `${manualPath}?force=1`, {
        actor: { id: learner.id, role: "user" },
        body: { requestId: "http-a1-000006" },
      });
      assert.equal(reply.status, 400);
    });
    await check("H10 a learner cannot complete another learner's level", async () => {
      const reply = await request("POST", manualPath, {
        actor: { id: stranger.id, role: "user" },
        body: { requestId: "http-a1-000007" },
      });
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error, "MANUAL_COMPLETION_NOT_ENROLLED");
    });
    await check("H11 a wrong-owner level is refused over HTTP", async () => {
      const reply = await request(
        "POST",
        `/api/curriculum/v2/levels/${wrongOwnerLevel.stableCode}/complete`,
        { actor: { id: learner.id, role: "user" }, body: { requestId: "http-a1-000008" } },
      );
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error, "MANUAL_COMPLETION_LEVEL_WRONG_OWNER");
    });
    await check("H12 a locked level is refused over HTTP", async () => {
      const reply = await request(
        "POST",
        `/api/curriculum/v2/levels/${lockedLevel.stableCode}/complete`,
        { actor: { id: learner.id, role: "user" }, body: { requestId: "http-a1-000009" } },
      );
      // The right owner, the wrong position: this is the honest "you are not
      // there yet", not a permission error.
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error, "MANUAL_COMPLETION_LEVEL_NOT_CURRENT");
      const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
      assert.equal(after.currentLevel, 2, "a refused request writes nothing");
    });

    /* -------- A6 summary, checked BEFORE the level is completed ------- */
    await check("H13 /current with no query is byte-identical to the shipped shape", async () => {
      const reply = await request("GET", "/api/curriculum/v2/current", {
        actor: { id: learner.id, role: "user" },
      });
      assert.equal(reply.status, 200, reply.text);
      const payload = data(reply);
      assert.equal(payload.kind, "enrolled");
      assert.equal("shape" in payload, false, "the default response gains no new key");
      assert.ok(Array.isArray(payload.modules));
      noStore(reply);
    });
    await check("H14 ?shape=full is identical to omitting the parameter", async () => {
      const bare = await request("GET", "/api/curriculum/v2/current", {
        actor: { id: learner.id, role: "user" },
      });
      const full = await request("GET", "/api/curriculum/v2/current?shape=full", {
        actor: { id: learner.id, role: "user" },
      });
      assert.equal(full.status, 200);
      assert.equal(full.text, bare.text);
    });
    await check("H15 ?shape=summary is slim and carries the Home facts", async () => {
      const reply = await request("GET", "/api/curriculum/v2/current?shape=summary", {
        actor: { id: learner.id, role: "user" },
      });
      assert.equal(reply.status, 200, reply.text);
      const payload = data(reply);
      assert.equal(payload.shape, "summary");
      assert.equal(payload.kind, "enrolled");
      assert.equal("modules" in payload, false, "no level graph");
      const progress = payload.progress as Record<string, number>;
      assert.equal(progress.currentLevel, 2);
      assert.equal(progress.totalLevels, 5);
      assert.equal(progress.completedLevels, 1);
      assert.equal(progress.highestCompletedLevel, 1);
      assert.equal(progress.percentComplete, 20);
      const current = payload.currentLevel as Record<string, unknown>;
      assert.equal(current.stableCode, manualLevel.stableCode);
      assert.equal(current.completionMethod, "manual");
      assert.equal(current.presentationState, "in_progress");
      assert.equal((payload.nextLevel as Record<string, unknown>).levelNumber, 3);
      assert.ok(payload.xp);
      // No PII, and no level beyond the current one and its successor.
      assert.equal(reply.text.includes("@example.com"), false);
      assert.equal(reply.text.includes(registrationLevel.stableCode), false);
      assert.equal(reply.text.includes(lockedLevel.stableCode), false);
      assert.equal(reply.text.includes(wrongOwnerLevel.stableCode), false);
      // Materially smaller than the full graph.
      const full = await request("GET", "/api/curriculum/v2/current", {
        actor: { id: learner.id, role: "user" },
      });
      assert.ok(reply.text.length < full.text.length, "the summary must be smaller");
      noStore(reply);
    });
    for (const query of ["shape=", "shape=Summary", "shape=summary&extra=1", "shape=full&shape=summary", "asOf=now"]) {
      await check(`H16 /current rejects ?${query}`, async () => {
        const reply = await request("GET", `/api/curriculum/v2/current?${query}`, {
          actor: { id: learner.id, role: "user" },
        });
        assert.equal(reply.status, 400, reply.text);
        assert.equal(reply.body.error, "INVALID_QUERY");
      });
    }

    /* ------------------------ A1 happy path -------------------------- */
    await check("H17 the learner completes their manual level", async () => {
      const reply = await request("POST", manualPath, {
        actor: { id: learner.id, role: "user" },
        body: { requestId: "http-a1-000010" },
      });
      assert.equal(reply.status, 200, reply.text);
      const payload = data(reply);
      assert.equal(payload.ok, true);
      assert.equal(payload.created, true);
      assert.equal(payload.levelNumber, 2);
      assert.equal(payload.completionMethod, "manual");
      assert.equal(payload.xpAwarded, 20);
      assert.equal(payload.nextLevelNumber, 3);
      assert.equal(payload.terminal, false);
      noStore(reply);
    });
    await check("H18 an identical retry replays with created:false", async () => {
      const reply = await request("POST", manualPath, {
        actor: { id: learner.id, role: "user" },
        body: { requestId: "http-a1-000010" },
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).created, false);
      assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 1);
    });
    await check("H19 a different requestId on the completed level is a 409", async () => {
      const reply = await request("POST", manualPath, {
        actor: { id: learner.id, role: "user" },
        body: { requestId: "http-a1-000011" },
      });
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error, "MANUAL_COMPLETION_REQUEST_CONFLICT");
      assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 1);
    });

    /* -------------------------- A4 over HTTP -------------------------- */
    await check("H20 the learner starts and submits the mentor-review level", async () => {
      const started = await request(
        "POST",
        `/api/curriculum/v2/levels/${mentorLevel.stableCode}/start`,
        { actor: { id: learner.id, role: "user" }, body: {} },
      );
      assert.equal(started.status, 200, started.text);
      const reply = await request("POST", reviewPath, {
        actor: { id: learner.id, role: "user" },
        body: {},
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).state, "pending_review");
      assert.equal(data(reply).created, true);
      noStore(reply);
    });

    const pendingProgress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: enrollment.id, levelDefinitionId: mentorLevel.id },
    });
    const approvePath = `/api/curriculum/v2/mentor-reviews/${pendingProgress.id}/approve`;

    await check("H21 the learner cannot reach the approve route at all", async () => {
      const reply = await request("POST", approvePath, {
        actor: { id: learner.id, role: "user" },
        body: {},
      });
      assert.equal(reply.status, 403, reply.text);
    });
    await check("H22 an unauthorized employee cannot approve", async () => {
      const support = await prisma.user.create({
        data: { email: "phase-a-support@example.com", name: "Support", role: "support", status: "active" },
      });
      const reply = await request("POST", approvePath, {
        actor: { id: support.id, role: "support" },
        body: {},
      });
      assert.equal(reply.status, 403);
    });
    await check("H23 approval requires CSRF even for a mentor", async () => {
      const reply = await request("POST", approvePath, {
        actor: { id: mentorUser.id, role: "mentor" },
        body: {},
        csrf: false,
      });
      assert.equal(reply.status, 403);
      assert.equal(reply.body.error, "CSRF_INVALID");
    });
    await check("H24 a mentor approves and the level completes exactly once", async () => {
      const reply = await request("POST", approvePath, {
        actor: { id: mentorUser.id, role: "mentor" },
        body: {},
      });
      assert.equal(reply.status, 200, reply.text);
      const payload = data(reply);
      assert.equal(payload.created, true);
      assert.equal(payload.state, "completed");
      assert.equal(payload.reviewerRole, "mentor");
      assert.equal(payload.xpAwarded, 30);
      const retry = await request("POST", approvePath, {
        actor: { id: mentorUser.id, role: "mentor" },
        body: {},
      });
      assert.equal(retry.status, 200, retry.text);
      assert.equal(data(retry).created, false);
      assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 2);
      noStore(reply);
    });
    await check("H25 a malformed approve path id is a 400, never a lookup", async () => {
      const reply = await request("POST", "/api/curriculum/v2/mentor-reviews/abc/approve", {
        actor: { id: mentorUser.id, role: "mentor" },
        body: {},
      });
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "MENTOR_REVIEW_INPUT_INVALID");
    });

    await check("H26 the staging attestation route is still 404 outside staging", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: adminUser.id, role: "admin" },
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000003",
        },
      });
      assert.equal(reply.status, 404, reply.text);
      assert.equal(reply.body.error, "NOT_FOUND");
      assert.equal(await prisma.stagingAttestation.count(), 0);
    });

    /* ============= server 3: curriculum on + staging ================== */
    await stop(server);

    // A second learner standing on the level 1 registration gate, with no
    // progress row of any kind — exactly where a real PREPROD learner is stuck
    // today, because no Pocket postback can reach a staging host.
    const attestEnrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: attestLearner.id,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status: "active",
        currentLevel: 1,
        highestCompletedLevel: 0,
      },
    });

    server = await start({ ...CURRICULUM_ON, ...STAGING_ON });

    await check("H27 an anonymous caller cannot attest", async () => {
      const reply = await request("POST", attestPath, {
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000004",
        },
      });
      assert.equal(reply.status, 401, reply.text);
      assert.equal(await prisma.stagingAttestation.count(), 0);
    });
    await check("H28 a learner cannot attest", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: attestLearner.id, role: "user" },
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000005",
        },
      });
      assert.equal(reply.status, 403, reply.text);
      assert.equal(await prisma.stagingAttestation.count(), 0);
    });
    await check("H29 a mentor cannot attest", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: mentorUser.id, role: "mentor" },
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000006",
        },
      });
      assert.equal(reply.status, 403);
    });
    await check("H30 attestation requires CSRF", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: adminUser.id, role: "admin" },
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000007",
        },
        csrf: false,
      });
      assert.equal(reply.status, 403);
      assert.equal(reply.body.error, "CSRF_INVALID");
      assert.equal(await prisma.stagingAttestation.count(), 0);
    });
    await check("H31 the body is strict: a balance cannot be submitted", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: adminUser.id, role: "admin" },
        body: {
          eventClass: "financial_checkpoint",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000008",
          balanceMinorUnits: 5000,
        },
      });
      assert.equal(reply.status, 400, reply.text);
      assert.equal(reply.body.error, "STAGING_ATTESTATION_INPUT_INVALID");
      assert.equal(await prisma.stagingAttestation.count(), 0);
    });
    await check("H32 an authorized operator attests the registration gate", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: adminUser.id, role: "admin" },
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000009",
        },
      });
      assert.equal(reply.status, 201, reply.text);
      const payload = data(reply);
      assert.equal(payload.created, true);
      assert.equal(payload.completed, true);
      assert.equal(payload.eventClass, "pocket_registration");
      assert.equal(payload.xpAwarded, 0);
      assert.equal(payload.xpTransactionId, null);

      const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: attestEnrollment.id },
      });
      assert.equal(after.highestCompletedLevel, 1);
      assert.equal(after.currentLevel, 2, "the gate opened and the learner advanced");
      assert.equal(await prisma.pocketTraderIdentity.count(), 0, "no fake Pocket binding");
    });
    await check("H33 an identical retry replays without a second attestation", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: adminUser.id, role: "admin" },
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000009",
        },
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).created, false);
      assert.equal(await prisma.stagingAttestation.count(), 1);
      assert.equal(
        await prisma.auditLog.count({
          where: { action: "CURRICULUM_STAGING_ATTESTATION_RECORDED" },
        }),
        1,
      );
    });
    await check("H34 rotating the request identity is a 409", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: adminUser.id, role: "admin" },
        body: {
          eventClass: "pocket_registration",
          learnerUserId: attestLearner.id,
          stableCode: registrationLevel.stableCode,
          requestId: "http-a8-000010",
        },
      });
      assert.equal(reply.status, 409, reply.text);
      assert.equal(reply.body.error, "STAGING_ATTESTATION_REQUEST_CONFLICT");
      assert.equal(await prisma.stagingAttestation.count(), 1);
    });
    await check("H35 an event class pointed at the wrong level kind is a 409", async () => {
      const reply = await request("POST", attestPath, {
        actor: { id: adminUser.id, role: "admin" },
        body: {
          eventClass: "financial_checkpoint",
          learnerUserId: learner.id,
          stableCode: manualLevel.stableCode,
          requestId: "http-a8-000011",
        },
      });
      assert.equal(reply.status, 409, reply.text);
      assert.equal(reply.body.error, "STAGING_ATTESTATION_LEVEL_WRONG_KIND");
    });
    await check("H36 no Pocket flag was needed and no provider state changed", async () => {
      assert.equal(await prisma.checkpointVerificationAttempt.count(), 0);
      assert.equal(await prisma.pocketTraderIdentity.count(), 0);
      assert.equal(await prisma.exchangeAccount.count(), 0);
      // The server was started with neither Pocket flag.
      assert.equal(STAGING_ON.hasOwnProperty("POCKET_POSTBACK_ENABLED"), false);
      assert.equal(STAGING_ON.hasOwnProperty("POCKET_BALANCE_PROVIDER_ENABLED"), false);
    });
  } finally {
    await stop(server);
    await prisma.$disconnect();
    cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
