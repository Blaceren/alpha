import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { LEADS_E2E } from "../../playwright.leads.config";

/**
 * AFD-5C2 — shared helpers for the affiliate lead E2E suite.
 *
 * AUTHENTICATION GOES THROUGH THE REAL CRM LOGIN ROUTE. The Turnstile widget
 * itself is not driven, because rendering it requires Cloudflare's script host
 * and this journey runs on an isolated loopback machine with no egress. The
 * backend runs in explicit Turnstile TEST mode, where the documented
 * always-pass test secret accepts any token — so posting to
 * `/api/crm/auth/login` exercises the real CRM auth route, the real backend
 * session and the real cookie bridge, and only the visual challenge is skipped.
 */

export interface LeadFixture {
  email: string;
  name: string;
  leadId: string;
  maskedEmail: string;
}

export interface Fixtures {
  backendOrigin: string;
  crmPort: number;
  password: string;
  staff: { crm_admin: string; analyst: string; support: string };
  leads: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G" | "P", LeadFixture>;
  partners: { alpha: string; beta: string };
  campaigns: { alphaOne: string; betaOne: string };
  links: { a1: string; a2: string; b1: string };
}

export const FIXTURES: Fixtures = JSON.parse(
  fs.readFileSync(LEADS_E2E.fixturesPath, "utf8"),
) as Fixtures;

export const LEADS_PATH = "/affiliates/leads";

export function leadPath(leadId: string): string {
  return `${LEADS_PATH}/${leadId}`;
}

/**
 * Every full identity the seeded population holds.
 *
 * The suite asserts against this list rather than against one address, so a leak
 * of ANY learner — not just the one a test happens to be looking at — fails.
 */
export const ALL_FULL_EMAILS: string[] = Object.values(FIXTURES.leads).map((lead) => lead.email);
export const ALL_FULL_NAMES: string[] = Object.values(FIXTURES.leads).map((lead) => lead.name);

/* ------------------------------------------------------------------- login */

type CachedSession = {
  status: number;
  cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];
};

/**
 * The cache is on DISK, not in module scope.
 *
 * Playwright restarts its worker process after a test times out, which would
 * reset an in-memory cache and send the suite back to the login endpoint — and
 * then, a few restarts later, into the rate limiter, turning one real failure
 * into a cascade of 429s that hides it. A file survives the restart.
 */
const CACHE_FILE = path.join(
  process.env.LEADS_E2E_SHOT_DIR ?? os.tmpdir(),
  ".leads-e2e-sessions.json",
);

const LOGIN_ATTEMPTS = 2;
const LOGIN_RETRY_MS = 65_000;

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

/**
 * One real login per identity, reused for the rest of the run.
 *
 * The backend rate-limits login per (IP, email) — five attempts in ten minutes,
 * which is correct production behaviour and which a suite that logged in inside
 * every `beforeEach` would trip, turning a passing suite into a wall of 429s
 * that look like product failures.
 */
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

  for (let attempt = 0; attempt < LOGIN_ATTEMPTS; attempt += 1) {
    const response = await request.post(`${LEADS_E2E.baseURL}/api/crm/auth/login`, {
      data: {
        email,
        password: FIXTURES.password,
        captchaToken: "afd5c2-leads-ui-e2e-token",
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
    cache[email] = { status, cookies };
    writeCache(cache);
  }
  if (cookies.length > 0) await context.addCookies(cookies);
  return status;
}

export async function signInAnalyst(context: BrowserContext, request: APIRequestContext) {
  return signIn(context, request, FIXTURES.staff.analyst);
}

export async function signInAdmin(context: BrowserContext, request: APIRequestContext) {
  return signIn(context, request, FIXTURES.staff.crm_admin);
}

export async function signInUnauthorized(context: BrowserContext, request: APIRequestContext) {
  return signIn(context, request, FIXTURES.staff.support);
}

/* ------------------------------------------------------------- assertions */

/**
 * The privacy canary.
 *
 * Reads EVERYTHING the page could disclose — rendered text, every attribute
 * value, and both web storages — and looks for any seeded learner's real
 * address or name, any internal identifier, and the backend port. Used after
 * every navigation in the redacted journey.
 */
export async function collectDisclosureSurface(page: Page): Promise<{
  text: string;
  attributes: string;
  storage: string;
  url: string;
}> {
  const surface = await page.evaluate(() => {
    const attributes: string[] = [];
    for (const element of Array.from(document.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        attributes.push(`${attribute.name}=${attribute.value}`);
      }
    }
    const readStorage = (store: Storage) => {
      const out: string[] = [];
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (key === null) continue;
        out.push(`${key}=${store.getItem(key) ?? ""}`);
      }
      return out.join("\n");
    };
    return {
      text: document.body.innerText,
      attributes: attributes.join("\n"),
      storage: `${readStorage(window.localStorage)}\n${readStorage(window.sessionStorage)}`,
      url: window.location.href,
    };
  });
  return surface;
}

/** Everything that must never appear on a redacted surface. */
export const FORBIDDEN_TOKENS: string[] = [
  ...ALL_FULL_EMAILS,
  ...ALL_FULL_NAMES,
  "ataClickId",
  "anonymousVisitorId",
  "pocketPlayerId",
  "pocketClickId",
  "POSTBACK_SECRET",
  "SESSION_SECRET",
  "passwordHash",
];
