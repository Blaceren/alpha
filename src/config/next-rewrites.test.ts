import { describe, expect, it } from "vitest";
// The real production config module — not a copy. If next.config.mjs drifts,
// these tests fail.
import { buildRewrites, SESSION_PATH, USERS_PATH, USER_DETAIL_PATH, USER_NOTES_PATH, OWNER_CANDIDATES_PATH, USER_OWNER_PATH, USER_OWNER_HISTORY_PATH, PROXIED_PATHS } from "../../next.config.mjs";

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

  it("produces exactly twenty-eight rewrite definitions", () => {
    // Seven CRM v1 data paths (CRM-AUTH-1) + five exact reviewer paths (MR-1R)
    // + six affiliate management paths (AFD-5A) + seven read-only affiliate
    // analytics paths (AFD-5C1) + three affiliate lead paths (AFD-5C2). Pinning
    // the count is the point: a new proxied path must be a deliberate change to
    // this number, never a side effect.
    expect(buildRewrites(env)).toHaveLength(28);
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

  it("exposes exactly the twenty-eight reviewed paths", () => {
    expect(PROXIED_PATHS).toEqual([
      "/api/crm/v1/session",
      "/api/crm/v1/users",
      "/api/crm/v1/users/:userId",
      "/api/crm/v1/users/:userId/notes",
      "/api/crm/v1/owner-candidates",
      "/api/crm/v1/users/:userId/owner",
      "/api/crm/v1/users/:userId/owner/history",
      "/api/curriculum/v2/report-reviews/queue",
      "/api/curriculum/v2/report-submissions/:submissionRef",
      "/api/curriculum/v2/report-submissions/:submissionRef/claim",
      "/api/curriculum/v2/report-submissions/:submissionRef/reject",
      "/api/curriculum/v2/report-submissions/:submissionRef/approve",
      "/api/crm/v1/affiliates/partners",
      "/api/crm/v1/affiliates/partners/:partnerId",
      "/api/crm/v1/affiliates/campaigns",
      "/api/crm/v1/affiliates/campaigns/:campaignId",
      "/api/crm/v1/affiliates/tracking-links",
      "/api/crm/v1/affiliates/tracking-links/:linkId",
      "/api/crm/v1/affiliates/analytics/filters",
      "/api/crm/v1/affiliates/analytics/summary",
      "/api/crm/v1/affiliates/analytics/timeseries",
      "/api/crm/v1/affiliates/analytics/breakdown",
      "/api/crm/v1/affiliates/analytics/cohorts/summary",
      "/api/crm/v1/affiliates/analytics/cohorts/timeseries",
      "/api/crm/v1/affiliates/analytics/cohorts/breakdown",
      "/api/crm/v1/affiliates/leads",
      "/api/crm/v1/affiliates/leads/:leadId",
      "/api/crm/v1/affiliates/leads/:leadId/reveal",
    ]);
    expect(SESSION_PATH).toBe("/api/crm/v1/session");
    expect(USERS_PATH).toBe("/api/crm/v1/users");
    expect(USER_DETAIL_PATH).toBe("/api/crm/v1/users/:userId");
    expect(USER_NOTES_PATH).toBe("/api/crm/v1/users/:userId/notes");
    expect(OWNER_CANDIDATES_PATH).toBe("/api/crm/v1/owner-candidates");
    expect(USER_OWNER_PATH).toBe("/api/crm/v1/users/:userId/owner");
    expect(USER_OWNER_HISTORY_PATH).toBe("/api/crm/v1/users/:userId/owner/history");
  });

  it("maps the exact notes path to the backend", () => {
    expect(buildRewrites(env)[3]).toEqual({
      source: "/api/crm/v1/users/:userId/notes",
      destination: "http://127.0.0.1:3110/api/crm/v1/users/:userId/notes",
    });
  });

  it("maps the exact owner-candidates path to the backend", () => {
    expect(buildRewrites(env)[4]).toEqual({
      source: "/api/crm/v1/owner-candidates",
      destination: "http://127.0.0.1:3110/api/crm/v1/owner-candidates",
    });
  });

  it("maps the exact owner path to the backend", () => {
    expect(buildRewrites(env)[5]).toEqual({
      source: "/api/crm/v1/users/:userId/owner",
      destination: "http://127.0.0.1:3110/api/crm/v1/users/:userId/owner",
    });
  });

  it("maps the exact owner-history path to the backend", () => {
    expect(buildRewrites(env)[6]).toEqual({
      source: "/api/crm/v1/users/:userId/owner/history",
      destination: "http://127.0.0.1:3110/api/crm/v1/users/:userId/owner/history",
    });
  });

  it("uses one method-agnostic owner rewrite for GET and PUT", () => {
    // Only the exact `/owner` singleton — the `/owner/history` sibling is a
    // separate reviewed path and must not be counted here.
    expect(buildRewrites(env).filter((r) => r.source.endsWith("/owner"))).toHaveLength(1);
  });

  it("uses one method-agnostic owner-history rewrite", () => {
    expect(buildRewrites(env).filter((r) => r.source.endsWith("/owner/history"))).toHaveLength(1);
  });

  it("keeps the owner-history path terminal — one userId segment, no child", () => {
    expect(USER_OWNER_HISTORY_PATH).toMatch(/^\/api\/crm\/v1\/users\/:userId\/owner\/history$/);
    expect(USER_OWNER_HISTORY_PATH).not.toContain("*");
    expect(USER_OWNER_HISTORY_PATH).not.toContain(":historyId");
  });

  it("keeps the owner path terminal — one userId segment, no child", () => {
    expect(USER_OWNER_PATH).toMatch(/^\/api\/crm\/v1\/users\/:userId\/owner$/);
    expect(USER_OWNER_PATH).not.toContain("*");
    expect(USER_OWNER_PATH).not.toContain(":employeeId");
    expect(USER_OWNER_PATH).not.toContain("history");
  });

  it("keeps owner-candidates a flat static path with no parameter", () => {
    expect(OWNER_CANDIDATES_PATH).not.toContain(":");
    expect(OWNER_CANDIDATES_PATH).not.toContain("*");
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

  /* --------------------------------------------- affiliate leads (AFD-5C2) */

  it("proxies exactly three lead paths", () => {
    const leads = buildRewrites(env).filter((r) => r.source.includes("/affiliates/leads"));
    expect(leads.map((r) => r.source)).toEqual([
      "/api/crm/v1/affiliates/leads",
      "/api/crm/v1/affiliates/leads/:leadId",
      "/api/crm/v1/affiliates/leads/:leadId/reveal",
    ]);
  });

  it("gives each lead path exactly one dynamic segment and no catch-all", () => {
    for (const source of [
      "/api/crm/v1/affiliates/leads/:leadId",
      "/api/crm/v1/affiliates/leads/:leadId/reveal",
    ]) {
      expect(source.match(/:/g)).toHaveLength(1);
      expect(source).not.toContain("*");
    }
    expect("/api/crm/v1/affiliates/leads").not.toContain(":");
  });

  it("makes a bulk reveal structurally unroutable through this origin", () => {
    // The reveal path names ONE segment. There is no shape here that could
    // carry an id array, a wildcard, a filter or an export format.
    const sources = buildRewrites(env).map((r) => r.source);
    for (const forbidden of [
      "/api/crm/v1/affiliates/leads/:path*",
      "/api/crm/v1/affiliates/leads/reveal",
      "/api/crm/v1/affiliates/leads/bulk-reveal",
      "/api/crm/v1/affiliates/leads/export",
      "/api/crm/v1/affiliates/leads/:leadId/reveal/:path*",
      "/api/crm/v1/affiliates/leads/:leadId/export",
      "/api/crm/v1/affiliates/leads/:leadId/:sub",
    ]) {
      expect(sources).not.toContain(forbidden);
    }
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
      "/api/crm/v1/owner-candidates",
      "/api/crm/v1/users/:userId/owner",
      "/api/crm/v1/users/:userId/owner/history",
      "/api/curriculum/v2/report-reviews/queue",
      "/api/curriculum/v2/report-submissions/:submissionRef",
      "/api/curriculum/v2/report-submissions/:submissionRef/claim",
      "/api/curriculum/v2/report-submissions/:submissionRef/reject",
      "/api/curriculum/v2/report-submissions/:submissionRef/approve",
      "/api/crm/v1/affiliates/partners",
      "/api/crm/v1/affiliates/partners/:partnerId",
      "/api/crm/v1/affiliates/campaigns",
      "/api/crm/v1/affiliates/campaigns/:campaignId",
      "/api/crm/v1/affiliates/tracking-links",
      "/api/crm/v1/affiliates/tracking-links/:linkId",
      "/api/crm/v1/affiliates/analytics/filters",
      "/api/crm/v1/affiliates/analytics/summary",
      "/api/crm/v1/affiliates/analytics/timeseries",
      "/api/crm/v1/affiliates/analytics/breakdown",
      "/api/crm/v1/affiliates/analytics/cohorts/summary",
      "/api/crm/v1/affiliates/analytics/cohorts/timeseries",
      "/api/crm/v1/affiliates/analytics/cohorts/breakdown",
      "/api/crm/v1/affiliates/leads",
      "/api/crm/v1/affiliates/leads/:leadId",
      "/api/crm/v1/affiliates/leads/:leadId/reveal",
    ]);
    for (const forbidden of [
      "/api/:path*",
      "/api/crm/v1/:path*",
      "/api/crm/:path*",
      "/api/auth/login",
      "/api/auth/csrf",
      "/api/health",
      "/api/crm/v1/notes",
      // A TOP-LEVEL /owner path stays forbidden: owner is nested under a learner,
      // and the flat directory is /owner-candidates, not /owner.
      "/api/crm/v1/owner",
      "/api/crm/v1/audit",
      "/api/crm/v1/user-360",
      // MR-1R added five exact reviewer paths. These stay forbidden: a wildcard
      // would expose the whole curriculum surface, and attachments must remain
      // unreachable while the attachment flag is off.
      "/api/curriculum/:path*",
      "/api/curriculum/v2/:path*",
      "/api/curriculum/v2/report-submissions/:path*",
      "/api/curriculum/v2/report-submissions/:submissionRef/attachments",
      "/api/curriculum/v2/report-attachments/:attachmentId",
      "/api/curriculum/v2/report-submissions/:submissionRef/reassign",
    ]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("exposes no nested learner subroute other than the exact notes, owner and owner-history paths", () => {
    // `/notes`, `/owner` and `/owner/history` are the THREE reviewed nested
    // paths. Every other nested route — including any child BELOW them — stays
    // structurally unreachable, because each parameter matches exactly one
    // segment. Note that `/owner/history` IS reviewed, but any child beneath it
    // (`/owner/history/:id`, `/owner/history/extra`) is not.
    const sources = rules.map((r) => r.source);
    for (const nested of [
      "/api/crm/v1/users/:userId/notes/:noteId",
      "/api/crm/v1/users/:userId/notes/extra",
      "/api/crm/v1/users/:userId/notes/:path*",
      "/api/crm/v1/users/:userId/owner/:employeeId",
      "/api/crm/v1/users/:userId/owner/extra",
      "/api/crm/v1/users/:userId/owner/:path*",
      "/api/crm/v1/users/:userId/owner/history/:historyId",
      "/api/crm/v1/users/:userId/owner/history/extra",
      "/api/crm/v1/users/:userId/owner/history/:path*",
      "/api/crm/v1/owner-candidates/:cursor",
      "/api/crm/v1/owner-candidates/extra",
      "/api/crm/v1/users/:userId/audit",
      "/api/crm/v1/users/:userId/:sub",
      "/api/crm/v1/users/:userId*",
      "/api/crm/v1/users/:path*",
    ]) {
      expect(sources).not.toContain(nested);
    }
    // The three reviewed nested paths ARE present.
    expect(sources).toContain("/api/crm/v1/users/:userId/notes");
    expect(sources).toContain("/api/crm/v1/users/:userId/owner");
    expect(sources).toContain("/api/crm/v1/users/:userId/owner/history");
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
