import { expect, test } from "@playwright/test";
import { AUTH_E2E, BACKEND_PORT_TOKEN, nextMentor } from "./support/auth-e2e-config";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  getCsrfCookie,
  getSessionCookie,
  loginAsStaff,
  warmRoutes,
} from "./support/helpers";

/**
 * Journeys F–J: logout, session expiry, CSRF, cookie attributes and test-cookie
 * rejection — all against the real backend.
 */

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await warmRoutes(page);
  await page.close();
});

test.describe("Journey F — logout", () => {
  test("logout clears the session and closes the protected route", async ({ page, context }) => {
    await loginAsStaff(page, nextMentor());
    expect(await getSessionCookie(context)).toBeDefined();

    await page.getByRole("button", { name: /^выйти$/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    // The browser no longer holds the cookie, so the CRM origin has no ambient
    // authority. (The backend token is a stateless HMAC with no server-side
    // session row, so this is cookie clearing, not revocation — recorded in the
    // phase audit rather than overstated here.)
    expect(await getSessionCookie(context)).toBeUndefined();

    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
  });

  test("logout clears the CSRF cookie too", async ({ page, context }) => {
    await loginAsStaff(page, nextMentor());
    // Logout fetches a CSRF token first, so the cookie exists by the time the
    // request is sent.
    await page.getByRole("button", { name: /^выйти$/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    expect(await getCsrfCookie(context)).toBeUndefined();
  });

  test("back navigation after logout does not reveal protected data", async ({ page }) => {
    await loginAsStaff(page, nextMentor());

    await page.getByRole("button", { name: /^выйти$/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    await page.goBack();
    // `replace` kept the workspace out of history and `refresh` dropped the
    // router cache, so going back cannot resurrect a rendered workspace.
    await expect(page).not.toHaveURL(/\/users$/, { timeout: 15_000 });
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Пользователи CRM");
  });
});

test.describe("Journey G — session expiry", () => {
  test("a deleted session cookie returns to login without a request storm", async ({
    page,
    context,
  }) => {
    await loginAsStaff(page, nextMentor());

    let sessionCalls = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/crm/v1/session")) sessionCalls += 1;
    });

    // Simulates expiry from the browser's side: the cookie is gone, exactly as
    // it would be once Max-Age elapsed.
    await context.clearCookies();
    await page.goto("/users");

    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
    await expect(page.getByText(/сессия завершена/i)).toBeVisible();

    // Bounded: the boundary asks once and redirects. A loop here would hammer
    // the backend on every unauthenticated visit.
    await page.waitForTimeout(2_000);
    expect(sessionCalls, `session endpoint called ${sessionCalls} times`).toBeLessThanOrEqual(3);
  });

  test("a tampered session cookie is rejected", async ({ page, context }) => {
    await loginAsStaff(page, nextMentor());

    const cookie = await getSessionCookie(context);
    expect(cookie).toBeDefined();

    // Flip the signature. The backend verifies an HMAC, so this must fail closed
    // rather than being accepted as some other user.
    await context.clearCookies();
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: `${cookie!.value.slice(0, -4)}0000`,
        domain: AUTH_E2E.host,
        path: "/",
      },
    ]);

    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
  });

  test("a forged unsigned session cookie is rejected", async ({ page, context }) => {
    await context.addCookies([
      {
        // Shape of a real token, but never signed with the server secret.
        name: SESSION_COOKIE,
        value: "1.admin.99999999999999.deadbeef",
        domain: AUTH_E2E.host,
        path: "/",
      },
    ]);

    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
  });

  test("no redirect loop occurs on the login page itself", async ({ page }) => {
    const logins: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) logins.push(frame.url());
    });

    await page.goto("/login");
    await page.waitForTimeout(2_000);

    // The login page is outside the session boundary, so it must never redirect.
    const loginVisits = logins.filter((u) => u.includes("/login")).length;
    expect(loginVisits, `login navigated ${loginVisits} times`).toBeLessThanOrEqual(2);
  });
});

test.describe("Journey H — CSRF", () => {
  test("the CRM CSRF route sets a script-readable cookie and echoes the token", async ({
    page,
    context,
  }) => {
    await page.goto("/login");

    const response = await page.request.get("/api/crm/auth/csrf");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { csrfToken?: string };
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken!.length).toBeGreaterThanOrEqual(32);

    const cookie = await getCsrfCookie(context);
    expect(cookie, "CSRF cookie was not bridged").toBeDefined();
    // Double-submit REQUIRES the client to read this one, so HttpOnly must be
    // false here — the opposite of the session cookie.
    expect(cookie!.httpOnly).toBe(false);
    expect(cookie!.value).toBe(body.csrfToken);
  });

  test("a write with a matching token succeeds", async ({ page, context }) => {
    await loginAsStaff(page, nextMentor());

    const token = (await page.request.get("/api/crm/auth/csrf").then((r) => r.json())) as {
      csrfToken: string;
    };
    const response = await page.request.post("/api/crm/auth/logout", {
      headers: { "x-csrf-token": token.csrfToken, "content-type": "application/json" },
      data: {},
    });
    expect(response.status()).toBe(200);
    expect(await getSessionCookie(context)).toBeUndefined();
  });

  test("a write with a WRONG token is rejected by the backend", async ({ page }) => {
    await loginAsStaff(page, nextMentor());
    await page.request.get("/api/crm/auth/csrf");

    const response = await page.request.post("/api/crm/auth/logout", {
      headers: { "x-csrf-token": "b".repeat(64), "content-type": "application/json" },
      data: {},
    });

    // The CRM route always answers 200 and clears cookies locally, but it reports
    // that the upstream refused — so the mismatch is visible, not swallowed.
    const body = (await response.json()) as { ok?: boolean; upstream?: string };
    expect(body.upstream).toBe("rejected");
  });

  test("a write with NO token is rejected by the backend", async ({ page }) => {
    await loginAsStaff(page, nextMentor());
    await page.request.get("/api/crm/auth/csrf");

    const response = await page.request.post("/api/crm/auth/logout", {
      headers: { "content-type": "application/json" },
      data: {},
    });
    const body = (await response.json()) as { upstream?: string };
    expect(body.upstream).toBe("rejected");
  });

  test("the token never reaches web storage or the URL", async ({ page }) => {
    await loginAsStaff(page, nextMentor());
    await page.request.get("/api/crm/auth/csrf");

    const storage = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
    expect(storage).not.toContain("csrf");
    expect(page.url()).not.toContain("csrf");
  });
});

test.describe("Journey I — cookie attributes", () => {
  test("the session cookie is HttpOnly, host-only, path /, lax and not Secure on http", async ({
    page,
    context,
  }) => {
    await loginAsStaff(page, nextMentor());

    const cookie = await getSessionCookie(context);
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.path).toBe("/");
    expect(cookie!.sameSite).toBe("Lax");
    // The CRM recomputes Secure from its own environment. This suite serves the
    // CRM over http, so a Secure cookie would never be sent back and every
    // authenticated test would fail opaquely.
    expect(cookie!.secure).toBe(false);
    // Host-only: the browser reports the exact host, never a parent domain.
    expect(cookie!.domain).toBe(AUTH_E2E.host);
    expect(cookie!.domain.startsWith(".")).toBe(false);
  });

  test("the session cookie carries the backend expiry, not a session lifetime", async ({
    page,
    context,
  }) => {
    await loginAsStaff(page, nextMentor());

    const cookie = await getSessionCookie(context);
    // The backend sends Max-Age=604800 (7 days). A corrupted Expires attribute
    // would show up here as -1 (a session cookie) or a past date.
    expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000);
    const days = (cookie!.expires - Date.now() / 1000) / 86_400;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
  });

  test("no cookie beyond the two bridged ones is set on the CRM origin", async ({
    page,
    context,
  }) => {
    await loginAsStaff(page, nextMentor());
    await page.request.get("/api/crm/auth/csrf");

    const names = (await context.cookies()).map((c) => c.name).sort();
    expect(names).toEqual([CSRF_COOKIE, SESSION_COOKIE].sort());
  });

  test("clearing is symmetric: logout removes exactly what login set", async ({
    page,
    context,
  }) => {
    await loginAsStaff(page, nextMentor());
    await page.request.get("/api/crm/auth/csrf");
    expect((await context.cookies()).length).toBe(2);

    await page.getByRole("button", { name: /^выйти$/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    const remaining = (await context.cookies()).filter(
      (c) => c.name === SESSION_COOKIE || c.name === CSRF_COOKIE,
    );
    expect(remaining).toEqual([]);
  });
});

test.describe("Journey J — deterministic test cookies are not authentication", () => {
  test("the session-suite test cookie grants no access", async ({ page, context }) => {
    // `ata_test_crm_session_state` selects a canned response from the stub used by
    // tests-e2e-session. Against the real backend it must be inert: production
    // code has never heard of it.
    await context.addCookies([
      { name: "ata_test_crm_session_state", value: "valid", domain: AUTH_E2E.host, path: "/" },
      { name: "ata_test_crm_users_state", value: "populated", domain: AUTH_E2E.host, path: "/" },
      { name: "ata_test_crm_notes_session", value: "crm_admin", domain: AUTH_E2E.host, path: "/" },
    ]);

    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?reason=session_required$/);
  });

  test("a test cookie cannot escalate an authenticated staff session", async ({ page, context }) => {
    await loginAsStaff(page, nextMentor());

    await context.addCookies([
      { name: "ata_test_crm_notes_session", value: "crm_admin", domain: AUTH_E2E.host, path: "/" },
    ]);
    await page.reload();

    // The identity still comes from the backend session endpoint: the pooled
    // account is a `mentor` StaffProfile, and the test cookie cannot rewrite that
    // into the `crm_admin` role it names. CRM_ROLE_LABEL.mentor is "Mentor".
    await expect(page.getByRole("banner")).toContainText("Mentor");
    await expect(page.getByRole("banner")).not.toContainText(/Администратор CRM/);
  });

  test("the backend origin is absent from every response body the browser sees", async ({
    page,
  }) => {
    const bodies: string[] = [];
    page.on("response", async (response) => {
      if (!response.url().startsWith(AUTH_E2E.baseURL)) return;
      const type = response.headers()["content-type"] ?? "";
      if (!type.includes("json") && !type.includes("html")) return;
      try {
        bodies.push(await response.text());
      } catch {
        /* a body that cannot be read cannot leak */
      }
    });

    await loginAsStaff(page, nextMentor());
    await page.waitForTimeout(500);

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain(BACKEND_PORT_TOKEN);
    }
  });
});
