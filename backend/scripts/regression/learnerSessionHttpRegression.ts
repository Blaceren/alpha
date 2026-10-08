/**
 * H-7 over real HTTP.
 *
 * The store matrix drives the module; the wiring assertions read the routes.
 * Neither watches a browser-shaped exchange, and this contract change is too
 * large to sign off on either. So this boots the Backend on an isolated port
 * against an isolated database with migration 54 applied, and speaks to the
 * real /api/auth routes the way a browser would.
 *
 * NOTHING LIVE IS TOUCHED. Its own database file, its own port, synthetic users
 * only. The live PREPROD database is never opened.
 *
 * NO TOKEN OR COOKIE VALUE IS EVER PRINTED. Assertions are on names, attributes
 * and status codes; where a value must be compared, it is compared, not shown.
 */
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = 3980 + (process.pid % 40);
const baseUrl = `http://127.0.0.1:${port}`;
const dbPath = `/tmp/ata-session-http-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const SESSION_SECRET = "http-integration-secret-http-integration-secret";
const PASSWORD = "Correct-Horse-9!";

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
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

/* `next dev` must not inherit a NODE_ENV from this process, and this project's
   ProcessEnv type declares it required — so the child's environment is built as
   a plain record rather than as a ProcessEnv it would have to lie about. */
const { NODE_ENV: _ignoredNodeEnv, ...inheritedEnv } = process.env;
const baseEnv: Record<string, string | undefined> = {
  ...inheritedEnv,
  DATABASE_URL: dbUrl,
  SESSION_SECRET,
  POSTBACK_SECRET: "http-integration-postback",
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};

async function start(): Promise<ChildProcess> {
  /* No --turbopack: this workspace's node_modules is a symlink farm and
     Turbopack cannot resolve the Next package through it. */
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    /* Cast at the boundary: this project's ProcessEnv declares NODE_ENV
       required, and the whole point here is to start the child without one. */
    env: baseEnv as NodeJS.ProcessEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (v) => { logs += String(v); });
  child.stderr?.on("data", (v) => { logs += String(v); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return child; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-2500)}`);
}

async function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 1500));
}

/** Cookie jar keyed by name; values are held, never printed. */
type Jar = Map<string, string>;
function applySetCookie(jar: Jar, response: Response): string[] {
  const raw = response.headers.getSetCookie?.() ?? [];
  const seen: string[] = [];
  for (const line of raw) {
    const name = line.slice(0, line.indexOf("="));
    const value = line.slice(line.indexOf("=") + 1, line.indexOf(";") === -1 ? undefined : line.indexOf(";"));
    seen.push(line);
    if (value === "" || /Max-Age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return seen;
}
function cookieHeader(jar: Jar): string {
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function main() {
  cleanup();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: baseEnv as NodeJS.ProcessEnv, encoding: "utf8" },
  );
  assert.equal(migration.status, 0, `migration failed:\n${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");
  const email = `http-${process.pid}@example.test`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(PASSWORD, 10), name: "HTTP", role: "user", emailVerifiedAt: new Date() },
  });

  let server: ChildProcess | null = null;
  try {
    server = await start();

    // Every mutation needs the CSRF pair; the contract is unchanged by H-7.
    async function csrf(jar: Jar): Promise<string> {
      const response = await fetch(`${baseUrl}/api/csrf`, { headers: { cookie: cookieHeader(jar) } });
      applySetCookie(jar, response);
      const body = (await response.json()) as { csrfToken?: string };
      return String(body.csrfToken);
    }

    async function login(
      jar: Jar,
      who: { email: string; userAgent?: string } = { email },
    ): Promise<{ status: number; setCookie: string[] }> {
      const token = await csrf(jar);
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": token,
          cookie: cookieHeader(jar),
          ...(who.userAgent ? { "user-agent": who.userAgent } : {}),
        },
        body: JSON.stringify({ email: who.email, password: PASSWORD }),
      });
      return { status: response.status, setCookie: applySetCookie(jar, response) };
    }

    const SESSION = "__Host-trading_platform_session";
    const hashOf = (jar: Jar) => createHash("sha256").update(jar.get(SESSION) ?? "", "utf8").digest("hex");
    const rowOf = async (jar: Jar) => prisma.userSession.findUnique({ where: { tokenHash: hashOf(jar) } });
    const liveCount = () => prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });

    type ListedSession = {
      id: string;
      current: boolean;
      signedInAt: string;
      lastSeenAt: string;
      device: { browser: string | null; os: string | null; kind: string | null };
    };
    async function listSessions(jar: Jar): Promise<{ status: number; sessions: ListedSession[]; raw: string }> {
      const response = await fetch(`${baseUrl}/api/auth/sessions`, { headers: { cookie: cookieHeader(jar) }, cache: "no-store" });
      const raw = await response.text();
      const body = response.ok ? (JSON.parse(raw) as { sessions: ListedSession[] }) : { sessions: [] };
      return { status: response.status, sessions: body.sessions, raw };
    }
    async function closeSession(jar: Jar, id: string, withCsrf = true): Promise<number> {
      // The CSRF pair first: fetching it sets its cookie in the jar, which the request must carry.
      const csrfToken = withCsrf ? await csrf(jar) : null;
      const headers: Record<string, string> = { cookie: cookieHeader(jar) };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      const response = await fetch(`${baseUrl}/api/auth/sessions/${id}`, { method: "DELETE", headers });
      return response.status;
    }

    async function sessionStatus(jar: Jar) {
      const response = await fetch(`${baseUrl}/api/auth/session-status`, {
        headers: { cookie: cookieHeader(jar) }, cache: "no-store",
      });
      return (await response.json()) as { authenticated: boolean; blocked: boolean; role: string | null };
    }

    const first: Jar = new Map();

    await check("H1. login sets the __Host- cookie with every required attribute", async () => {
      // Seed the legacy cookie first, so the clearing below is observable.
      first.set("trading_platform_session", "a-legacy-value");
      const { status, setCookie } = await login(first);
      assert.equal(status, 200, `login returned ${status}`);
      const line = setCookie.find((c) => c.startsWith("__Host-trading_platform_session="));
      assert.ok(line, "no __Host- session cookie was set");
      const attrs = line!.slice(line!.indexOf(";") + 1);
      assert.match(attrs, /HttpOnly/i);
      assert.match(attrs, /Secure/i);
      assert.match(attrs, /SameSite=Strict/i);
      assert.match(attrs, /Path=\/(;|$)/i);
      assert.ok(!/Domain=/i.test(attrs), "a __Host- cookie must carry no Domain");
    });

    /* ORDER MATTERS HERE, and the reason is the feature. A third login closes
       the session unused the longest, so a case that logs in again can
       invalidate the jar an earlier case is still holding. H3 therefore runs
       immediately after H1, before anything else authenticates as this user. */
    await check("H3. session-status accepts the new session and reports the role", async () => {
      const status = await sessionStatus(first);
      assert.equal(status.authenticated, true);
      assert.equal(status.blocked, false);
      assert.equal(status.role, "user");
    });

    await check("H2. login expires the legacy cookie", async () => {
      const line = (await (async () => {
        const jar: Jar = new Map([["trading_platform_session", "another-legacy-value"]]);
        const { setCookie } = await login(jar);
        return setCookie;
      })()).find((c) => c.startsWith("trading_platform_session="));
      assert.ok(line, "login did not touch the legacy cookie");
      assert.match(line!, /Max-Age=0/i);
    });

    const firstToken = first.get("__Host-trading_platform_session")!;

    /* TWO LIVE SESSIONS (owner 2026-10-07). H4a–H4f replace H-7's «a second
       login revokes the first». */
    const second: Jar = new Map();
    await check("H4a. a second browser signs in alongside the first — both work, two rows live", async () => {
      await prisma.userSession.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { tokenHash: hashOf(first) } },
        data: { revokedAt: new Date() },
      });
      const iphone =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
      const { status } = await login(second, { email, userAgent: iphone });
      assert.equal(status, 200);
      assert.notEqual(second.get(SESSION), firstToken);
      assert.equal((await sessionStatus(first)).authenticated, true, "the second login closed the first");
      assert.equal((await sessionStatus(second)).authenticated, true, "the second session does not work");
      assert.equal(await liveCount(), 2);
    });

    await check("H4b. each browser lists both sessions, itself marked current, named by device, with no secret in the answer", async () => {
      const fromSecond = await listSessions(second);
      assert.equal(fromSecond.status, 200);
      assert.equal(fromSecond.sessions.length, 2);
      const mine = fromSecond.sessions.filter((row) => row.current);
      assert.equal(mine.length, 1, "not exactly one session is marked current");
      assert.equal(mine[0]!.id, (await rowOf(second))!.id);
      assert.deepEqual(mine[0]!.device, { browser: "Safari", os: "iPhone", kind: "phone" });
      for (const value of [first.get(SESSION)!, second.get(SESSION)!, hashOf(first), hashOf(second)]) {
        assert.ok(!fromSecond.raw.includes(value), "a token or its hash is in the list");
      }
      assert.ok(!/userAgent|tokenHash|Mozilla/.test(fromSecond.raw), "the raw description or the hash is in the list");
      const fromFirst = await listSessions(first);
      assert.equal(fromFirst.sessions.find((row) => row.current)?.id, (await rowOf(first))!.id);
    });

    await check("H4c. the second browser closes the first — the first is a stranger at once", async () => {
      const firstId = (await rowOf(first))!.id;
      assert.equal(await closeSession(second, firstId, false), 403, "a close without CSRF was accepted");
      assert.equal((await sessionStatus(first)).authenticated, true, "a refused close still closed");
      assert.equal(await closeSession(second, firstId), 200);
      assert.equal((await sessionStatus(first)).authenticated, false, "the closed session still works");
      assert.equal((await sessionStatus(second)).authenticated, true, "closing the other closed this one");
      assert.equal(await closeSession(second, firstId), 404, "closing twice did not answer «not found»");
      assert.equal(await closeSession(second, (await rowOf(second))!.id), 409, "a session closed itself here");
      assert.equal(await closeSession(second, "not-a-session-id!"), 404);
      assert.equal(await liveCount(), 1);
    });

    const third: Jar = new Map();
    const fourth: Jar = new Map();
    await check("H4d. a third sign-in closes the session unused the longest, and the audit says so", async () => {
      await login(third);
      assert.equal(await liveCount(), 2);
      // The second browser was last used an hour ago, the third just now.
      await prisma.userSession.update({ where: { id: (await rowOf(second))!.id }, data: { lastSeenAt: new Date(Date.now() - 3_600_000) } });
      const evictedId = (await rowOf(second))!.id;
      await login(fourth);
      assert.equal(await liveCount(), 2);
      assert.equal((await sessionStatus(second)).authenticated, false, "the session unused the longest survived");
      assert.equal((await sessionStatus(third)).authenticated, true, "the recently used session was closed");
      assert.equal((await sessionStatus(fourth)).authenticated, true);
      const audit = await prisma.auditLog.findFirst({ where: { action: "AUTH_SESSION_EVICTED", entityId: evictedId } });
      assert.ok(audit, "the eviction was not recorded");
    });

    await check("H4e. another account cannot see or close this account's sessions", async () => {
      const otherEmail = `http-other-${process.pid}@example.test`;
      await prisma.user.create({
        data: { email: otherEmail, passwordHash: await bcrypt.hash(PASSWORD, 10), name: "Other", role: "user", emailVerifiedAt: new Date() },
      });
      const stranger: Jar = new Map();
      assert.equal((await login(stranger, { email: otherEmail })).status, 200);
      const theirs = await listSessions(stranger);
      assert.equal(theirs.sessions.length, 1, "another account sees more than its own session");
      const target = (await rowOf(third))!.id;
      assert.equal(await closeSession(stranger, target), 404, "another account closed this account's session");
      assert.equal((await sessionStatus(third)).authenticated, true);
    });

    await check("H4f. signed out, the list and the close are refused", async () => {
      const nobody: Jar = new Map();
      assert.equal((await listSessions(nobody)).status, 401);
      assert.equal(await closeSession(nobody, (await rowOf(third))!.id), 401);
      assert.equal((await sessionStatus(third)).authenticated, true);
    });

    const active: Jar = new Map();
    await check("H5. logout revokes the record on the server", async () => {
      await login(active);
      const token = active.get("__Host-trading_platform_session")!;
      const csrfToken = await csrf(active);
      const response = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { "x-csrf-token": csrfToken, cookie: cookieHeader(active) },
      });
      assert.equal(response.status, 200);
      const lines = applySetCookie(active, response);
      assert.ok(lines.some((c) => c.startsWith("__Host-trading_platform_session=") && /Max-Age=0/i.test(c)));
      assert.ok(lines.some((c) => c.startsWith("trading_platform_session=") && /Max-Age=0/i.test(c)));

      const row = await prisma.userSession.findUnique({
        where: { tokenHash: createHash("sha256").update(token, "utf8").digest("hex") },
      });
      assert.ok(row?.revokedAt, "logout left this session's row live");
      assert.ok((await liveCount()) <= 1, "logout left two live rows");

      // The copied token, replayed exactly as an attacker would.
      const replay = await sessionStatus(new Map([["__Host-trading_platform_session", token]]));
      assert.equal(replay.authenticated, false, "a token copied before logout still works");
    });

    await check("H6. logging out again is safe", async () => {
      const jar: Jar = new Map();
      await login(jar);
      const csrfToken = await csrf(jar);
      const headers = { "x-csrf-token": csrfToken, cookie: cookieHeader(jar) };
      const one = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers });
      const two = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers });
      assert.equal(one.status, 200);
      assert.equal(two.status, 200, "the second logout errored");
    });

    await check("H7. a legacy stateless token is refused", async () => {
      const legacy = `${user.id}.user.${Date.now() + 600_000}.` + "0".repeat(64);
      for (const name of ["trading_platform_session", "__Host-trading_platform_session"]) {
        const status = await sessionStatus(new Map([[name, legacy]]));
        assert.equal(status.authenticated, false, `${name} accepted a stateless token`);
      }
    });

    await check("H8. a random and a malformed token are refused", async () => {
      for (const value of ["deadbeef", "x".repeat(400), "1.2.3.4"]) {
        const status = await sessionStatus(new Map([["__Host-trading_platform_session", value]]));
        assert.equal(status.authenticated, false);
      }
    });

    await check("H9. CSRF still rejects a mutation without the header", async () => {
      const jar: Jar = new Map();
      await login(jar);
      const without = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST", headers: { cookie: cookieHeader(jar) },
      });
      assert.notEqual(without.status, 200, "logout succeeded with no CSRF token");
      const mismatched = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST", headers: { "x-csrf-token": "not-the-cookie", cookie: cookieHeader(jar) },
      });
      assert.notEqual(mismatched.status, 200, "logout succeeded with a mismatched CSRF token");
      // And the session is untouched by the refusals.
      assert.equal((await sessionStatus(jar)).authenticated, true);
    });

    await check("H10. no raw token is stored, and none appears in the server log", async () => {
      const jar: Jar = new Map();
      await login(jar);
      const token = jar.get("__Host-trading_platform_session")!;
      const rows = await prisma.userSession.findMany();
      for (const row of rows) assert.notEqual(row.tokenHash, token, "the raw token is in the database");
      assert.ok(!JSON.stringify(rows).includes(token), "the raw token appears in a row");
      assert.ok(!logs.includes(token), "the raw token appears in the server log");
    });

    /* ------------------------------------------- the 2026-10-07 audit, over HTTP */

    async function postJson(
      route: string,
      jar: Jar,
      body: unknown,
      extra: Record<string, string> = {},
    ): Promise<Response> {
      const token = await csrf(jar);
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token, cookie: cookieHeader(jar), ...extra },
        body: JSON.stringify(body),
      });
      applySetCookie(jar, response);
      return response;
    }
    const signIn = (jar: Jar, ip: string, password = PASSWORD, who = email, extra: Record<string, string> = {}) =>
      postJson("/api/auth/login", jar, { email: who, password }, { "x-forwarded-for": ip, ...extra });
    async function logoutFrom(jar: Jar, ip: string): Promise<number> {
      const token = await csrf(jar);
      const response = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { "x-csrf-token": token, cookie: cookieHeader(jar), "x-forwarded-for": ip },
      });
      applySetCookie(jar, response);
      return response.status;
    }

    await check("H12. signing in again in one browser replaces its own session — the other device stays signed in", async () => {
      await prisma.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      const laptop: Jar = new Map();
      const phone: Jar = new Map();
      assert.equal((await signIn(laptop, "203.0.113.12")).status, 200);
      assert.equal((await signIn(phone, "203.0.113.13")).status, 200);
      // The phone was used least recently: the old rule would have closed it.
      await prisma.userSession.update({ where: { id: (await rowOf(phone))!.id }, data: { lastSeenAt: new Date(Date.now() - 3_600_000) } });
      const oldLaptop = laptop.get(SESSION)!;
      const evictionsBefore = await prisma.auditLog.count({ where: { action: "AUTH_SESSION_EVICTED", userId: user.id } });
      assert.equal((await signIn(laptop, "203.0.113.12")).status, 200);
      assert.notEqual(laptop.get(SESSION), oldLaptop, "no new session was issued");
      assert.equal((await sessionStatus(phone)).authenticated, true, "signing in again on the laptop signed the phone out");
      assert.equal((await sessionStatus(laptop)).authenticated, true);
      assert.equal((await sessionStatus(new Map([[SESSION, oldLaptop]]))).authenticated, false, "the laptop's old session is still live");
      assert.equal(await liveCount(), 2);
      const evictionsAfter = await prisma.auditLog.count({ where: { action: "AUTH_SESSION_EVICTED", userId: user.id } });
      assert.equal(evictionsAfter, evictionsBefore, "an eviction was recorded for a replacement");
    });

    await check("H13. sign-ins that succeed are never refused by the limit", async () => {
      const jar: Jar = new Map();
      for (let i = 0; i < 7; i += 1) {
        const response = await signIn(jar, "203.0.113.21");
        assert.equal(response.status, 200, `sign-in ${i + 1} answered ${response.status}`);
      }
    });

    await check("H14. five wrong passwords stop that address and email — not another address", async () => {
      const jar: Jar = new Map();
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await signIn(jar, "203.0.113.31", "Wrong-password-1")).status, 401, `wrong password ${i + 1}`);
      }
      assert.equal((await signIn(jar, "203.0.113.31")).status, 429, "the sixth try was not refused");
      assert.equal((await signIn(new Map(), "203.0.113.32")).status, 200, "another address was refused too");
    });

    await check("H15. the right password clears the wrong ones before it", async () => {
      const jar: Jar = new Map();
      for (let round = 0; round < 2; round += 1) {
        for (let i = 0; i < 4; i += 1) {
          assert.equal((await signIn(jar, "203.0.113.41", "Wrong-password-1")).status, 401);
        }
        assert.equal((await signIn(jar, "203.0.113.41")).status, 200, `round ${round + 1}: the right password was refused`);
      }
    });

    await check("H16. the CRM's form signs in staff only — a learner gets no session at all", async () => {
      const before = await prisma.userSession.count({ where: { userId: user.id } });
      const jar: Jar = new Map();
      const response = await signIn(jar, "203.0.113.51", PASSWORD, email, { "x-ata-auth-surface": "crm_login" });
      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as { error?: string }).error, "NOT_STAFF");
      assert.equal(jar.get(SESSION), undefined, "a session cookie was set for a learner on the CRM form");
      assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), before, "a session row was created");

      const staffEmail = `http-staff-${process.pid}@example.test`;
      const staff = await prisma.user.create({
        data: { email: staffEmail, passwordHash: await bcrypt.hash(PASSWORD, 10), name: "Staff", role: "support", emailVerifiedAt: new Date() },
      });
      await prisma.staffProfile.create({ data: { userId: staff.id, displayName: "Staff", staffRole: "crm_manager" } });
      const staffJar: Jar = new Map();
      const ok = await signIn(staffJar, "203.0.113.52", PASSWORD, staffEmail, { "x-ata-auth-surface": "crm_login" });
      assert.equal(ok.status, 200, "staff could not sign in on the CRM form");
      assert.ok(staffJar.get(SESSION), "staff got no session");
    });

    await check("H17. a logout is never refused — past the per-address limit it still ends the session", async () => {
      for (let i = 0; i < 22; i += 1) {
        assert.equal(await logoutFrom(new Map(), "203.0.113.61"), 200, `logout ${i + 1} was refused`);
      }
      const jar: Jar = new Map();
      assert.equal((await signIn(jar, "203.0.113.62")).status, 200);
      const token = jar.get(SESSION)!;
      assert.equal(await logoutFrom(jar, "203.0.113.61"), 200);
      assert.equal((await sessionStatus(new Map([[SESSION, token]]))).authenticated, false, "the session outlived its logout");
    });

    await check("H18. a block ends every session — lifting it brings none back", async () => {
      const adminEmail = `http-admin-${process.pid}@example.test`;
      await prisma.user.create({
        data: { email: adminEmail, passwordHash: await bcrypt.hash(PASSWORD, 10), name: "Admin", role: "admin", emailVerifiedAt: new Date() },
      });
      const admin: Jar = new Map();
      assert.equal((await signIn(admin, "203.0.113.71", PASSWORD, adminEmail)).status, 200);
      const learner: Jar = new Map();
      assert.equal((await signIn(learner, "203.0.113.72")).status, 200);
      const learnerToken = learner.get(SESSION)!;
      const patch = async (status: "blocked" | "active") => {
        const token = await csrf(admin);
        const response = await fetch(`${baseUrl}/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-csrf-token": token, cookie: cookieHeader(admin) },
          body: JSON.stringify({ status }),
        });
        return response.status;
      };
      assert.equal(await patch("blocked"), 200);
      assert.equal(await patch("active"), 200);
      assert.equal(
        (await sessionStatus(new Map([[SESSION, learnerToken]]))).authenticated,
        false,
        "a session from before the block works again after it",
      );
      assert.equal(await liveCount(), 0, "the block left a live session");
      // Unblocked, the account signs in as usual.
      assert.equal((await signIn(new Map(), "203.0.113.73")).status, 200);
    });

    await check("H19. a password past bcrypt's 72 bytes is refused when it is set, plainly", async () => {
      const jar: Jar = new Map();
      const response = await postJson("/api/auth/register", jar, {
        email: `http-long-${process.pid}@example.test`,
        password: "пароль".repeat(7),
        name: "Long",
      });
      assert.equal(response.status, 400);
      assert.match(await response.text(), /72/);
    });

    await check("H11. the database never holds more than two live rows for this user", async () => {
      const live = await liveCount();
      assert.ok(live >= 1 && live <= 2, `${live} live rows`);
    });
  } finally {
    await stop(server);
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => { console.error(error); failed += 1; })
  .finally(() => {
    cleanup();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
