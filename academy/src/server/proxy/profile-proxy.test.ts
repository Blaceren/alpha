/**
 * Boundary tests for the profile write proxy.
 *
 * There is one thing here that a reviewer should be able to check in ten
 * seconds and that these tests make impossible to lose: the Backend's
 * `PATCH /api/me` also accepts `email`, and an email in that payload starts a
 * pending-email change with its own verification flow. This route must be able
 * to carry a name and nothing else — not by filtering, which can be got wrong,
 * but by constructing the outgoing body itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { proxyUpdateProfileName } from "@/server/proxy/profile-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3100";
const URL_ = "http://academy.test/api/backend/profile/name";

let fetchMock: ReturnType<typeof vi.fn>;
let saved: Record<string, string | undefined>;

function patch(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  saved = {
    ACADEMY_MODE: process.env.ACADEMY_MODE,
    BACKEND_ORIGIN: process.env.BACKEND_ORIGIN,
  };
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();

  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ user: { id: 1, name: "Новое Имя" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetAcademyConfigCache();
});

describe("profile proxy — the boundary", () => {
  it("forwards exactly one field, to one constant Backend path, with one method", async () => {
    await proxyUpdateProfileName(patch({ name: "Новое Имя" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/api/me`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Новое Имя" });
  });

  it("cannot carry an email change, however it is sent", async () => {
    await proxyUpdateProfileName(
      patch({ name: "Новое Имя", email: "someone@example.com" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ name: "Новое Имя" });
    expect(Object.keys(body)).toEqual(["name"]);
    expect(fetchMock.mock.calls[0]![1].body).not.toContain("example.com");
  });

  it("trims before it validates, exactly as the Backend schema does", async () => {
    await proxyUpdateProfileName(patch({ name: "  Имя  " }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ name: "Имя" });
  });

  it("refuses a name outside the Backend's own bounds without calling it", async () => {
    for (const name of ["", " ", "Я", "и".repeat(51)]) {
      fetchMock.mockClear();
      const response = await proxyUpdateProfileName(patch({ name }));
      expect(response.status, name).toBe(400);
      expect(fetchMock, name).not.toHaveBeenCalled();
    }
  });

  it("refuses a body that is not a name at all", async () => {
    for (const body of ["not json", { name: 42 }, { other: "x" }, []]) {
      fetchMock.mockClear();
      expect((await proxyUpdateProfileName(patch(body))).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("is pinned to PATCH", async () => {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const request = new Request(URL_, {
        method,
        ...(method === "GET" || method === "DELETE"
          ? {}
          : { body: JSON.stringify({ name: "Имя" }) }),
      });
      expect((await proxyUpdateProfileName(request)).status).toBe(405);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the CSRF token and the session, and nothing else the caller invented", async () => {
    await proxyUpdateProfileName(
      patch({ name: "Новое Имя" }, {
        cookie: "session=abc",
        "x-csrf-token": "tok",
        "x-forwarded-for": "1.2.3.4",
        authorization: "Bearer nope",
      }),
    );
    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("cookie")).toBe("session=abc");
    expect(headers.get("x-csrf-token")).toBe("tok");
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("turns an unreachable Backend into a bounded error, never a stack trace", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const response = await proxyUpdateProfileName(patch({ name: "Новое Имя" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      category: "BACKEND_UNAVAILABLE",
      messageKey: expect.any(String),
    });
  });
});
