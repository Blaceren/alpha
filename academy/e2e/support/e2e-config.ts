/**
 * Resolved host/port configuration for the Academy Playwright suite.
 *
 * Single source of truth: `baseURL` and the `webServer.url` are both derived
 * from one resolution, so they cannot drift apart.
 *
 * WHY THIS EXISTS (TB-2 / TB1-PORT-02)
 * ------------------------------------
 * The suite previously hard-coded port 3100 with
 * `reuseExistingServer: !process.env.CI`. Port 3100 is now the live DEV Backend
 * port, and with `CI` unset that flag is `true` — so an uncontrolled
 * `npx playwright test` would find the DEV Backend already listening, attach to
 * it, and run the entire Academy suite against a completely different
 * application. Reuse now defaults to `false` and reserved ports are refused.
 */

/** Ports owned by live runtimes. Binding or reusing one would hit a real service. */
export const FORBIDDEN_PORTS = [3100, 3010, 3110, 3020] as const;

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3040;

/** Opt-in reuse of an already-running dev server. Never on by default. */
export const REUSE_ENV = "ACADEMY_E2E_REUSE_SERVER";
/** Deliberate escape hatch for a reserved port. Never on by default. */
export const EMERGENCY_OVERRIDE_ENV = "ACADEMY_E2E_ALLOW_RESERVED_PORTS";

export class AcademyE2EConfigError extends Error {}

/** Plain env-like record so object literals can be passed in tests. */
export type EnvSource = Record<string, string | undefined>;

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new AcademyE2EConfigError(`ACADEMY_E2E_PORT must be an integer port (received "${raw}").`);
  }
  const value = Number(raw.trim());
  if (value < 1 || value > 65535) {
    throw new AcademyE2EConfigError(`ACADEMY_E2E_PORT must be between 1 and 65535 (received ${value}).`);
  }
  return value;
}

export interface AcademyE2EConfig {
  host: string;
  port: number;
  baseURL: string;
  reuseExistingServer: boolean;
}

export function resolveAcademyE2EConfig(
  env: EnvSource = process.env,
): AcademyE2EConfig {
  const host = env.ACADEMY_E2E_HOST?.trim() || DEFAULT_HOST;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new AcademyE2EConfigError(
      `ACADEMY_E2E_HOST must be loopback (received "${host}"). The suite must never bind a public interface.`,
    );
  }

  const port = parsePort(env.ACADEMY_E2E_PORT, DEFAULT_PORT);

  if ((FORBIDDEN_PORTS as readonly number[]).includes(port) && env[EMERGENCY_OVERRIDE_ENV] !== "true") {
    throw new AcademyE2EConfigError(
      `ACADEMY_E2E_PORT=${port} is reserved by a live runtime (${FORBIDDEN_PORTS.join(", ")}). ` +
        `Reusing or binding it would drive the DEV runtime instead of the Academy. ` +
        `Set ${EMERGENCY_OVERRIDE_ENV}=true only if you have deliberately stopped it.`,
    );
  }

  // Reuse is opt-in and explicit. It previously defaulted to ON whenever CI was
  // unset, which is exactly how a local run could silently attach to DEV.
  const reuseExistingServer = env[REUSE_ENV] === "true";

  return { host, port, baseURL: `http://${host}:${port}`, reuseExistingServer };
}

export const ACADEMY_E2E = resolveAcademyE2EConfig();
