-- ===========================================================================
-- MIGRATION 48 -- POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (R6)
--
-- NORMALISE THE LEGACY TEXT TIMESTAMPS THAT MIGRATION 47 DELIBERATELY LEFT.
--
-- PRISMA SPLITS THIS FILE ON THE SEMICOLON CHARACTER, so NO COMMENT IN THIS
-- FILE CONTAINS ONE, and every statement is a single complete statement
-- terminated by exactly one semicolon.
--
-- ---------------------------------------------------------------------------
-- WHAT MIGRATION 47 DECIDED, AND WHAT IT LEFT OPEN
--
-- Migration 47 established the canonical time representation of this database
-- by measurement: INTEGER EPOCH MILLISECONDS, because that is what Prisma's
-- SQLite connector writes and binds. It found that PREPROD also held rows
-- written by raw SQL whose datetime columns are TEXT, that SQLite orders every
-- TEXT value ABOVE every INTEGER, and that a range filter therefore silently
-- excluded them.
--
-- It fixed that FOR THE LEDGER, by normalising on the way into the projection,
-- and it stated plainly that "THE SOURCE TABLES ARE NOT REWRITTEN". That was
-- the right call for the ledger and it left the source tables mixed.
--
-- WHY THAT IS NO LONGER SUFFICIENT. The source tables are read directly, not
-- only through the projection. src/lib/crm/users.ts orders the CRM learner list
-- by `createdAt DESC`, so the four TEXT-typed User rows from 2026-07-29 sort
-- above every integer row and are presented to an operator as the four NEWEST
-- learners -- ahead of an account created weeks later. That is an observable
-- wrong answer on a live operator surface, not a latent risk.
--
-- ---------------------------------------------------------------------------
-- SCOPE -- EVERY MIXED COLUMN, MEASURED RATHER THAN ASSUMED
--
-- The finding that prompted this named 10 values in 3 columns. A full scan of
-- every DATETIME column in every table found 70 values in 19 columns across 7
-- tables. Fixing only the three named would have left `UserLevelProgress`
-- mixed -- the owner table of three Growth families -- so the scan decides the
-- scope, not the finding.
--
-- THE INSTANT IS PRESERVED, NOT REINTERPRETED. `strftime('%s', v) * 1000` is
-- migration 47's own conversion, applied to the one historical shape that
-- exists here: `YYYY-MM-DD HH:MM:SS`, which SQLite defines as UTC and which
-- CURRENT_TIMESTAMP produces. Every one of the 70 values was verified to
-- round-trip exactly before this migration was written.
--
-- IDEMPOTENT BY CONSTRUCTION. Every statement is guarded by
-- `WHERE typeof(...) = 'text'`, so a second run matches nothing and changes
-- nothing. Applying it to a fresh database created from migrations updates 0
-- rows, which is correct -- a fresh database has no legacy TEXT to normalise.
--
-- NO SCHEMA CHANGE, NO TABLE REBUILD. Adding `CHECK (typeof(...) = 'integer')`
-- to these columns would require SQLite's 12-step rebuild of `User` and every
-- table referencing it, which is a materially larger operation than the defect
-- justifies. The guard against reintroduction is
-- scripts/regression/timestampStorageClassRegression.ts, which fails if any
-- TEXT value exists in any of these columns.
--
-- AN UNRECOGNISED SHAPE IS A LOUD FAILURE, NOT A GUESS. The guard below counts
-- every TEXT value that is not the one recognised shape and aborts the whole
-- migration through a CHECK if that count is not zero. Substituting the
-- migration time or now() for an unknown historical instant is therefore
-- unrepresentable rather than merely discouraged.
--
-- AND EVERY UPDATE CARRIES THE SAME REFUSAL INDEPENDENTLY. Each statement also
-- requires `strftime('%s', col) IS NOT NULL`. This is not redundancy for its
-- own sake -- it removes a real failure mode found in rehearsal. `strftime`
-- returns NULL for a shape it cannot read, and eleven of these nineteen columns
-- are NULLABLE, so a statement relying only on the guard would silently
-- overwrite a real historical instant with NULL if the guard were ever bypassed
-- or if a value were introduced between the two. With the predicate, an
-- unreadable value is LEFT EXACTLY AS IT IS and the guard is what stops the
-- run. Destroying a timestamp is not an available outcome.
-- ===========================================================================

CREATE TABLE "_legacy_timestamp_normalization_guard" (
    "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 0),
    "unrecognisedShapes" INTEGER NOT NULL
        CHECK ("unrecognisedShapes" = 0)
);

INSERT INTO "_legacy_timestamp_normalization_guard" ("id", "unrecognisedShapes")
SELECT 0, COUNT(*) FROM (
    SELECT "createdAt" AS v FROM "ChatChannel"
    UNION ALL SELECT "updatedAt" FROM "ChatChannel"
    UNION ALL SELECT "createdAt" FROM "ExchangeAccount"
    UNION ALL SELECT "updatedAt" FROM "ExchangeAccount"
    UNION ALL SELECT "createdAt" FROM "LevelCheckpointRequirement"
    UNION ALL SELECT "updatedAt" FROM "LevelCheckpointRequirement"
    UNION ALL SELECT "publishedAt" FROM "NewsPost"
    UNION ALL SELECT "createdAt" FROM "NewsPost"
    UNION ALL SELECT "createdAt" FROM "User"
    UNION ALL SELECT "updatedAt" FROM "User"
    UNION ALL SELECT "enrolledAt" FROM "UserCurriculumEnrollment"
    UNION ALL SELECT "lastMeaningfulActionAt" FROM "UserCurriculumEnrollment"
    UNION ALL SELECT "createdAt" FROM "UserCurriculumEnrollment"
    UNION ALL SELECT "updatedAt" FROM "UserCurriculumEnrollment"
    UNION ALL SELECT "startedAt" FROM "UserLevelProgress"
    UNION ALL SELECT "lastProgressAt" FROM "UserLevelProgress"
    UNION ALL SELECT "completedAt" FROM "UserLevelProgress"
    UNION ALL SELECT "createdAt" FROM "UserLevelProgress"
    UNION ALL SELECT "updatedAt" FROM "UserLevelProgress"
)
WHERE v IS NOT NULL
  AND typeof(v) = 'text'
  AND (
        v NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
     OR strftime('%s', v) IS NULL
     OR datetime(strftime('%s', v), 'unixepoch') <> v
  );

UPDATE "ChatChannel" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;

UPDATE "ChatChannel" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;

UPDATE "ExchangeAccount" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;

UPDATE "ExchangeAccount" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;

UPDATE "LevelCheckpointRequirement" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;

UPDATE "LevelCheckpointRequirement" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;

UPDATE "NewsPost" SET "publishedAt" = CAST(strftime('%s', "publishedAt") AS INTEGER) * 1000 WHERE typeof("publishedAt") = 'text' AND strftime('%s', "publishedAt") IS NOT NULL;

UPDATE "NewsPost" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;

UPDATE "User" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;

UPDATE "User" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;

UPDATE "UserCurriculumEnrollment" SET "enrolledAt" = CAST(strftime('%s', "enrolledAt") AS INTEGER) * 1000 WHERE typeof("enrolledAt") = 'text' AND strftime('%s', "enrolledAt") IS NOT NULL;

UPDATE "UserCurriculumEnrollment" SET "lastMeaningfulActionAt" = CAST(strftime('%s', "lastMeaningfulActionAt") AS INTEGER) * 1000 WHERE typeof("lastMeaningfulActionAt") = 'text' AND strftime('%s', "lastMeaningfulActionAt") IS NOT NULL;

UPDATE "UserCurriculumEnrollment" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;

UPDATE "UserCurriculumEnrollment" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;

UPDATE "UserLevelProgress" SET "startedAt" = CAST(strftime('%s', "startedAt") AS INTEGER) * 1000 WHERE typeof("startedAt") = 'text' AND strftime('%s', "startedAt") IS NOT NULL;

UPDATE "UserLevelProgress" SET "lastProgressAt" = CAST(strftime('%s', "lastProgressAt") AS INTEGER) * 1000 WHERE typeof("lastProgressAt") = 'text' AND strftime('%s', "lastProgressAt") IS NOT NULL;

UPDATE "UserLevelProgress" SET "completedAt" = CAST(strftime('%s', "completedAt") AS INTEGER) * 1000 WHERE typeof("completedAt") = 'text' AND strftime('%s', "completedAt") IS NOT NULL;

UPDATE "UserLevelProgress" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;

UPDATE "UserLevelProgress" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;

DROP TABLE "_legacy_timestamp_normalization_guard";
