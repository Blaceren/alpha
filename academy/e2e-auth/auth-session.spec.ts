import { test, expect, type Page } from "@playwright/test";
import {
  ACADEMY_BASE_URL,
  LEARNER_EMAIL,
  LEARNER_PASSWORD,
  WRONG_PASSWORD,
} from "./support/e2e-auth-config";

/**
 * Isolated real-session auth E2E (CI-1). Runs the Academy in api mode against an
 * isolated Backend. Verifies the httpOnly signed session cookie works through
 * the same-origin proxy, that no auth token is exposed to JavaScript, and that
 * logout preserves drafts. The cookie VALUE is never printed, screenshot or
 * traced.
 */

const DEV_PORTS = [":3100", ":3010"];

function failIfDevPortTouched(page: Page): void {
  page.on("request", (request) => {
    const url = request.url();
    for (const marker of DEV_PORTS) {
      if (url.includes(marker)) {
        throw new Error(`A request touched a live DEV port: ${url}`);
      }
    }
  });
}

async function login(page: Page, password = LEARNER_PASSWORD) {
  await page.getByLabel("Email").fill(LEARNER_EMAIL);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

test.describe("Academy real-session authentication", () => {
  test("unauthenticated protected route redirects to /login and restores it after login", async ({ page }) => {
    failIfDevPortTouched(page);

    // 1-2. Unauthenticated visit to a protected route -> /login with returnTo.
    await page.goto(`${ACADEMY_BASE_URL}/path`);
    await expect(page).toHaveURL(/\/login\?next=%2Fpath$/);

    // 3-4. Login with the synthetic learner; Backend sets the real cookie; the
    // original internal route is restored.
    await login(page);
    await expect(page).toHaveURL(`${ACADEMY_BASE_URL}/path`);

    // 5. Refresh remains authenticated (no redirect back to login).
    await page.reload();
    await expect(page).toHaveURL(`${ACADEMY_BASE_URL}/path`);

    // 6. A second protected route loads.
    await page.goto(`${ACADEMY_BASE_URL}/lessons`);
    await expect(page).toHaveURL(`${ACADEMY_BASE_URL}/lessons`);

    // 7. JavaScript cannot read the httpOnly session cookie.
    const jsCookies = await page.evaluate(() => document.cookie);
    expect(jsCookies).not.toContain("trading_platform_session");

    // 8. No auth token in localStorage/sessionStorage.
    const storage = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    const suspicious = /(token|session|auth|jwt|bearer)/i;
    expect(storage.local.filter((k) => suspicious.test(k))).toHaveLength(0);
    expect(storage.session.filter((k) => suspicious.test(k))).toHaveLength(0);

    // The cookie IS present at the HTTP layer, and IS httpOnly (value not read).
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "trading_platform_session");
    expect(session, "session cookie exists").toBeTruthy();
    expect(session?.httpOnly, "session cookie is httpOnly").toBe(true);
  });

  test("logout returns to login, re-guards protected routes, and preserves drafts", async ({ page }) => {
    failIfDevPortTouched(page);
    await page.goto(`${ACADEMY_BASE_URL}/login`);
    await login(page);
    await expect(page).toHaveURL(`${ACADEMY_BASE_URL}/`);

    // A user draft that logout must NOT delete.
    await page.evaluate(() => {
      window.localStorage.setItem("ata.tools.trading-journal.v1", "journal-keep");
      window.localStorage.setItem("ata.report-workspace.v3", "draft-keep");
    });

    // 11. Logout via the shell control.
    await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // 12. Protected route redirects back to login.
    await page.goto(`${ACADEMY_BASE_URL}/tools`);
    await expect(page).toHaveURL(/\/login\?next=%2Ftools$/);

    // 13. Drafts / tool data remain intact after logout.
    const drafts = await page.evaluate(() => ({
      journal: window.localStorage.getItem("ata.tools.trading-journal.v1"),
      report: window.localStorage.getItem("ata.report-workspace.v3"),
    }));
    expect(drafts.journal).toBe("journal-keep");
    expect(drafts.report).toBe("draft-keep");

    // The httpOnly session cookie is cleared server-side after logout.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "trading_platform_session")?.value ?? "").toBe("");
  });

  test("wrong password shows a generic, enumeration-safe error", async ({ page }) => {
    failIfDevPortTouched(page);
    await page.goto(`${ACADEMY_BASE_URL}/login`);
    await login(page, WRONG_PASSWORD);
    const alert = page.locator("p.login-error");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/Неверный email или пароль/);
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown user and wrong password are indistinguishable in wording", async ({ page }) => {
    failIfDevPortTouched(page);
    await page.goto(`${ACADEMY_BASE_URL}/login`);
    await page.getByLabel("Email").fill("nobody-here@ci1.test");
    await page.getByLabel("Пароль").fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.locator("p.login-error")).toHaveText(/Неверный email или пароль/);
  });

  test("an external returnTo cannot redirect outside the Academy", async ({ page }) => {
    failIfDevPortTouched(page);
    await page.goto(`${ACADEMY_BASE_URL}/login?next=https://evil.example.com/`);
    await login(page);
    // Open redirect blocked: lands on the internal default home, same origin.
    await expect(page).toHaveURL(`${ACADEMY_BASE_URL}/`);
  });
});
