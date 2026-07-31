/**
 * AFD-3A2 — Content Security Policy and Turnstile.
 *
 * ## The finding: there is no CSP to add allowances to
 *
 * AFD-3A2 was asked to add the MINIMUM Cloudflare Turnstile allowances to the
 * Academy's CSP. Inspection found no CSP anywhere in the stack:
 *
 *   - the Academy emits no `Content-Security-Policy` header — `next.config.mjs`
 *     declares no `headers()`, no middleware sets one, and no route or layout
 *     emits a `<meta http-equiv>` policy;
 *   - the public ingress emits `X-Content-Type-Options`, `X-Frame-Options` and
 *     `Referrer-Policy`, and no CSP.
 *
 * The minimum required allowance is therefore ZERO: with no policy in force,
 * nothing about Turnstile is blocked. Authoring a first CSP for the whole
 * Academy is a much larger change than this phase owns — Next.js needs either a
 * per-request nonce or `unsafe-inline` for its bootstrap, and the phase forbids
 * broad `https:`, `unsafe-eval` and wildcard sources — so a hastily-added
 * policy would either break existing pages or be so wide as to be theatre.
 *
 * `X-Frame-Options: SAMEORIGIN` was checked specifically and does NOT affect the
 * widget: it governs whether OUR page may be framed by others, not what our page
 * may frame. Turnstile's iframe is a child of our document and is unaffected.
 *
 * ## What this suite does instead
 *
 * It pins the exact directives a future CSP owner must include, next to the
 * constants the widget actually uses, so the two can never drift. When the
 * Academy gains a CSP, these values go into it and this comment becomes the
 * rationale for why they are there.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  TURNSTILE_CSP_REQUIREMENTS,
  TURNSTILE_ORIGIN,
  TURNSTILE_SCRIPT_URL,
} from "@/lib/auth/turnstile";

describe("Turnstile CSP requirements", () => {
  it("names exactly three directives, each pinned to the official origin", () => {
    expect(TURNSTILE_CSP_REQUIREMENTS).toEqual({
      "script-src": "https://challenges.cloudflare.com",
      "frame-src": "https://challenges.cloudflare.com",
      "connect-src": "https://challenges.cloudflare.com",
    });
  });

  it("uses no wildcard, no scheme-only source and no unsafe directive", () => {
    for (const source of Object.values(TURNSTILE_CSP_REQUIREMENTS)) {
      expect(source).toBe(TURNSTILE_ORIGIN);
      expect(source).not.toContain("*");
      expect(source).not.toBe("https:");
      expect(source).not.toContain("unsafe-inline");
      expect(source).not.toContain("unsafe-eval");
      expect(source.startsWith("https://")).toBe(true);
    }
  });

  it("keeps the script URL inside the single allowed origin", () => {
    // If the script ever moved to another host, the pinned `script-src` above
    // would silently stop covering it. This assertion is that tripwire.
    expect(new URL(TURNSTILE_SCRIPT_URL).origin).toBe(TURNSTILE_ORIGIN);
  });

  it("adds no application-level CSP in this phase", () => {
    // The Academy is not the current CSP owner and this phase must not make it
    // one. If a `headers()` block or a policy string appears, this test fails
    // and whoever added it must apply the Turnstile directives above.
    //
    // Read as text rather than imported: importing the config would execute it,
    // and the point is to inspect what the file DECLARES.
    const config = readFileSync(path.join(process.cwd(), "next.config.mjs"), "utf8");
    expect(config).not.toContain("headers");
    expect(config).not.toContain("Content-Security-Policy");
  });
});
