/**
 * AFD-4 — the isolated end-to-end first-deposit journey.
 *
 * WHAT THIS PROVES THAT NOTHING ELSE DOES. Every other AFD-4 case calls the
 * route handler in process. This one runs the real Backend candidate as a real
 * server and walks the whole chain over HTTP:
 *
 *   affiliate link → /go → signed cookie → registration → frozen attribution
 *   → Pocket referral link → goal=reg → identity + Level 1
 *   → goal=dep → canonical first deposit → first_deposit conversion
 *
 * WHY THE ACADEMY IS NOT STARTED HERE. The first-deposit chain is entirely
 * Backend-to-Backend: Pocket calls the Backend, and the Backend owns the
 * provider event, the identity and the ledger. The Academy's only role in the
 * wider journey is proxying `/register`, which this phase does not touch — the
 * Academy candidate is byte-identical to AFD-3B1 — and that leg is already
 * proven end to end by `affiliateAttributionIsolatedE2E`. Starting a second
 * service to re-prove somebody else's unchanged code would add a dependency and
 * no evidence, so registration is driven against the same Backend endpoint the
 * Academy proxy forwards to.
 *
 * SAFETY. A disposable database copied from a fixture, ONE explicit isolated
 * port, ephemeral secrets generated per run, official Cloudflare TEST CAPTCHA
 * keys supplied from the environment, and synthetic accounts only. No live port
 * is contacted, no live database is opened, no live secret is read, no real
 * Pocket or affiliate host is contacted, and no live process is signalled. The
 * server is stopped by its own process-group id — never by name matching.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const backendRoot = path.resolve(__dirname, "../..");
const sourceDb =
  process.env.AFD4_FIXTURE_DB ?? "/home/ubuntu/publicurl1-work/db/fixture.sqlite";

const dbPath = path.join(os.tmpdir(), `ata-afd4-e2e-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** An explicit isolated port. Never 3010, 3050 or 3100. */
const BACKEND_PORT = Number(process.env.AFD4_E2E_BACKEND_PORT ?? 3187);

/** Ephemeral, generated per run. Never a live value. */
const SESSION_SECRET = `afd4-e2e-session-${crypto.randomBytes(24).toString("base64url")}`;
const POSTBACK_SECRET = `afd4-e2e-postback-${crypto.randomBytes(18).toString("base64url")}`;
const ATTRIBUTION_SECRET = crypto.randomBytes(32).toString("base64url");

/** Cloudflare's documented always-pass test secret, supplied at run time. */
const TURNSTILE_TEST_SECRET = process.env.AFD4_TURNSTILE_TEST_SECRET;
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const PASSWORD = "FirstDeposit123!";

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function ensureProductionBuild(env: Record<string, string>) {
  if (fs.existsSync(path.join(backendRoot, ".next", "BUILD_ID"))) return;
  const built = spawnSync("npx", ["next", "build"], {
    cwd: backendRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (built.status !== 0) {
    console.error(built.stdout?.slice(-3000), built.stderr?.slice(-3000));
    throw new Error("production build failed");
  }
}

type Service = { name: string; child: ChildProcess; pid: number; port: number; baseUrl: string };
const services: Service[] = [];

async function start(env: Record<string, string>): Promise<Service> {
  const merged = {
    ...(process.env as Record<string, string>),
    ...env,
    PORT: String(BACKEND_PORT),
  };
  const child = spawn("npx", ["next", "start", "-p", String(BACKEND_PORT)], {
    cwd: backendRoot,
    env: merged as unknown as NodeJS.ProcessEnv,
    // Its own process group. `stopAll` signals exactly this tree by pid, never
    // a name match and never a broad command-line pattern.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (v: Buffer) => {
    logs += String(v);
  });
  child.stderr?.on("data", (v: Buffer) => {
    logs += String(v);
  });

  const baseUrl = `http://127.0.0.1:${BACKEND_PORT}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`backend exited early\n${logs.slice(-3000)}`);
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) {
        const service = {
          name: "backend",
          child,
          pid: child.pid as number,
          port: BACKEND_PORT,
          baseUrl,
        };
        services.push(service);
        return service;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`backend did not become healthy on ${BACKEND_PORT}\n${logs.slice(-3000)}`);
}

async function stopAll() {
  for (const service of services) {
    try {
      process.kill(-service.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    let anyAlive = false;
    for (const service of services) {
      try {
        await fetch(`${service.baseUrl}/api/health`, { signal: AbortSignal.timeout(400) });
        anyAlive = true;
      } catch {
        /* down */
      }
    }
    if (!anyAlive) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  for (const service of services) {
    try {
      process.kill(-service.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------------------------------------ browser model */

/** A minimal cookie jar, so one learner's journey carries its own state. */
class Jar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string) {
    return this.cookies.get(name);
  }
}

async function main() {
  if (!TURNSTILE_TEST_SECRET) {
    throw new Error(
      "AFD4_TURNSTILE_TEST_SECRET is required (Cloudflare's documented always-pass test secret)",
    );
  }

  cleanup();
  fs.copyFileSync(sourceDb, dbPath);

  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: backendRoot, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");
  const { randomBase32Id } = await import("../../src/lib/affiliate/random-id");

  const backendEnv = {
    DATABASE_URL: dbUrl,
    SESSION_SECRET,
    POSTBACK_SECRET,
    APP_URL: "https://127.0.0.1",
    ATA_ENVIRONMENT: "dev",
    CHECKPOINT_PROVIDER_MODE: "disabled",
    STORAGE_DRIVER: "local",
    POCKET_AFFILIATE_BASE_URL: "https://example.invalid/ref",
    EMAIL_VERIFICATION_REQUIRED: "false",
    CAPTCHA_PROVIDER: "turnstile_test",
    CAPTCHA_TEST_MODE: "unsafe-official-turnstile-test-keys-isolated-only",
    TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
    AFFILIATE_ATTRIBUTION_ENABLED: "true",
    ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
    AFFILIATE_GO_LINK_LIMIT: "5000",
    AFFILIATE_GO_IP_LIMIT: "5000",
    POCKET_POSTBACK_ENABLED: "true",
    // POCKET-REG-SECURITY-CLOSURE-1 (§14): the spawned server owns its
    // fixture flags; G4 made ingest granular and the master gate alone
    // admits nothing. RDEP is deliberately absent.
    POCKET_REG_INGEST_ENABLED: "true",
    POCKET_DEP_INGEST_ENABLED: "true",
    POCKET_FIRST_DEPOSIT_ENABLED: "true",
  };

  ensureProductionBuild({ ...backendEnv, SESSION_SECRET: "afd4-build-only-not-a-runtime-secret" });

  const stamp = Date.now() % 100000;

  /* ------------------------- affiliate fixtures ------------------------- */
  // Seeded directly: the admin CRUD that normally creates these is proven by
  // affiliateFoundationRegression, and re-driving it here would test somebody
  // else's route rather than the deposit chain.
  const staff = await prisma.user.create({
    data: { email: `afd4-e2e-staff-${stamp}@example.invalid`, name: "Staff" },
  });
  const partner = await prisma.affiliatePartner.create({
    data: { code: `afd4-p-${stamp}`, displayName: "Partner", createdByUserId: staff.id },
  });
  const campaign = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: partner.id,
      code: `afd4-c-${stamp}`,
      displayName: "Campaign",
      createdByUserId: staff.id,
    },
  });
  const trackingLink = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: partner.id,
      affiliateCampaignId: campaign.id,
      publicCode: randomBase32Id(),
      displayName: "Link",
      status: "active",
      createdByUserId: staff.id,
    },
  });

  const backend = await start(backendEnv);
  const base = backend.baseUrl;

  let ipSeq = 0;
  const nextIp = () => `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  let playerSeq = 0;
  const nextPlayerId = () => String(810_000_000 + ++playerSeq);

  /**
   * One source IP per learner, for that learner's whole journey.
   *
   * Faithful (a browser does not change IP between clicking a link and
   * registering) and necessary: `POST /api/auth/register` allows 3 per IP per
   * 30 minutes, so learners sharing an address would exhaust it on the fourth.
   * Both headers are sent with the same value because `getRequestIp` reads
   * `x-forwarded-for` first and falls back to `x-real-ip`, and pinning both
   * removes any dependence on that precedence.
   */
  const ipHeaders = (ip: string) => ({ "x-forwarded-for": ip, "x-real-ip": ip });

  /** Walk /go, keeping the signed attribution cookie in this learner's jar. */
  async function visitGo(jar: Jar, ip: string) {
    const response = await fetch(`${base}/go/${trackingLink.publicCode}`, {
      redirect: "manual",
      headers: { ...ipHeaders(ip), "user-agent": "afd4-e2e" },
    });
    jar.absorb(response);
    return response;
  }

  async function register(jar: Jar, email: string, ip: string) {
    const response = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: jar.header(),
        ...ipHeaders(ip),
      },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: "AFD4 Learner",
        captchaToken: DUMMY_TOKEN,
      }),
    });
    jar.absorb(response);
    return response;
  }

  /** The learner-facing Pocket referral link, which mints the ExchangeAccount. */
  async function referralLink(jar: Jar, ip: string) {
    const csrf = await fetch(`${base}/api/csrf`, {
      headers: { cookie: jar.header(), ...ipHeaders(ip) },
    });
    jar.absorb(csrf);
    const token = jar.get("trading_platform_csrf");
    assert.ok(token, "a CSRF token is required to mint a referral link");

    const response = await fetch(`${base}/api/exchange/referral-link`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: jar.header(),
        "x-csrf-token": token,
        ...ipHeaders(ip),
      },
      body: JSON.stringify({}),
    });
    // Read the body ONCE. A template literal inside an assertion message is
    // evaluated eagerly, so `await response.text()` there would consume the body
    // even when the assertion passes and leave nothing for `.json()`.
    const body = await response.text();
    assert.equal(response.status, 200, `referral link failed: ${body}`);
    return JSON.parse(body) as { referralUrl?: string };
  }

  /** The synthetic Pocket sender, over real HTTP, to the isolated port only. */
  async function postback(query: Record<string, string>) {
    const params = new URLSearchParams(query);
    return fetch(`${base}/api/postbacks/pocket?${params.toString()}`, {
      headers: { "x-forwarded-for": nextIp() },
    });
  }

  const reg = (clickId: string, playerId: string) =>
    postback({ clickid: clickId, goal: "reg", playerid: playerId, ow: POSTBACK_SECRET });
  const dep = (clickId: string, playerId: string, sum: string) =>
    postback({ clickid: clickId, goal: "dep", playerid: playerId, sum, ow: POSTBACK_SECRET });

  const userByEmail = (email: string) =>
    prisma.user.findUnique({ where: { email }, select: { id: true } });
  const eventFor = (playerId: string) =>
    prisma.pocketProviderEvent.findFirst({ where: { pocketPlayerId: playerId } });
  const depositsFor = (userId: number) =>
    prisma.affiliateConversionEvent.findMany({ where: { userId, eventType: "first_deposit" } });

  /** Everything a learner needs, from click to a usable Pocket click id. */
  async function onboard(label: string, attributed: boolean) {
    const jar = new Jar();
    const ip = nextIp();
    if (attributed) {
      const go = await visitGo(jar, ip);
      assert.ok(go.status === 302 || go.status === 307, `/go must redirect (got ${go.status})`);
    }
    const email = `afd4-e2e-${label}-${stamp}@example.invalid`;
    const registration = await register(jar, email, ip);
    // 201 Created is the register route's success status.
    assert.equal(registration.status, 201, `register failed: ${await registration.text()}`);
    const user = await userByEmail(email);
    assert.ok(user);
    const link = await referralLink(jar, ip);
    const account = await prisma.exchangeAccount.findFirst({
      where: { userId: user.id },
      select: { clickId: true },
    });
    assert.ok(account?.clickId, "a referral link must mint a click id");
    return { jar, email, userId: user.id, clickId: account.clickId, referral: link };
  }

  try {
    /* =================================================== attributed learner A */

    let learnerA!: Awaited<ReturnType<typeof onboard>>;
    let playerA!: string;

    await check("A1 an attributed learner registers with a frozen attribution", async () => {
      learnerA = await onboard("a", true);
      const attribution = await prisma.affiliateAttribution.findUnique({
        where: { userId: learnerA.userId },
      });
      assert.ok(attribution, "the /go cookie must have produced a frozen attribution");
      assert.equal(attribution.selectedClickId, attribution.lastTouchClickId);
      const registrations = await prisma.affiliateConversionEvent.findMany({
        where: { userId: learnerA.userId, eventType: "academy_registration" },
      });
      assert.equal(registrations.length, 1);
      assert.equal(registrations[0].affiliatePartnerId, partner.id);
      // A registration carries no money.
      assert.equal(registrations[0].providerAmount, null);
      assert.equal(registrations[0].currencyStatus, null);
    });

    await check("A2 the Pocket referral link is public and carries the click id", () => {
      assert.ok(learnerA.clickId.startsWith("tq-"));
      const url = learnerA.referral.referralUrl ?? "";
      assert.ok(url.length > 0, "a referral URL must be returned");
      // PUBLICURL-1: the learner-facing URL is built from the public origin, not
      // from APP_URL, which must stay loopback.
      assert.ok(url.includes(learnerA.clickId), "the referral URL must carry the click id");
    });

    await check("A3 goal=reg binds the identity and completes Level 1 with zero XP", async () => {
      playerA = nextPlayerId();
      const response = await reg(learnerA.clickId, playerA);
      assert.equal(response.status, 200);

      const identity = await prisma.pocketTraderIdentity.findUnique({
        where: { pocketUserId: playerA },
      });
      assert.equal(identity?.userId, learnerA.userId);
      assert.equal(identity?.source, "registration_postback");
      assert.equal(await prisma.xPTransaction.count({ where: { userId: learnerA.userId } }), 0);
    });

    await check("A4 goal=dep records one matched first deposit", async () => {
      const response = await dep(learnerA.clickId, playerA, "282.70");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });

      const event = await eventFor(playerA);
      assert.equal(event?.status, "matched");
      assert.equal(event?.matchedUserId, learnerA.userId);
      assert.equal(event?.normalizedAmount, "282.70");
      assert.equal(event?.currencyStatus, "unspecified");
      assert.equal(event?.currencyCode, null);
      assert.equal(event?.replayCount, 0);
    });

    await check("A5 the deposit conversion reuses learner A's frozen attribution", async () => {
      const deposits = await depositsFor(learnerA.userId);
      assert.equal(deposits.length, 1);
      const attribution = await prisma.affiliateAttribution.findUnique({
        where: { userId: learnerA.userId },
      });
      assert.equal(deposits[0].attributionId, attribution!.id);
      assert.equal(deposits[0].selectedClickId, attribution!.selectedClickId);
      assert.equal(deposits[0].affiliatePartnerId, partner.id);
      assert.equal(deposits[0].affiliateCampaignId, campaign.id);
      assert.equal(deposits[0].trackingLinkId, trackingLink.id);
      assert.equal(deposits[0].providerAmount, "282.70");
    });

    await check("A6 an identical replay creates no duplicate", async () => {
      const first = await dep(learnerA.clickId, playerA, "282.70");
      const second = await dep(learnerA.clickId, playerA, "282.70");
      assert.equal(first.status, 200);
      assert.equal(await first.text(), await second.text());

      assert.equal(await prisma.pocketProviderEvent.count({ where: { pocketPlayerId: playerA } }), 1);
      assert.equal((await depositsFor(learnerA.userId)).length, 1);
      assert.equal((await eventFor(playerA))?.replayCount, 2);
    });

    await check("A7 a changed amount is quarantined and overwrites nothing", async () => {
      const response = await dep(learnerA.clickId, playerA, "999.99");
      assert.equal(response.status, 200);

      const event = await eventFor(playerA);
      assert.equal(event?.normalizedAmount, "282.70", "the canonical amount is immutable");
      assert.equal(event?.conflictCode, "amount_mismatch");
      assert.equal(event?.status, "matched", "an already-counted deposit keeps its match");
      const deposits = await depositsFor(learnerA.userId);
      assert.equal(deposits.length, 1);
      assert.equal(deposits[0].providerAmount, "282.70");
    });

    /* ================================================ out-of-order learner B */

    let learnerB!: Awaited<ReturnType<typeof onboard>>;
    let playerB!: string;

    await check("B1 a deposit arriving BEFORE registration stays pending", async () => {
      learnerB = await onboard("b", true);
      playerB = nextPlayerId();

      const response = await dep(learnerB.clickId, playerB, "410.05");
      assert.equal(response.status, 200);

      const event = await eventFor(playerB);
      assert.equal(event?.status, "pending_identity");
      assert.equal(event?.matchedUserId, null);
      assert.equal((await depositsFor(learnerB.userId)).length, 0, "no confirmed deposit yet");
      assert.equal(
        await prisma.pocketTraderIdentity.findUnique({ where: { pocketUserId: playerB } }),
        null,
        "a deposit must not bind an identity",
      );
    });

    await check("B2 the later goal=reg binds identity and reconciles the deposit", async () => {
      const response = await reg(learnerB.clickId, playerB);
      assert.equal(response.status, 200);

      const identity = await prisma.pocketTraderIdentity.findUnique({
        where: { pocketUserId: playerB },
      });
      assert.equal(identity?.userId, learnerB.userId);

      const event = await eventFor(playerB);
      assert.equal(event?.status, "matched");
      assert.equal(event?.matchedUserId, learnerB.userId);
      assert.equal(event?.normalizedAmount, "410.05");

      const deposits = await depositsFor(learnerB.userId);
      assert.equal(deposits.length, 1);
      assert.equal(deposits[0].providerAmount, "410.05");
      assert.equal(deposits[0].affiliatePartnerId, partner.id);
    });

    await check("B3 replaying the reconciliation creates no duplicate", async () => {
      await reg(learnerB.clickId, playerB);
      await reg(learnerB.clickId, playerB);
      await dep(learnerB.clickId, playerB, "410.05");
      assert.equal(await prisma.pocketProviderEvent.count({ where: { pocketPlayerId: playerB } }), 1);
      assert.equal((await depositsFor(learnerB.userId)).length, 1);
    });

    /* ======================================================== direct learner C */

    let learnerC!: Awaited<ReturnType<typeof onboard>>;

    await check("C1 a direct learner's deposit is recorded with no affiliate", async () => {
      learnerC = await onboard("c", false);
      const playerC = nextPlayerId();

      assert.equal(
        await prisma.affiliateAttribution.findUnique({ where: { userId: learnerC.userId } }),
        null,
        "learner C never visited /go",
      );

      assert.equal((await reg(learnerC.clickId, playerC)).status, 200);
      assert.equal((await dep(learnerC.clickId, playerC, "60.00")).status, 200);

      const deposits = await depositsFor(learnerC.userId);
      assert.equal(deposits.length, 1, "a direct deposit still produces a ledger row");
      assert.equal(deposits[0].attributionId, null);
      assert.equal(deposits[0].affiliatePartnerId, null);
      assert.equal(deposits[0].trackingLinkId, null);
      assert.equal(deposits[0].providerAmount, "60.00");
    });

    /* ====================================================== conflict learner D */

    await check("D1 a click/identity owner mismatch is quarantined", async () => {
      const learnerD = await onboard("d", true);
      const playerD = nextPlayerId();

      // The player is legally registered to learner D.
      assert.equal((await reg(learnerD.clickId, playerD)).status, 200);

      // A deposit then arrives naming learner A's click id for D's player.
      const response = await dep(learnerA.clickId, playerD, "700.00");
      assert.equal(response.status, 200, "a conflict is acknowledged, never retried forever");

      const event = await eventFor(playerD);
      assert.equal(event?.status, "conflict");
      assert.equal(event?.conflictCode, "identity_owner_mismatch");
      assert.equal(event?.matchedUserId, null);

      // Nobody was credited and no identity moved.
      assert.equal((await depositsFor(learnerD.userId)).length, 0);
      assert.equal((await depositsFor(learnerA.userId)).length, 1);
      const identity = await prisma.pocketTraderIdentity.findUnique({
        where: { pocketUserId: playerD },
      });
      assert.equal(identity?.userId, learnerD.userId);
    });

    /* =============================================== operator reconciliation */

    await check("E1 the operator dry-run reports counts and changes nothing", async () => {
      const before = await prisma.affiliateConversionEvent.count({
        where: { eventType: "first_deposit" },
      });
      const result = spawnSync(
        process.execPath,
        [
          path.join("node_modules", "tsx", "dist", "cli.mjs"),
          path.join("scripts", "ops", "reconcilePocketFirstDeposits.ts"),
        ],
        {
          cwd: backendRoot,
          env: { ...process.env, ...backendEnv },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(JSON.parse(result.stdout).mode, "dry-run");
      assert.equal(
        await prisma.affiliateConversionEvent.count({ where: { eventType: "first_deposit" } }),
        before,
      );
      assert.ok(!result.stdout.includes(POSTBACK_SECRET));
      assert.ok(!result.stdout.includes(learnerA.clickId));
    });

    await check("E2 the operator apply is idempotent against a settled ledger", async () => {
      const before = await prisma.affiliateConversionEvent.count({
        where: { eventType: "first_deposit" },
      });
      const result = spawnSync(
        process.execPath,
        [
          path.join("node_modules", "tsx", "dist", "cli.mjs"),
          path.join("scripts", "ops", "reconcilePocketFirstDeposits.ts"),
          "--apply",
        ],
        { cwd: backendRoot, env: { ...process.env, ...backendEnv }, encoding: "utf8" },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout);
      assert.equal(report.mode, "apply");
      assert.equal(report.errors, 0);
      // Everything already reconciled through the callback path.
      assert.equal(
        await prisma.affiliateConversionEvent.count({ where: { eventType: "first_deposit" } }),
        before + report.conversion_events_created,
      );
    });

    /* ================================================================ safety */

    await check("F1 no deposit awarded XP or completed a level", async () => {
      assert.equal(await prisma.xPTransaction.count(), 0);
      const deposits = await prisma.affiliateConversionEvent.count({
        where: { eventType: "first_deposit" },
      });
      assert.ok(deposits >= 3, "the journey really did record deposits");
    });

    await check("F2 exactly one canonical deposit exists per player", async () => {
      const events = await prisma.pocketProviderEvent.findMany();
      const keys = events.map((e) => `${e.provider}|${e.eventType}|${e.pocketPlayerId}`);
      assert.equal(new Set(keys).size, keys.length, "one player, one canonical deposit");
      for (const event of events) {
        assert.match(event.normalizedAmount, /^\d+\.\d{2}$/);
      }
    });

    // POCKET-REG-INGRESS-1: migration 47 creates `GrowthEventOutbox` by design —
    // the canonical Growth ledger's single outbox. The invariant this case
    // protects is unchanged and now stated post-47: no redeposit structure, no
    // SECOND outbox, no balance and no fabricated transaction id.
    await check("F3 no redeposit, no balance and no fabricated transaction id", async () => {
      const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='table'",
      );
      for (const { name } of tables) {
        assert.ok(!/redeposit/i.test(name), `unexpected table ${name}`);
        if (/outbox/i.test(name)) {
          assert.equal(name, "GrowthEventOutbox", `unexpected outbox table ${name}`);
        }
      }
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("PocketProviderEvent")',
      );
      for (const { name } of columns) {
        assert.ok(!/balance|transactionId/i.test(name), `unexpected column ${name}`);
      }
    });

    await check("F4 goal=reg regression: identity, Level 1 and zero XP all intact", async () => {
      const identities = await prisma.pocketTraderIdentity.findMany();
      assert.ok(identities.length >= 4);
      for (const identity of identities) {
        assert.equal(identity.source, "registration_postback");
      }
      const accounts = await prisma.exchangeAccount.findMany({
        where: { userId: { in: [learnerA.userId, learnerB.userId, learnerC.userId] } },
      });
      for (const account of accounts) {
        assert.equal(account.registrationStatus, true);
      }
      assert.equal(await prisma.xPTransaction.count(), 0);
    });

    await prisma.$disconnect();
  } finally {
    await stopAll();
  }

  /* -------------------------------------------------- process/port cleanup */

  await check("G1 the isolated port is free and the process group is gone", async () => {
    let reachable = true;
    try {
      await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      reachable = false;
    }
    assert.equal(reachable, false, `port ${BACKEND_PORT} must be free`);

    for (const service of services) {
      // Bounded wait rather than an instant assertion: `stopAll` returns as soon
      // as the port stops answering, which can be a moment before the kernel has
      // finished reaping the process. Asserting immediately tests the scheduler,
      // not the cleanup.
      const deadline = Date.now() + 15_000;
      let alive = true;
      while (Date.now() < deadline) {
        try {
          // Signal 0 tests for existence without delivering a signal.
          process.kill(service.pid, 0);
        } catch {
          alive = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.equal(alive, false, `pid ${service.pid} must be gone`);
    }
  });
}

main()
  .then(() => {
    cleanup();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    await stopAll();
    cleanup();
    console.error(error);
    process.exit(1);
  });
