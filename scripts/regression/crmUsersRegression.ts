import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { CRM_STAFF_ROLES } from "../../src/lib/crm/roles";
import { crmUsersResponseSchema } from "../../src/lib/crm/schemas";
import {
  decodeUsersCursor,
  encodeUsersCursor,
  maskEmail,
  CRM_USERS_DISPLAY_NAME_FALLBACK,
} from "../../src/lib/crm/users";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

// Real HTTP regression for GET /api/crm/v1/users. Runs an isolated next dev
// server against a throwaway /tmp SQLite database. No deployed database, no
// external service, no persistent process.
const dbPath = `/tmp/ata-crm-users-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3940 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "CrmUsers123!";
const SESSION_SECRET = "crm-users-regression-secret";
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
  POSTBACK_SECRET: "crm-users-postback-secret",
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

type Item = {
  userId: string;
  displayName: string;
  email: { value: string; visibility: string };
  status: string;
  level: number;
  emailConfirmed: boolean;
  createdAt: string;
  owner: { displayName: string } | null;
};
const itemsOf = (reply: Reply) => reply.body.items as Item[];

// One authenticated client per account, reused across checks. The app
// rate-limits /api/auth/login, so logging in per check would throttle the run
// rather than test anything.
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

    // A learner with no StaffProfile -> 403 on CRM endpoints.
    await prisma.user.create({ data: { email: "plain-learner@example.com", name: "Plain Learner", role: "user", passwordHash: hash } });

    // A staff account that gets blocked mid-test -> 401.
    const blocked = await prisma.user.create({ data: { email: "blocked-staff@example.com", name: "Blocked Staff", role: "support", passwordHash: hash } });
    await prisma.staffProfile.create({ data: { userId: blocked.id, displayName: "Blocked Staff", staffRole: "support" } });

    // --- learners (deterministic createdAt for stable ordering) -------------
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const learnerIds: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const user = await prisma.user.create({
        data: {
          email: `learner${String(index).padStart(2, "0")}@example.test`,
          name: `Learner ${String(index).padStart(2, "0")}`,
          role: "user",
          passwordHash: hash,
          level: index + 1,
          createdAt: new Date(base + index * 60_000),
          emailVerifiedAt: index % 2 === 0 ? new Date(base) : null,
        },
      });
      learnerIds.push(user.id);
    }

    // Two learners sharing an identical createdAt — the tie-break case.
    const tieAt = new Date("2026-02-02T00:00:00.000Z");
    const tieA = await prisma.user.create({ data: { email: "tie-a@example.test", name: "Tie Alpha", role: "user", passwordHash: hash, createdAt: tieAt } });
    const tieB = await prisma.user.create({ data: { email: "tie-b@example.test", name: "Tie Beta", role: "user", passwordHash: hash, createdAt: tieAt } });

    // A learner with a blank name -> honest fallback, never the email.
    await prisma.user.create({ data: { email: "nameless@example.test", name: "   ", role: "user", passwordHash: hash, createdAt: new Date("2026-03-03T00:00:00.000Z") } });

    /* ------------------------------------------------------ owner fixtures */

    // The "mine" actor is crm_manager (an existing, eligible StaffProfile). We
    // create owner-state rows DIRECTLY via prisma to control every state exactly
    // — the assignment SERVICE is exercised by crmUserOwnerRegression, not here.
    const managerProfile = await prisma.staffProfile.findFirstOrThrow({
      where: { userId: staffByRole.get("crm_manager")!.userId },
      select: { id: true, displayName: true },
    });
    const supportProfile = await prisma.staffProfile.findFirstOrThrow({
      where: { userId: staffByRole.get("support")!.userId },
      select: { id: true },
    });

    // Two learners owned by the mine-actor (crm_manager).
    const ownedA = await prisma.user.create({ data: { email: "owned-a@example.test", name: "Owned Alpha", role: "user", passwordHash: hash, createdAt: new Date("2026-04-01T00:00:00.000Z") } });
    const ownedB = await prisma.user.create({ data: { email: "owned-b@example.test", name: "Owned Beta", role: "user", passwordHash: hash, createdAt: new Date("2026-04-02T00:00:00.000Z") } });
    await prisma.crmUserOwner.create({ data: { userId: ownedA.id, ownerId: managerProfile.id, version: 1 } });
    await prisma.crmUserOwner.create({ data: { userId: ownedB.id, ownerId: managerProfile.id, version: 2 } });

    // A learner owned by someone ELSE (support) — must never appear in the
    // manager's `mine`, and must be excluded from `unassigned`.
    const ownedByOther = await prisma.user.create({ data: { email: "owned-other@example.test", name: "Owned Other", role: "user", passwordHash: hash, createdAt: new Date("2026-04-03T00:00:00.000Z") } });
    await prisma.crmUserOwner.create({ data: { userId: ownedByOther.id, ownerId: supportProfile.id, version: 1 } });

    // Persisted-null: a row exists but ownerId is null (version > 0). This is
    // the previously-assigned-then-unassigned state and MUST count as
    // unassigned — the case a naive "no row" predicate would drop.
    const persistedNull = await prisma.user.create({ data: { email: "persisted-null@example.test", name: "Persisted Null", role: "user", passwordHash: hash, createdAt: new Date("2026-04-04T00:00:00.000Z") } });
    await prisma.crmUserOwner.create({ data: { userId: persistedNull.id, ownerId: null, version: 3 } });

    // Blocked current owner: a dedicated staff, assigned, then its User blocked.
    // The owner must stay visible (the owner read is not status-filtered).
    const blockedOwnerUser = await prisma.user.create({ data: { email: "owner-blocked@example.com", name: "Owner Blocked User", role: "support", passwordHash: hash } });
    const blockedOwnerProfile = await prisma.staffProfile.create({ data: { userId: blockedOwnerUser.id, displayName: "Blocked Owner Name", staffRole: "support" } });
    const blockedOwnerLearner = await prisma.user.create({ data: { email: "has-blocked-owner@example.test", name: "Has Blocked Owner", role: "user", passwordHash: hash, createdAt: new Date("2026-04-05T00:00:00.000Z") } });
    await prisma.crmUserOwner.create({ data: { userId: blockedOwnerLearner.id, ownerId: blockedOwnerProfile.id, version: 1 } });
    await prisma.user.update({ where: { id: blockedOwnerUser.id }, data: { status: "blocked" } });

    // Role-ineligible current owner: a dedicated staff with a NON-eligible
    // StaffRole (moderator). Assigned directly, it must also stay visible.
    const ineligOwnerUser = await prisma.user.create({ data: { email: "owner-inelig@example.com", name: "Owner Inelig User", role: "support", passwordHash: hash } });
    const ineligOwnerProfile = await prisma.staffProfile.create({ data: { userId: ineligOwnerUser.id, displayName: "Ineligible Owner Name", staffRole: "moderator" } });
    const ineligOwnerLearner = await prisma.user.create({ data: { email: "has-inelig-owner@example.test", name: "Has Ineligible Owner", role: "user", passwordHash: hash, createdAt: new Date("2026-04-06T00:00:00.000Z") } });
    await prisma.crmUserOwner.create({ data: { userId: ineligOwnerLearner.id, ownerId: ineligOwnerProfile.id, version: 1 } });

    /* ---------------------------------------- where-composition fixtures ---
     * Purpose-built so a single search token spans BOTH an assigned learner and
     * unassigned learners, and so owner=mine can be exercised with an actor-owned
     * learner that does NOT match the search. These are exactly the shapes a
     * top-level `OR` key-overwrite (owner OR vs search OR) silently mishandles.
     *
     *   Kappa Shared        -> assigned (support)      | search "Kappa Shared" hit
     *   Kappa Shared Free   -> unassigned, rowless     | search "Kappa Shared" hit
     *   Kappa Shared Null   -> unassigned, persisted-null | search "Kappa Shared" hit
     *   Sigma Book          -> assigned (support, "mine"), NOT a "Owned" hit
     *
     * Sigma Book is owned by support (never crm_manager) so it cannot disturb the
     * crm_manager mine-book that checks 77/81 pin exactly to ownedA/ownedB.
     */
    const compAssigned = await prisma.user.create({ data: { email: "kappa-shared@example.test", name: "Kappa Shared", role: "user", passwordHash: hash, createdAt: new Date("2026-06-01T00:00:00.000Z") } });
    await prisma.crmUserOwner.create({ data: { userId: compAssigned.id, ownerId: supportProfile.id, version: 1 } });
    const compRowless = await prisma.user.create({ data: { email: "kappa-shared-free@example.test", name: "Kappa Shared Free", role: "user", passwordHash: hash, createdAt: new Date("2026-06-02T00:00:00.000Z") } });
    const compPersistedNull = await prisma.user.create({ data: { email: "kappa-shared-null@example.test", name: "Kappa Shared Null", role: "user", passwordHash: hash, createdAt: new Date("2026-06-03T00:00:00.000Z") } });
    await prisma.crmUserOwner.create({ data: { userId: compPersistedNull.id, ownerId: null, version: 2 } });
    // Owned by support and dated BEFORE ownedByOther (support's matching learner,
    // 04-03): under a support mine+search+cursor walk, a pre-fix build that drops
    // the search predicate on page 2 would leak this non-matching learner, so it
    // must sort where the cursor descends into, not above support's matching row.
    const mineNoMatch = await prisma.user.create({ data: { email: "sigma-book@example.test", name: "Sigma Book", role: "user", passwordHash: hash, createdAt: new Date("2026-04-02T12:00:00.000Z") } });
    await prisma.crmUserOwner.create({ data: { userId: mineNoMatch.id, ownerId: supportProfile.id, version: 1 } });

    // Assigned learners = every learner above with a non-null ownerId.
    const assignedLearnerIds = new Set(
      [ownedA.id, ownedB.id, ownedByOther.id, blockedOwnerLearner.id, ineligOwnerLearner.id, compAssigned.id, mineNoMatch.id].map(String),
    );

    const totalLearners = await prisma.user.count({ where: { role: "user" } });
    const unassignedExpected = totalLearners - assignedLearnerIds.size;

    server = await start();

    /* ------------------------------------------------------ authorization */

    await check("1. unauthenticated request is 401", async () => {
      const reply = await new Client().request("GET", "/api/crm/v1/users");
      assert.equal(reply.status, 401);
      assert.equal(reply.body.code, "unauthorized");
      assert.ok(String(reply.body.requestId).length > 0);
    });

    await check("2. invalid session signature is 401", async () => {
      const client = new Client();
      client.setRawSession("1.admin.9999999999999.deadbeef");
      assert.equal((await client.request("GET", "/api/crm/v1/users")).status, 401);
    });

    await check("3. expired but correctly signed session is 401", async () => {
      const client = new Client();
      client.setRawSession(signToken(staffByRole.get("crm_admin")!.userId, "admin", Date.now() - 60_000));
      assert.equal((await client.request("GET", "/api/crm/v1/users")).status, 401);
    });

    await check("4. authenticated learner without a StaffProfile is 403", async () => {
      const client = await loginAs("plain-learner@example.com");
      const reply = await client.request("GET", "/api/crm/v1/users");
      assert.equal(reply.status, 403);
      assert.equal(reply.body.code, "unauthorized");
    });

    await check("5. blocked staff account is 401 even with a valid cookie", async () => {
      const client = await loginAs("blocked-staff@example.com");
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "blocked" } });
      assert.equal((await client.request("GET", "/api/crm/v1/users")).status, 401);
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "active" } });
    });

    await check("6. all nine StaffRoles can read the basic users list", async () => {
      for (const role of CRM_STAFF_ROLES) {
        const client = await loginAs(staffByRole.get(role)!.email);
        const reply = await client.request("GET", "/api/crm/v1/users");
        assert.equal(reply.status, 200, `${role} expected 200, got ${reply.status}`);
        assert.ok(Array.isArray(reply.body.items), `${role} returned no items array`);
      }
    });

    await check("7. StaffRole drives access, not UserRole (UserRole admin + StaffRole read_only reads fine)", async () => {
      const client = await loginAs(staffByRole.get("read_only")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users");
      assert.equal(reply.status, 200);
      // read_only holds no permissions, so email must be masked.
      assert.equal(itemsOf(reply)[0].email.visibility, "masked");
    });

    /* ------------------------------------------------------------ contract */

    let adminReply: Reply;
    await check("8. success response matches the strict Zod schema exactly", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      adminReply = await client.request("GET", "/api/crm/v1/users");
      assert.equal(adminReply.status, 200);
      const parsed = crmUsersResponseSchema.safeParse(adminReply.body);
      assert.ok(parsed.success, JSON.stringify(adminReply.body).slice(0, 800));
    });

    await check("9. envelope has exactly items and nextCursor", () => {
      assert.deepEqual(Object.keys(adminReply.body).sort(), ["items", "nextCursor"]);
    });

    await check("10. each item has exactly the eight contract keys (incl. owner)", () => {
      for (const item of itemsOf(adminReply)) {
        assert.deepEqual(
          Object.keys(item).sort(),
          ["createdAt", "displayName", "email", "emailConfirmed", "level", "owner", "status", "userId"],
        );
      }
    });

    await check("11. userId is an opaque decimal string, not employeeId", async () => {
      for (const item of itemsOf(adminReply)) {
        assert.equal(typeof item.userId, "string");
        assert.match(item.userId, /^\d+$/);
      }
      // StaffProfile.id is a cuid (starts "c", non-numeric); userId never is.
      const staffProfileIds = new Set(
        (await prisma.staffProfile.findMany({ select: { id: true } })).map((p) => p.id),
      );
      for (const item of itemsOf(adminReply)) {
        assert.ok(!staffProfileIds.has(item.userId), "userId collided with a StaffProfile id");
      }
      assert.ok(!("employeeId" in itemsOf(adminReply)[0]), "must not expose employeeId");
    });

    await check("12. no mock fixture identifiers appear", () => {
      for (const marker of ["usr_mock", "emp_mock", "note_mock", "$50–99", "Nina Chmiel"]) {
        assert.ok(!adminReply.text.includes(marker), `mock marker leaked: ${marker}`);
      }
    });

    await check("13. no password/token/cookie/security field is present", () => {
      for (const banned of ["passwordHash", "password", "referralCode", "token", "emailVerificationToken", "cookie", "sessionToken", "pendingEmail"]) {
        assert.ok(!adminReply.text.includes(banned), `must not expose ${banned}`);
      }
    });

    await check("14. no notes/team/financial field is fabricated, and no owner internals leak", () => {
      // `owner` is now a real field (displayName only). Everything else the mock
      // carries stays absent, and no owner INTERNAL (ownerId, ownerVersion,
      // employeeId, staffRole, owner email) is ever serialized.
      for (const banned of ["ownerId", "ownerVersion", "ownerEmployeeId", "employeeId", "staffRole", "noteCount", "notes", "unread", "balance", "netDeposits", "bucket", "segment", "priority", "recommendation", "taskCount", "caseCount", "signals", "traderId", "clickId", "totalDeposits", "xp"]) {
        assert.ok(!adminReply.text.includes(banned), `must not expose ${banned}`);
      }
    });

    await check("15. no raw Prisma record leakage (updatedAt, role, currentTask absent)", () => {
      for (const banned of ["updatedAt", "currentTask", "leaderboardExcluded", "selectedAchievementId", "emailVerifiedAt"]) {
        assert.ok(!adminReply.text.includes(banned), `raw column leaked: ${banned}`);
      }
    });

    await check("16. response is Cache-Control: no-store", () => {
      assert.ok(String(adminReply.headers.get("cache-control") ?? "").includes("no-store"));
    });

    await check("17. every response carries a requestId header; errors carry it in the body", async () => {
      assert.ok(String(adminReply.headers.get("x-request-id") ?? "").length > 0);
      const anon = await new Client().request("GET", "/api/crm/v1/users");
      assert.ok(String(anon.body.requestId).length > 0);
      assert.ok(String(anon.headers.get("x-request-id") ?? "").length > 0);
    });

    await check("18. only learner accounts are listed (staff accounts absent)", () => {
      const staffEmails = new Set([...staffByRole.values()].map((s) => s.email));
      for (const item of itemsOf(adminReply)) {
        assert.ok(!staffEmails.has(item.email.value), `staff account listed: ${item.email.value}`);
      }
    });

    await check("19. blank name falls back honestly and never to the email", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?search=nameless");
      // Name search cannot match a blank name, so fetch the first page instead.
      const all = await client.request("GET", "/api/crm/v1/users?limit=100");
      const nameless = itemsOf(all).find((i) => i.email.value === "nameless@example.test");
      assert.ok(nameless, "nameless learner missing");
      assert.equal(nameless.displayName, CRM_USERS_DISPLAY_NAME_FALLBACK);
      assert.ok(!nameless.displayName.includes("@"));
      assert.equal(reply.status, 200);
    });

    /* --------------------------------------------------------- permissions */

    await check("20. view_identity_full_email grants the full address", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      const item = itemsOf(reply).find((i) => i.email.value === "learner00@example.test");
      assert.ok(item, "expected full email for crm_admin");
      assert.equal(item.email.visibility, "full");
    });

    await check("21. without the permission only a masked address is returned", async () => {
      for (const role of ["mentor", "support", "moderator", "analyst", "content_manager", "read_only"] as const) {
        const client = await loginAs(staffByRole.get(role)!.email);
        const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
        for (const item of itemsOf(reply)) {
          assert.equal(item.email.visibility, "masked", `${role} saw ${item.email.visibility}`);
        }
        assert.ok(!reply.text.includes("learner00@example.test"), `${role} leaked a full email`);
        assert.ok(!reply.text.includes("@example.test\""), `${role} leaked a full address`);
      }
    });

    await check("22. masked email is deterministic and hides the address", () => {
      assert.equal(maskEmail("nina.chmiel@example.test"), "n***@e***.test");
      assert.equal(maskEmail("nina.chmiel@example.test"), maskEmail("nina.chmiel@example.test"));
      assert.equal(maskEmail("a@b.co"), "a***@b***.co");
      assert.equal(maskEmail("no-at-sign"), "***");
      assert.equal(maskEmail("x@nodot"), "x***@***");
    });

    await check("23. reveal_pii alone does not grant the full email", async () => {
      // support holds edit_user_notes only; no role holds reveal_pii without
      // view_identity_full_email, so assert the matrix keeps that true.
      const { STAFF_ROLE_PERMISSIONS } = await import("../../src/lib/crm/roles");
      for (const [role, perms] of Object.entries(STAFF_ROLE_PERMISSIONS)) {
        if (perms.includes("reveal_pii")) {
          assert.ok(
            perms.includes("view_identity_full_email"),
            `${role} has reveal_pii without view_identity_full_email — masking rule must be re-reviewed`,
          );
        }
      }
      // And the projection keys off view_identity_full_email specifically.
      const client = await loginAs(staffByRole.get("read_only")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users");
      assert.equal(itemsOf(reply)[0].email.visibility, "masked");
    });

    await check("24. no full email exists anywhere in an unauthorized response", async () => {
      const client = await loginAs(staffByRole.get("analyst")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      for (const learnerEmail of ["learner00@example.test", "tie-a@example.test", "nameless@example.test"]) {
        assert.ok(!reply.text.includes(learnerEmail), `leaked ${learnerEmail}`);
      }
    });

    /* --------------------------------------------------------- pagination */

    await check("25. default limit is 25", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users");
      assert.equal(itemsOf(reply).length, Math.min(25, totalLearners));
    });

    await check("26. explicit limit, limit=1 and limit=100 are honoured", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      assert.equal(itemsOf(await client.request("GET", "/api/crm/v1/users?limit=5")).length, 5);
      assert.equal(itemsOf(await client.request("GET", "/api/crm/v1/users?limit=1")).length, 1);
      const max = await client.request("GET", "/api/crm/v1/users?limit=100");
      assert.equal(max.status, 200);
      assert.ok(itemsOf(max).length <= 100);
    });

    await check("27. invalid limits are rejected with invalid_input", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      for (const bad of ["0", "101", "-1", "1.5", "abc", "", " ", "1e2", "0x10"]) {
        const reply = await client.request("GET", `/api/crm/v1/users?limit=${encodeURIComponent(bad)}`);
        assert.equal(reply.status, 400, `limit=${bad} should be 400`);
        assert.equal(reply.body.code, "invalid_input");
      }
    });

    await check("28. unknown query keys are rejected, never silently ignored", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      for (const key of ["sort", "filter", "status", "page", "offset", "skip", "segmentId", "ownerId"]) {
        const reply = await client.request("GET", `/api/crm/v1/users?${key}=x`);
        assert.equal(reply.status, 400, `${key} should be rejected`);
        assert.equal(reply.body.code, "invalid_input");
      }
    });

    await check("29. malformed and tampered cursors are rejected with 400", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const bad = [
        "not-base64!!",
        Buffer.from("{}", "utf8").toString("base64url"),
        Buffer.from('{"v":2,"t":"2026-01-01T00:00:00.000Z","i":1}', "utf8").toString("base64url"),
        Buffer.from('{"v":1,"t":"not-a-date","i":1}', "utf8").toString("base64url"),
        Buffer.from('{"v":1,"t":"2026-01-01T00:00:00.000Z"}', "utf8").toString("base64url"),
        Buffer.from('{"v":1,"t":"2026-01-01T00:00:00.000Z","i":1,"extra":true}', "utf8").toString("base64url"),
        "x".repeat(600),
        "",
      ];
      for (const cursor of bad) {
        const reply = await client.request("GET", `/api/crm/v1/users?cursor=${encodeURIComponent(cursor)}`);
        assert.equal(reply.status, 400, `cursor ${cursor.slice(0, 24)} should be 400`);
        assert.equal(reply.body.code, "invalid_input");
        assert.ok(!reply.text.toLowerCase().includes("json"), "decoder detail leaked");
        assert.ok(!reply.text.toLowerCase().includes("prisma"), "prisma detail leaked");
      }
    });

    await check("30. paging walks the whole dataset with no duplicate and no skip", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const url = `/api/crm/v1/users?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const reply: Reply = await client.request("GET", url);
        assert.equal(reply.status, 200);
        for (const item of itemsOf(reply)) seen.push(item.userId);
        cursor = reply.body.nextCursor as string | null;
        guard += 1;
        assert.ok(guard < 50, "pagination did not terminate");
      } while (cursor);

      assert.equal(new Set(seen).size, seen.length, "duplicate userId across pages");
      assert.equal(seen.length, totalLearners, `expected ${totalLearners} learners, saw ${seen.length}`);
    });

    await check("31. ordering is createdAt DESC then id DESC, with ties broken by id", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      const items = itemsOf(reply);
      for (let index = 1; index < items.length; index += 1) {
        const prev = items[index - 1];
        const curr = items[index];
        const prevAt = Date.parse(prev.createdAt);
        const currAt = Date.parse(curr.createdAt);
        assert.ok(prevAt >= currAt, "createdAt not descending");
        if (prevAt === currAt) {
          assert.ok(Number(prev.userId) > Number(curr.userId), "tie not broken by descending id");
        }
      }
      // The two identical-createdAt rows must appear adjacent, higher id first.
      const a = items.findIndex((i) => i.userId === String(tieA.id));
      const b = items.findIndex((i) => i.userId === String(tieB.id));
      assert.ok(a >= 0 && b >= 0);
      assert.equal(Math.abs(a - b), 1, "tied rows not adjacent");
      assert.ok(b < a, "expected the higher id (tieB) first");
    });

    await check("32. a cursor cannot increase the requested limit", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const first = await client.request("GET", "/api/crm/v1/users?limit=2");
      const cursor = String(first.body.nextCursor);
      const second = await client.request("GET", `/api/crm/v1/users?limit=2&cursor=${encodeURIComponent(cursor)}`);
      assert.ok(itemsOf(second).length <= 2);
    });

    await check("33. the final page returns nextCursor null", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      assert.equal(reply.body.nextCursor, null);
      assert.equal(itemsOf(reply).length, totalLearners);
    });

    await check("34. an exact-multiple page boundary still terminates correctly", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      // limit == total: no extra row exists, so nextCursor must be null.
      const reply = await client.request("GET", `/api/crm/v1/users?limit=${totalLearners}`);
      assert.equal(itemsOf(reply).length, totalLearners);
      assert.equal(reply.body.nextCursor, null);
    });

    await check("35. cursor payload carries only the version and pagination tuple", () => {
      const cursor = encodeUsersCursor(new Date("2026-01-01T00:00:00.000Z"), 42);
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      assert.deepEqual(Object.keys(decoded).sort(), ["i", "t", "v"]);
      assert.equal(decoded.v, 1);
      assert.equal(decoded.i, 42);
      const round = decodeUsersCursor(cursor);
      assert.equal(round.id, 42);
      assert.equal(round.createdAt.toISOString(), "2026-01-01T00:00:00.000Z");
      // No identity, role, permission or session material.
      const text = JSON.stringify(decoded);
      for (const banned of ["email", "name", "role", "permission", "session", "employee", "@"]) {
        assert.ok(!text.includes(banned), `cursor leaked ${banned}`);
      }
    });

    await check("36. an empty result set returns items [] and nextCursor null", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?search=zzz-no-such-learner");
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body.items, []);
      assert.equal(reply.body.nextCursor, null);
    });

    /* ------------------------------------------------------------- search */

    await check("37. search matches the display name and is trimmed", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?search=%20%20Learner%2003%20%20");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, 1);
      assert.equal(itemsOf(reply)[0].displayName, "Learner 03");
    });

    await check("38. empty-after-trim search behaves exactly as absent", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const blank = await client.request("GET", "/api/crm/v1/users?search=%20%20&limit=100");
      const absent = await client.request("GET", "/api/crm/v1/users?limit=100");
      assert.equal(itemsOf(blank).length, itemsOf(absent).length);
    });

    await check("39. search is case-insensitive for ASCII (SQLite LIKE semantics)", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const lower = await client.request("GET", "/api/crm/v1/users?search=learner%2004");
      const upper = await client.request("GET", "/api/crm/v1/users?search=LEARNER%2004");
      assert.equal(itemsOf(lower).length, 1);
      assert.equal(itemsOf(upper).length, 1);
      assert.equal(itemsOf(lower)[0].userId, itemsOf(upper)[0].userId);
    });

    await check("40. overlong search is rejected", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", `/api/crm/v1/users?search=${"a".repeat(101)}`);
      assert.equal(reply.status, 400);
      assert.equal(reply.body.code, "invalid_input");
      // Exactly 100 is allowed.
      assert.equal((await client.request("GET", `/api/crm/v1/users?search=${"a".repeat(100)}`)).status, 200);
    });

    await check("41. authorized email search works and returns the full address", async () => {
      const client = await loginAs(staffByRole.get("crm_manager")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?search=learner05%40example.test");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, 1);
      assert.equal(itemsOf(reply)[0].email.value, "learner05@example.test");
      assert.equal(itemsOf(reply)[0].email.visibility, "full");
    });

    await check("42. unauthorized email-shaped search is refused, not silently downgraded", async () => {
      for (const role of ["mentor", "support", "analyst", "read_only"] as const) {
        const client = await loginAs(staffByRole.get(role)!.email);
        const reply = await client.request("GET", "/api/crm/v1/users?search=learner05%40example.test");
        assert.equal(reply.status, 400, `${role} email search should be refused`);
        assert.equal(reply.body.code, "invalid_input");
        // The refusal must not confirm or deny that the address exists.
        assert.ok(!reply.text.includes("learner05@example.test"));
      }
    });

    await check("43. unauthorized name search still works normally", async () => {
      const client = await loginAs(staffByRole.get("analyst")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?search=Learner%2006");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, 1);
      assert.equal(itemsOf(reply)[0].email.visibility, "masked");
    });

    await check("44. search combines with cursor paging without duplicates", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      // Derived, not hardcoded: "Plain Learner" also matches, and the point of
      // this check is paging integrity rather than a fixture count.
      const expected = await prisma.user.count({
        where: { role: "user", name: { contains: "Learner" } },
      });
      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const url = `/api/crm/v1/users?search=Learner&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const reply: Reply = await client.request("GET", url);
        assert.equal(reply.status, 200);
        for (const item of itemsOf(reply)) seen.push(item.userId);
        cursor = reply.body.nextCursor as string | null;
        guard += 1;
        assert.ok(guard < 20, "search pagination did not terminate");
      } while (cursor);
      assert.equal(new Set(seen).size, seen.length, "duplicate userId across searched pages");
      assert.equal(seen.length, expected, `expected ${expected} matches, saw ${seen.length}`);
    });

    /* ------------------------------------------------- database / non-scope */

    await check("45. no learner StaffProfile was created by listing", async () => {
      // Nine role staff + one blocked-staff (check 5) + two dedicated owner
      // staff (blocked-owner, ineligible-owner) = 12. Listing itself creates
      // none, and no learner ever gains a StaffProfile.
      const profiles = await prisma.staffProfile.count();
      assert.equal(profiles, CRM_STAFF_ROLES.length + 3, "unexpected StaffProfile rows");
      for (const id of learnerIds) {
        assert.equal(await prisma.staffProfile.count({ where: { userId: id } }), 0);
      }
    });

    await check("46. migration count matches the canonical constant and foreign keys are clean", () => {
      const migrations = fs.readdirSync(path.join(process.cwd(), "prisma", "migrations"))
        .filter((entry) => entry !== "migration_lock.toml");
      assert.equal(migrations.length, EXPECTED_MIGRATION_COUNT, `expected ${EXPECTED_MIGRATION_COUNT} migrations, found ${migrations.length}`);
      const fk = spawnSync("sqlite3", [dbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" });
      if (fk.status === 0) assert.equal(fk.stdout.trim(), "", `foreign_key_check reported ${fk.stdout}`);
    });

    await check("47. rerunning the migration runner is idempotent", () => {
      const rerun = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], { env: baseEnv, encoding: "utf8" });
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
    });

    await check("48. CRM v1 exposes session, users, owner-candidates and affiliates — no 360/audit route", () => {
      const crmV1 = path.join(process.cwd(), "src", "app", "api", "crm", "v1");
      // `affiliates` joins in AFD-2 (partners, campaigns, tracking-links). It is
      // an administrative namespace only: it serves no learner, exposes no
      // public route and holds no click, attribution or conversion data.
      /* `learner-ops`, `growth` and `community` joined with their own domains and
         are present on the deployed Backend. The ban list below is unchanged. */
      assert.deepEqual(fs.readdirSync(crmV1).sort(), ["affiliates", "community", "growth", "learner-ops", "owner-candidates", "session", "users"]);
      // Notes v1 and Owner v1 ship NESTED users/[userId]/{notes,owner} routes. A
      // top-level /api/crm/v1/notes or /owner route must still never exist, so
      // both stay banned here — this check only looks at the CRM v1 top level.
      for (const banned of ["notes", "owner", "owners", "audit", "360", "user-360"]) {
        assert.ok(!fs.existsSync(path.join(crmV1, banned)), `unexpected route ${banned}`);
      }
      assert.ok(!("crmNote" in prisma), "unexpected CrmNote model");
    });

    await check("49. the users route exposes no mutation verb", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const reply = await client.request(method, "/api/crm/v1/users", {});
        assert.ok(reply.status === 405 || reply.status === 404, `${method} returned ${reply.status}`);
      }
    });

    await check("50. no internal error path leaks SQL, stack or database path", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?cursor=abc.def");
      assert.equal(reply.status, 400);
      for (const marker of ["SELECT", "prisma", "/tmp/", ".db", "at Object", "Error:", "node_modules"]) {
        assert.ok(!reply.text.includes(marker), `leaked ${marker}`);
      }
    });

    /* ============================================ OWNER: query parsing ==== */

    // Walk every page of a given query and return the userIds seen, asserting
    // no duplicate and safe termination.
    async function walkAll(client: Client, suffix: string, limit = 3): Promise<string[]> {
      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const url = `/api/crm/v1/users?limit=${limit}&${suffix}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const reply: Reply = await client.request("GET", url);
        assert.equal(reply.status, 200, `${suffix} page ${guard} -> ${reply.status}`);
        for (const item of itemsOf(reply)) seen.push(item.userId);
        cursor = reply.body.nextCursor as string | null;
        guard += 1;
        assert.ok(guard < 50, `${suffix} pagination did not terminate`);
      } while (cursor);
      assert.equal(new Set(seen).size, seen.length, `duplicate userId for ${suffix}`);
      return seen;
    }

    await check("51. owner omitted defaults to all learners", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      assert.equal(itemsOf(reply).length, totalLearners);
    });

    await check("52. explicit owner=all equals omission", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const all = await client.request("GET", "/api/crm/v1/users?limit=100&owner=all");
      const omitted = await client.request("GET", "/api/crm/v1/users?limit=100");
      assert.equal(all.status, 200);
      assert.deepEqual(
        itemsOf(all).map((i) => i.userId),
        itemsOf(omitted).map((i) => i.userId),
      );
    });

    for (const [name, value] of [
      ["53. empty owner value is 400", ""],
      ["54. unsupported owner value is 400", "team"],
      ["55. uppercase owner=All is 400", "All"],
      ["56. uppercase owner=MINE is 400", "MINE"],
      ["57. owner=assigned is 400 (not supported)", "assigned"],
      ["58. owner=me is 400", "me"],
      ["59. owner=mine,all (comma) is 400", "mine,all"],
      ["60. owner=true (boolean) is 400", "true"],
    ] as const) {
      await check(name, async () => {
        const client = await loginAs(staffByRole.get("crm_admin")!.email);
        const reply = await client.request("GET", `/api/crm/v1/users?owner=${encodeURIComponent(value)}`);
        assert.equal(reply.status, 400, `owner=${value} should be 400`);
        assert.equal(reply.body.code, "invalid_input");
        assert.equal(reply.body.messageKey, "crm.users.owner_filter_invalid");
      });
    }

    await check("61. an arbitrary employee id as owner value is 400, not honoured", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", `/api/crm/v1/users?owner=${encodeURIComponent(managerProfile.id)}`);
      assert.equal(reply.status, 400);
      assert.equal(reply.body.messageKey, "crm.users.owner_filter_invalid");
      // The refusal must not confirm the employee id exists.
      assert.ok(!reply.text.includes(managerProfile.id));
    });

    await check("62. ownerEmployeeId is an unknown query key (400 unknown_query_key)", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?ownerEmployeeId=x");
      assert.equal(reply.status, 400);
      assert.equal(reply.body.messageKey, "crm.users.unknown_query_key");
    });

    /* ==================================== OWNER: repeated-key hardening ==== */

    for (const [name, qs] of [
      ["63. repeated owner (identical values) is 400 repeated_query_key", "owner=mine&owner=mine"],
      ["64. repeated owner (different values) is 400 repeated_query_key", "owner=mine&owner=all"],
      ["65. repeated limit is 400 repeated_query_key", "limit=5&limit=5"],
      ["66. repeated cursor is 400 repeated_query_key", "cursor=a&cursor=b"],
      ["67. repeated search is 400 repeated_query_key", "search=x&search=y"],
      ["68. repeated empty search is 400 repeated_query_key", "search=&search="],
    ] as const) {
      await check(name, async () => {
        const client = await loginAs(staffByRole.get("crm_admin")!.email);
        const reply = await client.request("GET", `/api/crm/v1/users?${qs}`);
        assert.equal(reply.status, 400, `${qs} should be 400`);
        assert.equal(reply.body.code, "invalid_input");
        assert.equal(reply.body.messageKey, "crm.users.repeated_query_key");
      });
    }

    /* ========================================= OWNER: projection shape ==== */

    await check("69. assigned learner projects exactly { owner: { displayName } }", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      const item = itemsOf(reply).find((i) => i.userId === String(ownedA.id));
      assert.ok(item, "owned learner missing");
      assert.ok(item.owner, "owner should not be null for an assigned learner");
      assert.deepEqual(Object.keys(item.owner).sort(), ["displayName"]);
      assert.equal(item.owner.displayName, managerProfile.displayName);
    });

    await check("70. pristine (no row) learner has owner null", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      // learnerIds[0] was never given an owner row.
      const item = itemsOf(reply).find((i) => i.userId === String(learnerIds[0]));
      assert.ok(item, "pristine learner missing");
      assert.equal(item.owner, null);
    });

    await check("71. persisted ownerId=null learner has owner null", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      const item = itemsOf(reply).find((i) => i.userId === String(persistedNull.id));
      assert.ok(item, "persisted-null learner missing");
      assert.equal(item.owner, null);
    });

    await check("72. a blocked current owner remains visible with its live name", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      const item = itemsOf(reply).find((i) => i.userId === String(blockedOwnerLearner.id));
      assert.ok(item?.owner, "blocked owner should still project");
      assert.equal(item.owner.displayName, "Blocked Owner Name");
    });

    await check("73. a role-ineligible current owner remains visible", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      const item = itemsOf(reply).find((i) => i.userId === String(ineligOwnerLearner.id));
      assert.ok(item?.owner, "ineligible owner should still project");
      assert.equal(item.owner.displayName, "Ineligible Owner Name");
    });

    await check("74. a live owner displayName change is reflected (never snapshotted)", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const before = await client.request("GET", "/api/crm/v1/users?limit=100");
      const b = itemsOf(before).find((i) => i.userId === String(ineligOwnerLearner.id));
      assert.equal(b?.owner?.displayName, "Ineligible Owner Name");
      await prisma.staffProfile.update({ where: { id: ineligOwnerProfile.id }, data: { displayName: "Renamed Owner Live" } });
      const after = await client.request("GET", "/api/crm/v1/users?limit=100");
      const a = itemsOf(after).find((i) => i.userId === String(ineligOwnerLearner.id));
      assert.equal(a?.owner?.displayName, "Renamed Owner Live");
      // restore
      await prisma.staffProfile.update({ where: { id: ineligOwnerProfile.id }, data: { displayName: "Ineligible Owner Name" } });
    });

    await check("75. no owner internal leaks in an owner-bearing response", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
      // The internal ownerId (a cuid) must never appear in the wire body.
      for (const id of [managerProfile.id, supportProfile.id, blockedOwnerProfile.id, ineligOwnerProfile.id]) {
        assert.ok(!reply.text.includes(id), `internal ownerId leaked: ${id}`);
      }
      for (const banned of ["employeeId", "ownerId", "ownerVersion", "staffRole", "\"version\""]) {
        assert.ok(!reply.text.includes(banned), `owner internal leaked: ${banned}`);
      }
      // No owner email either: the owner staff addresses must not appear.
      for (const owEmail of ["owner-blocked@example.com", "owner-inelig@example.com", "staff-support@example.com"]) {
        assert.ok(!reply.text.includes(owEmail), `owner email leaked: ${owEmail}`);
      }
    });

    await check("76. a blank current-owner display name fails closed (safe 500), never a placeholder", async () => {
      // Build an isolated blank-name owner, prove the 500, then remove it so the
      // rest of the dataset stays clean.
      const blankUser = await prisma.user.create({ data: { email: "owner-blank@example.com", name: "Owner Blank User", role: "support", passwordHash: hash } });
      const blankProfile = await prisma.staffProfile.create({ data: { userId: blankUser.id, displayName: "   ", staffRole: "support" } });
      const blankLearner = await prisma.user.create({ data: { email: "has-blank-owner@example.test", name: "Zzz Blank Owner Learner", role: "user", passwordHash: hash, createdAt: new Date("2026-05-01T00:00:00.000Z") } });
      await prisma.crmUserOwner.create({ data: { userId: blankLearner.id, ownerId: blankProfile.id, version: 1 } });
      try {
        const client = await loginAs(staffByRole.get("crm_admin")!.email);
        // Target just this learner via a unique name search so only its page 500s.
        const reply = await client.request("GET", "/api/crm/v1/users?search=Zzz%20Blank%20Owner%20Learner");
        assert.equal(reply.status, 500, `expected 500, got ${reply.status}`);
        assert.equal(reply.body.code, "internal");
        assert.ok(!reply.text.includes("Неизвестный"), "must not fabricate a placeholder");
        for (const marker of ["prisma", "SELECT", "/tmp/", ".db", blankProfile.id]) {
          assert.ok(!reply.text.includes(marker), `leaked ${marker}`);
        }
      } finally {
        await prisma.crmUserOwner.delete({ where: { userId: blankLearner.id } });
        await prisma.user.delete({ where: { id: blankLearner.id } });
        await prisma.staffProfile.delete({ where: { id: blankProfile.id } });
        await prisma.user.delete({ where: { id: blankUser.id } });
      }
    });

    /* ============================================ OWNER: mine filter ===== */

    await check("77. owner=mine returns exactly the actor's learners", async () => {
      const client = await loginAs(staffByRole.get("crm_manager")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100&owner=mine");
      assert.equal(reply.status, 200);
      const ids = new Set(itemsOf(reply).map((i) => i.userId));
      assert.deepEqual([...ids].sort(), [String(ownedA.id), String(ownedB.id)].sort());
      // Someone else's learner is never in my book.
      assert.ok(!ids.has(String(ownedByOther.id)));
    });

    await check("78. owner=mine is actor-scoped, not global (a non-owning actor gets [])", async () => {
      const client = await loginAs(staffByRole.get("analyst")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100&owner=mine");
      assert.equal(reply.status, 200);
      assert.deepEqual(itemsOf(reply), []);
      assert.equal(reply.body.nextCursor, null);
    });

    await check("79. owner=mine is empty for another valid StaffProfile owning nothing", async () => {
      const client = await loginAs(staffByRole.get("read_only")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?owner=mine");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, 0);
    });

    /* ======================================= OWNER: unassigned filter ==== */

    await check("80. owner=unassigned includes rowless + persisted-null, excludes assigned", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100&owner=unassigned");
      assert.equal(reply.status, 200);
      const ids = new Set(itemsOf(reply).map((i) => i.userId));
      assert.ok(ids.has(String(learnerIds[0])), "rowless pristine learner missing from unassigned");
      assert.ok(ids.has(String(persistedNull.id)), "persisted-null learner missing from unassigned");
      for (const id of assignedLearnerIds) {
        assert.ok(!ids.has(id), `assigned learner ${id} leaked into unassigned`);
      }
      assert.equal(itemsOf(reply).length, unassignedExpected);
      // Every returned row genuinely has owner null.
      for (const item of itemsOf(reply)) assert.equal(item.owner, null);
    });

    await check("81. owner=mine + owner=unassigned partition the assigned/unassigned sets", async () => {
      const client = await loginAs(staffByRole.get("crm_manager")!.email);
      const mine = await walkAll(client, "owner=mine");
      const unassigned = await walkAll(client, "owner=unassigned");
      // No learner is both mine and unassigned.
      const overlap = mine.filter((id) => unassigned.includes(id));
      assert.deepEqual(overlap, []);
      assert.equal(unassigned.length, unassignedExpected);
    });

    /* ========================================= OWNER: authorization ====== */

    await check("82. all nine StaffRoles may use every owner filter value (200)", async () => {
      for (const role of CRM_STAFF_ROLES) {
        const client = await loginAs(staffByRole.get(role)!.email);
        for (const value of ["all", "mine", "unassigned"]) {
          const reply = await client.request("GET", `/api/crm/v1/users?owner=${value}`);
          assert.equal(reply.status, 200, `${role} owner=${value} -> ${reply.status}`);
          assert.ok(Array.isArray(reply.body.items));
        }
      }
    });

    await check("83. all nine StaffRoles see the owner projection on an assigned learner", async () => {
      for (const role of CRM_STAFF_ROLES) {
        const client = await loginAs(staffByRole.get(role)!.email);
        const reply = await client.request("GET", "/api/crm/v1/users?limit=100");
        const item = itemsOf(reply).find((i) => i.userId === String(ownedA.id));
        assert.ok(item?.owner, `${role} did not see owner`);
        assert.equal(item.owner.displayName, managerProfile.displayName);
      }
    });

    await check("84. assign_owner grants no extra filter capability (manager vs analyst identical availability)", async () => {
      const manager = await loginAs(staffByRole.get("crm_manager")!.email); // has assign_owner
      const analyst = await loginAs(staffByRole.get("analyst")!.email); // no assign_owner
      for (const value of ["all", "mine", "unassigned"]) {
        assert.equal((await manager.request("GET", `/api/crm/v1/users?owner=${value}`)).status, 200);
        assert.equal((await analyst.request("GET", `/api/crm/v1/users?owner=${value}`)).status, 200);
      }
    });

    /* ============================== OWNER: composition & preservation ==== */

    await check("85. search composes with owner=mine (AND)", async () => {
      const client = await loginAs(staffByRole.get("crm_manager")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?owner=mine&search=Owned%20Alpha");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, 1);
      assert.equal(itemsOf(reply)[0].userId, String(ownedA.id));
      // A search that matches only someone else's learner returns nothing.
      const none = await client.request("GET", "/api/crm/v1/users?owner=mine&search=Owned%20Other");
      assert.deepEqual(itemsOf(none), []);
    });

    await check("86. search composes with owner=unassigned (AND)", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?owner=unassigned&search=Persisted%20Null");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, 1);
      assert.equal(itemsOf(reply)[0].userId, String(persistedNull.id));
    });

    await check("87. email masking is unchanged under an owner filter", async () => {
      const client = await loginAs(staffByRole.get("support")!.email); // no full-email
      const reply = await client.request("GET", "/api/crm/v1/users?owner=all&limit=100");
      assert.equal(reply.status, 200);
      for (const item of itemsOf(reply)) assert.equal(item.email.visibility, "masked");
      // full-email role still gets full addresses with a filter present.
      const admin = await loginAs(staffByRole.get("crm_admin")!.email);
      const full = await admin.request("GET", "/api/crm/v1/users?owner=unassigned&limit=100");
      assert.ok(itemsOf(full).some((i) => i.email.visibility === "full"));
    });

    await check("88. unauthorized email-shaped search is still refused with an owner filter present", async () => {
      const client = await loginAs(staffByRole.get("support")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?owner=mine&search=learner05%40example.test");
      assert.equal(reply.status, 400);
      assert.equal(reply.body.code, "invalid_input");
      assert.ok(!reply.text.includes("learner05@example.test"));
    });

    await check("89. owner-filtered responses keep Cache-Control: no-store and a requestId", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?owner=unassigned");
      assert.ok(String(reply.headers.get("cache-control") ?? "").includes("no-store"));
      assert.ok(String(reply.headers.get("x-request-id") ?? "").length > 0);
    });

    await check("90. exactly one prisma.user.findMany application call (no N+1)", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "users.ts"), "utf8");
      const matches = source.match(/prisma\.user\.findMany\(/g) ?? [];
      assert.equal(matches.length, 1, `expected 1 findMany, found ${matches.length}`);
      // The owner relation is projected inline, not fetched per row.
      assert.ok(!/crmUserOwner\.findMany|crmUserOwner\.findUnique/.test(source), "owner is fetched separately (N+1)");
    });

    /* ================= OWNER x SEARCH x CURSOR: where composition ========= */
    // Regression for the real defect: the final Prisma `where` was assembled by
    // spreading fragments, so owner=unassigned (a top-level OR) and search (a
    // top-level OR) collided — the later key silently overwrote the earlier one,
    // dropping the owner predicate. The clauses must compose as an AND, never
    // overwrite. Each check below fails on the pre-fix key-overwrite build.

    await check("91. owner=unassigned + search matching ONLY an assigned learner returns empty", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      // "Owned Other" is owned by support (assigned). Under unassigned it must vanish.
      const reply = await client.request("GET", "/api/crm/v1/users?owner=unassigned&search=Owned%20Other");
      assert.equal(reply.status, 200);
      assert.deepEqual(itemsOf(reply), [], "assigned learner leaked into owner=unassigned+search");
      assert.equal(reply.body.nextCursor, null);
    });

    await check("92. owner=unassigned + search matching a rowless pristine learner returns that learner", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?owner=unassigned&search=Learner%2000");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, 1);
      assert.equal(itemsOf(reply)[0].userId, String(learnerIds[0]));
      assert.equal(itemsOf(reply)[0].owner, null);
    });

    await check("93. owner=unassigned + search matching a persisted-null learner returns that learner", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?owner=unassigned&search=Persisted%20Null");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, 1);
      assert.equal(itemsOf(reply)[0].userId, String(persistedNull.id));
      assert.equal(itemsOf(reply)[0].owner, null);
    });

    await check("94. owner=unassigned + search matching BOTH assigned and unassigned returns only the unassigned", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      // "Kappa Shared" spans compAssigned (assigned), compRowless + compPersistedNull (unassigned).
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100&owner=unassigned&search=Kappa%20Shared");
      assert.equal(reply.status, 200);
      const ids = new Set(itemsOf(reply).map((i) => i.userId));
      assert.deepEqual([...ids].sort(), [String(compRowless.id), String(compPersistedNull.id)].sort());
      assert.ok(!ids.has(String(compAssigned.id)), "assigned learner leaked into unassigned+search");
      for (const item of itemsOf(reply)) assert.equal(item.owner, null);
    });

    await check("95. owner=mine + search returns only the actor's matching learners", async () => {
      // crm_manager owns exactly ownedA/ownedB. "Owned" also matches ownedByOther
      // (support's), which owner=mine must exclude — proving the owner predicate
      // ANDs with search rather than being overwritten by it.
      const client = await loginAs(staffByRole.get("crm_manager")!.email);
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100&owner=mine&search=Owned");
      assert.equal(reply.status, 200);
      const ids = new Set(itemsOf(reply).map((i) => i.userId));
      assert.deepEqual([...ids].sort(), [String(ownedA.id), String(ownedB.id)].sort());
      assert.ok(!ids.has(String(ownedByOther.id)), "someone else's learner leaked into mine");
    });

    await check("96. owner=all + search preserves normal search behaviour", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const expected = await prisma.user.count({ where: { role: "user", name: { contains: "Owned" } } });
      const reply = await client.request("GET", "/api/crm/v1/users?limit=100&owner=all&search=Owned");
      assert.equal(reply.status, 200);
      assert.equal(itemsOf(reply).length, expected);
      const ids = new Set(itemsOf(reply).map((i) => i.userId));
      assert.deepEqual(
        [...ids].sort(),
        [String(ownedA.id), String(ownedB.id), String(ownedByOther.id)].sort(),
      );
    });

    await check("97. owner omitted + search matches owner=all + search exactly", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      const omitted = await client.request("GET", "/api/crm/v1/users?limit=100&search=Owned");
      const all = await client.request("GET", "/api/crm/v1/users?limit=100&owner=all&search=Owned");
      assert.equal(omitted.status, 200);
      assert.deepEqual(
        itemsOf(omitted).map((i) => i.userId),
        itemsOf(all).map((i) => i.userId),
      );
    });

    await check("98. owner=unassigned + search + cursor: all predicates compose across pages, no assigned, no dup/gap", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      // "Learner" matches learnerIds[0..11] + "Plain Learner" — all unassigned.
      const matching = await prisma.user.findMany({
        where: { role: "user", name: { contains: "Learner" } },
        select: { id: true },
      });
      const expected = new Set(
        matching.map((m) => String(m.id)).filter((id) => !assignedLearnerIds.has(id)),
      );
      const seen = await walkAll(client, "owner=unassigned&search=Learner");
      assert.equal(seen.length, expected.size, `expected ${expected.size} unassigned matches, saw ${seen.length}`);
      assert.deepEqual(new Set(seen), expected);
      for (const id of assignedLearnerIds) {
        assert.ok(!seen.includes(id), `assigned learner ${id} leaked into unassigned+search+cursor`);
      }
    });

    await check("99. owner=mine + search + cursor: all predicates compose across pages", async () => {
      // support owns ownedByOther ("Owned Other", matches) and Sigma Book (mine but
      // NOT a search match, dated just below ownedByOther). limit=1 forces cursor
      // paging: a pre-fix build drops the search predicate on page 2 and leaks
      // Sigma Book. Only ownedByOther may survive owner=mine AND search.
      const client = await loginAs(staffByRole.get("support")!.email);
      const seen = await walkAll(client, "owner=mine&search=Owned", 1);
      assert.deepEqual(new Set(seen), new Set([String(ownedByOther.id)]));
      assert.ok(!seen.includes(String(mineNoMatch.id)), "non-matching mine learner leaked across paged mine+search");
      assert.ok(!seen.includes(String(ownedA.id)), "other actor's learner leaked across paged mine+search");
    });

    await check("100. both independent OR groups survive: owner=unassigned OR-branches + search OR both apply (with cursor)", async () => {
      const client = await loginAs(staffByRole.get("crm_admin")!.email);
      // "Kappa Shared" search OR must AND with the owner OR whose TWO branches are
      // rowless (compRowless) and persisted-null (compPersistedNull). Both branches
      // must appear; the assigned Kappa (compAssigned) must not. Walked with a
      // cursor so the cursor OR is simultaneously in play (limit=1 forces paging).
      const seen = await walkAll(client, "owner=unassigned&search=Kappa%20Shared", 1);
      assert.deepEqual(new Set(seen), new Set([String(compRowless.id), String(compPersistedNull.id)]));
      assert.ok(seen.includes(String(compRowless.id)), "rowless owner-OR branch dropped");
      assert.ok(seen.includes(String(compPersistedNull.id)), "persisted-null owner-OR branch dropped");
      assert.ok(!seen.includes(String(compAssigned.id)), "assigned learner leaked past AND composition");
      // Structural guard: the service composes with an enclosing AND, not a
      // top-level spread that lets one OR overwrite another.
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "users.ts"), "utf8");
      assert.ok(/where:\s*\{\s*AND:/.test(source), "final where is not composed as an enclosing AND");
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
