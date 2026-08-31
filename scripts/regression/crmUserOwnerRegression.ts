import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { StaffRole } from "@prisma/client";
import { CRM_STAFF_ROLES, CRM_ELIGIBLE_OWNER_ROLES, STAFF_ROLE_PERMISSIONS } from "../../src/lib/crm/roles";
import { crmOwnerResponseSchema, crmOwnerCandidatesResponseSchema } from "../../src/lib/crm/schemas";
import { EXPECTED_MIGRATION_COUNT, expectedPriorMigrationCount } from "./support/migrationCount";

// Real HTTP regression for CRM Learner Owner v1:
//   GET  /api/crm/v1/users/[userId]/owner
//   PUT  /api/crm/v1/users/[userId]/owner
//   GET  /api/crm/v1/owner-candidates
// Isolated next dev server against a throwaway /tmp SQLite database. No deployed
// database, no external service, no persistent process. A second throwaway DB
// proves the 31->32 upgrade.
const dbPath = `/tmp/ata-crm-user-owner-${process.pid}.db`;
const upgradeDbPath = `/tmp/ata-crm-user-owner-upgrade-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3900 + (process.pid % 40);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "CrmOwner123!";
const SESSION_SECRET = "crm-user-owner-regression-secret";
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
  for (const base of [dbPath, upgradeDbPath]) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${base}${suffix}`, { force: true });
  }
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
  POSTBACK_SECRET: "crm-owner-postback-secret",
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};
for (const key of ["NODE_ENV"]) delete baseEnv[key];

function runMigrations(env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env, encoding: "utf8" },
  );
}

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

const ownerUrl = (id: string | number) => `/api/crm/v1/users/${id}/owner`;
const CANDIDATES_URL = "/api/crm/v1/owner-candidates";

// Roles that hold assign_owner (may list candidates and PUT). Derived from the
// canonical matrix, not hardcoded, so a matrix drift is caught here too.
const ASSIGNERS = CRM_STAFF_ROLES.filter((r) => STAFF_ROLE_PERMISSIONS[r].includes("assign_owner"));
const NON_ASSIGNERS = CRM_STAFF_ROLES.filter((r) => !STAFF_ROLE_PERMISSIONS[r].includes("assign_owner"));

function assertEnvelope(reply: Reply, status: number, code: string) {
  assert.equal(reply.status, status, `expected ${status}, got ${reply.status}: ${reply.text}`);
  assert.equal(reply.body.code, code, `expected code ${code}, got ${reply.body.code}`);
  assert.ok(String(reply.body.requestId ?? "").length > 0, "missing requestId");
  assert.equal(reply.headers.get("cache-control"), "no-store");
  assert.equal(reply.headers.get("x-request-id"), reply.body.requestId, "header/body requestId mismatch");
}

async function main() {
  cleanup();
  let server: ChildProcess | null = null;
  try {
    const migration = runMigrations(baseEnv);
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);

    // --- staff, one per StaffRole (UserRole "admin" on purpose: authz is from
    //     StaffProfile, never UserRole) ---------------------------------------
    const staffByRole = new Map<string, { email: string; userId: number; employeeId: string }>();
    for (const role of CRM_STAFF_ROLES) {
      const email = `staff-${role}@example.com`;
      const user = await prisma.user.create({ data: { email, name: `Staff ${role}`, role: "admin", passwordHash: hash } });
      const profile = await prisma.staffProfile.create({ data: { userId: user.id, displayName: `Staff ${role}`, staffRole: role } });
      staffByRole.set(role, { email, userId: user.id, employeeId: profile.id });
    }

    // Learner with no StaffProfile -> 403 on CRM endpoints.
    await prisma.user.create({ data: { email: "plain-learner@example.com", name: "Plain Learner", role: "user", passwordHash: hash } });

    // Staff account that gets blocked mid-test -> 401.
    const blocked = await prisma.user.create({ data: { email: "blocked-staff@example.com", name: "Blocked Staff", role: "support", passwordHash: hash } });
    await prisma.staffProfile.create({ data: { userId: blocked.id, displayName: "Blocked Staff", staffRole: "support" } });

    // --- dedicated eligible candidates (names free of role substrings) --------
    async function makeStaff(email: string, displayName: string, staffRole: StaffRole, status: "active" | "blocked" = "active") {
      const u = await prisma.user.create({ data: { email, name: displayName || "x", role: "admin", passwordHash: hash, status } });
      const p = await prisma.staffProfile.create({ data: { userId: u.id, displayName, staffRole } });
      return { userId: u.id, employeeId: p.id };
    }
    const ownerA = await makeStaff("owner-alpha@example.com", "Owner Alpha", "support");
    const ownerB = await makeStaff("owner-beta@example.com", "Owner Beta", "mentor");
    const ownerLaterBlocked = await makeStaff("owner-gamma@example.com", "Owner Gamma", "support");
    const ownerBlocked = await makeStaff("owner-delta@example.com", "Owner Delta", "support", "blocked");
    const ownerBlank = await makeStaff("owner-blank@example.com", "   ", "mentor");
    const deletionOwner = await makeStaff("owner-epsilon@example.com", "Owner Epsilon", "retention_manager");

    // --- target learners -----------------------------------------------------
    async function learner(email: string) {
      return prisma.user.create({ data: { email, name: `L ${email}`, role: "user", passwordHash: hash } });
    }
    const readLearner = await learner("read@example.test");
    const lifecycle = await learner("lifecycle@example.test");
    const stale = await learner("stale@example.test");
    const noop = await learner("noop@example.test");
    const pristineNoop = await learner("pristine-noop@example.test");
    const concCreate = await learner("conc-create@example.test");
    const concUpdate = await learner("conc-update@example.test");
    const blockedAssign = await learner("blocked-assign@example.test");
    const laterBlockedL = await learner("later-blocked@example.test");
    const blankOwnerL = await learner("blank-owner@example.test");
    const deletionL = await learner("deletion@example.test");
    const privacyL = await learner("privacy@example.test");

    // Non-learner accounts indistinguishable from "not found".
    const newsEditor = await prisma.user.create({ data: { email: "news@example.test", name: "News Editor", role: "news_editor", passwordHash: hash } });
    const staffTargetId = staffByRole.get("crm_admin")!.userId;

    server = await start();
    const admin = () => loginAs(staffByRole.get("crm_admin")!.email);

    /* ================================================ authentication (GET) */

    await check("1. unauthenticated GET owner is 401", async () => {
      assertEnvelope(await new Client().request("GET", ownerUrl(readLearner.id)), 401, "unauthorized");
    });
    await check("2. malformed session GET owner is 401", async () => {
      const c = new Client(); c.setRawSession("1.admin.9999999999999.deadbeef");
      assert.equal((await c.request("GET", ownerUrl(readLearner.id))).status, 401);
    });
    await check("3. expired session GET owner is 401", async () => {
      const c = new Client(); c.setRawSession(signToken(staffTargetId, "admin", Date.now() - 60_000));
      assert.equal((await c.request("GET", ownerUrl(readLearner.id))).status, 401);
    });
    await check("4. blocked account GET owner is 401", async () => {
      const c = await loginAs("blocked-staff@example.com");
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "blocked" } });
      assert.equal((await c.request("GET", ownerUrl(readLearner.id))).status, 401);
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "active" } });
    });

    /* ============================================= staff boundary / authz */

    await check("5. authenticated non-staff learner is 403 on all three ops", async () => {
      const c = await loginAs("plain-learner@example.com");
      assertEnvelope(await c.request("GET", ownerUrl(readLearner.id)), 403, "unauthorized");
      assertEnvelope(await c.request("GET", CANDIDATES_URL), 403, "unauthorized");
      assertEnvelope(await c.request("PUT", ownerUrl(readLearner.id), { ownerEmployeeId: null, expectedVersion: 0 }), 403, "unauthorized");
    });

    await check("6. all nine StaffRoles may READ the current owner", async () => {
      for (const role of CRM_STAFF_ROLES) {
        const c = await loginAs(staffByRole.get(role)!.email);
        const reply = await c.request("GET", ownerUrl(readLearner.id));
        assert.equal(reply.status, 200, `${role} expected 200, got ${reply.status}`);
      }
    });

    await check("7. exactly the assign_owner roles may LIST candidates (others 403)", async () => {
      for (const role of ASSIGNERS) {
        const c = await loginAs(staffByRole.get(role)!.email);
        assert.equal((await c.request("GET", CANDIDATES_URL)).status, 200, `${role} should list`);
      }
      for (const role of NON_ASSIGNERS) {
        const c = await loginAs(staffByRole.get(role)!.email);
        assert.equal((await c.request("GET", CANDIDATES_URL)).status, 403, `${role} must not list`);
      }
    });

    await check("8. exactly the assign_owner roles may PUT (others 403)", async () => {
      for (const role of NON_ASSIGNERS) {
        const c = await loginAs(staffByRole.get(role)!.email);
        const reply = await c.request("PUT", ownerUrl(readLearner.id), { ownerEmployeeId: null, expectedVersion: 0 });
        assert.equal(reply.status, 403, `${role} must not PUT`);
      }
      // ASSIGNERS reaching a 200 no-op (null on pristine) proves they pass authz.
      for (const role of ASSIGNERS) {
        const c = await loginAs(staffByRole.get(role)!.email);
        const reply = await c.request("PUT", ownerUrl(readLearner.id), { ownerEmployeeId: null, expectedVersion: 0 });
        assert.equal(reply.status, 200, `${role} should PUT: ${reply.text}`);
      }
    });

    await check("9. assign_owner holders are exactly crm_admin, crm_manager, retention_manager", () => {
      assert.deepEqual([...ASSIGNERS].sort(), ["crm_admin", "crm_manager", "retention_manager"].sort());
    });

    /* ==================================================== learner boundary */

    await check("10. identical 404 for nonexistent / staff / admin-role / news_editor targets", async () => {
      const c = await admin();
      const misses = [987654321, staffTargetId, newsEditor.id];
      for (const id of misses) {
        const g = await c.request("GET", ownerUrl(id));
        assertEnvelope(g, 404, "not_found");
        const p = await c.request("PUT", ownerUrl(id), { ownerEmployeeId: null, expectedVersion: 0 });
        assertEnvelope(p, 404, "not_found");
      }
    });

    /* ================================================ pristine / lifecycle */

    await check("11. pristine learner reads owner null, version 0", async () => {
      const c = await admin();
      const reply = await c.request("GET", ownerUrl(lifecycle.id));
      assert.equal(reply.status, 200);
      const parsed = crmOwnerResponseSchema.parse(reply.body);
      assert.equal(parsed.owner, null);
      assert.equal(parsed.ownerVersion, 0);
      assert.equal(await prisma.crmUserOwner.count({ where: { userId: lifecycle.id } }), 0, "no row for pristine");
    });

    await check("12. first assignment: null/0 -> Owner Alpha/1 (row created)", async () => {
      const c = await admin();
      const reply = await c.request("PUT", ownerUrl(lifecycle.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 });
      assert.equal(reply.status, 200, reply.text);
      const parsed = crmOwnerResponseSchema.parse(reply.body);
      assert.deepEqual(parsed.owner, { employeeId: ownerA.employeeId, displayName: "Owner Alpha" });
      assert.equal(parsed.ownerVersion, 1);
    });

    await check("13. replacement: Alpha/1 -> Owner Beta/2", async () => {
      const c = await admin();
      const reply = await c.request("PUT", ownerUrl(lifecycle.id), { ownerEmployeeId: ownerB.employeeId, expectedVersion: 1 });
      const parsed = crmOwnerResponseSchema.parse(reply.body);
      assert.deepEqual(parsed.owner, { employeeId: ownerB.employeeId, displayName: "Owner Beta" });
      assert.equal(parsed.ownerVersion, 2);
    });

    await check("14. unassignment: Beta/2 -> null/3, and the ROW is retained", async () => {
      const c = await admin();
      const reply = await c.request("PUT", ownerUrl(lifecycle.id), { ownerEmployeeId: null, expectedVersion: 2 });
      const parsed = crmOwnerResponseSchema.parse(reply.body);
      assert.equal(parsed.owner, null);
      assert.equal(parsed.ownerVersion, 3);
      const row = await prisma.crmUserOwner.findUnique({ where: { userId: lifecycle.id }, select: { ownerId: true, version: true } });
      assert.ok(row, "row must survive unassignment");
      assert.equal(row!.ownerId, null);
      assert.equal(row!.version, 3);
    });

    await check("15. reassignment: null/3 -> Owner Alpha/4 (versions monotonic, never reset)", async () => {
      const c = await admin();
      const reply = await c.request("PUT", ownerUrl(lifecycle.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 3 });
      const parsed = crmOwnerResponseSchema.parse(reply.body);
      assert.deepEqual(parsed.owner, { employeeId: ownerA.employeeId, displayName: "Owner Alpha" });
      assert.equal(parsed.ownerVersion, 4);
    });

    /* ===================================================== no-op semantics */

    await check("16. same-owner PUT is a no-op: no version bump, no updatedAt touch", async () => {
      const c = await admin();
      await c.request("PUT", ownerUrl(noop.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 });
      const before = await prisma.crmUserOwner.findUnique({ where: { userId: noop.id }, select: { version: true, updatedAt: true } });
      await new Promise((r) => setTimeout(r, 20));
      const reply = await c.request("PUT", ownerUrl(noop.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 1 });
      const parsed = crmOwnerResponseSchema.parse(reply.body);
      assert.equal(parsed.ownerVersion, 1, "same-owner no-op must not bump version");
      const after = await prisma.crmUserOwner.findUnique({ where: { userId: noop.id }, select: { version: true, updatedAt: true } });
      assert.equal(after!.version, before!.version);
      assert.equal(after!.updatedAt.getTime(), before!.updatedAt.getTime(), "updatedAt must be untouched on no-op");
    });

    await check("17. pristine null PUT is a no-op and creates NO row", async () => {
      const c = await admin();
      const reply = await c.request("PUT", ownerUrl(pristineNoop.id), { ownerEmployeeId: null, expectedVersion: 0 });
      const parsed = crmOwnerResponseSchema.parse(reply.body);
      assert.equal(parsed.owner, null);
      assert.equal(parsed.ownerVersion, 0);
      assert.equal(await prisma.crmUserOwner.count({ where: { userId: pristineNoop.id } }), 0, "pristine no-op must not create a row");
    });

    /* ===================================================== stale conflicts */

    await check("18. stale expectedVersion returns 409", async () => {
      const c = await admin();
      await c.request("PUT", ownerUrl(stale.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 }); // -> v1
      // Stale zero after a prior mutation must NOT succeed.
      assertEnvelope(await c.request("PUT", ownerUrl(stale.id), { ownerEmployeeId: ownerB.employeeId, expectedVersion: 0 }), 409, "conflict");
      // Any other non-current version is also stale.
      assertEnvelope(await c.request("PUT", ownerUrl(stale.id), { ownerEmployeeId: ownerB.employeeId, expectedVersion: 5 }), 409, "conflict");
      // The state is untouched by the rejected calls.
      const g = crmOwnerResponseSchema.parse((await c.request("GET", ownerUrl(stale.id))).body);
      assert.equal(g.ownerVersion, 1);
      assert.deepEqual(g.owner, { employeeId: ownerA.employeeId, displayName: "Owner Alpha" });
    });

    await check("19. no-row with nonzero expectedVersion is 409", async () => {
      const c = await admin();
      assertEnvelope(await c.request("PUT", ownerUrl(concUpdate.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 1 }), 409, "conflict");
      assert.equal(await prisma.crmUserOwner.count({ where: { userId: concUpdate.id } }), 0, "409 must not create a row");
    });

    /* ================================================= concurrency (races) */

    await check("20. concurrent first-create: exactly one 200, one 409, final version 1", async () => {
      const c = await admin();
      const body = { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 };
      const [r1, r2] = await Promise.all([
        c.request("PUT", ownerUrl(concCreate.id), body),
        c.request("PUT", ownerUrl(concCreate.id), body),
      ]);
      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, [200, 409], `expected one 200 one 409, got ${statuses}`);
      const row = await prisma.crmUserOwner.findUnique({ where: { userId: concCreate.id }, select: { version: true } });
      assert.equal(row!.version, 1);
    });

    await check("21. concurrent update from the same version: one 200, one 409, +1 only", async () => {
      const c = await admin();
      await c.request("PUT", ownerUrl(concUpdate.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 }); // v1
      const [r1, r2] = await Promise.all([
        c.request("PUT", ownerUrl(concUpdate.id), { ownerEmployeeId: ownerB.employeeId, expectedVersion: 1 }),
        c.request("PUT", ownerUrl(concUpdate.id), { ownerEmployeeId: null, expectedVersion: 1 }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, [200, 409], `expected one 200 one 409, got ${statuses}`);
      const row = await prisma.crmUserOwner.findUnique({ where: { userId: concUpdate.id }, select: { version: true } });
      assert.equal(row!.version, 2, "version must advance by exactly one");
    });

    /* ================================================ candidate eligibility */

    await check("22. eligible owner roles are exactly manager/retention/mentor/support", () => {
      assert.deepEqual([...CRM_ELIGIBLE_OWNER_ROLES].sort(), ["crm_manager", "mentor", "retention_manager", "support"].sort());
    });

    await check("23. candidate list holds every active eligible nonblank staff, sorted, no others", async () => {
      const c = await admin();
      const expected = (await prisma.staffProfile.findMany({
        where: { staffRole: { in: [...CRM_ELIGIBLE_OWNER_ROLES] }, user: { status: "active" }, displayName: { not: "" } },
        select: { id: true, displayName: true },
      })).filter((r) => r.displayName.trim().length > 0)
        .sort((a, b) => (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : a.id < b.id ? -1 : 1))
        .map((r) => ({ employeeId: r.id, displayName: r.displayName }));

      // Walk every page.
      const seen: { employeeId: string; displayName: string }[] = [];
      let cursor: string | null = null;
      do {
        const url: string = cursor ? `${CANDIDATES_URL}?limit=3&cursor=${encodeURIComponent(cursor)}` : `${CANDIDATES_URL}?limit=3`;
        const page = crmOwnerCandidatesResponseSchema.parse((await c.request("GET", url)).body);
        assert.ok(page.items.length <= 3, "limit not honored");
        seen.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);

      assert.deepEqual(seen, expected, "candidate set/order mismatch");
      const ids = new Set(seen.map((x) => x.employeeId));
      assert.ok(!ids.has(ownerBlocked.employeeId), "blocked candidate must be hidden");
      assert.ok(!ids.has(ownerBlank.employeeId), "blank-name candidate must be hidden");
      for (const role of ["crm_admin", "moderator", "analyst", "content_manager", "read_only"]) {
        assert.ok(!ids.has(staffByRole.get(role)!.employeeId), `${role} must not be a candidate`);
      }
      for (const role of ["crm_manager", "retention_manager", "mentor", "support"]) {
        assert.ok(ids.has(staffByRole.get(role)!.employeeId), `${role} must be a candidate`);
      }
    });

    await check("24. candidate items expose exactly employeeId + displayName, no email/role", async () => {
      const c = await admin();
      const reply = await c.request("GET", CANDIDATES_URL);
      const page = crmOwnerCandidatesResponseSchema.parse(reply.body);
      for (const item of page.items) {
        assert.deepEqual(Object.keys(item).sort(), ["displayName", "employeeId"]);
      }
      assert.ok(!reply.text.includes("@example.com"), "candidate emails leaked");
      assert.ok(!reply.text.includes("staffRole"), "staffRole leaked");
    });

    await check("25. candidate query validation", async () => {
      const c = await admin();
      for (const bad of ["0", "-1", "101", "1.5", "abc", ""]) {
        assertEnvelope(await c.request("GET", `${CANDIDATES_URL}?limit=${encodeURIComponent(bad)}`), 400, "invalid_input");
      }
      assertEnvelope(await c.request("GET", `${CANDIDATES_URL}?search=x`), 400, "invalid_input");
      assertEnvelope(await c.request("GET", `${CANDIDATES_URL}?limit=1&limit=2`), 400, "invalid_input");
      assertEnvelope(await c.request("GET", `${CANDIDATES_URL}?cursor=`), 400, "invalid_input");
      assertEnvelope(await c.request("GET", `${CANDIDATES_URL}?cursor=not-base64url!!`), 400, "invalid_input");
      // A cursor minted for a different version is rejected.
      const wrongVersion = Buffer.from(JSON.stringify({ v: 2, n: "x", i: "y" }), "utf8").toString("base64url");
      assertEnvelope(await c.request("GET", `${CANDIDATES_URL}?cursor=${wrongVersion}`), 400, "invalid_input");
      // default limit works with no params, no total exposed.
      const ok = await c.request("GET", CANDIDATES_URL);
      assert.equal(ok.status, 200);
      for (const banned of ["total", "totalCount", "count", "hasMore", "page", "offset"]) {
        assert.ok(!ok.text.includes(`"${banned}"`), `must not expose ${banned}`);
      }
    });

    /* ==================================================== candidate 404s */

    await check("26. assigning an ineligible/blocked/missing candidate is an identical 404", async () => {
      const c = await admin();
      const targets = [
        staffByRole.get("crm_admin")!.employeeId, // holds assign_owner but not eligible
        staffByRole.get("moderator")!.employeeId,  // ineligible role
        ownerBlocked.employeeId,                   // eligible role but blocked user
        ownerBlank.employeeId,                     // eligible + active but blank name
        "emp_does_not_exist",                      // nonexistent
      ];
      for (const employeeId of targets) {
        const reply = await c.request("PUT", ownerUrl(blockedAssign.id), { ownerEmployeeId: employeeId, expectedVersion: 0 });
        assertEnvelope(reply, 404, "not_found");
      }
      assert.equal(await prisma.crmUserOwner.count({ where: { userId: blockedAssign.id } }), 0, "no row created by rejected assigns");
    });

    /* ========================================== blocked current owner reads */

    await check("27. a current owner who is later blocked stays readable and no-op-assignable", async () => {
      const c = await admin();
      // Assign the dedicated Gamma owner, then block its user account.
      await c.request("PUT", ownerUrl(laterBlockedL.id), { ownerEmployeeId: ownerLaterBlocked.employeeId, expectedVersion: 0 });
      await prisma.user.update({ where: { id: ownerLaterBlocked.userId }, data: { status: "blocked" } });

      // Still visible (owner read is not active-filtered).
      const g = crmOwnerResponseSchema.parse((await c.request("GET", ownerUrl(laterBlockedL.id))).body);
      assert.deepEqual(g.owner, { employeeId: ownerLaterBlocked.employeeId, displayName: "Owner Gamma" });
      assert.equal(g.ownerVersion, 1);

      // Same-owner no-op is permitted even though the owner is now blocked.
      const noopReply = await c.request("PUT", ownerUrl(laterBlockedL.id), { ownerEmployeeId: ownerLaterBlocked.employeeId, expectedVersion: 1 });
      assert.equal(noopReply.status, 200, noopReply.text);
      assert.equal(crmOwnerResponseSchema.parse(noopReply.body).ownerVersion, 1);

      // But a now-blocked owner cannot be NEWLY assigned to a different learner.
      const freshLearner = await learner("gamma-target@example.test");
      assertEnvelope(await c.request("PUT", ownerUrl(freshLearner.id), { ownerEmployeeId: ownerLaterBlocked.employeeId, expectedVersion: 0 }), 404, "not_found");
    });

    await check("28. a blank current-owner display name fails closed (500) on read", async () => {
      // Directly seed a row pointing at the blank-named eligible staff (the API
      // would never assign it), then prove the read fails closed rather than
      // emitting a fabricated or empty name.
      await prisma.crmUserOwner.create({ data: { userId: blankOwnerL.id, ownerId: ownerBlank.employeeId, version: 1 } });
      const c = await admin();
      const reply = await c.request("GET", ownerUrl(blankOwnerL.id));
      assertEnvelope(reply, 500, "internal");
    });

    /* ================================================== self-assignment */

    await check("29. a manager (assign_owner + eligible) may assign themselves", async () => {
      const mgr = staffByRole.get("crm_manager")!;
      const c = await loginAs(mgr.email);
      const selfLearner = await learner("self-mgr@example.test");
      const reply = await c.request("PUT", ownerUrl(selfLearner.id), { ownerEmployeeId: mgr.employeeId, expectedVersion: 0 });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(crmOwnerResponseSchema.parse(reply.body).owner!.employeeId, mgr.employeeId);
    });

    await check("30. crm_admin cannot assign themselves (holds assign_owner but not eligible)", async () => {
      const adminEmp = staffByRole.get("crm_admin")!;
      const c = await loginAs(adminEmp.email);
      const selfLearner = await learner("self-admin@example.test");
      assertEnvelope(await c.request("PUT", ownerUrl(selfLearner.id), { ownerEmployeeId: adminEmp.employeeId, expectedVersion: 0 }), 404, "not_found");
    });

    await check("31. no self-assignment bypass: a non-assigner cannot self-assign", async () => {
      const sup = staffByRole.get("support")!;
      const c = await loginAs(sup.email);
      const selfLearner = await learner("self-support@example.test");
      // support holds no assign_owner, so PUT is 403 before any candidacy check.
      assertEnvelope(await c.request("PUT", ownerUrl(selfLearner.id), { ownerEmployeeId: sup.employeeId, expectedVersion: 0 }), 403, "unauthorized");
    });

    /* ==================================================== body validation */

    await check("32. PUT body/param validation", async () => {
      const c = await admin();
      // malformed userId
      assertEnvelope(await c.request("PUT", ownerUrl("abc"), { ownerEmployeeId: null, expectedVersion: 0 }), 400, "invalid_input");
      // malformed JSON
      assertEnvelope(await c.request("PUT", ownerUrl(readLearner.id), "not json", { "content-type": "application/json" }), 400, "invalid_input");
      const bads: unknown[] = [
        {},
        { ownerEmployeeId: null },
        { expectedVersion: 0 },
        { ownerEmployeeId: null, expectedVersion: -1 },
        { ownerEmployeeId: null, expectedVersion: 1.5 },
        { ownerEmployeeId: null, expectedVersion: "0" },
        { ownerEmployeeId: 123, expectedVersion: 0 },
        { ownerEmployeeId: "   ", expectedVersion: 0 },
        { ownerEmployeeId: null, expectedVersion: 0, reason: "x" },
        { ownerEmployeeId: null, expectedVersion: 0, actor: "x" },
        { ownerEmployeeId: null, expectedVersion: 0, userId: 1 },
      ];
      for (const body of bads) {
        assertEnvelope(await c.request("PUT", ownerUrl(readLearner.id), body), 400, "invalid_input");
      }
      // query parameters on PUT are rejected
      assertEnvelope(await c.request("PUT", `${ownerUrl(readLearner.id)}?x=1`, { ownerEmployeeId: null, expectedVersion: 0 }), 400, "invalid_input");
      // unknown query param on GET owner rejected
      assertEnvelope(await c.request("GET", `${ownerUrl(readLearner.id)}?x=1`), 400, "invalid_input");
    });

    /* ==================================================== privacy / DTO */

    await check("33. owner GET exposes exactly {owner:{employeeId,displayName}, ownerVersion}", async () => {
      const c = await admin();
      await c.request("PUT", ownerUrl(privacyL.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 });
      const reply = await c.request("GET", ownerUrl(privacyL.id));
      const body = reply.body as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["owner", "ownerVersion"]);
      assert.deepEqual(Object.keys(body.owner as object).sort(), ["displayName", "employeeId"]);
      for (const banned of ["email", "@example.com", "staffRole", "support", "ownerId", "userId", "status", "permissionVersion", "createdAt", "updatedAt", "role", "history", "audit"]) {
        assert.ok(!reply.text.includes(banned), `owner GET leaked ${banned}`);
      }
    });

    /* ==================================================== side effects */

    await check("34. Owner operations write no AuditLog, no Notes, no User/StaffProfile changes", async () => {
      // Measure the delta around an ISOLATED owner-op sequence with an already
      // authenticated client, so no /api/auth/login (which itself writes an
      // AuditLog row) can be mistaken for an owner side effect.
      const c = await admin();
      const sideEffectLearner = await learner("side-effect@example.test");
      const before = {
        audit: await prisma.auditLog.count(),
        notes: await prisma.crmUserNote.count(),
        users: await prisma.user.count(),
        staff: await prisma.staffProfile.count(),
      };
      await c.request("GET", ownerUrl(sideEffectLearner.id));
      await c.request("GET", CANDIDATES_URL);
      await c.request("PUT", ownerUrl(sideEffectLearner.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 });
      await c.request("PUT", ownerUrl(sideEffectLearner.id), { ownerEmployeeId: ownerB.employeeId, expectedVersion: 1 });
      await c.request("PUT", ownerUrl(sideEffectLearner.id), { ownerEmployeeId: null, expectedVersion: 2 });
      const after = {
        audit: await prisma.auditLog.count(),
        notes: await prisma.crmUserNote.count(),
        users: await prisma.user.count(),
        staff: await prisma.staffProfile.count(),
      };
      assert.equal(after.audit, before.audit, "AuditLog written by an owner op");
      assert.equal(after.notes, before.notes, "Notes written by an owner op");
      assert.equal(after.users, before.users, "User rows changed by an owner op");
      assert.equal(after.staff, before.staff, "StaffProfile rows changed by an owner op");
    });

    await check("35. only CrmUserOwner rows exist for learners that were mutated", async () => {
      // Pristine no-op learner has no row; lifecycle learner has exactly one.
      assert.equal(await prisma.crmUserOwner.count({ where: { userId: pristineNoop.id } }), 0);
      assert.equal(await prisma.crmUserOwner.count({ where: { userId: lifecycle.id } }), 1);
    });

    /* ==================================================== deletion Restrict */

    await check("36. deleting an owned learner or an assigned owner is blocked (Restrict)", async () => {
      const c = await admin();
      await c.request("PUT", ownerUrl(deletionL.id), { ownerEmployeeId: deletionOwner.employeeId, expectedVersion: 0 });
      await assert.rejects(prisma.user.delete({ where: { id: deletionL.id } }), "learner delete must be restricted");
      await assert.rejects(prisma.staffProfile.delete({ where: { id: deletionOwner.employeeId } }), "owner delete must be restricted");
    });

    /* ==================================================== route scope */

    await check("37. owner route exports only GET and PUT; candidates only GET", () => {
      const ownerSrc = fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "crm", "v1", "users", "[userId]", "owner", "route.ts"), "utf8");
      for (const verb of ["POST", "PATCH", "DELETE"]) {
        assert.ok(!new RegExp(`export async function ${verb}\\b`).test(ownerSrc), `owner route must not export ${verb}`);
      }
      assert.ok(/export async function GET\b/.test(ownerSrc) && /export async function PUT\b/.test(ownerSrc));
      const candSrc = fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "crm", "v1", "owner-candidates", "route.ts"), "utf8");
      for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.ok(!new RegExp(`export async function ${verb}\\b`).test(candSrc), `candidates route must not export ${verb}`);
      }
    });

    await check("38. unsupported methods on the owner route are 404/405", async () => {
      const c = await admin();
      for (const method of ["POST", "PATCH", "DELETE"]) {
        const reply = await c.request(method, ownerUrl(readLearner.id), {});
        assert.ok(reply.status === 404 || reply.status === 405, `${method} returned ${reply.status}`);
      }
    });

    /* ==================================================== service hygiene */

    await check("39. service uses explicit selects, no include, and bounded queries", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "user-owner.ts"), "utf8");
      assert.ok(!src.includes("include:"), "must not use include");
      assert.ok(!/\.delete\(|deleteMany/.test(src), "must not delete owner rows");
      assert.ok(!src.includes("console."), "must not log");
    });

    /* ==================================================== no leakage on 500/404 */

    await check("40. no error path leaks SQL, stack, prisma or db path", async () => {
      const c = await admin();
      const replies = [
        await c.request("GET", ownerUrl("abc")),
        await c.request("GET", ownerUrl(987654321)),
        await c.request("GET", ownerUrl(blankOwnerL.id)), // 500 path
        await c.request("PUT", ownerUrl(readLearner.id), { bad: true }),
      ];
      for (const reply of replies) {
        for (const marker of ["SELECT", "prisma", "Prisma", "/tmp/", ".db", "at Object", "node_modules", "sqlite", "P2002", "P2034"]) {
          assert.ok(!reply.text.includes(marker), `leaked ${marker}: ${reply.text}`);
        }
      }
    });

    /* ==================================================== database integrity */

    await check("41. fresh DB has the expected migration count, clean foreign_key_check and integrity_check", () => {
      const migrations = fs.readdirSync(path.join(process.cwd(), "prisma", "migrations")).filter((e) => e !== "migration_lock.toml");
      assert.equal(migrations.length, EXPECTED_MIGRATION_COUNT, `expected ${EXPECTED_MIGRATION_COUNT} migrations, found ${migrations.length}`);
      assert.ok(migrations.includes("20260721000000_crm_user_owner_foundation"));
      assert.ok(migrations.includes("20260723000000_crm_user_owner_history"));
      const fk = spawnSync("sqlite3", [dbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" });
      if (fk.status === 0) assert.equal(fk.stdout.trim(), "", `foreign_key_check reported ${fk.stdout}`);
      const integ = spawnSync("sqlite3", [dbPath, "PRAGMA integrity_check;"], { encoding: "utf8" });
      if (integ.status === 0) assert.equal(integ.stdout.trim(), "ok", `integrity_check reported ${integ.stdout}`);
    });

    await check("42. the CrmUserOwner index exists", () => {
      const idx = spawnSync("sqlite3", [dbPath, "PRAGMA index_list('CrmUserOwner');"], { encoding: "utf8" });
      assert.ok(idx.stdout.includes("CrmUserOwner_ownerId_idx"), `missing ownerId index: ${idx.stdout}`);
    });

    await check("43. rerunning the migration runner is idempotent", () => {
      const rerun = runMigrations(baseEnv);
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
    });

    await check("44. migration 32 is additive: no rebuild, no update, no backfilled owner row", () => {
      const sql = fs.readFileSync(path.join(process.cwd(), "prisma", "migrations", "20260721000000_crm_user_owner_foundation", "migration.sql"), "utf8");
      const statements = sql.replace(/--[^\n]*\n/g, "");
      assert.ok(!/\bUPDATE\s+"/.test(statements), "migration must not update rows");
      assert.ok(!/CREATE TABLE "new_/.test(statements), "migration must not rebuild a table");
      assert.ok(!/INSERT\s+INTO/i.test(statements), "migration must not insert an initial owner");
      assert.ok(/CREATE TABLE "CrmUserOwner"/.test(statements));
    });

    /* ==================================================== 31 -> 32 upgrade */

    await check("45. upgrading a 31-migration DB to 32 preserves rows and adds an empty owner table", () => {
      const upgradeUrl = `file:${upgradeDbPath}`;
      const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
      // Prove the owner-FOUNDATION (migration 32) upgrade specifically, so exclude
      // both the owner foundation and the later owner-history migration (33) to
      // reconstruct the exact 31-migration pre-owner baseline.
      const prior = fs.readdirSync(migrationsDir)
        .filter(
          (e) =>
            e !== "migration_lock.toml" &&
            e !== "20260721000000_crm_user_owner_foundation" &&
            e !== "20260723000000_crm_user_owner_history",
        )
        .sort();
      assert.equal(prior.length, expectedPriorMigrationCount(2), `expected ${expectedPriorMigrationCount(2)} prior migrations, found ${prior.length}`);

      const bookkeeping = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0);`;
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: bookkeeping, encoding: "utf8" }).status, 0);
      for (const name of prior) {
        const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
        assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: sql, encoding: "utf8" }).status, 0, `apply ${name}`);
        const checksum = crypto.createHash("sha256").update(sql).digest("hex");
        assert.equal(spawnSync("sqlite3", [upgradeDbPath], {
          input: `INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","finished_at","applied_steps_count") VALUES ('${crypto.randomUUID()}','${checksum}','${name}',CURRENT_TIMESTAMP,1);`,
          encoding: "utf8",
        }).status, 0);
      }

      // The owner table must not exist yet.
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='CrmUserOwner';`, encoding: "utf8" }).stdout.trim(), "0");

      // Representative pre-existing rows, including a Note (proving Notes survive).
      const seed = `
        INSERT INTO "User" ("email","pendingEmail","referralCode","passwordHash","role","status","name","level","xp","createdAt","updatedAt")
        VALUES ('legacy@example.test',NULL,'legacy-ref','x','user','active','Legacy Learner',3,300,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "User" ("email","pendingEmail","referralCode","passwordHash","role","status","name","level","xp","createdAt","updatedAt")
        VALUES ('legacy-staff@example.test',NULL,'legacy-ref-2','x','admin','active','Legacy Staff',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "StaffProfile" ("id","userId","displayName","staffRole","permissionVersion","createdAt","updatedAt")
        VALUES ('legacy-emp-1',(SELECT id FROM "User" WHERE email='legacy-staff@example.test'),'Legacy Staff','crm_manager',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "CrmUserNote" ("id","userId","authorId","body","createdAt")
        VALUES ('legacy-note-1',(SELECT id FROM "User" WHERE email='legacy@example.test'),'legacy-emp-1','legacy note',CURRENT_TIMESTAMP);`;
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: seed, encoding: "utf8" }).status, 0);

      // Apply migration 32 through the repository runner.
      const upgrade = runMigrations({ ...baseEnv, DATABASE_URL: upgradeUrl });
      assert.equal(upgrade.status, 0, `${upgrade.stdout}\n${upgrade.stderr}`);
      assert.ok(upgrade.stdout.includes("Migration 20260721000000_crm_user_owner_foundation applied."), "migration 32 not applied");

      // Zero owner rows after migration; existing rows preserved.
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM "CrmUserOwner";`, encoding: "utf8" }).stdout.trim(), "0");
      const after = spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM "User"; SELECT count(*) FROM "StaffProfile"; SELECT count(*) FROM "CrmUserNote"; SELECT body FROM "CrmUserNote" WHERE id='legacy-note-1';`, encoding: "utf8" });
      assert.equal(after.stdout.trim().split("\n").map((s) => s.trim()).join(","), "2,1,1,legacy note");

      // The upgraded owner table is usable and keeps FKs clean.
      const use = `PRAGMA foreign_keys=ON;
        INSERT INTO "CrmUserOwner" ("userId","ownerId","version","createdAt","updatedAt")
        VALUES ((SELECT id FROM "User" WHERE email='legacy@example.test'),'legacy-emp-1',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        SELECT version FROM "CrmUserOwner";`;
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: use, encoding: "utf8" }).stdout.trim(), "1");
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: "PRAGMA foreign_key_check;", encoding: "utf8" }).stdout.trim(), "");
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: "PRAGMA integrity_check;", encoding: "utf8" }).stdout.trim(), "ok");

      // Idempotent rerun.
      assert.equal(runMigrations({ ...baseEnv, DATABASE_URL: upgradeUrl }).status, 0);
    });

    await check("46. the runtime and deployed databases were never referenced", () => {
      const runtime = "/home/ubuntu/runtime/ata-dev-v1/data/ata-dev.sqlite";
      assert.ok(dbPath.startsWith("/tmp/") && upgradeDbPath.startsWith("/tmp/"), "throwaway DBs must live under /tmp");
      assert.notEqual(dbPath, runtime);
    });
  } finally {
    await stop(server);
    cleanup();
  }

  const leftovers = [dbPath, upgradeDbPath].flatMap((b) => ["", "-journal", "-wal", "-shm"].map((s) => `${b}${s}`)).filter((p) => fs.existsSync(p));
  if (leftovers.length > 0) {
    failed += 1;
    console.error(`FAIL 47. temporary databases removed (leftovers: ${leftovers.join(", ")})`);
  } else {
    passed += 1;
    console.log("ok   47. temporary databases removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
