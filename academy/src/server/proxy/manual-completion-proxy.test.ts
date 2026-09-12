/**
 * G3 — the bounded manual-completion proxy.
 *
 * The whole write surface is ONE method against ONE path shape with a
 * `{ requestId }` body. These cases pin exactly that, and pin the refusals that
 * keep it structurally safe: no GET, no absolute URL, no path traversal, no
 * header the Backend did not ask for, no oversized body, no forwarded status
 * the Backend did not send.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  proxyManualCompletion,
  MAX_MANUAL_COMPLETION_BODY_BYTES,
} from "@/server/proxy/manual-completion-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3214";
const CODE = "v2.l009.checklist-pered-vhodom";

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

const REQUEST_BODY = JSON.stringify({ requestId: "ata-mc-11111111-2222-4333-8444-555555555555" });

describe("manual completion proxy — one operation, one path", () => {
  it("forwards POST to the fixed Backend path with a validated stableCode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyManualCompletion(post({ "content-type": "application/json" }, REQUEST_BODY), {
      operation: "manual-complete",
      stableCode: CODE,
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/api/curriculum/v2/levels/${CODE}/complete`);
    expect(fetchMock.mock.calls[0]![1].method).toBe("POST");
    expect(fetchMock.mock.calls[0]![1].redirect).toBe("manual");
  });

  it("forwards the session cookie and CSRF token, and nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyManualCompletion(
      post({
        "content-type": "application/json",
        "x-csrf-token": "token",
        cookie: "trading_platform_session=abc",
        authorization: "Bearer leak",
        "x-forwarded-for": "10.0.0.1",
        "x-real-ip": "10.0.0.1",
      }, REQUEST_BODY),
      { operation: "manual-complete", stableCode: CODE },
    );

    const headers: Headers = fetchMock.mock.calls[0]![1].headers;
    expect(headers.get("cookie")).toBe("trading_platform_session=abc");
    expect(headers.get("x-csrf-token")).toBe("token");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-real-ip")).toBeNull();
  });

  it("passes the body through byte-for-byte without inspecting it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyManualCompletion(post({ "content-type": "application/json" }, REQUEST_BODY), {
      operation: "manual-complete",
      stableCode: CODE,
    });

    const sent = new TextDecoder().decode(fetchMock.mock.calls[0]![1].body as ArrayBuffer);
    expect(sent).toBe(REQUEST_BODY);
  });

  it("refuses a non-POST method without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyManualCompletion(
      new Request("http://academy.test/x", { method: "GET" }),
      { operation: "manual-complete", stableCode: CODE },
    );

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["path traversal", "../../etc/passwd"],
    ["absolute url", "http://evil.test/x"],
    ["slash", "v2/l009"],
    ["empty", ""],
    ["leading dot", ".hidden"],
    ["too long", "a".repeat(200)],
    ["query smuggling", "v2.l009?x=1"],
    ["fragment", "v2.l009#frag"],
  ])("refuses a malformed stableCode (%s) without contacting Backend", async (_label, code) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyManualCompletion(
      post({ "content-type": "application/json" }, REQUEST_BODY),
      { operation: "manual-complete", stableCode: code },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an oversized body without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyManualCompletion(
      post({ "content-type": "application/json" }, "x".repeat(MAX_MANUAL_COMPLETION_BODY_BYTES + 1)),
      { operation: "manual-complete", stableCode: CODE },
    );

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the Backend status and body unchanged on a domain refusal", async () => {
    const refusal = { error: { code: "MANUAL_COMPLETION_LEVEL_WRONG_OWNER" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson(refusal, 409)));

    const response = await proxyManualCompletion(
      post({ "content-type": "application/json" }, REQUEST_BODY),
      { operation: "manual-complete", stableCode: CODE },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(refusal);
  });

  it("never caches a completion receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ data: {} })));

    const response = await proxyManualCompletion(
      post({ "content-type": "application/json" }, REQUEST_BODY),
      { operation: "manual-complete", stableCode: CODE },
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports a Backend outage as 502 and does NOT retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyManualCompletion(
      post({ "content-type": "application/json" }, REQUEST_BODY),
      { operation: "manual-complete", stableCode: CODE },
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses when the Academy is not configured for api mode", async () => {
    process.env.ACADEMY_MODE = "fixture";
    resetAcademyConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyManualCompletion(
      post({ "content-type": "application/json" }, REQUEST_BODY),
      { operation: "manual-complete", stableCode: CODE },
    );

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
