/**
 * PUBLICURL-1 — the public learner-facing URL contract.
 *
 * THE DEFECT THIS CLOSES
 * `/api/me` built the learner's invite link from `APP_URL`. On the publicly
 * served DEV box `APP_URL` must stay a **loopback** origin, because
 * `classifyEnvironment` demotes a `dev` declaration to `unknown` when it is not,
 * and `validateRuntimeEnv` then makes `CHECKPOINT_PROVIDER_MODE=dev_simulator` a
 * fatal error. So the link read `https://127.0.0.1/register?ref=…` — useless to
 * the learner who received it — and the obvious fix (point `APP_URL` at the public
 * IP) takes the whole Backend down.
 *
 * The fix separates the two jobs. `PUBLIC_APP_URL` names the learner-facing
 * origin and nothing else.
 *
 * WHAT THIS SUITE PROVES
 * Validation of the new variable, the security properties that matter for a URL
 * handed to a person (no header poisoning, no loopback, no credentials), and —
 * most importantly — that the new variable is **inert** with respect to
 * environment classification, cookie policy and simulator safety. If a future
 * change wired it into any of those, this suite fails.
 *
 * Pure unit checks plus one HTTP pass against a real server. No external request
 * is made and the real POSTBACK_SECRET is never read.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

import {
  PUBLIC_APP_URL_KEY,
  buildReferralInviteLink,
  publicAppOrigin,
  resolvePublicAppUrl,
} from "../../src/lib/publicUrl";
import { classifyEnvironment, isDevEnvironment } from "../../src/lib/environment";
import { shouldUseSecureCookies } from "../../src/lib/session";
import { validateRuntimeEnv } from "../../src/lib/env";

const PUBLIC_ORIGIN = "https://57.128.213.204";
const INTERNAL_APP_URL = "https://127.0.0.1";

const sourceDb =
  process.env.PUBLICURL_FIXTURE_DB ?? "/home/ubuntu/publicurl1-work/db/fixture.sqlite";
const dbPath = path.join(os.tmpdir(), `ata-publicurl-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const port = 3140 + (process.pid % 8);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "PublicUrl123!";

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

/** A minimal env that classifies as dev with the simulator selected. */
function devEnv(extra: Record<string, string | undefined> = {}) {
  return {
    ATA_ENVIRONMENT: "dev",
    CHECKPOINT_PROVIDER_MODE: "dev_simulator",
    APP_URL: INTERNAL_APP_URL,
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

let server: ChildProcess | null = null;
async function startServer(env: Record<string, string>) {
  const merged = { ...(process.env as Record<string, string>), ...env };
  delete (merged as Record<string, string | undefined>).NODE_ENV;
  const child: ChildProcess = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: merged as unknown as NodeJS.ProcessEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (v: Buffer) => { logs += String(v); });
  child.stderr?.on("data", (v: Buffer) => { logs += String(v); });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-3000)}`);
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
  // ------------------------------------------------------ A. validation
  await check("A1 a valid public https origin is accepted and normalised", () => {
    const resolved = resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: PUBLIC_ORIGIN }));
    assert.equal(resolved.kind, "configured");
    assert.equal((resolved as { origin: string }).origin, PUBLIC_ORIGIN);
  });

  await check("A2 a trailing slash resolves to the same origin — no ambiguity", () => {
    const withSlash = resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: `${PUBLIC_ORIGIN}/` }));
    assert.equal(withSlash.kind, "configured");
    assert.equal((withSlash as { origin: string }).origin, PUBLIC_ORIGIN);
  });

  await check("A3 plain http is rejected", () => {
    const resolved = resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: "http://57.128.213.204" }));
    assert.deepEqual(resolved, { kind: "invalid", reason: "not_https" });
  });

  await check("A4 every loopback and wildcard host is rejected", () => {
    for (const host of ["https://127.0.0.1", "https://localhost", "https://[::1]", "https://0.0.0.0"]) {
      const resolved = resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: host }));
      assert.deepEqual(resolved, { kind: "invalid", reason: "loopback_host" }, host);
    }
  });

  await check("A5 internal service ports are rejected", () => {
    for (const url of ["https://57.128.213.204:3100", "https://57.128.213.204:3050", "https://57.128.213.204:3010"]) {
      const resolved = resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: url }));
      assert.deepEqual(resolved, { kind: "invalid", reason: "internal_service_port" }, url);
    }
  });

  await check("A6 embedded credentials are rejected", () => {
    const resolved = resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: "https://user:pass@57.128.213.204" }));
    assert.deepEqual(resolved, { kind: "invalid", reason: "has_credentials" });
  });

  await check("A7 a query string or a fragment is rejected", () => {
    assert.deepEqual(
      resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: `${PUBLIC_ORIGIN}?a=b` })),
      { kind: "invalid", reason: "has_query" },
    );
    assert.deepEqual(
      resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: `${PUBLIC_ORIGIN}#frag` })),
      { kind: "invalid", reason: "has_fragment" },
    );
  });

  await check("A8 a base path is rejected — the referral contract appends its own", () => {
    assert.deepEqual(
      resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: `${PUBLIC_ORIGIN}/app` })),
      { kind: "invalid", reason: "has_path" },
    );
  });

  await check("A9 an unparseable or empty value is rejected", () => {
    assert.deepEqual(resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: "not a url" })), { kind: "invalid", reason: "unparseable" });
    assert.deepEqual(resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: "" })), { kind: "invalid", reason: "empty" });
    assert.deepEqual(resolvePublicAppUrl(devEnv({ PUBLIC_APP_URL: "   " })), { kind: "invalid", reason: "empty" });
  });

  await check("A10 absence is legal and distinct from invalid", () => {
    assert.deepEqual(resolvePublicAppUrl(devEnv()), { kind: "absent" });
    assert.equal(publicAppOrigin(devEnv()), null);
  });

  await check("A11 there is no source default pointing at any public server", () => {
    const source = fs.readFileSync("src/lib/publicUrl.ts", "utf8");
    // The public IP must appear nowhere in source: a default would silently point
    // every other deployment at this one machine.
    assert.equal(source.includes("57.128.213.204"), false);
    assert.equal(/\?\?\s*["'`]https?:/.test(source), false, "no `?? \"https://…\"` fallback");
  });

  // ------------------------------------------------- B. runtime validation
  await check("B1 a malformed public URL fails runtime env validation", () => {
    for (const bad of ["http://57.128.213.204", "https://127.0.0.1", "not a url", "https://57.128.213.204:3100"]) {
      const result = validateRuntimeEnv(devEnv({ PUBLIC_APP_URL: bad }));
      assert.equal(result.ok, false, bad);
      assert.ok(
        result.errors.some((e) => e.includes(PUBLIC_APP_URL_KEY)),
        `${bad}: expected a ${PUBLIC_APP_URL_KEY} error, got ${JSON.stringify(result.errors)}`,
      );
    }
  });

  await check("B2 a valid public URL passes validation alongside the simulator", () => {
    const result = validateRuntimeEnv(devEnv({ PUBLIC_APP_URL: PUBLIC_ORIGIN }));
    assert.ok(
      !result.errors.some((e) => e.includes(PUBLIC_APP_URL_KEY)),
      JSON.stringify(result.errors),
    );
  });

  await check("B3 an absent public URL is not an error", () => {
    const result = validateRuntimeEnv(devEnv());
    assert.ok(!result.errors.some((e) => e.includes(PUBLIC_APP_URL_KEY)), JSON.stringify(result.errors));
  });

  // --------------------------------- C. INDEPENDENCE — the point of the phase
  await check("C1 the public URL does not affect environment classification", () => {
    const withPublic = devEnv({ PUBLIC_APP_URL: PUBLIC_ORIGIN });
    const withoutPublic = devEnv();
    assert.deepEqual(classifyEnvironment(withPublic), classifyEnvironment(withoutPublic));
    assert.equal(isDevEnvironment(withPublic), true);
    assert.equal(isDevEnvironment(withoutPublic), true);
  });

  await check("C2 the public URL does not affect cookie policy", () => {
    // Secure cookies must still be decided by APP_URL alone.
    const publicOnly = { APP_URL: "http://127.0.0.1:3100", PUBLIC_APP_URL: PUBLIC_ORIGIN } as unknown as NodeJS.ProcessEnv;
    assert.equal(shouldUseSecureCookies(publicOnly), false, "a public URL must not turn Secure on");
    const internalHttps = { APP_URL: INTERNAL_APP_URL, PUBLIC_APP_URL: PUBLIC_ORIGIN } as unknown as NodeJS.ProcessEnv;
    assert.equal(shouldUseSecureCookies(internalHttps), true, "APP_URL still decides");
  });

  await check("C3 the simulator stays selectable in DEV with a public URL set", () => {
    const result = validateRuntimeEnv(devEnv({ PUBLIC_APP_URL: PUBLIC_ORIGIN }));
    assert.ok(
      !result.errors.some((e) => e.includes("dev_simulator")),
      `simulator rejected: ${JSON.stringify(result.errors)}`,
    );
  });

  await check("C4 production still rejects the simulator, public URL or not", () => {
    for (const extra of [{}, { PUBLIC_APP_URL: PUBLIC_ORIGIN }]) {
      const env = {
        ATA_ENVIRONMENT: "production",
        CHECKPOINT_PROVIDER_MODE: "dev_simulator",
        APP_URL: INTERNAL_APP_URL,
        ...extra,
      } as unknown as NodeJS.ProcessEnv;
      const result = validateRuntimeEnv(env);
      assert.ok(
        result.errors.some((e) => e.includes("dev_simulator")),
        `production must reject the simulator: ${JSON.stringify(result.errors)}`,
      );
    }
  });

  await check("C5 a public APP_URL still demotes the classification — interlock intact", () => {
    const env = devEnv({ APP_URL: PUBLIC_ORIGIN, PUBLIC_APP_URL: PUBLIC_ORIGIN });
    assert.deepEqual(classifyEnvironment(env), { kind: "unknown", reason: "ambiguous" });
    assert.equal(isDevEnvironment(env), false);
  });

  await check("C6 the public URL module reads exactly one variable", () => {
    const source = fs.readFileSync("src/lib/publicUrl.ts", "utf8");
    const reads = [...source.matchAll(/env\[?\.?([A-Z_]{4,})/g)].map((m) => m[1]);
    const unique = [...new Set(reads)].filter((name) => name !== "PUBLIC_APP_URL_KEY");
    assert.deepEqual(unique, [], `unexpected env reads: ${unique.join(",")}`);
    for (const forbidden of ["ATA_ENVIRONMENT", "CHECKPOINT_PROVIDER_MODE", "POSTBACK_SECRET", "SESSION_SECRET", "APP_URL"]) {
      assert.equal(source.includes(`env.${forbidden}`), false, forbidden);
      assert.equal(source.includes(`env["${forbidden}"]`), false, forbidden);
    }
  });

  // ------------------------------------------------------ D. link building
  await check("D1 the invite link uses the public origin and the existing path", () => {
    const link = buildReferralInviteLink("ABC123", devEnv({ PUBLIC_APP_URL: PUBLIC_ORIGIN }));
    assert.equal(link, `${PUBLIC_ORIGIN}/register?ref=ABC123`);
  });

  await check("D2 the link is empty when no public origin is configured", () => {
    assert.equal(buildReferralInviteLink("ABC123", devEnv()), "");
    assert.equal(buildReferralInviteLink("ABC123", devEnv({ PUBLIC_APP_URL: "http://x.test" })), "");
  });

  await check("D3 the referral code is URL-encoded", () => {
    const link = buildReferralInviteLink("a b&c=d", devEnv({ PUBLIC_APP_URL: PUBLIC_ORIGIN }));
    assert.equal(link, `${PUBLIC_ORIGIN}/register?ref=a%20b%26c%3Dd`);
    assert.equal(new URL(link).searchParams.get("ref"), "a b&c=d");
  });

  await check("D4 no builder accepts a request, so no header can reach it", () => {
    const source = fs.readFileSync("src/lib/publicUrl.ts", "utf8");
    // Comments are stripped: the file explains at length what it refuses to read.
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    // `url.hostname` and LOOPBACK_HOSTS are legitimate — they parse a CONFIGURED
    // value. What must not appear is anything that reads a REQUEST.
    for (const forbidden of [
      "Request", "NextRequest", "\\.headers", "headers\\.get",
      "x-forwarded", "req\\.", "request\\.",
    ]) {
      assert.equal(
        new RegExp(forbidden, "i").test(executable),
        false,
        `publicUrl.ts must not reference ${forbidden}`,
      );
    }
    // And it takes no parameter that could carry one.
    assert.equal(/function \w+\([^)]*\b(request|req|headers)\b/i.test(executable), false);
  });

  // ------------------------------------------------------ E. over real HTTP
  cleanup();
  if (!fs.existsSync(sourceDb)) {
    console.log("SKIP E: no fixture database available");
  } else {
    fs.copyFileSync(sourceDb, dbPath);
    server = await startServer({
      DATABASE_URL: dbUrl,
      SESSION_SECRET: "publicurl-session-secret",
      POSTBACK_SECRET: "publicurl-synthetic-postback-secret",
      APP_URL: INTERNAL_APP_URL,
      PUBLIC_APP_URL: PUBLIC_ORIGIN,
      ATA_ENVIRONMENT: "dev",
      CHECKPOINT_PROVIDER_MODE: "dev_simulator",
      STORAGE_DRIVER: "local",
      POCKET_AFFILIATE_BASE_URL: "https://example.invalid/ref",
      EMAIL_VERIFICATION_REQUIRED: "false",
      CAPTCHA_DEV_BYPASS: "true",
      POCKET_POSTBACK_ENABLED: "true",
      CURRICULUM_V2_READ_ENABLED: "true",
      CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
    });

    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);
    const email = `publicurl-${Date.now()}@example.invalid`;
    const learner = await prisma.user.create({
      data: {
        email, name: "PUBLICURL", passwordHash: hash,
        referralCode: `PU${Date.now() % 1000000}`, status: "active",
      },
    });

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
    await request("POST", "/api/auth/login", { email, password, captchaToken: "dev-captcha-ok" },
      { "x-csrf-token": await csrf() });

    const readLink = async (headers: Record<string, string> = {}) => {
      const me = await request("GET", "/api/me", undefined, headers);
      assert.equal(me.status, 200, me.text.slice(0, 200));
      const user = me.body.user as { referrals: { link: string } };
      return user.referrals.link;
    };

    await check("E1 /api/me returns the public origin, with no loopback", async () => {
      const link = await readLink();
      assert.equal(link, `${PUBLIC_ORIGIN}/register?ref=${learner.referralCode}`);
      assert.equal(/127\.0\.0\.1|localhost/.test(link), false);
      assert.equal(/:3100|:3050|:3010/.test(link), false);
    });

    await check("E2 a poisoned Host header cannot change the link", async () => {
      for (const host of ["evil.example.com", "evil.example.com:443", "127.0.0.1:3100"]) {
        const link = await readLink({ host });
        assert.equal(link, `${PUBLIC_ORIGIN}/register?ref=${learner.referralCode}`, host);
        assert.equal(link.includes("evil"), false, host);
      }
    });

    await check("E3 a poisoned X-Forwarded-Host cannot change the link", async () => {
      for (const header of ["x-forwarded-host", "x-forwarded-server", "x-original-host", "forwarded"]) {
        const link = await readLink({ [header]: "evil.example.com" });
        assert.equal(link, `${PUBLIC_ORIGIN}/register?ref=${learner.referralCode}`, header);
        assert.equal(link.includes("evil"), false, header);
      }
    });

    await check("E4 the link carries no secret, no ow and no playerid", async () => {
      const link = await readLink();
      for (const forbidden of ["ow=", "playerid", "postback", "secret", "clickid"]) {
        assert.equal(link.toLowerCase().includes(forbidden), false, forbidden);
      }
    });

    await check("E5 the Pocket referral contract is untouched and still external", async () => {
      const reply = await request("POST", "/api/exchange/referral-link", undefined, { "x-csrf-token": await csrf() });
      assert.equal(reply.status, 200, reply.text.slice(0, 200));
      const url = new URL(String((reply.body as { referralUrl: string }).referralUrl));
      assert.equal(url.origin, "https://example.invalid", "still driven by POCKET_AFFILIATE_BASE_URL");
      assert.equal(/127\.0\.0\.1|localhost/.test(url.href), false);
      assert.ok(url.searchParams.get("clickid"), "click id preserved");
      assert.equal(url.searchParams.has("ow"), false);
      assert.equal(url.searchParams.has("playerid"), false);
    });

    await prisma.$disconnect();
  }
}

main()
  .then(async () => {
    await stopServer();
    cleanup();
    console.log(`\npublic referral url regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch(async (error) => {
    console.error(error);
    await stopServer();
    cleanup();
    console.log(`\npublic referral url regression: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  });
