import { expect, test } from "@playwright/test";
import {
  BACKEND_PORT_TOKEN,
  CHAIN_MENTOR,
  FIXTURE,
  REVIEW_E2E,
  manifest,
  ownerName,
} from "./support/review-e2e-config";
import {
  REPORT_REVIEW_PATH,
  enrollmentLevels,
  levelStatus,
  login,
  loginAndOpenReview,
  loginError,
  nextAdmin,
  nextMentor,
  ownerRow,
  submissionStatus,
  warmRoutes,
  xpTransactionCount,
} from "./support/helpers";

/**
 * MR-1R journeys A–L against the real RR-1 Backend on a synthetic migration-34
 * database carrying the operator-approved revision 3, seeded from scratch by
 * global setup before this file runs.
 *
 * Every scenario that DECIDES a report owns a report nobody else touches, and the
 * queue-rendering journeys read two owners (`queueAlpha`, `queueBeta`) that no
 * journey ever decides. So an approval here cannot empty a queue there, and these
 * assertions hold wherever the test lands in the run.
 *
 * Journeys D→E (and F→G in the next file) are a deliberate chain on `learnerA`:
 * proving that a CORRECTED revision is approved requires a revision request first.
 * Each link states the state it needs, so a broken chain fails where it broke.
 */

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await warmRoutes(page);
  await page.close();
});

/* ------------------------------------------------- A: mentor login + queue */

test.describe("Journey A — mentor login and queue", () => {
  test("a mentor reaches the queue and sees the pending reports", async ({ page }) => {
    await loginAndOpenReview(page, nextMentor());

    await expect(page.getByRole("heading", { name: /отчёты на проверке/i })).toBeVisible();
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    // Two reports that no journey ever decides: whatever else has run, these are
    // pending, so this assertion measures the queue rather than the run order.
    await expect(table.getByText(ownerName("queueAlpha"))).toBeVisible();
    await expect(table.getByText(ownerName("queueBeta"))).toBeVisible();
    // Real backend rows, with the real level title from revision 3.
    await expect(table.getByText(/demo-сделок/i).first()).toBeVisible();
  });

  test("the browser never contacts the backend origin directly", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await loginAndOpenReview(page, nextMentor());
    await expect(page.getByRole("table")).toBeVisible();

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith(REVIEW_E2E.baseURL), `browser called ${url}`).toBe(true);
      expect(url).not.toContain(BACKEND_PORT_TOKEN);
    }
  });

  test("the queue filter narrows the loaded page", async ({ page }) => {
    await loginAndOpenReview(page, nextMentor());
    await expect(page.getByRole("table")).toBeVisible();

    await page.getByLabel(/фильтр/i).fill("Queue Alpha");
    await expect(page.getByRole("table").getByText(ownerName("queueAlpha"))).toBeVisible();
    await expect(page.getByRole("table").getByText(ownerName("queueBeta"))).toHaveCount(0);

    await page.getByLabel(/фильтр/i).fill("zzzz-no-match");
    await expect(page.getByText(/ничего не найдено/i)).toBeVisible();
  });
});

/* --------------------------------------- B: admin without the ADMIN flag */

test.describe("Journey B — admin reviews without CURRICULUM_V2_ADMIN_ENABLED", () => {
  test("an admin reaches the queue with the ADMIN flag absent", async ({ page }) => {
    // The fixture backend runs with ADMIN unset, so this test passing IS the proof
    // that report review does not depend on that flag.
    await loginAndOpenReview(page, nextAdmin());
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("table").getByText(ownerName("queueAlpha"))).toBeVisible();
  });
});

/* ------------------------- C: staff who must NOT reach report review */

test.describe("Journey C — staff admission is not reviewer authority", () => {
  test("support enters CRM but is refused report review", async ({ page }) => {
    await login(page, FIXTURE.support);
    // General CRM admission succeeds — this account IS staff.
    await expect(page).toHaveURL(/\/users$/, { timeout: 45_000 });
    await expect(page.getByRole("banner").getByText("MR1R Support")).toBeVisible();

    await page.goto(REPORT_REVIEW_PATH);
    // ...but the reviewer boundary refuses it, bounded and explanatory.
    const alert = page.getByRole("alert").filter({ hasText: /нет доступа к проверке отчётов/i });
    await expect(alert).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    // Not an authentication loop: still on the review route, still signed in.
    await expect(page).toHaveURL(new RegExp(`${REPORT_REVIEW_PATH}$`));
    await expect(page.getByRole("banner").getByText("MR1R Support")).toBeVisible();
  });

  test("userStaff enters CRM but is refused report review", async ({ page }) => {
    // The sharpest case: a valid CRM StaffProfile whose platform role is `user`.
    await login(page, FIXTURE.userStaff);
    await expect(page).toHaveURL(/\/users$/, { timeout: 45_000 });

    await page.goto(REPORT_REVIEW_PATH);
    await expect(
      page.getByRole("alert").filter({ hasText: /нет доступа к проверке отчётов/i }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("a learner is refused at the general CRM boundary, before review", async ({ page }) => {
    await login(page, FIXTURE.learner);
    await expect(loginError(page)).toContainText(/нет доступа к crm/i);
    await page.goto(REPORT_REVIEW_PATH);
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
  });

  test("an inactive mentor is refused at login", async ({ page }) => {
    await login(page, FIXTURE.inactiveMentor);
    await expect(loginError(page)).toContainText(/доступ приостановлен/i);
  });
});

/* ------------------------------------------------ D: inspect Learner A */

test.describe("Journey D — inspect the report", () => {
  test("claim reveals the payload, five trades, summary and R1–R7", async ({ page }) => {
    // The first link of the chain: the report this journey inspects must still be
    // awaiting review, and the seeder is what guarantees that.
    expect(submissionStatus(manifest().learnerA.submissionId)).toBe("pending_review");

    // The chain reviewer, not a pooled one: this test CLAIMS Learner A and Journey E
    // decides on that same claim. A claim belongs to one reviewer.
    await loginAndOpenReview(page, CHAIN_MENTOR);
    await ownerRow(page, "learnerA").getByRole("button", { name: /открыть/i }).click();

    // Before claiming the backend releases no payload at all.
    await expect(page.getByText(/возьмите отчёт в работу/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Сделка 1" })).toHaveCount(0);

    await page.getByRole("button", { name: /взять в работу/i }).click();

    await expect(page.getByRole("heading", { name: /содержание отчёта/i })).toBeVisible({ timeout: 30_000 });
    // Five trade groups plus the summary, derived from the published field codes.
    for (let n = 1; n <= 5; n += 1) {
      await expect(page.getByRole("heading", { name: `Сделка ${n}` })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: /итоги и выводы/i })).toBeVisible();
    // All 43 published fields are accounted for.
    await expect(page.getByText(/43 полей из определения задания/)).toBeVisible();

    // R1–R7 from the backend rubric, in order.
    const groups = page.getByRole("group");
    await expect(groups).toHaveCount(7);
    for (const code of manifest().criteria) {
      await expect(page.getByText(code, { exact: true })).toBeVisible();
    }
    // The conditional deviation notes have explicit not-applicable semantics.
    await expect(page.getByText(/не применимо — план соблюдён/i).first()).toBeVisible();
  });
});

/* ------------------------------------------ E: revision requested */

test.describe("Journey E — request a revision", () => {
  test("L3 stays incomplete, L4 stays locked, no XP", async ({ page }) => {
    const before = xpTransactionCount();
    const learnerA = manifest().learnerA;
    expect(submissionStatus(learnerA.submissionId)).toBe("pending_review");

    // Same reviewer as Journey D, so the claim taken there is still ours.
    await loginAndOpenReview(page, CHAIN_MENTOR);
    await ownerRow(page, "learnerA").getByRole("button", { name: /открыть/i }).click();
    // Wait for the detail to settle before probing: an immediate isVisible() races
    // the loading state and would skip the claim entirely.
    const claim = page.getByRole("button", { name: /взять в работу/i });
    const content = page.getByRole("heading", { name: /содержание отчёта/i });
    await expect(claim.or(content).first()).toBeVisible({ timeout: 30_000 });
    if (await claim.isVisible()) await claim.click();
    await expect(content).toBeVisible({ timeout: 30_000 });

    // Complete the rubric the backend published.
    for (const radio of await page.getByRole("radio", { name: "Соответствует" }).all()) await radio.click();
    const comments = await page.getByLabel(/^Комментарий/).all();
    for (const box of comments) await box.fill("Комментарий наставника по критерию");

    await page.getByLabel(/причина доработки/i).selectOption(manifest().rejectionReasons[0]!);
    await page.getByLabel(/комментарий ученику/i).fill("Добавьте доказательства по сделкам");
    await page.getByLabel(/что именно исправить/i).fill("Приложите скриншоты и уточните отклонения");

    await page.getByRole("button", { name: /отправить на доработку/i }).click();
    await page.getByRole("button", { name: /да, на доработку/i }).click();

    await expect(page.getByText(/отправлено на доработку/i)).toBeVisible({ timeout: 30_000 });

    // Server-side truth, read at the source.
    expect(submissionStatus(learnerA.submissionId)).toBe("rejected");
    expect(levelStatus(learnerA.enrollmentId)).toBe("in_progress");
    expect(enrollmentLevels(learnerA.enrollmentId).highestCompletedLevel).toBe(2);
    expect(xpTransactionCount()).toBe(before);
    expect(xpTransactionCount()).toBe(0);
  });

  test("the revision-requested report leaves the pending queue", async ({ page }) => {
    expect(submissionStatus(manifest().learnerA.submissionId)).toBe("rejected");

    await loginAndOpenReview(page, nextMentor());
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("table").getByText(ownerName("learnerA"))).toHaveCount(0);
    // The queue itself is intact — only the one report left it.
    await expect(page.getByRole("table").getByText(ownerName("queueAlpha"))).toBeVisible();
  });
});
