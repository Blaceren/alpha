/**
 * H-7 — the learner session, server-side and revocable.
 *
 * ## What was here before, and why it had to change
 *
 * The session was a self-contained HMAC token, `userId.role.expiresAt.signature`.
 * Everything about a session lived inside the string the browser held, which
 * meant the server had no way to change its mind:
 *
 *   * logout cleared the cookie and nothing else, so a token copied beforehand
 *     kept working until it expired;
 *   * a second login issued a second token and the first stayed valid;
 *   * the role travelled inside the token, so a demotion or a block did not
 *     reach a session that had already been issued.
 *
 * ## What it is now
 *
 * The cookie carries an opaque bearer token — 32 random bytes, base64url — and
 * the database holds only its SHA-256. The row is the session; the token is a
 * key to it. Nothing about identity or authority is encoded in the string, so
 * nothing can be asserted by holding it that the server does not agree with.
 *
 * ONE ACTIVE SESSION PER USER, by product decision. `issueSession` revokes every
 * live row for that user and inserts one, inside a single transaction, so two
 * concurrent logins cannot both survive — the one that commits last wins, and
 * the other's token is dead before it reaches the browser.
 *
 * THE ROLE IS NOT IN THE SESSION. `resolveSession` reads it from the User row on
 * every request, together with the account status. That is what makes a role
 * change and a block take effect on the next request instead of at the next
 * login.
 *
 * FAIL CLOSED, EVERY TIME. Absent, malformed, unknown, expired, revoked, or
 * belonging to a blocked user — all of them return null, and null is
 * unauthenticated. There is no branch in this file that resolves a session it
 * cannot find a live row for.
 *
 * THE RAW TOKEN NEVER LEAVES THIS FILE except into the cookie. It is not
 * returned by `resolveSession`, not stored, not logged, and not included in any
 * error. The only value that exists elsewhere is the hash.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { Prisma, UserRole } from "@prisma/client";

/**
 * The cookie name, with the `__Host-` prefix.
 *
 * `__Host-` IS NOT DECORATION. A browser stores a cookie under that name only if
 * it is Secure, has Path=/ and carries NO Domain attribute — which means it
 * cannot be set by a subdomain, cannot be scoped to a parent domain, and cannot
 * be overwritten by one. The partner console has used the prefix since it
 * shipped; the learner session did not, and this closes that gap.
 */
export const SESSION_COOKIE_NAME = "__Host-trading_platform_session";

/**
 * The name the learner session used before this change.
 *
 * It exists here for exactly one purpose: login and logout clear it, so a
 * browser holding one does not keep sending a cookie nothing will ever accept.
 * Its VALUE is never read, verified or logged — only the name is used, to
 * expire it.
 */
export const LEGACY_SESSION_COOKIE_NAME = "trading_platform_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = {
  userId: number;
  role: UserRole;
  expiresAt: Date;
};

/**
 * Cookie attributes, fixed rather than computed.
 *
 * `secure` is unconditional. The previous options derived it from APP_URL, so a
 * misconfigured environment could serve the session over plain HTTP; and a
 * `__Host-` cookie that is not Secure is not stored by any browser at all, so
 * making it conditional would silently break the login rather than weaken it.
 *
 * There is deliberately no `domain`: the prefix forbids it.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: true,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

/** The same attributes, expiring the cookie instead of setting it. */
export const clearedSessionCookieOptions = { ...sessionCookieOptions, maxAge: 0 };

/**
 * Attributes for expiring the LEGACY cookie.
 *
 * It was set without the `__Host-` prefix and without `secure` guaranteed, so
 * it must be cleared on the same terms it was set on — a browser will not
 * expire a cookie whose attributes do not match.
 */
export const clearedLegacySessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: 0,
};

/**
 * Whether cookies OTHER than the session should be Secure.
 *
 * The session no longer asks: its `secure` is unconditional, because a
 * `__Host-` cookie that is not Secure is not stored at all. This helper stays
 * for the cookies that still derive it — the CSRF token among them — because
 * changing their attributes is not part of this change.
 */
export function shouldUseSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.APP_URL) {
    try {
      return new URL(env.APP_URL).protocol === "https:";
    } catch {
      // Runtime env validation reports malformed APP_URL values separately.
    }
  }
  return env.NODE_ENV === "production";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Issue a session, and revoke whatever that user had.
 *
 * Returns the RAW token, which the caller puts in the cookie and nowhere else.
 * The transaction is what makes "one active session" true under concurrency:
 * both logins revoke, both insert, and the second revoke covers the first
 * insert, so exactly one row is left live.
 */
export async function issueSessionWithin(
  userId: number,
  beforeRotation?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<string> {
  /* THE DATABASE IS THE INVARIANT, AND IT CAN SAY NO.
     `UserSession_userId_active_key` is a unique index over (userId) WHERE
     revokedAt IS NULL, so two logins racing for the same user cannot both
     insert — one of them loses. That is the constraint working, not an error
     worth showing anyone: the loser simply re-reads the world and tries again,
     and its second attempt revokes the winner's row and inserts its own.

     Bounded deliberately. A retry loop that never gives up would turn a
     genuine database fault into a hang; three attempts covers contention and
     lets anything else surface as the failure it is. */
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

    try {
      await prisma.$transaction(async (tx) => {
        /* THE CALLER'S WRITE AND THE ROTATION ARE ONE COMMIT.
           A password change that succeeded while its session rotation failed
           would leave the two facts disagreeing: the old password gone, the
           old token still live. Running the caller's write here means either
           both land or neither does. */
        if (beforeRotation) await beforeRotation(tx);
        await tx.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.userSession.create({ data: { userId, tokenHash, expiresAt } });
      });
      return token;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw lastError;
}

/** The original entry point: rotation with nothing alongside it. */
export async function issueSession(userId: number): Promise<string> {
  return issueSessionWithin(userId);
}

/** A unique-constraint failure, however this Prisma version reports it. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "P2002") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /UNIQUE constraint failed/i.test(message);
}

/**
 * Resolve a raw token to a session, or null.
 *
 * The lookup is by hash, so a token that was never issued finds nothing. The
 * hash is compared again in constant time after the lookup — the unique index
 * already guarantees the match, and the second comparison costs nothing and
 * removes any doubt about how the row was selected.
 */
export async function resolveSession(token?: string | null): Promise<SessionPayload | null> {
  if (!token || token.length < 16 || token.length > 512) return null;

  const tokenHash = hashToken(token);
  const record = await prisma.userSession.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, role: true, status: true } } },
  });

  if (!record) return null;
  if (record.revokedAt !== null) return null;
  if (record.expiresAt.getTime() <= Date.now()) return null;

  const presented = Buffer.from(tokenHash, "utf8");
  const stored = Buffer.from(record.tokenHash, "utf8");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;

  // The account, as it is NOW — not as it was when the session was issued.
  if (!record.user) return null;
  if (record.user.status === "blocked") return null;

  return { userId: record.user.id, role: record.user.role, expiresAt: record.expiresAt };
}

/**
 * Revoke a session by its raw token. Idempotent: revoking an already-revoked,
 * expired or unknown token is a no-op that reports success, because the caller's
 * intent — "this token must not work" — is satisfied either way.
 */
export async function revokeSession(token?: string | null): Promise<void> {
  if (!token) return;
  await prisma.userSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke every live session a user has. */
export async function revokeAllSessionsForUser(userId: number): Promise<void> {
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** The raw token from the request cookie, or undefined. */
export async function readSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function getSession(): Promise<SessionPayload | null> {
  return resolveSession(await readSessionToken());
}

export async function getSessionUserId(): Promise<number | null> {
  return (await getSession())?.userId ?? null;
}
