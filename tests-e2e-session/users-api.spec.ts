import { test, expect, type Page } from "@playwright/test";

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
  | "not_json"
  | "network_failure";

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
      // `/users/{id}/notes` and `/users/{id}/owner` are reviewed nested paths;
      // a child BELOW either must still 404.
      "/api/crm/v1/users/123/notes/note_1",
      "/api/crm/v1/users/123/owner/history",
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
      expect(url.startsWith("http://127.0.0.1:3010/")).toBe(true);
      expect(url).not.toContain("3110");
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

  test("shows only the six contract columns", async ({ page }) => {
    await useStates(page, "authenticated", "populated");
    await page.goto("/users");
    await expect(heading(page)).toBeVisible();

    const headers = await page.locator("th").allTextContents();
    expect(headers).toEqual(["Имя", "Email", "Статус", "Уровень", "Email подтверждён", "Регистрация"]);
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
    for (const secret of ["emp_stub", "effectivePermissions", "permissionVersion", "3110", "CRM_BACKEND_ORIGIN"]) {
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
    for (const leak of ["ECONNREFUSED", "ECONNRESET", "127.0.0.1:3110", "crm.users.internal"]) {
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
