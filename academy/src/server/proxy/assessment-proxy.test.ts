import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyAssessmentWrite } from "@/server/proxy/assessment-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3214";

function backendJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: new Headers({ "content-type": "application/json" }) });
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

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://academy.test/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}

describe("assessment proxy — bounded write allow-list", () => {
  it("forwards start POST to the fixed Backend path with validated stableCode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await proxyAssessmentWrite(post({ locale: "ru" }, { "x-csrf-token": "t" }), { operation: "assessment-start", stableCode: "v2.l002.kak" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/api/curriculum/v2/levels/v2.l002.kak/assessment/attempts`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("forwards submit POST with validated attemptId and idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyAssessmentWrite(post({ answers: [] }, { "x-csrf-token": "t", "idempotency-key": "ata-asmt-1234abcd" }), { operation: "assessment-submit", attemptId: "42" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/api/curriculum/v2/assessment/attempts/42/submit`);
    const headers = init.headers as Headers;
    expect(headers.get("idempotency-key")).toBe("ata-asmt-1234abcd");
    expect(headers.get("x-csrf-token")).toBe("t");
  });

  it("rejects GET (405) without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxyAssessmentWrite(new Request("http://academy.test/x", { method: "GET" }), { operation: "assessment-start", stableCode: "v2.l002.x" });
    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed stableCode (400) without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxyAssessmentWrite(post({ locale: "ru" }), { operation: "assessment-start", stableCode: "../secret" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive / non-integer attemptId (400) without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const id of ["0", "-3", "1.5", "abc", "12x"]) {
      const res = await proxyAssessmentWrite(post({ answers: [] }), { operation: "assessment-submit", attemptId: id });
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward arbitrary request headers (only the allow-list)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await proxyAssessmentWrite(post({ locale: "ru" }, { "x-csrf-token": "t", "x-secret": "leak" }), { operation: "assessment-start", stableCode: "v2.l002.x" });
    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("x-secret")).toBeNull();
  });
});
