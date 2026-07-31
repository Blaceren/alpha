import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { StaffRole } from "@prisma/client";

/**
 * AFD-5A — the isolated end-to-end affiliate management journey.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE FOUNDATION REGRESSION. That suite drives
 * the Backend directly. This one drives the REAL CRM ORIGIN: every request goes
 * to the CRM's own port and reaches the Backend only through the CRM's explicit
 * Next rewrite allowlist. That is the only way to prove the three things a CRM
 * phase actually claims — the proxy forwards exactly the reviewed paths, the
 * session cookie survives the hop, and a read-only analyst is refused by the
 * BACKEND rather than by a hidden button.
 *
 * ISOLATION. Two loopback ports nobody else owns, a throwaway copy of the
 * database, synthetic staff accounts, an ephemeral session secret and a
 * SYNTHETIC https origin for the public link. It never touches the runtime
 * database, the deployed services, the live learner or the CRM admin, and it
 * makes no outbound request to Pocket or any other external host.
 */

const CRM_DIR = "/home/ubuntu/workspaces/ata-affiliate-management-crm-afd5a";

const dbPath = `/tmp/ata-afd5a-e2e-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const backendPort = 3190 + (process.pid % 20);
const crmPort = 3220 + (process.pid % 20);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const crmUrl = `http://127.0.0.1:${crmPort}`;

const password = "AffiliateCrmE2E123!";
const SESSION_SECRET = "afd5a-isolated-e2e-session-secret-value";
const ATTRIBUTION_SECRET = "Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MFFXRVJUWXVpb3A9";
/** Synthetic. Never the live bare-IP address, and never a real domain. */
const PUBLIC_ORIGIN = "https://affiliate-e2e.example";

const CSRF_COOKIE = "trading_platform_csrf";
const CSRF_TOKEN = "afd5a-isolated-e2e-csrf-token";

let passed = 0;
let failed = 0;
let backendLogs = "";
let crmLogs = "";

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
    if (crmLogs) console.error(`--- crm log tail ---\n${crmLogs.slice(-1500)}`);
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
  POSTBACK_SECRET: "afd5a-isolated-e2e-postback-secret",
  APP_URL: backendUrl,
  // The public origin the canonical tracking URL must be built from — and the
  // ONLY source the Backend will accept for it.
  PUBLIC_APP_URL: PUBLIC_ORIGIN,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
  // Attribution ON, so activation is a real operation in this runtime.
  AFFILIATE_ATTRIBUTION_ENABLED: "true",
  ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
  // Pocket stays OFF: this phase must never reach the provider.
  POCKET_POSTBACK_ENABLED: "false",
};
for (const key of ["NODE_ENV"]) delete backendEnv[key];

const crmEnv: NodeJS.ProcessEnv = {
  ...process.env,
  CRM_MODE: "api",
  CRM_BACKEND_ORIGIN: backendUrl,
  PORT: String(crmPort),
  HOSTNAME: "127.0.0.1",
  NEXT_TELEMETRY_DISABLED: "1",
};
for (const key of ["NODE_ENV"]) delete crmEnv[key];

/** Exact process-group handles. Nothing here is ever matched by name. */
let backend: ChildProcess | null = null;
let crm: ChildProcess | null = null;

async function waitForHttp(url: string, label: string, logs: () => string) {
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
  throw new Error(`${label} failed to start\n${logs().slice(-3000)}`);
}

async function startBackend() {
  const child = spawn("npx", ["next", "dev", "-p", String(backendPort)], {
    cwd: process.cwd(),
    env: backendEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (v) => (backendLogs += String(v)));
  child.stderr?.on("data", (v) => (backendLogs += String(v)));
  backend = child;
  await waitForHttp(`${backendUrl}/api/health`, "backend", () => backendLogs);
}

/**
 * Build the CRM against THIS run's backend origin.
 *
 * Next evaluates `rewrites()` at BUILD time and freezes the result into the
 * routes manifest, so a CRM built for some other origin proxies to that other
 * origin however it is later started. Rebuilding here is what makes the proxy
 * hop in this test the real one rather than a leftover from another build.
 */
function buildCrm() {
  const result = spawnSync("npx", ["next", "build"], {
    cwd: CRM_DIR,
    env: crmEnv,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`CRM build failed:\n${result.stdout?.slice(-3000)}\n${result.stderr?.slice(-3000)}`);
  }
}

async function startCrm() {
  const child = spawn("npx", ["next", "start", "-p", String(crmPort), "-H", "127.0.0.1"], {
    cwd: CRM_DIR,
    env: crmEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (v) => (crmLogs += String(v)));
  child.stderr?.on("data", (v) => (crmLogs += String(v)));
  crm = child;
  await waitForHttp(`${crmUrl}/login`, "crm", () => crmLogs);
}

/**
 * Stop EXACTLY the recorded process group.
 *
 * Never pkill, never killall, never a name or command-line match: the negative
 * group id is the pid this script itself spawned, so nothing else on the machine
 * can be signalled by accident.
 */
async function stopExact(child: ChildProcess | null, probeUrl: string, label: string) {
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
      await fetch(probeUrl, { signal: AbortSignal.timeout(500) });
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
};

/** A client that talks ONLY to the CRM origin. */
class CrmClient {
  cookies = new Map<string, string>();

  async request(
    method: string,
    urlPath: string,
    body?: unknown,
    options: { csrf?: boolean } = {},
  ): Promise<Reply> {
    const csrf = options.csrf !== false;
    if (csrf) this.cookies.set(CSRF_COOKIE, CSRF_TOKEN);

    const response = await fetch(`${crmUrl}${urlPath}`, {
      method,
      headers: {
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(csrf ? { "x-csrf-token": CSRF_TOKEN } : {}),
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
      value = JSON.parse(text);
    } catch {
      /* html or empty */
    }
    return { status: response.status, body: value as Record<string, unknown>, text };
  }

  /** Login through the CRM's own auth route, in Turnstile test/bypass mode. */
  async login(email: string) {
    return this.request("POST", "/api/crm/auth/login", {
      email,
      password,
      captchaToken: "dev-captcha-ok",
    });
  }
}

const PARTNERS = "/api/crm/v1/affiliates/partners";
const CAMPAIGNS = "/api/crm/v1/affiliates/campaigns";
const LINKS = "/api/crm/v1/affiliates/tracking-links";

async function loginAs(email: string) {
  const client = new CrmClient();
  const reply = await client.login(email);
  assert.equal(reply.status, 200, `CRM login failed for ${email}: ${reply.status} ${reply.text}`);
  return client;
}

async function main() {
  cleanupDb();

  // ---------------------------------------------------------------- schema
  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: backendEnv, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `migrate failed: ${migrate.stderr}`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const hash = await bcrypt.hash(password, 10);

  // -------------------------------------------------------- synthetic staff
  const staff: Record<string, string> = {};
  for (const role of ["crm_admin", "analyst", "support"] as const) {
    const email = `afd5a-e2e-${role}@example.invalid`;
    const user = await prisma.user.create({
      data: { email, name: `E2E ${role}`, role: "admin", passwordHash: hash },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, displayName: `E2E ${role}`, staffRole: role as StaffRole },
    });
    staff[role] = email;
  }

  try {
    await startBackend();
    buildCrm();
    await startCrm();

    /* ============================================ 1. crm_admin journey === */

    const admin = await loginAs(staff.crm_admin);
    let partnerId = "";
    let campaignId = "";
    let linkId = "";
    let publicCode = "";

    await check("1. crm_admin session is served through the CRM origin", async () => {
      const session = await admin.request("GET", "/api/crm/v1/session");
      assert.equal(session.status, 200, session.text);
      const permissions = session.body.effectivePermissions as string[];
      assert.ok(permissions.includes("manage_settings"));
      assert.ok(permissions.includes("view_affiliate_analytics"));
    });

    await check("2. the Аффилейты section is reachable", async () => {
      const page = await admin.request("GET", "/affiliates");
      assert.equal(page.status, 200, `expected the affiliates route to render, got ${page.status}`);
    });

    await check("3. create Affiliate Alpha", async () => {
      const reply = await admin.request("POST", PARTNERS, {
        code: "alpha-e2e",
        displayName: "Affiliate Alpha",
        description: "Primary traffic source",
        defaultAttributionWindowDays: 30,
      });
      assert.equal(reply.status, 201, reply.text);
      partnerId = String(reply.body.id);
      assert.equal(reply.body.status, "active");
      assert.deepEqual(reply.body.inventory, {
        campaigns: 0,
        trackingLinks: 0,
        activeTrackingLinks: 0,
      });
    });

    await check("4. edit display name and notes", async () => {
      const reply = await admin.request("PATCH", `${PARTNERS}/${partnerId}`, {
        displayName: "Affiliate Alpha (renamed)",
        description: "Updated notes",
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.displayName, "Affiliate Alpha (renamed)");
      // The immutable code is unchanged by an edit.
      assert.equal(reply.body.code, "alpha-e2e");
    });

    await check("5. create Campaign Alpha One", async () => {
      const reply = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: partnerId,
        code: "alpha-one",
        displayName: "Campaign Alpha One",
      });
      assert.equal(reply.status, 201, reply.text);
      campaignId = String(reply.body.id);
    });

    await check("6. create draft Link Alpha One", async () => {
      const reply = await admin.request("POST", LINKS, {
        affiliatePartnerId: partnerId,
        affiliateCampaignId: campaignId,
        displayName: "Link Alpha One",
        landingKey: "academy_registration",
      });
      assert.equal(reply.status, 201, reply.text);
      linkId = String(reply.body.id);
      publicCode = String(reply.body.publicCode);
      // A new link is a draft; creation never activates.
      assert.equal(reply.body.status, "draft");
    });

    await check("7-9. configure click parameter, sub1–sub5 and the attribution window", async () => {
      const reply = await admin.request("PATCH", `${LINKS}/${linkId}`, {
        externalClickParameter: "clickid",
        sub1Parameter: "utm_source",
        sub2Parameter: "utm_medium",
        sub3Parameter: "utm_campaign",
        sub4Parameter: "sub_four",
        sub5Parameter: "sub_five",
        attributionWindowDays: 14,
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.externalClickParameter, "clickid");
      assert.deepEqual(reply.body.subParameters, {
        sub1: "utm_source",
        sub2: "utm_medium",
        sub3: "utm_campaign",
        sub4: "sub_four",
        sub5: "sub_five",
      });
      assert.equal(reply.body.effectiveAttributionWindowDays, 14);
    });

    await check("9b. a duplicate parameter mapping is refused", async () => {
      const reply = await admin.request("PATCH", `${LINKS}/${linkId}`, {
        sub1Parameter: "clickid",
      });
      assert.equal(reply.status, 400, reply.text);
    });

    await check("9c. a protected parameter name is refused", async () => {
      for (const name of ["ow", "goal", "playerid", "token", "redirect"]) {
        const reply = await admin.request("PATCH", `${LINKS}/${linkId}`, {
          externalClickParameter: name,
        });
        assert.equal(reply.status, 400, `${name}: ${reply.text}`);
      }
    });

    await check("10. the canonical public path and URL come from the configured origin", async () => {
      const reply = await admin.request("GET", `${LINKS}/${linkId}`);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.publicPath, `/go/${publicCode}`);
      assert.equal(reply.body.publicUrl, `${PUBLIC_ORIGIN}/go/${publicCode}`);
      assert.equal(reply.body.publicUrlUnavailableReason, null);
      // Neither internal origin may ever appear in a copyable link.
      assert.ok(!reply.text.includes(String(backendPort)), "leaked the backend port");
      assert.ok(!reply.text.includes(String(crmPort)), "leaked the CRM port");
      assert.ok(!reply.text.includes("127.0.0.1"), "leaked a loopback host");
    });

    await check("10b. a forged Host header cannot change the canonical URL", async () => {
      // The decisive check for the whole generated-link contract.
      for (const host of ["evil.example", "attacker.test:8443"]) {
        const response = await fetch(`${crmUrl}${LINKS}/${linkId}`, {
          headers: {
            cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
            host,
            "x-forwarded-host": host,
            "x-forwarded-proto": "https",
            referer: `https://${host}/`,
          },
        });
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(
          body.publicUrl,
          `${PUBLIC_ORIGIN}/go/${publicCode}`,
          `Host ${host} changed the canonical URL`,
        );
        assert.ok(!JSON.stringify(body).includes("evil"), "attacker host reached the DTO");
        assert.ok(!JSON.stringify(body).includes("attacker"), "attacker host reached the DTO");
      }
    });

    await check("12. activate the link", async () => {
      const reply = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "active" });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.status, "active");
      assert.equal(reply.body.publicRouteState, "serving");
    });

    await check("14. pause the link", async () => {
      const reply = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "paused" });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.publicRouteState, "not_active");
    });

    await check("15. reactivate the link", async () => {
      const reply = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "active" });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.body.status, "active");
    });

    await check("17-18. pausing the affiliate makes every child unavailable", async () => {
      const paused = await admin.request("PATCH", `${PARTNERS}/${partnerId}`, { status: "paused" });
      assert.equal(paused.status, 200, paused.text);

      // The link's OWN status is untouched — only its effective availability moves.
      const link = await admin.request("GET", `${LINKS}/${linkId}`);
      assert.equal(link.body.status, "active", "the operator's stored status must not be rewritten");
      assert.equal(link.body.availability, "paused");
      assert.equal(link.body.publicRouteState, "parent_paused");

      const campaign = await admin.request("GET", `${CAMPAIGNS}/${campaignId}`);
      assert.equal(campaign.body.status, "active");
      assert.equal(campaign.body.availability, "paused");
    });

    await check("19. resume the affiliate and the children serve again", async () => {
      const resumed = await admin.request("PATCH", `${PARTNERS}/${partnerId}`, { status: "active" });
      assert.equal(resumed.status, 200, resumed.text);
      const link = await admin.request("GET", `${LINKS}/${linkId}`);
      assert.equal(link.body.publicRouteState, "serving");
    });

    await check("16. archive the link, and archive is terminal", async () => {
      const archived = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "archived" });
      assert.equal(archived.status, 200, archived.text);
      assert.equal(archived.body.status, "archived");
      assert.equal(archived.body.activationState, "terminal");

      const reactivate = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "active" });
      assert.equal(reactivate.status, 400, "an archived link must not reactivate");
    });

    await check("20-21. archive the campaign and its history stays visible", async () => {
      const archived = await admin.request("PATCH", `${CAMPAIGNS}/${campaignId}`, {
        status: "archived",
      });
      assert.equal(archived.status, 200, archived.text);

      const list = await admin.request("GET", `${CAMPAIGNS}?affiliatePartnerId=${partnerId}`);
      const items = list.body.items as Record<string, unknown>[];
      assert.equal(items.length, 1, "an archived campaign must remain listable");
      assert.equal(items[0].status, "archived");

      const link = await admin.request("GET", `${LINKS}/${linkId}`);
      assert.equal(link.status, 200, "an archived link must remain readable for history");
    });

    await check("22. inventory counts reflect configuration, and carry no traffic field", async () => {
      const partner = await admin.request("GET", `${PARTNERS}/${partnerId}`);
      assert.deepEqual(partner.body.inventory, {
        campaigns: 1,
        trackingLinks: 1,
        activeTrackingLinks: 0,
      });
      for (const forbidden of [
        "clicks", "uniqueVisitors", "registrations", "firstDeposits", "conversionRate",
        "revenue", "currentBalance", "redeposits", "ataClickId", "anonymousVisitorId",
      ]) {
        assert.ok(!partner.text.includes(forbidden), `partner DTO leaked ${forbidden}`);
      }
    });

    /* ============================================== 2. analyst journey === */

    const analyst = await loginAs(staff.analyst);

    await check("23-27. analyst may open the section and read every entity", async () => {
      const session = await analyst.request("GET", "/api/crm/v1/session");
      assert.equal(session.status, 200);
      const permissions = session.body.effectivePermissions as string[];
      assert.deepEqual(permissions, ["view_affiliate_analytics"]);

      assert.equal((await analyst.request("GET", "/affiliates")).status, 200);
      assert.equal((await analyst.request("GET", PARTNERS)).status, 200);
      assert.equal((await analyst.request("GET", `${PARTNERS}/${partnerId}`)).status, 200);
      assert.equal((await analyst.request("GET", CAMPAIGNS)).status, 200);
      assert.equal((await analyst.request("GET", `${CAMPAIGNS}/${campaignId}`)).status, 200);
      assert.equal((await analyst.request("GET", LINKS)).status, 200);
      assert.equal((await analyst.request("GET", `${LINKS}/${linkId}`)).status, 200);
    });

    await check("29-30. every analyst mutation is refused 403 by the Backend", async () => {
      // Direct API calls with a valid session and a valid CSRF token. Nothing
      // here depends on a hidden button.
      const attempts: [string, string, unknown][] = [
        ["POST", PARTNERS, { code: "analyst-x", displayName: "X" }],
        ["PATCH", `${PARTNERS}/${partnerId}`, { displayName: "Hacked" }],
        ["PATCH", `${PARTNERS}/${partnerId}`, { status: "archived" }],
        ["POST", CAMPAIGNS, { affiliatePartnerId: partnerId, code: "cx", displayName: "X" }],
        ["PATCH", `${CAMPAIGNS}/${campaignId}`, { displayName: "Hacked" }],
        ["POST", LINKS, { affiliatePartnerId: partnerId, displayName: "X" }],
        ["PATCH", `${LINKS}/${linkId}`, { status: "active" }],
        ["PATCH", `${LINKS}/${linkId}`, { externalClickParameter: "other" }],
        ["PATCH", `${LINKS}/${linkId}`, { attributionWindowDays: 99 }],
      ];
      for (const [method, url, body] of attempts) {
        const reply = await analyst.request(method, url, body);
        assert.equal(reply.status, 403, `${method} ${url} was not refused: ${reply.text}`);
        assert.equal(reply.body.code, "forbidden");
      }
    });

    await check("31. the refused writes changed nothing", async () => {
      const partner = await admin.request("GET", `${PARTNERS}/${partnerId}`);
      assert.equal(partner.body.displayName, "Affiliate Alpha (renamed)");
      assert.equal(partner.body.status, "active");
      const link = await admin.request("GET", `${LINKS}/${linkId}`);
      assert.equal(link.body.status, "archived");
      assert.equal(link.body.externalClickParameter, "clickid");
      assert.equal(link.body.effectiveAttributionWindowDays, 14);

      const partnerCount = await prisma.affiliatePartner.count();
      const campaignCount = await prisma.affiliateCampaign.count();
      const linkCount = await prisma.affiliateTrackingLink.count();
      assert.equal(partnerCount, 1);
      assert.equal(campaignCount, 1);
      assert.equal(linkCount, 1);
    });

    /* ========================================= 3. unauthorized journey === */

    const unauthorized = await loginAs(staff.support);

    await check("32-34. unauthorized staff is refused on every affiliate route", async () => {
      const session = await unauthorized.request("GET", "/api/crm/v1/session");
      assert.equal(session.status, 200);
      const permissions = session.body.effectivePermissions as string[];
      assert.ok(!permissions.includes("view_affiliate_analytics"));
      assert.ok(!permissions.includes("manage_settings"));

      for (const url of [PARTNERS, CAMPAIGNS, LINKS, `${PARTNERS}/${partnerId}`]) {
        const reply = await unauthorized.request("GET", url);
        assert.equal(reply.status, 403, `${url}: ${reply.text}`);
      }
    });

    await check("34b. anonymous is 401, never 200", async () => {
      const anon = new CrmClient();
      for (const url of [PARTNERS, CAMPAIGNS, LINKS]) {
        const reply = await anon.request("GET", url);
        assert.equal(reply.status, 401, `${url}: ${reply.status}`);
      }
    });

    await check("34c. a mutation without a CSRF token is refused", async () => {
      const reply = await admin.request(
        "POST",
        PARTNERS,
        { code: "nocsrf-e2e", displayName: "No CSRF" },
        { csrf: false },
      );
      assert.equal(reply.status, 403, reply.text);
      assert.equal(await prisma.affiliatePartner.count(), 1, "a CSRF-refused write created a row");
    });

    /* ==================================================== 4. safety === */

    await check("35-41. no traffic, conversion, deposit or balance data was created", async () => {
      assert.equal(await prisma.affiliateClick.count(), 0, "a traffic click was recorded");
      assert.equal(await prisma.affiliateAttribution.count(), 0, "an attribution was frozen");
      assert.equal(await prisma.affiliateConversionEvent.count(), 0, "a conversion was recorded");
      assert.equal(await prisma.pocketProviderEvent.count(), 0, "a Pocket provider event exists");
    });

    await check("35b. the public acquisition route was never exercised", async () => {
      // The CRM origin does not proxy /go/{publicCode} at all: it is absent from
      // the rewrite allowlist, so the CRM answers its own 404 rather than
      // forwarding traffic to the Backend.
      const reply = await admin.request("GET", `/go/${publicCode}`);
      assert.equal(reply.status, 404, `the CRM must not proxy the public route (${reply.status})`);
      assert.equal(await prisma.affiliateClick.count(), 0);
    });

    await check("35c. the CRM proxies no unlisted affiliate path", async () => {
      for (const url of [
        `${PARTNERS}/${partnerId}/campaigns`,
        `${LINKS}/${linkId}/activate`,
        "/api/crm/v1/affiliates",
        "/api/pocket/postback",
      ]) {
        const reply = await admin.request("GET", url);
        assert.notEqual(reply.status, 200, `${url} was proxied and answered 200`);
      }
    });

    await check("42. the live database was never referenced", () => {
      const forbidden = "/home/ubuntu/runtime/ata-dev-v2/data/ata-dev.sqlite";
      assert.ok(!backendLogs.includes(forbidden), "backend referenced the runtime database");
      assert.ok(!crmLogs.includes(forbidden), "crm referenced the runtime database");
      assert.equal(backendEnv.DATABASE_URL, dbUrl);
    });
  } finally {
    await stopExact(crm, `${crmUrl}/login`, "crm");
    await stopExact(backend, `${backendUrl}/api/health`, "backend");
    cleanupDb();
  }

  await check("43. the isolated databases were removed", () => {
    assert.ok(!fs.existsSync(dbPath), "temporary database still present");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await stopExact(crm, `${crmUrl}/login`, "crm");
  await stopExact(backend, `${backendUrl}/api/health`, "backend");
  cleanupDb();
  process.exit(1);
});
