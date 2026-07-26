/**
 * Config for the MR-1R real-backend review E2E suite.
 *
 * Runs the CRM against the RR-1 Backend source on a fresh synthetic
 * migration-34 database carrying the operator-approved revision 3. A stub could
 * not prove any of what matters here: that the reviewer gate actually refuses
 * `support`, that approval really completes L3 with no XPTransaction, or that a
 * replayed idempotency key returns the same receipt.
 *
 * The backend is started and seeded OUTSIDE Playwright (migrations, package
 * import, rubric authoring and two submitted reports), so it is not a `webServer`
 * entry. This module fails loudly if its inputs are missing rather than letting a
 * suite pass while proving nothing.
 */
import fs from "node:fs";
import { FORBIDDEN_PORTS } from "../../tests-e2e-session/support/e2e-config";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_CRM_PORT = 3033;
export const DEFAULT_BACKEND_PORT = 3220;

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

/** Identities the seeder creates. Emails are non-routable by construction. */
export const FIXTURE = {
  mentor: "mr1r.mentor@fixture.invalid",
  admin: "mr1r.admin@fixture.invalid",
  support: "mr1r.support@fixture.invalid",
  userStaff: "mr1r.userstaff@fixture.invalid",
  inactiveMentor: "mr1r.inactive@fixture.invalid",
  learner: "mr1r.learner@fixture.invalid",
} as const;

/**
 * Pooled reviewers, one per test that logs in.
 *
 * The backend rate-limits login to 5 attempts per 10 minutes per (ip + email) and
 * counts failures. Since the CRM calls the backend server-side, every request
 * arrives from one loopback address, so the address is the only distinguishing
 * key. Spending a fresh one per test is cheaper than trying to raise a limit this
 * phase must not modify.
 */
export const MENTOR_POOL_SIZE = 40;
export const ADMIN_POOL_SIZE = 10;

let mentorCursor = 0;
let adminCursor = 0;

/**
 * The reviewer that carries the Learner A chain (inspect → revision request).
 *
 * A claim belongs to ONE reviewer: the Backend releases the report payload only to
 * the holder of the active claim. So a journey that claims in one test and decides
 * in the next MUST reuse the same identity, or the second test sees
 * `access: "summary"` with no payload. Pooled identities are for INDEPENDENT tests.
 *
 * This address is spent at most twice inside the rate-limit window, well under the
 * Backend's 5-per-10-minutes-per-address limit.
 */
export const CHAIN_MENTOR = FIXTURE.mentor;

export function nextMentor(): string {
  mentorCursor += 1;
  if (mentorCursor > MENTOR_POOL_SIZE) {
    throw new ReviewE2EConfigError(`mentor pool (${MENTOR_POOL_SIZE}) exhausted — seed more identities`);
  }
  return `mr1r.pm${String(mentorCursor).padStart(2, "0")}@fixture.invalid`;
}

export function nextAdmin(): string {
  adminCursor += 1;
  if (adminCursor > ADMIN_POOL_SIZE) {
    throw new ReviewE2EConfigError(`admin pool (${ADMIN_POOL_SIZE}) exhausted — seed more identities`);
  }
  return `mr1r.pa${String(adminCursor).padStart(2, "0")}@fixture.invalid`;
}

export interface ReviewE2EConfig {
  host: string;
  crmPort: number;
  backendPort: number;
  baseURL: string;
  backendOrigin: string;
  password: string;
  /** Path to the seeder's manifest (ids, identities, submissions). */
  manifestPath: string;
  fixtureDir: string;
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
  const manifestPath = env.MR1R_MANIFEST ?? `${fixtureDir}/manifest.json`;
  if (!fs.existsSync(manifestPath)) {
    throw new ReviewE2EConfigError(`fixture manifest not found at ${manifestPath} — run the seeder first`);
  }

  return {
    host, crmPort, backendPort,
    baseURL: `http://${host}:${crmPort}`,
    backendOrigin: `http://${host}:${backendPort}`,
    password, manifestPath, fixtureDir,
  };
}

export const REVIEW_E2E = resolveReviewE2EConfig();
export const BACKEND_PORT_TOKEN = String(REVIEW_E2E.backendPort);

export interface FixtureManifest {
  curriculumVersionId: number;
  l3LevelDefinitionId: number;
  assignmentVersionId: number;
  rubricVersionId: number;
  fieldCount: number;
  criteria: string[];
  scale: string[];
  rejectionReasons: string[];
  identities: Record<string, number>;
  learnerA: { userId: number; enrollmentId: number; submissionId: number };
  learnerB: { userId: number; enrollmentId: number; submissionId: number };
  /** Exists solely for the two-reviewer race: a genuinely pending report. */
  learnerC: { userId: number; enrollmentId: number; submissionId: number };
}

export function manifest(): FixtureManifest {
  return JSON.parse(fs.readFileSync(REVIEW_E2E.manifestPath, "utf8")) as FixtureManifest;
}
