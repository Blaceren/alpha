/**
 * AFD-3A3 — isolated end-to-end login, across all three applications.
 *
 * WHAT THIS PROVES THAT A UNIT TEST CANNOT
 * `loginTurnstileRegression.ts` proves the verifier's logic against injected
 * provider answers. This suite starts REAL servers — a Backend, an Academy and a
 * CRM — on explicit loopback ports against a DISPOSABLE copy of a fixture
 * database, and drives login over HTTP through the exact proxies a browser would
 * use, with real HTTPS round trips to Cloudflare's Siteverify endpoint.
 *
 * The properties that only exist end to end:
 *
 *   - the surface header is stamped by the fronting server and OVERWRITES
 *     whatever the browser sent, so a caller cannot choose which action pin
 *     applies to their token;
 *   - a request that reaches the login owner without a surface is refused with a
 *     configuration error rather than accepted unpinned;
 *   - the ingress-measured client IP survives BOTH hops, so two clients get two
 *     rate-limit buckets instead of sharing one;
 *   - the session cookie, the learner authorization, the CRM staff check and the
 *     blocked-account behaviour are exactly what they were.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE
 * Cross-ACTION rejection over HTTP. Cloudflare's testing keys mint a fixed
 * literal token that encodes nothing, so their Siteverify answer carries no
 * `action` at any time — there is no way to obtain a real token stamped
 * `crm_login` without a real Cloudflare site and a real browser. That property is
 * proven exhaustively against injected answers in `loginTurnstileRegression.ts`,
 * in all six directions. What IS proven here is the layer below it: that the
 * SURFACE a token will be judged against cannot be chosen by the caller.
 *
 * SAFETY
 *   - the database is a copy in a temp directory, never the live one;
 *   - every server runs on an explicit loopback port and is stopped by its exact
 *     process group, never by name matching;
 *   - no live account, session, service or runtime file is touched;
 *   - the only outbound requests are to Cloudflare's official Siteverify
 *     endpoint, with Cloudflare's own published testing secrets, supplied at run
 *     time. No secret value is committed here.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

import { AUTH_SURFACE_HEADER } from "../../src/lib/captcha/surface";

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
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

// ---------------------------------------------------------------------------
// Inputs. Every one is supplied at run time; nothing sensitive is committed.
// ---------------------------------------------------------------------------
const ACADEMY_ROOT = process.env.AFD3A3_ACADEMY_ROOT;
const CRM_ROOT = process.env.AFD3A3_CRM_ROOT;
const SOURCE_DB = process.env.AFD3A3_FIXTURE_DB ?? "/home/ubuntu/publicurl1-work/db/fixture.sqlite";
/** Cloudflare's published "always passes" testing secret. */
const SECRET_PASS = process.env.AFD3A3_TURNSTILE_TEST_SECRET;
/** Cloudflare's published "token already spent" testing secret. */
const SECRET_SPENT = process.env.AFD3A3_TURNSTILE_TEST_SECRET_SPENT;
/**
 * Cloudflare's published "always passes" testing SITE key.
 *
 * Public documentation rather than a credential, and the frontends' own test
 * doubles do commit it. It is taken from the environment here anyway, because
 * this repository's rule is that no Turnstile key VALUE of any kind appears in
 * Backend source — see `hasOfficialTestKeyShape`, which recognises the secrets
 * by shape for exactly that reason. Only the two login pages read it, and only
 * to render a widget this suite never solves in a browser.
 */
const TEST_SITE_KEY = process.env.AFD3A3_TURNSTILE_TEST_SITE_KEY;

/** The official Cloudflare dummy token. Public documentation, not a credential. */
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const LEARNER_EMAIL = "afd3a3-learner@example.invalid";
const STAFF_EMAIL = "afd3a3-staff@example.invalid";
const BLOCKED_EMAIL = "afd3a3-blocked@example.invalid";
const PASSWORD = "LoginTurnstile123!";

const dbPath = path.join(os.tmpdir(), `ata-afd3a3-login-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

// Explicit, distinct loopback ports. Chosen well away from 3010/3050/3100.
const BACKEND_PORT = 3410 + (process.pid % 6) * 10;
const ACADEMY_PORT = BACKEND_PORT + 1;
const CRM_PORT = BACKEND_PORT + 2;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const ACADEMY_URL = `http://127.0.0.1:${ACADEMY_PORT}`;
const CRM_URL = `http://127.0.0.1:${CRM_PORT}`;

// ---------------------------------------------------------------------------
// Process control. Exact pids only — never a name match, never pkill.
// ---------------------------------------------------------------------------
type Service = { name: string; child: ChildProcess; pid: number; port: number };
const services: Service[] = [];

async function portOwner(port: number): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  try {
    return execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function startService(
  name: string,
  cwd: string,
  port: number,
  env: Record<string, string>,
  healthPath: string,
): Promise<Service> {
  const owner = await portOwner(port);
  if (owner !== "") {
    // Refuse rather than adopt: a health check that silently passes against a
    // stale server produces a wall of results about the wrong process.
    throw new Error(`port ${port} is already bound before starting ${name}: ${owner}`);
  }

  const merged = { ...(process.env as Record<string, string>), ...env };
  delete (merged as Record<string, string | undefined>).NODE_ENV;
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd,
    env: merged as unknown as NodeJS.ProcessEnv,
    // Its own process group, so the stop below signals exactly this tree.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (v: Buffer) => { logs += String(v); });
  child.stderr?.on("data", (v: Buffer) => { logs += String(v); });

  const service: Service = { name, child, pid: child.pid ?? -1, port };
  services.push(service);

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${healthPath}`);
      if (res.status < 500) {
        console.log(`     ${name} up on 127.0.0.1:${port} (pid ${service.pid})`);
        return service;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${name} failed to start on ${port}\n${logs.slice(-3000)}`);
}

async function stopAll(): Promise<void> {
  for (const service of services.reverse()) {
    if (service.pid > 0) {
      try {
        // The exact process GROUP this suite created, identified by pid.
        process.kill(-service.pid, "SIGTERM");
      } catch { /* already gone */ }
    }
  }
  await new Promise((r) => setTimeout(r, 3000));
  for (const service of services) {
    if (service.pid > 0) {
      try { process.kill(-service.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
  for (const service of services) {
    const owner = await portOwner(service.port);
    console.log(`     ${service.name} pid ${service.pid} stopped; port ${service.port} ${owner === "" ? "FREE" : `STILL BOUND: ${owner}`}`);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers.
// ---------------------------------------------------------------------------
type Reply = { status: number; body: unknown; setCookie: string[] };

/**
 * A distinct synthetic client address per case.
 *
 * The Backend rate-limits login on (client IP, email) at 5 attempts per 10
 * minutes, and this suite logs the same learner in a dozen times. Without a
 * fresh address per case the sixth check would be answered 429 and every
 * assertion after it would be about the rate limiter rather than about the
 * thing it names. Giving each case its own address is not a way around the
 * limit — checks 20 to 22 exercise the limiter deliberately — it is how each
 * case gets a clean bucket, exactly as two real visitors would.
 */
let clientCounter = 0;
function freshClient(): Record<string, string> {
  clientCounter += 1;
  const address = `203.0.113.${clientCounter}`;
  // BOTH names, and the reason is the one AFD-3A documented: the Backend's
  // `getRequestIp` reads `x-forwarded-for` FIRST, and the Backend's own Next
  // server injects `x-forwarded-for: 127.0.0.1` for any request that arrives
  // without one. A direct-to-Backend call that sets only `x-real-ip` is
  // therefore attributed to 127.0.0.1 and shares ONE bucket with every other
  // direct call — which is exactly what the proxies exist to prevent, and
  // exactly what this suite tripped over before setting both.
  return { "x-real-ip": address, "x-forwarded-for": address };
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, body: parsed, setCookie };
}

function sessionCookieFrom(reply: Reply): string | null {
  const cookie = reply.setCookie.find((value) => value.startsWith("trading_platform_session="));
  if (!cookie) return null;
  const pair = cookie.split(";")[0];
  return pair && !pair.endsWith("=") ? pair : null;
}

function errorCode(body: unknown): string | null {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ["error", "code"]) {
      const value = record[key];
      if (typeof value === "string") return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------
async function seedAccounts() {
  process.env.DATABASE_URL = dbUrl;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const learner = await prisma.user.create({
    data: { email: LEARNER_EMAIL, name: "AFD-3A3 learner", passwordHash, role: "user" },
  });
  const staff = await prisma.user.create({
    data: { email: STAFF_EMAIL, name: "AFD-3A3 staff", passwordHash, role: "admin" },
  });
  await prisma.staffProfile.create({
    data: { userId: staff.id, staffRole: "crm_admin", displayName: "AFD-3A3 staff" },
  });
  const blocked = await prisma.user.create({
    data: {
      email: BLOCKED_EMAIL,
      name: "AFD-3A3 blocked",
      passwordHash,
      role: "admin",
      status: "blocked",
    },
  });
  await prisma.staffProfile.create({
    data: { userId: blocked.id, staffRole: "crm_admin", displayName: "AFD-3A3 blocked" },
  });

  await prisma.$disconnect();
  return { learnerId: learner.id, staffId: staff.id, blockedId: blocked.id };
}

function backendEnv(secret: string): Record<string, string> {
  return {
    DATABASE_URL: dbUrl,
    SESSION_SECRET: "afd3a3-synthetic-session-secret",
    POSTBACK_SECRET: "afd3a3-synthetic-postback-secret",
    APP_URL: "https://127.0.0.1",
    ATA_ENVIRONMENT: "dev",
    CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    STORAGE_DRIVER: "local",
    POCKET_AFFILIATE_BASE_URL: "https://example.invalid/ref",
    EMAIL_VERIFICATION_REQUIRED: "false",
    // The property under test: login verification ON, with the explicit
    // isolated-test provider and every one of its safeguards present.
    CAPTCHA_LOGIN_ENFORCED: "true",
    CAPTCHA_PROVIDER: "turnstile_test",
    CAPTCHA_TEST_MODE: "unsafe-official-turnstile-test-keys-isolated-only",
    TURNSTILE_SECRET_KEY: secret,
  };
}

async function main() {
  if (!ACADEMY_ROOT || !CRM_ROOT) {
    throw new Error("AFD3A3_ACADEMY_ROOT and AFD3A3_CRM_ROOT must name the candidate worktrees");
  }
  if (!SECRET_PASS || !SECRET_SPENT || !TEST_SITE_KEY) {
    throw new Error(
      "AFD3A3_TURNSTILE_TEST_SECRET, AFD3A3_TURNSTILE_TEST_SECRET_SPENT and AFD3A3_TURNSTILE_TEST_SITE_KEY must be supplied at run time",
    );
  }

  cleanupDb();
  fs.copyFileSync(SOURCE_DB, dbPath);
  const ids = await seedAccounts();
  console.log(`     disposable db ${dbPath}; learner ${ids.learnerId}, staff ${ids.staffId}, blocked ${ids.blockedId}`);

  await startService("backend", process.cwd(), BACKEND_PORT, backendEnv(SECRET_PASS), "/api/health");
  await startService("academy", ACADEMY_ROOT, ACADEMY_PORT, {
    ACADEMY_MODE: "api",
    BACKEND_ORIGIN: BACKEND_URL,
    TURNSTILE_SITE_KEY: TEST_SITE_KEY,
  }, "/login");
  await startService("crm", CRM_ROOT, CRM_PORT, {
    CRM_MODE: "api",
    CRM_BACKEND_ORIGIN: BACKEND_URL,
    TURNSTILE_SITE_KEY: TEST_SITE_KEY,
  }, "/login");

  const academyLogin = `${ACADEMY_URL}/api/backend/auth/login`;
  const crmLogin = `${CRM_URL}/api/crm/auth/login`;
  const backendLogin = `${BACKEND_URL}/api/auth/login`;

  // ======================================================= A. Academy login
  await check("1. a valid challenge and valid learner credentials log in", async () => {
    const reply = await post(
      academyLogin,
      { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.notEqual(sessionCookieFrom(reply), null, "no session cookie was issued");
  });

  await check("2. the issued session resolves the learner", async () => {
    const reply = await post(
      academyLogin,
      { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    const cookie = sessionCookieFrom(reply);
    assert.notEqual(cookie, null);

    const session = await fetch(`${ACADEMY_URL}/api/backend/auth/me`, {
      headers: { cookie: cookie as string },
    });
    assert.equal(session.status, 200);
    const body = (await session.json()) as { user?: { email?: string; role?: string } };
    assert.equal(body.user?.email, LEARNER_EMAIL);
    assert.equal(body.user?.role, "user");
  });

  await check("3. NO token is refused as a CAPTCHA failure, and issues no session", async () => {
    const reply = await post(
      academyLogin,
      { email: LEARNER_EMAIL, password: PASSWORD },
      freshClient(),
    );
    assert.equal(reply.status, 400);
    assert.equal(errorCode(reply.body), "CAPTCHA_FAILED");
    assert.equal(sessionCookieFrom(reply), null);
  });

  await check("4. an empty and a whitespace token are refused too", async () => {
    for (const token of ["", "   "]) {
      const reply = await post(
        academyLogin,
        { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: token },
        freshClient(),
      );
      assert.equal(reply.status, 400, `token ${JSON.stringify(token)} was accepted`);
      assert.equal(sessionCookieFrom(reply), null);
    }
  });

  await check("5. a wrong password fails without enumeration and without a session", async () => {
    const wrongPassword = await post(
      academyLogin,
      { email: LEARNER_EMAIL, password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    const unknownAccount = await post(
      academyLogin,
      { email: "afd3a3-nobody@example.invalid", password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
      freshClient(),
    );

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownAccount.status, 401);
    // Byte-identical: the endpoint must not reveal which of the two happened.
    assert.deepEqual(wrongPassword.body, unknownAccount.body);
    assert.equal(sessionCookieFrom(wrongPassword), null);
    assert.equal(sessionCookieFrom(unknownAccount), null);
  });

  // ============================================ B. the surface, over the wire
  await check("6. a browser-supplied surface header is OVERWRITTEN by the proxy", async () => {
    // If the proxy forwarded the caller's value, the Backend would resolve
    // `academy_register` on a login request, refuse it as a foreign purpose and
    // answer 503. A 200 is only possible if the proxy stamped its own.
    const reply = await post(
      academyLogin,
      { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      { [AUTH_SURFACE_HEADER]: "academy_register", ...freshClient() },
    );
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.notEqual(sessionCookieFrom(reply), null);
  });

  await check("7. the CRM proxy overwrites it too", async () => {
    const reply = await post(
      crmLogin,
      { email: STAFF_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      { [AUTH_SURFACE_HEADER]: "academy_login", ...freshClient() },
    );
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
  });

  await check("8. the login owner refuses a request that names NO surface", async () => {
    const reply = await post(
      backendLogin,
      { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    assert.equal(reply.status, 503, JSON.stringify(reply.body));
    assert.equal(errorCode(reply.body), "CAPTCHA_CONFIGURATION_ERROR");
    assert.equal(sessionCookieFrom(reply), null);
  });

  await check("9. the login owner refuses a surface belonging to another purpose", async () => {
    const reply = await post(
      backendLogin,
      { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      { [AUTH_SURFACE_HEADER]: "academy_register", ...freshClient() },
    );
    assert.equal(reply.status, 503);
    assert.equal(errorCode(reply.body), "CAPTCHA_CONFIGURATION_ERROR");
  });

  await check("10. an unknown surface name is refused, not guessed at", async () => {
    for (const surface of ["", "login", "ACADEMY_LOGIN", "academy", "__proto__"]) {
      const reply = await post(
        backendLogin,
        { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
        { [AUTH_SURFACE_HEADER]: surface, ...freshClient() },
      );
      assert.equal(reply.status, 503, `${JSON.stringify(surface)} was accepted`);
    }
  });

  await check("11. both login surfaces are accepted when named correctly", async () => {
    for (const surface of ["academy_login", "crm_login"]) {
      const reply = await post(
        backendLogin,
        { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
        { [AUTH_SURFACE_HEADER]: surface, ...freshClient() },
      );
      assert.equal(reply.status, 200, `${surface} was refused: ${JSON.stringify(reply.body)}`);
    }
  });

  // ==================================================== C. the CRM contract
  await check("12. CRM login succeeds for a crm_admin and bridges a session", async () => {
    const reply = await post(
      crmLogin,
      { email: STAFF_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(reply.body, { ok: true });
    assert.notEqual(sessionCookieFrom(reply), null);
  });

  await check("13. the bridged CRM session resolves the crm_admin role", async () => {
    const reply = await post(
      crmLogin,
      { email: STAFF_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    const cookie = sessionCookieFrom(reply) as string;
    const session = await fetch(`${BACKEND_URL}/api/crm/v1/session`, { headers: { cookie } });
    assert.equal(session.status, 200);
    const body = (await session.json()) as Record<string, unknown>;
    assert.equal(JSON.stringify(body).includes("crm_admin"), true, JSON.stringify(body));
  });

  await check("14. CRM login without a token is a CAPTCHA failure, not a credential one", async () => {
    const reply = await post(
      crmLogin,
      { email: STAFF_EMAIL, password: PASSWORD },
      freshClient(),
    );
    assert.equal(reply.status, 400);
    assert.equal(errorCode(reply.body), "captcha_failed");
    assert.equal(sessionCookieFrom(reply), null);
  });

  await check("15. a wrong CRM password fails without enumeration", async () => {
    const wrong = await post(
      crmLogin,
      { email: STAFF_EMAIL, password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    const unknown = await post(
      crmLogin,
      { email: "afd3a3-nobody@example.invalid", password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal(sessionCookieFrom(wrong), null);
  });

  await check("16. a blocked staff account is refused and bridges no cookie", async () => {
    const reply = await post(
      crmLogin,
      { email: BLOCKED_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    assert.equal(reply.status, 403, JSON.stringify(reply.body));
    assert.equal(errorCode(reply.body), "inactive");
    assert.equal(sessionCookieFrom(reply), null);
  });

  await check("17. a learner cannot obtain a CRM-origin session", async () => {
    const reply = await post(
      crmLogin,
      { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      freshClient(),
    );
    assert.equal(reply.status, 403);
    assert.equal(errorCode(reply.body), "not_staff");
    assert.equal(sessionCookieFrom(reply), null);
  });

  // ============================================== D. the proxy route matrix
  await check("18. both login proxies are POST-only", async () => {
    for (const url of [academyLogin, crmLogin]) {
      for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
        const res = await fetch(url, { method, redirect: "manual" });
        assert.equal(res.status >= 400, true, `${method} ${url} answered ${res.status}`);
        assert.notEqual(res.status, 200, `${method} ${url} succeeded`);
      }
    }
  });

  await check("19. adjacent Backend auth routes stay unreachable through the proxies", async () => {
    // Literal adjacent names only. A `..` segment is normalised away by `fetch`
    // before the request leaves the client, so asserting on one proves nothing
    // about the proxy — it would just be a differently-spelled /login.
    // Names that are NOT in the proxy allow-list. `me` is deliberately excluded:
    // it IS allow-listed (as the `session` operation) and answers 405 to a POST,
    // which is the method boundary, asserted separately in case 18.
    for (const suffix of ["verify-email", "resend-verification", "session-status", "reset-password"]) {
      const res = await fetch(`${ACADEMY_URL}/api/backend/auth/${suffix}`, {
        method: "POST",
        redirect: "manual",
      });
      assert.equal(res.status, 404, `/api/backend/auth/${suffix} answered ${res.status}`);
    }
    for (const suffix of ["register", "session", "me"]) {
      const res = await fetch(`${CRM_URL}/api/crm/auth/${suffix}`, {
        method: "POST",
        redirect: "manual",
      });
      assert.notEqual(res.status, 200, `/api/crm/auth/${suffix} answered 200`);
    }
  });

  // ========================================== E. client IP and rate limiting
  await check("20. two distinct clients get two distinct rate-limit buckets", async () => {
    // The Backend limit is 5 per 10 minutes per (ip, email). Exhaust one client
    // on a throwaway email, then prove a DIFFERENT client is still served.
    const email = `afd3a3-bucket-${Date.now()}@example.invalid`;
    const firstClient = { "x-real-ip": "203.0.113.61" };
    const secondClient = { "x-real-ip": "198.51.100.62" };

    let sawLimit = false;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const reply = await post(
        academyLogin,
        { email, password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
        firstClient,
      );
      if (reply.status === 429) { sawLimit = true; break; }
    }
    assert.equal(sawLimit, true, "the first client was never rate limited");

    const other = await post(
      academyLogin,
      { email, password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
      secondClient,
    );
    // 401, not 429: a second client must not inherit the first one's budget.
    assert.equal(other.status, 401, `the second client saw ${other.status}`);
  });

  await check("21. the CRM preserves the client IP across its own hop", async () => {
    const email = `afd3a3-crm-bucket-${Date.now()}@example.invalid`;
    let sawLimit = false;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const reply = await post(
        crmLogin,
        { email, password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
        { "x-real-ip": "203.0.113.71" },
      );
      if (reply.status === 429) { sawLimit = true; break; }
    }
    assert.equal(sawLimit, true, "the CRM client was never rate limited");

    const other = await post(
      crmLogin,
      { email, password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
      { "x-real-ip": "198.51.100.72" },
    );
    assert.equal(other.status, 401, `the second CRM client saw ${other.status}`);
  });

  await check("22. a browser-spoofed forwarding chain does not shift the bucket", async () => {
    const email = `afd3a3-spoof-${Date.now()}@example.invalid`;
    let sawLimit = false;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const reply = await post(
        academyLogin,
        { email, password: "NotThePassword1!", captchaToken: DUMMY_TOKEN },
        // A fresh fake head on every attempt. If X-Forwarded-For were honoured
        // this would be an unlimited supply of buckets.
        { "x-real-ip": "203.0.113.81", "x-forwarded-for": `10.0.0.${attempt}` },
      );
      if (reply.status === 429) { sawLimit = true; break; }
    }
    assert.equal(sawLimit, true, "a spoofed X-Forwarded-For created a fresh bucket each time");
  });

  // ================================================== F. registration, intact
  await check("23. registration still succeeds under its own action", async () => {
    const reply = await post(`${ACADEMY_URL}/api/backend/auth/register`, {
      email: `afd3a3-new-${Date.now()}@example.invalid`,
      password: "NewLearner123!",
      captchaToken: DUMMY_TOKEN,
    });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
  });

  await check("24. registration without a token is still refused", async () => {
    const reply = await post(`${ACADEMY_URL}/api/backend/auth/register`, {
      email: `afd3a3-none-${Date.now()}@example.invalid`,
      password: "NewLearner123!",
    });
    assert.equal(reply.status, 400);
    assert.equal(errorCode(reply.body), "CAPTCHA_FAILED");
  });

  // ============================================= G. single use, on a new server
  await stopAll();
  services.length = 0;

  await startService("backend-spent", process.cwd(), BACKEND_PORT + 5, backendEnv(SECRET_SPENT), "/api/health");
  await check("25. a token the provider reports as already spent cannot log in", async () => {
    const reply = await post(
      `http://127.0.0.1:${BACKEND_PORT + 5}/api/auth/login`,
      { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
      { [AUTH_SURFACE_HEADER]: "academy_login", ...freshClient() },
    );
    assert.equal(reply.status, 400, JSON.stringify(reply.body));
    assert.equal(errorCode(reply.body), "CAPTCHA_FAILED");
    assert.equal(sessionCookieFrom(reply), null);
  });

  await check("26. replaying it a second time never succeeds either", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reply = await post(
        `http://127.0.0.1:${BACKEND_PORT + 5}/api/auth/login`,
        { email: LEARNER_EMAIL, password: PASSWORD, captchaToken: DUMMY_TOKEN },
        { [AUTH_SURFACE_HEADER]: "crm_login", ...freshClient() },
      );
      assert.equal(reply.status, 400);
    }
  });
}

main()
  .then(async () => {
    await stopAll();
    cleanupDb();
    console.log(`\nlogin turnstile isolated e2e: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch(async (error) => {
    console.error(error);
    await stopAll();
    cleanupDb();
    console.log(`\nlogin turnstile isolated e2e: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  });
