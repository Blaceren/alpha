-- ENTRY CHECKLIST, THE SECOND LIST (owner 2026-10-07: «нужно не 9 а 7 условий»).
-- The seven items replace the nine, under listVersion 2, so a check answered
-- against the new list is seven characters, one per item in the list's order.
--
-- A REBUILD, BECAUSE SQLITE CANNOT CHANGE A CHECK. The table's constraints
-- pinned listVersion to 1 and the answers to nine characters, so the table is
-- created again with constraints that know both lists, every row is copied
-- over as it is, and the old table is dropped. No row is rewritten and nothing
-- is lost: a check of the first list keeps its nine answers under version 1.
--
-- ROLLBACK-SAFE. A Backend built before this migration writes version 1 with
-- nine answers, which the new constraints allow, and reads any row it finds.
--
-- The verdict «enter» means every item confirmed, whichever the list: no «0»
-- among the answers. Nothing references this table, so the rebuild has no
-- child rows to re-point.
--
-- (No semicolon appears in these comments: the migration runner splits the file
-- on it.)

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ToolEntryCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "assetCode" TEXT NOT NULL CHECK (length(trim("assetCode")) > 0),
    "minPayoutPercent" INTEGER CHECK ("minPayoutPercent" IS NULL OR (typeof("minPayoutPercent") = 'integer' AND "minPayoutPercent" BETWEEN 1 AND 100)),
    "listVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("listVersion" IN (1, 2)),
    "answers" TEXT NOT NULL CHECK (
        ("listVersion" = 1 AND "answers" GLOB '[01][01][01][01][01][01][01][01][01]')
        OR ("listVersion" = 2 AND "answers" GLOB '[01][01][01][01][01][01][01]')
    ),
    "verdict" TEXT NOT NULL CHECK ("verdict" IN ('enter', 'skip_stop', 'skip_condition')),
    "missingItem" TEXT CHECK ("missingItem" IS NULL OR ("missingItem" NOT GLOB '*[^a-z_]*' AND length("missingItem") BETWEEN 2 AND 40)),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    CONSTRAINT "ToolEntryCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (("verdict" = 'enter') = ("missingItem" IS NULL)),
    CHECK (("verdict" = 'enter') = ("answers" NOT GLOB '*0*'))
);

INSERT INTO "new_ToolEntryCheck" ("id", "userId", "assetCode", "minPayoutPercent", "listVersion", "answers", "verdict", "missingItem", "createdAt")
SELECT "id", "userId", "assetCode", "minPayoutPercent", "listVersion", "answers", "verdict", "missingItem", "createdAt"
FROM "ToolEntryCheck";

DROP TABLE "ToolEntryCheck";

ALTER TABLE "new_ToolEntryCheck" RENAME TO "ToolEntryCheck";

CREATE INDEX "ToolEntryCheck_userId_createdAt_idx" ON "ToolEntryCheck"("userId", "createdAt");

PRAGMA foreign_keys=ON;
