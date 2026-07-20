import { describe, expect, it } from "vitest";
// The real production config module — not a copy. If next.config.mjs drifts,
// these tests fail.
import { buildRewrites, SESSION_PATH, USERS_PATH, USER_DETAIL_PATH, USER_NOTES_PATH, PROXIED_PATHS } from "../../next.config.mjs";

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

  it("produces exactly four rewrite definitions", () => {
    expect(buildRewrites(env)).toHaveLength(4);
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

  it("maps the exact user detail path to the backend", () => {
    expect(buildRewrites(env)[2]).toEqual({
      source: "/api/crm/v1/users/:userId",
      destination: "http://127.0.0.1:3110/api/crm/v1/users/:userId",
    });
  });

  it("exposes exactly the four reviewed paths", () => {
    expect(PROXIED_PATHS).toEqual([
      "/api/crm/v1/session",
      "/api/crm/v1/users",
      "/api/crm/v1/users/:userId",
      "/api/crm/v1/users/:userId/notes",
    ]);
    expect(SESSION_PATH).toBe("/api/crm/v1/session");
    expect(USERS_PATH).toBe("/api/crm/v1/users");
    expect(USER_DETAIL_PATH).toBe("/api/crm/v1/users/:userId");
    expect(USER_NOTES_PATH).toBe("/api/crm/v1/users/:userId/notes");
  });

  it("maps the exact notes path to the backend", () => {
    expect(buildRewrites(env)[3]).toEqual({
      source: "/api/crm/v1/users/:userId/notes",
      destination: "http://127.0.0.1:3110/api/crm/v1/users/:userId/notes",
    });
  });

  it("uses one method-agnostic notes rewrite for GET and POST", () => {
    // Next rewrites do not vary by method; a method-specific variant would only
    // create two definitions to keep in sync.
    expect(buildRewrites(env).filter((r) => r.source.endsWith("/notes"))).toHaveLength(1);
  });

  it("keeps the notes path terminal — exactly one userId segment and no child", () => {
    expect(USER_NOTES_PATH).toMatch(/^\/api\/crm\/v1\/users\/:userId\/notes$/);
    expect(USER_NOTES_PATH).not.toContain("*");
    expect(USER_NOTES_PATH).not.toContain(":noteId");
  });

  it("keeps the first two entries exact static paths", () => {
    const rules = buildRewrites(env);
    expect(rules[0]?.source).not.toContain(":");
    expect(rules[1]?.source).not.toContain(":");
  });

  it("gives the detail entry exactly one dynamic segment", () => {
    const source = buildRewrites(env)[2]?.source ?? "";
    // One parameter, and it is not a catch-all.
    expect(source.match(/:/g)).toHaveLength(1);
    expect(source).not.toContain("*");
    expect(source.endsWith("/:userId")).toBe(true);
    // Exactly one segment follows /users/.
    expect(source.split("/users/")[1]).toBe(":userId");
  });

  it("normalizes a trailing slash instead of emitting a double slash", () => {
    const rules = buildRewrites({ ...env, CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110/" });
    expect(rules[0]?.destination).toBe("http://127.0.0.1:3110/api/crm/v1/session");
    expect(rules[1]?.destination).toBe("http://127.0.0.1:3110/api/crm/v1/users");
    expect(rules[2]?.destination).toBe("http://127.0.0.1:3110/api/crm/v1/users/:userId");
  });
});

describe("rewrites — no wildcard exposure", () => {
  const rules = buildRewrites({
    CRM_MODE: "api",
    CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110",
  });

  it("uses no wildcard or catch-all in any source", () => {
    for (const rule of rules) {
      expect(rule.source).not.toContain(":path");
      expect(rule.source).not.toContain("*");
      expect(rule.source).not.toContain("...");
    }
  });

  it("exposes no other backend endpoint", () => {
    // Anything other than the two reviewed paths must be unreachable through
    // this config — including sibling auth, health and CSRF routes.
    const sources = rules.map((r) => r.source);
    expect(sources).toEqual([
      "/api/crm/v1/session",
      "/api/crm/v1/users",
      "/api/crm/v1/users/:userId",
      "/api/crm/v1/users/:userId/notes",
    ]);
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

  it("exposes no nested learner subroute other than the exact notes path", () => {
    // `/notes` is the ONE reviewed nested path. Every other nested route —
    // including any child BELOW /notes — stays structurally unreachable,
    // because each parameter matches exactly one segment.
    const sources = rules.map((r) => r.source);
    for (const nested of [
      "/api/crm/v1/users/:userId/notes/:noteId",
      "/api/crm/v1/users/:userId/notes/extra",
      "/api/crm/v1/users/:userId/notes/:path*",
      "/api/crm/v1/users/:userId/owner",
      "/api/crm/v1/users/:userId/audit",
      "/api/crm/v1/users/:userId/:sub",
      "/api/crm/v1/users/:userId*",
      "/api/crm/v1/users/:path*",
    ]) {
      expect(sources).not.toContain(nested);
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
