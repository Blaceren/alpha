import { expect, test } from "@playwright/test";
import { AUTH_E2E, BACKEND_PORT_TOKEN, FIXTURE, nextMentor } from "./support/auth-e2e-config";
import { errorSummary, fillLogin, loginAsStaff, warmRoutes } from "./support/helpers";

/**
 * Authenticated API extensibility proof.
 *
 * Shows the new foundation can carry a real authenticated staff read end to end,
 * without implementing any MR-1 product surface. The probe is the already-accepted
 * `GET /api/crm/v1/users` — a staff-safe read that predates this phase — reached
 * through the CRM origin with a canonical backend session.
 *
 * What this establishes for MR-1: adding the reviewer queue and decision routes is
 * a matter of extending the explicit allowlist and writing the client. The session,
 * the cookie bridge, the CSRF helper and the staff boundary are already in place.
 *
 * No REPORT flag is enabled here, and no reviewer route is added.
 */

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await warmRoutes(page);
  await page.close();
});

test.describe("an authenticated staff read works through the CRM origin", () => {
  test("a mentor session reaches the allowlisted backend read", async ({ page }) => {
    const apiCalls: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/crm/v1/users")) {
        apiCalls.push({ url: response.url(), status: response.status() });
      }
    });

    await loginAsStaff(page, nextMentor());

    // The workspace rendered real backend rows, not a mock fallback: the seeded
    // synthetic learner is present.
    await expect(page.getByRole("link", { name: "CA1 Learner" })).toBeVisible();

    expect(apiCalls.length).toBeGreaterThan(0);
    for (const call of apiCalls) {
      expect(call.status).toBe(200);
      // Same-origin: the browser called the CRM, which proxied server-side.
      expect(call.url.startsWith(AUTH_E2E.baseURL)).toBe(true);
      expect(call.url).not.toContain(BACKEND_PORT_TOKEN);
    }
  });

  test("the read carries the canonical session, not an anonymous request", async ({ page }) => {
    // Without a session the same path must not return data. This is the control
    // for the test above: it proves the 200 came from the bridged cookie.
    const response = await page.request.get("/api/crm/v1/users", {
      headers: { accept: "application/json" },
    });
    expect([401, 403]).toContain(response.status());
  });

  test("a rejected learner never reaches the staff read", async ({ page }) => {
    const apiCalls: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/crm/v1/users")) apiCalls.push(response.status());
    });

    await page.goto("/login");
    await fillLogin(page, FIXTURE.learner);
    await expect(errorSummary(page)).toContainText(/нет доступа к crm/i);

    // No session was established, so the staff read was never even attempted.
    expect(apiCalls).toEqual([]);
  });

  test("an unauthenticated request to an unlisted backend path is not proxied", async ({ page }) => {
    // The rewrite allowlist is exact. A path that was never reviewed must not be
    // reachable through the CRM origin, which is what keeps this a bounded
    // server-mediated client rather than an open proxy.
    for (const path of [
      "/api/crm/v1/audit",
      "/api/crm/v1/users/1/extra",
      "/api/auth/login",
      "/api/csrf",
      "/api/curriculum/v2/report-reviews/queue",
    ]) {
      const response = await page.request.get(path, { failOnStatusCode: false });
      expect(
        response.status(),
        `${path} was proxied through the CRM origin`,
      ).not.toBe(200);
    }
  });
});
