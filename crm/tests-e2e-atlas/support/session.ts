/**
 * AFD-5D2A — one analyst session, reused by every browser test.
 *
 * WHY THIS EXISTS. The backend rate-limits login to 5 attempts per 10 minutes
 * per (ip, email). That is a REAL protection and the suite must not be exempt
 * from it. AFD-5D2 had a handful of browser tests and never noticed; this phase
 * added a four-viewport responsive matrix and nine accessibility tests, and the
 * eighteenth login came back `429`.
 *
 * The fix is to stop logging in eighteen times. A test that authenticates once
 * and reuses the session is also closer to what an operator does: nobody signs
 * in again to resize their window.
 *
 * NOTHING IS RELAXED TO ACHIEVE THIS. The limiter is untouched, the credentials
 * are unchanged, and the first login is still asserted to succeed — if
 * authentication breaks, every test still fails, immediately and loudly.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { ATLAS_E2E } from "../../playwright.atlas.config";

/** The cookie array shape Playwright's storage state publishes. */
type StorageCookies = Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];

/**
 * Cached for the lifetime of the worker process. Playwright may split spec files
 * across workers, in which case each worker logs in once — still far inside the
 * limiter's budget, and still a real login per process.
 */
let analystSession: StorageCookies | null = null;

/** Log in as the analyst, or reuse the session already obtained. */
export async function loginAsAnalyst(page: Page): Promise<void> {
  if (analystSession) {
    await page.context().addCookies(analystSession);
    return;
  }

  const response = await page.request.post("/api/crm/auth/login", {
    data: {
      email: ATLAS_E2E.analyst,
      password: ATLAS_E2E.password,
      captchaToken: "afd5d3-atlas-ui-e2e-token",
    },
  });

  if (response.status() !== 200) {
    // Thrown rather than asserted so the message names the cause: a 429 here
    // means the suite is spending logins, not that authentication is broken.
    throw new Error(
      `analyst login failed with ${response.status()}${
        response.status() === 429 ? " (rate limited — the suite is logging in too often)" : ""
      }: ${await response.text()}`,
    );
  }

  const { cookies } = await page.request.storageState();
  analystSession = cookies;
  await page.context().addCookies(cookies);
}
