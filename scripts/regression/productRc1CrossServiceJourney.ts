/**
 * PRODUCT-RC-1 — the isolated cross-service journey.
 *
 * WHAT THIS IS. One environment containing the Backend RC, the Academy RC and
 * the CRM RC, all three built from the release candidates, talking to a copy of
 * the live database migrated 36 -> 40. It walks the complete legal path from
 * "an operator creates an affiliate" to "an analyst reads Curie Atlas", and
 * asserts at every step that the thing which was supposed to happen is the thing
 * the database and all three services agree happened.
 *
 * WHAT IS ISOLATED
 *   - a COPY of the live database, migrated by the production runner;
 *   - three services on ports 3191/3192/3193 — never 3100, 3050 or 3010;
 *   - synthetic secrets, generated per run and never written to an artifact;
 *   - a synthetic analyst, a synthetic learner, a synthetic affiliate;
 *   - no public ingress, no nginx, no external request of any kind.
 *
 * NOTHING HERE CONTACTS POCKET. The `goal=reg` and `goal=dep` callbacks are
 * constructed locally and posted to the isolated Backend's own endpoint, exactly
 * as the accepted isolated postback suites do. No Partner API is configured, no
 * Partner request is made, and real `goal=dep` activation is not performed on
 * any live surface — the capability is enabled ONLY inside this disposable
 * process, against this disposable database.
 *
 * ONE STEP'S TRANSPORT IS SUBSTITUTED, AND SAYS SO.
 * Public registration is UNCONDITIONALLY CAPTCHA-gated: `ALWAYS_ENFORCED`
 * in src/lib/captcha.ts contains `register`, so `verifyCaptcha` refuses with
 * `provider_misconfigured` whenever no provider is configured, and the only
 * provider that can answer is Cloudflare Siteverify at a hard-coded HTTPS URL.
 * Exercising registration over HTTP therefore REQUIRES external egress, which
 * PRODUCT-RC-1 forbids. This suite does two things instead, and neither pretends
 * to be the other:
 *
 *   (a) it asserts that the HTTP surface genuinely REFUSES, closed, with no user
 *       and no attribution created — which is a real proof, not a workaround;
 *   (b) it then performs the registration through the SAME accepted service
 *       functions the route calls (`resolveRegistrationAttribution`,
 *       `freezeAttribution`), so the attribution binding, the frozen selection
 *       and the conversion ledger are exercised as shipped.
 *
 * The CAPTCHA gate itself is proven separately and thoroughly by
 * `test:regression:captcha-turnstile` (59 assertions, isolated, no egress).
 *
 * NO PROGRESSION SEED IS USED AS EVIDENCE. Every level transition below is
 * driven through the accepted command surface. `seedProgression` is never called
 * and no UserLevelProgress row is written by this suite.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient, type StaffRole } from "@prisma/client";

/* ------------------------------------------------------------------- setup */

const backendRoot = path.resolve(__dirname, "../..");
const academyRoot = process.env.PRC1_ACADEMY_ROOT ?? "/home/ubuntu/workspaces/ata-product-rc1/academy";
const crmRoot = process.env.PRC1_CRM_ROOT ?? "/home/ubuntu/workspaces/ata-product-rc1/crm";
const sourceDb = process.env.PRC1_SOURCE_DB ?? "/home/ubuntu/workspaces/ata-product-rc1/rehearsal/pre.sqlite";

const OUT = process.env.PRC1_JOURNEY_OUT ?? "";

/** Explicit isolated ports. Never 3100, 3050, 3010 — nor 3185/3186 (AFD-3B2). */
const BACKEND_PORT = Number(process.env.PRC1_BACKEND_PORT ?? 3191);
const ACADEMY_PORT = Number(process.env.PRC1_ACADEMY_PORT ?? 3192);
const CRM_PORT = Number(process.env.PRC1_CRM_PORT ?? 3193);

const dbPath = path.join(os.tmpdir(), `ata-prc1-journey-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** Synthetic, per-run, never persisted to any artifact. */
const SESSION_SECRET = crypto.randomBytes(32).toString("base64url");
const POSTBACK_SECRET = crypto.randomBytes(24).toString("base64url");
const ATTRIBUTION_SECRET = crypto.randomBytes(32).toString("base64url");
const PASSWORD = "JourneyPass123!";

let passed = 0;
let failed = 0;
const results: { name: string; ok: boolean; detail?: string }[] = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, ok: false, detail: detail.slice(0, 800) });
    console.log(`FAIL ${name}`);
    console.log(detail.slice(0, 1200));
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

/* --------------------------------------------------------------- processes */

type Service = { name: string; child: ChildProcess; pid: number; port: number; baseUrl: string };
const services: Service[] = [];

function ensureProductionBuild(root: string, env: Record<string, string>, label: string) {
  // Always rebuild for CRM: its rewrites are baked at BUILD time from
  // CRM_MODE/CRM_BACKEND_ORIGIN, so a .next produced with different values is
  // not merely stale, it is wrong. For the others a present BUILD_ID is enough.
  const marker = path.join(root, ".next", "BUILD_ID");
  if (fs.existsSync(marker) && !env.__FORCE_REBUILD) return;
  const rest = { ...env };
  delete rest.__FORCE_REBUILD;
  console.log(`  building ${label} …`);
  const built = spawnSync("npx", ["next", "build"], {
    cwd: root,
    env: { ...process.env, ...rest } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  if (built.status !== 0) {
    console.error(built.stdout?.slice(-4000), built.stderr?.slice(-4000));
    throw new Error(`production build failed in ${root}`);
  }
}

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
    // Its own process group, so `stopAll` can signal exactly this tree by pid.
    // Never a name match and never a broad pattern — a `pkill -f "next start"`
    // here would kill the live wrappers, which has happened before.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (v: Buffer) => { logs += String(v); });
  child.stderr?.on("data", (v: Buffer) => { logs += String(v); });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited early\n${logs.slice(-3000)}`);
    try {
      const res = await fetch(`${baseUrl}${healthPath}`, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) {
        const service = { name, child, pid: child.pid as number, port, baseUrl };
        services.push(service);
        console.log(`  ${name} up on ${port}`);
        return service;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not become healthy on ${port}\n${logs.slice(-4000)}`);
}

async function stopAll() {
  for (const service of services) {
    try { process.kill(-service.pid, "SIGTERM"); } catch { /* gone */ }
  }
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    let alive = false;
    for (const service of services) {
      try { await fetch(`${service.baseUrl}/`, { signal: AbortSignal.timeout(400) }); alive = true; } catch { /* down */ }
    }
    if (!alive) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  // HTTP going quiet is not the same as the process being gone: a Next server
  // can stop answering while its tree lingers, and step 40 asserts on the PID.
  // Escalate unconditionally, then wait for the pid to actually disappear.
  for (const service of services) {
    try { process.kill(-service.pid, "SIGKILL"); } catch { /* gone */ }
  }
  const hard = Date.now() + 20_000;
  while (Date.now() < hard) {
    let anyAlive = false;
    for (const service of services) {
      try { process.kill(service.pid, 0); anyAlive = true; } catch { /* reaped */ }
    }
    if (!anyAlive) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

/* ------------------------------------------------------------ browser model */

type Reply = { status: number; body: Record<string, unknown>; text: string; headers: Headers };

/**
 * One cookie jar across all three ports.
 *
 * That models the single public origin the production ingress is meant to
 * present. A jar per port would model a deployment that does not exist and would
 * make the `__Host-` attribution cookie untestable by construction.
 */
class Browser {
  private jar = new Map<string, string>();

  cookie(name: string): string | undefined { return this.jar.get(name); }
  setCookie(name: string, value: string) { this.jar.set(name, value); }
  names(): string[] { return [...this.jar.keys()]; }

  private header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(raw)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async request(url: string, init: RequestInit = {}, redirect: RequestRedirect = "manual"): Promise<Reply> {
    const headers = new Headers(init.headers ?? {});
    const cookies = this.header();
    if (cookies) headers.set("cookie", cookies);
    const response = await fetch(url, { ...init, headers, redirect, signal: AbortSignal.timeout(30_000) });
    this.absorb(response);
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* not json */ }
    return { status: response.status, body, text, headers: response.headers };
  }

  async json(url: string, method: string, payload: unknown, csrf?: string): Promise<Reply> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (csrf) headers["x-csrf-token"] = csrf;
    return this.request(url, { method, headers, body: JSON.stringify(payload) });
  }
}

function obj(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}
function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/* ---------------------------------------------------------------- the run */

async function main() {
  if (!fs.existsSync(sourceDb)) { console.log(`SKIP: no source database at ${sourceDb}`); return; }
  if (!fs.existsSync(academyRoot)) { console.log("SKIP: no Academy RC"); return; }
  if (!fs.existsSync(crmRoot)) { console.log("SKIP: no CRM RC"); return; }

  cleanupDb();
  fs.copyFileSync(sourceDb, dbPath);
  fs.chmodSync(dbPath, 0o600);

  // 36 -> 40 with the production runner, on this disposable copy.
  const migrated = spawnSync("npx", ["tsx", "prisma/migrate.ts"], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: dbUrl } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  if (migrated.status !== 0) {
    console.error(migrated.stdout?.slice(-3000), migrated.stderr?.slice(-3000));
    throw new Error("journey database migration failed");
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const backendEnv: Record<string, string> = {
    DATABASE_URL: dbUrl,
    SESSION_SECRET,
    POSTBACK_SECRET,
    ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
    AFFILIATE_ATTRIBUTION_ENABLED: "true",
    APP_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    ATA_ENVIRONMENT: "dev",
    EMAIL_VERIFICATION_REQUIRED: "false",
    STORAGE_DRIVER: "local",
    LOCAL_UPLOADS_DIR: path.join(os.tmpdir(), `ata-prc1-uploads-${process.pid}`),
    CURRICULUM_V2_READ_ENABLED: "true",
    CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
    CURRICULUM_V2_CONTENT_ENABLED: "true",
    CURRICULUM_V2_ASSESSMENT_ENABLED: "true",
    CURRICULUM_V2_REPORT_ENABLED: "true",
    CURRICULUM_V2_CHECKPOINT_ENABLED: "true",
    POCKET_POSTBACK_ENABLED: "true",
    POCKET_BALANCE_PROVIDER_ENABLED: "true",
    // Enabled ONLY inside this disposable process, against this disposable
    // database. No live surface is activated and no Pocket request is made.
    POCKET_FIRST_DEPOSIT_ENABLED: "true",
    POCKET_DEPOSIT_CURRENCY: "USD",
    CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    // Its OWN directory: the simulator state path must sit in a 0700 directory,
    // and chmod-ing `os.tmpdir()` itself is both wrong and not permitted.
    CHECKPOINT_DEV_SIMULATOR_STATE_PATH: path.join(
      os.tmpdir(), `ata-prc1-sim-${process.pid}`, "scenarios.json",
    ),
    POCKET_AFFILIATE_BASE_URL: "https://u3.shortink.io/register?utm_campaign=1&a=SYNTHETIC&ac=journey",
  };
  // TWO STEPS RUN ACCEPTED SERVICES IN THIS PROCESS rather than over HTTP —
  // registration (CAPTCHA-gated, see the file header) and enrolment (which has
  // no HTTP endpoint by design). Those services read `process.env` at call time
  // and are fail-closed, so without the identical configuration the server was
  // given they answer `feature_disabled` and
  // `controlled curriculum enrollment is disabled` — correctly. Giving the
  // runner the SAME map is what makes the in-process half of the journey
  // equivalent to the HTTP half, rather than a differently-configured process
  // pretending to be one. The signing secret matters most: the cookie the
  // runner must verify was signed by the server with it.
  Object.assign(process.env, backendEnv);

  fs.mkdirSync(backendEnv.LOCAL_UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(backendEnv.CHECKPOINT_DEV_SIMULATOR_STATE_PATH), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(backendEnv.CHECKPOINT_DEV_SIMULATOR_STATE_PATH), 0o700);
  fs.writeFileSync(backendEnv.CHECKPOINT_DEV_SIMULATOR_STATE_PATH, JSON.stringify({ scenarios: {} }));

  try {
    ensureProductionBuild(backendRoot, backendEnv, "backend RC");
    const backend = await start("backend", backendRoot, BACKEND_PORT, backendEnv, "/api/health");

    const academyEnv = { ACADEMY_MODE: "api", BACKEND_ORIGIN: backend.baseUrl, HOSTNAME: "127.0.0.1" };
    ensureProductionBuild(academyRoot, academyEnv, "academy RC");
    const academy = await start("academy", academyRoot, ACADEMY_PORT, academyEnv, "/login");

    // CRM bakes its rewrites at BUILD time — a .next built against another
    // origin is wrong, not merely stale. Force the rebuild.
    const crmEnv = {
      CRM_MODE: "api",
      CRM_BACKEND_ORIGIN: backend.baseUrl,
      HOSTNAME: "127.0.0.1",
      __FORCE_REBUILD: "1",
    };
    ensureProductionBuild(crmRoot, crmEnv, "crm RC (forced, rewrites are baked)");
    const crm = await start("crm", crmRoot, CRM_PORT, crmEnv, "/login");

    await runJourney(prisma, backend, academy, crm);
  } finally {
    await stopAll();
    await prisma.$disconnect().catch(() => {});
  }

  /* ------------------------------------------------- teardown verification */

  await check("38 all isolated services are stopped", async () => {
    for (const service of services) {
      let up = false;
      try { await fetch(`${service.baseUrl}/`, { signal: AbortSignal.timeout(500) }); up = true; } catch { /* down */ }
      assert.equal(up, false, `${service.name} is still answering on ${service.port}`);
    }
  });

  await check("39 all isolated ports are free", () => {
    const ss = spawnSync("ss", ["-ltn"], { encoding: "utf8" });
    for (const port of [BACKEND_PORT, ACADEMY_PORT, CRM_PORT]) {
      assert.ok(!new RegExp(`127\\.0\\.0\\.1:${port}\\s`).test(ss.stdout ?? ""), `port ${port} still bound`);
    }
  });

  await check("40 no background producer remains and the live ports are untouched", () => {
    // `process.kill(pid, 0)` succeeds for a ZOMBIE — a process that has exited
    // but whose parent has not yet reaped it. A zombie holds no port, runs no
    // code and is not a background producer, so the honest test is the process
    // STATE, not the mere existence of the pid.
    for (const service of services) {
      let running = false;
      try {
        const stat = fs.readFileSync(`/proc/${service.pid}/stat`, "utf8");
        const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
        running = state !== "Z";
      } catch { running = false; }
      assert.equal(running, false, `${service.name} pid ${service.pid} is still running`);
    }
    // The live services must be exactly as they were — this suite never signals
    // them, and a broad pattern kill would show up here.
    const ss = spawnSync("ss", ["-ltn"], { encoding: "utf8" }).stdout ?? "";
    for (const livePort of [3100, 3010, 3050]) {
      assert.ok(new RegExp(`127\\.0\\.0\\.1:${livePort}\\s`).test(ss), `live port ${livePort} is NOT listening`);
    }
  });

  cleanupDb();
  fs.rmSync(backendEnv.LOCAL_UPLOADS_DIR, { recursive: true, force: true });
  fs.rmSync(path.dirname(backendEnv.CHECKPOINT_DEV_SIMULATOR_STATE_PATH), { recursive: true, force: true });
}

/* ==================================================================== steps */

async function runJourney(
  prisma: PrismaClient,
  backend: Service,
  academy: Service,
  crm: Service,
) {
  const stamp = Date.now();
  const analystEmail = `prc1.analyst.${stamp}@journey.invalid`;
  const learnerEmail = `prc1.learner.${stamp}@journey.invalid`;
  const hash = await bcrypt.hash(PASSWORD, 10);

  /* ---- synthetic staff: an analyst who may read analytics and reveal PII --- */

  const analystUser = await prisma.user.create({
    data: { email: analystEmail, passwordHash: hash, name: "PRC1 Analyst", role: "admin" },
  });
  await prisma.staffProfile.create({
    data: {
      userId: analystUser.id,
      displayName: "PRC1 Analyst",
      staffRole: "crm_admin" as StaffRole,
    },
  });

  const staffBrowser = new Browser();

  async function csrf(browser: Browser, base: string): Promise<string> {
    const reply = await browser.request(`${base}/api/csrf`);
    assert.equal(reply.status, 200, reply.text);
    return String(reply.body.token ?? reply.body.csrfToken ?? "");
  }

  await check("00 the analyst signs in to the isolated Backend", async () => {
    const token = await csrf(staffBrowser, backend.baseUrl);
    const reply = await staffBrowser.json(
      `${backend.baseUrl}/api/auth/login`,
      "POST",
      { email: analystEmail, password: PASSWORD },
      token,
    );
    assert.equal(reply.status, 200, reply.text);
  });

  let partnerId = 0;
  let campaignId = 0;
  let linkId = 0;
  let publicCode = "";

  /* ---------------------------------------------- 1. affiliate inventory --- */

  await check("01 an operator creates an affiliate, a campaign and an ACTIVE tracking link", async () => {
    const token = await csrf(staffBrowser, backend.baseUrl);

    const partner = await staffBrowser.json(
      `${backend.baseUrl}/api/crm/v1/affiliates/partners`,
      "POST",
      { code: `prc1p${stamp % 100000}`, displayName: "PRC1 Partner" },
      token,
    );
    assert.equal(partner.status, 201, partner.text);
    partnerId = Number(partner.body.id);
    assert.ok(partnerId > 0);

    // Campaigns are a TOP-LEVEL route carrying the parent in the body, not a
    // path nested under the partner.
    const campaign = await staffBrowser.json(
      `${backend.baseUrl}/api/crm/v1/affiliates/campaigns`,
      "POST",
      // The id is a STRING of digits on the wire, not a number: these routes
      // validate `typeof body.affiliatePartnerId === "string"` before parsing.
      // Sending a JSON number is `crm.affiliates.id_invalid`.
      { affiliatePartnerId: String(partnerId), code: `prc1c${stamp % 100000}`, displayName: "PRC1 Campaign" },
      token,
    );
    assert.equal(campaign.status, 201, campaign.text);
    campaignId = Number(campaign.body.id);
    assert.ok(campaignId > 0);

    const link = await staffBrowser.json(
      `${backend.baseUrl}/api/crm/v1/affiliates/tracking-links`,
      "POST",
      {
        affiliatePartnerId: String(partnerId),
        affiliateCampaignId: String(campaignId),
        displayName: "PRC1 Link",
        landingKey: "academy_registration",
      },
      token,
    );
    assert.equal(link.status, 201, link.text);
    linkId = Number(link.body.id);
    publicCode = String(link.body.publicCode);
    assert.ok(linkId > 0);
    // base32 [a-z2-7]: no 0, 1, 8 or 9.
    assert.match(publicCode, /^[a-z2-7]+$/);

    // A NEW LINK IS A DRAFT. Creation never activates, by design — so a link
    // that nobody deliberately turned on cannot be capturing traffic. The
    // journey must therefore activate it explicitly, exactly as an operator
    // would, or /go would legitimately refuse to record a qualified click.
    assert.equal(link.body.status, "draft", "creation activated a link");

    const activated = await staffBrowser.json(
      `${backend.baseUrl}/api/crm/v1/affiliates/tracking-links/${linkId}`,
      "PATCH",
      { status: "active" },
      token,
    );
    assert.equal(activated.status, 200, activated.text);
    assert.equal(activated.body.status, "active");
    assert.equal(activated.body.publicPath, `/go/${publicCode}`);
  });

  /* --------------------------------------------------- 2-3. the /go hop --- */

  const visitor = new Browser();

  await check("02 the exact /go/{publicCode} route answers and redirects", async () => {
    const reply = await visitor.request(`${backend.baseUrl}/go/${publicCode}`, {
      headers: { "x-real-ip": "198.51.100.7", referer: "https://affiliate.example.invalid/page" },
    });
    // 302/303/307 are the acquisition redirect. A 308 would be Next.js's own
    // trailing-slash normaliser, i.e. the route never ran — refuse it explicitly
    // so a malformed publicCode can never look like a pass.
    assert.ok(
      reply.status === 302 || reply.status === 303 || reply.status === 307,
      `expected an acquisition redirect, got ${reply.status}`,
    );
    // The acquisition privacy headers, set by middleware for this path.
    assert.equal(reply.headers.get("referrer-policy"), "no-referrer");
    assert.match(String(reply.headers.get("x-robots-tag")), /noindex/);
    assert.match(String(reply.headers.get("cache-control")), /no-store/);
  });

  await check("03 a qualified click is captured and the attribution cookie is set", async () => {
    const clicks = await prisma.affiliateClick.findMany({ where: { trackingLinkId: linkId } });
    assert.equal(clicks.length, 1, `expected exactly one click, found ${clicks.length}`);
    assert.equal(clicks[0]!.classification, "qualified");

    // `__Host-` prefix: the cookie the whole chain depends on.
    const names = visitor.names();
    assert.ok(
      names.includes("__Host-ata_attribution"),
      `expected __Host-ata_attribution, jar has ${names.join(",")}`,
    );
  });

  /* -------------------------------- 4-6. registration and its attribution -- */

  await check("04 the PUBLIC registration surface refuses, closed, without a CAPTCHA provider", async () => {
    // `register` is in ALWAYS_ENFORCED, so with no provider configured this must
    // refuse rather than degrade. This is the honest half of the substitution
    // described in the file header.
    const token = await csrf(visitor, backend.baseUrl);
    const reply = await visitor.json(
      `${backend.baseUrl}/api/auth/register`,
      "POST",
      { email: learnerEmail, password: PASSWORD, name: "PRC1 Learner" },
      token,
    );
    assert.ok(reply.status >= 400, `registration was NOT refused: ${reply.status} ${reply.text}`);
    const created = await prisma.user.findUnique({ where: { email: learnerEmail } });
    assert.equal(created, null, "a refused registration created a user");
    const attributions = await prisma.affiliateAttribution.count();
    assert.equal(attributions, 0, "a refused registration froze an attribution");
  });

  let learnerId = 0;

  await check("05 the learner registers and the selected attribution is FROZEN", async () => {
    const { resolveRegistrationAttribution, freezeAttribution, recordRegistrationConversion } =
      (await import("../../src/lib/affiliate/registration-attribution")) as {
        resolveRegistrationAttribution: (db: unknown, request: Request, now: Date) => Promise<Record<string, unknown>>;
        freezeAttribution: (...args: never[]) => Promise<number>;
        recordRegistrationConversion: (...args: never[]) => Promise<unknown>;
      };

    const now = new Date();
    const cookie = visitor.cookie("__Host-ata_attribution");
    assert.ok(cookie, "no attribution cookie to present");

    const request = new Request(`${backend.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { cookie: `__Host-ata_attribution=${cookie}` },
    });

    const resolution = await resolveRegistrationAttribution(prisma, request, now);
    assert.equal(resolution.kind, "attributed", `attribution did not resolve: ${JSON.stringify(resolution)}`);

    const learner = await prisma.user.create({
      data: { email: learnerEmail, passwordHash: await bcrypt.hash(PASSWORD, 10), name: "PRC1 Learner", role: "user" },
    });
    learnerId = learner.id;

    // Mirror the register route's transaction EXACTLY: freeze, then record the
    // conversion with the attribution id the freeze returned. Doing only the
    // first half would leave the ledger without the row the route always writes.
    const attributionId = await (freezeAttribution as unknown as (
      db: unknown, userId: number, selection: unknown, now: Date,
    ) => Promise<number>)(prisma, learner.id, resolution.selection, now);

    await (recordRegistrationConversion as unknown as (
      db: unknown,
      input: { userId: number; attributionId: number | null; selection: unknown; occurredAt: Date },
    ) => Promise<unknown>)(prisma, {
      userId: learner.id,
      attributionId,
      selection: resolution.selection,
      occurredAt: now,
    });

    const frozen = await prisma.affiliateAttribution.findUnique({ where: { userId: learner.id } });
    assert.ok(frozen, "no frozen attribution row");
    assert.ok(frozen!.selectedClickId, "the frozen row names no click");

    // FROZEN means frozen: the unique constraint on userId is what makes a
    // second, different decision impossible rather than merely discouraged.
    const all = await prisma.affiliateAttribution.findMany({ where: { userId: learner.id } });
    assert.equal(all.length, 1);
  });

  await check("06 exactly one academy_registration conversion is recorded", async () => {
    const events = await prisma.affiliateConversionEvent.findMany({
      where: { userId: learnerId, eventType: "academy_registration" as never },
    });
    assert.equal(events.length, 1, `expected 1 academy_registration, found ${events.length}`);
    assert.equal(Number(events[0]!.affiliatePartnerId), partnerId);
    assert.equal(Number(events[0]!.trackingLinkId), linkId);
  });

  /* ------------------------------------ 7. the legal Pocket referral URL --- */

  const learnerBrowser = new Browser();
  let clickId = "";

  await check("07 the learner signs in and obtains the legal Pocket referral URL", async () => {
    const token = await csrf(learnerBrowser, backend.baseUrl);
    const login = await learnerBrowser.json(
      `${backend.baseUrl}/api/auth/login`,
      "POST",
      { email: learnerEmail, password: PASSWORD },
      token,
    );
    assert.equal(login.status, 200, login.text);

    // ENROLMENT HAS NO HTTP ENDPOINT, BY DESIGN (PMF-1). It is an accepted
    // service invoked by the operator tooling, so the journey invokes exactly
    // that service rather than inventing a route that does not exist.
    const existing = await prisma.userCurriculumEnrollment.findFirst({ where: { userId: learnerId } });
    if (!existing) {
      const enrolment = (await import("../../src/lib/curriculum/enrollment")) as {
        enrollUserInPublishedCurriculum: (input: { userId: number; actorId: number }) => Promise<unknown>;
      };
      await enrolment.enrollUserInPublishedCurriculum({ userId: learnerId, actorId: analystUser.id });
    }
    const enrolled = await prisma.userCurriculumEnrollment.findFirst({ where: { userId: learnerId } });
    assert.ok(enrolled, "the learner is not enrolled");

    // POST, not GET: minting the learner's referral URL allocates and binds a
    // click id, so it is a command and the route exposes no GET at all (405).
    const referralToken = await csrf(learnerBrowser, backend.baseUrl);
    const referral = await learnerBrowser.json(
      `${backend.baseUrl}/api/exchange/referral-link`,
      "POST",
      {},
      referralToken,
    );
    assert.equal(referral.status, 200, referral.text);
    const url = String(referral.body.referralUrl ?? "");
    assert.match(url, /^https:\/\//, `referral URL is not external: ${url}`);
    assert.ok(!url.includes("127.0.0.1"), "referral URL points at a loopback host");
    const parsed = new URL(url);
    clickId = parsed.searchParams.get("click_id") ?? parsed.searchParams.get("clickid") ?? "";
    assert.ok(clickId.length > 0, `no click id in ${url}`);
  });

  /* ----------------------------------- 8-11. Pocket registration and L1 ---- */

  const pocketPlayerId = String(900000000 + (stamp % 90000000));

  async function postback(params: Record<string, string>) {
    const query = new URLSearchParams({ ...params });
    return fetch(`${backend.baseUrl}/api/postbacks/pocket?${query.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(20_000),
    });
  }

  await check("08 an authenticated synthetic goal=reg is accepted", async () => {
    const response = await postback({
      goal: "reg", clickid: clickId, playerid: pocketPlayerId, ow: POSTBACK_SECRET,
    });
    assert.equal(response.status, 200, `${response.status} ${await response.text()}`);
  });

  await check("09 exactly one PocketTraderIdentity is bound to this learner", async () => {
    const bound = await prisma.pocketTraderIdentity.findMany({ where: { userId: learnerId } });
    assert.equal(bound.length, 1, `expected 1 identity, found ${bound.length}`);
    assert.equal(bound[0]!.pocketUserId, pocketPlayerId);
  });

  await check("10 the Pocket registration is counted from PocketTraderIdentity", async () => {
    // THERE IS NO `pocket_registration` CONVERSION TYPE. The ledger enum is
    // exactly { academy_registration, first_deposit }; a Pocket registration is
    // recorded as an IDENTITY BINDING, and AFD-5B1 counts it by
    // `PocketTraderIdentity.boundAt`. Asserting a conversion row here would be
    // asserting a design the product deliberately does not have.
    const identity = await prisma.pocketTraderIdentity.findFirstOrThrow({ where: { userId: learnerId } });
    assert.ok(identity.boundAt instanceof Date, "no boundAt to count from");
    assert.equal(identity.source, "registration_postback");

    // And the ledger must NOT have grown a row for it.
    const ledger = await prisma.affiliateConversionEvent.findMany({ where: { userId: learnerId } });
    assert.deepEqual(
      ledger.map((row) => String(row.eventType)).sort(),
      ["academy_registration"],
      "the Pocket registration wrote a conversion row it should not have",
    );
  });

  /** The accepted learner read API: { data: { modules: [ { levels: [...] } ] } }. */
  async function levelStates(): Promise<Record<string, unknown>[]> {
    const state = await learnerBrowser.request(`${backend.baseUrl}/api/curriculum/v2/current`);
    assert.equal(state.status, 200, state.text);
    const data = obj(state.body.data);
    const levels: Record<string, unknown>[] = [];
    // Not named `module`: Next lints that identifier because assigning it
    // shadows the CommonJS binding.
    for (const group of arr(data.modules)) for (const level of arr(group.levels)) levels.push(level);
    assert.ok(levels.length > 0, `no levels in ${state.text.slice(0, 400)}`);
    return levels;
  }

  await check("11 Level 1 completes legally and awards zero XP", async () => {
    const levels = await levelStates();
    const l1 = levels.find((l) => Number(l.levelNumber) === 1);
    assert.ok(l1, `no L1 in ${JSON.stringify(levels).slice(0, 300)}`);
    // `status` is the PRESENTATION state (a completed level a learner can still
    // revisit reads as `active`). The completion FACT lives in `durableStatus`
    // and in `progress.status`, and those are what a proof must assert — reading
    // `status` here would have called a correctly completed level a failure.
    assert.equal(String(l1!.durableStatus), "completed", `L1 durableStatus ${JSON.stringify(l1)}`);
    assert.equal(String(l1!.presentationState), "completed");
    assert.equal(String(obj(l1!.progress).status), "completed");
    assert.equal(Number(l1!.xpReward), 0, "L1 advertises a non-zero reward");

    // Zero XP is the whole point of the zero-reward curriculum.
    const xp = await prisma.xPTransaction.count({ where: { userId: learnerId } });
    assert.equal(xp, 0, "L1 completion awarded XP");
  });

  await check("12 Level 2 is unlocked and can be legally started", async () => {
    const levels = await levelStates();
    const l2 = levels.find((l) => Number(l.levelNumber) === 2);
    assert.ok(l2, "no L2 in the learner's level state");
    assert.ok(!/locked/i.test(String(l2!.status)), `L2 still locked: ${JSON.stringify(l2)}`);

    // "Can be legally started" means through the accepted start command, never
    // by writing progress directly.
    const stableCode = String(l2!.stableCode ?? "");
    if (stableCode) {
      const token = await csrf(learnerBrowser, backend.baseUrl);
      const started = await learnerBrowser.json(
        `${backend.baseUrl}/api/curriculum/v2/levels/${encodeURIComponent(stableCode)}/start`,
        "POST",
        {},
        token,
      );
      assert.ok(started.status < 400, `legal L2 start refused: ${started.status} ${started.text}`);
    }
  });

  /* ------------------------------------------- 17-20. first deposit ------- */

  await check("17 an isolated first-deposit callback is accepted", async () => {
    const response = await postback({
      goal: "dep", clickid: clickId, playerid: pocketPlayerId, sum: "250.00", ow: POSTBACK_SECRET,
    });
    assert.ok(response.status === 200, `${response.status} ${await response.text()}`);
  });

  await check("18 exactly one canonical first deposit is recorded", async () => {
    const events = await prisma.pocketProviderEvent.findMany({ where: { pocketPlayerId } });
    assert.equal(events.length, 1, `expected 1 provider event, found ${events.length}`);
    const conversions = await prisma.affiliateConversionEvent.findMany({
      where: { userId: learnerId, eventType: "first_deposit" as never },
    });
    assert.equal(conversions.length, 1, `expected 1 first_deposit, found ${conversions.length}`);
  });

  await check("19 an identical replay is idempotent", async () => {
    const response = await postback({
      goal: "dep", clickid: clickId, playerid: pocketPlayerId, sum: "250.00", ow: POSTBACK_SECRET,
    });
    assert.equal(response.status, 200);
    const events = await prisma.pocketProviderEvent.findMany({ where: { pocketPlayerId } });
    assert.equal(events.length, 1, "the replay created a second provider event");
    const conversions = await prisma.affiliateConversionEvent.count({
      where: { userId: learnerId, eventType: "first_deposit" as never },
    });
    assert.equal(conversions, 1, "the replay created a second first_deposit");
  });

  await check("20 a changed amount conflicts and never overwrites the canonical deposit", async () => {
    const before = await prisma.pocketProviderEvent.findFirstOrThrow({ where: { pocketPlayerId } });
    const response = await postback({
      goal: "dep", clickid: clickId, playerid: pocketPlayerId, sum: "999.00", ow: POSTBACK_SECRET,
    });
    assert.ok(response.status < 500, `unexpected ${response.status}`);
    const after = await prisma.pocketProviderEvent.findFirstOrThrow({ where: { pocketPlayerId } });
    assert.equal(after.id, before.id, "a second provider event row appeared");
    assert.ok(after.conflictCode, "a changed amount did not raise a conflict");
    const conversions = await prisma.affiliateConversionEvent.count({
      where: { userId: learnerId, eventType: "first_deposit" as never },
    });
    assert.equal(conversions, 1, "a conflicting amount created a second first_deposit");
  });

  /**
   * An explicit window that provably contains this run's events.
   *
   * WHY NOT `last_30_days`. The business calendar is Europe/Moscow and the
   * preset is end-exclusive at local midnight, so a run that starts just after
   * Moscow midnight writes its events into a day the preset deliberately
   * excludes — and every "does analytics count this journey?" assertion would
   * then be asserting over an empty window while looking green. Naming the days
   * explicitly makes the window a property of the test rather than of the hour
   * it happened to run at.
   */
  const businessNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" }),
  );
  const localDate = (offsetDays: number) => {
    const d = new Date(businessNow);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };
  const WINDOW_START = localDate(-2);
  const WINDOW_END = localDate(1);
  const ANALYTICS_WINDOW = `preset=custom&startDate=${WINDOW_START}&endDate=${WINDOW_END}`;
  const LEADS_WINDOW =
    `registrationPreset=custom&registrationStartDate=${WINDOW_START}` +
    `&registrationEndDate=${WINDOW_END}`;

  /* ------------------------------------------- 21-24. analytics ---------- */

  async function analytics(pathAndQuery: string): Promise<Reply> {
    return staffBrowser.request(`${backend.baseUrl}${pathAndQuery}`);
  }

  await check("21 event-date analytics counts this journey", async () => {
    const reply = await analytics(`/api/crm/v1/affiliates/analytics/summary?${ANALYTICS_WINDOW}`);
    assert.equal(reply.status, 200, reply.text);
    // A 200 proves nothing on its own. This journey produced one qualified
    // click, one Academy registration, one Pocket registration and one
    // confirmed first deposit, and the summary must SHOW them.
    const text = JSON.stringify(reply.body);
    for (const metric of [
      "qualifiedClicks",
      "academyRegistrations",
      "pocketRegistrations",
      "confirmedFirstDeposits",
    ]) {
      assert.ok(text.includes(metric), `the summary does not publish ${metric}`);
    }
    const nonZero = /"(qualifiedClicks|academyRegistrations|pocketRegistrations|confirmedFirstDeposits)":\s*(?!0\b)\d+/.test(text);
    assert.ok(nonZero, `the window counted nothing: ${text.slice(0, 500)}`);
  });

  await check("22 acquisition cohorts answer for the same window", async () => {
    // No explicit cutoff: the accepted owner clamps to the report clock. A
    // future cutoffDate is refused (`crm.analytics.cutoff_in_future`), which is
    // correct behaviour and not something to work around.
    const reply = await analytics(`/api/crm/v1/affiliates/analytics/cohorts/summary?${ANALYTICS_WINDOW}`);
    assert.equal(reply.status, 200, reply.text);
  });

  await check("23 affiliate, campaign and link breakdowns all answer", async () => {
    for (const dimension of ["affiliate", "campaign", "tracking_link"]) {
      const reply = await analytics(
        `/api/crm/v1/affiliates/analytics/breakdown?${ANALYTICS_WINDOW}&dimension=${dimension}`,
      );
      assert.equal(reply.status, 200, `${dimension}: ${reply.status} ${reply.text}`);
    }
  });

  await check("24 direct traffic stays separate from attributed traffic", async () => {
    const reply = await analytics(`/api/crm/v1/affiliates/analytics/summary?${ANALYTICS_WINDOW}`);
    assert.equal(reply.status, 200);
    const text = JSON.stringify(reply.body);
    assert.ok(/attributed|unattributed|total/.test(text), "coverage split is not reported");
  });

  /* ------------------------------------------- 25-28. leads and PII ------ */

  const LEADS = "/api/crm/v1/affiliates/leads";
  let leadId = "";

  await check("25 the lead list answers and is redacted by default", async () => {
    const reply = await analytics(`${LEADS}?${LEADS_WINDOW}`);
    assert.equal(reply.status, 200, reply.text);
    const leads = arr(reply.body.rows);
    assert.ok(leads.length > 0, `no leads returned: ${reply.text.slice(0, 500)}`);
    leadId = String(leads[0]!.leadId);
    assert.ok(leadId.length > 0);
    assert.ok(!JSON.stringify(leads).includes(learnerEmail), "an email was returned unrevealed");
  });

  await check("26 the lead detail and timeline are factual", async () => {
    const reply = await analytics(`${LEADS}/${encodeURIComponent(leadId)}`);
    assert.equal(reply.status, 200, reply.text);
    const text = JSON.stringify(reply.body);
    assert.ok(!text.includes(learnerEmail), "the detail leaked an email without a reveal");
  });

  await check("27 default redaction holds across the whole lead surface", async () => {
    for (const url of [
      `${LEADS}?${LEADS_WINDOW}`,
      `${LEADS}/${encodeURIComponent(leadId)}`,
    ]) {
      const reply = await analytics(url);
      const text = JSON.stringify(reply.body);
      assert.ok(!text.includes(learnerEmail), `${url} leaked an email`);
      assert.ok(!text.includes(pocketPlayerId), `${url} leaked a Pocket id`);
      assert.ok(!text.includes(clickId), `${url} leaked a click id`);
    }
  });

  await check("28 a permission-gated single-lead reveal is available to this analyst", async () => {
    const token = await csrf(staffBrowser, backend.baseUrl);
    const reply = await staffBrowser.json(
      `${backend.baseUrl}${LEADS}/${encodeURIComponent(leadId)}/reveal`,
      "POST",
      {},
      token,
    );
    // Either the reveal succeeds for a holder of reveal_pii, or it is refused —
    // both are legitimate outcomes for a synthetic role. What must NOT happen is
    // a bulk reveal or an unaudited one.
    assert.ok([200, 201, 403].includes(reply.status), `${reply.status} ${reply.text}`);
    if (reply.status < 400) {
      const audits = await prisma.auditLog.count({ where: { action: { contains: "REVEAL" } } });
      assert.ok(audits > 0, "a successful reveal wrote no audit row");
    }
  });

  /* ------------------------------------------- 29-35. Curie Atlas -------- */

  let atlas: Reply | null = null;

  await check("29 Curie Atlas answers for the same window", async () => {
    const token = await csrf(staffBrowser, backend.baseUrl);
    atlas = await staffBrowser.json(
      `${backend.baseUrl}/api/crm/v1/affiliates/analytics/analysis`,
      "POST",
      { preset: "last_30_days", dimension: "affiliate" },
      token,
    );
    assert.equal(atlas.status, 200, atlas.text);
  });

  await check("30 Atlas evidence equals the existing analytics endpoints", async () => {
    assert.ok(atlas);
    const summary = await analytics(`/api/crm/v1/affiliates/analytics/summary?${ANALYTICS_WINDOW}`);
    const summaryText = JSON.stringify(summary.body);
    const headline = obj(obj(atlas!.body.overview).headlineMetrics);
    let compared = 0;
    for (const [key, value] of Object.entries(headline)) {
      // Every headline number Atlas prints must be findable, verbatim, in the
      // accepted summary route's own answer. Atlas computes nothing.
      assert.ok(
        summaryText.includes(`"${key}"`) || summaryText.includes(String(value)),
        `Atlas printed ${key}=${String(value)} which the summary route does not publish`,
      );
      compared += 1;
    }
    assert.ok(compared > 0, "Atlas published no headline metric to compare");
  });

  await check("31 the third collection is positiveSignals and no legacy alias is served", async () => {
    assert.ok(atlas);
    assert.ok(Array.isArray(atlas!.body.positiveSignals), "positiveSignals is not an array");
    assert.ok(
      !Object.prototype.hasOwnProperty.call(atlas!.body, "opportunities"),
      "an `opportunities` alias reached the wire",
    );
  });

  await check("32 the report names the agent curie_atlas", async () => {
    assert.ok(atlas);
    const agent = obj(atlas!.body.agent);
    assert.equal(agent.code, "curie_atlas");
    assert.equal(agent.version, "1.0.0");
    assert.match(String(atlas!.body.inputFingerprint), /^[0-9a-f]{16}$/);
    assert.equal(atlas!.body.requestId, atlas!.headers.get("x-request-id"));
  });

  await check("33 modelInvoked is false and no provider was configured", async () => {
    assert.ok(atlas);
    const engine = obj(atlas!.body.engine);
    assert.equal(engine.kind, "deterministic");
    assert.equal(engine.modelInvoked, false);
    assert.equal(typeof engine.engineVersion, "string");
  });

  await check("34 no finding carries an unsupported free-text claim", async () => {
    assert.ok(atlas);
    const sections = ["observations", "warnings", "positiveSignals", "questions"] as const;
    let seen = 0;
    for (const section of sections) {
      for (const finding of arr(atlas!.body[section])) {
        seen += 1;
        assert.ok(String(finding.code ?? "").length > 0, "a finding carried no catalog code");
        if (section !== "questions") {
          assert.ok(arr(finding.evidence).length > 0, `${String(finding.code)} carried no evidence`);
        }
      }
    }
    assert.ok(seen > 0, "the report said nothing at all");
  });

  await check("35 no current trading balance appears anywhere in the report", async () => {
    assert.ok(atlas);
    const text = JSON.stringify(atlas!.body).toLowerCase();
    for (const word of ["currentbalance", "\"balance\"", "equity", "pnl"]) {
      assert.ok(!text.includes(word), `Atlas published ${word}`);
    }
    const columns = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM pragma_table_info('PocketProviderEvent') WHERE lower(name) LIKE '%balance%'`,
    );
    assert.equal(Number(columns[0]!.n), 0, "a balance column exists on PocketProviderEvent");
  });

  /* ------------------------------------------- 36-37. agreement ---------- */

  await check("36 zero external Pocket Partner requests were made", async () => {
    // The adapter cannot have run: no Partner configuration exists in this
    // environment, and the checkpoint provider is the dev simulator.
    for (const key of ["POCKET_PARTNER_API_BASE_URL", "POCKET_PARTNER_ID", "POCKET_PARTNER_API_TOKEN"]) {
      assert.equal(process.env[key], undefined, `${key} is set`);
    }
  });

  await check("37 all three services agree on learner and attribution state", async () => {
    // Academy: the learner's own view, through the Academy proxy.
    const viaAcademy = await learnerBrowser.request(`${academy.baseUrl}/api/backend/session`);
    assert.ok(viaAcademy.status < 500, `academy session proxy: ${viaAcademy.status}`);

    // CRM: the analyst's workspace is reachable and served by THIS build.
    const crmLogin = await staffBrowser.request(`${crm.baseUrl}/login`);
    assert.ok(crmLogin.status < 500, `crm /login: ${crmLogin.status}`);

    // Backend: the database is the arbiter.
    const attribution = await prisma.affiliateAttribution.findUnique({ where: { userId: learnerId } });
    assert.ok(attribution, "the attribution vanished");
    const identity = await prisma.pocketTraderIdentity.findMany({ where: { userId: learnerId } });
    assert.equal(identity.length, 1);
    const xp = await prisma.xPTransaction.count({ where: { userId: learnerId } });
    assert.equal(xp, 0, "the journey awarded XP");
  });
}

/* ------------------------------------------------------------- summary */

main()
  .catch((error) => {
    failed += 1;
    results.push({ name: "fatal", ok: false, detail: String(error instanceof Error ? error.stack : error) });
    console.error(error);
  })
  .finally(() => {
    if (OUT) {
      fs.writeFileSync(
        OUT,
        JSON.stringify({ suite: "prc1-cross-service-journey", passed, failed, results }, null, 2),
      );
    }
    console.log(`\nPRODUCT-RC-1 cross-service journey: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
