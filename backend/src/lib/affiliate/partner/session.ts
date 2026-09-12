/**
 * AFFILIATE-PLATFORM-V1 §17 — the partner session token and its cookie.
 *
 * A SEPARATE NAMESPACE, A SEPARATE SECRET, A SEPARATE SHAPE. The learner/staff
 * session is `trading_platform_session`, signed with SESSION_SECRET, and its
 * payload is `<userId>.<role>.<expiresAt>`. If a partner token were signed with
 * the same key, a partner token and a learner token would be mutually
 * forgeable — the payloads are both dotted decimal fields, so a partner token
 * for principal 7 is byte-identical to a plausible learner token for user 7.
 * That is not a hypothetical: it is what "reuse the session secret" means.
 *
 * So this token is domain-separated three ways:
 *   * its own secret (PARTNER_SESSION_SECRET, refused if it equals any other),
 *   * a literal version-and-audience prefix inside the SIGNED payload,
 *   * its own cookie name under the `__Host-` prefix.
 *
 * `__Host-` IS NOT DECORATION. A browser stores a cookie under that prefix only
 * if it is Secure, has Path=/ and has NO Domain attribute. Without the last
 * one, any sibling subdomain — including one an attacker gets control of —
 * could write a cookie this origin would read as a partner session.
 *
 * SAMESITE=STRICT, UNLIKE THE ATTRIBUTION COOKIE. That cookie must survive a
 * cross-site top-level navigation, because arriving from the affiliate's own
 * site IS its purpose. A partner console is the opposite: there is no legitimate
 * flow in which a partner arrives at a mutating partner URL from a third-party
 * page. Strict makes the whole class of cross-site request forgery inapplicable
 * to this cookie, and the Origin check in the request guard is the second layer
 * rather than the only one.
 *
 * THE EPOCH IS WHY THERE IS NO SESSION TABLE. `sessionEpoch` is minted into the
 * payload and compared against the principal's current value on every request.
 * A password change or a forced sign-out bumps the column, and every token ever
 * issued for that principal stops verifying — without a row per session, a
 * cleanup job, or a window in which a revoked token still works.
 */
import crypto from "node:crypto";
import { getPartnerSessionSecret } from "@/lib/affiliate/platform-config";

export const PARTNER_SESSION_COOKIE_NAME = "__Host-ata_partner_session";
export const PARTNER_CSRF_COOKIE_NAME = "__Host-ata_partner_csrf";
export const PARTNER_CSRF_HEADER_NAME = "x-partner-csrf-token";

/**
 * Eight hours, not the learner session's seven days.
 *
 * A partner console shows commercial terms, conversion history and money owed,
 * and it is used in sessions rather than lived in. A week-long cookie on a
 * shared or borrowed machine is a week of exposure for a tenant boundary this
 * phase spends most of its effort defending.
 */
export const PARTNER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

/**
 * The audience label inside the signed payload.
 *
 * IT IS SIGNED, NOT MERELY PRESENT. A token minted for any other purpose, with
 * any other prefix, produces a different MAC — so even a hypothetical future
 * signer that shared this secret could not mint something this verifier
 * accepts.
 */
const PARTNER_TOKEN_PREFIX = "atap1";

export type PartnerSessionClaims = {
  readonly partnerUserId: number;
  readonly sessionEpoch: number;
  readonly expiresAt: Date;
};

function sign(payload: string, env: NodeJS.ProcessEnv = process.env): string {
  return crypto
    .createHmac("sha256", getPartnerSessionSecret(env))
    .update(payload)
    .digest("base64url");
}

export function createPartnerSessionToken(
  input: { partnerUserId: number; sessionEpoch: number },
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): { token: string; expiresAt: Date } {
  const expiresAtMs = now.getTime() + PARTNER_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${PARTNER_TOKEN_PREFIX}.${input.partnerUserId}.${input.sessionEpoch}.${expiresAtMs}`;
  return { token: `${payload}.${sign(payload, env)}`, expiresAt: new Date(expiresAtMs) };
}

/**
 * Verify a token's SIGNATURE, SHAPE and EXPIRY. Nothing else.
 *
 * IT DELIBERATELY DOES NOT KNOW WHETHER THE PRINCIPAL STILL EXISTS. A valid
 * signature proves the token was minted here and has not been edited; it proves
 * nothing about whether the human is still allowed in. That question needs the
 * database and belongs to `resolvePartnerPrincipal`, which is the only function
 * a route may call. Keeping them apart is what stops a route from being written
 * that checks the signature and then trusts the id.
 */
export function verifyPartnerSessionToken(
  token: string | undefined,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): PartnerSessionClaims | null {
  if (typeof token !== "string" || token === "") return null;

  const parts = token.split(".");
  if (parts.length !== 5) return null;

  const [prefix, idRaw, epochRaw, expiresRaw, signature] = parts;
  if (prefix !== PARTNER_TOKEN_PREFIX) return null;

  const payload = `${prefix}.${idRaw}.${epochRaw}.${expiresRaw}`;

  let expected: string;
  try {
    expected = sign(payload, env);
  } catch {
    // The platform is disabled or its secret is unusable. No token verifies,
    // which is the correct answer and not an error to report to a caller.
    return null;
  }

  const given = Buffer.from(signature, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return null;
  if (!crypto.timingSafeEqual(given, want)) return null;

  const partnerUserId = Number(idRaw);
  const sessionEpoch = Number(epochRaw);
  const expiresAtMs = Number(expiresRaw);
  if (!Number.isInteger(partnerUserId) || partnerUserId <= 0) return null;
  if (!Number.isInteger(sessionEpoch) || sessionEpoch <= 0) return null;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) return null;

  return { partnerUserId, sessionEpoch, expiresAt: new Date(expiresAtMs) };
}

export type PartnerCookieOptions = {
  readonly httpOnly: boolean;
  readonly secure: true;
  readonly sameSite: "strict";
  readonly path: "/";
  readonly maxAge: number;
};

/**
 * Options for the session cookie. There is deliberately no `domain` key:
 * adding one would make the browser refuse the `__Host-` name outright, and
 * omitting the key entirely means nobody can add one by editing a value.
 *
 * `secure` IS UNCONDITIONAL, exactly as it is for the attribution cookie. A
 * `__Host-` cookie that is not Secure is not stored by any modern browser, so a
 * conditional flag would produce a cookie that silently never exists.
 */
export function partnerSessionCookieOptions(maxAgeSeconds: number): PartnerCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

/**
 * The CSRF companion. NOT HttpOnly, because the partner client must read it to
 * echo it in a header — that is the whole double-submit construction, and it is
 * the same one the learner surface already uses.
 *
 * IT IS THE SECOND LAYER, NOT THE ONLY ONE. SameSite=Strict on the session
 * cookie already means a cross-site request arrives with no session at all.
 */
export function partnerCsrfCookieOptions(maxAgeSeconds: number): PartnerCookieOptions {
  return {
    httpOnly: false,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

export function createPartnerCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Compare the cookie and header halves of the double-submit token.
 *
 * TIMING-SAFE AND LENGTH-SAFE. A plain `===` on a secret-shaped value is the
 * habit worth not having, even where the practical attack is thin.
 */
export function partnerCsrfTokensMatch(
  cookieToken: string | null | undefined,
  headerToken: string | null | undefined,
): boolean {
  if (typeof cookieToken !== "string" || cookieToken.length < 32) return false;
  if (typeof headerToken !== "string" || headerToken.length !== cookieToken.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(cookieToken, "utf8"),
    Buffer.from(headerToken, "utf8"),
  );
}
