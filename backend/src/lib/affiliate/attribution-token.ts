/**
 * AFD-3B2 — the opaque, signed attribution token.
 *
 * WHAT IT IS. A versioned, authenticated pointer to an anonymous server-side
 * click journey, and nothing else. It carries a random visitor id, when it was
 * issued and when it stops being valid. That is the entire payload.
 *
 * WHAT IT IS NOT, AND WHY. It carries no affiliate id, no campaign id, no
 * tracking-link id, no publicCode, no external affiliate click id, no
 * ataClickId, no email, no user id and no Pocket identifier. Every one of those
 * would turn the cookie into a claim the browser makes about who referred it —
 * and a claim in a cookie is a claim an attacker can edit, replay or hand to a
 * friend. Instead the browser holds an opaque pointer and the SERVER looks up
 * what that pointer earned, from rows only the server ever wrote.
 *
 * SIGNED, NOT ENCRYPTED. The payload is readable by anyone who base64-decodes
 * it, and this file never pretends otherwise. That is acceptable precisely
 * because the payload is a random id and two timestamps: there is nothing in it
 * worth hiding. The signature exists to stop forgery and tampering, not to keep
 * a secret, and calling it "encrypted" would invite someone to put a secret in
 * it later.
 */
import crypto from "node:crypto";
import { AFFILIATE_ID_PATTERN } from "@/lib/affiliate/random-id";

/**
 * The current token version. It appears BOTH in the prefix and inside the
 * signed payload, and the two must agree: the prefix lets a verifier route
 * before parsing, and the signed copy stops anyone rewriting the prefix.
 */
export const ATTRIBUTION_TOKEN_VERSION = 1;

/**
 * A hard ceiling on what will even be parsed. A real token is about 170
 * characters; anything materially longer is not a token that got bigger, it is
 * someone probing the parser, and it is refused before base64 or JSON runs.
 */
export const ATTRIBUTION_TOKEN_MAX_LENGTH = 256;

/** 365 days, matching the schema's window ceiling. */
export const ATTRIBUTION_TOKEN_MAX_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

export type AttributionTokenPayload = {
  readonly version: number;
  readonly anonymousVisitorId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
};

export type AttributionTokenRejection =
  | "absent"
  | "too_long"
  | "malformed"
  | "future_version"
  | "bad_signature"
  | "bad_payload"
  | "implausible_lifetime"
  | "expired";

export type AttributionTokenVerification =
  | { readonly kind: "valid"; readonly payload: AttributionTokenPayload }
  | { readonly kind: "invalid"; readonly reason: AttributionTokenRejection };

function base64UrlEncode(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Buffer | null {
  // Strict alphabet: a value carrying padding, standard-base64 characters or
  // anything else is refused rather than silently normalised, so exactly one
  // encoding of a given payload is accepted.
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  try {
    return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
}

function sign(secret: string, signedInput: string): string {
  return base64UrlEncode(crypto.createHmac("sha256", secret).update(signedInput).digest());
}

/**
 * Constant-time comparison, and length-safe.
 *
 * `crypto.timingSafeEqual` throws when the buffers differ in length, and the
 * naive fix — comparing lengths first and returning early — leaks the length
 * through timing. Both sides are hashed to a fixed 32 bytes first, so the
 * comparison is always over equal-length buffers and reveals nothing.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function createAttributionToken(input: {
  secret: string;
  anonymousVisitorId: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  const issuedAt = Math.floor(input.issuedAt.getTime() / 1000);
  const expiresAt = Math.floor(input.expiresAt.getTime() / 1000);

  if (!AFFILIATE_ID_PATTERN.test(input.anonymousVisitorId)) {
    throw new Error("attribution token: anonymousVisitorId has the wrong shape");
  }
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) {
    throw new Error("attribution token: implausible lifetime");
  }
  if (expiresAt - issuedAt > ATTRIBUTION_TOKEN_MAX_LIFETIME_SECONDS) {
    throw new Error("attribution token: lifetime exceeds the 365-day ceiling");
  }

  // Key order is fixed so the same inputs always produce the same bytes.
  const payload = JSON.stringify({
    v: ATTRIBUTION_TOKEN_VERSION,
    vid: input.anonymousVisitorId,
    iat: issuedAt,
    exp: expiresAt,
  });
  const encodedPayload = base64UrlEncode(Buffer.from(payload, "utf8"));
  const signedInput = `${ATTRIBUTION_TOKEN_VERSION}.${encodedPayload}`;

  return `${signedInput}.${sign(input.secret, signedInput)}`;
}

/**
 * Verify a token. Every failure is a bounded code and no failure quotes the
 * token, the payload or the secret.
 *
 * ORDER MATTERS. The signature is checked BEFORE the payload is trusted for
 * anything, so a forged token can never reach the expiry or visitor-id logic —
 * but the payload is parsed first only to the extent needed to bound it, and a
 * parse failure on unsigned bytes is reported as `bad_payload` without ever
 * being acted upon.
 */
export function verifyAttributionToken(
  token: string | undefined | null,
  secret: string,
  now: Date = new Date(),
): AttributionTokenVerification {
  if (typeof token !== "string" || token === "") return { kind: "invalid", reason: "absent" };
  if (token.length > ATTRIBUTION_TOKEN_MAX_LENGTH) return { kind: "invalid", reason: "too_long" };

  const parts = token.split(".");
  if (parts.length !== 3) return { kind: "invalid", reason: "malformed" };
  const [versionPart, encodedPayload, signature] = parts;

  if (!/^[0-9]{1,3}$/.test(versionPart)) return { kind: "invalid", reason: "malformed" };
  const version = Number(versionPart);
  // A token from a FUTURE version is refused rather than best-effort parsed. A
  // deployment that has been rolled back must not act on a payload whose shape
  // it does not know, and reporting it distinctly is what makes a partial
  // rollout visible instead of mysterious.
  if (version > ATTRIBUTION_TOKEN_VERSION) return { kind: "invalid", reason: "future_version" };
  if (version !== ATTRIBUTION_TOKEN_VERSION) return { kind: "invalid", reason: "malformed" };

  if (encodedPayload === "" || signature === "") return { kind: "invalid", reason: "malformed" };
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) return { kind: "invalid", reason: "malformed" };

  const expectedSignature = sign(secret, `${versionPart}.${encodedPayload}`);
  if (!constantTimeEquals(signature, expectedSignature)) {
    return { kind: "invalid", reason: "bad_signature" };
  }

  const decoded = base64UrlDecode(encodedPayload);
  if (decoded === null || decoded.byteLength > 512) return { kind: "invalid", reason: "bad_payload" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    return { kind: "invalid", reason: "bad_payload" };
  }

  // STRICT SCHEMA. Exactly four keys, exactly these names, exactly these types.
  // An extra key is a refusal, not something to ignore: a signed token with a
  // field this version does not understand is not a token this version issued.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "invalid", reason: "bad_payload" };
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 4 || keys.join(",") !== "exp,iat,v,vid") {
    return { kind: "invalid", reason: "bad_payload" };
  }
  if (record.v !== ATTRIBUTION_TOKEN_VERSION) return { kind: "invalid", reason: "bad_payload" };
  if (typeof record.vid !== "string" || !AFFILIATE_ID_PATTERN.test(record.vid)) {
    return { kind: "invalid", reason: "bad_payload" };
  }
  if (!Number.isSafeInteger(record.iat) || !Number.isSafeInteger(record.exp)) {
    return { kind: "invalid", reason: "bad_payload" };
  }

  const issuedAt = record.iat as number;
  const expiresAt = record.exp as number;
  if (issuedAt <= 0 || expiresAt <= issuedAt) return { kind: "invalid", reason: "implausible_lifetime" };
  if (expiresAt - issuedAt > ATTRIBUTION_TOKEN_MAX_LIFETIME_SECONDS) {
    return { kind: "invalid", reason: "implausible_lifetime" };
  }

  if (Math.floor(now.getTime() / 1000) >= expiresAt) return { kind: "invalid", reason: "expired" };

  return {
    kind: "valid",
    payload: {
      version: ATTRIBUTION_TOKEN_VERSION,
      anonymousVisitorId: record.vid,
      issuedAt,
      expiresAt,
    },
  };
}
