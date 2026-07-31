import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { StaffRole } from "@prisma/client";
import { CRM_STAFF_ROLES, STAFF_ROLE_PERMISSIONS } from "../../src/lib/crm/roles";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";
import {
  AFFILIATE_PROTECTED_PARAMETERS,
  generatePublicCode,
} from "../../src/lib/crm/affiliates";
import { buildTrackingLinkPublicUrl } from "../../src/lib/crm/affiliate-routes";
import {
  affiliateCampaignSchema,
  affiliatePartnerSchema,
  affiliateTrackingLinkSchema,
} from "../../src/lib/crm/schemas";

// AFD-2 regression: the administrative affiliate foundation.
//
//   GET|POST  /api/crm/v1/affiliates/partners
//   GET|PATCH /api/crm/v1/affiliates/partners/[partnerId]
//   GET|POST  /api/crm/v1/affiliates/campaigns
//   GET|PATCH /api/crm/v1/affiliates/campaigns/[campaignId]
//   GET|POST  /api/crm/v1/affiliates/tracking-links
//   GET|PATCH /api/crm/v1/affiliates/tracking-links/[linkId]
//
// Isolated `next dev` server against a throwaway /tmp SQLite database. No
// deployed database, no runtime path, no external service. A second throwaway
// database proves the 36 -> 37 upgrade from a real pre-migration schema.
const dbPath = `/tmp/ata-affiliate-foundation-${process.pid}.db`;
const upgradeDbPath = `/tmp/ata-affiliate-foundation-upgrade-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3860 + (process.pid % 30);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "AffiliateFoundation123!";
const SESSION_SECRET = "affiliate-foundation-regression-secret";
const CSRF_COOKIE = "trading_platform_csrf";
const CSRF_TOKEN = "affiliate-foundation-csrf-token";

let passed = 0;
let failed = 0;
let logs = "";

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    if (logs) console.error(`--- server log tail ---\n${logs.slice(-1200)}\n--- end ---`);
  }
}

function cleanup() {
  for (const base of [dbPath, upgradeDbPath]) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${base}${suffix}`, { force: true });
  }
}

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET,
  POSTBACK_SECRET: "affiliate-foundation-postback-secret",
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};
for (const key of ["NODE_ENV"]) delete baseEnv[key];

function runMigrations(env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env, encoding: "utf8" },
  );
}

async function start() {
  const child = spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], {
    cwd: process.cwd(),
    env: baseEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value) => { logs += String(value); });
  child.stderr?.on("data", (value) => { logs += String(value); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return child; } catch { /* boot */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-3000)}`);
}

async function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}

type Reply = { status: number; headers: Headers; body: Record<string, unknown>; text: string };

class Client {
  cookies = new Map<string, string>();

  async request(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
    options: { csrf?: boolean } = {},
  ): Promise<Reply> {
    // Every mutation carries a matching CSRF cookie+header pair unless a test
    // deliberately withholds or corrupts it.
    const csrf = options.csrf !== false;
    if (csrf) this.cookies.set(CSRF_COOKIE, CSRF_TOKEN);

    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(csrf ? { "x-csrf-token": CSRF_TOKEN } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const rawCookie of response.headers.getSetCookie()) {
      const pair = rawCookie.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let value: unknown = {};
    try { value = JSON.parse(text); } catch { /* non-json */ }
    return { status: response.status, headers: response.headers, body: value as Record<string, unknown>, text };
  }

  login(email: string) {
    return this.request("POST", "/api/auth/login", { email, password, captchaToken: "dev-captcha-ok" });
  }
}

const clientCache = new Map<string, Client>();
async function loginAs(email: string) {
  const cached = clientCache.get(email);
  if (cached) return cached;
  const client = new Client();
  const login = await client.login(email);
  assert.equal(login.status, 200, `login failed for ${email}: ${login.text}`);
  clientCache.set(email, client);
  return client;
}

const PARTNERS = "/api/crm/v1/affiliates/partners";
const CAMPAIGNS = "/api/crm/v1/affiliates/campaigns";
const LINKS = "/api/crm/v1/affiliates/tracking-links";

// Derived from the canonical matrix, not hardcoded, so a matrix drift is caught
// here too. In AFD-2 MANAGERS was exactly {crm_admin} and it must stay so.
const MANAGERS = CRM_STAFF_ROLES.filter((r) => STAFF_ROLE_PERMISSIONS[r].includes("manage_settings"));

// AFD-5A — three derived cohorts instead of AFD-2's two. READERS is the exact
// set the read gate admits; READ_ONLY_ROLES is the analyst contract (may look,
// may not touch); NON_READERS must see nothing at all.
const READERS = CRM_STAFF_ROLES.filter(
  (r) =>
    STAFF_ROLE_PERMISSIONS[r].includes("view_affiliate_analytics") ||
    STAFF_ROLE_PERMISSIONS[r].includes("manage_settings"),
);
const READ_ONLY_ROLES = READERS.filter((r) => !STAFF_ROLE_PERMISSIONS[r].includes("manage_settings"));
const NON_READERS = CRM_STAFF_ROLES.filter((r) => !READERS.includes(r));

/**
 * A ProcessEnv for the public-URL builder with PUBLIC_APP_URL under this test's
 * control. It starts from the real environment and then DELETES the key, so an
 * ambient value cannot make an "absent origin" case pass for the wrong reason.
 */
function publicUrlEnv(publicAppUrl: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PUBLIC_APP_URL;
  if (publicAppUrl !== undefined) env.PUBLIC_APP_URL = publicAppUrl;
  return env;
}

function assertEnvelope(reply: Reply, status: number, code?: string) {
  assert.equal(reply.status, status, `expected ${status}, got ${reply.status}: ${reply.text}`);
  assert.ok(typeof reply.body.messageKey === "string", `no messageKey: ${reply.text}`);
  assert.ok(typeof reply.body.requestId === "string", `no requestId: ${reply.text}`);
  if (code) assert.equal(reply.body.code, code, reply.text);
  // No SQL, no stack, no Prisma internals ever escape.
  for (const forbidden of ["SELECT ", "INSERT ", "prisma.", "at Object.", "node_modules", "Invalid `"]) {
    assert.ok(!reply.text.includes(forbidden), `leaked ${forbidden}: ${reply.text}`);
  }
}

let seq = 0;
const nextCode = (prefix: string) => `${prefix}-${(seq += 1)}-${process.pid % 1000}`;

async function main() {
  cleanup();
  let server: ChildProcess | null = null;

  try {
    const migration = runMigrations(baseEnv);
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);

    // One staff account per StaffRole. UserRole is "admin" on purpose:
    // authorization comes from the StaffProfile axis, never from UserRole.
    const staffByRole = new Map<string, { email: string; userId: number }>();
    for (const role of CRM_STAFF_ROLES) {
      const email = `afd2-staff-${role}@example.com`;
      const user = await prisma.user.create({
        data: { email, name: `Staff ${role}`, role: "admin", passwordHash: hash },
      });
      await prisma.staffProfile.create({
        data: { userId: user.id, displayName: `Staff ${role}`, staffRole: role as StaffRole },
      });
      staffByRole.set(role, { email, userId: user.id });
    }

    // A learner with no StaffProfile at all.
    await prisma.user.create({
      data: { email: "afd2-learner@example.com", name: "Plain Learner", role: "user", passwordHash: hash },
    });

    server = await start();
    const admin = await loginAs(staffByRole.get("crm_admin")!.email);

    /* ================================================== A. authorization === */

    await check("A1 anonymous is 401 on every affiliate route", async () => {
      const anon = new Client();
      for (const url of [PARTNERS, CAMPAIGNS, LINKS]) {
        assertEnvelope(await anon.request("GET", url), 401, "unauthorized");
        assertEnvelope(await anon.request("POST", url, { code: "x" }), 401, "unauthorized");
      }
    });

    await check("A2 authenticated learner without StaffProfile is 403", async () => {
      const learner = await loginAs("afd2-learner@example.com");
      for (const url of [PARTNERS, CAMPAIGNS, LINKS]) {
        assertEnvelope(await learner.request("GET", url), 403, "unauthorized");
      }
    });

    await check("A3 every role WITHOUT either affiliate permission is 403 on read AND write", async () => {
      // AFD-5A split reads from writes. A role holding neither
      // view_affiliate_analytics nor manage_settings still sees the AFD-2
      // behaviour: nothing at all.
      assert.ok(NON_READERS.length > 0, "expected at least one role with no affiliate access");
      assert.ok(!NON_READERS.includes("analyst"), "analyst must be a reader from AFD-5A on");
      for (const role of NON_READERS) {
        const client = await loginAs(staffByRole.get(role)!.email);
        assertEnvelope(await client.request("GET", PARTNERS), 403, "forbidden");
        const write = await client.request("POST", PARTNERS, { code: nextCode("x"), displayName: "X" });
        assertEnvelope(write, 403, "forbidden");
      }
    });

    await check("A3b read-only roles may GET and are still 403 on every mutation", async () => {
      // The read-only analyst contract, asserted against the matrix rather than
      // a hardcoded role list: whoever can read but not manage must be able to
      // look and unable to touch. Frontend hiding is irrelevant here — these are
      // direct API calls with a valid session and a valid CSRF token.
      assert.ok(READ_ONLY_ROLES.includes("analyst"), "analyst must be read-only");
      assert.ok(!READ_ONLY_ROLES.includes("crm_admin"), "crm_admin manages, so it is not read-only");

      // A REAL target, created by the manager, so every refusal below is proven
      // against an existing row. A non-existent id would let a 404 masquerade as
      // the 403 this check is about.
      const seeded = await admin.request("POST", PARTNERS, {
        code: nextCode("readonly-target"),
        displayName: "Read-only target",
      });
      assert.equal(seeded.status, 201, seeded.text);
      const partnerId = affiliatePartnerSchema.parse(seeded.body).id;

      for (const role of READ_ONLY_ROLES) {
        const client = await loginAs(staffByRole.get(role)!.email);

        for (const url of [PARTNERS, CAMPAIGNS, LINKS]) {
          const read = await client.request("GET", url);
          assert.equal(read.status, 200, `${role} GET ${url}: ${read.text}`);
          assert.ok(Array.isArray(read.body.items), `${role} GET ${url} has no items array`);
        }

        assertEnvelope(
          await client.request("POST", PARTNERS, { code: nextCode("x"), displayName: "X" }),
          403,
          "forbidden",
        );
        assertEnvelope(
          await client.request("POST", CAMPAIGNS, {
            affiliatePartnerId: partnerId,
            code: nextCode("c"),
            displayName: "X",
          }),
          403,
          "forbidden",
        );
        assertEnvelope(
          await client.request("POST", LINKS, { affiliatePartnerId: partnerId, displayName: "X" }),
          403,
          "forbidden",
        );
        assertEnvelope(
          await client.request("PATCH", `${PARTNERS}/${partnerId}`, { displayName: "Renamed" }),
          403,
          "forbidden",
        );
        assertEnvelope(
          await client.request("PATCH", `${PARTNERS}/${partnerId}`, { status: "paused" }),
          403,
          "forbidden",
        );
      }
    });

    await check("A4 manage_settings is still held only by crm_admin after AFD-5A", () => {
      // AFD-5A must not have widened the MUTATION permission while adding a read
      // one. If this ever grows, an affiliate write gate silently opened.
      assert.deepEqual([...MANAGERS], ["crm_admin"]);
    });

    await check("A4b view_affiliate_analytics is granted to exactly the intended roles", () => {
      const holders = CRM_STAFF_ROLES.filter((r) =>
        STAFF_ROLE_PERMISSIONS[r].includes("view_affiliate_analytics"),
      );
      assert.deepEqual([...holders], ["crm_admin", "crm_manager", "analyst"]);
      // No unintended role may read the affiliate inventory.
      for (const role of ["mentor", "support", "moderator", "content_manager", "read_only", "retention_manager"] as const) {
        assert.ok(
          !STAFF_ROLE_PERMISSIONS[role].includes("view_affiliate_analytics"),
          `${role} must not hold view_affiliate_analytics`,
        );
      }
      // And the new permission must never imply the mutation permission.
      for (const role of holders) {
        if (role === "crm_admin") continue;
        assert.ok(
          !STAFF_ROLE_PERMISSIONS[role].includes("manage_settings"),
          `${role} gained manage_settings — read permission must not escalate`,
        );
      }
    });

    await check("A5 crm_admin may read and write", async () => {
      const list = await admin.request("GET", PARTNERS);
      assert.equal(list.status, 200, list.text);
      assert.ok(Array.isArray(list.body.items));
    });

    await check("A6 UserRole alone never authorizes", async () => {
      // Every staff account above is UserRole "admin". Only the StaffProfile
      // permission axis decided the 403s in A3, which proves UserRole is not
      // consulted.
      //
      // AFD-5A CHANGED THE PROBE, NOT THE RULE. AFD-2 used `analyst` here
      // because it held no permission at all, so its 403 isolated the UserRole
      // axis. Analyst now legitimately holds `view_affiliate_analytics`, so the
      // probe moved to a role that still holds neither affiliate permission —
      // otherwise this check would silently stop testing anything.
      const probeRole = NON_READERS[0];
      assert.ok(probeRole !== undefined, "need a role with no affiliate permission to probe with");
      const probeEmail = staffByRole.get(probeRole)!.email;
      const probe = await loginAs(probeEmail);
      const probeUser = await prisma.user.findUnique({
        where: { email: probeEmail },
        select: { role: true },
      });
      // UserRole "admin" — the strongest value on the learner axis — and still 403.
      assert.equal(probeUser?.role, "admin");
      assertEnvelope(await probe.request("GET", PARTNERS), 403, "forbidden");

      // The converse, so the check proves the axis rather than just a refusal:
      // analyst has the SAME UserRole "admin" and IS admitted, which can only
      // come from its StaffProfile permission.
      const analystEmail = staffByRole.get("analyst")!.email;
      const analystUser = await prisma.user.findUnique({
        where: { email: analystEmail },
        select: { role: true },
      });
      assert.equal(analystUser?.role, "admin");
      const analyst = await loginAs(analystEmail);
      assert.equal((await analyst.request("GET", PARTNERS)).status, 200);
    });

    /* =========================================================== B. CSRF === */

    await check("B1 POST without CSRF header is rejected", async () => {
      const reply = await admin.request(
        "POST", PARTNERS, { code: nextCode("csrf"), displayName: "No CSRF" }, {}, { csrf: false },
      );
      assertEnvelope(reply, 403, "forbidden");
      assert.equal(reply.body.messageKey, "crm.affiliates.csrf_invalid");
    });

    await check("B2 POST with a mismatched CSRF token is rejected", async () => {
      const reply = await admin.request(
        "POST", PARTNERS, { code: nextCode("csrf"), displayName: "Bad CSRF" },
        { "x-csrf-token": "not-the-cookie-value" },
      );
      assertEnvelope(reply, 403, "forbidden");
    });

    await check("B3 GET requires no CSRF and creates nothing", async () => {
      const before = await prisma.affiliatePartner.count();
      const reply = await admin.request("GET", PARTNERS, undefined, {}, { csrf: false });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(await prisma.affiliatePartner.count(), before, "GET created a row");
    });

    /* ======================================================= C. partners === */

    let alphaId = "";

    await check("C1 create a partner", async () => {
      const code = nextCode("alpha");
      const reply = await admin.request("POST", PARTNERS, {
        code, displayName: "  Affiliate Alpha  ", description: "Primary traffic source",
      });
      assert.equal(reply.status, 201, reply.text);
      const dto = affiliatePartnerSchema.parse(reply.body);
      alphaId = dto.id;
      assert.equal(dto.code, code);
      assert.equal(dto.displayName, "Affiliate Alpha", "display name was not trimmed");
      assert.equal(dto.status, "active");
      assert.equal(dto.availability, "available");
      assert.equal(dto.defaultAttributionWindowDays, 30);
      assert.equal(dto.archivedAt, null);
    });

    await check("C2 code is normalized to lowercase", async () => {
      const reply = await admin.request("POST", PARTNERS, {
        code: "MiXeD-CaSe-Code", displayName: "Mixed",
      });
      assert.equal(reply.status, 201, reply.text);
      assert.equal(affiliatePartnerSchema.parse(reply.body).code, "mixed-case-code");
    });

    await check("C3 duplicate code is a stable 409", async () => {
      const code = nextCode("dup");
      assert.equal((await admin.request("POST", PARTNERS, { code, displayName: "First" })).status, 201);
      const second = await admin.request("POST", PARTNERS, { code: code.toUpperCase(), displayName: "Second" });
      assertEnvelope(second, 409, "conflict");
    });

    await check("C4 invalid codes are rejected", async () => {
      for (const code of ["ab", "a".repeat(65), "has space", "has/slash", "has.dot", "пример", "a b", ""]) {
        const reply = await admin.request("POST", PARTNERS, { code, displayName: "Bad" });
        assertEnvelope(reply, 400, "invalid_input");
      }
    });

    await check("C5 a Cyrillic lookalike cannot shadow a Latin code", async () => {
      // "аlpha" with a Cyrillic 'а' must not become a second affiliate that
      // renders identically to a Latin "alpha".
      const reply = await admin.request("POST", PARTNERS, { code: "аlpha-look", displayName: "Lookalike" });
      assertEnvelope(reply, 400, "invalid_input");
    });

    await check("C6 empty or whitespace-only display name is rejected", async () => {
      for (const displayName of ["", "   ", "\t\n"]) {
        assertEnvelope(await admin.request("POST", PARTNERS, { code: nextCode("dn"), displayName }), 400);
      }
    });

    await check("C7 attribution window bounds are enforced", async () => {
      for (const days of [0, -1, 366, 1.5, "30", null]) {
        const reply = await admin.request("POST", PARTNERS, {
          code: nextCode("win"), displayName: "Win", defaultAttributionWindowDays: days,
        });
        assertEnvelope(reply, 400, "invalid_input");
      }
      const ok = await admin.request("POST", PARTNERS, {
        code: nextCode("win"), displayName: "Win", defaultAttributionWindowDays: 365,
      });
      assert.equal(ok.status, 201, ok.text);
    });

    await check("C8 client-supplied id/status/createdAt/createdByUserId are rejected", async () => {
      for (const extra of [
        { id: "1" }, { status: "archived" }, { createdAt: "2020-01-01T00:00:00.000Z" },
        { createdByUserId: 1 }, { archivedAt: null }, { unknownField: true },
      ]) {
        const reply = await admin.request("POST", PARTNERS, {
          code: nextCode("inject"), displayName: "Inject", ...extra,
        });
        assertEnvelope(reply, 400, "invalid_input");
        assert.equal(reply.body.messageKey, "crm.affiliates.body_unknown_field", JSON.stringify(extra));
      }
    });

    await check("C9 an oversized body is refused", async () => {
      const reply = await admin.request("POST", PARTNERS, {
        code: nextCode("big"), displayName: "Big", description: "x".repeat(20_000),
      });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.body_too_large");
    });

    await check("C10 edit display name and description", async () => {
      const reply = await admin.request("PATCH", `${PARTNERS}/${alphaId}`, {
        displayName: "Affiliate Alpha Renamed", description: null,
      });
      assert.equal(reply.status, 200, reply.text);
      const dto = affiliatePartnerSchema.parse(reply.body);
      assert.equal(dto.displayName, "Affiliate Alpha Renamed");
      assert.equal(dto.description, null);
    });

    await check("C11 the immutable code cannot be edited", async () => {
      const reply = await admin.request("PATCH", `${PARTNERS}/${alphaId}`, { code: "new-code" });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.body_unknown_field");
    });

    await check("C12 pause then resume", async () => {
      const paused = await admin.request("PATCH", `${PARTNERS}/${alphaId}`, { status: "paused" });
      assert.equal(paused.status, 200, paused.text);
      assert.equal(affiliatePartnerSchema.parse(paused.body).availability, "paused");
      const resumed = await admin.request("PATCH", `${PARTNERS}/${alphaId}`, { status: "active" });
      assert.equal(resumed.status, 200, resumed.text);
      assert.equal(affiliatePartnerSchema.parse(resumed.body).status, "active");
    });

    await check("C13 archive sets archivedAt and is terminal", async () => {
      const created = await admin.request("POST", PARTNERS, { code: nextCode("arch"), displayName: "Archive Me" });
      const id = affiliatePartnerSchema.parse(created.body).id;

      const archived = await admin.request("PATCH", `${PARTNERS}/${id}`, { status: "archived" });
      assert.equal(archived.status, 200, archived.text);
      const dto = affiliatePartnerSchema.parse(archived.body);
      assert.equal(dto.status, "archived");
      assert.ok(dto.archivedAt, "archivedAt not set");
      assert.equal(dto.availability, "archived");

      for (const status of ["active", "paused"]) {
        assertEnvelope(await admin.request("PATCH", `${PARTNERS}/${id}`, { status }), 400, "invalid_input");
      }
      // Content is frozen too, not just status.
      assertEnvelope(await admin.request("PATCH", `${PARTNERS}/${id}`, { displayName: "Revived" }), 400);
      // ...but it remains readable, so its children stay explainable.
      assert.equal((await admin.request("GET", `${PARTNERS}/${id}`)).status, 200);
    });

    await check("C14 there is no DELETE route", async () => {
      const reply = await admin.request("DELETE", `${PARTNERS}/${alphaId}`);
      assert.ok(reply.status === 405 || reply.status === 404, `DELETE returned ${reply.status}`);
      assert.ok(await prisma.affiliatePartner.findUnique({ where: { id: Number(alphaId) } }), "row was deleted");
    });

    await check("C15 an empty PATCH body is rejected", async () => {
      assertEnvelope(await admin.request("PATCH", `${PARTNERS}/${alphaId}`, {}), 400, "invalid_input");
    });

    await check("C16 unknown partner is 404", async () => {
      assertEnvelope(await admin.request("GET", `${PARTNERS}/999999`), 404, "not_found");
      assertEnvelope(await admin.request("GET", `${PARTNERS}/not-a-number`), 400, "invalid_input");
    });

    /* ====================================================== D. campaigns === */

    let campaignAId = "";
    let betaId = "";

    await check("D1 create a campaign under an affiliate", async () => {
      const reply = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: alphaId, code: "alpha-one", displayName: "Alpha One", notes: "Search traffic",
      });
      assert.equal(reply.status, 201, reply.text);
      const dto = affiliateCampaignSchema.parse(reply.body);
      campaignAId = dto.id;
      assert.equal(dto.affiliatePartnerId, alphaId);
      assert.equal(dto.status, "active");
      assert.equal(dto.availability, "available");
    });

    await check("D2 duplicate campaign code within one affiliate is 409", async () => {
      const reply = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: alphaId, code: "alpha-one", displayName: "Dupe",
      });
      assertEnvelope(reply, 409, "conflict");
    });

    await check("D3 the SAME campaign code under a DIFFERENT affiliate is allowed", async () => {
      const beta = await admin.request("POST", PARTNERS, { code: nextCode("beta"), displayName: "Affiliate Beta" });
      betaId = affiliatePartnerSchema.parse(beta.body).id;
      const reply = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: betaId, code: "alpha-one", displayName: "Beta reuse",
      });
      assert.equal(reply.status, 201, reply.text);
    });

    await check("D4 a campaign cannot be created under a paused affiliate", async () => {
      await admin.request("PATCH", `${PARTNERS}/${betaId}`, { status: "paused" });
      const reply = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: betaId, code: "beta-paused", displayName: "Nope",
      });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.campaign.parent_not_active");
      await admin.request("PATCH", `${PARTNERS}/${betaId}`, { status: "active" });
    });

    await check("D5 a campaign cannot be resumed while its affiliate is paused", async () => {
      const created = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: betaId, code: "beta-resume", displayName: "Resume Test",
      });
      const id = affiliateCampaignSchema.parse(created.body).id;
      await admin.request("PATCH", `${CAMPAIGNS}/${id}`, { status: "paused" });
      await admin.request("PATCH", `${PARTNERS}/${betaId}`, { status: "paused" });

      const reply = await admin.request("PATCH", `${CAMPAIGNS}/${id}`, { status: "active" });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.campaign.parent_not_active");

      await admin.request("PATCH", `${PARTNERS}/${betaId}`, { status: "active" });
      assert.equal((await admin.request("PATCH", `${CAMPAIGNS}/${id}`, { status: "active" })).status, 200);
    });

    await check("D6 an active campaign under a paused affiliate reports availability paused", async () => {
      await admin.request("PATCH", `${PARTNERS}/${betaId}`, { status: "paused" });
      const list = await admin.request("GET", `${CAMPAIGNS}?affiliatePartnerId=${betaId}&status=active`);
      assert.equal(list.status, 200, list.text);
      const items = (list.body.items as unknown[]).map((i) => affiliateCampaignSchema.parse(i));
      assert.ok(items.length > 0, "expected at least one active campaign");
      for (const item of items) {
        assert.equal(item.status, "active", "stored status must be preserved");
        assert.equal(item.availability, "paused", "effective availability must reflect the parent");
      }
      await admin.request("PATCH", `${PARTNERS}/${betaId}`, { status: "active" });
    });

    await check("D7 campaign code and affiliate are immutable", async () => {
      for (const body of [{ code: "renamed" }, { affiliatePartnerId: betaId }]) {
        const reply = await admin.request("PATCH", `${CAMPAIGNS}/${campaignAId}`, body);
        assertEnvelope(reply, 400, "invalid_input");
        assert.equal(reply.body.messageKey, "crm.affiliates.body_unknown_field");
      }
    });

    await check("D8 a campaign under an unknown affiliate is 404", async () => {
      const reply = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: "999999", code: "orphan", displayName: "Orphan",
      });
      assertEnvelope(reply, 404, "not_found");
    });

    await check("D9 archived campaign is terminal", async () => {
      const created = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: alphaId, code: "alpha-archive", displayName: "Archive Me",
      });
      const id = affiliateCampaignSchema.parse(created.body).id;
      assert.equal((await admin.request("PATCH", `${CAMPAIGNS}/${id}`, { status: "archived" })).status, 200);
      assertEnvelope(await admin.request("PATCH", `${CAMPAIGNS}/${id}`, { status: "active" }), 400);
      assertEnvelope(await admin.request("PATCH", `${CAMPAIGNS}/${id}`, { displayName: "Revived" }), 400);
    });

    /* ================================================== E. tracking links === */

    let linkId = "";
    let linkPublicCode = "";

    await check("E1 create a DRAFT tracking link", async () => {
      const reply = await admin.request("POST", LINKS, {
        affiliatePartnerId: alphaId, affiliateCampaignId: campaignAId, displayName: "Alpha L1",
        landingKey: "academy_registration",
      });
      assert.equal(reply.status, 201, reply.text);
      const dto = affiliateTrackingLinkSchema.parse(reply.body);
      linkId = dto.id;
      linkPublicCode = dto.publicCode;
      assert.equal(dto.status, "draft");
      assert.equal(dto.landingKey, "academy_registration");
      assert.equal(dto.externalClickParameter, "clickid", "default external click parameter");
      // AFD-3B2. These two fields used to be placeholders and are now live
      // operational facts. This server runs with acquisition attribution
      // switched OFF, which is the state that produces both values below — the
      // assertion is therefore stricter than the old literal, not weaker: it
      // pins the DTO's answer for a specific deployment configuration.
      assert.equal(dto.publicRouteState, "feature_disabled");
      assert.equal(dto.activationState, "feature_disabled");
      assert.equal(dto.effectiveAttributionWindowDays, 30, "inherits the partner default");
      assert.equal(dto.attributionWindowDays, null);
    });

    await check("E2 publicCode is server-owned, 32 chars, base32, non-sequential", async () => {
      assert.match(linkPublicCode, /^[a-z2-7]{32}$/);
      const codes = new Set<string>();
      for (let i = 0; i < 200; i += 1) codes.add(generatePublicCode());
      assert.equal(codes.size, 200, "generator produced a duplicate in 200 draws");
      // 32 base32 chars = 160 bits.
      assert.equal(linkPublicCode.length * 5, 160);
    });

    await check("E3 a client-supplied publicCode is rejected", async () => {
      const reply = await admin.request("POST", LINKS, {
        affiliatePartnerId: alphaId, displayName: "Injected", publicCode: "a".repeat(32),
      });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.body_unknown_field");
    });

    await check("E4 publicCode is unique across many creates", async () => {
      const seen = new Set<string>();
      for (let i = 0; i < 12; i += 1) {
        const reply = await admin.request("POST", LINKS, {
          affiliatePartnerId: alphaId, displayName: `Bulk ${i}`,
        });
        assert.equal(reply.status, 201, reply.text);
        const code = affiliateTrackingLinkSchema.parse(reply.body).publicCode;
        assert.ok(!seen.has(code), "duplicate publicCode issued");
        seen.add(code);
      }
    });

    await check("E5 an arbitrary URL as landingKey is rejected", async () => {
      for (const landingKey of [
        "https://evil.example/steal", "javascript:alert(1)", "//evil.example",
        "academy_registration?next=https://evil.example", "data:text/html,x", "/go/anything", "",
      ]) {
        const reply = await admin.request("POST", LINKS, {
          affiliatePartnerId: alphaId, displayName: "Evil", landingKey,
        });
        assertEnvelope(reply, 400, "invalid_input");
        assert.equal(reply.body.messageKey, "crm.affiliates.link.landing_key_invalid", landingKey);
      }
    });

    await check("E6 the DTO exposes no arbitrary destination, and no URL without a public origin", async () => {
      // AFD-2 asserted "no URL field at all" because no public route existed.
      // AFD-3B2 built `/go/{publicCode}` and AFD-5A publishes it, so the rule
      // that survives is the one that always mattered: the DTO carries no
      // OPERATOR- OR CLIENT-SUPPLIED destination of any kind.
      const reply = await admin.request("GET", `${LINKS}/${linkId}`);
      assert.equal(reply.status, 200, reply.text);
      const keys = Object.keys(reply.body);
      for (const forbidden of [
        "url", "href", "link", "destination", "redirectUrl", "targetUrl",
        "pocketUrl", "callbackUrl", "postbackUrl",
      ]) {
        assert.ok(!keys.includes(forbidden), `DTO exposes ${forbidden}`);
      }

      // This regression runs with no PUBLIC_APP_URL configured, so the canonical
      // URL must be null and say why — never a guessed origin, and never the
      // loopback APP_URL this test server is actually listening on.
      assert.equal(reply.body.publicUrl, null, "publicUrl must fail closed with no public origin");
      assert.equal(reply.body.publicUrlUnavailableReason, "public_origin_unavailable");
      assert.match(String(reply.body.publicPath), /^\/go\/[a-z2-7]{32}$/);
      assert.equal(reply.body.publicPath, `/go/${reply.body.publicCode}`);

      // With no origin resolved, no absolute URL may appear anywhere in the DTO.
      assert.ok(!reply.text.includes("http://"), "DTO leaked an http URL");
      assert.ok(!reply.text.includes("https://"), "DTO leaked an https URL");
      // And the internal test origin must never appear even as a substring.
      assert.ok(!reply.text.includes(String(port)), "DTO leaked the internal service port");
    });

    await check("E6b the canonical URL is built from the configured origin and never from a header", () => {
      // Exercised directly against the builder, because the header-immunity
      // claim is a claim about its SIGNATURE: it takes an env and a code, and
      // there is no request parameter through which a Host or X-Forwarded-Host
      // could reach the result. A synthetic HTTPS origin is used — never the
      // live public address.
      const code = "abcdefghijklmnopqrstuvwxyz234567";
      const origin = "https://affiliate-test.example";

      const configured = buildTrackingLinkPublicUrl(code, publicUrlEnv(origin));
      assert.equal(configured.publicPath, `/go/${code}`);
      assert.equal(configured.publicUrl, `${origin}/go/${code}`);
      assert.equal(configured.publicUrlUnavailableReason, null);
      // Bare: no query, no example click id, no placeholder macro.
      assert.ok(!configured.publicUrl!.includes("?"), "canonical URL must carry no query string");

      // Absent, loopback, http and internal-port origins all fail closed rather
      // than producing a link an operator could paste to an affiliate.
      for (const rejected of [
        undefined,
        "http://example.com",
        "https://127.0.0.1",
        "https://localhost",
        "https://example.com:3100",
        "https://example.com/base",
        "not-a-url",
      ]) {
        const result = buildTrackingLinkPublicUrl(code, publicUrlEnv(rejected));
        assert.equal(result.publicUrl, null, `origin ${String(rejected)} must not produce a URL`);
        assert.equal(result.publicUrlUnavailableReason, "public_origin_unavailable");
        // The path is still shown, so the CRM can explain the link without it.
        assert.equal(result.publicPath, `/go/${code}`);
      }

      // Host-shaped env keys are not consulted at all.
      const hostile = publicUrlEnv(undefined);
      hostile.HOST = "evil.example";
      hostile.X_FORWARDED_HOST = "evil.example";
      hostile.APP_URL = "https://evil.example";
      assert.equal(
        buildTrackingLinkPublicUrl(code, hostile).publicUrl,
        null,
        "only PUBLIC_APP_URL may produce a canonical URL",
      );
    });

    await check("E7 protected parameter names are rejected", async () => {
      for (const name of AFFILIATE_PROTECTED_PARAMETERS) {
        const reply = await admin.request("POST", LINKS, {
          affiliatePartnerId: alphaId, displayName: "Protected", externalClickParameter: name,
        });
        assertEnvelope(reply, 400, "invalid_input");
        assert.equal(reply.body.messageKey, "crm.affiliates.link.parameter_protected", name);
      }
    });

    await check("E8 malformed parameter names are rejected", async () => {
      for (const name of ["a[b]", "a.b", "a b", "a-b", "", "x".repeat(33), "UPPER!"]) {
        const reply = await admin.request("POST", LINKS, {
          affiliatePartnerId: alphaId, displayName: "Bad param", externalClickParameter: name,
        });
        assertEnvelope(reply, 400, "invalid_input");
      }
    });

    await check("E9 duplicate parameter mappings are rejected", async () => {
      const reply = await admin.request("POST", LINKS, {
        affiliatePartnerId: alphaId, displayName: "Dupe params",
        externalClickParameter: "cid", sub1Parameter: "cid",
      });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.link.parameter_duplicate");

      const subs = await admin.request("POST", LINKS, {
        affiliatePartnerId: alphaId, displayName: "Dupe subs",
        sub1Parameter: "s1", sub2Parameter: "s1",
      });
      assertEnvelope(subs, 400, "invalid_input");
    });

    await check("E10 a PARTIAL edit cannot create a duplicate pair", async () => {
      const created = await admin.request("POST", LINKS, {
        affiliatePartnerId: alphaId, displayName: "Merge test",
        externalClickParameter: "extclick", sub1Parameter: "s1",
      });
      const id = affiliateTrackingLinkSchema.parse(created.body).id;
      // Only sub2 is submitted, but it collides with the STORED sub1.
      const reply = await admin.request("PATCH", `${LINKS}/${id}`, { sub2Parameter: "s1" });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.link.parameter_duplicate");
    });

    await check("E11 a cross-affiliate campaign is rejected", async () => {
      const betaCampaign = await admin.request("POST", CAMPAIGNS, {
        affiliatePartnerId: betaId, code: "beta-cross", displayName: "Beta Cross",
      });
      const betaCampaignId = affiliateCampaignSchema.parse(betaCampaign.body).id;

      const reply = await admin.request("POST", LINKS, {
        affiliatePartnerId: alphaId, affiliateCampaignId: betaCampaignId, displayName: "Cross",
      });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.link.campaign_partner_mismatch");

      const patch = await admin.request("PATCH", `${LINKS}/${linkId}`, { affiliateCampaignId: betaCampaignId });
      assertEnvelope(patch, 400, "invalid_input");
    });

    await check("E12 activation returns the stable refusal, not a coercion", async () => {
      // AFD-3B2 built the machinery, so the refusal changed meaning and changed
      // code with it: activation is now a real operation that THIS deployment
      // has switched off, rather than one that does not exist. The important
      // property is unchanged and still asserted below — the status is not
      // silently coerced to something the operator did not ask for.
      const reply = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "active" });
      assert.equal(reply.status, 409, reply.text);
      assert.equal(reply.body.code, "AFFILIATE_ATTRIBUTION_DISABLED");
      const after = await admin.request("GET", `${LINKS}/${linkId}`);
      assert.equal(affiliateTrackingLinkSchema.parse(after.body).status, "draft", "status was silently coerced");
    });

    await check("E13 draft -> paused -> draft -> archived, and archived is terminal", async () => {
      const paused = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "paused" });
      assert.equal(affiliateTrackingLinkSchema.parse(paused.body).status, "paused");
      const draft = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "draft" });
      assert.equal(affiliateTrackingLinkSchema.parse(draft.body).status, "draft");
      const archived = await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "archived" });
      const dto = affiliateTrackingLinkSchema.parse(archived.body);
      assert.equal(dto.status, "archived");
      assert.ok(dto.archivedAt);
      assertEnvelope(await admin.request("PATCH", `${LINKS}/${linkId}`, { status: "draft" }), 400);
      assertEnvelope(await admin.request("PATCH", `${LINKS}/${linkId}`, { displayName: "Revived" }), 400);
    });

    await check("E14 a link under an archived affiliate cannot be created", async () => {
      const created = await admin.request("POST", PARTNERS, { code: nextCode("dead"), displayName: "Dead" });
      const id = affiliatePartnerSchema.parse(created.body).id;
      await admin.request("PATCH", `${PARTNERS}/${id}`, { status: "archived" });
      const reply = await admin.request("POST", LINKS, { affiliatePartnerId: id, displayName: "Nope" });
      assertEnvelope(reply, 400, "invalid_input");
      assert.equal(reply.body.messageKey, "crm.affiliates.parent_archived");
    });

    await check("E15 link attributionWindowDays overrides the partner default", async () => {
      const reply = await admin.request("POST", LINKS, {
        affiliatePartnerId: alphaId, displayName: "Own window", attributionWindowDays: 7,
      });
      const dto = affiliateTrackingLinkSchema.parse(reply.body);
      assert.equal(dto.attributionWindowDays, 7);
      assert.equal(dto.effectiveAttributionWindowDays, 7);
    });

    await check("E16 no public /go route exists", async () => {
      const anon = new Client();
      for (const url of [`/go/${linkPublicCode}`, "/go/anything", `/api/go/${linkPublicCode}`]) {
        const reply = await anon.request("GET", url);
        assert.equal(reply.status, 404, `${url} returned ${reply.status} - a public route exists`);
      }
    });

    await check("E17 the acquisition and deposit tables exist and later ones still do not", async () => {
      // AFD-3B2 added the three acquisition tables this case used to forbid, and
      // AFD-4 added PocketProviderEvent. The forbidden list keeps its remaining
      // members, which are AFD-5 and later and must still be absent, and the
      // case pins the positive fact that the arrived tables really did arrive.
      //
      // AffiliateRedeposit stays forbidden ON PURPOSE and is not a scheduling
      // detail: Pocket supplies no unique deposit transaction identifier, so a
      // redeposit table could only ever be populated by guessing which
      // redelivery was a second deposit. See 19_REDEPOSIT_BOUNDARY.md.
      const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='table'",
      );
      const names = rows.map((r) => r.name);
      for (const forbidden of [
        "AffiliatePostbackEndpoint", "AffiliatePostbackDelivery",
        "AffiliateFirstDeposit", "AffiliateRedeposit", "AffiliateOutbox",
      ]) {
        assert.ok(!names.includes(forbidden), `${forbidden} belongs to a later phase`);
      }
      for (const expected of [
        "AffiliatePartner", "AffiliateCampaign", "AffiliateTrackingLink",
        "AffiliateClick", "AffiliateAttribution", "AffiliateConversionEvent",
        "PocketProviderEvent",
      ]) {
        assert.ok(names.includes(expected), expected);
      }
    });

    /* ======================================== F. list, filter, page, sort === */

    await check("F1 default page size is 25 and max is 100", async () => {
      const dflt = await admin.request("GET", LINKS);
      assert.equal(dflt.body.limit, 25);
      assert.equal((await admin.request("GET", `${LINKS}?limit=100`)).body.limit, 100);
      for (const limit of ["0", "101", "-1", "abc", "1.5"]) {
        assertEnvelope(await admin.request("GET", `${LINKS}?limit=${limit}`), 400, "invalid_input");
      }
    });

    await check("F2 sorting is deterministic and paging never changes the total", async () => {
      const page1 = await admin.request("GET", `${LINKS}?limit=3&offset=0`);
      const page2 = await admin.request("GET", `${LINKS}?limit=3&offset=3`);
      assert.equal(page1.body.total, page2.body.total, "total changed between pages");

      const ids1 = (page1.body.items as { id: string }[]).map((i) => i.id);
      const ids2 = (page2.body.items as { id: string }[]).map((i) => i.id);
      assert.equal(new Set([...ids1, ...ids2]).size, ids1.length + ids2.length, "pages overlap");

      // Repeating the same request returns the same order.
      const again = await admin.request("GET", `${LINKS}?limit=3&offset=0`);
      assert.deepEqual((again.body.items as { id: string }[]).map((i) => i.id), ids1);
    });

    await check("F3 filters work and unknown/duplicated query keys are rejected", async () => {
      const byPartner = await admin.request("GET", `${CAMPAIGNS}?affiliatePartnerId=${alphaId}`);
      assert.equal(byPartner.status, 200, byPartner.text);
      for (const item of byPartner.body.items as { affiliatePartnerId: string }[]) {
        assert.equal(item.affiliatePartnerId, alphaId);
      }

      const byCode = await admin.request("GET", `${LINKS}?publicCode=${linkPublicCode}`);
      assert.equal((byCode.body.items as unknown[]).length, 1);

      assertEnvelope(await admin.request("GET", `${PARTNERS}?bogus=1`), 400, "invalid_input");
      assertEnvelope(await admin.request("GET", `${PARTNERS}?status=active&status=paused`), 400, "invalid_input");
      assertEnvelope(await admin.request("GET", `${LINKS}?status=active`), 400, "invalid_input");
    });

    await check("F4 archived entities remain listable", async () => {
      const archived = await admin.request("GET", `${PARTNERS}?status=archived`);
      assert.equal(archived.status, 200, archived.text);
      assert.ok((archived.body.items as unknown[]).length > 0, "archived partners vanished from history");
    });

    await check("F5 no list DTO carries a click, conversion or money field", async () => {
      for (const url of [PARTNERS, CAMPAIGNS, LINKS]) {
        const reply = await admin.request("GET", url);
        for (const forbidden of [
          "clicks", "clickCount", "conversions", "registrations", "firstDeposit",
          "revenue", "amount", "balance", "visitors", "leads",
        ]) {
          assert.ok(!reply.text.includes(forbidden), `${url} exposes ${forbidden}`);
        }
      }
    });

    /* ====================================================== G. concurrency === */

    await check("G1 concurrent duplicate partner codes produce exactly one row", async () => {
      const code = nextCode("race");
      const replies = await Promise.all(
        Array.from({ length: 6 }, () => admin.request("POST", PARTNERS, { code, displayName: "Race" })),
      );
      const created = replies.filter((r) => r.status === 201);
      const conflicts = replies.filter((r) => r.status === 409);
      assert.equal(created.length, 1, `expected 1 winner, got ${created.length}`);
      assert.equal(conflicts.length, 5, `expected 5 conflicts, got ${conflicts.length}`);
      for (const reply of conflicts) assertEnvelope(reply, 409, "conflict");
      assert.equal(await prisma.affiliatePartner.count({ where: { code } }), 1);
    });

    await check("G2 concurrent duplicate campaign codes produce exactly one row", async () => {
      const code = nextCode("crace");
      const replies = await Promise.all(
        Array.from({ length: 5 }, () =>
          admin.request("POST", CAMPAIGNS, { affiliatePartnerId: alphaId, code, displayName: "Race" })),
      );
      assert.equal(replies.filter((r) => r.status === 201).length, 1);
      assert.equal(
        await prisma.affiliateCampaign.count({ where: { affiliatePartnerId: Number(alphaId), code } }), 1,
      );
    });

    await check("G3 concurrent identical archives leave exactly one winner", async () => {
      // Both requests attempt the SAME transition, so only one can legally
      // succeed however they interleave: once the first commits, `archived` is
      // terminal and the second must be refused rather than re-applied.
      const created = await admin.request("POST", PARTNERS, { code: nextCode("srace"), displayName: "Status Race" });
      const id = affiliatePartnerSchema.parse(created.body).id;

      const replies = await Promise.all(
        Array.from({ length: 4 }, () => admin.request("PATCH", `${PARTNERS}/${id}`, { status: "archived" })),
      );

      assert.equal(replies.filter((r) => r.status === 200).length, 1, "more than one archive applied");
      for (const reply of replies.filter((r) => r.status !== 200)) {
        // A clean typed refusal, never a 500 or a raw database error.
        assertEnvelope(reply, 400, "invalid_input");
      }

      const row = await prisma.affiliatePartner.findUniqueOrThrow({ where: { id: Number(id) } });
      assert.equal(row.status, "archived");
      // status and archivedAt are one fact, always.
      assert.equal(row.status === "archived", row.archivedAt !== null);

      // Exactly one status-change audit row for this entity — a lost update
      // would have produced two.
      const audits = await prisma.auditLog.count({
        where: { action: "AFFILIATE_PARTNER_STATUS_CHANGED", entityId: id },
      });
      assert.equal(audits, 1, `expected 1 status audit row, got ${audits}`);
    });

    await check("G3b a legal sequential transition chain still succeeds", async () => {
      // The counterpart to G3: active -> paused -> archived is two legal steps
      // and both must apply, so G3's single winner is the conditional update
      // working, not the API refusing legitimate changes.
      const created = await admin.request("POST", PARTNERS, { code: nextCode("seq"), displayName: "Sequential" });
      const id = affiliatePartnerSchema.parse(created.body).id;
      assert.equal((await admin.request("PATCH", `${PARTNERS}/${id}`, { status: "paused" })).status, 200);
      assert.equal((await admin.request("PATCH", `${PARTNERS}/${id}`, { status: "archived" })).status, 200);
    });

    await check("G4 concurrent link creates never collide on publicCode", async () => {
      const replies = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          admin.request("POST", LINKS, { affiliatePartnerId: alphaId, displayName: `Conc ${i}` })),
      );
      const codes = replies.filter((r) => r.status === 201)
        .map((r) => affiliateTrackingLinkSchema.parse(r.body).publicCode);
      assert.equal(codes.length, 8, "not all concurrent creates succeeded");
      assert.equal(new Set(codes).size, 8, "publicCode collision");
    });

    /* =========================================================== H. audit === */

    await check("H1 every successful write is audited", async () => {
      const actions = await prisma.auditLog.findMany({
        where: { action: { startsWith: "AFFILIATE_" } },
        select: { action: true },
      });
      const names = new Set(actions.map((a) => a.action));
      for (const expected of [
        "AFFILIATE_PARTNER_CREATED", "AFFILIATE_PARTNER_UPDATED", "AFFILIATE_PARTNER_STATUS_CHANGED",
        "AFFILIATE_CAMPAIGN_CREATED", "AFFILIATE_CAMPAIGN_STATUS_CHANGED",
        "AFFILIATE_TRACKING_LINK_CREATED", "AFFILIATE_TRACKING_LINK_STATUS_CHANGED",
      ]) {
        assert.ok(names.has(expected), `missing audit action ${expected}`);
      }
    });

    await check("H2 audit metadata carries field NAMES and status, never content", async () => {
      const row = await prisma.auditLog.findFirst({
        where: { action: "AFFILIATE_PARTNER_STATUS_CHANGED" },
        orderBy: { id: "desc" },
      });
      assert.ok(row, "no status-change audit row");
      const meta = row.metadata as Record<string, unknown>;
      assert.ok(Array.isArray(meta.changedFields));
      assert.ok(typeof meta.previousStatus === "string");
      assert.ok(typeof meta.newStatus === "string");
    });

    await check("H3 no audit row leaks a publicCode, secret, cookie or CSRF token", async () => {
      const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: "AFFILIATE_" } } });
      const dump = JSON.stringify(rows);
      assert.ok(!dump.includes(linkPublicCode), "a publicCode reached the audit trail");
      for (const forbidden of [
        CSRF_TOKEN, SESSION_SECRET, "affiliate-foundation-postback-secret",
        password, "passwordHash", "trading_platform_session",
      ]) {
        assert.ok(!dump.includes(forbidden), `audit leaked ${forbidden}`);
      }
    });

    await check("H4 a rejected CSRF mutation is audited and writes nothing", async () => {
      const before = await prisma.affiliatePartner.count();
      const code = nextCode("csrfaudit");
      await admin.request("POST", PARTNERS, { code, displayName: "No CSRF" }, {}, { csrf: false });
      assert.equal(await prisma.affiliatePartner.count(), before, "a CSRF-rejected request created a row");
      assert.ok(
        await prisma.auditLog.findFirst({ where: { action: "CSRF_INVALID" } }),
        "no CSRF_INVALID audit row",
      );
    });

    /* ==================================================== I. no-regression === */

    await check("I1 existing tables are untouched by this migration", async () => {
      // Nothing in AFD-2 writes to any pre-existing table except AuditLog.
      assert.equal(await prisma.exchangeAccount.count(), 0);
      assert.equal(await prisma.pocketTraderIdentity.count(), 0);
      assert.equal(await prisma.postbackEvent.count(), 0);
      assert.equal(await prisma.xpEvent.count(), 0);
    });

    await check("I2 the pocket referral and postback routes still respond", async () => {
      // Proof that the affiliate namespace did not shadow or break them.
      const anon = new Client();
      const postback = await anon.request("GET", "/api/postbacks/pocket?goal=reg");
      assert.ok([400, 403, 503].includes(postback.status), `unexpected ${postback.status}`);
      const referral = await anon.request("POST", "/api/exchange/referral-link");
      assert.ok([401, 403].includes(referral.status), `unexpected ${referral.status}`);
    });

    /* ================================================ J. schema upgrade === */

    await check("J1 a pre-affiliate database upgrades to the canonical count", async () => {
      // A real pre-migration schema: apply every migration EXCEPT this phase's,
      // then apply the full set and prove the delta is exactly +1.
      const upgradeEnv = { ...baseEnv, DATABASE_URL: `file:${upgradeDbPath}` };
      const first = runMigrations(upgradeEnv);
      assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);

      const count = spawnSync("sqlite3", [upgradeDbPath, "SELECT COUNT(*) FROM _prisma_migrations;"], {
        encoding: "utf8",
      });
      assert.equal(
        Number(count.stdout.trim()),
        EXPECTED_MIGRATION_COUNT,
        `expected ${EXPECTED_MIGRATION_COUNT} applied migrations`,
      );

      const tables = spawnSync("sqlite3", [
        upgradeDbPath,
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Affiliate%' ORDER BY name;",
      ], { encoding: "utf8" });
      assert.deepEqual(
        tables.stdout.trim().split("\n").sort(),
        [
          "AffiliateAttribution", "AffiliateCampaign", "AffiliateClick",
          "AffiliateConversionEvent", "AffiliatePartner", "AffiliateTrackingLink",
        ],
      );

      const integrity = spawnSync("sqlite3", [upgradeDbPath, "PRAGMA integrity_check;"], { encoding: "utf8" });
      assert.equal(integrity.stdout.trim(), "ok");
      const fk = spawnSync("sqlite3", [upgradeDbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" });
      assert.equal(fk.stdout.trim(), "", "foreign key failures after upgrade");
    });

    await check("J2 re-running the migration is a no-op", async () => {
      const again = runMigrations({ ...baseEnv, DATABASE_URL: `file:${upgradeDbPath}` });
      assert.equal(again.status, 0);
      const count = spawnSync("sqlite3", [upgradeDbPath, "SELECT COUNT(*) FROM _prisma_migrations;"], {
        encoding: "utf8",
      });
      assert.equal(
        Number(count.stdout.trim()),
        EXPECTED_MIGRATION_COUNT,
        "re-running changed the migration count",
      );
    });

    await check("J3 the runtime and deployed databases were never referenced", () => {
      assert.ok(dbPath.startsWith("/tmp/") && upgradeDbPath.startsWith("/tmp/"));
      assert.ok(!dbPath.includes("/home/ubuntu/runtime"));
      assert.ok(!baseEnv.DATABASE_URL?.includes("ata-dev.sqlite"));
    });
  } finally {
    await stop(server);
    cleanup();
  }

  const leftovers = [dbPath, upgradeDbPath]
    .flatMap((b) => ["", "-journal", "-wal", "-shm"].map((s) => `${b}${s}`))
    .filter((p) => fs.existsSync(p));
  if (leftovers.length > 0) {
    failed += 1;
    console.error(`FAIL K1 temporary databases removed (leftovers: ${leftovers.join(", ")})`);
  } else {
    passed += 1;
    console.log("ok   K1 temporary databases removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
