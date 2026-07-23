/**
 * Configuration for the isolated authentication E2E.
 *
 * This suite runs the Academy in `api` mode against an ISOLATED Backend (a
 * synthetic SQLite DB, a synthetic learner, a synthetic session secret, Pocket
 * disabled, Curriculum V2 absent). It must never touch the live DEV runtime:
 * the forbidden-port guard refuses 3100/3010 (and the other reserved ports).
 */
export const ACADEMY_PORT = Number(process.env.ACADEMY_AUTH_E2E_PORT ?? 3040);
export const BACKEND_PORT = Number(process.env.ACADEMY_AUTH_E2E_BACKEND_PORT ?? 3212);
export const HOST = "127.0.0.1";

export const ACADEMY_BASE_URL = `http://${HOST}:${ACADEMY_PORT}`;
export const BACKEND_ORIGIN = `http://${HOST}:${BACKEND_PORT}`;

/** Ports owned by live runtimes — binding or reusing one would hit a real service. */
export const FORBIDDEN_PORTS = [3100, 3010, 3110, 3020, 3200, 3300, 3400] as const;

export const LEARNER_EMAIL = process.env.ACADEMY_AUTH_E2E_EMAIL ?? "learner@ci1.test";
export const LEARNER_PASSWORD = process.env.ACADEMY_AUTH_E2E_PASSWORD ?? "Test-Passw0rd";
/** A wrong password that still passes the Backend's min-length validation (hits the real 401). */
export const WRONG_PASSWORD = "definitely-not-correct-1";

export function assertSafePorts(): void {
  for (const port of [ACADEMY_PORT, BACKEND_PORT]) {
    if ((FORBIDDEN_PORTS as readonly number[]).includes(port)) {
      throw new Error(
        `Refusing to run the auth E2E against reserved live-runtime port ${port}. ` +
          `Allowed: Academy ${ACADEMY_PORT}, Backend ${BACKEND_PORT}.`,
      );
    }
  }
}
