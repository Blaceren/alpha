import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { changeProfilePassword, saveProfileName } from "@/lib/profile/profile-client";

/**
 * THE TWO REQUESTS THIS SURFACE MAKES, AND EXACTLY WHAT IS IN THEM.
 *
 * Both were caught by mutation rather than by design: a battery that added
 * `email` to the name request and `confirmPassword` to the password request
 * left every other test green. The name proxy rebuilds its body server-side, so
 * the product was never reachable that way — but nothing here would have said
 * so, and the second body is forwarded rather than rebuilt.
 *
 * The client-only confirmation exists to catch a typo before the network. It is
 * validated in the form and never placed in a payload.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const csrfOk = () =>
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ csrfToken: "t" }),
    headers: new Headers(),
  });

const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call]![1].body as string);

describe("saveProfileName", () => {
  it("sends the name and nothing that could start an email change", async () => {
    csrfOk();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => ({ user: { name: "Мария" } }),
    });

    await saveProfileName("Мария");

    expect(Object.keys(bodyOf(1))).toEqual(["name"]);
    for (const forbidden of ["email", "pendingEmail", "password"]) {
      expect(bodyOf(1), forbidden).not.toHaveProperty(forbidden);
    }
  });
});

describe("changeProfilePassword", () => {
  it("sends exactly the two fields the Backend schema names", async () => {
    csrfOk();
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers(), json: async () => ({}) });

    await changeProfilePassword("old-one", "new-one");

    expect(Object.keys(bodyOf(1)).sort()).toEqual(["currentPassword", "newPassword"]);
    /* The confirmation is a client-only guard against a typo. Sending it would
       put a third copy of the new password on the wire for a field the server
       does not read. */
    expect(bodyOf(1)).not.toHaveProperty("confirmPassword");
    expect(bodyOf(1)).not.toHaveProperty("confirmationPassword");
  });

  it("separates a wrong current password from an outage", async () => {
    csrfOk();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers(),
      json: async () => ({ error: "INVALID_CURRENT_PASSWORD" }),
    });
    expect(await changeProfilePassword("wrong", "abcdef")).toEqual({ ok: false, wrongCurrent: true });

    csrfOk();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      headers: new Headers(),
      json: async () => ({ error: "BACKEND_UNAVAILABLE" }),
    });
    const outage = await changeProfilePassword("old-one", "abcdef");
    expect(outage.ok).toBe(false);
    expect(outage.ok === false && outage.wrongCurrent).toBe(false);
  });

  it("never puts a password in the value it returns", async () => {
    csrfOk();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers(),
      json: async () => ({ error: "INVALID_CURRENT_PASSWORD" }),
    });
    const result = await changeProfilePassword("secret-current", "secret-new");
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("secret-current");
    expect(serialised).not.toContain("secret-new");
  });
});
