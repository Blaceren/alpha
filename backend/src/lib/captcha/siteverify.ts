/**
 * AFD-3A2 — the Cloudflare Turnstile Siteverify client.
 *
 * THIS FILE IS THE TRUST BOUNDARY FOR THE CHALLENGE.
 * The browser widget is decoration. A token in a request body proves nothing
 * until Cloudflare says so, and this module is the only place that asks. It
 * takes a token in and returns a VERDICT out; the token, the secret and the
 * provider's raw answer all go out of scope here and reach nothing downstream.
 *
 * WHAT NEVER LEAVES THIS MODULE
 *   - the secret;
 *   - the token (not on success, not on failure, not truncated, not hashed);
 *   - the resolved client IP;
 *   - the raw response body;
 *   - the caught exception object.
 * Consequently NOTHING here is logged. `fetch` rejections routinely carry the
 * request in `error.cause`, so thrown values are classified by shape and then
 * dropped — never stringified, never re-thrown, never attached to a result.
 *
 * FAIL CLOSED, ALWAYS.
 * A timeout, a malformed body, a redirect, an oversized payload and an HTTP 500
 * are all NOT-VERIFIED. There is no branch in which uncertainty becomes
 * success, and there is no retry: retrying a single-use token can only produce
 * `timeout-or-duplicate`, and retrying a failing provider only amplifies it.
 */
import { TURNSTILE_TEST_PROVIDER, type TurnstileConfig } from "./provider";

/** The fixed, official endpoint. Never overridable, never caller-derived. */
export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Hard ceiling on the response body. A Siteverify answer is a few hundred bytes. */
export const TURNSTILE_MAX_RESPONSE_BYTES = 16 * 1024;

/**
 * Cloudflare's longest documented token is well under this. The cap exists so a
 * megabyte of junk in the `captchaToken` field is refused locally instead of
 * being uploaded to Cloudflare on every attempt.
 */
export const TURNSTILE_MAX_TOKEN_BYTES = 4_096;

/**
 * The complete answer this module gives. Note what is absent: there is no field
 * the token, the secret or the raw body could occupy, in any branch.
 */
export type TurnstileVerdict =
  | { readonly kind: "success" }
  /** The token is absent, malformed, expired or was issued for another site. */
  | { readonly kind: "invalid_token" }
  /** Single-use token replayed, or the interactive challenge timed out. */
  | { readonly kind: "expired_or_duplicate" }
  /** OUR credential is wrong, revoked or missing. A platform fault. */
  | { readonly kind: "provider_misconfigured" }
  /** The provider did not answer within the budget. */
  | { readonly kind: "provider_timeout" }
  /** The provider answered, but not usefully: 5xx, connection failure. */
  | { readonly kind: "provider_unavailable" }
  /** A 2xx whose body was not the documented contract. */
  | { readonly kind: "malformed_provider_response" }
  /** Verified, but solved on a hostname this deployment did not authorise. */
  | { readonly kind: "hostname_mismatch" }
  /** Verified, but carrying an action this surface did not ask for. */
  | { readonly kind: "action_mismatch" };

/** Injectable purely so tests can drive the client without a global stub. */
export type SiteverifyFetch = (
  url: string,
  init: {
    method: string;
    redirect: "manual";
    signal: AbortSignal;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<Response>;

export type VerifyTurnstileInput = {
  readonly config: TurnstileConfig;
  /** The raw browser-supplied token. Never logged from here on. */
  readonly token: string;
  /**
   * The action THIS surface's widget stamps (AFD-3A3). Source-owned — it comes
   * from `captcha/surface.ts`, never from the environment and never from the
   * caller's request. Required: there is no unpinned call site left, and making
   * it optional would reintroduce the "one valid token opens every form"
   * behaviour this parameter exists to end.
   */
  readonly expectedAction: string;
  /**
   * The resolved client IP, or `null`. Optional in Cloudflare's contract and
   * optional here: an absent IP weakens the signal, it never fails the check.
   */
  readonly remoteIp?: string | null;
  /** Overrides the config budget. Used only by tests. */
  readonly timeoutMs?: number;
  readonly fetchImpl?: SiteverifyFetch;
};

/**
 * Cloudflare's documented `error-codes`, mapped onto verdicts.
 *
 * `invalid-input-secret` and `missing-input-secret` are OUR fault, not the
 * visitor's, and must never read as a failed challenge — the caller turns them
 * into a configuration error so a misconfigured deployment is visibly broken
 * rather than quietly rejecting every honest registration as a bot.
 */
function verdictForErrorCodes(codes: readonly string[]): TurnstileVerdict {
  if (codes.includes("timeout-or-duplicate")) return { kind: "expired_or_duplicate" };
  if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) {
    return { kind: "provider_misconfigured" };
  }
  if (codes.includes("internal-error")) return { kind: "provider_unavailable" };
  // `invalid-input-response`, `missing-input-response`, `bad-request` and
  // anything undocumented all mean the same thing to the caller: this token did
  // not verify. Unknown codes deliberately land here rather than on success.
  return { kind: "invalid_token" };
}

/**
 * Ask Cloudflare whether one token is genuine.
 *
 * Exactly ONE request is made, under one deadline, with redirects refused.
 */
export async function verifyTurnstileToken(
  input: VerifyTurnstileInput,
): Promise<TurnstileVerdict> {
  const token = input.token;

  // Refused locally: an empty or absurd token cannot be genuine, and sending it
  // would spend a provider round trip and an upstream rate-limit slot.
  if (token.length === 0) return { kind: "invalid_token" };
  if (Buffer.byteLength(token, "utf8") > TURNSTILE_MAX_TOKEN_BYTES) {
    return { kind: "invalid_token" };
  }

  const body = new URLSearchParams();
  body.set("secret", input.config.secret);
  body.set("response", token);
  // Cloudflare's contract accepts a bare IPv4/IPv6 address. `getRequestIp` can
  // answer the sentinel `"unknown"`, which is not an address, so it is omitted
  // rather than sent as a literal — a bogus value would weaken the signal on
  // Cloudflare's side for no gain.
  const remoteIp = input.remoteIp;
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? input.config.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as SiteverifyFetch);
    response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      // A 3xx would replay the SECRET at a host this platform never approved.
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (error) {
    // Classified by shape only. Never inspected for a message, never logged:
    // the rejection can embed the request, and the request contains the secret.
    return isAbortError(error)
      ? { kind: "provider_timeout" }
      : { kind: "provider_unavailable" };
  } finally {
    clearTimeout(timer);
  }

  const statusVerdict = classifyHttpStatus(response);
  if (statusVerdict) return statusVerdict;

  const payload = await readBoundedJson(response);
  if (payload === null) return { kind: "malformed_provider_response" };

  return evaluatePayload(payload, input.config, input.expectedAction);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Map the HTTP status onto a verdict, or `null` when the body should be read.
 *
 * Infrastructure failure NEVER becomes `invalid_token`. "We could not find out"
 * and "this visitor failed the challenge" are different facts, and conflating
 * them would turn a Cloudflare outage into a wall of accusatory bot warnings
 * for people who did nothing wrong.
 */
function classifyHttpStatus(response: Response): TurnstileVerdict | null {
  const status = response.status;

  if (response.type === "opaqueredirect" || (status >= 300 && status < 400)) {
    return { kind: "malformed_provider_response" };
  }

  if (status === 200) {
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    // A 200 that is not JSON is not the documented contract — an HTML error
    // page or a captive-portal login body must never be parsed hopefully.
    return contentType.includes("application/json") ? null : { kind: "malformed_provider_response" };
  }

  if (status === 408) return { kind: "provider_timeout" };
  if (status === 429) return { kind: "provider_unavailable" };
  if (status >= 500 && status <= 599) return { kind: "provider_unavailable" };
  // 4xx from Siteverify means we sent something the API refused. That is a
  // platform fault, not a visitor fault.
  if (status >= 400) return { kind: "provider_misconfigured" };

  return { kind: "malformed_provider_response" };
}

/**
 * Read at most `TURNSTILE_MAX_RESPONSE_BYTES` and parse strictly.
 *
 * Streamed with a running byte count rather than buffered whole, so an
 * oversized or endless response is abandoned at the cap instead of consuming
 * memory. Anything that is not a plain JSON object collapses to `null`, and the
 * offending text is never carried into an error.
 */
async function readBoundedJson(response: Response): Promise<Record<string, unknown> | null> {
  let text: string;

  try {
    const stream = response.body;
    if (!stream) {
      text = await response.text();
      if (Buffer.byteLength(text, "utf8") > TURNSTILE_MAX_RESPONSE_BYTES) return null;
    } else {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > TURNSTILE_MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
      text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    }
  } catch {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Turn a well-formed Siteverify document into a verdict.
 *
 * `success` must be a real boolean. A truthy string, a 1, or an absent field is
 * a malformed response, not a pass — this is the single most important line in
 * the file, because every other check is downstream of it.
 */
function evaluatePayload(
  payload: Record<string, unknown>,
  config: TurnstileConfig,
  expectedAction: string,
): TurnstileVerdict {
  const success = payload.success;
  if (typeof success !== "boolean") return { kind: "malformed_provider_response" };

  if (!success) {
    const raw = payload["error-codes"];
    if (raw !== undefined && !Array.isArray(raw)) return { kind: "malformed_provider_response" };
    const codes = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    return verdictForErrorCodes(codes);
  }

  // Cloudflare said yes. The remaining checks are OURS: a valid token minted for
  // a different site or a different form on this site is still not a token for
  // THIS submission.
  if (config.expectedHostnames) {
    const hostname = payload.hostname;
    if (typeof hostname !== "string") return { kind: "malformed_provider_response" };
    if (!config.expectedHostnames.includes(hostname.toLowerCase())) {
      return { kind: "hostname_mismatch" };
    }
  }

  // AFD-3A3: the action pin. A token minted by the registration widget carries
  // `academy_register` and is REFUSED by the login owner even though Cloudflare
  // called it genuine, because it is genuine evidence about a different form.
  const action = payload.action;
  if (typeof action === "string") {
    // A stated action that disagrees is refused under EVERY provider. This is
    // the property the pin exists for and it has no exception.
    return action === expectedAction ? { kind: "success" } : { kind: "action_mismatch" };
  }

  // No action stated. Normally that is a mismatch, not a pass: the comparison
  // was required and could not be made. It is also what stops a hand-crafted
  // token from being waved through by a permissive secret.
  //
  // The ONE exception is Cloudflare's own testing keys, which cannot carry an
  // action: the "token" they mint is a fixed literal that encodes nothing, so
  // Cloudflare has nothing to echo. Verified against the live endpoint — the
  // answer is `{success: true, hostname: "example.com", metadata:
  // {result_with_testing_key: true}}` with no `action` at any time.
  //
  // Refusing there would not make anything safer; it would make the isolated
  // test provider incapable of ever succeeding, which means the end-to-end
  // login flow could not be exercised at all before a deployment.
  //
  // The exception is bounded by TWO independent facts, not by a policy switch:
  //
  //   1. the deployment must have named the isolated test provider — already
  //      gated on `ATA_ENVIRONMENT=dev`, an explicit opt-in marker and a
  //      dummy-shaped secret, and refused at startup on production/staging;
  //   2. CLOUDFLARE must itself declare the answer came from a testing key.
  //
  // A real secret cannot produce that marker, so this branch is unreachable on
  // any deployment holding a genuine credential.
  return isTestingKeyAnswer(payload, config) ? { kind: "success" } : { kind: "action_mismatch" };
}

/** Did Cloudflare mark this answer as produced by one of its testing keys? */
function isTestingKeyAnswer(
  payload: Record<string, unknown>,
  config: TurnstileConfig,
): boolean {
  if (config.provider !== TURNSTILE_TEST_PROVIDER) return false;
  const metadata = payload.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return false;
  // A real boolean only. A truthy string or a 1 is not Cloudflare's contract,
  // and treating one as the marker would be the beginning of a bypass.
  return (metadata as Record<string, unknown>).result_with_testing_key === true;
}
