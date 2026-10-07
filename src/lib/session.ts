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
 * TWO LIVE SESSIONS PER USER, by product decision (owner 2026-10-07: «можно
 * было иметь 2 активных сеанса в 1 аккаунте»; H-7 held one). A sign-in takes a
 * free one of the two slots; when both are taken it closes the session that
 * went unused the longest and takes its slot — the learner is never locked out
 * and never has a third (owner's answer: «закрывать самый давний»). A password
 * change still rotates: every live row is revoked and one is issued. The
 * database holds the limit (`UserSession_userId_slot_active_key`), so two
 * concurrent sign-ins racing for one slot cannot both land — the loser re-reads
 * and takes what is left.
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

/** How many sessions one account may have live at once (owner 2026-10-07). */
export const MAX_LIVE_SESSIONS = 2;

/** «Last used» is written at most this often, so a request is not a write. */
const LAST_SEEN_STEP_MS = 5 * 60 * 1000;

/** The browser's description is kept to this length, and only to name a device. */
const USER_AGENT_MAX = 400;

export type SessionPayload = {
  userId: number;
  role: UserRole;
  expiresAt: Date;
  /** The row's id — which of the account's sessions this request is. Not a credential. */
  sessionId: string;
};

/** What a sign-in may record about the browser it happens in. */
export type SessionMeta = {
  userAgent?: string | null;
};

function cleanUserAgent(value?: string | null): string | null {
  if (!value) return null;
  const printable = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return printable ? printable.slice(0, USER_AGENT_MAX) : null;
}

function lastUsedAt(row: { lastSeenAt: Date | null; createdAt: Date }): number {
  return (row.lastSeenAt ?? row.createdAt).getTime();
}

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
 * ROTATE: revoke every live session the user has and issue one.
 *
 * Used where every other session must end — a password change. Returns the RAW
 * token, which the caller puts in the cookie and nowhere else. Revoke and
 * insert are one transaction, so two concurrent rotations leave exactly one
 * row live.
 */
export async function issueSessionWithin(
  userId: number,
  beforeRotation?: (tx: Prisma.TransactionClient) => Promise<void>,
  meta: SessionMeta = {},
): Promise<string> {
  /* THE DATABASE IS THE INVARIANT, AND IT CAN SAY NO.
     `UserSession_userId_slot_active_key` is a unique index over (userId, slot)
     WHERE revokedAt IS NULL, so two rotations racing for the same user cannot
     both insert into slot 0 — one of them loses. That is the constraint
     working, not an error worth showing anyone: the loser simply re-reads the
     world and tries again, and its second attempt revokes the winner's row and
     inserts its own.

     Bounded deliberately. A retry loop that never gives up would turn a
     genuine database fault into a hang; three attempts covers contention and
     lets anything else surface as the failure it is. */
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

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
          data: { revokedAt: now },
        });
        await tx.userSession.create({
          data: { userId, tokenHash, expiresAt, slot: 0, userAgent: cleanUserAgent(meta.userAgent), lastSeenAt: now },
        });
      });
      return token;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw lastError;
}

/**
 * SIGN IN: issue a session alongside the one the user may already have.
 *
 * Two may be live (`MAX_LIVE_SESSIONS`). A free slot is taken; with both taken,
 * the session unused the longest is revoked and its slot is taken — the owner's
 * answer of 2026-10-07, «закрывать самый давний». An expired row that was never
 * revoked frees its slot first. Returns the RAW token. `onEvicted` hears which
 * session was closed to make room, after the commit, so the caller can record it.
 */
export async function issueSession(
  userId: number,
  meta: SessionMeta & { onEvicted?: (sessionId: string) => void } = {},
): Promise<string> {
  /* The same discipline as a rotation: two sign-ins racing for the last free
     slot cannot both insert into it, the loser re-reads and takes what is left
     (closing the session unused the longest if nothing is). Five attempts, not
     three: a burst of sign-ins can lose more than one race in a row. */
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

    try {
      const evicted = await prisma.$transaction(async (tx) => {
        await tx.userSession.updateMany({
          where: { userId, revokedAt: null, expiresAt: { lte: now } },
          data: { revokedAt: now },
        });
        const live = await tx.userSession.findMany({
          where: { userId, revokedAt: null },
          select: { id: true, slot: true, createdAt: true, lastSeenAt: true },
        });

        let evictedId: string | null = null;
        let slot = Array.from({ length: MAX_LIVE_SESSIONS }, (_, i) => i).find(
          (candidate) => !live.some((row) => row.slot === candidate),
        );
        if (slot === undefined) {
          const unusedLongest = [...live].sort((a, b) => lastUsedAt(a) - lastUsedAt(b))[0]!;
          await tx.userSession.update({ where: { id: unusedLongest.id }, data: { revokedAt: now } });
          evictedId = unusedLongest.id;
          slot = unusedLongest.slot;
        }

        await tx.userSession.create({
          data: { userId, tokenHash, expiresAt, slot, userAgent: cleanUserAgent(meta.userAgent), lastSeenAt: now },
        });
        return evictedId;
      });
      if (evicted) meta.onEvicted?.(evicted);
      return token;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw lastError;
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
 *
 * `touch` records that the session was used (at most every few minutes) — what
 * a third sign-in reads to find the session unused the longest. Requests touch
 * through `getSession`; a read that only labels something (the click
 * classifier) does not.
 */
export async function resolveSession(
  token?: string | null,
  options: { touch?: boolean } = {},
): Promise<SessionPayload | null> {
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

  if (options.touch && Date.now() - lastUsedAt(record) >= LAST_SEEN_STEP_MS) {
    try {
      await prisma.userSession.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { lastSeenAt: new Date() },
      });
    } catch {
      /* «Last used» is a convenience: missing one never fails a request. */
    }
  }

  return {
    userId: record.user.id,
    role: record.user.role,
    expiresAt: record.expiresAt,
    sessionId: record.id,
  };
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

/** A live session as the account's own list shows it — no token, no hash. */
export type LiveSession = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
};

/** The user's live sessions, the most recently used first. */
export async function listLiveSessions(userId: number): Promise<LiveSession[]> {
  const rows = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true },
  });
  return rows
    .map((row) => ({ ...row, lastSeenAt: row.lastSeenAt ?? row.createdAt }))
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

/**
 * Close one of the user's sessions by its id — from the account's other
 * session (owner 2026-10-07: «возможность закрыть сеанс с другого сеанса»).
 * Scoped by the user, so an id that belongs to someone else, is already closed
 * or never existed changes nothing and answers false.
 */
export async function revokeUserSession(userId: number, sessionId: string): Promise<boolean> {
  const result = await prisma.userSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** The raw token from the request cookie, or undefined. */
export async function readSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function getSession(): Promise<SessionPayload | null> {
  return resolveSession(await readSessionToken(), { touch: true });
}

export async function getSessionUserId(): Promise<number | null> {
  return (await getSession())?.userId ?? null;
}
