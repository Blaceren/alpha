import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { CRM_PERMISSIONS, CRM_STAFF_ROLES, STAFF_ROLE_PERMISSIONS, resolveEffectivePermissions } from "../../src/lib/crm/roles";
import { crmUserNoteItemSchema, crmUserNotesResponseSchema } from "../../src/lib/crm/schemas";
import {
  assertCanCreateNotes,
  assertCanListNotes,
  CRM_NOTES_MAX_BODY_CODE_POINTS,
  CrmUserNotesForbiddenError,
  encodeNotesCursor,
  normalizeNoteBody,
} from "../../src/lib/crm/user-notes";
import { EXPECTED_MIGRATION_COUNT, expectedPriorMigrationCount } from "./support/migrationCount";

// Real HTTP regression for GET/POST /api/crm/v1/users/[userId]/notes. Isolated
// next dev server against a throwaway /tmp SQLite database. No deployed
// database, no runtime database, no external service, no persistent process.
const dbPath = `/tmp/ata-crm-user-notes-${process.pid}.db`;
const upgradeDbPath = `/tmp/ata-crm-user-notes-upgrade-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3900 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "CrmNotes123!";
const SESSION_SECRET = "crm-user-notes-regression-secret";
const SESSION_COOKIE = "trading_platform_session";

/** Roles the accepted matrix grants both Notes permissions. */
const NOTES_ROLES = ["crm_admin", "crm_manager", "retention_manager", "support"] as const;

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
  POSTBACK_SECRET: "crm-notes-postback-secret",
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
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
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
    const migration = runMigrations(baseEnv);
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);

    // --- staff (one per StaffRole) -----------------------------------------
    const staffByRole = new Map<string, { email: string; userId: number; employeeId: string }>();
    for (const role of CRM_STAFF_ROLES) {
      const email = `staff-${role}@example.com`;
      const user = await prisma.user.create({
        data: { email, name: `Staff ${role}`, role: "admin", passwordHash: hash },
      });
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, displayName: `Staff ${role}`, staffRole: role },
      });
      staffByRole.set(role, { email, userId: user.id, employeeId: profile.id });
    }

    // Learner with no StaffProfile -> 403 on CRM endpoints.
    await prisma.user.create({
      data: { email: "plain-learner@example.com", name: "Plain Learner", role: "user", passwordHash: hash },
    });

    // Staff account blocked mid-test -> 401.
    const blocked = await prisma.user.create({ data: { email: "blocked-staff@example.com", name: "Blocked Staff", role: "support", passwordHash: hash } });
    const blockedProfile = await prisma.staffProfile.create({ data: { userId: blocked.id, displayName: "Blocked Staff", staffRole: "crm_admin" } });

    // --- targets ------------------------------------------------------------
    const target = await prisma.user.create({
      data: { email: "target-learner@example.test", name: "Target Learner", role: "user", passwordHash: hash },
    });
    const emptyLearner = await prisma.user.create({
      data: { email: "empty-learner@example.test", name: "Empty Learner", role: "user", passwordHash: hash },
    });
    const pageLearner = await prisma.user.create({
      data: { email: "page-learner@example.test", name: "Page Learner", role: "user", passwordHash: hash },
    });
    const staffTarget = staffByRole.get("crm_admin")!.userId;
    const newsEditor = await prisma.user.create({
      data: { email: "news@example.test", name: "News Editor", role: "news_editor", passwordHash: hash },
    });

    const notesUrl = (id: string | number) => `/api/crm/v1/users/${id}/notes`;
    const adminEmail = staffByRole.get("crm_admin")!.email;

    server = await start();

    /* --------------------------------------------------- 1-6 authentication */

    await check("1. unauthenticated GET is 401", async () => {
      const reply = await new Client().request("GET", notesUrl(target.id));
      assert.equal(reply.status, 401);
      assert.equal(reply.body.code, "unauthorized");
    });

    await check("2. unauthenticated POST is 401", async () => {
      const reply = await new Client().request("POST", notesUrl(target.id), { body: "x" });
      assert.equal(reply.status, 401);
    });

    await check("3. malformed session signature is 401", async () => {
      const client = new Client();
      client.setRawSession("1.admin.9999999999999.deadbeef");
      assert.equal((await client.request("GET", notesUrl(target.id))).status, 401);
    });

    await check("4. expired but correctly signed session is 401", async () => {
      const client = new Client();
      client.setRawSession(signToken(staffTarget, "admin", Date.now() - 60_000));
      assert.equal((await client.request("GET", notesUrl(target.id))).status, 401);
    });

    await check("5. blocked account is 401 on GET and POST", async () => {
      const client = await loginAs("blocked-staff@example.com");
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "blocked" } });
      assert.equal((await client.request("GET", notesUrl(target.id))).status, 401);
      assert.equal((await client.request("POST", notesUrl(target.id), { body: "x" })).status, 401);
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "active" } });
    });

    await check("6. authenticated user without a StaffProfile is 403", async () => {
      const client = await loginAs("plain-learner@example.com");
      assert.equal((await client.request("GET", notesUrl(target.id))).status, 403);
      assert.equal((await client.request("POST", notesUrl(target.id), { body: "x" })).status, 403);
    });

    /* ------------------------------------------------- 7-13 permission axis */

    await check("7. exactly four roles hold view_user_notes", () => {
      const holders = CRM_STAFF_ROLES.filter((r) => STAFF_ROLE_PERMISSIONS[r].includes("view_user_notes"));
      assert.deepEqual([...holders].sort(), [...NOTES_ROLES].sort());
    });

    await check("8. exactly four roles hold create_user_notes", () => {
      const holders = CRM_STAFF_ROLES.filter((r) => STAFF_ROLE_PERMISSIONS[r].includes("create_user_notes"));
      assert.deepEqual([...holders].sort(), [...NOTES_ROLES].sort());
    });

    await check("9. all nine roles: GET matches the accepted matrix exactly", async () => {
      for (const role of CRM_STAFF_ROLES) {
        const client = await loginAs(staffByRole.get(role)!.email);
        const reply = await client.request("GET", notesUrl(target.id));
        const allowed = (NOTES_ROLES as readonly string[]).includes(role);
        assert.equal(reply.status, allowed ? 200 : 403, `${role} GET got ${reply.status}`);
      }
    });

    await check("10. all nine roles: POST matches the accepted matrix exactly", async () => {
      for (const role of CRM_STAFF_ROLES) {
        const client = await loginAs(staffByRole.get(role)!.email);
        const reply = await client.request("POST", notesUrl(emptyLearner.id), { body: `note by ${role}` });
        const allowed = (NOTES_ROLES as readonly string[]).includes(role);
        assert.equal(reply.status, allowed ? 201 : 403, `${role} POST got ${reply.status}`);
      }
    });

    await check("11. the five non-notes roles hold neither permission", () => {
      for (const role of ["mentor", "moderator", "analyst", "content_manager", "read_only"] as const) {
        const perms = resolveEffectivePermissions(role);
        assert.ok(!perms.includes("view_user_notes"), `${role} must not view`);
        assert.ok(!perms.includes("create_user_notes"), `${role} must not create`);
      }
    });

    await check("12. the two checks are independent — view alone lists, create alone creates", () => {
      // Unit-level, so either permission can be held in isolation even though
      // the production matrix always grants them together.
      assertCanListNotes(["view_user_notes"]);
      assertCanCreateNotes(["create_user_notes"]);
      assert.throws(() => assertCanListNotes(["create_user_notes"]), CrmUserNotesForbiddenError);
      assert.throws(() => assertCanCreateNotes(["view_user_notes"]), CrmUserNotesForbiddenError);
    });

    await check("13. edit_user_notes alone grants neither GET nor POST", () => {
      assert.throws(() => assertCanListNotes(["edit_user_notes"]), CrmUserNotesForbiddenError);
      assert.throws(() => assertCanCreateNotes(["edit_user_notes"]), CrmUserNotesForbiddenError);
    });

    await check("14. reveal_pii / view_identity_full_email / view_audit grant nothing", () => {
      for (const perm of ["reveal_pii", "view_identity_full_email", "view_audit", "export", "assign_owner", "manage_settings", "view_exact_financials"] as const) {
        assert.throws(() => assertCanListNotes([perm]), CrmUserNotesForbiddenError, `${perm} must not list`);
        assert.throws(() => assertCanCreateNotes([perm]), CrmUserNotesForbiddenError, `${perm} must not create`);
      }
    });

    await check("15. UserRole never grants Notes access", async () => {
      // UserRole "admin" with StaffRole read_only -> no notes access at all.
      const axis = await prisma.user.create({ data: { email: "axis@example.com", name: "Axl Axis", role: "admin", passwordHash: hash } });
      await prisma.staffProfile.create({ data: { userId: axis.id, displayName: "Axl Axis", staffRole: "read_only" } });
      const client = await loginAs("axis@example.com");
      assert.equal((await client.request("GET", notesUrl(target.id))).status, 403);
      assert.equal((await client.request("POST", notesUrl(target.id), { body: "x" })).status, 403);
    });

    await check("16. a permission failure never names the role or permission", async () => {
      const client = await loginAs(staffByRole.get("analyst")!.email);
      const reply = await client.request("GET", notesUrl(target.id));
      assert.equal(reply.status, 403);
      assert.deepEqual(Object.keys(reply.body).sort(), ["code", "messageKey", "requestId"]);
      for (const leak of ["analyst", "view_user_notes", "create_user_notes", "edit_user_notes", "StaffRole", "permission"]) {
        assert.ok(!reply.text.includes(leak), `403 leaked ${leak}`);
      }
    });

    /* --------------------------------------------------- 17-22 learner gate */

    let notFoundReply: Reply;
    await check("17. nonexistent learner is 404", async () => {
      const client = await loginAs(adminEmail);
      notFoundReply = await client.request("GET", notesUrl(987654321));
      assert.equal(notFoundReply.status, 404);
      assert.equal(notFoundReply.body.code, "not_found");
    });

    await check("18. a staff account id returns an identical 404 (GET and POST)", async () => {
      const client = await loginAs(adminEmail);
      const get = await client.request("GET", notesUrl(staffTarget));
      assert.equal(get.status, 404);
      assert.deepEqual(get.body.messageKey, notFoundReply.body.messageKey);
      const post = await client.request("POST", notesUrl(staffTarget), { body: "x" });
      assert.equal(post.status, 404);
      assert.deepEqual(post.body.messageKey, notFoundReply.body.messageKey);
    });

    await check("19. a non-learner system account returns an identical 404", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", notesUrl(newsEditor.id));
      assert.equal(reply.status, 404);
      assert.equal(reply.body.messageKey, notFoundReply.body.messageKey);
    });

    await check("20. the 404 body reveals no account type or existence", async () => {
      const client = await loginAs(adminEmail);
      for (const id of [987654321, staffTarget, newsEditor.id]) {
        const reply = await client.request("GET", notesUrl(id));
        assert.deepEqual(Object.keys(reply.body).sort(), ["code", "messageKey", "requestId"]);
        for (const leak of ["admin", "news_editor", "staff", "StaffProfile", "@example.com", "@example.test"]) {
          assert.ok(!reply.text.includes(leak), `404 leaked ${leak}`);
        }
      }
    });

    await check("21. a hidden target never returns a fabricated empty list", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", notesUrl(staffTarget));
      assert.equal(reply.status, 404);
      assert.ok(!("items" in reply.body), "must not return items for a hidden target");
    });

    await check("22. the target learner needs no StaffProfile", async () => {
      assert.equal(await prisma.staffProfile.count({ where: { userId: target.id } }), 0);
      const client = await loginAs(adminEmail);
      assert.equal((await client.request("GET", notesUrl(target.id))).status, 200);
    });

    /* ------------------------------------------------ 23-30 path/query input */

    await check("23. malformed userIds are rejected with invalid_input", async () => {
      const client = await loginAs(adminEmail);
      for (const raw of ["0", "-1", "+1", "01", "1.5", "1e3", "NaN", "abc", "0x10", "99999999999999999999", "2147483648"]) {
        const reply = await client.request("GET", notesUrl(raw));
        assert.equal(reply.status, 400, `${raw} should be 400, got ${reply.status}`);
        assert.equal(reply.body.code, "invalid_input");
      }
    });

    await check("24. default limit is 25", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", notesUrl(pageLearner.id));
      assert.equal(reply.status, 200);
      assert.ok(Array.isArray(reply.body.items));
    });

    await check("25. limit bounds: 1 and 100 accepted, 0/101/fraction rejected", async () => {
      const client = await loginAs(adminEmail);
      for (const good of ["1", "100"]) {
        assert.equal((await client.request("GET", `${notesUrl(target.id)}?limit=${good}`)).status, 200, good);
      }
      for (const bad of ["0", "101", "-1", "1.5", "abc", "", "1e2", "01x"]) {
        const reply = await client.request("GET", `${notesUrl(target.id)}?limit=${bad}`);
        assert.equal(reply.status, 400, `limit=${bad} should be 400, got ${reply.status}`);
      }
    });

    await check("26. unknown query keys are rejected on GET", async () => {
      const client = await loginAs(adminEmail);
      for (const key of ["offset", "page", "total", "include", "expand", "fields", "search", "select", "sort", "visibility", "pinned"]) {
        const reply = await client.request("GET", `${notesUrl(target.id)}?${key}=1`);
        assert.equal(reply.status, 400, `${key} should be rejected`);
        assert.equal(reply.body.code, "invalid_input");
      }
    });

    await check("27. repeated query keys are rejected, never silently first-wins", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", `${notesUrl(target.id)}?limit=1&limit=100`);
      assert.equal(reply.status, 400);
      assert.equal(reply.body.code, "invalid_input");
    });

    await check("28. POST accepts no query parameters at all", async () => {
      const client = await loginAs(adminEmail);
      for (const key of ["limit", "cursor", "include", "anything"]) {
        const reply = await client.request("POST", `${notesUrl(target.id)}?${key}=1`, { body: "x" });
        assert.equal(reply.status, 400, `${key} should be rejected`);
      }
    });

    await check("29. malformed cursors are rejected", async () => {
      const client = await loginAs(adminEmail);
      const bad = [
        "",
        "!!!not-base64!!!",
        Buffer.from("not json", "utf8").toString("base64url"),
        Buffer.from(JSON.stringify({ v: 2, t: new Date().toISOString(), i: "x" }), "utf8").toString("base64url"),
        Buffer.from(JSON.stringify({ v: 1, t: "not-a-date", i: "x" }), "utf8").toString("base64url"),
        Buffer.from(JSON.stringify({ v: 1, t: new Date().toISOString(), i: "" }), "utf8").toString("base64url"),
        Buffer.from(JSON.stringify({ v: 1, t: new Date().toISOString() }), "utf8").toString("base64url"),
        Buffer.from(JSON.stringify({ v: 1, t: new Date().toISOString(), i: "x", extra: 1 }), "utf8").toString("base64url"),
      ];
      for (const raw of bad) {
        const reply = await client.request("GET", `${notesUrl(target.id)}?cursor=${encodeURIComponent(raw)}`);
        assert.equal(reply.status, 400, `cursor ${raw.slice(0, 24)} should be 400, got ${reply.status}`);
      }
    });

    await check("30. an over-long cursor is rejected before decoding", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", `${notesUrl(target.id)}?cursor=${"a".repeat(513)}`);
      assert.equal(reply.status, 400);
    });

    /* ------------------------------------------------ 31-40 body validation */

    await check("31. a valid note is created with 201", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("POST", notesUrl(target.id), { body: "Первая заметка" });
      assert.equal(reply.status, 201);
      assert.equal(reply.body.body, "Первая заметка");
      assert.ok(crmUserNoteItemSchema.safeParse(reply.body).success);
    });

    await check("32. surrounding whitespace is trimmed", () => {
      assert.equal(normalizeNoteBody("   hello   "), "hello");
      assert.equal(normalizeNoteBody("\n\n hello \n\n"), "hello");
    });

    await check("33. CRLF and lone CR normalize to LF", () => {
      assert.equal(normalizeNoteBody("a\r\nb"), "a\nb");
      assert.equal(normalizeNoteBody("a\rb"), "a\nb");
    });

    await check("34. internal newlines, tabs and spaces are preserved", async () => {
      assert.equal(normalizeNoteBody("a\n\nb\tc  d"), "a\n\nb\tc  d");
      const client = await loginAs(adminEmail);
      const reply = await client.request("POST", notesUrl(target.id), { body: "line1\r\nline2\ttabbed" });
      assert.equal(reply.status, 201);
      assert.equal(reply.body.body, "line1\nline2\ttabbed");
    });

    await check("35. blank bodies are rejected", async () => {
      const client = await loginAs(adminEmail);
      for (const body of ["", "   ", "\n\n", "\t", "\r\n", " "]) {
        const reply = await client.request("POST", notesUrl(target.id), { body });
        assert.equal(reply.status, 400, `${JSON.stringify(body)} should be 400`);
        assert.equal(reply.body.code, "invalid_input");
      }
    });

    await check("36. exactly 2000 code points accepted, 2001 rejected", async () => {
      const client = await loginAs(adminEmail);
      const ok = await client.request("POST", notesUrl(target.id), { body: "a".repeat(CRM_NOTES_MAX_BODY_CODE_POINTS) });
      assert.equal(ok.status, 201);
      const tooLong = await client.request("POST", notesUrl(target.id), { body: "a".repeat(CRM_NOTES_MAX_BODY_CODE_POINTS + 1) });
      assert.equal(tooLong.status, 400);
    });

    await check("37. astral characters count as one code point, not two units", async () => {
      // 2000 astral emoji = 4000 UTF-16 units but exactly 2000 code points.
      const body = "\u{1F600}".repeat(CRM_NOTES_MAX_BODY_CODE_POINTS);
      assert.equal(body.length, CRM_NOTES_MAX_BODY_CODE_POINTS * 2);
      assert.equal(normalizeNoteBody(body), body);
      const client = await loginAs(adminEmail);
      const reply = await client.request("POST", notesUrl(target.id), { body });
      assert.equal(reply.status, 201, "2000 astral code points must be accepted");
      const over = await client.request("POST", notesUrl(target.id), { body: "\u{1F600}".repeat(CRM_NOTES_MAX_BODY_CODE_POINTS + 1) });
      assert.equal(over.status, 400);
    });

    await check("38. NUL and forbidden control characters are rejected", async () => {
      const client = await loginAs(adminEmail);
      // NUL, BEL, VT, FF, ESC, DEL and a C1 control — each built from its code
      // point so the intent survives any file encoding.
      for (const cp of [0x00, 0x07, 0x0b, 0x0c, 0x1b, 0x7f, 0x85]) {
        const bad = `a${String.fromCodePoint(cp)}b`;
        const label = `U+${cp.toString(16).padStart(4, "0")}`;
        assert.throws(() => normalizeNoteBody(bad), /body_control_char/, `${label} must be rejected`);
        const reply = await client.request("POST", notesUrl(target.id), { body: bad });
        assert.equal(reply.status, 400, `${label} should be 400`);
      }
    });

    await check("39. nothing is truncated or silently repaired", () => {
      // A too-long body errors; it is never cut down to the limit.
      assert.throws(() => normalizeNoteBody("a".repeat(CRM_NOTES_MAX_BODY_CODE_POINTS + 1)), /body_too_long/);
      // A control character errors; it is never stripped out.
      assert.throws(() => normalizeNoteBody(`clean${String.fromCodePoint(0)}text`), /body_control_char/);
      // Newline and tab are the only permitted controls, and survive intact.
      assert.equal(normalizeNoteBody("a\nb\tc"), "a\nb\tc");
    });

    await check("40. unknown body keys, wrong types and malformed JSON are rejected", async () => {
      const client = await loginAs(adminEmail);
      const bad: unknown[] = [
        { body: "x", authorId: "emp_1" },
        { body: "x", authorDisplayName: "Someone Else" },
        { body: "x", createdAt: "2020-01-01T00:00:00.000Z" },
        { body: "x", visibility: "private" },
        { body: "x", pinned: true },
        { body: 42 },
        { body: null },
        { body: ["x"] },
        {},
        { note: "x" },
        [],
      ];
      for (const payload of bad) {
        const reply = await client.request("POST", notesUrl(target.id), payload);
        assert.equal(reply.status, 400, `${JSON.stringify(payload)} should be 400`);
        assert.equal(reply.body.code, "invalid_input");
      }
      const malformed = await client.request("POST", notesUrl(target.id), "{not json", { "content-type": "application/json" });
      assert.equal(malformed.status, 400);
    });

    await check("41. HTML and Markdown are stored verbatim, never interpreted", async () => {
      const client = await loginAs(adminEmail);
      const raw = "<script>alert(1)</script> **bold** <b>x</b>";
      const reply = await client.request("POST", notesUrl(target.id), { body: raw });
      assert.equal(reply.status, 201);
      assert.equal(reply.body.body, raw, "body must round-trip byte-for-byte");
    });

    /* ------------------------------------------------- 42-48 author identity */

    await check("42. authorDisplayName is the creating employee's current name", async () => {
      const client = await loginAs(staffByRole.get("support")!.email);
      const reply = await client.request("POST", notesUrl(target.id), { body: "by support" });
      assert.equal(reply.status, 201);
      assert.equal(reply.body.authorDisplayName, "Staff support");
    });

    await check("43. the author is taken from the session, never from the request", async () => {
      const client = await loginAs(staffByRole.get("support")!.email);
      // An attacker-supplied author is rejected outright (test 40); prove that
      // even the accepted path cannot be steered by a header.
      const reply = await client.request("POST", notesUrl(target.id), { body: "header spoof" }, {
        "x-author-id": staffByRole.get("crm_admin")!.employeeId,
        "x-employee-id": staffByRole.get("crm_admin")!.employeeId,
      });
      assert.equal(reply.status, 201);
      assert.equal(reply.body.authorDisplayName, "Staff support");
    });

    await check("44. a renamed employee changes the resolved name on existing notes", async () => {
      const client = await loginAs(adminEmail);
      const created = await client.request("POST", notesUrl(emptyLearner.id), { body: "rename probe" });
      assert.equal(created.status, 201);
      const profileId = staffByRole.get("crm_admin")!.employeeId;
      await prisma.staffProfile.update({ where: { id: profileId }, data: { displayName: "Renamed Admin" } });
      const listed = await client.request("GET", `${notesUrl(emptyLearner.id)}?limit=100`);
      const item = (listed.body.items as { body: string; authorDisplayName: string }[])
        .find((n) => n.body === "rename probe");
      assert.ok(item, "note not found");
      assert.equal(item.authorDisplayName, "Renamed Admin", "name resolves live, no snapshot");
      await prisma.staffProfile.update({ where: { id: profileId }, data: { displayName: "Staff crm_admin" } });
    });

    await check("45. no author display-name snapshot column exists", () => {
      const columns = spawnSync("sqlite3", [dbPath, "PRAGMA table_info('CrmUserNote');"], { encoding: "utf8" });
      if (columns.status === 0) {
        const names = columns.stdout.trim().split("\n").map((l) => l.split("|")[1]).sort();
        assert.deepEqual(names, ["authorId", "body", "createdAt", "id", "userId"]);
      }
    });

    await check("46. a note stays readable after its author is blocked", async () => {
      const client = await loginAs(adminEmail);
      const before = await client.request("POST", notesUrl(emptyLearner.id), { body: "authored before block" });
      assert.equal(before.status, 201);
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "blocked" } });
      const listed = await client.request("GET", `${notesUrl(emptyLearner.id)}?limit=100`);
      assert.equal(listed.status, 200);
      assert.ok((listed.body.items as unknown[]).length > 0);
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "active" } });
      void blockedProfile;
    });

    await check("47. blocked staff cannot create a note", async () => {
      const client = await loginAs("blocked-staff@example.com");
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "blocked" } });
      const reply = await client.request("POST", notesUrl(target.id), { body: "should not persist" });
      assert.equal(reply.status, 401);
      const found = await prisma.crmUserNote.count({ where: { body: "should not persist" } });
      assert.equal(found, 0, "blocked staff must not persist a note");
      await prisma.user.update({ where: { id: blocked.id }, data: { status: "active" } });
    });

    await check("48. author resolution uses one nested select, not an N+1", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "user-notes.ts"), "utf8");
      assert.ok(!source.includes("include:"), "must not use include");
      assert.ok(/author:\s*\{\s*select:\s*\{\s*displayName:\s*true\s*\}\s*\}/.test(source), "nested author select missing");
      // No staffProfile lookup exists at all -> no per-note author query.
      assert.ok(!/prisma\.staffProfile\./.test(source), "must not query StaffProfile separately");
      const queries = [...source.matchAll(/prisma\.\w+\.(findMany|findFirst|findUnique|create|count|aggregate)/g)];
      // Exactly: learner existence check, list findMany, create.
      assert.equal(queries.length, 3, `expected 3 Prisma calls, found ${queries.length}`);
    });

    /* ---------------------------------------------------- 49-56 pagination */

    await check("49. notes are ordered createdAt DESC", async () => {
      const client = await loginAs(adminEmail);
      for (let i = 0; i < 5; i += 1) {
        await prisma.crmUserNote.create({
          data: {
            userId: pageLearner.id,
            authorId: staffByRole.get("crm_admin")!.employeeId,
            body: `ordered ${i}`,
            createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
          },
        });
      }
      const reply = await client.request("GET", `${notesUrl(pageLearner.id)}?limit=100`);
      const dates = (reply.body.items as { createdAt: string }[]).map((n) => n.createdAt);
      assert.deepEqual([...dates], [...dates].sort().reverse(), "not createdAt DESC");
    });

    await check("50. id DESC breaks ties at an identical createdAt", async () => {
      const tie = new Date(Date.UTC(2026, 5, 5));
      for (let i = 0; i < 4; i += 1) {
        await prisma.crmUserNote.create({
          data: { userId: pageLearner.id, authorId: staffByRole.get("crm_admin")!.employeeId, body: `tie ${i}`, createdAt: tie },
        });
      }
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", `${notesUrl(pageLearner.id)}?limit=100`);
      const ties = (reply.body.items as { noteId: string; createdAt: string }[])
        .filter((n) => n.createdAt === tie.toISOString())
        .map((n) => n.noteId);
      assert.equal(ties.length, 4);
      assert.deepEqual([...ties], [...ties].sort().reverse(), "ties not id DESC");
    });

    await check("51. keyset pagination walks every note once, no gaps or duplicates", async () => {
      const client = await loginAs(adminEmail);
      const total = await prisma.crmUserNote.count({ where: { userId: pageLearner.id } });
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 50; guard += 1) {
        const url: string = `${notesUrl(pageLearner.id)}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const reply: Reply = await client.request("GET", url);
        assert.equal(reply.status, 200);
        seen.push(...(reply.body.items as { noteId: string }[]).map((n) => n.noteId));
        cursor = reply.body.nextCursor as string | null;
        if (cursor === null) break;
      }
      assert.equal(seen.length, total, `walked ${seen.length} of ${total}`);
      assert.equal(new Set(seen).size, total, "duplicate note across pages");
    });

    await check("52. nextCursor is null exactly at the end", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", `${notesUrl(pageLearner.id)}?limit=100`);
      assert.equal(reply.body.nextCursor, null);
    });

    await check("53. an empty learner returns an empty list and a null cursor", async () => {
      const fresh = await prisma.user.create({ data: { email: "no-notes@example.test", name: "No Notes", role: "user", passwordHash: hash } });
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", notesUrl(fresh.id));
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body, { items: [], nextCursor: null });
    });

    await check("54. a cursor cannot widen the requested limit", async () => {
      const client = await loginAs(adminEmail);
      const first = await client.request("GET", `${notesUrl(pageLearner.id)}?limit=1`);
      const cursor = String(first.body.nextCursor);
      const second = await client.request("GET", `${notesUrl(pageLearner.id)}?limit=1&cursor=${encodeURIComponent(cursor)}`);
      assert.equal((second.body.items as unknown[]).length, 1);
    });

    await check("55. a cursor from another learner cannot cross the userId filter", async () => {
      const client = await loginAs(adminEmail);
      const foreign = encodeNotesCursor(new Date(Date.UTC(2030, 0, 1)), "zzzz");
      const reply = await client.request("GET", `${notesUrl(emptyLearner.id)}?cursor=${encodeURIComponent(foreign)}`);
      assert.equal(reply.status, 200);
      for (const item of reply.body.items as { noteId: string }[]) {
        const row = await prisma.crmUserNote.findUnique({ where: { id: item.noteId }, select: { userId: true } });
        assert.equal(row?.userId, emptyLearner.id, "cursor leaked another learner's note");
      }
    });

    await check("56. no total/count field is exposed", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", notesUrl(pageLearner.id));
      assert.deepEqual(Object.keys(reply.body).sort(), ["items", "nextCursor"]);
      for (const banned of ["total", "totalCount", "count", "hasMore", "page", "offset"]) {
        assert.ok(!reply.text.includes(`"${banned}"`), `must not expose ${banned}`);
      }
    });

    /* ------------------------------------------------- 57-63 projection/privacy */

    await check("57. GET body matches the strict Zod schema exactly", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", notesUrl(target.id));
      const parsed = crmUserNotesResponseSchema.safeParse(reply.body);
      assert.ok(parsed.success, JSON.stringify(reply.body).slice(0, 400));
    });

    await check("58. each item has exactly the four contract keys", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", notesUrl(target.id));
      for (const item of reply.body.items as Record<string, unknown>[]) {
        assert.deepEqual(Object.keys(item).sort(), ["authorDisplayName", "body", "createdAt", "noteId"]);
      }
    });

    await check("59. POST returns the created note directly with the same four keys", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("POST", notesUrl(target.id), { body: "shape probe" });
      assert.equal(reply.status, 201);
      assert.deepEqual(Object.keys(reply.body).sort(), ["authorDisplayName", "body", "createdAt", "noteId"]);
      assert.ok(!("items" in reply.body), "POST must not wrap in an envelope");
    });

    await check("60. no employeeId or authorId appears anywhere in a response", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", `${notesUrl(target.id)}?limit=100`);
      for (const profile of staffByRole.values()) {
        assert.ok(!reply.text.includes(profile.employeeId), `leaked employeeId ${profile.employeeId}`);
      }
      for (const banned of ["employeeId", "authorId", "staffRole", "StaffRole", "effectivePermissions", "permissions", "permissionVersion"]) {
        assert.ok(!reply.text.includes(banned), `must not expose ${banned}`);
      }
    });

    await check("61. no learner or author email appears in a response", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", `${notesUrl(target.id)}?limit=100`);
      for (const address of ["target-learner@example.test", "staff-crm_admin@example.com", "staff-support@example.com", "@example.com", "@example.test"]) {
        assert.ok(!reply.text.includes(address), `leaked ${address}`);
      }
    });

    await check("62. no deferred note metadata is fabricated", async () => {
      const client = await loginAs(adminEmail);
      const reply = await client.request("GET", `${notesUrl(target.id)}?limit=100`);
      for (const banned of ["updatedAt", "deletedAt", "editedAt", "deletedBy", "version", "visibility", "pinned", "caseId", "capabilities", "canEdit", "canDelete", "mock", "audit", "ownerId", "team"]) {
        assert.ok(!reply.text.includes(banned), `must not expose ${banned}`);
      }
    });

    await check("63. full note text is returned untruncated", async () => {
      const client = await loginAs(adminEmail);
      const long = "Ф".repeat(1500);
      const created = await client.request("POST", notesUrl(emptyLearner.id), { body: long });
      assert.equal(created.status, 201);
      assert.equal(created.body.body, long);
      assert.equal(String(created.body.body).length, 1500);
    });

    /* --------------------------------------------- 64-70 immutability/scope */

    await check("64. the notes route exports only GET and POST", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "crm", "v1", "users", "[userId]", "notes", "route.ts"), "utf8");
      assert.ok(/export async function GET\b/.test(source));
      assert.ok(/export async function POST\b/.test(source));
      for (const verb of ["PUT", "PATCH", "DELETE"]) {
        assert.ok(!new RegExp(`export async function ${verb}\\b`).test(source), `${verb} must not exist`);
      }
    });

    await check("65. PUT/PATCH/DELETE fail safely over HTTP", async () => {
      const client = await loginAs(adminEmail);
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const reply = await client.request(method, notesUrl(target.id), {});
        assert.ok(reply.status === 405 || reply.status === 404, `${method} returned ${reply.status}`);
      }
    });

    await check("66. no individual-note or auxiliary notes route exists", () => {
      const notesDir = path.join(process.cwd(), "src", "app", "api", "crm", "v1", "users", "[userId]", "notes");
      assert.deepEqual(fs.readdirSync(notesDir).sort(), ["route.ts"]);
      for (const banned of ["[noteId]", "search", "bulk", "audit", "owner", "visibility", "pin", "[...slug]"]) {
        assert.ok(!fs.existsSync(path.join(notesDir, banned)), `unexpected route notes/${banned}`);
      }
    });

    await check("67. the Notes module contains no update or delete call", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "user-notes.ts"), "utf8");
      for (const op of ["update", "delete"]) {
        assert.ok(!new RegExp(`prisma\\.\\w+\\.${op}`).test(source), `must not call ${op}`);
      }
      assert.ok(!/upsert|deleteMany|updateMany/.test(source), "must not upsert or mass-mutate");
    });

    await check("68. Notes v1 writes no AuditLog record", async () => {
      const before = await prisma.auditLog.count();
      const client = await loginAs(adminEmail);
      assert.equal((await client.request("POST", notesUrl(target.id), { body: "audit probe" })).status, 201);
      assert.equal(await prisma.auditLog.count(), before, "Notes v1 must not write AuditLog");
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "crm", "user-notes.ts"), "utf8");
      // Code reference, not prose: the module documents that it writes no audit
      // record, so match an actual Prisma call rather than the word.
      assert.ok(!/prisma\.auditLog/.test(source), "Notes module must not write AuditLog");
    });

    await check("69. creating a note is the only side effect", async () => {
      const client = await loginAs(adminEmail);
      const users = await prisma.user.count();
      const profiles = await prisma.staffProfile.count();
      const notes = await prisma.crmUserNote.count();
      assert.equal((await client.request("POST", notesUrl(target.id), { body: "side effect probe" })).status, 201);
      assert.equal(await prisma.user.count(), users, "User rows changed");
      assert.equal(await prisma.staffProfile.count(), profiles, "StaffProfile rows changed");
      assert.equal(await prisma.crmUserNote.count(), notes + 1, "exactly one note expected");
    });

    await check("70. a stored note is never mutated by a later read", async () => {
      const client = await loginAs(adminEmail);
      const created = await client.request("POST", notesUrl(emptyLearner.id), { body: "immutable probe" });
      const noteId = String(created.body.noteId);
      const first = await prisma.crmUserNote.findUnique({ where: { id: noteId } });
      await client.request("GET", `${notesUrl(emptyLearner.id)}?limit=100`);
      const second = await prisma.crmUserNote.findUnique({ where: { id: noteId } });
      assert.deepEqual(second, first, "note row changed across a read");
    });

    /* ------------------------------------------ 71-75 request safety/errors */

    await check("71. every response is no-store with a matching X-Request-Id", async () => {
      const client = await loginAs(adminEmail);
      const replies = [
        await client.request("GET", notesUrl(target.id)),
        await client.request("POST", notesUrl(target.id), { body: "hdr probe" }),
        await client.request("GET", notesUrl(987654321)),
        await client.request("GET", notesUrl("abc")),
        await client.request("GET", `${notesUrl(target.id)}?offset=1`),
        await new Client().request("GET", notesUrl(target.id)),
        await (await loginAs(staffByRole.get("analyst")!.email)).request("GET", notesUrl(target.id)),
      ];
      for (const reply of replies) {
        assert.ok(String(reply.headers.get("cache-control") ?? "").includes("no-store"), `status ${reply.status} not no-store`);
        const header = String(reply.headers.get("x-request-id") ?? "");
        assert.ok(header.length > 0, `status ${reply.status} missing X-Request-Id`);
        assert.equal(reply.body.requestId ?? header, header, `status ${reply.status} requestId mismatch`);
      }
    });

    await check("72. every error uses exactly the three-key safe envelope", async () => {
      const client = await loginAs(adminEmail);
      for (const reply of [
        await client.request("GET", notesUrl("abc")),
        await client.request("GET", notesUrl(987654321)),
        await client.request("POST", notesUrl(target.id), { body: "" }),
        await new Client().request("GET", notesUrl(target.id)),
      ]) {
        assert.deepEqual(Object.keys(reply.body).sort(), ["code", "messageKey", "requestId"]);
        assert.ok(["invalid_input", "unauthorized", "not_found", "internal"].includes(String(reply.body.code)));
        assert.ok(String(reply.body.messageKey).length > 0);
      }
    });

    await check("73. messageKeys live under the crm.users.notes namespace", async () => {
      const client = await loginAs(adminEmail);
      for (const reply of [
        await client.request("GET", notesUrl(987654321)),
        await client.request("POST", notesUrl(target.id), { body: "" }),
        await client.request("GET", `${notesUrl(target.id)}?offset=1`),
      ]) {
        assert.match(String(reply.body.messageKey), /^crm\.users\.(notes|detail)\./);
      }
    });

    await check("74. no error path leaks SQL, stack, Prisma or a database path", async () => {
      const client = await loginAs(adminEmail);
      for (const reply of [
        await client.request("GET", notesUrl("abc")),
        await client.request("GET", notesUrl(987654321)),
        await client.request("POST", notesUrl(target.id), { body: "a".repeat(5000) }),
        await client.request("POST", notesUrl(target.id), "{bad", { "content-type": "application/json" }),
        await client.request("GET", `${notesUrl(target.id)}?cursor=%21%21%21`),
      ]) {
        for (const marker of ["SELECT", "prisma", "Prisma", "/tmp/", ".db", "at Object", "Error:", "node_modules", "sqlite", "ZodError", "invalid_type"]) {
          assert.ok(!reply.text.includes(marker), `leaked ${marker} (status ${reply.status})`);
        }
      }
    });

    await check("75. a rejected body is never echoed back to the caller", async () => {
      const client = await loginAs(adminEmail);
      const secret = "SENSITIVE-REJECTED-CONTENT-9182";
      const reply = await client.request("POST", notesUrl(target.id), { body: `${secret} ` });
      assert.equal(reply.status, 400);
      assert.ok(!reply.text.includes(secret), "rejected body echoed back");
    });

    /* ----------------------------------------------- 76-82 database proofs */

    await check("76. fresh database has exactly the canonical migration count", () => {
      const migrations = fs.readdirSync(path.join(process.cwd(), "prisma", "migrations"))
        .filter((entry) => entry !== "migration_lock.toml");
      assert.equal(migrations.length, EXPECTED_MIGRATION_COUNT, `expected ${EXPECTED_MIGRATION_COUNT} migrations, found ${migrations.length}`);
      assert.ok(migrations.includes("20260720000000_crm_user_note_foundation"));
    });

    await check("77. foreign_key_check is empty on the fresh database", () => {
      const fk = spawnSync("sqlite3", [dbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" });
      if (fk.status === 0) assert.equal(fk.stdout.trim(), "", `foreign_key_check reported ${fk.stdout}`);
    });

    await check("78. both CrmUserNote indexes exist", () => {
      const idx = spawnSync("sqlite3", [dbPath, "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='CrmUserNote' ORDER BY name;"], { encoding: "utf8" });
      if (idx.status === 0) {
        const names = idx.stdout.trim().split("\n").filter(Boolean);
        assert.ok(names.includes("CrmUserNote_userId_createdAt_id_idx"), `cursor index missing: ${names.join(",")}`);
        assert.ok(names.includes("CrmUserNote_authorId_idx"), `author index missing: ${names.join(",")}`);
      }
    });

    await check("79. deleting a learner that has notes is Restricted", async () => {
      await assert.rejects(
        () => prisma.user.delete({ where: { id: target.id } }),
        "deleting a learner with notes must be restricted",
      );
      assert.ok(await prisma.user.findUnique({ where: { id: target.id } }), "learner must survive");
    });

    await check("80. deleting an author StaffProfile that has notes is Restricted", async () => {
      const authorId = staffByRole.get("support")!.employeeId;
      assert.ok(await prisma.crmUserNote.count({ where: { authorId } }) > 0, "fixture must have authored notes");
      await assert.rejects(
        () => prisma.staffProfile.delete({ where: { id: authorId } }),
        "deleting an author with notes must be restricted",
      );
      assert.ok(await prisma.staffProfile.findUnique({ where: { id: authorId } }), "author must survive");
    });

    await check("81. rerunning the migration runner is idempotent", () => {
      const rerun = runMigrations(baseEnv);
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
      const fk = spawnSync("sqlite3", [dbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" });
      if (fk.status === 0) assert.equal(fk.stdout.trim(), "");
    });

    await check("82. migration 31 is additive only", () => {
      const sql = fs.readFileSync(
        path.join(process.cwd(), "prisma", "migrations", "20260720000000_crm_user_note_foundation", "migration.sql"),
        "utf8",
      );
      assert.ok(/CREATE TABLE "CrmUserNote"/.test(sql));
      assert.ok(/ON DELETE RESTRICT/.test(sql));
      assert.ok(/ON UPDATE CASCADE/.test(sql));
      // Strip SQL comments first, so the prose above the DDL cannot mask or
      // trigger a match. "ON UPDATE CASCADE" is a legitimate FK clause, so the
      // row-mutation check looks for an UPDATE statement specifically.
      const statements = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
      for (const forbidden of ["DROP TABLE", "ALTER TABLE", "DELETE FROM", "INSERT INTO", "PRAGMA"]) {
        assert.ok(!statements.includes(forbidden), `migration must not contain ${forbidden}`);
      }
      assert.ok(!/\bUPDATE\s+"/.test(statements), "migration must not update existing rows");
      assert.ok(!/CREATE TABLE "new_/.test(statements), "migration must not rebuild a table");
    });

    await check("83. upgrading a 30-migration database preserves existing rows", () => {
      // Build a throwaway DB at the accepted 30-migration state by applying every
      // migration except Notes (31), the later Owner (32) foundation and the
      // Owner History (33) migration, seed representative rows, then let the
      // runner apply the pending migration(s).
      const upgradeUrl = `file:${upgradeDbPath}`;
      const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
      const applied = fs.readdirSync(migrationsDir)
        .filter(
          (e) =>
            e !== "migration_lock.toml" &&
            e !== "20260720000000_crm_user_note_foundation" &&
            e !== "20260721000000_crm_user_owner_foundation" &&
            e !== "20260723000000_crm_user_owner_history",
        )
        .sort();
      assert.equal(applied.length, expectedPriorMigrationCount(3), `expected ${expectedPriorMigrationCount(3)} prior migrations, found ${applied.length}`);

      // Apply the 30 prior migrations AND record them in the runner's
      // bookkeeping table, so the result is byte-faithful to a real database at
      // the accepted 30-migration state rather than a bare schema dump.
      const bookkeeping = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0);`;
      const init = spawnSync("sqlite3", [upgradeDbPath], { input: bookkeeping, encoding: "utf8" });
      assert.equal(init.status, 0, `bookkeeping init failed: ${init.stderr}`);

      for (const name of applied) {
        const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
        const run = spawnSync("sqlite3", [upgradeDbPath], { input: sql, encoding: "utf8" });
        assert.equal(run.status, 0, `migration ${name} failed: ${run.stderr}`);
        const checksum = crypto.createHash("sha256").update(sql).digest("hex");
        const record = spawnSync("sqlite3", [upgradeDbPath], {
          input: `INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","finished_at","applied_steps_count") VALUES ('${crypto.randomUUID()}','${checksum}','${name}',CURRENT_TIMESTAMP,1);`,
          encoding: "utf8",
        });
        assert.equal(record.status, 0, `bookkeeping for ${name} failed: ${record.stderr}`);
      }

      // The Notes table must not exist yet — this is the 30-migration state.
      const pre = spawnSync("sqlite3", [upgradeDbPath], {
        input: `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='CrmUserNote';`, encoding: "utf8",
      });
      assert.equal(pre.stdout.trim(), "0", "CrmUserNote must not exist before migration 31");

      // Representative pre-existing rows.
      const seed = `
        INSERT INTO "User" ("email","pendingEmail","referralCode","passwordHash","role","status","name","level","xp","createdAt","updatedAt")
        VALUES ('legacy@example.test',NULL,'legacy-ref','x','user','active','Legacy Learner',3,300,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "User" ("email","pendingEmail","referralCode","passwordHash","role","status","name","level","xp","createdAt","updatedAt")
        VALUES ('legacy-staff@example.test',NULL,'legacy-ref-2','x','admin','active','Legacy Staff',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "StaffProfile" ("id","userId","displayName","staffRole","permissionVersion","createdAt","updatedAt")
        VALUES ('legacy-emp-1',(SELECT id FROM "User" WHERE email='legacy-staff@example.test'),'Legacy Staff','crm_admin',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      `;
      const seeded = spawnSync("sqlite3", [upgradeDbPath], { input: seed, encoding: "utf8" });
      assert.equal(seeded.status, 0, `seed failed: ${seeded.stderr}`);

      const before = spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM "User"; SELECT count(*) FROM "StaffProfile";`, encoding: "utf8" });
      assert.equal(before.stdout.trim().split("\n").map((s) => s.trim()).join(","), "2,1");

      // Apply migration 31 through the repository runner.
      const upgrade = runMigrations({ ...baseEnv, DATABASE_URL: upgradeUrl });
      assert.equal(upgrade.status, 0, `${upgrade.stdout}\n${upgrade.stderr}`);
      assert.ok(
        upgrade.stdout.includes("Migration 20260720000000_crm_user_note_foundation applied."),
        "migration 31 was not applied",
      );
      assert.ok(
        !/Migration 20260[0-6]\d+_\w+ applied\./.test(upgrade.stdout),
        "an already-applied migration was re-run",
      );

      // Existing rows preserved untouched.
      const after = spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM "User"; SELECT count(*) FROM "StaffProfile"; SELECT name FROM "User" WHERE email='legacy@example.test';`, encoding: "utf8" });
      assert.equal(after.stdout.trim().split("\n").map((s) => s.trim()).join(","), "2,1,Legacy Learner");
    });

    await check("84. the upgraded database has a usable Notes table and clean keys", () => {
      const insert = `
        PRAGMA foreign_keys=ON;
        INSERT INTO "CrmUserNote" ("id","userId","authorId","body","createdAt")
        VALUES ('note-legacy-1',(SELECT id FROM "User" WHERE email='legacy@example.test'),'legacy-emp-1','upgraded note',CURRENT_TIMESTAMP);
        SELECT body FROM "CrmUserNote" WHERE id='note-legacy-1';
      `;
      const run = spawnSync("sqlite3", [upgradeDbPath], { input: insert, encoding: "utf8" });
      assert.equal(run.status, 0, `insert failed: ${run.stderr}`);
      assert.equal(run.stdout.trim(), "upgraded note");

      const fk = spawnSync("sqlite3", [upgradeDbPath], { input: "PRAGMA foreign_key_check;", encoding: "utf8" });
      assert.equal(fk.stdout.trim(), "", `foreign_key_check reported ${fk.stdout}`);

      // Re-running the upgrade must be a no-op.
      const rerun = runMigrations({ ...baseEnv, DATABASE_URL: `file:${upgradeDbPath}` });
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
      const still = spawnSync("sqlite3", [upgradeDbPath], { input: `SELECT count(*) FROM "CrmUserNote";`, encoding: "utf8" });
      assert.equal(still.stdout.trim(), "1", "idempotent rerun changed note rows");
    });

    await check("85. the runtime and deployed databases were never touched", () => {
      // This suite only ever addresses its own /tmp databases.
      const source = fs.readFileSync(path.join(process.cwd(), "scripts", "regression", "crmUserNotesRegression.ts"), "utf8");
      // Assembled at runtime so this check cannot match its own source literal.
      const runtimeMarker = ["/home/ubuntu", "runtime", "ata-dev-v1"].join("/");
      const otherDeployment = ["trading", "mvp"].join("-");
      assert.ok(!source.includes(runtimeMarker), "must not reference the runtime database");
      assert.ok(!source.includes(otherDeployment), "must not reference another deployment");
      // Every database this suite addresses is its own throwaway /tmp file.
      assert.ok(dbPath.startsWith("/tmp/") && upgradeDbPath.startsWith("/tmp/"));
      assert.equal(baseEnv.DATABASE_URL, `file:${dbPath}`);
    });

    /* --------------------------------------------- 86-88 permission contract */

    await check("86. the canonical permission list has exactly fourteen entries", () => {
      // AFD-5A appended view_affiliate_analytics. PHASE-G0 appended the three
      // curriculum-authoring permissions. What Notes v1 needs to stay true is
      // that ITS two permissions keep their positions, which the slice below
      // pins independently of the total.
      assert.equal(CRM_PERMISSIONS.length, 14);
      assert.deepEqual([...CRM_PERMISSIONS], [
        "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
        "export", "view_audit", "manage_settings", "edit_user_notes",
        "view_user_notes", "create_user_notes", "view_affiliate_analytics",
        "curriculum_read", "curriculum_author", "curriculum_approve",
      ]);
      assert.deepEqual(CRM_PERMISSIONS.slice(8, 10), ["view_user_notes", "create_user_notes"]);
    });

    await check("87. the accepted first eight keep their exact relative order", () => {
      assert.deepEqual(CRM_PERMISSIONS.slice(0, 8), [
        "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
        "export", "view_audit", "manage_settings", "edit_user_notes",
      ]);
    });

    await check("88. existing edit_user_notes assignments are unchanged", () => {
      const holders = CRM_STAFF_ROLES.filter((r) => STAFF_ROLE_PERMISSIONS[r].includes("edit_user_notes"));
      assert.deepEqual([...holders].sort(), ["crm_admin", "crm_manager", "retention_manager", "support"].sort());
    });

    await check("89. an unknown role still fails closed with no permissions", () => {
      assert.deepEqual(resolveEffectivePermissions("not_a_role"), []);
      assert.deepEqual(resolveEffectivePermissions(""), []);
    });

    await check("90. permissionVersion is untouched by this slice", async () => {
      const versions = await prisma.staffProfile.findMany({ select: { permissionVersion: true } });
      assert.ok(versions.length > 0);
      for (const row of versions) assert.equal(row.permissionVersion, 1, "permissionVersion must stay 1");
    });
  } finally {
    await stop(server);
    cleanup();
  }

  const leftovers = [dbPath, upgradeDbPath]
    .flatMap((base) => ["", "-journal", "-wal", "-shm"].map((s) => `${base}${s}`))
    .filter((file) => fs.existsSync(file));
  if (leftovers.length > 0) {
    failed += 1;
    console.error(`FAIL 91. temporary databases removed (leftovers: ${leftovers.join(", ")})`);
  } else {
    passed += 1;
    console.log("ok   91. temporary databases removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
