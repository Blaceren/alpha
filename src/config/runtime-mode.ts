/**
 * The CRM runtime mode contract — the one piece of runtime configuration that is
 * allowed to cross into the browser.
 *
 * "mock" and "api" are not secrets: they say which data boundary the app runs
 * against, nothing about where the backend lives. The resolved value travels
 * from the server layout to client components as an ordinary serializable prop.
 *
 * This module deliberately reads NO environment. Reading env is the job of
 * `@/config/server-runtime`, which is server-only. Keeping the type here lets a
 * client component name the mode without pulling a server module into the bundle.
 */

export const CRM_RUNTIME_MODES = ["mock", "api"] as const;

export type CrmRuntimeMode = (typeof CRM_RUNTIME_MODES)[number];

export function isCrmRuntimeMode(value: unknown): value is CrmRuntimeMode {
  return typeof value === "string" && (CRM_RUNTIME_MODES as readonly string[]).includes(value);
}
