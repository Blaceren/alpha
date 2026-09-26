import { expect, test, type Locator, type Page } from "@playwright/test";
import { REPORT_LEVEL_STABLE_CODE } from "../fixture/identities";
import { query } from "../fixture/sqlite";
import {
  REVIEW_E2E,
  adminFor,
  fixtureDatabase,
  manifest,
  mentorFor,
  ownerName,
} from "./review-e2e-config";

export const REPORT_REVIEW_PATH = "/report-review";

/**
 * The login form's error summary, scoped to the form: Next injects its own
 * `role="alert"` route announcer into every page, so an unscoped query matches two
 * elements and fails strict mode.
 */
export function loginError(page: Page): Locator {
  return page.locator("form").getByRole("alert");
}

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/рабочий email/i).fill(email);
  await page.getByLabel(/^пароль$/i).fill(REVIEW_E2E.password);
  await page.getByRole("button", { name: /^войти$/i }).click();
}

/** Sign in and land on the review queue (or its bounded forbidden panel). */
export async function loginAndOpenReview(page: Page, email: string) {
  await login(page, email);
  // Post-login lands on /users; navigate to the review route.
  await expect(page).toHaveURL(/\/users$/, { timeout: 45_000 });
  await page.goto(REPORT_REVIEW_PATH);
}

/**
 * A pooled reviewer belonging to the CURRENT test.
 *
 * Allocation is derived from the running test's own title rather than a shared
 * cursor, so it does not change when the suite is reordered and does not reset
 * when Playwright restarts the worker after a failure. Repeated calls inside one
 * test return distinct identities.
 */
export function nextMentor(): string {
  return mentorFor({ titleKey: test.info().titlePath.join(" › ") });
}

export function nextAdmin(): string {
  return adminFor({ titleKey: test.info().titlePath.join(" › ") });
}

/** Sign in as a reviewer belonging to this test and open the queue. */
export async function loginAsMentor(page: Page) {
  await loginAndOpenReview(page, nextMentor());
}

/** Compile the routes the suite uses, so a dev-server cold compile is not a race. */
export async function warmRoutes(page: Page) {
  for (const route of ["/login", "/users", REPORT_REVIEW_PATH]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
  }
}

/** Row locator for a seeded report owner, by the name the queue renders. */
export function ownerRow(page: Page, ownerKey: string): Locator {
  return page.getByRole("row", { name: new RegExp(ownerName(ownerKey)) });
}

/* --------------------------------------------------- direct DB observation */

/**
 * Read-only assertions against THIS RUN's fixture database.
 *
 * The UI cannot show "zero XPTransaction rows exist anywhere" — that is a claim
 * about the server's state, so it is verified at the source rather than inferred
 * from a rendered number. The path comes from the run directory global setup
 * published, so an observation can never read a previous run's database.
 *
 * The connection is opened read-only, so the suite cannot mutate the fixture while
 * observing it.
 */
function observe(sql: string, params: Array<string | number> = []): unknown[][] {
  return query(fixtureDatabase(), sql, params);
}

export function xpTransactionCount(): number {
  return Number(observe("select count(*) from XPTransaction")[0]![0]);
}

export function levelStatus(enrollmentId: number): string {
  const rows = observe(
    "select status from UserLevelProgress where enrollmentId = ? and levelDefinitionId = ?",
    [enrollmentId, manifest().l3LevelDefinitionId],
  );
  return rows.length > 0 ? String(rows[0]![0]) : "absent";
}

export function enrollmentLevels(enrollmentId: number): {
  currentLevel: number;
  highestCompletedLevel: number;
} {
  const row = observe(
    "select currentLevel, highestCompletedLevel from UserCurriculumEnrollment where id = ?",
    [enrollmentId],
  )[0]!;
  return { currentLevel: Number(row[0]), highestCompletedLevel: Number(row[1]) };
}

export function submissionStatus(submissionId: number): string {
  const rows = observe("select status from ReportSubmission where id = ?", [submissionId]);
  return rows.length > 0 ? String(rows[0]![0]) : "absent";
}

export function reviewRows(): Array<{ id: number; decision: string; submissionId: number }> {
  return observe("select id, decision, submissionId from ReportReview order by id").map((r) => ({
    id: Number(r[0]),
    decision: String(r[1]),
    submissionId: Number(r[2]),
  }));
}

export function submittedRevisionNumber(submissionId: number): number {
  const row = observe(
    "select r.revisionNumber from ReportSubmission s join ReportRevision r on r.id = s.submittedRevisionId where s.id = ?",
    [submissionId],
  )[0];
  return row ? Number(row[0]) : 0;
}

/* ------------------------------------------- protected learner fixture ops */

/**
 * Drive a corrected resubmission through the real learner API.
 *
 * Journey F requires a learner to fix and resubmit. There is no mentor-facing way
 * to do that — and there must not be — so it runs as a protected fixture
 * operation against the Backend's own learner routes, outside the CRM entirely.
 * This is what proves a resubmitted revision returns to the queue without the
 * reviewer UI ever touching a learner draft.
 *
 * Before RF-1 this shelled out to a script in an untracked `tmp/` directory of the
 * Backend worktree. That script no longer existed, so Journey F could not have
 * passed however healthy the fixture was. Going through the published HTTP contract
 * keeps the whole operation inside this suite and inside the product's own rules:
 * the learner must authenticate, carry CSRF, and satisfy the report state machine
 * exactly as a real learner would.
 */
export async function learnerResubmit(ownerKey: string, salt: string): Promise<void> {
  const owner = manifest().owners[ownerKey];
  if (!owner) throw new Error(`no seeded report owner named ${ownerKey}`);
  const origin = REVIEW_E2E.backendOrigin;
  const cookies = new Map<string, string>();

  const absorb = (response: Response) => {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair?.indexOf("=") ?? -1;
      if (pair && eq >= 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookies.size > 0 ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    absorb(response);
    if (!response.ok) {
      throw new Error(`fixture ${method} ${path} failed with ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return response.json() as Promise<Record<string, unknown>>;
  };

  await call("POST", "/api/auth/login", { email: owner.email, password: REVIEW_E2E.password });
  const csrf = (await call("GET", "/api/csrf")) as unknown as { csrfToken: string };
  const headers = { "x-csrf-token": csrf.csrfToken, "Idempotency-Key": `mr1r-resubmit-${ownerKey}-${salt}` };
  const base = `/api/curriculum/v2/levels/${REPORT_LEVEL_STABLE_CODE}/report`;

  // Correct the report the reviewer sent back, then resubmit the corrected revision.
  //
  // `expectedRevision` is the submission's WORKFLOW version, not its revision
  // number — the Backend compares it against `submission.workflowVersion` and
  // answers 409 REPORT_REVISION_STALE otherwise. It advances on every command, so
  // it is read fresh here and again after the draft lands.
  //
  // The correction APPENDS to the existing answer rather than replacing it: the
  // field is `long_text` with minLength 50 / maxLength 300, and a short replacement
  // would be refused as REPORT_DRAFT_INPUT_INVALID — a fixture problem dressed up
  // as a product failure.
  const content = currentFieldValues(owner.submissionId);
  const previous = String(content["summary-next-session-rule"] ?? "");
  await call(
    "PUT",
    `${base}/draft`,
    {
      expectedRevision: workflowVersion(owner.submissionId),
      fieldValues: {
        ...content,
        "summary-next-session-rule": `${previous} Доработка ${salt}.`.slice(0, 300),
      },
    },
    { ...headers, "Idempotency-Key": `mr1r-fix-${ownerKey}-${salt}` },
  );
  await call("POST", `${base}/resubmit`, { expectedRevision: workflowVersion(owner.submissionId) }, headers);
}

/** The submission's current workflow version — the CAS token every learner command carries. */
function workflowVersion(submissionId: number): number {
  return Number(observe("select workflowVersion from ReportSubmission where id = ?", [submissionId])[0]![0]);
}

/** The field values of a submission's latest revision, so a correction edits rather than replaces. */
function currentFieldValues(submissionId: number): Record<string, unknown> {
  const row = observe(
    "select r.content from ReportSubmission s join ReportRevision r on r.id = s.activeRevisionId where s.id = ?",
    [submissionId],
  )[0];
  if (!row) throw new Error(`submission ${submissionId} has no active revision`);
  const raw = row[0];
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
}
