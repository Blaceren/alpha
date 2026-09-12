import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSession, login, logout, PROXY_BASE } from "@/lib/api/client";

function jsonResponse(body: unknown, init: { status?: number; requestId?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.requestId) headers.set("x-request-id", init.requestId);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("api client — fetchSession", () => {
  it("returns the parsed session on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ user: { id: 1, name: "A", role: "user" } }, { requestId: "req-1" }),
    ));
    const result = await fetchSession();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user?.name).toBe("A");
      expect(result.requestId).toBe("req-1");
    }
  });

  it("returns UNAUTHENTICATED on 401 (never fabricates a session)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "UNAUTHORIZED" }, { status: 401 })));
    const result = await fetchSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("UNAUTHENTICATED");
  });

  it("retries ONCE on a transient network failure, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(jsonResponse({ user: null }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("returns NETWORK_ERROR when both attempts fail", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("NETWORK_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns MALFORMED_RESPONSE on invalid JSON", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{not json", { status: 200, headers })));
    const result = await fetchSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("MALFORMED_RESPONSE");
  });

  it("returns MALFORMED_RESPONSE on a wrong content type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })));
    const result = await fetchSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("MALFORMED_RESPONSE");
  });
});

describe("api client — login", () => {
  it("targets the same-origin proxy login path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: { id: 1, name: "A", role: "user" } }));
    vi.stubGlobal("fetch", fetchMock);
    await login({ email: "a@b.co", password: "secret" });
    expect(fetchMock).toHaveBeenCalledWith(`${PROXY_BASE}/auth/login`, expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });

  it("maps 401 to INVALID_CREDENTIALS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "x" }, { status: 401 })));
    const result = await login({ email: "a@b.co", password: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("INVALID_CREDENTIALS");
  });

  it("maps 429 to RATE_LIMITED and does not retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await login({ email: "a@b.co", password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("RATE_LIMITED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 5xx to BACKEND_UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 502 })));
    const result = await login({ email: "a@b.co", password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("BACKEND_UNAVAILABLE");
  });

  it("does not retry login on a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await login({ email: "a@b.co", password: "x" });
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("api client — logout", () => {
  it("bootstraps CSRF then sends x-csrf-token on the logout POST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "tok-123" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await logout();
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${PROXY_BASE}/csrf`, expect.any(Object));
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = new Headers(secondInit.headers);
    expect(headers.get("x-csrf-token")).toBe("tok-123");
  });

  it("propagates a CSRF bootstrap failure without attempting logout", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await logout();
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
