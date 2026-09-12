-- H-7 — the learner session becomes server-side and revocable.
--
-- ADDITIVE, AND NOTHING ELSE. One CREATE TABLE and two indexes. No existing
-- table is altered, no existing row is rewritten, and nothing is deleted. That
-- is what makes rollback safe: a Backend release built before this migration
-- does not know the table exists and never queries it, so the table simply sits
-- there unused until the release that needs it is active again.
--
-- WHY IT IS HAND-WRITTEN. `prisma migrate diff` against the live PREPROD
-- database emits a rebuild of thirteen unrelated tables and a batch of index
-- renames, none of which is this change — the same reason every recent
-- migration in this directory is written by hand.
--
-- THE RAW TOKEN IS NEVER STORED. `tokenHash` is a SHA-256 hex digest of the
-- bearer token, so this table is useless to anyone who reads it: it cannot be
-- replayed, and verification is a hash lookup rather than a secret comparison.
--
-- NO ROLE COLUMN, DELIBERATELY. The role is read from "User" at verification
-- time, which is what makes a demotion or a block take effect on the next
-- request instead of at the next login.
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The lookup on every authenticated request is by hash, and a hash must name at
-- most one session.
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- Login revokes every live row for one user, so that read is by userId.
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- Expiry sweeps read by expiresAt.
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- ONE ACTIVE SESSION PER USER, ENFORCED BY THE DATABASE.
--
-- The application already revokes-then-inserts inside a transaction, and that
-- is the right shape. It is not, on its own, an invariant: any other writer —
-- a script, a future route, a hand-typed INSERT during an incident — can create
-- a second live row without going through it, and nothing would notice until a
-- learner had two working sessions.
--
-- A PARTIAL index is what expresses the rule exactly. `userId` alone cannot be
-- unique, because a user accumulates revoked rows over time and they are
-- history worth keeping. The uniqueness applies only to the live ones.
--
-- SQLite supports partial indexes directly, so this needs no application
-- fallback. Prisma cannot express the WHERE clause in schema.prisma, so the
-- index is created here and the schema records it in a comment — the database
-- is the authority either way.
CREATE UNIQUE INDEX "UserSession_userId_active_key"
    ON "UserSession"("userId")
    WHERE "revokedAt" IS NULL;
