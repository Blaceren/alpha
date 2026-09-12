import { expect, test, type Page } from "@playwright/test";
import { manifest, ownerName } from "./support/review-e2e-config";
import {
  enrollmentLevels,
  learnerResubmit,
  levelStatus,
  loginAndOpenReview,
  nextMentor,
  ownerRow,
  reviewRows,
  submissionStatus,
  submittedRevisionNumber,
  warmRoutes,
  xpTransactionCount,
} from "./support/helpers";

/**
 * Journeys F–L: resubmission, zero-reward approval, idempotency, the two-reviewer
 * race, and the flag boundaries.
 *
 * Journeys H and I own a report each (`learnerB`, `learnerC`) that nothing else
 * decides, so they hold wherever they land in the run. Journeys F and G continue
 * the `learnerA` chain begun in `01-queue-and-inspection.spec.ts`: proving that a
 * CORRECTED revision returns to the queue and is then approved requires the
 * revision request to have happened first, so the files carry numeric prefixes and
 * the suite runs on one worker. Playwright orders files alphabetically, and the
 * original names (`decision-…` before `review-…`) silently inverted the chain —
 * every dependent test failed until the prefixes made the order explicit.
 *
 * Each link of the chain asserts the state it requires before acting, so a broken
 * chain reports where it broke instead of failing as a UI timeout.
 */

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await warmRoutes(page);
  await page.close();
});

/**
 * Open a report with an owned claim and a completed rubric.
 *
 * The detail loads asynchronously, so the claim button must be WAITED for rather
 * than probed with `isVisible()` — an immediate probe races the loading state,
 * returns false, and then the content never appears because nothing was ever
 * claimed. Whichever settles first tells us which branch we are in: the claim
 * prompt (unclaimed) or the report content (already ours).
 */
async function openAndPrepare(page: Page, ownerKey: string) {
  await ownerRow(page, ownerKey).getByRole("button", { name: /открыть/i }).click();

  const claim = page.getByRole("button", { name: /взять в работу/i });
  const content = page.getByRole("heading", { name: /содержание отчёта/i });
  await expect(claim.or(content).first()).toBeVisible({ timeout: 30_000 });

  if (await claim.isVisible()) {
    await claim.click();
    await expect(content).toBeVisible({ timeout: 30_000 });
  }
  await expect(content).toBeVisible({ timeout: 30_000 });

  for (const radio of await page.getByRole("radio", { name: "Соответствует" }).all()) await radio.click();
  for (const box of await page.getByLabel(/^Комментарий/).all()) await box.fill("Всё соответствует рубрике");
}

/* ------------------------------- F: corrected revision returns to queue */

test.describe("Journey F — corrected revision returns to the queue", () => {
  test("the learner resubmits and the report reappears with a higher revision", async ({ page }) => {
    const learnerA = manifest().learnerA;
    expect(submissionStatus(learnerA.submissionId)).toBe("rejected");
    const before = submittedRevisionNumber(learnerA.submissionId);

    // Driven through the backend's own learner API, entirely outside the CRM:
    // the reviewer UI must have no way to touch a learner draft.
    await learnerResubmit("learnerA", "journeyF");

    expect(submissionStatus(learnerA.submissionId)).toBe("pending_review");
    expect(submittedRevisionNumber(learnerA.submissionId)).toBeGreaterThan(before);

    await loginAndOpenReview(page, nextMentor());
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByText(ownerName("learnerA"))).toBeVisible();
    // The queue shows the NEW revision number.
    await expect(ownerRow(page, "learnerA")).toContainText(
      `№${submittedRevisionNumber(learnerA.submissionId)}`,
    );
  });
});

/* --------------------------------------- G: zero-reward approval */

test.describe("Journey G — approve the corrected revision", () => {
  test("L3 completes, L4 becomes available, zero XPTransaction", async ({ page }) => {
    const learnerA = manifest().learnerA;
    // The corrected revision must be back in review, or this proves nothing about
    // approving a CORRECTED report.
    expect(submissionStatus(learnerA.submissionId)).toBe("pending_review");
    expect(submittedRevisionNumber(learnerA.submissionId)).toBeGreaterThan(2);
    expect(xpTransactionCount()).toBe(0);
    const reviewsBefore = reviewRows().length;

    await loginAndOpenReview(page, nextMentor());
    await openAndPrepare(page, "learnerA");

    await page.getByRole("button", { name: /принять отчёт/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /да, принять/i }).click();

    await expect(page.getByText(/отчёт принят/i)).toBeVisible({ timeout: 30_000 });

    // The receipt the server returned, rendered verbatim.
    await expect(page.getByText(/Уровень 3 завершён на сервере/)).toBeVisible();
    await expect(page.getByText(/Уровень 4 стал доступен/)).toBeVisible();
    await expect(page.getByText("не создана")).toBeVisible(); // xpTransactionId === null

    // Server-side truth.
    expect(submissionStatus(learnerA.submissionId)).toBe("approved");
    expect(levelStatus(learnerA.enrollmentId)).toBe("completed");
    const levels = enrollmentLevels(learnerA.enrollmentId);
    expect(levels.highestCompletedLevel).toBe(3);
    expect(levels.currentLevel).toBe(4);
    // Zero XP anywhere in the database, not merely zero for this learner.
    expect(xpTransactionCount()).toBe(0);
    expect(reviewRows().length).toBe(reviewsBefore + 1);
  });

  test("the approved report leaves the pending queue", async ({ page }) => {
    expect(submissionStatus(manifest().learnerA.submissionId)).toBe("approved");

    await loginAndOpenReview(page, nextMentor());
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("table").getByText(ownerName("learnerA"))).toHaveCount(0);
    // Approving one report did not empty the queue for anyone else.
    await expect(page.getByRole("table").getByText(ownerName("queueAlpha"))).toBeVisible();
  });
});

/* ------------------------------------------------- H: idempotent replay */

test.describe("Journey H — idempotency", () => {
  test("the identical approval replayed with the same key returns the same receipt", async ({ page }) => {
    // Driven through the CRM's own same-origin routes with a key this test
    // controls, because that is the only way to send the SAME key twice — which is
    // exactly what a retry after an ambiguous timeout does. The UI mints its key
    // internally, so it cannot demonstrate a replay.
    const learnerB = manifest().learnerB;
    // Journey H owns this report outright: no other journey claims, approves or
    // rejects it, so a replay is measured against a report only this test has touched.
    expect(submissionStatus(learnerB.submissionId)).toBe("pending_review");

    await loginAndOpenReview(page, nextMentor());
    const ref = submissionRef(learnerB.submissionId);
    const key = "crm-approve-journeyh-replay01";

    const csrf = (await page.request.get("/api/crm/auth/csrf").then((r) => r.json())) as { csrfToken: string };
    const headers = {
      "content-type": "application/json",
      "x-csrf-token": csrf.csrfToken,
      "Idempotency-Key": key,
    };

    // Claim, then read the CAS tuple the server reports.
    const summary = (await page.request
      .get(`/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}?locale=ru`)
      .then((r) => r.json())) as { data: { workflowVersion: number; claimVersion: number; submittedRevision: number } };
    await page.request.post(`/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}/claim`, {
      headers: { ...headers, "Idempotency-Key": "crm-claim-journeyh-0001" },
      data: {
        expectedWorkflowVersion: summary.data.workflowVersion,
        expectedClaimVersion: summary.data.claimVersion,
        expectedSubmittedRevision: summary.data.submittedRevision,
      },
    });

    const claimed = (await page.request
      .get(`/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}?locale=ru`)
      .then((r) => r.json())) as {
      data: {
        workflowVersion: number; claimVersion: number; submittedRevision: number;
        payload: { rubric: { criteria: Array<{ code: string; commentRequired: boolean }> } };
      };
    };
    const body = {
      expectedWorkflowVersion: claimed.data.workflowVersion,
      expectedClaimVersion: claimed.data.claimVersion,
      expectedSubmittedRevision: claimed.data.submittedRevision,
      scores: claimed.data.payload.rubric.criteria.map((c) => ({
        criterionCode: c.code,
        scaleCode: "meets",
        ...(c.commentRequired ? { comment: "Соответствует рубрике" } : {}),
      })),
    };

    const first = await page.request.post(
      `/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}/approve`,
      { headers, data: body },
    );
    expect(first.status()).toBe(200);
    const firstReceipt = (await first.json()) as { data: { created: boolean; retry: boolean; reviewId: number; completion: { xpTransactionId: number | null; xpAwarded: number } } };
    expect(firstReceipt.data.created).toBe(true);
    expect(firstReceipt.data.retry).toBe(false);
    expect(firstReceipt.data.completion.xpTransactionId).toBeNull();
    expect(firstReceipt.data.completion.xpAwarded).toBe(0);

    const reviewsAfterFirst = reviewRows();

    // Replay: identical key, identical payload.
    const replay = await page.request.post(
      `/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}/approve`,
      { headers, data: body },
    );
    expect(replay.status()).toBe(200);
    const replayReceipt = (await replay.json()) as { data: { created: boolean; retry: boolean; reviewId: number; completion: { xpTransactionId: number | null } } };

    // Same durable result, marked as a replay rather than a new command.
    expect(replayReceipt.data.created).toBe(false);
    expect(replayReceipt.data.retry).toBe(true);
    expect(replayReceipt.data.reviewId).toBe(firstReceipt.data.reviewId);
    expect(replayReceipt.data.completion.xpTransactionId).toBeNull();

    // No duplicate review, no duplicate completion, no XP row.
    expect(reviewRows().length).toBe(reviewsAfterFirst.length);
    expect(reviewRows().filter((r) => r.submissionId === learnerB.submissionId)).toHaveLength(1);
    expect(xpTransactionCount()).toBe(0);
  });

  test("the same key with a CHANGED payload is refused as a conflict", async ({ page }) => {
    await loginAndOpenReview(page, nextMentor());
    const ref = submissionRef(manifest().learnerB.submissionId);
    const csrf = (await page.request.get("/api/crm/auth/csrf").then((r) => r.json())) as { csrfToken: string };
    const reviewsBefore = reviewRows().length;

    const response = await page.request.post(
      `/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}/approve`,
      {
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf.csrfToken,
          // The key Journey H already consumed, with different evidence.
          "Idempotency-Key": "crm-approve-journeyh-replay01",
        },
        data: { expectedWorkflowVersion: 1, expectedClaimVersion: 1, expectedSubmittedRevision: 1, scores: [] },
        failOnStatusCode: false,
      },
    );

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(reviewRows().length).toBe(reviewsBefore);
    expect(xpTransactionCount()).toBe(0);
  });
});

/** Resolve a submission's opaque ref the way the backend encodes it. */
function submissionRef(submissionId: number): string {
  return Buffer.from(`report-submission:v1:${submissionId}`, "utf8").toString("base64url");
}

/* -------------------------------------------- I: two-reviewer race */

test.describe("Journey I — two reviewers racing", () => {
  test("only one terminal decision survives; the loser gets a bounded conflict", async ({ browser }) => {
    // Learner C exists purely for this journey: the race must run against a
    // genuinely PENDING report. Racing on an already-terminal one would only prove
    // that a closed report refuses writes — a far weaker claim than "two reviewers
    // cannot both decide".
    const learnerC = manifest().learnerC;
    expect(submissionStatus(learnerC.submissionId)).toBe("pending_review");
    const ref = submissionRef(learnerC.submissionId);
    const reviewsBefore = reviewRows().length;

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    try {
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();
      await loginAndOpenReview(p1, nextMentor());
      await loginAndOpenReview(p2, nextMentor());

      async function prepare(page: Page) {
        const csrf = (await page.request.get("/api/crm/auth/csrf").then((r) => r.json())) as { csrfToken: string };
        const headers = {
          "content-type": "application/json",
          "x-csrf-token": csrf.csrfToken,
        };
        const summary = (await page.request
          .get(`/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}?locale=ru`)
          .then((r) => r.json())) as { data: { workflowVersion: number; claimVersion: number; submittedRevision: number } };
        return { headers, cas: summary.data };
      }

      // BOTH reviewers read the same CAS tuple while the report is unclaimed —
      // this is the real race: two sessions holding identical expectations.
      const a = await prepare(p1);
      const b = await prepare(p2);
      expect(a.cas.workflowVersion).toBe(b.cas.workflowVersion);
      expect(a.cas.claimVersion).toBe(b.cas.claimVersion);

      // Both attempt to claim with those identical expectations.
      const claims = await Promise.all(
        [
          { page: p1, prep: a, key: "crm-claim-race-aaaa0001" },
          { page: p2, prep: b, key: "crm-claim-race-bbbb0001" },
        ].map(async ({ page, prep, key }) =>
          page.request.post(`/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}/claim`, {
            headers: { ...prep.headers, "Idempotency-Key": key },
            data: {
              expectedWorkflowVersion: prep.cas.workflowVersion,
              expectedClaimVersion: prep.cas.claimVersion,
              expectedSubmittedRevision: prep.cas.submittedRevision,
            },
            failOnStatusCode: false,
          }),
        ),
      );
      const claimStatuses = claims.map((r) => r.status());
      // Exactly one claim can win on those identical CAS versions.
      expect(claimStatuses.filter((s) => s === 200)).toHaveLength(1);
      expect(claimStatuses.filter((s) => s >= 400)).toHaveLength(1);

      const winnerIndex = claimStatuses.indexOf(200);
      const winner = winnerIndex === 0 ? { page: p1, prep: a } : { page: p2, prep: b };
      const loser = winnerIndex === 0 ? { page: p2, prep: b } : { page: p1, prep: a };

      // The winner approves with the CAS the server now reports.
      const claimed = (await winner.page.request
        .get(`/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}?locale=ru`)
        .then((r) => r.json())) as {
        data: {
          workflowVersion: number; claimVersion: number; submittedRevision: number;
          payload: { rubric: { criteria: Array<{ code: string; commentRequired: boolean }> } };
        };
      };
      const scores = claimed.data.payload.rubric.criteria.map((c) => ({
        criterionCode: c.code,
        scaleCode: "meets",
        ...(c.commentRequired ? { comment: "Соответствует" } : {}),
      }));
      const approve = await winner.page.request.post(
        `/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}/approve`,
        {
          headers: { ...winner.prep.headers, "Idempotency-Key": "crm-approve-race-win001" },
          data: {
            expectedWorkflowVersion: claimed.data.workflowVersion,
            expectedClaimVersion: claimed.data.claimVersion,
            expectedSubmittedRevision: claimed.data.submittedRevision,
            scores,
          },
        },
      );
      expect(approve.status()).toBe(200);

      // The loser now submits its decision using the STALE tuple it read earlier.
      const stale = await loser.page.request.post(
        `/api/curriculum/v2/report-submissions/${encodeURIComponent(ref)}/approve`,
        {
          headers: { ...loser.prep.headers, "Idempotency-Key": "crm-approve-race-lose01" },
          data: {
            expectedWorkflowVersion: loser.prep.cas.workflowVersion,
            expectedClaimVersion: loser.prep.cas.claimVersion,
            expectedSubmittedRevision: loser.prep.cas.submittedRevision,
            scores,
          },
          failOnStatusCode: false,
        },
      );

      // Bounded refusal — never a silent second terminal decision.
      expect(stale.status()).toBeGreaterThanOrEqual(400);
      expect(stale.status()).toBeLessThan(500);

      // Exactly ONE review for this submission, one completion, and no XP.
      expect(reviewRows().filter((r) => r.submissionId === learnerC.submissionId)).toHaveLength(1);
      expect(reviewRows().length).toBe(reviewsBefore + 1);
      expect(levelStatus(learnerC.enrollmentId)).toBe("completed");
      expect(xpTransactionCount()).toBe(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test("a stale CAS tuple from the UI is refused without a second write", async ({ page }) => {
    await loginAndOpenReview(page, nextMentor());
    const learnerC = manifest().learnerC;
    const reviewsBefore = reviewRows().length;

    const csrf = (await page.request.get("/api/crm/auth/csrf").then((r) => r.json())) as { csrfToken: string };
    const response = await page.request.post(
      `/api/curriculum/v2/report-submissions/${encodeURIComponent(submissionRef(learnerC.submissionId))}/approve`,
      {
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf.csrfToken,
          "Idempotency-Key": "crm-stale-journeyi-0001",
        },
        data: { expectedWorkflowVersion: 1, expectedClaimVersion: 0, expectedSubmittedRevision: 1, scores: [] },
        failOnStatusCode: false,
      },
    );
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(reviewRows().length).toBe(reviewsBefore);
    expect(xpTransactionCount()).toBe(0);
  });
});

/* ---------------------------------------------- J/K/L: flags and CSRF */

test.describe("Journeys J–L — flags, XP and attachments", () => {
  test("no attachment route is ever reachable through the CRM origin", async ({ page }) => {
    await loginAndOpenReview(page, nextMentor());
    for (const path of [
      "/api/curriculum/v2/report-attachments/1",
      "/api/curriculum/v2/report-submissions/x/attachments",
      "/api/curriculum/v2/levels/v2.l003.pervye-pyat-demo-sdelok/report/attachments/initiate",
    ]) {
      const response = await page.request.get(path, { failOnStatusCode: false });
      expect(response.status(), `${path} was proxied`).not.toBe(200);
    }
  });

  test("no admin authoring or reassign route is reachable through the CRM origin", async ({ page }) => {
    await loginAndOpenReview(page, nextMentor());
    for (const path of [
      "/api/admin/curriculum/versions",
      "/api/curriculum/v2/report-submissions/x/reassign",
      "/api/curriculum/v2/xp/history",
    ]) {
      const response = await page.request.get(path, { failOnStatusCode: false });
      expect(response.status(), `${path} was proxied`).not.toBe(200);
    }
  });

  test("no learner draft or resubmit route is reachable through the CRM origin", async ({ page }) => {
    // The mentor UI must never be able to mutate a learner's report.
    await loginAndOpenReview(page, nextMentor());
    for (const path of [
      "/api/curriculum/v2/levels/v2.l003.pervye-pyat-demo-sdelok/report/draft",
      "/api/curriculum/v2/levels/v2.l003.pervye-pyat-demo-sdelok/report/resubmit",
      "/api/curriculum/v2/levels/v2.l003.pervye-pyat-demo-sdelok/report/submit",
    ]) {
      const response = await page.request.post(path, { data: {}, failOnStatusCode: false });
      expect(response.status(), `${path} was proxied`).not.toBe(200);
    }
  });

  test("a decision write without a CSRF token is refused", async ({ page }) => {
    await loginAndOpenReview(page, nextMentor());
    const response = await page.request.post(
      `/api/curriculum/v2/report-submissions/${encodeURIComponent(submissionRef(manifest().learnerB.submissionId))}/approve`,
      {
        headers: { "content-type": "application/json", "Idempotency-Key": "crm-nocsrf-journeyl-1" },
        data: { expectedWorkflowVersion: 1, expectedClaimVersion: 1, expectedSubmittedRevision: 1, scores: [] },
        failOnStatusCode: false,
      },
    );
    expect(response.status()).toBe(403);
    expect(xpTransactionCount()).toBe(0);
  });

  test("the whole journey created zero XPTransaction rows with XP disabled", async () => {
    // The single most important invariant of the zero-reward contract.
    expect(xpTransactionCount()).toBe(0);
  });
});
