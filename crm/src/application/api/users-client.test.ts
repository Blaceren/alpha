import { describe, expect, it, vi } from "vitest";
import { buildUsersQuery, fetchUsers, USERS_ENDPOINT } from "./users-client";

const USER = {
  userId: "1042",
  displayName: "Пользователь 01",
  email: { value: "l***@e***.test", visibility: "masked" },
  status: "active",
  level: 7,
  emailConfirmed: true,
  createdAt: "2026-01-04T09:15:00.000Z",
  owner: { displayName: "Мария Куратор" },
};

const PAGE = { items: [USER], nextCursor: null };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const impl = (r: () => Response) => (async () => r()) as unknown as typeof fetch;

describe("buildUsersQuery — only the three accepted keys", () => {
  it("always sends a bounded limit", () => {
    expect(buildUsersQuery({})).toBe("limit=25");
    expect(buildUsersQuery({ limit: 50 })).toBe("limit=50");
  });

  it("clamps limit into 1..100", () => {
    expect(buildUsersQuery({ limit: 0 })).toBe("limit=1");
    expect(buildUsersQuery({ limit: -5 })).toBe("limit=1");
    expect(buildUsersQuery({ limit: 500 })).toBe("limit=100");
    expect(buildUsersQuery({ limit: 25.9 })).toBe("limit=25");
  });

  it("passes the cursor through opaquely", () => {
    expect(buildUsersQuery({ cursor: "abc.def" })).toContain("cursor=abc.def");
  });

  it("omits an absent or empty cursor", () => {
    expect(buildUsersQuery({ cursor: null })).not.toContain("cursor");
    expect(buildUsersQuery({ cursor: "" })).not.toContain("cursor");
  });

  it("trims search and omits it when empty", () => {
    expect(buildUsersQuery({ search: "  Лена  " })).toContain("search=%D0%9B%D0%B5%D0%BD%D0%B0");
    expect(buildUsersQuery({ search: "   " })).not.toContain("search");
    expect(buildUsersQuery({ search: "" })).not.toContain("search");
  });

  it("caps search length", () => {
    const query = new URLSearchParams(buildUsersQuery({ search: "a".repeat(400) }));
    expect(query.get("search")!.length).toBe(100);
  });

  it("never serializes an unsupported key", () => {
    const query = buildUsersQuery({
      limit: 10,
      cursor: "c",
      search: "x",
      // Extra keys are not part of the input type; prove none leak even if passed.
      ...({ offset: 5, page: 2, sort: "name", ownerId: "e1", status: "active", role: "admin" } as object),
    });
    const keys = [...new URLSearchParams(query).keys()].sort();
    expect(keys).toEqual(["cursor", "limit", "search"]);
  });
});

describe("buildUsersQuery — owner filter", () => {
  it("omits owner for all (or an omitted value) — the canonical default", () => {
    expect(buildUsersQuery({})).not.toContain("owner");
    expect(buildUsersQuery({ owner: "all" })).not.toContain("owner");
  });

  it("sends owner=mine exactly", () => {
    const query = new URLSearchParams(buildUsersQuery({ owner: "mine" }));
    expect(query.get("owner")).toBe("mine");
  });

  it("sends owner=unassigned exactly", () => {
    const query = new URLSearchParams(buildUsersQuery({ owner: "unassigned" }));
    expect(query.get("owner")).toBe("unassigned");
  });

  it("never puts an employee id on the wire for mine", () => {
    // The wire carries the literal `mine`, never a session employeeId.
    expect(buildUsersQuery({ owner: "mine" })).toBe("limit=25&owner=mine");
  });

  it("composes owner with search and cursor in a deterministic order", () => {
    expect(buildUsersQuery({ cursor: "cur", search: "Лена", owner: "unassigned" })).toBe(
      "limit=25&cursor=cur&search=%D0%9B%D0%B5%D0%BD%D0%B0&owner=unassigned",
    );
  });

  it("refuses to serialize an invalid owner value (never reaches the wire)", () => {
    for (const bad of ["assigned", "ALL", "mine,all", "emp_123", "", "true"]) {
      expect(buildUsersQuery({ owner: bad as never })).not.toContain("owner");
    }
  });

  it("changing only the owner filter does not alter search normalization", () => {
    const withMine = new URLSearchParams(buildUsersQuery({ search: "  Лена  ", owner: "mine" }));
    const withUnassigned = new URLSearchParams(
      buildUsersQuery({ search: "  Лена  ", owner: "unassigned" }),
    );
    expect(withMine.get("search")).toBe("Лена");
    expect(withUnassigned.get("search")).toBe("Лена");
  });
});

describe("fetchUsers — request shape", () => {
  it("uses the relative endpoint with same-origin credentials and no store", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, PAGE));
    await fetchUsers({}, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith(`${USERS_ENDPOINT}?`)).toBe(true);
    expect(url.startsWith("/")).toBe(true);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it("never puts a backend origin in the request URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, PAGE));
    await fetchUsers({}, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toContain("3110");
    expect(url).not.toContain("127.0.0.1");
  });
});

describe("fetchUsers — outcome mapping", () => {
  it("maps a valid 200 to success", async () => {
    const result = await fetchUsers({}, { fetchImpl: impl(() => jsonResponse(200, PAGE)) });
    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.page.items[0]?.userId).toBe("1042");
  });

  it("maps an empty 200 to success", async () => {
    const result = await fetchUsers(
      {},
      { fetchImpl: impl(() => jsonResponse(200, { items: [], nextCursor: null })) },
    );
    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.page.items).toEqual([]);
  });

  it("maps a malformed 200 to malformed_response", async () => {
    const result = await fetchUsers(
      {},
      {
        fetchImpl: impl(() =>
          jsonResponse(200, { items: [{ ...USER, status: "suspended" }], nextCursor: null }),
        ),
      },
    );
    expect(result.status).toBe("malformed_response");
  });

  it("maps a 200 carrying a fabricated field to malformed_response", async () => {
    const result = await fetchUsers(
      {},
      {
        fetchImpl: impl(() =>
          jsonResponse(200, { items: [{ ...USER, ownerId: "emp_1" }], nextCursor: null }),
        ),
      },
    );
    expect(result.status).toBe("malformed_response");
  });

  it("maps a non-JSON 200 to malformed_response", async () => {
    const result = await fetchUsers(
      {},
      {
        fetchImpl: impl(
          () => new Response("<html>nope</html>", { status: 200, headers: { "content-type": "text/html" } }),
        ),
      },
    );
    expect(result.status).toBe("malformed_response");
  });

  it("maps 400/401/403 to their outcomes", async () => {
    const cases: Array<[number, string]> = [
      [400, "invalid_input"],
      [401, "unauthenticated"],
      [403, "forbidden"],
    ];
    for (const [status, expected] of cases) {
      const result = await fetchUsers({}, { fetchImpl: impl(() => jsonResponse(status, {})) });
      expect(result.status).toBe(expected);
    }
  });

  it.each([500, 502, 503, 504])("maps %i to upstream_unavailable", async (status) => {
    const result = await fetchUsers({}, { fetchImpl: impl(() => jsonResponse(status, {})) });
    expect(result.status).toBe("upstream_unavailable");
  });

  it("maps an unrecognized 4xx to malformed_response (fail closed)", async () => {
    const result = await fetchUsers({}, { fetchImpl: impl(() => jsonResponse(418, {})) });
    expect(result.status).toBe("malformed_response");
  });

  it("maps a network failure to upstream_unavailable", async () => {
    const result = await fetchUsers(
      {},
      {
        fetchImpl: (async () => {
          throw new TypeError("Failed to fetch");
        }) as unknown as typeof fetch,
      },
    );
    expect(result.status).toBe("upstream_unavailable");
  });

  it("never returns page data on failure", async () => {
    for (const status of [400, 401, 403, 500]) {
      const result = await fetchUsers({}, { fetchImpl: impl(() => jsonResponse(status, {})) });
      expect(result).not.toHaveProperty("page");
    }
  });
});

describe("fetchUsers — requestId handling", () => {
  it("prefers the X-Request-Id header", async () => {
    const result = await fetchUsers(
      {},
      { fetchImpl: impl(() => jsonResponse(403, {}, { "x-request-id": "req_header" })) },
    );
    expect(result).toEqual({ status: "forbidden", requestId: "req_header" });
  });

  it("falls back to the error envelope requestId", async () => {
    const result = await fetchUsers(
      {},
      {
        fetchImpl: impl(() =>
          jsonResponse(400, {
            code: "invalid_input",
            messageKey: "crm.users.limit_invalid",
            requestId: "req_body",
          }),
        ),
      },
    );
    expect(result).toEqual({ status: "invalid_input", requestId: "req_body" });
    // Backend copy must never travel into anything renderable.
    expect(JSON.stringify(result)).not.toContain("crm.users.limit_invalid");
  });

  it("tolerates a missing error body", async () => {
    const result = await fetchUsers(
      {},
      { fetchImpl: impl(() => new Response(null, { status: 401 })) },
    );
    expect(result.status).toBe("unauthenticated");
  });
});

describe("fetchUsers — abort and timeout", () => {
  it("maps a caller abort to upstream_unavailable", async () => {
    const controller = new AbortController();
    const promise = fetchUsers(
      {},
      {
        signal: controller.signal,
        fetchImpl: ((_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          })) as unknown as typeof fetch,
      },
    );
    controller.abort();
    expect((await promise).status).toBe("upstream_unavailable");
  });

  it("aborts the request when the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const promise = fetchUsers(
        {},
        {
          timeoutMs: 8_000,
          fetchImpl: ((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => {
                aborted = true;
                reject(new DOMException("Aborted", "AbortError"));
              });
            })) as unknown as typeof fetch,
        },
      );
      await vi.advanceTimersByTimeAsync(8_000);
      expect(aborted).toBe(true);
      expect((await promise).status).toBe("upstream_unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
});
