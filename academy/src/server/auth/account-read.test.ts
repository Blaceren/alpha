import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = { mode: "api" as "api" | "fixture", backendOrigin: "http://backend.invalid" as string | null, requestTimeoutMs: 1000, turnstileSiteKey: null };
const cookieJar = new Map<string, string>();

vi.mock("@/config/academy-config", () => ({ getAcademyConfig: () => config }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));

import { readAccountCapabilities, readServerAccount } from "./account-read";
import { NO_ACCOUNT_CAPABILITIES } from "@/lib/account/account-types";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

/**
 * ACCOUNT RECOVERY — the server's two reads fail CLOSED. A «Забыли пароль?»
 * that appears because a read failed open would promise a message nobody sends.
 */

const ABLE = { passwordRecovery: true, emailVerification: true, emailChange: true };
const fetchMock = vi.fn();

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  config.mode = "api";
  config.backendOrigin = "http://backend.invalid";
  cookieJar.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("what the deployment can do", () => {
  it("is the Backend's answer, read anonymously", async () => {
    fetchMock.mockResolvedValue(respond(200, { capabilities: ABLE }));
    expect(await readAccountCapabilities()).toEqual(ABLE);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://backend.invalid/api/auth/capabilities");
    expect(JSON.stringify(init.headers)).not.toContain("cookie");
    expect(init.cache).toBe("no-store");
  });

  it("is nothing when the answer cannot be trusted", async () => {
    const untrusted = [
      () => respond(503, { capabilities: ABLE }),
      () => respond(200, { capabilities: { passwordRecovery: "yes" } }),
      () => respond(200, {}),
      () => new Response("not json", { status: 200 }),
      () => { throw new TypeError("network"); },
    ];
    for (const answer of untrusted) {
      fetchMock.mockImplementationOnce(async () => answer());
      expect(await readAccountCapabilities()).toEqual(NO_ACCOUNT_CAPABILITIES);
    }
  });

  it("is nothing, without a request, when the Academy has no Backend", async () => {
    config.mode = "fixture";
    config.backendOrigin = null;
    expect(await readAccountCapabilities()).toEqual(NO_ACCOUNT_CAPABILITIES);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the learner's own address", () => {
  const VIEW = { account: { email: "maria@example.invalid", emailVerified: true, pendingEmail: null }, capabilities: ABLE };

  it("is not asked for without a session", async () => {
    expect(await readServerAccount()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is read with the session cookie and nothing else of the browser's", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "session-value");
    cookieJar.set("unrelated", "x");
    fetchMock.mockResolvedValue(respond(200, VIEW));
    expect(await readServerAccount()).toEqual(VIEW);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://backend.invalid/api/me/account");
    expect(init.headers.cookie).toContain("session-value");
    expect(init.headers.cookie).not.toContain("unrelated");
  });

  it("is null when the read fails or the shape is wrong", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "session-value");
    fetchMock.mockResolvedValueOnce(respond(401, { error: "UNAUTHORIZED" }));
    expect(await readServerAccount()).toBeNull();
    fetchMock.mockResolvedValueOnce(respond(200, { account: { email: "" }, capabilities: ABLE }));
    expect(await readServerAccount()).toBeNull();
  });
});
