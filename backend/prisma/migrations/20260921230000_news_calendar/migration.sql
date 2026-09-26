-- NEWS CALENDAR (L30), the sixth tool of the rebuilt block, and the news it reads.
--
-- ADDITIVE, AND NOTHING ELSE. Two CREATE TABLE and their indexes. No existing
-- table is altered, no existing row is rewritten, nothing is deleted. A Backend
-- release built before this migration never queries either table, which keeps
-- that release a valid rollback target after the tables have rows.
--
-- HAND-WRITTEN for the same reason as every recent migration here.
--
-- A NEWS ITEM is an economic release on the calendar, written in the CRM by
-- staff with the copywriter role (owner, 2026-09-21). A published item is its
-- own public page. The release instant is stored in UTC, and the country
-- decides the currency, which the table itself checks. The address (slug)
-- never changes once the item has been published. The legacy NewsPost table is
-- neither touched nor read. Timestamps are integer epoch milliseconds with
-- typeof CHECKs, as everywhere else.
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL CHECK (length("slug") BETWEEN 3 AND 120 AND "slug" NOT GLOB '*[^a-z0-9-]*' AND "slug" NOT GLOB '-*' AND "slug" NOT GLOB '*-' AND "slug" NOT GLOB '*--*'),
    "title" TEXT NOT NULL CHECK (length("title") BETWEEN 3 AND 140 AND "title" = trim("title")),
    "summary" TEXT NOT NULL CHECK (length("summary") BETWEEN 20 AND 300 AND "summary" = trim("summary")),
    "body" TEXT NOT NULL DEFAULT '' CHECK (length("body") <= 20000 AND "body" = trim("body")),
    "country" TEXT NOT NULL CHECK ("country" IN ('US', 'EA', 'DE', 'FR', 'IT', 'ES', 'GB', 'JP', 'CH', 'CA', 'AU', 'NZ', 'CN')),
    "currency" TEXT NOT NULL CHECK (
        ("currency" = 'USD' AND "country" = 'US')
        OR ("currency" = 'EUR' AND "country" IN ('EA', 'DE', 'FR', 'IT', 'ES'))
        OR ("currency" = 'GBP' AND "country" = 'GB')
        OR ("currency" = 'JPY' AND "country" = 'JP')
        OR ("currency" = 'CHF' AND "country" = 'CH')
        OR ("currency" = 'CAD' AND "country" = 'CA')
        OR ("currency" = 'AUD' AND "country" = 'AU')
        OR ("currency" = 'NZD' AND "country" = 'NZ')
        OR ("currency" = 'CNY' AND "country" = 'CN')
    ),
    "importance" INTEGER NOT NULL CHECK (typeof("importance") = 'integer' AND "importance" IN (1, 2, 3)),
    "releaseAt" DATETIME NOT NULL CHECK (typeof("releaseAt") = 'integer'),
    "forecast" TEXT CHECK ("forecast" IS NULL OR (length("forecast") BETWEEN 1 AND 24 AND "forecast" = trim("forecast"))),
    "previous" TEXT CHECK ("previous" IS NULL OR (length("previous") BETWEEN 1 AND 24 AND "previous" = trim("previous"))),
    "actual" TEXT CHECK ("actual" IS NULL OR (length("actual") BETWEEN 1 AND 24 AND "actual" = trim("actual"))),
    "sourceName" TEXT CHECK ("sourceName" IS NULL OR (length("sourceName") BETWEEN 2 AND 120 AND "sourceName" = trim("sourceName"))),
    "sourceUrl" TEXT CHECK ("sourceUrl" IS NULL OR (length("sourceUrl") <= 500 AND "sourceUrl" GLOB 'https://?*')),
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published')),
    "publishedAt" DATETIME CHECK ("publishedAt" IS NULL OR typeof("publishedAt") = 'integer'),
    "firstPublishedAt" DATETIME CHECK ("firstPublishedAt" IS NULL OR typeof("firstPublishedAt") = 'integer'),
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    "updatedAt" DATETIME NOT NULL CHECK (typeof("updatedAt") = 'integer'),
    CHECK (("sourceName" IS NULL) = ("sourceUrl" IS NULL)),
    CHECK (("status" = 'published') = ("publishedAt" IS NOT NULL)),
    CHECK ("publishedAt" IS NULL OR "firstPublishedAt" IS NOT NULL),
    CONSTRAINT "NewsItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NewsItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NewsItem_slug_key" ON "NewsItem"("slug");

-- The calendar and the public list read published items by release time.
CREATE INDEX "NewsItem_status_releaseAt_idx" ON "NewsItem"("status", "releaseAt");

-- A NEWS PLAN is the learner's own (lesson L29): which releases close entry
-- (high importance only, or medium and high), for how many minutes before and
-- after, for which currencies, and the time zone the day is read in. Kept in
-- versions like the Risk Plan: every save adds a row, the newest row is the
-- plan in force, and the application never edits or deletes a row. The
-- currencies are codes joined by commas, in the order of the list.
CREATE TABLE "ToolNewsPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL CHECK (length("timeZone") BETWEEN 1 AND 64 AND "timeZone" NOT GLOB '*[^A-Za-z0-9_+/-]*'),
    "minImportance" INTEGER NOT NULL CHECK (typeof("minImportance") = 'integer' AND "minImportance" IN (2, 3)),
    "minutesBefore" INTEGER NOT NULL CHECK (typeof("minutesBefore") = 'integer' AND "minutesBefore" IN (5, 10, 15, 30, 60)),
    "minutesAfter" INTEGER NOT NULL CHECK (typeof("minutesAfter") = 'integer' AND "minutesAfter" IN (5, 10, 15, 30, 60)),
    "currencies" TEXT NOT NULL CHECK (length("currencies") BETWEEN 3 AND 35 AND "currencies" NOT GLOB '*[^A-Z,]*' AND "currencies" NOT GLOB ',*' AND "currencies" NOT GLOB '*,'),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    CONSTRAINT "ToolNewsPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The learner's versions, newest first.
CREATE INDEX "ToolNewsPlan_userId_createdAt_idx" ON "ToolNewsPlan"("userId", "createdAt");
