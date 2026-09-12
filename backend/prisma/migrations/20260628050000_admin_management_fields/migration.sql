-- Add admin management fields.
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Task" ADD COLUMN "isCheckpoint" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Reward" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "NewsPost" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'published';
