/**
 * SERVER-ONLY runtime configuration.
 *
 * Never import this from a client component. It reads `CRM_MODE` and
 * `CRM_BACKEND_ORIGIN`, neither of which carries a NEXT_PUBLIC_ prefix, so
 * neither is inlined into the browser bundle. A server component reads the mode
 * here and passes the resolved `"mock" | "api"` string down as a prop; the
 * backend origin never leaves the server.
 *
 * Everything fails closed. There is no fallback to mock: a missing or unknown
 * CRM_MODE is a configuration error, because silently serving the synthetic
 * dataset when API mode was intended is precisely the failure this boundary
 * exists to prevent.
 */
import { z } from "zod";
import { CRM_RUNTIME_MODES, type CrmRuntimeMode } from "@/config/runtime-mode";
import { backendOriginErrorMessage, parseBackendOrigin } from "@/config/backend-origin";

export type ServerRuntimeConfig =
  | { mode: "mock" }
  | { mode: "api"; backendOrigin: string };

const ModeSchema = z.enum(CRM_RUNTIME_MODES);

export class CrmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmConfigurationError";
  }
}

/** Guard against a client bundle ever pulling this module in. */
function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new CrmConfigurationError(
      "server-runtime must not be imported from client code: it reads server-only environment.",
    );
  }
}

/**
 * Resolve the runtime configuration from an environment-like record.
 * Exported separately from `getServerRuntimeConfig` so tests can drive it
 * without mutating `process.env`.
 */
export function resolveServerRuntimeConfig(
  source: Record<string, string | undefined>,
): ServerRuntimeConfig {
  const parsedMode = ModeSchema.safeParse(source.CRM_MODE);
  if (!parsedMode.success) {
    const received = source.CRM_MODE === undefined ? "missing" : `"${source.CRM_MODE}"`;
    throw new CrmConfigurationError(
      `CRM_MODE must be exactly "mock" or "api" (received ${received}). ` +
        "There is no default: the CRM refuses to guess which data boundary it serves.",
    );
  }

  const mode: CrmRuntimeMode = parsedMode.data;

  // In mock mode the backend origin is ignored entirely — not read, not
  // validated — so a stale value in the environment cannot influence anything.
  if (mode === "mock") return { mode: "mock" };

  const origin = parseBackendOrigin(source.CRM_BACKEND_ORIGIN);
  if (!origin.ok) throw new CrmConfigurationError(backendOriginErrorMessage(origin.error));

  return { mode: "api", backendOrigin: origin.origin };
}

/** Read the validated runtime configuration from the real process environment. */
export function getServerRuntimeConfig(): ServerRuntimeConfig {
  assertServer();
  return resolveServerRuntimeConfig(process.env as Record<string, string | undefined>);
}

/**
 * The only value a client component may receive. Returning just the mode keeps
 * the backend origin structurally unable to reach a prop.
 */
export function getServerRuntimeMode(): CrmRuntimeMode {
  return getServerRuntimeConfig().mode;
}
