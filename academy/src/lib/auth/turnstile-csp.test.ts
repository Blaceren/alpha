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

  /**
   * H-8 CHANGED THE ANSWER TO THIS, AND ONLY PART OF IT.
   *
   * This used to assert that no CSP existed at all, because the reasoning above
   * still held: Next needs a nonce or `unsafe-inline` for its own bootstrap, and
   * a policy that permits inline script is theatre. That reasoning is unchanged
   * and was re-derived independently — the served /login carries four inline
   * scripts, all of them `self.__next_f.push`, none with a nonce.
   *
   * What changed is that ONE directive needs none of that. `frame-ancestors`
   * governs who may frame us; it constrains no script, style, font or request,
   * so it cannot break Turnstile, Next or RSC. That subset now ships.
   *
   * So the assertion inverts rather than disappears: a CSP may exist, and it may
   * contain framing directives ONLY. The moment a script-src, style-src,
   * connect-src or frame-src appears, whoever added it owns the Turnstile
   * allowances above, and this fails until they are in the policy.
   */
  it("ships a framing-only CSP, and no directive that could block the widget", () => {
    const config = readFileSync(path.join(process.cwd(), "next.config.mjs"), "utf8");
    const policies = [...config.matchAll(/"Content-Security-Policy",\s*value:\s*"([^"]*)"/g)]
      .map((m) => m[1] ?? "");
    expect(policies.length, "H-8 ships exactly one policy").toBe(1);

    const policy = policies[0] ?? "";
    expect(policy).toContain("frame-ancestors");

    const fetchDirectives = ["script-src", "style-src", "connect-src", "frame-src", "img-src", "font-src", "default-src"];
    const present = fetchDirectives.filter((d) => policy.includes(d));
    if (present.length > 0) {
      // Someone took ownership of the real policy. These are the allowances the
      // widget needs, pinned next to the constants it actually uses.
      for (const [directive, origin] of Object.entries(TURNSTILE_CSP_REQUIREMENTS)) {
        expect(policy, `${directive} must allow ${origin}`).toContain(origin);
      }
      expect(policy, "a nonce or unsafe-inline decision is required before script-src ships")
        .toMatch(/nonce-|'strict-dynamic'/);
    }
  });

  it("permits framing of nobody, and says so twice for older browsers", () => {
    const config = readFileSync(path.join(process.cwd(), "next.config.mjs"), "utf8");
    expect(config).toContain("frame-ancestors 'none'");
    expect(config).toContain("X-Frame-Options");
  });
});
