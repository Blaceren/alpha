-- Phase 4B.1 additive content, assessment and lesson-progress foundation.
-- Published-resource immutability remains a service boundary. The custom
-- migration runner cannot safely execute trigger bodies.
CREATE TABLE "ContentVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
    "videoDurationSeconds" INTEGER CHECK ("videoDurationSeconds" IS NULL OR "videoDurationSeconds" > 0),
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "changeNotes" TEXT,
    CONSTRAINT "ContentVersion_lifecycle_check" CHECK (
        ("status" = 'draft' AND "publishedAt" IS NULL AND "archivedAt" IS NULL) OR
        ("status" = 'published' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NULL) OR
        ("status" = 'archived' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NOT NULL)
    ),
    CONSTRAINT "ContentVersion_levelDefinitionId_curriculumVersionId_fkey"
        FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition" ("id", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ContentVersion_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContentVersion_id_levelDefinitionId_key"
ON "ContentVersion"("id", "levelDefinitionId");
CREATE UNIQUE INDEX "ContentVersion_levelDefinitionId_versionNumber_key"
ON "ContentVersion"("levelDefinitionId", "versionNumber");
CREATE UNIQUE INDEX "ContentVersion_published_per_level_key"
ON "ContentVersion"("levelDefinitionId") WHERE "status" = 'published';
CREATE INDEX "ContentVersion_curriculumVersionId_status_idx"
ON "ContentVersion"("curriculumVersionId", "status");
CREATE INDEX "ContentVersion_createdById_idx" ON "ContentVersion"("createdById");

CREATE TABLE "ContentLocalization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contentVersionId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL CHECK (
        length("locale") BETWEEN 2 AND 35 AND
        "locale" NOT GLOB '*[^A-Za-z0-9-]*' AND
        "locale" NOT LIKE '-%' AND "locale" NOT LIKE '%-'
    ),
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "learningObjectiveExtension" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "transcript" TEXT,
    "body" JSONB NOT NULL CHECK (json_valid("body")),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentLocalization_contentVersionId_fkey"
        FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContentLocalization_contentVersionId_locale_key"
ON "ContentLocalization"("contentVersionId", "locale");

CREATE TABLE "ContentAsset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contentVersionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('video', 'subtitles', 'image', 'chart', 'attachment')),
    "assetCode" TEXT NOT NULL CHECK (length(trim("assetCode")) BETWEEN 1 AND 64),
    "locale" TEXT CHECK (
        "locale" IS NULL OR (
            length("locale") BETWEEN 2 AND 35 AND
            "locale" NOT GLOB '*[^A-Za-z0-9-]*' AND
            "locale" NOT LIKE '-%' AND "locale" NOT LIKE '%-'
        )
    ),
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER CHECK ("sizeBytes" IS NULL OR "sizeBytes" > 0),
    "durationSeconds" INTEGER CHECK ("durationSeconds" IS NULL OR "durationSeconds" > 0),
    "checksum" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentAsset_contentVersionId_fkey"
        FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContentAsset_id_contentVersionId_key"
ON "ContentAsset"("id", "contentVersionId");
CREATE UNIQUE INDEX "ContentAsset_contentVersionId_assetCode_key"
ON "ContentAsset"("contentVersionId", "assetCode");
CREATE UNIQUE INDEX "ContentAsset_contentVersionId_sortOrder_key"
ON "ContentAsset"("contentVersionId", "sortOrder");
CREATE INDEX "ContentAsset_contentVersionId_kind_locale_idx"
ON "ContentAsset"("contentVersionId", "kind", "locale");

CREATE TABLE "AssessmentVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
    "passPercent" INTEGER NOT NULL CHECK ("passPercent" BETWEEN 1 AND 100),
    "maxAttempts" INTEGER CHECK ("maxAttempts" IS NULL OR "maxAttempts" > 0),
    "showExplanation" BOOLEAN NOT NULL DEFAULT false CHECK ("showExplanation" IN (0, 1)),
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "changeNotes" TEXT,
    CONSTRAINT "AssessmentVersion_lifecycle_check" CHECK (
        ("status" = 'draft' AND "publishedAt" IS NULL AND "archivedAt" IS NULL) OR
        ("status" = 'published' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NULL) OR
        ("status" = 'archived' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NOT NULL)
    ),
    CONSTRAINT "AssessmentVersion_levelDefinitionId_curriculumVersionId_fkey"
        FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition" ("id", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentVersion_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssessmentVersion_id_levelDefinitionId_key"
ON "AssessmentVersion"("id", "levelDefinitionId");
CREATE UNIQUE INDEX "AssessmentVersion_levelDefinitionId_versionNumber_key"
ON "AssessmentVersion"("levelDefinitionId", "versionNumber");
CREATE UNIQUE INDEX "AssessmentVersion_published_per_level_key"
ON "AssessmentVersion"("levelDefinitionId") WHERE "status" = 'published';
CREATE INDEX "AssessmentVersion_curriculumVersionId_status_idx"
ON "AssessmentVersion"("curriculumVersionId", "status");
CREATE INDEX "AssessmentVersion_createdById_idx" ON "AssessmentVersion"("createdById");

CREATE TABLE "QuestionDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assessmentVersionId" INTEGER NOT NULL,
    "questionNumber" INTEGER NOT NULL CHECK ("questionNumber" > 0),
    "stableKey" TEXT NOT NULL CHECK (length(trim("stableKey")) BETWEEN 1 AND 64),
    "type" TEXT NOT NULL CHECK ("type" IN (
        'single_choice', 'multiple_choice', 'true_false', 'ordered_steps',
        'scenario_choice', 'numeric', 'chart_choice'
    )),
    "skillTag" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'disabled')),
    "options" JSONB CHECK ("options" IS NULL OR json_valid("options")),
    "correctAnswer" JSONB NOT NULL CHECK (json_valid("correctAnswer")),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionDefinition_assessmentVersionId_fkey"
        FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QuestionDefinition_assessmentVersionId_questionNumber_key"
ON "QuestionDefinition"("assessmentVersionId", "questionNumber");
CREATE UNIQUE INDEX "QuestionDefinition_assessmentVersionId_stableKey_key"
ON "QuestionDefinition"("assessmentVersionId", "stableKey");

CREATE TABLE "QuestionLocalization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL CHECK (
        length("locale") BETWEEN 2 AND 35 AND
        "locale" NOT GLOB '*[^A-Za-z0-9-]*' AND
        "locale" NOT LIKE '-%' AND "locale" NOT LIKE '%-'
    ),
    "prompt" TEXT NOT NULL,
    "optionLabels" JSONB CHECK ("optionLabels" IS NULL OR json_valid("optionLabels")),
    "explanation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionLocalization_questionId_fkey"
        FOREIGN KEY ("questionId") REFERENCES "QuestionDefinition" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QuestionLocalization_questionId_locale_key"
ON "QuestionLocalization"("questionId", "locale");

CREATE TABLE "LevelResourceBinding" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "levelDefinitionId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "contentVersionId" INTEGER,
    "assessmentVersionId" INTEGER,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LevelResourceBinding_nonempty_check"
        CHECK ("contentVersionId" IS NOT NULL OR "assessmentVersionId" IS NOT NULL),
    CONSTRAINT "LevelResourceBinding_levelDefinitionId_curriculumVersionId_fkey"
        FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition" ("id", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelResourceBinding_contentVersionId_levelDefinitionId_fkey"
        FOREIGN KEY ("contentVersionId", "levelDefinitionId")
        REFERENCES "ContentVersion" ("id", "levelDefinitionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelResourceBinding_assessmentVersionId_levelDefinitionId_fkey"
        FOREIGN KEY ("assessmentVersionId", "levelDefinitionId")
        REFERENCES "AssessmentVersion" ("id", "levelDefinitionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelResourceBinding_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LevelResourceBinding_levelDefinitionId_key"
ON "LevelResourceBinding"("levelDefinitionId");
CREATE UNIQUE INDEX "LevelResourceBinding_levelDefinitionId_curriculumVersionId_key"
ON "LevelResourceBinding"("levelDefinitionId", "curriculumVersionId");
CREATE INDEX "LevelResourceBinding_contentVersionId_idx"
ON "LevelResourceBinding"("contentVersionId");
CREATE INDEX "LevelResourceBinding_assessmentVersionId_idx"
ON "LevelResourceBinding"("assessmentVersionId");
CREATE INDEX "LevelResourceBinding_curriculumVersionId_idx"
ON "LevelResourceBinding"("curriculumVersionId");
CREATE INDEX "LevelResourceBinding_createdById_idx"
ON "LevelResourceBinding"("createdById");

CREATE TABLE "AssessmentAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    "assessmentVersionId" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL CHECK ("attemptNumber" > 0),
    "status" TEXT NOT NULL DEFAULT 'in_progress' CHECK ("status" IN ('in_progress', 'passed', 'failed')),
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "durationSeconds" INTEGER CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0),
    "totalQuestions" INTEGER CHECK ("totalQuestions" IS NULL OR "totalQuestions" > 0),
    "correctCount" INTEGER CHECK (
        "correctCount" IS NULL OR (
            "correctCount" >= 0 AND "totalQuestions" IS NOT NULL AND "correctCount" <= "totalQuestions"
        )
    ),
    "scoreBasisPoints" INTEGER CHECK ("scoreBasisPoints" IS NULL OR "scoreBasisPoints" BETWEEN 0 AND 10000),
    "submittedAnswers" JSONB CHECK ("submittedAnswers" IS NULL OR json_valid("submittedAnswers")),
    "answersFingerprint" TEXT CHECK (
        "answersFingerprint" IS NULL OR (
            "answersFingerprint" GLOB 'sha256:[0-9a-f]*' AND length("answersFingerprint") = 71
        )
    ),
    "startRequestId" TEXT NOT NULL CHECK (length(trim("startRequestId")) BETWEEN 8 AND 128),
    "submitRequestId" TEXT CHECK ("submitRequestId" IS NULL OR length(trim("submitRequestId")) BETWEEN 8 AND 128),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssessmentAttempt_submission_check" CHECK (
        ("status" = 'in_progress' AND "submittedAt" IS NULL AND "durationSeconds" IS NULL AND
         "totalQuestions" IS NULL AND "correctCount" IS NULL AND "scoreBasisPoints" IS NULL AND
         "submittedAnswers" IS NULL AND "answersFingerprint" IS NULL AND "submitRequestId" IS NULL) OR
        ("status" IN ('passed', 'failed') AND "submittedAt" IS NOT NULL AND "durationSeconds" IS NOT NULL AND
         "totalQuestions" IS NOT NULL AND "correctCount" IS NOT NULL AND "scoreBasisPoints" IS NOT NULL AND
         "submittedAnswers" IS NOT NULL AND "answersFingerprint" IS NOT NULL AND "submitRequestId" IS NOT NULL)
    ),
    CONSTRAINT "AssessmentAttempt_timestamp_check" CHECK (
        "submittedAt" IS NULL OR julianday("submittedAt") >= julianday("startedAt")
    ),
    CONSTRAINT "AssessmentAttempt_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentAttempt_enrollmentId_userId_curriculumVersionId_fkey"
        FOREIGN KEY ("enrollmentId", "userId", "curriculumVersionId")
        REFERENCES "UserCurriculumEnrollment" ("id", "userId", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentAttempt_levelDefinitionId_curriculumVersionId_fkey"
        FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition" ("id", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentAttempt_assessmentVersionId_levelDefinitionId_fkey"
        FOREIGN KEY ("assessmentVersionId", "levelDefinitionId")
        REFERENCES "AssessmentVersion" ("id", "levelDefinitionId")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssessmentAttempt_enrollmentId_assessmentVersionId_attemptNumber_key"
ON "AssessmentAttempt"("enrollmentId", "assessmentVersionId", "attemptNumber");
CREATE UNIQUE INDEX "AssessmentAttempt_enrollmentId_startRequestId_key"
ON "AssessmentAttempt"("enrollmentId", "startRequestId");
CREATE UNIQUE INDEX "AssessmentAttempt_active_per_assessment_key"
ON "AssessmentAttempt"("enrollmentId", "assessmentVersionId") WHERE "status" = 'in_progress';
CREATE INDEX "AssessmentAttempt_enrollmentId_assessmentVersionId_status_idx"
ON "AssessmentAttempt"("enrollmentId", "assessmentVersionId", "status");
CREATE INDEX "AssessmentAttempt_userId_createdAt_idx"
ON "AssessmentAttempt"("userId", "createdAt");
CREATE INDEX "AssessmentAttempt_assessmentVersionId_status_idx"
ON "AssessmentAttempt"("assessmentVersionId", "status");

CREATE TABLE "UserLessonProgress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    "contentVersionId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress' CHECK ("status" IN ('in_progress', 'completed')),
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastProgressAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "playbackPositionSeconds" INTEGER NOT NULL DEFAULT 0 CHECK ("playbackPositionSeconds" >= 0),
    "completedSections" JSONB NOT NULL DEFAULT '[]' CHECK (json_valid("completedSections")),
    "progressData" JSONB CHECK ("progressData" IS NULL OR json_valid("progressData")),
    "lastRequestId" TEXT CHECK ("lastRequestId" IS NULL OR length(trim("lastRequestId")) BETWEEN 8 AND 128),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserLessonProgress_status_timestamp_check" CHECK (
        ("status" = 'in_progress' AND "completedAt" IS NULL) OR
        ("status" = 'completed' AND "completedAt" IS NOT NULL)
    ),
    CONSTRAINT "UserLessonProgress_timestamp_order_check" CHECK (
        julianday("lastProgressAt") >= julianday("startedAt") AND
        ("completedAt" IS NULL OR julianday("completedAt") >= julianday("startedAt"))
    ),
    CONSTRAINT "UserLessonProgress_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserLessonProgress_enrollmentId_userId_curriculumVersionId_fkey"
        FOREIGN KEY ("enrollmentId", "userId", "curriculumVersionId")
        REFERENCES "UserCurriculumEnrollment" ("id", "userId", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserLessonProgress_levelDefinitionId_curriculumVersionId_fkey"
        FOREIGN KEY ("levelDefinitionId", "curriculumVersionId")
        REFERENCES "LevelDefinition" ("id", "curriculumVersionId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserLessonProgress_contentVersionId_levelDefinitionId_fkey"
        FOREIGN KEY ("contentVersionId", "levelDefinitionId")
        REFERENCES "ContentVersion" ("id", "levelDefinitionId")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserLessonProgress_enrollmentId_contentVersionId_key"
ON "UserLessonProgress"("enrollmentId", "contentVersionId");
CREATE INDEX "UserLessonProgress_enrollmentId_levelDefinitionId_idx"
ON "UserLessonProgress"("enrollmentId", "levelDefinitionId");
CREATE INDEX "UserLessonProgress_userId_lastProgressAt_idx"
ON "UserLessonProgress"("userId", "lastProgressAt");
