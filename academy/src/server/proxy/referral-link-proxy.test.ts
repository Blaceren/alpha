/**
 * POCKETCTA-1 — the bounded Pocket referral-link proxy.
 *
 * The whole surface is ONE method against ONE constant path with NO body. These
 * cases pin exactly that, and pin the refusals that keep it structurally safe:
 * no other method, no absolute URL or host from the caller, no body smuggled
 * through, no `authorization` forwarded, no shared cache, and no SSRF — there is
 * no input at all from which a destination could be derived.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  proxyReferralLink,
  REFERRAL_LINK_BACKEND_PATH,
  MAX_REFERRAL_LINK_RESPONSE_BYTES,
} from "@/server/proxy/referral-link-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3215";
const EXTERNAL_URL =
  "https://affiliate.example.invalid/register?utm_campaign=1&cid=2&clickid=tq-x&click_id=tq-x&landing=Landing_1";

function backendJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({ "content-type": "application/json" }),
  });
}

let originalEnv: Record<string, string | undefined>;
beforeEach(() => {
  originalEnv = { ACADEMY_MODE: process.env.ACADEMY_MODE, BACKEND_ORIGIN: process.env.BACKEND_ORIGIN };
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();
});
afterEach(() => {
  process.env.ACADEMY_MODE = originalEnv.ACADEMY_MODE;
  process.env.BACKEND_ORIGIN = originalEnv.BACKEND_ORIGIN;
  resetAcademyConfigCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const post = (headers: Record<string, string> = {}, body?: BodyInit) =>
  new Request("http://academy.test/api/backend/exchange/referral-link", { method: "POST", headers, body });

const input = { operation: "referral-link" } as const;

describe("referral-link proxy — one operation, one path, no body", () => {
  it("forwards POST to the one constant Backend path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ referralUrl: EXTERNAL_URL }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyReferralLink(post({ "x-csrf-token": "t", cookie: "s=1" }), input);

    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}${REFERRAL_LINK_BACKEND_PATH}`);
    expect(REFERRAL_LINK_BACKEND_PATH).toBe("/api/exchange/referral-link");
    const init = fetchMock.mock.calls[0]![1];
    expect(init.method).toBe("POST");
    // The request genuinely has no body — not an empty string, nothing.
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
  });

  it("forwards the session cookie and the browser's CSRF token, and nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ referralUrl: EXTERNAL_URL }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyReferralLink(
      post({
        "x-csrf-token": "browser-token",
        cookie: "trading_platform_session=abc",
        authorization: "Basic dGVhbTpwYXNz",
        "x-forwarded-for": "10.0.0.1",
        "x-real-ip": "10.0.0.2",
      }),
      input,
    );

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("browser-token");
    expect(headers.get("cookie")).toBe("trading_platform_session=abc");
    // The ingress Basic Auth credential must never reach the Backend.
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-real-ip")).toBeNull();
  });

  it("never mints a CSRF token of its own", async () => {
    // A server-minted token would defeat the double-submit check it is meant to
    // satisfy. With no token from the caller, none is sent.
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ referralUrl: EXTERNAL_URL }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyReferralLink(post({ cookie: "s=1" }), input);

    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(1);
    // No extra request was made to bootstrap a token…
    expect(calls[0]![0]).toBe(`${ORIGIN}${REFERRAL_LINK_BACKEND_PATH}`);
    // …and no token was invented.
    expect((calls[0]![1].headers as Headers).get("x-csrf-token")).toBeNull();
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])(
    "rejects %s with 405 without contacting Backend",
    async (method) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const request = new Request("http://academy.test/api/backend/exchange/referral-link", { method });
      const response = await proxyReferralLink(request, input);
      expect(response.status).toBe(405);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a body outright rather than forwarding it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // There is no legitimate field here, so a caller nominating a target URL, a
    // clickid or another learner is refused before Backend is contacted.
    for (const body of [
      JSON.stringify({ url: "https://evil.example.com" }),
      JSON.stringify({ clickid: "tq-attacker" }),
      JSON.stringify({ userId: 1 }),
      "x",
    ]) {
      const response = await proxyReferralLink(post({ "content-type": "application/json" }, body), input);
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes no destination from the caller — no SSRF primitive exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ referralUrl: EXTERNAL_URL }));
    vi.stubGlobal("fetch", fetchMock);

    // Every conceivable caller-supplied destination: a query, a poisoned Host, a
    // forwarded host, an absolute URL in the path. All are ignored.
    const hostile = new Request(
      "http://academy.test/api/backend/exchange/referral-link?target=https://evil.example.com&url=http://169.254.169.254/",
      {
        method: "POST",
        headers: {
          host: "evil.example.com",
          "x-forwarded-host": "evil.example.com",
          "x-original-host": "evil.example.com",
          "x-forwarded-proto": "http",
        },
      },
    );
    await proxyReferralLink(hostile, input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const target = String(fetchMock.mock.calls[0]![0]);
    expect(target).toBe(`${ORIGIN}${REFERRAL_LINK_BACKEND_PATH}`);
    expect(target).not.toContain("evil.example.com");
    expect(target).not.toContain("169.254.169.254");
    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBeNull();
  });

  it("refuses an operation it does not own", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyReferralLink(
      post(),
      { operation: "something-else" } as unknown as typeof input,
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the Backend status and body straight through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ referralUrl: EXTERNAL_URL })));
    const response = await proxyReferralLink(post(), input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ referralUrl: EXTERNAL_URL });
  });

  it("forwards an unauthenticated Backend answer unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ error: "UNAUTHENTICATED" }, 401)));
    const response = await proxyReferralLink(post(), input);
    expect(response.status).toBe(401);
    // No URL is invented for a caller the Backend refused.
    expect(await response.text()).not.toContain("affiliate.example.invalid");
  });

  it("is never cacheable, whatever the Backend says", async () => {
    // A shared cache would hand the next learner the previous learner's clickid.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ referralUrl: EXTERNAL_URL }), {
          status: 200,
          headers: new Headers({ "content-type": "application/json", "cache-control": "public, max-age=600" }),
        }),
      ),
    );
    const response = await proxyReferralLink(post(), input);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports an unreachable Backend as 502 and does not retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyReferralLink(post(), input);
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds the response size", async () => {
    const oversized = "x".repeat(MAX_REFERRAL_LINK_RESPONSE_BYTES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ referralUrl: oversized }), {
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
        }),
      ),
    );
    const response = await proxyReferralLink(post(), input);
    expect(response.status).toBe(502);
  });

  it("refuses to run outside API mode", async () => {
    process.env.ACADEMY_MODE = "fixtures";
    resetAcademyConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyReferralLink(post(), input);
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the proxy allow-list stays narrow", () => {
  it("exposes exactly one exchange route and no wildcard", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = "src/app/api/backend/exchange";
    // Exactly one route file under the exchange namespace…
    const found: string[] = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const next = path.join(current, entry.name);
        if (entry.isDirectory()) walk(next);
        else found.push(next.replace(/\\/g, "/"));
      }
    };
    walk(dir);
    expect(found).toEqual(["src/app/api/backend/exchange/referral-link/route.ts"]);
    // …and it is not a catch-all segment.
    expect(found.some((f) => f.includes("[") || f.includes("..."))).toBe(false);
  });

  it("the route exports POST and nothing else", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/app/api/backend/exchange/referral-link/route.ts", "utf8");
    const exported = [...source.matchAll(/export async function ([A-Z]+)/g)].map((m) => m[1]);
    expect(exported).toEqual(["POST"]);
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      expect(source).not.toContain(`function ${method}`);
    }
  });

  it("the affiliate host and base URL are not in the Academy source", async () => {
    const fs = await import("node:fs");
    for (const file of [
      "src/server/proxy/referral-link-proxy.ts",
      "src/lib/pocket-registration/referral-link-client.ts",
      "src/features/pocket-registration/pocket-registration.tsx",
    ]) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/shortink/i);
      expect(source).not.toMatch(/utm_campaign=\d/);
      expect(source).not.toMatch(/POCKET_AFFILIATE_BASE_URL/);
    }
  });
});
