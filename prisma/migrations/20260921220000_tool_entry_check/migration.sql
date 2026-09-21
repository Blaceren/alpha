-- TOOLS-V2 — Entry Checklist (L20), the fourth tool of the rebuilt block.
--
-- ADDITIVE, AND NOTHING ELSE. One CREATE TABLE and one index. No existing table
-- is altered, no existing row is rewritten, nothing is deleted. A Backend
-- release built before this migration never queries the table, which keeps
-- that release a valid rollback target after the table has rows.
--
-- HAND-WRITTEN for the same reason as every recent migration here.
--
-- ONE ROW IS ONE CHECK, made before one entry and kept as it was. The nine
-- items are fixed (owner decision), so the answers are nine characters, one per
-- item in the list's order, under listVersion 1. The verdict is written by the
-- server from the answers, and the CHECK below keeps the verdict and the item
-- it names from contradicting each other. Rows are never edited or deleted by
-- the application, so the table has no updatedAt.
--
-- The learner's minimum payout is the number they check the payout against,
-- kept with the check it was checked in. Timestamps are integer epoch
-- milliseconds with typeof CHECKs, as everywhere else.
CREATE TABLE "ToolEntryCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "assetCode" TEXT NOT NULL CHECK (length(trim("assetCode")) > 0),
    "minPayoutPercent" INTEGER CHECK ("minPayoutPercent" IS NULL OR (typeof("minPayoutPercent") = 'integer' AND "minPayoutPercent" BETWEEN 1 AND 100)),
    "listVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("listVersion" = 1),
    "answers" TEXT NOT NULL CHECK ("answers" GLOB '[01][01][01][01][01][01][01][01][01]'),
    "verdict" TEXT NOT NULL CHECK ("verdict" IN ('enter', 'skip_stop', 'skip_condition')),
    "missingItem" TEXT CHECK ("missingItem" IS NULL OR ("missingItem" NOT GLOB '*[^a-z_]*' AND length("missingItem") BETWEEN 2 AND 40)),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    CONSTRAINT "ToolEntryCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (("verdict" = 'enter') = ("missingItem" IS NULL)),
    CHECK (("verdict" = 'enter') = ("answers" = '111111111'))
);

-- The learner's checks, newest first.
CREATE INDEX "ToolEntryCheck_userId_createdAt_idx" ON "ToolEntryCheck"("userId", "createdAt");
