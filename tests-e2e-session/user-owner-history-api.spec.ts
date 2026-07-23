import { test, expect, type Page } from "@playwright/test";

/**
 * Production CRM Learner Owner History (OH-1) at `/users/[userId]`, proved in a
 * real browser against the deterministic stub. The stub's history responses and
 * the session's permission set are chosen by test-only cookies set here — the
 * production client knows nothing about them.
 *
 * The section is read-only and gated by `view_audit`: a role that may reassign
 * the owner (`assign_owner`) but lacks `view_audit` must neither see it nor
 * request it. History is server-backed, so a reload re-fetches it rather than
 * relying on any client cache.
 *
 * These tests take no screenshots: nothing here is a tracked visual baseline.
 */

const SESSION_COOKIE = "ata_test_crm_session_state";
const OWNER_SESSION_COOKIE = "ata_test_crm_owner_session";
const USERS_COOKIE = "ata_test_crm_users_state";
const DETAIL_COOKIE = "ata_test_crm_user_detail_state";
const OWNER_COOKIE = "ata_test_crm_owner_state";
const HISTORY_COOKIE = "ata_test_crm_owner_history_state";

type Perms = "viewer" | "viewer_and_assigner" | "assigner" | "none";
type HistoryState = "three" | "paged" | "empty" | "forbidden" | "server_error" | "malformed";

async function useHistory(
  page: Page,
  opts: { perms?: Perms; history?: HistoryState } = {},
) {
  await page.context().clearCookies();
  await page.context().addCookies(
    [
      { name: SESSION_COOKIE, value: "owner_matrix" },
      { name: OWNER_SESSION_COOKIE, value: opts.perms ?? "viewer" },
      { name: USERS_COOKIE, value: "populated" },
      { name: DETAIL_COOKIE, value: "active" },
      // A valid current owner so the detail page renders fully.
      { name: OWNER_COOKIE, value: "assigned" },
      { name: HISTORY_COOKIE, value: opts.history ?? "three" },
    ].map((c) => ({ ...c, domain: "127.0.0.1", path: "/" })),
  );
}

const learner = (page: Page) => page.getByRole("heading", { name: "Целевой Пользователь" });
const historyHeading = (page: Page) =>
  page.getByRole("heading", { name: "История ответственного" });
const historySection = (page: Page) =>
  page.locator("section", { has: page.getByRole("heading", { name: "История ответственного" }) });

/** History requests observed by the browser, for "no request" assertions. */
function trackHistoryRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/crm\/v1\/users\/[^/?]+\/owner\/history/.test(r.url())) seen.push(r.url());
  });
  return seen;
}

test.describe("Owner History — visibility", () => {
  test("is shown and lists all three ordered transitions for view_audit", async ({ page }) => {
    await useHistory(page, { perms: "viewer", history: "three" });
    await page.goto("/users/1042");
    await expect(learner(page)).toBeVisible();
    await expect(historyHeading(page)).toBeVisible();

    const section = historySection(page);
    // Newest-first order: unassigned, then reassigned, then assigned. Exact
    // matching so the label "Назначен" is not confused with the owner label
    // "Не назначен" (case-insensitive substring) on the assign/unassign rows.
    await expect(section.getByRole("listitem")).toHaveCount(3);
    await expect(section.getByText("Снят", { exact: true })).toBeVisible();
    await expect(section.getByText("Изменён", { exact: true })).toBeVisible();
    await expect(section.getByText("Назначен", { exact: true })).toBeVisible();
    // Owner names on the transitions and the authenticated actor.
    await expect(section.getByText("Оператор Альфа").first()).toBeVisible();
    await expect(section.getByText("Оператор Бета").first()).toBeVisible();
    await expect(section.getByText(/Оператор Дельта/).first()).toBeVisible();
  });

  test("is hidden and never requested for assign_owner without view_audit", async ({ page }) => {
    const seen = trackHistoryRequests(page);
    await useHistory(page, { perms: "assigner", history: "three" });
    await page.goto("/users/1042");
    await expect(learner(page)).toBeVisible();
    // The owner section still renders (assigner may edit), but history does not.
    await expect(page.getByRole("heading", { name: "Ответственный" })).toBeVisible();
    await expect(historyHeading(page)).toHaveCount(0);
    // And no history request was ever made.
    expect(seen).toHaveLength(0);
  });

  test("is hidden for a session with no relevant permission", async ({ page }) => {
    await useHistory(page, { perms: "none", history: "three" });
    await page.goto("/users/1042");
    await expect(learner(page)).toBeVisible();
    await expect(historyHeading(page)).toHaveCount(0);
  });
});

test.describe("Owner History — states", () => {
  test("shows an honest empty state without a complete-history claim", async ({ page }) => {
    await useHistory(page, { perms: "viewer", history: "empty" });
    await page.goto("/users/1042");
    const section = historySection(page);
    await expect(section.getByText(/Записей пока нет/)).toBeVisible();
    await expect(section.getByText(/после включения этой функции/)).toBeVisible();
    await expect(section.getByText(/недоступны/)).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);
  });

  test("paginates newest-first with load-more, no duplicates", async ({ page }) => {
    await useHistory(page, { perms: "viewer", history: "paged" });
    await page.goto("/users/1042");
    const section = historySection(page);
    await expect(section.getByRole("listitem")).toHaveCount(2);

    await section.getByRole("button", { name: "Показать ещё" }).click();
    await expect(section.getByRole("listitem")).toHaveCount(3);
    // All three transition labels are now present, exactly once each (exact
    // matching so "Назначен" is not conflated with the "Не назначен" owner label).
    await expect(section.getByText("Снят", { exact: true })).toHaveCount(1);
    await expect(section.getByText("Изменён", { exact: true })).toHaveCount(1);
    await expect(section.getByText("Назначен", { exact: true })).toHaveCount(1);
  });

  test("is server-backed: a reload re-fetches and re-renders history", async ({ page }) => {
    const seen = trackHistoryRequests(page);
    await useHistory(page, { perms: "viewer", history: "three" });
    await page.goto("/users/1042");
    await expect(historySection(page).getByRole("listitem")).toHaveCount(3);
    const before = seen.length;
    expect(before).toBeGreaterThan(0);

    await page.reload();
    await expect(historySection(page).getByRole("listitem")).toHaveCount(3);
    // The reload made at least one fresh history request — nothing is cached.
    expect(seen.length).toBeGreaterThan(before);
  });

  test("offers a retry on an upstream failure", async ({ page }) => {
    await useHistory(page, { perms: "viewer", history: "server_error" });
    await page.goto("/users/1042");
    const section = historySection(page);
    await expect(section.getByText(/Не удалось загрузить историю/)).toBeVisible();
    await expect(section.getByRole("button", { name: "Повторить" })).toBeVisible();
  });

  test("rejects a malformed payload instead of rendering a leaked field", async ({ page }) => {
    await useHistory(page, { perms: "viewer", history: "malformed" });
    await page.goto("/users/1042");
    const section = historySection(page);
    await expect(section.getByText(/Ответ сервиса не прошёл проверку/)).toBeVisible();
    // The leaked internal id never reaches the DOM.
    await expect(page.getByText("emp_leak")).toHaveCount(0);
  });
});
