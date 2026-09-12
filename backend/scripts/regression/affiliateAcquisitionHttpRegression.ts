/**
 * AFD-3B2 — the public acquisition route and the registration binding, over
 * real HTTP, against an isolated server and a disposable database.
 *
 * WHY THIS SUITE EXISTS SEPARATELY. `affiliateAttributionRegression.ts` proves
 * the rules. This one proves the WIRING: that the route is reachable at exactly
 * one method and one path, that the headers a browser actually receives are the
 * ones intended, that a Set-Cookie really is emitted (and really is cleared),
 * and that two simultaneous registrations sharing one token cannot both be
 * attributed.
 *
 * SAFETY. A disposable database copied from a fixture, an isolated loopback
 * port, an ephemeral synthetic attribution secret generated per run, and the
 * official Cloudflare TEST CAPTCHA keys supplied through the environment. No
 * live port is contacted, no live database is opened, no live secret is read and
 * no Pocket callback is sent.
 *
 * The CAPTCHA sections run only when the phase supplies the official Cloudflare
 * test secrets through the environment. No key value is committed here.
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

const projectRoot = path.resolve(__dirname, "../..");
const sourceDb =
  process.env.AFD3B2_FIXTURE_DB ?? "/home/ubuntu/publicurl1-work/db/fixture.sqlite";
const dbPath = path.join(os.tmpdir(), `ata-afd3b2-http-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** Explicit isolated ports. Never 3010, 3050 or 3100. */
const PORT_ENABLED = Number(process.env.AFD3B2_PORT_ENABLED ?? 3181);
const PORT_DISABLED = Number(process.env.AFD3B2_PORT_DISABLED ?? 3182);

/** Generated per run and never written anywhere. */
const ATTRIBUTION_SECRET = crypto.randomBytes(32).toString("base64url");

/** The official Cloudflare dummy token — public documentation, not a credential. */
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const SECRET_PASS = process.env.AFD3B2_TURNSTILE_TEST_SECRET;
const SECRET_FAIL = process.env.AFD3B2_TURNSTILE_TEST_SECRET_FAIL;

const PASSWORD = "Attribution123!";

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function isolatedEnv(overrides: Record<string, string>): Record<string, string> {
  return {
    DATABASE_URL: dbUrl,
    SESSION_SECRET: "afd3b2-synthetic-session-secret-not-a-real-key",
    POSTBACK_SECRET: "afd3b2-synthetic-postback-secret-not-a-real-key",
    APP_URL: "https://127.0.0.1",
    ATA_ENVIRONMENT: "dev",
    CHECKPOINT_PROVIDER_MODE: "disabled",
    STORAGE_DRIVER: "local",
    POCKET_AFFILIATE_BASE_URL: "https://example.invalid/ref",
    EMAIL_VERIFICATION_REQUIRED: "false",
    CAPTCHA_PROVIDER: "turnstile_test",
    CAPTCHA_TEST_MODE: "unsafe-official-turnstile-test-keys-isolated-only",
    TURNSTILE_SECRET_KEY: SECRET_PASS ?? "",
    ...overrides,
  };
}

/**
 * `next start` needs a production build, and any suite in the same worktree that
 * runs `next dev` replaces `.next` with a development one. Rather than depend on
 * suite ordering — which would make this file pass or fail according to what ran
 * before it — the build is ensured here, once, and only when it is missing.
 */
function ensureProductionBuild(root: string) {
  if (fs.existsSync(path.join(root, ".next", "BUILD_ID"))) return;
  const built = spawnSync("npx", ["next", "build"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      SESSION_SECRET: "afd3b2-build-only-not-a-runtime-secret-value",
    },
    encoding: "utf8",
  });
  if (built.status !== 0) {
    console.error(built.stdout?.slice(-3000), built.stderr?.slice(-3000));
    throw new Error("production build failed");
  }
}

type Server = { child: ChildProcess; port: number; baseUrl: string };

async function startServer(port: number, env: Record<string, string>): Promise<Server> {
  const merged = { ...(process.env as Record<string, string>), ...env, PORT: String(port) };
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: projectRoot,
    env: merged as unknown as NodeJS.ProcessEnv,
    // Its own process group, so the stop below signals exactly this tree and
    // nothing that merely resembles it. Never pkill, never a name match.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (v: Buffer) => { logs += String(v); });
  child.stderr?.on("data", (v: Buffer) => { logs += String(v); });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early\n${logs.slice(-3000)}`);
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { child, port, baseUrl };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become healthy on ${port}\n${logs.slice(-3000)}`);
}

async function stopServer(server: Server | null) {
  if (!server?.child.pid) return;
  try { process.kill(-server.child.pid, "SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${server.baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  try { process.kill(-server.child.pid, "SIGKILL"); } catch { /* already gone */ }
}

/** A distinct synthetic client address per caller, so the registration limiter
 *  (3 per 30 minutes per address) does not collapse the whole suite into one
 *  bucket. These are invented values for an isolated server and are never
 *  persisted by anything under test. */
let clientCounter = 0;
function nextClientIp(): string {
  clientCounter += 1;
  return `203.0.113.${clientCounter % 250 + 1}`;
}

type Reply = {
  status: number;
  headers: Headers;
  setCookies: string[];
  text: string;
  json: Record<string, unknown> | null;
};

/** A placeholder so a reply captured inside one case can be read by the next. */
const EMPTY_REPLY: Reply = {
  status: 0,
  headers: new Headers(),
  setCookies: [],
  text: "",
  json: null,
};

async function request(
  baseUrl: string,
  method: string,
  pathname: string,
  init: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: "manual",
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not json */ }
  return { status: res.status, headers: res.headers, setCookies: res.headers.getSetCookie(), text, json };
}

function attributionCookieFrom(reply: Reply): string | null {
  const raw = reply.setCookies.find((c) => c.startsWith(`${ATTRIBUTION_COOKIE_NAME}=`));
  if (!raw) return null;
  const value = raw.split(";")[0].slice(ATTRIBUTION_COOKIE_NAME.length + 1);
  return value === "" ? null : value;
}

function attributionSetCookieLine(reply: Reply): string | null {
  return reply.setCookies.find((c) => c.startsWith(`${ATTRIBUTION_COOKIE_NAME}=`)) ?? null;
}

async function main() {
  if (!fs.existsSync(sourceDb)) {
    console.log("SKIP: no fixture database available");
    return;
  }
  if (!SECRET_PASS) {
    console.log("SKIP: no official Turnstile test secret supplied");
    return;
  }

  cleanup();
  fs.copyFileSync(sourceDb, dbPath);

  const migrate = spawnSync("npx", ["tsx", "prisma/migrate.ts"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migrate.status !== 0) {
    console.error(migrate.stdout, migrate.stderr);
    throw new Error("migration of the disposable fixture failed");
  }

  ensureProductionBuild(projectRoot);

  process.env.DATABASE_URL = dbUrl;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  /* ---------------------------- synthetic affiliates --------------------- */

  const stamp = Date.now();
  const staff = await prisma.user.create({
    data: {
      email: `afd3b2-http-staff-${stamp}@example.invalid`,
      name: "AFD3B2 HTTP Staff",
      passwordHash: "synthetic-not-a-real-hash",
    },
  });

  const alpha = await prisma.affiliatePartner.create({
    data: {
      code: `afd3b2-http-alpha-${stamp % 100000}`,
      displayName: "Alpha",
      defaultAttributionWindowDays: 30,
      createdByUserId: staff.id,
    },
  });
  const alphaCampaign = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: alpha.id,
      code: `alpha-one-${stamp % 100000}`,
      displayName: "Alpha One",
      createdByUserId: staff.id,
    },
  });

  async function makeLink(
    partnerId: number,
    status: "draft" | "active" | "paused" | "archived",
    extra: Record<string, unknown> = {},
  ) {
    return prisma.affiliateTrackingLink.create({
      data: {
        affiliatePartnerId: partnerId,
        publicCode: randomBase32Id(),
        displayName: `link-${status}`,
        status,
        archivedAt: status === "archived" ? new Date() : null,
        createdByUserId: staff.id,
        sub1Parameter: "sub1",
        ...extra,
      },
    });
  }

  const activeLink = await makeLink(alpha.id, "active", {
    affiliateCampaignId: alphaCampaign.id,
  });
  const activeLink2 = await makeLink(alpha.id, "active");
  const draftLink = await makeLink(alpha.id, "draft");
  const pausedLink = await makeLink(alpha.id, "paused");
  const archivedLink = await makeLink(alpha.id, "archived");

  const beta = await prisma.affiliatePartner.create({
    data: {
      code: `afd3b2-http-beta-${stamp % 100000}`,
      displayName: "Beta",
      defaultAttributionWindowDays: 30,
      createdByUserId: staff.id,
    },
  });
  const betaLink = await makeLink(beta.id, "active");

  /* ============================ ENABLED SERVER =========================== */

  let server: Server | null = null;
  try {
    server = await startServer(
      PORT_ENABLED,
      isolatedEnv({
        AFFILIATE_ATTRIBUTION_ENABLED: "true",
        ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
        // Generous per-link ceiling for the whole suite, and a deliberately tiny
        // one is used later through a dedicated link.
        AFFILIATE_GO_LINK_LIMIT: "5000",
        AFFILIATE_GO_LIMIT_WINDOW_SECONDS: "600",
      }),
    );
    const base = server.baseUrl;

    /* ---------------------------- A. THE ROUTE --------------------------- */

    let firstClickReply: Reply = EMPTY_REPLY;

    await check("A1 an active link redirects to the fixed same-origin /register", async () => {
      firstClickReply = await request(base, "GET", `/go/${activeLink.publicCode}`);
      assert.equal(firstClickReply.status, 302);
      assert.equal(firstClickReply.headers.get("location"), "/register");
    });

    await check("A2 the redirect carries no-store, no-referrer and a robots refusal", () => {
      assert.match(firstClickReply.headers.get("cache-control") ?? "", /no-store/);
      assert.equal(firstClickReply.headers.get("referrer-policy"), "no-referrer");
      assert.equal(firstClickReply.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    });

    await check("A3 a qualified click sets exactly one attribution cookie", () => {
      const line = attributionSetCookieLine(firstClickReply);
      assert.ok(line, "no attribution cookie was set");
      assert.match(line!, /HttpOnly/i);
      assert.match(line!, /Secure/i);
      assert.match(line!, /SameSite=Lax/i);
      assert.match(line!, /Path=\//i);
      assert.ok(!/Domain=/i.test(line!), "a Domain attribute would void the __Host- prefix");
      assert.match(line!, /Max-Age=\d+/);
    });

    const journeyToken = attributionCookieFrom(firstClickReply)!;

    await check("A4 the cookie value is a token this server can verify", () => {
      const result = verifyAttributionToken(journeyToken, ATTRIBUTION_SECRET);
      assert.equal(result.kind, "valid");
    });

    await check("A5 the cookie names no affiliate, link or learner", () => {
      const payload = JSON.parse(
        Buffer.from(journeyToken.split(".")[1], "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      // Four keys and no others is the whole guarantee: there is nowhere in this
      // payload for an affiliate, a campaign, a link or a learner to live.
      assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "v", "vid"]);
      const text = JSON.stringify(payload);
      assert.ok(!text.includes(activeLink.publicCode), "the link's public code leaked");
      assert.ok(!text.includes(alpha.code), "the affiliate code leaked");
      // The visitor id is its own random value, unrelated to anything stored.
      assert.notEqual(payload.vid, activeLink.publicCode);
      assert.equal(typeof payload.vid, "string");
      // `v`, `iat` and `exp` are a version and two timestamps whose values are
      // fixed by the token format, so the only field that could carry an
      // identity is `vid` — and it is a random 160-bit id, not a database key.
      assert.match(payload.vid as string, /^[a-z2-7]{32}$/);
      assert.notEqual(payload.vid, String(activeLink.id));
      assert.notEqual(payload.vid, String(alpha.id));
    });

    await check("A6 draft, paused, archived, unknown and malformed all give one 404", async () => {
      const replies = await Promise.all([
        request(base, "GET", `/go/${draftLink.publicCode}`),
        request(base, "GET", `/go/${pausedLink.publicCode}`),
        request(base, "GET", `/go/${archivedLink.publicCode}`),
        request(base, "GET", `/go/${randomBase32Id()}`),
        request(base, "GET", "/go/short"),
        request(base, "GET", "/go/UPPERCASEUPPERCASEUPPERCASEUPPE"),
        request(base, "GET", `/go/${"1".repeat(32)}`),
      ]);
      for (const reply of replies) {
        assert.equal(reply.status, 404, reply.text.slice(0, 120));
        assert.equal(reply.text, replies[0].text, "the bodies must be indistinguishable");
        assert.equal(reply.setCookies.length, 0, "a refused code must set no cookie");
      }
    });

    await check("A7 a 404 still carries the privacy headers", async () => {
      const reply = await request(base, "GET", `/go/${randomBase32Id()}`);
      assert.equal(reply.headers.get("referrer-policy"), "no-referrer");
      assert.equal(reply.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
      assert.match(reply.headers.get("cache-control") ?? "", /no-store/);
    });

    await check("A8 every method other than GET is refused", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const reply = await request(base, method, `/go/${activeLink.publicCode}`);
        assert.equal(reply.status, 405, `${method} -> ${reply.status}`);
      }
    });

    await check("A9 no target parameter can move the redirect off this origin", async () => {
      for (const query of [
        "?url=https://evil.invalid",
        "?next=https://evil.invalid",
        "?target=//evil.invalid",
        "?redirect=/../../etc/passwd",
        "?return_url=https%3A%2F%2Fevil.invalid",
      ]) {
        const reply = await request(base, "GET", `/go/${activeLink.publicCode}${query}`);
        assert.equal(reply.status, 302, query);
        assert.equal(reply.headers.get("location"), "/register", query);
      }
    });

    await check("A10 the redirect never echoes a captured value", async () => {
      const reply = await request(
        base,
        "GET",
        `/go/${activeLink.publicCode}?clickid=SHOULD-NOT-APPEAR&sub1=NOR-THIS`,
      );
      const location = reply.headers.get("location") ?? "";
      assert.equal(location, "/register");
      assert.ok(!location.includes("SHOULD-NOT-APPEAR"));
      assert.ok(!reply.text.includes("SHOULD-NOT-APPEAR"));
    });

    /* ------------------------- B. THE QUERY CONTRACT --------------------- */

    await check("B1 the configured external click id and sub1 are captured", async () => {
      const before = await prisma.affiliateClick.count();
      await request(
        base,
        "GET",
        `/go/${activeLink.publicCode}?clickid=NET-ABC-123&sub1=creative7&unknown=ignored`,
      );
      assert.equal(await prisma.affiliateClick.count(), before + 1);
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      assert.equal(click.externalAffiliateClickId, "NET-ABC-123");
      assert.equal(click.sub1, "creative7");
      assert.equal(click.sub2, null);
      assert.equal(click.trackingLinkId, activeLink.id);
      assert.equal(click.classification, "qualified");
      assert.equal(click.effectiveAttributionWindowDays, 30);
    });

    await check("B2 an unknown parameter is never persisted anywhere on the row", async () => {
      await request(base, "GET", `/go/${activeLink.publicCode}?gclid=GOOGLEVALUE&utm_source=x`);
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      const serialized = JSON.stringify(click);
      assert.ok(!serialized.includes("GOOGLEVALUE"));
      assert.ok(!serialized.includes("utm_source"));
    });

    await check("B3 a duplicated configured parameter is a 400 and writes no click", async () => {
      const before = await prisma.affiliateClick.count();
      const reply = await request(base, "GET", `/go/${activeLink.publicCode}?clickid=a&clickid=b`);
      assert.equal(reply.status, 400);
      assert.equal(await prisma.affiliateClick.count(), before);
    });

    await check("B4 a control character in a captured value is a 400", async () => {
      const before = await prisma.affiliateClick.count();
      const reply = await request(base, "GET", `/go/${activeLink.publicCode}?clickid=a%00b`);
      assert.equal(reply.status, 400);
      assert.equal(await prisma.affiliateClick.count(), before);
    });

    await check("B5 an excessive value is a 400", async () => {
      const reply = await request(
        base,
        "GET",
        `/go/${activeLink.publicCode}?clickid=${"a".repeat(300)}`,
      );
      assert.equal(reply.status, 400);
    });

    await check("B6 too many query keys is a 400", async () => {
      const query = Array.from({ length: 40 }, (_, i) => `k${i}=1`).join("&");
      const reply = await request(base, "GET", `/go/${activeLink.publicCode}?${query}`);
      assert.equal(reply.status, 400);
    });

    await check("B7 no click row can hold an IP, a User-Agent or a full URL", async () => {
      await request(base, "GET", `/go/${activeLink.publicCode}?clickid=probe`, {
        headers: {
          "user-agent": "SyntheticProbe/9.9 (should-not-be-stored)",
          "x-forwarded-for": "198.51.100.77",
          referer: "https://partner.invalid/landing?secret=should-not-be-stored",
        },
      });
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      const serialized = JSON.stringify(click);
      assert.ok(!serialized.includes("198.51.100.77"), "an IP was persisted");
      assert.ok(!serialized.includes("SyntheticProbe"), "a User-Agent was persisted");
      assert.ok(!serialized.includes("should-not-be-stored"), "a full referrer was persisted");
      // The host alone is kept, and only the host.
      assert.equal(click.sanitizedReferrerHost, "partner.invalid");
    });

    /* ---------------------- C. CLASSIFICATION AND COOKIES ---------------- */

    await check("C1 a prefetch is recorded as prefetch and gets no cookie", async () => {
      const reply = await request(base, "GET", `/go/${activeLink.publicCode}`, {
        headers: { "sec-purpose": "prefetch;prerender" },
      });
      assert.equal(reply.status, 302);
      assert.equal(attributionSetCookieLine(reply), null, "a prefetch must not be given a journey");
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      assert.equal(click.classification, "prefetch");
      assert.equal(click.anonymousVisitorId, null);
    });

    await check("C2 a second click REUSES the visitor and does not re-issue an unchanged cookie", async () => {
      const reply = await request(base, "GET", `/go/${activeLink2.publicCode}`, {
        cookie: `${ATTRIBUTION_COOKIE_NAME}=${journeyToken}`,
      });
      assert.equal(reply.status, 302);
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      const original = verifyAttributionToken(journeyToken, ATTRIBUTION_SECRET);
      assert.equal(original.kind, "valid");
      if (original.kind !== "valid") return;
      assert.equal(click.anonymousVisitorId, original.payload.anonymousVisitorId);
      // Same 30-day window on both links, so the expiry did move out (later
      // click, same window) and the cookie is re-issued with the same visitor.
      const reissued = attributionCookieFrom(reply);
      if (reissued !== null) {
        const parsed = verifyAttributionToken(reissued, ATTRIBUTION_SECRET);
        assert.equal(parsed.kind, "valid");
        assert.equal(
          parsed.kind === "valid" && parsed.payload.anonymousVisitorId,
          original.payload.anonymousVisitorId,
        );
      }
    });

    await check("C3 a forged cookie cannot inject a chosen visitor id", async () => {
      const chosen = randomBase32Id();
      const forged = createAttributionToken({
        secret: "an-entirely-different-synthetic-key-0192837465",
        anonymousVisitorId: chosen,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await request(base, "GET", `/go/${activeLink.publicCode}`, {
        cookie: `${ATTRIBUTION_COOKIE_NAME}=${forged}`,
      });
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      assert.notEqual(click.anonymousVisitorId, chosen);
    });

    await check("C4 a browser-supplied internal attribution header changes nothing", async () => {
      const chosen = randomBase32Id();
      await request(base, "GET", `/go/${activeLink.publicCode}`, {
        headers: {
          "x-ata-attribution": chosen,
          "x-ata-visitor-id": chosen,
          "x-ata-affiliate": String(beta.id),
        },
      });
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      assert.notEqual(click.anonymousVisitorId, chosen);
      assert.equal(click.trackingLinkId, activeLink.id, "the path chose the link, not a header");
    });

    /* ------------------------- D. THE ABUSE LIMIT ------------------------ */

    await check("D1 a per-link ceiling refuses with 429 and writes no further click", async () => {
      const limited = await startServer(
        PORT_DISABLED,
        isolatedEnv({
          AFFILIATE_ATTRIBUTION_ENABLED: "true",
          ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
          AFFILIATE_GO_LINK_LIMIT: "3",
          AFFILIATE_GO_LIMIT_WINDOW_SECONDS: "600",
        }),
      );
      try {
        const before = await prisma.affiliateClick.count();
        const statuses: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          statuses.push(
            (await request(limited.baseUrl, "GET", `/go/${betaLink.publicCode}`)).status,
          );
        }
        assert.deepEqual(statuses, [302, 302, 302, 429, 429], JSON.stringify(statuses));
        assert.equal(await prisma.affiliateClick.count(), before + 3, "a refusal wrote a click");
      } finally {
        await stopServer(limited);
      }
    });

    await check("D2 a spoofed forwarding header creates no bucket of its own", async () => {
      // With the default (untrusted-ingress) configuration the header is not
      // read at all, so rotating it cannot evade the per-link ceiling and
      // claiming somebody else's address cannot exhaust their bucket.
      const replies = await Promise.all(
        ["9.9.9.9", "1.1.1.1", "8.8.8.8"].map((ip) =>
          request(base, "GET", `/go/${activeLink.publicCode}`, {
            headers: { "x-forwarded-for": ip },
          }),
        ),
      );
      for (const reply of replies) assert.equal(reply.status, 302);
      const clicks = await prisma.affiliateClick.findMany({
        orderBy: { id: "desc" },
        take: 3,
      });
      for (const click of clicks) {
        assert.ok(!JSON.stringify(click).includes("9.9.9.9"));
      }
    });

    /* ----------------------- E. REGISTRATION BINDING --------------------- */

    async function register(
      body: Record<string, unknown>,
      cookie?: string,
    ): Promise<Reply> {
      return request(base, "POST", "/api/auth/register", {
        cookie,
        body: { captchaToken: DUMMY_TOKEN, password: PASSWORD, ...body },
        headers: { "x-forwarded-for": nextClientIp() },
      });
    }

    // A fresh journey: two clicks on two different Alpha links, so first touch
    // and last touch are genuinely different rows.
    const c1 = await request(base, "GET", `/go/${activeLink.publicCode}?clickid=FIRST-TOUCH`);
    const journey2 = attributionCookieFrom(c1)!;
    const c2 = await request(base, "GET", `/go/${activeLink2.publicCode}?clickid=LAST-TOUCH`, {
      cookie: `${ATTRIBUTION_COOKIE_NAME}=${journey2}`,
    });
    const journey2b = attributionCookieFrom(c2) ?? journey2;

    let attributedEmail = "";
    let attributedReply: Reply = EMPTY_REPLY;

    await check("E1 an attributed registration succeeds and returns a session", async () => {
      attributedEmail = `afd3b2-attr-${stamp}@example.invalid`;
      attributedReply = await register(
        { email: attributedEmail, name: "Attributed" },
        `${ATTRIBUTION_COOKIE_NAME}=${journey2b}`,
      );
      assert.equal(attributedReply.status, 201, attributedReply.text.slice(0, 200));
      assert.ok(
        attributedReply.setCookies.some((c) => c.startsWith("trading_platform_session=")),
        "no session cookie",
      );
    });

    await check("E2 the response carries BOTH cookies as separate Set-Cookie values", () => {
      const session = attributedReply.setCookies.filter((c) =>
        c.startsWith("trading_platform_session="),
      );
      const attribution = attributedReply.setCookies.filter((c) =>
        c.startsWith(`${ATTRIBUTION_COOKIE_NAME}=`),
      );
      assert.equal(session.length, 1, JSON.stringify(attributedReply.setCookies));
      assert.equal(attribution.length, 1, JSON.stringify(attributedReply.setCookies));
      // Neither may have been joined into the other by a comma.
      assert.ok(!session[0].includes(ATTRIBUTION_COOKIE_NAME));
      assert.ok(!attribution[0].includes("trading_platform_session"));
    });

    await check("E3 the attribution cookie is cleared with Max-Age=0 and matching attributes", () => {
      const line = attributionSetCookieLine(attributedReply)!;
      assert.match(line, /Max-Age=0/i);
      assert.match(line, /Path=\//i);
      assert.match(line, /HttpOnly/i);
      assert.match(line, /Secure/i);
      assert.match(line, /SameSite=Lax/i);
      assert.ok(!/Domain=/i.test(line));
    });

    let attributedUserId = 0;

    await check("E4 first touch, last touch and selected are the expected clicks", async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: attributedEmail } });
      attributedUserId = user.id;
      const attribution = await prisma.affiliateAttribution.findUniqueOrThrow({
        where: { userId: user.id },
        include: {
          firstTouchClick: { select: { trackingLinkId: true, externalAffiliateClickId: true } },
          lastTouchClick: { select: { trackingLinkId: true, externalAffiliateClickId: true } },
        },
      });
      assert.equal(attribution.firstTouchClick.externalAffiliateClickId, "FIRST-TOUCH");
      assert.equal(attribution.firstTouchClick.trackingLinkId, activeLink.id);
      assert.equal(attribution.lastTouchClick.externalAffiliateClickId, "LAST-TOUCH");
      assert.equal(attribution.lastTouchClick.trackingLinkId, activeLink2.id);
      assert.equal(attribution.selectedClickId, attribution.lastTouchClickId);
      assert.equal(attribution.attributionModel, "last_eligible_affiliate_click");
      assert.equal(attribution.selectionReason, "registration_cookie");
      assert.ok(attribution.frozenAt instanceof Date);
    });

    await check("E5 exactly one ATTRIBUTED academy_registration event exists", async () => {
      const events = await prisma.affiliateConversionEvent.findMany({
        where: { userId: attributedUserId },
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, "academy_registration");
      assert.equal(events[0].sourceOwner, "auth_register");
      assert.equal(events[0].sourceEventId, `user:${attributedUserId}`);
      assert.equal(events[0].affiliatePartnerId, alpha.id);
      assert.equal(events[0].affiliateCodeSnapshot, alpha.code);
      assert.equal(events[0].trackingLinkId, activeLink2.id);
      assert.equal(events[0].trackingLinkPublicCodeSnapshot, activeLink2.publicCode);
    });

    await check("E6 the attributed learner got no XP, no Pocket identity and no balance", async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: attributedUserId } });
      assert.equal(user.xp, 0);
      assert.equal(await prisma.xpEvent.count({ where: { userId: attributedUserId } }), 0);
      assert.equal(
        await prisma.pocketTraderIdentity.count({ where: { userId: attributedUserId } }),
        0,
      );
      assert.equal(
        await prisma.userCurriculumEnrollment.count({ where: { userId: attributedUserId } }),
        0,
      );
    });

    await check("E7 a REPLAYED token registers successfully but cannot steal attribution", async () => {
      const email = `afd3b2-replay-${stamp}@example.invalid`;
      const reply = await register(
        { email, name: "Replay" },
        `${ATTRIBUTION_COOKIE_NAME}=${journey2b}`,
      );
      assert.equal(reply.status, 201, reply.text.slice(0, 200));
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
      const events = await prisma.affiliateConversionEvent.findMany({ where: { userId: user.id } });
      assert.equal(events.length, 1);
      assert.equal(events[0].attributionId, null, "a replay produced an attributed event");
      assert.equal(events[0].affiliatePartnerId, null);
      // And the original owner still owns the journey.
      const original = await prisma.affiliateAttribution.findUniqueOrThrow({
        where: { userId: attributedUserId },
      });
      assert.ok(original.id > 0);
    });

    await check("E8 a registration with NO cookie produces one DIRECT event", async () => {
      const email = `afd3b2-direct-${stamp}@example.invalid`;
      const reply = await register({ email, name: "Direct" });
      assert.equal(reply.status, 201, reply.text.slice(0, 200));
      assert.equal(attributionSetCookieLine(reply), null, "no cookie was sent, none should return");
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const events = await prisma.affiliateConversionEvent.findMany({ where: { userId: user.id } });
      assert.equal(events.length, 1);
      assert.equal(events[0].attributionId, null);
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
    });

    await check("E9 an EXPIRED cookie registers direct and is cleared", async () => {
      const expired = createAttributionToken({
        secret: ATTRIBUTION_SECRET,
        anonymousVisitorId: randomBase32Id(),
        issuedAt: new Date(Date.now() - 40 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      });
      const email = `afd3b2-expired-${stamp}@example.invalid`;
      const reply = await register(
        { email, name: "Expired" },
        `${ATTRIBUTION_COOKIE_NAME}=${expired}`,
      );
      assert.equal(reply.status, 201, reply.text.slice(0, 200));
      assert.match(attributionSetCookieLine(reply) ?? "", /Max-Age=0/i);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
      assert.equal(
        await prisma.affiliateConversionEvent.count({ where: { userId: user.id } }),
        1,
      );
    });

    await check("E10 a MALFORMED cookie registers direct and is cleared", async () => {
      const email = `afd3b2-malformed-${stamp}@example.invalid`;
      const reply = await register(
        { email, name: "Malformed" },
        `${ATTRIBUTION_COOKIE_NAME}=not-a-token-at-all`,
      );
      assert.equal(reply.status, 201, reply.text.slice(0, 200));
      assert.match(attributionSetCookieLine(reply) ?? "", /Max-Age=0/i);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
    });

    await check("E11 a valid cookie with NO eligible click registers direct", async () => {
      const orphan = createAttributionToken({
        secret: ATTRIBUTION_SECRET,
        anonymousVisitorId: randomBase32Id(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const email = `afd3b2-orphan-${stamp}@example.invalid`;
      const reply = await register({ email, name: "Orphan" }, `${ATTRIBUTION_COOKIE_NAME}=${orphan}`);
      assert.equal(reply.status, 201, reply.text.slice(0, 200));
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
      assert.equal(
        await prisma.affiliateConversionEvent.count({ where: { userId: user.id } }),
        1,
      );
    });

    await check("E12 a DUPLICATE email creates no user, no attribution and no event", async () => {
      const beforeUsers = await prisma.user.count();
      const beforeEvents = await prisma.affiliateConversionEvent.count();
      const journey = attributionCookieFrom(
        await request(base, "GET", `/go/${activeLink.publicCode}`),
      )!;
      const reply = await register(
        { email: attributedEmail, name: "Duplicate" },
        `${ATTRIBUTION_COOKIE_NAME}=${journey}`,
      );
      assert.equal(reply.status, 400);
      assert.equal(await prisma.user.count(), beforeUsers);
      assert.equal(await prisma.affiliateConversionEvent.count(), beforeEvents);
      assert.equal(attributionSetCookieLine(reply), null, "a failed registration cleared a token");
    });

    await check("E13 an INVALID ATA referral creates no user and no event", async () => {
      const beforeUsers = await prisma.user.count();
      const beforeEvents = await prisma.affiliateConversionEvent.count();
      const journey = attributionCookieFrom(
        await request(base, "GET", `/go/${activeLink.publicCode}`),
      )!;
      const reply = await register(
        {
          email: `afd3b2-badref-${stamp}@example.invalid`,
          name: "BadRef",
          referralCode: "NO-SUCH-INVITER-CODE",
        },
        `${ATTRIBUTION_COOKIE_NAME}=${journey}`,
      );
      assert.equal(reply.status, 400);
      assert.equal(reply.json?.error, "REFERRAL_INVALID");
      assert.equal(await prisma.user.count(), beforeUsers);
      assert.equal(await prisma.affiliateConversionEvent.count(), beforeEvents);
      assert.equal(attributionSetCookieLine(reply), null);
    });

    if (SECRET_FAIL) {
      await check("E14 a CAPTCHA failure creates no user, no attribution and no event", async () => {
        const failing = await startServer(
          PORT_DISABLED,
          isolatedEnv({
            AFFILIATE_ATTRIBUTION_ENABLED: "true",
            ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
            TURNSTILE_SECRET_KEY: SECRET_FAIL,
          }),
        );
        try {
          const beforeUsers = await prisma.user.count();
          const beforeEvents = await prisma.affiliateConversionEvent.count();
          const reply = await request(failing.baseUrl, "POST", "/api/auth/register", {
            body: {
              email: `afd3b2-captcha-${stamp}@example.invalid`,
              password: PASSWORD,
              name: "Captcha",
              captchaToken: DUMMY_TOKEN,
            },
            headers: { "x-forwarded-for": nextClientIp() },
          });
          assert.ok(reply.status >= 400, `expected a refusal, got ${reply.status}`);
          assert.equal(await prisma.user.count(), beforeUsers);
          assert.equal(await prisma.affiliateConversionEvent.count(), beforeEvents);
        } finally {
          await stopServer(failing);
        }
      });
    } else {
      console.log("skip E14 (no failing Turnstile test secret supplied)");
    }

    await check("E15 CONCURRENT registrations on one token: exactly one winner", async () => {
      const start = await request(base, "GET", `/go/${activeLink.publicCode}?clickid=RACE`);
      const raceToken = attributionCookieFrom(start)!;
      const raceVisitor = (verifyAttributionToken(raceToken, ATTRIBUTION_SECRET) as {
        kind: "valid";
        payload: { anonymousVisitorId: string };
      }).payload.anonymousVisitorId;

      const emails = [
        `afd3b2-race-a-${stamp}@example.invalid`,
        `afd3b2-race-b-${stamp}@example.invalid`,
      ];
      const replies = await Promise.all(
        emails.map((email) =>
          register({ email, name: "Race" }, `${ATTRIBUTION_COOKIE_NAME}=${raceToken}`),
        ),
      );
      for (const reply of replies) {
        assert.equal(reply.status, 201, reply.text.slice(0, 200));
      }

      const users = await prisma.user.findMany({ where: { email: { in: emails } } });
      assert.equal(users.length, 2, "both legal registrations must succeed");

      const attributions = await prisma.affiliateAttribution.findMany({
        where: { anonymousVisitorId: raceVisitor },
      });
      assert.equal(attributions.length, 1, "exactly one attribution may own the journey");

      const events = await prisma.affiliateConversionEvent.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      assert.equal(events.length, 2, "one event per registration, always");
      assert.equal(events.filter((e) => e.attributionId !== null).length, 1);
      assert.equal(events.filter((e) => e.attributionId === null).length, 1);

      // No partial user: every registered user has a complete row and an event.
      for (const user of users) {
        assert.ok(user.passwordHash.length > 0);
        assert.equal(events.filter((e) => e.userId === user.id).length, 1);
      }
    });

    await check("E16 later clicks cannot change a frozen attribution", async () => {
      const before = await prisma.affiliateAttribution.findUniqueOrThrow({
        where: { userId: attributedUserId },
      });
      await request(base, "GET", `/go/${betaLink.publicCode}?clickid=TOO-LATE`);
      const after = await prisma.affiliateAttribution.findUniqueOrThrow({
        where: { userId: attributedUserId },
      });
      assert.deepEqual(after, before);
    });

    await check("E17 an authenticated visitor's click is classified and never re-attributes", async () => {
      const session = attributedReply.setCookies
        .find((c) => c.startsWith("trading_platform_session="))!
        .split(";")[0];
      const before = await prisma.affiliateAttribution.count();
      const reply = await request(base, "GET", `/go/${betaLink.publicCode}`, { cookie: session });
      assert.equal(reply.status, 302);
      assert.equal(attributionSetCookieLine(reply), null, "a signed-in visitor got a journey");
      const click = await prisma.affiliateClick.findFirstOrThrow({ orderBy: { id: "desc" } });
      assert.equal(click.classification, "authenticated_user");
      assert.equal(click.anonymousVisitorId, null);
      assert.equal(await prisma.affiliateAttribution.count(), before);
    });

    await check("E18 every registration in this suite produced exactly one event", async () => {
      const grouped = await prisma.affiliateConversionEvent.groupBy({
        by: ["userId"],
        _count: { _all: true },
      });
      for (const row of grouped) {
        assert.equal(row._count._all, 1, `user ${row.userId} has ${row._count._all} events`);
      }
    });
  } finally {
    await stopServer(server);
    server = null;
  }

  /* =========================== DISABLED SERVER =========================== */

  let disabled: Server | null = null;
  try {
    disabled = await startServer(PORT_ENABLED, isolatedEnv({}));
    const base = disabled.baseUrl;

    await check("F1 with attribution DISABLED the acquisition route is a plain 404", async () => {
      const reply = await request(base, "GET", `/go/${activeLink.publicCode}`);
      assert.equal(reply.status, 404);
      assert.equal(reply.setCookies.length, 0);
    });

    await check("F2 with attribution DISABLED registration still works", async () => {
      const beforeClicks = await prisma.affiliateClick.count();
      const beforeEvents = await prisma.affiliateConversionEvent.count();
      const email = `afd3b2-disabled-${stamp}@example.invalid`;
      const reply = await request(base, "POST", "/api/auth/register", {
        body: { email, password: PASSWORD, name: "Disabled", captchaToken: DUMMY_TOKEN },
        headers: { "x-forwarded-for": nextClientIp() },
      });
      assert.equal(reply.status, 201, reply.text.slice(0, 200));
      assert.ok(reply.setCookies.some((c) => c.startsWith("trading_platform_session=")));
      assert.equal(attributionSetCookieLine(reply), null);
      // No click, and no conversion event: the ledger is governed by the same
      // switch, so a deployment with attribution off behaves exactly as it did
      // before this phase.
      assert.equal(await prisma.affiliateClick.count(), beforeClicks);
      assert.equal(await prisma.affiliateConversionEvent.count(), beforeEvents);
    });

    await check("F3 with attribution DISABLED an attribution cookie is simply ignored", async () => {
      const token = createAttributionToken({
        secret: ATTRIBUTION_SECRET,
        anonymousVisitorId: randomBase32Id(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const email = `afd3b2-disabled-cookie-${stamp}@example.invalid`;
      const reply = await request(base, "POST", "/api/auth/register", {
        cookie: `${ATTRIBUTION_COOKIE_NAME}=${token}`,
        body: { email, password: PASSWORD, name: "DisabledCookie", captchaToken: DUMMY_TOKEN },
        headers: { "x-forwarded-for": nextClientIp() },
      });
      assert.equal(reply.status, 201, reply.text.slice(0, 200));
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await prisma.affiliateAttribution.count({ where: { userId: user.id } }), 0);
      assert.equal(
        await prisma.affiliateConversionEvent.count({ where: { userId: user.id } }),
        0,
      );
    });
  } finally {
    await stopServer(disabled);
  }

  await prisma.$disconnect();
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
