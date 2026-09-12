ALTER TABLE "User" ADD COLUMN "pendingEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "pendingEmailRequestedAt" DATETIME;
CREATE UNIQUE INDEX "User_pendingEmail_key" ON "User"("pendingEmail");
