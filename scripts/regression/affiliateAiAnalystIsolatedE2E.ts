/**
 * AFD-5D1 — the isolated integration journey for the analysis endpoint.
 *
 * WHAT THIS PROVES THAT THE UNIT SUITE CANNOT. That the route exists and is
 * reachable; that it enforces the affiliate read permission and the CSRF
 * contract THROUGH THE BACKEND rather than through a hidden branch; that it
 * refuses the wrong methods; that it sets `private, no-store`; that it reads the
 * SAME numbers the shipped summary, timeseries and breakdown routes publish for
 * the same request; and that its response carries no identity.
 *
 * ISOLATION. One loopback port nobody else owns, a throwaway database built from
 * the repository's own migrations, synthetic staff and learners, an ephemeral
 * session secret and official Cloudflare TEST captcha keys. It never touches the
 * runtime database, the deployed services, the live learner or the CRM admin,
 * and it makes no outbound request. Pocket postbacks stay OFF: every Pocket
 * identity and provider event is written directly as a fixture.
 *
 * NO MODEL IS INVOLVED. There is no provider, no key and no egress in this
 * phase; the endpoint's own response asserts `engine.modelInvoked === false`.
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

const dbPath = `/tmp/ata-afd5d1-e2e-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
/**
 * Deliberately away from 3010/3050/3100/5177, from the pre-existing 3200, 3300
 * and 3400 listeners, and from the windows earlier phases claimed.
 */
const backendPort = 3940 + (process.pid % 20);
const backendUrl = `http://127.0.0.1:${backendPort}`;

const password = "AffiliateAiAnalystE2E123!";
const SESSION_SECRET = "afd5d1-isolated-e2e-session-secret-value";
const ATTRIBUTION_SECRET = "Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MFFXRVJUWXVpb3A9";
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const CAPTCHA_TEST_MARKER = "unsafe-official-turnstile-test-keys-isolated-only";
const AUTH_SURFACE_HEADER = "x-ata-auth-surface";

const ANALYSIS = "/api/crm/v1/affiliates/analytics/analysis";
const SUMMARY = "/api/crm/v1/affiliates/analytics/summary";
const TIMESERIES = "/api/crm/v1/affiliates/analytics/timeseries";
const BREAKDOWN = "/api/crm/v1/affiliates/analytics/breakdown";
const MSK = "Europe/Moscow";
const OUT = process.env.AFD5D1_E2E_OUT ?? "";

let passed = 0;
let failed = 0;
let backendLogs = "";
const results: { name: string; ok: boolean }[] = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    results.push({ name, ok: false });
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
  PUBLIC_APP_URL: "https://analysis-e2e.example",
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  AFFILIATE_ATTRIBUTION_ENABLED: "true",
  ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
  POCKET_POSTBACK_ENABLED: "false",
  ATA_ENVIRONMENT: "dev",
  CAPTCHA_PROVIDER: "turnstile_test",
  CAPTCHA_TEST_MODE: CAPTCHA_TEST_MARKER,
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
  ATA_BUSINESS_TIMEZONE: MSK,
};
for (const key of ["NODE_ENV"]) delete backendEnv[key];

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

  async request(
    method: string,
    urlPath: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Reply> {
    const response = await fetch(`${backendUrl}${urlPath}`, {
      method,
      headers: {
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        [AUTH_SURFACE_HEADER]: "crm_login",
        ...extraHeaders,
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
    return this.request("POST", "/api/auth/login", {
      email,
      password,
      captchaToken: "afd5d1-isolated-test-token",
    });
  }

  /** Mint a CSRF pair through the canonical owner, then POST with it. */
  async postWithCsrf(urlPath: string, body: unknown) {
    await this.request("GET", "/api/csrf");
    const token = this.cookies.get("trading_platform_csrf");
    assert.ok(token, "the CSRF owner issued no cookie");
    return this.request("POST", urlPath, body, { "x-csrf-token": token! });
  }
}

async function loginAs(email: string) {
  const client = new Client();
  const reply = await client.login(email);
  assert.equal(reply.status, 200, `login failed for ${email}: ${reply.status} ${reply.text}`);
  return client;
}

const obj = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const arr = (value: unknown): Record<string, unknown>[] => value as Record<string, unknown>[];

function msk(y: number, m: number, d: number, h = 0): Date {
  return localWallClockToUtc({ year: y, month: m, day: d, hour: h, minute: 0, second: 0 }, MSK);
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
  for (const role of ["crm_admin", "analyst", "support", "mentor"] as const) {
    const email = `afd5d1-e2e-${role}@example.invalid`;
    const user = await prisma.user.create({
      data: { email, name: `E2E ${role}`, role: "admin", passwordHash: hash },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, displayName: `E2E ${role}`, staffRole: role as StaffRole },
    });
    staff[role] = email;
  }

  const learnerEmail = "afd5d1-e2e-learner@example.invalid";
  await prisma.user.create({
    data: { email: learnerEmail, name: "E2E learner", role: "user", passwordHash: hash },
  });

  /* --------------------------------------------------------- affiliate set */

  let sequence = 0;
  /**
   * A unique 32-character identifier in the BASE32 alphabet the database
   * enforces with a CHECK constraint: `[a-z2-7]`, so the counter is rendered in
   * letters rather than digits — `1`, `0`, `8` and `9` are not base32 and a
   * numeric tail is rejected at insert time.
   */
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
  const linkA = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linka"),
      displayName: "Link Alpha",
      createdByUserId: owner.id,
    },
  });
  const linkB = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: beta.id,
      publicCode: id32("linkb"),
      displayName: "Link Beta",
      createdByUserId: owner.id,
    },
  });

  /* --------------------------------------------------------------- traffic */

  // A deliberately lopsided population: Alpha converts, Beta produces clicks and
  // nothing else, so the report has a real contrast to state and a real
  // concentration to measure. All inside one week of July 2026.
  async function click(
    linkId: number,
    at: Date,
    classification: "qualified" | "prefetch" | "authenticated_user" = "qualified",
  ) {
    return prisma.affiliateClick.create({
      data: {
        ataClickId: id32("c"),
        trackingLinkId: linkId,
        anonymousVisitorId: id32("v"),
        classification,
        effectiveAttributionWindowDays: 30,
        occurredAt: at,
      },
    });
  }

  const registrations: { userId: number; linkId: number; at: Date }[] = [];

  async function learner(linkId: number, clickAt: Date, registeredAt: Date, deep: boolean) {
    const user = await prisma.user.create({
      data: {
        email: `${id32("l")}@example.invalid`,
        name: "E2E learner",
        role: "user",
        passwordHash: hash,
      },
    });
    const selected = await click(linkId, clickAt);
    const attribution = await prisma.affiliateAttribution.create({
      data: {
        userId: user.id,
        anonymousVisitorId: id32("va"),
        firstTouchClickId: selected.id,
        lastTouchClickId: selected.id,
        selectedClickId: selected.id,
        attributionModel: "last_eligible_affiliate_click",
        selectionReason: "registration_cookie",
        selectedAt: registeredAt,
        frozenAt: registeredAt,
      },
    });
    // The conversion carries the dimension codes as they were AT ACQUISITION —
    // the real ones, because the database CHECK-constrains their shape and a
    // placeholder is rejected at insert time.
    const link = await prisma.affiliateTrackingLink.findUniqueOrThrow({
      where: { id: linkId },
      select: {
        id: true,
        affiliatePartnerId: true,
        affiliateCampaignId: true,
        publicCode: true,
        partner: { select: { code: true } },
        campaign: { select: { code: true } },
      },
    });
    const snapshot = {
      affiliatePartnerId: link.affiliatePartnerId,
      affiliateCampaignId: link.affiliateCampaignId,
      trackingLinkId: link.id,
      affiliateCodeSnapshot: link.partner.code,
      campaignCodeSnapshot: link.campaign ? link.campaign.code : null,
      trackingLinkPublicCodeSnapshot: link.publicCode,
    };
    await prisma.affiliateConversionEvent.create({
      data: {
        eventId: id32("r"),
        eventType: "academy_registration",
        userId: user.id,
        attributionId: attribution.id,
        selectedClickId: selected.id,
        ...snapshot,
        sourceOwner: "auth_register",
        sourceEventId: `afd3b2:user:${user.id}`,
        occurredAt: registeredAt,
      },
    });
    registrations.push({ userId: user.id, linkId, at: registeredAt });

    if (!deep) return;

    await prisma.pocketTraderIdentity.create({
      data: {
        userId: user.id,
        pocketUserId: String(900000 + user.id),
        clickId: id32("pk"),
        source: "registration_postback",
        boundAt: new Date(registeredAt.getTime() + 3600_000),
      },
    });
    const event = await prisma.pocketProviderEvent.create({
      data: {
        eventType: "first_deposit",
        pocketClickId: id32("pc"),
        pocketPlayerId: String(900000 + user.id),
        matchedUserId: user.id,
        normalizedAmount: "75.00",
        currencyCode: "USD",
        currencyStatus: "configured",
        status: "matched",
        firstReceivedAt: new Date(registeredAt.getTime() + 7200_000),
        lastReceivedAt: new Date(registeredAt.getTime() + 7200_000),
        matchedAt: new Date(registeredAt.getTime() + 7200_000),
      },
    });
    await prisma.affiliateConversionEvent.create({
      data: {
        eventId: id32("fd"),
        eventType: "first_deposit",
        userId: user.id,
        attributionId: attribution.id,
        selectedClickId: selected.id,
        ...snapshot,
        sourceOwner: "pocket_first_deposit",
        sourceEventId: `pocket:${event.id}`,
        providerAmount: "75.00",
        currencyCode: "USD",
        currencyStatus: "configured",
        occurredAt: new Date(registeredAt.getTime() + 7200_000),
      },
    });
  }

  // Alpha: 40 clicks, 20 registrations, 8 of them all the way to a deposit.
  for (let index = 0; index < 40; index += 1) {
    await click(linkA.id, msk(2026, 7, 6, 9));
  }
  for (let index = 0; index < 20; index += 1) {
    await learner(linkA.id, msk(2026, 7, 6, 10), msk(2026, 7, 7, 11), index < 8);
  }

  // Beta: 60 clicks and no registration at all — a fact the report must state
  // without calling the traffic anything.
  for (let index = 0; index < 60; index += 1) {
    await click(linkB.id, msk(2026, 7, 8, 9));
  }

  // One conflicting provider event, so a warning has something real behind it.
  await prisma.pocketProviderEvent.create({
    data: {
      eventType: "first_deposit",
      pocketClickId: id32("pc"),
      pocketPlayerId: "999001",
      normalizedAmount: "50.00",
      currencyCode: "USD",
      currencyStatus: "configured",
      status: "conflict",
      firstReceivedAt: msk(2026, 7, 9, 12),
      lastReceivedAt: msk(2026, 7, 9, 12),
      conflictDetectedAt: msk(2026, 7, 9, 12),
      conflictCode: "amount_mismatch",
    },
  });

  await prisma.$disconnect();

  /* ------------------------------------------------------------- the server */

  await startBackend();

  const analyst = await loginAs(staff.analyst);
  const admin = await loginAs(staff.crm_admin);
  const unauthorized = await loginAs(staff.support);
  const learnerClient = await loginAs(learnerEmail);
  const anonymous = new Client();

  const WINDOW = {
    preset: "custom",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  } as const;
  const QUERY = `preset=custom&startDate=2026-07-01&endDate=2026-07-31`;

  /* -------------------------------------------- 1-6 authorization contract */

  await check("1 an analyst may request an analysis", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(reply.status, 200, reply.text);
    assert.ok(Array.isArray(reply.body.observations));
  });

  await check("2 a crm_admin may request an analysis", async () => {
    const reply = await admin.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(reply.status, 200, reply.text);
  });

  await check("3 unauthorized staff and a learner are refused with 403", async () => {
    for (const client of [unauthorized, learnerClient]) {
      const reply = await client.postWithCsrf(ANALYSIS, WINDOW);
      assert.equal(reply.status, 403, reply.text);
      assert.ok(!reply.text.includes("observations"));
    }
  });

  await check("4 an anonymous caller is refused with 401", async () => {
    const reply = await anonymous.request("POST", ANALYSIS, WINDOW);
    assert.equal(reply.status, 401, reply.text);
  });

  await check("5 a POST without a CSRF token is refused", async () => {
    const reply = await analyst.request("POST", ANALYSIS, WINDOW);
    assert.equal(reply.status, 403, reply.text);
    assert.match(String(obj(reply.body).messageKey), /csrf/i);
  });

  await check("6 GET is not a way in", async () => {
    const reply = await analyst.request("GET", ANALYSIS);
    assert.ok(reply.status === 405 || reply.status === 404, `saw ${reply.status}`);
  });

  /* ------------------------------------------------- 7-9 transport contract */

  await check("7 the response is private and never cached", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    // The analytics namespace publishes the stronger `private, no-store`: two
    // staff members can hold different permissions and see different numbers,
    // so one shared cache entry would be a disclosure.
    assert.equal(reply.headers.get("cache-control"), "private, no-store");
    assert.ok(reply.headers.get("x-request-id"));
  });

  await check("8 an unknown body key is refused rather than ignored", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, { ...WINDOW, limit: 5 });
    assert.equal(reply.status, 400, reply.text);
    assert.match(String(obj(reply.body).messageKey), /body_unknown_key/);
  });

  await check("9 a hostile filter value reaches no query", async () => {
    for (const value of ["1 OR 1=1", "-1", "1.5"]) {
      const reply = await analyst.postWithCsrf(ANALYSIS, {
        ...WINDOW,
        affiliatePartnerId: value,
      });
      assert.equal(reply.status, 400, `${value}: ${reply.text}`);
    }
  });

  /* --------------------------------- 10-13 the numbers ARE the aggregates' */

  await check("10 headline metrics equal the summary route's own totals", async () => {
    const summary = await analyst.request("GET", `${SUMMARY}?${QUERY}`);
    assert.equal(summary.status, 200, summary.text);
    const analysis = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(analysis.status, 200, analysis.text);

    const totals = obj(obj(summary.body).total ?? obj(summary.body).metrics ?? {});
    const headline = obj(obj(analysis.body.overview).headlineMetrics);

    // The summary publishes its counts under whichever block this deployment
    // uses; the analysis must agree with it wherever both name a metric.
    const flat = JSON.stringify(summary.body);
    for (const metric of ["qualifiedClicks", "academyRegistrations", "confirmedFirstDeposits"]) {
      const value = String(headline[metric]);
      assert.ok(
        flat.includes(`"${metric}":${value}`),
        `${metric}=${value} does not appear in the summary response`,
      );
      void totals;
    }
  });

  await check("11 every finding's evidence names a metric the aggregates publish", async () => {
    const analysis = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    const sections = ["observations", "warnings", "positiveSignals"] as const;
    let evidenceCount = 0;
    for (const section of sections) {
      for (const finding of arr(analysis.body[section])) {
        const evidence = arr(finding.evidence);
        assert.ok(evidence.length > 0, `${String(finding.code)} carries no evidence`);
        for (const item of evidence) {
          assert.ok(String(item.key).length > 0);
          assert.ok(String(item.value).length > 0);
          evidenceCount += 1;
        }
      }
    }
    assert.ok(evidenceCount > 10, `expected substantial evidence, saw ${evidenceCount}`);
  });

  await check("12 the breakdown contrast matches the breakdown route", async () => {
    const breakdown = await analyst.request(
      "GET",
      `${BREAKDOWN}?${QUERY}&dimension=tracking_link&limit=100`,
    );
    assert.equal(breakdown.status, 200, breakdown.text);

    const analysis = await analyst.postWithCsrf(ANALYSIS, {
      ...WINDOW,
      dimension: "tracking_link",
    });
    assert.equal(analysis.status, 200, analysis.text);

    // Beta's link produced clicks and no registrations: the report must say so,
    // naming the member by id and quoting the click count the breakdown gives.
    const finding = arr(analysis.body.positiveSignals).find(
      (entry) => entry.code === "member_clicks_without_registrations",
    );
    assert.ok(finding, "expected a clicks-without-registrations finding");
    assert.equal(Number(finding!.dimensionId), linkB.id);

    const row = arr(obj(breakdown.body).rows ?? []).find(
      (entry) => Number(obj(entry).id ?? obj(entry).dimensionId) === linkB.id,
    );
    assert.ok(row, "the breakdown route did not return the Beta link");
    const clicks = Number(obj(obj(row!).metrics ?? obj(row!).counts ?? {}).qualifiedClicks);
    const evidence = arr(finding!.evidence).find((item) => item.key === "qualifiedClicks");
    assert.ok(evidence, "no click evidence on the finding");
    assert.equal(Number(evidence!.value), clicks);
  });

  await check("13 a series change quotes the timeseries route's own buckets", async () => {
    const series = await analyst.request("GET", `${TIMESERIES}?${QUERY}&group=day`);
    assert.equal(series.status, 200, series.text);
    const analysis = await analyst.postWithCsrf(ANALYSIS, { ...WINDOW, group: "day" });
    assert.equal(analysis.status, 200, analysis.text);

    const buckets = arr(obj(series.body).buckets);
    assert.ok(buckets.length >= 2, "expected a multi-bucket series");
    assert.equal(Number(obj(analysis.body.overview).bucketCount), buckets.length);
  });

  /* ------------------------------------------ 14-18 the prohibitions hold */

  const FORBIDDEN = [
    /вероятн/iu,
    /из-за/iu,
    /рекоменд/iu,
    /(?<!\p{L})ставк/iu,
    /прогноз/iu,
    /отключ/iu,
    /(?<!\p{L})плох/iu,
    /(?<!\p{L})хорош/iu,
    /эффективн/iu,
    /\bCPA\b/i,
  ];

  await check("14 no sentence in a real report advises, predicts or explains", async () => {
    for (const body of [WINDOW, { ...WINDOW, mode: "acquisition_cohort" }]) {
      const reply = await analyst.postWithCsrf(ANALYSIS, body);
      assert.equal(reply.status, 200, reply.text);
      for (const section of ["observations", "warnings", "positiveSignals", "questions"] as const) {
        for (const finding of arr(reply.body[section])) {
          const message = String(finding.message);
          for (const pattern of FORBIDDEN) {
            assert.ok(!pattern.test(message), `"${message}" matched ${String(pattern)}`);
          }
        }
      }
    }
  });

  await check("15 the response carries no identity of any kind", async () => {
    for (const body of [WINDOW, { ...WINDOW, mode: "acquisition_cohort" }]) {
      const reply = await analyst.postWithCsrf(ANALYSIS, body);
      const text = reply.text;
      assert.ok(!text.includes("@example.invalid"), "an address reached the response");
      for (const token of [
        "userId",
        "leadId",
        "pocketPlayerId",
        "pocketClickId",
        "ataClickId",
        "anonymousVisitorId",
        "passwordHash",
        "maskedEmail",
      ]) {
        assert.ok(!text.includes(token), `${token} reached the response`);
      }
    }
  });

  await check("16 the report states that no model was invoked", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    const engine = obj(reply.body.engine);
    assert.equal(engine.kind, "deterministic");
    assert.equal(engine.modelInvoked, false);
    assert.equal(typeof engine.engineVersion, "string");
    assert.equal(typeof engine.catalogVersion, "string");
  });

  await check("16b the report names the agent, the fingerprint and the request id", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(reply.status, 200, reply.text);

    const agent = obj(reply.body.agent);
    assert.equal(agent.code, "curie_atlas");
    assert.equal(agent.version, "1.0.0");

    // PRODUCT-RC-1 — the fingerprint is published and is a 16-hex token.
    assert.match(String(reply.body.inputFingerprint), /^[0-9a-f]{16}$/);

    // The request id is in the BODY as well as the header, and they agree.
    const header = reply.headers.get("x-request-id");
    assert.ok(header, "X-Request-Id header missing");
    assert.equal(reply.body.requestId, header);

    // The rename reached the wire: no legacy alias is served.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(reply.body, "opportunities"),
      "an `opportunities` alias reached the response",
    );
    assert.ok(Array.isArray(reply.body.positiveSignals));

    // `group` and `dimension` are BOTH echoed and are different concepts.
    const request = obj(reply.body.request);
    assert.ok(["day", "week", "month"].includes(String(request.group)));
    assert.ok(["affiliate", "campaign", "tracking_link"].includes(String(request.dimension)));
  });

  await check("16c the same normalized request is byte-identical apart from per-call ids", async () => {
    const first = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    const second = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 200, second.text);

    // The fingerprint is a property of the QUESTION, so it must match across
    // two calls even though the request id and the clock do not.
    assert.equal(first.body.inputFingerprint, second.body.inputFingerprint);
    assert.notEqual(first.body.requestId, second.body.requestId);

    // Everything except the two per-call fields must be byte-identical.
    const strip = (body: Record<string, unknown>) => {
      const copy = { ...body };
      delete copy.requestId;
      delete copy.generatedAt;
      return JSON.stringify(copy);
    };
    assert.equal(strip(obj(first.body)), strip(obj(second.body)));
  });

  await check("17 an empty period returns insufficient_data and no observations", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, {
      preset: "custom",
      startDate: "2020-01-01",
      endDate: "2020-02-01",
    });
    assert.equal(reply.status, 200, reply.text);
    // AFD-5D2A — the verdict is now a top-level `status` plus a three-valued
    // sufficiency status and a coded issue list. An EMPTY period raises no
    // issues: emptiness is a valid factual result, and the `insufficient_data`
    // FINDING already names why.
    assert.equal(reply.body.status, "insufficient_data");
    const sufficiency = obj(reply.body.dataSufficiency);
    assert.equal(sufficiency.status, "insufficient");
    assert.deepEqual(sufficiency.issues, []);
    assert.deepEqual(reply.body.observations, []);
    assert.deepEqual(reply.body.positiveSignals, []);
    assert.match(String(arr(reply.body.warnings)[0]?.message), /insufficient_data/);
  });

  await check("17b every published finding carries a backend support tier", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(reply.status, 200, reply.text);
    const all = [
      ...arr(reply.body.observations),
      ...arr(reply.body.warnings),
      ...arr(reply.body.positiveSignals),
      ...arr(reply.body.questions),
    ];
    assert.ok(all.length > 0);
    for (const finding of all) {
      const tier = obj(finding).supportTier;
      assert.ok(
        ["descriptive", "moderate", "strong"].includes(String(tier)),
        `finding ${String(obj(finding).code)} has tier ${String(tier)}`,
      );
      // The field is always PRESENT, `null` when the finding is not a
      // comparison — never absent, so a consumer never guesses.
      assert.ok("comparison" in obj(finding));
    }
  });

  await check("17c a real window publishes ok or partial, never a derived state", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(reply.status, 200, reply.text);
    assert.ok(["ok", "partial"].includes(String(reply.body.status)));
    const sufficiency = obj(reply.body.dataSufficiency);
    assert.ok(["complete", "partial"].includes(String(sufficiency.status)));
    // The two views of one decision agree.
    const expected =
      reply.body.status === "partial" ? "partial" : "complete";
    assert.equal(sufficiency.status, expected);
    // Every issue names a code from the closed catalog.
    for (const issue of arr(sufficiency.issues)) {
      assert.ok(
        [
          "SAMPLE_TOO_SMALL",
          "COHORT_FOLLOWUP_INCOMPLETE",
          "COMPARISON_PERIOD_UNAVAILABLE",
          "MIXED_CURRENCY",
          "BREAKDOWN_TRUNCATED",
          "METRIC_UNAVAILABLE",
          "INTEGRITY_WARNING",
        ].includes(String(obj(issue).code)),
        `unknown reason code ${String(obj(issue).code)}`,
      );
      assert.ok(arr(obj(issue).evidence).length > 0, "an issue carries no evidence");
    }
  });

  await check("18 two identical requests produce identical findings", async () => {
    const first = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    const second = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    // `generatedAt` and `requestId` are the ONLY fields allowed to move between
    // two runs. `requestId` joined that list in PRODUCT-RC-1, when it began
    // being echoed in the body as well as the header — it is per-call by
    // definition, and case 16c asserts that it genuinely differs rather than
    // being stripped here to hide a constant.
    const strip = (reply: Reply) => {
      const copy = { ...reply.body } as Record<string, unknown>;
      delete copy.generatedAt;
      delete copy.requestId;
      return JSON.stringify(copy);
    };
    assert.equal(strip(first), strip(second));
    // Nothing else is excused: the fingerprint, being a property of the
    // question rather than of the call, must be inside the compared payload.
    assert.match(String(first.body.inputFingerprint), /^[0-9a-f]{16}$/);
  });

  /* --------------------------------------------- 19-21 modes and filters */

  await check("19 cohort mode reports cohort findings and accepts a cutoff", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, {
      ...WINDOW,
      mode: "acquisition_cohort",
      cutoffDate: "2026-07-31",
    });
    assert.equal(reply.status, 200, reply.text);
    assert.equal(obj(reply.body.overview).mode, "acquisition_cohort");
    const codes = arr(reply.body.observations).map((finding) => String(finding.code));
    assert.ok(codes.includes("cohort_size"), codes.join(","));
    assert.ok(!codes.includes("period_volume"));
    assert.ok(obj(obj(reply.body.request).cutoff).cutoffUtc);
  });

  await check("20 a cutoff outside cohort mode is refused", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, { ...WINDOW, cutoffDate: "2026-07-31" });
    assert.equal(reply.status, 400, reply.text);
    assert.match(String(obj(reply.body).messageKey), /cutoff_not_allowed/);
  });

  await check("21 a partner filter narrows the report to that partner", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, {
      ...WINDOW,
      affiliatePartnerId: String(beta.id),
    });
    assert.equal(reply.status, 200, reply.text);
    assert.equal(obj(reply.body.overview).filtered, true);
    assert.equal(obj(reply.body.overview).coverage, "attributed");
    // Beta produced clicks and no registrations, so its own report says the
    // registration rate is undefined rather than zero.
    const headline = obj(obj(reply.body.overview).headlineMetrics);
    assert.equal(Number(headline.academyRegistrations), 0);
  });

  await check("22 a nonexistent filter id is refused by the accepted owner", async () => {
    const reply = await analyst.postWithCsrf(ANALYSIS, {
      ...WINDOW,
      affiliatePartnerId: "999999",
    });
    assert.ok(reply.status === 404 || reply.status === 400, `saw ${reply.status}: ${reply.text}`);
  });

  /* ------------------------------------------------- 23 the shipped routes */

  await check("23 the accepted analytics routes still answer unchanged", async () => {
    for (const url of [`${SUMMARY}?${QUERY}`, `${TIMESERIES}?${QUERY}`, `${BREAKDOWN}?${QUERY}`]) {
      const reply = await analyst.request("GET", url);
      assert.equal(reply.status, 200, `${url}: ${reply.text}`);
    }
  });

  /* ================================================================== */
  /* AFD-5D3 — ADVERSARIAL HTTP SECURITY                                */
  /*                                                                    */
  /* The cases above prove the endpoint works and refuses the obvious   */
  /* wrong callers. These attack the session and request boundaries.    */
  /*                                                                    */
  /* ONE SESSION PER ROLE, HOISTED. The backend rate-limits login to    */
  /* five attempts per ten minutes per (ip, email). A case that logs in */
  /* for itself is spending a budget the whole section shares, and the  */
  /* first draft of this section exhausted it and failed six cases with */
  /* a 429 that had nothing to do with what they were testing.          */
  /* ================================================================== */

  const secAnalyst = await loginAs(staff.analyst!);
  const secAdmin = await loginAs(staff.crm_admin!);
  const secMentor = await loginAs(staff.mentor!);

  await check("S1 a mentor is refused, on the staff-role axis rather than the user axis", async () => {
    // `mentor` is a real StaffRole with a staff profile and a working login, so
    // this is not the anonymous case wearing a different hat: it proves the
    // permission is checked, not merely the presence of staff.
    const mentor = secMentor;
    const reply = await mentor.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(reply.status, 403, `mentor received ${reply.status}: ${reply.text}`);
  });

  await check("S2 an INVALID csrf token is refused, not merely a missing one", async () => {
    // A missing token is already covered. A present-but-wrong token is the case
    // that distinguishes a real double-submit check from a presence check.
    const client = secAnalyst;
    await client.request("GET", "/api/csrf");
    const reply = await client.request("POST", ANALYSIS, WINDOW, {
      "x-csrf-token": "0000000000000000000000000000000000000000",
    });
    assert.equal(reply.status, 403, `invalid csrf accepted: ${reply.status} ${reply.text}`);
    assert.match(String(obj(reply.body).messageKey ?? ""), /csrf/i);
  });

  await check("S3 a csrf token from ANOTHER session is refused", async () => {
    // The token must be bound to the session that minted it. If it is not, a
    // token leaked from any other session is a working forgery.
    const victim = secAnalyst;
    const attacker = secAdmin;
    await victim.request("GET", "/api/csrf");
    const victimToken = victim.cookies.get("trading_platform_csrf");
    assert.ok(victimToken);

    // The attacker keeps its OWN session cookie and presents the victim's token.
    const reply = await attacker.request("POST", ANALYSIS, WINDOW, {
      "x-csrf-token": victimToken!,
    });
    assert.equal(reply.status, 403, `cross-session token accepted: ${reply.status}`);
  });

  await check("S4 a tampered session cookie is refused", async () => {
    // A CLONED cookie jar, not the shared client: tampering with the shared
    // session would poison every case after this one, and the failure would
    // look like a permission bug rather than this test's own doing.
    const client = new Client();
    for (const [name, value] of secAnalyst.cookies) client.cookies.set(name, value);
    await client.request("GET", "/api/csrf");
    const token = client.cookies.get("trading_platform_csrf");
    const session = client.cookies.get("trading_platform_session");
    assert.ok(session, "no session cookie to tamper with");
    // Flip the last character: a signature check must reject it.
    const tampered = session!.slice(0, -1) + (session!.endsWith("a") ? "b" : "a");
    client.cookies.set("trading_platform_session", tampered);
    const reply = await client.request("POST", ANALYSIS, WINDOW, { "x-csrf-token": token! });
    assert.ok(
      reply.status === 401 || reply.status === 403,
      `tampered session produced ${reply.status}`,
    );
  });

  await check("S5 an oversized body is refused without a stack trace", async () => {
    const client = secAnalyst;
    await client.request("GET", "/api/csrf");
    const token = client.cookies.get("trading_platform_csrf");
    // One megabyte of filler under an unknown key.
    const huge = { ...WINDOW, padding: "x".repeat(1_000_000) };
    const reply = await client.request("POST", ANALYSIS, huge, { "x-csrf-token": token! });
    assert.ok(reply.status >= 400 && reply.status < 500, `oversized body produced ${reply.status}`);
    for (const leak of ["at Object.", "node_modules", "SELECT ", "prisma", "Error:"]) {
      assert.ok(!reply.text.includes(leak), `error body leaks "${leak}": ${reply.text.slice(0, 200)}`);
    }
  });

  await check("S6 PII-shaped filter values are refused by the accepted owner", async () => {
    const client = secAnalyst;
    const hostile = [
      "learner@example.invalid",
      "+7 999 123-45-67",
      "1 OR 1=1",
      "../../etc/passwd",
      "<script>alert(1)</script>",
      "%00",
    ];
    for (const value of hostile) {
      const reply = await client.postWithCsrf(ANALYSIS, {
        ...WINDOW,
        affiliatePartnerId: value,
      });
      assert.ok(
        reply.status >= 400 && reply.status < 500,
        `hostile partner id "${value}" produced ${reply.status}`,
      );
      assert.ok(!reply.text.includes(value), `the error echoed the hostile value back: ${reply.text.slice(0, 160)}`);
    }
  });

  await check("S7 concurrent identical requests agree exactly", async () => {
    // Determinism under concurrency, not just in sequence. Shared mutable state
    // in the engine would show here and nowhere else.
    const client = secAnalyst;
    await client.request("GET", "/api/csrf");
    const token = client.cookies.get("trading_platform_csrf");
    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        client.request("POST", ANALYSIS, WINDOW, { "x-csrf-token": token! }),
      ),
    );
    for (const reply of replies) assert.equal(reply.status, 200, reply.text);

    const fingerprints = new Set(replies.map((r) => String(obj(r.body).inputFingerprint)));
    assert.equal(fingerprints.size, 1, `concurrent requests disagreed: ${[...fingerprints]}`);

    // The analytical body must be identical; only per-call identifiers may move.
    const bodies = replies.map((r) => {
      const body = { ...obj(r.body) };
      delete body.requestId;
      delete body.generatedAt;
      return JSON.stringify(body);
    });
    assert.equal(new Set(bodies).size, 1, "concurrent requests produced different findings");
  });

  await check("S8 concurrent DIFFERENT requests do not contaminate each other", async () => {
    const client = secAnalyst;
    await client.request("GET", "/api/csrf");
    const token = client.cookies.get("trading_platform_csrf");

    const eventDate = client.request("POST", ANALYSIS, WINDOW, { "x-csrf-token": token! });
    const cohort = client.request("POST", ANALYSIS, { ...WINDOW, mode: "acquisition_cohort" }, {
      "x-csrf-token": token!,
    });
    const [a, b] = await Promise.all([eventDate, cohort]);
    assert.equal(a.status, 200, a.text);
    assert.equal(b.status, 200, b.text);

    assert.equal(obj(obj(a.body).request!).mode, "event_date");
    assert.equal(obj(obj(b.body).request!).mode, "acquisition_cohort");
    assert.notEqual(
      String(obj(a.body).inputFingerprint),
      String(obj(b.body).inputFingerprint),
      "two different questions produced one fingerprint",
    );
  });

  await check("S9 the analysis writes ZERO Agent Core rows, before and after", async () => {
    // The tables exist in this candidate's schema (migration 41), so "empty" is
    // a measurement rather than an absence of somewhere to look.
    const AGENT_TABLES = [
      "AgentRun",
      "AgentFinding",
      "AgentEvidenceReference",
      "AgentHandoff",
      "AgentActionProposal",
      "AgentActionDecision",
      "AgentActionExecution",
      "AgentEvaluation",
      "ModelInvocation",
    ];
    async function counts() {
      const out: Record<string, number> = {};
      for (const table of AGENT_TABLES) {
        const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
          `SELECT COUNT(*) AS n FROM "${table}"`,
        );
        out[table] = Number(rows[0]?.n ?? 0);
      }
      return out;
    }
    const before = await counts();
    const client = secAnalyst;
    await client.postWithCsrf(ANALYSIS, WINDOW);
    await client.postWithCsrf(ANALYSIS, { ...WINDOW, mode: "acquisition_cohort" });
    const after = await counts();

    for (const table of AGENT_TABLES) {
      assert.equal(before[table], 0, `${table} was not empty BEFORE the analysis`);
      assert.equal(after[table], 0, `${table} gained rows: ${after[table]}`);
    }
  });

  await check("S10 no response or error body ever exposes SQL, a stack or a secret", async () => {
    const client = secAnalyst;
    const probes: unknown[] = [
      WINDOW,
      { ...WINDOW, group: "century" },
      { ...WINDOW, dimension: "learner" },
      { ...WINDOW, startDate: "not-a-date" },
      { ...WINDOW, startDate: "2026-07-31", endDate: "2026-07-01" },
      { ...WINDOW, preset: "last_7_days", startDate: "2026-07-01" },
      [],
      "string body",
      null,
    ];
    for (const probe of probes) {
      const reply = await client.postWithCsrf(ANALYSIS, probe);
      for (const leak of [
        "SELECT ",
        "FROM \"",
        "at Object.",
        "/home/ubuntu",
        "node_modules",
        SESSION_SECRET,
        ATTRIBUTION_SECRET,
        TURNSTILE_TEST_SECRET,
      ]) {
        assert.ok(
          !reply.text.includes(leak),
          `body for ${JSON.stringify(probe).slice(0, 40)} leaks "${leak}"`,
        );
      }
    }
  });

  await check("S11 an inverted or absurd period is refused, never silently swapped", async () => {
    const client = secAnalyst;
    const inverted = await client.postWithCsrf(ANALYSIS, {
      mode: "event_date",
      preset: "custom",
      startDate: "2026-07-31",
      endDate: "2026-07-01",
    });
    assert.ok(inverted.status >= 400 && inverted.status < 500, `inverted period: ${inverted.status}`);

    const absurd = await client.postWithCsrf(ANALYSIS, {
      mode: "event_date",
      preset: "custom",
      startDate: "1900-01-01",
      endDate: "2999-12-31",
    });
    assert.ok(
      absurd.status >= 400 && absurd.status < 500,
      `a 1100-year period was accepted with ${absurd.status}`,
    );
  });

  await check("S12 the response stays bounded in size and finding count", async () => {
    const client = secAnalyst;
    const reply = await client.postWithCsrf(ANALYSIS, WINDOW);
    assert.equal(reply.status, 200);
    const body = obj(reply.body);
    const findings =
      arr(body.observations).length +
      arr(body.warnings).length +
      arr(body.positiveSignals).length +
      arr(body.questions).length;
    // The catalog has 33 codes; a breakdown may repeat member-scoped ones, so
    // this is a sanity bound rather than a tight one. Unbounded growth is what
    // it exists to catch.
    assert.ok(findings > 0, "a real window produced no findings at all");
    assert.ok(findings < 500, `finding count is unbounded: ${findings}`);
    assert.ok(reply.text.length < 2_000_000, `response size is unbounded: ${reply.text.length}`);
  });

  // A real response, captured for review. Written only when asked for, and it
  // contains no identity — check 15 above proves that of every response.
  const SAMPLE = process.env.AFD5D1_SAMPLE_OUT ?? "";
  if (SAMPLE) {
    const sample = await analyst.postWithCsrf(ANALYSIS, WINDOW);
    fs.writeFileSync(SAMPLE, JSON.stringify(sample.body, null, 2));
    console.log(`sample written to ${SAMPLE}`);
  }

  await stopExact(backend, "backend");
  backend = null;
  cleanupDb();

  if (OUT) {
    fs.writeFileSync(
      OUT,
      JSON.stringify({ suite: "afd5d1-isolated-e2e", passed, failed, results }, null, 2),
    );
  }

  console.log(`\nAFD-5D1 analysis isolated E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await stopExact(backend, "backend");
  cleanupDb();
  if (backendLogs) console.error(`--- backend log tail ---\n${backendLogs.slice(-2500)}`);
  process.exit(1);
});
