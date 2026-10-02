/**
 * THE REGISTRATION CHECK — what the browser asks, and how it reads the answer.
 *
 * The request carries nothing: no body, no learner, no claim. The answer is two
 * facts from the Backend's own records, and each is read as a strict boolean —
 * a level is not completed because a payload contained the word "true".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPocketRegistration } from "@/lib/pocket-registration/referral-link-client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The CSRF bootstrap first, then the answer under test. */
function answer(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(json({ csrfToken: "t-1" })).mockResolvedValueOnce(json(body, status));
}

describe("checkPocketRegistration", () => {
  it("posts to the one same-origin path, with the CSRF token and no body", async () => {
    answer({ ok: true, status: "confirmed", message: "Регистрация подтверждена", levelCompleted: true });
    await checkPocketRegistration();
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/backend/exchange/registration/check");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers["x-csrf-token"]).toBe("t-1");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it("reads a confirmed registration that completed the level", async () => {
    answer({ ok: true, status: "confirmed", levelCompleted: true });
    expect(await checkPocketRegistration()).toMatchObject({ ok: true, confirmed: true, levelCompleted: true });
  });

  it("reads a confirmed registration on a learner who is not on the level yet", async () => {
    answer({ ok: true, status: "confirmed", levelCompleted: false });
    expect(await checkPocketRegistration()).toMatchObject({ ok: true, confirmed: true, levelCompleted: false });
  });

  it("reads «not registered yet» as a normal answer, not a failure", async () => {
    answer({ ok: false, status: "pending", message: "Регистрация ещё не подтверждена, попробуйте позже" });
    expect(await checkPocketRegistration()).toMatchObject({ ok: true, confirmed: false, levelCompleted: false });
  });

  it("an older Backend that does not report the level is read as «not completed»", async () => {
    answer({ ok: true, status: "confirmed" });
    expect(await checkPocketRegistration()).toMatchObject({ ok: true, confirmed: true, levelCompleted: false });
  });

  it("takes only strict booleans: a string is not a fact", async () => {
    answer({ ok: "true", status: "confirmed", levelCompleted: "true" });
    expect(await checkPocketRegistration()).toMatchObject({ ok: true, confirmed: false, levelCompleted: false });
  });

  it("refuses an answer it cannot read", async () => {
    for (const body of [{ status: "done" }, { ok: true }, "confirmed", null, []]) {
      answer(body);
      const result = await checkPocketRegistration();
      expect(result.ok, JSON.stringify(body)).toBe(false);
      if (!result.ok) expect(result.error.category).toBe("MALFORMED_RESPONSE");
    }
  });

  it("reports an expired session and an unreachable server as what they are", async () => {
    answer({ error: "unauthorized" }, 401);
    const expired = await checkPocketRegistration();
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.category).toBe("UNAUTHENTICATED");

    fetchMock.mockResolvedValueOnce(json({ csrfToken: "t-2" })).mockRejectedValueOnce(new TypeError("network"));
    const offline = await checkPocketRegistration();
    expect(offline.ok).toBe(false);
    if (!offline.ok) expect(offline.error.category).toBe("NETWORK_ERROR");
  });

  it("does not ask at all when the CSRF token cannot be had", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 500));
    const result = await checkPocketRegistration();
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
