import { describe, expect, it } from "vitest";
import {
  BRIDGED_COOKIE_NAMES,
  CSRF_COOKIE_NAME,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  bridgeSetCookies,
  clearedCookie,
  parseBridgedSetCookie,
} from "./set-cookie-bridge";

const DEV = { NODE_ENV: "development" };
const PROD = { NODE_ENV: "production" };

/**
 * The real shape the backend sends on login since H-7: an opaque token under the
 * `__Host-` name, always Secure, SameSite=Strict (backend `src/lib/session.ts`).
 */
const REAL_SESSION_SET_COOKIE =
  `${SESSION_COOKIE_NAME}=0123456789abcdef0123456789abcdef0123456789abcdef; Path=/; ` +
  "Expires=Sun, 02 Aug 2026 10:01:58 GMT; Max-Age=604800; Secure; HttpOnly; SameSite=strict";

/** What the same login response also sends: the pre-H-7 name, expired. */
const REAL_LEGACY_CLEAR_SET_COOKIE =
  `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax`;

const REAL_CSRF_SET_COOKIE =
  "trading_platform_csrf=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef; " +
  "Path=/; SameSite=lax";

describe("parseBridgedSetCookie", () => {
  it("parses the real backend session cookie without corrupting expiry", () => {
    const cookie = parseBridgedSetCookie(REAL_SESSION_SET_COOKIE, DEV);
    expect(cookie).not.toBeNull();
    expect(cookie!.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie!.value).toBe("0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("strict");
    expect(cookie!.maxAge).toBe(604800);
    // The Expires attribute contains a comma — the exact thing naive splitting
    // corrupts. It must survive as a real Date.
    expect(cookie!.expires?.toISOString()).toBe("2026-08-02T10:01:58.000Z");
  });

  it("keeps the CSRF cookie script-readable", () => {
    // Double-submit requires the client to read it. Forcing HttpOnly here would
    // silently break every write.
    const cookie = parseBridgedSetCookie(REAL_CSRF_SET_COOKIE, DEV);
    expect(cookie!.name).toBe(CSRF_COOKIE_NAME);
    expect(cookie!.httpOnly).toBe(false);
  });

  it("preserves a session value containing '=' padding", () => {
    const cookie = parseBridgedSetCookie(
      `${SESSION_COOKIE_NAME}=a=b==; Path=/; HttpOnly; SameSite=lax`,
      DEV,
    );
    expect(cookie!.value).toBe("a=b==");
  });

  it("always drops a Domain attribute", () => {
    for (const domain of ["Domain=backend.internal", "Domain=.example.com", "Domain=evil.test"]) {
      const cookie = parseBridgedSetCookie(
        `${SESSION_COOKIE_NAME}=v; Path=/; ${domain}; HttpOnly; SameSite=lax`,
        DEV,
      );
      expect(cookie).not.toBeNull();
      // The descriptor has no domain field at all, so nothing can forward one.
      expect(Object.keys(cookie!)).not.toContain("domain");
      expect(JSON.stringify(cookie)).not.toContain("example.com");
      expect(JSON.stringify(cookie)).not.toContain("evil.test");
    }
  });

  it("normalizes Path to / regardless of what the backend sent", () => {
    const cookie = parseBridgedSetCookie(
      `${SESSION_COOKIE_NAME}=v; Path=/api/auth; HttpOnly; SameSite=lax`,
      DEV,
    );
    expect(cookie!.path).toBe("/");
  });

  it("recomputes Secure from CRM env for ordinary cookies instead of copying the backend flag", () => {
    // Backend sent no Secure (loopback http), but the CRM is production https.
    const promoted = parseBridgedSetCookie(REAL_CSRF_SET_COOKIE, PROD);
    expect(promoted!.secure).toBe(true);

    // Backend sent Secure, but this CRM is local http — do not claim Secure.
    const demoted = parseBridgedSetCookie(
      "trading_platform_csrf=v; Path=/; Secure; SameSite=lax",
      DEV,
    );
    expect(demoted!.secure).toBe(false);
  });

  it("always marks the __Host- session Secure, because a browser drops it otherwise", () => {
    expect(parseBridgedSetCookie(REAL_SESSION_SET_COOKIE, PROD)!.secure).toBe(true);
    expect(parseBridgedSetCookie(REAL_SESSION_SET_COOKIE, DEV)!.secure).toBe(true);
    expect(
      parseBridgedSetCookie(`${SESSION_COOKIE_NAME}=v; Path=/; HttpOnly`, DEV)!.secure,
    ).toBe(true);
  });

  it("rejects any cookie not on the allowlist", () => {
    for (const raw of [
      "session=v; Path=/",
      "trading_platform_sessionx=v; Path=/",
      "xtrading_platform_session=v; Path=/",
      "__Host-trading_platform_sessionx=v; Path=/",
      "analytics_id=v; Path=/",
      "__Host-evil=v; Path=/",
    ]) {
      expect(parseBridgedSetCookie(raw, DEV), `accepted ${raw}`).toBeNull();
    }
  });

  it("never bridges a live session under the pre-H-7 name", () => {
    // The backend no longer accepts it; delivering one would recreate the exact
    // failure this module was changed to fix.
    expect(
      parseBridgedSetCookie(`${LEGACY_SESSION_COOKIE_NAME}=v; Path=/; HttpOnly; SameSite=lax`, DEV),
    ).toBeNull();
  });

  it("bridges the pre-H-7 name as a deletion, so old browsers are cleaned up", () => {
    const cookie = parseBridgedSetCookie(REAL_LEGACY_CLEAR_SET_COOKIE, PROD);
    expect(cookie).not.toBeNull();
    expect(cookie!.name).toBe(LEGACY_SESSION_COOKIE_NAME);
    expect(cookie!.value).toBe("");
    expect(cookie!.maxAge).toBe(0);
    expect(cookie!.httpOnly).toBe(true);
  });

  it("rejects malformed input rather than guessing", () => {
    for (const raw of ["", "   ", "novalue", "=leadingequals", ";;;"]) {
      expect(parseBridgedSetCookie(raw, DEV), `accepted ${JSON.stringify(raw)}`).toBeNull();
    }
  });

  it("accepts an empty value, because that is how logout clears", () => {
    const cookie = parseBridgedSetCookie(
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=strict`,
      DEV,
    );
    expect(cookie).not.toBeNull();
    expect(cookie!.value).toBe("");
    expect(cookie!.maxAge).toBe(0);
  });

  it("ignores a malformed Max-Age rather than turning it into a deletion", () => {
    // Number("") is 0, which would silently expire the cookie immediately.
    const cookie = parseBridgedSetCookie(
      `${SESSION_COOKIE_NAME}=v; Path=/; Max-Age=; HttpOnly`,
      DEV,
    );
    expect(cookie!.maxAge).toBeUndefined();

    const nonNumeric = parseBridgedSetCookie(
      `${SESSION_COOKIE_NAME}=v; Path=/; Max-Age=soon; HttpOnly`,
      DEV,
    );
    expect(nonNumeric!.maxAge).toBeUndefined();
  });

  it("ignores an unparseable Expires", () => {
    const cookie = parseBridgedSetCookie(
      `${SESSION_COOKIE_NAME}=v; Path=/; Expires=not-a-date; HttpOnly`,
      DEV,
    );
    expect(cookie!.expires).toBeUndefined();
  });

  it("defaults an absent or unknown SameSite to lax, never none", () => {
    expect(parseBridgedSetCookie(`${SESSION_COOKIE_NAME}=v; Path=/`, DEV)!.sameSite).toBe("lax");
    expect(
      parseBridgedSetCookie(`${SESSION_COOKIE_NAME}=v; SameSite=weird`, DEV)!.sameSite,
    ).toBe("lax");
    expect(
      parseBridgedSetCookie(`${SESSION_COOKIE_NAME}=v; SameSite=Strict`, DEV)!.sameSite,
    ).toBe("strict");
  });

  it("is case-insensitive about attribute names", () => {
    const cookie = parseBridgedSetCookie(
      `${SESSION_COOKIE_NAME}=v; path=/; httponly; samesite=STRICT; max-age=60`,
      DEV,
    );
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("strict");
    expect(cookie!.maxAge).toBe(60);
  });
});

describe("bridgeSetCookies", () => {
  it("bridges MULTIPLE Set-Cookie headers independently", () => {
    // The case that breaks naive implementations: headers.get() joins these with
    // ", " and the Expires date already contains a comma.
    const headers = new Headers();
    headers.append("set-cookie", REAL_SESSION_SET_COOKIE);
    headers.append("set-cookie", REAL_CSRF_SET_COOKIE);

    const bridged = bridgeSetCookies(headers, DEV);
    expect(bridged).toHaveLength(2);
    expect(bridged.map((c) => c.name)).toEqual([SESSION_COOKIE_NAME, CSRF_COOKIE_NAME]);
    expect(bridged[0]!.expires?.toISOString()).toBe("2026-08-02T10:01:58.000Z");
    expect(bridged[0]!.httpOnly).toBe(true);
    expect(bridged[1]!.httpOnly).toBe(false);
  });

  it("bridges the real H-7 login response: the session, plus the legacy deletion", () => {
    const headers = new Headers();
    headers.append("set-cookie", REAL_SESSION_SET_COOKIE);
    headers.append("set-cookie", REAL_LEGACY_CLEAR_SET_COOKIE);

    const bridged = bridgeSetCookies(headers, PROD);
    expect(bridged.map((c) => c.name)).toEqual([SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]);
    expect(bridged[0]!.value).not.toBe("");
    expect(bridged[0]!.secure).toBe(true);
    expect(bridged[1]!.value).toBe("");
    expect(bridged[1]!.maxAge).toBe(0);
  });

  it("drops non-allowlisted cookies while keeping allowlisted ones", () => {
    const headers = new Headers();
    headers.append("set-cookie", "tracking=1; Path=/");
    headers.append("set-cookie", REAL_SESSION_SET_COOKIE);
    headers.append("set-cookie", "other=2; Path=/; Domain=.evil.test");

    const bridged = bridgeSetCookies(headers, DEV);
    expect(bridged.map((c) => c.name)).toEqual([SESSION_COOKIE_NAME]);
  });

  it("preserves order so a clear-then-set sequence ends set", () => {
    const headers = new Headers();
    headers.append("set-cookie", `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly`);
    headers.append("set-cookie", REAL_SESSION_SET_COOKIE);

    const bridged = bridgeSetCookies(headers, DEV);
    expect(bridged).toHaveLength(2);
    expect(bridged[0]!.value).toBe("");
    expect(bridged[1]!.value).not.toBe("");
  });

  it("returns an empty list when the response set no cookies", () => {
    expect(bridgeSetCookies(new Headers(), DEV)).toEqual([]);
  });

  it("falls back to a single get() for a Headers without getSetCookie", () => {
    const fake = {
      get: (name: string) => (name === "set-cookie" ? REAL_SESSION_SET_COOKIE : null),
    } as unknown as Headers;
    const bridged = bridgeSetCookies(fake, DEV);
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe(SESSION_COOKIE_NAME);
  });
});

describe("clearedCookie", () => {
  it("clears the __Host- session cookie with the flags it was set with", () => {
    // A deletion of a __Host- cookie that is not Secure, or not Path=/, is
    // refused by the browser and the live session cookie survives.
    for (const env of [DEV, PROD]) {
      const cleared = clearedCookie(SESSION_COOKIE_NAME, env);
      expect(cleared.value).toBe("");
      expect(cleared.maxAge).toBe(0);
      expect(cleared.path).toBe("/");
      expect(cleared.httpOnly).toBe(true);
      expect(cleared.sameSite).toBe("strict");
      expect(cleared.secure).toBe(true);
    }
  });

  it("clears the pre-H-7 session name as HttpOnly", () => {
    const cleared = clearedCookie(LEGACY_SESSION_COOKIE_NAME, PROD);
    expect(cleared.value).toBe("");
    expect(cleared.maxAge).toBe(0);
    expect(cleared.httpOnly).toBe(true);
    expect(cleared.secure).toBe(true);
  });

  it("clears the CSRF cookie without HttpOnly, matching how it was set", () => {
    expect(clearedCookie(CSRF_COOKIE_NAME, DEV).httpOnly).toBe(false);
  });

  it("applies the CRM Secure rule to ordinary cookies", () => {
    expect(clearedCookie(CSRF_COOKIE_NAME, PROD).secure).toBe(true);
    expect(clearedCookie(CSRF_COOKIE_NAME, DEV).secure).toBe(false);
  });
});

describe("allowlist shape", () => {
  it("bridges exactly the reviewed cookies", () => {
    expect([...BRIDGED_COOKIE_NAMES]).toEqual([
      "__Host-trading_platform_session",
      "trading_platform_session",
      "trading_platform_csrf",
    ]);
  });

  it("names the session exactly as the backend does", () => {
    // Backend src/lib/session.ts: SESSION_COOKIE_NAME. A mismatch here is what
    // made every CRM staff login end in 502 after H-7.
    expect(SESSION_COOKIE_NAME).toBe("__Host-trading_platform_session");
  });
});
