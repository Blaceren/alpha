/**
 * Isolated API-mode curriculum E2E configuration.
 *
 * Academy (api mode) on 3041 reading an ISOLATED Backend on 3213 with a
 * synthetic published curriculum (L1 completed, L2 available, L3 locked, L4
 * checkpoint-locked). Never the live DEV runtime.
 */
export const ACADEMY_PORT = Number(process.env.ACADEMY_CUR_E2E_PORT ?? 3041);
export const BACKEND_PORT = Number(process.env.ACADEMY_CUR_E2E_BACKEND_PORT ?? 3213);
export const HOST = "127.0.0.1";
export const ACADEMY_BASE_URL = `http://${HOST}:${ACADEMY_PORT}`;
export const BACKEND_ORIGIN = `http://${HOST}:${BACKEND_PORT}`;

export const FORBIDDEN_PORTS = [3100, 3010, 3110, 3020, 3200, 3300, 3400] as const;

export const LEARNER_EMAIL = process.env.ACADEMY_CUR_E2E_EMAIL ?? "learner@ci1.test";
export const LEARNER_PASSWORD = process.env.ACADEMY_CUR_E2E_PASSWORD ?? "Test-Passw0rd";

export const LEVELS = {
  l1: "level.001",
  l2: "level.002",
  l3: "level.003",
  l4: "level.004",
} as const;

export function assertSafePorts(): void {
  for (const port of [ACADEMY_PORT, BACKEND_PORT]) {
    if ((FORBIDDEN_PORTS as readonly number[]).includes(port)) {
      throw new Error(`Refusing to run curriculum E2E against reserved live port ${port}.`);
    }
  }
}
