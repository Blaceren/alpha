import { describe, expect, it } from "vitest";
// The real production config module — not a copy. If next.config.mjs drifts,
// these tests fail.
import { buildRewrites, SESSION_PATH, USERS_PATH, USER_DETAIL_PATH, USER_NOTES_PATH, OWNER_CANDIDATES_PATH, USER_OWNER_PATH, USER_OWNER_HISTORY_PATH, USER_PROGRESSION_PATH, USER_PROGRESSION_PREVIEW_PATH, USER_PROGRESSION_ADJUST_PATH, PROXIED_PATHS } from "../../next.config.mjs";

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

  it("produces exactly sixty-four rewrite definitions", () => {
    // Seven CRM v1 data paths (CRM-AUTH-1) + five exact reviewer paths (MR-1R)
    // + six affiliate management paths (AFD-5A) + seven read-only affiliate
    // analytics paths (AFD-5C1) + one Curie Atlas analysis path (AFD-5D2)
    // + three affiliate lead paths (AFD-5C2) + five read-only Growth paths
    // (G4-GROWTH) + FOUR commercial control paths (AFFILIATE-PLATFORM-V1).
    // Pinning the count is the point: a new proxied path must be a deliberate
    // change to this number, never a side effect. It fired on the four added
    // below, which is the guard working, and it is updated in the same commit.
    // COMMUNITY-V1 adds ONE: the Community moderation surface.
    expect(buildRewrites(env)).toHaveLength(64);
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

  it("exposes exactly the sixty-four reviewed paths", () => {
    expect(PROXIED_PATHS).toEqual([
      "/api/crm/v1/session",
      "/api/crm/v1/users",
      "/api/crm/v1/users/:userId",
      "/api/crm/v1/users/:userId/notes",
      "/api/crm/v1/owner-candidates",
      "/api/crm/v1/users/:userId/owner",
      "/api/crm/v1/users/:userId/owner/history",
      // PHASE-1 ADMIN — administrative progression correction.
      "/api/crm/v1/users/:userId/progression",
      "/api/crm/v1/users/:userId/progression/preview",
      "/api/crm/v1/users/:userId/progression/adjust",
      "/api/curriculum/v2/report-reviews/queue",
      "/api/curriculum/v2/report-submissions/:submissionRef",
      "/api/curriculum/v2/report-submissions/:submissionRef/claim",
      "/api/curriculum/v2/report-submissions/:submissionRef/reject",
      "/api/curriculum/v2/report-submissions/:submissionRef/approve",
      // G3 — mentor review. Exactly two: discover, and approve. There is no
      // claim, release, reassign or reject path because the canonical lifecycle
      // has no such transition.
      "/api/curriculum/v2/mentor-reviews/queue",
      "/api/curriculum/v2/mentor-reviews/:progressId/approve",
      "/api/crm/v1/affiliates/partners",
      "/api/crm/v1/affiliates/partners/:partnerId",
      "/api/crm/v1/affiliates/campaigns",
      "/api/crm/v1/affiliates/campaigns/:campaignId",
      "/api/crm/v1/affiliates/tracking-links",
      "/api/crm/v1/affiliates/tracking-links/:linkId",
      "/api/crm/v1/affiliates/partner-users",
      "/api/crm/v1/affiliates/campaign-terms",
      "/api/crm/v1/affiliates/commissions",
      "/api/crm/v1/affiliates/postback-deliveries",
      "/api/crm/v1/affiliates/analytics/filters",
      "/api/crm/v1/affiliates/analytics/summary",
      "/api/crm/v1/affiliates/analytics/timeseries",
      "/api/crm/v1/affiliates/analytics/breakdown",
      "/api/crm/v1/affiliates/analytics/cohorts/summary",
      "/api/crm/v1/affiliates/analytics/cohorts/timeseries",
      "/api/crm/v1/affiliates/analytics/cohorts/breakdown",
      "/api/crm/v1/affiliates/analytics/analysis",
      "/api/crm/v1/affiliates/leads",
      "/api/crm/v1/affiliates/leads/:leadId",
      "/api/crm/v1/affiliates/leads/:leadId/reveal",
      // G4-GROWTH — five exact, terminal, read-only Growth paths. The Pocket
      // postback intake is deliberately NOT among them: it is provider-facing
      // traffic on the public origin and must never be reachable through the
      // CRM origin.
      "/api/crm/v1/growth/overview",
      "/api/crm/v1/growth/funnel",
      "/api/crm/v1/growth/acquisition",
      "/api/crm/v1/growth/pocket-conversions",
      "/api/crm/v1/growth/ingress-health",
      // LEARNER-OPERATIONS-V1 — twenty explicit paths, no prefix wildcard.
      // A wildcard would forward routes that do not exist yet, including any a
      // future backend adds without this repository reviewing them, which is
      // the exact thing this allowlist exists to prevent.
      "/api/crm/v1/learner-ops/cases",
      "/api/crm/v1/learner-ops/cases/:caseId",
      "/api/crm/v1/learner-ops/cases/:caseId/status",
      "/api/crm/v1/learner-ops/cases/:caseId/assign",
      "/api/crm/v1/learner-ops/cases/:caseId/priority",
      "/api/crm/v1/learner-ops/cases/:caseId/messages",
      "/api/crm/v1/learner-ops/cases/:caseId/notes",
      "/api/crm/v1/learner-ops/cases/:caseId/events",
      "/api/crm/v1/learner-ops/cases/:caseId/escalations",
      "/api/crm/v1/learner-ops/cases/:caseId/qa",
      "/api/crm/v1/learner-ops/escalations/:escalationId/resolve",
      "/api/crm/v1/learner-ops/learners/:userId",
      "/api/crm/v1/learner-ops/config",
      "/api/crm/v1/learner-ops/analytics",
      "/api/crm/v1/learner-ops/qa",
      "/api/crm/v1/learner-ops/knowledge",
      "/api/crm/v1/learner-ops/knowledge/:slug",
      "/api/crm/v1/learner-ops/voc",
      "/api/crm/v1/learner-ops/voc/:signalId",
      "/api/crm/v1/learner-ops/voc/:signalId/cases",
      // COMMUNITY-V1 — one path: GET reads the moderation queue, POST applies
      // one action. Both live at the same URL.
      "/api/crm/v1/community/moderation",
    ]);
    expect(SESSION_PATH).toBe("/api/crm/v1/session");
    expect(USERS_PATH).toBe("/api/crm/v1/users");
    expect(USER_DETAIL_PATH).toBe("/api/crm/v1/users/:userId");
    expect(USER_NOTES_PATH).toBe("/api/crm/v1/users/:userId/notes");
    expect(OWNER_CANDIDATES_PATH).toBe("/api/crm/v1/owner-candidates");
    expect(USER_OWNER_PATH).toBe("/api/crm/v1/users/:userId/owner");
    expect(USER_OWNER_HISTORY_PATH).toBe("/api/crm/v1/users/:userId/owner/history");
    expect(USER_PROGRESSION_PATH).toBe("/api/crm/v1/users/:userId/progression");
    expect(USER_PROGRESSION_PREVIEW_PATH).toBe("/api/crm/v1/users/:userId/progression/preview");
    expect(USER_PROGRESSION_ADJUST_PATH).toBe("/api/crm/v1/users/:userId/progression/adjust");
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
    //
    // The filter names the USER-notes path exactly rather than matching every
    // source ending in `/notes`. LEARNER-OPERATIONS-V1 added a second,
    // unrelated notes resource (`.../learner-ops/cases/:caseId/notes`), and a
    // suffix match would have quietly turned this assertion into "how many
    // notes-shaped resources exist" — a different question that happens to have
    // had the same answer until now.
    const rules = buildRewrites(env);
    expect(rules.filter((r) => r.source === USER_NOTES_PATH)).toHaveLength(1);

    // The same property, asserted separately for the Learner Operations
    // resource: one definition, not one per method.
    expect(
      rules.filter((r) => r.source === "/api/crm/v1/learner-ops/cases/:caseId/notes"),
    ).toHaveLength(1);
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
      // PHASE-1 ADMIN — administrative progression correction.
      "/api/crm/v1/users/:userId/progression",
      "/api/crm/v1/users/:userId/progression/preview",
      "/api/crm/v1/users/:userId/progression/adjust",
      "/api/curriculum/v2/report-reviews/queue",
      "/api/curriculum/v2/report-submissions/:submissionRef",
      "/api/curriculum/v2/report-submissions/:submissionRef/claim",
      "/api/curriculum/v2/report-submissions/:submissionRef/reject",
      "/api/curriculum/v2/report-submissions/:submissionRef/approve",
      // G3 — mentor review. Exactly two: discover, and approve. There is no
      // claim, release, reassign or reject path because the canonical lifecycle
      // has no such transition.
      "/api/curriculum/v2/mentor-reviews/queue",
      "/api/curriculum/v2/mentor-reviews/:progressId/approve",
      "/api/crm/v1/affiliates/partners",
      "/api/crm/v1/affiliates/partners/:partnerId",
      "/api/crm/v1/affiliates/campaigns",
      "/api/crm/v1/affiliates/campaigns/:campaignId",
      "/api/crm/v1/affiliates/tracking-links",
      "/api/crm/v1/affiliates/tracking-links/:linkId",
      "/api/crm/v1/affiliates/partner-users",
      "/api/crm/v1/affiliates/campaign-terms",
      "/api/crm/v1/affiliates/commissions",
      "/api/crm/v1/affiliates/postback-deliveries",
      "/api/crm/v1/affiliates/analytics/filters",
      "/api/crm/v1/affiliates/analytics/summary",
      "/api/crm/v1/affiliates/analytics/timeseries",
      "/api/crm/v1/affiliates/analytics/breakdown",
      "/api/crm/v1/affiliates/analytics/cohorts/summary",
      "/api/crm/v1/affiliates/analytics/cohorts/timeseries",
      "/api/crm/v1/affiliates/analytics/cohorts/breakdown",
      "/api/crm/v1/affiliates/analytics/analysis",
      "/api/crm/v1/affiliates/leads",
      "/api/crm/v1/affiliates/leads/:leadId",
      "/api/crm/v1/affiliates/leads/:leadId/reveal",
      // G4-GROWTH — read-only Growth surfaces.
      "/api/crm/v1/growth/overview",
      "/api/crm/v1/growth/funnel",
      "/api/crm/v1/growth/acquisition",
      "/api/crm/v1/growth/pocket-conversions",
      "/api/crm/v1/growth/ingress-health",
      // LEARNER-OPERATIONS-V1 — twenty explicit paths, no prefix wildcard.
      // A wildcard would forward routes that do not exist yet, including any a
      // future backend adds without this repository reviewing them, which is
      // the exact thing this allowlist exists to prevent.
      "/api/crm/v1/learner-ops/cases",
      "/api/crm/v1/learner-ops/cases/:caseId",
      "/api/crm/v1/learner-ops/cases/:caseId/status",
      "/api/crm/v1/learner-ops/cases/:caseId/assign",
      "/api/crm/v1/learner-ops/cases/:caseId/priority",
      "/api/crm/v1/learner-ops/cases/:caseId/messages",
      "/api/crm/v1/learner-ops/cases/:caseId/notes",
      "/api/crm/v1/learner-ops/cases/:caseId/events",
      "/api/crm/v1/learner-ops/cases/:caseId/escalations",
      "/api/crm/v1/learner-ops/cases/:caseId/qa",
      "/api/crm/v1/learner-ops/escalations/:escalationId/resolve",
      "/api/crm/v1/learner-ops/learners/:userId",
      "/api/crm/v1/learner-ops/config",
      "/api/crm/v1/learner-ops/analytics",
      "/api/crm/v1/learner-ops/qa",
      "/api/crm/v1/learner-ops/knowledge",
      "/api/crm/v1/learner-ops/knowledge/:slug",
      "/api/crm/v1/learner-ops/voc",
      "/api/crm/v1/learner-ops/voc/:signalId",
      "/api/crm/v1/learner-ops/voc/:signalId/cases",
      // COMMUNITY-V1 — one path: GET reads the moderation queue, POST applies
      // one action. Both live at the same URL.
      "/api/crm/v1/community/moderation",
    ]);
    for (const forbidden of [
      "/api/:path*",
      "/api/crm/v1/:path*",
      "/api/crm/:path*",
      // G4-GROWTH. The Pocket postback intake must never be reachable through
      // the CRM origin: it is provider-facing traffic authenticated by the
      // shared POSTBACK_SECRET, and proxying it here would put a money-bearing
      // intake behind a staff-session origin. The CRM reads the RESULT of
      // provider events, never their intake.
      "/api/postbacks/pocket",
      "/api/exchange/postbacks/receive",
      "/api/crm/v1/growth/:path*",
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

/**
 * PHASE-1 ADMIN — the three administrative progression paths.
 *
 * THESE TESTS EXIST BECAUSE THEIR ABSENCE SHIPPED A BROKEN FEATURE. The backend
 * routes, the CRM client and the «Прогресс Академии» section were all deployed
 * to PREPROD and every request 404'd at the CRM origin: the paths had never been
 * added to `PROXIED_PATHS`, and the section's own tests mocked the client, so
 * the only unproxied layer was the only layer nothing exercised.
 *
 * The lesson generalises past this feature: a backend route under
 * `/api/crm/v1` is not reachable from the CRM until it is listed in
 * `next.config.mjs`, and a component test that mocks its client will never
 * notice. That is what the last case below is for.
 */
describe("rewrites — administrative progression (PHASE-1 ADMIN)", () => {
  const env = { CRM_MODE: "api", CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110" };

  it("forwards the progression read", () => {
    expect(buildRewrites(env)).toContainEqual({
      source: "/api/crm/v1/users/:userId/progression",
      destination: "http://127.0.0.1:3110/api/crm/v1/users/:userId/progression",
    });
  });

  it("forwards the preview", () => {
    expect(buildRewrites(env)).toContainEqual({
      source: "/api/crm/v1/users/:userId/progression/preview",
      destination: "http://127.0.0.1:3110/api/crm/v1/users/:userId/progression/preview",
    });
  });

  it("forwards the adjust mutation", () => {
    expect(buildRewrites(env)).toContainEqual({
      source: "/api/crm/v1/users/:userId/progression/adjust",
      destination: "http://127.0.0.1:3110/api/crm/v1/users/:userId/progression/adjust",
    });
  });

  it("declares all three in PROXIED_PATHS", () => {
    for (const path of [
      USER_PROGRESSION_PATH,
      USER_PROGRESSION_PREVIEW_PATH,
      USER_PROGRESSION_ADJUST_PATH,
    ]) {
      expect(PROXIED_PATHS).toContain(path);
    }
  });

  it("does NOT forward an unlisted child of /progression", () => {
    // No catch-all: a path nobody reviewed must fall through to the CRM app
    // rather than reaching the backend.
    const sources = buildRewrites(env).map((rewrite) => rewrite.source);
    expect(sources).not.toContain("/api/crm/v1/users/:userId/progression/:rest*");
    expect(sources.filter((source) => source.includes("/progression"))).toHaveLength(3);
  });

  it("every path the progression client calls is proxied", () => {
    // THE CROSS-CHECK THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. The client
    // builds its URLs from one helper, so the shapes it can produce are
    // enumerable — and each must appear in the proxy list with `:userId` in
    // place of the concrete id.
    const clientPaths = ["", "/preview", "/adjust"].map(
      (suffix) => `/api/crm/v1/users/:userId/progression${suffix}`,
    );
    for (const path of clientPaths) {
      expect(PROXIED_PATHS).toContain(path);
    }
  });
});
