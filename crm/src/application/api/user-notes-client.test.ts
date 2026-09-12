import { describe, expect, it, vi } from "vitest";
import { createUserNote, fetchUserNotes } from "./user-notes-client";

const note = (over: Record<string, unknown> = {}) => ({
  noteId: "note_1",
  body: "Позвонил клиенту",
  authorDisplayName: "Нина Ч.",
  createdAt: "2026-07-20T18:42:00.000Z",
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

describe("fetchUserNotes — request shape", () => {
  it("calls the exact relative nested path with no query by default", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserNotes("12", {}, { fetchImpl: s.impl });
    expect(s.calls[0]?.url).toBe("/api/crm/v1/users/12/notes");
  });

  it("never sends an absolute URL or a backend origin", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserNotes("12", {}, { fetchImpl: s.impl });
    expect(s.calls[0]?.url.startsWith("/")).toBe(true);
    expect(s.calls[0]?.url).not.toContain("http");
    expect(s.calls[0]?.url).not.toContain("3110");
  });

  it("sends same-origin credentials and no-store", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserNotes("12", {}, { fetchImpl: s.impl });
    expect(s.calls[0]?.init.credentials).toBe("same-origin");
    expect(s.calls[0]?.init.cache).toBe("no-store");
    expect(s.calls[0]?.init.method).toBe("GET");
  });

  it("encodes limit and cursor through URLSearchParams", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserNotes("12", { limit: 25, cursor: "a b/c+d=" }, { fetchImpl: s.impl });
    expect(s.calls[0]?.url).toBe("/api/crm/v1/users/12/notes?limit=25&cursor=a+b%2Fc%2Bd%3D");
  });

  it("sends only limit and cursor — no unsupported key can be smuggled in", async () => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    await fetchUserNotes(
      "12",
      { limit: 10, cursor: "c", offset: 5, include: "author" } as never,
      { fetchImpl: s.impl },
    );
    const query = s.calls[0]!.url.split("?")[1] ?? "";
    expect([...new URLSearchParams(query).keys()].sort()).toEqual(["cursor", "limit"]);
  });

  it.each([0, 101, -1, 1.5, Number.NaN])("rejects an out-of-range limit (%s) with no request", async (limit) => {
    const s = spy(reply(200, { items: [], nextCursor: null }));
    const out = await fetchUserNotes("12", { limit: limit as number }, { fetchImpl: s.impl });
    expect(out.status).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });

  it.each(["0", "-1", "01", "1.5", "abc", "mock_user_1", "2147483648", ""])(
    "rejects a malformed userId (%s) with no request",
    async (userId) => {
      const s = spy(reply(200, { items: [], nextCursor: null }));
      const out = await fetchUserNotes(userId, {}, { fetchImpl: s.impl });
      expect(out.status).toBe("invalid_input");
      expect(s.calls).toHaveLength(0);
    },
  );
});

describe("fetchUserNotes — outcomes", () => {
  it("returns a validated page", async () => {
    const s = spy(reply(200, { items: [note()], nextCursor: "next" }));
    const out = await fetchUserNotes("12", {}, { fetchImpl: s.impl });
    expect(out).toEqual({ status: "success", page: { items: [note()], nextCursor: "next" } });
  });

  it.each([
    [400, "invalid_input"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
    [500, "upstream_unavailable"],
    [503, "upstream_unavailable"],
  ])("maps HTTP %s to %s", async (status, expected) => {
    const s = spy(reply(status, { code: "internal", messageKey: "k", requestId: "r" }));
    const out = await fetchUserNotes("12", {}, { fetchImpl: s.impl });
    expect(out.status).toBe(expected);
  });

  it("treats HTTP status as authoritative over the body code", async () => {
    // The backend answers 403 with code "unauthorized"; that must not collapse
    // into the 401 unauthenticated state.
    const s = spy(reply(403, { code: "unauthorized", messageKey: "k", requestId: "r" }));
    expect((await fetchUserNotes("12", {}, { fetchImpl: s.impl })).status).toBe("forbidden");
  });

  it("prefers the X-Request-Id header for the support reference", async () => {
    const s = spy(reply(403, { code: "unauthorized", messageKey: "k", requestId: "body-id" }, { "x-request-id": "header-id" }));
    const out = await fetchUserNotes("12", {}, { fetchImpl: s.impl });
    expect(out).toMatchObject({ requestId: "header-id" });
  });

  it("falls back to the validated envelope requestId", async () => {
    const s = spy(reply(403, { code: "unauthorized", messageKey: "k", requestId: "body-id" }));
    const out = await fetchUserNotes("12", {}, { fetchImpl: s.impl });
    expect(out).toMatchObject({ requestId: "body-id" });
  });

  it.each([
    ["extra key", { items: [], nextCursor: null, total: 1 }],
    ["forbidden note field", { items: [note({ employeeId: "e" })], nextCursor: null }],
    ["missing nextCursor", { items: [] }],
    ["wrong root shape", [note()]],
    ["null", null],
  ])("fails closed on a malformed 200 (%s)", async (_label, body) => {
    const s = spy(reply(200, body));
    expect((await fetchUserNotes("12", {}, { fetchImpl: s.impl })).status).toBe("malformed_response");
  });

  it("fails closed on non-JSON", async () => {
    const s = spy(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await fetchUserNotes("12", {}, { fetchImpl: s.impl })).status).toBe("malformed_response");
  });

  it("returns upstream_unavailable on a network failure", async () => {
    const impl = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    expect((await fetchUserNotes("12", {}, { fetchImpl: impl })).status).toBe("upstream_unavailable");
  });

  it("times out without leaking an exception", async () => {
    vi.useFakeTimers();
    const impl = ((_u: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const promise = fetchUserNotes("12", {}, { fetchImpl: impl, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(20);
    expect((await promise).status).toBe("upstream_unavailable");
    vi.useRealTimers();
  });

  it("honours a caller abort", async () => {
    const controller = new AbortController();
    const impl = ((_u: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const promise = fetchUserNotes("12", {}, { fetchImpl: impl, signal: controller.signal });
    controller.abort();
    expect((await promise).status).toBe("upstream_unavailable");
  });
});

describe("createUserNote — request shape", () => {
  it("posts to the exact relative path with no query string", async () => {
    const s = spy(reply(201, note()));
    await createUserNote("12", "текст", { fetchImpl: s.impl });
    expect(s.calls[0]?.url).toBe("/api/crm/v1/users/12/notes");
    expect(s.calls[0]?.url).not.toContain("?");
  });

  it("sends exactly { body } and no author field", async () => {
    const s = spy(reply(201, note()));
    await createUserNote("12", "текст", { fetchImpl: s.impl });
    const sent = JSON.parse(String(s.calls[0]?.init.body));
    expect(Object.keys(sent)).toEqual(["body"]);
    for (const forbidden of ["authorId", "employeeId", "authorDisplayName", "createdAt", "visibility", "pinned"]) {
      expect(sent).not.toHaveProperty(forbidden);
    }
  });

  it("sends the NORMALIZED body, not the raw draft", async () => {
    const s = spy(reply(201, note()));
    await createUserNote("12", "  a\r\nb  ", { fetchImpl: s.impl });
    expect(JSON.parse(String(s.calls[0]?.init.body)).body).toBe("a\nb");
  });

  it("sets method, Content-Type, credentials and no-store", async () => {
    const s = spy(reply(201, note()));
    await createUserNote("12", "текст", { fetchImpl: s.impl });
    const init = s.calls[0]!.init;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it.each(["", "   ", "\r\n", "a".repeat(2001), "bad body"])(
    "rejects an invalid body (%j) with no request",
    async (body) => {
      const s = spy(reply(201, note()));
      const out = await createUserNote("12", body, { fetchImpl: s.impl });
      expect(out.status).toBe("invalid_input");
      expect(s.calls).toHaveLength(0);
    },
  );

  it("rejects a malformed userId with no request", async () => {
    const s = spy(reply(201, note()));
    expect((await createUserNote("abc", "текст", { fetchImpl: s.impl })).status).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });
});

describe("createUserNote — outcomes", () => {
  it("returns the validated created note on 201", async () => {
    const s = spy(reply(201, note()));
    expect(await createUserNote("12", "текст", { fetchImpl: s.impl })).toEqual({
      status: "success",
      note: note(),
    });
  });

  it("does NOT accept a 200 as a successful create", async () => {
    const s = spy(reply(200, note()));
    expect((await createUserNote("12", "текст", { fetchImpl: s.impl })).status).toBe(
      "malformed_response",
    );
  });

  it.each([
    [400, "invalid_input"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
    [500, "upstream_unavailable"],
  ])("maps HTTP %s to %s", async (status, expected) => {
    const s = spy(reply(status, { code: "internal", messageKey: "k", requestId: "r" }));
    expect((await createUserNote("12", "текст", { fetchImpl: s.impl })).status).toBe(expected);
  });

  it.each([
    ["enveloped", { note: note() }],
    ["forbidden field", note({ authorId: "a" })],
    ["missing field", { noteId: "n", body: "b" }],
  ])("fails closed on a malformed 201 (%s)", async (_label, body) => {
    const s = spy(reply(201, body));
    expect((await createUserNote("12", "текст", { fetchImpl: s.impl })).status).toBe(
      "malformed_response",
    );
  });

  it("returns upstream_unavailable on a network failure", async () => {
    const impl = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    expect((await createUserNote("12", "текст", { fetchImpl: impl })).status).toBe(
      "upstream_unavailable",
    );
  });

  it("honours a caller abort", async () => {
    const controller = new AbortController();
    const impl = ((_u: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const promise = createUserNote("12", "текст", { fetchImpl: impl, signal: controller.signal });
    controller.abort();
    expect((await promise).status).toBe("upstream_unavailable");
  });
});
