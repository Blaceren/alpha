import { describe, expect, it } from "vitest";
import { fetchOwnerCandidates, fetchUserOwner, setUserOwner } from "./user-owner-client";

const identity = { employeeId: "emp_1", displayName: "Владелец Альфа" };

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Captures the exact request the client made. */
function spy(...responses: (Response | Promise<Response>)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const impl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return Promise.resolve(r);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

/* ------------------------------------------------------- fetchUserOwner */

describe("fetchUserOwner — request shape", () => {
  it("calls the exact relative owner path with no query", async () => {
    const s = spy(reply(200, { owner: null, ownerVersion: 0 }));
    await fetchUserOwner("12", { fetchImpl: s.impl });
    expect(s.calls[0]?.url).toBe("/api/crm/v1/users/12/owner");
  });

  it("sends same-origin credentials, no-store, GET, and no backend origin", async () => {
    const s = spy(reply(200, { owner: null, ownerVersion: 0 }));
    await fetchUserOwner("12", { fetchImpl: s.impl });
    expect(s.calls[0]?.init.credentials).toBe("same-origin");
    expect(s.calls[0]?.init.cache).toBe("no-store");
    expect(s.calls[0]?.init.method).toBe("GET");
    expect(s.calls[0]?.url).not.toContain("http");
    expect(s.calls[0]?.url).not.toContain("3110");
  });

  it("makes zero requests for an invalid userId", async () => {
    const s = spy(reply(200, { owner: null, ownerVersion: 0 }));
    const out = await fetchUserOwner("mock_user_1", { fetchImpl: s.impl });
    expect(out.status).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });
});

describe("fetchUserOwner — outcomes", () => {
  it("returns success with the validated owner", async () => {
    const s = spy(reply(200, { owner: identity, ownerVersion: 2 }));
    const out = await fetchUserOwner("12", { fetchImpl: s.impl });
    expect(out).toEqual({ status: "success", owner: { owner: identity, ownerVersion: 2 } });
  });

  it.each([
    [400, "invalid_input"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
    [500, "upstream_unavailable"],
  ] as const)("maps %i to %s", async (status, expected) => {
    const s = spy(reply(status, { code: "x", messageKey: "k", requestId: "r1" }, { "x-request-id": "r1" }));
    const out = await fetchUserOwner("12", { fetchImpl: s.impl });
    expect(out.status).toBe(expected);
  });

  it("prefers the X-Request-Id header for the support reference", async () => {
    const s = spy(reply(403, { code: "unauthorized", messageKey: "k", requestId: "body" }, { "x-request-id": "hdr" }));
    const out = await fetchUserOwner("12", { fetchImpl: s.impl });
    expect(out).toMatchObject({ status: "forbidden", requestId: "hdr" });
  });

  it("treats a schema-violating 200 as malformed", async () => {
    const s = spy(reply(200, { owner: { employeeId: "e", displayName: "n", email: "x@y" }, ownerVersion: 1 }));
    expect((await fetchUserOwner("12", { fetchImpl: s.impl })).status).toBe("malformed_response");
  });

  it("treats non-JSON as malformed", async () => {
    const s = spy(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await fetchUserOwner("12", { fetchImpl: s.impl })).status).toBe("malformed_response");
  });

  it("treats a thrown fetch (network/abort/timeout) as upstream_unavailable", async () => {
    const impl = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    expect((await fetchUserOwner("12", { fetchImpl: impl })).status).toBe("upstream_unavailable");
  });
});

/* -------------------------------------------------- fetchOwnerCandidates */

describe("fetchOwnerCandidates — request shape", () => {
  it("calls the flat candidates path with no query by default", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchOwnerCandidates({}, { fetchImpl: s.impl });
    expect(s.calls[0]?.url).toBe("/api/crm/v1/owner-candidates");
  });

  it("sends only limit and cursor — no search key can be smuggled in", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchOwnerCandidates(
      { limit: 50, cursor: "a b/c" } as unknown as { limit: number; cursor: string; search?: string },
      { fetchImpl: s.impl },
    );
    expect(s.calls[0]?.url).toBe("/api/crm/v1/owner-candidates?limit=50&cursor=a+b%2Fc");
    expect(s.calls[0]?.url).not.toContain("search");
  });

  it("rejects an out-of-range limit without a request", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    expect((await fetchOwnerCandidates({ limit: 101 }, { fetchImpl: s.impl })).status).toBe("invalid_input");
    expect((await fetchOwnerCandidates({ limit: 0 }, { fetchImpl: s.impl })).status).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });

  it("rejects an empty cursor without a request", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    expect((await fetchOwnerCandidates({ cursor: "" }, { fetchImpl: s.impl })).status).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });

  it("returns success with the validated page", async () => {
    const s = spy(reply(200, { items: [identity], nextCursor: "c2" }));
    const out = await fetchOwnerCandidates({}, { fetchImpl: s.impl });
    expect(out).toEqual({ status: "success", page: { items: [identity], nextCursor: "c2" } });
  });

  it("maps 403 to forbidden", async () => {
    const s = spy(reply(403, { code: "unauthorized", messageKey: "k", requestId: "r" }));
    expect((await fetchOwnerCandidates({}, { fetchImpl: s.impl })).status).toBe("forbidden");
  });

  it("treats a candidate carrying staffRole as malformed", async () => {
    const s = spy(reply(200, { items: [{ ...identity, staffRole: "support" }], nextCursor: null }));
    expect((await fetchOwnerCandidates({}, { fetchImpl: s.impl })).status).toBe("malformed_response");
  });
});

/* -------------------------------------------------------------- setUserOwner */

describe("setUserOwner — request shape", () => {
  it("PUTs the exact two-field body and no query string", async () => {
    const s = spy(reply(200, { owner: identity, ownerVersion: 1 }));
    await setUserOwner("12", "emp_1", 0, { fetchImpl: s.impl });
    expect(s.calls[0]?.url).toBe("/api/crm/v1/users/12/owner");
    expect(s.calls[0]?.init.method).toBe("PUT");
    expect(s.calls[0]?.init.credentials).toBe("same-origin");
    expect(s.calls[0]?.init.cache).toBe("no-store");
    expect(JSON.parse(String(s.calls[0]?.init.body))).toEqual({ ownerEmployeeId: "emp_1", expectedVersion: 0 });
  });

  it("sends null verbatim for an unassign", async () => {
    const s = spy(reply(200, { owner: null, ownerVersion: 3 }));
    await setUserOwner("12", null, 2, { fetchImpl: s.impl });
    expect(JSON.parse(String(s.calls[0]?.init.body))).toEqual({ ownerEmployeeId: null, expectedVersion: 2 });
  });

  it("keeps a numeric-looking employeeId a string in the body", async () => {
    const s = spy(reply(200, { owner: { employeeId: "123", displayName: "n" }, ownerVersion: 1 }));
    await setUserOwner("12", "123", 0, { fetchImpl: s.impl });
    const body = JSON.parse(String(s.calls[0]?.init.body));
    expect(body.ownerEmployeeId).toBe("123");
    expect(typeof body.ownerEmployeeId).toBe("string");
  });

  it.each([
    ["mock_user_1", "emp_1", 0],
    ["12", "   ", 0],
    ["12", "emp_1", -1],
    ["12", "emp_1", 1.5],
  ] as const)("makes zero requests for invalid input (%s,%s,%s)", async (userId, emp, ver) => {
    const s = spy(reply(200, { owner: null, ownerVersion: 0 }));
    const out = await setUserOwner(userId, emp, ver, { fetchImpl: s.impl });
    expect(out.status).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });
});

describe("setUserOwner — outcomes", () => {
  it("returns success with the validated new state", async () => {
    const s = spy(reply(200, { owner: identity, ownerVersion: 5 }));
    const out = await setUserOwner("12", "emp_1", 4, { fetchImpl: s.impl });
    expect(out).toEqual({ status: "success", owner: { owner: identity, ownerVersion: 5 } });
  });

  it("maps 409 to a distinct conflict outcome", async () => {
    const s = spy(reply(409, { code: "conflict", messageKey: "crm.users.owner.conflict", requestId: "r9" }));
    const out = await setUserOwner("12", "emp_1", 1, { fetchImpl: s.impl });
    expect(out).toMatchObject({ status: "conflict", requestId: "r9" });
  });

  it("distinguishes a candidate 404 from a learner 404 by messageKey", async () => {
    const candidate = spy(reply(404, { code: "not_found", messageKey: "crm.users.owner.candidate_not_found", requestId: "rc" }));
    const learner = spy(reply(404, { code: "not_found", messageKey: "crm.users.owner.not_found", requestId: "rl" }));
    expect((await setUserOwner("12", "emp_x", 0, { fetchImpl: candidate.impl })).status).toBe("candidate_not_found");
    expect((await setUserOwner("12", "emp_x", 0, { fetchImpl: learner.impl })).status).toBe("not_found");
  });

  it("treats a 404 with no readable messageKey as a learner not_found", async () => {
    const s = spy(new Response("<html>", { status: 404, headers: { "content-type": "text/html", "x-request-id": "rh" } }));
    const out = await setUserOwner("12", "emp_x", 0, { fetchImpl: s.impl });
    expect(out).toMatchObject({ status: "not_found", requestId: "rh" });
  });

  it("treats a non-200 ok status (e.g. 201) as malformed", async () => {
    const s = spy(reply(201, { owner: identity, ownerVersion: 1 }));
    expect((await setUserOwner("12", "emp_1", 0, { fetchImpl: s.impl })).status).toBe("malformed_response");
  });

  it("treats a schema-violating 200 as malformed", async () => {
    const s = spy(reply(200, { owner: identity, ownerVersion: 1, reason: "x" }));
    expect((await setUserOwner("12", "emp_1", 0, { fetchImpl: s.impl })).status).toBe("malformed_response");
  });

  it("treats a thrown fetch as upstream_unavailable", async () => {
    const impl = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    expect((await setUserOwner("12", "emp_1", 0, { fetchImpl: impl })).status).toBe("upstream_unavailable");
  });

  it("maps 403 to forbidden", async () => {
    const s = spy(reply(403, { code: "unauthorized", messageKey: "k", requestId: "r" }));
    expect((await setUserOwner("12", "emp_1", 0, { fetchImpl: s.impl })).status).toBe("forbidden");
  });
});
