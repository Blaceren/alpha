/**
 * AFD-5B1 — the isolated end-to-end affiliate analytics journey.
 *
 * WHAT THIS PROVES THAT THE UNIT SUITE CANNOT. The four routes exist, are
 * reachable, are GET-only, enforce the permission contract through the BACKEND
 * rather than through a hidden button, set `private, no-store`, and return
 * responses whose totals reconcile with their own breakdowns and buckets.
 *
 * ISOLATION. One loopback port nobody else owns, a throwaway database built from
 * the repository's own migrations, synthetic staff and learners, an ephemeral
 * session secret and official Cloudflare TEST captcha keys. It never touches the
 * runtime database, the deployed services, the live learner or the CRM admin,
 * and it makes no outbound request to Pocket or any other external host.
 *
 * NO CRM. AFD-5B1 changes no CRM source, so this drives the Backend directly.
 * The CRM proxy hop is already proven by `affiliateCrmManagementIsolatedE2E`.
 *
 * PROCESS SAFETY. The server is stopped by signalling EXACTLY the process group
 * this script spawned. Never pkill, never killall, never a name match.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { StaffRole } from "@prisma/client";

const dbPath = `/tmp/ata-afd5b1-e2e-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
/** Deliberately away from 3100/3010/3050/5177 and the root-owned 3200. */
const backendPort = 3260 + (process.pid % 20);
const backendUrl = `http://127.0.0.1:${backendPort}`;

const password = "AffiliateAnalyticsE2E123!";
const SESSION_SECRET = "afd5b1-isolated-e2e-session-secret-value";
const ATTRIBUTION_SECRET = "Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MFFXRVJUWXVpb3A9";

/**
 * Cloudflare's PUBLIC, documented always-passes test secret. Not a credential:
 * it is a digit, an `x`, thirty-one zeroes and two letters, which is the exact
 * shape `hasOfficialTestKeyShape` recognises and which the production provider
 * REFUSES to accept.
 */
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const CAPTCHA_TEST_MARKER = "unsafe-official-turnstile-test-keys-isolated-only";
const AUTH_SURFACE_HEADER = "x-ata-auth-surface";

const ANALYTICS = "/api/crm/v1/affiliates/analytics";

let passed = 0;
let failed = 0;
let backendLogs = "";

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    if (backendLogs) console.error(`--- backend log tail ---\n${backendLogs.slice(-1500)}`);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

const backendEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET,
  APP_URL: backendUrl,
  PUBLIC_APP_URL: "https://analytics-e2e.example",
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  AFFILIATE_ATTRIBUTION_ENABLED: "true",
  ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
  // Pocket stays OFF: this phase must never reach the provider.
  POCKET_POSTBACK_ENABLED: "false",
  // Official Turnstile TEST mode, explicitly marked and dev-gated.
  ATA_ENVIRONMENT: "dev",
  CAPTCHA_PROVIDER: "turnstile_test",
  CAPTCHA_TEST_MODE: CAPTCHA_TEST_MARKER,
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
  // The business calendar under test.
  ATA_BUSINESS_TIMEZONE: "Europe/Moscow",
};
for (const key of ["NODE_ENV"]) delete backendEnv[key];

/** The exact process-group handle. Nothing here is ever matched by name. */
let backend: ChildProcess | null = null;

async function waitForHttp(url: string, label: string) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status > 0) return;
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} failed to start\n${backendLogs.slice(-3000)}`);
}

async function startBackend() {
  const child = spawn("npx", ["next", "dev", "-p", String(backendPort)], {
    cwd: process.cwd(),
    env: backendEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value) => (backendLogs += String(value)));
  child.stderr?.on("data", (value) => (backendLogs += String(value)));
  backend = child;
  await waitForHttp(`${backendUrl}/api/health`, "backend");
}

/** Stop EXACTLY the recorded process group, then prove the port is free. */
async function stopExact(child: ChildProcess | null, label: string) {
  if (!child?.pid) return;
  const pgid = child.pid;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    /* already gone */
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      console.log(`stopped ${label} (pgid ${pgid})`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    /* gone */
  }
  console.log(`force-stopped ${label} (pgid ${pgid})`);
}

type Reply = {
  status: number;
  body: Record<string, unknown>;
  text: string;
  headers: Headers;
};

class Client {
  cookies = new Map<string, string>();

  async request(method: string, urlPath: string, body?: unknown): Promise<Reply> {
    const response = await fetch(`${backendUrl}${urlPath}`, {
      method,
      headers: {
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        // The trusted server that fronts the form declares the surface.
        [AUTH_SURFACE_HEADER]: "crm_login",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let value: unknown = {};
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      value = {};
    }
    return {
      status: response.status,
      body: (value ?? {}) as Record<string, unknown>,
      text,
      headers: response.headers,
    };
  }

  async login(email: string) {
    // Any token passes against Cloudflare's always-passes TEST secret.
    return this.request("POST", "/api/auth/login", {
      email,
      password,
      captchaToken: "afd5b1-isolated-test-token",
    });
  }
}

async function loginAs(email: string) {
  const client = new Client();
  const reply = await client.login(email);
  assert.equal(reply.status, 200, `login failed for ${email}: ${reply.status} ${reply.text}`);
  return client;
}

const num = (value: unknown): number => Number(value);

async function main() {
  cleanupDb();

  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: backendEnv, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `migrate failed: ${migrate.stderr}`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const hash = await bcrypt.hash(password, 10);

  /* -------------------------------------------------- synthetic identities */

  const staff: Record<string, string> = {};
  for (const role of ["crm_admin", "analyst", "support"] as const) {
    const email = `afd5b1-e2e-${role}@example.invalid`;
    const user = await prisma.user.create({
      data: { email, name: `E2E ${role}`, role: "admin", passwordHash: hash },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, displayName: `E2E ${role}`, staffRole: role as StaffRole },
    });
    staff[role] = email;
  }

  // A learner with NO StaffProfile: authenticated, but not staff.
  const learnerEmail = "afd5b1-e2e-learner@example.invalid";
  await prisma.user.create({
    data: { email: learnerEmail, name: "E2E learner", role: "user", passwordHash: hash },
  });

  /* --------------------------------------------------------- affiliate set */

  let sequence = 0;
  const letters = (value: number): string => {
    let out = "";
    let rest = value;
    do {
      out = String.fromCharCode(97 + (rest % 26)) + out;
      rest = Math.floor(rest / 26);
    } while (rest > 0);
    return out;
  };
  const id32 = (prefix: string): string => {
    sequence += 1;
    const tail = letters(sequence);
    return `${`${prefix}${"a".repeat(32)}`.slice(0, 32 - tail.length)}${tail}`.slice(0, 32);
  };

  const owner = await prisma.user.findFirstOrThrow({ where: { email: staff.crm_admin } });

  const alpha = await prisma.affiliatePartner.create({
    data: { code: "alpha", displayName: "Affiliate Alpha", createdByUserId: owner.id },
  });
  const beta = await prisma.affiliatePartner.create({
    data: { code: "beta", displayName: "Affiliate Beta", createdByUserId: owner.id },
  });
  const alphaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: alpha.id,
      code: "alpha-one",
      displayName: "Campaign Alpha One",
      createdByUserId: owner.id,
    },
  });
  const betaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: beta.id,
      code: "beta-one",
      displayName: "Campaign Beta One",
      createdByUserId: owner.id,
    },
  });
  const linkA1 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linkalphaone"),
      displayName: "Link Alpha One",
      status: "active",
      createdByUserId: owner.id,
    },
  });
  const linkA2 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linkalphatwo"),
      displayName: "Link Alpha Two",
      // A paused link WITH history: still reportable.
      status: "paused",
      createdByUserId: owner.id,
    },
  });
  const linkB1 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: beta.id,
      affiliateCampaignId: betaOne.id,
      publicCode: id32("linkbetaone"),
      displayName: "Link Beta One",
      status: "active",
      createdByUserId: owner.id,
    },
  });

  /* ------------------------------------------------- synthetic activity ---
   *
   * Events are placed across two Moscow business days, a Sunday/Monday boundary
   * and a month boundary, and at UTC instants that map to a DIFFERENT UTC date
   * from their Moscow date, so a UTC-based implementation would fail here.
   */
  const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
  const msk = (iso: string) => new Date(Date.parse(`${iso}Z`) - MSK_OFFSET_MS);

  // 2026-07-05 is a Sunday and 2026-07-06 a Monday. 30 June / 1 July spans the
  // month boundary. Every instant is in the PAST relative to the real clock, so
  // `all_time` — which ends at the resolved report time — contains all of it.
  const JUN30 = msk("2026-06-30T12:00:00");
  const JUL01_EARLY = msk("2026-07-01T00:30:00"); // 2026-06-30T21:30Z — prior UTC day
  const SUNDAY = msk("2026-07-05T18:00:00");
  const MONDAY = msk("2026-07-06T10:00:00");
  const MONDAY_LATE = msk("2026-07-06T23:30:00"); // 2026-07-06T20:30Z

  const visitorOne = id32("visitorone");
  const visitorTwo = id32("visitortwo");

  await prisma.affiliateClick.createMany({
    data: [
      // Two qualified clicks from ONE visitor, on two different Moscow days.
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: visitorOne, classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: JUN30 },
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: visitorOne, classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: MONDAY },
      // A separate unique visitor, on the month boundary.
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: visitorTwo, classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: JUL01_EARLY },
      // The paused link, with history.
      { ataClickId: id32("c"), trackingLinkId: linkA2.id, anonymousVisitorId: id32("v"), classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: SUNDAY },
      // Beta.
      { ataClickId: id32("c"), trackingLinkId: linkB1.id, anonymousVisitorId: id32("v"), classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: MONDAY },
      // Prefetch and authenticated-user clicks carry no visitor journey.
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: null, classification: "prefetch", effectiveAttributionWindowDays: 30, occurredAt: MONDAY },
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: null, classification: "authenticated_user", effectiveAttributionWindowDays: 30, occurredAt: MONDAY_LATE },
    ],
  });

  type Link = { id: number; publicCode: string; affiliatePartnerId: number; affiliateCampaignId: number | null };

  async function learner(tag: string, link: Link | null) {
    const user = await prisma.user.create({
      data: { email: `afd5b1-${tag}@example.invalid`, name: tag, role: "user", passwordHash: hash },
    });
    if (link === null) return { user, attributionId: null as number | null, clickId: null as number | null };
    const click = await prisma.affiliateClick.create({
      data: {
        ataClickId: id32("a"),
        trackingLinkId: link.id,
        anonymousVisitorId: id32("av"),
        classification: "qualified",
        effectiveAttributionWindowDays: 30,
        occurredAt: JUN30,
      },
    });
    const attribution = await prisma.affiliateAttribution.create({
      data: {
        userId: user.id,
        anonymousVisitorId: click.anonymousVisitorId!,
        firstTouchClickId: click.id,
        lastTouchClickId: click.id,
        selectedClickId: click.id,
        attributionModel: "last_eligible_affiliate_click",
        selectedAt: JUN30,
        frozenAt: JUN30,
        selectionReason: "registration_cookie",
      },
    });
    return { user, attributionId: attribution.id, clickId: click.id };
  }

  type Who = { user: { id: number }; attributionId: number | null; clickId: number | null };

  async function conversion(
    who: Who,
    link: Link | null,
    type: "academy_registration" | "first_deposit",
    at: Date,
    money?: { amount: string; status: "configured" | "unspecified"; code: string | null },
  ) {
    await prisma.affiliateConversionEvent.create({
      data: {
        eventId: id32("e"),
        eventType: type,
        userId: who.user.id,
        attributionId: who.attributionId,
        selectedClickId: who.clickId,
        affiliatePartnerId: link?.affiliatePartnerId ?? null,
        affiliateCampaignId: link?.affiliateCampaignId ?? null,
        trackingLinkId: link?.id ?? null,
        affiliateCodeSnapshot: link ? "snapshot" : null,
        campaignCodeSnapshot: link?.affiliateCampaignId ? "campaign-snapshot" : null,
        trackingLinkPublicCodeSnapshot: link ? link.publicCode : null,
        sourceOwner: type === "academy_registration" ? "auth_register" : "pocket_first_deposit",
        sourceEventId: `${type}-${who.user.id}`,
        ...(money
          ? { providerAmount: money.amount, currencyCode: money.code, currencyStatus: money.status }
          : {}),
        occurredAt: at,
      },
    });
  }

  const alphaLearner = await learner("alpha-learner", linkA1);
  const betaLearner = await learner("beta-learner", linkB1);
  const directLearner = await learner("direct-learner", null);

  await conversion(alphaLearner, linkA1, "academy_registration", JUL01_EARLY);
  await conversion(betaLearner, linkB1, "academy_registration", MONDAY);
  await conversion(directLearner, null, "academy_registration", MONDAY);

  // Trusted Pocket registrations: one attributed, one direct.
  await prisma.pocketTraderIdentity.create({
    data: { userId: alphaLearner.user.id, pocketUserId: "910000001", clickId: "trusted-1", source: "registration_postback", boundAt: MONDAY_LATE },
  });
  await prisma.pocketTraderIdentity.create({
    data: { userId: directLearner.user.id, pocketUserId: "910000002", clickId: "trusted-2", source: "registration_postback", boundAt: MONDAY },
  });

  await conversion(alphaLearner, linkA1, "first_deposit", MONDAY, {
    amount: "282.70",
    status: "configured",
    code: "USD",
  });
  await conversion(directLearner, null, "first_deposit", MONDAY, {
    amount: "17.30",
    status: "configured",
    code: "USD",
  });

  // Pending and conflicting provider events, plus an identical replay.
  await prisma.pocketProviderEvent.create({
    data: {
      eventType: "first_deposit",
      pocketClickId: "orphan-1",
      pocketPlayerId: "910000101",
      normalizedAmount: "50.00",
      currencyStatus: "unspecified",
      status: "pending_identity",
      firstReceivedAt: MONDAY,
      lastReceivedAt: MONDAY,
      replayCount: 2,
    },
  });
  await prisma.pocketProviderEvent.create({
    data: {
      eventType: "first_deposit",
      pocketClickId: "orphan-2",
      pocketPlayerId: "910000102",
      normalizedAmount: "75.00",
      currencyStatus: "unspecified",
      status: "conflict",
      conflictCode: "amount_mismatch",
      firstReceivedAt: MONDAY,
      lastReceivedAt: MONDAY_LATE,
      conflictDetectedAt: MONDAY_LATE,
    },
  });

  const WHOLE = `preset=custom&startDate=2026-06-29&endDate=2026-07-07`;

  try {
    await startBackend();

    /* ======================= 1. AUTHORIZATION CONTRACT ==================== */

    await check("1 anonymous is refused with 401 on every analytics route", async () => {
      const anonymous = new Client();
      for (const route of ["filters", "summary", "timeseries", "breakdown"]) {
        const reply = await anonymous.request("GET", `${ANALYTICS}/${route}`);
        assert.equal(reply.status, 401, `${route}: ${reply.status} ${reply.text}`);
      }
    });

    await check("2 an authenticated learner with no StaffProfile is refused 403", async () => {
      const client = await loginAs(learnerEmail);
      for (const route of ["filters", "summary", "timeseries", "breakdown"]) {
        const reply = await client.request("GET", `${ANALYTICS}/${route}`);
        assert.equal(reply.status, 403, `${route}: ${reply.status} ${reply.text}`);
      }
    });

    await check("3 staff WITHOUT view_affiliate_analytics are refused 403", async () => {
      const client = await loginAs(staff.support);
      for (const route of ["filters", "summary", "timeseries", "breakdown"]) {
        const reply = await client.request("GET", `${ANALYTICS}/${route}`);
        assert.equal(reply.status, 403, `${route}: ${reply.status} ${reply.text}`);
      }
    });

    const analyst = await loginAs(staff.analyst);
    const admin = await loginAs(staff.crm_admin);

    await check("4 the read-only analyst is allowed 200", async () => {
      for (const route of ["filters", "summary", "timeseries", "breakdown"]) {
        const reply = await analyst.request("GET", `${ANALYTICS}/${route}`);
        assert.equal(reply.status, 200, `${route}: ${reply.status} ${reply.text}`);
      }
    });

    await check("5 crm_admin is allowed 200 through manage_settings", async () => {
      for (const route of ["filters", "summary", "timeseries", "breakdown"]) {
        const reply = await admin.request("GET", `${ANALYTICS}/${route}`);
        assert.equal(reply.status, 200, `${route}: ${reply.status} ${reply.text}`);
      }
    });

    await check("6 every analytics response is private and never stored", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/summary`);
      assert.equal(reply.headers.get("cache-control"), "private, no-store");
      // Even a refusal must not be cached.
      const refused = await new Client().request("GET", `${ANALYTICS}/summary`);
      assert.equal(refused.headers.get("cache-control"), "private, no-store");
    });

    await check("7 the analytics routes are GET-only and mutate nothing", async () => {
      for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
        const reply = await admin.request(method, `${ANALYTICS}/summary`, {});
        assert.ok(
          reply.status === 405 || reply.status === 404,
          `${method} should not be routed, got ${reply.status}`,
        );
      }
    });

    /* ============================ 2. FILTER METADATA ===================== */

    await check("8 analyst filter metadata lists partners, campaigns and links", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/filters`);
      assert.equal(reply.status, 200, reply.text);
      const partners = reply.body.affiliatePartners as Array<Record<string, unknown>>;
      const campaigns = reply.body.affiliateCampaigns as Array<Record<string, unknown>>;
      const links = reply.body.affiliateTrackingLinks as Array<Record<string, unknown>>;
      assert.equal(partners.length, 2);
      assert.equal(campaigns.length, 2);
      assert.equal(links.length, 3);
      assert.ok(links.some((link) => link.availability === "paused"), "paused link is described");
    });

    await check("9 filter metadata narrows to one parent", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/filters?affiliatePartnerId=${alpha.id}`,
      );
      assert.equal(reply.status, 200, reply.text);
      assert.equal((reply.body.affiliateTrackingLinks as unknown[]).length, 2);
    });

    await check("10 filter metadata exposes NO identifier or callback material", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/filters`);
      for (const forbidden of [
        "ataClickId",
        "anonymousVisitorId",
        "pocketPlayerId",
        "pocketClickId",
        "externalAffiliateClickId",
        "passwordHash",
        "example.invalid",
        "910000001",
        "trusted-1",
        visitorOne,
      ]) {
        assert.ok(!reply.text.includes(forbidden), `leaked ${forbidden}`);
      }
    });

    /* ================================ 3. SUMMARY ========================= */

    await check("11 summary reports event_date mode and period_event_ratio", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.mode, "event_date");
      assert.equal(reply.body.rateMode, "period_event_ratio");
      const period = reply.body.period as Record<string, unknown>;
      assert.equal(period.timezone, "Europe/Moscow");
      assert.equal(period.weekStart, "monday");
      assert.equal(period.intervalConvention, "start_inclusive_end_exclusive");
      assert.ok(String(reply.body.rateModeExplanation).includes("different acquisition cohorts"));
    });

    await check("12 summary counts every metric from its own authoritative source", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`);
      const total = (reply.body.coverage as Record<string, Record<string, unknown>>).total;
      // 5 qualified fixture clicks, plus one acquisition click for each of the
      // TWO attributed learners. The direct learner has none, by definition.
      assert.equal(num(total.qualifiedClicks), 7);
      assert.equal(num(total.prefetchClicks), 1);
      assert.equal(num(total.authenticatedUserClicks), 1);
      assert.equal(num(total.rawClicks), 9);
      assert.equal(num(total.academyRegistrations), 3);
      assert.equal(num(total.pocketRegistrations), 2);
      assert.equal(num(total.confirmedFirstDeposits), 2);
      assert.equal(num(total.pendingIdentityDeposits), 1, "a replay is not a second deposit");
      assert.equal(num(total.conflictingDeposits), 1);
    });

    await check("13 attributed, unattributed and total are all reported", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`);
      const coverage = reply.body.coverage as Record<string, Record<string, unknown>>;
      assert.ok(coverage.attributed, "attributed coverage present");
      assert.ok(coverage.unattributed, "unattributed coverage present");
      assert.ok(coverage.total, "total coverage present");
      assert.equal(num(coverage.attributed.academyRegistrations), 2);
      assert.equal(num(coverage.unattributed.academyRegistrations), 1, "the direct signup");
      assert.equal(
        num(coverage.attributed.academyRegistrations) +
          num(coverage.unattributed.academyRegistrations),
        num(coverage.total.academyRegistrations),
      );
    });

    await check("14 an affiliate filter reports no unattributed slice at all", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/summary?${WHOLE}&affiliatePartnerId=${alpha.id}`,
      );
      const coverage = reply.body.coverage as Record<string, unknown>;
      assert.equal(coverage.unattributed, null, "null, never a block of zeroes");
      assert.equal(coverage.total, null);
      const attributed = coverage.attributed as Record<string, unknown>;
      assert.equal(num(attributed.academyRegistrations), 1);
    });

    await check("15 period ratios are exact decimals with documented denominators", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`);
      const total = (reply.body.coverage as Record<string, Record<string, unknown>>).total;
      const ratios = total.ratios as Record<string, unknown>;
      // 3 academy registrations over 7 qualified clicks, exact to six places.
      assert.equal(ratios.qualifiedClickToAcademyRegistrationRate, "0.428571");
      assert.equal(ratios.academyRegistrationToPocketRegistrationRate, "0.666666");
      assert.equal(ratios.pocketRegistrationToFirstDepositRate, "1.000000");
      const denominators = reply.body.ratioDenominators as Record<string, unknown>;
      assert.equal(denominators.qualifiedClickToAcademyRegistrationRate, "qualifiedClicks");
    });

    await check("16 a zero denominator yields null, never zero", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/summary?preset=custom&startDate=2026-01-01&endDate=2026-01-02`,
      );
      const total = (reply.body.coverage as Record<string, Record<string, unknown>>).total;
      const ratios = total.ratios as Record<string, unknown>;
      for (const [name, value] of Object.entries(ratios)) {
        assert.equal(value, null, `${name} must be null in an empty period`);
      }
      assert.equal(num(total.qualifiedClicks), 0);
    });

    /* ============================== 4. PRESETS =========================== */

    await check("17 every preset is served and echoes what it resolved to", async () => {
      for (const preset of [
        "today",
        "yesterday",
        "current_week",
        "previous_week",
        "last_7_days",
        "last_30_days",
        "current_month",
        "previous_month",
        "all_time",
      ]) {
        const reply = await analyst.request("GET", `${ANALYTICS}/summary?preset=${preset}`);
        assert.equal(reply.status, 200, `${preset}: ${reply.text}`);
        const period = reply.body.period as Record<string, unknown>;
        assert.equal(period.resolvedPreset, preset);
        assert.ok(period.endUtc, `${preset} must expose a resolved end`);
      }
    });

    await check("18 all_time has a null start and an explicit resolved end", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?preset=all_time`);
      const period = reply.body.period as Record<string, unknown>;
      assert.equal(period.startUtc, null);
      assert.equal(period.startLocal, null);
      assert.ok(typeof period.endUtc === "string" && period.endUtc.length > 0);
      const total = (reply.body.coverage as Record<string, Record<string, unknown>>).total;
      assert.equal(num(total.academyRegistrations), 3, "all history, no hidden cutoff");
    });

    await check("19 bad period input is refused with a bounded 400", async () => {
      for (const query of [
        "preset=nonsense",
        "preset=custom&startDate=2026-08-05&endDate=2026-08-03",
        "preset=custom&startDate=2026-02-30&endDate=2026-03-01",
        "preset=custom&startDate=2020-01-01&endDate=2030-01-01",
        "preset=custom",
        "preset=today&startDate=2026-08-01",
        "preset=custom&startDate=2026-08-01T00:00:00Z&endDate=2026-08-02",
        "unknownKey=1",
        "preset=today&preset=all_time",
      ]) {
        const reply = await analyst.request("GET", `${ANALYTICS}/summary?${query}`);
        assert.equal(reply.status, 400, `${query} -> ${reply.status} ${reply.text}`);
        assert.ok(reply.body.messageKey, "a bounded messageKey");
        // No SQL, no stack, no Zod issue tree.
        assert.ok(!reply.text.includes("SELECT"), reply.text);
        assert.ok(!reply.text.includes("at Object"), reply.text);
      }
    });

    /* ============================= 5. TIME SERIES ======================== */

    await check("20 the day series buckets on Moscow calendar days", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/timeseries?${WHOLE}&group=day`);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.group, "day");
      const buckets = reply.body.buckets as Array<Record<string, unknown>>;
      assert.equal(buckets.length, 8, "2026-06-29 .. 2026-07-06 inclusive of start");
      assert.equal(buckets[0].localLabel, "2026-06-29");
      assert.equal(buckets[7].localLabel, "2026-07-06");
      // The 00:30 Moscow click on 1 July is 21:30 UTC on 30 June. It must be
      // counted on the 1st — a UTC implementation would put it on the 30th and
      // in the wrong MONTH bucket too.
      const july1 = buckets.find((bucket) => bucket.localLabel === "2026-07-01")!;
      assert.equal(num((july1.metrics as Record<string, unknown>).qualifiedClicks), 1);
      const june30 = buckets.find((bucket) => bucket.localLabel === "2026-06-30")!;
      assert.equal(num((june30.metrics as Record<string, unknown>).qualifiedClicks), 3);
    });

    await check("21 interior zero buckets are present, not omitted", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/timeseries?${WHOLE}&group=day`);
      const buckets = reply.body.buckets as Array<Record<string, unknown>>;
      const zeroes = buckets.filter(
        (bucket) => num((bucket.metrics as Record<string, unknown>).rawClicks) === 0,
      );
      assert.ok(zeroes.length > 0, "a quiet day must still appear");
      // Contiguous: each bucket starts exactly where the previous one ended.
      for (let i = 1; i < buckets.length; i += 1) {
        assert.equal(buckets[i].startUtc, buckets[i - 1].endUtc, `gap before bucket ${i}`);
      }
    });

    await check("22 the week series opens on Monday and reconciles", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/timeseries?${WHOLE}&group=week`);
      assert.equal(reply.status, 200, reply.text);
      const buckets = reply.body.buckets as Array<Record<string, unknown>>;
      assert.deepEqual(
        buckets.map((bucket) => bucket.localLabel),
        ["2026-06-29", "2026-07-06"],
      );
      const reconciliation = reply.body.reconciliation as Record<string, unknown>;
      assert.equal(reconciliation.additiveMetricsMatch, true);
    });

    await check("23 the month series labels YYYY-MM and reconciles", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/timeseries?${WHOLE}&group=month`);
      const buckets = reply.body.buckets as Array<Record<string, unknown>>;
      assert.deepEqual(
        buckets.map((bucket) => bucket.localLabel),
        ["2026-06", "2026-07"],
      );
      assert.equal(
        (reply.body.reconciliation as Record<string, unknown>).additiveMetricsMatch,
        true,
      );
    });

    await check("24 additive bucket sums equal the period totals", async () => {
      for (const group of ["day", "week", "month"]) {
        const reply = await analyst.request(
          "GET",
          `${ANALYTICS}/timeseries?${WHOLE}&group=${group}`,
        );
        const buckets = reply.body.buckets as Array<Record<string, unknown>>;
        const totals = reply.body.totals as Record<string, unknown>;
        for (const metric of [
          "rawClicks",
          "qualifiedClicks",
          "academyRegistrations",
          "pocketRegistrations",
          "confirmedFirstDeposits",
          "pendingIdentityDeposits",
          "conflictingDeposits",
        ]) {
          const sum = buckets.reduce(
            (running, bucket) => running + num((bucket.metrics as Record<string, unknown>)[metric]),
            0,
          );
          assert.equal(sum, num(totals[metric]), `${group}/${metric}`);
        }
      }
    });

    await check("25 period uniques are distinguished from summed bucket uniques", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/timeseries?${WHOLE}&group=day`);
      const periodUniques = num(reply.body.periodUniqueVisitors);
      const summed = num(reply.body.summedBucketUniqueVisitors);
      // visitorOne clicks on two different Moscow days, so the naive sum is larger.
      assert.equal(periodUniques, 6);
      assert.equal(summed, 7);
      assert.notEqual(periodUniques, summed);
      assert.ok(String(reply.body.uniqueVisitorExplanation).includes("do not sum"));
      const buckets = reply.body.buckets as Array<Record<string, unknown>>;
      assert.ok(
        buckets.every((bucket) => "bucketUniqueVisitors" in (bucket.metrics as object)),
        "each bucket names its own distinct count",
      );
    });

    await check("26 an oversized range/group combination is REFUSED, not truncated", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/timeseries?preset=custom&startDate=2022-01-01&endDate=2025-01-01&group=day`,
      );
      assert.equal(reply.status, 400, reply.text);
      assert.equal(reply.body.messageKey, "crm.analytics.bucket_cap_exceeded");
      // The same range by month is inside the cap and is served.
      const monthly = await analyst.request(
        "GET",
        `${ANALYTICS}/timeseries?preset=custom&startDate=2022-01-01&endDate=2025-01-01&group=month`,
      );
      assert.equal(monthly.status, 200, monthly.text);
      assert.equal(num(monthly.body.bucketCount), 36);
    });

    /* ============================== 6. BREAKDOWN ========================= */

    await check("27 the affiliate breakdown returns one row per affiliate", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/breakdown?${WHOLE}&dimension=affiliate`,
      );
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.dimension, "affiliate");
      const rows = reply.body.rows as Array<Record<string, unknown>>;
      assert.equal(rows.length, 2);
      const alphaRow = rows.find((row) => row.id === String(alpha.id))!;
      assert.equal(alphaRow.displayName, "Affiliate Alpha");
      assert.equal(num((alphaRow.metrics as Record<string, unknown>).academyRegistrations), 1);
      assert.ok(alphaRow.lastActivityAt, "last activity is reported");
    });

    await check("28 the campaign breakdown returns one row per campaign", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/breakdown?${WHOLE}&dimension=campaign`,
      );
      const rows = reply.body.rows as Array<Record<string, unknown>>;
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.affiliatePartnerId !== null));
    });

    await check("29 the tracking-link breakdown includes the PAUSED link", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/breakdown?${WHOLE}&dimension=tracking_link`,
      );
      const rows = reply.body.rows as Array<Record<string, unknown>>;
      assert.equal(rows.length, 3);
      const paused = rows.find((row) => row.id === String(linkA2.id))!;
      assert.equal(paused.status, "paused");
      assert.equal(num((paused.metrics as Record<string, unknown>).qualifiedClicks), 1);
    });

    await check("30 breakdown rows reconcile with the attributed totals", async () => {
      for (const dimension of ["affiliate", "campaign", "tracking_link"]) {
        const reply = await analyst.request(
          "GET",
          `${ANALYTICS}/breakdown?${WHOLE}&dimension=${dimension}`,
        );
        const rows = reply.body.rows as Array<Record<string, unknown>>;
        const totals = reply.body.attributedTotals as Record<string, unknown>;
        for (const metric of ["qualifiedClicks", "academyRegistrations", "confirmedFirstDeposits"]) {
          const sum = rows.reduce(
            (running, row) => running + num((row.metrics as Record<string, unknown>)[metric]),
            0,
          );
          assert.equal(sum, num(totals[metric]), `${dimension}/${metric}`);
        }
      }
    });

    await check("31 pagination does not change the total it pages over", async () => {
      const full = await analyst.request(
        "GET",
        `${ANALYTICS}/breakdown?${WHOLE}&dimension=affiliate`,
      );
      const paged = await analyst.request(
        "GET",
        `${ANALYTICS}/breakdown?${WHOLE}&dimension=affiliate&limit=1&offset=0`,
      );
      const second = await analyst.request(
        "GET",
        `${ANALYTICS}/breakdown?${WHOLE}&dimension=affiliate&limit=1&offset=1`,
      );
      assert.equal(num(paged.body.total), num(full.body.total));
      assert.equal((paged.body.rows as unknown[]).length, 1);
      assert.equal((second.body.rows as unknown[]).length, 1);
      assert.notEqual(
        (paged.body.rows as Array<Record<string, unknown>>)[0].id,
        (second.body.rows as Array<Record<string, unknown>>)[0].id,
      );
    });

    await check("32 an invalid dimension or sort is refused", async () => {
      for (const query of [
        "dimension=learner",
        "dimension=user;DROP TABLE",
        "dimension=affiliate&limit=0",
        "dimension=affiliate&limit=101",
        "dimension=affiliate&offset=-1",
        "dimension=affiliate&includeZeroActivity=maybe",
      ]) {
        const reply = await analyst.request("GET", `${ANALYTICS}/breakdown?${WHOLE}&${query}`);
        assert.equal(reply.status, 400, `${query} -> ${reply.status} ${reply.text}`);
      }
    });

    /* =============================== 7. FILTERS ========================== */

    await check("33 the Alpha filter reports only Alpha", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/summary?${WHOLE}&affiliatePartnerId=${alpha.id}`,
      );
      const attributed = (reply.body.coverage as Record<string, Record<string, unknown>>).attributed;
      assert.equal(num(attributed.academyRegistrations), 1);
      assert.equal(num(attributed.confirmedFirstDeposits), 1);
      assert.equal(num(attributed.pocketRegistrations), 1);
    });

    await check("34 the Beta filter reports only Beta", async () => {
      const reply = await analyst.request(
        "GET",
        `${ANALYTICS}/summary?${WHOLE}&affiliatePartnerId=${beta.id}`,
      );
      const attributed = (reply.body.coverage as Record<string, Record<string, unknown>>).attributed;
      assert.equal(num(attributed.academyRegistrations), 1);
      assert.equal(num(attributed.confirmedFirstDeposits), 0);
      assert.equal(num(attributed.pocketRegistrations), 0);
    });

    await check("35 a hierarchy mismatch is refused, an unknown entity is 404", async () => {
      const mismatch = await analyst.request(
        "GET",
        `${ANALYTICS}/summary?${WHOLE}&affiliatePartnerId=${alpha.id}&affiliateCampaignId=${betaOne.id}`,
      );
      assert.equal(mismatch.status, 400, mismatch.text);
      assert.equal(mismatch.body.messageKey, "crm.analytics.filter_hierarchy_mismatch");

      const unknown = await analyst.request(
        "GET",
        `${ANALYTICS}/summary?${WHOLE}&affiliatePartnerId=999999`,
      );
      assert.equal(unknown.status, 404, unknown.text);

      const linkMismatch = await analyst.request(
        "GET",
        `${ANALYTICS}/summary?${WHOLE}&affiliatePartnerId=${beta.id}&affiliateTrackingLinkId=${linkA1.id}`,
      );
      assert.equal(linkMismatch.status, 400, linkMismatch.text);
    });

    await check("36 a malformed filter value is refused before any lookup", async () => {
      for (const value of ["abc", "-1", "0", "1.5", "1%20OR%201=1", "999999999999"]) {
        const reply = await analyst.request(
          "GET",
          `${ANALYTICS}/summary?${WHOLE}&affiliatePartnerId=${value}`,
        );
        assert.ok(
          reply.status === 400 || reply.status === 404,
          `${value} -> ${reply.status} ${reply.text}`,
        );
      }
    });

    /* ============================= 8. FD AMOUNTS ========================= */

    await check("37 one configured currency aggregates to an exact total", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`);
      const amount = reply.body.firstDepositAmount as Record<string, unknown>;
      assert.equal(amount.amountAggregationAvailable, true);
      assert.equal(amount.amountTotal, "300.00", "282.70 + 17.30, exactly");
      assert.equal(amount.currencyCode, "USD");
    });

    await check("38 an UNSPECIFIED currency withholds the total with a reason", async () => {
      const extra = await learner("unspecified-currency", linkA1);
      await conversion(extra, linkA1, "first_deposit", MONDAY, {
        amount: "5.00",
        status: "unspecified",
        code: null,
      });
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`);
      const amount = reply.body.firstDepositAmount as Record<string, unknown>;
      assert.equal(amount.amountAggregationAvailable, false);
      assert.equal(amount.amountTotal, null);
      assert.equal(amount.currencyCode, null);
      assert.equal(amount.unavailableReason, "currency_unspecified_or_mixed");
      // The COUNT stays authoritative even when the money does not.
      const total = (reply.body.coverage as Record<string, Record<string, unknown>>).total;
      assert.equal(num(total.confirmedFirstDeposits), 3);
      await prisma.affiliateConversionEvent.deleteMany({
        where: { sourceEventId: `first_deposit-${extra.user.id}` },
      });
    });

    await check("39 a MIXED currency set withholds the total and never converts", async () => {
      const extra = await learner("mixed-currency", linkA1);
      await conversion(extra, linkA1, "first_deposit", MONDAY, {
        amount: "5.00",
        status: "configured",
        code: "EUR",
      });
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`);
      const amount = reply.body.firstDepositAmount as Record<string, unknown>;
      assert.equal(amount.amountAggregationAvailable, false);
      assert.equal(amount.unavailableReason, "currency_unspecified_or_mixed");
      assert.equal(amount.amountTotal, null);
      await prisma.affiliateConversionEvent.deleteMany({
        where: { sourceEventId: `first_deposit-${extra.user.id}` },
      });
    });

    /* ========================= 9. AVAILABILITY HONESTY =================== */

    await check("40 unavailable metrics carry reasons and are never zero", async () => {
      const reply = await analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`);
      const availability = reply.body.dataAvailability as Record<
        string,
        { available: boolean; reason?: string }
      >;
      assert.equal(availability.redeposits.available, false);
      assert.equal(availability.redeposits.reason, "provider_transaction_identifier_missing");
      assert.equal(availability.currentBalance.available, false);
      assert.equal(availability.currentBalance.reason, "prohibited_not_collected");
      assert.equal(availability.educationQuality.available, false);
      // AFD-5B2A shipped the acquisition-cohort mode, so the event-date response
      // now reports it as available. Leaving this pinned to the old
      // "deferred_to_afd5b2" would have made the suite guard a claim the API had
      // stopped being entitled to make.
      assert.equal(availability.acquisitionCohortMode.available, true);
      // AFD-5B2B shipped it; pinning the old deferral would guard a false claim.
      assert.equal(availability.leadDrilldown.available, true);
      assert.equal(availability.pocketRegistrations.available, true);
      assert.equal(availability.firstDeposits.available, true);
      // No metric named below may appear as a countable zero anywhere.
      const total = (reply.body.coverage as Record<string, Record<string, unknown>>).total;
      for (const absent of ["redeposits", "currentBalance", "balance", "educationQuality"]) {
        assert.ok(!(absent in total), `${absent} must not be a metric`);
      }
    });

    await check("41 no analytics response carries PII, secrets or raw identifiers", async () => {
      const replies = await Promise.all([
        analyst.request("GET", `${ANALYTICS}/summary?${WHOLE}`),
        analyst.request("GET", `${ANALYTICS}/timeseries?${WHOLE}&group=day`),
        analyst.request("GET", `${ANALYTICS}/breakdown?${WHOLE}&dimension=affiliate`),
        analyst.request("GET", `${ANALYTICS}/filters`),
      ]);
      for (const reply of replies) {
        for (const forbidden of [
          SESSION_SECRET,
          ATTRIBUTION_SECRET,
          TURNSTILE_TEST_SECRET,
          "example.invalid",
          "passwordHash",
          "910000001",
          "910000101",
          "orphan-1",
          "trusted-1",
          visitorOne,
          visitorTwo,
        ]) {
          assert.ok(!reply.text.includes(forbidden), `leaked ${forbidden}`);
        }
      }
    });

    /* ============================== 10. SAFETY =========================== */

    await check("42 the isolated run made no live mutation and no outbound call", async () => {
      // Everything above ran against the throwaway database on the isolated port.
      assert.ok(fs.existsSync(dbPath), "the throwaway database is the only one touched");
      assert.ok(backendEnv.DATABASE_URL === dbUrl);
      assert.equal(backendEnv.POCKET_POSTBACK_ENABLED, "false");
      const identities = await prisma.pocketTraderIdentity.count();
      assert.equal(identities, 2, "only the two synthetic bindings");

      // Stronger than naming a live account and checking it is absent: assert
      // that EVERY user in this database was created by this script. A live
      // address could not appear here even if one were copied in by accident,
      // and no live identifier has to be written into the repository to say so.
      const emails = (await prisma.user.findMany({ select: { email: true } })).map(
        (row) => row.email,
      );
      assert.ok(emails.length > 0);
      for (const email of emails) {
        assert.ok(
          email.startsWith("afd5b1-") && email.endsWith("@example.invalid"),
          `unexpected account in the isolated database: ${email}`,
        );
      }
    });
  } finally {
    await stopExact(backend, "backend");
    await prisma.$disconnect();
    cleanupDb();
  }

  console.log(`\nAFD-5B1 analytics isolated E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await stopExact(backend, "backend");
  cleanupDb();
  process.exit(1);
});
