import { describe, expect, it } from "vitest";
import { fetchUserOwnerHistory } from "./user-owner-history-client";

const actor = (over: Record<string, unknown> = {}) => ({
  employeeId: "emp_1",
  displayName: "Нина Ч.",
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  historyId: "h_1",
  transition: "assigned",
  ownerVersion: 1,
  createdAt: "2026-07-20T18:42:00.000Z",
  actor: actor(),
  previousOwner: null,
  nextOwner: actor({ employeeId: "emp_2", displayName: "Пётр О." }),
  ...over,
});

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Captures the exact request the client made. */
function spy(response: Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("fetchUserOwnerHistory — request shape", () => {
  it("calls the exact relative nested path with no query by default", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserOwnerHistory("12", {}, { fetchImpl: s.impl });
    expect(s.calls[0]?.url).toBe("/api/crm/v1/users/12/owner/history");
  });

  it("never sends an absolute URL or a backend origin", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserOwnerHistory("12", {}, { fetchImpl: s.impl });
    expect(s.calls[0]?.url.startsWith("/")).toBe(true);
    expect(s.calls[0]?.url).not.toContain("http");
    expect(s.calls[0]?.url).not.toContain("3110");
  });

  it("sends same-origin credentials, no-store and GET", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserOwnerHistory("12", {}, { fetchImpl: s.impl });
    expect(s.calls[0]?.init.credentials).toBe("same-origin");
    expect(s.calls[0]?.init.cache).toBe("no-store");
    expect(s.calls[0]?.init.method).toBe("GET");
  });

  it("encodes limit and cursor through URLSearchParams", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserOwnerHistory("12", { limit: 20, cursor: "a b/c+d=" }, { fetchImpl: s.impl });
    expect(s.calls[0]?.url).toBe("/api/crm/v1/users/12/owner/history?limit=20&cursor=a+b%2Fc%2Bd%3D");
  });

  it("does not send a request for a malformed learner id", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    const out = await fetchUserOwnerHistory("mock_user_1", {}, { fetchImpl: s.impl });
    expect(out.status).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });

  it("rejects an out-of-range or empty cursor locally, without a request", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    expect((await fetchUserOwnerHistory("12", { limit: 0 }, { fetchImpl: s.impl })).status).toBe("invalid_input");
    expect((await fetchUserOwnerHistory("12", { limit: 51 }, { fetchImpl: s.impl })).status).toBe("invalid_input");
    expect((await fetchUserOwnerHistory("12", { limit: 1.5 }, { fetchImpl: s.impl })).status).toBe("invalid_input");
    expect((await fetchUserOwnerHistory("12", { cursor: "" }, { fetchImpl: s.impl })).status).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });
});

describe("fetchUserOwnerHistory — response mapping", () => {
  it("parses a valid page and propagates the next cursor", async () => {
    const s = spy(reply(200, { items: [item()], nextCursor: "next-cur" }));
    const out = await fetchUserOwnerHistory("12", {}, { fetchImpl: s.impl });
    expect(out.status).toBe("success");
    if (out.status === "success") {
      expect(out.page.items).toHaveLength(1);
      expect(out.page.items[0]?.transition).toBe("assigned");
      expect(out.page.nextCursor).toBe("next-cur");
    }
  });

  it("maps status codes to closed outcomes", async () => {
    const cases: [number, string][] = [
      [400, "invalid_input"],
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [500, "upstream_unavailable"],
      [503, "upstream_unavailable"],
    ];
    for (const [status, expected] of cases) {
      const s = spy(reply(status, { code: "x", messageKey: "y", requestId: "r" }));
      expect((await fetchUserOwnerHistory("12", {}, { fetchImpl: s.impl })).status).toBe(expected);
    }
  });

  it("surfaces a support requestId from the header on error", async () => {
    const s = spy(reply(403, { code: "unauthorized", messageKey: "k", requestId: "body-id" }, { "x-request-id": "hdr-id" }));
    const out = await fetchUserOwnerHistory("12", {}, { fetchImpl: s.impl });
    expect(out.status === "forbidden" && out.requestId).toBe("hdr-id");
  });

  it("treats an unparseable body as malformed_response, never mock fallback", async () => {
    const s = spy(reply(200, { items: [{ historyId: "h", transition: "assigned" }], nextCursor: null }));
    const out = await fetchUserOwnerHistory("12", {}, { fetchImpl: s.impl });
    expect(out.status).toBe("malformed_response");
  });

  it("treats a payload with an extra field as malformed (strict)", async () => {
    const s = spy(reply(200, { items: [item({ actorStaffId: "emp_1" })], nextCursor: null }));
    expect((await fetchUserOwnerHistory("12", {}, { fetchImpl: s.impl })).status).toBe("malformed_response");
  });

  it("treats a network failure as upstream_unavailable", async () => {
    const impl = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    expect((await fetchUserOwnerHistory("12", {}, { fetchImpl: impl })).status).toBe("upstream_unavailable");
  });
});
