ALTER TABLE "UserLessonProgress"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "UserLessonProgress_id_userId_enrollmentId_curriculumVersionId_levelDefinitionId_contentVersionId_key"
ON "UserLessonProgress"("id", "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId", "contentVersionId");

CREATE TABLE "UserLessonProgressSaveReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lessonProgressId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "curriculumVersionId" INTEGER NOT NULL,
    "levelDefinitionId" INTEGER NOT NULL,
    "contentVersionId" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL CHECK (length(trim("requestId")) BETWEEN 8 AND 128),
    "revision" INTEGER NOT NULL CHECK ("revision" > 0),
    "payloadFingerprint" TEXT NOT NULL CHECK (
        length("payloadFingerprint") = 71 AND
        substr("payloadFingerprint", 1, 7) = 'sha256:' AND
        substr("payloadFingerprint", 8) NOT GLOB '*[^0-9a-f]*'
    ),
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserLessonProgressSaveReceipt_lessonProgress_ownership_fkey"
        FOREIGN KEY (
            "lessonProgressId", "userId", "enrollmentId", "curriculumVersionId",
            "levelDefinitionId", "contentVersionId"
        )
        REFERENCES "UserLessonProgress" (
            "id", "userId", "enrollmentId", "curriculumVersionId",
            "levelDefinitionId", "contentVersionId"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserLessonProgressSaveReceipt_userId_requestId_key"
ON "UserLessonProgressSaveReceipt"("userId", "requestId");

CREATE UNIQUE INDEX "UserLessonProgressSaveReceipt_lessonProgressId_revision_key"
ON "UserLessonProgressSaveReceipt"("lessonProgressId", "revision");
