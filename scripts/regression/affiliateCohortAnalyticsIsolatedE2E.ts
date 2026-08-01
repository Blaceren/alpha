/**
 * AFD-5B2A — the isolated end-to-end acquisition-cohort journey.
 *
 * WHAT THIS PROVES THAT THE UNIT SUITE CANNOT. The three cohort routes exist,
 * are reachable, are GET-only, enforce the permission contract THROUGH THE
 * BACKEND rather than through a hidden button, set `private, no-store`, and
 * return responses whose totals reconcile with their own buckets and breakdown
 * rows — and which contain no learner row, no identifier and no PII.
 *
 * ISOLATION. One loopback port nobody else owns, a throwaway database built from
 * the repository's own migrations, synthetic staff and learners, an ephemeral
 * session secret and official Cloudflare TEST captcha keys. It never touches the
 * runtime database, the deployed services, the live learner or the CRM admin,
 * and it makes no outbound request to Pocket or any other external host. Pocket
 * postbacks stay OFF: every Pocket identity below is written directly as a
 * fixture, so no callback — least of all `goal=dep` — is ever exercised.
 *
 * NO CRM. AFD-5B2A changes no CRM source, so this drives the Backend directly.
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

import { localWallClockToUtc } from "../../src/lib/analytics/business-time";

const dbPath = `/tmp/ata-afd5b2a-e2e-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
/**
 * Deliberately away from 3010/3050/3100/5177, from the root-owned 3200, from
 * 3300 and 3400, and from AFD-5B1's own 3260-3279 window.
 */
const backendPort = 3320 + (process.pid % 20);
const backendUrl = `http://127.0.0.1:${backendPort}`;

const password = "AffiliateCohortsE2E123!";
const SESSION_SECRET = "afd5b2a-isolated-e2e-session-secret-value";
const ATTRIBUTION_SECRET = "Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MFFXRVJUWXVpb3A9";

/**
 * Cloudflare's PUBLIC, documented always-passes test secret. Not a credential:
 * it is a digit, an `x`, thirty-one zeroes and two letters, the exact shape the
 * production provider REFUSES to accept.
 */
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const CAPTCHA_TEST_MARKER = "unsafe-official-turnstile-test-keys-isolated-only";
const AUTH_SURFACE_HEADER = "x-ata-auth-surface";

const COHORTS = "/api/crm/v1/affiliates/analytics/cohorts";
const EVENT_DATE = "/api/crm/v1/affiliates/analytics";
const MSK = "Europe/Moscow";
const DAY = 86_400;

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
  PUBLIC_APP_URL: "https://cohorts-e2e.example",
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  AFFILIATE_ATTRIBUTION_ENABLED: "true",
  ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
  // Pocket stays OFF: this phase must never reach the provider.
  POCKET_POSTBACK_ENABLED: "false",
  ATA_ENVIRONMENT: "dev",
  CAPTCHA_PROVIDER: "turnstile_test",
  CAPTCHA_TEST_MODE: CAPTCHA_TEST_MARKER,
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
  ATA_BUSINESS_TIMEZONE: MSK,
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

type Reply = { status: number; body: Record<string, unknown>; text: string; headers: Headers };

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
    return { status: response.status, body: (value ?? {}) as Record<string, unknown>, text, headers: response.headers };
  }

  async login(email: string) {
    return this.request("POST", "/api/auth/login", {
      email,
      password,
      captchaToken: "afd5b2a-isolated-test-token",
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
const obj = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const arr = (value: unknown): Record<string, unknown>[] => value as Record<string, unknown>[];

/** The three counts a reconciliation sums, named so a reduce stays typed. */
type CohortTally = {
  cohortLearners: number;
  pocketRegisteredLearners: number;
  firstDepositLearners: number;
};

function msk(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return localWallClockToUtc({ year: y, month: m, day: d, hour: h, minute: min, second: s }, MSK);
}

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
    const email = `afd5b2a-e2e-${role}@example.invalid`;
    const user = await prisma.user.create({
      data: { email, name: `E2E ${role}`, role: "admin", passwordHash: hash },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, displayName: `E2E ${role}`, staffRole: role as StaffRole },
    });
    staff[role] = email;
  }

  // A learner with NO StaffProfile: authenticated, but not staff.
  const learnerEmail = "afd5b2a-e2e-learner@example.invalid";
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
    data: { affiliatePartnerId: alpha.id, code: "alpha-one", displayName: "Campaign Alpha One", createdByUserId: owner.id },
  });
  const betaOne = await prisma.affiliateCampaign.create({
    data: { affiliatePartnerId: beta.id, code: "beta-one", displayName: "Campaign Beta One", createdByUserId: owner.id },
  });
  const linkA1 = await prisma.affiliateTrackingLink.create({
    data: { affiliatePartnerId: alpha.id, affiliateCampaignId: alphaOne.id, publicCode: id32("linkaone"), displayName: "Link Alpha One", createdByUserId: owner.id },
  });
  const linkA2 = await prisma.affiliateTrackingLink.create({
    data: { affiliatePartnerId: alpha.id, affiliateCampaignId: alphaOne.id, publicCode: id32("linkatwo"), displayName: "Link Alpha Two", status: "paused", createdByUserId: owner.id },
  });
  const linkB1 = await prisma.affiliateTrackingLink.create({
    // Archived on purpose: an archived link's history must remain reportable.
    data: { affiliatePartnerId: beta.id, affiliateCampaignId: betaOne.id, publicCode: id32("linkbone"), displayName: "Link Beta One", status: "archived", archivedAt: new Date(), createdByUserId: owner.id },
  });

  /* ------------------------------- journeys ------------------------------ */

  async function makeClick(linkId: number, occurredAt: Date) {
    return prisma.affiliateClick.create({
      data: {
        ataClickId: id32("c"),
        trackingLinkId: linkId,
        anonymousVisitorId: id32("v"),
        classification: "qualified",
        effectiveAttributionWindowDays: 30,
        occurredAt,
      },
    });
  }

  type Journey = {
    label: string;
    selected: { id: number; trackingLinkId: number; occurredAt: Date };
    firstTouch?: { id: number };
    registeredAt: Date;
    pocketAt?: Date;
    firstDepositAt?: Date;
    amount?: string;
  };

  async function makeLearner(journey: Journey) {
    const user = await prisma.user.create({
      data: {
        email: `afd5b2a-${journey.label}@example.invalid`,
        name: `Learner ${journey.label}`,
        role: "user",
        passwordHash: hash,
      },
    });
    const link = await prisma.affiliateTrackingLink.findUniqueOrThrow({
      where: { id: journey.selected.trackingLinkId },
      select: {
        id: true, affiliatePartnerId: true, affiliateCampaignId: true, publicCode: true,
        partner: { select: { code: true } }, campaign: { select: { code: true } },
      },
    });
    const attribution = await prisma.affiliateAttribution.create({
      data: {
        userId: user.id,
        anonymousVisitorId: id32("av"),
        firstTouchClickId: journey.firstTouch?.id ?? journey.selected.id,
        lastTouchClickId: journey.selected.id,
        selectedClickId: journey.selected.id,
        attributionModel: "last_eligible_affiliate_click",
        selectionReason: "registration_cookie",
        selectedAt: journey.registeredAt,
        frozenAt: journey.registeredAt,
      },
    });
    const snapshot = {
      attributionId: attribution.id,
      selectedClickId: journey.selected.id,
      affiliatePartnerId: link.affiliatePartnerId,
      affiliateCampaignId: link.affiliateCampaignId,
      trackingLinkId: link.id,
      affiliateCodeSnapshot: link.partner.code,
      campaignCodeSnapshot: link.campaign?.code ?? null,
      trackingLinkPublicCodeSnapshot: link.publicCode,
    };
    await prisma.affiliateConversionEvent.create({
      data: {
        ...snapshot,
        eventId: id32("ev"),
        eventType: "academy_registration",
        userId: user.id,
        sourceOwner: "auth_register",
        sourceEventId: `reg-${user.id}`,
        occurredAt: journey.registeredAt,
      },
    });
    if (journey.pocketAt !== undefined) {
      await prisma.pocketTraderIdentity.create({
        data: {
          userId: user.id,
          pocketUserId: `9${String(user.id).padStart(9, "0")}`,
          clickId: id32("pc"),
          source: "registration_postback",
          boundAt: journey.pocketAt,
        },
      });
    }
    if (journey.firstDepositAt !== undefined) {
      await prisma.affiliateConversionEvent.create({
        data: {
          ...snapshot,
          eventId: id32("ev"),
          eventType: "first_deposit",
          userId: user.id,
          sourceOwner: "pocket_first_deposit",
          sourceEventId: `fd-${user.id}`,
          providerAmount: journey.amount ?? "100.00",
          currencyCode: "USD",
          currencyStatus: "configured",
          occurredAt: journey.firstDepositAt,
        },
      });
    }
    return user;
  }

  // A — Alpha Link One in January; registers February, Pocket March, FD April.
  const clickA = await makeClick(linkA1.id, msk(2026, 1, 10));
  await makeLearner({ label: "a", selected: clickA, registeredAt: msk(2026, 2, 5), pocketAt: msk(2026, 3, 5), firstDepositAt: msk(2026, 4, 5), amount: "150.00" });

  // B — Alpha Link Two in January; registers January; never reaches Pocket.
  const clickB = await makeClick(linkA2.id, msk(2026, 1, 12));
  await makeLearner({ label: "b", selected: clickB, registeredAt: msk(2026, 1, 20) });

  // C — Beta Link One; the whole journey inside February.
  const clickC = await makeClick(linkB1.id, msk(2026, 2, 8));
  await makeLearner({ label: "c", selected: clickC, registeredAt: msk(2026, 2, 8, 1), pocketAt: msk(2026, 2, 8, 2), firstDepositAt: msk(2026, 2, 8, 3), amount: "50.00" });

  // D — a DIRECT learner: real registration, Pocket identity and deposit, with
  // no attribution at all. Must never appear in an acquisition cohort.
  const direct = await prisma.user.create({
    data: { email: "afd5b2a-direct@example.invalid", name: "Learner direct", role: "user", passwordHash: hash },
  });
  await prisma.affiliateConversionEvent.create({
    data: { eventId: id32("ev"), eventType: "academy_registration", userId: direct.id, sourceOwner: "auth_register", sourceEventId: `reg-${direct.id}`, occurredAt: msk(2026, 1, 11) },
  });
  await prisma.pocketTraderIdentity.create({
    data: { userId: direct.id, pocketUserId: `9${String(direct.id).padStart(9, "0")}`, clickId: id32("pc"), source: "registration_postback", boundAt: msk(2026, 1, 12) },
  });
  await prisma.affiliateConversionEvent.create({
    data: { eventId: id32("ev"), eventType: "first_deposit", userId: direct.id, sourceOwner: "pocket_first_deposit", sourceEventId: `fd-${direct.id}`, providerAmount: "900.00", currencyCode: "USD", currencyStatus: "configured", occurredAt: msk(2026, 1, 13) },
  });

  // E — first touch Alpha, SELECTED touch Beta. Belongs to Beta.
  const eFirst = await makeClick(linkA1.id, msk(2026, 1, 2));
  const eSelected = await makeClick(linkB1.id, msk(2026, 1, 25));
  await makeLearner({ label: "e", selected: eSelected, firstTouch: eFirst, registeredAt: msk(2026, 1, 26) });

  // F — acquired in January, registers in March: excluded until a later cutoff.
  const clickF = await makeClick(linkA1.id, msk(2026, 1, 15));
  await makeLearner({ label: "f", selected: clickF, registeredAt: msk(2026, 3, 20) });

  // G — Pocket after the first cutoff, FD after the second.
  const clickG = await makeClick(linkA1.id, msk(2026, 1, 18));
  await makeLearner({ label: "g", selected: clickG, registeredAt: msk(2026, 1, 25), pocketAt: msk(2026, 3, 10), firstDepositAt: msk(2026, 4, 10), amount: "250.00" });

  // An EVEN median population in June: 10 s and 11 s → exactly 10.5.
  const clickH = await makeClick(linkA1.id, msk(2026, 6, 1));
  await makeLearner({ label: "h", selected: clickH, registeredAt: msk(2026, 6, 1, 0, 0, 10) });
  const clickI = await makeClick(linkA1.id, msk(2026, 6, 2));
  await makeLearner({ label: "i", selected: clickI, registeredAt: msk(2026, 6, 2, 0, 0, 11) });

  await prisma.$disconnect();

  /* --------------------------------------------------------------- server */

  await startBackend();

  const JAN = "preset=custom&startDate=2026-01-01&endDate=2026-02-01";
  const JUN = "preset=custom&startDate=2026-06-01&endDate=2026-07-01";

  const analyst = await loginAs(staff.analyst);
  const admin = await loginAs(staff.crm_admin);
  const support = await loginAs(staff.support);
  const learner = await loginAs(learnerEmail);

  /* ---------------------------- 1-3 authorization ------------------------ */

  await check("1 analyst reaches the cohort summary", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2026-04-30`);
    assert.equal(reply.status, 200, reply.text);
    assert.equal(reply.body.mode, "acquisition_cohort");
    assert.equal(reply.body.cohortPopulation, "registered_attributed_learners");
    assert.equal(reply.body.cohortAnchor, "selected_acquisition_click");
  });

  await check("2 crm_admin reaches the cohort summary", async () => {
    const reply = await admin.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2026-04-30`);
    assert.equal(reply.status, 200, reply.text);
  });

  await check("3 an unauthorized caller is refused on every cohort route", async () => {
    const anonymous = new Client();
    for (const route of ["summary", "timeseries", "breakdown"]) {
      const anon = await anonymous.request("GET", `${COHORTS}/${route}?${JAN}`);
      assert.equal(anon.status, 401, `anonymous ${route}: ${anon.status}`);

      const asLearner = await learner.request("GET", `${COHORTS}/${route}?${JAN}`);
      assert.equal(asLearner.status, 403, `learner ${route}: ${asLearner.status}`);

      const asSupport = await support.request("GET", `${COHORTS}/${route}?${JAN}`);
      assert.equal(asSupport.status, 403, `support ${route}: ${asSupport.status}`);
    }
  });

  /* ------------------------- 4-6 the cutoff progression ------------------ */

  const cutoffs: Record<string, Record<string, unknown>> = {};
  for (const [label, date] of [["feb", "2026-02-28"], ["mar", "2026-03-31"], ["apr", "2026-04-30"]] as const) {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=${date}`);
    cutoffs[label] = reply.body;
  }

  await check("4 January cohort with a February cutoff: members, no conversions", () => {
    const metrics = obj(cutoffs.feb!.metrics);
    assert.equal(num(metrics.cohortLearners), 4, "A, B, E and G registered by February");
    assert.equal(num(metrics.pocketRegisteredLearners), 0);
    assert.equal(num(metrics.firstDepositLearners), 0);
  });

  await check("5 same cohort with a March cutoff: Pocket appears, FD does not", () => {
    const metrics = obj(cutoffs.mar!.metrics);
    assert.equal(num(metrics.cohortLearners), 5, "F's March registration is now observed");
    assert.equal(num(metrics.pocketRegisteredLearners), 2);
    assert.equal(num(metrics.firstDepositLearners), 0);
  });

  await check("6 same cohort with an April cutoff: FD appears", () => {
    const metrics = obj(cutoffs.apr!.metrics);
    assert.equal(num(metrics.cohortLearners), 5);
    assert.equal(num(metrics.pocketRegisteredLearners), 2);
    assert.equal(num(metrics.firstDepositLearners), 2);
  });

  await check("7 the February answer did not change once April was known", async () => {
    const again = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2026-02-28`);
    assert.deepEqual(obj(again.body.metrics), obj(cutoffs.feb!.metrics));
  });

  /* ------------------------------- 8-12 presets -------------------------- */

  await check("8 every documented preset resolves in cohort mode", async () => {
    for (const preset of ["today", "yesterday", "current_week", "previous_week", "last_7_days", "last_30_days", "current_month", "previous_month", "all_time"]) {
      const reply = await analyst.request("GET", `${COHORTS}/summary?preset=${preset}`);
      assert.equal(reply.status, 200, `${preset}: ${reply.status} ${reply.text}`);
      assert.equal(obj(reply.body.cohortPeriod).resolvedPreset, preset);
    }
  });

  await check("9 a custom cohort range is honoured", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2026-04-30`);
    const period = obj(reply.body.cohortPeriod);
    assert.equal(period.resolvedPreset, "custom");
    assert.equal(period.timezone, MSK);
    assert.equal(period.weekStart, "monday");
    assert.equal(period.intervalConvention, "start_inclusive_end_exclusive");
  });

  await check("10 all-time reports every cohort learner", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?preset=all_time`);
    // A, B, E, F, G, C, H and I. D is direct and has no acquisition anchor.
    assert.equal(num(obj(reply.body.metrics).cohortLearners), 8);
    assert.equal(obj(reply.body.cohortPeriod).startUtc, null);
  });

  await check("11 a future cutoff is refused with a 400", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2030-01-01`);
    assert.equal(reply.status, 400);
    assert.equal(reply.body.messageKey, "crm.analytics.cutoff_in_future");
  });

  await check("12 a cutoff before the cohort start is refused with a 400", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2025-06-01`);
    assert.equal(reply.status, 400);
    assert.equal(reply.body.messageKey, "crm.analytics.cutoff_before_cohort_start");
  });

  /* ---------------------------- 13-15 time series ------------------------ */

  for (const group of ["day", "week", "month"] as const) {
    await check(`13-15 the ${group} series reconciles with its own totals`, async () => {
      const reply = await analyst.request("GET", `${COHORTS}/timeseries?${JAN}&cutoffDate=2026-04-30&group=${group}`);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.group, group);

      const buckets = arr(reply.body.buckets);
      const totals = obj(obj(reply.body.totals).metrics);
      const summed = buckets.reduce<CohortTally>(
        (accumulator, bucket) => {
          const metrics = obj(bucket.metrics);
          return {
            cohortLearners: accumulator.cohortLearners + num(metrics.cohortLearners),
            pocketRegisteredLearners:
              accumulator.pocketRegisteredLearners + num(metrics.pocketRegisteredLearners),
            firstDepositLearners:
              accumulator.firstDepositLearners + num(metrics.firstDepositLearners),
          };
        },
        { cohortLearners: 0, pocketRegisteredLearners: 0, firstDepositLearners: 0 },
      );
      assert.equal(summed.cohortLearners, num(totals.cohortLearners));
      assert.equal(summed.pocketRegisteredLearners, num(totals.pocketRegisteredLearners));
      assert.equal(summed.firstDepositLearners, num(totals.firstDepositLearners));

      // Every bucket shares the report cutoff.
      const bucketCutoffs = new Set(buckets.map((bucket) => obj(bucket.followup).cutoffUtc));
      assert.ok(bucketCutoffs.size <= 1, "buckets used different cutoffs");
    });
  }

  await check("16 zero-population buckets are present, not omitted", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/timeseries?${JAN}&cutoffDate=2026-04-30&group=day`);
    const buckets = arr(reply.body.buckets);
    assert.equal(buckets.length, 31);
    assert.ok(buckets.some((bucket) => num(obj(bucket.metrics).cohortLearners) === 0));
  });

  await check("17 the bucket cap refuses an oversized series", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/timeseries?preset=custom&startDate=2020-01-01&endDate=2024-01-01&group=day`);
    assert.equal(reply.status, 400);
    assert.equal(reply.body.messageKey, "crm.analytics.bucket_cap_exceeded");
  });

  await check("18 the series states that rates and medians are NOT additive", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/timeseries?${JAN}&cutoffDate=2026-04-30&group=day`);
    const reconciliation = obj(reply.body.reconciliation);
    assert.equal(reconciliation.countsAreAdditive, true);
    assert.equal(reconciliation.ratesAreAdditive, false);
    assert.equal(reconciliation.mediansAreAdditive, false);
  });

  /* ---------------------------- 19-23 breakdowns ------------------------- */

  for (const dimension of ["affiliate", "campaign", "tracking_link"] as const) {
    await check(`19-21 the ${dimension} breakdown reconciles with the summary`, async () => {
      const reply = await analyst.request("GET", `${COHORTS}/breakdown?${JAN}&cutoffDate=2026-04-30&dimension=${dimension}`);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.dimension, dimension);

      const rows = arr(reply.body.rows);
      const totals = obj(obj(reply.body.cohortTotals).metrics);
      const summed = rows.reduce((sum, row) => sum + num(obj(row.metrics).cohortLearners), 0);
      assert.equal(summed, num(totals.cohortLearners), `${dimension} rows did not reconcile`);
      assert.equal(num(reply.body.total), rows.length);
    });
  }

  await check("22 the affiliate breakdown splits by SELECTED link owner", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/breakdown?${JAN}&cutoffDate=2026-04-30&dimension=affiliate`);
    const rows = arr(reply.body.rows);
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    assert.equal(num(obj(byId.get(String(alpha.id))!.metrics).cohortLearners), 4);
    // E's FIRST touch was Alpha; the cohort follows the SELECTED Beta click.
    assert.equal(num(obj(byId.get(String(beta.id))!.metrics).cohortLearners), 1);
  });

  await check("23 an archived link is still a reportable breakdown row", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/breakdown?${JAN}&cutoffDate=2026-04-30&dimension=tracking_link`);
    const rows = arr(reply.body.rows);
    const archived = rows.find((row) => String(row.id) === String(linkB1.id));
    assert.ok(archived, "the archived link disappeared from history");
    assert.equal(archived!.archived, true);
    assert.equal(archived!.code, linkB1.publicCode);
  });

  await check("24 breakdown paging is bounded and its total is stable", async () => {
    const first = await analyst.request("GET", `${COHORTS}/breakdown?${JAN}&cutoffDate=2026-04-30&dimension=tracking_link&limit=1&offset=0`);
    const second = await analyst.request("GET", `${COHORTS}/breakdown?${JAN}&cutoffDate=2026-04-30&dimension=tracking_link&limit=1&offset=1`);
    assert.equal(arr(first.body.rows).length, 1);
    assert.equal(num(first.body.total), num(second.body.total));
    assert.notEqual(arr(first.body.rows)[0]!.id, arr(second.body.rows)[0]!.id);
  });

  /* ------------------------------- 25-27 filters ------------------------- */

  await check("25 an Alpha filter narrows the cohort", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2026-04-30&affiliatePartnerId=${alpha.id}`);
    assert.equal(num(obj(reply.body.metrics).cohortLearners), 4);
  });

  await check("26 a Beta filter returns only Beta's acquisition", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2026-04-30&affiliatePartnerId=${beta.id}`);
    assert.equal(num(obj(reply.body.metrics).cohortLearners), 1);
  });

  await check("27 a mismatched filter hierarchy is a 400", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&affiliatePartnerId=${alpha.id}&affiliateCampaignId=${betaOne.id}`);
    assert.equal(reply.status, 400);
    assert.equal(reply.body.messageKey, "crm.analytics.filter_hierarchy_mismatch");
  });

  /* --------------------------- 28-31 rates and medians ------------------- */

  await check("28 the three cohort rates are exact decimal strings", () => {
    const rates = obj(cutoffs.apr!.rates);
    assert.equal(rates.pocketRegistrationRate, "0.400000");
    assert.equal(rates.firstDepositRate, "0.400000");
    assert.equal(rates.pocketToFirstDepositRate, "1.000000");
  });

  // December 2025 is deliberately BEFORE every fixture click, and in the past
  // relative to the real report clock — a future interval would be refused by
  // the cutoff guard rather than reported as empty.
  await check("29 a zero denominator is null and a zero numerator is zero", async () => {
    const empty = await analyst.request("GET", `${COHORTS}/summary?preset=custom&startDate=2025-12-01&endDate=2026-01-01`);
    const emptyRates = obj(empty.body.rates);
    assert.equal(emptyRates.pocketRegistrationRate, null);
    assert.equal(emptyRates.firstDepositRate, null);

    const febRates = obj(cutoffs.feb!.rates);
    assert.equal(febRates.pocketRegistrationRate, "0.000000");
    assert.equal(febRates.pocketToFirstDepositRate, null);
  });

  await check("30 the odd median is the middle value, with a sample size", () => {
    const lag = obj(obj(cutoffs.apr!.medianLags).selectedClickToAcademyRegistration);
    assert.equal(num(lag.sampleSize), 5);
    assert.equal(lag.medianSeconds, `${8 * DAY}.0`);
  });

  await check("31 the even median is the exact mean of two central values", () => {
    const lag = obj(obj(cutoffs.apr!.medianLags).academyRegistrationToPocketRegistration);
    assert.equal(num(lag.sampleSize), 2);
    assert.equal(lag.medianSeconds, `${36 * DAY}.0`);
  });

  await check("32 an even population of adjacent seconds is an exact half", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JUN}`);
    const lag = obj(obj(reply.body.medianLags).selectedClickToAcademyRegistration);
    assert.equal(num(lag.sampleSize), 2);
    assert.equal(lag.medianSeconds, "10.5");
  });

  await check("33 an empty population reports a null median, not a zero", async () => {
    const empty = await analyst.request("GET", `${COHORTS}/summary?preset=custom&startDate=2025-12-01&endDate=2026-01-01`);
    for (const value of Object.values(obj(empty.body.medianLags))) {
      const lag = obj(value);
      assert.equal(lag.medianSeconds, null);
      assert.equal(num(lag.sampleSize), 0);
    }
  });

  /* -------------------------- 34-36 follow-up metadata ------------------- */

  await check("34 follow-up metadata reports the observation window as fact", () => {
    const followup = obj(cutoffs.apr!.followup);
    assert.equal(num(followup.minimumPossibleFollowupSeconds), 89 * DAY);
    assert.equal(num(followup.maximumPossibleFollowupSeconds), 120 * DAY);
    assert.equal(followup.cohortIntervalFullyBeforeCutoff, true);
    assert.ok(typeof followup.cohortStartLocal === "string");
    assert.ok(typeof followup.cutoffUtc === "string");
  });

  await check("35 maturity is explicitly not scored", () => {
    const followup = obj(cutoffs.apr!.followup);
    assert.equal(followup.maturityAssessment, "not_scored");
    assert.equal(followup.maturityReason, "empirical_maturity_model_not_implemented");
  });

  await check("36 a cutoff inside the interval reports it, rather than hiding it", async () => {
    const reply = await analyst.request("GET", `${COHORTS}/summary?${JAN}&cutoffDate=2026-01-20`);
    const followup = obj(reply.body.followup);
    assert.equal(followup.cohortIntervalFullyBeforeCutoff, false);
    assert.equal(num(followup.minimumPossibleFollowupSeconds), 0);
  });

  /* --------------------------- 37-39 money and availability -------------- */

  await check("37 a single configured currency yields an exact total", () => {
    const amount = obj(cutoffs.apr!.firstDepositAmount);
    assert.equal(amount.amountAggregationAvailable, true);
    assert.equal(amount.amountTotal, "400.00");
    assert.equal(amount.currencyCode, "USD");
  });

  await check("38 a cohort with no deposits names the reason, not a zero", () => {
    const amount = obj(cutoffs.feb!.firstDepositAmount);
    assert.equal(amount.amountAggregationAvailable, false);
    assert.equal(amount.amountTotal, null);
    assert.equal(amount.unavailableReason, "no_confirmed_first_deposits");
  });

  await check("39 every prohibited metric is unavailable WITH a reason", () => {
    const availability = obj(cutoffs.apr!.dataAvailability);
    const expected: Record<string, string> = {
      anonymousVisitorToRegistrationCohortRate: "unregistered_visitor_selected_attribution_not_frozen",
      unattributedAcquisitionCohort: "no_selected_acquisition_click",
      directTrafficCohort: "acquisition_anchor_absent",
      educationQuality: "authoritative_product_event_catalog_not_implemented",
      redeposits: "provider_transaction_identifier_missing",
      currentBalance: "prohibited_not_collected",
      // leadDrilldown is deliberately absent: AFD-5B2B shipped it, so it is no
      // longer an unavailable dimension carrying a reason.
      maturityScoring: "deferred_to_statistical_analyst_phase",
      forecasting: "deferred_to_predictive_analytics_phase",
    };
    for (const [key, reason] of Object.entries(expected)) {
      const state = obj(availability[key]);
      assert.equal(state.available, false, `${key} must be unavailable`);
      assert.equal(state.reason, reason, `${key} reason`);
    }

    // AFD-5B2B shipped the per-lead drilldown, so this dimension moved out of
    // the map above and is asserted positively here — an availability that
    // simply stopped being checked would be worse than one asserted wrongly.
    assert.deepEqual(obj(availability.leadDrilldown), { available: true });
  });

  /* -------------------- 40 event-date versus cohort mode ----------------- */

  await check("40 event-date and cohort modes give different, correct answers", async () => {
    const eventDate = await analyst.request("GET", `${EVENT_DATE}/summary?preset=custom&startDate=2026-03-01&endDate=2026-04-01`);
    assert.equal(eventDate.status, 200, eventDate.text);
    assert.equal(eventDate.body.mode, "event_date");
    const marchEvents = obj(obj(obj(eventDate.body.coverage).attributed));
    assert.equal(num(marchEvents.pocketRegistrations), 2, "A and G bound Pocket in March");

    const cohort = await analyst.request("GET", `${COHORTS}/summary?preset=custom&startDate=2026-03-01&endDate=2026-04-01`);
    assert.equal(cohort.body.mode, "acquisition_cohort");
    assert.equal(num(obj(cohort.body.metrics).cohortLearners), 0, "March acquired nobody");
  });

  /* ------------------------ 41-43 privacy and hygiene -------------------- */

  await check("41 no response carries a learner row, an identifier or PII", async () => {
    const forbidden = [
      "@example.invalid", "Learner ", "passwordHash", "ataClickId", "anonymousVisitorId",
      "pocketUserId", "pocketClickId", "externalAffiliateClickId", "clickId",
      "POSTBACK_SECRET", "SESSION_SECRET", "sessionSecret", "cookie",
    ];
    for (const route of [
      `${COHORTS}/summary?${JAN}&cutoffDate=2026-04-30`,
      `${COHORTS}/timeseries?${JAN}&cutoffDate=2026-04-30&group=day`,
      `${COHORTS}/breakdown?${JAN}&cutoffDate=2026-04-30&dimension=tracking_link`,
    ]) {
      const reply = await analyst.request("GET", route);
      for (const needle of forbidden) {
        assert.ok(!reply.text.includes(needle), `${route} leaked "${needle}"`);
      }
      // No per-learner rows: a cohort report aggregates, it does not list.
      assert.ok(!/"userId"/.test(reply.text), `${route} returned a user id`);
      assert.ok(!/"email"/.test(reply.text), `${route} returned an email`);
    }
  });

  await check("42 every cohort route is GET-only and never cached across callers", async () => {
    for (const route of ["summary", "timeseries", "breakdown"]) {
      const get = await analyst.request("GET", `${COHORTS}/${route}?${JAN}`);
      assert.equal(get.headers.get("cache-control"), "private, no-store", route);
      for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
        const reply = await analyst.request(method, `${COHORTS}/${route}?${JAN}`, {});
        assert.ok(reply.status === 405 || reply.status === 404, `${method} ${route} was ${reply.status}`);
      }
    }
  });

  await check("43 an unknown or duplicated query key is refused", async () => {
    const unknown = await analyst.request("GET", `${COHORTS}/summary?${JAN}&sortBy=learners`);
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.messageKey, "crm.analytics.query_unknown");

    const duplicated = await analyst.request("GET", `${COHORTS}/summary?preset=all_time&preset=today`);
    assert.equal(duplicated.status, 400);
    assert.equal(duplicated.body.messageKey, "crm.analytics.query_duplicated");
  });

  /* ------------------------------- teardown ------------------------------ */

  await stopExact(backend, "backend");
  backend = null;
  cleanupDb();

  console.log(`\nAFD-5B2A cohort isolated E2E: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await stopExact(backend, "backend");
  cleanupDb();
  process.exit(1);
});
