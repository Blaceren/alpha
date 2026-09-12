/**
 * The dual-cookie forwarding seam (H-7 cutover).
 *
 * WHY BOTH, NOT ONE. Academy and Backend are separate releases, and during the
 * window between their cutovers either version of the Backend may be the one
 * answering. An old Backend reads `trading_platform_session`; the new one reads
 * `__Host-trading_platform_session`. A forwarder that chooses ONE cookie can
 * satisfy only one of them, and an earlier version of this seam did exactly
 * that — which is what made the cutover order fragile enough to strand a
 * signed-in learner on the login page.
 *
 * So the rule is: send everything the browser has, each under its own name, and
 * let the Backend pick the one it understands. These cases exist to fail if the
 * implementation ever goes back to choosing.
 *
 * NO VALUE IS ASSERTED ON. The fixtures below are placeholders; what is under
 * test is which NAMES travel, and in what shape.
 */
import { describe, it, expect } from "vitest";
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  hasAnySessionCookie,
  sessionCookieHeader,
} from "@/lib/auth/constants";

/** A cookie jar, as `cookies()` and `request.cookies` both expose it. */
function jar(present: Record<string, string>) {
  return {
    get: (name: string) => (name in present ? { value: present[name]! } : undefined),
    has: (name: string) => name in present,
  };
}

const LEGACY = LEGACY_SESSION_COOKIE_NAME;
const NEW = SESSION_COOKIE_NAME;

describe("what the Academy forwards to the Backend", () => {
  it("legacy only → the legacy cookie, under its own name", () => {
    const header = sessionCookieHeader(jar({ [LEGACY]: "a" }).get);
    expect(header).toBe(`${LEGACY}=a`);
  });

  it("new only → the new cookie, under its own name", () => {
    const header = sessionCookieHeader(jar({ [NEW]: "b" }).get);
    expect(header).toBe(`${NEW}=b`);
  });

  it("both → BOTH, so either Backend version can serve the request", () => {
    const header = sessionCookieHeader(jar({ [LEGACY]: "a", [NEW]: "b" }).get);
    expect(header).not.toBeNull();
    // The assertion that matters: neither name may be dropped.
    expect(header).toContain(`${NEW}=b`);
    expect(header).toContain(`${LEGACY}=a`);
    expect(header!.split("; ")).toHaveLength(2);
  });

  it("neither → null, which every caller reads as no session", () => {
    expect(sessionCookieHeader(jar({}).get)).toBeNull();
  });

  it("forwards a shape both Backend readers can parse", () => {
    const header = sessionCookieHeader(jar({ [LEGACY]: "a", [NEW]: "b" }).get)!;
    /* An old Backend scans the Cookie header for its own name; the new one asks
       Next for a named cookie. Both need standard `name=value; name=value`. */
    for (const segment of header.split("; ")) {
      expect(segment).toMatch(/^[^=;]+=[^;]*$/);
    }
    const names = header.split("; ").map((s) => s.slice(0, s.indexOf("=")));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(LEGACY);
    expect(names).toContain(NEW);
  });

  it("never renames a value from one cookie onto the other", () => {
    /* Substring checks are useless here: the new name ENDS with the legacy name,
       so `__Host-trading_platform_session=` contains `trading_platform_session=`.
       The names have to be parsed. */
    const names = (header: string | null) =>
      (header ?? "").split("; ").filter(Boolean).map((s) => s.slice(0, s.indexOf("=")));

    expect(names(sessionCookieHeader(jar({ [LEGACY]: "legacy-value" }).get))).toEqual([LEGACY]);
    expect(names(sessionCookieHeader(jar({ [NEW]: "new-value" }).get))).toEqual([NEW]);
  });
});

describe("the middleware's routing hint", () => {
  it("counts either cookie as presence", () => {
    expect(hasAnySessionCookie(jar({ [LEGACY]: "a" }).has)).toBe(true);
    expect(hasAnySessionCookie(jar({ [NEW]: "b" }).has)).toBe(true);
    expect(hasAnySessionCookie(jar({ [LEGACY]: "a", [NEW]: "b" }).has)).toBe(true);
    expect(hasAnySessionCookie(jar({}).has)).toBe(false);
  });
});

describe("no forwarding seam chooses a single cookie", () => {
  it("every server read forwards the whole header", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const seams = [
      "src/server/auth/server-session.ts",
      "src/server/curriculum/server-read.ts",
      "src/server/curriculum/report-state-read.ts",
      "src/server/learner-ops/server-read.ts",
      "src/server/notifications/unread-presence.ts",
    ];
    for (const seam of seams) {
      const code = readFileSync(join(process.cwd(), seam), "utf8");
      /* CALLING it, not merely importing it. A mutation that replaced the call
         with a hand-rolled single-cookie read left the import in place and
         passed a `toContain` check — so the assertion is on the call shape. */
      expect(code, `${seam} must CALL the shared forwarder`).toMatch(
        /sessionCookieHeader\(\s*\(name\)\s*=>/,
      );
      // And must not read a named cookie directly to build the header itself.
      expect(code, `${seam} reads a cookie by name`).not.toMatch(
        /cookieStore\.get\(SESSION_COOKIE_NAME\)/,
      );
      // The shape that chose one cookie, and must not come back.
      expect(code, `${seam} still names a single cookie`).not.toMatch(
        /cookie:\s*`\$\{SESSION_COOKIE_NAME\}=/,
      );
      expect(code, `${seam} still picks one`).not.toContain("sessionCookieToForward");
    }
  });
});
