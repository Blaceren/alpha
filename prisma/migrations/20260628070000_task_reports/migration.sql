ALTER TABLE "Task" ADD COLUMN "requiresReport" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TaskReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reportText" TEXT,
    "reportUrl" TEXT,
    "fileName" TEXT,
    "reviewerId" INTEGER,
    "reviewComment" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskReport_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskReport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaskReport_userId_taskId_key" ON "TaskReport"("userId", "taskId");
CREATE INDEX "TaskReport_status_submittedAt_idx" ON "TaskReport"("status", "submittedAt");
CREATE INDEX "TaskReport_taskId_idx" ON "TaskReport"("taskId");
CREATE INDEX "TaskReport_reviewerId_idx" ON "TaskReport"("reviewerId");
