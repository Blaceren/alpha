import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BACKEND_PATHS, callBackend } from "./backend-client";

/**
 * Repo convention for source-level guards: read relative to process.cwd().
 * `import.meta.url` is a virtual module URL under Vitest and does not resolve to
 * a real file, so readFileSync on it fails.
 */
const readSource = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

const SOURCE_PATH = "src/server/backend-client.ts";

const ENV = {
  CRM_MODE: "api",
  CRM_BACKEND_ORIGIN: "http://127.0.0.1:3210",
  NODE_ENV: "development",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("callBackend — path allowlist", () => {
  it("exposes exactly the four reviewed backend paths", () => {
    expect(BACKEND_PATHS).toEqual({
      login: "/api/auth/login",
      logout: "/api/auth/logout",
      csrf: "/api/csrf",
      session: "/api/crm/v1/session",
    });
  });

  it("builds the URL from the validated origin plus an allowlisted path only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await callBackend({ path: BACKEND_PATHS.login, method: "POST", json: {}, fetchImpl, env: ENV });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://127.0.0.1:3210/api/auth/login");
  });

  it("contains no wildcard or interpolated path segment in the allowlist", () => {
    // The open-proxy guard, asserted structurally rather than by intent.
    for (const path of Object.values(BACKEND_PATHS)) {
      expect(path).toMatch(/^\/api\/[a-z0-9/-]+$/);
      expect(path).not.toContain("*");
      expect(path).not.toContain(":");
      expect(path).not.toContain("${");
      expect(path).not.toContain("..");
    }
  });

  it("cannot be pointed at another host by the caller", () => {
    // The type system is the enforcement, so this is a source-level assertion:
    // there is no `origin`, `host`, `url` or `baseUrl` field on the input.
    const source = readSource(SOURCE_PATH);
    const inputBlock = source.slice(
      source.indexOf("export interface BackendCallInput"),
      source.indexOf("export async function callBackend"),
    );
    for (const field of ["origin", "host", "baseUrl", "url"] as const) {
      expect(inputBlock, `BackendCallInput exposes a caller-steerable "${field}"`).not.toMatch(
        new RegExp(`^\\s*${field}[?]?:`, "m"),
      );
    }
  });
});

describe("callBackend — configuration", () => {
  it("reports misconfigured when CRM_BACKEND_ORIGIN is absent", async () => {
    const fetchImpl = vi.fn();
    const result = await callBackend({
      path: BACKEND_PATHS.csrf,
      method: "GET",
      fetchImpl,
      env: { CRM_MODE: "api" },
    });
    expect(result).toEqual({ status: "misconfigured" });
    // Fails before any network call — a bad origin must never be attempted.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an origin with credentials, a path, a query or a hash", async () => {
    for (const origin of [
      "http://user:pass@127.0.0.1:3210",
      "http://127.0.0.1:3210/api",
      "http://127.0.0.1:3210?a=1",
      "http://127.0.0.1:3210#x",
      "ftp://127.0.0.1:3210",
      "//127.0.0.1:3210",
    ]) {
      const fetchImpl = vi.fn();
      const result = await callBackend({
        path: BACKEND_PATHS.csrf,
        method: "GET",
        fetchImpl,
        env: { CRM_MODE: "api", CRM_BACKEND_ORIGIN: origin },
      });
      expect(result, `accepted origin ${origin}`).toEqual({ status: "misconfigured" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});

describe("callBackend — request shape", () => {
  it("forwards the cookie header and CSRF header when given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await callBackend({
      path: BACKEND_PATHS.logout,
      method: "POST",
      json: {},
      cookie: "trading_platform_session=abc",
      csrfToken: "tok",
      fetchImpl,
      env: ENV,
    });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toBe("trading_platform_session=abc");
    expect(headers["x-csrf-token"]).toBe("tok");
  });

  it("omits cookie and CSRF headers when absent, rather than sending empty ones", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await callBackend({
      path: BACKEND_PATHS.csrf,
      method: "GET",
      cookie: null,
      csrfToken: null,
      fetchImpl,
      env: ENV,
    });
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Cookie");
    expect(headers).not.toHaveProperty("x-csrf-token");
  });

  it("never follows a redirect", async () => {
    // An auth endpoint that 302s somewhere is not something to chase: following
    // it could replay credentials to an unreviewed destination.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await callBackend({ path: BACKEND_PATHS.login, method: "POST", json: {}, fetchImpl, env: ENV });
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).redirect).toBe("manual");
  });

  it("never caches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await callBackend({ path: BACKEND_PATHS.csrf, method: "GET", fetchImpl, env: ENV });
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).cache).toBe("no-store");
  });
});

describe("callBackend — result normalization", () => {
  it("returns the status, parsed body and bridged cookies", async () => {
    const response = jsonResponse({ user: { id: 1 } });
    response.headers.append(
      "set-cookie",
      "trading_platform_session=v; Path=/; HttpOnly; SameSite=lax",
    );
    const result = await callBackend({
      path: BACKEND_PATHS.login,
      method: "POST",
      json: {},
      fetchImpl: vi.fn().mockResolvedValue(response),
      env: ENV,
    });

    expect(result.status).toBe("responded");
    if (result.status !== "responded") return;
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ user: { id: 1 } });
    expect(result.cookies).toHaveLength(1);
  });

  it("preserves a non-2xx status instead of collapsing it", async () => {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      const result = await callBackend({
        path: BACKEND_PATHS.login,
        method: "POST",
        json: {},
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ error: "X" }, { status })),
        env: ENV,
      });
      expect(result.status).toBe("responded");
      if (result.status === "responded") expect(result.httpStatus).toBe(status);
    }
  });

  it("tolerates a non-JSON body without throwing", async () => {
    const result = await callBackend({
      path: BACKEND_PATHS.csrf,
      method: "GET",
      fetchImpl: vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })),
      env: ENV,
    });
    expect(result).toMatchObject({ status: "responded", httpStatus: 502, body: null });
  });

  it("reports unreachable for a network failure, with no detail", async () => {
    const result = await callBackend({
      path: BACKEND_PATHS.csrf,
      method: "GET",
      fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:3210")),
      env: ENV,
    });
    // The origin is server-only; an error string carrying it must not escape.
    expect(result).toEqual({ status: "unreachable" });
    expect(JSON.stringify(result)).not.toContain("3210");
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
  });

  it("reports unreachable on timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;

    const result = await callBackend({
      path: BACKEND_PATHS.csrf,
      method: "GET",
      timeoutMs: 10,
      fetchImpl,
      env: ENV,
    });
    expect(result).toEqual({ status: "unreachable" });
  });
});

describe("callBackend — logging discipline", () => {
  it("logs nothing at all", async () => {
    // A login body contains a password and the cookie header contains a session.
    // The only safe amount of logging in this module is none.
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    try {
      await callBackend({
        path: BACKEND_PATHS.login,
        method: "POST",
        json: { email: "a@b.c", password: "supersecret" },
        cookie: "trading_platform_session=abc",
        csrfToken: "tok",
        fetchImpl: vi.fn().mockRejectedValue(new Error("boom")),
        env: ENV,
      });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("contains no console call in source", () => {
    const source = readSource(SOURCE_PATH);
    expect(source).not.toMatch(/console\./);
  });
});
