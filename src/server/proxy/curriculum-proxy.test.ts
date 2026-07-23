import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyCurriculumRead, MAX_READ_RESPONSE_BYTES } from "@/server/proxy/curriculum-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3213";

function backendJson(body: unknown, init: { status?: number; requestId?: string; cacheControl?: string; etag?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.requestId) headers.set("x-request-id", init.requestId);
  if (init.cacheControl) headers.set("cache-control", init.cacheControl);
  if (init.etag) headers.set("etag", init.etag);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
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

describe("curriculum proxy — allow-list", () => {
  it("forwards current GET to the fixed Backend path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: { kind: "unavailable", reason: "x" } }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyCurriculumRead(new Request("http://academy.test/api/backend/curriculum/current"), { operation: "curriculum-current" });
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/api/curriculum/v2/current`, expect.objectContaining({ method: "GET" }));
  });

  it("forwards level-content with validated stableCode + locale", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyCurriculumRead(new Request("http://academy.test/x"), { operation: "level-content", stableCode: "level.002", locale: "ru" });
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/api/curriculum/v2/levels/level.002/content?locale=ru`, expect.objectContaining({ method: "GET" }));
  });

  it("rejects a write method (405) without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxyCurriculumRead(new Request("http://academy.test/x", { method: "POST" }), { operation: "curriculum-current" });
    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed stableCode (400) without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxyCurriculumRead(new Request("http://academy.test/x"), { operation: "level-content", stableCode: "../secret", locale: "ru" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed/absent locale (400)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await proxyCurriculumRead(new Request("http://academy.test/x"), { operation: "level-content", stableCode: "l002", locale: null })).status).toBe(400);
    expect((await proxyCurriculumRead(new Request("http://academy.test/x"), { operation: "level-content", stableCode: "l002", locale: "not a locale!" })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("curriculum proxy — SSRF resistance & passthrough", () => {
  it("always targets the configured origin regardless of request URL/host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const req = new Request("http://academy.test/api/backend/curriculum/current", { headers: { host: "evil.example.com", "x-forwarded-host": "evil.example.com" } });
    await proxyCurriculumRead(req, { operation: "curriculum-current" });
    const [target] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe(`${ORIGIN}/api/curriculum/v2/current`);
    expect(target).not.toContain("evil");
  });

  it("preserves request id, cache-control and etag", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ data: {} }, { requestId: "req-9", cacheControl: "no-store", etag: 'W/"abc"' })));
    const res = await proxyCurriculumRead(new Request("http://academy.test/x"), { operation: "curriculum-current" });
    expect(res.headers.get("x-request-id")).toBe("req-9");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBe('W/"abc"');
  });

  it("only forwards cookie/accept/x-request-id (no host/authorization)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const req = new Request("http://academy.test/x", { headers: { cookie: "trading_platform_session=abc", accept: "application/json", host: "academy.test", authorization: "Bearer leak", connection: "keep-alive" } });
    await proxyCurriculumRead(req, { operation: "curriculum-current" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("cookie")).toBe("trading_platform_session=abc");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("connection")).toBeNull();
  });

  it("normalizes an oversized response to 502", async () => {
    const huge = "x".repeat(MAX_READ_RESPONSE_BYTES + 1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(huge, { status: 200, headers: { "content-type": "application/json" } })));
    const res = await proxyCurriculumRead(new Request("http://academy.test/x"), { operation: "curriculum-current" });
    expect(res.status).toBe(502);
  });

  it("normalizes a network failure to 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await proxyCurriculumRead(new Request("http://academy.test/x"), { operation: "curriculum-current" });
    expect(res.status).toBe(502);
    expect((await res.json()).category).toBe("BACKEND_UNAVAILABLE");
  });

  it("fails closed (500) in fixture mode", async () => {
    process.env.ACADEMY_MODE = "fixture";
    delete process.env.BACKEND_ORIGIN;
    resetAcademyConfigCache();
    const res = await proxyCurriculumRead(new Request("http://academy.test/x"), { operation: "curriculum-current" });
    expect(res.status).toBe(500);
    expect((await res.json()).category).toBe("CONFIGURATION_ERROR");
  });
});
