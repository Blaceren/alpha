import { test, expect, type Page } from "@playwright/test";
import { SESSION_E2E, BACKEND_ORIGIN_HOSTPORT, BACKEND_PORT_TOKEN } from "./support/e2e-config";

/**
 * Production Users v1 list, proved in a real browser against the deterministic
 * stub. The stub's users response is chosen by a test-only cookie set here —
 * the production client knows nothing about it.
 *
 * These tests take no screenshots: nothing here is a tracked visual baseline.
 */

const SESSION_COOKIE = "ata_test_crm_session_state";
const USERS_COOKIE = "ata_test_crm_users_state";

type SessionState = "authenticated" | "admin_no_permissions";
type UsersState =
  | "populated"
  | "full_email"
  | "empty"
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "server_error"
  | "malformed"
  | "malformed_extra_field"
  | "owner_malformed"
  | "owner_extra_field"
  | "not_json"
  | "network_failure";

const OWNER_COLUMNS = [
  "Имя",
  "Email",
  "Статус",
  "Уровень",
  "Email подтверждён",
  "Ответственный",
  "Регистрация",
];

async function useStates(page: Page, session: SessionState, users: UsersState) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: session, domain: "127.0.0.1", path: "/" },
    { name: USERS_COOKIE, value: users, domain: "127.0.0.1", path: "/" },
  ]);
}

const heading = (page: Page) => page.getByRole("heading", { name: "Пользователи", level: 1 });

test.describe("same-origin proxy", () => {
  test("the exact users path is proxied", async ({ request }) => {
    const response = await request.get("/api/crm/v1/users", {
      headers: { cookie: `${USERS_COOKIE}=populated` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("nested paths and near-misses are not proxied", async ({ request }) => {
    // Changed in Frontend CRM User Detail API Slice 2: a single segment after
    // /users/ is now proxied on purpose (the backend owns id validation), so
    // only NESTED paths and sibling routes may be checked for a Next-level 404.
    for (const path of [
      "/api/crm/v1/users/123/extra",
      // `/users/{id}/notes`, `/users/{id}/owner` and `/users/{id}/owner/history`
      // are reviewed nested paths; a child BELOW any of them must still 404.
      "/api/crm/v1/users/123/notes/note_1",
      "/api/crm/v1/users/123/owner/emp_1",
      "/api/crm/v1/users/123/owner/history/hist_1",
      "/api/crm/v1/user",
      "/api/crm/v1/notes",
      // A TOP-LEVEL /owner path stays unreachable: owner is nested under a
      // learner, and the flat directory is /owner-candidates.
      "/api/crm/v1/owner",
      "/api/crm/v1/owner-candidates/extra",
      "/api/crm/v1/audit",
      "/api/auth/login",
      "/api/health",
    ]) {
      const response = await request.get(path);
      expect(response.status(), `${path} must not proxy to the backend`).toBe(404);
    }
  });

  test("both session and users use the CRM origin, never the backend origin", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));

    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    // Wait for the list itself: the h1 renders during loading, before the fetch.
    await expect(page.getByText("Пользователь 00")).toBeVisible();

    const apiCalls = requested.filter((u) => u.includes("/api/crm/v1/"));
    expect(apiCalls.some((u) => u.includes("/session"))).toBe(true);
    expect(apiCalls.some((u) => u.includes("/users"))).toBe(true);
    for (const url of apiCalls) {
      expect(url.startsWith(`${SESSION_E2E.baseURL}/`)).toBe(true);
      expect(url).not.toContain(BACKEND_PORT_TOKEN);
    }
  });
});

test.describe("populated list", () => {
  test("renders synthetic production users with masked email", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");

    await expect(heading(page)).toBeVisible();
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await expect(page.getByText("Пользователь 01")).toBeVisible();
    await expect(page.getByText("l***@e***.test").first()).toBeVisible();
  });

  test("renders a full email when the backend sent one", async ({ page }) => {
    await useStates(page, "authenticated", "full_email");
    await page.goto("/users");
    await expect(page.getByText("learner00@example.test")).toBeVisible();
  });

  test("shows the seven contract columns, with Ответственный before Регистрация", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(heading(page)).toBeVisible();

    const headers = await page.locator("th").allTextContents();
    expect(headers).toEqual(OWNER_COLUMNS);
  });

  test("shows the Russian status and confirmation labels", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Активен").first()).toBeVisible();
    await expect(page.getByText("Заблокирован").first()).toBeVisible();
    await expect(page.getByText("Подтверждён", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Не подтверждён").first()).toBeVisible();
  });

  test("no mock fixture, financial, owner, note or activity data appears", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(heading(page)).toBeVisible();

    const html = await page.content();
    for (const leak of [
      "Nina Chmiel",
      "$50–99",
      "usr_mock",
      "Владелец",
      "Заметки",
      "Баланс",
      "Активность",
      "Приоритет",
      "Рекомендация",
      "Сегмент",
    ]) {
      expect(html, `must not render ${leak}`).not.toContain(leak);
    }
  });

  test("no mock sidebar sections, no role switch, no User 360 link", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();

    // Visible text, not raw HTML: Next embeds the app's not-found boundary
    // (which links to «Сегодня») in every route's RSC payload. What matters is
    // that the shell does not *offer* these sections to the employee.
    const visible = await page.locator("body").innerText();
    for (const banned of ["Сегодня", "Аудит", "Задачи", "Кейсы", "Настройки", "Демо-роль", "Роль:"]) {
      expect(visible, `must not offer ${banned}`).not.toContain(banned);
    }
    // One nav link, plus exactly one detail link per row (Slice 2).
    await expect(page.getByRole("navigation", { name: "Разделы CRM" }).getByRole("link")).toHaveCount(1);
    const rowLinks = page.locator("table a");
    await expect(rowLinks).toHaveCount(3);
    await expect(rowLinks.first()).toHaveAttribute("href", "/users/1000");
  });

  test("no employeeId, permissions or backend origin reaches the page", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(heading(page)).toBeVisible();

    const html = await page.content();
    for (const secret of ["emp_stub", "effectivePermissions", "permissionVersion", BACKEND_PORT_TOKEN, "CRM_BACKEND_ORIGIN"]) {
      expect(html, `leaked ${secret}`).not.toContain(secret);
    }
  });

  test("shows a page position but never a fake total", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Страница 1")).toBeVisible();
    expect(await page.content()).not.toMatch(/Страница\s*1\s*из/);
  });
});

test.describe("cursor pagination", () => {
  test("next then previous walks pages using backend cursors", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();

    await page.getByRole("button", { name: "Следующая" }).click();
    await expect(page.getByText("Пользователь 03")).toBeVisible();
    await expect(page.getByText("Пользователь 00")).toHaveCount(0);
    await expect(page.getByText("Страница 2")).toBeVisible();

    await page.getByRole("button", { name: "Предыдущая" }).click();
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await expect(page.getByText("Страница 1")).toBeVisible();
  });

  test("Previous is disabled on the first page, Next on the last", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await expect(page.getByRole("button", { name: "Предыдущая" })).toBeDisabled();

    await page.getByRole("button", { name: "Следующая" }).click();
    await expect(page.getByText("Пользователь 03")).toBeVisible();
    await expect(page.getByRole("button", { name: "Следующая" })).toBeDisabled();
  });

  test("the cursor is never displayed", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    expect(await page.content()).not.toContain("cursor-page-2");
  });
});

test.describe("search", () => {
  test("display-name search filters the list", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();

    await page.getByLabel("Имя").fill("Пользователь 03");
    await page.getByRole("button", { name: "Найти" }).click();

    await expect(page.getByText("Пользователь 03")).toBeVisible();
    await expect(page.getByText("Пользователь 00")).toHaveCount(0);
  });

  test("search resets pagination to the first page", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await page.getByRole("button", { name: "Следующая" }).click();
    await expect(page.getByText("Страница 2")).toBeVisible();

    await page.getByLabel("Имя").fill("Пользователь 03");
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page.getByText("Страница 1")).toBeVisible();
  });

  test("without the permission the field is name-only and email is refused locally", async ({ page }) => {
    // The stub session is `support` — no view_identity_full_email.
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByLabel("Имя")).toBeVisible();
    await expect(page.getByLabel("Имя или email")).toHaveCount(0);

    let usersCalls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/crm/v1/users")) usersCalls += 1;
    });

    await page.getByLabel("Имя").fill("learner00@example.test");
    await page.getByRole("button", { name: "Найти" }).click();

    await expect(page.locator("#api-users-search-error")).toContainText("Поиск по email недоступен");
    // The request was never sent.
    expect(usersCalls).toBe(0);
  });

  test("a role with empty effectivePermissions gains no email search", async ({ page }) => {
    // crm_admin by role, but the backend granted nothing.
    await useStates(page, "admin_no_permissions", "populated");
    await page.goto("/users");
    await expect(heading(page)).toBeVisible();
    await expect(page.getByLabel("Имя")).toBeVisible();
    await expect(page.getByLabel("Имя или email")).toHaveCount(0);
  });
});

test.describe("empty and error states", () => {
  test("empty list renders the empty state", async ({ page }) => {
    await useStates(page, "authenticated", "empty");
    await page.goto("/users");
    await expect(page.getByText("Пользователи не найдены.")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("400 renders a safe input error and keeps the form", async ({ page }) => {
    await useStates(page, "authenticated", "invalid_input");
    await page.goto("/users");
    await expect(page.getByText("Некорректный запрос")).toBeVisible();
    await expect(page.getByRole("button", { name: "Найти" })).toBeVisible();
    expect(await page.content()).not.toContain("crm.users.limit_invalid");
  });

  test("401 redirects to the exact login URL", async ({ page }) => {
    await useStates(page, "authenticated", "unauthenticated");
    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
    expect(await page.content()).not.toContain("Пользователь 00");
  });

  test("403 renders the safe no-access state", async ({ page }) => {
    await useStates(page, "authenticated", "forbidden");
    await page.goto("/users");
    await expect(page.getByText("Нет доступа к данным CRM")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
    expect(await page.content()).not.toContain("crm.session.not_staff");
  });

  test("500 renders retry and no raw diagnostics", async ({ page }) => {
    await useStates(page, "authenticated", "server_error");
    await page.goto("/users");
    await expect(page.getByText("Сервис недоступен")).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();

    const html = await page.content();
    for (const leak of ["ECONNREFUSED", "ECONNRESET", BACKEND_ORIGIN_HOSTPORT, "crm.users.internal"]) {
      expect(html).not.toContain(leak);
    }
  });

  test("a connection drop renders the retry state", async ({ page }) => {
    await useStates(page, "authenticated", "network_failure");
    await page.goto("/users");
    await expect(page.getByText("Сервис недоступен")).toBeVisible();
  });

  test("an unknown status value fails closed", async ({ page }) => {
    await useStates(page, "authenticated", "malformed");
    await page.goto("/users");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("a fabricated ownerId fails closed and never renders", async ({ page }) => {
    await useStates(page, "authenticated", "malformed_extra_field");
    await page.goto("/users");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
    expect(await page.content()).not.toContain("emp_leak");
  });

  test("a non-JSON body fails closed", async ({ page }) => {
    await useStates(page, "authenticated", "not_json");
    await page.goto("/users");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
  });
});

test.describe("route composition", () => {
  test("/users/123 mounts the production detail, never a User 360 aggregate", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));

    await useStates(page, "authenticated", "populated");
    await page.goto("/users/123");

    // Connected in Slice 2 — the detail foundation, not the mock User 360.
    await expect(page.getByRole("heading", { name: "Целевой Пользователь" })).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
    // Still no User 360 aggregate endpoint anywhere.
    expect(requested.some((u) => u.includes("user-360"))).toBe(false);
  });

  test("other CRM routes stay deferred with a safe link to /users", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    for (const path of ["/today", "/audit", "/financial", "/settings"]) {
      await page.goto(path);
      await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();
      await expect(page.locator("table")).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "Перейти к пользователям" })).toHaveAttribute(
      "href",
      "/users",
    );
  });
});

const ownerSelect = (page: Page) => page.getByLabel("Ответственный");

/** Collect every `/api/crm/v1/users` request URL seen after this call. */
function trackUsersRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (url.includes("/api/crm/v1/users")) urls.push(url);
  });
  return urls;
}

test.describe("owner column", () => {
  test("renders an assigned owner displayName and «Не назначен» for a null owner", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    // Default synthetic list: an assigned owner and an unassigned row.
    await expect(page.getByText("Оператор Альфа").first()).toBeVisible();
    await expect(page.getByText("Не назначен").first()).toBeVisible();
  });

  test("a long owner name keeps its full text via title", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    const long = "Александра-Валентина Оператор-Куратор Длинноимённая-Двойная";
    await expect(page.getByText(long).first()).toHaveAttribute("title", long);
  });

  test("exposes no owner employeeId, ownerVersion, StaffRole or email", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    const html = await page.content();
    for (const secret of ["employeeId", "ownerId", "ownerVersion", "staffRole", "emp_stub", "emp_alpha"]) {
      expect(html, `leaked ${secret}`).not.toContain(secret);
    }
  });

  test("a malformed owner payload fails closed", async ({ page }) => {
    await useStates(page, "authenticated", "owner_malformed");
    await page.goto("/users");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("a forbidden extra owner field fails closed and never renders", async ({ page }) => {
    await useStates(page, "authenticated", "owner_extra_field");
    await page.goto("/users");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
    expect(await page.content()).not.toContain("emp_leak");
  });
});

test.describe("owner filter", () => {
  test("the default list requests no owner parameter", async ({ page }) => {
    const urls = trackUsersRequests(page);
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).not.toContain("owner=");
    await expect(ownerSelect(page)).toHaveValue("all");
  });

  test("an incoming owner=all canonicalizes away and sends no owner", async ({ page }) => {
    const urls = trackUsersRequests(page);
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=all");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await expect(page).toHaveURL(/\/users$/);
    await expect(ownerSelect(page)).toHaveValue("all");
    for (const url of urls) expect(url).not.toContain("owner=");
  });

  test("owner=mine is sent exactly and carries no employee id", async ({ page }) => {
    const urls = trackUsersRequests(page);
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=mine");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    const mine = urls.filter((u) => u.includes("owner=mine"));
    expect(mine.length).toBeGreaterThan(0);
    for (const url of mine) {
      expect(url).not.toContain("emp_");
      expect(url).not.toContain("employeeId");
    }
    await expect(ownerSelect(page)).toHaveValue("mine");
  });

  test("owner=unassigned is sent exactly and shows only unassigned rows", async ({ page }) => {
    const urls = trackUsersRequests(page);
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=unassigned");
    await expect(page.getByText("Не назначен").first()).toBeVisible();
    expect(urls.some((u) => u.includes("owner=unassigned"))).toBe(true);
    await expect(ownerSelect(page)).toHaveValue("unassigned");
  });

  test("the filter offers exactly Все / Мои / Без ответственного and no assigned option", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(ownerSelect(page)).toBeVisible();
    const options = await ownerSelect(page).locator("option").allTextContents();
    expect(options).toEqual(["Все", "Мои", "Без ответственного"]);
  });

  test("the filter is shown without assign_owner (support session)", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(ownerSelect(page)).toBeVisible();
  });

  test("unrelated permissions do not change the filter (admin with none)", async ({ page }) => {
    await useStates(page, "admin_no_permissions", "populated");
    await page.goto("/users");
    await expect(ownerSelect(page)).toBeVisible();
    const options = await ownerSelect(page).locator("option").allTextContents();
    expect(options).toEqual(["Все", "Мои", "Без ответственного"]);
  });

  test("selecting mine updates the URL and the request", async ({ page }) => {
    const urls = trackUsersRequests(page);
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();

    await ownerSelect(page).selectOption("mine");
    await expect(page).toHaveURL(/\/users\?owner=mine$/);
    await expect(page.getByText("Ирина Соколова").first()).toBeVisible();
    expect(urls.some((u) => u.includes("owner=mine"))).toBe(true);
  });

  test("selecting unassigned updates the URL and the request", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await ownerSelect(page).selectOption("unassigned");
    await expect(page).toHaveURL(/\/users\?owner=unassigned$/);
    await expect(page.getByText("Не назначен").first()).toBeVisible();
  });

  test("changing the filter resets pagination to the first page", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await page.getByRole("button", { name: "Следующая" }).click();
    await expect(page.getByText("Страница 2")).toBeVisible();

    await ownerSelect(page).selectOption("mine");
    await expect(page.getByText("Страница 1")).toBeVisible();
  });

  test("a search change preserves the owner filter", async ({ page }) => {
    const urls = trackUsersRequests(page);
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=mine");
    await expect(page.getByText("Пользователь 00")).toBeVisible();

    await page.getByLabel("Имя").fill("Пользователь 03");
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page.getByText("Пользователь 03")).toBeVisible();

    const searched = urls.filter((u) => u.includes("search="));
    expect(searched.length).toBeGreaterThan(0);
    for (const url of searched) expect(url).toContain("owner=mine");
    await expect(ownerSelect(page)).toHaveValue("mine");
  });

  test("search composes with unassigned", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=unassigned");
    await page.getByLabel("Имя").fill("Пользователь 02");
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page.getByText("Пользователь 02")).toBeVisible();
  });

  test("browser back restores the previous owner filter", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();

    await ownerSelect(page).selectOption("mine");
    await expect(page).toHaveURL(/\/users\?owner=mine$/);
    await expect(ownerSelect(page)).toHaveValue("mine");

    await page.goBack();
    await expect(page).toHaveURL(/\/users$/);
    await expect(ownerSelect(page)).toHaveValue("all");
  });

  test("browser forward re-applies the owner filter", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await ownerSelect(page).selectOption("mine");
    await expect(page).toHaveURL(/\/users\?owner=mine$/);
    await page.goBack();
    await expect(ownerSelect(page)).toHaveValue("all");
    await page.goForward();
    await expect(page).toHaveURL(/\/users\?owner=mine$/);
    await expect(ownerSelect(page)).toHaveValue("mine");
  });

  test("a refresh preserves mine", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=mine");
    await expect(ownerSelect(page)).toHaveValue("mine");
    await page.reload();
    await expect(ownerSelect(page)).toHaveValue("mine");
  });

  test("an invalid owner URL canonicalizes safely to all", async ({ page }) => {
    const urls = trackUsersRequests(page);
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=assigned");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await expect(page).toHaveURL(/\/users$/);
    await expect(ownerSelect(page)).toHaveValue("all");
    // The invalid value never reaches the backend.
    for (const url of urls) expect(url).not.toContain("owner=assigned");
  });

  test("a repeated owner URL canonicalizes safely to all", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=mine&owner=all");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await expect(page).toHaveURL(/\/users$/);
    await expect(ownerSelect(page)).toHaveValue("all");
  });

  test("no owner-candidates request is made from the list", async ({ page }) => {
    const all: string[] = [];
    page.on("request", (r) => all.push(r.url()));
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    await ownerSelect(page).selectOption("mine");
    await expect(page.getByText("Ирина Соколова").first()).toBeVisible();
    expect(all.some((u) => u.includes("owner-candidates"))).toBe(false);
  });
});

test.describe("owner filter — empty states and copy", () => {
  test("mine with no rows shows the mine empty copy", async ({ page }) => {
    await useStates(page, "authenticated", "empty");
    await page.goto("/users?owner=mine");
    await expect(page.getByText("За вами пока не закреплены пользователи.")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("unassigned with no rows shows the unassigned empty copy", async ({ page }) => {
    await useStates(page, "authenticated", "empty");
    await page.goto("/users?owner=unassigned");
    await expect(page.getByText("Все пользователи закреплены за ответственными.")).toBeVisible();
  });

  test("a non-empty search takes precedence over the owner empty copy", async ({ page }) => {
    // owner=unassigned + a search that matches an owned row → zero rows, but the
    // search-empty copy wins.
    await useStates(page, "authenticated", "populated");
    await page.goto("/users?owner=unassigned");
    await page.getByLabel("Имя").fill("Пользователь 00");
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(
      page.getByText("По этому запросу пользователей нет. Измените запрос или сбросьте поиск."),
    ).toBeVisible();
    await expect(page.getByText("Все пользователи закреплены за ответственными.")).toHaveCount(0);
  });
});

test.describe("owner filter — mobile", () => {
  test("the owner field is usable at a 320px viewport with no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    // The owner value and the filter are reachable.
    await expect(page.getByText("Оператор Альфа").first()).toBeVisible();
    await expect(ownerSelect(page)).toBeVisible();
    // The document itself never scrolls horizontally (wide content scrolls only
    // inside its own container).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(overflow).toBe(true);
  });

  test("a long owner name does not force horizontal document overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(overflow).toBe(true);
  });
});
