import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { AUTH_E2E } from "./auth-e2e-config";

export const SESSION_COOKIE = "trading_platform_session";
export const CSRF_COOKIE = "trading_platform_csrf";

/**
 * The login form's error summary.
 *
 * Scoped to the form on purpose: Next's App Router injects its own
 * `<div role="alert" id="__next-route-announcer__">` into every page, so a bare
 * `getByRole("alert")` matches two elements and fails Playwright's strict mode.
 * Scoping is better than `.first()` here — it asserts we found *our* alert rather
 * than whichever happened to be first in the DOM.
 */
export function errorSummary(page: Page): Locator {
  return page.locator("form").getByRole("alert");
}

export async function fillLogin(page: Page, email: string, password = AUTH_E2E.password) {
  await page.getByLabel(/рабочий email/i).fill(email);
  await page.getByLabel(/^пароль$/i).fill(password);
  await page.getByRole("button", { name: /^войти$/i }).click();
}

export async function getSessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
}

export async function getCsrfCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === CSRF_COOKIE);
}

/**
 * Log in and land on the workspace.
 *
 * The generous URL timeout is a dev-server accommodation, not slack in the
 * product: `next dev` compiles a route the first time it is requested, and the
 * post-login navigation to `/users` is often that first request. `warmRoutes`
 * below removes most of the wait; this covers the rest.
 */
export async function loginAsStaff(page: Page, email: string) {
  await page.goto("/login");
  await fillLogin(page, email);
  await expect(page).toHaveURL(/\/users$/, { timeout: 30_000 });
}

/**
 * Compile the routes the suite navigates to, once per worker.
 *
 * Without this, the first post-login `router.replace("/users")` races the dev
 * server's on-demand compilation and looks like a redirect that never happened.
 */
export async function warmRoutes(page: Page) {
  for (const route of ["/login", "/users"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
  }
}
