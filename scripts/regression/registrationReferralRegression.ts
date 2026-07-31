/**
 * AFD-3A2 — resilient ATA invitation referrals.
 *
 * THE DEFECT THIS SUITE PINS SHUT
 * `POST /api/auth/register` used to decide the whole question in one condition:
 *
 *     if (referralCode && (!inviter || !referralConfig?.isActive)) → REFERRAL_INVALID
 *
 * That `||` joins two unrelated facts: "does this person exist?" and "is the
 * platform paying a bonus today?". The live database has ZERO
 * `ReferralBonusConfig` rows, so every genuine ATA invite link in circulation
 * would have been rejected as "недействительна" — telling an invited person
 * their friend's link was fake.
 *
 * WHAT IS PROVEN HERE
 *   A. only an unknown or blocked inviter rejects;
 *   B. a valid inviter always yields a relationship;
 *   C. bonus availability is read separately;
 *   D. no reward, no XP event and no notification exist without an ACTIVE config;
 *   E. with an active config, the pre-existing reward behaviour is byte-identical.
 *
 * NO BONUS CONFIGURATION IS CREATED IN ANY SHARED DATABASE. The active-config
 * regression runs against a disposable COPY and invents no economic value — it
 * asserts that whatever amounts the config carries are the amounts paid.
 *
 * The HTTP section additionally proves atomicity and the response contract. It
 * runs only when the phase supplies an official Cloudflare test secret through
 * `AFD3A2_TURNSTILE_TEST_SECRET`; no secret value is committed here.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

import {
  DEFAULT_REFERRAL_BONUS_SLUG,
  resolveRegistrationReferral,
  revalidateReferralReward,
} from "../../src/lib/referral/registrationReferral";

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
// Disposable database. Never the live one.
// ---------------------------------------------------------------------------
const sourceDb =
  process.env.AFD3A2_FIXTURE_DB ?? "/home/ubuntu/publicurl1-work/db/fixture.sqlite";
const dbPath = path.join(os.tmpdir(), `ata-afd3a2-referral-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const basePort = 3160 + (process.pid % 8) * 4;
let port = basePort;
let baseUrl = `http://127.0.0.1:${port}`;
const PASSWORD = "Referral123!";

/** The official Cloudflare dummy token. Public documentation, not a credential. */
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * The three official Cloudflare test secrets, supplied by the phase at run time
 * and never committed.
 *
 * They are three different behaviours, not three copies of one:
 *   PASS  — succeeds for ANY token (verified against the live endpoint: it is
 *           not token-sensitive, so it cannot be used to test rejection);
 *   FAIL  — always answers `invalid-input-response`;
 *   SPENT — always answers `timeout-or-duplicate`, i.e. a replayed token.
 *
 * Each drives its own short-lived server below, because the secret is process
 * configuration and cannot vary per request.
 */
const SECRET_PASS = process.env.AFD3A2_TURNSTILE_TEST_SECRET;
const SECRET_FAIL = process.env.AFD3A2_TURNSTILE_TEST_SECRET_FAIL;
const SECRET_SPENT = process.env.AFD3A2_TURNSTILE_TEST_SECRET_SPENT;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

let server: ChildProcess | null = null;
let serverPid: number | null = null;
let serverLogs = "";

/** Environment shared by every isolated server here. Never a live runtime file. */
function isolatedEnv(secret: string): Record<string, string> {
  return {
    DATABASE_URL: dbUrl,
    SESSION_SECRET: "afd3a2-synthetic-session-secret",
    POSTBACK_SECRET: "afd3a2-synthetic-postback-secret",
    APP_URL: "https://127.0.0.1",
    ATA_ENVIRONMENT: "dev",
    CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    STORAGE_DRIVER: "local",
    POCKET_AFFILIATE_BASE_URL: "https://example.invalid/ref",
    EMAIL_VERIFICATION_REQUIRED: "false",
    // The explicit isolated-test CAPTCHA contract, with every safeguard present.
    CAPTCHA_PROVIDER: "turnstile_test",
    CAPTCHA_TEST_MODE: "unsafe-official-turnstile-test-keys-isolated-only",
    TURNSTILE_SECRET_KEY: secret,
  };
}

/**
 * Run `fn` against a server configured with one specific test secret, then stop
 * that exact process group. Each pass takes its own port so a lingering socket
 * from the previous pass can never be mistaken for the next one.
 */
async function withServer(secret: string, offset: number, fn: () => Promise<void>) {
  port = basePort + offset;
  baseUrl = `http://127.0.0.1:${port}`;
  server = await startServer(isolatedEnv(secret));
  try {
    await fn();
  } finally {
    await stopServer();
    server = null;
  }
}

async function startServer(env: Record<string, string>) {
  const merged = { ...(process.env as Record<string, string>), ...env };
  delete (merged as Record<string, string | undefined>).NODE_ENV;
  const child: ChildProcess = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: merged as unknown as NodeJS.ProcessEnv,
    // Its own process group, so the stop below signals exactly this tree and
    // nothing that merely looks like it. Never `pkill`, never a name match.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverPid = child.pid ?? null;
  child.stdout?.on("data", (v: Buffer) => { serverLogs += String(v); });
  child.stderr?.on("data", (v: Buffer) => { serverLogs += String(v); });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next dev failed to start\n${serverLogs.slice(-3000)}`);
}

async function stopServer() {
  if (!server?.pid) return;
  // Exact process group of the exact child we spawned.
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); }
    catch { return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* already gone */ }
}

async function main() {
  if (!fs.existsSync(sourceDb)) {
    console.log("SKIP: no fixture database available");
    return;
  }

  cleanup();
  fs.copyFileSync(sourceDb, dbPath);
  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");

  // A guard, not a formality: every assertion below assumes the fixture starts
  // with no bonus programme, which is also the LIVE state.
  const startingConfigs = await prisma.referralBonusConfig.count();
  await check("the fixture starts with no referral bonus configuration", () => {
    assert.equal(startingConfigs, 0);
  });

  const stamp = Date.now();
  const hash = await bcrypt.hash(PASSWORD, 10);
  const inviter = await prisma.user.create({
    data: {
      email: `afd3a2-inviter-${stamp}@example.invalid`,
      name: "AFD3A2 Inviter",
      passwordHash: hash,
      referralCode: `AFD3A2INV${stamp % 1000000}`,
      status: "active",
    },
  });
  const blocked = await prisma.user.create({
    data: {
      email: `afd3a2-blocked-${stamp}@example.invalid`,
      name: "AFD3A2 Blocked",
      passwordHash: hash,
      referralCode: `AFD3A2BLK${stamp % 1000000}`,
      status: "blocked",
    },
  });

  // ==================================================== A. inviter validity
  await check("no code resolves to 'absent' — no relationship, no reward", async () => {
    assert.deepEqual(await resolveRegistrationReferral(prisma, undefined), { kind: "absent" });
    assert.deepEqual(await resolveRegistrationReferral(prisma, ""), { kind: "absent" });
  });

  await check("an unknown code is invalid", async () => {
    const resolution = await resolveRegistrationReferral(prisma, `NO-SUCH-CODE-${stamp}`);
    assert.equal(resolution.kind, "invalid");
  });

  await check("a malformed code is invalid, never a crash", async () => {
    for (const code of ["   ", "' OR 1=1 --", " ", "x".repeat(500), "<script>"]) {
      const resolution = await resolveRegistrationReferral(prisma, code);
      assert.equal(resolution.kind, "invalid", `code ${JSON.stringify(code)} was accepted`);
    }
  });

  await check("a blocked inviter's code is invalid", async () => {
    // A blocked account must stop accruing a downline, and the invitee gets the
    // same generic answer as for an unknown code — which leaks nothing.
    const resolution = await resolveRegistrationReferral(prisma, blocked.referralCode);
    assert.equal(resolution.kind, "invalid");
  });

  await check("referral codes are unique at the schema level", async () => {
    // "Duplicate code ambiguity" cannot arise: the column is @unique, so a
    // second user cannot own the same code.
    await assert.rejects(
      prisma.user.create({
        data: {
          email: `afd3a2-dup-${stamp}@example.invalid`,
          name: "dup",
          passwordHash: hash,
          referralCode: inviter.referralCode,
          status: "active",
        },
      }),
    );
  });

  // ====================================== B. validity is NOT bonus availability
  await check("THE FIX: a valid code is accepted with no bonus configuration", async () => {
    const resolution = await resolveRegistrationReferral(prisma, inviter.referralCode);
    assert.equal(resolution.kind, "accepted");
    assert.equal(resolution.kind === "accepted" && resolution.inviterId, inviter.id);
    assert.equal(resolution.kind === "accepted" && resolution.reward, "not_configured");
    assert.equal(resolution.kind === "accepted" && resolution.bonus, null);
  });

  await check("an INACTIVE configuration does not invalidate a valid code", async () => {
    const created = await prisma.referralBonusConfig.create({
      data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: false },
    });
    try {
      const resolution = await resolveRegistrationReferral(prisma, inviter.referralCode);
      assert.equal(resolution.kind, "accepted");
      assert.equal(resolution.kind === "accepted" && resolution.reward, "inactive");
      assert.equal(resolution.kind === "accepted" && resolution.bonus, null);
    } finally {
      await prisma.referralBonusConfig.delete({ where: { id: created.id } });
    }
  });

  await check("an ACTIVE configuration prices the reward from the stored values", async () => {
    const created = await prisma.referralBonusConfig.create({
      data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: true, inviterXp: 100, invitedXp: 50 },
    });
    try {
      const resolution = await resolveRegistrationReferral(prisma, inviter.referralCode);
      assert.equal(resolution.kind === "accepted" && resolution.reward, "payable");
      // Read from the row, never invented by this code.
      assert.deepEqual(resolution.kind === "accepted" && resolution.bonus, {
        inviterXp: created.inviterXp,
        invitedXp: created.invitedXp,
      });
    } finally {
      await prisma.referralBonusConfig.delete({ where: { id: created.id } });
    }
  });

  await check("a blocked inviter is still invalid even WITH an active programme", async () => {
    const created = await prisma.referralBonusConfig.create({
      data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: true },
    });
    try {
      const resolution = await resolveRegistrationReferral(prisma, blocked.referralCode);
      assert.equal(resolution.kind, "invalid");
    } finally {
      await prisma.referralBonusConfig.delete({ where: { id: created.id } });
    }
  });

  // ============================== C. transactional revalidation demotes only
  await check("a programme withdrawn mid-request demotes the reward, not the account", async () => {
    const created = await prisma.referralBonusConfig.create({
      data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: true, inviterXp: 100, invitedXp: 50 },
    });
    const resolution = await resolveRegistrationReferral(prisma, inviter.referralCode);
    assert.equal(resolution.kind === "accepted" && resolution.reward, "payable");

    // The operator switches the programme off between resolution and commit.
    await prisma.referralBonusConfig.update({ where: { id: created.id }, data: { isActive: false } });
    try {
      const reward = await prisma.$transaction((tx) =>
        revalidateReferralReward(tx, resolution as Extract<typeof resolution, { kind: "accepted" }>),
      );
      assert.equal(reward, "inactive");
    } finally {
      await prisma.referralBonusConfig.delete({ where: { id: created.id } });
    }
  });

  await check("amounts edited mid-request pay nothing rather than an unvalidated number", async () => {
    const created = await prisma.referralBonusConfig.create({
      data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: true, inviterXp: 100, invitedXp: 50 },
    });
    const resolution = await resolveRegistrationReferral(prisma, inviter.referralCode);
    await prisma.referralBonusConfig.update({
      where: { id: created.id },
      data: { inviterXp: 999_999 },
    });
    try {
      const reward = await prisma.$transaction((tx) =>
        revalidateReferralReward(tx, resolution as Extract<typeof resolution, { kind: "accepted" }>),
      );
      assert.equal(reward, "inactive");
    } finally {
      await prisma.referralBonusConfig.delete({ where: { id: created.id } });
    }
  });

  await check("revalidation can only demote — it never promotes to payable", async () => {
    const resolution = await resolveRegistrationReferral(prisma, inviter.referralCode);
    assert.equal(resolution.kind === "accepted" && resolution.reward, "not_configured");

    // A programme switched ON mid-request must not retroactively pay a bonus
    // this request never priced.
    const created = await prisma.referralBonusConfig.create({
      data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: true, inviterXp: 100, invitedXp: 50 },
    });
    try {
      const reward = await prisma.$transaction((tx) =>
        revalidateReferralReward(tx, resolution as Extract<typeof resolution, { kind: "accepted" }>),
      );
      assert.equal(reward, "not_configured");
    } finally {
      await prisma.referralBonusConfig.delete({ where: { id: created.id } });
    }
  });

  await check("an inviter blocked mid-request loses the payout, not the invitee's account", async () => {
    const created = await prisma.referralBonusConfig.create({
      data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: true, inviterXp: 100, invitedXp: 50 },
    });
    const temp = await prisma.user.create({
      data: {
        email: `afd3a2-race-${stamp}@example.invalid`,
        name: "race",
        passwordHash: hash,
        referralCode: `AFD3A2RACE${stamp % 1000000}`,
        status: "active",
      },
    });
    const resolution = await resolveRegistrationReferral(prisma, temp.referralCode);
    await prisma.user.update({ where: { id: temp.id }, data: { status: "blocked" } });
    try {
      const reward = await prisma.$transaction((tx) =>
        revalidateReferralReward(tx, resolution as Extract<typeof resolution, { kind: "accepted" }>),
      );
      assert.equal(reward, "inactive");
    } finally {
      await prisma.referralBonusConfig.delete({ where: { id: created.id } });
      await prisma.user.delete({ where: { id: temp.id } });
    }
  });

  await prisma.$disconnect();

  // ============================================== D. over real HTTP
  if (!SECRET_PASS) {
    console.log("SKIP D: AFD3A2_TURNSTILE_TEST_SECRET was not supplied");
  } else {
    process.env.DATABASE_URL = dbUrl;
    const { prisma: db } = await import("../../src/lib/prisma");

    let seq = 0;
    const register = async (body: Record<string, unknown>, ip?: string) => {
      seq += 1;
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A distinct client per attempt: the route rate-limits 3 per 30
          // minutes per resolved IP, and this suite makes more than three.
          "x-forwarded-for": ip ?? `198.51.100.${seq % 250}`,
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
        cookies: response.headers.getSetCookie(),
      };
    };

    const inviterHttp = await db.user.create({
      data: {
        email: `afd3a2-http-inviter-${stamp}@example.invalid`,
        name: "AFD3A2 HTTP Inviter",
        passwordHash: hash,
        referralCode: `AFD3A2HTTP${stamp % 1000000}`,
        status: "active",
      },
    });

    // ---- pass 1: the "always passes" secret -------------------------------
    // Verified against the live endpoint: this secret succeeds for ANY token,
    // so it proves the SUCCESS path and every referral behaviour, and cannot be
    // used to prove rejection. Rejection gets its own secrets in passes 2 & 3.
    await withServer(SECRET_PASS, 0, async () => {

    await check("HTTP: registration with no referral succeeds and issues a session", async () => {
      const before = await db.user.count();
      const result = await register({
        email: `afd3a2-noref-${stamp}@example.invalid`,
        password: PASSWORD,
        captchaToken: DUMMY_TOKEN,
      });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      // The response DTO is unchanged from AFD-3A.
      assert.ok(result.body?.user);
      assert.deepEqual(Object.keys(result.body ?? {}).sort(), ["user", "verification"]);
      assert.equal((result.body?.verification as { required: boolean }).required, false);
      assert.equal(result.cookies.some((c) => c.startsWith("trading_platform_session=")), true);
      assert.equal(await db.user.count(), before + 1);
    });

    await check("HTTP: no referral means no Referral row at all", async () => {
      const user = await db.user.findUnique({
        where: { email: `afd3a2-noref-${stamp}@example.invalid` },
        include: { invitedByReferral: true },
      });
      assert.equal(user?.invitedByReferral, null);
    });

    await check("HTTP: a missing token is refused and creates nothing", async () => {
      const before = await db.user.count();
      const result = await register({
        email: `afd3a2-notoken-${stamp}@example.invalid`,
        password: PASSWORD,
      });
      assert.equal(result.status, 400);
      assert.equal(result.body?.error, "CAPTCHA_FAILED");
      // Fail-closed BEFORE any write: no user, no partial rows.
      assert.equal(await db.user.count(), before);
    });

    await check("HTTP: THE FIX — a valid invite works with no bonus programme", async () => {
      assert.equal(await db.referralBonusConfig.count(), 0);
      const result = await register({
        email: `afd3a2-ref-${stamp}@example.invalid`,
        password: PASSWORD,
        referralCode: inviterHttp.referralCode,
        captchaToken: DUMMY_TOKEN,
      });
      // Before this phase this was 400 REFERRAL_INVALID.
      assert.equal(result.status, 201, JSON.stringify(result.body));
    });

    await check("HTTP: the relationship exists and records both parties", async () => {
      const invitee = await db.user.findUnique({
        where: { email: `afd3a2-ref-${stamp}@example.invalid` },
        include: { invitedByReferral: true },
      });
      const relation = invitee?.invitedByReferral;
      assert.ok(relation, "no referral relationship was created");
      assert.equal(relation.inviterUserId, inviterHttp.id);
      assert.equal(relation.invitedUserId, invitee.id);
    });

    await check("HTTP: the relationship carries NO reward", async () => {
      const invitee = await db.user.findUnique({
        where: { email: `afd3a2-ref-${stamp}@example.invalid` },
        include: { invitedByReferral: true },
      });
      const relation = invitee?.invitedByReferral;
      assert.ok(relation);
      assert.equal(relation.xpEarned, 0);
      assert.equal(relation.invitedXpEarned, 0);
      // The schema's own discriminator for "no bonus was granted".
      assert.equal(relation.bonusGrantedAt, null);
    });

    await check("HTTP: no XP is created for either party without an active config", async () => {
      const invitee = await db.user.findUniqueOrThrow({
        where: { email: `afd3a2-ref-${stamp}@example.invalid` },
      });
      const refreshedInviter = await db.user.findUniqueOrThrow({ where: { id: inviterHttp.id } });

      assert.equal(invitee.xp, 0, "the invitee received XP with no bonus programme");
      assert.equal(refreshedInviter.xp, inviterHttp.xp, "the inviter's XP moved");

      const events = await db.xpEvent.count({
        where: { userId: { in: [invitee.id, inviterHttp.id] } },
      });
      // Not even a zero-value event: the ledger records nothing at all.
      assert.equal(events, 0);
    });

    await check("HTTP: no reward notification promises XP that was never granted", async () => {
      const invitee = await db.user.findUniqueOrThrow({
        where: { email: `afd3a2-ref-${stamp}@example.invalid` },
      });
      const notifications = await db.notification.count({
        where: { userId: { in: [invitee.id, inviterHttp.id] }, type: "referral_bonus" },
      });
      assert.equal(notifications, 0);
    });

    await check("HTTP: the accepted relationship IS audited", async () => {
      const invitee = await db.user.findUniqueOrThrow({
        where: { email: `afd3a2-ref-${stamp}@example.invalid` },
      });
      const audit = await db.auditLog.findFirst({
        where: { action: "REFERRAL_RELATION_CREATED", entityId: String(invitee.id) },
      });
      assert.ok(audit, "an unrewarded relationship left no audit trail");
      assert.equal(JSON.stringify(audit.metadata).includes("not_configured"), true);
      // A bonus grant must NOT be recorded when nothing was granted.
      const granted = await db.auditLog.count({
        where: { action: "REFERRAL_BONUS_GRANTED", entityId: String(invitee.id) },
      });
      assert.equal(granted, 0);
    });

    await check("HTTP: an unknown inviter is rejected atomically", async () => {
      const before = await db.user.count();
      const result = await register({
        email: `afd3a2-badref-${stamp}@example.invalid`,
        password: PASSWORD,
        referralCode: `UNKNOWN-${stamp}`,
        captchaToken: DUMMY_TOKEN,
      });
      assert.equal(result.status, 400);
      assert.equal(result.body?.error, "REFERRAL_INVALID");
      // No partial user, and the rejection happens before the transaction.
      assert.equal(await db.user.count(), before);
      assert.equal(
        await db.user.count({ where: { email: `afd3a2-badref-${stamp}@example.invalid` } }),
        0,
      );
    });

    await check("HTTP: a blocked inviter is rejected atomically", async () => {
      const before = await db.user.count();
      const result = await register({
        email: `afd3a2-blockedref-${stamp}@example.invalid`,
        password: PASSWORD,
        referralCode: blocked.referralCode,
        captchaToken: DUMMY_TOKEN,
      });
      assert.equal(result.status, 400);
      assert.equal(result.body?.error, "REFERRAL_INVALID");
      assert.equal(await db.user.count(), before);
    });

    await check("HTTP: an inactive programme still accepts the invite, unrewarded", async () => {
      const created = await db.referralBonusConfig.create({
        data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: false, inviterXp: 100, invitedXp: 50 },
      });
      try {
        const result = await register({
          email: `afd3a2-inactive-${stamp}@example.invalid`,
          password: PASSWORD,
          referralCode: inviterHttp.referralCode,
          captchaToken: DUMMY_TOKEN,
        });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        const invitee = await db.user.findUniqueOrThrow({
          where: { email: `afd3a2-inactive-${stamp}@example.invalid` },
          include: { invitedByReferral: true },
        });
        assert.ok(invitee.invitedByReferral);
        assert.equal(invitee.invitedByReferral.bonusGrantedAt, null);
        assert.equal(invitee.xp, 0);
      } finally {
        await db.referralBonusConfig.delete({ where: { id: created.id } });
      }
    });

    await check("HTTP: an ACTIVE programme pays exactly the configured amounts", async () => {
      const created = await db.referralBonusConfig.create({
        data: { slug: DEFAULT_REFERRAL_BONUS_SLUG, isActive: true, inviterXp: 100, invitedXp: 50 },
      });
      const inviterBefore = await db.user.findUniqueOrThrow({ where: { id: inviterHttp.id } });
      try {
        const result = await register({
          email: `afd3a2-active-${stamp}@example.invalid`,
          password: PASSWORD,
          referralCode: inviterHttp.referralCode,
          captchaToken: DUMMY_TOKEN,
        });
        assert.equal(result.status, 201, JSON.stringify(result.body));

        const invitee = await db.user.findUniqueOrThrow({
          where: { email: `afd3a2-active-${stamp}@example.invalid` },
          include: { invitedByReferral: true },
        });
        const relation = invitee.invitedByReferral;
        assert.ok(relation);
        // Byte-identical to the pre-AFD-3A2 reward behaviour.
        assert.equal(relation.xpEarned, created.inviterXp);
        assert.equal(relation.invitedXpEarned, created.invitedXp);
        assert.notEqual(relation.bonusGrantedAt, null);
        assert.equal(invitee.xp, created.invitedXp);

        const inviterAfter = await db.user.findUniqueOrThrow({ where: { id: inviterHttp.id } });
        assert.equal(inviterAfter.xp, inviterBefore.xp + created.inviterXp);

        const events = await db.xpEvent.findMany({
          where: { userId: { in: [invitee.id, inviterHttp.id] } },
          orderBy: { id: "asc" },
        });
        assert.equal(events.length, 2);
        assert.deepEqual(
          events.map((e) => e.source).sort(),
          ["referral_invited", "referral_inviter"],
        );

        const notifications = await db.notification.count({
          where: { userId: { in: [invitee.id, inviterHttp.id] }, type: "referral_bonus" },
        });
        assert.equal(notifications, 2);

        const granted = await db.auditLog.count({
          where: { action: "REFERRAL_BONUS_GRANTED", entityId: String(invitee.id) },
        });
        assert.equal(granted, 1);
      } finally {
        await db.referralBonusConfig.delete({ where: { id: created.id } });
      }
    });

    await check("HTTP: one invitee can hold only one relationship", async () => {
      const invitee = await db.user.findUniqueOrThrow({
        where: { email: `afd3a2-ref-${stamp}@example.invalid` },
      });
      // `invitedUserId` is @unique: a duplicate is impossible, not merely rare.
      await assert.rejects(
        db.referral.create({
          data: { inviterUserId: inviterHttp.id, invitedUserId: invitee.id },
        }),
      );
      assert.equal(await db.referral.count({ where: { invitedUserId: invitee.id } }), 1);
    });

    await check("HTTP: concurrent invites from one inviter each get their own relation", async () => {
      const emails = [1, 2, 3].map((n) => `afd3a2-conc${n}-${stamp}@example.invalid`);
      const results = await Promise.all(
        emails.map((email, index) =>
          register(
            {
              email,
              password: PASSWORD,
              referralCode: inviterHttp.referralCode,
              captchaToken: DUMMY_TOKEN,
            },
            `198.51.101.${index + 1}`,
          ),
        ),
      );
      for (const result of results) {
        assert.equal(result.status, 201, JSON.stringify(result.body));
      }
      const created = await db.user.findMany({
        where: { email: { in: emails } },
        include: { invitedByReferral: true },
      });
      assert.equal(created.length, 3);
      for (const user of created) {
        assert.ok(user.invitedByReferral, `${user.email} has no relationship`);
        // Still no reward: there is no active programme.
        assert.equal(user.invitedByReferral.bonusGrantedAt, null);
        assert.equal(user.xp, 0);
      }
    });

    await check("HTTP: a duplicate email is refused and creates no second relation", async () => {
      const before = await db.referral.count();
      const result = await register({
        email: `afd3a2-ref-${stamp}@example.invalid`,
        password: PASSWORD,
        referralCode: inviterHttp.referralCode,
        captchaToken: DUMMY_TOKEN,
      });
      assert.equal(result.status, 400);
      assert.equal(await db.referral.count(), before);
    });

    await check("HTTP: registration enrols nobody and creates no Pocket identity", async () => {
      const invitee = await db.user.findUniqueOrThrow({
        where: { email: `afd3a2-ref-${stamp}@example.invalid` },
      });
      assert.equal(await db.userCurriculumEnrollment.count({ where: { userId: invitee.id } }), 0);
      assert.equal(await db.pocketTraderIdentity.count({ where: { userId: invitee.id } }), 0);
      assert.equal(await db.exchangeAccount.count({ where: { userId: invitee.id } }), 0);
    });

    await check("HTTP: the rate limit is unchanged at 3 per 30 minutes per IP", async () => {
      const ip = "198.51.102.77";
      const statuses: number[] = [];
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const result = await register(
          {
            email: `afd3a2-rl${attempt}-${stamp}@example.invalid`,
            password: PASSWORD,
            captchaToken: DUMMY_TOKEN,
          },
          ip,
        );
        statuses.push(result.status);
      }
      assert.deepEqual(statuses.slice(0, 3), [201, 201, 201], `got ${statuses.join(",")}`);
      assert.equal(statuses[3], 429, `fourth attempt was ${statuses[3]}`);
    });

    await check("HTTP: the rate limit is enforced BEFORE the provider is consulted", async () => {
      // Ordering matters: a limiter that ran after Siteverify would let an
      // attacker burn Cloudflare quota for free.
      const ip = "198.51.103.88";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await register(
          { email: `afd3a2-rlo${attempt}-${stamp}@example.invalid`, password: PASSWORD, captchaToken: DUMMY_TOKEN },
          ip,
        );
      }
      const exhausted = await register(
        { email: `afd3a2-rlo4-${stamp}@example.invalid`, password: PASSWORD },
        ip,
      );
      // No token at all, yet the answer is 429 rather than CAPTCHA_FAILED.
      assert.equal(exhausted.status, 429);
    });

    await check("no token and no secret reached the server log", () => {
      assert.equal(serverLogs.includes(DUMMY_TOKEN), false, "a token was logged");
      assert.equal(serverLogs.includes(SECRET_PASS), false, "the secret was logged");
    });

    }); // end pass 1

    // ---- pass 2: the "always fails" secret --------------------------------
    if (!SECRET_FAIL) {
      console.log("SKIP D2: AFD3A2_TURNSTILE_TEST_SECRET_FAIL was not supplied");
    } else {
      await withServer(SECRET_FAIL, 1, async () => {
        await check("HTTP: a token Cloudflare rejects creates nothing", async () => {
          const before = await db.user.count();
          const result = await register({
            email: `afd3a2-rejected-${stamp}@example.invalid`,
            password: PASSWORD,
            captchaToken: DUMMY_TOKEN,
          });
          assert.equal(result.status, 400, JSON.stringify(result.body));
          assert.equal(result.body?.error, "CAPTCHA_FAILED");
          // The decisive assertion: rejection happens BEFORE the transaction,
          // so there is no user, no referral row and no XP event to clean up.
          assert.equal(await db.user.count(), before);
          assert.equal(
            await db.user.count({ where: { email: `afd3a2-rejected-${stamp}@example.invalid` } }),
            0,
          );
        });

        await check("HTTP: a rejected challenge does not even reach referral resolution", async () => {
          const relationsBefore = await db.referral.count();
          const result = await register({
            email: `afd3a2-rejected-ref-${stamp}@example.invalid`,
            password: PASSWORD,
            // A perfectly valid inviter. The CAPTCHA still refuses first.
            referralCode: inviterHttp.referralCode,
            captchaToken: DUMMY_TOKEN,
          });
          assert.equal(result.status, 400);
          assert.equal(result.body?.error, "CAPTCHA_FAILED");
          assert.equal(await db.referral.count(), relationsBefore);
        });

        await check("HTTP: a rejected challenge issues no session cookie", async () => {
          const result = await register({
            email: `afd3a2-rejected-session-${stamp}@example.invalid`,
            password: PASSWORD,
            captchaToken: DUMMY_TOKEN,
          });
          assert.equal(result.status, 400);
          assert.equal(result.cookies.length, 0);
        });
      });
    }

    // ---- pass 3: the "token already spent" secret -------------------------
    if (!SECRET_SPENT) {
      console.log("SKIP D3: AFD3A2_TURNSTILE_TEST_SECRET_SPENT was not supplied");
    } else {
      await withServer(SECRET_SPENT, 2, async () => {
        await check("HTTP: a replayed (already spent) token is refused", async () => {
          const before = await db.user.count();
          const result = await register({
            email: `afd3a2-replay-${stamp}@example.invalid`,
            password: PASSWORD,
            captchaToken: DUMMY_TOKEN,
          });
          // Cloudflare answers `timeout-or-duplicate`, which the platform maps
          // to `expired_or_duplicate` and reports as a failed check.
          assert.equal(result.status, 400, JSON.stringify(result.body));
          assert.equal(result.body?.error, "CAPTCHA_FAILED");
          assert.equal(await db.user.count(), before);
        });

        await check("HTTP: replaying the same token twice never succeeds", async () => {
          const first = await register({
            email: `afd3a2-replay2-${stamp}@example.invalid`,
            password: PASSWORD,
            captchaToken: DUMMY_TOKEN,
          });
          const second = await register({
            email: `afd3a2-replay2-${stamp}@example.invalid`,
            password: PASSWORD,
            captchaToken: DUMMY_TOKEN,
          });
          assert.equal(first.status, 400);
          assert.equal(second.status, 400);
          // There is no automatic retry that could turn a spent token into a pass.
          assert.equal(
            await db.user.count({ where: { email: `afd3a2-replay2-${stamp}@example.invalid` } }),
            0,
          );
        });
      });
    }

    await db.$disconnect();
  }
}

main()
  .then(async () => {
    await stopServer();
    cleanup();
    console.log(`\nregistration referral regression: ${passed} passed, ${failed} failed`);
    if (serverPid) console.log(`isolated server pid was ${serverPid} on port ${port}`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch(async (error) => {
    console.error(error);
    await stopServer();
    cleanup();
    console.log(`\nregistration referral regression: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  });
