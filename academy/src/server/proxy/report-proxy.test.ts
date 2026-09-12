import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyReport, resolveReportTargetPath } from "@/server/proxy/report-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3217";

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

const req = (method: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Request("http://academy.test/x", { method, headers: { ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("report proxy — path resolution (SSRF-bounded)", () => {
  it("builds each learner path from the constant shape + validated segments", () => {
    expect(resolveReportTargetPath({ operation: "report-definition", stableCode: "v2.l003.x", locale: "ru" }))
      .toBe("/api/curriculum/v2/levels/v2.l003.x/report?locale=ru");
    expect(resolveReportTargetPath({ operation: "report-draft", stableCode: "v2.l003.x" }))
      .toBe("/api/curriculum/v2/levels/v2.l003.x/report/draft");
    expect(resolveReportTargetPath({ operation: "report-submit", stableCode: "v2.l003.x" }))
      .toBe("/api/curriculum/v2/levels/v2.l003.x/report/submit");
    expect(resolveReportTargetPath({ operation: "report-resubmit", stableCode: "v2.l003.x" }))
      .toBe("/api/curriculum/v2/levels/v2.l003.x/report/resubmit");
    expect(resolveReportTargetPath({ operation: "report-revisions", stableCode: "v2.l003.x", locale: "ru", limit: "10", cursor: "2" }))
      .toBe("/api/curriculum/v2/levels/v2.l003.x/report/revisions?locale=ru&limit=10&cursor=2");
    expect(resolveReportTargetPath({ operation: "report-revision", stableCode: "v2.l003.x", revisionId: "5", locale: "ru" }))
      .toBe("/api/curriculum/v2/levels/v2.l003.x/report/revisions/5?locale=ru");
  });

  it("rejects a malformed stableCode / locale / revisionId / paging without a path", () => {
    expect(resolveReportTargetPath({ operation: "report-definition", stableCode: "../etc", locale: "ru" })).toBeNull();
    expect(resolveReportTargetPath({ operation: "report-definition", stableCode: "v2.l003.x", locale: "no spaces" })).toBeNull();
    expect(resolveReportTargetPath({ operation: "report-revision", stableCode: "v2.l003.x", revisionId: "0", locale: "ru" })).toBeNull();
    expect(resolveReportTargetPath({ operation: "report-revision", stableCode: "v2.l003.x", revisionId: "1e3", locale: "ru" })).toBeNull();
    expect(resolveReportTargetPath({ operation: "report-revisions", stableCode: "v2.l003.x", locale: "ru", limit: "999", cursor: null })).toBeNull();
  });

  it("has NO attachment operation in its input union (attachments never proxied)", () => {
    // Type-level guarantee mirrored at runtime: an unknown operation yields null.
    expect(resolveReportTargetPath({ operation: "report-attachment" as never, stableCode: "v2.l003.x" } as never)).toBeNull();
  });
});

describe("report proxy — transport", () => {
  it("forwards the definition GET to the fixed Backend path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyReport(req("GET"), { operation: "report-definition", stableCode: "v2.l003.x", locale: "ru" });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/api/curriculum/v2/levels/v2.l003.x/report?locale=ru`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "GET" });
  });

  it("forwards the draft PUT with CSRF + Idempotency-Key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyReport(
      req("PUT", { "content-type": "application/json", "x-csrf-token": "csrf-1", "idempotency-key": "ata-rpt-save-abcd1234" }, { expectedRevision: 0, fieldValues: {} }),
      { operation: "report-draft", stableCode: "v2.l003.x" },
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("PUT");
    const headers = init.headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("csrf-1");
    expect(headers.get("idempotency-key")).toBe("ata-rpt-save-abcd1234");
  });

  it("does not forward CSRF/idempotency headers on a read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyReport(req("GET", { "x-csrf-token": "leak", "idempotency-key": "leak" }), { operation: "report-definition", stableCode: "v2.l003.x", locale: "ru" });
    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("x-csrf-token")).toBeNull();
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("rejects a wrong method (405) without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxyReport(req("GET"), { operation: "report-draft", stableCode: "v2.l003.x" });
    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed (500) in fixture mode (proxy never touches Backend)", async () => {
    process.env.ACADEMY_MODE = "fixture";
    process.env.BACKEND_ORIGIN = "";
    resetAcademyConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxyReport(req("GET"), { operation: "report-definition", stableCode: "v2.l003.x", locale: "ru" });
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
