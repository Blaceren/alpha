import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { CRM_PERMISSIONS, resolveEffectivePermissions } from "../../src/lib/crm/roles";
import { crmSessionResponseSchema } from "../../src/lib/crm/schemas";

// Real HTTP regression for GET /api/crm/v1/session. Runs an isolated next dev
// server against a throwaway /tmp SQLite database. No external service used.
const dbPath = `/tmp/ata-crm-session-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3910 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "CrmSession123!";
const SESSION_SECRET = "crm-session-regression-secret";
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
  POSTBACK_SECRET: "crm-session-postback-secret",
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

async function main() {
  cleanup();
  let server: ChildProcess | null = null;
  try {
    const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], { env: baseEnv, encoding: "utf8" });
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);

    const crmAdminUser = await prisma.user.create({ data: { email: "crm-admin@example.com", name: "Casey Admin", role: "admin", passwordHash: hash } });
    const crmAdminProfile = await prisma.staffProfile.create({ data: { userId: crmAdminUser.id, displayName: "Casey Admin", staffRole: "crm_admin" } });
    await prisma.user.create({ data: { email: "crm-learner@example.com", name: "Lee Learner", role: "user", passwordHash: hash } });
    const blockedUser = await prisma.user.create({ data: { email: "crm-blocked@example.com", name: "Bo Blocked", role: "support", passwordHash: hash } });
    await prisma.staffProfile.create({ data: { userId: blockedUser.id, displayName: "Bo Blocked", staffRole: "support" } });
    const adminReadonlyUser = await prisma.user.create({ data: { email: "crm-axis@example.com", name: "Axl Axis", role: "admin", passwordHash: hash } });
    await prisma.staffProfile.create({ data: { userId: adminReadonlyUser.id, displayName: "Axl Axis", staffRole: "read_only" } });
    const supportManagerUser = await prisma.user.create({ data: { email: "crm-truth@example.com", name: "Trudy Truth", role: "support", passwordHash: hash } });
    const supportManagerProfile = await prisma.staffProfile.create({ data: { userId: supportManagerUser.id, displayName: "Trudy Truth", staffRole: "crm_manager" } });

    server = await start();

    await check("1. unauthenticated request is 401", async () => {
      const reply = await new Client().request("GET", "/api/crm/v1/session");
      assert.equal(reply.status, 401);
      assert.equal(reply.body.code, "unauthorized");
      assert.ok(String(reply.body.messageKey).length > 0);
      assert.ok(String(reply.body.requestId).length > 0);
    });

    await check("2. invalid session signature is 401", async () => {
      const client = new Client();
      client.setRawSession("1.admin.9999999999999.deadbeef");
      const reply = await client.request("GET", "/api/crm/v1/session");
      assert.equal(reply.status, 401);
    });

    await check("3. expired (but correctly signed) session is 401", async () => {
      const client = new Client();
      client.setRawSession(signToken(crmAdminUser.id, "admin", Date.now() - 60_000));
      const reply = await client.request("GET", "/api/crm/v1/session");
      assert.equal(reply.status, 401);
    });

    await check("4. authenticated learner without a StaffProfile is 403", async () => {
      const client = new Client();
      assert.equal((await client.login("crm-learner@example.com")).status, 200);
      const reply = await client.request("GET", "/api/crm/v1/session");
      assert.equal(reply.status, 403);
      assert.equal(reply.body.code, "unauthorized");
    });

    let messageKey401 = "";
    let messageKey403 = "";
    await check("5. 401 and 403 carry the same code but distinct messageKeys", async () => {
      const anon = await new Client().request("GET", "/api/crm/v1/session");
      const learner = new Client();
      await learner.login("crm-learner@example.com");
      const forbidden = await learner.request("GET", "/api/crm/v1/session");
      messageKey401 = String(anon.body.messageKey);
      messageKey403 = String(forbidden.body.messageKey);
      assert.equal(anon.body.code, forbidden.body.code);
      assert.notEqual(messageKey401, messageKey403);
    });

    let adminReply: Reply | null = null;
    await check("6. authenticated staff account is 200", async () => {
      const client = new Client();
      assert.equal((await client.login("crm-admin@example.com")).status, 200);
      adminReply = await client.request("GET", "/api/crm/v1/session");
      assert.equal(adminReply.status, 200);
    });

    await check("7. response body exactly matches the Zod session schema", () => {
      const parsed = crmSessionResponseSchema.safeParse(adminReply!.body);
      assert.ok(parsed.success, JSON.stringify(adminReply!.body));
    });

    await check("8. employeeId is StaffProfile.id, not User.id", () => {
      assert.equal(adminReply!.body.employeeId, crmAdminProfile.id);
      assert.notEqual(adminReply!.body.employeeId, String(crmAdminUser.id));
    });

    await check("9. role comes from StaffRole, not UserRole", () => {
      assert.equal(adminReply!.body.role, "crm_admin");
    });

    await check("10. effectivePermissions match the matrix in canonical order", () => {
      /* This used to assert that an admin holds EVERY declared permission. That
         stopped being true when `progression_operator` was introduced as its own
         role: `curriculum_progress_override` is granted to that role alone, so
         no single role holds the whole vocabulary any more. Separation of duties
         is the point of the split, and asserting the old equality would pin its
         absence.

         The canonical ORDER is still the thing under test, so it is still
         compared element by element — against the admin's own grant, with the
         one permission an admin deliberately lacks named rather than skipped. */
      assert.deepEqual(adminReply!.body.effectivePermissions, resolveEffectivePermissions("crm_admin"));
      const adminHas = new Set<string>(adminReply!.body.effectivePermissions as string[]);
      const adminLacks = CRM_PERMISSIONS.filter((permission) => !adminHas.has(permission));
      assert.deepEqual(adminLacks, ["curriculum_progress_override"]);
      // Order is canonical: the admin's grant is CRM_PERMISSIONS with that one removed.
      assert.deepEqual(
        adminReply!.body.effectivePermissions,
        CRM_PERMISSIONS.filter((permission) => permission !== "curriculum_progress_override"),
      );
    });

    await check("11. permissionVersion is a positive integer", () => {
      assert.equal(adminReply!.body.permissionVersion, 1);
    });

    await check("12. expiresAt is a real future ISO session expiry", () => {
      const expiresAt = new Date(String(adminReply!.body.expiresAt));
      assert.ok(!Number.isNaN(expiresAt.getTime()));
      const deltaDays = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      assert.ok(deltaDays > 6 && deltaDays < 8, `expected ~7 days, got ${deltaDays}`);
    });

    await check("13. response leaks no learner/identity fields", () => {
      const keys = Object.keys(adminReply!.body).sort();
      assert.deepEqual(keys, ["displayName", "effectivePermissions", "employeeId", "expiresAt", "permissionVersion", "role"]);
      for (const forbidden of ["email", "id", "userId", "status", "level", "xp", "passwordHash", "token", "avatar"]) {
        assert.ok(!(forbidden in adminReply!.body), `must not expose ${forbidden}`);
      }
      assert.ok(!adminReply!.text.includes("crm-admin@example.com"), "email leaked in body");
    });

    await check("14. session response is Cache-Control: no-store", () => {
      assert.ok(String(adminReply!.headers.get("cache-control") ?? "").includes("no-store"));
    });

    await check("15. blocked account is 401 even with a valid cookie", async () => {
      const client = new Client();
      assert.equal((await client.login("crm-blocked@example.com")).status, 200);
      await prisma.user.update({ where: { id: blockedUser.id }, data: { status: "blocked" } });
      const reply = await client.request("GET", "/api/crm/v1/session");
      assert.equal(reply.status, 401);
    });

    await check("16. axis separation: UserRole admin + StaffRole read_only -> read_only matrix", async () => {
      const client = new Client();
      await client.login("crm-axis@example.com");
      const reply = await client.request("GET", "/api/crm/v1/session");
      assert.equal(reply.status, 200);
      assert.equal(reply.body.role, "read_only");
      // THE PROPERTY UNDER TEST is axis separation: `UserRole=admin` must not
      // leak CRM authority into the StaffRole axis. PHASE-G0 gave read_only its
      // first permission, so "no permissions" is no longer the way to say that
      // — the assertion is now that the session carries exactly the read_only
      // matrix and nothing an admin would have.
      assert.deepEqual(reply.body.effectivePermissions, resolveEffectivePermissions("read_only"));
      /* `learner_ops_view` joined the read_only matrix with the learner-ops
         domain (269dd69, which also brought migration 51). It is a read
         capability — "may look at operational work and learner context" — so it
         belongs to a read-only staff role. */
      assert.deepEqual(reply.body.effectivePermissions, ["curriculum_read", "learner_ops_view"]);
      for (const forbidden of [
        "manage_settings",
        "reveal_pii",
        "curriculum_author",
        "curriculum_approve",
      ] as const) {
        assert.ok(
          !reply.body.effectivePermissions.includes(forbidden),
          `UserRole=admin must not leak ${forbidden} into a read_only staff session`,
        );
      }
    });

    await check("17. StaffProfile is the CRM source of truth: UserRole support + StaffRole crm_manager -> crm_manager matrix", async () => {
      const client = new Client();
      await client.login("crm-truth@example.com");
      const reply = await client.request("GET", "/api/crm/v1/session");
      assert.equal(reply.status, 200);
      assert.equal(reply.body.employeeId, supportManagerProfile.id);
      assert.equal(reply.body.role, "crm_manager");
      assert.deepEqual(reply.body.effectivePermissions, resolveEffectivePermissions("crm_manager"));
    });

    await check("18. existing /api/auth/me contract is unchanged (still returns UserRole)", async () => {
      const client = new Client();
      await client.login("crm-admin@example.com");
      const reply = await client.request("GET", "/api/auth/me");
      assert.equal(reply.status, 200);
      const user = reply.body.user as Record<string, unknown>;
      assert.equal(user.role, "admin");
      assert.equal(user.email, "crm-admin@example.com");
    });

    await check("19. existing auth login/session-status/logout still work", async () => {
      const client = new Client();
      assert.equal((await client.login("crm-admin@example.com")).status, 200);
      const status = await client.request("GET", "/api/auth/session-status");
      assert.equal(status.status, 200);
      assert.equal(status.body.authenticated, true);
      const csrf = await client.request("GET", "/api/csrf");
      const logout = await client.request("POST", "/api/auth/logout", undefined, { "x-csrf-token": String(csrf.body.csrfToken) });
      assert.ok([200, 204].includes(logout.status));
    });

    await check("20. CRM v1 surface is exactly session, users, owner-candidates and affiliates", () => {
      // `users` joined in Users Slice 2; `owner-candidates` joins in Owner v1
      // (GET /api/crm/v1/owner-candidates); `affiliates` joins in AFD-2 as the
      // administrative partner/campaign/tracking-link foundation. Every other
      // top-level route stays banned, so this guard still proves audit and User
      // 360 have not appeared and that owner mutation lives nested under
      // users/[userId], not here.
      const crmV1 = path.join(process.cwd(), "src", "app", "api", "crm", "v1");
      /* Three namespaces joined since this line was written, each with its own
         phase: `learner-ops` and `growth` with the operational domain, and
         `community` with the discussion domain (022cbad). All three are
         administrative namespaces, and all three are present on the deployed
         Backend. The ban list below is the part that matters and is unchanged. */
      assert.deepEqual(fs.readdirSync(crmV1).sort(), ["affiliates", "community", "growth", "learner-ops", "owner-candidates", "session", "users"]);
      // A top-level /api/crm/v1/notes or /owner route still must not exist:
      // notes and owner are nested under users/[userId] and asserted there.
      for (const banned of ["notes", "owner", "owners", "audit", "360", "user-360"]) {
        assert.ok(!fs.existsSync(path.join(crmV1, banned)), `unexpected route ${banned}`);
      }
      assert.ok(!("crmNote" in prisma), "unexpected CrmNote model");
    });
  } finally {
    await stop(server);
    cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
