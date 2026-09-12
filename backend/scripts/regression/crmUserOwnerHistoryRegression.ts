import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { StaffRole } from "@prisma/client";
import { CRM_STAFF_ROLES, STAFF_ROLE_PERMISSIONS } from "../../src/lib/crm/roles";
import { crmOwnerHistoryResponseSchema } from "../../src/lib/crm/schemas";
import { EXPECTED_MIGRATION_COUNT, expectedPriorMigrationCount } from "./support/migrationCount";

// Real HTTP regression for CRM Learner Owner History (OH-1):
//   GET /api/crm/v1/users/[userId]/owner/history
// plus the atomic history WRITE that the owner PUT performs, the DB transition
// constraints, and the migration-33 upgrade. Isolated next dev server against a
// throwaway /tmp SQLite database. No deployed database, no external service, no
// persistent process. A second throwaway DB proves the 32 -> 33 upgrade.
const dbPath = `/tmp/ata-crm-owner-history-${process.pid}.db`;
const upgradeDbPath = `/tmp/ata-crm-owner-history-upgrade-${process.pid}.db`;
const constraintDbPath = `/tmp/ata-crm-owner-history-constraint-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3860 + (process.pid % 40);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "CrmOwnerHist123!";
const SESSION_SECRET = "crm-owner-history-regression-secret";
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
  for (const base of [dbPath, upgradeDbPath, constraintDbPath]) {
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
  POSTBACK_SECRET: "crm-owner-history-postback-secret",
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
  const child = spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], {
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
const historyUrl = (id: string | number) => `/api/crm/v1/users/${id}/owner/history`;

// Roles that hold view_audit (may read history) vs those that do not. Derived
// from the canonical matrix, not hardcoded, so a matrix drift is caught here.
const VIEWERS = CRM_STAFF_ROLES.filter((r) => STAFF_ROLE_PERMISSIONS[r].includes("view_audit"));
const NON_VIEWERS = CRM_STAFF_ROLES.filter((r) => !STAFF_ROLE_PERMISSIONS[r].includes("view_audit"));

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
      const email = `hstaff-${role}@example.com`;
      const user = await prisma.user.create({ data: { email, name: `HStaff ${role}`, role: "admin", passwordHash: hash } });
      const profile = await prisma.staffProfile.create({ data: { userId: user.id, displayName: `HStaff ${role}`, staffRole: role } });
      staffByRole.set(role, { email, userId: user.id, employeeId: profile.id });
    }

    // Learner with no StaffProfile -> 403 on CRM endpoints.
    await prisma.user.create({ data: { email: "h-plain-learner@example.com", name: "Plain Learner", role: "user", passwordHash: hash } });

    async function makeStaff(email: string, displayName: string, staffRole: StaffRole) {
      const u = await prisma.user.create({ data: { email, name: displayName || "x", role: "admin", passwordHash: hash } });
      const p = await prisma.staffProfile.create({ data: { userId: u.id, displayName, staffRole } });
      return { userId: u.id, employeeId: p.id };
    }
    const ownerA = await makeStaff("h-owner-alpha@example.com", "Owner Alpha", "support");
    const ownerB = await makeStaff("h-owner-beta@example.com", "Owner Beta", "mentor");

    async function learner(email: string) {
      return prisma.user.create({ data: { email, name: `L ${email}`, role: "user", passwordHash: hash } });
    }
    const lifecycle = await learner("h-lifecycle@example.test");
    const emptyL = await learner("h-empty@example.test");
    const noopL = await learner("h-noop@example.test");
    const pristineL = await learner("h-pristine@example.test");
    const staleL = await learner("h-stale@example.test");
    const invalidTargetL = await learner("h-invalid-target@example.test");
    const unauthL = await learner("h-unauth@example.test");
    const rollbackL = await learner("h-rollback@example.test");
    const concL = await learner("h-conc@example.test");
    const pageL = await learner("h-page@example.test");
    const crossA = await learner("h-cross-a@example.test");
    const crossB = await learner("h-cross-b@example.test");
    const privacyL = await learner("h-privacy@example.test");

    const newsEditor = await prisma.user.create({ data: { email: "h-news@example.test", name: "News Editor", role: "news_editor", passwordHash: hash } });
    const adminStaffTargetId = staffByRole.get("crm_admin")!.userId;

    server = await start();
    const admin = () => loginAs(staffByRole.get("crm_admin")!.email);
    const adminEmployeeId = staffByRole.get("crm_admin")!.employeeId;

    // Assign/replace/unassign through the real PUT owner route as admin.
    async function put(id: number, ownerEmployeeId: string | null, expectedVersion: number) {
      const c = await admin();
      return c.request("PUT", ownerUrl(id), { ownerEmployeeId, expectedVersion });
    }

    /* ================================================ authentication (GET) */

    await check("1. unauthenticated GET history is 401", async () => {
      assertEnvelope(await new Client().request("GET", historyUrl(lifecycle.id)), 401, "unauthorized");
    });
    await check("2. malformed session GET history is 401", async () => {
      const c = new Client(); c.setRawSession("1.admin.9999999999999.deadbeef");
      assert.equal((await c.request("GET", historyUrl(lifecycle.id))).status, 401);
    });
    await check("3. expired session GET history is 401", async () => {
      const c = new Client(); c.setRawSession(signToken(adminStaffTargetId, "admin", Date.now() - 60_000));
      assert.equal((await c.request("GET", historyUrl(lifecycle.id))).status, 401);
    });

    /* ============================================= staff boundary / authz */

    await check("4. authenticated non-staff learner is 403 on history", async () => {
      const c = await loginAs("h-plain-learner@example.com");
      assertEnvelope(await c.request("GET", historyUrl(lifecycle.id)), 403, "unauthorized");
    });

    await check("5. exactly the view_audit roles may read history (others 403)", async () => {
      for (const role of VIEWERS) {
        const c = await loginAs(staffByRole.get(role)!.email);
        assert.equal((await c.request("GET", historyUrl(emptyL.id))).status, 200, `${role} should read`);
      }
      for (const role of NON_VIEWERS) {
        const c = await loginAs(staffByRole.get(role)!.email);
        assertEnvelope(await c.request("GET", historyUrl(emptyL.id)), 403, "unauthorized");
      }
    });

    await check("6. view_audit holders are exactly crm_admin, crm_manager", () => {
      assert.deepEqual([...VIEWERS].sort(), ["crm_admin", "crm_manager"].sort());
    });

    await check("7. retention_manager may assign but NOT read history (403)", async () => {
      // retention_manager holds assign_owner but not view_audit: it can mutate the
      // owner yet cannot read the log — the invariant OH-1 requires.
      assert.ok(STAFF_ROLE_PERMISSIONS.retention_manager.includes("assign_owner"));
      assert.ok(!STAFF_ROLE_PERMISSIONS.retention_manager.includes("view_audit"));
      const c = await loginAs(staffByRole.get("retention_manager")!.email);
      assertEnvelope(await c.request("GET", historyUrl(lifecycle.id)), 403, "unauthorized");
    });

    /* ==================================================== learner boundary */

    await check("8. identical 404 for nonexistent / staff / news_editor targets", async () => {
      const c = await admin();
      for (const id of [987654321, adminStaffTargetId, newsEditor.id]) {
        assertEnvelope(await c.request("GET", historyUrl(id)), 404, "not_found");
      }
    });

    await check("9. malformed userId is 400", async () => {
      const c = await admin();
      assertEnvelope(await c.request("GET", historyUrl("abc")), 400, "invalid_input");
    });

    /* ================================================== empty honest state */

    await check("10. a learner with no transitions returns empty items, null cursor", async () => {
      const c = await admin();
      const reply = await c.request("GET", historyUrl(emptyL.id));
      assert.equal(reply.status, 200, reply.text);
      const parsed = crmOwnerHistoryResponseSchema.parse(reply.body);
      assert.deepEqual(parsed.items, []);
      assert.equal(parsed.nextCursor, null);
    });

    /* ============================================= mutation writes history */

    await check("11. assign / replace / unassign each create exactly one ordered row", async () => {
      assert.equal((await put(lifecycle.id, ownerA.employeeId, 0)).status, 200); // v1 assign
      assert.equal((await put(lifecycle.id, ownerB.employeeId, 1)).status, 200); // v2 reassign
      assert.equal((await put(lifecycle.id, null, 2)).status, 200); // v3 unassign

      const c = await admin();
      const parsed = crmOwnerHistoryResponseSchema.parse((await c.request("GET", historyUrl(lifecycle.id))).body);
      assert.equal(parsed.items.length, 3, "exactly three rows");

      // Newest first: v3 unassign, v2 reassign, v1 assign.
      assert.deepEqual(parsed.items.map((i) => i.ownerVersion), [3, 2, 1]);
      assert.deepEqual(parsed.items.map((i) => i.transition), ["unassigned", "reassigned", "assigned"]);

      const [v3, v2, v1] = parsed.items;
      assert.equal(v1.previousOwner, null);
      assert.deepEqual(v1.nextOwner, { employeeId: ownerA.employeeId, displayName: "Owner Alpha" });
      assert.deepEqual(v2.previousOwner, { employeeId: ownerA.employeeId, displayName: "Owner Alpha" });
      assert.deepEqual(v2.nextOwner, { employeeId: ownerB.employeeId, displayName: "Owner Beta" });
      assert.deepEqual(v3.previousOwner, { employeeId: ownerB.employeeId, displayName: "Owner Beta" });
      assert.equal(v3.nextOwner, null);

      // Actor is the authenticated admin StaffProfile on every row.
      for (const item of parsed.items) {
        assert.equal(item.actor.employeeId, adminEmployeeId, "actor must be the session staff");
        assert.equal(item.actor.displayName, "HStaff crm_admin");
      }

      // Resulting ownerVersion matches the current owner state.
      assert.equal(await prisma.crmUserOwner.findUnique({ where: { userId: lifecycle.id }, select: { version: true } }).then((r) => r!.version), 3);
    });

    await check("12. no-op A->A creates no new row", async () => {
      await put(noopL.id, ownerA.employeeId, 0); // v1
      const before = await prisma.crmUserOwnerHistory.count({ where: { userId: noopL.id } });
      assert.equal((await put(noopL.id, ownerA.employeeId, 1)).status, 200); // no-op, still v1
      const after = await prisma.crmUserOwnerHistory.count({ where: { userId: noopL.id } });
      assert.equal(after, before, "no-op must not write history");
      assert.equal(before, 1);
    });

    await check("13. pristine null->null no-op creates no row", async () => {
      assert.equal((await put(pristineL.id, null, 0)).status, 200);
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: pristineL.id } }), 0);
    });

    await check("14. stale expectedVersion (409) creates no row", async () => {
      await put(staleL.id, ownerA.employeeId, 0); // v1
      const before = await prisma.crmUserOwnerHistory.count({ where: { userId: staleL.id } });
      assert.equal((await put(staleL.id, ownerB.employeeId, 0)).status, 409); // stale
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: staleL.id } }), before);
    });

    await check("15. invalid target owner (404) creates no row", async () => {
      const c = await admin();
      const reply = await c.request("PUT", ownerUrl(invalidTargetL.id), { ownerEmployeeId: "no-such-employee", expectedVersion: 0 });
      assert.equal(reply.status, 404);
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: invalidTargetL.id } }), 0);
    });

    await check("16. unauthorized PUT (no assign_owner) creates no row", async () => {
      const c = await loginAs(staffByRole.get("support")!.email); // support lacks assign_owner
      const reply = await c.request("PUT", ownerUrl(unauthL.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 });
      assert.equal(reply.status, 403);
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: unauthL.id } }), 0);
    });

    await check("17. unauthenticated PUT creates no row", async () => {
      const reply = await new Client().request("PUT", ownerUrl(unauthL.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 });
      assert.equal(reply.status, 401);
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: unauthL.id } }), 0);
    });

    await check("18. request cannot inject actorStaffId / previousOwnerId / ownerVersion", async () => {
      const c = await admin();
      // Strict body: any extra field is a 400 and writes nothing.
      for (const extra of [
        { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0, actorStaffId: ownerB.employeeId },
        { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0, previousOwnerId: ownerB.employeeId },
        { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0, ownerVersion: 99 },
        { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0, createdAt: "2020-01-01T00:00:00.000Z" },
      ]) {
        const reply = await c.request("PUT", ownerUrl(unauthL.id), extra);
        assert.equal(reply.status, 400, `injection ${JSON.stringify(extra)} must be 400`);
      }
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: unauthL.id } }), 0);
    });

    /* ==================================== atomic rollback on history failure */

    await check("19. history write failure rolls back the owner mutation (atomic)", async () => {
      // Pre-plant a history row that will collide with the version the first
      // assign produces (v1). The assign's history insert then hits the unique
      // (userId, ownerVersion) index; the whole transaction rolls back, so NO
      // CrmUserOwner row is created and the PUT is a 409.
      await prisma.crmUserOwnerHistory.create({
        data: { userId: rollbackL.id, actorStaffId: adminEmployeeId, previousOwnerId: null, nextOwnerId: ownerA.employeeId, ownerVersion: 1 },
      });
      const reply = await put(rollbackL.id, ownerB.employeeId, 0);
      assert.equal(reply.status, 409, `expected 409, got ${reply.status}: ${reply.text}`);
      assert.equal(await prisma.crmUserOwner.count({ where: { userId: rollbackL.id } }), 0, "owner mutation must have rolled back");
      // Only the pre-planted row remains; no second row was written.
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: rollbackL.id } }), 1);
    });

    /* ================================================= concurrency (races) */

    await check("20. concurrent same-version PUT: one 200 / one 409, exactly one history row at that version", async () => {
      const c = await admin();
      await c.request("PUT", ownerUrl(concL.id), { ownerEmployeeId: ownerA.employeeId, expectedVersion: 0 }); // v1
      const [r1, r2] = await Promise.all([
        c.request("PUT", ownerUrl(concL.id), { ownerEmployeeId: ownerB.employeeId, expectedVersion: 1 }),
        c.request("PUT", ownerUrl(concL.id), { ownerEmployeeId: null, expectedVersion: 1 }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
      // Exactly one row claims resulting version 2.
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: concL.id, ownerVersion: 2 } }), 1);
      // Total rows = v1 + one v2 = 2.
      assert.equal(await prisma.crmUserOwnerHistory.count({ where: { userId: concL.id } }), 2);
    });

    /* ==================================================== pagination (read) */

    await check("21. keyset pagination is newest-first, stable, no dup/missing, default+max limit", async () => {
      // Build 25 transitions on pageL: assign then alternate owners.
      let version = 0;
      assert.equal((await put(pageL.id, ownerA.employeeId, version++)).status, 200); // v1
      for (let i = 0; i < 24; i++) {
        const next = i % 2 === 0 ? ownerB.employeeId : ownerA.employeeId;
        assert.equal((await put(pageL.id, next, version++)).status, 200);
      }
      const c = await admin();

      // Default limit is 20.
      const first = crmOwnerHistoryResponseSchema.parse((await c.request("GET", historyUrl(pageL.id))).body);
      assert.equal(first.items.length, 20, "default limit must be 20");
      assert.equal(first.items[0].ownerVersion, 25, "newest first");
      assert.notEqual(first.nextCursor, null);

      // Walk all pages with a small limit; assert strictly descending, unique.
      const seen: number[] = [];
      let cursor: string | null = null;
      do {
        const url: string = cursor ? `${historyUrl(pageL.id)}?limit=7&cursor=${encodeURIComponent(cursor)}` : `${historyUrl(pageL.id)}?limit=7`;
        const page = crmOwnerHistoryResponseSchema.parse((await c.request("GET", url)).body);
        assert.ok(page.items.length <= 7, "limit not honored");
        seen.push(...page.items.map((i) => i.ownerVersion));
        cursor = page.nextCursor;
      } while (cursor);

      assert.equal(seen.length, 25, "every transition seen exactly once");
      assert.deepEqual(seen, [...seen].sort((a, b) => b - a), "must be strictly newest-first");
      assert.equal(new Set(seen).size, 25, "no duplicates across pages");
      assert.deepEqual([...new Set(seen)].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));

      // Max limit is 50; a limit of 51 is rejected.
      assert.equal((await c.request("GET", `${historyUrl(pageL.id)}?limit=50`)).status, 200);
      assertEnvelope(await c.request("GET", `${historyUrl(pageL.id)}?limit=51`), 400, "invalid_input");
      assertEnvelope(await c.request("GET", `${historyUrl(pageL.id)}?limit=0`), 400, "invalid_input");
      assertEnvelope(await c.request("GET", `${historyUrl(pageL.id)}?limit=abc`), 400, "invalid_input");
    });

    await check("22. malformed cursor is 400; a cursor cannot cross users", async () => {
      const c = await admin();
      assertEnvelope(await c.request("GET", `${historyUrl(pageL.id)}?cursor=%%%not-base64%%%`), 400, "invalid_input");
      assertEnvelope(await c.request("GET", `${historyUrl(pageL.id)}?cursor=`), 400, "invalid_input");

      // Build history on crossA (2 rows) and crossB (2 rows). A cursor minted on
      // crossA cannot surface crossB's rows: applied to crossB it only positions
      // within crossB's OWN versions and never leaks crossA's history.
      await put(crossA.id, ownerA.employeeId, 0); // A v1
      await put(crossA.id, ownerB.employeeId, 1); // A v2
      await put(crossB.id, ownerA.employeeId, 0); // B v1
      await put(crossB.id, ownerB.employeeId, 1); // B v2

      const aPage = crmOwnerHistoryResponseSchema.parse((await c.request("GET", `${historyUrl(crossA.id)}?limit=1`)).body);
      const aCursor = aPage.nextCursor!;
      const bViaACursor = crmOwnerHistoryResponseSchema.parse(
        (await c.request("GET", `${historyUrl(crossB.id)}?cursor=${encodeURIComponent(aCursor)}`)).body,
      );
      // Every returned row is genuinely crossB's — none of crossA's actor/owner ids leak.
      for (const item of bViaACursor.items) {
        assert.ok(item.ownerVersion <= 2);
      }
      // The endpoint is filtered by the path userId; a crossA-minted cursor never
      // returns a row that belongs to crossA under crossB's path.
      const bAll = crmOwnerHistoryResponseSchema.parse((await c.request("GET", historyUrl(crossB.id))).body);
      assert.equal(bAll.items.length, 2, "crossB has exactly its own two rows");
    });

    /* ==================================================== privacy / DTO */

    await check("23. response DTO excludes private/internal fields; no total count", async () => {
      const c = await admin();
      await put(privacyL.id, ownerA.employeeId, 0);
      const reply = await c.request("GET", historyUrl(privacyL.id));
      // Strict schema parse proves the shape carries ONLY the allowed keys.
      crmOwnerHistoryResponseSchema.parse(reply.body);
      assert.ok(!("total" in reply.body), "no total-count field");
      assert.ok(!("totalCount" in reply.body), "no totalCount field");
      for (const banned of [
        "@example.com", "email", "actorStaffId", "previousOwnerId", "nextOwnerId",
        "ipAddress", "userAgent", "User-Agent", "staffRole", "permissionVersion",
        "passwordHash", "session", "secret", "AuditLog", "metadata", "updatedAt",
      ]) {
        assert.ok(!reply.text.includes(banned), `history response leaked ${banned}: ${reply.text.slice(0, 300)}`);
      }
    });

    await check("24. history response is no-store with a request id header", async () => {
      const c = await admin();
      const reply = await c.request("GET", historyUrl(emptyL.id));
      assert.equal(reply.headers.get("cache-control"), "no-store");
      assert.ok(String(reply.headers.get("x-request-id") ?? "").length > 0, "missing x-request-id");
    });

    await check("25. no history error path leaks SQL, stack, prisma or db path", async () => {
      const c = await admin();
      const replies = [
        await c.request("GET", historyUrl("abc")),
        await c.request("GET", historyUrl(987654321)),
        await c.request("GET", `${historyUrl(pageL.id)}?limit=999`),
        await c.request("GET", `${historyUrl(pageL.id)}?cursor=@@@`),
      ];
      for (const reply of replies) {
        for (const marker of ["SELECT", "prisma", "Prisma", "/tmp/", ".db", "at Object", "node_modules", "sqlite", "P2002", "P2034"]) {
          assert.ok(!reply.text.includes(marker), `leaked ${marker}: ${reply.text}`);
        }
      }
    });

    /* ==================================================== route scope */

    await check("26. history route exports only GET; POST/PUT/PATCH/DELETE are 404/405", async () => {
      const src = fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "crm", "v1", "users", "[userId]", "owner", "history", "route.ts"), "utf8");
      for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.ok(!new RegExp(`export async function ${verb}\\b`).test(src), `history route must not export ${verb}`);
      }
      assert.ok(/export async function GET\b/.test(src));
      const c = await admin();
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const reply = await c.request(method, historyUrl(emptyL.id), {});
        assert.ok(reply.status === 404 || reply.status === 405, `${method} returned ${reply.status}`);
      }
    });

    await check("27. history service never writes and uses explicit selects", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "user-owner-history.ts"), "utf8");
      assert.ok(!src.includes("include:"), "must not use include");
      assert.ok(!/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(src), "read module must not write");
      assert.ok(!src.includes("console."), "must not log");
    });

    /* ==================================================== database integrity */

    await check("28. fresh DB has the expected migration count incl. owner history; clean fk/integrity", () => {
      const migrations = fs.readdirSync(path.join(process.cwd(), "prisma", "migrations")).filter((e) => e !== "migration_lock.toml");
      assert.equal(migrations.length, EXPECTED_MIGRATION_COUNT, `expected ${EXPECTED_MIGRATION_COUNT} migrations, found ${migrations.length}`);
      assert.ok(migrations.includes("20260723000000_crm_user_owner_history"));
      const fk = spawnSync("sqlite3", [dbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" });
      if (fk.status === 0) assert.equal(fk.stdout.trim(), "", `foreign_key_check reported ${fk.stdout}`);
      const integ = spawnSync("sqlite3", [dbPath, "PRAGMA integrity_check;"], { encoding: "utf8" });
      if (integ.status === 0) assert.equal(integ.stdout.trim(), "ok", `integrity_check reported ${integ.stdout}`);
    });

    await check("29. the CrmUserOwnerHistory indexes exist (unique keyset + 3 FK)", () => {
      const idx = spawnSync("sqlite3", [dbPath, "PRAGMA index_list('CrmUserOwnerHistory');"], { encoding: "utf8" }).stdout;
      for (const name of [
        "CrmUserOwnerHistory_userId_ownerVersion_key",
        "CrmUserOwnerHistory_actorStaffId_idx",
        "CrmUserOwnerHistory_previousOwnerId_idx",
        "CrmUserOwnerHistory_nextOwnerId_idx",
      ]) {
        assert.ok(idx.includes(name), `missing index ${name}: ${idx}`);
      }
    });

    await check("30. migration 33 is additive: no rebuild, no update, no backfill insert", () => {
      const sql = fs.readFileSync(path.join(process.cwd(), "prisma", "migrations", "20260723000000_crm_user_owner_history", "migration.sql"), "utf8");
      const statements = sql.replace(/--[^\n]*\n/g, "");
      assert.ok(!/\bUPDATE\s+"/.test(statements), "migration must not update rows");
      assert.ok(!/CREATE TABLE "new_/.test(statements), "migration must not rebuild a table");
      assert.ok(!/INSERT\s+INTO/i.test(statements), "migration must not backfill any row");
      assert.ok(/CREATE TABLE "CrmUserOwnerHistory"/.test(statements));
    });

    await check("31. DB rejects null->null, A->A, and duplicate userId+ownerVersion", () => {
      // Fresh throwaway DB with only User + StaffProfile + the history table.
      const seed = spawnSync("sqlite3", [constraintDbPath], {
        input: `CREATE TABLE "User"(id INTEGER PRIMARY KEY); CREATE TABLE "StaffProfile"(id TEXT PRIMARY KEY);`,
        encoding: "utf8",
      });
      assert.equal(seed.status, 0);
      const historySql = fs.readFileSync(path.join(process.cwd(), "prisma", "migrations", "20260723000000_crm_user_owner_history", "migration.sql"), "utf8");
      assert.equal(spawnSync("sqlite3", [constraintDbPath], { input: historySql, encoding: "utf8" }).status, 0);
      const off = `PRAGMA foreign_keys=OFF;`;
      const nullNull = spawnSync("sqlite3", [constraintDbPath], { input: `${off} INSERT INTO "CrmUserOwnerHistory" (id,userId,actorStaffId,previousOwnerId,nextOwnerId,ownerVersion) VALUES ('x1',1,'s',NULL,NULL,1);`, encoding: "utf8" });
      assert.notEqual(nullNull.status, 0, "null->null must be rejected");
      const aa = spawnSync("sqlite3", [constraintDbPath], { input: `${off} INSERT INTO "CrmUserOwnerHistory" (id,userId,actorStaffId,previousOwnerId,nextOwnerId,ownerVersion) VALUES ('x2',1,'s','a','a',1);`, encoding: "utf8" });
      assert.notEqual(aa.status, 0, "A->A must be rejected");
      const good = spawnSync("sqlite3", [constraintDbPath], { input: `${off} INSERT INTO "CrmUserOwnerHistory" (id,userId,actorStaffId,previousOwnerId,nextOwnerId,ownerVersion) VALUES ('x3',1,'s',NULL,'a',1);`, encoding: "utf8" });
      assert.equal(good.status, 0, "assign must be accepted");
      const dup = spawnSync("sqlite3", [constraintDbPath], { input: `${off} INSERT INTO "CrmUserOwnerHistory" (id,userId,actorStaffId,previousOwnerId,nextOwnerId,ownerVersion) VALUES ('x4',1,'s','a',NULL,1);`, encoding: "utf8" });
      assert.notEqual(dup.status, 0, "duplicate userId+ownerVersion must be rejected");
    });

    await check("32. rerunning the migration runner is idempotent", () => {
      const rerun = runMigrations(baseEnv);
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
    });

    /* ==================================================== 32 -> 33 upgrade */

    await check("33. upgrading a pre-history DB preserves rows and adds an empty history table", () => {
      const upgradeUrl = `file:${upgradeDbPath}`;
      const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
      const prior = fs.readdirSync(migrationsDir)
        .filter((e) => e !== "migration_lock.toml" && e !== "20260723000000_crm_user_owner_history")
        .sort();
      assert.equal(prior.length, expectedPriorMigrationCount(1), `expected ${expectedPriorMigrationCount(1)} prior migrations, found ${prior.length}`);

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

      // The history table must not exist yet, but the owner table must.
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='CrmUserOwnerHistory';`, encoding: "utf8" }).stdout.trim(), "0");
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='CrmUserOwner';`, encoding: "utf8" }).stdout.trim(), "1");

      // Representative pre-existing rows, including an existing owner state that
      // migration 33 must preserve untouched (version NOT reset).
      const seed = `
        INSERT INTO "User" ("email","pendingEmail","referralCode","passwordHash","role","status","name","level","xp","createdAt","updatedAt")
        VALUES ('u-legacy@example.test',NULL,'oh-ref','x','user','active','Legacy Learner',3,300,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "User" ("email","pendingEmail","referralCode","passwordHash","role","status","name","level","xp","createdAt","updatedAt")
        VALUES ('s-legacy@example.test',NULL,'oh-ref-2','x','admin','active','Legacy Staff',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "StaffProfile" ("id","userId","displayName","staffRole","permissionVersion","createdAt","updatedAt")
        VALUES ('oh-emp-1',(SELECT id FROM "User" WHERE email='s-legacy@example.test'),'Legacy Staff','crm_manager',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "CrmUserOwner" ("userId","ownerId","version","createdAt","updatedAt")
        VALUES ((SELECT id FROM "User" WHERE email='u-legacy@example.test'),'oh-emp-1',4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`;
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: seed, encoding: "utf8" }).status, 0);

      // Apply migration 33 through the repository runner.
      const upgrade = runMigrations({ ...baseEnv, DATABASE_URL: upgradeUrl });
      assert.equal(upgrade.status, 0, `${upgrade.stdout}\n${upgrade.stderr}`);
      assert.ok(upgrade.stdout.includes("Migration 20260723000000_crm_user_owner_history applied."), "migration 33 not applied");

      // Zero history rows after migration (no backfill); owner state preserved.
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM "CrmUserOwnerHistory";`, encoding: "utf8" }).stdout.trim(), "0");
      const after = spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM "User"; SELECT count(*) FROM "StaffProfile"; SELECT count(*) FROM "CrmUserOwner"; SELECT version FROM "CrmUserOwner";`, encoding: "utf8" });
      assert.equal(after.stdout.trim().split("\n").map((s) => s.trim()).join(","), "2,1,1,4", "existing rows/version must be preserved");

      // The upgraded history table is usable and keeps FKs clean.
      const use = `PRAGMA foreign_keys=ON;
        INSERT INTO "CrmUserOwnerHistory" ("id","userId","actorStaffId","previousOwnerId","nextOwnerId","ownerVersion","createdAt")
        VALUES ('oh-h1',(SELECT id FROM "User" WHERE email='u-legacy@example.test'),'oh-emp-1',NULL,'oh-emp-1',1,CURRENT_TIMESTAMP);
        SELECT ownerVersion FROM "CrmUserOwnerHistory";`;
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: use, encoding: "utf8" }).stdout.trim(), "1");
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: "PRAGMA foreign_key_check;", encoding: "utf8" }).stdout.trim(), "");
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: "PRAGMA integrity_check;", encoding: "utf8" }).stdout.trim(), "ok");

      // Idempotent rerun.
      assert.equal(runMigrations({ ...baseEnv, DATABASE_URL: upgradeUrl }).status, 0);
    });

    await check("34. deleting the actor or an owner named by history is blocked (Restrict)", async () => {
      // lifecycle's history references ownerA/ownerB as previous/next and admin as
      // actor; each Restrict FK blocks deleting a StaffProfile the log names.
      await assert.rejects(prisma.staffProfile.delete({ where: { id: adminEmployeeId } }), "actor delete must be restricted");
      await assert.rejects(prisma.staffProfile.delete({ where: { id: ownerA.employeeId } }), "named owner delete must be restricted");
    });

    await check("35. the runtime and deployed databases were never referenced", () => {
      assert.ok(dbPath.startsWith("/tmp/") && upgradeDbPath.startsWith("/tmp/") && constraintDbPath.startsWith("/tmp/"), "throwaway DBs must live under /tmp");
    });
  } finally {
    await stop(server);
    cleanup();
  }

  const leftovers = [dbPath, upgradeDbPath, constraintDbPath]
    .flatMap((b) => ["", "-journal", "-wal", "-shm"].map((s) => `${b}${s}`))
    .filter((p) => fs.existsSync(p));
  if (leftovers.length > 0) {
    failed += 1;
    console.error(`FAIL 36. temporary databases removed (leftovers: ${leftovers.join(", ")})`);
  } else {
    passed += 1;
    console.log("ok   36. temporary databases removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
