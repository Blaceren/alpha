/**
 * AFD-3A3 — Turnstile on the LOGIN surfaces.
 *
 * WHAT THIS SUITE PROVES
 * AFD-3A2 hardened registration and deliberately left login unverified, because
 * neither login page had a widget and enforcing the challenge would have locked
 * out the learner and the CRM administrator. This suite proves the replacement
 * contract:
 *
 *   - login is verified wherever enforcement applies, with no sentinel, no
 *     header bypass and no query bypass;
 *   - a token is evidence about ONE form — the three surfaces cannot borrow each
 *     other's tokens;
 *   - the surface is named by a trusted fronting server, never by the caller;
 *   - a CAPTCHA failure short-circuits BEFORE any password comparison, so the
 *     endpoint cannot be used to learn whether an account exists;
 *   - production-like configuration fails closed.
 *
 * NO SECRET, REAL OR DUMMY, APPEARS IN THIS FILE, and Siteverify is never
 * called: every provider answer is injected through the `fetchImpl` seam, so
 * this suite makes no outbound request and touches no database.
 * `POSTBACK_SECRET` and `SESSION_SECRET` are neither read nor named.
 */
import assert from "node:assert/strict";

import {
  CAPTCHA_LOGIN_ENFORCED_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_TEST_MODE_KEY,
  CAPTCHA_TEST_MODE_MARKER,
  TURNSTILE_EXPECTED_ACTION_KEY,
  TURNSTILE_SECRET_ENV_KEY,
  TURNSTILE_PROVIDER,
  TURNSTILE_TEST_PROVIDER,
  ACTION_PATTERN,
  resolveCaptchaConfig,
} from "../../src/lib/captcha/provider";
import {
  ACADEMY_LOGIN_SURFACE,
  ACADEMY_REGISTER_SURFACE,
  AUTH_SURFACES,
  AUTH_SURFACE_HEADER,
  AUTH_SURFACE_NAMES,
  CRM_LOGIN_SURFACE,
  isAuthSurfaceName,
  resolveAuthSurface,
} from "../../src/lib/captcha/surface";
import { isCaptchaEnforced, verifyCaptcha } from "../../src/lib/captcha";
import { validateRuntimeEnv } from "../../src/lib/env";

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

/** A stand-in with the shape of a real secret. Not a real credential. */
const REAL_SHAPED_SECRET = "synthetic-turnstile-secret-not-a-real-key";
/** A stand-in with Cloudflare's published dummy-secret SHAPE. Not a real key. */
const TEST_SHAPED_SECRET = `9x${"0".repeat(31)}ZZ`;
const TOKEN = "synthetic.dummy.token";

/**
 * The strings that must never again authorize anything. `dev-captcha-ok` is the
 * literal the pre-AFD-3A2 stub accepted and the Backend's own legacy pages used
 * to send; the others are the shapes a future stand-in would most plausibly take.
 */
const FORBIDDEN_SENTINELS = [
  "dev-captcha-ok",
  "dev-captcha",
  "captcha-ok",
  "test-token",
  "bypass",
] as const;

function envFor(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    ATA_ENVIRONMENT: "dev",
    APP_URL: "https://127.0.0.1",
    [CAPTCHA_LOGIN_ENFORCED_KEY]: "true",
    [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
    [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env as unknown as NodeJS.ProcessEnv;
}

function providerJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { url: string; init: { body: string } };

function stubFetch(responder: () => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const impl = async (url: string, init: { body: string }) => {
    calls.push({ url, init });
    return responder();
  };
  return { calls, impl: impl as never };
}

/** A Siteverify answer that says "genuine, minted by the widget for `action`". */
function solvedFor(action: string) {
  return stubFetch(() => providerJson({ success: true, action, hostname: "academy.example.invalid" }));
}

function loginRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://academy.example.invalid/api/auth/login", {
    method: "POST",
    headers,
  });
}

/**
 * Remove block and line comments. Deliberately simple: it is applied only to
 * this repository's own TypeScript, where a `//` inside a string literal is
 * confined to URLs (`https://…`), and a URL cannot contain a sentinel, so the
 * only possible error is to strip slightly too much — which can never turn a
 * real offender into a pass.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

async function main() {
  // ==================================================== A. the surface registry
  await check("exactly three surfaces exist, one per public authentication form", () => {
    assert.deepEqual([...AUTH_SURFACE_NAMES].sort(), [
      "academy_login",
      "academy_register",
      "crm_login",
    ]);
    assert.equal(ACADEMY_REGISTER_SURFACE.purpose, "register");
    assert.equal(ACADEMY_LOGIN_SURFACE.purpose, "login");
    assert.equal(CRM_LOGIN_SURFACE.purpose, "login");
  });

  await check("every action is distinct and within Cloudflare's documented limits", () => {
    const actions = AUTH_SURFACE_NAMES.map((name) => AUTH_SURFACES[name].action);
    assert.equal(new Set(actions).size, actions.length, "two surfaces share an action");
    for (const action of actions) {
      assert.equal(ACTION_PATTERN.test(action), true, `${action} violates the action shape`);
    }
  });

  await check("an unknown or foreign-purpose surface header resolves to null", () => {
    assert.equal(
      resolveAuthSurface(loginRequest({ [AUTH_SURFACE_HEADER]: "academy_login" }), "login")?.name,
      "academy_login",
    );
    assert.equal(
      resolveAuthSurface(loginRequest({ [AUTH_SURFACE_HEADER]: "crm_login" }), "login")?.name,
      "crm_login",
    );
    // The registration surface exists, but it does not belong to this purpose.
    assert.equal(
      resolveAuthSurface(loginRequest({ [AUTH_SURFACE_HEADER]: "academy_register" }), "login"),
      null,
    );
    // Nothing is guessed, aliased or case-folded.
    for (const raw of ["", "Academy_Login", "ACADEMY_LOGIN", "login", "academy", "__proto__", "constructor"]) {
      assert.equal(
        resolveAuthSurface(loginRequest({ [AUTH_SURFACE_HEADER]: raw }), "login"),
        null,
        `${JSON.stringify(raw)} was accepted`,
      );
    }

    // The string-level contract is strict too. Surrounding whitespace never
    // reaches `resolveAuthSurface` in practice — RFC 7230 optional whitespace is
    // stripped by the Headers implementation before we see the value — so this
    // is asserted on the predicate directly rather than through a Request that
    // would silently normalise it and prove nothing.
    for (const raw of [" academy_login", "academy_login ", "\tacademy_login"]) {
      assert.equal(isAuthSurfaceName(raw), false, `${JSON.stringify(raw)} was accepted`);
    }
    // And an absent header is null, never a default.
    assert.equal(resolveAuthSurface(loginRequest(), "login"), null);
    assert.equal(resolveAuthSurface(undefined, "login"), null);
    assert.equal(isAuthSurfaceName("__proto__"), false);
  });

  // ==================================================== B. cross-action refusal
  await check("a registration token cannot authorize a login", async () => {
    const result = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: solvedFor(ACADEMY_REGISTER_SURFACE.action).impl,
    });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.outcome, "action_mismatch");
    assert.equal(!result.ok && result.code, "CAPTCHA_FAILED");
  });

  await check("an Academy login token cannot authorize a CRM login", async () => {
    const result = await verifyCaptcha({
      purpose: "login",
      surface: CRM_LOGIN_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: solvedFor(ACADEMY_LOGIN_SURFACE.action).impl,
    });
    assert.equal(!result.ok && result.outcome, "action_mismatch");
  });

  await check("a CRM login token cannot authorize an Academy login", async () => {
    const result = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: solvedFor(CRM_LOGIN_SURFACE.action).impl,
    });
    assert.equal(!result.ok && result.outcome, "action_mismatch");
  });

  await check("a login token cannot authorize a registration", async () => {
    const result = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: solvedFor(ACADEMY_LOGIN_SURFACE.action).impl,
    });
    assert.equal(!result.ok && result.outcome, "action_mismatch");
  });

  await check("each surface accepts its OWN token", async () => {
    for (const surface of [ACADEMY_LOGIN_SURFACE, CRM_LOGIN_SURFACE]) {
      const result = await verifyCaptcha({
        purpose: "login",
        surface,
        token: TOKEN,
        env: envFor(),
        fetchImpl: solvedFor(surface.action).impl,
      });
      assert.equal(result.ok, true, `${surface.name} refused its own token`);
    }
    const registration = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: solvedFor(ACADEMY_REGISTER_SURFACE.action).impl,
    });
    assert.equal(registration.ok, true);
  });

  await check("an answer carrying NO action is refused, however genuine", async () => {
    // This is what a token handed to Siteverify by a script rather than minted
    // by a widget looks like — and it is what a permissive test secret would
    // otherwise wave through.
    const result = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: stubFetch(() => providerJson({ success: true })).impl,
    });
    assert.equal(!result.ok && result.outcome, "action_mismatch");
  });

  await check("the testing-key exception is bounded by BOTH facts, not one", async () => {
    // Cloudflare's testing keys cannot carry an action — the "token" they mint
    // is a fixed literal that encodes nothing, so there is nothing to echo.
    // Refusing an absent action there would make the isolated test provider
    // incapable of succeeding; tolerating it anywhere else would be a bypass.
    const testEnv = envFor({
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
      [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
      [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
    });
    const testingKeyAnswer = () =>
      providerJson({
        success: true,
        hostname: "example.com",
        metadata: { result_with_testing_key: true },
      });

    // 1. Test provider + Cloudflare's marker: accepted.
    const accepted = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: testEnv,
      fetchImpl: stubFetch(testingKeyAnswer).impl,
    });
    assert.equal(accepted.ok, true);

    // 2. The PRODUCTION provider seeing the same marker: refused. A real secret
    //    cannot produce it, and honouring a forged one would be the bypass.
    const productionProvider = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: stubFetch(testingKeyAnswer).impl,
    });
    assert.equal(!productionProvider.ok && productionProvider.outcome, "action_mismatch");

    // 3. The test provider WITHOUT the marker: refused. The relaxation is not a
    //    property of the provider alone.
    const noMarker = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: testEnv,
      fetchImpl: stubFetch(() => providerJson({ success: true, hostname: "example.com" })).impl,
    });
    assert.equal(!noMarker.ok && noMarker.outcome, "action_mismatch");

    // 4. A truthy-but-not-true marker: refused. Only Cloudflare's contract.
    for (const forged of ["true", 1, {}, null]) {
      const result = await verifyCaptcha({
        purpose: "login",
        surface: ACADEMY_LOGIN_SURFACE,
        token: TOKEN,
        env: testEnv,
        fetchImpl: stubFetch(() =>
          providerJson({ success: true, metadata: { result_with_testing_key: forged } }),
        ).impl,
      });
      assert.equal(result.ok, false, `${JSON.stringify(forged)} was accepted as the marker`);
    }

    // 5. A STATED action that disagrees is refused even under the test provider.
    //    The exception covers an ABSENT action only.
    const statedMismatch = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: testEnv,
      fetchImpl: stubFetch(() =>
        providerJson({
          success: true,
          action: "crm_login",
          metadata: { result_with_testing_key: true },
        }),
      ).impl,
    });
    assert.equal(!statedMismatch.ok && statedMismatch.outcome, "action_mismatch");
  });

  // ================================================ C. the surface is mandatory
  await check("an enforced login with no resolved surface is a configuration error", async () => {
    const stub = stubFetch(() => providerJson({ success: true, action: "academy_login" }));
    const result = await verifyCaptcha({
      purpose: "login",
      surface: null,
      token: TOKEN,
      env: envFor(),
      fetchImpl: stub.impl,
    });
    assert.equal(!result.ok && result.outcome, "surface_unresolved");
    assert.equal(!result.ok && result.code, "CAPTCHA_CONFIGURATION_ERROR");
    assert.equal(!result.ok && result.status, 503);
    // And the provider was never asked — an unattributable challenge is refused
    // locally rather than spending a round trip to learn nothing.
    assert.equal(stub.calls.length, 0);
  });

  await check("a surface belonging to another purpose is refused, not reinterpreted", async () => {
    const result = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: solvedFor(ACADEMY_REGISTER_SURFACE.action).impl,
    });
    assert.equal(!result.ok && result.outcome, "surface_unresolved");
  });

  // ================================================== D. no bypass of any kind
  await check("no sentinel string authorizes a login", async () => {
    for (const sentinel of FORBIDDEN_SENTINELS) {
      const result = await verifyCaptcha({
        purpose: "login",
        surface: ACADEMY_LOGIN_SURFACE,
        token: sentinel,
        env: envFor(),
        // The harshest case: a provider that says yes to everything, which is
        // exactly how Cloudflare's "always passes" dummy secret behaves. The
        // action pin is what stops it, and it must stop it.
        fetchImpl: stubFetch(() => providerJson({ success: true })).impl,
      });
      assert.equal(result.ok, false, `${sentinel} authorized a login`);
    }
  });

  await check("a missing token is refused before the provider is contacted", async () => {
    const stub = stubFetch(() => providerJson({ success: true, action: "academy_login" }));
    for (const token of [undefined, null, "", "   "]) {
      const result = await verifyCaptcha({
        purpose: "login",
        surface: ACADEMY_LOGIN_SURFACE,
        token,
        env: envFor(),
        fetchImpl: stub.impl,
      });
      assert.equal(!result.ok && result.outcome, "missing_token");
    }
    assert.equal(stub.calls.length, 0);
  });

  await check("no request header or query can turn enforcement off", async () => {
    // `verifyCaptcha` reads exactly one thing from the request: the trusted
    // client IP, forwarded to Cloudflare. Nothing in a URL or a header is
    // consulted for enforcement, so these all have to fail identically.
    const hostile = new Request(
      "https://academy.example.invalid/api/auth/login?captcha=off&skipCaptcha=1&dev=true",
      {
        method: "POST",
        headers: {
          "x-captcha-bypass": "true",
          "x-skip-captcha": "1",
          "x-ata-captcha": "ok",
          [AUTH_SURFACE_HEADER]: "academy_login",
        },
      },
    );
    const result = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: "",
      env: envFor(),
      request: hostile,
      fetchImpl: stubFetch(() => providerJson({ success: true, action: "academy_login" })).impl,
    });
    assert.equal(result.ok, false);
  });

  await check("a replayed token is refused", async () => {
    const result = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: envFor(),
      fetchImpl: stubFetch(() =>
        providerJson({ success: false, "error-codes": ["timeout-or-duplicate"] }),
      ).impl,
    });
    assert.equal(!result.ok && result.outcome, "expired_or_duplicate");
    // Single-use: the browser must obtain a fresh challenge before retrying.
    assert.equal(!result.ok && result.renewToken, true);
  });

  await check("provider failure is never a login", async () => {
    const cases: Array<[string, () => Response | Promise<Response>, string]> = [
      ["timeout", () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })), "provider_timeout"],
      ["5xx", () => providerJson({}, 503), "provider_unavailable"],
      ["malformed", () => providerJson({ success: "yes" }), "malformed_provider_response"],
      ["non-JSON", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), "malformed_provider_response"],
      ["our own bad secret", () => providerJson({ success: false, "error-codes": ["invalid-input-secret"] }), "provider_misconfigured"],
    ];
    for (const [label, responder, outcome] of cases) {
      const result = await verifyCaptcha({
        purpose: "login",
        surface: ACADEMY_LOGIN_SURFACE,
        token: TOKEN,
        env: envFor(),
        fetchImpl: stubFetch(responder).impl,
      });
      assert.equal(result.ok, false, `${label} produced a pass`);
      assert.equal(!result.ok && result.outcome, outcome, label);
    }
  });

  // ================================================== E. configuration contract
  await check("login enforcement is mandatory outside an explicit dev deployment", () => {
    for (const environment of ["production", "staging"]) {
      const { errors } = validateRuntimeEnv({
        NODE_ENV: "production",
        ATA_ENVIRONMENT: environment,
        APP_URL: "https://academy.example.invalid",
        DATABASE_URL: "file:./x.sqlite",
        SESSION_SECRET: "x".repeat(48),
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      } as unknown as NodeJS.ProcessEnv);
      assert.equal(
        errors.some((message: string) => message.includes(CAPTCHA_LOGIN_ENFORCED_KEY)),
        true,
        `${environment} booted without login enforcement`,
      );
    }
  });

  await check("production refuses a missing provider and a missing secret", () => {
    const base = {
      NODE_ENV: "production",
      ATA_ENVIRONMENT: "production",
      APP_URL: "https://academy.example.invalid",
      DATABASE_URL: "file:./x.sqlite",
      SESSION_SECRET: "x".repeat(48),
      [CAPTCHA_LOGIN_ENFORCED_KEY]: "true",
    };
    const { errors: noProvider } = validateRuntimeEnv(base as unknown as NodeJS.ProcessEnv);
    assert.equal(noProvider.some((m: string) => m.includes(CAPTCHA_PROVIDER_KEY)), true);

    const { errors: noSecret } = validateRuntimeEnv({
      ...base,
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(noSecret.some((m: string) => m.includes(TURNSTILE_SECRET_ENV_KEY)), true);
  });

  await check("production refuses the isolated test provider and its marker", () => {
    const { errors } = validateRuntimeEnv({
      NODE_ENV: "production",
      ATA_ENVIRONMENT: "production",
      APP_URL: "https://academy.example.invalid",
      DATABASE_URL: "file:./x.sqlite",
      SESSION_SECRET: "x".repeat(48),
      [CAPTCHA_LOGIN_ENFORCED_KEY]: "true",
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
      [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
      [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(errors.some((m: string) => m.includes(TURNSTILE_TEST_PROVIDER)), true);
    assert.equal(errors.some((m: string) => m.includes(CAPTCHA_TEST_MODE_KEY)), true);
  });

  await check("the retired env action pin fails startup everywhere", () => {
    const { errors } = validateRuntimeEnv({
      NODE_ENV: "production",
      ATA_ENVIRONMENT: "dev",
      APP_URL: "https://127.0.0.1",
      DATABASE_URL: "file:./x.sqlite",
      SESSION_SECRET: "x".repeat(48),
      [TURNSTILE_EXPECTED_ACTION_KEY]: "academy_login",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(errors.some((m: string) => m.includes(TURNSTILE_EXPECTED_ACTION_KEY)), true);
  });

  await check("an unconfigured provider closes the login door rather than opening it", async () => {
    const result = await verifyCaptcha({
      purpose: "login",
      surface: ACADEMY_LOGIN_SURFACE,
      token: TOKEN,
      env: envFor({ [CAPTCHA_PROVIDER_KEY]: undefined, [TURNSTILE_SECRET_ENV_KEY]: undefined }),
    });
    assert.equal(!result.ok && result.outcome, "provider_misconfigured");
    assert.equal(!result.ok && result.code, "CAPTCHA_CONFIGURATION_ERROR");
  });

  await check("the isolated test provider still needs dev, the marker AND a dummy-shaped secret", () => {
    const dev = { ATA_ENVIRONMENT: "dev", APP_URL: "https://127.0.0.1" };
    const complete = resolveCaptchaConfig({
      ...dev,
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
      [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
      [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(complete.configured, true);

    const withoutMarker = resolveCaptchaConfig({
      ...dev,
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
      [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(withoutMarker.configured, false);

    const outsideDev = resolveCaptchaConfig({
      ATA_ENVIRONMENT: "production",
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
      [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
      [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(outsideDev.configured, false);
  });

  await check("enforcement follows the declared boundary and nothing else", () => {
    // An explicit dev box without the opt-in keeps the pre-AFD-3A2 behaviour.
    assert.equal(
      isCaptchaEnforced("login", { ATA_ENVIRONMENT: "dev" } as unknown as NodeJS.ProcessEnv),
      false,
    );
    assert.equal(isCaptchaEnforced("login", envFor()), true);
    assert.equal(
      isCaptchaEnforced("login", { ATA_ENVIRONMENT: "production" } as unknown as NodeJS.ProcessEnv),
      true,
    );
    // Registration is never governed by the login switch.
    assert.equal(
      isCaptchaEnforced("register", {
        ATA_ENVIRONMENT: "dev",
        [CAPTCHA_LOGIN_ENFORCED_KEY]: "false",
      } as unknown as NodeJS.ProcessEnv),
      true,
    );
  });

  // ============================================================ F. no leakage
  await check("no result carries the token, the secret or the provider's answer", async () => {
    const results = [];
    results.push(
      await verifyCaptcha({
        purpose: "login",
        surface: ACADEMY_LOGIN_SURFACE,
        token: TOKEN,
        env: envFor(),
        fetchImpl: solvedFor("academy_register").impl,
      }),
    );
    results.push(
      await verifyCaptcha({
        purpose: "login",
        surface: null,
        token: TOKEN,
        env: envFor(),
      }),
    );
    const serialized = JSON.stringify(results);
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes(REAL_SHAPED_SECRET), false);
    assert.equal(serialized.includes("academy.example.invalid"), false);
  });

  // ============================================ G. the source is sentinel-free
  await check("no forbidden sentinel survives in product source", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../src");

    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        // Comments are stripped first. A quoted sentinel in CODE is a value that
        // could be sent; the same word inside the prose that explains why it was
        // removed is documentation, and failing on that would make deleting the
        // explanation the cheapest way to pass — which is how a lesson gets
        // re-learned the hard way.
        const text = stripComments(await readFile(full, "utf8"));
        for (const sentinel of FORBIDDEN_SENTINELS) {
          for (const quoted of [`"${sentinel}"`, `'${sentinel}'`, `\`${sentinel}\``]) {
            if (text.includes(quoted)) offenders.push(`${full}: ${quoted}`);
          }
        }
      }
    }
    await walk(root);
    assert.deepEqual(offenders, [], `sentinel values found in source:\n${offenders.join("\n")}`);
  });

  await check("the login owner sends no captcha field of its own invention", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const route = await readFile(
      path.resolve(__dirname, "../../src/app/api/auth/login/route.ts"),
      "utf8",
    );
    // The token comes from the validated body and the surface from the header
    // resolver. Neither is defaulted.
    assert.equal(route.includes("token: parsed.data.captchaToken"), true);
    assert.equal(route.includes("resolveAuthSurface(request, \"login\")"), true);

    // Ordering is asserted inside the handler BODY, not the whole file: the
    // import block names every one of these identifiers first, so a naive
    // whole-file scan would compare import order and prove nothing.
    const bodyStart = route.indexOf("export async function POST");
    assert.notEqual(bodyStart, -1);
    const body = route.slice(bodyStart);
    const at = (needle: string) => {
      const index = body.indexOf(needle);
      assert.notEqual(index, -1, `${needle} is absent from the login handler`);
      return index;
    };
    assert.equal(
      at("verifyCaptcha(") < at("bcrypt.compare("),
      true,
      "the password is compared before the challenge is verified",
    );
    assert.equal(
      at("rateLimit(") < at("verifyCaptcha("),
      true,
      "the challenge is verified before the rate limit is applied",
    );
    assert.equal(
      at("getRequestIp(") < at("rateLimit("),
      true,
      "the rate limit is applied before the client IP is resolved",
    );
  });
}

main()
  .then(() => {
    console.log(`\nlogin turnstile regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    console.log(`\nlogin turnstile regression: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  });
