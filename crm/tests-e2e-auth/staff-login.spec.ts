import { expect, test } from "@playwright/test";
import { AUTH_E2E, BACKEND_PORT_TOKEN, FIXTURE, nextMentor } from "./support/auth-e2e-config";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  errorSummary,
  fillLogin,
  getSessionCookie,
  loginAsStaff,
  warmRoutes,
} from "./support/helpers";

/**
 * Journeys A–E: real staff login against the real backend on an isolated
 * synthetic database.
 *
 * Every assertion runs through the CRM origin. The backend is reached only by the
 * CRM's server-side route handlers, and several tests assert the browser never
 * learns it exists.
 *
 * Each test that logs in spends a fresh pooled identity — see `nextMentor()`.
 */

const PASSWORD = AUTH_E2E.password;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await warmRoutes(page);
  await page.close();
});

test.describe("Journey A — mentor login", () => {
  test("a protected route redirects to login, then login returns to it", async ({
    page,
    context,
  }) => {
    await page.goto("/users");
    // No session yet: the boundary bounces to the fixed literal, with no
    // steerable return parameter in the URL.
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
    await expect(page.getByRole("heading", { name: /вход для сотрудников/i })).toBeVisible();
    await expect(page.getByText(/сессия завершена/i)).toBeVisible();

    await fillLogin(page, nextMentor());

    await expect(page).toHaveURL(/\/users$/, { timeout: 30_000 });

    const cookie = await getSessionCookie(context);
    expect(cookie, "session cookie was not bridged onto the CRM origin").toBeDefined();
    expect(cookie!.httpOnly, "session cookie must stay HttpOnly").toBe(true);
    // Host-only for the CRM origin: no Domain attribute was forwarded.
    expect(cookie!.domain).toBe(AUTH_E2E.host);
    expect(cookie!.path).toBe("/");
  });

  test("the session survives a full reload", async ({ page }) => {
    const email = nextMentor();
    await loginAsStaff(page, email);

    await page.reload();
    await expect(page).toHaveURL(/\/users$/);
    // Still authenticated: no bounce back to login.
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("the browser never contacts the backend origin directly", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await loginAsStaff(page, nextMentor());

    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(url.startsWith(AUTH_E2E.baseURL), `browser called ${url}`).toBe(true);
      expect(url).not.toContain(BACKEND_PORT_TOKEN);
    }
  });

  test("no rendered HTML discloses the backend origin", async ({ page }) => {
    await loginAsStaff(page, nextMentor());

    const html = await page.content();
    expect(html).not.toContain(BACKEND_PORT_TOKEN);
    expect(html).not.toContain("CRM_BACKEND_ORIGIN");
  });

  test("no auth material is written to web storage", async ({ page }) => {
    await loginAsStaff(page, nextMentor());

    const storage = await page.evaluate(() => ({
      local: Object.entries({ ...window.localStorage }),
      session: Object.entries({ ...window.sessionStorage }),
    }));

    // localStorage is untouched entirely. sessionStorage may only ever have held
    // the return path, and login consumes it.
    expect(storage.local).toEqual([]);
    const serialized = JSON.stringify(storage);
    for (const secret of [PASSWORD, SESSION_COOKIE, CSRF_COOKIE, "csrfToken"]) {
      expect(serialized, `web storage leaked ${secret}`).not.toContain(secret);
    }
  });
});

test.describe("Journey B — admin login", () => {
  test("an admin enters the staff workspace with no curriculum ADMIN flag", async ({ page }) => {
    // The isolated backend runs with NO CURRICULUM_V2_* flags set at all, so this
    // test passing is itself the proof that staff authentication does not depend
    // on CURRICULUM_V2_ADMIN_ENABLED.
    await loginAsStaff(page, FIXTURE.admin);
    // Scoped to the header: a staff member can also appear as a row in the
    // users list, so an unscoped match is ambiguous.
    await expect(page.getByRole("banner").getByText("CA1 Admin")).toBeVisible();
  });

  test("a staff role that is not a report reviewer also authenticates", async ({ page }) => {
    // `support` is staff but is NOT a report reviewer. Staff authentication and
    // reviewer authorization are separate axes; this proves the first does not
    // imply the second.
    await loginAsStaff(page, FIXTURE.support);
    // Scoped to the header: a staff member can also appear as a row in the
    // users list, so an unscoped match is ambiguous.
    await expect(page.getByRole("banner").getByText("CA1 Support")).toBeVisible();
  });
});

test.describe("Journey C — learner rejection", () => {
  test("valid learner credentials are refused at the staff boundary", async ({ page, context }) => {
    await page.goto("/login");
    await fillLogin(page, FIXTURE.learner);

    // The backend authenticates this account perfectly well; the CRM refuses it.
    await expect(errorSummary(page)).toContainText(/нет доступа к crm/i);

    // Still on login. No workspace, no learner identity rendered.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("CA1 Learner")).toHaveCount(0);

    // THE SELECTED SAFE BEHAVIOUR: no session cookie is established on the CRM
    // origin for a non-staff account. The cookie the backend minted was never
    // delivered to the browser, so the learner's sessions in other applications
    // are untouched — nothing was revoked there, and nothing was granted here.
    expect(await getSessionCookie(context)).toBeUndefined();
  });

  test("a rejected learner cannot reach a protected route", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, FIXTURE.learner);
    await expect(errorSummary(page)).toBeVisible();

    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
  });

  test("a learner who holds a StaffProfile is admitted as staff, not as a reviewer", async ({
    page,
  }) => {
    // role=user + StaffProfile(read_only). CRM staff access derives from the
    // StaffProfile axis, so this account IS staff here. Recorded explicitly
    // because MR-1 must not read CRM admission as reviewer authority: the
    // reviewer gate checks User.role, which is `user` for this identity.
    await loginAsStaff(page, FIXTURE.userStaff);
    // Scoped to the header: a staff member can also appear as a row in the
    // users list, so an unscoped match is ambiguous.
    await expect(page.getByRole("banner").getByText("CA1 UserStaff")).toBeVisible();
  });
});

test.describe("Journey D — invalid credentials", () => {
  test("a wrong password is refused with no session and no loop", async ({ page, context }) => {
    await page.goto("/login");
    await fillLogin(page, nextMentor(), "definitely-not-the-password");

    await expect(errorSummary(page)).toContainText(/неверные данные для входа/i);
    expect(await getSessionCookie(context)).toBeUndefined();
    await expect(page).toHaveURL(/\/login/);
  });

  test("an unknown account is indistinguishable from a wrong password", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, nextMentor(), "definitely-not-the-password");
    const wrongPassword = await errorSummary(page).textContent();

    await page.goto("/login");
    await fillLogin(page, FIXTURE.unknown, "definitely-not-the-password");
    const unknownAccount = await errorSummary(page).textContent();

    // Any divergence here would be account enumeration.
    expect(unknownAccount).toBe(wrongPassword);
  });

  test("the password is cleared and never appears in the URL", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, nextMentor(), "definitely-not-the-password");
    await expect(errorSummary(page)).toBeVisible();

    await expect(page.getByLabel(/^пароль$/i)).toHaveValue("");
    expect(page.url()).not.toContain("definitely-not-the-password");
  });

  test("the error summary receives focus", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, nextMentor(), "definitely-not-the-password");
    await expect(errorSummary(page)).toBeFocused();
  });

  test("a malformed email is rejected locally, with no request", async ({ page }) => {
    const posted: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/crm/auth/login")) posted.push(r.url());
    });

    await page.goto("/login");
    await fillLogin(page, "not-an-email");

    await expect(errorSummary(page)).toContainText(/проверьте email и пароль/i);
    // Local rejection costs no request and no rate-limit slot.
    expect(posted).toEqual([]);
  });
});

test.describe("Journey E — inactive staff", () => {
  test("a blocked mentor is refused with no session", async ({ page, context }) => {
    await page.goto("/login");
    await fillLogin(page, FIXTURE.inactive);

    await expect(errorSummary(page)).toContainText(/доступ приостановлен/i);
    expect(await getSessionCookie(context)).toBeUndefined();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a blocked mentor cannot reach a protected route", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, FIXTURE.inactive);
    await expect(errorSummary(page)).toBeVisible();

    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
  });
});

test.describe("Journey — rate limiting is preserved", () => {
  test("repeated failures for one address eventually return the rate-limited state", async ({
    page,
  }) => {
    // The backend allows 5 attempts per 10 minutes per (ip + email), counting
    // failures. Spending them on one dedicated address proves the CRM surfaces
    // the 429 as its own bounded state rather than mistaking it for a bad
    // password.
    const email = nextMentor();

    let sawRateLimited = false;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await page.goto("/login");
      await fillLogin(page, email, "definitely-not-the-password");
      await expect(errorSummary(page)).toBeVisible();
      const text = (await errorSummary(page).textContent()) ?? "";
      if (/слишком много попыток/i.test(text)) {
        sawRateLimited = true;
        break;
      }
    }

    expect(sawRateLimited, "the backend rate limit never surfaced in the CRM UI").toBe(true);
  });
});
