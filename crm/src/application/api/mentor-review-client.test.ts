/**
 * G3 — the mentor-review client contract.
 *
 * Two calls, and the refusals that keep them narrow: no body on approve, no
 * unbounded page, no reviewer id ever sent, and every backend failure mapped to
 * a closed outcome rather than an exception.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The CSRF bootstrap is mocked at the module boundary — the same technique the
// affiliate-leads client test uses — so these cases exercise the mentor contract
// rather than re-testing token plumbing that has its own suite.
const csrfHeadersMock = vi.fn();
vi.mock("@/application/api/auth-client", () => ({
  csrfHeaders: (...args: unknown[]) => csrfHeadersMock(...args),
}));

import {
  approveMentorReview,
  fetchMentorQueue,
} from "@/application/api/mentor-review-client";

const QUEUE_ITEM = {
  progressId: 7,
  levelNumber: 14,
  stableCode: "v2.l014.lichnyy-risk-plan",
  levelTitle: "Личный риск-план",
  xpReward: 250,
  learnerUserId: 53,
  learnerName: "Ученик",
  requestedAt: "2026-08-12T10:00:00.000Z",
  curriculumCode: "ata-v2",
  curriculumVersionNumber: 4,
  // §15 — part of the contract at every tier, and the schema is strict, so an
  // omitted field is a contract violation rather than a tolerated default.
  operationalWorkItem: null,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({ "content-type": "application/json" }),
  });
}

beforeEach(() => {
  csrfHeadersMock.mockReset().mockResolvedValue({ "x-csrf-token": "tok_1" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchMentorQueue", () => {
  it("reads the pinned queue endpoint with a bounded default limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ data: { items: [QUEUE_ITEM], nextCursor: null } }));
    const outcome = await fetchMentorQueue({}, { fetchImpl });

    expect(outcome.status).toBe("success");
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url.startsWith("/api/curriculum/v2/mentor-reviews/queue?")).toBe(true);
    expect(url).toContain("limit=20");
    expect(fetchImpl.mock.calls[0]![1].method).toBe("GET");
    expect(fetchImpl.mock.calls[0]![1].credentials).toBe("same-origin");
  });

  it("never sends a reviewer identity — the session decides", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ data: { items: [], nextCursor: null } }));
    await fetchMentorQueue({}, { fetchImpl });
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).not.toMatch(/reviewer|userId|actor/i);
  });

  it.each([0, -1, 51, 1.5, Number.NaN])("refuses an out-of-range limit (%s) locally", async (limit) => {
    const fetchImpl = vi.fn();
    const outcome = await fetchMentorQueue({ limit: limit as number }, { fetchImpl });
    expect(outcome.status).toBe("invalid_input");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([0, -3, 2.5])("refuses a malformed cursor (%s) locally", async (cursor) => {
    const fetchImpl = vi.fn();
    const outcome = await fetchMentorQueue({ cursor: cursor as number }, { fetchImpl });
    expect(outcome.status).toBe("invalid_input");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps 401 to unauthenticated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "UNAUTHENTICATED" }, 401));
    expect((await fetchMentorQueue({}, { fetchImpl })).status).toBe("unauthenticated");
  });

  it("maps a reviewer-gate 403 to forbidden, and a flag 403 to flag_disabled", async () => {
    const gate = vi.fn().mockResolvedValue(json({ error: "FORBIDDEN" }, 403));
    expect((await fetchMentorQueue({}, { fetchImpl: gate })).status).toBe("forbidden");

    const flag = vi.fn().mockResolvedValue(json({ error: "MENTOR_REVIEW_DISABLED" }, 403));
    expect((await fetchMentorQueue({}, { fetchImpl: flag })).status).toBe("flag_disabled");
  });

  it("rejects a payload carrying an unexpected field", async () => {
    const leaky = { ...QUEUE_ITEM, learnerEmail: "someone@example.com" };
    const fetchImpl = vi.fn().mockResolvedValue(json({ data: { items: [leaky], nextCursor: null } }));
    // `.strict()` is what turns a backend leak into a loud local failure.
    expect((await fetchMentorQueue({}, { fetchImpl })).status).toBe("malformed_response");
  });

  it("maps a transport failure to upstream_unavailable without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    expect((await fetchMentorQueue({}, { fetchImpl })).status).toBe("upstream_unavailable");
  });
});

describe("approveMentorReview", () => {
  /** The CSRF header is mocked, so the command is the only fetch. */
  function fetchWithCsrf(commandResponse: Response) {
    return vi.fn().mockResolvedValue(commandResponse);
  }

  it("posts to the pinned approve path with NO body", async () => {
    const approval = {
      ok: true, created: true, state: "completed", levelNumber: 14,
      stableCode: "v2.l014.lichnyy-risk-plan", learnerUserId: 53, reviewerUserId: 54,
      reviewerRole: "mentor", xpAwarded: 250, xpTransactionId: 9,
      nextLevelNumber: 15, terminal: false, completedAt: "2026-08-12T11:00:00.000Z",
    };
    const fetchImpl = fetchWithCsrf(json({ data: approval }));
    const outcome = await approveMentorReview(7, { fetchImpl });

    expect(outcome.status).toBe("success");
    const call = fetchImpl.mock.calls.at(-1)!;
    expect(call[0]).toBe("/api/curriculum/v2/mentor-reviews/7/approve");
    expect(call[1].method).toBe("POST");
    expect(call[1].body).toBeUndefined();
    expect((call[1].headers as Record<string, string>)["x-csrf-token"]).toBe("tok_1");
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a malformed progressId (%s) locally", async (id) => {
    const fetchImpl = vi.fn();
    const outcome = await approveMentorReview(id as number, { fetchImpl });
    expect(outcome.status).toBe("invalid_input");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a domain conflict to a bounded conflict outcome carrying the code", async () => {
    const fetchImpl = fetchWithCsrf(json({ error: "MENTOR_REVIEW_NOT_PENDING" }, 409));
    const outcome = await approveMentorReview(7, { fetchImpl });
    expect(outcome).toEqual({ status: "conflict", code: "MENTOR_REVIEW_NOT_PENDING" });
  });

  it("maps self-review refusal to a bounded conflict rather than an error", async () => {
    const fetchImpl = fetchWithCsrf(json({ error: "MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN" }, 409));
    const outcome = await approveMentorReview(7, { fetchImpl });
    expect(outcome).toEqual({ status: "conflict", code: "MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN" });
  });

  it("treats an idempotent replay (created:false) as SUCCESS", async () => {
    const replay = {
      ok: true, created: false, state: "completed", levelNumber: 14,
      stableCode: "v2.l014.lichnyy-risk-plan", learnerUserId: 53, reviewerUserId: 54,
      reviewerRole: "mentor", xpAwarded: 250, xpTransactionId: 9,
      nextLevelNumber: 15, terminal: false, completedAt: "2026-08-12T11:00:00.000Z",
    };
    const fetchImpl = fetchWithCsrf(json({ data: replay }));
    const outcome = await approveMentorReview(7, { fetchImpl });
    expect(outcome.status).toBe("success");
    if (outcome.status === "success") expect(outcome.result.created).toBe(false);
  });

  it("refuses locally when no CSRF token can be obtained", async () => {
    csrfHeadersMock.mockResolvedValue({});
    const fetchImpl = vi.fn();
    const outcome = await approveMentorReview(7, { fetchImpl });
    expect(outcome.status).toBe("upstream_unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
