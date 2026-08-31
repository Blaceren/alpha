import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { CRM_STAFF_ROLES, STAFF_ROLE_PERMISSIONS } from "../../src/lib/crm/roles";
import { crmUserDetailResponseSchema } from "../../src/lib/crm/schemas";
import { maskEmail } from "../../src/lib/crm/users";
import { CRM_USER_DETAIL_DISPLAY_NAME_FALLBACK, PRISMA_INT_MAX } from "../../src/lib/crm/user-detail";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

// Real HTTP regression for GET /api/crm/v1/users/[userId]. Isolated next dev
// server against a throwaway /tmp SQLite database. No deployed database, no
// external service, no persistent process.
const dbPath = `/tmp/ata-crm-user-detail-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3960 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "CrmDetail123!";
const SESSION_SECRET = "crm-user-detail-regression-secret";
const SESSION_COOKIE = "trading_platform_session";

let passed = 0;
let failed = 0;
let logs = "";

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    if (logs) console.error(`--- server log tail ---\n${logs.slice(-1200)}\n--- end ---`);
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

function signToken(userId: number, role: string, expiresAt: number) {
  const payload = `${userId}.${role}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET,
  POSTBACK_SECRET: "crm-detail-postback-secret",
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};
for (const key of ["NODE_ENV"]) delete baseEnv[key];

async function start() {
    /* No --turbopack here, deliberately.
     This workspace's node_modules is a farm of 402 symlinks into
     /srv/ata/repos/backend/node_modules, so `next` resolves OUTSIDE the project
     root. Turbopack follows that link, fails `get_next_package`, and dies with
     "Next.js package not found" while reporting its own version as 0.0.0 — the
     server never binds, and all four of these suites failed at start() without
     ever reaching an assertion. The webpack dev server resolves through the
     same symlinks and answers /api/health in about three seconds.
     What these suites test is HTTP behaviour, permissions and row counts. The
     bundler was incidental to that, and picking the one that tolerates the
     dependency layout is a change to the test runtime, not to the product. */
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(), env: baseEnv, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value) => { logs += String(value); });
  child.stderr?.on("data", (value) => { logs += String(value); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return child; } catch { /* boot */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-3000)}`);
}

async function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}

type Reply = { status: number; headers: Headers; body: Record<string, unknown>; text: string };
class Client {
  cookies = new Map<string, string>();
  async request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const rawCookie of response.headers.getSetCookie()) {
      const pair = rawCookie.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let value: unknown = {};
    try { value = JSON.parse(text); } catch { /* non-json */ }
    return { status: response.status, headers: response.headers, body: value as Record<string, unknown>, text };
  }
  setRawSession(token: string) { this.cookies.set(SESSION_COOKIE, token); }
  login(email: string) { return this.request("POST", "/api/auth/login", { email, password, captchaToken: "dev-captcha-ok" }); }
}

// One authenticated client per account: /api/auth/login is rate limited, so
// logging in per check would throttle the run rather than test anything.
const clientCache = new Map<string, Client>();
async function loginAs(email: string) {
  const cached = clientCache.get(email);
  if (cached) return cached;
  const client = new Client();
  const login = await client.login(email);
  assert.equal(login.status, 200, `login failed for ${email}: ${login.text}`);
  clientCache.set(email, client);
  return client;
}

async function main() {
  cleanup();
  let server: ChildProcess | null = null;
  try {
    const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], { env: baseEnv, encoding: "utf8" });
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);

    // --- staff (one per StaffRole) -----------------------------------------
    const staffByRole = new Map<string, { email: string; userId: number }>();
    for (const role of CRM_STAFF_ROLES) {
      const email = `staff-${role}@example.com`;
      const user = await prisma.user.create({
        data: { email, name: `Staff ${role}`, role: "admin", passwordHash: hash },
      });
      await prisma.staffProfile.create({
        data: { userId: user.id, displayName: `Staff ${role}`, staffRole: role },
      });
      staffByRole.set(role, { email, userId: user.id });
    }

    // Learner with no StaffProfile -> 403 on CRM endpoints.
    const plainLearner = await prisma.user.create({
      data: { email: "plain-learner@example.com", name: "Plain Learner", role: "user", passwordHash: hash },
    });

    // Staff account that gets blocked mid-test -> 401.
    const blocked = await prisma.user.create({ data: { email: "blocked-staff@example.com", name: "Blocked Staff", role: "support", passwordHash: hash } });
    await prisma.staffProfile.create({ data: { userId: blocked.id, displayName: "Blocked Staff", staffRole: "support" } });

    // --- target learners ----------------------------------------------------
    const target = await prisma.user.create({
      data: {
        email: "target-learner@example.test",
        name: "Target Learner",
        role: "user",
        passwordHash: hash,
        level: 7,
        xp: 4242,
        emailVerifiedAt: new Date("2026-02-02T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    });
    const unconfirmed = await prisma.user.create({
      data: { email: "unconfirmed@example.test", name: "Unconfirmed Learner", role: "user", passwordHash: hash, emailVerifiedAt: null },
    });
    const blockedLearner = await prisma.user.create({
      data: { email: "blocked-learner@example.test", name: "Blocked Learner", role: "user", passwordHash: hash, status: "blocked" },
    });
    const namelessLearner = await prisma.user.create({
      data: { email: "nameless@example.test", name: "   ", role: "user", passwordHash: hash },
    });

    // Non-learner accounts that must be indistinguishable from "not found".
    const staffTarget = staffByRole.get("crm_admin")!.userId;
    const newsEditor = await prisma.user.create({
      data: { email: "news@example.test", name: "News Editor", role: "news_editor", passwordHash: hash },
    });

    const detailUrl = (id: string | number) => `/api/crm/v1/users/${id}`;

    server = await start();

    /* ------------------------------------------------------ authorization */

    await check("1. unauthenticated request is 401", async () => {
      const reply = await new Client().request("GET", detailUrl(target.id));
      assert.equal(reply.status, 401);
      assert.equal(reply.body.code, "unauthorized");
      assert.ok(String(reply.body.requestId).length > 0);
    });

    await check("2. invalid session signature is 401", async () => {
      const client = new Client();
      client.setRawSession("1.admin.9999999999999.deadbeef");
      assert.equal((await client.request("GET", detailUrl(target.id))).status, 401);
    });

    await check("3. expired but correctly signed session is 401", async () => {
      const client = new Client();
      client.setRawSession(signToken(staffTarget, "admin", Date.now() - 60_000));
      assert.equal((await client.request("GET", detailUrl(target.id))).status, 401);
    });

    await check("4. blocked authenticated account is 401", async () => {
      const client = await loginAs("blocked-staff@example.com");
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "blocked" } });
      assert.equal((await client.request("GET", detailUrl(target.id))).status, 401);
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "active" } });
    });

    await check("5. authenticated learner without a StaffProfile is 403", async () => {
      const client = await loginAs("plain-learner@example.com");
      const reply = await client.request("GET", detailUrl(target.id));
      assert.equal(reply.status, 403);
      assert.equal(reply.body.code, "unauthorized");
    });

    let adminReply: Reply;
    await check("6. authenticated staff is 200", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      adminReply = await client.request("GET", detailUrl(target.id));
      assert.equal(adminReply.status, 200);
    });

    await check("7. all nine StaffRoles can read a learner detail", async () => {
      for (const role of CRM_STAFF_ROLES) {
        const client = await loginAs(staffByRole.get(role)!.email);
        const reply = await client.request("GET", detailUrl(target.id));
        assert.equal(reply.status, 200, `${role} expected 200, got ${reply.status}`);
        assert.equal(reply.body.userId, String(target.id));
      }
    });

    await check("8. StaffRole comes from StaffProfile, not UserRole", async () => {
      // read_only staff has UserRole "admin" but holds no CRM permissions.
      const client = await loginAs(staffByRole.get("read_only")!.email);
      const reply = await client.request("GET", detailUrl(target.id));
      assert.equal(reply.status, 200);
      assert.equal((reply.body.email as { visibility: string }).visibility, "masked");
    });

    /* ---------------------------------------------------------- path input */

    await check("9. canonical userId is accepted", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      assert.equal((await client.request("GET", detailUrl(target.id))).status, 200);
    });

    await check("10-19. malformed userIds are rejected with invalid_input", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const bad = [
        "0", "-1", "+1", "01", "007", "1.5", "1e3", "NaN", "Infinity",
        "%201", "1%20", "mock_user_1", "emp_backend_001", "usr_mock_017",
        "abc", "12345678901", "99999999999999999999", "1,2", "0x10", "1n",
      ];
      for (const raw of bad) {
        const reply = await client.request("GET", detailUrl(raw));
        assert.equal(reply.status, 400, `${raw} should be 400, got ${reply.status}`);
        assert.equal(reply.body.code, "invalid_input", `${raw} wrong code`);
      }
    });

    await check("19b. an id above the Prisma Int range is rejected", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", detailUrl(String(PRISMA_INT_MAX + 1)));
      assert.equal(reply.status, 400);
      assert.equal(reply.body.code, "invalid_input");
      // The largest valid Int is shape-valid; it simply does not exist -> 404.
      const max = await client.request("GET", detailUrl(String(PRISMA_INT_MAX)));
      assert.equal(max.status, 404);
    });

    await check("20. unknown query keys are rejected, never ignored", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      for (const key of ["include", "expand", "fields", "select", "limit", "cursor", "search", "role"]) {
        const reply = await client.request("GET", `${detailUrl(target.id)}?${key}=x`);
        assert.equal(reply.status, 400, `${key} should be rejected`);
        assert.equal(reply.body.code, "invalid_input");
      }
    });

    /* ------------------------------------------------ learner / not-found */

    let notFoundReply: Reply;
    await check("21. unknown id is 404", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      notFoundReply = await client.request("GET", detailUrl(987654321));
      assert.equal(notFoundReply.status, 404);
      assert.equal(notFoundReply.body.code, "not_found");
      assert.equal(notFoundReply.body.messageKey, "crm.users.detail.not_found");
    });

    await check("22. a staff account id returns an identical 404", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", detailUrl(staffTarget));
      assert.equal(reply.status, 404);
      assert.equal(reply.body.code, notFoundReply.body.code);
      assert.equal(reply.body.messageKey, notFoundReply.body.messageKey);
    });

    await check("23. a non-learner system account returns an identical 404", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", detailUrl(newsEditor.id));
      assert.equal(reply.status, 404);
      assert.equal(reply.body.messageKey, notFoundReply.body.messageKey);
    });

    await check("24. the not-found body reveals no account type or existence", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      for (const id of [987654321, staffTarget, newsEditor.id]) {
        const reply = await client.request("GET", detailUrl(id));
        assert.deepEqual(Object.keys(reply.body).sort(), ["code", "messageKey", "requestId"]);
        for (const leak of ["admin", "news_editor", "staff", "StaffProfile", "role", "@example.com", "@example.test"]) {
          assert.ok(!reply.text.includes(leak), `404 leaked ${leak}`);
        }
      }
    });

    await check("25. 404 requestId is present and matches the header", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", detailUrl(987654321));
      const header = String(reply.headers.get("x-request-id") ?? "");
      assert.ok(header.length > 0);
      assert.equal(reply.body.requestId, header);
      assert.ok(String(reply.headers.get("cache-control") ?? "").includes("no-store"));
    });

    /* ------------------------------------------------------------ contract */

    await check("26. success body matches the strict Zod schema exactly", () => {
      const parsed = crmUserDetailResponseSchema.safeParse(adminReply.body);
      assert.ok(parsed.success, JSON.stringify(adminReply.body));
    });

    await check("27-28. userId is the canonical decimal string", () => {
      assert.equal(typeof adminReply.body.userId, "string");
      assert.equal(adminReply.body.userId, String(target.id));
      assert.match(String(adminReply.body.userId), /^[1-9][0-9]*$/);
    });

    await check("29. displayName is projected, with an honest blank fallback", async () => {
      assert.equal(adminReply.body.displayName, "Target Learner");
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", detailUrl(namelessLearner.id));
      assert.equal(reply.status, 200);
      assert.equal(reply.body.displayName, CRM_USER_DETAIL_DISPLAY_NAME_FALLBACK);
      assert.ok(!String(reply.body.displayName).includes("@"));
    });

    await check("30. active status is reported", () => {
      assert.equal(adminReply.body.status, "active");
    });

    await check("31. a blocked learner is still readable by valid staff", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", detailUrl(blockedLearner.id));
      assert.equal(reply.status, 200);
      assert.equal(reply.body.status, "blocked");
    });

    await check("32-33. level and xp are exact", () => {
      assert.equal(adminReply.body.level, 7);
      assert.equal(adminReply.body.xp, 4242);
    });

    await check("33b. xp is a nonnegative integer (proven backend invariant)", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      // A fresh learner starts at the schema default of 0 and must still parse.
      const reply = await client.request("GET", detailUrl(unconfirmed.id));
      assert.equal(reply.status, 200);
      assert.equal(reply.body.xp, 0);
      assert.ok(crmUserDetailResponseSchema.safeParse(reply.body).success);
    });

    await check("34-35. emailConfirmed reflects emailVerifiedAt", async () => {
      assert.equal(adminReply.body.emailConfirmed, true);
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", detailUrl(unconfirmed.id));
      assert.equal(reply.body.emailConfirmed, false);
    });

    await check("36. createdAt is the exact ISO timestamp", () => {
      assert.equal(adminReply.body.createdAt, "2026-01-01T12:00:00.000Z");
    });

    await check("37-38. success is no-store and carries X-Request-Id", () => {
      assert.ok(String(adminReply.headers.get("cache-control") ?? "").includes("no-store"));
      assert.ok(String(adminReply.headers.get("x-request-id") ?? "").length > 0);
    });

    await check("39. the body has exactly the eight contract keys", () => {
      assert.deepEqual(
        Object.keys(adminReply.body).sort(),
        ["createdAt", "displayName", "email", "emailConfirmed", "level", "status", "userId", "xp"],
      );
    });

    await check("40. no raw User record is spread into the response", () => {
      for (const raw of ["updatedAt", "passwordHash", "referralCode", "pendingEmail", "currentTask", "leaderboardExcluded", "selectedAchievementId", "emailVerifiedAt", "id\"", "role"]) {
        assert.ok(!adminReply.text.includes(raw), `raw column leaked: ${raw}`);
      }
    });

    /* ------------------------------------------------- permissions/privacy */

    await check("41. view_identity_full_email grants the full address", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", detailUrl(target.id));
      assert.deepEqual(reply.body.email, { value: "target-learner@example.test", visibility: "full" });
    });

    await check("42. without the permission only a deterministic mask is returned", async () => {
      for (const role of ["mentor", "support", "moderator", "analyst", "content_manager", "read_only"] as const) {
        const client = await loginAs(staffByRole.get(role)!.email);
        const reply = await client.request("GET", detailUrl(target.id));
        assert.deepEqual(
          reply.body.email,
          { value: maskEmail("target-learner@example.test"), visibility: "masked" },
          `${role} projection wrong`,
        );
      }
    });

    await check("43. reveal_pii alone does not grant the full email", () => {
      for (const [role, perms] of Object.entries(STAFF_ROLE_PERMISSIONS)) {
        if (perms.includes("reveal_pii")) {
          assert.ok(
            perms.includes("view_identity_full_email"),
            `${role} has reveal_pii without view_identity_full_email — masking rule must be re-reviewed`,
          );
        }
      }
    });

    await check("44. the role name does not re-grant a removed permission", async () => {
      // Demote a crm_admin StaffProfile to read_only: same UserRole "admin",
      // same account, but the projection must follow the StaffProfile.
      const axis = await prisma.user.create({ data: { email: "axis@example.com", name: "Axl Axis", role: "admin", passwordHash: hash } });
      await prisma.staffProfile.create({ data: { userId: axis.id, displayName: "Axl Axis", staffRole: "read_only" } });
      const client = await loginAs("axis@example.com");
      const reply = await client.request("GET", detailUrl(target.id));
      assert.equal(reply.status, 200);
      assert.equal((reply.body.email as { visibility: string }).visibility, "masked");
      assert.ok(!reply.text.includes("target-learner@example.test"));
    });

    await check("45. unauthorized JSON contains no full email anywhere", async () => {
      const client = await loginAs(staffByRole.get("analyst")!.email);
      const reply = await client.request("GET", detailUrl(target.id));
      for (const address of ["target-learner@example.test", "unconfirmed@example.test", "nameless@example.test"]) {
        assert.ok(!reply.text.includes(address), `leaked ${address}`);
      }
    });

    await check("46-54. no forbidden field appears in the success body", () => {
      const banned = [
        "employeeId", "staffProfile", "StaffProfile", "staffRole", "permissions", "effectivePermissions",
        "passwordHash", "password", "token", "pendingEmail", "referralCode",
        "ownerId", "owner", "noteCount", "notes", "team",
        "balance", "deposit", "withdraw", "exchangeAccount", "ExchangeAccount", "totalDeposits", "traderId",
        "updatedAt", "lastActivity", "lastActiveAt", "lastMeaningfulActionAt",
        "currentTask", "leaderboardExcluded", "selectedAchievementId",
        "achievement", "curriculum", "enrollment", "checkpoint",
      ];
      for (const field of banned) {
        assert.ok(!adminReply.text.includes(field), `must not expose ${field}`);
      }
    });

    /* ------------------------------------------------- database and schema */

    await check("55. the projection source selects only approved columns", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "user-detail.ts"), "utf8");
      const select = /const USER_DETAIL_SELECT = \{([^}]*)\}/.exec(source);
      assert.ok(select, "USER_DETAIL_SELECT not found");
      const columns = [...select[1].matchAll(/(\w+):\s*true/g)].map((m) => m[1]).sort();
      assert.deepEqual(columns, ["createdAt", "email", "emailVerifiedAt", "id", "level", "name", "status", "xp"]);
      // role is filtered in `where`, never selected.
      assert.ok(!/role:\s*true/.test(select[1]), "role must not be selected");
    });

    await check("56. exactly one Prisma query, no N+1", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "user-detail.ts"), "utf8");
      const queries = [...source.matchAll(/prisma\.\w+\.(findMany|findFirst|findUnique|count|aggregate)/g)];
      assert.equal(queries.length, 1, `expected 1 query, found ${queries.length}`);
      assert.ok(!source.includes("include:"), "must not use include");
    });

    await check("57-58. the target learner needs no StaffProfile and none is loaded", async () => {
      assert.equal(await prisma.staffProfile.count({ where: { userId: target.id } }), 0);
      // Staff profiles: one per role + blocked staff + the axis account.
      assert.equal(await prisma.staffProfile.count(), CRM_STAFF_ROLES.length + 2);
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "user-detail.ts"), "utf8");
      assert.ok(!source.includes("staffProfile"), "must not load a learner StaffProfile");
      void plainLearner;
    });

    await check("59-62. fresh DB, expected migration count, clean foreign keys", () => {
      const migrations = fs.readdirSync(path.join(process.cwd(), "prisma", "migrations"))
        .filter((entry) => entry !== "migration_lock.toml");
      assert.equal(migrations.length, EXPECTED_MIGRATION_COUNT, `expected ${EXPECTED_MIGRATION_COUNT} migrations, found ${migrations.length}`);
      const fk = spawnSync("sqlite3", [dbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" });
      if (fk.status === 0) assert.equal(fk.stdout.trim(), "", `foreign_key_check reported ${fk.stdout}`);
    });

    await check("63. rerunning the migration runner is idempotent", () => {
      const rerun = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], { env: baseEnv, encoding: "utf8" });
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
    });

    /* ----------------------------------------------------------- route scope */

    await check("65-70. CRM v1 exposes session, users, owner-candidates, affiliates and nested owner", () => {
      const crmV1 = path.join(process.cwd(), "src", "app", "api", "crm", "v1");
      // `affiliates` joins in AFD-2 — an administrative namespace with no
      // learner-facing route and no click, attribution or conversion data.
      /* `learner-ops`, `growth` and `community` joined with their own domains
         and are present on the deployed Backend. All three are administrative
         namespaces; the nested-route assertions below are unchanged. */
      assert.deepEqual(fs.readdirSync(crmV1).sort(), ["affiliates", "community", "growth", "learner-ops", "owner-candidates", "session", "users"]);
      // owner-candidates is a flat read-only route: exactly one route file.
      assert.deepEqual(fs.readdirSync(path.join(crmV1, "owner-candidates")).sort(), ["route.ts"]);

      const usersDir = path.join(crmV1, "users");
      assert.deepEqual(fs.readdirSync(usersDir).sort(), ["[userId]", "route.ts"]);
      // Notes v1 added nested notes; Owner v1 adds nested owner; Owner History
      // OH-1 adds a nested owner/history read. Nothing else.
      assert.deepEqual(fs.readdirSync(path.join(usersDir, "[userId]")).sort(), /* `progression` joined nested under users/[userId] with administrative
         forward correction (078bce9), and is present on the deployed Backend.
         Nested is where it belongs: correcting one learner's record is an
         operation on that learner, not a top-level CRM namespace. */
      ["notes", "owner", "progression", "route.ts"]);
      assert.deepEqual(fs.readdirSync(path.join(usersDir, "[userId]", "notes")).sort(), ["route.ts"]);
      assert.deepEqual(fs.readdirSync(path.join(usersDir, "[userId]", "owner")).sort(), ["history", "route.ts"]);
      assert.deepEqual(fs.readdirSync(path.join(usersDir, "[userId]", "owner", "history")).sort(), ["route.ts"]);

      // Top-level: notes and owner are nested, so they must not appear here;
      // owners/audit/360 never existed.
      for (const banned of ["notes", "owner", "owners", "audit", "360", "user-360"]) {
        assert.ok(!fs.existsSync(path.join(crmV1, banned)), `unexpected route ${banned}`);
        assert.ok(!fs.existsSync(path.join(usersDir, banned)), `unexpected subroute users/${banned}`);
      }
      // Under users/[userId] only notes and owner exist; everything else banned.
      // `history` is nested UNDER owner (owner/history), never a direct child.
      for (const banned of ["owners", "owner-candidates", "audit", "360", "user-360", "history"]) {
        assert.ok(!fs.existsSync(path.join(usersDir, "[userId]", banned)), `unexpected subroute users/[userId]/${banned}`);
      }
      // Owner history is the ONE reviewed owner subroute; a per-employee owner
      // subroute never existed.
      assert.ok(fs.existsSync(path.join(usersDir, "[userId]", "owner", "history", "route.ts")), "missing owner/history route");
      assert.ok(!fs.existsSync(path.join(usersDir, "[userId]", "owner", "[employeeId]")), "unexpected owner/[employeeId]");
      // No catch-all.
      assert.ok(!fs.existsSync(path.join(usersDir, "[...slug]")));
      assert.ok(!("crmNote" in prisma), "unexpected CrmNote model");
    });

    await check("69. the detail route exposes only GET", async () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), "src", "app", "api", "crm", "v1", "users", "[userId]", "route.ts"),
        "utf8",
      );
      for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.ok(!new RegExp(`export async function ${verb}\\b`).test(source), `${verb} must not exist`);
      }
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const reply = await client.request(method, detailUrl(target.id), {});
        assert.ok(reply.status === 405 || reply.status === 404, `${method} returned ${reply.status}`);
      }
    });

    await check("71. no internal error path leaks SQL, stack or database path", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      for (const reply of [
        await client.request("GET", detailUrl("abc")),
        await client.request("GET", detailUrl(987654321)),
      ]) {
        for (const marker of ["SELECT", "prisma", "Prisma", "/tmp/", ".db", "at Object", "Error:", "node_modules", "sqlite"]) {
          assert.ok(!reply.text.includes(marker), `leaked ${marker}`);
        }
      }
    });
  } finally {
    await stop(server);
    cleanup();
  }

  // 64. temporary DB removed by cleanup() above.
  const leftovers = ["", "-journal", "-wal", "-shm"].filter((s) => fs.existsSync(`${dbPath}${s}`));
  if (leftovers.length > 0) {
    failed += 1;
    console.error(`FAIL 64. temporary database removed (leftovers: ${leftovers.join(", ")})`);
  } else {
    passed += 1;
    console.log("ok   64. temporary database removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
