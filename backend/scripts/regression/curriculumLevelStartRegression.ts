/**
 * L2START-PLAYER-1 — the legal level-start HTTP owner.
 *
 * THE DEFECT THIS CLOSES
 * `startCurrentCurriculumLevel` was the domain owner of `available ->
 * in_progress`, but no route reached it. After L1OWNER-1 made Pocket
 * registration complete L1, every learner arrived at L2 `available` and stopped
 * there for good: lesson progress answered NOT_STARTED and the assessment
 * answered ASSESSMENT_LEVEL_NOT_STARTED, both correctly. Earlier end-to-end
 * phases hid it by inserting UserLevelProgress rows directly.
 *
 * WHY THIS SUITE SPEAKS HTTP
 * The defect was never in the domain owner — it was in what the product exposed.
 * A suite that called the owner in-process would have passed before the fix, so
 * every case here goes over the wire against a real server, with real sessions,
 * real CSRF and the real published ata-v2 curriculum. Anonymous access, CSRF and
 * cross-learner isolation cannot be argued about any other way.
 *
 * WHAT IT NEVER DOES
 * It never creates, updates or deletes a UserLevelProgress row, never grants
 * assessment eligibility, and never completes a level by hand. Users and their
 * Pocket click ids are account fixtures; every progress transition below is
 * produced by the owner under test. A check at the end proves the file contains
 * no progress-seeding call.
 *
 * Synthetic database only (an online backup copy of DEV). No external request is
 * made and the real POSTBACK_SECRET is never read.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

const sourceDb =
  process.env.L2START_FIXTURE_DB ?? "/home/ubuntu/l2start1-work/db/fixture.sqlite";
const dbPath = path.join(os.tmpdir(), `ata-l2start-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const port = 3990 + (process.pid % 8);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "L2Start123!";
const SECRET = "l2start1-synthetic-postback-secret";

const L1 = "v2.l001.registraciya-pocket";
const L2 = "v2.l002.kak-ustroen-alfa-trade-academy";
const L3 = "v2.l003.pervye-pyat-demo-sdelok";
const L4 = "v2.l004.kontrolnaya-tochka-50";

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
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

let ip = 0;
const nextIp = () => `10.61.${Math.floor(++ip / 250)}.${ip % 250}`;

type Reply = { status: number; headers: Headers; body: Record<string, unknown>; text: string };

class Client {
  readonly cookies = new Map<string, string>();

  async request(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
        "x-forwarded-for": nextIp(),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let value: unknown = {};
    try {
      value = JSON.parse(text);
    } catch {
      /* non-JSON bodies are asserted through `text` */
    }
    return { status: response.status, headers: response.headers, body: value as Record<string, unknown>, text };
  }

  /**
   * The live double-submit contract: GET /api/csrf sets the
   * `trading_platform_csrf` cookie AND returns the token, which must then travel
   * back in `x-csrf-token`. Every mutation below goes through here, so a route
   * that silently dropped CSRF would not be quietly rewarded.
   */
  async csrf(): Promise<string> {
    const reply = await this.request("GET", "/api/csrf");
    return String(reply.body.csrfToken);
  }

  async post(url: string, body?: unknown, headers: Record<string, string> = {}) {
    return this.request("POST", url, body, { "x-csrf-token": await this.csrf(), ...headers });
  }

  async patch(url: string, body?: unknown, headers: Record<string, string> = {}) {
    return this.request("PATCH", url, body, { "x-csrf-token": await this.csrf(), ...headers });
  }

  login(email: string) {
    return this.request("POST", "/api/auth/login", {
      email,
      password,
      captchaToken: "dev-captcha-ok",
    });
  }
}

const startUrl = (stableCode: string) =>
  `/api/curriculum/v2/levels/${encodeURIComponent(stableCode)}/start`;

function noStore(reply: Reply) {
  assert.equal(reply.headers.get("cache-control"), "no-store");
}

let server: ChildProcess | null = null;
let logs = "";

async function startServer() {
  // Typed loosely on purpose: NodeJS.ProcessEnv insists on NODE_ENV, and this
  // suite must hand the child an environment with NODE_ENV deliberately absent.
  const env = {
    ...(process.env as Record<string, string>),
    DATABASE_URL: dbUrl,
    SESSION_SECRET: "l2start-session-secret",
    POSTBACK_SECRET: SECRET,
    APP_URL: baseUrl,
    STORAGE_DRIVER: "local",
    POCKET_AFFILIATE_BASE_URL: "https://example.invalid/ref",
    EMAIL_VERIFICATION_REQUIRED: "false",
    CAPTCHA_DEV_BYPASS: "true",
    POCKET_POSTBACK_ENABLED: "true",
    CURRICULUM_V2_READ_ENABLED: "true",
    CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
    CURRICULUM_V2_CONTENT_ENABLED: "true",
    CURRICULUM_V2_ASSESSMENT_ENABLED: "true",
    CURRICULUM_V2_REPORT_ENABLED: "true",
    ATA_ENVIRONMENT: "dev",
  };
  delete (env as Record<string, string | undefined>).NODE_ENV;

  const child: ChildProcess = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: env as unknown as NodeJS.ProcessEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value: Buffer) => { logs += String(value); });
  child.stderr?.on("data", (value: Buffer) => { logs += String(value); });

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-4000)}`);
}

async function stopServer() {
  if (!server?.pid) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* already gone */ }
}

async function main() {
  cleanup();
  fs.copyFileSync(sourceDb, dbPath);
  process.env.DATABASE_URL = dbUrl;
  // The in-process half of this suite only ever enrols learners and reads state
  // back; it needs the same flags the server runs with, because the enrolment
  // owner refuses to run with the curriculum switched off.
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const enrolment = await import("../../src/lib/curriculum/enrollment");

  const version = await prisma.curriculumVersion.findFirst({
    where: { code: "ata-v2", status: "published" },
  });
  if (!version) {
    console.log("SKIP: no published ata-v2 in the fixture database");
    return;
  }
  const levels = new Map<string, { id: number; levelNumber: number }>();
  for (const code of [L1, L2, L3, L4]) {
    const definition = await prisma.levelDefinition.findFirstOrThrow({
      where: { curriculumVersionId: version.id, stableCode: code },
      select: { id: true, levelNumber: true },
    });
    levels.set(code, definition);
  }

  server = await startServer();

  const hash = await bcrypt.hash(password, 10);
  let seq = 0;

  /**
   * A synthetic learner at a chosen point on the real curriculum.
   *
   * `l1` is reached by sending an authenticated registration postback — the same
   * owner a real learner triggers — and `start` by calling the route under test.
   * Neither writes progress directly, which is what makes the assertions below
   * mean anything.
   */
  async function learner(options: { enrol?: boolean; l1?: boolean; start?: boolean } = {}) {
    const { enrol = true, l1 = true, start = false } = options;
    seq += 1;
    const email = `l2start-${seq}-${Date.now()}@example.invalid`;
    const user = await prisma.user.create({
      data: {
        email,
        name: "L2START",
        passwordHash: hash,
        referralCode: `L2S${seq}${Date.now() % 100000}`,
        status: "active",
      },
    });
    if (enrol) await enrolment.enrollUserInPublishedCurriculum({ userId: user.id, actorId: 1 });

    const client = new Client();
    const loggedIn = await client.login(email);
    assert.equal(loggedIn.status, 200, `login failed: ${loggedIn.text.slice(0, 200)}`);

    if (l1) {
      const referral = await client.post("/api/exchange/referral-link");
      assert.equal(referral.status, 200, `referral failed: ${referral.text.slice(0, 200)}`);
      const account = await prisma.exchangeAccount.findUniqueOrThrow({
        where: { userId: user.id },
        select: { clickId: true },
      });
      const query = new URLSearchParams({
        clickid: String(account.clickId),
        goal: "reg",
        ow: SECRET,
        playerid: `95${seq}${Date.now() % 10000}`,
      });
      const postback = await fetch(`${baseUrl}/api/postbacks/pocket?${query}`, {
        headers: { "x-forwarded-for": nextIp() },
      });
      assert.equal(postback.status, 200, "registration postback rejected");
    }
    if (start) {
      const started = await client.post(startUrl(L2));
      assert.equal(started.status, 200, `precondition start failed: ${started.text.slice(0, 200)}`);
    }
    return { userId: user.id, email, client };
  }

  const enrollmentOf = (userId: number) =>
    prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId } });

  async function progressOf(userId: number, code: string) {
    const owned = await enrollmentOf(userId);
    return prisma.userLevelProgress.findFirst({
      where: { enrollmentId: owned.id, levelDefinitionId: levels.get(code)!.id },
    });
  }

  const progressCount = async (userId: number) => {
    const owned = await enrollmentOf(userId);
    return prisma.userLevelProgress.count({ where: { enrollmentId: owned.id } });
  };

  // ---------------------------------------------------------------- 1. legal start
  const legal = await learner();
  await check("1 legal current-level start returns in_progress", async () => {
    const before = await progressOf(legal.userId, L2);
    assert.equal(before, null, "L2 must not exist before the start route runs");

    const reply = await legal.client.post(startUrl(L2));
    assert.equal(reply.status, 200, reply.text.slice(0, 300));
    noStore(reply);
    const data = reply.body.data as Record<string, unknown>;
    assert.equal(data.ok, true);
    assert.equal(data.state, "in_progress");
    assert.equal(data.stableCode, L2);
    assert.equal(data.created, true);
    assert.equal((await progressOf(legal.userId, L2))?.status, "in_progress");
  });

  await check("1a response leaks no internal or financial detail", async () => {
    const reply = await legal.client.post(startUrl(L2));
    const serialized = JSON.stringify(reply.body);
    for (const forbidden of ["enrollmentId", "levelDefinitionId", "balance", "xp", "clickId", "traderId", "password"]) {
      assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
    }
  });

  // ---------------------------------------------------------------- 2. duplicate
  await check("2 duplicate start is idempotent and creates no second row", async () => {
    const reply = await legal.client.post(startUrl(L2));
    assert.equal(reply.status, 200);
    assert.equal((reply.body.data as Record<string, unknown>).created, false);
    const owned = await enrollmentOf(legal.userId);
    assert.equal(
      await prisma.userLevelProgress.count({
        where: { enrollmentId: owned.id, levelDefinitionId: levels.get(L2)!.id },
      }),
      1,
    );
  });

  // ---------------------------------------------------------------- 3. concurrency
  const concurrent = await learner();
  await check("3 concurrent identical starts make exactly one transition", async () => {
    // The token is fetched once and shared: four genuinely parallel requests,
    // not four serialised ones with a round-trip between them.
    const token = await concurrent.client.csrf();
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        concurrent.client.request("POST", startUrl(L2), undefined, { "x-csrf-token": token }),
      ),
    );
    for (const reply of replies) assert.equal(reply.status, 200, reply.text.slice(0, 200));
    assert.equal(
      replies.filter((reply) => (reply.body.data as Record<string, unknown>).created === true).length,
      1,
      "exactly one request may report that it created the transition",
    );
    const owned = await enrollmentOf(concurrent.userId);
    const rows = await prisma.userLevelProgress.findMany({
      where: { enrollmentId: owned.id, levelDefinitionId: levels.get(L2)!.id },
      select: { id: true },
    });
    assert.equal(rows.length, 1, "exactly one progress row");

    // Scoped to THIS progress row on purpose. The learner already has a second
    // level-started event from L1: the registration owner starts L1 through the
    // same domain owner before completing it, so an unscoped count is 2 for a
    // perfectly healthy learner and would assert nothing about concurrency.
    assert.equal(
      await prisma.auditLog.count({
        where: {
          userId: concurrent.userId,
          action: "CURRICULUM_LEVEL_STARTED",
          entityType: "UserLevelProgress",
          entityId: String(rows[0].id),
        },
      }),
      1,
      "exactly one level-started audit event for the L2 transition",
    );
  });

  // ---------------------------------------------------------------- 4. no enrolment
  await check("4 a learner without an enrollment fails closed", async () => {
    const orphan = await learner({ enrol: false, l1: false });
    const reply = await orphan.client.post(startUrl(L2));
    assert.equal(reply.status, 409);
    assert.equal(reply.body.error, "LEVEL_START_NO_ACTIVE_ENROLLMENT");
    assert.equal(
      await prisma.userCurriculumEnrollment.count({ where: { userId: orphan.userId } }),
      0,
      "no enrollment may be created as a side effect",
    );
  });

  // ---------------------------------------------------------------- 5/6/8/9 targets
  const stale = await learner();
  await check("5 a locked future level is refused with zero mutation", async () => {
    const before = await progressCount(stale.userId);
    for (const locked of [L3, L4]) {
      const reply = await stale.client.post(startUrl(locked));
      assert.equal(reply.status, 403, `${locked}: ${reply.text.slice(0, 200)}`);
      assert.equal(reply.body.error, "LEVEL_START_LOCKED");
      assert.equal(await progressOf(stale.userId, locked), null, `${locked} progress row`);
    }
    assert.equal(await progressCount(stale.userId), before, "no row anywhere");
  });

  await check("6 a completed level returns a bounded already-completed result", async () => {
    const reply = await stale.client.post(startUrl(L1));
    assert.equal(reply.status, 409);
    assert.equal(reply.body.error, "LEVEL_START_ALREADY_COMPLETED");
    const owned = await enrollmentOf(stale.userId);
    assert.equal(
      await prisma.userLevelProgress.count({
        where: { enrollmentId: owned.id, levelDefinitionId: levels.get(L1)!.id },
      }),
      1,
      "no second L1 row",
    );
    assert.equal((await progressOf(stale.userId, L1))?.status, "completed");
  });

  await check("8 an unknown level is a bounded not-found", async () => {
    const reply = await stale.client.post(startUrl("v2.l099.nesushchestvuyushchiy"));
    assert.equal(reply.status, 404);
    assert.equal(reply.body.error, "LEVEL_START_LEVEL_NOT_FOUND");
    assert.equal(await progressCount(stale.userId), 1, "still only the completed L1");
  });

  await check("9 a malformed stable code is a bounded validation failure", async () => {
    for (const malformed of ["NOT A CODE", "../../etc/passwd", "x".repeat(200)]) {
      const reply = await stale.client.post(startUrl(malformed));
      assert.equal(reply.status, 400, malformed);
      assert.equal(reply.body.error, "INPUT_INVALID", malformed);
    }
    assert.equal(await progressCount(stale.userId), 1);
  });

  // ---------------------------------------------------------------- 7. wrong learner
  await check("7 a learner can only ever act for themselves", async () => {
    const other = await learner();
    const victimBefore = await progressCount(stale.userId);

    // There is no field through which another learner could be named, so the
    // proof is that the actor is taken from the session and nothing else: the
    // same request under a different session moves only that session's learner.
    const reply = await other.client.post(startUrl(L2));
    assert.equal(reply.status, 200);
    assert.equal((await progressOf(other.userId, L2))?.status, "in_progress");
    assert.equal(await progressCount(stale.userId), victimBefore, "victim untouched");
    assert.equal(await progressOf(stale.userId, L2), null);

    const source = fs.readFileSync(
      "src/app/api/curriculum/v2/levels/[stableCode]/start/route.ts",
      "utf8",
    );
    for (const forbidden of ["userId", "learnerId", "actorUserId:", "targetUser"]) {
      assert.equal(
        source.includes(`body.${forbidden}`) || source.includes(`params.${forbidden}`),
        false,
        `route must not read ${forbidden} from the request`,
      );
    }
  });

  await check("20 an anonymous caller cannot start a level", async () => {
    const anonymous = new Client();
    const reply = await anonymous.request("POST", startUrl(L2), undefined, {
      "x-csrf-token": "anything",
    });
    assert.equal(reply.status, 401);
  });

  await check("21 a session without a CSRF token cannot start a level", async () => {
    const guarded = await learner();
    const reply = await guarded.client.request("POST", startUrl(L2));
    assert.equal(reply.status, 403);
    assert.equal(await progressOf(guarded.userId, L2), null, "zero mutation");
  });

  // ---------------------------------------------------------------- 22. cross-level race
  await check("22 concurrent starts for different levels cannot bypass the sequence", async () => {
    const racer = await learner();
    const token = await racer.client.csrf();
    const [current, future] = await Promise.all([
      racer.client.request("POST", startUrl(L2), undefined, { "x-csrf-token": token }),
      racer.client.request("POST", startUrl(L3), undefined, { "x-csrf-token": token }),
    ]);
    assert.equal(current.status, 200, "the legal current level wins");
    assert.equal(future.status, 403, "the future level is refused");
    assert.equal(await progressOf(racer.userId, L3), null, "no L3 row");
    assert.equal((await progressOf(racer.userId, L2))?.status, "in_progress");
  });

  // ---------------------------------------------------------------- 10. inactive level
  await check("10 a disabled level definition cannot be started", async () => {
    const blocked = await learner();
    await prisma.levelDefinition.update({
      where: { id: levels.get(L2)!.id },
      data: { status: "disabled" },
    });
    try {
      const reply = await blocked.client.post(startUrl(L2));
      // The resolver reports LEVEL_STATE_CORRUPT rather than "not available",
      // and that is the honest answer: a published curriculum whose current
      // level was disabled underneath an enrolled learner is broken data, not a
      // learner who has simply not arrived yet. What matters for this phase is
      // that it is a bounded refusal and that nothing was written.
      assert.equal(reply.status, 409, reply.text.slice(0, 200));
      assert.equal(reply.body.error, "LEVEL_STATE_CORRUPT");
      assert.equal(await progressOf(blocked.userId, L2), null, "zero mutation");
    } finally {
      await prisma.levelDefinition.update({
        where: { id: levels.get(L2)!.id },
        data: { status: "active" },
      });
    }
  });

  // ---------------------------------------------------------------- 11/12 separation
  await check("11 starting does not complete the level or unlock the next one", async () => {
    const owned = await enrollmentOf(legal.userId);
    assert.equal(owned.highestCompletedLevel, 1, "still only L1 completed");
    assert.equal(owned.currentLevel, 2);
    assert.equal((await progressOf(legal.userId, L2))?.status, "in_progress");
    assert.equal(await progressOf(legal.userId, L3), null, "L3 must stay untouched");
    assert.equal(
      await prisma.userLevelProgress.count({
        where: { enrollmentId: owned.id, status: "completed" },
      }),
      1,
    );
  });

  await check("12 starting creates no XP", async () => {
    assert.equal(await prisma.xPTransaction.count({ where: { userId: legal.userId } }), 0);
    assert.equal(await prisma.xPTransaction.count(), 0, "no XP anywhere in this suite");
  });

  // ---------------------------------------------------------------- 13-16 gates
  const gated = await learner();
  const lessonBody = {
    expectedRevision: 0,
    playbackPositionSeconds: 30,
    completedSections: [],
  };

  await check("13 the assessment is blocked before the level is started", async () => {
    const reply = await gated.client.post(`/api/curriculum/v2/levels/${L2}/assessment/attempts`, {
      locale: "ru",
    });
    assert.equal(reply.status, 409, reply.text.slice(0, 200));
    assert.equal(reply.body.error, "ASSESSMENT_LEVEL_NOT_STARTED");
  });

  await check("15 lesson progress is blocked before the level is started", async () => {
    const reply = await gated.client.patch(
      `/api/curriculum/v2/levels/${L2}/lesson-progress`,
      lessonBody,
      { "Idempotency-Key": `l2start-before-${gated.userId}` },
    );
    assert.equal(reply.status, 409, reply.text.slice(0, 200));
    assert.equal(reply.body.error, "NOT_STARTED");
  });

  await check("14+16 both become available once the start owner has run", async () => {
    const started = await gated.client.post(startUrl(L2));
    assert.equal(started.status, 200, started.text.slice(0, 200));

    const lesson = await gated.client.patch(
      `/api/curriculum/v2/levels/${L2}/lesson-progress`,
      lessonBody,
      { "Idempotency-Key": `l2start-after-${gated.userId}` },
    );
    assert.equal(lesson.status, 200, `lesson progress: ${lesson.text.slice(0, 300)}`);

    const attempt = await gated.client.post(
      `/api/curriculum/v2/levels/${L2}/assessment/attempts`,
      { locale: "ru" },
    );
    assert.equal(attempt.status, 201, `assessment: ${attempt.text.slice(0, 300)}`);
  });

  // ---------------------------------------------------------------- 17/18 assessment
  const binding = await prisma.levelResourceBinding.findUniqueOrThrow({
    where: { levelDefinitionId: levels.get(L2)!.id },
    select: { assessmentVersionId: true },
  });
  const questions = await prisma.questionDefinition.findMany({
    where: { assessmentVersionId: binding.assessmentVersionId! },
    orderBy: { questionNumber: "asc" },
    select: { stableKey: true, correctAnswer: true, options: true },
  });

  /**
   * The published answer key, read from the definition rather than hard-coded,
   * so a future content revision cannot make this suite silently assert the
   * wrong thing. `correctCount` picks how many answers are right.
   */
  function answersFor(correctCount: number) {
    return questions.map((question, index) => {
      const correct = (question.correctAnswer as { code: string }).code;
      if (index < correctCount) return { questionKey: question.stableKey, answer: { code: correct } };
      const options = (question.options as { code: string }[]) ?? [];
      const wrong = options.map((option) => option.code).find((code) => code !== correct) ?? "a";
      return { questionKey: question.stableKey, answer: { code: wrong } };
    });
  }

  async function attemptFor(client: Client) {
    const reply = await client.post(`/api/curriculum/v2/levels/${L2}/assessment/attempts`, {
      locale: "ru",
    });
    assert.equal(reply.status, 201, reply.text.slice(0, 300));
    const data = reply.body.data as { attempt: { attemptId: number } };
    return String(data.attempt.attemptId);
  }

  await check("18 a failed assessment leaves the level in progress", async () => {
    const failing = await learner({ start: true });
    const attemptId = await attemptFor(failing.client);
    const reply = await failing.client.post(
      `/api/curriculum/v2/assessment/attempts/${attemptId}/submit`,
      { answers: answersFor(0) },
      { "Idempotency-Key": `l2start-fail-${failing.userId}` },
    );
    assert.equal(reply.status, 200, reply.text.slice(0, 300));
    const progress = await progressOf(failing.userId, L2);
    assert.equal(progress?.status, "in_progress", "a failure must not reset the level to available");
    const owned = await enrollmentOf(failing.userId);
    assert.equal(owned.highestCompletedLevel, 1);
    assert.equal(await prisma.xPTransaction.count({ where: { userId: failing.userId } }), 0);
  });

  await check("17 a passed assessment completes the level exactly once", async () => {
    const passing = await learner({ start: true });
    const attemptId = await attemptFor(passing.client);
    const reply = await passing.client.post(
      `/api/curriculum/v2/assessment/attempts/${attemptId}/submit`,
      { answers: answersFor(questions.length) },
      { "Idempotency-Key": `l2start-pass-${passing.userId}` },
    );
    assert.equal(reply.status, 200, reply.text.slice(0, 300));

    const progress = await progressOf(passing.userId, L2);
    assert.equal(progress?.status, "completed");
    const owned = await enrollmentOf(passing.userId);
    assert.equal(owned.highestCompletedLevel, 2, "L3 unlocks through the assessment owner");
    assert.equal(owned.currentLevel, 3);
    assert.equal(
      await prisma.userLevelProgress.count({
        where: { enrollmentId: owned.id, levelDefinitionId: levels.get(L2)!.id },
      }),
      1,
      "exactly one L2 row",
    );
    assert.equal(await prisma.xPTransaction.count({ where: { userId: passing.userId } }), 0);

    // A start after completion must not resurrect the level.
    const restart = await passing.client.post(startUrl(L2));
    assert.equal(restart.status, 409);
    assert.equal(restart.body.error, "LEVEL_START_ALREADY_COMPLETED");
    assert.equal((await progressOf(passing.userId, L2))?.status, "completed");
    assert.equal(
      await prisma.userLevelProgress.count({
        where: { enrollmentId: owned.id, levelDefinitionId: levels.get(L2)!.id },
      }),
      1,
    );
  });

  // ---------------------------------------------------------------- 19 blind spot
  await check("19 this suite seeds no level progress of its own", () => {
    const source = fs.readFileSync(new URL(import.meta.url).pathname, "utf8");
    // Comments and string literals are stripped first: the forbidden calls are
    // named as string literals right here, so a raw scan would match itself.
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n")
      .replace(/`(?:[^`\\]|\\.)*`/g, '"S"')
      .replace(/"(?:[^"\\]|\\.)*"/g, '"S"')
      .replace(/'(?:[^'\\]|\\.)*'/g, '"S"');
    for (const forbidden of [
      "userLevelProgress.create",
      "userLevelProgress.upsert",
      "userLevelProgress.update",
      "userLevelProgress.updateMany",
      "assessmentAttempt.create",
      "assessmentAttempt.update",
      "pocketTraderIdentity.create",
      "xPTransaction.create",
      "userCurriculumEnrollment.update",
    ]) {
      assert.equal(executable.includes(forbidden), false, `suite seeds state: ${forbidden}`);
    }
  });

  await check("19a no generic progress-status route was added", () => {
    for (const candidate of [
      "src/app/api/curriculum/v2/progress/route.ts",
      "src/app/api/curriculum/v2/levels/[stableCode]/status/route.ts",
      "src/app/api/curriculum/v2/levels/[stableCode]/progress/route.ts",
    ]) {
      assert.equal(fs.existsSync(candidate), false, candidate);
    }
    const source = fs.readFileSync(
      "src/app/api/curriculum/v2/levels/[stableCode]/start/route.ts",
      "utf8",
    );
    // The route must delegate; a direct progress write here would be a second
    // start implementation, which is what this phase exists to prevent.
    assert.equal(source.includes("userLevelProgress"), false);
    assert.equal(source.includes("prisma"), false);
    assert.match(source, /startCurrentCurriculumLevel/);
  });

  // A1 amends this suite deliberately. The completion route USED to be listed
  // above as a route that must not exist, because at the time nothing could
  // legally complete a level over HTTP and any such route would have been a
  // second progression implementation. Product decision R1 makes `lesson:manual`
  // the completion contract for 13 of the 20 canonical practical levels, so the
  // route now has to exist — and the guarantee that mattered is restated here as
  // a positive obligation rather than dropped: it must DELEGATE, and it must not
  // be a generic completion endpoint.
  await check("19a-bis the manual completion route delegates and is not generic", () => {
    const routePath = "src/app/api/curriculum/v2/levels/[stableCode]/complete/route.ts";
    assert.equal(fs.existsSync(routePath), true, routePath);
    const source = fs.readFileSync(routePath, "utf8");
    // The route's CODE, with comments stripped: the doc comment names the very
    // identifiers the route must not use, and a substring match cannot tell
    // "documents that this is forbidden" from "does it".
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // No second progression implementation: no direct durable writes here.
    for (const forbidden of [
      "userLevelProgress",
      "xPTransaction",
      "userCurriculumEnrollment",
      "prisma",
      "auditLog",
    ]) {
      assert.equal(code.includes(forbidden), false, forbidden);
    }
    // The caller cannot nominate a learner, an enrollment, a level id or a
    // reward: none of those identifiers may appear in the route's code at all.
    for (const forbidden of ["userId", "enrollmentId", "levelDefinitionId", "xpReward", "sourceType"]) {
      assert.equal(code.includes(forbidden), false, forbidden);
    }
    assert.match(code, /completeManualLevel/);
    assert.match(code, /gatePhase4Self/);
    assert.match(code, /strictObject/);
    // Still no generic completion endpoint anywhere.
    for (const candidate of [
      "src/app/api/curriculum/v2/complete/route.ts",
      "src/app/api/curriculum/v2/levels/complete/route.ts",
      "src/app/api/curriculum/v2/level-completion/route.ts",
    ]) {
      assert.equal(fs.existsSync(candidate), false, candidate);
    }
  });

  await check("19b only the start route may be reached without a started level", async () => {
    // The whole point of the fix: the gate the start route opens is the ONLY new
    // one. Nothing else may have quietly started accepting an unstarted level.
    const fresh = await learner();
    const attempt = await fresh.client.post(
      `/api/curriculum/v2/levels/${L2}/assessment/attempts`,
      { locale: "ru" },
    );
    assert.equal(attempt.status, 409);
    const content = await fresh.client.request(
      "GET",
      `/api/curriculum/v2/levels/${L2}/content?locale=ru`,
    );
    assert.equal(content.status, 200, "reading is legal without starting");
    assert.equal(await progressOf(fresh.userId, L2), null, "a GET must not start the level");
  });

  await prisma.$disconnect();
}

main()
  .then(async () => {
    await stopServer();
    cleanup();
    console.log(`\ncurriculum level start regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch(async (error) => {
    console.error(error);
    await stopServer();
    cleanup();
    console.log(`\ncurriculum level start regression: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  });
