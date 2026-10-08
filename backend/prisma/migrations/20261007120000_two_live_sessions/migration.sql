-- TWO LIVE SESSIONS PER ACCOUNT (owner 2026-10-07: «можно было иметь 2 активных
-- сеанса в 1 аккаунте»). H-7 held one, by product decision, in the partial
-- unique index this migration replaces.
--
-- ADDITIVE AND ROLLBACK-SAFE. Three columns are added, one with a default and
-- two nullable, and one partial unique index is replaced by another. No
-- existing row is rewritten and nothing is deleted. A Backend built before this
-- migration revokes every live row and then inserts one with the default slot,
-- which the new index allows, so rolling the release back keeps working on this
-- schema.
--
-- THE SLOT IS WHAT THE DATABASE COUNTS. A partial unique index cannot say «at
-- most two», so every live row holds one of two slots (0 or 1, the CHECK) and
-- the index makes (userId, slot) unique among the live rows. Two live sessions
-- at most, refused by the database whichever writer tries for a third. Revoked
-- rows keep their slot as history and are outside the index.
--
-- userAgent is the browser's own description at sign-in, kept only to name the
-- device in the learner's list of sessions and never shown raw. lastSeenAt is
-- when the session was last used, written at most every few minutes, so a
-- third sign-in closes the session that went unused the longest. No IP address
-- is stored.
--
-- (No semicolon appears in these comments: the migration runner splits the file
-- on it.)

ALTER TABLE "UserSession" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0 CHECK ("slot" IN (0, 1));

ALTER TABLE "UserSession" ADD COLUMN "userAgent" TEXT;

ALTER TABLE "UserSession" ADD COLUMN "lastSeenAt" DATETIME;

DROP INDEX "UserSession_userId_active_key";

CREATE UNIQUE INDEX "UserSession_userId_slot_active_key"
    ON "UserSession"("userId", "slot")
    WHERE "revokedAt" IS NULL;
