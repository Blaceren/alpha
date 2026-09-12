import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

// Phase 3B.6 acceptance regression: real Next HTTP, real sessions/cookies,
// production resolvers, and one throwaway SQLite database under /tmp.

const dbPath = `/tmp/ata-curriculum-xp-api-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
/**
 * AFD-5D2A — the URL the IN-SUITE fixture client uses, pinned to ONE connection.
 *
 * WHY. This suite seeds a deliberately corrupt relation by bracketing an
 * FK-violating UPDATE with `PRAGMA foreign_keys=OFF` / `=ON`. `PRAGMA
 * foreign_keys` is a PER-CONNECTION setting in SQLite, and Prisma dispatches
 * each `$executeRawUnsafe` through a connection POOL — so the UPDATE could land
 * on a connection that never received the `OFF` and be rejected with SQLite
 * error 787, `FOREIGN KEY constraint failed`, before the first assertion ran.
 *
 * That is what made `curriculum-phase4` intermittently red on BOTH this
 * candidate and the untouched RC baseline: a harness isolation defect, not a
 * product defect. Measured directly — after one explicit `OFF`, 95 of 160
 * pooled reads still reported `foreign_keys=ON`; with the pool pinned to one
 * connection, 160 of 160 read `OFF` across three runs.
 *
 * FOREIGN KEYS ARE NOT WEAKENED ANYWHERE. They stay enforced for the product,
 * for the server, and for every other statement in this suite. The only change
 * is that the fixture's own `OFF`/`ON` bracket now applies to the connection
 * that actually performs the write.
 *
 * The SERVER child deliberately keeps the unpinned `dbUrl` below, so the code
 * under test runs against a normal pool exactly as it does in production.
 */
const fixtureDbUrl = `${dbUrl}?connection_limit=1`;
const PORT = 3960 + (process.pid % 30);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "CurriculumXpRead123!";
const CURRENT = "/api/curriculum/v2/current";
const HISTORY = "/api/curriculum/v2/xp/history";
const PUBLISHED_AT = new Date("2026-07-14T08:00:00.000Z");
const ENROLLED_AT = new Date("2026-07-14T09:00:00.000Z");

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
      redirect: "manual",
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {}),
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

  async csrfToken() {
    const response = await this.get("/api/csrf");
    const token = (response.json as { csrfToken?: string })?.csrfToken;
    assert.equal(typeof token, "string");
    return token!;
  }
}

function body(response: ApiResponse): Record<string, unknown> {
  return (response.json ?? {}) as Record<string, unknown>;
}

function data(response: ApiResponse): Record<string, unknown> {
  return (body(response).data ?? {}) as Record<string, unknown>;
}

function items(response: ApiResponse): Array<Record<string, unknown>> {
  return (data(response).items ?? []) as Array<Record<string, unknown>>;
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

const baseServerEnv: Record<string, string | undefined> = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "curriculum-xp-read-api-session-secret",
  POSTBACK_SECRET: "curriculum-xp-read-api-postback-secret",
  APP_URL: BASE_URL,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};
delete baseServerEnv.NODE_ENV;
delete baseServerEnv.CURRICULUM_V2_ADMIN_ENABLED;
delete baseServerEnv.CURRICULUM_V2_READ_ENABLED;
delete baseServerEnv.CURRICULUM_V2_ENROLLMENT_ENABLED;
delete baseServerEnv.CURRICULUM_V2_XP_ENABLED;

async function startServer(flags: {
  read: boolean;
  xp: boolean;
  admin?: boolean;
  enrollment?: boolean;
}): Promise<ChildProcess> {
  const env = { ...baseServerEnv };
  if (flags.read) env.CURRICULUM_V2_READ_ENABLED = "true";
  if (flags.xp) env.CURRICULUM_V2_XP_ENABLED = "true";
  if (flags.admin) env.CURRICULUM_V2_ADMIN_ENABLED = "true";
  if (flags.enrollment) env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
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
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return proc;
    } catch {
      // keep polling
    }
    if (Date.now() > deadline) throw new Error("dev server did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
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
      env: baseServerEnv as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`);

    // The fixture client is pinned to one connection; see `fixtureDbUrl`.
    process.env.DATABASE_URL = fixtureDbUrl;
    process.env.CURRICULUM_V2_READ_ENABLED = "true";
    process.env.CURRICULUM_V2_XP_ENABLED = "true";
    ({ prisma } = await import("../../src/lib/prisma"));
    const { recordCurriculumXp } = await import("../../src/lib/curriculum/xp");
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    async function createUser(
      email: string,
      options: { role?: "user" | "admin"; status?: "active" | "blocked"; xp?: number } = {},
    ) {
      return prisma!.user.create({
        data: {
          email,
          name: email.split("@")[0],
          passwordHash,
          role: options.role ?? "user",
          status: options.status ?? "active",
          xp: options.xp ?? 0,
        },
      });
    }

    const candidate = await createUser("xp-candidate@example.com", { role: "admin" });
    const primary = await createUser("xp-primary@example.com", { xp: 9999 });
    const zero = await createUser("xp-zero@example.com");
    const below = await createUser("xp-below@example.com");
    const surplus = await createUser("xp-surplus@example.com");
    const archived = await createUser("xp-archived@example.com");
    const completed = await createUser("xp-completed@example.com");
    const other = await createUser("xp-other@example.com");
    const corruptXp = await createUser("xp-corrupt@example.com");
    const corruptRelation = await createUser("xp-relation@example.com");
    const blocked = await createUser("xp-blocked@example.com");

    async function createGraph(versionNumber: number, status: "published" | "archived") {
      const version = await prisma!.curriculumVersion.create({
        data: {
          code: "ata-v2",
          name: `ATA V2 ${versionNumber}`,
          versionNumber,
          status,
          publishedAt: PUBLISHED_AT,
        },
      });
      const moduleDefinition = await prisma!.moduleDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleNumber: 1,
          code: `m-${versionNumber}`,
          title: `Module ${versionNumber}`,
          firstLevel: 1,
          lastLevel: 2,
          learningObjective: "learn",
        },
      });
      const levelOne = await prisma!.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleDefinition.id,
          levelNumber: 1,
          stableCode: `v${versionNumber}.l001.start`,
          type: "lesson",
          title: "Start",
          completionMethod: "lesson",
          xpReward: 10,
          requiredXp: 0,
        },
      });
      const levelTwo = await prisma!.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleDefinition.id,
          levelNumber: 2,
          stableCode: `v${versionNumber}.l002.next`,
          type: "lesson",
          title: "Next",
          completionMethod: "lesson",
          xpReward: 20,
          requiredXp: 150,
          requiredPreviousLevel: 1,
        },
      });
      return { version, levelOne, levelTwo };
    }

    const old = await createGraph(1, "archived");
    const current = await createGraph(2, "published");

    async function enroll(
      userId: number,
      versionId: number,
      options: { currentLevel?: number; highest?: number } = {},
    ) {
      return prisma!.userCurriculumEnrollment.create({
        data: {
          userId,
          curriculumVersionId: versionId,
          curriculumCode: "ata-v2",
          enrolledAt: ENROLLED_AT,
          currentLevel: options.currentLevel ?? 1,
          highestCompletedLevel: options.highest ?? 0,
        },
      });
    }

    async function completedProgress(enrollmentId: number, versionId: number, levelId: number) {
      return prisma!.userLevelProgress.create({
        data: {
          enrollmentId,
          curriculumVersionId: versionId,
          levelDefinitionId: levelId,
          status: "completed",
          startedAt: ENROLLED_AT,
          lastProgressAt: ENROLLED_AT,
          completedAt: ENROLLED_AT,
          completionMethod: "lesson",
          attemptCount: 1,
        },
      });
    }

    const primaryEnrollment = await enroll(primary.id, current.version.id, {
      currentLevel: 2,
      highest: 1,
    });
    await completedProgress(primaryEnrollment.id, current.version.id, current.levelOne.id);
    await enroll(zero.id, current.version.id);
    const belowEnrollment = await enroll(below.id, current.version.id, {
      currentLevel: 2,
      highest: 1,
    });
    await completedProgress(belowEnrollment.id, current.version.id, current.levelOne.id);
    const surplusEnrollment = await enroll(surplus.id, current.version.id, {
      currentLevel: 2,
      highest: 1,
    });
    await completedProgress(surplusEnrollment.id, current.version.id, current.levelOne.id);
    const archivedEnrollment = await enroll(archived.id, old.version.id);
    const completedEnrollment = await enroll(completed.id, current.version.id);
    const otherEnrollment = await enroll(other.id, current.version.id);
    const corruptXpEnrollment = await enroll(corruptXp.id, current.version.id);
    const corruptRelationEnrollment = await enroll(corruptRelation.id, current.version.id);

    async function award(input: {
      enrollmentId: number;
      sourceType: "level_completion" | "promocode";
      sourceId: string;
      amount: number;
      levelDefinitionId?: number;
      createdAt: Date;
    }) {
      const result = await recordCurriculumXp({
        enrollmentId: input.enrollmentId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        amount: input.amount,
        levelDefinitionId: input.levelDefinitionId,
        metadata: { regression: true },
      });
      await prisma!.xPTransaction.update({
        where: { id: result.transaction.id },
        data: { createdAt: input.createdAt },
      });
      return result.transaction.id;
    }

    const baseTime = new Date("2026-07-14T10:00:00.000Z");
    await award({
      enrollmentId: primaryEnrollment.id,
      sourceType: "level_completion",
      sourceId: "primary-level-1",
      amount: 10,
      levelDefinitionId: current.levelOne.id,
      createdAt: new Date(baseTime.getTime() + 53.5 * 60_000),
    });
    for (let index = 1; index <= 54; index += 1) {
      const minute = index === 53 ? 54 : index;
      await award({
        enrollmentId: primaryEnrollment.id,
        sourceType: "promocode",
        sourceId: `primary-promo-${index}`,
        amount: index,
        createdAt: new Date(baseTime.getTime() + minute * 60_000),
      });
    }
    await award({
      enrollmentId: belowEnrollment.id,
      sourceType: "promocode",
      sourceId: "below-120",
      amount: 120,
      createdAt: baseTime,
    });
    await award({
      enrollmentId: surplusEnrollment.id,
      sourceType: "promocode",
      sourceId: "surplus-150",
      amount: 150,
      createdAt: baseTime,
    });
    await award({
      enrollmentId: archivedEnrollment.id,
      sourceType: "promocode",
      sourceId: "archived-5",
      amount: 5,
      createdAt: baseTime,
    });
    await award({
      enrollmentId: completedEnrollment.id,
      sourceType: "level_completion",
      sourceId: "completed-level-1",
      amount: 10,
      levelDefinitionId: current.levelOne.id,
      createdAt: baseTime,
    });
    await award({
      enrollmentId: completedEnrollment.id,
      sourceType: "level_completion",
      sourceId: "completed-level-2",
      amount: 20,
      levelDefinitionId: current.levelTwo.id,
      createdAt: new Date(baseTime.getTime() + 60_000),
    });
    await completedProgress(completedEnrollment.id, current.version.id, current.levelOne.id);
    await completedProgress(completedEnrollment.id, current.version.id, current.levelTwo.id);
    await prisma!.userCurriculumEnrollment.update({
      where: { id: completedEnrollment.id },
      data: {
        status: "completed",
        currentLevel: 3,
        highestCompletedLevel: 2,
        completedAt: new Date("2026-07-14T12:00:00.000Z"),
      },
    });
    await award({
      enrollmentId: otherEnrollment.id,
      sourceType: "promocode",
      sourceId: "other-1",
      amount: 1,
      createdAt: baseTime,
    });
    const corruptId = await award({
      enrollmentId: corruptXpEnrollment.id,
      sourceType: "promocode",
      sourceId: "corrupt-1",
      amount: 1,
      createdAt: baseTime,
    });
    await prisma!.$executeRawUnsafe(
      `UPDATE "XPTransaction" SET "payloadFingerprint" = 'sha256:${"0".repeat(64)}' WHERE "id" = ${corruptId}`,
    );
    const corruptRelationId = await award({
      enrollmentId: corruptRelationEnrollment.id,
      sourceType: "level_completion",
      sourceId: "relation-1",
      amount: 1,
      levelDefinitionId: current.levelOne.id,
      createdAt: baseTime,
    });
    await prisma!.$executeRawUnsafe("PRAGMA foreign_keys=OFF");
    await prisma!.$executeRawUnsafe(
      `UPDATE "XPTransaction" SET "levelDefinitionId" = ${old.levelOne.id} WHERE "id" = ${corruptRelationId}`,
    );
    await prisma!.$executeRawUnsafe("PRAGMA foreign_keys=ON");
    await prisma!.xpEvent.create({
      data: { userId: primary.id, amount: 777, source: "task", sourceId: "legacy-only" },
    });
    const promo = await prisma!.promocode.create({
      data: {
        code: "XPREADV1",
        type: "xp_bonus",
        value: { xp: 7 },
        perUserLimit: 1,
      },
    });

    const anonymous = new HttpClient();
    server = await startServer({ read: false, xp: false, admin: true, enrollment: true });

    await check("1. READ off returns 404 before authentication", async () => {
      assert.deepEqual((await anonymous.get(HISTORY)).json, { error: "NOT_FOUND" });
    });
    await check("6. ADMIN does not replace READ and XP flags", async () => {
      assert.equal((await anonymous.get(`${HISTORY}?unexpected=1`)).status, 404);
    });
    await check("7. ENROLLMENT does not replace READ and XP flags", async () => {
      assert.equal((await anonymous.get(CURRENT)).status, 404);
    });

    await stopServer(server);
    server = null;
    server = await startServer({ read: true, xp: false });

    await check("2. XP off hides history before authentication", async () => {
      assert.deepEqual((await anonymous.get(HISTORY)).json, { error: "NOT_FOUND" });
    });
    const candidateClient = new HttpClient();
    const primaryClient = new HttpClient();
    assert.equal((await candidateClient.login(candidate.email)).status, 200);
    assert.equal((await primaryClient.login(primary.email)).status, 200);
    await check("3. current remains available with READ on and XP off", async () => {
      assert.equal((await primaryClient.get(CURRENT)).status, 200);
    });
    await check("14. candidate with XP disabled has no invented XP summary", async () => {
      const response = await candidateClient.get(CURRENT);
      assert.equal(response.status, 200);
      assert.equal(data(response).kind, "candidate");
      assert.equal("currentXp" in data(response), false);
    });
    await check("15. enrolled current exposes explicit disabled XP block", async () => {
      assert.deepEqual(data(await primaryClient.get(CURRENT)).xp, { kind: "disabled" });
    });

    await stopServer(server);
    server = null;
    server = await startServer({ read: true, xp: true });

    await check("4. anonymous history returns 401", async () => {
      assert.equal((await anonymous.get(HISTORY)).status, 401);
    });

    const accounts = [
      candidate,
      primary,
      zero,
      below,
      surplus,
      archived,
      completed,
      other,
      corruptXp,
      corruptRelation,
      blocked,
    ];
    const clients = new Map<string, HttpClient>();
    for (const account of accounts) {
      const client = new HttpClient();
      assert.equal((await client.login(account.email)).status, 200);
      clients.set(account.email, client);
    }
    await prisma!.user.update({ where: { id: blocked.id }, data: { status: "blocked" } });
    const client = (email: string) => clients.get(email)!;

    await check("5. blocked session returns 403", async () => {
      assert.equal((await client(blocked.email).get(HISTORY)).status, 403);
    });
    await check("8. GET history requires no CSRF", async () => {
      assert.equal((await client(primary.email).get(HISTORY, { "x-csrf-token": "" })).status, 200);
    });
    await check("9. all XP read responses are no-store", async () => {
      for (const response of [
        await client(primary.email).get(CURRENT),
        await client(primary.email).get(HISTORY),
      ]) {
        assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      }
    });
    await check("10. unexpected query is rejected", async () => {
      assert.equal((await client(primary.email).get(`${HISTORY}?unexpected=1`)).status, 400);
    });
    await check("11. userId injection is rejected", async () => {
      assert.equal((await client(primary.email).get(`${HISTORY}?userId=${other.id}`)).status, 400);
    });
    await check("12. enrollment version and asOf injection are rejected", async () => {
      assert.equal(
        (await client(primary.email).get(`${HISTORY}?enrollmentId=1&versionId=1&asOf=now`)).status,
        400,
      );
    });
    await check("13. malformed cursor is rejected", async () => {
      assert.equal((await client(primary.email).get(`${HISTORY}?cursor=abc`)).status, 400);
    });

    const zeroCurrent = await client(zero.email).get(CURRENT);
    const primaryCurrent = await client(primary.email).get(CURRENT);
    const primaryXp = data(primaryCurrent).xp as Record<string, unknown>;
    await check("16. zero XP summary is available", () => {
      assert.equal((data(zeroCurrent).xp as Record<string, unknown>).currentXp, 0);
    });
    await check("17. multiple ledger rows are represented", () => {
      assert.equal(primaryXp.transactionCount, 55);
    });
    await check("18. currentXp comes from the full pinned ledger", () => {
      assert.equal(primaryXp.currentXp, 1495);
    });
    await check("19. transactionCount is exact", () => {
      assert.equal(primaryXp.transactionCount, 55);
    });
    await check("20. lastTransactionAt is exact", () => {
      assert.equal(
        primaryXp.lastTransactionAt,
        new Date(baseTime.getTime() + 54 * 60_000).toISOString(),
      );
    });
    await check("21. nextLevelRequiredXp comes from current definition", async () => {
      const value = data(await client(below.email).get(CURRENT)).xp as Record<string, unknown>;
      assert.equal(value.nextLevelRequiredXp, 150);
    });
    await check("22. xpRemaining below threshold is exact", async () => {
      const value = data(await client(below.email).get(CURRENT)).xp as Record<string, unknown>;
      assert.equal(value.xpRemaining, 30);
    });
    await check("23. exact or surplus threshold clamps remaining to zero", async () => {
      const value = data(await client(surplus.email).get(CURRENT)).xp as Record<string, unknown>;
      assert.equal(value.xpRemaining, 0);
      assert.equal(primaryXp.xpRemaining, 0);
    });
    const archivedCurrent = await client(archived.email).get(CURRENT);
    await check("24. archived pin retains its XP", () => {
      assert.equal((data(archivedCurrent).xp as Record<string, unknown>).currentXp, 5);
    });
    await check("25. newer published version does not repin archived enrollment", () => {
      const curriculum = data(archivedCurrent).curriculum as Record<string, unknown>;
      assert.equal(curriculum.versionNumber, 1);
      assert.equal(curriculum.status, "archived");
    });
    await check("26. completed enrollment returns terminal XP summary", async () => {
      const response = await client(completed.email).get(CURRENT);
      const xp = data(response).xp as Record<string, unknown>;
      assert.equal(data(response).kind, "completed");
      assert.equal(xp.currentXp, 30);
      assert.equal(xp.nextLevelRequiredXp, null);
      assert.equal(xp.xpRemaining, 0);
    });
    await check("27. corrupt XP returns sanitized 409", async () => {
      const response = await client(corruptXp.email).get(CURRENT);
      assert.equal(response.status, 409);
      assert.equal(body(response).error, "XP_STATE_CORRUPT");
    });
    await check("28. V1 User.xp and XpEvent are ignored", () => {
      assert.equal(primaryXp.currentXp, 1495);
      assert.notEqual(primaryXp.currentXp, primary.xp + 777);
    });
    await check("29. current XP response excludes internal ledger fields", () => {
      const keys = collectKeys(primaryCurrent.json);
      for (const forbidden of [
        "idempotencyKey",
        "payloadFingerprint",
        "metadata",
        "sourceId",
        "createdById",
        "userId",
        "enrollmentId",
        "curriculumVersionId",
      ]) {
        assert.equal(keys.has(forbidden), false, forbidden);
      }
    });

    await check("30. candidate history is not_enrolled and empty", async () => {
      const response = await client(candidate.email).get(HISTORY);
      assert.equal(data(response).kind, "not_enrolled");
      assert.equal(data(response).summary, null);
      assert.deepEqual(items(response), []);
    });
    const primaryHistory = await client(primary.email).get(HISTORY);
    await check("31. active enrollment history is available", () => {
      assert.equal(primaryHistory.status, 200);
      assert.equal(data(primaryHistory).kind, "available");
    });
    await check("32. archived pin history remains selected", async () => {
      const response = await client(archived.email).get(HISTORY);
      assert.equal(data(response).kind, "available");
      assert.equal((data(response).curriculum as Record<string, unknown>).versionNumber, 1);
    });
    await check("33. completed enrollment history is terminal", async () => {
      assert.equal(data(await client(completed.email).get(HISTORY)).kind, "completed");
    });
    await check("34. history contains completion and promocode sources", () => {
      const sources = new Set(items(primaryHistory).map((item) => item.sourceType));
      assert.equal(sources.has("level_completion"), true);
      assert.equal(sources.has("promocode"), true);
    });
    await check("35. level-linked history exposes only safe level mapping", () => {
      const row = items(primaryHistory).find((item) => item.sourceType === "level_completion")!;
      assert.deepEqual(row.level, { levelNumber: 1, stableCode: "v2.l001.start" });
    });
    await check("36. non-level source maps level to null", () => {
      assert.equal(items(primaryHistory).find((item) => item.sourceType === "promocode")!.level, null);
    });
    await check("37. metadata is absent", () => {
      assert.equal(collectKeys(primaryHistory.json).has("metadata"), false);
    });
    await check("38. sourceId is absent", () => {
      assert.equal(collectKeys(primaryHistory.json).has("sourceId"), false);
    });
    await check("39. fingerprint and idempotency key are absent", () => {
      const keys = collectKeys(primaryHistory.json);
      assert.equal(keys.has("payloadFingerprint"), false);
      assert.equal(keys.has("idempotencyKey"), false);
    });
    await check("40. actor and internal IDs are absent", () => {
      const keys = collectKeys(primaryHistory.json);
      for (const key of ["id", "userId", "enrollmentId", "curriculumVersionId", "createdById"]) {
        assert.equal(keys.has(key), false, key);
      }
    });
    await check("41. history order is createdAt descending", () => {
      const times = items(primaryHistory).map((item) => String(item.createdAt));
      assert.deepEqual(times, [...times].sort().reverse());
    });
    await check("42. equal timestamps use id descending tie-breaker", () => {
      assert.equal(items(primaryHistory)[0].amount, 54);
      assert.equal(items(primaryHistory)[1].amount, 53);
      assert.equal(items(primaryHistory)[0].createdAt, items(primaryHistory)[1].createdAt);
    });
    await check("43. default limit is 20", () => {
      assert.equal(items(primaryHistory).length, 20);
    });
    await check("44. custom valid limit is honored", async () => {
      assert.equal(items(await client(primary.email).get(`${HISTORY}?limit=7`)).length, 7);
    });
    await check("45. max limit 50 is honored", async () => {
      assert.equal(items(await client(primary.email).get(`${HISTORY}?limit=50`)).length, 50);
    });
    await check("46. limit 0 and 51 are rejected", async () => {
      assert.equal((await client(primary.email).get(`${HISTORY}?limit=0`)).status, 400);
      assert.equal((await client(primary.email).get(`${HISTORY}?limit=51`)).status, 400);
    });
    const firstPage = await client(primary.email).get(`${HISTORY}?limit=7`);
    const firstCursor = ((data(firstPage).page as Record<string, unknown>).nextCursor ?? null) as string | null;
    await check("47. first page returns opaque nextCursor", () => {
      assert.equal(typeof firstCursor, "string");
      assert.doesNotMatch(firstCursor!, /primary|enrollment|user|2026/i);
    });
    const secondPage = await client(primary.email).get(
      `${HISTORY}?limit=7&cursor=${encodeURIComponent(firstCursor!)}`,
    );
    await check("48. cursor returns the second page", () => {
      assert.equal(secondPage.status, 200);
      assert.equal(items(secondPage).length, 7);
      assert.notDeepEqual(items(secondPage), items(firstPage));
    });
    await check("49. adjacent pages contain no duplicates", () => {
      const key = (item: Record<string, unknown>) => `${item.createdAt}:${item.amount}`;
      const left = new Set(items(firstPage).map(key));
      assert.equal(items(secondPage).some((item) => left.has(key(item))), false);
    });
    await check("50. stable pagination has no missing rows", async () => {
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const response = await client(primary.email).get(
          `${HISTORY}?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        assert.equal(response.status, 200, response.text);
        for (const item of items(response)) {
          seen.add(`${item.createdAt}:${item.amount}`);
        }
        cursor = ((data(response).page as Record<string, unknown>).nextCursor ?? null) as string | null;
      } while (cursor);
      assert.equal(seen.size, 55);
    });
    await check("51. cursor cannot cross enrollment", async () => {
      const response = await client(other.email).get(
        `${HISTORY}?cursor=${encodeURIComponent(firstCursor!)}`,
      );
      assert.equal(response.status, 400);
    });
    let corruptRelationResponse!: ApiResponse;
    await check("52. corrupt level/version relation returns 409", async () => {
      corruptRelationResponse = await client(corruptRelation.email).get(HISTORY);
      assert.equal(corruptRelationResponse.status, 409);
      assert.equal(body(corruptRelationResponse).error, "XP_STATE_CORRUPT");
    });
    await check("53. raw infrastructure errors never leak", () => {
      assert.doesNotMatch(
        corruptRelationResponse.text,
        /Prisma|SQLite|SELECT|UPDATE|stack|\/home\/|DATABASE_URL|SESSION_SECRET|cursor.*payload/i,
      );
    });

    const auditBeforeReads = await prisma!.auditLog.count();
    const timestampBeforeReads = JSON.stringify(
      await prisma!.userCurriculumEnrollment.findMany({
        orderBy: { id: "asc" },
        select: { id: true, updatedAt: true, lastMeaningfulActionAt: true },
      }),
    );
    await client(primary.email).get(HISTORY);
    await check("54. GET creates no audit", async () => {
      assert.equal(await prisma!.auditLog.count(), auditBeforeReads);
    });
    await check("55. GET changes no enrollment timestamps", async () => {
      const after = JSON.stringify(
        await prisma!.userCurriculumEnrollment.findMany({
          orderBy: { id: "asc" },
          select: { id: true, updatedAt: true, lastMeaningfulActionAt: true },
        }),
      );
      assert.equal(after, timestampBeforeReads);
    });
    await check("56. repeated GET is deterministic", async () => {
      const first = await client(primary.email).get(`${HISTORY}?limit=7`);
      const second = await client(primary.email).get(`${HISTORY}?limit=7`);
      assert.equal(first.text, second.text);
    });
    await check("57. page mapping has bounded query shape and no N+1", () => {
      const source = fs.readFileSync("src/lib/curriculum/xp-read.ts", "utf8");
      assert.equal((source.match(/xPTransaction\.findMany/g) ?? []).length, 1);
      assert.equal(/for \([^)]*item[^)]*\)[\s\S]{0,200}await tx\./.test(source), false);
    });

    await check("58. V1 authenticated read remains operational", async () => {
      const response = await client(primary.email).get("/api/levels");
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(body(response).levels));
    });
    await check("59. V1 promocode route remains operational", async () => {
      const promoClient = client(candidate.email);
      const csrf = await promoClient.csrfToken();
      const response = await promoClient.request("POST", "/api/promocodes/redeem", {
        body: { code: promo.code },
        headers: {
          "x-csrf-token": csrf,
          "Idempotency-Key": "xp-read-v1-promo-request",
        },
      });
      assert.equal(response.status, 200, response.text);
    });
    await check("60. health route on the test server is 200", async () => {
      assert.equal((await anonymous.get("/api/health")).status, 200);
    });

    await stopServer(server);
    server = null;
    await prisma!.$disconnect();
    prisma = null;
    cleanupDb();
    await check("61. test listener is removed", () => {
      assert.equal(listenerOnTestPort(), "");
    });
    await check("62. temporary DB files are removed in finally-safe cleanup", () => {
      for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
      }
    });
  } finally {
    await stopServer(server);
    await prisma?.$disconnect();
    cleanupDb();
  }

  console.log(`\nCurriculum XP read API regression: ${passed} passed, ${failed} failed`);
  assert.equal(passed + failed, 62, "XP read API scenario count drifted");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  cleanupDb();
  process.exitCode = 1;
});
