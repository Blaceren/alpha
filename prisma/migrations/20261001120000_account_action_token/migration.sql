-- ACCOUNT RECOVERY — the one-time links a learner receives by email: a password
-- reset, and the confirmation of a new address (owner, 2026-10-01: «сброс
-- пароля / восстановление пароля, подтверждение и смена почты»).
--
-- ADDITIVE, AND NOTHING ELSE. One CREATE TABLE and its indexes. No existing
-- table is altered, no existing row is rewritten, nothing is deleted. A Backend
-- release built before this migration never queries the table, which keeps
-- that release a valid rollback target after the table has rows. Email
-- verification keeps its own table (EmailVerificationToken), untouched.
--
-- HAND-WRITTEN for the same reason as every recent migration here.
--
-- ONE ROW IS ONE LINK. The raw token exists only in the email. The row holds
-- its SHA-256 (64 lowercase hex characters, checked), so a copy of the database
-- cannot be turned into a working link. A row is used once (usedAt), and a
-- newer link of the same kind or a cancelled request retires the older ones
-- (revokedAt). newEmail is set exactly for email_change, which the table
-- itself checks. Timestamps are integer epoch milliseconds with typeof CHECKs,
-- as everywhere else.
CREATE TABLE "AccountActionToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('password_reset', 'email_change')),
    "tokenHash" TEXT NOT NULL CHECK (length("tokenHash") = 64 AND "tokenHash" NOT GLOB '*[^0-9a-f]*'),
    "newEmail" TEXT CHECK ("newEmail" IS NULL OR (length("newEmail") BETWEEN 3 AND 254 AND "newEmail" = trim("newEmail"))),
    "expiresAt" DATETIME NOT NULL CHECK (typeof("expiresAt") = 'integer'),
    "usedAt" DATETIME CHECK ("usedAt" IS NULL OR typeof("usedAt") = 'integer'),
    "revokedAt" DATETIME CHECK ("revokedAt" IS NULL OR typeof("revokedAt") = 'integer'),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    CONSTRAINT "AccountActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (("kind" = 'email_change') = ("newEmail" IS NOT NULL))
);

-- The link is found by its hash, and a hash names one link.
CREATE UNIQUE INDEX "AccountActionToken_tokenHash_key" ON "AccountActionToken"("tokenHash");

-- A learner's links of one kind: to retire the older ones when a new one is made.
CREATE INDEX "AccountActionToken_userId_kind_idx" ON "AccountActionToken"("userId", "kind");

-- Expired rows, for housekeeping.
CREATE INDEX "AccountActionToken_expiresAt_idx" ON "AccountActionToken"("expiresAt");
