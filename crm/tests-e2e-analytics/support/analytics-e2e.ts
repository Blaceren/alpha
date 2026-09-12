import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BrowserContext, Page, APIRequestContext } from "@playwright/test";
import { ANALYTICS_E2E } from "../../playwright.analytics.config";

/**
 * AFD-5C1 — shared helpers for the analytics E2E suite.
 *
 * AUTHENTICATION GOES THROUGH THE REAL CRM LOGIN ROUTE. The Turnstile widget
 * itself is not driven, because rendering it requires Cloudflare's script host
 * and this journey runs on an isolated loopback machine with no egress. The
 * backend runs in explicit Turnstile TEST mode, where the documented always-pass
 * test secret accepts any token — so posting to `/api/crm/auth/login` exercises
 * the real CRM auth route, the real backend session and the real cookie bridge,
 * and only the visual challenge is skipped.
 *
 * The resulting session cookies are copied into the browser context, so every
 * page load afterwards is an ordinary authenticated CRM request.
 */

export const CREDENTIALS = {
  password: "AffiliateAnalyticsUiE2E123!",
  /** Holds view_affiliate_analytics and nothing that manages anything. */
  analyst: "afd5c1-e2e-analyst@example.invalid",
  /** Holds manage_settings. */
  admin: "afd5c1-e2e-crm-admin@example.invalid",
  /** Staff with neither permission. */
  unauthorized: "afd5c1-e2e-support@example.invalid",
  /** Authenticated, but no StaffProfile at all. */
  learner: "afd5c1-e2e-learner@example.invalid",
} as const;

export const ANALYTICS_PATH = "/affiliates/analytics";

/**
 * One real login per identity, reused for the rest of the run.
 *
 * The backend rate-limits login per (IP, email) — five attempts in ten minutes,
 * which is correct production behaviour and which a suite that logged in inside
 * every `beforeEach` would trip after the fifth test, turning a passing suite
 * into a wall of 429s that look like product failures. The FIRST call for an
 * identity performs a genuine end-to-end login through the CRM route; later
 * calls replay the resulting cookies into the new browser context.
 *
 * The login itself is therefore still proved — once per identity, against the
 * real route and the real backend — without the suite behaving like an attacker.
 */
type CachedSession = { status: number; cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"] };

/**
 * The cache is on DISK, not in module scope.
 *
 * Playwright restarts its worker process after a test times out, which would
 * reset an in-memory cache and send the suite back to the login endpoint — and
 * then, a few restarts later, into the rate limiter, turning one real failure
 * into a cascade of 429s that hides it. A file survives the restart.
 */
const CACHE_FILE = path.join(
  process.env.ANALYTICS_E2E_SHOT_DIR ?? os.tmpdir(),
  ".analytics-e2e-sessions.json",
);

function readCache(): Record<string, CachedSession> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Record<string, CachedSession>;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedSession>) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), { mode: 0o600 });
  } catch {
    /* a cache miss is survivable; a crash here is not worth it */
  }
}

export async function signIn(
  context: BrowserContext,
  request: APIRequestContext,
  email: string,
): Promise<number> {
  const cache = readCache();
  const cached = cache[email];
  if (cached) {
    if (cached.cookies.length > 0) await context.addCookies(cached.cookies);
    return cached.status;
  }

  let status = 0;
  let cookies: CachedSession["cookies"] = [];

  // The login limiter is a rolling window per (IP, email). A clean run logs in
  // once per identity and never approaches it, but a re-run started inside a
  // previous run's window would otherwise fail every test with a 429 that looks
  // like a product defect. Waiting the window out is bounded and explicit.
  for (let attempt = 0; attempt < LOGIN_ATTEMPTS; attempt += 1) {
    const response = await request.post(`${ANALYTICS_E2E.baseURL}/api/crm/auth/login`, {
      data: {
        email,
        password: CREDENTIALS.password,
        captchaToken: "afd5c1-analytics-ui-e2e-token",
      },
    });
    status = response.status();
    if (status !== 429) {
      cookies = response.ok() ? (await request.storageState()).cookies : [];
      break;
    }
    if (attempt < LOGIN_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, LOGIN_RETRY_MS));
    }
  }

  // A FAILED login is never cached: caching it would make one transient refusal
  // poison every remaining test in the run.
  if (status === 200 || status === 401 || status === 403) {
    writeCache({ ...readCache(), [email]: { status, cookies } });
  }
  if (cookies.length > 0) await context.addCookies(cookies);
  return status;
}

// One retry only: it must fit inside the per-test timeout, and a clean run
// never needs even that.
const LOGIN_ATTEMPTS = 2;
const LOGIN_RETRY_MS = 65_000;

export async function signOut(context: BrowserContext) {
  await context.clearCookies();
}

/**
 * Record every request the page makes, so a spec can prove what was NOT called.
 *
 * The lead endpoints are the ones that matter: AFD-5C1 must not touch them, and
 * an assertion over the actual network log is the only proof that holds after
 * somebody adds an import.
 */
export function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

/** Fail loudly if the page logs an uncaught error. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

/** Wait until the workspace has painted real data rather than a skeleton. */
export async function waitForAnalytics(page: Page) {
  await page.getByRole("heading", { name: "Аналитика аффилейтов" }).waitFor();
  await page
    .locator("text=Загружаем сводку…")
    .waitFor({ state: "detached", timeout: 30_000 })
    .catch(() => {
      /* already loaded */
    });
}

/**
 * Wait until EVERY section has finished loading.
 *
 * `waitForAnalytics` only settles the summary, which is enough for an assertion
 * scoped to one section but not for a screenshot: the first 390px capture showed
 * three loading blocks and was evidence of nothing.
 */
export async function waitForAllSections(page: Page) {
  await waitForAnalytics(page);
  for (const label of ["Загружаем график…", "Загружаем детализацию…", "Загружаем когорту…", "Загружаем график когорт…"]) {
    await page
      .locator(`text=${label}`)
      .waitFor({ state: "detached", timeout: 30_000 })
      .catch(() => {
        /* that section was never in this mode */
      });
  }
}

/**
 * Choose a `<select>` option by a substring of its visible text.
 *
 * The option labels carry a display name, an immutable code and a status suffix
 * ("Affiliate Alpha (alpha)", "Link Alpha Two (…) — на паузе"), so an exact-text
 * match would be brittle and `selectOption` accepts no pattern. Resolving the
 * VALUE first keeps the assertion about the affiliate, not about its label text.
 */
export async function selectByText(page: Page, fieldLabel: string, needle: string) {
  // `exact` matters: "Аффилейт" would otherwise also match the
  // "Разделы аффилейтов" landmark and the "Аффилейты" dimension radio.
  const select = page.getByLabel(fieldLabel, { exact: true });
  const value = await select.evaluate((node, text) => {
    const element = node as HTMLSelectElement;
    const match = Array.from(element.options).find((option) =>
      option.textContent?.includes(text),
    );
    if (!match) throw new Error(`no option containing "${text}"`);
    return match.value;
  }, needle);
  await select.selectOption(value);
  return value;
}

/**
 * Choose a segmented-control option by its visible label.
 *
 * The coverage and dimension controls are radios rendered `sr-only` inside a
 * visible `<label>` — the standard accessible segmented-control pattern: the
 * input stays focusable and keyboard-operable, and the label is what a pointer
 * hits. Clicking the INPUT therefore fails with "label intercepts pointer
 * events", which is the browser correctly describing how a user would interact.
 */
export async function chooseOption(page: Page, groupName: string, optionLabel: string) {
  const group = page.getByRole("radiogroup", { name: groupName });
  await group.getByText(optionLabel, { exact: true }).click();
}

/**
 * True when the APPLICATION scrolls horizontally — §37 forbids it at every width.
 *
 * Measured on `document.body`, not on `document.documentElement`, and that
 * distinction is deliberate. This suite drives the CRM through `next dev`, which
 * injects a dev-tools indicator OUTSIDE the application's own layout. At a 160px
 * viewport that indicator alone reports `html.scrollWidth = 198` against
 * `body.scrollWidth = 160` — an overflow that belongs to the development server
 * and does not exist in a production build.
 *
 * `body` is the containing block for the entire CRM shell, so any element the
 * PRODUCT lays out too wide still widens it: the real 320px regression this
 * phase found (the sign-out button pushed to x=365) is caught identically by
 * either measurement. Only the dev artefact is excluded.
 */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // One pixel of slack for sub-pixel rounding in the layout engine.
    return document.body.scrollWidth > document.body.clientWidth + 1;
  });
}
