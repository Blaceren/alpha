-- TOOLS-V2 — Trading Journal (L10), the second tool of the rebuilt block.
--
-- ADDITIVE, AND NOTHING ELSE. Two CREATE TABLEs and three indexes. No existing
-- table is altered, no existing row is rewritten, nothing is deleted. A Backend
-- release built before this migration never queries either table, which keeps
-- that release a valid rollback target after the tables have rows.
--
-- HAND-WRITTEN for the same reason as every recent migration here.
--
-- TWO SOURCES, ONE SHAPE. An entry is either a Trade Card saved after the
-- journal opened (source trade_card, exactly one entry per card) or a trade
-- the learner records by hand (source manual). The CHECK below ties the source
-- to the presence of the card reference, so neither can drift from the other.
--
-- DATES ARE THE LEARNER'S OWN. tradeDate is the learner's local calendar date
-- and entryTime their local clock time, both as typed text. Timestamps are
-- integer epoch milliseconds with typeof CHECKs, as everywhere else.
--
-- MONEY IS ONE STAKE, NEVER A BALANCE, exactly as on the Trade Card.
CREATE TABLE "ToolJournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "source" TEXT NOT NULL CHECK ("source" IN ('trade_card', 'manual')),
    "tradeCardId" TEXT,
    "tradeDate" TEXT NOT NULL CHECK ("tradeDate" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    "entryTime" TEXT NOT NULL CHECK ("entryTime" GLOB '[0-2][0-9]:[0-5][0-9]'),
    "assetCode" TEXT NOT NULL CHECK (length(trim("assetCode")) > 0),
    "direction" TEXT NOT NULL CHECK ("direction" IN ('up', 'down')),
    "amountMinor" INTEGER NOT NULL CHECK (typeof("amountMinor") = 'integer' AND "amountMinor" BETWEEN 1 AND 100000000),
    "payoutPercent" INTEGER NOT NULL CHECK (typeof("payoutPercent") = 'integer' AND "payoutPercent" BETWEEN 1 AND 100),
    "expiryCode" TEXT NOT NULL CHECK (length(trim("expiryCode")) > 0),
    "result" TEXT NOT NULL CHECK ("result" IN ('profit', 'loss')),
    "plan" TEXT CHECK ("plan" IS NULL OR length(trim("plan")) > 0),
    "execution" TEXT CHECK ("execution" IS NULL OR length(trim("execution")) > 0),
    "conclusion" TEXT CHECK ("conclusion" IS NULL OR length(trim("conclusion")) > 0),
    "planFollowed" BOOLEAN CHECK ("planFollowed" IS NULL OR "planFollowed" IN (0, 1)),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    "updatedAt" DATETIME NOT NULL CHECK (typeof("updatedAt") = 'integer'),
    CONSTRAINT "ToolJournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolJournalEntry_tradeCardId_fkey" FOREIGN KEY ("tradeCardId") REFERENCES "ToolTradeCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (("source" = 'trade_card') = ("tradeCardId" IS NOT NULL))
);

-- One journal entry per card, enforced by the database.
CREATE UNIQUE INDEX "ToolJournalEntry_tradeCardId_key" ON "ToolJournalEntry"("tradeCardId");

-- The learner's own entries, newest trade first.
CREATE INDEX "ToolJournalEntry_userId_tradeDate_entryTime_idx" ON "ToolJournalEntry"("userId", "tradeDate", "entryTime");

-- The rules a learner says they broke on one entry. The codes are validated
-- by the application against its fixed list, and the database keeps them to
-- plain lowercase identifiers, one of each per entry.
CREATE TABLE "ToolJournalViolation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "code" TEXT NOT NULL CHECK ("code" NOT GLOB '*[^a-z_]*' AND length("code") BETWEEN 2 AND 40),
    CONSTRAINT "ToolJournalViolation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ToolJournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ToolJournalViolation_entryId_code_key" ON "ToolJournalViolation"("entryId", "code");
