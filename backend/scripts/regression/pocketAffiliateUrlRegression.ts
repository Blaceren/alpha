/**
 * POCKETCTA-1 — the Pocket affiliate registration URL contract.
 *
 * WHAT THIS SUITE PROVES
 * The Level 1 registration action hands a learner an EXTERNAL URL that carries
 * the operator's affiliate attribution plus that learner's own clickid. Three
 * things can go wrong, and each is a real failure rather than a cosmetic one:
 *
 *   1. The base URL is unusable — plain http, a loopback host, an internal
 *      service port, embedded credentials. Previously `z.string().url()` accepted
 *      all of these and the learner got a dead or attribution-stripped link.
 *   2. The operator's fixed parameters are lost or overwritten. `cid` in
 *      particular is a STATIC affiliate value that must survive; overwriting it
 *      with the learner's clickid would misattribute every registration.
 *   3. A learner identity or a secret leaks the wrong way — a clickid baked into
 *      configuration (shared by everyone), or `ow`/`playerid` on an outbound link.
 *
 * THE OPERATOR'S REAL URL IS NOT IN THIS FILE.
 * A real affiliate URL in source would be committed tracking configuration, and
 * every other deployment would inherit it. So the suite validates INVARIANTS
 * against a synthetic base, and additionally asserts the operator's exact static
 * values when `POCKETCTA_AFFILIATE_BASE_URL` supplies them at run time. The
 * phase runs it both ways.
 *
 * POSTBACK_SECRET is never read, printed, hashed or compared. The forbidden
 * `ow` parameter is matched by NAME only.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

import {
  POCKET_DYNAMIC_PARAM_NAMES,
  POCKET_LANDING_PARAM,
  POCKET_LANDING_VALUE,
  describePocketReferralUrlShape,
  resolvePocketAffiliateUrl,
} from "../../src/lib/exchange/pocketAffiliateUrl";
import { buildPocketReferralUrl, getPocketReferralUrl } from "../../src/lib/exchange/pocket";
import { parsePocketRegistrationFields } from "../../src/lib/exchange/pocketPostbackAuth";
import { validateRuntimeEnv } from "../../src/lib/env";

/**
 * A synthetic stand-in shaped exactly like a real affiliate URL: https, a
 * registration path, and several fixed tracking parameters including `cid`.
 */
const SYNTHETIC_BASE =
  "https://affiliate.example.invalid/register?utm_campaign=111111&utm_source=affiliate&utm_medium=sr&a=SynthAffiliate&al=222222&ac=synthetic1&cid=333333&code=SYNTH1";

/** The operator's real base URL, supplied by the phase at run time only. */
const OPERATOR_BASE = process.env.POCKETCTA_AFFILIATE_BASE_URL;

const CLICK_ID = "tq-0f8f1c9a-1b2c-4d5e-8a9b-0c1d2e3f4a5b";
const OTHER_CLICK_ID = "tq-11111111-2222-4333-8444-555555555555";

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

/** Run `fn` with POCKET_AFFILIATE_BASE_URL set, then restore it. */
function withBase<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.POCKET_AFFILIATE_BASE_URL;
  const previousLegacy = process.env.POCKET_REFERRAL_URL;
  if (value === undefined) delete process.env.POCKET_AFFILIATE_BASE_URL;
  else process.env.POCKET_AFFILIATE_BASE_URL = value;
  delete process.env.POCKET_REFERRAL_URL;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.POCKET_AFFILIATE_BASE_URL;
    else process.env.POCKET_AFFILIATE_BASE_URL = previous;
    if (previousLegacy !== undefined) process.env.POCKET_REFERRAL_URL = previousLegacy;
  }
}

function devEnv(extra: Record<string, string | undefined> = {}) {
  return {
    ATA_ENVIRONMENT: "dev",
    CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    APP_URL: "https://127.0.0.1",
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------
// HTTP fixture plumbing (mirrors publicReferralUrlRegression)
// ---------------------------------------------------------------------------
const sourceDb = process.env.POCKETCTA_FIXTURE_DB;
const dbPath = path.join(os.tmpdir(), `ata-pocketcta-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const port = 3150 + (process.pid % 8);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "PocketCta123!";

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

let server: ChildProcess | null = null;
let serverLogs = "";
async function startServer(env: Record<string, string>) {
  const merged = { ...(process.env as Record<string, string>), ...env };
  delete (merged as Record<string, string | undefined>).NODE_ENV;
  const child: ChildProcess = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: merged as unknown as NodeJS.ProcessEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (v: Buffer) => { serverLogs += String(v); });
  child.stderr?.on("data", (v: Buffer) => { serverLogs += String(v); });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next dev failed to start\n${serverLogs.slice(-3000)}`);
}
async function stopServer() {
  if (!server?.pid) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); }
    catch { return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
}

async function main() {
  // ==================================================== A. base URL validation
  await check("A1 a well-formed affiliate base URL with fixed parameters is accepted", () => {
    const resolved = resolvePocketAffiliateUrl(devEnv({ POCKET_AFFILIATE_BASE_URL: SYNTHETIC_BASE }));
    assert.equal(resolved.kind, "configured");
    assert.equal((resolved as { url: string }).url, SYNTHETIC_BASE);
  });

  await check("A2 plain http is rejected", () => {
    const resolved = resolvePocketAffiliateUrl(
      devEnv({ POCKET_AFFILIATE_BASE_URL: SYNTHETIC_BASE.replace("https:", "http:") }),
    );
    assert.equal(resolved.kind, "invalid");
    assert.equal((resolved as { reason: string }).reason, "not_https");
  });

  await check("A3 every loopback and wildcard host is rejected", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]) {
      const resolved = resolvePocketAffiliateUrl(
        devEnv({ POCKET_AFFILIATE_BASE_URL: `https://${host}/register?a=1` }),
      );
      assert.equal((resolved as { reason: string }).reason, "loopback_host", host);
    }
  });

  await check("A4 internal service ports are rejected", () => {
    for (const p of ["3100", "3050", "3010"]) {
      const resolved = resolvePocketAffiliateUrl(
        devEnv({ POCKET_AFFILIATE_BASE_URL: `https://affiliate.example.invalid:${p}/register?a=1` }),
      );
      assert.equal((resolved as { reason: string }).reason, "internal_service_port", p);
    }
  });

  await check("A5 a non-standard port is rejected", () => {
    const resolved = resolvePocketAffiliateUrl(
      devEnv({ POCKET_AFFILIATE_BASE_URL: "https://affiliate.example.invalid:8443/register?a=1" }),
    );
    assert.equal((resolved as { reason: string }).reason, "non_standard_port");
  });

  await check("A6 embedded credentials are rejected", () => {
    const resolved = resolvePocketAffiliateUrl(
      devEnv({ POCKET_AFFILIATE_BASE_URL: "https://user:pass@affiliate.example.invalid/register?a=1" }),
    );
    assert.equal((resolved as { reason: string }).reason, "has_credentials");
  });

  await check("A7 a fragment is rejected", () => {
    const resolved = resolvePocketAffiliateUrl(
      devEnv({ POCKET_AFFILIATE_BASE_URL: `${SYNTHETIC_BASE}#frag` }),
    );
    assert.equal((resolved as { reason: string }).reason, "has_fragment");
  });

  await check("A8 a malformed or empty value is rejected", () => {
    assert.equal(
      (resolvePocketAffiliateUrl(devEnv({ POCKET_AFFILIATE_BASE_URL: "not a url" })) as { reason: string }).reason,
      "unparseable",
    );
    assert.equal(
      (resolvePocketAffiliateUrl(devEnv({ POCKET_AFFILIATE_BASE_URL: "   " })) as { reason: string }).reason,
      "empty",
    );
  });

  await check("A9 a bare origin with no registration path is rejected", () => {
    const resolved = resolvePocketAffiliateUrl(
      devEnv({ POCKET_AFFILIATE_BASE_URL: "https://affiliate.example.invalid" }),
    );
    assert.equal((resolved as { reason: string }).reason, "no_path");
  });

  await check("A10 a clickid or playerid baked into configuration is rejected", () => {
    // Configuration is shared by every learner, so a clickid here would attribute
    // everyone's registration to one person.
    for (const name of ["click_id", "clickid", "playerid", "CLICKID"]) {
      const resolved = resolvePocketAffiliateUrl(
        devEnv({ POCKET_AFFILIATE_BASE_URL: `https://affiliate.example.invalid/register?${name}=x` }),
      );
      assert.equal((resolved as { reason: string }).reason, "embeds_learner_identifier", name);
    }
  });

  await check("A11 an `ow` or secret-named parameter in the base URL is rejected", () => {
    const ow = resolvePocketAffiliateUrl(
      devEnv({ POCKET_AFFILIATE_BASE_URL: "https://affiliate.example.invalid/register?ow=x" }),
    );
    assert.equal((ow as { reason: string }).reason, "embeds_learner_identifier");
    for (const name of ["secret", "postback_secret", "SECRET"]) {
      const resolved = resolvePocketAffiliateUrl(
        devEnv({ POCKET_AFFILIATE_BASE_URL: `https://affiliate.example.invalid/register?${name}=x` }),
      );
      assert.equal((resolved as { reason: string }).reason, "embeds_secret_parameter", name);
    }
  });

  await check("A12 absence is distinct from invalid", () => {
    assert.deepEqual(resolvePocketAffiliateUrl(devEnv()), { kind: "absent" });
  });

  await check("A13 the validator reads configuration only — no request can reach it", () => {
    const source = fs.readFileSync("src/lib/exchange/pocketAffiliateUrl.ts", "utf8");
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const forbidden of ["Request", "NextRequest", "headers", "x-forwarded", "req\\.", "request\\."]) {
      assert.equal(new RegExp(forbidden, "i").test(executable), false, forbidden);
    }
    // And it never touches the postback secret.
    assert.equal(/POSTBACK_SECRET/.test(source), true, "mentioned only in prose");
    assert.equal(/env\.POSTBACK_SECRET|env\["POSTBACK_SECRET"\]/.test(executable), false);
  });

  await check("A14 no affiliate URL is hardcoded in source", () => {
    for (const file of ["src/lib/exchange/pocketAffiliateUrl.ts", "src/lib/exchange/pocket.ts",
      "src/app/api/exchange/referral-link/route.ts"]) {
      const source = fs.readFileSync(file, "utf8");
      assert.equal(/https?:\/\/[a-z0-9.-]*shortink/i.test(source), false, `${file} names the affiliate host`);
      assert.equal(/\?\?\s*["'`]https?:/.test(source), false, `${file} has a URL fallback`);
    }
  });

  // ============================================ B. runtime env validation
  await check("B1 an unusable affiliate base URL fails runtime env validation", () => {
    for (const bad of [
      SYNTHETIC_BASE.replace("https:", "http:"),
      "https://127.0.0.1/register?a=1",
      "https://affiliate.example.invalid:3100/register?a=1",
      "not a url",
      "https://affiliate.example.invalid/register?clickid=x",
    ]) {
      const result = validateRuntimeEnv(devEnv({ POCKET_AFFILIATE_BASE_URL: bad }));
      assert.equal(result.ok, false, bad);
      assert.ok(
        result.errors.some((e) => e.includes("POCKET_AFFILIATE_BASE_URL")),
        `${bad}: got ${JSON.stringify(result.errors)}`,
      );
    }
  });

  await check("B2 a valid affiliate base URL raises no affiliate error", () => {
    const result = validateRuntimeEnv(devEnv({ POCKET_AFFILIATE_BASE_URL: SYNTHETIC_BASE }));
    assert.ok(
      !result.errors.some((e) => e.includes("POCKET_AFFILIATE_BASE_URL")),
      JSON.stringify(result.errors),
    );
  });

  await check("B3 the affiliate URL does not disturb simulator safety", () => {
    const result = validateRuntimeEnv(devEnv({ POCKET_AFFILIATE_BASE_URL: SYNTHETIC_BASE }));
    assert.ok(!result.errors.some((e) => e.includes("dev_simulator")), JSON.stringify(result.errors));
  });

  // ============================================ C. generated URL contract
  await check("C1 the owner fails closed when the base URL is absent or unusable", () => {
    withBase(undefined, () => assert.throws(() => getPocketReferralUrl(), /required/));
    withBase("http://affiliate.example.invalid/register?a=1", () =>
      assert.throws(() => getPocketReferralUrl(), /https/));
  });

  await check("C2 every static parameter of the base survives verbatim", () => {
    withBase(SYNTHETIC_BASE, () => {
      const base = new URL(SYNTHETIC_BASE);
      const generated = buildPocketReferralUrl(CLICK_ID);
      assert.equal(generated.origin, base.origin);
      assert.equal(generated.pathname, base.pathname);
      for (const [name, value] of base.searchParams) {
        assert.equal(generated.searchParams.get(name), value, `static ${name} changed`);
      }
    });
  });

  await check("C3 `cid` is a static affiliate value and is never overwritten", () => {
    withBase(SYNTHETIC_BASE, () => {
      const expected = new URL(SYNTHETIC_BASE).searchParams.get("cid");
      const generated = buildPocketReferralUrl(CLICK_ID);
      assert.equal(generated.searchParams.get("cid"), expected);
      assert.notEqual(generated.searchParams.get("cid"), CLICK_ID, "cid must not become the clickid");
      assert.equal(generated.searchParams.getAll("cid").length, 1);
    });
  });

  await check("C4 both clickid spellings are emitted, exactly once each", () => {
    withBase(SYNTHETIC_BASE, () => {
      const generated = buildPocketReferralUrl(CLICK_ID);
      for (const name of POCKET_DYNAMIC_PARAM_NAMES) {
        assert.equal(generated.searchParams.get(name), CLICK_ID, name);
        assert.equal(generated.searchParams.getAll(name).length, 1, `${name} duplicated`);
      }
    });
  });

  await check("C5 `clickid` is the spelling the official direct postback requires", () => {
    // The proof that emitting `clickid` is not cosmetic: feed the generated
    // parameters straight to the real postback parser.
    withBase(SYNTHETIC_BASE, () => {
      const generated = buildPocketReferralUrl(CLICK_ID);
      const params = new URLSearchParams(generated.search);
      params.set("playerid", "123456");
      const parsed = parsePocketRegistrationFields(params);
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
      assert.equal((parsed as { clickId: string }).clickId, CLICK_ID);
    });
  });

  await check("C6 `landing` is added exactly once and is not the operator's", () => {
    withBase(SYNTHETIC_BASE, () => {
      const generated = buildPocketReferralUrl(CLICK_ID);
      assert.equal(generated.searchParams.getAll(POCKET_LANDING_PARAM).length, 1);
      assert.equal(generated.searchParams.get(POCKET_LANDING_PARAM), POCKET_LANDING_VALUE);
      assert.equal(new URL(SYNTHETIC_BASE).searchParams.has(POCKET_LANDING_PARAM), false);
    });
  });

  await check("C7 rebuilding is idempotent — no parameter accumulates", () => {
    withBase(SYNTHETIC_BASE, () => {
      const once = buildPocketReferralUrl(CLICK_ID);
      const twice = buildPocketReferralUrl(CLICK_ID);
      assert.equal(once.href, twice.href);
      assert.equal([...twice.searchParams.keys()].length, new Set([...twice.searchParams.keys()]).size);
    });
  });

  await check("C8 the generated URL carries no ow, no playerid and no secret", () => {
    withBase(SYNTHETIC_BASE, () => {
      const generated = buildPocketReferralUrl(CLICK_ID);
      for (const forbidden of ["ow", "playerid", "secret", "postback_secret"]) {
        assert.equal(generated.searchParams.has(forbidden), false, forbidden);
      }
      assert.equal(/[?&]ow=/.test(generated.href), false);
      assert.equal(/playerid/i.test(generated.href), false);
      assert.equal(/secret/i.test(generated.href), false);
    });
  });

  await check("C9 the generated URL is external — never loopback or an internal port", () => {
    withBase(SYNTHETIC_BASE, () => {
      const generated = buildPocketReferralUrl(CLICK_ID);
      assert.equal(generated.protocol, "https:");
      assert.equal(/127\.0\.0\.1|localhost|::1/.test(generated.href), false);
      assert.equal(/:3100|:3050|:3010/.test(generated.href), false);
      assert.equal(generated.href.includes("example.test"), false);
    });
  });

  await check("C10 a different learner gets a different link", () => {
    withBase(SYNTHETIC_BASE, () => {
      const a = buildPocketReferralUrl(CLICK_ID);
      const b = buildPocketReferralUrl(OTHER_CLICK_ID);
      assert.notEqual(a.href, b.href);
      assert.equal(b.searchParams.get("clickid"), OTHER_CLICK_ID);
      // …but the static attribution is identical.
      assert.equal(a.searchParams.get("cid"), b.searchParams.get("cid"));
    });
  });

  await check("C11 the URL is built by a parser, not by concatenation", () => {
    // An `&` arriving from configuration must stay one parameter, not graft a
    // second one on. A concatenating implementation fails this.
    withBase("https://affiliate.example.invalid/register?a=1%26b=2", () => {
      const generated = buildPocketReferralUrl(CLICK_ID);
      assert.equal(generated.searchParams.get("a"), "1&b=2");
      assert.equal(generated.searchParams.has("b"), false);
    });
    const source = fs.readFileSync("src/lib/exchange/pocket.ts", "utf8");
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    assert.equal(/\+\s*["'`][?&]/.test(executable), false, "no string-concatenated query");
  });

  await check("C12 the audit shape describes structure and carries no value", () => {
    withBase(SYNTHETIC_BASE, () => {
      const generated = buildPocketReferralUrl(CLICK_ID);
      const shape = describePocketReferralUrlShape(generated);
      const serialised = JSON.stringify(shape);
      assert.equal(serialised.includes(CLICK_ID), false, "clickid leaked into the audit shape");
      assert.equal(serialised.includes("333333"), false, "a static value leaked into the audit shape");
      assert.deepEqual([...shape.dynamicParamNames], ["click_id", "clickid"]);
      assert.ok(shape.staticParamNames.includes("cid"));
      assert.ok(shape.staticParamNames.includes(POCKET_LANDING_PARAM));
      assert.equal(shape.paramCount, [...generated.searchParams.keys()].length);
      assert.equal(shape.origin, "https://affiliate.example.invalid");
      assert.equal(shape.pathname, "/register");
    });
  });

  // ================================ D. the operator's real supplied URL
  if (!OPERATOR_BASE) {
    console.log("SKIP D: POCKETCTA_AFFILIATE_BASE_URL not supplied");
  } else {
    await check("D1 the operator-supplied base URL passes validation", () => {
      const resolved = resolvePocketAffiliateUrl(devEnv({ POCKET_AFFILIATE_BASE_URL: OPERATOR_BASE }));
      assert.equal(resolved.kind, "configured", JSON.stringify(resolved));
      const url = new URL((resolved as { url: string }).url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.username, "");
      assert.equal(url.password, "");
      assert.equal(url.hash, "");
      assert.equal(url.port, "");
      assert.equal(url.pathname, "/register");
    });

    await check("D2 all eight operator parameters survive generation exactly", () => {
      withBase(OPERATOR_BASE, () => {
        const base = new URL(OPERATOR_BASE);
        const generated = buildPocketReferralUrl(CLICK_ID);
        const names = [...base.searchParams.keys()];
        assert.equal(names.length, 8, `expected 8 static parameters, got ${names.length}: ${names}`);
        for (const [name, value] of base.searchParams) {
          assert.equal(generated.searchParams.get(name), value, `operator ${name} changed`);
          assert.equal(generated.searchParams.getAll(name).length, 1, `operator ${name} duplicated`);
        }
      });
    });

    await check("D3 the generated operator URL has 8 static + landing + 2 clickid names", () => {
      withBase(OPERATOR_BASE, () => {
        const generated = buildPocketReferralUrl(CLICK_ID);
        const shape = describePocketReferralUrlShape(generated);
        assert.equal(shape.paramCount, 11, `got ${shape.paramCount}: ${[...generated.searchParams.keys()]}`);
        assert.equal(shape.staticParamNames.length, 9, "8 operator + landing");
        assert.deepEqual([...shape.dynamicParamNames], ["click_id", "clickid"]);
      });
    });

    await check("D4 the operator base embeds no learner identifier and no secret", () => {
      const base = new URL(OPERATOR_BASE);
      for (const forbidden of ["ow", "playerid", "click_id", "clickid"]) {
        assert.equal(base.searchParams.has(forbidden), false, forbidden);
      }
      for (const name of base.searchParams.keys()) {
        assert.equal(/secret/i.test(name), false, name);
      }
    });
  }

  // ==================================================== E. over real HTTP
  cleanup();
  if (!sourceDb || !fs.existsSync(sourceDb)) {
    console.log("SKIP E: no fixture database available (POCKETCTA_FIXTURE_DB)");
  } else {
    fs.copyFileSync(sourceDb, dbPath);
    const httpBase = OPERATOR_BASE ?? SYNTHETIC_BASE;
    server = await startServer({
      DATABASE_URL: dbUrl,
      SESSION_SECRET: "pocketcta-session-secret",
      POSTBACK_SECRET: "pocketcta-synthetic-postback-secret",
      APP_URL: "https://127.0.0.1",
      PUBLIC_APP_URL: "https://57.128.213.204",
      ATA_ENVIRONMENT: "dev",
      CHECKPOINT_PROVIDER_MODE: "dev_simulator",
      STORAGE_DRIVER: "local",
      POCKET_AFFILIATE_BASE_URL: httpBase,
      EMAIL_VERIFICATION_REQUIRED: "false",
      CAPTCHA_DEV_BYPASS: "true",
      POCKET_POSTBACK_ENABLED: "true",
      CURRICULUM_V2_READ_ENABLED: "true",
      CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
    });

    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);

    const makeLearner = async (tag: string) => {
      const email = `pocketcta-${tag}-${Date.now()}@example.invalid`;
      const user = await prisma.user.create({
        data: {
          email, name: `POCKETCTA ${tag}`, passwordHash: hash,
          referralCode: `PC${tag}${Date.now() % 100000}`, status: "active",
        },
      });
      return { user, email };
    };

    const session = () => {
      const cookies = new Map<string, string>();
      const request = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
        const response = await fetch(`${baseUrl}${url}`, {
          method,
          headers: {
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
            ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
            ...headers,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        for (const raw of response.headers.getSetCookie()) {
          const pair = raw.split(";")[0];
          const index = pair.indexOf("=");
          if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
        }
        const text = await response.text();
        let value: unknown = {};
        try { value = JSON.parse(text); } catch { /* html */ }
        return { status: response.status, body: value as Record<string, unknown>, text };
      };
      const csrf = async () => String((await request("GET", "/api/csrf")).body.csrfToken);
      return { request, csrf };
    };

    const login = async (s: ReturnType<typeof session>, email: string) =>
      s.request("POST", "/api/auth/login", { email, password, captchaToken: "dev-captcha-ok" },
        { "x-csrf-token": await s.csrf() });

    const referral = async (s: ReturnType<typeof session>, headers: Record<string, string> = {}) =>
      s.request("POST", "/api/exchange/referral-link", undefined,
        { "x-csrf-token": await s.csrf(), ...headers });

    await check("E1 an anonymous caller is denied", async () => {
      const anon = session();
      const reply = await referral(anon);
      assert.ok(reply.status === 401 || reply.status === 403, `got ${reply.status}`);
      assert.equal(/shortink|affiliate\.example|utm_campaign/.test(reply.text), false, "no URL leaked to anonymous");
    });

    await check("E2 a missing CSRF token is denied", async () => {
      const { user, email } = await makeLearner("csrf");
      const s = session();
      await login(s, email);
      const reply = await s.request("POST", "/api/exchange/referral-link");
      assert.ok(reply.status === 403 || reply.status === 419, `got ${reply.status}`);
      assert.ok(user.id > 0);
    });

    await check("E3 GET is not an accepted method on the Backend owner", async () => {
      const { email } = await makeLearner("get");
      const s = session();
      await login(s, email);
      const reply = await s.request("GET", "/api/exchange/referral-link");
      assert.equal(reply.status, 405, `got ${reply.status}`);
    });

    let learnerClickId = "";
    await check("E4 an authenticated learner receives an external link with their own clickid", async () => {
      const { user, email } = await makeLearner("ok");
      const s = session();
      await login(s, email);
      const reply = await referral(s);
      assert.equal(reply.status, 200, reply.text.slice(0, 300));
      const url = new URL(String((reply.body as { referralUrl: string }).referralUrl));
      assert.equal(url.origin, new URL(httpBase).origin);
      assert.equal(url.pathname, new URL(httpBase).pathname);
      // The clickid belongs to THIS learner: it is the one persisted for them.
      const account = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });
      assert.ok(account?.clickId, "no clickid persisted");
      assert.equal(url.searchParams.get("clickid"), account?.clickId);
      assert.equal(url.searchParams.get("click_id"), account?.clickId);
      learnerClickId = account?.clickId ?? "";
      // Static attribution survived the round trip through HTTP.
      for (const [name, value] of new URL(httpBase).searchParams) {
        assert.equal(url.searchParams.get(name), value, `static ${name} changed over HTTP`);
      }
      assert.equal(url.searchParams.has("ow"), false);
      assert.equal(url.searchParams.has("playerid"), false);
      assert.equal(/example\.test|127\.0\.0\.1|:3100/.test(url.href), false);
    });

    await check("E5 two learners never share a clickid", async () => {
      const { user: u1, email: e1 } = await makeLearner("one");
      const { user: u2, email: e2 } = await makeLearner("two");
      const s1 = session(); await login(s1, e1);
      const s2 = session(); await login(s2, e2);
      const r1 = new URL(String((await referral(s1)).body.referralUrl));
      const r2 = new URL(String((await referral(s2)).body.referralUrl));
      assert.notEqual(r1.searchParams.get("clickid"), r2.searchParams.get("clickid"));
      const a1 = await prisma.exchangeAccount.findUnique({ where: { userId: u1.id } });
      const a2 = await prisma.exchangeAccount.findUnique({ where: { userId: u2.id } });
      assert.equal(r1.searchParams.get("clickid"), a1?.clickId);
      assert.equal(r2.searchParams.get("clickid"), a2?.clickId);
    });

    await check("E6 repeating the call is stable — the clickid does not rotate", async () => {
      const { email } = await makeLearner("stable");
      const s = session();
      await login(s, email);
      const first = new URL(String((await referral(s)).body.referralUrl));
      const second = new URL(String((await referral(s)).body.referralUrl));
      assert.equal(first.searchParams.get("clickid"), second.searchParams.get("clickid"));
      assert.equal(first.href, second.href);
    });

    await check("E7 a poisoned Host header cannot change the link", async () => {
      const { email } = await makeLearner("host");
      const s = session();
      await login(s, email);
      const clean = new URL(String((await referral(s)).body.referralUrl));
      for (const host of ["evil.example.com", "evil.example.com:443", "127.0.0.1:3100"]) {
        const url = new URL(String((await referral(s, { host })).body.referralUrl));
        assert.equal(url.origin, clean.origin, host);
        assert.equal(url.href.includes("evil"), false, host);
      }
    });

    await check("E8 a poisoned X-Forwarded-Host cannot change the link", async () => {
      const { email } = await makeLearner("xfh");
      const s = session();
      await login(s, email);
      const clean = new URL(String((await referral(s)).body.referralUrl));
      for (const header of ["x-forwarded-host", "x-forwarded-server", "x-original-host", "forwarded"]) {
        const url = new URL(String((await referral(s, { [header]: "evil.example.com" })).body.referralUrl));
        assert.equal(url.origin, clean.origin, header);
        assert.equal(url.href.includes("evil"), false, header);
      }
    });

    await check("E9 an unenrolled learner is served — and nothing is completed", async () => {
      // The documented contract: registration may legally precede enrolment.
      // What must NOT happen is any progress or Pocket identity appearing.
      const { user, email } = await makeLearner("unenrolled");
      const s = session();
      await login(s, email);
      const reply = await referral(s);
      assert.equal(reply.status, 200, reply.text.slice(0, 200));
      assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: user.id } }), 0);
      assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: user.id } }), 0);
    });

    await check("E10 generating a link completes no level and binds no Pocket identity", async () => {
      const { user, email } = await makeLearner("nocomplete");
      const s = session();
      await login(s, email);
      await referral(s);
      await referral(s);
      assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: user.id } }), 0);
      const enrollments = await prisma.userCurriculumEnrollment.findMany({ where: { userId: user.id } });
      for (const enrollment of enrollments) {
        assert.equal(enrollment.highestCompletedLevel, 0, "a level was completed by link generation");
        const progress = await prisma.userLevelProgress.count({
          where: { enrollmentId: enrollment.id, status: "completed" },
        });
        assert.equal(progress, 0, "completed progress appeared");
      }
    });

    await check("E11 the audit record carries the shape but never the clickid", async () => {
      const audits = await prisma.auditLog.findMany({
        where: { action: "POCKET_REFERRAL_OPENED" },
        orderBy: { id: "desc" },
        take: 25,
      });
      assert.ok(audits.length > 0, "no referral audit rows");
      for (const row of audits) {
        const serialised = JSON.stringify(row.metadata ?? {});
        assert.equal(serialised.includes("tq-"), false, "a clickid reached the audit log");
        assert.equal(/utm_campaign=|[?&]a=/.test(serialised), false, "a full URL reached the audit log");
      }
      const latest = JSON.stringify(audits[0].metadata ?? {});
      assert.ok(latest.includes("referralUrlShape"), "shape evidence missing");
      assert.ok(latest.includes("paramCount"), "param count missing");
    });

    await check("E12 the server logs never contain the generated learner URL", async () => {
      if (learnerClickId) {
        assert.equal(serverLogs.includes(learnerClickId), false, "a clickid was logged");
      }
      assert.equal(/[?&]ow=/.test(serverLogs), false, "an ow parameter was logged");
      assert.equal(serverLogs.includes("pocketcta-synthetic-postback-secret"), false, "the secret was logged");
    });

    await prisma.$disconnect();
  }
}

main()
  .then(async () => {
    await stopServer();
    cleanup();
    console.log(`\npocket affiliate url regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch(async (error) => {
    console.error(error);
    await stopServer();
    cleanup();
    console.log(`\npocket affiliate url regression: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  });
