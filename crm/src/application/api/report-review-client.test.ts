import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveSubmission,
  claimSubmission,
  fetchReviewDetail,
  fetchReviewQueue,
  requestRevision,
} from "./report-review-client";
import { resetCsrfTokenForTests } from "./auth-client";

const TOKEN = "a".repeat(64);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
/** The backend wraps successful payloads in `{ data: … }`. */
const wrapped = (data: unknown, status = 200) => json({ data }, status);

const CAS = { expectedWorkflowVersion: 3, expectedClaimVersion: 1, expectedSubmittedRevision: 2 };
const SCORES = [{ criterionCode: "r1-process", scaleCode: "meets", comment: "ok" }];
const KEY = "crm-approve-abc12345";

function csrfThen(...responses: Response[]) {
  const impl = vi.fn();
  impl.mockResolvedValueOnce(json({ csrfToken: TOKEN }));
  for (const r of responses) impl.mockResolvedValueOnce(r);
  return impl;
}

beforeEach(() => resetCsrfTokenForTests());

describe("fetchReviewQueue", () => {
  it("calls a relative path with the locale, never the backend origin", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(wrapped({ items: [], nextCursor: null }));
    await fetchReviewQueue({}, { fetchImpl });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url.startsWith("/api/curriculum/v2/report-reviews/queue")).toBe(true);
    expect(url).toContain("locale=ru");
    expect(url).not.toContain("127.0.0.1");
    expect(url).not.toContain("http");
  });

  it("sends same-origin credentials and never caches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(wrapped({ items: [], nextCursor: null }));
    await fetchReviewQueue({}, { fetchImpl });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it("rejects an out-of-range limit locally, with no request", async () => {
    const fetchImpl = vi.fn();
    for (const limit of [0, 51, 1.5, -1]) {
      await expect(fetchReviewQueue({ limit }, { fetchImpl })).resolves.toEqual({ status: "invalid_input" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a reviewer 403 to forbidden — the capability probe", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "FORBIDDEN" }, 403));
    await expect(fetchReviewQueue({}, { fetchImpl })).resolves.toEqual({ status: "forbidden" });
  });

  it("distinguishes a disabled REPORT flag from a forbidden reviewer", async () => {
    // Both are 403 at the transport level and mean completely different things.
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "REPORT_DISABLED" }, 403));
    await expect(fetchReviewQueue({}, { fetchImpl })).resolves.toEqual({ status: "flag_disabled" });
  });

  it("maps 401 to unauthenticated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 401));
    await expect(fetchReviewQueue({}, { fetchImpl })).resolves.toEqual({ status: "unauthenticated" });
  });

  it("rejects a payload that fails the strict schema", async () => {
    // An extra field is a contract change nobody reviewed — fail closed.
    const fetchImpl = vi.fn().mockResolvedValue(wrapped({ items: [], nextCursor: null, extra: 1 }));
    await expect(fetchReviewQueue({}, { fetchImpl })).resolves.toEqual({ status: "malformed_response" });
  });

  it("reports a network failure without leaking detail", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:3220"));
    const outcome = await fetchReviewQueue({}, { fetchImpl });
    expect(outcome).toEqual({ status: "upstream_unavailable" });
    expect(JSON.stringify(outcome)).not.toContain("3220");
  });
});

describe("fetchReviewDetail", () => {
  const summary = {
    submissionRef: "ref", access: "summary", status: "pending_review",
    submittedRevision: 2, workflowVersion: 3, claimVersion: 1,
    submittedAt: "2026-07-26T00:00:00.000Z",
    claim: { state: "unclaimed", expiresAt: null }, reviewStartedAt: null, payload: null,
    // §15 — the operational pointer is part of the contract at BOTH tiers. The
    // schema is strict, so an omitted field is a contract violation and this
    // fixture must carry it.
    operationalWorkItem: null,
  };

  it("accepts the summary tier with a null payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(wrapped(summary));
    const outcome = await fetchReviewDetail("ref", { fetchImpl });
    expect(outcome.status).toBe("success");
    if (outcome.status === "success") expect(outcome.detail.payload).toBeNull();
  });

  it("collapses the backend's not-found into not_found", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "REPORT_SUBMISSION_NOT_FOUND" }, 404));
    await expect(fetchReviewDetail("ref", { fetchImpl })).resolves.toEqual({ status: "not_found" });
  });

  it("encodes the submission ref into the path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(wrapped(summary));
    await fetchReviewDetail("a/b", { fetchImpl });
    expect(fetchImpl.mock.calls[0]![0]).toContain("a%2Fb");
  });
});

describe("decision commands", () => {
  it("sends the CSRF header and the caller's idempotency key", async () => {
    const fetchImpl = csrfThen(
      wrapped({
        operation: "approve", created: true, retry: false, submissionRef: "ref",
        submittedRevision: 2, workflowVersion: 4, claimVersion: 2, reviewId: 1,
        completion: { xpTransactionId: null, xpAwarded: 0, levelNumber: 3, nextLevelNumber: 4, terminal: false, completedAt: "2026-07-26T00:00:00.000Z" },
        appliedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    const outcome = await approveSubmission("ref", { ...CAS, scores: SCORES }, KEY, { fetchImpl });
    expect(outcome.status).toBe("success");

    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/curriculum/v2/report-submissions/ref/approve");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(KEY);
    expect(headers["x-csrf-token"]).toBe(TOKEN);
    expect(JSON.parse(init.body as string)).toEqual({ ...CAS, scores: SCORES });
  });

  it("reuses the SAME key the caller supplied, so a retry is not a new command", async () => {
    for (let i = 0; i < 2; i += 1) {
      // The CSRF token is cached module-scoped, so each iteration must start from
      // a clean slate or the second one would consume the wrong queued response.
      resetCsrfTokenForTests();
      const fetchImpl = csrfThen(json({ error: "boom" }, 500));
      await approveSubmission("ref", { ...CAS, scores: SCORES }, KEY, { fetchImpl });
      const headers = (fetchImpl.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe(KEY);
    }
  });

  it("rejects a malformed idempotency key locally, with no request", async () => {
    for (const bad of ["", "short", "-leadingdash", "has space", "x".repeat(200)]) {
      const fetchImpl = vi.fn();
      await expect(
        approveSubmission("ref", { ...CAS, scores: SCORES }, bad, { fetchImpl }),
      ).resolves.toEqual({ status: "invalid_input" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("maps a conflicting key reuse to a conflict carrying the code", async () => {
    const fetchImpl = csrfThen(json({ error: "REPORT_IDEMPOTENCY_CONFLICT" }, 400));
    await expect(
      approveSubmission("ref", { ...CAS, scores: SCORES }, KEY, { fetchImpl }),
    ).resolves.toEqual({ status: "conflict", code: "REPORT_IDEMPOTENCY_CONFLICT" });
  });

  it("maps a stale CAS version to a conflict", async () => {
    for (const code of [
      "REPORT_WORKFLOW_VERSION_CONFLICT",
      "REPORT_CLAIM_VERSION_CONFLICT",
      "REPORT_REVISION_CONFLICT",
    ]) {
      resetCsrfTokenForTests();
      const fetchImpl = csrfThen(json({ error: code }, 409));
      await expect(
        approveSubmission("ref", { ...CAS, scores: SCORES }, KEY, { fetchImpl }),
      ).resolves.toEqual({ status: "conflict", code });
    }
  });

  it("preserves an idempotent replay result", async () => {
    const fetchImpl = csrfThen(
      wrapped({
        operation: "approve", created: false, retry: true, submissionRef: "ref",
        submittedRevision: 2, workflowVersion: 4, claimVersion: 2, reviewId: 1,
        completion: { xpTransactionId: null, xpAwarded: 0, levelNumber: 3, nextLevelNumber: 4, terminal: false, completedAt: "2026-07-26T00:00:00.000Z" },
        appliedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    const outcome = await approveSubmission("ref", { ...CAS, scores: SCORES }, KEY, { fetchImpl });
    expect(outcome.status).toBe("success");
    if (outcome.status === "success") {
      expect(outcome.result.created).toBe(false);
      expect(outcome.result.retry).toBe(true);
      expect(outcome.result.completion.xpTransactionId).toBeNull();
      expect(outcome.result.completion.xpAwarded).toBe(0);
    }
  });

  it("sends the revision-request fields the contract requires", async () => {
    const fetchImpl = csrfThen(
      wrapped({
        operation: "reject", created: true, retry: false, submissionRef: "ref",
        submittedRevision: 2, workflowVersion: 4, claimVersion: 2,
        claim: { state: "closed", expiresAt: null, reviewerRole: "mentor" },
        reasonCode: "missing-evidence", appliedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    await requestRevision(
      "ref",
      { ...CAS, scores: SCORES, reasonCode: "missing-evidence", humanComment: "c", correctiveAction: "a" },
      "crm-reject-abc12345",
      { fetchImpl },
    );
    const body = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string);
    expect(body).toEqual({
      ...CAS, scores: SCORES, reasonCode: "missing-evidence", humanComment: "c", correctiveAction: "a",
    });
    expect(fetchImpl.mock.calls[1]![0]).toBe("/api/curriculum/v2/report-submissions/ref/reject");
  });

  it("claims with only the CAS tuple", async () => {
    const fetchImpl = csrfThen(
      wrapped({
        operation: "claim", created: true, retry: false, submissionRef: "ref",
        submittedRevision: 2, workflowVersion: 3, claimVersion: 1,
        claim: { state: "active", expiresAt: "2026-07-26T01:00:00.000Z", reviewerRole: "mentor" },
        reasonCode: null, appliedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    await claimSubmission("ref", CAS, "crm-claim-abc12345", { fetchImpl });
    expect(JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string)).toEqual(CAS);
  });
});

describe("no attachment or admin surface is ever called", () => {
  it("only ever targets the five reviewer paths", async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/api/crm/auth/csrf")) return json({ csrfToken: TOKEN });
      return json({ error: "x" }, 500);
    }) as unknown as typeof fetch;

    await fetchReviewQueue({}, { fetchImpl: impl });
    await fetchReviewDetail("ref", { fetchImpl: impl });
    await claimSubmission("ref", CAS, "crm-claim-abc12345", { fetchImpl: impl });
    await requestRevision("ref", { ...CAS, scores: SCORES, reasonCode: "r", humanComment: "c", correctiveAction: "a" }, "crm-reject-abc12345", { fetchImpl: impl });
    await approveSubmission("ref", { ...CAS, scores: SCORES }, KEY, { fetchImpl: impl });

    for (const url of calls) {
      expect(url).not.toContain("attachment");
      expect(url).not.toContain("/api/admin");
      expect(url).not.toContain("reassign");
      expect(url).not.toContain("/xp");
      expect(url).not.toContain("/draft");
      expect(url).not.toContain("/resubmit");
    }
    expect(calls.some((u) => u.includes("/report-reviews/queue"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/approve"))).toBe(true);
  });
});
