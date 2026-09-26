/**
 * Port/origin configuration for the REAL-BACKEND staff authentication E2E suite.
 *
 * This suite is different in kind from `tests-e2e-session`. That one proves the
 * session boundary against a deterministic stub selected by test cookies. This
 * one proves authentication against the **real backend source** running on an
 * isolated synthetic database, because a stub cannot prove that a password is
 * verified, that a signed session cookie survives the bridge, or that CSRF
 * double-submit actually holds.
 *
 * Consequences of using the real backend:
 *
 * - The backend is started and seeded OUTSIDE Playwright (it needs migrations and
 *   fixture identities), so it is not a `webServer` entry. The suite asserts it is
 *   reachable and fails loudly rather than silently testing nothing.
 * - Credentials come from the environment. They are never written into a spec,
 *   a snapshot or the audit — see `CA1_FIXTURE_PASSWORD`.
 *
 * The live runtime ports stay forbidden, for the same reason as in the session
 * suite: binding one would collide with a real service.
 */
import { FORBIDDEN_PORTS } from "../../tests-e2e-session/support/e2e-config";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_CRM_PORT = 3032;
export const DEFAULT_BACKEND_PORT = 3210;

export class AuthE2EConfigError extends Error {}

export type EnvSource = Record<string, string | undefined>;

function parsePort(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new AuthE2EConfigError(`${name} must be an integer port (received "${raw}").`);
  }
  const value = Number(raw.trim());
  if (value < 1 || value > 65535) {
    throw new AuthE2EConfigError(`${name} must be between 1 and 65535 (received ${value}).`);
  }
  if ((FORBIDDEN_PORTS as readonly number[]).includes(value)) {
    throw new AuthE2EConfigError(
      `${name}=${value} is reserved by a live runtime (${FORBIDDEN_PORTS.join(", ")}).`,
    );
  }
  return value;
}

export interface AuthE2EConfig {
  host: string;
  crmPort: number;
  backendPort: number;
  /** The CRM origin — the ONLY origin a browser in this suite may call. */
  baseURL: string;
  /** The isolated backend origin — must never appear in a browser request. */
  backendOrigin: string;
  /** Fixture credential. Required; the suite refuses to invent one. */
  password: string;
}

/** Synthetic fixture identities. Emails are non-routable by construction. */
export const FIXTURE = {
  mentor: "ca1.mentor@fixture.invalid",
  admin: "ca1.admin@fixture.invalid",
  learner: "ca1.learner@fixture.invalid",
  inactive: "ca1.inactive@fixture.invalid",
  support: "ca1.support@fixture.invalid",
  /** role=user but holds a StaffProfile — proves the two axes are independent. */
  userStaff: "ca1.userstaff@fixture.invalid",
  unknown: "ca1.nobody@fixture.invalid",
} as const;

/**
 * A pool of interchangeable active mentors, one per test that needs a login.
 *
 * The backend rate-limits login to 5 attempts per 10 minutes per (ip + email) and
 * counts FAILED attempts too. Reusing one address across the suite exhausts that
 * bucket, and later tests then see 429 where they expected a credential result.
 * The limit is hardcoded in the backend and this phase must not modify it, so the
 * suite spends a fresh address instead of trying to raise the ceiling.
 *
 * `nextMentor()` is deliberately not random: a deterministic sequence makes a
 * failing run reproducible.
 */
/**
 * Sized for BOTH spec files in one worker: Playwright shares this module, so the
 * cursor is consumed across every test in the run, not per file.
 */
export const POOL_SIZE = 60;

let poolCursor = 0;

export function nextMentor(): string {
  poolCursor += 1;
  if (poolCursor > POOL_SIZE) {
    throw new AuthE2EConfigError(
      `The mentor fixture pool (${POOL_SIZE}) is exhausted. Seed more identities rather than ` +
        "reusing one address, which would hit the backend login rate limit.",
    );
  }
  return `ca1.pool${String(poolCursor).padStart(2, "0")}@fixture.invalid`;
}

export function resolveAuthE2EConfig(env: EnvSource = process.env): AuthE2EConfig {
  const host = env.CA1_E2E_HOST?.trim() || DEFAULT_HOST;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new AuthE2EConfigError(
      `CA1_E2E_HOST must be loopback (received "${host}"). The suite must never bind a public interface.`,
    );
  }

  const crmPort = parsePort(env.CA1_E2E_CRM_PORT, DEFAULT_CRM_PORT, "CA1_E2E_CRM_PORT");
  const backendPort = parsePort(
    env.CA1_E2E_BACKEND_PORT,
    DEFAULT_BACKEND_PORT,
    "CA1_E2E_BACKEND_PORT",
  );

  if (crmPort === backendPort) {
    throw new AuthE2EConfigError(
      `CA1_E2E_CRM_PORT and CA1_E2E_BACKEND_PORT must differ (both ${crmPort}).`,
    );
  }

  const password = env.CA1_FIXTURE_PASSWORD;
  if (!password) {
    throw new AuthE2EConfigError(
      "CA1_FIXTURE_PASSWORD is required. Export it from the isolated fixture env; " +
        "the suite will not fabricate a credential.",
    );
  }

  return {
    host,
    crmPort,
    backendPort,
    baseURL: `http://${host}:${crmPort}`,
    backendOrigin: `http://${host}:${backendPort}`,
    password,
  };
}

export const AUTH_E2E = resolveAuthE2EConfig();

/** For leak assertions: the backend origin must never surface in the browser. */
export const BACKEND_PORT_TOKEN = String(AUTH_E2E.backendPort);
