/**
 * AFD-3A2 — the Cloudflare Turnstile provider contract.
 *
 * WHAT THIS SUITE PROVES
 * The old `verifyCaptcha` was a stub whose whole policy was
 * `CAPTCHA_DEV_BYPASS !== "false"`: bypass ON by default, ON for a MISSING
 * token, and ON for every typo of "false". This suite proves that door is shut
 * and cannot be reopened by configuration, by a token value, by a header, or by
 * a provider failure.
 *
 * NO SECRET, REAL OR DUMMY, APPEARS IN THIS FILE.
 * The production provider must refuse a placeholder and the test provider must
 * refuse a real credential, so both need to recognise Cloudflare's published
 * dummy keys. They are recognised by SHAPE (`hasOfficialTestKeyShape`), and the
 * fixtures below are built from that shape at run time rather than pasted in.
 * `POSTBACK_SECRET`, `SESSION_SECRET` and every Pocket credential are untouched
 * and unread.
 *
 * Siteverify is never actually called: every provider answer is injected
 * through the `fetchImpl` seam, so this suite makes no outbound request.
 */
import assert from "node:assert/strict";

import {
  CAPTCHA_LOGIN_ENFORCED_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_TEST_MODE_KEY,
  CAPTCHA_TEST_MODE_MARKER,
  TURNSTILE_EXPECTED_ACTION_KEY,
  TURNSTILE_EXPECTED_HOSTNAMES_KEY,
  TURNSTILE_SECRET_ENV_KEY,
  TURNSTILE_TEST_PROVIDER,
  TURNSTILE_PROVIDER,
  hasOfficialTestKeyShape,
  isCaptchaProviderRequired,
  resolveCaptchaConfig,
  type TurnstileConfig,
} from "../../src/lib/captcha/provider";
import {
  TURNSTILE_MAX_RESPONSE_BYTES,
  TURNSTILE_SITEVERIFY_URL,
  verifyTurnstileToken as verifyTurnstileTokenRaw,
  type VerifyTurnstileInput,
} from "../../src/lib/captcha/siteverify";
import { captchaPublicCode, requiresFreshToken } from "../../src/lib/captcha/outcome";
import { isCaptchaEnforced, verifyCaptcha } from "../../src/lib/captcha";
// AFD-3A3: every enforced verification now names its surface, which supplies the
// expected Turnstile action. This suite is the REGISTRATION contract, so it uses
// exactly one; the login surfaces and the cross-action refusals are covered by
// `loginTurnstileRegression.ts`.
import { ACADEMY_REGISTER_SURFACE } from "../../src/lib/captcha/surface";
import { validateRuntimeEnv, envContract } from "../../src/lib/env";

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

// ---------------------------------------------------------------------------
// Fixtures. Built from the documented SHAPE so no key value is committed.
// ---------------------------------------------------------------------------

/** A stand-in with Cloudflare's published dummy-secret shape. */
const TEST_SHAPED_SECRET = `9x${"0".repeat(31)}ZZ`;
/** A stand-in with the shape of a real secret. Not a real credential. */
const REAL_SHAPED_SECRET = "synthetic-turnstile-secret-not-a-real-key";
const TOKEN = "synthetic.dummy.token";

function devEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    ATA_ENVIRONMENT: "dev",
    APP_URL: "https://127.0.0.1",
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env as unknown as NodeJS.ProcessEnv;
}

function prodEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    ATA_ENVIRONMENT: "production",
    APP_URL: "https://academy.example.invalid",
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env as unknown as NodeJS.ProcessEnv;
}

function config(over: Partial<TurnstileConfig> = {}): TurnstileConfig {
  return {
    provider: TURNSTILE_PROVIDER,
    secret: REAL_SHAPED_SECRET,
    expectedHostnames: null,
    timeoutMs: 2_000,
    ...over,
  };
}

/**
 * AFD-3A3 — the action pin is no longer optional, so this suite needs a default.
 *
 * `verifyTurnstileToken` now REQUIRES an expected action (see
 * `captcha/surface.ts`). Every pre-existing case here predates that and cares
 * about some other property, so the wrapper supplies the registration action
 * unless a case names its own. Nothing is weakened: the comparison still runs on
 * every call, and the cases that exercise it set both sides explicitly.
 */
const SUITE_ACTION = ACADEMY_REGISTER_SURFACE.action;

function verifyTurnstileToken(
  input: Omit<VerifyTurnstileInput, "expectedAction"> & { expectedAction?: string },
) {
  return verifyTurnstileTokenRaw({ expectedAction: SUITE_ACTION, ...input });
}

/**
 * A Siteverify answer with the documented JSON content type.
 *
 * A SUCCESSFUL answer is stamped with `SUITE_ACTION` unless the case supplied
 * its own `action`, because a real Cloudflare answer for a widget-minted token
 * always carries one. Cases that need the action genuinely ABSENT use
 * `providerJsonExact`.
 */
function providerJson(body: unknown, status = 200) {
  let payload = body;
  if (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>).success === true &&
    !("action" in (body as Record<string, unknown>))
  ) {
    payload = { ...(body as Record<string, unknown>), action: SUITE_ACTION };
  }
  return providerJsonExact(payload, status);
}

/** The answer VERBATIM — no action is added. */
function providerJsonExact(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { url: string; init: { body: string; redirect: string; method: string } };

/** A fetch double that records the request and returns a canned answer. */
function stubFetch(responder: () => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const impl = async (url: string, init: { body: string; redirect: string; method: string }) => {
    calls.push({ url, init });
    return responder();
  };
  return { calls, impl: impl as never };
}

async function main() {
  // ======================================================= A. configuration
  await check("provider=turnstile with a real-shaped secret resolves", () => {
    const resolution = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      }),
    );
    assert.equal(resolution.configured, true);
    assert.equal(resolution.configured && resolution.config.provider, TURNSTILE_PROVIDER);
  });

  await check("absent provider is unconfigured, never a pass", () => {
    const resolution = resolveCaptchaConfig(devEnv());
    assert.equal(resolution.configured, false);
    assert.equal(!resolution.configured && resolution.reason, "provider_absent");
  });

  await check("missing secret under provider=turnstile is unconfigured", () => {
    const resolution = resolveCaptchaConfig(
      devEnv({ [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER }),
    );
    assert.equal(!resolution.configured && resolution.reason, "secret_absent");
  });

  await check("empty and whitespace secrets are invalid", () => {
    for (const value of ["", "   ", "\t"]) {
      const resolution = resolveCaptchaConfig(
        devEnv({ [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER, [TURNSTILE_SECRET_ENV_KEY]: value }),
      );
      assert.equal(resolution.configured, false, `empty secret ${JSON.stringify(value)} resolved`);
    }
  });

  await check("an unknown provider name is refused, never normalised", () => {
    for (const value of ["recaptcha", "Turnstile", " turnstile", "turnstile,dev", "dev"]) {
      const resolution = resolveCaptchaConfig(
        devEnv({
          [CAPTCHA_PROVIDER_KEY]: value,
          [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
        }),
      );
      assert.equal(resolution.configured, false, `provider ${JSON.stringify(value)} resolved`);
    }
  });

  await check("a placeholder secret is refused by the production provider", () => {
    assert.equal(hasOfficialTestKeyShape(TEST_SHAPED_SECRET), true);
    const resolution = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
      }),
    );
    assert.equal(!resolution.configured && resolution.reason, "secret_is_test_key");
  });

  await check("a real secret is refused by the test provider", () => {
    const resolution = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
        [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      }),
    );
    assert.equal(!resolution.configured && resolution.reason, "secret_is_not_test_key");
  });

  await check("AFD-3A3: a deployment-wide expected action is refused outright", () => {
    // One env-wide pin cannot be correct for three surfaces at once. Honouring
    // it would silently stop at least two of them distinguishing their own
    // tokens, so it is now a configuration REJECTION rather than an override —
    // the operator finds out at startup instead of never.
    for (const value of ["academy_register", "academy_login", "crm_login", "anything"]) {
      const resolution = resolveCaptchaConfig(
        devEnv({
          [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
          [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
          [TURNSTILE_EXPECTED_ACTION_KEY]: value,
        }),
      );
      assert.equal(resolution.configured, false, `${value} was accepted as an env pin`);
      assert.equal(!resolution.configured && resolution.reason, "expected_action_env_forbidden");
    }

    // Absent (and empty) remain the normal, configured case.
    const ok = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
        [TURNSTILE_EXPECTED_ACTION_KEY]: "",
      }),
    );
    assert.equal(ok.configured, true);
  });

  await check("one bad hostname invalidates the whole allow-list", () => {
    const ok = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
        [TURNSTILE_EXPECTED_HOSTNAMES_KEY]: "academy.example.invalid, Other.Example.Invalid",
      }),
    );
    assert.deepEqual(ok.configured && ok.config.expectedHostnames, [
      "academy.example.invalid",
      "other.example.invalid",
    ]);

    // Silently dropping the bad entry would widen an allow-list the operator
    // believed was narrow.
    const bad = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
        [TURNSTILE_EXPECTED_HOSTNAMES_KEY]: "academy.example.invalid, https://evil.example",
      }),
    );
    assert.equal(!bad.configured && bad.reason, "expected_hostnames_invalid");
  });

  // ================================================== B. no default bypass
  await check("CAPTCHA_DEV_BYPASS is gone from the environment contract", () => {
    assert.equal(
      (envContract.optional as readonly string[]).includes("CAPTCHA_DEV_BYPASS"),
      false,
      "the removed bypass key is still in the env contract",
    );
  });

  await check("setting the old bypass key grants nothing", async () => {
    const result = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env: devEnv({ CAPTCHA_DEV_BYPASS: "true" }),
    });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.outcome, "provider_misconfigured");
  });

  await check("registration is enforced even on an unclassified deployment", () => {
    for (const env of [devEnv(), prodEnv(), {} as NodeJS.ProcessEnv]) {
      assert.equal(isCaptchaEnforced("register", env), true);
    }
  });

  await check("an unconfigured provider closes registration rather than opening it", async () => {
    const result = await verifyCaptcha({ purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE, token: TOKEN, env: devEnv() });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "CAPTCHA_CONFIGURATION_ERROR");
  });

  await check("no token value is a magic pass", async () => {
    const env = devEnv({
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
      [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
    });
    const stub = stubFetch(() => providerJson({ success: false, "error-codes": ["invalid-input-response"] }));
    for (const token of ["test", "dev-captcha-ok", "true", "1", "bypass"]) {
      const result = await verifyCaptcha({ purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE, token, env, fetchImpl: stub.impl });
      assert.equal(result.ok, false, `token ${JSON.stringify(token)} passed`);
    }
  });

  await check("a missing token is refused before any provider call", async () => {
    const stub = stubFetch(() => providerJson({ success: true }));
    for (const token of [undefined, null, "", "   "]) {
      const result = await verifyCaptcha({
        purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
        token,
        env: devEnv({
          [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
          [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
        }),
        fetchImpl: stub.impl,
      });
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.outcome, "missing_token");
    }
    assert.equal(stub.calls.length, 0, "a missing token reached the provider");
  });

  // ================================================ C. test mode is explicit
  await check("the test provider requires the exact marker", () => {
    const noMarker = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
      }),
    );
    assert.equal(!noMarker.configured && noMarker.reason, "test_provider_marker_absent");

    const wrongMarker = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
        [CAPTCHA_TEST_MODE_KEY]: "true",
        [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
      }),
    );
    assert.equal(!wrongMarker.configured && wrongMarker.reason, "test_marker_malformed");
  });

  await check("the test provider is accepted only with every safeguard present", () => {
    const resolution = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
        [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
        [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
      }),
    );
    assert.equal(resolution.configured, true);
    assert.equal(resolution.configured && resolution.config.provider, TURNSTILE_TEST_PROVIDER);
  });

  await check("the test provider is refused outside ATA_ENVIRONMENT=dev", () => {
    for (const env of [
      prodEnv(),
      { ATA_ENVIRONMENT: "staging" } as unknown as NodeJS.ProcessEnv,
      {} as NodeJS.ProcessEnv,
      { ATA_ENVIRONMENT: "Dev" } as unknown as NodeJS.ProcessEnv,
    ]) {
      const merged = {
        ...env,
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
        [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
        [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
      } as unknown as NodeJS.ProcessEnv;
      const resolution = resolveCaptchaConfig(merged);
      assert.equal(!resolution.configured && resolution.reason, "test_provider_outside_dev");
    }
  });

  await check("the test marker is meaningless under the production provider", () => {
    const resolution = resolveCaptchaConfig(
      devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      }),
    );
    assert.equal(!resolution.configured && resolution.reason, "test_marker_malformed");
  });

  // ============================================ D. startup validation gates
  await check("a production deployment must have a working provider", () => {
    const result = validateRuntimeEnv(prodEnv());
    assert.equal(
      result.errors.some((e) => e.includes(CAPTCHA_PROVIDER_KEY)),
      true,
      `production accepted an absent provider: ${result.errors.join("; ")}`,
    );
  });

  await check("production refuses the isolated-test provider at startup", () => {
    const result = validateRuntimeEnv(
      prodEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_TEST_PROVIDER,
        [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
        [TURNSTILE_SECRET_ENV_KEY]: TEST_SHAPED_SECRET,
        [CAPTCHA_LOGIN_ENFORCED_KEY]: "true",
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(
      result.errors.some((e) => e.includes(TURNSTILE_TEST_PROVIDER)),
      true,
      `production accepted the test provider: ${result.errors.join("; ")}`,
    );
  });

  await check("production refuses the isolated-test marker at startup", () => {
    const result = validateRuntimeEnv(
      prodEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
        [CAPTCHA_TEST_MODE_KEY]: CAPTCHA_TEST_MODE_MARKER,
        [CAPTCHA_LOGIN_ENFORCED_KEY]: "true",
      }),
    );
    assert.equal(
      result.errors.some((e) => e.includes(CAPTCHA_TEST_MODE_KEY)),
      true,
      `production accepted the test marker: ${result.errors.join("; ")}`,
    );
  });

  await check("production must enforce login CAPTCHA too", () => {
    // This is what stops the bounded DEV login exception from ever becoming a
    // production bypass: such a deployment does not boot.
    const result = validateRuntimeEnv(
      prodEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      }),
    );
    assert.equal(
      result.errors.some((e) => e.includes(CAPTCHA_LOGIN_ENFORCED_KEY)),
      true,
      `production booted without login enforcement: ${result.errors.join("; ")}`,
    );
  });

  await check("only an explicit production/staging deployment is obliged", () => {
    // Deliberately NOT `unknown`. See the long comment on
    // `isCaptchaProviderRequired`: obliging unclassified hosts broke every
    // existing isolated harness, and buys nothing, because REGISTRATION is
    // verified unconditionally and still fails closed there.
    assert.equal(isCaptchaProviderRequired(prodEnv()), true);
    assert.equal(
      isCaptchaProviderRequired({ ATA_ENVIRONMENT: "staging" } as unknown as NodeJS.ProcessEnv),
      true,
    );
    assert.equal(isCaptchaProviderRequired(devEnv()), false);
    assert.equal(isCaptchaProviderRequired({} as NodeJS.ProcessEnv), false);
  });

  await check("an unclassified deployment still cannot register anyone", async () => {
    // The compensating guarantee for the line above: whatever the environment
    // says or fails to say, an unconfigured provider closes registration.
    const result = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env: {} as NodeJS.ProcessEnv,
    });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "CAPTCHA_CONFIGURATION_ERROR");
  });

  await check("an unclassified deployment starts, so isolated harnesses still work", () => {
    const result = validateRuntimeEnv({ APP_URL: "https://127.0.0.1" } as unknown as NodeJS.ProcessEnv);
    const captchaErrors = result.errors.filter(
      (e) => e.includes("CAPTCHA") || e.includes("TURNSTILE"),
    );
    assert.deepEqual(captchaErrors, [], `an unclassified server was refused: ${captchaErrors.join("; ")}`);
  });

  await check("a coherent production configuration passes CAPTCHA validation", () => {
    const result = validateRuntimeEnv(
      prodEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
        [CAPTCHA_LOGIN_ENFORCED_KEY]: "true",
      }),
    );
    const captchaErrors = result.errors.filter(
      (e) =>
        e.includes("CAPTCHA") || e.includes("TURNSTILE"),
    );
    assert.deepEqual(captchaErrors, [], `unexpected CAPTCHA errors: ${captchaErrors.join("; ")}`);
  });

  await check("a DEV deployment with no provider still starts", () => {
    // Absent configuration is legal in DEV and simply closes registration; it
    // must not brick the whole service.
    const result = validateRuntimeEnv(devEnv());
    const captchaErrors = result.errors.filter(
      (e) => e.includes("CAPTCHA") || e.includes("TURNSTILE"),
    );
    assert.deepEqual(captchaErrors, []);
  });

  await check("a DEV deployment with an INCOHERENT provider fails at startup", () => {
    // Naming a provider without a secret would boot and then 503 every
    // registration. Better to say so at deploy time.
    const result = validateRuntimeEnv(devEnv({ [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER }));
    assert.equal(
      result.errors.some((e) => e.includes(TURNSTILE_SECRET_ENV_KEY)),
      true,
      `an incoherent DEV provider booted: ${result.errors.join("; ")}`,
    );
  });

  // ================================================= E. Siteverify contract
  await check("the endpoint is the fixed official URL and is never derived", async () => {
    const stub = stubFetch(() => providerJson({ success: true }));
    await verifyTurnstileToken({ config: config(), token: TOKEN, fetchImpl: stub.impl });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0]?.url, TURNSTILE_SITEVERIFY_URL);
    assert.equal(TURNSTILE_SITEVERIFY_URL.startsWith("https://challenges.cloudflare.com/"), true);
  });

  await check("redirects are refused, never followed", async () => {
    const stub = stubFetch(() => providerJson({ success: true }));
    await verifyTurnstileToken({ config: config(), token: TOKEN, fetchImpl: stub.impl });
    // A 3xx would replay the SECRET at a host this platform never approved.
    assert.equal(stub.calls[0]?.init.redirect, "manual");

    const redirected = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      fetchImpl: stubFetch(() => new Response(null, { status: 302 })).impl,
    });
    assert.equal(redirected.kind, "malformed_provider_response");
  });

  await check("the secret and token are sent in the POST body only", async () => {
    const stub = stubFetch(() => providerJson({ success: true }));
    await verifyTurnstileToken({
      config: config({ secret: REAL_SHAPED_SECRET }),
      token: TOKEN,
      fetchImpl: stub.impl,
    });
    const call = stub.calls[0];
    assert.ok(call);
    assert.equal(call.init.method, "POST");
    assert.equal(call.url.includes(REAL_SHAPED_SECRET), false, "secret leaked into the URL");
    assert.equal(call.url.includes(TOKEN), false, "token leaked into the URL");
    const body = new URLSearchParams(call.init.body);
    assert.equal(body.get("secret"), REAL_SHAPED_SECRET);
    assert.equal(body.get("response"), TOKEN);
  });

  await check("a success answer verifies", async () => {
    const verdict = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      fetchImpl: stubFetch(() => providerJson({ success: true, hostname: "a.example" })).impl,
    });
    assert.deepEqual(verdict, { kind: "success" });
  });

  await check("documented error codes map onto distinct verdicts", async () => {
    const cases: Array<[string, string]> = [
      ["invalid-input-response", "invalid_token"],
      ["missing-input-response", "invalid_token"],
      ["bad-request", "invalid_token"],
      ["timeout-or-duplicate", "expired_or_duplicate"],
      ["invalid-input-secret", "provider_misconfigured"],
      ["missing-input-secret", "provider_misconfigured"],
      ["internal-error", "provider_unavailable"],
    ];
    for (const [code, expected] of cases) {
      const verdict = await verifyTurnstileToken({
        config: config(),
        token: TOKEN,
        fetchImpl: stubFetch(() => providerJson({ success: false, "error-codes": [code] })).impl,
      });
      assert.equal(verdict.kind, expected, `${code} produced ${verdict.kind}`);
    }
  });

  await check("an undocumented error code fails closed, never open", async () => {
    const verdict = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      fetchImpl: stubFetch(() => providerJson({ success: false, "error-codes": ["brand-new-code"] })).impl,
    });
    assert.equal(verdict.kind, "invalid_token");
  });

  await check("a non-boolean success field is malformed, not a pass", async () => {
    for (const success of ["true", 1, {}, null, undefined]) {
      const verdict = await verifyTurnstileToken({
        config: config(),
        token: TOKEN,
        fetchImpl: stubFetch(() => providerJson({ success })).impl,
      });
      assert.equal(
        verdict.kind,
        "malformed_provider_response",
        `success=${JSON.stringify(success)} produced ${verdict.kind}`,
      );
    }
  });

  await check("non-JSON, array and truncated bodies are malformed", async () => {
    const bodies: Array<() => Response> = [
      () => new Response("<html>error</html>", { status: 200, headers: { "content-type": "text/html" } }),
      () => providerJson([{ success: true }]),
      () => new Response("{\"success\": tr", { status: 200, headers: { "content-type": "application/json" } }),
      () => providerJson("success"),
    ];
    for (const responder of bodies) {
      const verdict = await verifyTurnstileToken({
        config: config(),
        token: TOKEN,
        fetchImpl: stubFetch(responder).impl,
      });
      assert.equal(verdict.kind, "malformed_provider_response", `got ${verdict.kind}`);
    }
  });

  await check("an oversized response is abandoned at the cap", async () => {
    const huge = JSON.stringify({ success: true, pad: "x".repeat(TURNSTILE_MAX_RESPONSE_BYTES + 1_000) });
    const verdict = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      fetchImpl: stubFetch(() => providerJson(JSON.parse(huge))).impl,
    });
    assert.equal(verdict.kind, "malformed_provider_response");
  });

  await check("an oversized TOKEN is refused before the provider is called", async () => {
    const stub = stubFetch(() => providerJson({ success: true }));
    const verdict = await verifyTurnstileToken({
      config: config(),
      token: "x".repeat(10_000),
      fetchImpl: stub.impl,
    });
    assert.equal(verdict.kind, "invalid_token");
    assert.equal(stub.calls.length, 0);
  });

  await check("HTTP statuses are classified without ever becoming a pass", async () => {
    const cases: Array<[number, string]> = [
      [408, "provider_timeout"],
      [429, "provider_unavailable"],
      [500, "provider_unavailable"],
      [503, "provider_unavailable"],
      [400, "provider_misconfigured"],
      [403, "provider_misconfigured"],
    ];
    for (const [status, expected] of cases) {
      const verdict = await verifyTurnstileToken({
        config: config(),
        token: TOKEN,
        fetchImpl: stubFetch(() => providerJson({ success: true }, status)).impl,
      });
      assert.equal(verdict.kind, expected, `status ${status} produced ${verdict.kind}`);
    }
  });

  await check("a timeout fails closed", async () => {
    const verdict = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      timeoutMs: 20,
      fetchImpl: (async (_url: string, init: { signal: AbortSignal }) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          init.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
        return providerJson({ success: true });
      }) as never,
    });
    assert.equal(verdict.kind, "provider_timeout");
  });

  await check("a connection failure fails closed", async () => {
    const verdict = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      fetchImpl: (() => Promise.reject(new Error(`connect ECONNREFUSED ${REAL_SHAPED_SECRET}`))) as never,
    });
    assert.equal(verdict.kind, "provider_unavailable");
  });

  await check("exactly one request is made — there is no retry", async () => {
    const stub = stubFetch(() => providerJson({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    await verifyTurnstileToken({ config: config(), token: TOKEN, fetchImpl: stub.impl });
    // Retrying a single-use token can only ever produce the same answer.
    assert.equal(stub.calls.length, 1);
  });

  // ============================================ F. our own post-checks
  await check("a hostname outside the allow-list is rejected", async () => {
    const verdict = await verifyTurnstileToken({
      config: config({ expectedHostnames: ["academy.example.invalid"] }),
      token: TOKEN,
      fetchImpl: stubFetch(() => providerJson({ success: true, hostname: "evil.example" })).impl,
    });
    assert.equal(verdict.kind, "hostname_mismatch");
  });

  await check("a hostname inside the allow-list is accepted, case-insensitively", async () => {
    const verdict = await verifyTurnstileToken({
      config: config({ expectedHostnames: ["academy.example.invalid"] }),
      token: TOKEN,
      fetchImpl: stubFetch(() => providerJson({ success: true, hostname: "Academy.Example.Invalid" })).impl,
    });
    assert.equal(verdict.kind, "success");
  });

  await check("an action mismatch is rejected, and an absent action is too", async () => {
    const mismatch = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      expectedAction: "academy_register",
      fetchImpl: stubFetch(() => providerJsonExact({ success: true, action: "login" })).impl,
    });
    assert.equal(mismatch.kind, "action_mismatch");

    const absent = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      expectedAction: "academy_register",
      fetchImpl: stubFetch(() => providerJsonExact({ success: true })).impl,
    });
    assert.equal(absent.kind, "action_mismatch");

    const match = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      expectedAction: "academy_register",
      fetchImpl: stubFetch(() => providerJsonExact({ success: true, action: "academy_register" })).impl,
    });
    assert.equal(match.kind, "success");
  });

  await check("AFD-3A3: the action comparison is unconditional — there is no unpinned call", async () => {
    // Before AFD-3A3 an unset pin meant "do not compare", so a genuine token
    // minted for ANY form passed everywhere. That branch no longer exists: the
    // parameter is required, and an answer carrying a foreign action fails even
    // though Cloudflare called the token genuine.
    const foreign = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      expectedAction: "crm_login",
      fetchImpl: stubFetch(() =>
        providerJsonExact({ success: true, action: "academy_login", hostname: "x.example" }),
      ).impl,
    });
    assert.equal(foreign.kind, "action_mismatch");
  });

  // ================================================ G. remote IP handling
  await check("the trusted resolved IP is sent as remoteip", async () => {
    const stub = stubFetch(() => providerJson({ success: true }));
    const request = new Request("https://academy.example.invalid/api/auth/register", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      request,
      env: devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      }),
      fetchImpl: stub.impl,
    });
    const body = new URLSearchParams(stub.calls[0]?.init.body ?? "");
    // Exactly the canonical resolver's answer — the first hop of the chain the
    // trusted ingress stamped, never a raw browser-controlled list.
    assert.equal(body.get("remoteip"), "203.0.113.9");
  });

  await check("only the FIRST forwarded hop is sent, never the whole chain", async () => {
    const stub = stubFetch(() => providerJson({ success: true }));
    const request = new Request("https://academy.example.invalid/api/auth/register", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1, 192.168.0.1" },
    });
    await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      request,
      env: devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      }),
      fetchImpl: stub.impl,
    });
    const body = new URLSearchParams(stub.calls[0]?.init.body ?? "");
    assert.equal(body.get("remoteip"), "203.0.113.9");
    assert.equal(body.get("remoteip")?.includes("10.0.0.1"), false);
  });

  await check("the 'unknown' sentinel is omitted rather than sent as a literal", async () => {
    const stub = stubFetch(() => providerJson({ success: true }));
    const request = new Request("https://academy.example.invalid/api/auth/register", { method: "POST" });
    await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      request,
      env: devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      }),
      fetchImpl: stub.impl,
    });
    const body = new URLSearchParams(stub.calls[0]?.init.body ?? "");
    assert.equal(body.has("remoteip"), false);
  });

  await check("an absent remoteip never fails the check", async () => {
    const verdict = await verifyTurnstileToken({
      config: config(),
      token: TOKEN,
      remoteIp: null,
      fetchImpl: stubFetch(() => providerJson({ success: true })).impl,
    });
    assert.equal(verdict.kind, "success");
  });

  // =========================================== H. nothing sensitive is logged
  await check("neither the token nor the secret is ever written to a log", async () => {
    const lines: string[] = [];
    const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    console.warn = console.log;
    console.error = console.log;
    console.info = console.log;
    try {
      const env = devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      });
      // Every branch: success, rejection, malformed, timeout, connection error.
      await verifyCaptcha({ purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE, token: TOKEN, env, fetchImpl: stubFetch(() => providerJson({ success: true })).impl });
      await verifyCaptcha({ purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE, token: TOKEN, env, fetchImpl: stubFetch(() => providerJson({ success: false, "error-codes": ["invalid-input-response"] })).impl });
      await verifyCaptcha({ purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE, token: TOKEN, env, fetchImpl: stubFetch(() => new Response("nope", { status: 200 })).impl });
      await verifyCaptcha({
        purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
        token: TOKEN,
        env,
        // A rejection carrying the secret in its message, as real `fetch`
        // rejections carry the request URL in `error.cause`.
        fetchImpl: (() => Promise.reject(new Error(`failed for ${REAL_SHAPED_SECRET} / ${TOKEN}`))) as never,
      });
    } finally {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
      console.info = originals.info;
    }
    const emitted = lines.join("\n");
    assert.equal(emitted.includes(TOKEN), false, "the token was logged");
    assert.equal(emitted.includes(REAL_SHAPED_SECRET), false, "the secret was logged");
  });

  await check("no failure result carries the token, the secret or a raw body", async () => {
    const env = devEnv({
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
      [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
    });
    const result = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env,
      fetchImpl: stubFetch(() => providerJson({ success: false, hostname: "leak.example", "error-codes": ["invalid-input-response"] })).impl,
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes(REAL_SHAPED_SECRET), false);
    assert.equal(serialized.includes("leak.example"), false);
    assert.equal(serialized.includes("invalid-input-response"), false);
  });

  // ================================================ I. public error contract
  await check("internal outcomes project onto exactly three public codes", () => {
    const expected: Array<[Parameters<typeof captchaPublicCode>[0], string]> = [
      ["missing_token", "CAPTCHA_FAILED"],
      ["invalid_token", "CAPTCHA_FAILED"],
      ["expired_or_duplicate", "CAPTCHA_FAILED"],
      ["hostname_mismatch", "CAPTCHA_FAILED"],
      ["action_mismatch", "CAPTCHA_FAILED"],
      ["provider_timeout", "CAPTCHA_UNAVAILABLE"],
      ["provider_unavailable", "CAPTCHA_UNAVAILABLE"],
      ["malformed_provider_response", "CAPTCHA_UNAVAILABLE"],
      ["provider_misconfigured", "CAPTCHA_CONFIGURATION_ERROR"],
      ["surface_unresolved", "CAPTCHA_CONFIGURATION_ERROR"],
    ];
    for (const [outcome, code] of expected) {
      assert.equal(captchaPublicCode(outcome), code, `${outcome} projected wrongly`);
    }
  });

  await check("a missing and an invalid secret are indistinguishable to a browser", async () => {
    const missing = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env: devEnv({ [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER }),
    });
    const invalid = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env: devEnv({
        [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
        [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
      }),
      fetchImpl: stubFetch(() => providerJson({ success: false, "error-codes": ["invalid-input-secret"] })).impl,
    });
    assert.equal(missing.ok, false);
    assert.equal(invalid.ok, false);
    // Probing must not tell an attacker which of the two is true.
    assert.equal(!missing.ok && missing.code, !invalid.ok && invalid.code);
    assert.equal(!missing.ok && missing.message, !invalid.ok && invalid.message);
  });

  await check("only a missing token leaves the widget alone; everything else renews", () => {
    assert.equal(requiresFreshToken("missing_token"), false);
    for (const outcome of [
      "invalid_token",
      "expired_or_duplicate",
      "provider_timeout",
      "provider_unavailable",
      "provider_misconfigured",
      "hostname_mismatch",
      "action_mismatch",
      "malformed_provider_response",
      "surface_unresolved",
    ] as const) {
      assert.equal(requiresFreshToken(outcome), true, `${outcome} did not renew`);
    }
  });

  await check("CAPTCHA_FAILED keeps status 400; unavailability is 503", async () => {
    const env = devEnv({
      [CAPTCHA_PROVIDER_KEY]: TURNSTILE_PROVIDER,
      [TURNSTILE_SECRET_ENV_KEY]: REAL_SHAPED_SECRET,
    });
    const rejected = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env,
      fetchImpl: stubFetch(() => providerJson({ success: false, "error-codes": ["invalid-input-response"] })).impl,
    });
    assert.equal(!rejected.ok && rejected.status, 400);

    const unavailable = await verifyCaptcha({
      purpose: "register",
      surface: ACADEMY_REGISTER_SURFACE,
      token: TOKEN,
      env,
      fetchImpl: stubFetch(() => providerJson({ success: true }, 503)).impl,
    });
    assert.equal(!unavailable.ok && unavailable.status, 503);
  });

  // ============================================= J. the bounded DEV login gap
  await check("login verification follows the same production/staging boundary", () => {
    assert.equal(isCaptchaEnforced("login", devEnv()), false);
    assert.equal(isCaptchaEnforced("login", prodEnv()), true);
    assert.equal(
      isCaptchaEnforced("login", { ATA_ENVIRONMENT: "staging" } as unknown as NodeJS.ProcessEnv),
      true,
    );
    // An unclassified isolated harness keeps the pre-AFD-3A2 login behaviour.
    assert.equal(isCaptchaEnforced("login", {} as NodeJS.ProcessEnv), false);
    // And any deployment may opt in explicitly.
    assert.equal(
      isCaptchaEnforced("login", devEnv({ [CAPTCHA_LOGIN_ENFORCED_KEY]: "true" })),
      true,
    );
  });

  await check("registration is never covered by the login exception", () => {
    assert.equal(isCaptchaEnforced("register", devEnv()), true);
    assert.equal(
      isCaptchaEnforced("register", devEnv({ [CAPTCHA_LOGIN_ENFORCED_KEY]: "false" })),
      true,
    );
  });
}

main()
  .then(() => {
    console.log(`\ncaptcha turnstile regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    console.log(`\ncaptcha turnstile regression: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  });
