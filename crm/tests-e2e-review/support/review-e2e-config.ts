/**
 * Config for the MR-1R real-backend review E2E suite.
 *
 * Runs the CRM against the RR-1 Backend source on a fresh synthetic
 * migration-34 database carrying the operator-approved revision 3. A stub could
 * not prove any of what matters here: that the reviewer gate actually refuses
 * `support`, that approval really completes L3 with no XPTransaction, or that a
 * replayed idempotency key returns the same receipt.
 *
 * RF-1: the database, the backend process and the manifest are all created by
 * `global-setup.ts` and destroyed by `global-teardown.ts`. Nothing is inherited
 * from a previous run and nothing is repaired by hand, so a second run of this
 * suite starts from exactly the state the first one did.
 */
import fs from "node:fs";
import { FORBIDDEN_PORTS } from "../../tests-e2e-session/support/e2e-config";
import { ADMIN_POOL_SIZE, FIXTURE, MENTOR_POOL_SIZE, pooledAdmin, pooledMentor } from "../fixture/identities";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_CRM_PORT = 3033;
export const DEFAULT_BACKEND_PORT = 3220;

/** Where global setup publishes the run directory for the workers it forks. */
export const RUN_DIR_ENV = "MR1R_RUN_DIR";

export class ReviewE2EConfigError extends Error {}

function parsePort(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new ReviewE2EConfigError(`${name} must be an integer port`);
  const value = Number(raw.trim());
  if ((FORBIDDEN_PORTS as readonly number[]).includes(value)) {
    throw new ReviewE2EConfigError(`${name}=${value} is reserved by a live runtime`);
  }
  return value;
}

export { FIXTURE, MENTOR_POOL_SIZE, ADMIN_POOL_SIZE };

/**
 * The reviewer that carries the Learner A chain (inspect → revision request →
 * approve the corrected revision).
 *
 * A claim belongs to ONE reviewer: the Backend releases the report payload only to
 * the holder of the active claim. So a journey that claims in one test and decides
 * in the next MUST reuse the same identity, or the second test sees
 * `access: "summary"` with no payload. Pooled identities are for INDEPENDENT tests.
 */
export const CHAIN_MENTOR = FIXTURE.mentor;

/* ------------------------------------------------------ pooled reviewers */

/**
 * Pooled reviewers, allocated deterministically from the test's own name.
 *
 * The Backend rate-limits login to 5 attempts per 10 minutes per (ip + email), so
 * an identity must not be spent by many tests. Until RF-1 the pool was handed out
 * by a module-level cursor, which looked correct only while every test passed:
 * Playwright tears the worker process down after a failure, the module reloads,
 * the cursor resets to zero, and every subsequent test logs in as `pm01` until the
 * limiter answers 429. One genuine failure therefore manufactured several more.
 *
 * Deriving the slot from the test's own title removes the shared mutable state
 * entirely. The same test gets the same identity whatever ran before it, whether
 * the worker was just restarted, and whether this is a first attempt or a retry —
 * so an allocation can no longer depend on run order, and a retry cannot consume
 * an identity that belongs to another test.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Calls made by the SAME test get consecutive slots: Journey I needs two distinct reviewers. */
const callsPerTest = new Map<string, number>();

function allocate(testKey: string, poolSize: number): number {
  const seen = callsPerTest.get(testKey) ?? 0;
  callsPerTest.set(testKey, seen + 1);
  return ((fnv1a(testKey) + seen) % poolSize) + 1;
}

export interface TestIdentity {
  /** Stable per-test key, normally `testInfo.titlePath.join(" › ")`. */
  titleKey: string;
}

export function mentorFor(test: TestIdentity): string {
  return pooledMentor(allocate(`m:${test.titleKey}`, MENTOR_POOL_SIZE));
}

export function adminFor(test: TestIdentity): string {
  return pooledAdmin(allocate(`a:${test.titleKey}`, ADMIN_POOL_SIZE));
}

/* --------------------------------------------------------------- resolution */

export interface ReviewE2EConfig {
  host: string;
  crmPort: number;
  backendPort: number;
  baseURL: string;
  backendOrigin: string;
  password: string;
  /** Directory holding the isolated fixture env and this run's `runs/<id>` tree. */
  fixtureDir: string;
  /** Isolated backend env file, kept outside the repository because it holds secrets. */
  envFile: string;
}

export function resolveReviewE2EConfig(env = process.env): ReviewE2EConfig {
  const host = env.MR1R_E2E_HOST?.trim() || DEFAULT_HOST;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new ReviewE2EConfigError("MR1R_E2E_HOST must be loopback");
  }
  const crmPort = parsePort(env.MR1R_E2E_CRM_PORT, DEFAULT_CRM_PORT, "MR1R_E2E_CRM_PORT");
  const backendPort = parsePort(env.MR1R_E2E_BACKEND_PORT, DEFAULT_BACKEND_PORT, "MR1R_E2E_BACKEND_PORT");
  if (crmPort === backendPort) throw new ReviewE2EConfigError("CRM and backend ports must differ");

  const password = env.MR1R_FIXTURE_PASSWORD;
  if (!password) {
    throw new ReviewE2EConfigError(
      "MR1R_FIXTURE_PASSWORD is required. Export it from the isolated fixture env; " +
        "the suite will not fabricate a credential.",
    );
  }
  const fixtureDir = env.MR1R_FIXTURE_DIR ?? "/home/ubuntu/workspaces/.mr1r-fixture";
  const envFile = env.MR1R_FIXTURE_ENV ?? `${fixtureDir}/backend.env`;

  return {
    host, crmPort, backendPort,
    baseURL: `http://${host}:${crmPort}`,
    backendOrigin: `http://${host}:${backendPort}`,
    password, fixtureDir, envFile,
  };
}

export const REVIEW_E2E = resolveReviewE2EConfig();
export const BACKEND_PORT_TOKEN = String(REVIEW_E2E.backendPort);

/* ----------------------------------------------------------------- manifest */

export interface OwnerRecord {
  userId: number;
  enrollmentId: number;
  submissionId: number;
}

export interface FixtureManifest {
  runId: string;
  /** Database THIS run created. Read-only observation only; never a write target. */
  databaseFile: string;
  curriculumVersionId: number;
  l3LevelDefinitionId: number;
  assignmentVersionId: number;
  rubricVersionId: number;
  fieldCount: number;
  criteria: string[];
  scale: string[];
  rejectionReasons: string[];
  identities: Record<string, number>;
  owners: Record<string, OwnerRecord & { name: string; email: string; readOnly: boolean }>;
  /** Owned by the D→E→F→G chain: inspect, request a revision, resubmit, approve. */
  learnerA: OwnerRecord;
  /** Owned by Journey H alone: idempotent replay and the conflicting-key refusal. */
  learnerB: OwnerRecord;
  /** Owned by Journey I alone: the two-reviewer race needs a genuinely pending report. */
  learnerC: OwnerRecord;
  /** Never decided by any journey: the queue-rendering assertions read these. */
  queueAlpha: OwnerRecord;
  queueBeta: OwnerRecord;
}

export function runDir(): string {
  const dir = process.env[RUN_DIR_ENV];
  if (!dir) {
    throw new ReviewE2EConfigError(
      `${RUN_DIR_ENV} is not set — the reviewer suite must be started through its Playwright config, ` +
        "which seeds an isolated fixture in global setup.",
    );
  }
  return dir;
}

export function fixtureDatabase(): string {
  return `${runDir()}/mr1r.sqlite`;
}

export function manifest(): FixtureManifest {
  const file = `${runDir()}/manifest.json`;
  if (!fs.existsSync(file)) {
    throw new ReviewE2EConfigError(`fixture manifest not found at ${file} — global setup did not complete`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as FixtureManifest;
}

/** Display name the CRM queue renders for a seeded report owner. */
export function ownerName(key: string): string {
  const owner = manifest().owners[key];
  if (!owner) throw new ReviewE2EConfigError(`no seeded report owner named ${key}`);
  return owner.name;
}
