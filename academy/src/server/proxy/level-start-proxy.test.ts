/**
 * L2START-PLAYER-1 — the bounded level-start proxy.
 *
 * The whole write surface is ONE method against ONE path shape with NO body.
 * These cases pin exactly that, and pin the refusals that keep it structurally
 * safe: no GET, no absolute URL, no path traversal, no body smuggled through,
 * no header the Backend did not ask for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyLevelStart } from "@/server/proxy/level-start-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3214";
const CODE = "v2.l002.kak-ustroen-alfa-trade-academy";

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
  new Request("http://academy.test/x", { method: "POST", headers, body });

describe("level start proxy — one operation, one path, no body", () => {
  it("forwards POST to the fixed Backend path with a validated stableCode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyLevelStart(post({ "x-csrf-token": "t", cookie: "s=1" }), {
      operation: "level-start",
      stableCode: CODE,
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/api/curriculum/v2/levels/${CODE}/start`);
    const init = fetchMock.mock.calls[0]![1];
    expect(init.method).toBe("POST");
    // The request genuinely has no body — not an empty string, nothing.
    expect(init.body).toBeUndefined();
  });

  it("forwards the session cookie and CSRF token, and nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyLevelStart(
      post({
        "x-csrf-token": "token",
        cookie: "trading_platform_session=abc",
        authorization: "Bearer leak",
        "x-forwarded-for": "10.0.0.1",
      }),
      { operation: "level-start", stableCode: CODE },
    );

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("token");
    expect(headers.get("cookie")).toBe("trading_platform_session=abc");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  });

  it("rejects GET (405) without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyLevelStart(
      new Request("http://academy.test/x", { method: "GET" }),
      { operation: "level-start", stableCode: CODE },
    );
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a body outright rather than forwarding it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyLevelStart(
      post({ "content-type": "application/json" }, JSON.stringify({ status: "completed" })),
      { operation: "level-start", stableCode: CODE },
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed or hostile stableCode without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const code of [
      "../../etc/passwd",
      "v2/l002/x",
      "https://evil.example.com/x",
      "code with spaces",
      "",
      "x".repeat(200),
    ]) {
      const response = await proxyLevelStart(post(), { operation: "level-start", stableCode: code });
      expect(response.status, code).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the Backend status and body straight through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ error: "LEVEL_START_LOCKED" }, 403)));
    const response = await proxyLevelStart(post(), { operation: "level-start", stableCode: CODE });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "LEVEL_START_LOCKED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports an unreachable Backend as 502 and does not retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyLevelStart(post(), { operation: "level-start", stableCode: CODE });
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to run outside API mode", async () => {
    process.env.ACADEMY_MODE = "fixtures";
    resetAcademyConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyLevelStart(post(), { operation: "level-start", stableCode: CODE });
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
