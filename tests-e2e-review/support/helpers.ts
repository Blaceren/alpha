import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";
import { REVIEW_E2E, manifest } from "./review-e2e-config";

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

/** Compile the routes the suite uses, so a dev-server cold compile is not a race. */
export async function warmRoutes(page: Page) {
  for (const route of ["/login", "/users", REPORT_REVIEW_PATH]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
  }
}

/* --------------------------------------------------- direct DB observation */

/**
 * Read-only assertions against the fixture database.
 *
 * The UI cannot show "zero XPTransaction rows exist anywhere" — that is a claim
 * about the server's state, so it is verified at the source rather than inferred
 * from a rendered number.
 *
 * Queries run through a short python3 subprocess rather than `node:sqlite`: that
 * module is experimental and ships no type declarations in this toolchain, and an
 * untyped `any` in a security-relevant assertion is worse than a subprocess. The
 * connection is opened read-only, so the suite cannot mutate the fixture while
 * observing it.
 */
function query(sql: string, params: Array<string | number> = []): unknown[][] {
  const script = [
    "import json,sqlite3,sys",
    `conn = sqlite3.connect("file:${REVIEW_E2E.fixtureDir}/mr1r.sqlite?mode=ro", uri=True)`,
    "sql = sys.argv[1]",
    "params = json.loads(sys.argv[2])",
    "print(json.dumps([list(r) for r in conn.execute(sql, params)]))",
  ].join("\n");
  const out = execFileSync("python3", ["-c", script, sql, JSON.stringify(params)], {
    encoding: "utf8",
  });
  return JSON.parse(out) as unknown[][];
}

export function xpTransactionCount(): number {
  return Number(query("select count(*) from XPTransaction")[0]![0]);
}

export function levelStatus(enrollmentId: number): string {
  const rows = query(
    "select status from UserLevelProgress where enrollmentId = ? and levelDefinitionId = ?",
    [enrollmentId, manifest().l3LevelDefinitionId],
  );
  return rows.length > 0 ? String(rows[0]![0]) : "absent";
}

export function enrollmentLevels(enrollmentId: number): {
  currentLevel: number;
  highestCompletedLevel: number;
} {
  const row = query(
    "select currentLevel, highestCompletedLevel from UserCurriculumEnrollment where id = ?",
    [enrollmentId],
  )[0]!;
  return { currentLevel: Number(row[0]), highestCompletedLevel: Number(row[1]) };
}

export function submissionStatus(submissionId: number): string {
  const rows = query("select status from ReportSubmission where id = ?", [submissionId]);
  return rows.length > 0 ? String(rows[0]![0]) : "absent";
}

export function reviewRows(): Array<{ id: number; decision: string; submissionId: number }> {
  return query("select id, decision, submissionId from ReportReview order by id").map((r) => ({
    id: Number(r[0]),
    decision: String(r[1]),
    submissionId: Number(r[2]),
  }));
}

export function submittedRevisionNumber(submissionId: number): number {
  const row = query(
    "select r.revisionNumber from ReportSubmission s join ReportRevision r on r.id = s.submittedRevisionId where s.id = ?",
    [submissionId],
  )[0];
  return row ? Number(row[0]) : 0;
}

/* ------------------------------------------- protected learner fixture ops */

/**
 * Drive a corrected resubmission through the real learner domain services.
 *
 * Journey F requires a learner to fix and resubmit. There is no mentor-facing way
 * to do that — and there must not be — so it runs as a protected fixture
 * operation against the backend's own `report-submission` runtime, outside the
 * CRM entirely. This is what proves the resubmitted revision returns to the queue
 * without the reviewer UI ever touching a learner draft.
 */
export function learnerResubmit(learnerUserId: number, salt: string): void {
  execFileSync(
    "/home/ubuntu/workspaces/ata-report-zero-reward-rr1/node_modules/.bin/tsx",
    ["tmp/mr1r-resubmit.ts"],
    {
      cwd: "/home/ubuntu/workspaces/ata-report-zero-reward-rr1",
      env: {
        ...process.env,
        MR1R_RESUBMIT_USER: String(learnerUserId),
        MR1R_RESUBMIT_SALT: salt,
      },
      encoding: "utf8",
      stdio: "pipe",
    },
  );
}
