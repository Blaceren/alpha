/**
 * TOOLS-V2 — the bounded tools proxy.
 *
 * Three operations, each pinned to one method and one constant Backend path
 * shape. What these cases pin is the boundary, not the happy path: nothing a
 * caller sends can choose a host, leave the card-id segment, reach a staff
 * route, carry a query, or make a private answer cacheable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TOOLS_BODY_BYTES,
  MAX_TOOLS_RESPONSE_BYTES,
  proxyTools,
  resolveToolsTargetPath,
} from "@/server/proxy/tools-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3215";
const CARD = "cm3k9x2p10000abcdefghij";

function backendJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({ "content-type": "application/json", ...headers }),
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

const request = (method: string, path = "/api/backend/tools/trade-cards", headers: Record<string, string> = {}, body?: BodyInit) =>
  new Request(`http://academy.test${path}`, { method, headers, body });

describe("tools proxy — the path it will build", () => {
  it("pins each operation to one constant Backend path", () => {
    expect(resolveToolsTargetPath({ operation: "trade-card-state" })).toBe("/api/tools/trade-cards");
    expect(resolveToolsTargetPath({ operation: "trade-card-fix" })).toBe("/api/tools/trade-cards");
    expect(resolveToolsTargetPath({ operation: "trade-card-change", cardId: CARD })).toBe(`/api/tools/trade-cards/${CARD}`);
  });

  it("refuses a card id that is not a plain identifier", () => {
    for (const cardId of [
      "../../crm/v1/users",
      "abc/../../../etc/passwd",
      `${CARD}/notes`,
      `${CARD}?admin=1`,
      `${CARD}#x`,
      "http://evil.invalid/x",
      "//evil.invalid/x",
      "clx 1234567",
      "",
      "short",
      "x".repeat(200),
    ]) {
      expect(resolveToolsTargetPath({ operation: "trade-card-change", cardId }), JSON.stringify(cardId)).toBeNull();
    }
  });

  it("never builds a path outside the learner's own tool routes", () => {
    for (const input of [
      { operation: "trade-card-state" } as const,
      { operation: "trade-card-fix" } as const,
      { operation: "trade-card-change", cardId: CARD } as const,
    ]) {
      const path = resolveToolsTargetPath(input)!;
      expect(path.startsWith("/api/tools/trade-cards")).toBe(true);
      expect(path).not.toContain("/crm/");
    }
  });
});

describe("tools proxy — the request it sends", () => {
  it("reads with GET, fixes with POST and changes with PATCH, each on its constant path", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyTools(request("GET"), { operation: "trade-card-state" });
    await proxyTools(request("POST", undefined, { "content-type": "application/json" }, "{}"), { operation: "trade-card-fix" });
    await proxyTools(request("PATCH", `/api/backend/tools/trade-cards/${CARD}`, {}, "{}"), {
      operation: "trade-card-change",
      cardId: CARD,
    });

    expect(fetchMock.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      [`${ORIGIN}/api/tools/trade-cards`, "GET"],
      [`${ORIGIN}/api/tools/trade-cards`, "POST"],
      [`${ORIGIN}/api/tools/trade-cards/${CARD}`, "PATCH"],
    ]);
    for (const call of fetchMock.mock.calls) expect(call[1].redirect).toBe("manual");
  });

  it("forwards the session cookie and the browser's CSRF token on a write, and nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await proxyTools(
      request(
        "POST",
        undefined,
        {
          "content-type": "application/json",
          "x-csrf-token": "browser-token",
          cookie: "session=abc",
          authorization: "Basic dGVhbTpwYXNz",
          "x-forwarded-for": "10.0.0.1",
          "x-real-ip": "10.0.0.2",
          "x-forwarded-host": "evil.invalid",
        },
        JSON.stringify({ plan: {} }),
      ),
      { operation: "trade-card-fix" },
    );

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("browser-token");
    expect(headers.get("cookie")).toBe("session=abc");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBeNull();
  });

  it("sends no body and no CSRF token on a read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyTools(request("GET", undefined, { "x-csrf-token": "t", cookie: "s=1" }), { operation: "trade-card-state" });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBeUndefined();
    expect((init.headers as Headers).get("x-csrf-token")).toBeNull();
    expect((init.headers as Headers).get("cookie")).toBe("s=1");
  });

  it("never mints a CSRF token of its own", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyTools(request("POST", undefined, { cookie: "s=1" }, "{}"), { operation: "trade-card-fix" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]![1].headers as Headers).get("x-csrf-token")).toBeNull();
  });
});

describe("tools proxy — what it refuses without contacting Backend", () => {
  it.each([
    ["DELETE", "trade-card-state"],
    ["POST", "trade-card-state"],
    ["GET", "trade-card-fix"],
    ["PUT", "trade-card-fix"],
    ["POST", "trade-card-change"],
    ["DELETE", "trade-card-change"],
  ] as const)("refuses %s on %s with 405", async (method, operation) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const input = operation === "trade-card-change" ? { operation, cardId: CARD } : { operation };
    const response = await proxyTools(request(method), input);
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a hostile card id with 400", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("PATCH", "/api/backend/tools/trade-cards/x", {}, "{}"), {
      operation: "trade-card-change",
      cardId: "../../crm/v1/users",
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses any query string with 400", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("GET", "/api/backend/tools/trade-cards?userId=7"), { operation: "trade-card-state" });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an oversized body with 413", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("POST", undefined, {}, "x".repeat(MAX_TOOLS_BODY_BYTES + 1)), {
      operation: "trade-card-fix",
    });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 500 outside api mode", async () => {
    process.env.ACADEMY_MODE = "fixture";
    resetAcademyConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tools proxy — the answer it returns", () => {
  it("passes the Backend status and body through, 401 and 403 unchanged", async () => {
    for (const status of [200, 201, 400, 401, 403, 404, 409, 429]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ error: "X" }, status)));
      const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
      expect(response.status).toBe(status);
    }
  });

  it("is never cacheable, whatever the Backend said", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ data: {} }, 200, { "cache-control": "public, max-age=600" })));
    const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 502 on a network failure, without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers 502 on an oversized response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(MAX_TOOLS_RESPONSE_BYTES + 1), { status: 200 })),
    );
    const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
    expect(response.status).toBe(502);
  });
});
