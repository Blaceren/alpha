/**
 * Resolved port/origin configuration for the API-mode session E2E suite.
 *
 * Single source of truth. The Playwright config, the session-stub launch env and
 * every spec assertion read from here, so a port change can never leave a
 * hard-coded literal behind.
 *
 * WHY THIS EXISTS (TB-2 / TB1-F-002, TB1-PORT-01)
 * -----------------------------------------------
 * The suite previously hard-coded `CRM_PORT = 3010` and `STUB_PORT = 3110`.
 * Those are now the live DEV CRM port and the RI-1 candidate backend port, so
 * the suite could not run while the DEV runtime was up, and two specs asserted
 * the literal origin `http://127.0.0.1:3010/`.
 *
 * Equally important: several specs use the backend origin as a *leak canary*
 * (`expect(html).not.toContain("3110")`). If the stub port moved but those
 * literals did not, the canaries would still look for a port nothing uses and
 * would pass vacuously — a false green. They now derive from `BACKEND_ORIGIN`.
 */

/** Ports owned by live runtimes. Binding one would collide with a real service. */
export const FORBIDDEN_PORTS = [3100, 3010, 3110, 3020] as const;

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_CRM_PORT = 3031;
export const DEFAULT_STUB_PORT = 3211;

/**
 * Escape hatch for an operator who genuinely needs a reserved port (for example
 * reproducing a historical failure with the DEV runtime stopped). It must be an
 * explicit, deliberate act — never a default, and never silent.
 */
export const EMERGENCY_OVERRIDE_ENV = "CRM_E2E_ALLOW_RESERVED_PORTS";

export class E2EPortPolicyError extends Error {}

/** Matches the repo convention in `src/config/server-runtime.ts`. */
export type EnvSource = Record<string, string | undefined>;

function parsePort(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new E2EPortPolicyError(`${name} must be an integer port (received "${raw}").`);
  }
  const value = Number(raw.trim());
  if (value < 1 || value > 65535) {
    throw new E2EPortPolicyError(`${name} must be between 1 and 65535 (received ${value}).`);
  }
  return value;
}

function assertAllowed(port: number, name: string, env: EnvSource) {
  if (!(FORBIDDEN_PORTS as readonly number[]).includes(port)) return;
  if (env[EMERGENCY_OVERRIDE_ENV] === "true") return;
  throw new E2EPortPolicyError(
    `${name}=${port} is reserved by a live runtime (${FORBIDDEN_PORTS.join(", ")}). ` +
      `Running the suite there would collide with the DEV runtime. ` +
      `Set ${EMERGENCY_OVERRIDE_ENV}=true only if you have deliberately stopped it.`,
  );
}

export interface SessionE2EConfig {
  host: string;
  crmPort: number;
  stubPort: number;
  /** The CRM origin — the ONLY origin a browser in this suite should ever call. */
  baseURL: string;
  /** The stub origin — must never appear in a browser request or a response body. */
  backendOrigin: string;
}

export function resolveSessionE2EConfig(
  env: EnvSource = process.env,
): SessionE2EConfig {
  const host = env.CRM_E2E_HOST?.trim() || DEFAULT_HOST;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new E2EPortPolicyError(
      `CRM_E2E_HOST must be loopback (received "${host}"). The suite must never bind a public interface.`,
    );
  }

  const crmPort = parsePort(env.CRM_E2E_PORT, DEFAULT_CRM_PORT, "CRM_E2E_PORT");
  const stubPort = parsePort(env.CRM_E2E_STUB_PORT, DEFAULT_STUB_PORT, "CRM_E2E_STUB_PORT");

  assertAllowed(crmPort, "CRM_E2E_PORT", env);
  assertAllowed(stubPort, "CRM_E2E_STUB_PORT", env);

  if (crmPort === stubPort) {
    throw new E2EPortPolicyError(
      `CRM_E2E_PORT and CRM_E2E_STUB_PORT must differ (both ${crmPort}).`,
    );
  }

  return {
    host,
    crmPort,
    stubPort,
    baseURL: `http://${host}:${crmPort}`,
    backendOrigin: `http://${host}:${stubPort}`,
  };
}

/** The resolved config for the current process. */
export const SESSION_E2E = resolveSessionE2EConfig();

/**
 * The bare `host:port` of the stub, for leak assertions that check a response
 * body or URL does not disclose the backend origin.
 */
export const BACKEND_ORIGIN_HOSTPORT = `${SESSION_E2E.host}:${SESSION_E2E.stubPort}`;

/** The stub port as a string, for leak assertions that check the bare number. */
export const BACKEND_PORT_TOKEN = String(SESSION_E2E.stubPort);
