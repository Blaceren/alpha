/**
 * Academy runtime configuration contract (SERVER-ONLY).
 *
 * This module must never be imported from a Client Component. It resolves the
 * Backend origin and the Academy mode from server environment variables. The
 * Backend origin is deliberately NOT a `NEXT_PUBLIC_*` variable — the browser
 * only ever talks to the Academy same-origin proxy, never directly to Backend.
 *
 * CI-1 decisions:
 *  - mode is `fixture | api`;
 *  - `api` mode requires a valid Backend origin (fail-closed);
 *  - production must not silently fall back to `fixture`;
 *  - the origin may not carry credentials, a query string or a fragment;
 *  - plain `http://` is accepted only for loopback (dev/test); everything else
 *    must be `https://`.
 *
 * `resolveAcademyConfig` is a pure function of its inputs so it can be unit
 * tested without touching `process.env`. `getAcademyConfig` is the lazy runtime
 * accessor used by server code; it never runs at module-eval time, so a
 * misconfigured production environment fails at request time (fail-closed)
 * rather than breaking the build.
 */

export type AcademyMode = "fixture" | "api";

export type AcademyConfig = {
  mode: AcademyMode;
  /** Present only in `api` mode; always `null` in `fixture` mode. */
  backendOrigin: string | null;
  requestTimeoutMs: number;
  /**
   * The PUBLIC Cloudflare Turnstile site key (AFD-3A2), or `null` when none is
   * configured.
   *
   * Injected at runtime and passed down to the registration page as a prop
   * rather than compiled in as a `NEXT_PUBLIC_*` value, so one build serves
   * every deployment and rotating the widget is not a release.
   *
   * Absence is legal and fails CLOSED at the surface: the registration form
   * renders an unavailable state and blocks submission. It never means "skip
   * the challenge". The SECRET counterpart lives only in the Backend and is
   * deliberately unreadable from the Academy.
   */
  turnstileSiteKey: string | null;
};

export class AcademyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademyConfigError";
  }
}

export type EnvSource = Record<string, string | undefined>;

export type ResolveOptions = {
  /** Defaults to `process.env.NODE_ENV === "production"`. */
  isProduction?: boolean;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function resolveTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(raw.trim())) {
    throw new AcademyConfigError(
      `ACADEMY_REQUEST_TIMEOUT_MS must be a positive integer (received "${raw}").`,
    );
  }
  const value = Number(raw.trim());
  if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new AcademyConfigError(
      `ACADEMY_REQUEST_TIMEOUT_MS must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} (received ${value}).`,
    );
  }
  return value;
}

/**
 * Validate and normalize a Backend origin. Returns the canonical
 * `scheme://host[:port]` form (no trailing slash, no path/query/fragment).
 */
export function normalizeBackendOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new AcademyConfigError("BACKEND_ORIGIN must not be empty in api mode.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AcademyConfigError(`BACKEND_ORIGIN is not a valid absolute URL ("${trimmed}").`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AcademyConfigError(
      `BACKEND_ORIGIN must use http or https (received "${url.protocol}").`,
    );
  }

  if (url.username !== "" || url.password !== "") {
    throw new AcademyConfigError("BACKEND_ORIGIN must not contain credentials.");
  }

  if (url.search !== "" || url.hash !== "") {
    throw new AcademyConfigError("BACKEND_ORIGIN must not contain a query string or fragment.");
  }

  if (url.pathname !== "" && url.pathname !== "/") {
    throw new AcademyConfigError("BACKEND_ORIGIN must not contain a path.");
  }

  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AcademyConfigError(
      `BACKEND_ORIGIN may only use plain http for loopback hosts (received host "${url.hostname}"). ` +
        `Use https for non-loopback origins.`,
    );
  }

  // `url.origin` is the canonical scheme://host[:port] with no trailing slash.
  return url.origin;
}

export function resolveAcademyConfig(
  env: EnvSource,
  options: ResolveOptions = {},
): AcademyConfig {
  const isProduction = options.isProduction ?? env.NODE_ENV === "production";
  const rawMode = env.ACADEMY_MODE?.trim();

  let mode: AcademyMode;
  if (rawMode === "api" || rawMode === "fixture") {
    mode = rawMode;
  } else if (rawMode === undefined || rawMode === "") {
    // Missing mode: dev/test may default to fixture, production must not.
    if (isProduction) {
      throw new AcademyConfigError(
        "ACADEMY_MODE must be set explicitly in production (fixture | api). " +
          "Production must not silently fall back to fixture mode.",
      );
    }
    mode = "fixture";
  } else {
    throw new AcademyConfigError(`ACADEMY_MODE must be "fixture" or "api" (received "${rawMode}").`);
  }

  const requestTimeoutMs = resolveTimeout(env.ACADEMY_REQUEST_TIMEOUT_MS);
  // Deliberately NOT validated here. An absent or malformed key must not stop
  // the Academy from serving its other 40 routes over one registration widget;
  // the registration surface itself refuses to submit. See
  // `resolveCaptchaContract`, which classifies absent and malformed separately.
  const rawSiteKey = env.TURNSTILE_SITE_KEY?.trim();
  const turnstileSiteKey = rawSiteKey === undefined || rawSiteKey === "" ? null : rawSiteKey;

  if (mode === "fixture") {
    return { mode, backendOrigin: null, requestTimeoutMs, turnstileSiteKey };
  }

  // api mode: Backend origin is mandatory (fail-closed).
  const rawOrigin = env.BACKEND_ORIGIN;
  if (rawOrigin === undefined || rawOrigin.trim() === "") {
    throw new AcademyConfigError(
      "BACKEND_ORIGIN is required when ACADEMY_MODE=api. Refusing to start api mode without a Backend origin.",
    );
  }

  return {
    mode,
    backendOrigin: normalizeBackendOrigin(rawOrigin),
    requestTimeoutMs,
    turnstileSiteKey,
  };
}

let cached: AcademyConfig | null = null;

/**
 * Lazy server-side accessor. Resolves once per process. Throws
 * `AcademyConfigError` (fail-closed) if the environment is misconfigured.
 */
export function getAcademyConfig(): AcademyConfig {
  if (cached === null) {
    cached = resolveAcademyConfig(process.env as EnvSource);
  }
  return cached;
}

/** Test-only: clear the memoized config so a new env can be resolved. */
export function resetAcademyConfigCache(): void {
  cached = null;
}
