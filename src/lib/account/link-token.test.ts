import { afterEach, describe, expect, it } from "vitest";
import { parseLinkToken, takeLinkToken } from "./link-token";

const RESET = "A".repeat(43);
const VERIFY = "3f2b1c9e-8a4d-4f6b-9c1e-2d7a5b6c8e90";

describe("the token in a link's fragment", () => {
  it("is read from #token=…, whichever kind of token it is", () => {
    expect(parseLinkToken(`#token=${RESET}`)).toBe(RESET);
    expect(parseLinkToken(`token=${VERIFY}`)).toBe(VERIFY);
    expect(parseLinkToken(`#x=1&token=${RESET}`)).toBe(RESET);
  });

  it("is refused by shape, and absent is not an error", () => {
    for (const hash of ["", "#", "#token=", "#token=short", `#token=${"a".repeat(200)}`, "#token=has space here ok", "#token=%E0%A4%A", "#other=1"]) {
      expect(parseLinkToken(hash), hash).toBeNull();
    }
  });

  describe("in the browser", () => {
    afterEach(() => window.history.replaceState(null, "", "/"));

    it("leaves the address bar once it has been read", () => {
      window.history.replaceState(null, "", `/reset-password?x=1#token=${RESET}`);
      expect(takeLinkToken()).toBe(RESET);
      // Not in the URL any more: not in history, not in a copied link.
      expect(window.location.hash).toBe("");
      expect(window.location.pathname + window.location.search).toBe("/reset-password?x=1");
      expect(takeLinkToken()).toBeNull();
    });

    it("clears a fragment it could not read, too", () => {
      window.history.replaceState(null, "", "/verify-email#token=nope");
      expect(takeLinkToken()).toBeNull();
      expect(window.location.hash).toBe("");
    });
  });
});
