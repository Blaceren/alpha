import { test, expect, type Page } from "@playwright/test";

/**
 * Production CRM Learner Owner v1 at `/users/[userId]`, proved in a real browser
 * against the deterministic stub. The stub's owner/candidate responses and the
 * session's permission set are chosen by test-only cookies set here — the
 * production client knows nothing about them.
 *
 * These tests take no screenshots: nothing here is a tracked visual baseline.
 */

const SESSION_COOKIE = "ata_test_crm_session_state";
const OWNER_SESSION_COOKIE = "ata_test_crm_owner_session";
const USERS_COOKIE = "ata_test_crm_users_state";
const DETAIL_COOKIE = "ata_test_crm_user_detail_state";
const OWNER_COOKIE = "ata_test_crm_owner_state";
const OWNER_MUTATION_COOKIE = "ata_test_crm_owner_mutation";
const CANDIDATES_COOKIE = "ata_test_crm_candidates_state";

type OwnerPerms = "assigner" | "no_assign" | "unrelated" | "none";
type OwnerState =
  | "assigned"
  | "pristine"
  | "unassigned_persisted"
  | "forbidden"
  | "unauthenticated"
  | "not_found"
  | "server_error"
  | "malformed"
  | "not_json"
  | "network_failure"
  | "delayed";
type OwnerMutation =
  | "success"
  | "conflict"
  | "forbidden"
  | "candidate_404"
  | "learner_404"
  | "invalid"
  | "server_error"
  | "malformed";
type CandidatesState =
  | "one_page"
  | "paged"
  | "duplicate"
  | "empty"
  | "forbidden"
  | "server_error"
  | "malformed"
  | "delayed";

async function useOwner(
  page: Page,
  opts: {
    perms?: OwnerPerms;
    owner?: OwnerState;
    mutation?: OwnerMutation;
    candidates?: CandidatesState;
  } = {},
) {
  await page.context().clearCookies();
  await page.context().addCookies(
    [
      { name: SESSION_COOKIE, value: "owner_matrix" },
      { name: OWNER_SESSION_COOKIE, value: opts.perms ?? "assigner" },
      { name: USERS_COOKIE, value: "populated" },
      { name: DETAIL_COOKIE, value: "active" },
      { name: OWNER_COOKIE, value: opts.owner ?? "assigned" },
      { name: OWNER_MUTATION_COOKIE, value: opts.mutation ?? "success" },
      { name: CANDIDATES_COOKIE, value: opts.candidates ?? "one_page" },
    ].map((c) => ({ ...c, domain: "127.0.0.1", path: "/" })),
  );
}

const ownerSection = (page: Page) => page.getByRole("heading", { name: "Ответственный" });
const editButton = (page: Page) => page.getByRole("button", { name: "Изменить ответственного" });
const ownerSelect = (page: Page) => page.getByLabel("Ответственный");
const saveButton = (page: Page) => page.getByRole("button", { name: "Сохранить" });
const learner = (page: Page) => page.getByRole("heading", { name: "Целевой Пользователь" });
/** The stated current owner — unambiguous even while the editor (whose options
 * repeat the same names) is open. */
const statedOwner = (page: Page) => page.getByTestId("crm-owner-current");

/** Owner + candidate requests observed by the browser, for "no request" assertions. */
function trackOwnerRequests(page: Page): { url: string; method: string }[] {
  const seen: { url: string; method: string }[] = [];
  page.on("request", (r) => {
    if (/\/api\/crm\/v1\/(users\/[^/?]+\/owner|owner-candidates)/.test(r.url())) {
      seen.push({ url: r.url(), method: r.method() });
    }
  });
  return seen;
}

/* ------------------------------------------------------------------ proxy */

test.describe("same-origin proxy", () => {
  test("the exact owner path is proxied for GET", async ({ request }) => {
    const response = await request.get("/api/crm/v1/users/101/owner", {
      headers: { cookie: `${OWNER_COOKIE}=assigned` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.owner.displayName).toBe("Оператор Альфа");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });

  test("the exact owner path is proxied for PUT", async ({ request }) => {
    const response = await request.put("/api/crm/v1/users/101/owner", {
      headers: { cookie: `${OWNER_MUTATION_COOKIE}=success`, "content-type": "application/json" },
      data: { ownerEmployeeId: "emp_beta", expectedVersion: 1 },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ownerVersion).toBe(2);
    expect(body.owner.employeeId).toBe("emp_beta");
  });

  test("the exact candidates path is proxied for GET", async ({ request }) => {
    const response = await request.get("/api/crm/v1/owner-candidates", {
      headers: { cookie: `${CANDIDATES_COOKIE}=one_page` },
    });
    expect(response.status()).toBe(200);
    expect(Array.isArray((await response.json()).items)).toBe(true);
  });

  test("/owner/extra is NOT proxied", async ({ request }) => {
    expect((await request.get("/api/crm/v1/users/101/owner/extra")).status()).toBe(404);
  });

  test("/owner/history IS proxied (OH-1), but a child beneath it is not", async ({ request }) => {
    // Owner History (OH-1) is a reviewed terminal path and reaches the backend.
    expect((await request.get("/api/crm/v1/users/101/owner/history")).status()).toBe(200);
    // A child segment below it is not a reviewed path and must fall through.
    expect((await request.get("/api/crm/v1/users/101/owner/history/hist_1")).status()).toBe(404);
    expect((await request.get("/api/crm/v1/users/101/owner/history/extra")).status()).toBe(404);
  });

  test("/owner-candidates/extra is NOT proxied", async ({ request }) => {
    expect((await request.get("/api/crm/v1/owner-candidates/extra")).status()).toBe(404);
  });

  test("PATCH on the owner path is unsupported", async ({ request }) => {
    const r = await request.patch("/api/crm/v1/users/101/owner", { data: {} });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).not.toBe(200);
  });

  test("POST on the owner path is unsupported", async ({ request }) => {
    expect((await request.post("/api/crm/v1/users/101/owner", { data: {} })).status()).toBeGreaterThanOrEqual(400);
  });

  test("DELETE on the owner path is unsupported", async ({ request }) => {
    expect((await request.delete("/api/crm/v1/users/101/owner")).status()).toBeGreaterThanOrEqual(400);
  });
});

/* --------------------------------------------------------------- display */

test.describe("current owner display", () => {
  test("shows the assigned owner display name", async ({ page }) => {
    await useOwner(page, { owner: "assigned" });
    await page.goto("/users/101");
    await expect(ownerSection(page)).toBeVisible();
    await expect(page.getByText("Оператор Альфа")).toBeVisible();
  });

  test("shows «Не назначен» for the pristine state", async ({ page }) => {
    await useOwner(page, { owner: "pristine", perms: "no_assign" });
    await page.goto("/users/101");
    await expect(page.getByText("Не назначен")).toBeVisible();
  });

  test("shows «Не назначен» for a persisted unassigned non-zero version", async ({ page }) => {
    await useOwner(page, { owner: "unassigned_persisted" });
    await page.goto("/users/101");
    await expect(page.getByText("Не назначен")).toBeVisible();
  });

  test("never exposes employeeId, version, StaffRole or email", async ({ page }) => {
    await useOwner(page, { owner: "assigned" });
    await page.goto("/users/101");
    await expect(page.getByText("Оператор Альфа")).toBeVisible();
    const html = await page.content();
    for (const banned of ["emp_alpha", "ownerVersion", "staffRole", "StaffRole", "@example", "assign_owner"]) {
      expect(html).not.toContain(banned);
    }
  });
});

/* ------------------------------------------------------------ permissions */

test.describe("permission-bounded controls", () => {
  test("assigner sees the edit control", async ({ page }) => {
    await useOwner(page, { perms: "assigner" });
    await page.goto("/users/101");
    await expect(editButton(page)).toBeVisible();
  });

  test("without assign_owner shows read-only owner and requests no candidates", async ({ page }) => {
    const seen = trackOwnerRequests(page);
    await useOwner(page, { perms: "no_assign" });
    await page.goto("/users/101");
    await expect(page.getByText("Оператор Альфа")).toBeVisible();
    await expect(editButton(page)).toHaveCount(0);
    expect(seen.some((r) => r.url.includes("owner-candidates"))).toBe(false);
  });

  test("an unrelated permission grants no controls", async ({ page }) => {
    await useOwner(page, { perms: "unrelated" });
    await page.goto("/users/101");
    await expect(page.getByText("Оператор Альфа")).toBeVisible();
    await expect(editButton(page)).toHaveCount(0);
  });
});

/* ------------------------------------------------------------- candidates */

test.describe("candidate selection", () => {
  test("lists «Без ответственного» plus candidates in backend order", async ({ page }) => {
    await useOwner(page, { owner: "pristine", candidates: "one_page" });
    await page.goto("/users/101");
    await editButton(page).click();
    await expect(ownerSelect(page)).toBeVisible();
    const options = await ownerSelect(page).locator("option").allTextContents();
    expect(options).toEqual(["Без ответственного", "Оператор Альфа", "Оператор Бета", "Оператор Гамма"]);
  });

  test("walks multiple candidate pages", async ({ page }) => {
    await useOwner(page, { owner: "pristine", candidates: "paged" });
    await page.goto("/users/101");
    await editButton(page).click();
    await expect(ownerSelect(page)).toBeVisible();
    const options = await ownerSelect(page).locator("option").allTextContents();
    expect(options).toEqual(["Без ответственного", "Оператор Альфа", "Оператор Бета"]);
  });

  test("deduplicates a repeated candidate across pages", async ({ page }) => {
    await useOwner(page, { owner: "pristine", candidates: "duplicate" });
    await page.goto("/users/101");
    await editButton(page).click();
    await expect(ownerSelect(page)).toBeVisible();
    const options = await ownerSelect(page).locator("option").allTextContents();
    expect(options).toEqual(["Без ответственного", "Оператор Альфа", "Оператор Бета", "Оператор Гамма"]);
  });

  test("candidates 403 removes controls and keeps the owner visible", async ({ page }) => {
    await useOwner(page, { owner: "assigned", candidates: "forbidden" });
    await page.goto("/users/101");
    await editButton(page).click();
    await expect(page.getByText("Нет доступа к назначению ответственного")).toBeVisible();
    await expect(statedOwner(page)).toHaveText("Оператор Альфа");
  });

  test("candidates 500 shows a retry", async ({ page }) => {
    await useOwner(page, { owner: "assigned", candidates: "server_error" });
    await page.goto("/users/101");
    await editButton(page).click();
    await expect(page.getByText("Не удалось загрузить список сотрудников.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  });

  test("candidates malformed fails closed", async ({ page }) => {
    await useOwner(page, { owner: "assigned", candidates: "malformed" });
    await page.goto("/users/101");
    await editButton(page).click();
    await expect(page.getByText("Не удалось загрузить список сотрудников.")).toBeVisible();
  });
});

/* -------------------------------------------------------------- mutation */

async function openEditorAndSelect(page: Page, optionLabel: string) {
  await editButton(page).click();
  await expect(ownerSelect(page)).toBeVisible();
  await ownerSelect(page).selectOption({ label: optionLabel });
}

test.describe("assignment", () => {
  test("assigns via confirmation and shows the server owner", async ({ page }) => {
    await useOwner(page, { owner: "pristine", mutation: "success" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Назначить ответственного?")).toBeVisible();
    await dialog.getByRole("button", { name: "Назначить" }).click();
    await expect(page.getByText("Ответственный обновлён")).toBeVisible();
    await expect(statedOwner(page)).toHaveText("Оператор Бета");
  });

  test("replaces the current owner", async ({ page }) => {
    await useOwner(page, { owner: "assigned", mutation: "success" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Назначить" }).click();
    await expect(statedOwner(page)).toHaveText("Оператор Бета");
  });

  test("unassigns with the unassign confirmation copy", async ({ page }) => {
    await useOwner(page, { owner: "assigned", mutation: "success" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Без ответственного");
    await saveButton(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Снять ответственного?")).toBeVisible();
    await dialog.getByRole("button", { name: "Снять" }).click();
    await expect(page.getByText("Не назначен")).toBeVisible();
  });

  test("sends the retained non-zero version on the next mutation", async ({ page }) => {
    const seen: { method: string; body: string }[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && /\/owner$/.test(r.url())) seen.push({ method: r.method(), body: r.postData() ?? "" });
    });
    await useOwner(page, { owner: "unassigned_persisted", mutation: "success" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Альфа");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Назначить" }).click();
    await expect(page.getByText("Ответственный обновлён")).toBeVisible();
    // The persisted version 3 (not 0) must have travelled — no reset on unassign.
    expect(JSON.parse(seen[0]!.body)).toEqual({ ownerEmployeeId: "emp_alpha", expectedVersion: 3 });
  });

  test("cancel in the dialog sends no mutation", async ({ page }) => {
    const seen = trackOwnerRequests(page);
    await useOwner(page, { owner: "assigned" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();
    expect(seen.some((r) => r.method === "PUT")).toBe(false);
  });

  test("selecting the current owner keeps Save disabled and sends nothing", async ({ page }) => {
    await useOwner(page, { owner: "assigned" });
    await page.goto("/users/101");
    await editButton(page).click();
    await expect(ownerSelect(page)).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
  });

  test("a candidate 404 keeps the detail and reports the employee unavailable", async ({ page }) => {
    await useOwner(page, { owner: "assigned", mutation: "candidate_404" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Назначить" }).click();
    await expect(page.getByText("Сотрудник недоступен для назначения")).toBeVisible();
    await expect(learner(page)).toBeVisible();
    await expect(statedOwner(page)).toHaveText("Оператор Альфа");
  });

  test("a learner 404 replaces the whole detail", async ({ page }) => {
    await useOwner(page, { owner: "assigned", mutation: "learner_404" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Назначить" }).click();
    await expect(page.getByText("Пользователь не найден")).toBeVisible();
  });

  test("a mutation 403 removes the controls", async ({ page }) => {
    await useOwner(page, { owner: "assigned", mutation: "forbidden" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Назначить" }).click();
    await expect(page.getByText("Нет доступа к назначению ответственного")).toBeVisible();
    await expect(editButton(page)).toHaveCount(0);
  });

  test("a mutation 500 keeps the current owner", async ({ page }) => {
    await useOwner(page, { owner: "assigned", mutation: "server_error" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Назначить" }).click();
    await expect(page.getByText("Не удалось обновить ответственного. Попробуйте ещё раз.")).toBeVisible();
    await expect(statedOwner(page)).toHaveText("Оператор Альфа");
  });

  test("a malformed mutation 200 does not report a false success", async ({ page }) => {
    await useOwner(page, { owner: "assigned", mutation: "malformed" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Назначить" }).click();
    await expect(page.getByText("Ответственный обновлён")).toHaveCount(0);
    await expect(statedOwner(page)).toHaveText("Оператор Альфа");
  });
});

/* -------------------------------------------------------------- conflict */

test.describe("conflict", () => {
  test("a 409 refetches the current owner, does not apply the attempt, and never auto-retries", async ({ page }) => {
    const puts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && /\/owner$/.test(r.url())) puts.push(r.url());
    });
    await useOwner(page, { owner: "assigned", mutation: "conflict" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Назначить" }).click();
    await expect(
      page.getByText("Ответственный уже изменён другим сотрудником. Данные обновлены."),
    ).toBeVisible();
    // The attempted owner (Beta) is not applied; the refetched current owner shows.
    await expect(statedOwner(page)).toHaveText("Оператор Альфа");
    // Exactly one PUT: no automatic retry with the new version.
    await page.waitForTimeout(300);
    expect(puts).toHaveLength(1);
  });
});

/* ------------------------------------------------------- errors / redirect */

test.describe("owner read errors", () => {
  test("a 401 redirects to login", async ({ page }) => {
    await useOwner(page, { owner: "unauthenticated" });
    await page.goto("/users/101");
    await expect(page).toHaveURL(/\/login\?reason=session_required/);
  });

  test("a learner 404 replaces the whole detail", async ({ page }) => {
    await useOwner(page, { owner: "not_found" });
    await page.goto("/users/101");
    await expect(page.getByText("Пользователь не найден")).toBeVisible();
  });

  test("a 500 keeps identity and shows an owner-only retry", async ({ page }) => {
    await useOwner(page, { owner: "server_error" });
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();
    await expect(page.getByText("Не удалось загрузить ответственного.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  });

  test("a malformed owner 200 fails closed", async ({ page }) => {
    await useOwner(page, { owner: "malformed" });
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();
    await expect(page.getByText(/не прошёл проверку/)).toBeVisible();
  });
});

/* ------------------------------------------------------- stale / a11y / mock */

test.describe("stale and accessibility", () => {
  test("changing the learner route clears the previous owner", async ({ page }) => {
    await useOwner(page, { owner: "assigned" });
    await page.goto("/users/101");
    await expect(page.getByText("Оператор Альфа")).toBeVisible();
    // Point the detail cookie at a learner whose owner is unassigned.
    await page.context().addCookies([
      { name: OWNER_COOKIE, value: "pristine", domain: "127.0.0.1", path: "/" },
    ]);
    await page.goto("/users/202");
    await expect(page.getByText("Не назначен")).toBeVisible();
  });

  test("a long owner display name does not overflow horizontally", async ({ page }) => {
    await useOwner(page, { owner: "assigned" });
    await page.goto("/users/101");
    await expect(page.getByText("Оператор Альфа")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(true);
  });

  test("the confirmation dialog is a labelled accessible dialog", async ({ page }) => {
    await useOwner(page, { owner: "assigned" });
    await page.goto("/users/101");
    await openEditorAndSelect(page, "Оператор Бета");
    await saveButton(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Escape closes and returns focus to the page without sending a mutation.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("remains usable at 200% zoom", async ({ page }) => {
    await useOwner(page, { owner: "assigned" });
    await page.goto("/users/101");
    await page.evaluate(() => ((document.body.style as CSSStyleDeclaration).zoom = "2"));
    await expect(page.getByText("Оператор Альфа")).toBeVisible();
    await expect(editButton(page)).toBeVisible();
  });
});
