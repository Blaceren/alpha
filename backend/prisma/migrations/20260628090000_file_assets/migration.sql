CREATE TABLE "FileAsset" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ownerUserId" INTEGER NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileAsset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FileAsset_storedName_key" ON "FileAsset"("storedName");
CREATE INDEX "FileAsset_ownerUserId_purpose_createdAt_idx" ON "FileAsset"("ownerUserId", "purpose", "createdAt");

ALTER TABLE "TaskReport" ADD COLUMN "fileAssetId" INTEGER REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD COLUMN "fileAssetId" INTEGER REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "SupportMessage_fileAssetId_idx" ON "SupportMessage"("fileAssetId");
