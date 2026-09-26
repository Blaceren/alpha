import { describe, expect, it, vi } from "vitest";
import { fetchSession, SESSION_ENDPOINT } from "./session-client";

const VALID_DTO = {
  employeeId: "emp_7f3a9c",
  displayName: "Ирина Соколова",
  role: "support",
  effectivePermissions: ["edit_user_notes"],
  permissionVersion: 3,
  expiresAt: "2026-07-20T18:30:00.000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchSession — request shape", () => {
  it("calls the relative session path with same-origin credentials and no store", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, VALID_DTO));
    await fetchSession({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SESSION_ENDPOINT);
    expect(url.startsWith("/")).toBe(true);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it("never puts a backend origin in the request URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, VALID_DTO));
    await fetchSession({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toContain("127.0.0.1");
  });
});

describe("fetchSession — outcome mapping", () => {
  it("maps a valid 200 to authenticated", async () => {
    const result = await fetchSession({
      fetchImpl: (async () => jsonResponse(200, VALID_DTO)) as unknown as typeof fetch,
    });
    expect(result.status).toBe("authenticated");
    if (result.status === "authenticated") {
      expect(result.dto.employeeId).toBe("emp_7f3a9c");
    }
  });

  it("maps a malformed 200 to malformed_response", async () => {
    const result = await fetchSession({
      fetchImpl: (async () =>
        jsonResponse(200, { ...VALID_DTO, role: "superadmin" })) as unknown as typeof fetch,
    });
    expect(result.status).toBe("malformed_response");
  });

  it("maps a 200 carrying an extra sensitive field to malformed_response", async () => {
    const result = await fetchSession({
      fetchImpl: (async () =>
        jsonResponse(200, { ...VALID_DTO, email: "a@b.test" })) as unknown as typeof fetch,
    });
    expect(result.status).toBe("malformed_response");
  });

  it("maps a non-JSON 200 body to malformed_response", async () => {
    const result = await fetchSession({
      fetchImpl: (async () =>
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })) as unknown as typeof fetch,
    });
    expect(result.status).toBe("malformed_response");
  });

  it("maps 401 to unauthenticated", async () => {
    const result = await fetchSession({
      fetchImpl: (async () => jsonResponse(401, {})) as unknown as typeof fetch,
    });
    expect(result.status).toBe("unauthenticated");
  });

  it("maps 403 to forbidden", async () => {
    const result = await fetchSession({
      fetchImpl: (async () => jsonResponse(403, {})) as unknown as typeof fetch,
    });
    expect(result.status).toBe("forbidden");
  });

  it.each([500, 502, 503, 504])("maps %i to upstream_unavailable", async (status) => {
    const result = await fetchSession({
      fetchImpl: (async () => jsonResponse(status, {})) as unknown as typeof fetch,
    });
    expect(result.status).toBe("upstream_unavailable");
  });

  it("maps an unrecognized 4xx to malformed_response (fail closed)", async () => {
    const result = await fetchSession({
      fetchImpl: (async () => jsonResponse(418, {})) as unknown as typeof fetch,
    });
    expect(result.status).toBe("malformed_response");
  });

  it("maps a network failure to upstream_unavailable", async () => {
    const result = await fetchSession({
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    expect(result.status).toBe("upstream_unavailable");
  });

  it("never returns a fallback session on failure", async () => {
    for (const status of [401, 403, 500]) {
      const result = await fetchSession({
        fetchImpl: (async () => jsonResponse(status, {})) as unknown as typeof fetch,
      });
      expect(result).not.toHaveProperty("dto");
    }
  });
});

describe("fetchSession — error envelope", () => {
  it("surfaces only requestId from a valid 401 envelope", async () => {
    const result = await fetchSession({
      fetchImpl: (async () =>
        jsonResponse(401, {
          code: "unauthorized",
          messageKey: "errors.session.expired",
          requestId: "req_abc123",
        })) as unknown as typeof fetch,
    });
    expect(result).toEqual({ status: "unauthenticated", requestId: "req_abc123" });
    // The backend copy key must not travel into anything the UI could render.
    expect(JSON.stringify(result)).not.toContain("errors.session.expired");
  });

  it("ignores an envelope that does not match the safe shape", async () => {
    const result = await fetchSession({
      fetchImpl: (async () =>
        jsonResponse(403, { code: "nope", detail: "internal stack trace" })) as unknown as typeof fetch,
    });
    expect(result).toEqual({ status: "forbidden", requestId: undefined });
    expect(JSON.stringify(result)).not.toContain("internal stack trace");
  });

  it("tolerates a missing error body", async () => {
    const result = await fetchSession({
      fetchImpl: (async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
    });
    expect(result.status).toBe("unauthenticated");
  });
});

describe("fetchSession — abort and timeout", () => {
  it("maps a caller abort to upstream_unavailable", async () => {
    const controller = new AbortController();
    const promise = fetchSession({
      signal: controller.signal,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })) as unknown as typeof fetch,
    });
    controller.abort();
    expect((await promise).status).toBe("upstream_unavailable");
  });

  it("aborts the request when the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const promise = fetchSession({
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

  it("does not abort a response that arrives before the timeout", async () => {
    vi.useFakeTimers();
    try {
      const promise = fetchSession({
        timeoutMs: 8_000,
        fetchImpl: (async () => jsonResponse(200, VALID_DTO)) as unknown as typeof fetch,
      });
      await vi.advanceTimersByTimeAsync(10);
      expect((await promise).status).toBe("authenticated");
    } finally {
      vi.useRealTimers();
    }
  });
});
