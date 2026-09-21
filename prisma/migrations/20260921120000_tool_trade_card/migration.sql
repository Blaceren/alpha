-- TOOLS-V2 — Trade Card (L5), the first tool of the rebuilt tool block.
--
-- ADDITIVE, AND NOTHING ELSE. One CREATE TABLE and two indexes. No existing
-- table is altered, no existing row is rewritten, nothing is deleted. A Backend
-- release built before this migration never queries the table, which is what
-- keeps that release a valid rollback target after the table has rows.
--
-- WHY IT IS HAND-WRITTEN. Exactly as every recent migration here: a generated
-- diff against the live PREPROD database rebuilds unrelated tables and drops
-- their hand-written CHECK constraints.
--
-- TIMESTAMPS ARE INTEGER EPOCH MILLISECONDS, the storage class migration 48
-- normalised the database to. Prisma always writes the timestamp columns itself
-- (now() and updatedAt), and the typeof CHECKs refuse any writer that would put
-- TEXT there - the defect a CURRENT_TIMESTAMP default reintroduced elsewhere.
--
-- THE STATE MACHINE IS IN THE DATABASE. A saved card has a result and a savedAt
-- and nothing else does. A cancelled card has a cancelledAt and nothing else
-- does. Money is one stake in integer minor units, never a balance.
CREATE TABLE "ToolTradeCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('fixed', 'saved', 'cancelled')),
    "assetCode" TEXT NOT NULL CHECK (length(trim("assetCode")) > 0),
    "direction" TEXT NOT NULL CHECK ("direction" IN ('up', 'down')),
    "amountMinor" INTEGER NOT NULL CHECK (typeof("amountMinor") = 'integer' AND "amountMinor" BETWEEN 1 AND 100000000),
    "payoutPercent" INTEGER NOT NULL CHECK (typeof("payoutPercent") = 'integer' AND "payoutPercent" BETWEEN 1 AND 100),
    "expiryCode" TEXT NOT NULL CHECK (length(trim("expiryCode")) > 0),
    "entryTime" TEXT NOT NULL CHECK ("entryTime" GLOB '[0-2][0-9]:[0-5][0-9]'),
    "reason" TEXT NOT NULL CHECK (length(trim("reason")) >= 3),
    "fixedAt" DATETIME NOT NULL CHECK (typeof("fixedAt") = 'integer'),
    "planRevisionCount" INTEGER NOT NULL DEFAULT 0 CHECK ("planRevisionCount" >= 0),
    "result" TEXT CHECK ("result" IS NULL OR "result" IN ('profit', 'loss')),
    "observation" TEXT,
    "savedAt" DATETIME CHECK ("savedAt" IS NULL OR typeof("savedAt") = 'integer'),
    "cancelledAt" DATETIME CHECK ("cancelledAt" IS NULL OR typeof("cancelledAt") = 'integer'),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    "updatedAt" DATETIME NOT NULL CHECK (typeof("updatedAt") = 'integer'),
    CONSTRAINT "ToolTradeCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (("status" = 'saved') = ("result" IS NOT NULL)),
    CHECK (("status" = 'saved') = ("savedAt" IS NOT NULL)),
    CHECK (("status" = 'cancelled') = ("cancelledAt" IS NOT NULL))
);

-- The learner's own cards, newest first, for the Trading Journal (L10).
CREATE INDEX "ToolTradeCard_userId_createdAt_idx" ON "ToolTradeCard"("userId", "createdAt");

-- ONE OPEN CARD PER LEARNER, ENFORCED BY THE DATABASE.
--
-- The application resumes the open card instead of creating a second one, and
-- that is the right shape. It is not an invariant on its own: any other writer
-- could create a second open card and the learner would silently get two plans
-- for one trade. The uniqueness applies only to open cards, because saved and
-- cancelled cards are history worth keeping.
CREATE UNIQUE INDEX "ToolTradeCard_userId_open_key"
    ON "ToolTradeCard"("userId")
    WHERE "status" = 'fixed';
