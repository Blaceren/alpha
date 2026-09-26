import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /login must be rendered per request, never statically prerendered.
 *
 * WHY THIS TEST EXISTS. `app/login/page.tsx` reads the PUBLIC Turnstile site key
 * from the server environment at render time. When the route is prerendered,
 * that read happens once during `next build` and its result — `null` for a build
 * with no key configured — is frozen into BOTH the static HTML and the RSC
 * payload. The deployed CRM then serves a permanent "captcha unavailable" login
 * form no matter what the runtime environment says, and no restart can repair
 * it. That shipped once; this test is what makes it not ship twice.
 *
 * Two layers, deliberately:
 *
 *   1. A SOURCE guard that always runs. It fails the moment the route-segment
 *      declaration is deleted, with no build required — the cheapest possible
 *      signal, available to `npm run test:run` on a bare checkout.
 *
 *   2. ARTIFACT guards that run only when a production build is present. They
 *      prove the declaration actually had the intended effect, which is the part
 *      a source grep can never establish. They are skipped rather than failed on
 *      a checkout with no `.next`, so a plain unit-test run stays honest instead
 *      of red for an unrelated reason.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const NEXT_DIR = path.join(REPO_ROOT, ".next");
const PRERENDER_MANIFEST = path.join(NEXT_DIR, "prerender-manifest.json");
const APP_ROUTES_MANIFEST = path.join(NEXT_DIR, "app-path-routes-manifest.json");
const SERVER_APP_DIR = path.join(NEXT_DIR, "server", "app");

const hasBuild = existsSync(PRERENDER_MANIFEST);

describe("/login route-segment configuration", () => {
  it("declares force-dynamic in source", () => {
    const source = readFileSync(path.join(REPO_ROOT, "src/app/login/page.tsx"), "utf8");
    // Matches the route-segment export specifically, not the word in a comment.
    expect(/^export const dynamic = "force-dynamic";$/m.test(source)).toBe(true);
  });

  it("reads the site key inside the request-time render, not at module scope", () => {
    const source = readFileSync(path.join(REPO_ROOT, "src/app/login/page.tsx"), "utf8");
    // A module-scope `const x = getTurnstileSiteKey()` would be evaluated once
    // per process and would survive force-dynamic as a stale value.
    expect(/^const\s+\w+\s*=\s*getTurnstileSiteKey\(\)/m.test(source)).toBe(false);
    expect(source).toContain("getTurnstileSiteKey()");
  });
});

describe.skipIf(!hasBuild)("/login production artifact (requires .next)", () => {
  it("is absent from the prerender manifest", () => {
    const manifest = JSON.parse(readFileSync(PRERENDER_MANIFEST, "utf8")) as {
      routes?: Record<string, unknown>;
      dynamicRoutes?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.routes ?? {})).not.toContain("/login");
    expect(Object.keys(manifest.dynamicRoutes ?? {})).not.toContain("/login");
  });

  it("emitted no static HTML or RSC payload", () => {
    // These three are exactly what a prerendered route leaves behind.
    expect(existsSync(path.join(SERVER_APP_DIR, "login.html"))).toBe(false);
    expect(existsSync(path.join(SERVER_APP_DIR, "login.rsc"))).toBe(false);
    expect(existsSync(path.join(SERVER_APP_DIR, "login.meta"))).toBe(false);
  });

  it("still exists as a server route", () => {
    // Not prerendered must mean "rendered per request", never "gone".
    const routes = JSON.parse(readFileSync(APP_ROUTES_MANIFEST, "utf8")) as Record<string, string>;
    expect(Object.values(routes)).toContain("/login");
  });

  it("did not silently make the rest of the app dynamic", () => {
    // The fix is scoped to one page. If a future change moves the declaration
    // up into a layout, the (crm) shells stop being prerendered too — which is
    // a performance regression nobody asked for. Assert a representative few
    // are still static.
    const manifest = JSON.parse(readFileSync(PRERENDER_MANIFEST, "utf8")) as {
      routes?: Record<string, unknown>;
    };
    const prerendered = Object.keys(manifest.routes ?? {});
    for (const route of ["/today", "/users", "/settings"]) {
      expect(prerendered).toContain(route);
    }
  });
});
