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

    async function login(jar: Jar): Promise<{ status: number; setCookie: string[] }> {
      const token = await csrf(jar);
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token, cookie: cookieHeader(jar) },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      return { status: response.status, setCookie: applySetCookie(jar, response) };
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

    /* ORDER MATTERS HERE, and the reason is the feature. Every login revokes
       whatever that user had, so a case that logs in again invalidates the jar
       an earlier case is still holding. H3 therefore runs immediately after H1,
       before anything else authenticates as this user. */
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

    await check("H4. a second login revokes the first", async () => {
      const second: Jar = new Map();
      const { status } = await login(second);
      assert.equal(status, 200);
      const secondToken = second.get("__Host-trading_platform_session")!;
      assert.notEqual(secondToken, firstToken);

      // The first browser still holds its cookie and is now a stranger.
      const stale = await sessionStatus(new Map([["__Host-trading_platform_session", firstToken]]));
      assert.equal(stale.authenticated, false, "the first session survived the second login");

      const live = await sessionStatus(second);
      assert.equal(live.authenticated, true, "the second session does not work");

      const rows = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
      assert.equal(rows, 1);
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

      const live = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
      assert.equal(live, 0, "logout left a live session row");

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

    await check("H11. the database still holds exactly one live row for this user", async () => {
      const live = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
      assert.equal(live, 1);
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
