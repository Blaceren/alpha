/**
 * Boundary tests for the notifications proxy.
 *
 * The list operation was already bounded. This phase added two WRITE
 * operations, and a write path is where a proxy stops being merely wrong and
 * starts being dangerous — so these tests pin the properties that keep the two
 * new entries as narrow as the one they joined.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  proxyBackendJson,
  proxyMarkNotificationRead,
  proxyMarkAllNotificationsRead,
} from "@/server/proxy/notifications-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3100";

let fetchMock: ReturnType<typeof vi.fn>;
let saved: Record<string, string | undefined>;

function post(path = "http://academy.test/api/backend/notifications/n1/read"): Request {
  return new Request(path, { method: "POST" });
}

beforeEach(() => {
  saved = {
    ACADEMY_MODE: process.env.ACADEMY_MODE,
    BACKEND_ORIGIN: process.env.BACKEND_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();

  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetAcademyConfigCache();
  vi.unstubAllGlobals();
});

describe("notifications proxy — method pinning", () => {
  it("refuses a non-GET on the list operation", async () => {
    const response = await proxyBackendJson(post("http://academy.test/api/backend/notifications"));
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a non-POST on mark-read", async () => {
    const get = new Request("http://academy.test/api/backend/notifications/n1/read");
    const response = await proxyMarkNotificationRead(get, "n1");
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a non-POST on read-all", async () => {
    const get = new Request("http://academy.test/api/backend/notifications/read-all");
    const response = await proxyMarkAllNotificationsRead(get);
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("notifications proxy — the id is not a path", () => {
  /*
   * The id is the ONLY caller-controlled input in the whole file. If it can
   * carry a slash, a traversal or a scheme, the proxy stops being pinned to one
   * Backend resource. Each of these must be refused BEFORE any request is made.
   */
  const hostile = [
    "../../auth/me",
    "..%2f..%2fauth%2fme",
    "n1/../../admin",
    "n1?x=1",
    "n1#frag",
    "http://evil.example.com",
    "//evil.example.com",
    "n1 with space",
    "",
    "a".repeat(200),
  ];

  for (const id of hostile) {
    it(`refuses ${JSON.stringify(id)} without contacting the Backend`, async () => {
      const response = await proxyMarkNotificationRead(post(), id);
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("accepts a well-formed id and builds the pinned path", async () => {
    const response = await proxyMarkNotificationRead(post(), "n_123-abc.4");
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/notifications/n_123-abc.4/read`);
    expect(init.method).toBe("POST");
  });
});

describe("notifications proxy — constant paths", () => {
  it("read-all takes no caller input at all", async () => {
    const response = await proxyMarkAllNotificationsRead(post());
    expect(response.status).toBe(200);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${ORIGIN}/api/notifications/read-all`);
  });

  it("never forwards to any origin other than the configured Backend", async () => {
    await proxyMarkNotificationRead(post(), "n1");
    await proxyMarkAllNotificationsRead(post());
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0]).startsWith(`${ORIGIN}/`)).toBe(true);
    }
  });

  it("exposes no settings operation — /api/me/notification-settings stays unreachable", async () => {
    const proxy = await import("@/server/proxy/notifications-proxy");
    const exported = Object.keys(proxy).join(" ");
    expect(exported).not.toMatch(/settings/i);
  });
});

describe("notifications proxy — write headers", () => {
  it("forwards the CSRF token on a write", async () => {
    const request = new Request("http://academy.test/api/backend/notifications/n1/read", {
      method: "POST",
      headers: { "x-csrf-token": "token-value", cookie: "trading_platform_session=abc" },
    });
    await proxyMarkNotificationRead(request, "n1");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-csrf-token")).toBe("token-value");
    expect(headers.get("cookie")).toBe("trading_platform_session=abc");
  });

  it("does not forward an arbitrary caller header", async () => {
    const request = new Request("http://academy.test/api/backend/notifications/n1/read", {
      method: "POST",
      headers: { "x-forwarded-host": "evil.example.com", authorization: "Bearer nope" },
    });
    await proxyMarkNotificationRead(request, "n1");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });
});

describe("notifications proxy — configuration is fail-closed", () => {
  it("refuses to forward in fixture mode", async () => {
    process.env.ACADEMY_MODE = "fixture";
    resetAcademyConfigCache();
    const response = await proxyMarkAllNotificationsRead(post());
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
