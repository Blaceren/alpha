/**
 * AFD-5B2B — the isolated end-to-end lead drilldown journey.
 *
 * WHAT THIS PROVES THAT THE UNIT SUITE CANNOT. That the three lead routes exist,
 * are reachable, enforce the permission contract THROUGH THE BACKEND rather than
 * through a hidden button, refuse the wrong HTTP methods, set `private,
 * no-store`, require a CSRF token for the one operation that writes, and write
 * exactly one audit row when — and only when — an identity is actually revealed.
 *
 * ISOLATION. One loopback port nobody else owns, a throwaway database built from
 * the repository's own migrations, synthetic staff and learners, an ephemeral
 * session secret and official Cloudflare TEST captcha keys. It never touches the
 * runtime database, the deployed services, the live learner or the CRM admin,
 * and it makes no outbound request to Pocket or any other external host. Pocket
 * postbacks stay OFF: every Pocket identity and provider event below is written
 * directly as a fixture, so no callback — least of all `goal=dep` — is ever
 * exercised.
 *
 * NO CRM AND NO ACADEMY. AFD-5B2B changes neither, so this drives the Backend
 * directly and neither frontend is built, started or read.
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

const dbPath = `/tmp/ata-afd5b2b-e2e-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
/**
 * Deliberately away from 3010/3050/3100/5177, from the pre-existing 3200, 3300
 * and 3400 listeners this phase inventoried and must not disturb, from AFD-5B1's
 * 3260-3279 window and from AFD-5B2A's 3320-3339 one.
 */
const backendPort = 3340 + (process.pid % 20);
const backendUrl = `http://127.0.0.1:${backendPort}`;

const password = "AffiliateLeadsE2E123!";
const SESSION_SECRET = "afd5b2b-isolated-e2e-session-secret-value";
const ATTRIBUTION_SECRET = "Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MFFXRVJUWXVpb3A9";

/**
 * Cloudflare's PUBLIC, documented always-passes test secret. Not a credential:
 * it is a digit, an `x`, thirty-one zeroes and two letters, the exact shape the
 * production provider REFUSES to accept.
 */
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const CAPTCHA_TEST_MARKER = "unsafe-official-turnstile-test-keys-isolated-only";
const AUTH_SURFACE_HEADER = "x-ata-auth-surface";

const LEADS = "/api/crm/v1/affiliates/leads";
const MSK = "Europe/Moscow";
const OUT = process.env.AFD5B2B_E2E_OUT ?? "";

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
  PUBLIC_APP_URL: "https://leads-e2e.example",
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
      captchaToken: "afd5b2b-isolated-test-token",
    });
  }

  /** Mint a CSRF pair through the canonical owner, then POST with it. */
  async postWithCsrf(urlPath: string) {
    await this.request("GET", "/api/csrf");
    const token = this.cookies.get("trading_platform_csrf");
    assert.ok(token, "the CSRF owner issued no cookie");
    return this.request("POST", urlPath, undefined, { "x-csrf-token": token! });
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
    const email = `afd5b2b-e2e-${role}@example.invalid`;
    const user = await prisma.user.create({
      data: { email, name: `E2E ${role}`, role: "admin", passwordHash: hash },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, displayName: `E2E ${role}`, staffRole: role as StaffRole },
    });
    staff[role] = email;
  }

  // A learner with NO StaffProfile: authenticated, but not staff.
  const learnerEmail = "afd5b2b-e2e-learner@example.invalid";
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
  let player = 700000;
  const playerId = () => String((player += 1));

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
      publicCode: id32("linkaone"),
      displayName: "Link Alpha One",
      createdByUserId: owner.id,
    },
  });
  const linkA2 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linkatwo"),
      displayName: "Link Alpha Two",
      status: "paused",
      createdByUserId: owner.id,
    },
  });
  const linkB1 = await prisma.affiliateTrackingLink.create({
    // Archived on purpose: an archived link's history must remain reportable.
    data: {
      affiliatePartnerId: beta.id,
      affiliateCampaignId: betaOne.id,
      publicCode: id32("linkbone"),
      displayName: "Link Beta One",
      status: "archived",
      archivedAt: new Date(),
      createdByUserId: owner.id,
    },
  });

  /* -------------------------------------------------------------- journeys */

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

  type Deposit = {
    firstReceivedAt: Date;
    status: "matched" | "conflict" | "pending_identity";
    matchedAt?: Date;
    conflictDetectedAt?: Date;
    conflictCode?: "click_id_mismatch" | "amount_mismatch" | "identity_owner_mismatch" | "click_owner_missing";
    ledgerAt?: Date;
  };

  type Journey = {
    label: string;
    registeredAt: Date;
    firstTouch?: { linkId: number; at: Date };
    selectedTouch?: { linkId: number; at: Date };
    pocketAt?: Date;
    deposit?: Deposit;
    duplicateRegistration?: boolean;
  };

  const leads: Record<string, { email: string; name: string; leadId: string; userId: number }> = {};

  async function makeLead(journey: Journey) {
    const email = `afd5b2b-lead-${journey.label.toLowerCase()}@example.invalid`;
    const name = `Learner ${journey.label}`;
    const user = await prisma.user.create({
      data: { email, name, role: "user", passwordHash: hash },
    });

    let attributionId: number | null = null;
    let selectedClickId: number | null = null;
    let snapshot: Record<string, unknown> = {};

    if (journey.firstTouch) {
      const first = await makeClick(journey.firstTouch.linkId, journey.firstTouch.at);
      const selected = journey.selectedTouch
        ? await makeClick(journey.selectedTouch.linkId, journey.selectedTouch.at)
        : first;

      const attribution = await prisma.affiliateAttribution.create({
        data: {
          userId: user.id,
          anonymousVisitorId: id32("va"),
          firstTouchClickId: first.id,
          lastTouchClickId: selected.id,
          selectedClickId: selected.id,
          attributionModel: "last_eligible_affiliate_click",
          selectionReason: "registration_cookie",
          selectedAt: journey.registeredAt,
          frozenAt: journey.registeredAt,
        },
      });
      attributionId = attribution.id;
      selectedClickId = selected.id;

      const link = await prisma.affiliateTrackingLink.findUniqueOrThrow({
        where: { id: selected.trackingLinkId },
        select: {
          id: true,
          affiliatePartnerId: true,
          affiliateCampaignId: true,
          publicCode: true,
          partner: { select: { code: true } },
          campaign: { select: { code: true } },
        },
      });
      snapshot = {
        affiliatePartnerId: link.affiliatePartnerId,
        affiliateCampaignId: link.affiliateCampaignId,
        trackingLinkId: link.id,
        affiliateCodeSnapshot: link.partner.code,
        campaignCodeSnapshot: link.campaign ? link.campaign.code : null,
        trackingLinkPublicCodeSnapshot: link.publicCode,
      };
    }

    const eventId = id32("r");
    await prisma.affiliateConversionEvent.create({
      data: {
        eventId,
        eventType: "academy_registration",
        userId: user.id,
        attributionId,
        selectedClickId,
        ...snapshot,
        sourceOwner: "auth_register",
        sourceEventId: `afd3b2:user:${user.id}`,
        occurredAt: journey.registeredAt,
      },
    });

    if (journey.duplicateRegistration) {
      await prisma.affiliateConversionEvent.create({
        data: {
          eventId: id32("rd"),
          eventType: "academy_registration",
          userId: user.id,
          sourceOwner: "auth_register",
          sourceEventId: `afd3b2:user:${user.id}:synthetic-duplicate`,
          occurredAt: new Date(journey.registeredAt.getTime() + 1000),
        },
      });
    }

    let boundPlayer: string | null = null;
    if (journey.pocketAt) {
      boundPlayer = playerId();
      await prisma.pocketTraderIdentity.create({
        data: {
          userId: user.id,
          pocketUserId: boundPlayer,
          clickId: id32("pk"),
          source: "registration_postback",
          boundAt: journey.pocketAt,
        },
      });
    }

    if (journey.deposit) {
      const deposit = journey.deposit;
      const matched = deposit.status === "matched";
      const event = await prisma.pocketProviderEvent.create({
        data: {
          eventType: "first_deposit",
          pocketClickId: id32("pc"),
          pocketPlayerId: boundPlayer ?? playerId(),
          matchedUserId: matched ? user.id : null,
          normalizedAmount: "75.00",
          currencyCode: "USD",
          currencyStatus: "configured",
          status: deposit.status,
          firstReceivedAt: deposit.firstReceivedAt,
          lastReceivedAt: deposit.firstReceivedAt,
          ...(matched ? { matchedAt: deposit.matchedAt ?? deposit.firstReceivedAt } : {}),
          ...(deposit.conflictDetectedAt ? { conflictDetectedAt: deposit.conflictDetectedAt } : {}),
          ...(deposit.conflictCode ? { conflictCode: deposit.conflictCode } : {}),
        },
      });

      if (deposit.ledgerAt) {
        await prisma.affiliateConversionEvent.create({
          data: {
            eventId: id32("fd"),
            eventType: "first_deposit",
            userId: user.id,
            attributionId,
            selectedClickId,
            ...snapshot,
            sourceOwner: "pocket_first_deposit",
            sourceEventId: `pocket:${event.id}`,
            providerAmount: "75.00",
            currencyCode: "USD",
            currencyStatus: "configured",
            occurredAt: deposit.ledgerAt,
          },
        });
      }
    }

    leads[journey.label] = { email, name, leadId: `v1_${eventId}`, userId: user.id };
  }

  // A — attributed Alpha, first touch on Link One, selected on Link Two,
  //     Academy registered, Pocket registered, confirmed deposit.
  await makeLead({
    label: "A",
    firstTouch: { linkId: linkA1.id, at: msk(2026, 3, 1, 8) },
    selectedTouch: { linkId: linkA2.id, at: msk(2026, 3, 9, 8) },
    registeredAt: msk(2026, 3, 10, 9),
    pocketAt: msk(2026, 3, 11, 9),
    deposit: {
      firstReceivedAt: msk(2026, 3, 12, 9),
      status: "matched",
      matchedAt: msk(2026, 3, 12, 9),
      ledgerAt: msk(2026, 3, 12, 9),
    },
  });

  // B — attributed Beta, deposit BEFORE the binding, later reconciled.
  await makeLead({
    label: "B",
    firstTouch: { linkId: linkB1.id, at: msk(2026, 4, 1, 10) },
    registeredAt: msk(2026, 4, 5, 10),
    pocketAt: msk(2026, 4, 8, 10),
    deposit: {
      firstReceivedAt: msk(2026, 4, 6, 10),
      status: "matched",
      matchedAt: msk(2026, 4, 8, 10),
      ledgerAt: msk(2026, 4, 8, 10),
    },
  });

  // C — attributed Alpha, Pocket registered, deposit quarantined and uncounted.
  await makeLead({
    label: "C",
    firstTouch: { linkId: linkA1.id, at: msk(2026, 5, 1, 11) },
    registeredAt: msk(2026, 5, 2, 11),
    pocketAt: msk(2026, 5, 3, 11),
    deposit: {
      firstReceivedAt: msk(2026, 5, 4, 11),
      status: "conflict",
      conflictDetectedAt: msk(2026, 5, 4, 11),
      conflictCode: "identity_owner_mismatch",
    },
  });

  // D — DIRECT registration that still reached a confirmed deposit.
  await makeLead({
    label: "D",
    registeredAt: msk(2026, 6, 1, 12),
    pocketAt: msk(2026, 6, 2, 12),
    deposit: {
      firstReceivedAt: msk(2026, 6, 3, 12),
      status: "matched",
      matchedAt: msk(2026, 6, 3, 12),
      ledgerAt: msk(2026, 6, 3, 12),
    },
  });

  // E — Academy registration only.
  await makeLead({ label: "E", registeredAt: msk(2026, 7, 1, 13) });

  // F — Pocket registered, no deposit at all.
  await makeLead({ label: "F", registeredAt: msk(2026, 8, 1, 14), pocketAt: msk(2026, 8, 2, 14) });

  // G — the malformed integrity case, on this copied database only.
  await makeLead({
    label: "G",
    registeredAt: msk(2026, 9, 1, 15),
    duplicateRegistration: true,
  });

  // P — a deposit still pending although the binding already exists.
  await makeLead({
    label: "P",
    registeredAt: msk(2026, 11, 1, 17),
    pocketAt: msk(2026, 11, 2, 17),
    deposit: { firstReceivedAt: msk(2026, 11, 3, 17), status: "pending_identity" },
  });

  const leadCount = Object.keys(leads).length;
  const auditBefore = await prisma.auditLog.count();

  await prisma.$disconnect();

  /* ------------------------------------------------------------- the server */

  await startBackend();

  const analyst = await loginAs(staff.analyst);
  const admin = await loginAs(staff.crm_admin);
  const unauthorized = await loginAs(staff.support);
  const learner = await loginAs(learnerEmail);
  const anonymous = new Client();

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  /* ------------------------------------------- 1-4 authorization contract */

  await check("1 an analyst may list leads", async () => {
    const reply = await analyst.request("GET", `${LEADS}?limit=100`);
    assert.equal(reply.status, 200, reply.text);
    assert.equal(arr(reply.body.rows).length, leadCount);
  });

  await check("2 a crm_admin may list leads", async () => {
    const reply = await admin.request("GET", `${LEADS}?limit=100`);
    assert.equal(reply.status, 200, reply.text);
    assert.equal(arr(reply.body.rows).length, leadCount);
  });

  await check("3 unauthorized staff and a learner are refused with 403", async () => {
    for (const client of [unauthorized, learner]) {
      const list = await client.request("GET", LEADS);
      assert.equal(list.status, 403, list.text);
      const detail = await client.request("GET", `${LEADS}/${leads.A.leadId}`);
      assert.equal(detail.status, 403, detail.text);
      // No lead content escapes to an unauthorised caller.
      assert.ok(!detail.text.includes("@example.invalid"));
    }
  });

  await check("4 an anonymous caller is refused with 401", async () => {
    const list = await anonymous.request("GET", LEADS);
    assert.equal(list.status, 401, list.text);
    const detail = await anonymous.request("GET", `${LEADS}/${leads.A.leadId}`);
    assert.equal(detail.status, 401, detail.text);
    const reveal = await anonymous.request("POST", `${LEADS}/${leads.A.leadId}/reveal`);
    assert.equal(reveal.status, 401, reveal.text);
  });

  /* ----------------------------------------------------------- 5-17 filters */

  const labelOf = (row: Record<string, unknown>) =>
    Object.entries(leads).find(([, lead]) => lead.leadId === row.leadId)?.[0] ?? "?";

  async function labels(query: string) {
    const reply = await analyst.request("GET", `${LEADS}?${query}&limit=100`);
    assert.equal(reply.status, 200, `${query}: ${reply.text}`);
    return arr(reply.body.rows).map(labelOf).sort();
  }

  await check("5 the attributed filter selects only attributed leads", async () => {
    assert.deepEqual(await labels("attributionState=attributed"), ["A", "B", "C"]);
  });

  await check("6 the direct filter selects only direct leads", async () => {
    assert.deepEqual(await labels("attributionState=unattributed"), ["D", "E", "F", "G", "P"]);
  });

  await check("7 the affiliate filter selects that affiliate's leads", async () => {
    assert.deepEqual(await labels(`affiliatePartnerId=${alpha.id}`), ["A", "C"]);
    assert.deepEqual(await labels(`affiliatePartnerId=${beta.id}`), ["B"]);
  });

  await check("8 the campaign filter narrows within an affiliate", async () => {
    assert.deepEqual(await labels(`affiliateCampaignId=${alphaOne.id}`), ["A", "C"]);
    assert.deepEqual(await labels(`affiliateCampaignId=${betaOne.id}`), ["B"]);
  });

  await check("9 the tracking-link filter selects the SELECTED link", async () => {
    assert.deepEqual(await labels(`affiliateTrackingLinkId=${linkA2.id}`), ["A"]);
    assert.deepEqual(await labels(`affiliateTrackingLinkId=${linkA1.id}`), ["C"]);
    // An ARCHIVED link still reports the history it acquired.
    assert.deepEqual(await labels(`affiliateTrackingLinkId=${linkB1.id}`), ["B"]);
  });

  await check("10 the Academy-registered stage filter", async () => {
    assert.deepEqual(await labels("journeyStage=academy_registered"), ["E", "G"]);
  });

  await check("11 the Pocket-registered stage filter", async () => {
    assert.deepEqual(await labels("journeyStage=pocket_registered"), ["C", "F", "P"]);
  });

  await check("12 the confirmed-deposit stage filter", async () => {
    assert.deepEqual(await labels("journeyStage=first_deposit_confirmed"), ["A", "B", "D"]);
  });

  await check("13 the pending deposit-state filter", async () => {
    assert.deepEqual(await labels("depositState=pending_identity"), ["P"]);
  });

  await check("14 the conflict deposit-state filter", async () => {
    assert.deepEqual(await labels("depositState=conflict"), ["C"]);
  });

  await check("15 the registration period bounds by the registration", async () => {
    assert.deepEqual(
      await labels("registrationPreset=custom&registrationStartDate=2026-03-01&registrationEndDate=2026-04-01"),
      ["A"],
    );
  });

  await check("16 the acquisition period bounds by the selected click", async () => {
    assert.deepEqual(
      await labels("acquisitionPreset=custom&acquisitionStartDate=2026-03-09&acquisitionEndDate=2026-03-10"),
      ["A"],
    );
  });

  await check("17 both periods are applied together and echoed separately", async () => {
    const reply = await analyst.request(
      "GET",
      `${LEADS}?registrationPreset=custom&registrationStartDate=2026-03-01&registrationEndDate=2026-04-01` +
        `&acquisitionPreset=custom&acquisitionStartDate=2026-03-09&acquisitionEndDate=2026-03-10&limit=100`,
    );
    assert.equal(reply.status, 200, reply.text);
    assert.deepEqual(arr(reply.body.rows).map(labelOf), ["A"]);

    const periods = obj(reply.body.periods);
    assert.notEqual(periods.registration, null);
    assert.notEqual(periods.acquisition, null);
    assert.notDeepEqual(periods.registration, periods.acquisition);
    assert.equal(obj(periods.registration).timezone, MSK);
    assert.equal(obj(periods.registration).weekStart, "monday");
    assert.equal(obj(periods.registration).intervalConvention, "start_inclusive_end_exclusive");

    // A contradiction returns nothing rather than silently using one window.
    const empty = await analyst.request(
      "GET",
      `${LEADS}?registrationPreset=custom&registrationStartDate=2026-06-01&registrationEndDate=2026-07-01` +
        `&acquisitionPreset=custom&acquisitionStartDate=2026-03-09&acquisitionEndDate=2026-03-10&limit=100`,
    );
    assert.equal(arr(empty.body.rows).length, 0);
  });

  /* -------------------------------------------------------- 18-21 paging */

  await check("18 the first page honours the default size and reports hasMore", async () => {
    const reply = await analyst.request("GET", `${LEADS}?limit=3`);
    assert.equal(reply.status, 200, reply.text);
    assert.equal(arr(reply.body.rows).length, 3);
    assert.equal(reply.body.hasMore, true);
    assert.equal(reply.body.pageSize, 3);
    assert.equal(reply.body.defaultPageSize, 25);
    assert.equal(reply.body.maxPageSize, 100);
    assert.equal(reply.body.sort, "registration_desc");
    assert.ok(typeof reply.body.nextCursor === "string");

    const defaults = await analyst.request("GET", LEADS);
    assert.equal(obj(defaults.body).pageSize, 25);
    const tooBig = await analyst.request("GET", `${LEADS}?limit=101`);
    assert.equal(tooBig.status, 400);
  });

  await check("19 the cursor walks the whole population with no gap or repeat", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const reply: Reply = await analyst.request(
        "GET",
        `${LEADS}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      assert.equal(reply.status, 200, reply.text);
      for (const row of arr(reply.body.rows)) seen.push(String(row.leadId));
      if (reply.body.hasMore !== true) {
        assert.equal(reply.body.nextCursor, null, "the final page must not offer a cursor");
        break;
      }
      cursor = String(reply.body.nextCursor);
    }
    assert.equal(seen.length, leadCount, "the walk lost or invented rows");
    assert.equal(new Set(seen).size, leadCount, "a row appeared on two pages");
  });

  await check("20 a tampered cursor is refused, and so is a replayed one", async () => {
    const first = await analyst.request("GET", `${LEADS}?limit=2`);
    const cursor = String(first.body.nextCursor);

    for (const bad of [`${cursor}X`, "not-a-cursor", "a".repeat(600), ""]) {
      const reply = await analyst.request("GET", `${LEADS}?limit=2&cursor=${encodeURIComponent(bad)}`);
      assert.equal(reply.status, 400, `accepted a tampered cursor: ${bad.slice(0, 20)}`);
    }

    // The SAME cursor against a different predicate or ordering is refused.
    const rebound = await analyst.request(
      "GET",
      `${LEADS}?limit=2&attributionState=attributed&cursor=${encodeURIComponent(cursor)}`,
    );
    assert.equal(rebound.status, 400, rebound.text);
    assert.equal(rebound.body.messageKey, "crm.leads.cursor_filter_mismatch");

    const resorted = await analyst.request(
      "GET",
      `${LEADS}?limit=2&sort=registration_asc&cursor=${encodeURIComponent(cursor)}`,
    );
    assert.equal(resorted.status, 400, resorted.text);
  });

  await check("21 every supported sort is accepted and an arbitrary one is not", async () => {
    for (const sort of [
      "registration_desc",
      "registration_asc",
      "acquisition_desc",
      "acquisition_asc",
      "pocket_registration_desc",
      "first_deposit_desc",
    ]) {
      const reply = await analyst.request("GET", `${LEADS}?sort=${sort}&limit=100`);
      assert.equal(reply.status, 200, `${sort}: ${reply.text}`);
      assert.equal(arr(reply.body.rows).length, leadCount, sort);
    }
    for (const sort of ["email", "email_desc", "id", "1", "registration"]) {
      const reply = await analyst.request("GET", `${LEADS}?sort=${sort}`);
      assert.equal(reply.status, 400, sort);
    }
  });

  /* ---------------------------------------------------- 22-27 PII contract */

  await check("22 the analyst's redacted detail carries no identity", async () => {
    const reply = await analyst.request("GET", `${LEADS}/${leads.A.leadId}`);
    assert.equal(reply.status, 200, reply.text);
    const lead = obj(obj(reply.body.lead));
    assert.equal(lead.piiState, "redacted");
    assert.equal(lead.displayName, null);
    assert.ok(String(lead.maskedEmail).includes("***"));
    assert.ok(!reply.text.includes(leads.A.email));
    assert.ok(!reply.text.includes(leads.A.name));
    assert.equal(lead.canRevealPii, false);
  });

  await check("23 the analyst is refused the reveal", async () => {
    const reply = await analyst.postWithCsrf(`${LEADS}/${leads.A.leadId}/reveal`);
    assert.equal(reply.status, 403, reply.text);
    assert.ok(!reply.text.includes(leads.A.email));
    assert.ok(!reply.text.includes(leads.A.name));
  });

  await check("24 a denied reveal does not disclose whether a lead exists", async () => {
    const real = await analyst.postWithCsrf(`${LEADS}/${leads.A.leadId}/reveal`);
    const fake = await analyst.postWithCsrf(`${LEADS}/v1_${"z".repeat(32)}/reveal`);
    // Identical refusals: authorization is decided before any lookup.
    assert.equal(real.status, 403);
    assert.equal(fake.status, 403);
    assert.equal(obj(real.body).code, obj(fake.body).code);
    assert.equal(obj(real.body).messageKey, obj(fake.body).messageKey);
  });

  await check("25 the crm_admin's default detail is STILL redacted", async () => {
    const reply = await admin.request("GET", `${LEADS}/${leads.A.leadId}`);
    assert.equal(reply.status, 200, reply.text);
    const lead = obj(obj(reply.body.lead));
    assert.equal(lead.piiState, "redacted");
    assert.equal(lead.displayName, null);
    assert.ok(!reply.text.includes(leads.A.email), "an administrator saw a full address by default");
    // The capability hint differs; the CONTENT does not.
    assert.equal(lead.canRevealPii, true);
  });

  await check("26 the crm_admin may reveal ONE lead, explicitly", async () => {
    const reply = await admin.postWithCsrf(`${LEADS}/${leads.A.leadId}/reveal`);
    assert.equal(reply.status, 200, reply.text);
    const identity = obj(obj(reply.body.identity));
    assert.equal(identity.piiState, "revealed");
    assert.equal(identity.email, leads.A.email);
    assert.equal(identity.displayName, leads.A.name);
    assert.equal(identity.leadId, leads.A.leadId);
    // The closed field list, and nothing else.
    assert.deepEqual(Object.keys(identity).sort(), ["displayName", "email", "leadId", "piiState"]);
    assert.equal(reply.headers.get("cache-control"), "private, no-store");
    // No other learner's identity travels with it.
    for (const [label, lead] of Object.entries(leads)) {
      if (label === "A") continue;
      assert.ok(!reply.text.includes(lead.email), `the reveal leaked ${label}`);
    }
  });

  await check("27 the reveal requires CSRF and refuses GET", async () => {
    const noToken = await admin.request("POST", `${LEADS}/${leads.B.leadId}/reveal`);
    assert.equal(noToken.status, 403, noToken.text);
    assert.ok(!noToken.text.includes(leads.B.email));

    const wrongToken = await admin.request("POST", `${LEADS}/${leads.B.leadId}/reveal`, undefined, {
      "x-csrf-token": "not-the-cookie",
    });
    assert.equal(wrongToken.status, 403, wrongToken.text);

    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const reply = await admin.request(method, `${LEADS}/${leads.B.leadId}/reveal`);
      assert.ok(
        reply.status === 405 || reply.status === 404,
        `${method} reveal answered ${reply.status}`,
      );
      assert.ok(!reply.text.includes(leads.B.email), `${method} reveal leaked an address`);
    }
  });

  await check("28 the successful reveal wrote exactly one bounded audit row", async () => {
    const rows = await db.auditLog.findMany({
      where: { action: "AFFILIATE_LEAD_PII_REVEALED" },
      orderBy: { id: "asc" },
    });
    assert.equal(rows.length, 1, "one successful reveal must write exactly one row");
    const row = rows[0];
    assert.equal(row.entityType, "AFFILIATE_LEAD");
    assert.equal(row.entityId, leads.A.leadId);
    assert.equal(row.userId, owner.id, "the actor is the authenticated staff user");

    const metadata = JSON.stringify(row.metadata);
    assert.ok(metadata.includes(leads.A.leadId));
    // NO PII in the audit trail: relocating the disclosure into a table more
    // people can read is not protecting it.
    for (const lead of Object.values(leads)) {
      assert.ok(!metadata.includes(lead.email), "the audit row quoted an address");
      assert.ok(!metadata.includes(lead.name), "the audit row quoted a name");
      assert.ok(!metadata.includes(String(lead.userId)) || !metadata.includes(`"userId"`));
    }
    for (const forbidden of ["pocketUserId", "pocketClickId", "ataClickId", "SECRET", "password"]) {
      assert.ok(!metadata.includes(forbidden), `the audit row carried ${forbidden}`);
    }

    // The audit row count grew by exactly the reveals plus the CSRF refusals
    // the established owner records — never one row per listed lead.
    const total = await db.auditLog.count();
    assert.ok(total - auditBefore < leadCount, "the list wrote per-row audit noise");
  });

  await check("29 there is no bulk reveal and no reveal collection route", async () => {
    for (const route of [
      `${LEADS}/reveal`,
      `${LEADS}/*/reveal`,
      `${LEADS}/all/reveal`,
      `${LEADS}/export`,
    ]) {
      const reply = await admin.postWithCsrf(route);
      assert.ok(reply.status >= 400, `${route} answered ${reply.status}`);
      for (const lead of Object.values(leads)) {
        assert.ok(!reply.text.includes(lead.email), `${route} leaked an address`);
      }
    }
  });

  /* ------------------------------------------------- 30-38 journey and timeline */

  async function detail(label: string) {
    const reply = await admin.request("GET", `${LEADS}/${leads[label].leadId}`);
    assert.equal(reply.status, 200, `${label}: ${reply.text}`);
    return { reply, lead: obj(obj(reply.body.lead)) };
  }

  await check("30 lead A: two-touch acquisition with role deduplication", async () => {
    const { lead } = await detail("A");
    const acquisition = obj(lead.acquisition);
    assert.equal(acquisition.attributionState, "attributed");
    assert.equal(obj(acquisition.affiliate).code, "alpha");
    assert.equal(obj(acquisition.campaign).code, "alpha-one");
    assert.equal(obj(acquisition.trackingLink).code, linkA2.publicCode);
    assert.equal(acquisition.firstTouchAt, msk(2026, 3, 1, 8).toISOString());
    assert.equal(acquisition.lastTouchAt, msk(2026, 3, 9, 8).toISOString());
    assert.equal(acquisition.selectedTouchAt, msk(2026, 3, 9, 8).toISOString());
    assert.equal(acquisition.acquisitionModel, "last_eligible_affiliate_click");

    const items = arr(obj(lead.timeline).items);
    const touches = items.filter((item) => item.roles !== null);
    // Two clicks, two items — not three rows for two occurrences.
    assert.equal(touches.length, 2);
    assert.deepEqual(touches[0].roles, ["first_touch"]);
    assert.deepEqual(touches[1].roles, ["last_touch", "selected"]);
  });

  await check("31 lead A: the full factual timeline, in order", async () => {
    const { lead } = await detail("A");
    const timeline = obj(lead.timeline);
    const sequence = arr(timeline.items).map((item) => String(item.eventType));
    assert.deepEqual(sequence, [
      "acquisition_first_touch",
      "acquisition_selected",
      "academy_registration",
      "pocket_registration",
      "first_deposit_confirmed",
    ]);
    // Matched on arrival: no pending step was invented.
    assert.ok(!sequence.includes("first_deposit_received_pending"));
    assert.equal(timeline.truncated, false);
    assert.equal(timeline.maxItems, 50);

    const instants = arr(timeline.items).map((item) => new Date(String(item.occurredAt)).getTime());
    for (let index = 1; index < instants.length; index += 1) {
      assert.ok(instants[index - 1] <= instants[index], "the timeline is out of order");
    }
  });

  await check("32 lead B: pending, then the binding, then confirmed", async () => {
    const { lead } = await detail("B");
    const sequence = arr(obj(lead.timeline).items).map((item) => String(item.eventType));
    assert.deepEqual(sequence, [
      "acquisition_selected",
      "academy_registration",
      "first_deposit_received_pending",
      "pocket_registration",
      "first_deposit_confirmed",
    ]);
    assert.equal(obj(lead.journey).journeyStage, "first_deposit_confirmed");
    assert.equal(obj(lead.deposit).depositState, "confirmed");
    assert.equal(obj(lead.deposit).firstReceivedAt, msk(2026, 4, 6, 10).toISOString());
    assert.equal(obj(lead.deposit).confirmedAt, msk(2026, 4, 8, 10).toISOString());
  });

  await check("33 lead C: a conflict that was never counted", async () => {
    const { lead } = await detail("C");
    const sequence = arr(obj(lead.timeline).items).map((item) => String(item.eventType));
    assert.ok(sequence.includes("first_deposit_conflict_detected"));
    assert.ok(!sequence.includes("first_deposit_confirmed"));
    assert.equal(obj(lead.journey).journeyStage, "pocket_registered");
    assert.equal(obj(lead.deposit).depositState, "conflict");
    assert.equal(obj(lead.deposit).conflictCategory, "identity_owner_mismatch");
    assert.equal(obj(lead.deposit).confirmedAt, null);
  });

  await check("34 lead D: a direct lead with a real deposit and no affiliate", async () => {
    const { reply, lead } = await detail("D");
    const acquisition = obj(lead.acquisition);
    assert.equal(acquisition.attributionState, "unattributed");
    assert.equal(acquisition.affiliate, null);
    assert.equal(acquisition.campaign, null);
    assert.equal(acquisition.trackingLink, null);
    assert.equal(acquisition.selectedTouchAt, null);
    assert.equal(obj(lead.journey).journeyStage, "first_deposit_confirmed");
    // Direct is stated as a reason, not as a missing field.
    assert.equal(obj(obj(reply.body.dataAvailability).acquisition).available, false);
    assert.equal(obj(obj(reply.body.dataAvailability).acquisition).reason, "direct_registration");
  });

  await check("35 lead E: Academy only", async () => {
    const { reply, lead } = await detail("E");
    assert.equal(obj(lead.journey).journeyStage, "academy_registered");
    assert.equal(obj(lead.deposit).depositState, "none");
    assert.equal(obj(lead.journey).pocketRegisteredAt, null);
    assert.deepEqual(
      arr(obj(lead.timeline).items).map((item) => String(item.eventType)),
      ["academy_registration"],
    );
    const availability = obj(reply.body.dataAvailability);
    assert.equal(obj(availability.pocketRegistration).available, false);
    assert.equal(obj(availability.firstDeposit).state, "absent");
  });

  await check("36 lead F: Pocket registered with no deposit", async () => {
    const { lead } = await detail("F");
    assert.equal(obj(lead.journey).journeyStage, "pocket_registered");
    assert.equal(obj(lead.deposit).depositState, "none");
    assert.notEqual(obj(lead.journey).pocketRegisteredAt, null);
  });

  await check("37 lead G: the duplicate registration is flagged, not duplicated", async () => {
    const { lead } = await detail("G");
    assert.ok(
      (lead.integrityFlags as string[]).includes("duplicate_academy_registration"),
      JSON.stringify(lead.integrityFlags),
    );
    const list = await analyst.request("GET", `${LEADS}?limit=100`);
    const matches = arr(list.body.rows).filter((row) => labelOf(row) === "G");
    assert.equal(matches.length, 1, "the learner occupied two positions in the page");
  });

  await check("38 lead P: pending, with the reconciliation anomaly reported", async () => {
    const { reply, lead } = await detail("P");
    assert.equal(obj(lead.deposit).depositState, "pending_identity");
    assert.equal(obj(lead.journey).journeyStage, "pocket_registered");
    assert.equal(obj(lead.journey).firstDepositConfirmedAt, null);
    assert.ok(
      (lead.integrityFlags as string[]).includes("deposit_pending_after_identity_binding"),
      JSON.stringify(lead.integrityFlags),
    );
    assert.equal(obj(obj(reply.body.dataAvailability).firstDeposit).state, "pending");
  });

  /* ---------------------------------------------- 39-45 privacy and hygiene */

  await check("39 no list or detail response carries an identifier or PII", async () => {
    const identities = await db.pocketTraderIdentity.findMany({
      select: { pocketUserId: true, clickId: true },
    });
    const clicks = await db.affiliateClick.findMany({
      select: { ataClickId: true, anonymousVisitorId: true },
    });
    const events = await db.pocketProviderEvent.findMany({
      select: { pocketClickId: true, pocketPlayerId: true },
    });

    const routes = [
      `${LEADS}?limit=100`,
      ...Object.values(leads).map((lead) => `${LEADS}/${lead.leadId}`),
    ];

    for (const route of routes) {
      const reply = await admin.request("GET", route);
      assert.equal(reply.status, 200, route);

      for (const lead of Object.values(leads)) {
        assert.ok(!reply.text.includes(lead.email), `${route} leaked an address`);
        assert.ok(!reply.text.includes(lead.name), `${route} leaked a name`);
      }
      for (const identity of identities) {
        assert.ok(!reply.text.includes(identity.pocketUserId), `${route} leaked a Pocket player id`);
        assert.ok(!reply.text.includes(identity.clickId), `${route} leaked an identity click id`);
      }
      for (const click of clicks) {
        assert.ok(!reply.text.includes(click.ataClickId), `${route} leaked an ataClickId`);
        if (click.anonymousVisitorId) {
          assert.ok(!reply.text.includes(click.anonymousVisitorId), `${route} leaked a visitor id`);
        }
      }
      for (const event of events) {
        assert.ok(!reply.text.includes(event.pocketClickId), `${route} leaked a Pocket click id`);
        assert.ok(!reply.text.includes(event.pocketPlayerId), `${route} leaked a Pocket player id`);
      }
      for (const forbidden of [
        "passwordHash",
        "POSTBACK_SECRET",
        "SESSION_SECRET",
        ATTRIBUTION_SECRET,
        TURNSTILE_TEST_SECRET,
        "trading_platform_session",
        '"userId"',
        '"ip"',
        "userAgent",
      ]) {
        assert.ok(!reply.text.includes(forbidden), `${route} leaked ${forbidden}`);
      }
    }
  });

  await check("40 no lead reports a redeposit or a current balance", async () => {
    const reply = await admin.request("GET", `${LEADS}/${leads.A.leadId}`);
    const availability = obj(reply.body.dataAvailability);
    assert.deepEqual(availability.redeposit, {
      available: false,
      reason: "provider_transaction_identifier_missing",
    });
    assert.deepEqual(availability.currentBalance, {
      available: false,
      reason: "prohibited_not_collected",
    });
    assert.deepEqual(availability.educationTimeline, {
      available: false,
      reason: "authoritative_product_event_catalog_not_implemented",
    });
    assert.deepEqual(availability.trafficSubParameters, {
      available: false,
      reason: "sensitive_acquisition_metadata_not_exposed",
    });
    // The DECLARATIONS above are the only place those words appear. What must
    // not exist is a redeposit COUNT or a balance VALUE — an absence rendered
    // as a number is exactly what the availability block exists to prevent.
    const lead = obj(obj(reply.body.lead));
    const body = JSON.stringify(lead);
    for (const forbidden of ["redeposit", "balance", "Balance", "redepositCount"]) {
      assert.ok(!body.includes(forbidden), `the lead payload carried ${forbidden}`);
    }
    assert.equal(availability.redeposit && "count" in obj(availability.redeposit), false);
    assert.equal(availability.currentBalance && "value" in obj(availability.currentBalance), false);
  });

  await check("41 the list is never cached and never mutable", async () => {
    const list = await analyst.request("GET", LEADS);
    assert.equal(list.headers.get("cache-control"), "private, no-store");
    const detailReply = await analyst.request("GET", `${LEADS}/${leads.A.leadId}`);
    assert.equal(detailReply.headers.get("cache-control"), "private, no-store");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const route of [LEADS, `${LEADS}/${leads.A.leadId}`]) {
        const reply = await admin.request(method, route, {});
        assert.ok(
          reply.status === 405 || reply.status === 404 || reply.status === 403,
          `${method} ${route} answered ${reply.status}`,
        );
      }
    }
  });

  await check("42 a bad lead reference is refused without a lookup", async () => {
    const cases: [string, number][] = [
      [`v2_${"a".repeat(32)}`, 400],
      ["a".repeat(32), 400],
      ["1", 400],
      [`v1_${"a".repeat(31)}`, 400],
      [`v1_${"z".repeat(32)}`, 404],
    ];
    for (const [leadId, expected] of cases) {
      const reply = await admin.request("GET", `${LEADS}/${encodeURIComponent(leadId)}`);
      assert.equal(reply.status, expected, `${leadId} answered ${reply.status}: ${reply.text}`);
    }
  });

  await check("43 an unknown or duplicated query key is refused", async () => {
    const unknown = await analyst.request("GET", `${LEADS}?search=nina`);
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.messageKey, "crm.leads.query_unknown");

    const email = await analyst.request("GET", `${LEADS}?email=${encodeURIComponent(leads.A.email)}`);
    assert.equal(email.status, 400, "an arbitrary email search was accepted");
    assert.ok(!email.text.includes(leads.A.email));

    const duplicated = await analyst.request("GET", `${LEADS}?sort=registration_desc&sort=registration_asc`);
    assert.equal(duplicated.status, 400);
    assert.equal(duplicated.body.messageKey, "crm.leads.query_duplicated");

    // The detail route takes no query at all.
    const noisyDetail = await analyst.request("GET", `${LEADS}/${leads.A.leadId}?reveal=true`);
    assert.equal(noisyDetail.status, 400, noisyDetail.text);
  });

  await check("44 the analytics availability blocks now point at the drilldown", async () => {
    const summary = await analyst.request(
      "GET",
      "/api/crm/v1/affiliates/analytics/summary?preset=all_time",
    );
    assert.equal(summary.status, 200, summary.text);
    assert.deepEqual(obj(obj(summary.body.dataAvailability).leadDrilldown), { available: true });

    const cohorts = await analyst.request(
      "GET",
      "/api/crm/v1/affiliates/analytics/cohorts/summary?preset=all_time",
    );
    assert.equal(cohorts.status, 200, cohorts.text);
    assert.deepEqual(obj(obj(cohorts.body.dataAvailability).leadDrilldown), { available: true });
  });

  await check("45 the list agrees with the detail for every lead", async () => {
    const list = await admin.request("GET", `${LEADS}?limit=100`);
    for (const row of arr(list.body.rows)) {
      const reply = await admin.request("GET", `${LEADS}/${row.leadId}`);
      assert.equal(reply.status, 200);
      const lead = obj(obj(reply.body.lead));
      assert.equal(row.journeyStage, obj(lead.journey).journeyStage, String(row.leadId));
      assert.equal(row.depositState, obj(lead.deposit).depositState, String(row.leadId));
      assert.equal(row.attributionState, obj(lead.acquisition).attributionState);
      assert.equal(row.maskedEmail, lead.maskedEmail);
      assert.equal(row.piiState, "redacted");
      assert.equal("timeline" in row, false, "a list row carried a timeline");
    }
  });

  /* ------------------------------------------------------------- teardown */

  const auditAfter = await db.auditLog.count();
  const revealRows = await db.auditLog.count({ where: { action: "AFFILIATE_LEAD_PII_REVEALED" } });
  await db.$disconnect();

  await stopExact(backend, "backend");
  backend = null;

  if (OUT) {
    fs.writeFileSync(
      OUT,
      `${JSON.stringify(
        {
          schema: "ata.afd5b2b.isolated-e2e/1",
          phase: "AFD-5B2B",
          port: backendPort,
          leads: leadCount,
          auditRowsBefore: auditBefore,
          auditRowsAfter: auditAfter,
          revealAuditRows: revealRows,
          // Deliberately names checks, never lead identities or revealed values.
          checks: results,
          passed,
          failed,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`wrote ${OUT}`);
  }

  cleanupDb();

  console.log(`\nAFD-5B2B lead isolated E2E: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await stopExact(backend, "backend");
  cleanupDb();
  process.exit(1);
});
