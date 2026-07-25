/**
 * Isolated CI-3 assessment E2E configuration. All ports are injected by
 * scripts/run-assessment-e2e.sh (scanned free loopback ports); NEVER the live
 * DEV runtime (3010/3050/3100/3199).
 */
export const HOST = "127.0.0.1";
export const ACADEMY_ON_PORT = Number(process.env.ACADEMY_ASMT_ON_PORT ?? 0);
export const ACADEMY_OFF_PORT = Number(process.env.ACADEMY_ASMT_OFF_PORT ?? 0);
export const ACADEMY_ON = `http://${HOST}:${ACADEMY_ON_PORT}`;
export const ACADEMY_OFF = `http://${HOST}:${ACADEMY_OFF_PORT}`;

export const FORBIDDEN_PORTS = [3010, 3050, 3100, 3199] as const;

export const L2 = "v2.l002.kak-ustroen-alfa-trade-academy";
export const L3 = "v2.l003.pervye-pyat-demo-sdelok";
export const PASSWORD = "Test-Passw0rd";
export const LEARNER_A = "ci3-a@e2e.test"; // failed attempt + retry/pass
export const LEARNER_C = "ci3-c@e2e.test"; // double submit (fresh)
export const LEARNER_D = "ci3-d@e2e.test"; // flag-disabled backend

/** Path where the seed writes protected all-correct fixture answers (gitignored). */
export const ANSWERS_FILE = process.env.ACADEMY_ASMT_ANSWERS ?? "test-results/assessment-e2e/answers.json";

export function assertSafePorts(): void {
  for (const p of [ACADEMY_ON_PORT, ACADEMY_OFF_PORT]) {
    if (!p) throw new Error("assessment E2E ports not provided by harness");
    if ((FORBIDDEN_PORTS as readonly number[]).includes(p)) throw new Error(`Refusing reserved live port ${p}`);
  }
}
