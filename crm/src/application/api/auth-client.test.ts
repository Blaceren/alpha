import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRM_AUTH_CSRF_PATH,
  CRM_AUTH_LOGIN_PATH,
  CRM_AUTH_LOGOUT_PATH,
  CSRF_HEADER_NAME,
} from "@/data/contracts/api/auth";
import {
  csrfHeaders,
  ensureCsrfToken,
  login,
  logout,
  resetCsrfTokenForTests,
} from "./auth-client";

const TOKEN = "a".repeat(64);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetCsrfTokenForTests();
});

describe("login — request shape", () => {
  it("posts exactly email and password to the CRM origin", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true }));
    await login("Mentor@Example.com ", "secret123", { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    // Relative path: the browser never learns the backend origin.
    expect(url).toBe(CRM_AUTH_LOGIN_PATH);
    expect(url.startsWith("/")).toBe(true);
    expect(url).not.toContain("127.0.0.1");
    expect(url).not.toContain("http");

    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    // Exactly two keys travel — no role, no actor, no return path.
    expect(JSON.parse(init.body as string)).toEqual({
      email: "Mentor@Example.com",
      password: "secret123",
    });
  });

  it("never puts the password in the URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true }));
    await login("a@b.c", "supersecret", { fetchImpl });
    expect(fetchImpl.mock.calls[0]![0]).not.toContain("supersecret");
  });
});

describe("login — outcomes", () => {
  it("reports success on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true }));
    await expect(login("a@b.c", "secret123", { fetchImpl })).resolves.toEqual({
      status: "success",
    });
  });

  it.each([
    [400, "invalid_input"],
    [401, "invalid_credentials"],
    [403, "not_staff"],
    [429, "rate_limited"],
    [503, "upstream_unavailable"],
    [500, "server_error"],
  ] as const)("maps a %i body code through unchanged", async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code }, status));
    await expect(login("a@b.c", "secret123", { fetchImpl })).resolves.toEqual({
      status: "failed",
      code,
    });
  });

  it("carries a requestId when present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code: "not_staff", requestId: "r-1" }, 403));
    await expect(login("a@b.c", "secret123", { fetchImpl })).resolves.toEqual({
      status: "failed",
      code: "not_staff",
      requestId: "r-1",
    });
  });

  it("reports server_error — never a credential failure — for an unreadable body", async () => {
    // Telling an employee their password is wrong when the service is broken is
    // the specific misdiagnosis this guards against.
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(login("a@b.c", "secret123", { fetchImpl })).resolves.toEqual({
      status: "failed",
      code: "server_error",
    });
  });

  it("reports upstream_unavailable on a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(login("a@b.c", "secret123", { fetchImpl })).resolves.toEqual({
      status: "failed",
      code: "upstream_unavailable",
    });
  });

  it("reports upstream_unavailable on timeout", async () => {
    const fetchImpl = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_r, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;
    await expect(
      login("a@b.c", "secret123", { fetchImpl, timeoutMs: 10 }),
    ).resolves.toEqual({ status: "failed", code: "upstream_unavailable" });
  });

  it("rejects an unknown code rather than passing it through", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code: "teapot" }, 418));
    await expect(login("a@b.c", "secret123", { fetchImpl })).resolves.toEqual({
      status: "failed",
      code: "server_error",
    });
  });
});

describe("CSRF token", () => {
  it("fetches the token from the CRM origin and caches it in memory", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ csrfToken: TOKEN }));
    expect(await ensureCsrfToken({ fetchImpl })).toBe(TOKEN);
    // Second call is served from memory.
    expect(await ensureCsrfToken({ fetchImpl })).toBe(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(CRM_AUTH_CSRF_PATH);
  });

  it("builds the double-submit header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ csrfToken: TOKEN }));
    await expect(csrfHeaders({ fetchImpl })).resolves.toEqual({ [CSRF_HEADER_NAME]: TOKEN });
  });

  it("returns no header rather than a bogus one when the token cannot be fetched", async () => {
    // A missing header makes the backend reject the write, which is the correct
    // outcome. Inventing a value would turn a clear 403 into a confusing one.
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(csrfHeaders({ fetchImpl })).resolves.toEqual({});
  });

  it("rejects a malformed token payload", async () => {
    for (const body of [{}, { csrfToken: "" }, { csrfToken: "short" }, { token: TOKEN }]) {
      resetCsrfTokenForTests();
      const fetchImpl = vi.fn().mockResolvedValue(json(body));
      expect(await ensureCsrfToken({ fetchImpl }), JSON.stringify(body)).toBeNull();
    }
  });

  it("discards the cached token after a successful login", async () => {
    const csrfFetch = vi.fn().mockResolvedValue(json({ csrfToken: TOKEN }));
    await ensureCsrfToken({ fetchImpl: csrfFetch });

    await login("a@b.c", "secret123", { fetchImpl: vi.fn().mockResolvedValue(json({ ok: true })) });

    // A token minted for the previous session must not be reused for the new one.
    const second = vi.fn().mockResolvedValue(json({ csrfToken: "b".repeat(64) }));
    expect(await ensureCsrfToken({ fetchImpl: second })).toBe("b".repeat(64));
  });
});

describe("logout", () => {
  it("posts to the CRM origin with the CSRF header", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: TOKEN })) // csrfHeaders
      .mockResolvedValueOnce(json({ ok: true })); // logout

    await expect(logout({ fetchImpl })).resolves.toEqual({ status: "done" });

    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(CRM_AUTH_LOGOUT_PATH);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)[CSRF_HEADER_NAME]).toBe(TOKEN);
  });

  it("resolves done even when the request fails", async () => {
    // The CRM route clears cookies regardless, so the session is over locally.
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(logout({ fetchImpl })).resolves.toEqual({ status: "done" });
  });

  it("clears the cached token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: TOKEN }))
      .mockResolvedValueOnce(json({ ok: true }));
    await logout({ fetchImpl });

    const after = vi.fn().mockResolvedValue(json({ csrfToken: "c".repeat(64) }));
    expect(await ensureCsrfToken({ fetchImpl: after })).toBe("c".repeat(64));
  });
});

describe("storage discipline", () => {
  it("touches neither localStorage nor sessionStorage", async () => {
    const localSet = vi.fn();
    const sessionSet = vi.fn();
    vi.stubGlobal("localStorage", { setItem: localSet, getItem: () => null, removeItem: vi.fn() });
    vi.stubGlobal("sessionStorage", {
      setItem: sessionSet,
      getItem: () => null,
      removeItem: vi.fn(),
    });

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ csrfToken: TOKEN }))
      .mockResolvedValueOnce(json({ ok: true }));

    await login("a@b.c", "secret123", { fetchImpl });
    await ensureCsrfToken({ fetchImpl });
    await logout({ fetchImpl });

    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
