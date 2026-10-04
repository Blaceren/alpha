-- PROGRAM STRUCTURE — what the 30-level program needs and the 100-level one did
-- not (owner, 2026-10-02: «внедряем первые 30 настоящих уровней … плеер так же
-- добавляй уже»).
--
-- ADDITIVE. Four nullable columns on three existing tables and two new tables.
-- No table is rebuilt, no existing column is altered and no existing row is
-- rewritten. Every new column is NULL on every existing row, and NULL means
-- exactly what the product did before the column existed. A Backend release
-- built before this migration selects none of them and never queries the new
-- tables, so it stays a valid rollback target after they have rows.
--
-- HAND-WRITTEN for the same reason as every recent migration here.

-- 1. CHAPTERS. A chapter is a run of consecutive modules with a number and a
--    title («Глава 1 · Основы и первые реальные сделки»). It carries nothing
--    else, so it lives on the module. Both columns are set together or not at
--    all.
ALTER TABLE "ModuleDefinition" ADD COLUMN "chapterNumber" INTEGER
    CHECK ("chapterNumber" IS NULL OR "chapterNumber" > 0);
ALTER TABLE "ModuleDefinition" ADD COLUMN "chapterTitle" TEXT
    CHECK (
        ("chapterTitle" IS NULL) = ("chapterNumber" IS NULL)
        AND ("chapterTitle" IS NULL OR length(trim("chapterTitle")) BETWEEN 1 AND 300)
    );

-- 2. WHAT A LEVEL IS CALLED. Display only: completion is still decided by
--    "type" and "completionMethod". A closed vocabulary, so a reader can
--    enumerate it.
ALTER TABLE "LevelDefinition" ADD COLUMN "presentationKind" TEXT
    CHECK ("presentationKind" IS NULL OR "presentationKind" IN ('lesson', 'task', 'report', 'practice', 'assembly'));

-- 3. «ПЕРЕСМОТРЕТЬ: С 1:55». The second of the lesson video where the answer to
--    a question is taught. Bounded by one day, like every video duration here.
ALTER TABLE "QuestionDefinition" ADD COLUMN "rewatchFromSeconds" INTEGER
    CHECK ("rewatchFromSeconds" IS NULL OR "rewatchFromSeconds" BETWEEN 0 AND 86400);

-- 4. WHICH LEVEL OPENS WHICH TOOL, PER VERSION. Until now one global number per
--    tool in the Backend source, true only while every version had one shape.
CREATE TABLE "LevelToolUnlock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "toolCode" TEXT NOT NULL CHECK ("toolCode" GLOB 'tool.[a-z]*' AND length("toolCode") BETWEEN 6 AND 64),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    -- CASCADE: an unlock row is a statement about the level and has no history
    -- of its own, so a draft level that is removed takes it along. A published
    -- level is never deleted — its learners' progress rows are RESTRICT.
    CONSTRAINT "LevelToolUnlock_levelDefinition_fkey" FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition" ("id", "curriculumVersionId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One level opens a tool in a version. A level may open several tools.
CREATE UNIQUE INDEX "LevelToolUnlock_curriculumVersionId_toolCode_key"
ON "LevelToolUnlock"("curriculumVersionId", "toolCode");

CREATE INDEX "LevelToolUnlock_levelDefinitionId_idx" ON "LevelToolUnlock"("levelDefinitionId");

-- THE RULE EVERY EXISTING VERSION WAS READ BY, WRITTEN DOWN. Until this
-- migration a tool was open when the level with a fixed NUMBER was completed,
-- whatever version the learner was pinned to: 5, 10, 15, 20, 25, 30. These rows
-- state that same rule for every version that has such a level, so a learner on
-- an existing version keeps exactly the tools they had. A version too short to
-- have the level gets no row, which reads as "locked" — as it did.
INSERT INTO "LevelToolUnlock" ("levelDefinitionId", "curriculumVersionId", "toolCode")
SELECT level."id", level."curriculumVersionId", legacy."toolCode"
FROM "LevelDefinition" AS level
JOIN (
    SELECT 5 AS "levelNumber", 'tool.trade_card' AS "toolCode"
    UNION ALL SELECT 10, 'tool.trading_journal'
    UNION ALL SELECT 15, 'tool.risk_calculator'
    UNION ALL SELECT 20, 'tool.entry_checklist'
    UNION ALL SELECT 25, 'tool.personal_stats'
    UNION ALL SELECT 30, 'tool.news_calendar'
) AS legacy ON legacy."levelNumber" = level."levelNumber";

-- 5. LESSON MEDIA. The video a lesson plays, registered per level STABLE CODE
--    and replaced in place — a file is re-cut and re-encoded without the lesson
--    changing, and a content version is immutable once published. "storageKey"
--    is a path under the deployment's media root, never a URL and never a host.
CREATE TABLE "LessonMediaAsset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "curriculumCode" TEXT NOT NULL CHECK (length(trim("curriculumCode")) BETWEEN 1 AND 120),
    "levelStableCode" TEXT NOT NULL CHECK (length(trim("levelStableCode")) BETWEEN 1 AND 128),
    "kind" TEXT NOT NULL CHECK ("kind" IN ('video', 'subtitles', 'image')),
    "assetCode" TEXT NOT NULL CHECK (length("assetCode") BETWEEN 1 AND 64 AND "assetCode" NOT GLOB '*[^a-z0-9-]*'),
    "locale" TEXT,
    -- Relative, forward slashes, no traversal, no leading slash.
    "storageKey" TEXT NOT NULL CHECK (
        length("storageKey") BETWEEN 3 AND 400
        AND "storageKey" NOT GLOB '/*'
        AND "storageKey" NOT GLOB '*..*'
        AND "storageKey" NOT GLOB '*[^A-Za-z0-9._/-]*'
    ),
    "mimeType" TEXT NOT NULL CHECK (length("mimeType") BETWEEN 3 AND 255),
    "sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes" > 0),
    "durationSeconds" INTEGER CHECK ("durationSeconds" IS NULL OR "durationSeconds" BETWEEN 1 AND 86400),
    "checksum" TEXT NOT NULL CHECK (length("checksum") = 64 AND "checksum" NOT GLOB '*[^0-9a-f]*'),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    "updatedAt" DATETIME NOT NULL CHECK (typeof("updatedAt") = 'integer'),
    -- A video without a length cannot bound the saved playback position.
    CHECK ("kind" <> 'video' OR "durationSeconds" IS NOT NULL)
);

-- One current file per lesson and asset code.
CREATE UNIQUE INDEX "LessonMediaAsset_curriculumCode_levelStableCode_assetCode_key"
ON "LessonMediaAsset"("curriculumCode", "levelStableCode", "assetCode");

CREATE INDEX "LessonMediaAsset_curriculumCode_levelStableCode_kind_idx"
ON "LessonMediaAsset"("curriculumCode", "levelStableCode", "kind");
