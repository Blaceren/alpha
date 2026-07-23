import { test, expect, type Page } from "@playwright/test";
import { SESSION_E2E, BACKEND_ORIGIN_HOSTPORT, BACKEND_PORT_TOKEN } from "./support/e2e-config";

/**
 * Production User Detail foundation at `/users/[userId]`, proved in a real
 * browser against the deterministic stub. The stub's detail response is chosen
 * by a test-only cookie set here — the production client knows nothing about it.
 *
 * These tests take no screenshots: nothing here is a tracked visual baseline.
 */

const SESSION_COOKIE = "ata_test_crm_session_state";
const USERS_COOKIE = "ata_test_crm_users_state";
const DETAIL_COOKIE = "ata_test_crm_user_detail_state";

type SessionState = "authenticated" | "admin_no_permissions";
type DetailState =
  | "active"
  | "blocked"
  | "full_email"
  | "unconfirmed"
  | "zero_xp"
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "staff_hidden"
  | "system_hidden"
  | "server_error"
  | "malformed"
  | "malformed_extra_field"
  | "not_json"
  | "network_failure"
  | "delayed";

async function useStates(page: Page, session: SessionState, detail: DetailState) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: session, domain: "127.0.0.1", path: "/" },
    { name: USERS_COOKIE, value: "populated", domain: "127.0.0.1", path: "/" },
    { name: DETAIL_COOKIE, value: detail, domain: "127.0.0.1", path: "/" },
  ]);
}

const learner = (page: Page) =>
  page.getByRole("heading", { name: "Целевой Пользователь" });

/** Detail requests observed by the browser, for "no request" assertions. */
function trackDetailRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/crm\/v1\/users\/[^/?]+$/.test(r.url())) seen.push(r.url());
  });
  return seen;
}

test.describe("same-origin proxy", () => {
  test("the exact one-segment detail path is proxied", async ({ request }) => {
    const response = await request.get("/api/crm/v1/users/101", {
      headers: { cookie: `${DETAIL_COOKIE}=active` },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).userId).toBe("101");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });

  test("nested learner subroutes other than notes, owner and owner-history are not proxied", async ({ request }) => {
    // `/notes`, `/owner` and `/owner/history` are the THREE reviewed nested paths
    // (Notes Slice 1, Owner Slice 1, Owner History OH-1). Everything else under a
    // learner — and any child below them — stays unreachable.
    for (const path of [
      "/api/crm/v1/users/101/extra",
      "/api/crm/v1/users/101/notes/note_1",
      "/api/crm/v1/users/101/owner/emp_1",
      "/api/crm/v1/users/101/owner/history/hist_1",
      "/api/crm/v1/users/101/audit",
      "/api/crm/v1/users/101/timeline",
    ]) {
      const response = await request.get(path);
      expect(response.status(), `${path} must not proxy to the backend`).toBe(404);
    }
  });

  test("a malformed single segment reaches the backend, which owns validation", async ({ request }) => {
    // The proxy forwards one segment; the backend answers its canonical 400.
    const response = await request.get("/api/crm/v1/users/mock_user_1", {
      headers: { cookie: `${DETAIL_COOKIE}=invalid_input` },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe("invalid_input");
  });
});

test.describe("navigation from the list", () => {
  test("a Users row opens the production detail route", async ({ page }) => {
    await useStates(page, "authenticated", "active");
    await page.goto("/users");
    await expect(page.getByText("Пользователь 00")).toBeVisible();

    await page.getByRole("link", { name: "Пользователь 00" }).click();

    await expect(page).toHaveURL(/\/users\/1000$/);
    await expect(learner(page)).toBeVisible();
  });

  test("the back link returns to the list", async ({ page }) => {
    await useStates(page, "authenticated", "active");
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();

    await page.getByRole("link", { name: /К списку пользователей/ }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByText("Пользователь 00")).toBeVisible();
  });
});

test.describe("populated detail", () => {
  test("renders an active learner with level, xp and registration date", async ({ page }) => {
    await useStates(page, "authenticated", "active");
    await page.goto("/users/101");

    await expect(learner(page)).toBeVisible();
    await expect(page.getByText("Активен")).toBeVisible();
    await expect(page.getByText("t***@e***.test")).toBeVisible();
    await expect(page.getByText("Скрытый email")).toBeVisible();
    await expect(page.getByText("Подтверждён", { exact: true })).toBeVisible();
    await expect(page.getByText("7", { exact: true })).toBeVisible();
    await expect(page.getByText("4242")).toBeVisible();
    await expect(page.getByText("01.01.2026")).toBeVisible();
  });

  test("renders a blocked learner", async ({ page }) => {
    await useStates(page, "authenticated", "blocked");
    await page.goto("/users/101");
    await expect(page.getByText("Заблокирован")).toBeVisible();
  });

  test("renders a full email when the backend sent one", async ({ page }) => {
    await useStates(page, "authenticated", "full_email");
    await page.goto("/users/101");
    await expect(page.getByText("target-learner@example.test")).toBeVisible();
    await expect(page.getByText("Полный email")).toBeVisible();
  });

  test("renders an unconfirmed email", async ({ page }) => {
    await useStates(page, "authenticated", "unconfirmed");
    await page.goto("/users/101");
    await expect(page.getByText("Не подтверждён")).toBeVisible();
  });

  test("renders zero xp truthfully", async ({ page }) => {
    await useStates(page, "authenticated", "zero_xp");
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toBeVisible();
  });

  test("a crm_admin session with no permissions still sees only the masked email", async ({ page }) => {
    await useStates(page, "admin_no_permissions", "active");
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();
    await expect(page.getByText("Скрытый email")).toBeVisible();
    expect(await page.content()).not.toContain("target-learner@example.test");
  });
});

test.describe("only truthful sections appear", () => {
  test("shows the owner section but no mock-only sections", async ({ page }) => {
    await useStates(page, "authenticated", "active");
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();

    // Owner v1 is a truthful connected section — it must appear, under its
    // production label «Ответственный», never the mock's «Владелец».
    await expect(page.getByRole("heading", { name: "Ответственный" })).toBeVisible();

    const visible = await page.locator("body").innerText();
    for (const banned of [
      // «Владелец» is the MOCK owner label; production uses «Ответственный».
      "Владелец", "Заметки", "Баланс", "Депозит", "Активность",
      "Рекомендаци", "Приоритет", "Сегмент", "Задачи", "Кейсы", "Достижени", "360",
    ]) {
      expect(visible, `must not render ${banned}`).not.toContain(banned);
    }
  });

  test("offers no mutation control", async ({ page }) => {
    await useStates(page, "authenticated", "active");
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();

    const visible = await page.locator("body").innerText();
    for (const banned of ["Заблокировать", "Разблокировать", "Редактировать", "Удалить", "Сбросить пароль", "Сохранить"]) {
      expect(visible, `must not offer ${banned}`).not.toContain(banned);
    }
    // Scope to the CRM content region: Next's dev overlay injects its own button.
    await expect(page.locator("#crm-content").getByRole("button")).toHaveCount(0);
  });

  test("no mock fixture, employeeId or backend origin reaches the page", async ({ page }) => {
    await useStates(page, "authenticated", "active");
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();

    const html = await page.content();
    for (const leak of ["Nina Chmiel", "$50–99", "usr_mock", "emp_stub", "effectivePermissions", BACKEND_PORT_TOKEN, "CRM_BACKEND_ORIGIN"]) {
      expect(html, `leaked ${leak}`).not.toContain(leak);
    }
  });
});

test.describe("invalid id is answered locally", () => {
  for (const bad of ["0", "01", "mock_user_1", "emp_backend_001", "1.5", "2147483648"]) {
    test(`"${bad}" renders the invalid-id state and sends no detail request`, async ({ page }) => {
      const seen = trackDetailRequests(page);
      await useStates(page, "authenticated", "active");
      await page.goto(`/users/${encodeURIComponent(bad)}`);

      await expect(page.getByText("Некорректный идентификатор пользователя")).toBeVisible();
      expect(seen, `a request was sent for ${bad}`).toHaveLength(0);
      await expect(page.getByRole("link", { name: /К списку пользователей/ })).toBeVisible();
    });
  }
});

test.describe("error states", () => {
  test("400 from the backend renders the safe invalid-id state", async ({ page }) => {
    await useStates(page, "authenticated", "invalid_input");
    await page.goto("/users/101");
    await expect(page.getByText("Некорректный идентификатор пользователя")).toBeVisible();
    expect(await page.content()).not.toContain("crm.users.detail.user_id_invalid");
  });

  test("401 redirects to the exact login URL", async ({ page }) => {
    await useStates(page, "authenticated", "unauthenticated");
    await page.goto("/users/101");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
    expect(await page.content()).not.toContain("Целевой Пользователь");
  });

  test("403 renders the safe no-access state", async ({ page }) => {
    await useStates(page, "authenticated", "forbidden");
    await page.goto("/users/101");
    await expect(page.getByText("Нет доступа к данным CRM")).toBeVisible();
    expect(await page.content()).not.toContain("crm.session.not_staff");
  });

  test("404 renders the safe not-found state", async ({ page }) => {
    await useStates(page, "authenticated", "not_found");
    await page.goto("/users/101");
    await expect(page.getByText("Пользователь не найден")).toBeVisible();
    await expect(page.getByRole("link", { name: /К списку пользователей/ })).toBeVisible();
  });

  test("a hidden staff or system account uses identical visible copy", async ({ page }) => {
    // The backend cannot distinguish these, and neither may the UI.
    const seen: string[] = [];
    for (const state of ["not_found", "staff_hidden", "system_hidden"] as const) {
      await useStates(page, "authenticated", state);
      await page.goto("/users/101");
      await expect(page.getByText("Пользователь не найден")).toBeVisible();
      seen.push(await page.locator("body").innerText());
    }
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1]).toBe(seen[2]);
  });

  test("500 renders retry and no raw diagnostics", async ({ page }) => {
    await useStates(page, "authenticated", "server_error");
    await page.goto("/users/101");
    await expect(page.getByText("Сервис недоступен")).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();

    const html = await page.content();
    for (const leak of ["ECONNREFUSED", "ECONNRESET", BACKEND_ORIGIN_HOSTPORT, "crm.users.detail.internal"]) {
      expect(html).not.toContain(leak);
    }
  });

  test("a connection drop renders the retry state", async ({ page }) => {
    await useStates(page, "authenticated", "network_failure");
    await page.goto("/users/101");
    await expect(page.getByText("Сервис недоступен")).toBeVisible();
  });

  test("an unknown status value fails closed", async ({ page }) => {
    await useStates(page, "authenticated", "malformed");
    await page.goto("/users/101");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
    expect(await page.content()).not.toContain("Целевой Пользователь");
  });

  test("a fabricated ownerId fails closed and never renders", async ({ page }) => {
    await useStates(page, "authenticated", "malformed_extra_field");
    await page.goto("/users/101");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
    expect(await page.content()).not.toContain("emp_leak");
  });

  test("a non-JSON body fails closed", async ({ page }) => {
    await useStates(page, "authenticated", "not_json");
    await page.goto("/users/101");
    await expect(page.getByText("Некорректный ответ сервиса")).toBeVisible();
  });

  test("clicks during an in-flight retry do not stack requests", async ({ page }) => {
    const seen = trackDetailRequests(page);
    await useStates(page, "authenticated", "server_error");
    await page.goto("/users/101");
    await expect(page.getByText("Сервис недоступен")).toBeVisible();

    // Switch the stub to a response that stays open, so the next retry is
    // genuinely in flight while the following clicks happen. (Against a
    // fast-failing stub, sequential retries legitimately produce a request
    // each — single-flight prevents CONCURRENT requests, not later ones.)
    await page.context().addCookies([
      { name: DETAIL_COOKIE, value: "delayed", domain: "127.0.0.1", path: "/" },
    ]);

    const before = seen.length;
    const button = page.getByRole("button", { name: "Повторить" });
    await button.click();

    // While the retry is in flight the control is removed entirely, so a second
    // click is not merely ignored — it is impossible. That is a stronger
    // guarantee than dropping duplicate handler calls.
    await expect(button).toHaveCount(0);
    // Deterministic signal rather than a fixed sleep: the retrying state is on
    // screen, which means the single request is genuinely in flight.
    await expect(page.getByText("Загружаем данные пользователя")).toBeAttached();

    // Exactly one request from the click; nothing stacked behind it.
    expect(seen.length - before).toBe(1);
  });
});

test.describe("nested routes stay deferred", () => {
  test("/users/101/notes is not a connected section", async ({ page }) => {
    await useStates(page, "authenticated", "active");
    await page.goto("/users/101/notes");

    // No such Next route exists, so the app's own 404 answers — which is the
    // correct "this section does not exist" result. No learner data leaks.
    await expect(page.getByText("Страница не найдена")).toBeVisible();
    expect(await page.content()).not.toContain("Целевой Пользователь");
  });
});
