/**
 * Isolated CI-4 report E2E configuration. All ports are injected by
 * scripts/run-report-e2e.sh (scanned free loopback ports); NEVER the live DEV
 * runtime (3010/3050/3100/3199). The Backend is the RR-1 feature worktree run
 * against a fresh synthetic DB.
 */
export const HOST = "127.0.0.1";
export const ACADEMY_ON_PORT = Number(process.env.ACADEMY_RPT_ON_PORT ?? 0);
export const ACADEMY_OFF_PORT = Number(process.env.ACADEMY_RPT_OFF_PORT ?? 0);
export const ACADEMY_ON = `http://${HOST}:${ACADEMY_ON_PORT}`;
export const ACADEMY_OFF = `http://${HOST}:${ACADEMY_OFF_PORT}`;

export const FORBIDDEN_PORTS = [3010, 3050, 3100, 3199] as const;

export const L3 = "v2.l003.pervye-pyat-demo-sdelok";
export const L4 = "v2.l004.dnevnik-treydera";
export const PASSWORD = process.env.CI4_PASSWORD ?? "Test-Passw0rd";

export const LEARNER_DRAFT = "ci4-draft@e2e.test"; // Journeys A, B
export const LEARNER_SUBMIT = "ci4-submit@e2e.test"; // Journey C
export const LEARNER_REVISION = "ci4-revision@e2e.test"; // Journey D
export const LEARNER_APPROVE = "ci4-approve@e2e.test"; // Journey E
export const LEARNER_STALE = "ci4-stale@e2e.test"; // Journey G (stale revision)
export const LEARNER_DOUBLE = "ci4-double@e2e.test"; // Journey G (double submit)
export const LEARNER_OFF = "ci4-off@e2e.test"; // Journey F (flag disabled backend)

/** Every synthetic learner the harness must create (REPORT-ON DB). */
export const ON_LEARNERS = [LEARNER_DRAFT, LEARNER_SUBMIT, LEARNER_REVISION, LEARNER_APPROVE, LEARNER_STALE, LEARNER_DOUBLE];

/** Protected, gitignored valid-values fixture emitted from the REAL definition. */
export const VALUES_FILE = process.env.CI4_VALUES ?? "test-results/report-e2e/values.json";

/** Wrapper script (in backend/tmp) that runs the backend fixture actor. */
export const ACTOR = process.env.CI4_ACTOR ?? "";

export function assertSafePorts(): void {
  for (const p of [ACADEMY_ON_PORT, ACADEMY_OFF_PORT]) {
    if (!p) throw new Error("report E2E ports not provided by harness");
    if ((FORBIDDEN_PORTS as readonly number[]).includes(p)) throw new Error(`Refusing reserved live port ${p}`);
  }
}
