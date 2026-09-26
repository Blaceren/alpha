import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LANDING_PATH,
  RETURN_PATH_KEY,
  consumeReturnPath,
  rememberReturnPath,
  safeReturnPath,
} from "./return-path";

describe("safeReturnPath — accepts", () => {
  it("keeps a plain same-origin path", () => {
    expect(safeReturnPath("/users")).toBe("/users");
    expect(safeReturnPath("/users/123")).toBe("/users/123");
    expect(safeReturnPath("/")).toBe("/");
  });

  it("keeps a query string and hash", () => {
    expect(safeReturnPath("/users?page=2")).toBe("/users?page=2");
    expect(safeReturnPath("/users#row-3")).toBe("/users#row-3");
  });

  it("trims surrounding whitespace", () => {
    expect(safeReturnPath("  /users  ")).toBe("/users");
  });
});

describe("safeReturnPath — rejects open redirects", () => {
  it("rejects absolute URLs to another origin", () => {
    for (const value of [
      "http://evil.test/",
      "https://evil.test/users",
      "//evil.test",
      "//evil.test/users",
      "///evil.test",
      "javascript:alert(1)",
      "data:text/html,<script>",
    ]) {
      expect(safeReturnPath(value), `accepted ${value}`).toBeNull();
    }
  });

  it("rejects the backslash protocol-relative form", () => {
    // Browsers normalize "/\" to "//", so this is an open redirect that looks
    // like a path.
    for (const value of ["/\\evil.test", "/\\\\evil.test", "/users\\..\\x"]) {
      expect(safeReturnPath(value), `accepted ${value}`).toBeNull();
    }
  });

  it("rejects a scheme smuggled into the first segment", () => {
    expect(safeReturnPath("/http://evil.test")).toBeNull();
    expect(safeReturnPath("/javascript:alert(1)")).toBeNull();
  });

  it("rejects relative paths that could resolve elsewhere", () => {
    for (const value of ["users", "evil.test", "../admin", "./x", ""]) {
      expect(safeReturnPath(value), `accepted ${value}`).toBeNull();
    }
  });

  it("rejects control characters, including CR/LF header injection", () => {
    expect(safeReturnPath("/users\r\nSet-Cookie: a=b")).toBeNull();
    expect(safeReturnPath("/users\nX")).toBeNull();
    expect(safeReturnPath("/users\u0000")).toBeNull();
    expect(safeReturnPath("/users\u007f")).toBeNull();
  });

  it("rejects an over-long value", () => {
    expect(safeReturnPath(`/${"a".repeat(600)}`)).toBeNull();
  });

  it("rejects non-strings", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(safeReturnPath(value), `accepted ${JSON.stringify(value)}`).toBeNull();
    }
  });
});

describe("safeReturnPath — redirect loop", () => {
  it("refuses to return to the login page", () => {
    // Returning to /login after a successful login is the loop this prevents.
    expect(safeReturnPath("/login")).toBeNull();
    expect(safeReturnPath("/login?reason=session_required")).toBeNull();
    expect(safeReturnPath("/login#x")).toBeNull();
  });

  it("still allows a path that merely starts with the same letters", () => {
    expect(safeReturnPath("/logins")).toBe("/logins");
    expect(safeReturnPath("/login-help")).toBe("/login-help");
  });
});

describe("sessionStorage round trip", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });

  it("remembers and returns a safe path exactly once", () => {
    rememberReturnPath("/users/42");
    expect(consumeReturnPath()).toBe("/users/42");
    // Consumed, so a later unrelated login cannot be hijacked by a stale entry.
    expect(consumeReturnPath()).toBe(DEFAULT_LANDING_PATH);
  });

  it("never stores an unsafe path", () => {
    rememberReturnPath("https://evil.test");
    expect(store.has(RETURN_PATH_KEY)).toBe(false);
    expect(consumeReturnPath()).toBe(DEFAULT_LANDING_PATH);
  });

  it("re-validates on read, so a poisoned entry is ignored", () => {
    // Storage is untrusted input even when we wrote it: another script on the
    // origin, or an older build, could have put anything there.
    store.set(RETURN_PATH_KEY, "//evil.test");
    expect(consumeReturnPath()).toBe(DEFAULT_LANDING_PATH);
  });

  it("defaults when nothing was remembered", () => {
    expect(consumeReturnPath()).toBe(DEFAULT_LANDING_PATH);
  });

  it("survives storage throwing", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => rememberReturnPath("/users")).not.toThrow();
    expect(consumeReturnPath()).toBe(DEFAULT_LANDING_PATH);
  });

  it("stores a path, never a token", () => {
    rememberReturnPath("/users");
    const stored = store.get(RETURN_PATH_KEY) ?? "";
    expect(stored).toBe("/users");
    expect(stored).not.toMatch(/session|token|csrf|password/i);
  });
});
