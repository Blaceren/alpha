/**
 * Route guard behaviour for the anonymous auth routes.
 *
 * `/register` must be reachable WITHOUT a session, otherwise every ATA invite
 * link (`/register?ref=...`) bounces to `/login` and the invite is a dead end.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "@/middleware";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

function request(path: string, options: { session?: boolean } = {}): NextRequest {
  const req = new NextRequest(new URL(`http://academy.test${path}`));
  if (options.session) req.cookies.set(SESSION_COOKIE_NAME, "token");
  return req;
}

function redirectTarget(response: { status: number; headers: Headers }): string | null {
  return response.headers.get("location");
}

let originalMode: string | undefined;

beforeEach(() => {
  originalMode = process.env.ACADEMY_MODE;
  process.env.ACADEMY_MODE = "api";
});

afterEach(() => {
  process.env.ACADEMY_MODE = originalMode;
});

describe("middleware — anonymous routes", () => {
  it("lets an anonymous visitor reach /register", () => {
    const response = middleware(request("/register"));
    expect(redirectTarget(response)).toBeNull();
  });

  it("lets an anonymous visitor reach an invite link with ?ref", () => {
    const response = middleware(request("/register?ref=ABC123"));
    expect(redirectTarget(response)).toBeNull();
  });

  it("still lets an anonymous visitor reach /login", () => {
    expect(redirectTarget(middleware(request("/login")))).toBeNull();
  });

  it("does not change the guard for protected routes", () => {
    const response = middleware(request("/path"));
    expect(redirectTarget(response)).toContain("/login");
    expect(redirectTarget(response)).toContain("next=%2Fpath");
  });

  it("does not exempt a route that merely starts with the same letters", () => {
    const response = middleware(request("/registered-users"));
    expect(redirectTarget(response)).toContain("/login");
  });

  it("renders /register for an authenticated visitor, matching /login's convention", () => {
    expect(redirectTarget(middleware(request("/register", { session: true })))).toBeNull();
    expect(redirectTarget(middleware(request("/login", { session: true })))).toBeNull();
  });

  it("is a pass-through in fixture mode", () => {
    process.env.ACADEMY_MODE = "fixture";
    expect(redirectTarget(middleware(request("/register")))).toBeNull();
    expect(redirectTarget(middleware(request("/path")))).toBeNull();
  });
});

/**
 * UNIFIED-DESIGN-V1 made `/` the Public Home. The middleware must let an
 * anonymous visitor reach it — and must not, in doing so, let them reach
 * anything else.
 */
describe("public home", () => {
  it("lets an anonymous visitor reach /", () => {
    expect(redirectTarget(middleware(request("/")))).toBeNull();
  });

  it("lets an authenticated visitor reach / without redirecting them away", () => {
    // Product decision 3: an authenticated user may still view Public Home.
    // There is deliberately no bounce to /home.
    expect(redirectTarget(middleware(request("/", { session: true })))).toBeNull();
  });

  it("does NOT turn every route anonymous", () => {
    /*
     * The load-bearing test for this change.
     *
     * `ANONYMOUS_ROUTES` is matched exact-or-subpath. Had "/" been added to
     * that list, its subpath arm would be `pathname.startsWith("/")` — true of
     * every path in the product — and the entire authenticated Academy would
     * have become anonymous to this middleware in one line. "/" is therefore
     * matched as an exact comparison instead, and these guarded routes prove
     * the blast radius stayed at zero.
     */
    for (const path of [
      "/home",
      "/path",
      "/lessons",
      "/tools",
      "/notifications",
      "/profile",
      "/community",
      "/support",
      "/path/L1/workspace",
    ]) {
      const response = middleware(request(path));
      expect(redirectTarget(response), `${path} must stay guarded`).toContain("/login");
    }
  });

  it("still guards the new authenticated home at /home", () => {
    const response = middleware(request("/home"));
    expect(redirectTarget(response)).toContain("/login");
    expect(redirectTarget(response)).toContain("next=%2Fhome");
  });
});

/**
 * The matcher decides what the guard is even asked about. These lock the
 * static-asset exclusions, because a brand asset that redirects to /login is
 * invisible on exactly the surface that needs it most.
 */
describe("matcher — static brand assets", () => {
  const matcher = (config.matcher as string[])[0];
  const pattern = new RegExp(`^${matcher}$`);

  it("does not run the guard on vendored font assets", () => {
    // Regression: these 307'd to /login for any visitor without a cookie, so
    // Public Home rendered in fallback system fonts for its entire audience.
    expect(pattern.test("/fonts/ata/manrope/manrope-latin-wght-normal.woff2")).toBe(false);
    expect(pattern.test("/fonts/ata/ibm-plex-mono/ibm-plex-mono-400-latin.woff2")).toBe(false);
    expect(pattern.test("/fonts/ata/source-serif-4/source-serif-4-variable-latin.woff2")).toBe(false);
  });

  it("does not run the guard on brand assets", () => {
    expect(pattern.test("/brand/ata-logo.svg")).toBe(false);
  });

  it("still runs the guard on every product route", () => {
    for (const path of [
      "/",
      "/home",
      "/path",
      "/lessons",
      "/tools",
      "/notifications",
      "/profile",
      "/community",
      "/support",
      "/path/L1/workspace",
    ]) {
      expect(pattern.test(path), `${path} must still be matched`).toBe(true);
    }
  });

  it("does not exempt a route that merely begins with the same letters", () => {
    // `fonts/` and `brand/` carry a trailing slash for this reason: a product
    // route named /fonts-and-colours or /branding must NOT fall out of the guard.
    expect(pattern.test("/fonts-and-colours")).toBe(true);
    expect(pattern.test("/branding")).toBe(true);
  });
});
