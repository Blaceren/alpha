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

/**
 * Stable codes MUST satisfy the Backend's canonical STABLE_CODE_PATTERN
 * (`^v2\.l(\d{3})\.[a-z0-9]+(?:-[a-z0-9]+)*$`). The content read route parses
 * the code with that pattern, so a non-conformant code (e.g. `level.002`) is
 * rejected as `level_not_accessible` before any content lookup happens.
 */
export const LEVELS = {
  l1: "v2.l001.otkrytie-scheta",
  l2: "v2.l002.kak-ustroen-put",
  l3: "v2.l003.pervyy-otchet",
  l4: "v2.l004.kontrolnaya-tochka",
} as const;

export function assertSafePorts(): void {
  for (const port of [ACADEMY_PORT, BACKEND_PORT]) {
    if ((FORBIDDEN_PORTS as readonly number[]).includes(port)) {
      throw new Error(`Refusing to run curriculum E2E against reserved live port ${port}.`);
    }
  }
}
