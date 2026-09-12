import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildAffiliateQuery,
  createAffiliatePartner,
  fetchAffiliatePartners,
  fetchAffiliateTrackingLink,
  updateAffiliateTrackingLink,
  AFFILIATE_PARTNERS_ENDPOINT,
} from "./affiliates-client";
import { resetCsrfTokenForTests } from "./auth-client";

/**
 * AFD-5A — client contract tests.
 *
 * The security-relevant claims here are (a) no mutation is ever sent without a
 * CSRF token, and (b) the canonical tracking URL is never constructed in the
 * browser.
 */

const LINK = {
  id: "7",
  affiliatePartnerId: "1",
  affiliatePartnerCode: "alpha",
  affiliateCampaignId: null,
  affiliateCampaignCode: null,
  publicCode: "abcdefghijklmnopqrstuvwxyz234567",
  displayName: "Link Alpha One",
  status: "draft",
  availability: "paused",
  landingKey: "academy_registration",
  externalClickParameter: "clickid",
  subParameters: { sub1: null, sub2: null, sub3: null, sub4: null, sub5: null },
  attributionWindowDays: null,
  effectiveAttributionWindowDays: 30,
  publicRouteState: "not_active",
  activationState: "blocked",
  publicPath: "/go/abcdefghijklmnopqrstuvwxyz234567",
  publicUrl: "https://affiliate-test.example/go/abcdefghijklmnopqrstuvwxyz234567",
  publicUrlUnavailableReason: null,
  createdBy: null,
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z",
  archivedAt: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch double that answers the CSRF endpoint and records every call. */
function fetchDouble(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/crm/auth/csrf") {
      return jsonResponse({ csrfToken: "test-csrf-token-0123456789" });
    }
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => {
  resetCsrfTokenForTests();
});

describe("buildAffiliateQuery", () => {
  it("writes only the keys the backend accepts", () => {
    const query = buildAffiliateQuery({
      limit: 25,
      offset: 50,
      status: "active",
      search: "  alpha  ",
      affiliatePartnerId: "3",
    });
    const params = new URLSearchParams(query);
    expect([...params.keys()].sort()).toEqual([
      "affiliatePartnerId",
      "limit",
      "offset",
      "search",
      "status",
    ]);
    expect(params.get("search")).toBe("alpha");
  });

  it("bounds the limit and omits a zero offset and an empty search", () => {
    expect(new URLSearchParams(buildAffiliateQuery({ limit: 9999 })).get("limit")).toBe("100");
    expect(new URLSearchParams(buildAffiliateQuery({ limit: 0 })).get("limit")).toBe("1");
    const bare = new URLSearchParams(buildAffiliateQuery({ search: "   " }));
    expect(bare.has("offset")).toBe(false);
    expect(bare.has("search")).toBe(false);
  });
});

describe("reads", () => {
  it("maps a validated list to success", async () => {
    const { impl } = fetchDouble(() =>
      jsonResponse({ items: [], total: 0, limit: 25, offset: 0 }),
    );
    const outcome = await fetchAffiliatePartners({}, { fetchImpl: impl });
    expect(outcome.status).toBe("success");
  });

  it("maps 401/403/404/409/429/500 to closed outcomes", async () => {
    const cases: [number, string][] = [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [429, "rate_limited"],
      [400, "invalid_input"],
      [500, "upstream_unavailable"],
    ];
    for (const [status, expected] of cases) {
      const { impl } = fetchDouble(() =>
        jsonResponse({ code: "x", messageKey: "crm.affiliates.forbidden", requestId: "r1" }, status),
      );
      const outcome = await fetchAffiliatePartners({}, { fetchImpl: impl });
      expect(outcome.status, `status ${status}`).toBe(expected);
    }
  });

  it("refuses a response that does not match the contract", async () => {
    const { impl } = fetchDouble(() => jsonResponse({ items: [{ id: "1" }], total: 1, limit: 25, offset: 0 }));
    const outcome = await fetchAffiliatePartners({}, { fetchImpl: impl });
    expect(outcome.status).toBe("malformed_response");
  });

  it("maps a network failure to upstream_unavailable, never to success", async () => {
    const impl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const outcome = await fetchAffiliatePartners({}, { fetchImpl: impl });
    expect(outcome.status).toBe("upstream_unavailable");
  });

  it("returns the backend's publicUrl verbatim and builds no URL of its own", async () => {
    const { impl } = fetchDouble(() => jsonResponse(LINK));
    const outcome = await fetchAffiliateTrackingLink("7", { fetchImpl: impl });
    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") return;
    expect(outcome.data.publicUrl).toBe(LINK.publicUrl);
    // The current test origin must never appear in the result.
    expect(outcome.data.publicUrl).not.toContain(window.location.host);
  });
});

describe("mutations", () => {
  it("sends the canonical CSRF header on POST", async () => {
    const { impl, calls } = fetchDouble(() =>
      jsonResponse({ code: "x", messageKey: "crm.affiliates.forbidden", requestId: "r" }, 403),
    );
    await createAffiliatePartner({ code: "alpha", displayName: "A" }, { fetchImpl: impl });

    const mutation = calls.find((c) => c.url === AFFILIATE_PARTNERS_ENDPOINT);
    expect(mutation).toBeDefined();
    expect(mutation!.init?.method).toBe("POST");
    const headers = mutation!.init?.headers as Record<string, string>;
    expect(headers["x-csrf-token"]).toBe("test-csrf-token-0123456789");
  });

  it("abandons the mutation locally when no CSRF token can be obtained", async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/crm/auth/csrf") return new Response("nope", { status: 500 });
      return jsonResponse(LINK);
    }) as unknown as typeof fetch;

    const outcome = await updateAffiliateTrackingLink("7", { status: "active" }, { fetchImpl: impl });
    expect(outcome.status).toBe("forbidden");
    // The mutation itself was never put on the wire.
    expect(calls.filter((url) => url.includes("tracking-links"))).toHaveLength(0);
  });

  it("never sends a GET for a state change", async () => {
    const { impl, calls } = fetchDouble(() => jsonResponse(LINK));
    await updateAffiliateTrackingLink("7", { status: "paused" }, { fetchImpl: impl });
    const mutation = calls.find((c) => c.url.includes("tracking-links/7"));
    expect(mutation!.init?.method).toBe("PATCH");
  });
});

describe("no browser-derived origin", () => {
  /**
   * Strip comments before scanning.
   *
   * These modules DOCUMENT the rule at length ("no `window.location.origin`
   * anywhere in this file"), so a raw substring search would match the very
   * prose that explains the prohibition. The property under test is that no
   * CODE reads a browser-supplied origin, so the comments are removed first and
   * the executable text is what gets checked.
   */
  function codeOf(relativePath: string): string {
    return fs
      .readFileSync(path.join(process.cwd(), relativePath), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const FORBIDDEN = [
    "location.host",
    "location.origin",
    "window.location",
    "document.baseURI",
    "X-Forwarded-Host",
    "x-forwarded-host",
    "Referer",
  ];

  // A URL built from the browser's host would be a redirect gadget: it points
  // wherever the CRM happened to be served from. This must be impossible to
  // reintroduce without failing here.
  it.each([
    "src/application/api/affiliates-client.ts",
    "src/features/affiliates/copy-link.tsx",
    "src/features/affiliates/tracking-link-detail-workspace.tsx",
    "src/features/affiliates/tracking-link-form.tsx",
  ])("builds no origin from the browser in %s", (file) => {
    const code = codeOf(file);
    for (const forbidden of FORBIDDEN) {
      expect(code, `${file} must not reference ${forbidden} in code`).not.toContain(forbidden);
    }
  });

  it("still documents the prohibition in the client source", () => {
    // Guards the stripper itself: if the comments vanished, the check above
    // would keep passing while the reasoning it protects had been deleted.
    const raw = fs.readFileSync(
      path.join(process.cwd(), "src/application/api/affiliates-client.ts"),
      "utf8",
    );
    expect(raw).toContain("location.host");
  });
});
