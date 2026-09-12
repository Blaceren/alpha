import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchReportContext,
  saveReportDraft,
  submitReport,
  resubmitReport,
  newReportRequestId,
  __resetReportCsrfCacheForTests,
} from "@/lib/report/report-client";
import { buildContext, buildSubmission } from "@/features/report/test-fixtures";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: new Headers({ "content-type": "application/json" }) });
}
const csrfOk = () => json({ csrfToken: "csrf-xyz" });
const cmdOk = () => json({ data: { kind: "saved", created: true, retry: false, acceptedRevision: 1, resultingWorkflowVersion: 1, appliedAt: "t", submission: buildSubmission() } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  __resetReportCsrfCacheForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;

describe("report client — same-origin + read", () => {
  it("reads the definition from the same-origin proxy with no credentials header", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: buildContext("available", null) }));
    const res = await fetchReportContext("v2.l003.x", "ru");
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/backend/curriculum/levels/v2.l003.x/report?locale=ru");
    expect(init.credentials).toBe("same-origin");
    expect(init.method).toBe("GET");
    expect(url.startsWith("/api/backend/")).toBe(true); // never a Backend origin
  });

  it("surfaces a 404 as a flag-disabled-shaped error", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "NOT_FOUND" }, 404));
    const res = await fetchReportContext("v2.l003.x", "ru");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code === "NOT_FOUND" || res.error.status === 404).toBe(true);
  });
});

describe("report client — writes carry CSRF + a valid Idempotency-Key", () => {
  it("save bootstraps CSRF then PUTs draft with idempotency key", async () => {
    fetchMock.mockResolvedValueOnce(csrfOk()).mockResolvedValueOnce(cmdOk());
    const key = newReportRequestId("save");
    expect(IDEMPOTENCY_RE.test(key)).toBe(true);
    const res = await saveReportDraft("v2.l003.x", 0, { "trade1-instrument": "EURUSD" }, key);
    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/backend/csrf");
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/backend/curriculum/levels/v2.l003.x/report/draft");
    expect(init.method).toBe("PUT");
    const headers = init.headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("csrf-xyz");
    expect(headers.get("idempotency-key")).toBe(key);
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body as string)).toEqual({ expectedRevision: 0, fieldValues: { "trade1-instrument": "EURUSD" } });
  });

  it("submit POSTs with expectedRevision + idempotency key", async () => {
    fetchMock.mockResolvedValueOnce(csrfOk()).mockResolvedValueOnce(json({ data: { kind: "submitted", created: false, retry: false, acceptedRevision: 1, resultingWorkflowVersion: 2, appliedAt: "t", submission: buildSubmission({ status: "pending_review" }) } }));
    const res = await submitReport("v2.l003.x", 1, "ata-rpt-submit-abcd1234");
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/backend/curriculum/levels/v2.l003.x/report/submit");
    expect(JSON.parse(init.body as string)).toEqual({ expectedRevision: 1 });
    expect((init.headers as Headers).get("idempotency-key")).toBe("ata-rpt-submit-abcd1234");
  });

  it("resubmit targets the resubmit route", async () => {
    fetchMock.mockResolvedValueOnce(csrfOk()).mockResolvedValueOnce(json({ data: { kind: "resubmitted", created: false, retry: false, acceptedRevision: 2, resultingWorkflowVersion: 4, appliedAt: "t", submission: buildSubmission({ status: "pending_review" }) } }));
    const res = await resubmitReport("v2.l003.x", 3, "ata-rpt-resubmit-abcd1234");
    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/backend/curriculum/levels/v2.l003.x/report/resubmit");
  });

  it("never calls an attachment route", async () => {
    fetchMock.mockResolvedValueOnce(csrfOk()).mockResolvedValueOnce(cmdOk());
    await saveReportDraft("v2.l003.x", 0, {}, "ata-rpt-save-abcd1234");
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("attachment");
    }
  });

  it("does not auto-retry a failed write (single request identity)", async () => {
    fetchMock.mockResolvedValueOnce(csrfOk()).mockRejectedValueOnce(new Error("network"));
    const res = await saveReportDraft("v2.l003.x", 0, {}, "ata-rpt-save-abcd1234");
    expect(res.ok).toBe(false);
    // one csrf + one write attempt only
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
