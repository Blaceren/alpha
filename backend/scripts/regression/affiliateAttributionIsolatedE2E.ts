/**
 * AFD-3B2 — the isolated end-to-end acquisition journey.
 *
 * WHAT THIS PROVES THAT NOTHING ELSE DOES. Every other suite exercises one side.
 * This one runs the real Backend candidate and the real Academy candidate
 * together and walks a visitor through the whole chain:
 *
 *   affiliate link → /go → click → signed cookie → Academy /register proxy
 *   → Backend registration → frozen attribution → conversion event
 *
 * HOW THE SINGLE PUBLIC ORIGIN IS MODELLED. In production `/go` and `/register`
 * are the same public origin, and the ingress routes `/go` to Backend and the
 * rest to Academy — which is exactly why a `__Host-` cookie set at `/go` is sent
 * again at registration. Here the two candidates listen on two isolated loopback
 * ports, so this script keeps ONE cookie jar across both and sends it to both.
 * That is a faithful model of the production arrangement and it is the reason
 * the ingress mapping is called out as a production prerequisite in the source
 * handoff: without it, the cookie would never reach registration.
 *
 * SAFETY. A disposable database copied from a fixture, two explicit isolated
 * ports, an ephemeral attribution secret generated per run, official Cloudflare
 * TEST CAPTCHA keys from the environment, and synthetic accounts only. No live
 * port is contacted, no live database is opened, no live secret is read, no
 * Pocket callback is sent and no live process is signalled.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ATTRIBUTION_COOKIE_NAME } from "../../src/lib/affiliate/attribution-cookie";
import {
  createAttributionToken,
  verifyAttributionToken,
} from "../../src/lib/affiliate/attribution-token";
import { randomBase32Id } from "../../src/lib/affiliate/random-id";

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

/* ------------------------------------------------------------------- setup */

const backendRoot = path.resolve(__dirname, "../..");
const academyRoot =
  process.env.AFD3B2_ACADEMY_ROOT ?? "/home/ubuntu/workspaces/ata-attribution-academy-afd3b2";
const sourceDb =
  process.env.AFD3B2_FIXTURE_DB ?? "/home/ubuntu/publicurl1-work/db/fixture.sqlite";

const dbPath = path.join(os.tmpdir(), `ata-afd3b2-e2e-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** Explicit isolated ports. Never 3010, 3050 or 3100. */
const BACKEND_PORT = Number(process.env.AFD3B2_E2E_BACKEND_PORT ?? 3185);
const ACADEMY_PORT = Number(process.env.AFD3B2_E2E_ACADEMY_PORT ?? 3186);

const ATTRIBUTION_SECRET = crypto.randomBytes(32).toString("base64url");
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const SECRET_PASS = process.env.AFD3B2_TURNSTILE_TEST_SECRET;
/**
 * Cloudflare's documented always-pass SITE key, supplied at run time.
 *
 * Deliberately NOT defaulted to the literal, even though it is public. AFD-3A2
 * established that no key value — not even a published dummy — lives in this
 * repository, which is why `hasOfficialTestKeyShape` matches a shape rather than
 * a string. Following the same rule here keeps that property true of every file.
 */
const SITE_KEY = process.env.AFD3B2_TURNSTILE_TEST_SITE_KEY;
const PASSWORD = "Attribution123!";

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/**
 * `next start` needs a production build. Ensured here rather than assumed, so a
 * suite that ran `next dev` in either worktree beforehand cannot decide whether
 * this one passes. Only builds when `.next/BUILD_ID` is missing.
 */
function ensureProductionBuild(root: string, env: Record<string, string>) {
  if (fs.existsSync(path.join(root, ".next", "BUILD_ID"))) return;
  const built = spawnSync("npx", ["next", "build"], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (built.status !== 0) {
    console.error(built.stdout?.slice(-3000), built.stderr?.slice(-3000));
    throw new Error(`production build failed in ${root}`);
  }
}

type Service = { name: string; child: ChildProcess; pid: number; port: number; baseUrl: string };

const services: Service[] = [];

async function start(
  name: string,
  cwd: string,
  port: number,
  env: Record<string, string>,
  healthPath: string,
): Promise<Service> {
  const merged = { ...(process.env as Record<string, string>), ...env, PORT: String(port) };
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd,
    env: merged as unknown as NodeJS.ProcessEnv,
    // Its own process group. The stop below signals exactly this tree by pid,
    // never a name match and never a broad pattern.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (v: Buffer) => { logs += String(v); });
  child.stderr?.on("data", (v: Buffer) => { logs += String(v); });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited early\n${logs.slice(-3000)}`);
    try {
      const res = await fetch(`${baseUrl}${healthPath}`, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) {
        const service = { name, child, pid: child.pid as number, port, baseUrl };
        services.push(service);
        return service;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not become healthy on ${port}\n${logs.slice(-3000)}`);
}

async function stopAll() {
  for (const service of services) {
    try { process.kill(-service.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    let anyAlive = false;
    for (const service of services) {
      try {
        await fetch(`${service.baseUrl}/`, { signal: AbortSignal.timeout(400) });
        anyAlive = true;
      } catch { /* down */ }
    }
    if (!anyAlive) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  for (const service of services) {
    try { process.kill(-service.pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

/* ------------------------------------------------------------ browser model */

/**
 * One cookie jar shared by both ports, modelling the single public origin the
 * production ingress presents. A jar per port would be modelling a deployment
 * that does not exist and would silently make the whole chain untestable.
 */
class Browser {
  private jar = new Map<string, string>();

  cookieHeader(): string | undefined {
    if (this.jar.size === 0) return undefined;
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | null {
    const value = this.jar.get(name);
    return value === undefined || value === "" ? null : value;
  }

  private absorb(setCookies: string[]) {
    for (const raw of setCookies) {
      const pair = raw.split(";")[0];
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      // A real browser deletes on Max-Age=0. Modelling that is the only way the
      // "the cookie is cleared" assertions mean anything.
      if (/;\s*Max-Age=0\b/i.test(raw) || value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async request(
    baseUrl: string,
    method: string,
    pathname: string,
    init: { body?: unknown; headers?: Record<string, string>; sendCookies?: boolean } = {},
  ) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.sendCookies !== false) {
      const cookie = this.cookieHeader();
      if (cookie) headers.cookie = cookie;
    }
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "manual",
    });
    const setCookies = res.headers.getSetCookie();
    this.absorb(setCookies);
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not json */ }
    return { status: res.status, headers: res.headers, setCookies, text, json };
  }
}

/**
 * A distinct synthetic client address per registration.
 *
 * Sent as `x-real-ip`, NOT `x-forwarded-for`. That is not a detail — it is the
 * Academy proxy's AFD-3A3 contract: `x-forwarded-for` is client-controlled and
 * is ignored entirely, while `x-real-ip` is the header the trusted ingress hop
 * overwrites and is therefore the only one the proxy will read and forward.
 * Sending the wrong one puts every registration in this journey into one
 * rate-limit bucket, which is exactly what the proxy is designed to make
 * impossible for a browser to influence.
 *
 * These are invented values for an isolated server standing in for that ingress
 * hop, and nothing under test persists them.
 */
let clientCounter = 0;
function nextClientIp(): string {
  clientCounter += 1;
  return `198.51.100.${(clientCounter % 250) + 1}`;
}

function ingressHeaders(): Record<string, string> {
  return { "x-real-ip": nextClientIp() };
}

async function main() {
  if (!fs.existsSync(sourceDb)) { console.log("SKIP: no fixture database available"); return; }
  if (!fs.existsSync(academyRoot)) { console.log("SKIP: no Academy candidate available"); return; }
  if (!SECRET_PASS || !SITE_KEY) {
    console.log("SKIP: no official Turnstile test secret and site key supplied");
    return;
  }

  cleanup();
  fs.copyFileSync(sourceDb, dbPath);

  const migrate = spawnSync("npx", ["tsx", "prisma/migrate.ts"], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migrate.status !== 0) {
    console.error(migrate.stdout, migrate.stderr);
    throw new Error("migration of the disposable fixture failed");
  }

  ensureProductionBuild(backendRoot, {
    DATABASE_URL: dbUrl,
    SESSION_SECRET: "afd3b2-build-only-not-a-runtime-secret-value",
  });
  ensureProductionBuild(academyRoot, {
    ACADEMY_MODE: "api",
    BACKEND_ORIGIN: `http://127.0.0.1:${BACKEND_PORT}`,
  });

  process.env.DATABASE_URL = dbUrl;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    /* ------------------------- synthetic affiliates ---------------------- */

    // The fixture is a copy of a real database and already contains Pocket
    // identities and postback rows from earlier phases. "This journey created
    // none" is therefore a comparison against the fixture's own baseline, not
    // against zero — asserting zero would be asserting something about the
    // fixture rather than about this phase.
    const baseline = {
      pocketIdentities: await prisma.pocketTraderIdentity.count(),
      postbackEvents: await prisma.postbackEvent.count(),
      exchangeAccounts: await prisma.exchangeAccount.count(),
      attributions: await prisma.affiliateAttribution.count(),
      conversionEvents: await prisma.affiliateConversionEvent.count(),
      clicks: await prisma.affiliateClick.count(),
    };

    const stamp = Date.now();
    const staff = await prisma.user.create({
      data: {
        email: `afd3b2-e2e-staff-${stamp}@example.invalid`,
        name: "AFD3B2 E2E Staff",
        passwordHash: "synthetic-not-a-real-hash",
      },
    });

    async function partner(code: string) {
      return prisma.affiliatePartner.create({
        data: {
          code,
          displayName: code,
          defaultAttributionWindowDays: 30,
          createdByUserId: staff.id,
        },
      });
    }
    async function campaign(partnerId: number, code: string, name: string) {
      return prisma.affiliateCampaign.create({
        data: {
          affiliatePartnerId: partnerId,
          code,
          displayName: name,
          createdByUserId: staff.id,
        },
      });
    }
    async function link(partnerId: number, campaignId: number, name: string) {
      return prisma.affiliateTrackingLink.create({
        data: {
          affiliatePartnerId: partnerId,
          affiliateCampaignId: campaignId,
          publicCode: randomBase32Id(),
          displayName: name,
          status: "active",
          sub1Parameter: "sub1",
          createdByUserId: staff.id,
        },
      });
    }

    const alpha = await partner(`afd3b2-e2e-alpha-${stamp % 100000}`);
    const alphaOne = await campaign(alpha.id, `alpha-one-${stamp % 100000}`, "Alpha One");
    const alphaLink1 = await link(alpha.id, alphaOne.id, "Alpha Link 1");
    const alphaLink2 = await link(alpha.id, alphaOne.id, "Alpha Link 2");

    const beta = await partner(`afd3b2-e2e-beta-${stamp % 100000}`);
    const betaOne = await campaign(beta.id, `beta-one-${stamp % 100000}`, "Beta One");
    const betaLink1 = await link(beta.id, betaOne.id, "Beta Link 1");

    /* ----------------------------- services ------------------------------ */

    const backend = await start(
      "backend",
      backendRoot,
      BACKEND_PORT,
      {
        DATABASE_URL: dbUrl,
        SESSION_SECRET: "afd3b2-e2e-synthetic-session-secret-not-real",
        POSTBACK_SECRET: "afd3b2-e2e-synthetic-postback-secret-not-real",
        APP_URL: "https://127.0.0.1",
        ATA_ENVIRONMENT: "dev",
        CHECKPOINT_PROVIDER_MODE: "disabled",
        STORAGE_DRIVER: "local",
        POCKET_AFFILIATE_BASE_URL: "https://example.invalid/ref",
        EMAIL_VERIFICATION_REQUIRED: "false",
        CAPTCHA_PROVIDER: "turnstile_test",
        CAPTCHA_TEST_MODE: "unsafe-official-turnstile-test-keys-isolated-only",
        TURNSTILE_SECRET_KEY: SECRET_PASS,
        AFFILIATE_ATTRIBUTION_ENABLED: "true",
        ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
        AFFILIATE_GO_LINK_LIMIT: "5000",
      },
      "/api/health",
    );

    const academy = await start(
      "academy",
      academyRoot,
      ACADEMY_PORT,
      {
        ACADEMY_MODE: "api",
        BACKEND_ORIGIN: backend.baseUrl,
        TURNSTILE_SITE_KEY: SITE_KEY,
      },
      "/register",
    );

    const browser = new Browser();

    /* ============================ THE JOURNEY ============================= */

    await check("1 a qualified visit to Alpha Link 1 redirects to /register", async () => {
      const reply = await browser.request(
        backend.baseUrl,
        "GET",
        `/go/${alphaLink1.publicCode}?clickid=NET-ALPHA-1&sub1=banner-a`,
      );
      assert.equal(reply.status, 302);
      assert.equal(reply.headers.get("location"), "/register");
    });

    let visitorId = "";

    await check("2 exactly one click exists and the browser holds one attribution cookie", async () => {
      const clicks = await prisma.affiliateClick.findMany();
      assert.equal(clicks.length, 1);
      assert.equal(clicks[0].trackingLinkId, alphaLink1.id);
      assert.equal(clicks[0].externalAffiliateClickId, "NET-ALPHA-1");
      assert.equal(clicks[0].sub1, "banner-a");
      assert.equal(clicks[0].classification, "qualified");

      const token = browser.get(ATTRIBUTION_COOKIE_NAME);
      assert.ok(token, "no attribution cookie in the jar");
      const parsed = verifyAttributionToken(token!, ATTRIBUTION_SECRET);
      assert.equal(parsed.kind, "valid");
      if (parsed.kind !== "valid") return;
      visitorId = parsed.payload.anonymousVisitorId;
      assert.equal(clicks[0].anonymousVisitorId, visitorId);
    });

    await check("3 a direct visit to the Academy /register page works", async () => {
      const reply = await browser.request(academy.baseUrl, "GET", "/register");
      assert.equal(reply.status, 200, `register page returned ${reply.status}`);
    });

    await check("4 the attribution cookie survives that visit", () => {
      const token = browser.get(ATTRIBUTION_COOKIE_NAME);
      assert.ok(token, "the registration page destroyed the journey");
      const parsed = verifyAttributionToken(token!, ATTRIBUTION_SECRET);
      assert.equal(parsed.kind === "valid" && parsed.payload.anonymousVisitorId, visitorId);
    });

    await check("5 a later visit to Alpha Link 2 is accepted", async () => {
      const reply = await browser.request(
        backend.baseUrl,
        "GET",
        `/go/${alphaLink2.publicCode}?clickid=NET-ALPHA-2`,
      );
      assert.equal(reply.status, 302);
    });

    await check("6 that click joins the SAME visitor journey and is later", async () => {
      const clicks = await prisma.affiliateClick.findMany({ orderBy: { id: "asc" } });
      assert.equal(clicks.length, 2);
      assert.equal(clicks[1].anonymousVisitorId, visitorId);
      assert.equal(clicks[1].trackingLinkId, alphaLink2.id);
      assert.ok(clicks[1].occurredAt.getTime() >= clicks[0].occurredAt.getTime());
      assert.equal(browser.get(ATTRIBUTION_COOKIE_NAME) !== null, true);
    });

    /** The token as the browser holds it at the moment of registration. */
    const tokenBeforeRegistration = browser.get(ATTRIBUTION_COOKIE_NAME)!;

    const attributedEmail = `afd3b2-e2e-attributed-${stamp}@example.invalid`;
    let registerReply: Awaited<ReturnType<Browser["request"]>>;

    await check("7 registration through the Academy proxy succeeds", async () => {
      registerReply = await browser.request(academy.baseUrl, "POST", "/api/backend/auth/register", {
        body: {
          email: attributedEmail,
          password: PASSWORD,
          name: "E2E Attributed",
          captchaToken: DUMMY_TOKEN,
        },
        headers: ingressHeaders(),
      });
      assert.equal(registerReply.status, 201, registerReply.text.slice(0, 300));
    });

    let attributedUserId = 0;

    await check("8a first touch is Alpha Link 1", async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: attributedEmail } });
      attributedUserId = user.id;
      const attribution = await prisma.affiliateAttribution.findUniqueOrThrow({
        where: { userId: user.id },
        include: { firstTouchClick: true, lastTouchClick: true, selectedClick: true },
      });
      assert.equal(attribution.firstTouchClick.trackingLinkId, alphaLink1.id);
      assert.equal(attribution.firstTouchClick.externalAffiliateClickId, "NET-ALPHA-1");
    });

    await check("8b last touch is Alpha Link 2", async () => {
      const attribution = await prisma.affiliateAttribution.findUniqueOrThrow({
        where: { userId: attributedUserId },
        include: { lastTouchClick: true },
      });
      assert.equal(attribution.lastTouchClick.trackingLinkId, alphaLink2.id);
      assert.equal(attribution.lastTouchClick.externalAffiliateClickId, "NET-ALPHA-2");
    });

    await check("8c the SELECTED click is Alpha Link 2, and the attribution is frozen", async () => {
      const attribution = await prisma.affiliateAttribution.findUniqueOrThrow({
        where: { userId: attributedUserId },
      });
      assert.equal(attribution.selectedClickId, attribution.lastTouchClickId);
      assert.equal(attribution.anonymousVisitorId, visitorId);
      assert.equal(attribution.attributionModel, "last_eligible_affiliate_click");
      assert.equal(attribution.selectionReason, "registration_cookie");
      assert.ok(attribution.frozenAt instanceof Date);
      assert.equal(attribution.frozenAt.getTime(), attribution.selectedAt.getTime());
    });

    await check("8d exactly one attributed academy_registration event exists", async () => {
      const events = await prisma.affiliateConversionEvent.findMany({
        where: { userId: attributedUserId },
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, "academy_registration");
      assert.equal(events[0].affiliatePartnerId, alpha.id);
      assert.equal(events[0].affiliateCampaignId, alphaOne.id);
      assert.equal(events[0].trackingLinkId, alphaLink2.id);
      assert.equal(events[0].affiliateCodeSnapshot, alpha.code);
      assert.equal(events[0].campaignCodeSnapshot, alphaOne.code);
      assert.equal(events[0].trackingLinkPublicCodeSnapshot, alphaLink2.publicCode);
    });

    await check("8e the Academy proxy preserved BOTH Set-Cookie values", () => {
      const session = registerReply.setCookies.filter((c) =>
        c.startsWith("trading_platform_session="),
      );
      const attribution = registerReply.setCookies.filter((c) =>
        c.startsWith(`${ATTRIBUTION_COOKIE_NAME}=`),
      );
      assert.equal(session.length, 1, JSON.stringify(registerReply.setCookies));
      assert.equal(attribution.length, 1, JSON.stringify(registerReply.setCookies));
      // Neither line may have swallowed the other through comma joining.
      assert.ok(!session[0].includes(ATTRIBUTION_COOKIE_NAME));
      assert.ok(!attribution[0].includes("trading_platform_session"));
      assert.match(attribution[0], /Max-Age=0/i);
      assert.match(attribution[0], /HttpOnly/i);
      assert.match(attribution[0], /Secure/i);
      assert.match(attribution[0], /SameSite=Lax/i);
    });

    await check("8f the browser now holds a session and NO attribution cookie", () => {
      assert.ok(browser.get("trading_platform_session"), "no session cookie survived the proxy");
      assert.equal(browser.get(ATTRIBUTION_COOKIE_NAME), null, "the journey was not cleared");
    });

    await check("8g the session works against the Academy", async () => {
      const reply = await browser.request(academy.baseUrl, "GET", "/api/backend/auth/me");
      assert.equal(reply.status, 200, reply.text.slice(0, 200));
    });

    /* --------------------------- replay --------------------------------- */

    const replayEmail = `afd3b2-e2e-replay-${stamp}@example.invalid`;

    await check("9 a replayed token registers a second synthetic learner", async () => {
      const replayBrowser = new Browser();
      const reply = await replayBrowser.request(
        academy.baseUrl,
        "POST",
        "/api/backend/auth/register",
        {
          body: {
            email: replayEmail,
            password: PASSWORD,
            name: "E2E Replay",
            captchaToken: DUMMY_TOKEN,
          },
          headers: {
            cookie: `${ATTRIBUTION_COOKIE_NAME}=${tokenBeforeRegistration}`,
            ...ingressHeaders(),
          },
          sendCookies: false,
        },
      );
      assert.equal(reply.status, 201, reply.text.slice(0, 300));
    });

    await check("10 the replay is DIRECT and could not steal the attribution", async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: replayEmail } });
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
      const events = await prisma.affiliateConversionEvent.findMany({ where: { userId: user.id } });
      assert.equal(events.length, 1);
      assert.equal(events[0].attributionId, null);
      // One attribution owns the journey, and it is still the first learner's.
      const owners = await prisma.affiliateAttribution.findMany({
        where: { anonymousVisitorId: visitorId },
      });
      assert.equal(owners.length, 1);
      assert.equal(owners[0].userId, attributedUserId);
    });

    /* ------------------- authenticated and prefetch clicks --------------- */

    await check("11-12 an authenticated visitor's click is classified and gets no journey", async () => {
      const before = await prisma.affiliateAttribution.count();
      const reply = await browser.request(backend.baseUrl, "GET", `/go/${betaLink1.publicCode}`);
      assert.equal(reply.status, 302);
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      assert.equal(click.classification, "authenticated_user");
      assert.equal(click.anonymousVisitorId, null);
      assert.equal(browser.get(ATTRIBUTION_COOKIE_NAME), null, "a signed-in visitor got a journey");
      assert.equal(await prisma.affiliateAttribution.count(), before);
    });

    await check("13-14 a prefetch is recorded as prefetch and gets no cookie", async () => {
      const prefetchBrowser = new Browser();
      const reply = await prefetchBrowser.request(
        backend.baseUrl,
        "GET",
        `/go/${alphaLink1.publicCode}`,
        { headers: { "sec-purpose": "prefetch;prerender" } },
      );
      assert.equal(reply.status, 302);
      assert.equal(prefetchBrowser.get(ATTRIBUTION_COOKIE_NAME), null);
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      assert.equal(click.classification, "prefetch");
      assert.equal(click.anonymousVisitorId, null);
    });

    /* --------------------------- direct signup --------------------------- */

    await check("15-16 a visitor with no cookie registers direct with one event", async () => {
      const directBrowser = new Browser();
      const email = `afd3b2-e2e-direct-${stamp}@example.invalid`;
      const reply = await directBrowser.request(
        academy.baseUrl,
        "POST",
        "/api/backend/auth/register",
        {
          body: { email, password: PASSWORD, name: "E2E Direct", captchaToken: DUMMY_TOKEN },
          headers: ingressHeaders(),
        },
      );
      assert.equal(reply.status, 201, reply.text.slice(0, 300));
      assert.equal(directBrowser.get(ATTRIBUTION_COOKIE_NAME), null);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const events = await prisma.affiliateConversionEvent.findMany({ where: { userId: user.id } });
      assert.equal(events.length, 1);
      assert.equal(events[0].attributionId, null);
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
    });

    /* --------------------------- expired token --------------------------- */

    await check("17 an expired token registers direct and is cleared", async () => {
      const expiredBrowser = new Browser();
      const expired = createAttributionToken({
        secret: ATTRIBUTION_SECRET,
        anonymousVisitorId: randomBase32Id(),
        issuedAt: new Date(Date.now() - 60 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      });
      const email = `afd3b2-e2e-expired-${stamp}@example.invalid`;
      const reply = await expiredBrowser.request(
        academy.baseUrl,
        "POST",
        "/api/backend/auth/register",
        {
          body: { email, password: PASSWORD, name: "E2E Expired", captchaToken: DUMMY_TOKEN },
          headers: {
            cookie: `${ATTRIBUTION_COOKIE_NAME}=${expired}`,
            ...ingressHeaders(),
          },
          sendCookies: false,
        },
      );
      assert.equal(reply.status, 201, reply.text.slice(0, 300));
      assert.ok(
        reply.setCookies.some(
          (c) => c.startsWith(`${ATTRIBUTION_COOKIE_NAME}=`) && /Max-Age=0/i.test(c),
        ),
        "an unusable token was not cleared",
      );
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
      assert.equal(
        await prisma.affiliateConversionEvent.count({ where: { userId: user.id } }),
        1,
      );
    });

    /* ------------------ paused-after-click historical eligibility -------- */

    await check("18 a link paused AFTER the click still earns the attribution", async () => {
      const pausedBrowser = new Browser();
      await pausedBrowser.request(
        backend.baseUrl,
        "GET",
        `/go/${betaLink1.publicCode}?clickid=NET-BETA-PAUSED`,
      );
      const token = pausedBrowser.get(ATTRIBUTION_COOKIE_NAME);
      assert.ok(token, "no journey was issued for the Beta click");

      // The operator pauses the link after the visitor clicked it.
      await prisma.affiliateTrackingLink.update({
        where: { id: betaLink1.id },
        data: { status: "paused" },
      });
      const refused = await pausedBrowser.request(
        backend.baseUrl,
        "GET",
        `/go/${betaLink1.publicCode}`,
      );
      assert.equal(refused.status, 404, "a paused link kept serving");

      const email = `afd3b2-e2e-paused-${stamp}@example.invalid`;
      const reply = await pausedBrowser.request(
        academy.baseUrl,
        "POST",
        "/api/backend/auth/register",
        {
          body: { email, password: PASSWORD, name: "E2E Paused", captchaToken: DUMMY_TOKEN },
          headers: ingressHeaders(),
        },
      );
      assert.equal(reply.status, 201, reply.text.slice(0, 300));

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const attribution = await prisma.affiliateAttribution.findUniqueOrThrow({
        where: { userId: user.id },
        include: { selectedClick: true },
      });
      assert.equal(attribution.selectedClick.trackingLinkId, betaLink1.id);
      const event = await prisma.affiliateConversionEvent.findFirstOrThrow({
        where: { userId: user.id },
      });
      assert.equal(event.affiliatePartnerId, beta.id);

      await prisma.affiliateTrackingLink.update({
        where: { id: betaLink1.id },
        data: { status: "active" },
      });
    });

    /* ---------------------------- concurrency ---------------------------- */

    await check("19-20 two concurrent registrations on one token: exactly one winner", async () => {
      const raceBrowser = new Browser();
      await raceBrowser.request(
        backend.baseUrl,
        "GET",
        `/go/${alphaLink1.publicCode}?clickid=NET-RACE`,
      );
      const raceToken = raceBrowser.get(ATTRIBUTION_COOKIE_NAME)!;
      const parsed = verifyAttributionToken(raceToken, ATTRIBUTION_SECRET);
      assert.equal(parsed.kind, "valid");
      const raceVisitor =
        parsed.kind === "valid" ? parsed.payload.anonymousVisitorId : "";

      const emails = [
        `afd3b2-e2e-race-a-${stamp}@example.invalid`,
        `afd3b2-e2e-race-b-${stamp}@example.invalid`,
      ];
      const replies = await Promise.all(
        emails.map((email) =>
          new Browser().request(academy.baseUrl, "POST", "/api/backend/auth/register", {
            body: { email, password: PASSWORD, name: "E2E Race", captchaToken: DUMMY_TOKEN },
            headers: {
              cookie: `${ATTRIBUTION_COOKIE_NAME}=${raceToken}`,
              ...ingressHeaders(),
            },
            sendCookies: false,
          }),
        ),
      );
      for (const reply of replies) assert.equal(reply.status, 201, reply.text.slice(0, 300));

      const users = await prisma.user.findMany({ where: { email: { in: emails } } });
      assert.equal(users.length, 2, "both legal registrations must succeed");

      const owners = await prisma.affiliateAttribution.findMany({
        where: { anonymousVisitorId: raceVisitor },
      });
      assert.equal(owners.length, 1, "exactly one attribution may own the journey");

      const events = await prisma.affiliateConversionEvent.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      assert.equal(events.length, 2);
      assert.equal(events.filter((e) => e.attributionId !== null).length, 1);
      assert.equal(events.filter((e) => e.attributionId === null).length, 1);
    });

    /* ------------------------- product invariants ------------------------ */

    await check("21 no Pocket identity was created by any of this", async () => {
      assert.equal(await prisma.pocketTraderIdentity.count(), baseline.pocketIdentities);
      const synthetic = await prisma.user.findMany({
        where: { email: { contains: "afd3b2-e2e-" } },
        select: { id: true },
      });
      assert.equal(
        await prisma.pocketTraderIdentity.count({
          where: { userId: { in: synthetic.map((u) => u.id) } },
        }),
        0,
        "a learner acquired in this journey was bound to a Pocket player",
      );
    });

    await check("22 no first deposit, provider event or postback row exists", async () => {
      const rows = (await prisma.$queryRawUnsafe(
        "SELECT name FROM sqlite_master WHERE type='table'",
      )) as Array<{ name: string }>;
      const names = new Set(rows.map((r) => r.name));

      // AFD-5B2A-FINAL — this check asserted these four table NAMES were absent
      // from the schema. That was true when AFD-3B2 was written, and stopped
      // being true when AFD-4 shipped `PocketProviderEvent` in migration
      // `20260731010000_pocket_first_deposit`. Table absence was only ever a
      // proxy for the property under test: that this acquisition journey wrote
      // no deposit, provider or outbox ROW. So assert that directly. Where a
      // table does not exist the guarantee holds trivially; where it does, it is
      // now checked rather than assumed — which is strictly stronger than the
      // proxy it replaces.
      for (const table of [
        "AffiliateFirstDeposit",
        "AffiliateRedeposit",
        "PocketProviderEvent",
        "AffiliateOutbox",
      ]) {
        if (!names.has(table)) continue;
        const [{ n }] = (await prisma.$queryRawUnsafe(
          // Identifier comes from sqlite_master, never from input.
          `SELECT count(*) AS n FROM "${table.replace(/"/g, '""')}"`,
        )) as Array<{ n: number | bigint }>;
        assert.equal(Number(n), 0, `${table} holds ${String(n)} row(s) after an acquisition-only journey`);
      }
      // No Pocket callback was sent, so the fixture's own postback rows are
      // exactly what remains.
      assert.equal(await prisma.postbackEvent.count(), baseline.postbackEvents);
    });

    await check("23 no XP was granted to any account created in this journey", async () => {
      const emails = await prisma.user.findMany({
        where: { email: { contains: "afd3b2-e2e-" } },
        select: { id: true, xp: true },
      });
      // staff + attributed + replay + direct + expired + paused + 2 race = 8.
      assert.ok(emails.length >= 8, `only ${emails.length} synthetic accounts`);
      for (const user of emails) assert.equal(user.xp, 0, `user ${user.id} has XP`);
      assert.equal(
        await prisma.xpEvent.count({ where: { userId: { in: emails.map((u) => u.id) } } }),
        0,
      );
    });

    await check("24 no current balance and no exchange account exists", async () => {
      const synthetic = await prisma.user.findMany({
        where: { email: { contains: "afd3b2-e2e-" } },
        select: { id: true },
      });
      assert.equal(
        await prisma.exchangeAccount.count({ where: { userId: { in: synthetic.map((u) => u.id) } } }),
        0,
      );
      assert.equal(await prisma.exchangeAccount.count(), baseline.exchangeAccounts);
      assert.equal(
        await prisma.checkpoint.count({ where: { userId: { in: synthetic.map((u) => u.id) } } }),
        0,
      );
    });

    await check("25 every registration in this journey produced exactly one event", async () => {
      const synthetic = await prisma.user.findMany({
        where: { email: { contains: "afd3b2-e2e-" } },
        select: { id: true, email: true },
      });
      // The staff fixture never registered, so it is the only one without an event.
      for (const user of synthetic) {
        const count = await prisma.affiliateConversionEvent.count({ where: { userId: user.id } });
        const expected = user.email.includes("-staff-") ? 0 : 1;
        assert.equal(count, expected, `${user.email} has ${count} events`);
      }
    });
  } finally {
    await stopAll();
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
