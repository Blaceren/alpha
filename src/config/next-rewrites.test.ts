import { describe, expect, it } from "vitest";
// The real production config module — not a copy. If next.config.mjs drifts,
// these tests fail.
import { buildRewrites, SESSION_PATH, USERS_PATH, PROXIED_PATHS } from "../../next.config.mjs";

describe("rewrites — mock mode", () => {
  it("produces zero rewrites", () => {
    expect(buildRewrites({ CRM_MODE: "mock" })).toEqual([]);
  });

  it("produces zero rewrites even when an origin is present", () => {
    expect(
      buildRewrites({ CRM_MODE: "mock", CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110" }),
    ).toEqual([]);
  });

  it("produces zero rewrites when the mode is missing", () => {
    // No mode means no proxying. The application layer separately refuses to
    // boot, so this cannot silently become a usable mock deployment.
    expect(buildRewrites({})).toEqual([]);
  });
});

describe("rewrites — api mode", () => {
  const env = { CRM_MODE: "api", CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110" };

  it("produces exactly two rewrites", () => {
    expect(buildRewrites(env)).toHaveLength(2);
  });

  it("maps the exact session path to the backend", () => {
    expect(buildRewrites(env)[0]).toEqual({
      source: "/api/crm/v1/session",
      destination: "http://127.0.0.1:3110/api/crm/v1/session",
    });
  });

  it("maps the exact users path to the backend", () => {
    expect(buildRewrites(env)[1]).toEqual({
      source: "/api/crm/v1/users",
      destination: "http://127.0.0.1:3110/api/crm/v1/users",
    });
  });

  it("exposes exactly the two reviewed paths", () => {
    expect(PROXIED_PATHS).toEqual(["/api/crm/v1/session", "/api/crm/v1/users"]);
    expect(SESSION_PATH).toBe("/api/crm/v1/session");
    expect(USERS_PATH).toBe("/api/crm/v1/users");
  });

  it("normalizes a trailing slash instead of emitting a double slash", () => {
    const rules = buildRewrites({ ...env, CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110/" });
    expect(rules[0]?.destination).toBe("http://127.0.0.1:3110/api/crm/v1/session");
    expect(rules[1]?.destination).toBe("http://127.0.0.1:3110/api/crm/v1/users");
  });
});

describe("rewrites — no wildcard exposure", () => {
  const rules = buildRewrites({
    CRM_MODE: "api",
    CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110",
  });

  it("uses no path parameters or wildcards in the source", () => {
    for (const rule of rules) {
      expect(rule.source).not.toContain(":path");
      expect(rule.source).not.toContain("*");
      expect(rule.source).not.toContain(":");
    }
  });

  it("exposes no other backend endpoint", () => {
    // Anything other than the two reviewed paths must be unreachable through
    // this config — including sibling auth, health and CSRF routes.
    const sources = rules.map((r) => r.source);
    expect(sources).toEqual(["/api/crm/v1/session", "/api/crm/v1/users"]);
    for (const forbidden of [
      "/api/:path*",
      "/api/crm/v1/:path*",
      "/api/crm/:path*",
      "/api/auth/login",
      "/api/auth/csrf",
      "/api/health",
      "/api/crm/v1/notes",
      "/api/crm/v1/owner",
      "/api/crm/v1/audit",
      "/api/crm/v1/user-360",
    ]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("proxies the users path exactly — no sub-paths and no near-misses", () => {
    // Next matches `source` exactly unless it carries a pattern, and it carries
    // none. These must therefore all fall through to the CRM app (404), never
    // to the backend.
    const sources = rules.map((r) => r.source);
    for (const notProxied of [
      "/api/crm/v1/users/extra",
      "/api/crm/v1/users/123",
      "/api/crm/v1/users/",
      "/api/crm/v1/user",
      "/api/crm/v1/userss",
    ]) {
      expect(sources).not.toContain(notProxied);
    }
    // And the one that IS proxied is the bare path.
    expect(sources).toContain("/api/crm/v1/users");
  });

  it("targets only the configured origin", () => {
    for (const rule of rules) {
      expect(rule.destination.startsWith("http://127.0.0.1:3110/")).toBe(true);
    }
  });
});

describe("rewrites — fails closed on a bad origin", () => {
  const bad = [
    undefined,
    "",
    "   ",
    "not-a-url",
    "/relative",
    "ftp://127.0.0.1",
    "javascript:alert(1)",
    "http://user:pass@127.0.0.1:3110",
    "http://127.0.0.1:3110?a=1",
    "http://127.0.0.1:3110#x",
    "http://127.0.0.1:3110/api",
    "http://127.0.0.1:notaport",
  ];

  it.each(bad)("throws for %j", (origin) => {
    expect(() => buildRewrites({ CRM_MODE: "api", CRM_BACKEND_ORIGIN: origin })).toThrow();
  });

  it("never emits a rewrite built from an invalid origin", () => {
    // A throw is the required behaviour: returning [] would start the app in
    // api mode with the session endpoint silently unproxied.
    expect(() => buildRewrites({ CRM_MODE: "api" })).toThrow(/CRM_BACKEND_ORIGIN/);
  });
});
