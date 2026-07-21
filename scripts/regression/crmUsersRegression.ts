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

type Item = {
  userId: string;
  displayName: string;
  email: { value: string; visibility: string };
  status: string;
  level: number;
  emailConfirmed: boolean;
  createdAt: string;
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

    const totalLearners = await prisma.user.count({ where: { role: "user" } });

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

    await check("10. each item has exactly the seven contract keys", () => {
      for (const item of itemsOf(adminReply)) {
        assert.deepEqual(
          Object.keys(item).sort(),
          ["createdAt", "displayName", "email", "emailConfirmed", "level", "status", "userId"],
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

    await check("14. no owner/notes/team/financial field is fabricated", () => {
      for (const banned of ["ownerId", "owner", "noteCount", "notes", "unread", "balance", "netDeposits", "bucket", "segment", "priority", "recommendation", "taskCount", "caseCount", "signals", "traderId", "clickId", "totalDeposits", "xp"]) {
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
      const profiles = await prisma.staffProfile.count();
      assert.equal(profiles, CRM_STAFF_ROLES.length + 1, "unexpected StaffProfile rows");
      for (const id of learnerIds) {
        assert.equal(await prisma.staffProfile.count({ where: { userId: id } }), 0);
      }
    });

    await check("46. migration count is 32 and foreign keys are clean", () => {
      const migrations = fs.readdirSync(path.join(process.cwd(), "prisma", "migrations"))
        .filter((entry) => entry !== "migration_lock.toml");
      assert.equal(migrations.length, 32, `expected 32 migrations, found ${migrations.length}`);
      const fk = spawnSync("sqlite3", [dbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" });
      if (fk.status === 0) assert.equal(fk.stdout.trim(), "", `foreign_key_check reported ${fk.stdout}`);
    });

    await check("47. rerunning the migration runner is idempotent", () => {
      const rerun = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], { env: baseEnv, encoding: "utf8" });
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
    });

    await check("48. CRM v1 exposes session, users and owner-candidates — no 360/audit route", () => {
      const crmV1 = path.join(process.cwd(), "src", "app", "api", "crm", "v1");
      assert.deepEqual(fs.readdirSync(crmV1).sort(), ["owner-candidates", "session", "users"]);
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
