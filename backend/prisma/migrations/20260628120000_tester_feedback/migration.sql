CREATE TABLE "TesterFeedback" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER,
  "role" TEXT,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "pageUrl" TEXT,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "browserInfo" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "resolvedAt" DATETIME,
  "resolvedById" INTEGER,
  "adminComment" TEXT,
  CONSTRAINT "TesterFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TesterFeedback_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TesterFeedback_status_createdAt_idx" ON "TesterFeedback"("status", "createdAt");
CREATE INDEX "TesterFeedback_type_severity_status_idx" ON "TesterFeedback"("type", "severity", "status");
CREATE INDEX "TesterFeedback_userId_idx" ON "TesterFeedback"("userId");
CREATE INDEX "TesterFeedback_resolvedById_idx" ON "TesterFeedback"("resolvedById");
