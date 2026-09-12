import { describe, expect, it, vi } from "vitest";
import { fetchUserDetail, USER_DETAIL_ENDPOINT } from "./user-detail-client";

const DETAIL = {
  userId: "1042",
  displayName: "Target Learner",
  email: { value: "l***@e***.test", visibility: "masked" },
  status: "active",
  level: 7,
  xp: 4242,
  emailConfirmed: true,
  createdAt: "2026-01-01T12:00:00.000Z",
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const impl = (r: () => Response) => (async () => r()) as unknown as typeof fetch;

describe("fetchUserDetail — request shape", () => {
  it("calls the exact relative path with no query string", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, DETAIL));
    await fetchUserDetail("1042", { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${USER_DETAIL_ENDPOINT}/1042`);
    expect(url.startsWith("/")).toBe(true);
    expect(url).not.toContain("?");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it("never puts a backend origin in the request URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, DETAIL));
    await fetchUserDetail("1042", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toContain("3110");
    expect(url).not.toContain("127.0.0.1");
  });

  it("makes no request at all for an invalid id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, DETAIL));
    for (const bad of ["0", "01", "-1", "+1", "1.5", "1e3", "mock_user_1", "emp_backend_001", "", " ", "2147483648"]) {
      const result = await fetchUserDetail(bad, { fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(result, bad).toEqual({ status: "invalid_input" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchUserDetail — outcome mapping", () => {
  it("maps a valid 200 to success", async () => {
    const result = await fetchUserDetail("1042", { fetchImpl: impl(() => jsonResponse(200, DETAIL)) });
    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.detail.xp).toBe(4242);
  });

  it("maps a malformed 200 to malformed_response", async () => {
    const result = await fetchUserDetail("1042", {
      fetchImpl: impl(() => jsonResponse(200, { ...DETAIL, status: "suspended" })),
    });
    expect(result.status).toBe("malformed_response");
  });

  it("maps a 200 carrying a fabricated field to malformed_response", async () => {
    const result = await fetchUserDetail("1042", {
      fetchImpl: impl(() => jsonResponse(200, { ...DETAIL, ownerId: "emp_1" })),
    });
    expect(result.status).toBe("malformed_response");
  });

  it("maps a non-JSON 200 to malformed_response", async () => {
    const result = await fetchUserDetail("1042", {
      fetchImpl: impl(
        () => new Response("<html>nope</html>", { status: 200, headers: { "content-type": "text/html" } }),
      ),
    });
    expect(result.status).toBe("malformed_response");
  });

  it.each([
    [400, "invalid_input"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
  ])("maps %i to %s", async (status, expected) => {
    const result = await fetchUserDetail("1042", { fetchImpl: impl(() => jsonResponse(status, {})) });
    expect(result.status).toBe(expected);
  });

  it.each([500, 502, 503, 504])("maps %i to upstream_unavailable", async (status) => {
    const result = await fetchUserDetail("1042", { fetchImpl: impl(() => jsonResponse(status, {})) });
    expect(result.status).toBe("upstream_unavailable");
  });

  it("maps an unrecognized 4xx to malformed_response (fail closed)", async () => {
    const result = await fetchUserDetail("1042", { fetchImpl: impl(() => jsonResponse(418, {})) });
    expect(result.status).toBe("malformed_response");
  });

  it("maps a network failure to upstream_unavailable", async () => {
    const result = await fetchUserDetail("1042", {
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    expect(result.status).toBe("upstream_unavailable");
  });

  it("never returns detail data on failure", async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      const result = await fetchUserDetail("1042", { fetchImpl: impl(() => jsonResponse(status, {})) });
      expect(result).not.toHaveProperty("detail");
    }
  });
});

describe("fetchUserDetail — requestId handling", () => {
  it("prefers the X-Request-Id header", async () => {
    const result = await fetchUserDetail("1042", {
      fetchImpl: impl(() => jsonResponse(404, {}, { "x-request-id": "req_header" })),
    });
    expect(result).toEqual({ status: "not_found", requestId: "req_header" });
  });

  it("falls back to the error envelope requestId and never exposes messageKey", async () => {
    const result = await fetchUserDetail("1042", {
      fetchImpl: impl(() =>
        jsonResponse(404, {
          code: "not_found",
          messageKey: "crm.users.detail.not_found",
          requestId: "req_body",
        }),
      ),
    });
    expect(result).toEqual({ status: "not_found", requestId: "req_body" });
    expect(JSON.stringify(result)).not.toContain("crm.users.detail.not_found");
  });

  it("tolerates a missing error body", async () => {
    const result = await fetchUserDetail("1042", {
      fetchImpl: impl(() => new Response(null, { status: 403 })),
    });
    expect(result.status).toBe("forbidden");
  });
});

describe("fetchUserDetail — abort and timeout", () => {
  it("maps a caller abort to upstream_unavailable", async () => {
    const controller = new AbortController();
    const promise = fetchUserDetail("1042", {
      signal: controller.signal,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        })) as unknown as typeof fetch,
    });
    controller.abort();
    expect((await promise).status).toBe("upstream_unavailable");
  });

  it("aborts the request when the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const promise = fetchUserDetail("1042", {
        timeoutMs: 8_000,
        fetchImpl: ((_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("Aborted", "AbortError"));
            });
          })) as unknown as typeof fetch,
      });
      await vi.advanceTimersByTimeAsync(8_000);
      expect(aborted).toBe(true);
      expect((await promise).status).toBe("upstream_unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
});
