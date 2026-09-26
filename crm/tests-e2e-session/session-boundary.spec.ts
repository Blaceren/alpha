import { test, expect, type Page } from "@playwright/test";
import { SESSION_E2E, BACKEND_ORIGIN_HOSTPORT, BACKEND_PORT_TOKEN } from "./support/e2e-config";

/**
 * API-mode session boundary, proved in a real browser against the deterministic
 * stub. The stub's response is chosen by a test-only cookie set here — the
 * production session client knows nothing about it.
 *
 * These tests take no screenshots: nothing here is a tracked visual baseline.
 */

const STATE_COOKIE = "ata_test_crm_session_state";
const MOCK_ROLE_KEY = "ata-crm.mock-role.v1";

type StubState =
  | "authenticated"
  | "unauthenticated"
  | "forbidden"
  | "server_error"
  | "malformed"
  | "malformed_extra_field"
  | "not_json"
  | "network_failure"
  | "admin_no_permissions";

async function useState(page: Page, state: StubState) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: STATE_COOKIE, value: state, domain: "127.0.0.1", path: "/" },
  ]);
}

/** Fail loudly if a page logs an uncaught error. */
function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test.describe("authenticated", () => {
  test("a valid session renders the truthful confirmation, not the mock CRM", async ({ page }) => {
    await useState(page, "authenticated");
    await page.goto("/today");

    // /today has no API data, so it renders the deferred state. The copy now
    // names the one connected capability (Users) instead of claiming that all
    // CRM data is pending — see Frontend CRM Users API Slice 1.
    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();
    await expect(
      page.getByText("Из данных CRM сейчас доступен только список", { exact: false }),
    ).toBeVisible();

    // The employee is named, and the role is a safe label.
    await expect(page.getByText("Ирина Соколова")).toBeVisible();
    await expect(page.getByText("Support")).toBeVisible();
  });

  test("no mock CRM data reaches the screen", async ({ page }) => {
    await useState(page, "authenticated");
    await page.goto("/today");
    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();

    const html = await page.content();
    // Fixture names, buckets and workspace chrome from the mock dataset.
    for (const leak of ["Nina Chmiel", "$50–99", "Очередь на сегодня", "Пользователи CRM"]) {
      expect(html, `mock data leaked into api mode: ${leak}`).not.toContain(leak);
    }
    // No navigation into feature routes.
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });

  test("no sensitive session field is rendered", async ({ page }) => {
    await useState(page, "authenticated");
    await page.goto("/today");
    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();

    const html = await page.content();
    for (const secret of [
      "emp_stub_7f3a9c",
      "effectivePermissions",
      "edit_user_notes",
      "permissionVersion",
      "2099-12-31T23:59:59.000Z",
    ]) {
      expect(html, `session internals leaked: ${secret}`).not.toContain(secret);
    }
  });

  test("the dev role switch is absent for a backend session", async ({ page }) => {
    await useState(page, "authenticated");
    await page.goto("/today");
    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();
    await expect(page.getByText("Демо-роль (только dev)")).toHaveCount(0);
    await expect(page.getByText("Роль:")).toHaveCount(0);
  });
});

test.describe("same-origin proxy", () => {
  test("the browser calls a relative path and never the backend origin", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));

    await useState(page, "authenticated");
    await page.goto("/today");
    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();

    const sessionCalls = requested.filter((u) => u.includes("/api/crm/v1/session"));
    expect(sessionCalls.length).toBeGreaterThan(0);
    for (const url of sessionCalls) {
      // Same origin as the CRM — the rewrite happens server-side.
      expect(url.startsWith(`${SESSION_E2E.baseURL}/`)).toBe(true);
      expect(url).not.toContain(BACKEND_PORT_TOKEN);
    }
  });

  test("the session endpoint is reachable through the CRM origin", async ({ request }) => {
    const response = await request.get("/api/crm/v1/session", {
      headers: { cookie: `${STATE_COOKIE}=authenticated` },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).employeeId).toBe("emp_stub_7f3a9c");
  });

  test("no other backend path is exposed through the proxy", async ({ request }) => {
    // `users` joined the reviewed proxy surface in Frontend CRM Users API
    // Slice 1 and is covered by users-api.spec.ts. Everything else must still
    // be unreachable through both the rewrite list and the stub.
    for (const path of [
      // `/users/{one-segment}` became a reviewed proxied path in Frontend CRM
      // User Detail API Slice 2, so only NESTED paths are checked here.
      "/api/crm/v1/users/123/extra",
      // `/users/{id}/notes` became a reviewed proxied path in Frontend CRM User
      // Notes Slice 1 and is covered by user-notes-api.spec.ts. A child BELOW
      // it, and a TOP-LEVEL /notes route, must both still be unreachable.
      "/api/crm/v1/users/123/notes/note_1",
      "/api/crm/v1/users/123/notes/extra",
      "/api/crm/v1/notes",
      "/api/crm/v1/owner",
      "/api/crm/v1/audit",
      "/api/crm/v1/",
      "/api/crm/v1/session/extra",
      "/api/auth/login",
      "/api/health",
    ]) {
      const response = await request.get(path);
      expect(response.status(), `${path} must not proxy to the backend`).toBe(404);
    }
  });
});

test.describe("401 unauthenticated", () => {
  test("redirects to the exact login URL and shows no CRM chrome", async ({ page }) => {
    await useState(page, "unauthenticated");
    await page.goto("/today");

    await expect(page).toHaveURL(/\/login\?reason=session_required$/);

    // CRM-AUTH-1 replaced the Phase 1A placeholder — which had no form and simply
    // linked to /today — with the real staff credential form. This asserted the
    // placeholder's "Alfa Trade Academy CRM" heading, which now exists only in
    // mock mode, so it failed for the right reason: the page it described is gone.
    //
    // The replacement asserts the semantics that must hold whatever the panel is
    // called — an employee bounced off a protected route lands on a usable login
    // form — instead of one heading string.
    await expect(page.getByRole("heading", { name: "Вход для сотрудников" })).toBeVisible();
    await expect(page.getByLabel("Рабочий email")).toBeVisible();
    await expect(page.getByLabel("Пароль")).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();

    // Still no CRM chrome: no shell navigation, and not the deferred-section panel.
    await expect(page.getByRole("navigation")).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain("Раздел ещё не подключён");
  });

  test("stays on the login page instead of looping back into the protected route", async ({
    page,
  }) => {
    // The redirect is bounded: one hop to a fixed literal. A loop would leave the
    // URL changing and the form never settling, so the URL is re-checked after the
    // page has had time to perform any further navigation.
    await useState(page, "unauthenticated");
    await page.goto("/today");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);

    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
  });
});

test.describe("403 forbidden", () => {
  test("renders the safe no-access state with no chrome", async ({ page }) => {
    await useState(page, "forbidden");
    await page.goto("/today");

    await expect(page.getByText("Нет доступа к CRM")).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByText("Раздел ещё не подключён")).toHaveCount(0);
  });

  test("shows the requestId but not the backend message key", async ({ page }) => {
    await useState(page, "forbidden");
    await page.goto("/today");
    await expect(page.getByText("req_stub_403")).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain("errors.session.no_crm_access");
  });
});

test.describe("upstream and malformed", () => {
  test("500 renders a retry state with no raw diagnostics", async ({ page }) => {
    await useState(page, "server_error");
    await page.goto("/today");

    await expect(page.getByText("Сервис недоступен")).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();

    // The upstream body and any transport diagnostic must stay out of the DOM.
    // Needles are specific: a bare "internal" also matches Next's own
    // `app-pages-internals.js` chunk name.
    const body = await page.locator("body").innerText();
    const html = await page.content();
    for (const leak of ['{"error":"internal"}', "ECONNREFUSED", "ECONNRESET", BACKEND_ORIGIN_HOSTPORT, "socket hang up"]) {
      expect(html, `diagnostic leaked: ${leak}`).not.toContain(leak);
    }
    expect(body).not.toContain("500");
  });

  test("a connection drop renders the retry state", async ({ page }) => {
    await useState(page, "network_failure");
    await page.goto("/today");
    await expect(page.getByText("Сервис недоступен")).toBeVisible();
  });

  test("an unknown role fails closed", async ({ page }) => {
    await useState(page, "malformed");
    await page.goto("/today");

    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
    await expect(page.getByText("Раздел ещё не подключён")).toHaveCount(0);
  });

  test("an unexpected sensitive field fails closed and never renders", async ({ page }) => {
    await useState(page, "malformed_extra_field");
    await page.goto("/today");

    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
    expect(await page.content()).not.toContain("leaked@example.test");
  });

  test("a non-JSON body fails closed", async ({ page }) => {
    await useState(page, "not_json");
    await page.goto("/today");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
  });

  test("retry recovers once the upstream is healthy", async ({ page }) => {
    const errors = trackConsole(page);
    await useState(page, "server_error");
    await page.goto("/today");
    await expect(page.getByText("Сервис недоступен")).toBeVisible();

    // Flip the stub to a healthy response, then retry in place.
    await useState(page, "authenticated");
    await page.getByRole("button", { name: "Повторить" }).click();

    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});

test.describe("security regressions", () => {
  test("a stored mock crm_admin role cannot elevate an API session", async ({ page }) => {
    await useState(page, "authenticated");
    await page.goto("/today");
    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();

    // Plant the dev role key and reload: the backend session must be unchanged.
    await page.evaluate((key) => window.localStorage.setItem(key, "crm_admin"), MOCK_ROLE_KEY);
    await page.reload();

    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();
    // Still the backend's role, not the planted one.
    await expect(page.getByText("Support")).toBeVisible();
    await expect(page.getByText("Администратор CRM")).toHaveCount(0);
    await expect(page.getByText("Демо-роль (только dev)")).toHaveCount(0);
  });

  test("api mode never writes the mock role key", async ({ page }) => {
    await useState(page, "authenticated");
    await page.goto("/today");
    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), MOCK_ROLE_KEY);
    expect(stored).toBeNull();
  });

  test("role=crm_admin with no permissions grants no affordance", async ({ page }) => {
    await useState(page, "admin_no_permissions");
    await page.goto("/today");

    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();
    // The role label is honest…
    await expect(page.getByText("Администратор CRM")).toBeVisible();

    // …but nothing permission-gated appears, because effectivePermissions is empty
    // and the role is never allowed to re-grant locally.
    const html = await page.content();
    for (const affordance of [
      "Назначить владельца",
      "Экспорт",
      "Журнал аудита",
      "Добавить заметку",
      "Настройки",
    ]) {
      expect(html, `${affordance} must not be offered`).not.toContain(affordance);
    }
  });

  test("the backend origin never reaches the browser", async ({ page }) => {
    await useState(page, "authenticated");
    await page.goto("/today");
    await expect(page.getByText("Раздел ещё не подключён")).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain(BACKEND_PORT_TOKEN);
    expect(html).not.toContain("CRM_BACKEND_ORIGIN");
    // And no client-visible mode key.
    expect(html).not.toContain("NEXT_PUBLIC_CRM_MODE");
  });
});
